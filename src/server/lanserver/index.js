// 局域网 HTTP 服务: 对外提供 Ollama 聊天测试页面 / 接口与显存清理接口
// 零新增运行时依赖, 使用 Node 原生 http + 已有 axios, 兼容 Electron 13(Node 14, 无全局 fetch)
import http from 'http';
import os from 'os';
import axios from 'axios';
import { registHandle } from '../ipc';
import { HandleEvents } from '@/common/eventConst';
import { releaseVram } from '../dashboard';
import { CHAT_PAGE_HTML } from './chatPage';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_PORT = 3100;
const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434/v1';
const MAX_BODY_BYTES = 1024 * 1024;

const getSmartDeskDir = () => path.join(app.getPath('userData'), 'SmartDesk');
const getConfigFile = () => path.join(getSmartDeskDir(), 'lan-server.json');

const readConfig = () => {
    const defaults = {
        enabled: true,
        port: DEFAULT_PORT,
        token: '',
        defaultModel: '',
        ollamaBaseUrl: DEFAULT_OLLAMA_BASE,
    };
    try {
        const parsed = JSON.parse(fs.readFileSync(getConfigFile(), 'utf-8'));
        return { ...defaults, ...parsed };
    } catch (err) {
        return defaults;
    }
};

let server = null;
const sockets = new Set();
let status = {
    running: false,
    enabled: true,
    port: DEFAULT_PORT,
    urls: [],
    tokenConfigured: false,
    error: '',
};

const resolveLanUrls = (port) => {
    const urls = [];
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach((name) => {
        (interfaces[name] || []).forEach((net) => {
            if (net.family === 'IPv4' && !net.internal) {
                urls.push(`http://${net.address}:${port}`);
            }
        });
    });
    return urls;
};

const sendJson = (res, httpStatus, payload) => {
    res.writeHead(httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            reject(new Error('请求体超过 1MB 限制'));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

const isAuthorized = (req, config) => {
    if (!config.token) return true;
    return req.headers.authorization === `Bearer ${config.token}`;
};

const handleModels = async (config, res) => {
    try {
        const upstream = await axios.get(`${config.ollamaBaseUrl}/models`, {
            headers: { Authorization: 'Bearer ollama' },
            timeout: 8000,
            proxy: false,
        });
        const models = Array.isArray(upstream.data && upstream.data.data)
            ? upstream.data.data.map((item) => String(item.id || '')).filter(Boolean)
            : [];
        sendJson(res, 200, { models, defaultModel: config.defaultModel });
    } catch (err) {
        sendJson(res, 502, {
            error: `无法连接模型服务 ${config.ollamaBaseUrl}：${err.message}`,
        });
    }
};

const handleChat = async (config, req, res) => {
    let payload;
    try {
        payload = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
        sendJson(res, 400, { error: `请求体不是合法 JSON：${err.message}` });
        return;
    }
    const message = String(payload.message || '').trim();
    if (!message) {
        sendJson(res, 400, { error: 'message 不能为空' });
        return;
    }
    const model = String(payload.model || config.defaultModel || '');
    if (!model) {
        sendJson(res, 400, { error: '未指定 model, 且服务端未配置默认模型' });
        return;
    }

    let upstream;
    try {
        upstream = await axios({
            method: 'POST',
            url: `${config.ollamaBaseUrl}/chat/completions`,
            data: {
                model,
                messages: [{ role: 'user', content: message }],
                stream: true,
            },
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ollama',
            },
            responseType: 'stream',
            timeout: 0,
            proxy: false,
            validateStatus: () => true,
        });
    } catch (err) {
        sendJson(res, 502, {
            error: `无法连接模型服务 ${config.ollamaBaseUrl}：${err.message}`,
        });
        return;
    }

    if (upstream.status !== 200) {
        let detail = '';
        try {
            detail = await new Promise((resolve) => {
                const parts = [];
                upstream.data.on('data', (chunk) => parts.push(chunk));
                upstream.data.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
                upstream.data.on('error', () => resolve(''));
            });
        } catch (err) {
            detail = '';
        }
        sendJson(res, 502, {
            error: `模型服务返回 HTTP ${upstream.status}：${detail.slice(0, 500)}`,
        });
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    let buffer = '';
    const writeSse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    upstream.data.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach((rawLine) => {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            try {
                const json = JSON.parse(data);
                const delta = json.choices && json.choices[0]
                    && json.choices[0].delta && json.choices[0].delta.content;
                if (delta) writeSse({ delta });
            } catch (err) {
                // 忽略心跳与非 JSON 行
            }
        });
    });
    upstream.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
    });
    upstream.data.on('error', (err) => {
        writeSse({ error: `流式响应中断：${err.message}` });
        res.end();
    });
    req.on('close', () => {
        if (!res.writableEnded) upstream.data.destroy();
    });
};

