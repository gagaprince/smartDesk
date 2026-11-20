import axios from 'axios';
import { registHandle } from '../ipc';
import { HandleEvents } from '@/common/eventConst';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

// uvicorn 绑定 0.0.0.0 以承载 AIComicBuilder 兼容协议的局域网访问
const BIND_HOST = '0.0.0.0';
const PORT = 8888;
// 渲染层与健康探测始终走回环地址
export const COMFYUI_CTRL_BASE = `http://127.0.0.1:${PORT}`;
const HEALTH_URL = `${COMFYUI_CTRL_BASE}/health`;

let serviceChild = null;
let startingPromise = null;

const isComfyuiHome = (dir) => {
    if (!dir) return false;
    return fs.existsSync(path.join(dir, 'app', 'main.py'))
        && fs.existsSync(path.join(dir, 'run.py'));
};

// 解析 comfyui-ctrl 子项目目录: 自定义 > 环境变量 > 开发目录 > 打包 resources
export const resolveComfyuiHome = (customHome) => {
    const candidates = [
        customHome,
        process.env.COMFYUI_CTRL_HOME,
        path.resolve(process.cwd(), 'subprojects', 'comfyui-ctrl'),
        path.resolve(app.getAppPath(), 'subprojects', 'comfyui-ctrl'),
        path.resolve(process.resourcesPath || '', 'comfyui-ctrl'),
    ].filter(Boolean);
    const matched = candidates.find(isComfyuiHome);
    if (matched) return matched;
    throw new Error(
        `未找到 comfyui-ctrl 子项目目录, 已尝试: ${candidates.join('; ')}`,
    );
};

const resolvePython = (home) => {
    const venvPython = process.platform === 'win32'
        ? path.join(home, '.venv', 'Scripts', 'python.exe')
        : path.join(home, '.venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) return venvPython;
    return process.platform === 'win32' ? 'python' : 'python3';
};

const checkHealth = async () => {
    try {
        // 本机回环探测显式绕过系统代理（如 Clash），避免代理拦截本地请求
        const resp = await axios.get(HEALTH_URL, { timeout: 2000, proxy: false });
        return resp.status === 200;
    } catch (err) {
        return false;
    }
};

const waitUntilReady = (deadlineMs = 30000) => new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
        if (await checkHealth()) {
            clearInterval(timer);
            resolve(true);
        } else if (Date.now() - startedAt > deadlineMs) {
            clearInterval(timer);
            resolve(false);
        }
    }, 800);
});

// 应用启动时调用: 已在运行则复用, 否则拉起 uvicorn 子进程
export const startComfyuiService = async () => {
    if (startingPromise) return startingPromise;
    startingPromise = (async () => {
        if (await checkHealth()) {
            return { started: false, ready: true, base: COMFYUI_CTRL_BASE };
        }
        let home;
        let python;
        try {
            home = resolveComfyuiHome();
            python = resolvePython(home);
        } catch (err) {
            console.error('[comfyui-ctrl]', err.message);
            return { started: false, ready: false, error: err.message };
        }
        const child = spawn(
            python,
            ['-m', 'uvicorn', 'app.main:app', '--host', BIND_HOST, '--port', String(PORT)],
            {
                cwd: home,
                windowsHide: true,
                env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
            },
        );
        serviceChild = child;
        child.stdout.on('data', (chunk) => {
            process.stdout.write(`[comfyui-ctrl] ${chunk}`);
        });
        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[comfyui-ctrl] ${chunk}`);
        });
        child.on('exit', (code) => {
            console.log(`[comfyui-ctrl] 子进程退出 code=${code}`);
            if (serviceChild === child) {
                serviceChild = null;
            }
        });
        const ready = await waitUntilReady();
        return {
            started: true,
            ready,
            base: COMFYUI_CTRL_BASE,
            error: ready ? '' : 'comfyui-ctrl 服务启动超时, 请检查子项目虚拟环境',
        };
    })();
    try {
        return await startingPromise;
    } finally {
        startingPromise = null;
    }
};

export const stopComfyuiService = () => {
    if (serviceChild) {
        serviceChild.kill();
        serviceChild = null;
    }
};

const getServiceStatus = async () => ({
    base: COMFYUI_CTRL_BASE,
    ready: await checkHealth(),
});

registHandle(HandleEvents.GET_COMFYUI_BASE, () => COMFYUI_CTRL_BASE);
registHandle(HandleEvents.GET_COMFYUI_HEALTH, getServiceStatus);
