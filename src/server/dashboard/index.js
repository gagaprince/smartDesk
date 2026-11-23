import axios from 'axios';
import { registHandle } from '../ipc';
import { HandleEvents } from '@/common/eventConst';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { app, shell } = require('electron');

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const fileExists = (target) => {
    try {
        fs.accessSync(target, fs.constants.F_OK);
        return true;
    } catch (err) {
        return false;
    }
};

// ---------------- 显卡状态（nvidia-smi, 外置显卡未挂载时命令直接失败） ----------------

const NVIDIA_SMI_CANDIDATES = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    'nvidia-smi',
];

let gpuProbeInFlight = false;
let lastGpu = null;

const runNvidiaSmi = () => new Promise((resolve) => {
    const tryCandidate = (index) => {
        execFile(
            NVIDIA_SMI_CANDIDATES[index],
            [
                '--query-gpu=name,memory.total,memory.used,memory.free',
                '--format=csv,noheader,nounits',
            ],
            { timeout: 8000, windowsHide: true },
            (err, stdout) => {
                if (err || !stdout || !stdout.trim()) {
                    const notFound = err && (err.code === 'ENOENT' || err.code === 127);
                    if (notFound && index < NVIDIA_SMI_CANDIDATES.length - 1) {
                        tryCandidate(index + 1);
                    } else {
                        resolve(null);
                    }
                    return;
                }
                resolve(stdout);
            },
        );
    };
    tryCandidate(0);
});

const queryGpu = async () => {
    // 轮询间隔较短时, 跳过并发中的探测, 直接复用上一次结果
    if (gpuProbeInFlight) {
        return lastGpu || {
            available: false,
            error: '正在检测显卡状态…',
            gpus: [],
            totals: null,
        };
    }
    gpuProbeInFlight = true;
    try {
        const stdout = await runNvidiaSmi();
        if (!stdout) {
            lastGpu = {
                available: false,
                error: '未检测到 NVIDIA 显卡，外置显卡可能未挂载或驱动未就绪',
                gpus: [],
                totals: null,
            };
            return lastGpu;
        }
        const gpus = stdout
            .trim()
            .split(/\r?\n/)
            .map((line) => {
                const cells = line.split(',').map((cell) => cell.trim());
                const [name, total, used, free] = cells;
                const totalMiB = Number(total);
                const usedMiB = Number(used);
                const freeMiB = Number(free);
                return {
                    name,
                    totalMiB,
                    usedMiB,
                    freeMiB,
                    usedPercent: totalMiB
                        ? Number(((usedMiB / totalMiB) * 100).toFixed(1))
                        : 0,
                };
            })
            .filter((gpu) => gpu.name && Number.isFinite(gpu.totalMiB));
        if (!gpus.length) {
            lastGpu = {
                available: false,
                error: 'nvidia-smi 未返回有效显卡数据',
                gpus: [],
                totals: null,
            };
            return lastGpu;
        }
        const totals = gpus.reduce((acc, gpu) => ({
            totalMiB: acc.totalMiB + gpu.totalMiB,
            usedMiB: acc.usedMiB + gpu.usedMiB,
            freeMiB: acc.freeMiB + gpu.freeMiB,
        }), { totalMiB: 0, usedMiB: 0, freeMiB: 0 });
        totals.usedPercent = totals.totalMiB
            ? Number(((totals.usedMiB / totals.totalMiB) * 100).toFixed(1))
            : 0;
        lastGpu = {
            available: true, error: null, gpus, totals,
        };
        return lastGpu;
    } finally {
        gpuProbeInFlight = false;
    }
};

// ---------------- 受管服务定义与启动命令发现 ----------------

const SERVICE_META = {
    ollama: {
        label: 'Ollama',
        port: 11434,
        healthPath: '/api/version',
        homeUrl: null,
    },
    comfyui: {
        label: 'ComfyUI',
        port: 8188,
        healthPath: '/system_stats',
        homeUrl: 'http://127.0.0.1:8188',
    },
    academia: {
        label: 'AcademiaSD',
        port: 4990,
        healthPath: '/',
        homeUrl: 'http://127.0.0.1:4990',
    },
};

