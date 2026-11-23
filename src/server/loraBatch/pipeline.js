/**
 * LoRA 单任务全链路流水线
 * 素材下载 -> 智能裁切 -> 提示词打标 -> 预缓存 -> 训练 -> 导出模型 -> 预览生图
 * 每个阶段产物落盘并在 job.stageStatus 记录状态, 失败后可从断点阶段重试
 */
import axios from 'axios';

import {
    STAGE_KEYS,
    getConfig,
    appendLog,
} from './jobStore';
import {
    ensureTrainer,
    savePrecacheConfig,
    saveTrainConfig,
    runAndWait,
    exportLora,
} from './academiaClient';
import { parseXhsProfile } from '../lib/xhs/xhsProfileParser';
import { downloadSmallVideoByLink } from '../video/downloadVideo';
import { runSmartCut, stopSmartCut } from '../smartcut/index';
import { startComfyuiService, COMFYUI_CTRL_BASE } from '../comfyui/index';
import { startService, getAcademiaHome } from '../dashboard/index';

const fs = require('fs');
const path = require('path');

const IMAGE_SUFFIXES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const VIDEO_SUFFIXES = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.ts', '.m4v']);

// LoRA 模型管理页"生图测试"使用的默认提示词
const DEFAULT_PREVIEW_PROMPT = '漂亮少女，真人，姿态自然，头像感，特别特别瘦，白皙皮肤。梦核风格的前置摄像头抓拍画面，有一种抓拍的随性松弛氛围感，ins风，随手记录。画面里的少女超级漂亮，低分辨率，露出的脸和皮肤微微曝光，柔顺头发，盘发，午后的阳光洒在身上形成漂亮的光影，优美的姿势，背景是庄园式农场草原树林，充满生命力，生机勃勃。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class JobStoppedError extends Error {
    constructor() {
        super('用户停止任务');
        this.stopped = true;
    }
}

const walkFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const result = [];
    const walk = (current) => {
        fs.readdirSync(current).forEach((name) => {
            const full = path.join(current, name);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                walk(full);
            } else {
                result.push(full);
            }
        });
    };
    walk(dir);
    return result;
};

