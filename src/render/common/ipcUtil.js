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
export const selectDirectory = async () => ipcRenderer.invoke(HandleEvents.SELECT_DIR);
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

// 工作台: 显卡状态与本地服务启停管理
export const getDashboardOverview = async () => ipcRenderer.invoke(HandleEvents.GET_DASHBOARD_OVERVIEW);
export const startDashboardService = async (id) => ipcRenderer.invoke(HandleEvents.START_SERVICE, id);
export const stopDashboardService = async (id) => ipcRenderer.invoke(HandleEvents.STOP_SERVICE, id);
export const releaseDashboardVram = async () => ipcRenderer.invoke(HandleEvents.RELEASE_VRAM);
export const openDashboardServiceHome = async (id) => ipcRenderer.invoke(
    HandleEvents.OPEN_SERVICE_HOME,
    id,
);