const getSmartDeskDir = () => path.join(app.getPath('userData'), 'SmartDesk');
const getDashboardLogDir = () => path.join(getSmartDeskDir(), 'logs');
const getOverrideFile = () => path.join(getSmartDeskDir(), 'dashboard-services.json');

// 用户可在 userData/SmartDesk/dashboard-services.json 覆盖启动命令:
// { "services": { "comfyui": { "command": "...", "args": [...], "cwd": "..." } } }
const readOverrides = () => {
    try {
        const parsed = JSON.parse(fs.readFileSync(getOverrideFile(), 'utf-8'));
        return parsed && parsed.services ? parsed.services : {};
    } catch (err) {
        return {};
    }
};

const discoverOllama = () => {
    const localAppData = process.env.LOCALAPPDATA || '';
    const exe = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
    if (fileExists(exe)) {
        return { command: exe, args: ['serve'], cwd: path.dirname(exe) };
    }
    return { command: 'ollama', args: ['serve'], cwd: getSmartDeskDir() };
};

const COMFY_DESKTOP_CONFIG_DIR = path.join(process.env.APPDATA || '', 'Comfy Desktop');
const COMFY_SHARED_ROOT = process.env.COMFYUI_SHARED_HOME
    || 'D:\\Comfy-Desktop\\ComfyUI-Shared';

const readJsonSafe = (filePath) => {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
        return null;
    }
};

// 通过 Comfy Desktop 的 installations.json 把安装目录映射到实例 id
const resolveDesktopInstanceId = (installRoot) => {
    const installations = readJsonSafe(
        path.join(COMFY_DESKTOP_CONFIG_DIR, 'installations.json'),
    );
    if (!Array.isArray(installations)) return null;
    const target = path.resolve(installRoot).toLowerCase();
    const hit = installations.find((item) => item.installPath
        && path.resolve(item.installPath).toLowerCase() === target);
    return hit ? hit.id : null;
};

// Desktop 生成的共享模型 yaml 缺失时, 在 userData 内生成等价配置
const ensureGeneratedModelPaths = () => {
    const sharedModels = path.join(COMFY_SHARED_ROOT, 'models');
    if (!fileExists(sharedModels)) return null;
    const target = path.join(getSmartDeskDir(), 'comfyui-extra-model-paths.yaml');
    if (fileExists(target)) return target;
    const folders = [
        'checkpoints', 'classifiers', 'clip_vision', 'configs', 'controlnet',
        'diffusers', 'diffusion_models', 'embeddings', 'gligen', 'hypernetworks',
        'latent_upscale_models', 'loras', 'model_patches', 'audio_encoders',
        'photomaker', 'style_models', 'text_encoders', 'upscale_models',
        'background_removal', 'frame_interpolation', 'geometry_estimation',
        'optical_flow', 'detection', 'vae', 'vae_approx', 'LLM', 'RMBG',
        'grounding-dino', 'sams', 'ultralytics', 'vitmatte', 'yolo', 'clip', 'unet',
    ];
    const basePath = sharedModels.replace(/\\/g, '/');
    const lines = [
        '# Generated by SmartDesk: 共享模型目录映射, 等价 Comfy Desktop 的 instance-model-paths',
        'smartdesk.shared:',
        `  base_path: '${basePath}'`,
        '  is_default: true',
    ];
    folders.forEach((folder) => {
        lines.push(`  '${folder}': '${folder}/'`);
    });
    fs.mkdirSync(getSmartDeskDir(), { recursive: true });
    fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');
    return target;
};

// 解析共享模型目录配置: 优先复用 Desktop 按实例生成的 yaml, 其次目录内任意 yaml, 最后自生成
const resolveComfyModelPathConfig = (installRoot) => {
    const instanceId = resolveDesktopInstanceId(installRoot);
    if (instanceId) {
        const instanceYaml = path.join(
            COMFY_DESKTOP_CONFIG_DIR,
            'instance-model-paths',
            `${instanceId}.yaml`,
        );
        if (fileExists(instanceYaml)) return instanceYaml;
    }
    try {
        const dir = path.join(COMFY_DESKTOP_CONFIG_DIR, 'instance-model-paths');
        const yamlName = fs.readdirSync(dir).find((name) => name.endsWith('.yaml'));
        if (yamlName) return path.join(dir, yamlName);
    } catch (err) {
        // 目录不存在时继续走自生成逻辑
    }
    return ensureGeneratedModelPaths();
};

