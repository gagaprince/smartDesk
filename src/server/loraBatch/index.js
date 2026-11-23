/**
 * LoRA 批量训练: IPC 入口与串行任务队列
 * 单 GPU + smartcut 单任务锁决定了同一时刻只能跑一个任务, 其余排队
 */
import { registHandle, getMainWindow } from '../ipc';
import { HandleEvents, RenderReceiveEvents } from '@/common/eventConst';
import {
    initStore,
    getConfig,
    updateConfig,
    listJobs,
    getJob,
    upsertJob,
    removeJob,
    createJobRecord,
    appendLog,
    projectNameExists,
    sanitizeProjectName,
    suggestProjectName,
    uniqueProjectName,
    newBatchId,
    listJobsByBatch,
    batchHasAwaiting,
    extractProfileUrl,
    STAGE_KEYS,
} from './jobStore';
import { runJobPipeline } from './pipeline';

const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const DATASET_IMAGE_SUFFIXES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);

const countDatasetImages = (dir) => {
    if (!dir || !fs.existsSync(dir)) return 0;
    let count = 0;
    const walk = (current) => {
        fs.readdirSync(current).forEach((name) => {
            const full = path.join(current, name);
            if (fs.statSync(full).isDirectory()) {
                walk(full);
            } else if (DATASET_IMAGE_SUFFIXES.has(path.extname(full).toLowerCase())) {
                count += 1;
            }
        });
    };
    walk(dir);
    return count;
};

let queue = [];
let pumping = false;

const emit = (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
        win.webContents.send(RenderReceiveEvents.LORA_BATCH_PROGRESS, payload);
    }
};

const makeHooks = (job) => {
    const save = () => upsertJob(job);
    const setStage = (stage, status, percent, message) => {
        const stageState = job.stageStatus[stage];
        if (!stageState) return;
        stageState.status = status;
        if (typeof percent === 'number') stageState.percent = percent;
        if (message) stageState.message = message;
        stageState.updatedAt = Date.now();
        if (status === 'running') {
            stageState.startedAt = stageState.startedAt || Date.now();
            job.stage = stage;
        }
        if (status === 'done') {
            stageState.percent = 100;
            stageState.finishedAt = Date.now();
        }
        if (message) appendLog(job, stage, message);
        upsertJob(job);
        emit({ type: 'update', jobId: job.id, job: getJob(job.id) });
    };
    return { save, setStage };
};

// 批次屏障: 已通过裁切卡口的任务, 必须等同批次所有任务都完成人工确认才放行训练阶段,
// 让下载/裁切先行、人工审核集中、训练在确认后串行执行
const isBatchReady = (job) => {
    const cropState = job.stageStatus && job.stageStatus.crop;
    if (cropState && cropState.status === 'done' && job.status === 'queued') {
        return !batchHasAwaiting(job.batchId);
    }
    return true;
};

async function pump() {
    if (pumping) return;
    pumping = true;
    try {
        while (queue.length) {
            const jobId = queue[0];
            const job = getJob(jobId);
            if (!job || job.stopRequested || job.status === 'stopped') {
                queue.shift();
            } else if (!isBatchReady(job)) {
                // 队头在等同批次人工确认, 让出泵; 批量确认后 enqueue 会再次触发
                break;
            } else {
                queue.shift();
                emit({ type: 'update', jobId: job.id, job: getJob(job.id) });
                await runJobPipeline(job, makeHooks(job));
                emit({ type: 'update', jobId: job.id, job: getJob(job.id) });
            }
        }
    } finally {
        pumping = false;
    }
}

const enqueue = (jobId) => {
    if (!queue.includes(jobId)) queue.push(jobId);
    pump();
};

// ---------------- IPC handlers ----------------

const handleGetConfig = () => getConfig();

const handleSetConfig = (patch) => updateConfig(patch || {});

const handleListJobs = () => listJobs();

