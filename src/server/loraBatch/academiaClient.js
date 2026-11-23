/**
 * AcademiaSD LoRAlab 训练器 HTTP 客户端 (Qwen-Image 2.1)
 * launcher: 4990 负责拉起训练器; 训练器本体: 5000, 提供配置保存/脚本执行/状态/导出接口
 * 全部走回环地址并显式绕过系统代理
 */
import axios from 'axios';

const LAUNCHER_BASE = 'http://127.0.0.1:4990';
const TRAINER_BASE = 'http://127.0.0.1:5000';
const TRAINER_ID = 'qwenimage21';

const http = axios.create({ proxy: false, timeout: 10000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getTrainerStatus() {
    try {
        const resp = await http.get(`${TRAINER_BASE}/api/status`);
        return resp.data;
    } catch (err) {
        return null;
    }
}

// 训练器未启动时通过 launcher 拉起, 轮询直到 5000 端口就绪
export async function ensureTrainer() {
    let status = await getTrainerStatus();
    if (status) {
        if (status.running) {
            throw new Error('训练器正在执行其他任务，请等待其完成后再试');
        }
        return status;
    }
    try {
        const resp = await http.post(`${LAUNCHER_BASE}/api/launch`, { id: TRAINER_ID });
        const data = resp.data || {};
        if (data.status === 'error') {
            throw new Error(data.error || '训练器启动失败');
        }
    } catch (err) {
        if (err.response) {
            const respError = err.response.data ? err.response.data.error : '';
            throw new Error(`训练器启动失败: ${respError || err.message}`);
        }
        throw new Error(`AcademiaSD 启动器(4990)不可用，请先在工作台启动 AcademiaSD：${err.message}`);
    }
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        await sleep(1500);
        status = await getTrainerStatus();
        if (status) {
            if (status.running) {
                throw new Error('训练器正在执行其他任务，请等待其完成后再试');
            }
            return status;
        }
    }
    throw new Error('训练器启动超时（90 秒），请打开 AcademiaSD 控制台查看原因');
}

async function postJson(url, body) {
    const resp = await http.post(url, body);
    const data = resp.data || {};
    if (data.status && data.status !== 'ok') {
        throw new Error(data.error || '训练器接口返回错误');
    }
    return data;
}

export const savePrecacheConfig = (cfg) => postJson(`${TRAINER_BASE}/api/save-precache`, cfg);
export const saveTrainConfig = (cfg) => postJson(`${TRAINER_BASE}/api/save-train`, cfg);

export const exportLora = (targetDir, finalName) => postJson(
    `${TRAINER_BASE}/api/export-lora`,
    { target_dir: targetDir, final_name: finalName },
);

export async function stopTrainerScript() {
    try {
        await http.post(`${TRAINER_BASE}/api/stop`, {});
    } catch (err) {
        // 停止尽力而为, 调用方负责后续状态判断
    }
}

/**
 * 触发训练器脚本并轮询到结束
 * script: caption | precache | train
 */
export async function runAndWait(script, options = {}) {
    const { onProgress = () => {}, shouldStop = () => false, pollMs = 2000 } = options;
    let resp;
    try {
        resp = await http.post(`${TRAINER_BASE}/api/run`, { script });
    } catch (err) {
        const data = err.response && err.response.data;
        throw new Error((data && data.error) || `启动 ${script} 失败: ${err.message}`);
    }
    if (resp.data && resp.data.status === 'error') {
        throw new Error(resp.data.error || `启动 ${script} 失败`);
    }

    let runningSeen = false;
    let lastStep = -1;
    for (;;) {
        if (shouldStop()) {
            await stopTrainerScript();
            const err = new Error('用户停止任务');
            err.stopped = true;
            throw err;
        }
        await sleep(pollMs);
        const status = await getTrainerStatus();
        if (!status) {
            throw new Error('训练器连接中断');
        }
        if (status.running) {
            runningSeen = true;
            const progress = status.progress || {};
            if (typeof progress.step === 'number' && progress.step !== lastStep) {
                lastStep = progress.step;
                onProgress(progress);
            }
        } else {
            const last = status.last || {};
            if (runningSeen || last.script === script) {
                if (last.code === 0) return last;
                const errors = (last.errors || []).join('；') || `进程退出码 ${last.code}`;
                throw new Error(`${script} 失败: ${errors}`);
            }
        }
    }
}