// 输入 / 输出目录与 Desktop 设置保持一致, 默认指向 ComfyUI-Shared
const resolveComfySharedIoDirs = () => {
    const settings = readJsonSafe(
        path.join(COMFY_DESKTOP_CONFIG_DIR, 'settings.json'),
    ) || {};
    const inputDir = settings.inputDir || path.join(COMFY_SHARED_ROOT, 'input');
    const outputDir = settings.outputDir || path.join(COMFY_SHARED_ROOT, 'output');
    return {
        inputDir: fileExists(inputDir) ? inputDir : null,
        outputDir: fileExists(outputDir) ? outputDir : null,
    };
};

const discoverComfyui = () => {
    const installsRoot = process.env.COMFYUI_HOME
        || 'D:\\Comfy-Desktop\\ComfyUI-Installs';
    let names = [];
    try {
        names = fs.readdirSync(installsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch (err) {
        return null;
    }
    for (const name of names) {
        const installRoot = path.join(installsRoot, name);
        const installDir = path.join(installRoot, 'ComfyUI');
        const mainScript = path.join(installDir, 'main.py');
        // ComfyUI Desktop 新版在 ComfyUI/.venv 内建虚拟环境,
        // 旧版直接使用安装根目录下的 standalone-env
        const pythonCandidates = [
            path.join(installDir, '.venv', 'Scripts', 'python.exe'),
            path.join(installRoot, 'standalone-env', 'python.exe'),
        ];
        const python = pythonCandidates.find((candidate) => fileExists(candidate));
        if (python && fileExists(mainScript)) {
            const args = [
                '-s',
                'ComfyUI/main.py',
                '--listen',
                '127.0.0.1',
                '--port',
                '8188',
                // 与 Desktop 的 launchArgs 对齐, 桌面版 Manager 需要该开关启用
                '--enable-manager',
            ];
            // 关键: 不传该配置时 ComfyUI 只扫描安装目录内的 models,
            // 不会使用 ComfyUI-Shared 下的共享模型 / 输入 / 输出目录
            const modelPathConfig = resolveComfyModelPathConfig(installRoot);
            if (modelPathConfig) {
                args.push('--extra-model-paths-config', modelPathConfig);
            }
            const { inputDir, outputDir } = resolveComfySharedIoDirs();
            if (inputDir) args.push('--input-directory', inputDir);
            if (outputDir) args.push('--output-directory', outputDir);
            return {
                command: python,
                args,
                cwd: installRoot,
            };
        }
    }
    return null;
};

const discoverAcademia = () => {
    const home = process.env.ACADEMIA_HOME
        || 'E:\\aiwork\\AcademiaSD_LoRAlab-TrainerStudio';
    const python = path.join(home, 'venv', 'Scripts', 'python.exe');
    const launcher = path.join(home, 'scripts', 'launcher.py');
    if (fileExists(python) && fileExists(launcher)) {
        return { command: python, args: ['scripts/launcher.py'], cwd: home };
    }
    return null;
};

const DISCOVERERS = {
    ollama: discoverOllama,
    comfyui: discoverComfyui,
    academia: discoverAcademia,
};

const resolveServiceConfig = (id) => {
    const discovered = DISCOVERERS[id]();
    const override = readOverrides()[id];
    if (!discovered && !override) return null;
    return { ...(discovered || {}), ...(override || {}) };
};

// loraBatch 复用: 解析 AcademiaSD 安装目录(训练器的 Cache_Data/Outputs 相对路径都基于它)
export const getAcademiaHome = () => {
    const cfg = resolveServiceConfig('academia');
    return (cfg && cfg.cwd) || process.env.ACADEMIA_HOME
        || 'E:\\aiwork\\AcademiaSD_LoRAlab-TrainerStudio';
};

// ---------------- 健康探测与进程管理 ----------------

const probeService = async (meta) => {
    try {
        await axios.get(`http://127.0.0.1:${meta.port}${meta.healthPath}`, {
            timeout: 2500,
            proxy: false,
            // 只要拿到任意 HTTP 响应（含 4xx）都说明端口上有服务
            validateStatus: (status) => status < 500,
        });
        return true;
    } catch (err) {
        return Boolean(err && err.response);
    }
};

const findPidsByPort = (port) => new Promise((resolve) => {
    const command = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'netstat.exe')
        : 'netstat';
    execFile(command, ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
        const pids = new Set();
        if (!err && stdout) {
            stdout.split(/\r?\n/).forEach((line) => {
                const match = line
                    .trim()
                    .match(/^TCP\s+[\d.]+:(\d+)\s+[\d.]+:\d+\s+LISTENING\s+(\d+)/i);
                if (match && Number(match[1]) === port && match[2] !== '0') {
                    pids.add(Number(match[2]));
                }
            });
        }
        resolve([...pids]);
    });
});

