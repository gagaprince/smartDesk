import { registHandle } from '../../ipc';
import { HandleEvents } from '@/common/eventConst';

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

// 与后续主页解析共用同一个持久化分区，登录态 cookie 自动保存在本机
const PARTITION = 'persist:xhsParser';
const LOGIN_URL = 'https://www.xiaohongshu.com/login';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// cookie 由 persist 分区自动持久化；匿名访问也会种下 web_session，
// 但 id_token 仅在扫码登录成功后才会出现，是可靠的登录判据
const getCacheFile = () => path.resolve(app.getPath('userData'), 'SmartDesk', 'xhs-login.json');
let loginCache = { nickname: '', userId: '', loggedInAt: 0 };
try {
    loginCache = { ...loginCache, ...JSON.parse(fs.readFileSync(getCacheFile(), 'utf8')) };
} catch (e) {
    // 缓存文件不存在时使用空值
}
const saveLoginCache = () => {
    try {
        fs.mkdirSync(path.dirname(getCacheFile()), { recursive: true });
        fs.writeFileSync(getCacheFile(), JSON.stringify(loginCache, null, 2));
    } catch (e) {
        console.error('xhs login cache save failed:', e.message);
    }
};

let loginWin = null;
let loginPromise = null;
let lifecycleWired = false;

// 登录窗口不能阻止应用退出：主窗口全部关闭后主动销毁登录窗口
function setupLifecycleWatcher() {
    if (lifecycleWired) return;
    lifecycleWired = true;
    const hasVisibleOtherWindow = () => BrowserWindow.getAllWindows()
        .some((win) => win !== loginWin && !win.isDestroyed() && win.isVisible());
    const watchedWindows = new WeakSet();
    const watchWindow = (win) => {
        if (win === loginWin || watchedWindows.has(win)) return;
        watchedWindows.add(win);
        win.on('closed', () => {
            if (!hasVisibleOtherWindow() && loginWin && !loginWin.isDestroyed()) {
                loginWin.destroy();
            }
        });
    };
    app.on('browser-window-created', (event, win) => watchWindow(win));
    BrowserWindow.getAllWindows().forEach(watchWindow);
    app.on('before-quit', () => {
        if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
    });
}

export const getXhsSession = () => session.fromPartition(PARTITION);

const hasLoginCookie = async () => {
    const cookies = await getXhsSession().cookies.get({});
    return cookies.some((cookie) => cookie.name === 'id_token' && !!cookie.value);
};

// 不弹窗、不发网络请求；以 id_token cookie 为准，本地缓存仅提供昵称等展示信息
export const getXhsLoginStatus = async () => {
    const loggedIn = await hasLoginCookie();
    return {
        loggedIn,
        nickname: loggedIn ? loginCache.nickname || '' : '',
        userId: loggedIn ? loginCache.userId || '' : '',
    };
};

// 在登录窗口页面内探测登录状态：登录成功后页面状态里会出现真实用户 ID
const probeLoginState = (win) => win.webContents.executeJavaScript(`(function () {
    try {
        const state = window.__INITIAL_STATE__ || {};
        const userInfo = (state.user && (state.user.userInfo || state.user)) || {};
        const userId = userInfo.userid || userInfo.user_id || userInfo.id || '';
        const nickname = userInfo.nickname || userInfo.nick_name || '';
        return {
            href: location.href,
            userId: userId === null || userId === undefined ? '' : String(userId),
            nickname: nickname || '',
        };
    } catch (e) {
        return { href: location.href, userId: '', nickname: '' };
    }
})()`).catch(() => ({ href: '', userId: '', nickname: '' }));

async function doLogin() {
    const current = await getXhsLoginStatus();
    if (current.loggedIn) return current;

    await app.whenReady();
    setupLifecycleWatcher();

    const win = new BrowserWindow({
        show: true,
        width: 1200,
        height: 900,
        center: true,
        autoHideMenuBar: true,
        title: '小红书登录',
        webPreferences: {
            partition: PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    loginWin = win;
    win.webContents.setUserAgent(DESKTOP_UA);
    win.on('closed', () => {
        if (loginWin === win) loginWin = null;
    });

    try {
        await win.loadURL(LOGIN_URL);
    } catch (e) {
        console.error('xhs login page load failed:', e.message);
    }

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (win.isDestroyed()) {
            return { loggedIn: false, errorMsg: '已取消小红书登录' };
        }
        if (await hasLoginCookie()) {
            // 昵称尽力获取，失败不影响登录结果，后续主页解析时还能再补
            const probe = await probeLoginState(win);
            loginCache = {
                userId: probe.userId || loginCache.userId || '',
                nickname: probe.nickname || loginCache.nickname || '',
                loggedInAt: Date.now(),
            };
            saveLoginCache();
            if (!win.isDestroyed()) win.destroy();
            return {
                loggedIn: true,
                userId: loginCache.userId,
                nickname: loginCache.nickname,
            };
        }
        await sleep(POLL_INTERVAL_MS);
    }

    if (!win.isDestroyed()) win.destroy();
    return { loggedIn: false, errorMsg: '登录超时，请重新点击登录' };
}

// 串行化，重复点击复用同一个登录流程，避免弹出多个窗口
export const loginXhs = () => {
    if (loginPromise) return loginPromise;
    loginPromise = doLogin().finally(() => {
        loginPromise = null;
    });
    return loginPromise;
};

export const logoutXhs = async () => {
    try {
        await getXhsSession().clearStorageData();
    } catch (e) {
        console.error('xhs logout clear failed:', e.message);
    }
    loginCache = { nickname: '', userId: '', loggedInAt: 0 };
    try {
        fs.unlinkSync(getCacheFile());
    } catch (e) {
        // 缓存文件不存在即可
    }
    return { loggedIn: false, nickname: '', userId: '' };
};

registHandle(HandleEvents.XHS_LOGIN, loginXhs);
registHandle(HandleEvents.XHS_LOGIN_STATUS, getXhsLoginStatus);
registHandle(HandleEvents.XHS_LOGOUT, logoutXhs);