const listImageFiles = (dir) => walkFiles(dir)
    .filter((file) => IMAGE_SUFFIXES.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

// 等间距挑出 keep 个文件, 保留跨素材的时间多样性
const pickEvenly = (files, keep) => {
    if (files.length <= keep) return [...files];
    const picked = [];
    for (let i = 0; i < keep; i++) {
        const index = Math.floor(((i + 0.5) * files.length) / keep);
        picked.push(files[index]);
    }
    return picked;
};

/**
 * 清理该项目在训练器侧的全部历史状态(缓存 + 训练输出)。
 * 训练器按 project_name 固定写入 Cache_Data/ 与 Outputs/ 子目录,
 * 同名项目重训若不清理, current_step.txt + resume_checkpoint 会触发自动续训,
 * 导致 0 步训练直接导出旧权重。crop 阶段是数据集身份变化的唯一入口, 在这里统一清理。
 */
const cleanTrainerProjectState = (job) => {
    const home = getAcademiaHome();
    if (!home || !fs.existsSync(home)) return;
    const cacheDir = path.join(home, 'Cache_Data', `cached_data_qwen_image21_${job.projectName}`);
    const outputDir = path.join(home, 'Outputs', `qwen_image21_lora_output_${job.projectName}`);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    appendLog(job, 'crop', '已清理训练器中该项目的旧缓存与旧训练输出，确保从零训练');
};

// ---------------- comfyui-ctrl 子服务调用(统一响应包络 {code,message,data}) ----------------

const ctrlRequest = async (method, url, body) => {
    const resp = await axios({
        method,
        url,
        data: body,
        proxy: false,
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
    });
    const envelope = resp.data || {};
    if (envelope.code !== 0) {
        throw new Error(envelope.message || 'comfyui-ctrl 调用失败');
    }
    return envelope.data;
};

const ctrlGet = (url) => ctrlRequest('GET', url);
const ctrlPost = (url, body) => ctrlRequest('POST', url, body);
const ctrlPut = (url, body) => ctrlRequest('PUT', url, body);

// 训练前清理 ComfyUI/Ollama 驻留显存; 失败不阻塞流水线
async function releaseVramForTraining(setStage) {
    const service = await startComfyuiService();
    if (!service.ready) {
        setStage('caption', 'running', 5, 'comfyui-ctrl 未就绪，跳过显存清理');
        return;
    }
    try {
        await axios.post(`${COMFYUI_CTRL_BASE}/api/v1/vram/release`, {}, {
            proxy: false,
            timeout: 30000,
        });
        await sleep(8000);
    } catch (err) {
        setStage('caption', 'running', 5, `显存清理失败但继续训练: ${err.message}`);
    }
}

// ---------------- 阶段 1: 小红书主页素材下载 ----------------

async function stageDownload(job, hooks) {
    const { assertRunning, setStage } = hooks;
    setStage('download', 'running', 2, '解析小红书主页');
    // 重试/重跑时先清空上次的半成品 raw, 下载阶段始终全量重取, 避免重复素材混入
    fs.rmSync(job.paths.rawDir, { recursive: true, force: true });
    const profile = await parseXhsProfile(job.profileUrl, { limit: job.params.noteLimit });
    if (!profile || !profile.isProfile) {
        throw new Error((profile && profile.errorMsg) || '小红书主页解析失败');
    }
    job.nickname = (profile.user && profile.user.nickname) || job.nickname;
    job.userId = (profile.user && profile.user.userId) || '';
    const notes = profile.notes || [];
    job.stats.noteCount = notes.length;
    if (!notes.length) {
        throw new Error('主页没有可下载的作品');
    }
    fs.mkdirSync(job.paths.rawDir, { recursive: true });

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < notes.length; i++) {
        assertRunning();
        const note = notes[i];
        setStage(
            'download',
            'running',
            Math.round(((i + 1) / notes.length) * 100),
            `下载作品 ${i + 1}/${notes.length}`,
        );
        try {
            const info = await downloadSmallVideoByLink(note.noteUrl, {
                link: note.noteUrl,
                xhsWindowParse: true,
                noteId: note.noteId,
                xsecToken: note.xsecToken,
                profileUrl: profile.profileUrl,
                noteUrl: note.noteUrl,
                targetDir: job.paths.rawDir,
            });
            if (info && !info.errorMsg && (info.videoUrl || (info.images && info.images.length))) {
                ok += 1;
            } else {
                failed += 1;
                appendLog(job, 'download', `作品下载失败: ${note.noteId} ${(info && info.errorMsg) || ''}`);
            }
        } catch (err) {
            failed += 1;
            appendLog(job, 'download', `作品下载异常: ${note.noteId} ${err.message}`);
        }
    }
    job.stats.downloaded = ok;
    job.stats.failedDownloads = failed;

    const rawFiles = walkFiles(job.paths.rawDir);
    job.stats.rawVideos = rawFiles
        .filter((file) => VIDEO_SUFFIXES.has(path.extname(file).toLowerCase())).length;
    job.stats.rawImages = rawFiles
        .filter((file) => IMAGE_SUFFIXES.has(path.extname(file).toLowerCase())).length;
    if (job.stats.rawVideos + job.stats.rawImages === 0) {
        throw new Error('素材下载全部失败，请检查小红书登录态或网络后重试');
    }
}

// ---------------- 阶段 2: 智能裁切 + 素材数量门禁 ----------------