const runTaskKill = (args) => new Promise((resolve) => {
    const command = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'taskkill.exe')
        : 'taskkill';
    execFile(command, args, { windowsHide: true }, () => {
        resolve();
    });
});

const taskKillTree = (pid) => runTaskKill(['/F', '/T', '/PID', String(pid)]);
const taskKillImage = (imageName) => runTaskKill(['/F', '/T', '/IM', imageName]);

// 由本模块拉起的子进程, id -> ChildProcess
const spawned = new Map();
// 启停串行化, 避免同一服务并发操作
const pending = new Map();
// 快速就绪窗口: 窗口内健康探测通过即返回成功; 超时但进程仍存活则转为"启动中"
// ComfyUI 冷启动受自定义节点初始化影响可能需要数分钟, 不宜按固定超时判定失败
const READY_FAST_WAIT_MS = 30000;

export const startService = async (id) => {
    const meta = SERVICE_META[id];
    if (!meta) return { success: false, message: '未知服务' };
    if (pending.has(id)) return pending.get(id);
    const job = (async () => {
        if (await probeService(meta)) {
            return { success: true, alreadyRunning: true, message: `${meta.label} 已在运行` };
        }
        const logPath = path.join(getDashboardLogDir(), `dashboard-${id}.log`);
        // 已有本模块拉起且仍在运行的进程（如 ComfyUI 慢启动中）, 不重复拉起
        const existing = spawned.get(id);
        if (existing && existing.exitCode === null) {
            return {
                success: true,
                starting: true,
                pid: existing.pid,
                logPath,
                message: `${meta.label} 正在后台启动中，请留意工作台状态变化`,
            };
        }
        const config = resolveServiceConfig(id);
        if (!config) {
            return {
                success: false,
                message: `${meta.label} 启动程序未找到，可在 dashboard-services.json 中配置启动命令`,
            };
        }
        if (path.isAbsolute(config.command) && !fileExists(config.command)) {
            return { success: false, message: `找不到可执行文件：${config.command}` };
        }
        fs.mkdirSync(getDashboardLogDir(), { recursive: true });
        const outFd = fs.openSync(logPath, 'a');
        let child;
        try {
            child = spawn(config.command, config.args || [], {
                cwd: config.cwd,
                windowsHide: true,
                detached: true,
                stdio: ['ignore', outFd, outFd],
                env: {
                    ...process.env,
                    PYTHONUTF8: '1',
                    PYTHONIOENCODING: 'utf-8',
                },
            });
        } catch (err) {
            return { success: false, message: `启动失败：${err.message}` };
        }
        child.unref();
        spawned.set(id, child);
        child.on('exit', (code) => {
            if (spawned.get(id) === child) spawned.delete(id);
            console.log(`[dashboard] ${id} 子进程退出 code=${code}`);
        });
        const deadline = Date.now() + READY_FAST_WAIT_MS;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) {
                return {
                    success: false,
                    message: `${meta.label} 进程意外退出（code=${child.exitCode}），详见日志 ${logPath}`,
                };
            }
            if (await probeService(meta)) {
                return {
                    success: true,
                    pid: child.pid,
                    logPath,
                    message: `${meta.label} 启动成功`,
                };
            }
            await sleep(1000);
        }
        if (child.exitCode !== null) {
            return {
                success: false,
                message: `${meta.label} 进程意外退出（code=${child.exitCode}），详见日志 ${logPath}`,
            };
        }
        return {
            success: true,
            starting: true,
            pid: child.pid,
            logPath,
            message: `${meta.label} 仍在后台启动中，就绪后工作台状态会自动更新，详见日志 ${logPath}`,
        };
    })();
    pending.set(id, job);
    try {
        return await job;
    } finally {
        pending.delete(id);
    }
};