const handleVramRelease = async (res) => {
    try {
        const result = await releaseVram();
        sendJson(res, result.success ? 200 : 503, result);
    } catch (err) {
        sendJson(res, 500, { success: false, message: `显存清理异常：${err.message}` });
    }
};

const createRequestHandler = (config) => (req, res) => {
    // 渲染层与局域网页面都可能跨域调用, 统一放开
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') && !isAuthorized(req, config)) {
        sendJson(res, 401, { error: '未授权, 请在 Authorization 头中携带正确的 Bearer Token' });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
        sendJson(res, 200, {
            defaultModel: config.defaultModel,
            ollamaBaseUrl: config.ollamaBaseUrl,
            authRequired: Boolean(config.token),
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/models') {
        handleModels(config, res);
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
        handleChat(config, req, res);
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vram/release') {
        handleVramRelease(res);
        return;
    }
    if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(CHAT_PAGE_HTML);
        return;
    }
    sendJson(res, 404, { error: 'Not Found' });
};

export const startLanServer = () => {
    if (server) return status;
    const config = readConfig();
    status.enabled = config.enabled;
    status.tokenConfigured = Boolean(config.token);
    if (!config.enabled) {
        status.running = false;
        status.error = '';
        return status;
    }
    try {
        server = http.createServer(createRequestHandler(config));
        server.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        });
        server.on('error', (err) => {
            status.running = false;
            status.error = err.code === 'EADDRINUSE'
                ? `端口 ${config.port} 被占用, 可修改 ${getConfigFile()} 中的 port 后重启应用`
                : err.message;
            console.error('[lan-server] 服务异常:', err);
            server = null;
        });
        server.listen(config.port, '0.0.0.0', () => {
            status = {
                running: true,
                enabled: true,
                port: config.port,
                urls: resolveLanUrls(config.port),
                tokenConfigured: Boolean(config.token),
                error: '',
            };
            console.log(`[lan-server] 局域网服务已启动, 端口 ${config.port}, 地址: ${status.urls.join(', ')}`);
        });
    } catch (err) {
        status.running = false;
        status.error = err.message;
        server = null;
    }
    return status;
};

export const stopLanServer = () => new Promise((resolve) => {
    if (!server) {
        status.running = false;
        resolve();
        return;
    }
    sockets.forEach((socket) => socket.destroy());
    server.close(() => {
        server = null;
        status.running = false;
        status.urls = [];
        resolve();
    });
});

export const getLanServerStatus = () => {
    const config = readConfig();
    return {
        ...status,
        enabled: config.enabled,
        port: status.running ? status.port : config.port,
        tokenConfigured: Boolean(config.token),
        configFile: getConfigFile(),
    };
};

registHandle(HandleEvents.GET_LAN_SERVER_STATUS, getLanServerStatus);
registHandle(HandleEvents.START_LAN_SERVER, () => startLanServer());
registHandle(HandleEvents.STOP_LAN_SERVER, stopLanServer);