const handleCreateJob = (payload = {}) => {
    const profileUrl = extractProfileUrl(payload.profileUrlText || payload.profileUrl || '');
    if (!profileUrl) {
        throw new Error('无法从输入中识别小红书链接');
    }
    const projectName = sanitizeProjectName(payload.projectName || suggestProjectName());
    if (!projectName) {
        throw new Error('项目名不合法，仅支持英文、数字、下划线与短横线');
    }
    if (projectNameExists(projectName)) {
        throw new Error(`项目名 ${projectName} 已存在，请换一个`);
    }
    const job = createJobRecord({ profileUrl, projectName });
    // 同名任务记录已删除但磁盘残留仍可能存在(raw/dataset), 新任务开始前整体清空, 避免旧素材混入
    if (fs.existsSync(job.paths.jobDir)) {
        fs.rmSync(job.paths.jobDir, { recursive: true, force: true });
        appendLog(job, 'download', '检测到同名项目的历史素材目录，已清空后重新下载');
    }
    upsertJob(job);
    appendLog(job, 'download', `任务已创建：${profileUrl}`);
    upsertJob(job);
    enqueue(job.id);
    return job;
};

// 批量创建: 每行一个主页链接, 同属一个批次, 项目名自动加序号去重
const handleCreateBatchJobs = (payload = {}) => {
    const lines = String(payload.profileUrlText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const entries = [];
    const errors = [];
    lines.forEach((line, idx) => {
        const profileUrl = extractProfileUrl(line);
        if (!profileUrl) {
            errors.push(`第 ${idx + 1} 行无法识别小红书链接`);
            return;
        }
        if (entries.some((entry) => entry.profileUrl === profileUrl)) {
            errors.push(`第 ${idx + 1} 行链接重复，已跳过`);
            return;
        }
        entries.push({ profileUrl });
    });
    if (!entries.length) {
        throw new Error(errors[0] || '没有可创建的有效链接');
    }

    const batchId = newBatchId();
    const baseName = sanitizeProjectName(payload.projectName || suggestProjectName());
    const jobs = [];
    entries.forEach((entry, i) => {
        const projectName = entries.length === 1
            ? sanitizeProjectName(payload.projectName || suggestProjectName())
            : uniqueProjectName(`${baseName}-${String(i + 1).padStart(2, '0')}`);
        if (entries.length === 1 && projectNameExists(projectName)) {
            throw new Error(`项目名 ${projectName} 已存在，请换一个`);
        }
        const job = createJobRecord({ profileUrl: entry.profileUrl, projectName, batchId });
        // 同名任务记录已删除但磁盘残留仍可能存在(raw/dataset), 新任务开始前整体清空
        if (fs.existsSync(job.paths.jobDir)) {
            fs.rmSync(job.paths.jobDir, { recursive: true, force: true });
            appendLog(job, 'download', '检测到同名项目的历史素材目录，已清空后重新下载');
        }
        upsertJob(job);
        appendLog(
            job,
            'download',
            `批次任务已创建（${i + 1}/${entries.length}）：${entry.profileUrl}`,
        );
        upsertJob(job);
        jobs.push(job);
        enqueue(job.id);
    });
    return { batchId, jobs, errors };
};

const handleStopJob = (jobId) => {
    const job = getJob(jobId);
    if (!job) throw new Error('任务不存在');
    if (job.status !== 'running' && job.status !== 'queued') {
        throw new Error('当前任务状态不支持停止');
    }
    job.stopRequested = true;
    appendLog(job, job.stage || 'pipeline', '已请求停止，将在当前步骤安全退出');
    upsertJob(job);
    emit({ type: 'update', jobId: job.id, job: getJob(job.id) });
    return { success: true };
};

const handleRetryJob = (jobId) => {
    const job = getJob(jobId);
    if (!job) throw new Error('任务不存在');
    if (job.status !== 'failed' && job.status !== 'stopped') {
        throw new Error('仅失败或已停止的任务可以重试');
    }
    job.stopRequested = false;
    job.error = '';
    job.status = 'queued';
    Object.keys(job.stageStatus).forEach((stage) => {
        const stageState = job.stageStatus[stage];
        if (stageState.status !== 'done') {
            stageState.status = 'pending';
            stageState.percent = 0;
            stageState.message = '';
        }
    });
    upsertJob(job);
    enqueue(job.id);
    return job;
};

const handleRemoveJob = (jobId) => {
    removeJob(jobId);
    queue = queue.filter((id) => id !== jobId);
    emit({ type: 'remove', jobId });
    return { success: true };
};

const handleConfirmJob = (jobId) => {
    const job = getJob(jobId);
    if (!job) throw new Error('任务不存在');
    if (job.status !== 'awaiting_confirm') {
        throw new Error('仅等待素材确认的任务可以继续');
    }
    const imageCount = countDatasetImages(job.paths.datasetDir);
    if (imageCount < job.params.minImages) {
        throw new Error(`当前素材仅 ${imageCount} 张，低于下限 ${job.params.minImages} 张，请重新裁切或补回删除的素材`);
    }
    job.stats.datasetCount = imageCount;
    job.status = 'queued';
    job.error = '';
    appendLog(job, 'crop', `人工确认素材 ${imageCount} 张，继续后续训练流程`);
    upsertJob(job);
    enqueue(job.id);
    return job;
};

const handleRecropJob = (jobId) => {
    const job = getJob(jobId);
    if (!job) throw new Error('任务不存在');
    if (job.status !== 'awaiting_confirm') {
        throw new Error('仅等待素材确认的任务可以重新裁切');
    }
    // 保留下载产物, 清空旧裁切结果并从 crop 阶段重来
    fs.rmSync(job.paths.datasetDir, { recursive: true, force: true });
    const cropIndex = STAGE_KEYS.indexOf('crop');
    STAGE_KEYS.forEach((stage, index) => {
        if (index >= cropIndex) {
            const stageState = job.stageStatus[stage];
            stageState.status = 'pending';
            stageState.percent = 0;
            stageState.message = '';
            stageState.startedAt = 0;
            stageState.finishedAt = 0;
        }
    });
    job.status = 'queued';
    job.error = '';
    job.stage = '';
    appendLog(job, 'crop', '用户要求重新裁切，任务从智能裁切阶段重来');
    upsertJob(job);
    enqueue(job.id);
    return job;
};

// 批量确认: 同批次所有 awaiting_confirm 任务统一校验素材下限后一次性放行
const handleConfirmBatch = (batchId) => {
    const jobs = listJobsByBatch(batchId).filter((job) => job.status === 'awaiting_confirm');
    if (!jobs.length) {
        throw new Error('该批次没有等待素材确认的任务');
    }
    const problems = [];
    jobs.forEach((job) => {
        const imageCount = countDatasetImages(job.paths.datasetDir);
        if (imageCount < job.params.minImages) {
            problems.push(`${job.projectName} 仅 ${imageCount} 张，低于下限 ${job.params.minImages} 张`);
        }
    });
    if (problems.length) {
        throw new Error(`批量确认被拦截：${problems.join('；')}`);
    }
    jobs.forEach((job) => {
        const imageCount = countDatasetImages(job.paths.datasetDir);
        job.stats.datasetCount = imageCount;
        job.status = 'queued';
        job.error = '';
        appendLog(job, 'crop', `批次统一确认素材 ${imageCount} 张，继续后续训练流程`);
        upsertJob(job);
    });
    jobs.forEach((job) => enqueue(job.id));
    return { batchId, count: jobs.length };
};

const handleOpenDir = (dir) => {
    if (!dir) return { success: false, error: '目录为空' };
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        return { success: false, error: `目录创建失败: ${err.message}` };
    }
    return shell.openPath(dir).then((err) => ({ success: !err, error: err || '' }));
};

initStore();

registHandle(HandleEvents.LORA_BATCH_GET_CONFIG, handleGetConfig);
registHandle(HandleEvents.LORA_BATCH_SET_CONFIG, handleSetConfig);
registHandle(HandleEvents.LORA_BATCH_LIST_JOBS, handleListJobs);
registHandle(HandleEvents.LORA_BATCH_CREATE_JOB, handleCreateJob);
registHandle(HandleEvents.LORA_BATCH_CREATE_BATCH, handleCreateBatchJobs);
registHandle(HandleEvents.LORA_BATCH_STOP_JOB, handleStopJob);
registHandle(HandleEvents.LORA_BATCH_RETRY_JOB, handleRetryJob);
registHandle(HandleEvents.LORA_BATCH_REMOVE_JOB, handleRemoveJob);
registHandle(HandleEvents.LORA_BATCH_CONFIRM_JOB, handleConfirmJob);
registHandle(HandleEvents.LORA_BATCH_CONFIRM_BATCH, handleConfirmBatch);
registHandle(HandleEvents.LORA_BATCH_RECROP_JOB, handleRecropJob);
registHandle(HandleEvents.LORA_BATCH_OPEN_DIR, handleOpenDir);