export const stopService = async (id) => {
    const meta = SERVICE_META[id];
    if (!meta) return { success: false, message: '未知服务' };
    if (pending.has(id)) {
        return { success: false, message: '该服务正在启停中，请稍候' };
    }
    const job = (async () => {
        const online = await probeService(meta);
        const managedChild = spawned.get(id);
        if (!online && !managedChild) {
            return { success: true, alreadyStopped: true, message: `${meta.label} 未在运行` };
        }
        if (id === 'ollama') {
            // 与参考实现一致, 按映像名整树结束（含托盘程序, 避免其自动重启 serve）
            await taskKillImage('ollama.exe');
            await taskKillImage('ollama app.exe');
        } else {
            // 服务可能仍在启动中（端口尚未监听）, 也要结束本模块拉起的进程
            if (managedChild && managedChild.pid) await taskKillTree(managedChild.pid);
            const pids = await findPidsByPort(meta.port);
            for (const pid of pids) {
                await taskKillTree(pid);
            }
        }
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const currentChild = spawned.get(id);
            if (!(await probeService(meta)) && (!currentChild || currentChild.exitCode !== null)) {
                return { success: true, message: `${meta.label} 已停止` };
            }
            await sleep(800);
        }
        return { success: false, message: `${meta.label} 停止超时，请在任务管理器中确认进程状态` };
    })();
    pending.set(id, job);
    try {
        return await job;
    } finally {
        pending.delete(id);
    }
};

export const getOverview = async () => {
    const services = await Promise.all(
        Object.keys(SERVICE_META).map(async (id) => {
            const meta = SERVICE_META[id];
            const [running, config] = await Promise.all([
                probeService(meta),
                Promise.resolve(resolveServiceConfig(id)),
            ]);
            return {
                id,
                label: meta.label,
                port: meta.port,
                running,
                starting: !running && spawned.has(id),
                homeUrl: meta.homeUrl,
                browser: Boolean(meta.homeUrl),
                configured: Boolean(config),
                managed: spawned.has(id),
            };
        }),
    );
    return {
        gpu: await queryGpu(),
        services,
        configFile: getOverrideFile(),
        updatedAt: new Date().toISOString(),
    };
};

// ---------------- 显存清理（对齐 comfyui_ctrl 的 vram_service） ----------------

// 两个服务的 API 返回后, 驱动层面的显存回收是异步的, 等待后再统计释放量
const VRAM_SETTLE_MS = 6000;
let vramPending = null;

const releaseOllamaVram = async () => {
    const meta = SERVICE_META.ollama;
    if (!(await probeService(meta))) {
        return {
            service: 'ollama',
            success: false,
            skipped: true,
            message: 'Ollama 服务不可达，已跳过',
        };
    }
    try {
        const psResponse = await axios.get('http://127.0.0.1:11434/api/ps', {
            timeout: 3000,
            proxy: false,
        });
        const models = (psResponse.data && psResponse.data.models) || [];
        if (!models.length) {
            return {
                service: 'ollama',
                success: true,
                skipped: false,
                message: 'Ollama 无驻留模型，无需卸载',
            };
        }
        const unloaded = [];
        for (const model of models) {
            const name = model.name || model.model;
            if (name) {
                // keep_alive=0 通知 Ollama 立即卸载该模型, serve 进程本身保持运行
                await axios.post(
                    'http://127.0.0.1:11434/api/generate',
                    { model: name, keep_alive: 0 },
                    { timeout: 15000, proxy: false },
                );
                unloaded.push(name);
            }
        }
        return {
            service: 'ollama',
            success: true,
            message: `Ollama 已卸载 ${unloaded.length} 个驻留模型`,
            detail: { unloadedModels: unloaded },
        };
    } catch (err) {
        return {
            service: 'ollama',
            success: false,
            message: `Ollama 模型卸载失败：${err.message}`,
        };
    }
};