async function stageCrop(job, hooks) {
    const { assertRunning, setStage } = hooks;
    // 同名项目重跑/重新裁切时先清空旧 dataset, 避免旧图混入新素材
    fs.rmSync(job.paths.datasetDir, { recursive: true, force: true });
    fs.mkdirSync(job.paths.datasetDir, { recursive: true });
    // 同步清理训练器侧的项目缓存与续训检查点, 防止假训练
    cleanTrainerProjectState(job);
    setStage('crop', 'running', 5, `智能裁切中（仅头部，每个视频抽 ${job.params.frames} 帧）`);

    const stopWatcher = setInterval(() => {
        if (job.stopRequested) stopSmartCut();
    }, 1000);
    let result;
    try {
        result = await runSmartCut({
            inputDir: job.paths.rawDir,
            outputDir: job.paths.datasetDir,
            frames: job.params.frames,
            parts: ['head'],
            size: 1024,
            scale: 2.6,
            recursive: true,
            aiSeg: false,
        });
    } finally {
        clearInterval(stopWatcher);
    }
    assertRunning();
    if (result && result.stopped) throw new JobStoppedError();
    // python 进程整体非 0 退出才算硬失败; 个别单元无脸/损坏记为 failed 但仍可能产出足量素材, 交给数量门禁判断
    if (!result || result.code !== 0) {
        throw new Error((result && result.summary) || '智能裁切进程异常退出');
    }
    if (result.summary) {
        appendLog(job, 'crop', result.summary);
    }

    let images = listImageFiles(job.paths.datasetDir);
    if (images.length < job.params.minImages) {
        throw new Error(
            `素材不足：仅裁切出 ${images.length} 张头部素材，下限 ${job.params.minImages} 张，请增加下载作品数后重试`,
        );
    }
    if (images.length > job.params.maxImages) {
        const kept = pickEvenly(images, job.params.maxImages);
        const keptSet = new Set(kept);
        images.forEach((file) => {
            if (!keptSet.has(file)) fs.rmSync(file, { force: true });
        });
        job.stats.trimmed = images.length - kept.length;
        images = listImageFiles(job.paths.datasetDir);
        appendLog(job, 'crop', `素材超过上限，已等间距精简 ${job.stats.trimmed} 张`);
    }
    job.stats.datasetCount = images.length;
}

// ---------------- 训练器配置构建 ----------------

const buildPrecacheConfig = (job) => ({
    project_name: job.projectName,
    trigger_word: job.triggerWord,
    dataset_path: job.paths.datasetDir,
    target_area: 589824,
    multiple: 32,
    max_side: 1280,
    text_encoder: 'BF16_offload',
    cache_dir: `./Cache_Data/cached_data_qwen_image21_${job.projectName}`,
    lora_type: 'normal',
    preview_custom_prompt: '',
    preview_edit_image: '',
    preview_edit_images: [],
});

const buildTrainConfig = (job) => ({
    dataset_path: job.paths.datasetDir,
    project_name: job.projectName,
    cache_dir: `./Cache_Data/cached_data_qwen_image21_${job.projectName}`,
    output_dir: `./Outputs/qwen_image21_lora_output_${job.projectName}`,
    trigger_word: job.triggerWord,
    lora_type: 'normal',
    preview_custom_prompt: '',
    preview_edit_image: '',
    preview_edit_images: [],
    total_steps: job.params.totalSteps,
    lr: 0.0004,
    lr_scheduler: 'cosine',
    warmup_steps: 100,
    lr_cycles: 3,
    lora_rank: 32,
    lora_alpha: 16,
    use_rslora: false,
    use_loraplus: false,
    use_lokr: false,
    lokr_factor: 16,
    lora_targets: 'blocks',
    batch_size: 1,
    grad_accum_steps: 4,
    save_every: 25,
    seed: -1,
    preview_every: 50,
    preview_caption_mode: 'random',
    preview_steps: 8,
    preview_cfg: 1,
    preview_size: 768,
    preview_aspect_ratio: '1:1',
    preview_width: 768,
    preview_height: 768,
    use_turbo: true,
    turbo_lora_strength: 1,
    use_filter_bypass: false,
    filter_bypass_strength: 0.01,
    export_final_name: `qwen_image21_lora_${job.projectName}.safetensors`,
});

const trainerProgress = (job, stage, setStage, label) => (progress) => {
    const total = progress.total || 1;
    const percent = Math.min(99, Math.round((progress.step / total) * 100));
    setStage(stage, 'running', percent, `${label} ${progress.step}/${progress.total}`);
    if (stage === 'train') {
        job.stats.trainStep = progress.step;
        job.stats.trainTotal = progress.total;
    }
};

// ---------------- 阶段 3-5: 打标 / 预缓存 / 训练 ----------------

