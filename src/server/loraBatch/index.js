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

async function pump() {
    if (pumping) return;
    pumping = true;
    try {
        while (queue.length) {
            const jobId = queue.shift();
            const job = getJob(jobId);
            if (job && !job.stopRequested && job.status !== 'stopped') {
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
registHandle(HandleEvents.LORA_BATCH_STOP_JOB, handleStopJob);
registHandle(HandleEvents.LORA_BATCH_RETRY_JOB, handleRetryJob);
registHandle(HandleEvents.LORA_BATCH_REMOVE_JOB, handleRemoveJob);
registHandle(HandleEvents.LORA_BATCH_CONFIRM_JOB, handleConfirmJob);
registHandle(HandleEvents.LORA_BATCH_RECROP_JOB, handleRecropJob);
registHandle(HandleEvents.LORA_BATCH_OPEN_DIR, handleOpenDir);
