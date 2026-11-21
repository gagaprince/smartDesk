/**
 * 一键智能裁切: 调用 Python headcut.smartcut_cli
 * 在原头像裁切之外新增视频均分抽帧与头/胸/腿/手/脚多部位裁切,
 * 与 headcut 模块相互独立, 共用同一个 Python 虚拟环境与输出目录工具。
 */
import { registHandle, getMainWindow } from '../ipc';
import { HandleEvents, RenderReceiveEvents } from '@/common/eventConst';
import {
    resolveHeadcutHome,
    resolvePython,
    listOutputImages,
    readOutputImage,
    deleteOutputFile,
} from '../headcut/index';

const fs = require('fs');
const { spawn } = require('child_process');

let runningChild = null;

const sendProgress = (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
        win.webContents.send(RenderReceiveEvents.SMART_CUT_PROGRESS, payload);
    }
};

const parseLine = (line, stats) => {
    const totalMatch = line.match(/共发现\s*(\d+)\s*个处理单元/);
    if (totalMatch) {
        stats.total = Number(totalMatch[1]);
    }
    if (line.includes('[裁切]')) {
        stats.cropped += 1;
    }
    if (line.includes('[未检测到人体]') || line.includes('[未检测到人脸]')) {
        stats.noTarget += 1;
    }
    if (line.includes('[处理失败]') || line.includes('[视频探测失败]')) {
        stats.failed += 1;
    }
    // 一个单元可能产出多张部位裁切, 按输出基名去重统计已完成的单元数,
    // 避免进度条按裁切条数计算而瞬间冲到 99%
    const cropMatch = line.match(/\[裁切\]\s+(.+?)\s+->/);
    const noTargetMatch = line.match(/\[未检测到(?:人体|人脸)\]\s+(.+)/);
    const failedMatch = line.match(/\[处理失败\]\s+([^:]+)/);
    const unitName = (cropMatch && cropMatch[1])
        || (noTargetMatch && noTargetMatch[1])
        || (failedMatch && failedMatch[1]);
    if (unitName) {
        stats.finishedUnits.add(unitName.trim());
    }
    const summaryMatch = line.match(
        /共\s*(\d+)\s*个单元,\s*裁切输出\s*(\d+)\s*张,\s*无目标\s*(\d+)\s*个,\s*失败\s*(\d+)\s*个/,
    );
    if (summaryMatch) {
        stats.total = Number(summaryMatch[1]);
        stats.cropped = Number(summaryMatch[2]);
        stats.noTarget = Number(summaryMatch[3]);
        stats.failed = Number(summaryMatch[4]);
        stats.summary = line.trim();
    }
};

const buildArgs = (options) => {
    const parts = Array.isArray(options.parts) && options.parts.length
        ? options.parts.join(',')
        : 'head';
    const args = [
        '-m', 'headcut.smartcut_cli',
        options.inputDir,
        '-o', options.outputDir,
        '-s', String(options.size || 1024),
        '--frames', String(options.frames || 5),
        '--parts', parts,
        '--prompt', String(options.prompt || ''),
        '--scale', String(options.scale || 2.6),
    ];
    if (options.recursive !== false) {
        args.push('-r');
    }
    if (options.confidence) {
        args.push('--confidence', String(options.confidence));
    }
    if (options.poseConfidence) {
        args.push('--pose-confidence', String(options.poseConfidence));
    }
    if (options.kptConf) {
        args.push('--kpt-conf', String(options.kptConf));
    }
    if (options.saveDebug) {
        args.push('--save-debug');
    }
    if (options.aiSeg === false) {
        args.push('--no-seg');
    }
    if (options.removeBg) {
        args.push('--remove-bg');
        if (options.bgModel) {
            args.push('--bg-model', String(options.bgModel));
        }
        if (options.bgColor) {
            args.push('--bg-color', String(options.bgColor));
        }
    }
    return args;
};

export const runSmartCut = (options = {}) => new Promise((resolve) => {
    if (runningChild) {
        resolve({ success: false, message: '已有智能裁切任务正在运行, 请先停止或等待完成' });
        return;
    }
    if (!options.inputDir || !fs.existsSync(options.inputDir)) {
        resolve({ success: false, message: '素材目录不存在' });
        return;
    }
    if (!options.outputDir) {
        resolve({ success: false, message: '请选择裁切结果输出目录' });
        return;
    }

    let home;
    let python;
    try {
        home = resolveHeadcutHome(options.headcutHome);
        python = resolvePython(home);
    } catch (err) {
        resolve({ success: false, message: err.message });
        return;
    }

    fs.mkdirSync(options.outputDir, { recursive: true });

    const stats = {
        total: 0,
        cropped: 0,
        noTarget: 0,
        failed: 0,
        summary: '',
        finishedUnits: new Set(),
    };
    const logs = [];
    const pushLog = (line) => {
        const text = line.toString().trim();
        if (!text) return;
        logs.push(text);
        if (logs.length > 500) logs.shift();
        parseLine(text, stats);
        const finished = stats.finishedUnits.size;
        const percentage = stats.total > 0
            ? Math.min(99, Math.round((finished / stats.total) * 100))
            : 0;
        sendProgress({
            stage: 'log',
            message: text,
            total: stats.total,
            cropped: stats.cropped,
            noTarget: stats.noTarget,
            failed: stats.failed,
            percentage,
        });
    };

    const args = buildArgs(options);
    sendProgress({
        stage: 'start',
        message: `启动 smartcut: ${python} ${args.join(' ')}`,
        home,
    });

    let stderrTail = '';
    const child = spawn(python, args, {
        cwd: home,
        windowsHide: true,
        env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
    });
    runningChild = child;

    const handleData = (chunk) => {
        chunk.toString('utf8').split(/\r?\n/).forEach(pushLog);
    };
    child.stdout.on('data', handleData);
    child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrTail = `${stderrTail}${text}`.slice(-2000);
        text.split(/\r?\n/).forEach((line) => {
            if (line.trim()) pushLog(line);
        });
    });
    child.on('error', (err) => {
        runningChild = null;
        const message = `调用 Python 失败: ${err.message}。请确认 headcut 虚拟环境已安装依赖。`;
        sendProgress({ stage: 'error', message });
        resolve({ success: false, message, logs });
    });
    child.on('close', (code) => {
        runningChild = null;
        const success = code === 0 && stats.failed === 0;
        const result = {
            success,
            stopped: child.killed,
            code,
            total: stats.total,
            cropped: stats.cropped,
            noTarget: stats.noTarget,
            failed: stats.failed,
            summary: stats.summary,
            stderrTail,
            logs,
        };
        sendProgress({ stage: 'done', ...result });
        resolve(result);
    });
});

export const stopSmartCut = () => {
    if (!runningChild) return { success: false, message: '当前没有运行中的智能裁切任务' };
    runningChild.kill();
    return { success: true, message: '已请求停止智能裁切任务' };
};

registHandle(HandleEvents.SMART_CUT, runSmartCut);
registHandle(HandleEvents.SMART_CUT_STOP, stopSmartCut);
registHandle(
    HandleEvents.SMART_CUT_LIST_FILES,
    (dir) => listOutputImages(dir),
);
registHandle(
    HandleEvents.SMART_CUT_READ_IMAGE,
    (filePath, dir) => readOutputImage(filePath, dir),
);
registHandle(
    HandleEvents.SMART_CUT_DELETE_FILE,
    (filePath, dir) => deleteOutputFile(filePath, dir),
);