async function stageCaption(job, hooks) {
    const { setStage } = hooks;
    setStage('caption', 'running', 2, '启动训练器并清理显存');
    await ensureTrainer();
    await releaseVramForTraining(setStage);
    await savePrecacheConfig(buildPrecacheConfig(job));
    setStage('caption', 'running', 5, 'Qwen3-VL 逐张打标中');
    await runAndWait('caption', {
        shouldStop: () => job.stopRequested,
        onProgress: trainerProgress(job, 'caption', setStage, '打标'),
    });
    setStage('caption', 'running', 99, `打标完成 ${job.stats.datasetCount} 张`);
}

async function stagePrecache(job, hooks) {
    const { setStage } = hooks;
    setStage('precache', 'running', 5, '预缓存文本编码与 latent');
    await runAndWait('precache', {
        shouldStop: () => job.stopRequested,
        onProgress: trainerProgress(job, 'precache', setStage, '预缓存'),
    });
    setStage('precache', 'running', 99, `预缓存完成 ${job.stats.datasetCount} 张`);
}

async function stageTrain(job, hooks) {
    const { setStage } = hooks;
    setStage('train', 'running', 2, '保存训练参数');
    await saveTrainConfig(buildTrainConfig(job));
    setStage('train', 'running', 5, `开始训练 ${job.params.totalSteps} 步`);
    await runAndWait('train', {
        shouldStop: () => job.stopRequested,
        onProgress: trainerProgress(job, 'train', setStage, '训练'),
        pollMs: 3000,
    });
    // 守卫: 训练器若残留同项目续训检查点会 0 步结束并导出旧权重, 这里直接判失败提示重裁
    if (!job.stats.trainStep) {
        throw new Error('训练器未执行任何训练步（疑似复用了同名项目的旧续训检查点），请重新裁切后再试');
    }
    setStage('train', 'running', 99, `训练完成 ${job.stats.trainStep}/${job.stats.trainTotal}`);
}

// ---------------- 阶段 6: 导出到 ComfyUI LoRA 目录 ----------------

async function stageExport(job) {
    const exportDir = getConfig().loraExportDir;
    fs.mkdirSync(exportDir, { recursive: true });
    const finalName = `qwen_image21_lora_${job.projectName}.safetensors`;
    const ret = await exportLora(exportDir, finalName);
    job.paths.exportFile = ret.dest || path.join(exportDir, ret.filename || finalName);
}

// ---------------- 阶段 7: 自动生图预览 + 缩略图 + 分类打标 ----------------

async function waitLoraListed(base, finalName, shouldStop, deadlineMs = 120000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        if (shouldStop()) throw new JobStoppedError();
        try {
            // lora-library 接口带 refresh=true 会强制重新扫描模型目录, 避开 5 分钟枚举缓存
            const data = await ctrlGet(`${base}/api/v1/admin/lora-library?refresh=true`);
            const loras = ((data && data.loras) || []).map((item) => item.name);
            const matched = loras
                .find((name) => path.basename(name).toLowerCase() === finalName.toLowerCase());
            if (matched) return matched;
        } catch (err) {
            // ComfyUI 未就绪(如刚启动), 不退出, 继续轮询直到超时
        }
        await sleep(3000);
    }
    return '';
}