const releaseComfyuiVram = async () => {
    const meta = SERVICE_META.comfyui;
    if (!(await probeService(meta))) {
        return {
            service: 'comfyui',
            success: false,
            skipped: true,
            message: 'ComfyUI 服务不可达，已跳过',
        };
    }
    try {
        await axios.post(
            'http://127.0.0.1:8188/free',
            { unload_models: true, free_memory: true },
            { timeout: 15000, proxy: false },
        );
        return {
            service: 'comfyui',
            success: true,
            message: 'ComfyUI 已触发模型卸载与显存回收',
        };
    } catch (err) {
        return {
            service: 'comfyui',
            success: false,
            message: `ComfyUI 显存释放失败：${err.message}`,
        };
    }
};

export const releaseVram = () => {
    if (vramPending) return vramPending;
    const job = (async () => {
        const beforeGpu = await queryGpu();
        if (!beforeGpu.available) {
            return {
                success: false,
                message: '显卡未挂载，无法清理显存',
                steps: [],
                beforeUsedMiB: null,
                afterUsedMiB: null,
                freedMiB: null,
            };
        }
        const beforeUsedMiB = beforeGpu.totals.usedMiB;
        // 与参考实现一致: 先 Ollama 后 ComfyUI, 串行释放
        const steps = [
            await releaseOllamaVram(),
            await releaseComfyuiVram(),
        ];
        await sleep(VRAM_SETTLE_MS);
        const afterGpu = await queryGpu();
        const afterUsedMiB = afterGpu.available ? afterGpu.totals.usedMiB : null;
        const freedMiB = afterUsedMiB === null ? null : beforeUsedMiB - afterUsedMiB;
        const allSkipped = steps.every((step) => step.skipped);
        const message = allSkipped
            ? 'Ollama 与 ComfyUI 均未运行，未执行显存回收'
            : `显存清理完成，当前占用 ${afterUsedMiB} MiB，较清理前${freedMiB >= 0 ? '释放' : '增加'} ${Math.abs(freedMiB)} MiB`;
        return {
            success: true,
            message,
            steps,
            beforeUsedMiB,
            afterUsedMiB,
            freedMiB,
        };
    })();
    vramPending = job;
    job.finally(() => {
        vramPending = null;
    });
    return job;
};

export const openServiceHome = (id) => {
    const meta = SERVICE_META[id];
    if (meta && meta.homeUrl) {
        shell.openExternal(meta.homeUrl);
        return { success: true };
    }
    return { success: false, message: '该服务没有浏览器入口' };
};

// Ollama 文档页: 主进程代理 /api/tags, 避免渲染层直连的跨域与系统代理问题
export const getOllamaModels = async () => {
    const meta = SERVICE_META.ollama;
    if (!(await probeService(meta))) {
        return { online: false, models: [] };
    }
    try {
        const response = await axios.get('http://127.0.0.1:11434/api/tags', {
            timeout: 3000,
            proxy: false,
        });
        const models = (response.data && response.data.models) || [];
        return {
            online: true,
            models: models.map((item) => ({
                name: item.name,
                sizeMiB: item.size ? Math.round(item.size / 1024 / 1024) : null,
                modifiedAt: item.modified_at || null,
                details: item.details || null,
            })),
        };
    } catch (err) {
        return { online: true, models: [], error: err.message };
    }
};

registHandle(HandleEvents.GET_DASHBOARD_OVERVIEW, getOverview);
registHandle(HandleEvents.START_SERVICE, startService);
registHandle(HandleEvents.STOP_SERVICE, stopService);
registHandle(HandleEvents.RELEASE_VRAM, releaseVram);
registHandle(HandleEvents.OPEN_SERVICE_HOME, openServiceHome);
registHandle(HandleEvents.GET_OLLAMA_MODELS, getOllamaModels);
