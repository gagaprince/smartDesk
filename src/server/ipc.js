import { Event, HandleEvents, RenderReceiveEvents } from '@/common/eventConst';

const { ipcMain } = require('electron');

// render -> main 异步事件（ipcRenderer.on / event.reply 模式）
const controllerMap = {};

export const registController = (eventName, controller) => {
    controllerMap[eventName] = controller;
};

// render -> main 同步调用（ipcRenderer.invoke / ipcMain.handle 模式）
const handlerMap = {};

export const registHandle = (eventName, handler) => {
    handlerMap[eventName] = handler;
};

export const getMsgId = () => ('0'.repeat(8) + parseInt(Math.pow(2, 40) * Math.random(), 10).toString(32)).slice(-8) + Date.now();

const _createReplyPromise = () => {
    const msgId = getMsgId();
    const replyHolder = {
        msgId,
    };
    replyHolder.reply = new Promise((resolve, reject) => {
        replyHolder.resolveFun = resolve;
        replyHolder.rejectFun = reject;
    });
    return replyHolder;
};

let renderReplyList = [];
const registRenderReply = (holder) => {
    renderReplyList.push(holder);
};

const invokeRenderReply = (arg) => {
    const { msgId, ret, error } = arg;
    const holder = renderReplyList.find((ele) => ele.msgId === msgId);
    if (error) {
        holder.rejectFun(error);
    } else {
        holder.resolveFun(ret);
    }
    renderReplyList = renderReplyList.filter((ele) => ele.msgId !== msgId);
};

let mainWin;
export const initIpc = (win) => {
    mainWin = win;
    // 这种是异步调用 render 调用 main
    Object.keys(Event).forEach((key) => {
        ipcMain.on(Event[key], (event, arg) => {
            const controller = controllerMap[Event[key]];
            if (controller) {
                controller.reply(event, arg);
            } else {
                // 给一个默认的回复
                event.reply(Event[key], '当前事件没有找到对应的controller');
            }
        });
    });
    // 这种是同步调用 render 调用 main
    Object.keys(HandleEvents).forEach((key) => {
        ipcMain.handle(HandleEvents[key], (event, ...args) => {
            const handler = handlerMap[HandleEvents[key]];
            if (handler) {
                if (handler.invoke) return handler.invoke(...args);
                return handler(...args);
            }
            // 给一个默认的调用结果
            return '当前事件没有找到对应的handler';
        });
    });

    ipcMain.on(RenderReceiveEvents.PONG, (event, arg) => {
        invokeRenderReply(arg);
    });
};

export const getMainWindow = () => mainWin;

/**
 * 主进程调用渲染层方法
 * options: { methodName, args, msgId }
 */
export const invokeRenderMethod = (options) => {
    const holder = _createReplyPromise();
    const msg = {
        ...options,
        msgId: holder.msgId,
    };
    mainWin.webContents.send(RenderReceiveEvents.PING, msg);
    registRenderReply(holder);
    return holder.reply;
};

global.logRender = async (...args) => {
    await invokeRenderMethod({
        methodName: 'logRender',
        args: [...args],
    });
};

registHandle(HandleEvents.TEST, (msg) => `主进程已收到消息：${msg}`);