async function stagePreview(job, hooks) {
    const { assertRunning, setStage } = hooks;
    setStage('preview', 'running', 5, '检查 comfyui-ctrl 服务');
    const service = await startComfyuiService();
    if (!service.ready) {
        throw new Error('comfyui-ctrl 不可用，模型已导出，可稍后在 LoRA 模型管理页手动测试');
    }
    const base = COMFYUI_CTRL_BASE;
    const finalName = path.basename(job.paths.exportFile);

    let loraName = job.paths.loraName;
    if (!loraName) {
        loraName = await waitLoraListed(base, finalName, () => job.stopRequested, 30000);
        if (!loraName) {
            // ComfyUI 未运行时自动拉起一次再等
            setStage('preview', 'running', 10, 'ComfyUI 未就绪，尝试自动启动');
            await startService('comfyui');
            loraName = await waitLoraListed(base, finalName, () => job.stopRequested, 180000);
        }
    }
    if (!loraName) {
        throw new Error(`LoRA 列表中找不到 ${finalName}，模型已导出，请确认 ComfyUI 已刷新模型目录后重试本阶段`);
    }
    job.paths.loraName = loraName;
    assertRunning();

    setStage('preview', 'running', 40, '提交预览生图任务');
    const jobInfo = await ctrlPost(`${base}/api/v1/workflows/qwen_lora_txt2img/invoke`, {
        params: {
            prompt: DEFAULT_PREVIEW_PROMPT,
            lora_enabled: true,
            lora_name: loraName,
            lora_strength: 1,
            seed: -1,
            aspect_ratio: '1:1 (Square)',
        },
    });

    const deadline = Date.now() + 600000;
    let result = null;
    while (Date.now() < deadline) {
        assertRunning();
        await sleep(3000);
        const info = await ctrlGet(`${base}/api/v1/jobs/${jobInfo.job_id}`);
        if (info.status === 'success') {
            result = info;
            break;
        }
        if (info.status === 'error') {
            throw new Error(info.error || '预览生图失败');
        }
        setStage('preview', 'running', 60, `预览生图中（${info.status}）`);
    }
    if (!result) throw new Error('预览生图超时（10 分钟）');

    setStage('preview', 'running', 85, '保存缩略图与分类标签');
    const imageResp = await axios.get(`${base}${result.image_url}`, {
        responseType: 'arraybuffer',
        proxy: false,
        timeout: 30000,
    });
    const buffer = Buffer.from(imageResp.data);
    // PNG 签名校验, LoRA 库缩略图接口只接受 image/png
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
        throw new Error('预览图不是 PNG 格式，无法保存为缩略图');
    }
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
    await ctrlPost(`${base}/api/v1/admin/lora-library/thumbnail`, {
        name: loraName,
        image_data: dataUrl,
    });
    await ctrlPut(`${base}/api/v1/admin/lora-library/tags/batch`, {
        names: [loraName],
        tags: { base: ['qwen'], function: ['portrait'] },
    });
    job.paths.previewThumb = true;
}

const STAGE_RUNNERS = {
    download: stageDownload,
    crop: stageCrop,
    caption: stageCaption,
    precache: stagePrecache,
    train: stageTrain,
    export: stageExport,
    preview: stagePreview,
};

/**
 * 执行任务流水线, hooks 由 index.js 提供:
 *   setStage(stage, status, percent, message) 状态落盘并推送渲染层
 *   save()                                  强制落盘
 */
export async function runJobPipeline(job, hooks) {
    const { setStage, save } = hooks;
    const assertRunning = () => {
        if (job.stopRequested) throw new JobStoppedError();
    };
    const stageHooks = { assertRunning, setStage, save };

    job.status = 'running';
    job.error = '';
    save();
    try {
        for (let i = 0; i < STAGE_KEYS.length; i++) {
            const stage = STAGE_KEYS[i];
            const stageState = job.stageStatus[stage];
            if (stageState.status !== 'done') {
                assertRunning();
                job.stage = stage;
                stageState.startedAt = stageState.startedAt || Date.now();
                setStage(stage, 'running', stageState.percent || 2, stageState.message || '');
                await STAGE_RUNNERS[stage](job, stageHooks);
                setStage(stage, 'done', 100, '');
                save();
                // 人工卡口: 裁切完成后暂停, 等用户确认素材再继续打标与训练
                if (stage === 'crop') {
                    job.status = 'awaiting_confirm';
                    job.stage = '';
                    appendLog(job, 'crop', '裁切完成，等待人工确认素材后继续训练');
                    save();
                    return;
                }
            }
        }
        job.status = 'done';
        job.stage = '';
        save();
    } catch (err) {
        const stopped = Boolean(err.stopped);
        job.status = stopped ? 'stopped' : 'failed';
        job.error = err.message;
        if (job.stage && job.stageStatus[job.stage]) {
            job.stageStatus[job.stage].status = stopped ? 'stopped' : 'failed';
            job.stageStatus[job.stage].message = err.message;
        }
        appendLog(job, job.stage || 'pipeline', err.message);
        save();
    }
}
