/**
 * LoRA 批量训练: 任务与配置的持久化存储
 * 数据位于 userData/SmartDesk/lora_batch/:
 *   config.json 应用配置(工作区目录、LoRA 导出目录)
 *   jobs.json   全部任务记录
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

export const TRIGGER_WORD = 'gaga';

export const DEFAULT_PARAMS = {
    noteLimit: 15,
    frames: 3,
    minImages: 20,
    maxImages: 40,
    totalSteps: 1200,
};

export const DEFAULT_LORA_EXPORT_DIR = 'D:\\Comfy-Desktop\\ComfyUI-Shared\\models\\loras\\qwen\\selftrain';

export const STAGE_KEYS = [
    'download', 'crop', 'caption', 'precache', 'train', 'export', 'preview',
];

const getRootDir = () => path.resolve(app.getPath('userData'), 'SmartDesk', 'lora_batch');
const getConfigFile = () => path.join(getRootDir(), 'config.json');
const getJobsFile = () => path.join(getRootDir(), 'jobs.json');

const defaultWorkspace = () => path.resolve(app.getPath('documents'), 'SmartDesk', 'loraBatch');

let config = {
    workspaceDir: '',
    loraExportDir: DEFAULT_LORA_EXPORT_DIR,
};
const store = { jobs: [] };

const ensureRoot = () => {
    fs.mkdirSync(getRootDir(), { recursive: true });
};

const writeJson = (file, data) => {
    ensureRoot();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
};

const saveConfig = () => writeJson(getConfigFile(), config);
const saveJobs = () => writeJson(getJobsFile(), store);

export function initStore() {
    ensureRoot();
    try {
        const raw = JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'));
        config = { ...config, ...raw };
    } catch (err) {
        // 首次运行无配置文件
    }
    if (!config.workspaceDir) {
        config.workspaceDir = defaultWorkspace();
    }
    if (!config.loraExportDir) {
        config.loraExportDir = DEFAULT_LORA_EXPORT_DIR;
    }
    saveConfig();

    try {
        const raw = JSON.parse(fs.readFileSync(getJobsFile(), 'utf8'));
        if (raw && Array.isArray(raw.jobs)) {
            store.jobs = raw.jobs;
        }
    } catch (err) {
        // 首次运行无任务文件
    }
    // 应用重启后, 运行中的任务无法自动续跑, 标记为失败以便用户手动从断点重试
    store.jobs.forEach((job) => {
        if (job.status === 'running' || job.status === 'queued') {
            job.status = 'failed';
            job.stopRequested = false;
            job.error = '应用重启导致中断，可点击重试从断点继续';
            const stageState = job.stage && job.stageStatus[job.stage];
            if (stageState && stageState.status === 'running') {
                stageState.status = 'failed';
                stageState.message = job.error;
            }
        }
    });
    saveJobs();
}

export const getConfig = () => ({ ...config });

export function updateConfig(patch = {}) {
    if (patch.workspaceDir && typeof patch.workspaceDir === 'string') {
        config.workspaceDir = patch.workspaceDir;
    }
    if (patch.loraExportDir && typeof patch.loraExportDir === 'string') {
        config.loraExportDir = patch.loraExportDir;
    }
    saveConfig();
    return getConfig();
}

export const listJobs = () => [...store.jobs].sort((a, b) => b.createdAt - a.createdAt);
export const getJob = (id) => store.jobs.find((job) => job.id === id) || null;

export function upsertJob(job) {
    job.updatedAt = Date.now();
    const index = store.jobs.findIndex((item) => item.id === job.id);
    if (index === -1) {
        store.jobs.push(job);
    } else {
        store.jobs.splice(index, 1, job);
    }
    saveJobs();
    return job;
}

export function removeJob(id) {
    const index = store.jobs.findIndex((item) => item.id === id);
    if (index === -1) return false;
    const job = store.jobs[index];
    if (job.status === 'running' || job.status === 'queued') {
        throw new Error('任务运行中，无法删除，请先停止');
    }
    store.jobs.splice(index, 1);
    saveJobs();
    return true;
}

export function createJobRecord({ profileUrl, projectName, batchId }) {
    const now = Date.now();
    const id = `lb_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const jobDir = path.resolve(config.workspaceDir, projectName);
    const stageStatus = {};
    STAGE_KEYS.forEach((key) => {
        stageStatus[key] = { status: 'pending', percent: 0, message: '' };
    });
    return {
        id,
        batchId: batchId || id,
        profileUrl,
        nickname: '',
        userId: '',
        projectName,
        triggerWord: TRIGGER_WORD,
        status: 'queued',
        stopRequested: false,
        stage: '',
        stageStatus,
        params: { ...DEFAULT_PARAMS },
        paths: {
            jobDir,
            rawDir: path.join(jobDir, 'raw'),
            datasetDir: path.join(jobDir, 'dataset'),
            exportFile: '',
            loraName: '',
            previewThumb: false,
        },
        stats: {
            noteCount: 0,
            downloaded: 0,
            failedDownloads: 0,
            rawVideos: 0,
            rawImages: 0,
            datasetCount: 0,
            trimmed: 0,
            trainStep: 0,
            trainTotal: DEFAULT_PARAMS.totalSteps,
        },
        logs: [],
        error: '',
        createdAt: now,
        updatedAt: now,
    };
}

export function appendLog(job, stage, message) {
    if (!message) return;
    job.logs.push({ time: Date.now(), stage, message: String(message) });
    if (job.logs.length > 300) {
        job.logs.splice(0, job.logs.length - 300);
    }
}

export const projectNameExists = (projectName) => store.jobs
    .some((job) => job.projectName === projectName);

// 项目名只允许英文数字下划线和短横线, 避免 Python/路径编码问题
export const sanitizeProjectName = (name) => String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const suggestProjectName = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `face_${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

// 批量创建时同分钟内会撞名, 基于 base 追加序号直到不冲突
export function uniqueProjectName(base) {
    let name = base;
    let seq = 1;
    while (projectNameExists(name)) {
        name = `${base}-${String(seq).padStart(2, '0')}`;
        seq += 1;
    }
    return name;
}

export const newBatchId = () => `lbb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const listJobsByBatch = (batchId) => store.jobs.filter((job) => job.batchId === batchId);

// 批次内是否还有任务停在人工确认卡口(训练阶段的放行屏障)
export const batchHasAwaiting = (batchId) => store.jobs
    .some((job) => job.batchId === batchId && job.status === 'awaiting_confirm');

// 从整段分享文案中提取主页链接, 兼容 https\:// 转义与尾部标点
export function extractProfileUrl(text) {
    const cleaned = String(text || '').replace(/\\:/g, ':');
    const match = cleaned.match(/(https?:\/\/[^\s]+|xhslink\.cn\/[^\s]+)/i);
    if (!match) return '';
    return match[1].replace(/[),，。；;！!？?\]]+$/, '');
}
