import {
    Event, HandleEvents, RenderReceiveEvents,
} from '@/common/eventConst';

import ipcMethods from './ipcMethods';

const { ipcRenderer } = window;

const _createReplyPromise = () => {
    const replyHolder = {};
    replyHolder.reply = new Promise((resolve) => {
        replyHolder.resolveFun = resolve;
    });
    return replyHolder;
};

const sendFactory = (eventName) => {
    let replyHolder = _createReplyPromise();
    ipcRenderer.on(eventName, (event, arg) => {
        replyHolder.resolveFun(arg);
        replyHolder = _createReplyPromise();
    });
    return (options) => {
        ipcRenderer.send(eventName, options);
        return replyHolder.reply;
    };
};

const helloSend = sendFactory(Event.TEST);

export const sayHello = () => helloSend('hello');

/**
 * arg: {
 *  methodName, msgId, args
 * }
 * 主进程通过 PING 调用渲染层方法，渲染层通过 PONG 返回结果
 */
const initCallRenderMethod = () => {
    ipcRenderer.on(RenderReceiveEvents.PING, async (event, arg) => {
        const { methodName, msgId, args } = arg;
        if (ipcMethods[methodName]) {
            const ret = await ipcMethods[methodName](...args);
            ipcRenderer.send(RenderReceiveEvents.PONG, {
                msgId, ret,
            });
        } else {
            ipcRenderer.send(RenderReceiveEvents.PONG, {
                msgId, error: `method:${methodName} is not defined`, ret: undefined,
            });
        }
    });
};

initCallRenderMethod();

export const invokeTest = async () => {
    const ret = await ipcRenderer.invoke(HandleEvents.TEST, 'test');
    console.log('invokeTest ret:', ret);
    return ret;
};

export const openDevTool = async () => ipcRenderer.invoke(HandleEvents.OPEN_DEV_TOOLS);

// 目录选择与打开
export const selectDirectory = async (defaultPath) => ipcRenderer.invoke(HandleEvents.SELECT_DIR, defaultPath);
export const openDirectory = async (dir) => ipcRenderer.invoke(HandleEvents.OPEN_DIR, dir);

// 短视频下载目录配置（配置入口在短视频下载功能页内）
export const getVideoWorkspace = async () => ipcRenderer.invoke(HandleEvents.GET_VIDEO_WORKSPACE);
export const setVideoWorkspace = async (path) => ipcRenderer.invoke(HandleEvents.SET_VIDEO_WORKSPACE, path);

// 短视频解析与下载
export const getVideoInfoByLink = async (link, options) => ipcRenderer.invoke(
    HandleEvents.GET_VIDEO_INFO,
    link,
    options,
);
export const downloadSmallVideoByLink = async (link, options) => ipcRenderer.invoke(
    HandleEvents.DOWNLOAD_SMALL_VIDEO,
    link,
    options,
);

// 小红书网页版登录态（个人主页批量解析前置）
export const xhsLogin = async () => ipcRenderer.invoke(HandleEvents.XHS_LOGIN);
export const getXhsLoginStatus = async () => ipcRenderer.invoke(HandleEvents.XHS_LOGIN_STATUS);
export const xhsLogout = async () => ipcRenderer.invoke(HandleEvents.XHS_LOGOUT);
export const xhsParseProfile = async (link, options) => ipcRenderer.invoke(HandleEvents.XHS_PARSE_PROFILE, link, options);

// 一键裁切头像
export const runHeadCut = async (options) => ipcRenderer.invoke(HandleEvents.HEAD_CUT, options);
export const stopHeadCut = async () => ipcRenderer.invoke(HandleEvents.HEAD_CUT_STOP);
export const listHeadCutImages = async (dir) => ipcRenderer.invoke(HandleEvents.HEAD_CUT_LIST_FILES, dir);
export const readHeadCutImage = async (filePath, dir) => ipcRenderer.invoke(
    HandleEvents.HEAD_CUT_READ_IMAGE,
    filePath,
    dir,
);
export const deleteHeadCutFile = async (filePath, dir) => ipcRenderer.invoke(
    HandleEvents.HEAD_CUT_DELETE_FILE,
    filePath,
    dir,
);

// 一键智能裁切（图片/视频 + 多部位）
export const runSmartCut = async (options) => ipcRenderer.invoke(HandleEvents.SMART_CUT, options);
export const stopSmartCut = async () => ipcRenderer.invoke(HandleEvents.SMART_CUT_STOP);
export const listSmartCutImages = async (dir) => ipcRenderer.invoke(
    HandleEvents.SMART_CUT_LIST_FILES,
    dir,
);
export const readSmartCutImage = async (filePath, dir) => ipcRenderer.invoke(
    HandleEvents.SMART_CUT_READ_IMAGE,
    filePath,
    dir,
);
export const deleteSmartCutFile = async (filePath, dir) => ipcRenderer.invoke(
    HandleEvents.SMART_CUT_DELETE_FILE,
    filePath,
    dir,
);

// 工作台: 显卡状态与本地服务启停管理
export const getDashboardOverview = async () => ipcRenderer.invoke(HandleEvents.GET_DASHBOARD_OVERVIEW);
export const startDashboardService = async (id) => ipcRenderer.invoke(HandleEvents.START_SERVICE, id);
export const stopDashboardService = async (id) => ipcRenderer.invoke(HandleEvents.STOP_SERVICE, id);
export const releaseDashboardVram = async () => ipcRenderer.invoke(HandleEvents.RELEASE_VRAM);
export const openDashboardServiceHome = async (id) => ipcRenderer.invoke(
    HandleEvents.OPEN_SERVICE_HOME,
    id,
);

// Ollama 调用说明页: 获取本地模型清单与在线状态
export const getOllamaModels = async () => ipcRenderer.invoke(HandleEvents.GET_OLLAMA_MODELS);

// 局域网 HTTP 服务: 状态查询与启停
export const getLanServerStatus = async () => ipcRenderer.invoke(HandleEvents.GET_LAN_SERVER_STATUS);
export const startLanServerApi = async () => ipcRenderer.invoke(HandleEvents.START_LAN_SERVER);
export const stopLanServerApi = async () => ipcRenderer.invoke(HandleEvents.STOP_LAN_SERVER);

// LoRA 批量训练
export const getLoraBatchConfig = async () => ipcRenderer.invoke(HandleEvents.LORA_BATCH_GET_CONFIG);
export const setLoraBatchConfig = async (patch) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_SET_CONFIG, patch);
export const listLoraBatchJobs = async () => ipcRenderer.invoke(HandleEvents.LORA_BATCH_LIST_JOBS);
export const createLoraBatchJob = async (payload) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_CREATE_JOB, payload);
export const createLoraBatchJobs = async (payload) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_CREATE_BATCH, payload);
export const confirmLoraBatchJobs = async (batchId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_CONFIRM_BATCH, batchId);
export const stopLoraBatchJob = async (jobId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_STOP_JOB, jobId);
export const retryLoraBatchJob = async (jobId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_RETRY_JOB, jobId);
export const removeLoraBatchJob = async (jobId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_REMOVE_JOB, jobId);
export const openLoraBatchDir = async (dir) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_OPEN_DIR, dir);
export const confirmLoraBatchJob = async (jobId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_CONFIRM_JOB, jobId);
export const recropLoraBatchJob = async (jobId) => ipcRenderer.invoke(HandleEvents.LORA_BATCH_RECROP_JOB, jobId);
