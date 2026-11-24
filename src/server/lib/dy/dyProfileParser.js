import { registHandle } from '../../ipc';
import { HandleEvents } from '@/common/eventConst';
import { request } from '../request';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const PARTITION = 'persist:dyParser';
const PAGE_LOAD_MS = 20000;
const FIRST_API_MS = 25000;
const RELOAD_WAIT_MS = 20000;
const SCROLL_IDLE_MS = 25000;
const MAX_SCROLL_ROUNDS = 80;
const MANUAL_VERIFY_MS = 90000;
const EXEC_JS_TIMEOUT_MS = 8000;
const ANONYMOUS_NO_PROGRESS_ROUNDS = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toHttps = (url) => {
    if (!url) return '';
    const safe = url.indexOf('&amp;') !== -1 ? url.replace(/&amp;/g, '&') : url;
    return safe.startsWith('http://') ? safe.replace('http://', 'https://') : safe;
};
const getImageExt = (url) => {
    if (url.indexOf('.webp') !== -1) return 'webp';
    if (url.indexOf('.png') !== -1) return 'png';
    return 'jpg';
};

// 诊断日志落地到 userData/SmartDesk/dy-parser.log，便于排查风控/抓包问题
const logLine = (msg) => {
    console.log(`[dy] ${msg}`);
    try {
        const file = path.resolve(app.getPath('userData'), 'SmartDesk', 'dy-parser.log');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
    } catch (e) {
        // 日志失败不影响主流程
    }
};

// executeJavaScript 在页面持续导航/加载未完成时会无限 pending，统一加超时兜底
const execJs = async (win, js, timeoutMs = EXEC_JS_TIMEOUT_MS) => {
    if (!win || win.isDestroyed()) return null;
    return Promise.race([
        win.webContents.executeJavaScript(js).catch(() => null),
        sleep(timeoutMs).then(() => null),
    ]);
};

const loadUrlBounded = async (win, url, timeoutMs = PAGE_LOAD_MS) => {
    if (!win || win.isDestroyed()) return;
    await Promise.race([
        win.loadURL(url).catch((e) => logLine(`navigation aborted: ${e.message}`)),
        sleep(timeoutMs),
    ]);
};

// 响应数据改用调试器 Network 域直接读取（与小红书解析器一致），
// 避免页面内 XHR/fetch 钩子在应用环境里不生效导致抓不到作品接口

const SCROLL_JS = `(function () {
    window.scrollTo(0, document.body.scrollHeight);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 2000, bubbles: true }));
    document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 300) el.scrollTop = el.scrollHeight;
    });
    return true;
})()`;

const PAGE_STATE_JS = `JSON.stringify({
    title: document.title,
    bodyLen: document.body ? document.body.innerHTML.length : 0,
    href: location.href,
})`;

let parserWin = null;
let createPromise = null;
let taskQueue = Promise.resolve();
let lifecycleWired = false;
let networkReady = null;

// 调试器抓到的运行时数据
let capture = null;

const resetCapture = () => {
    capture = {
        awemes: new Map(),
        pendingUrls: {},
        lastHasMore: 1,
        lastMaxCursor: 0,
        lastApiAt: 0,
        firstHealthy: null,
        profile: null,
    };
};
resetCapture();

function mergePostBody(body) {
    const list = Array.isArray(body.aweme_list) ? body.aweme_list : [];
    if (capture.firstHealthy === null) {
        capture.firstHealthy = list.some((item) => !!item.aweme_id);
        logLine(`aweme/post first response healthy=${capture.firstHealthy}, count=${list.length}, has_more=${body.has_more}, status_code=${body.status_code}`);
    }
    list.forEach((item) => {
        if (item.aweme_id) capture.awemes.set(String(item.aweme_id), item);
    });
    capture.lastHasMore = body.has_more === undefined ? capture.lastHasMore : body.has_more;
    capture.lastMaxCursor = body.max_cursor || 0;
    capture.lastApiAt = Date.now();
}

// 调试器 Network 域：作品接口响应完成时直接读取响应体，不依赖页面内钩子
async function handleDyDebugMessage(dbg, method, params) {
    if (!capture) return;
    if (method === 'Network.responseReceived') {
        const resp = params.response || {};
        const url = resp.url || '';
        if (url.indexOf('/aweme/post/') !== -1) {
            capture.pendingUrls[params.requestId] = { url, kind: 'post' };
            capture.lastApiAt = Date.now();
        } else if (url.indexOf('/user/profile/other/') !== -1) {
            capture.pendingUrls[params.requestId] = { url, kind: 'profile' };
        }
        return;
    }
    if (method !== 'Network.loadingFinished') return;
    const pending = capture.pendingUrls[params.requestId];
    if (!pending) return;
    delete capture.pendingUrls[params.requestId];
    let body = '';
    try {
        const ret = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        body = ret.body;
    } catch (e) {
        return;
    }
    let json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        return;
    }
    if (pending.kind === 'post') {
        mergePostBody(json);
    } else {
        capture.profile = json;
    }
}

function setupLifecycleWatcher() {
    if (lifecycleWired) return;
    lifecycleWired = true;
    const hasVisibleOtherWindow = () => BrowserWindow.getAllWindows()
        .some((win) => win !== parserWin && !win.isDestroyed() && win.isVisible());
    const watchedWindows = new WeakSet();
    const watchWindow = (win) => {
        if (win === parserWin || watchedWindows.has(win)) return;
        watchedWindows.add(win);
        win.on('closed', () => {
            if (!hasVisibleOtherWindow() && parserWin && !parserWin.isDestroyed()) {
                parserWin.destroy();
            }
        });
    };
    app.on('browser-window-created', (event, win) => watchWindow(win));
    BrowserWindow.getAllWindows().forEach(watchWindow);
    app.on('before-quit', () => {
        if (parserWin && !parserWin.isDestroyed()) parserWin.destroy();
    });
}

async function createParserWindow() {
    await app.whenReady();
    if (parserWin && !parserWin.isDestroyed()) return parserWin;
    if (createPromise) return createPromise;
    setupLifecycleWatcher();
    networkReady = new Promise((resolveNetworkReady) => {
        createPromise = (async () => {
            const win = new BrowserWindow({
                show: false,
                width: 1280,
                height: 900,
                webPreferences: {
                    partition: PARTITION,
                    contextIsolation: true,
                    nodeIntegration: false,
                    backgroundThrottling: false,
                    javascript: true,
                },
            });
            win.webContents.setUserAgent(DESKTOP_UA);
            win.on('closed', () => {
                parserWin = null;
                capture = null;
                networkReady = null;
            });
            win.webContents.on('render-process-gone', () => {
                if (parserWin && !parserWin.isDestroyed()) parserWin.destroy();
                parserWin = null;
            });

            let attached = false;
            win.webContents.on('dom-ready', async () => {
                if (attached) return;
                attached = true;
                try {
                    const dbg = win.webContents.debugger;
                    dbg.attach('1.3');
                    await dbg.sendCommand('Network.enable');
                    dbg.on('message', async (event, method, params) => {
                        try {
                            await handleDyDebugMessage(dbg, method, params);
                        } catch (err) {
                            console.error('dy debugger handle failed:', err.message);
                        }
                    });
                    logLine('dy network debugger attached');
                } catch (e) {
                    console.error('dy debugger attach failed:', e.message);
                    logLine(`debugger attach failed: ${e.message}`);
                } finally {
                    resolveNetworkReady();
                }
            });
            parserWin = win;
            return win;
        })();
    });
    try {
        await createPromise;
    } finally {
        createPromise = null;
    }
    return parserWin;
}

// 短链还原：v.douyin.com 会 302 到 iesdouyin.com/share/user/{sec_uid}
const getDyRealLink = async (link) => {
    if (!link) return '';
    // v.douyin.com 是短链域名，必须走 302 还原；其它 douyin.com 地址已是完整链接
    const isShortLink = link.indexOf('v.douyin.com') !== -1;
    if (!isShortLink && link.indexOf('douyin.com') !== -1) return link;
    try {
        const ret = await request({
            url: link,
            responseType: 'text',
            followRedirects: false,
            headers: {
                pragma: 'no-cache',
                accept: '*/*',
                'user-agent': MOBILE_UA,
                'accept-language': 'zh-CN,zh;q=0.9',
                'cache-control': 'no-cache',
            },
        });
        const headers = ret.headers || {};
        return headers.location || headers.Location || '';
    } catch (e) {
        const resp = e.response || {};
        const headers = resp.headers || {};
        if (headers.location || headers.Location) {
            return headers.location || headers.Location;
        }
        console.error('dy short link resolve failed:', e.message);
    }
    return '';
};

// 从分享链接/还原后的链接中提取 sec_uid，并归一化为桌面端主页 URL
const normalizeProfileUrl = (realLink) => {
    const pathMatch = realLink.match(/(?:share\/user|user)\/([\w-]+)/);
    if (pathMatch && pathMatch[1]) {
        return `https://www.douyin.com/user/${pathMatch[1]}`;
    }
    try {
        const secUid = new URL(realLink).searchParams.get('sec_uid');
        if (secUid) return `https://www.douyin.com/user/${secUid}`;
    } catch (e) {
        // URL 解析失败时忽略
    }
    return '';
};

const isProfileLink = (realLink) => realLink.indexOf('/share/user/') !== -1
    || realLink.indexOf('/user/') !== -1
    || realLink.indexOf('sec_uid=') !== -1;

// 响应体由调试器 Network 事件实时写入 capture，保留空实现以复用既有轮询节奏
const drainFreshResponses = async () => {
    /* network-driven capture */
};

const isChallengePage = (state) => !state.title
    || state.title.indexOf('验证码') !== -1
    || !state.bodyLen
    || state.bodyLen < 50000;

async function getPageState(win) {
    const raw = await execJs(win, PAGE_STATE_JS) || '{}';
    try {
        return JSON.parse(raw);
    } catch (e) {
        return {};
    }
}

// 隐藏窗口没能自动过风控时，置顶弹窗让用户手动滑验证
async function waitManualVerify(win) {
    if (win.isMinimized()) win.restore();
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    }, 5000);
    logLine('manual verification window shown');
    const deadline = Date.now() + MANUAL_VERIFY_MS;
    while (Date.now() < deadline) {
        await execJs(win, SCROLL_JS);
        await sleep(2500);
        await drainFreshResponses(win);
        if (capture.firstHealthy === true && capture.awemes.size > 0) {
            win.hide();
            logLine('manual verification passed');
            return true;
        }
    }
    win.hide();
    logLine('manual verification timeout');
    return false;
}

async function waitHealthyFirstPage(win) {
    const isHealthy = () => capture.awemes.size > 0 && capture.firstHealthy === true;
    const nudge = async () => {
        await execJs(win, SCROLL_JS);
    };

    let deadline = Date.now() + FIRST_API_MS;
    while (Date.now() < deadline) {
        await drainFreshResponses(win);
        if (isHealthy()) return true;
        if (capture.firstHealthy === false) break;
        await nudge();
        await sleep(2000);
    }
    logLine(`phase1 end, healthy=${capture.firstHealthy}, awemes=${capture.awemes.size}`);

    // 钩子安装晚于首屏请求时，刷新页面让 XHR 在钩子监听下重新发起
    if (capture.firstHealthy === null) {
        resetCapture();
        logLine('no api captured, reloading profile page');
        try {
            win.webContents.reload();
        } catch (e) {
            logLine(`reload failed: ${e.message}`);
        }
        deadline = Date.now() + RELOAD_WAIT_MS;
        while (Date.now() < deadline) {
            await drainFreshResponses(win);
            if (isHealthy()) return true;
            if (capture.firstHealthy === false) break;
            await nudge();
            await sleep(2000);
        }
        logLine(`phase2 end, healthy=${capture.firstHealthy}, awemes=${capture.awemes.size}`);
    }

    const state = await getPageState(win);
    if (isChallengePage(state) || capture.firstHealthy !== true) {
        const passed = await waitManualVerify(win);
        if (passed) return true;
    }
    return isHealthy();
}

function buildUser(profileBody, fallbackAweme) {
    const info = (profileBody && profileBody.user) || {};
    const author = (fallbackAweme && fallbackAweme.author) || {};
    const avatarObj = info.avatar_larger || author.avatar_larger || author.avatar_thumb || {};
    const avatar = Array.isArray(avatarObj.url_list) ? avatarObj.url_list[0] || '' : '';
    const rawUid = info.uid || author.uid || '';
    return {
        nickname: info.nickname || author.nickname || '抖音用户',
        userId: rawUid ? String(rawUid) : '',
        fans: info.follower_count || '',
        avatar: toHttps(avatar),
        desc: info.signature || '',
    };
}

// 把接口蛇形字段映射成与小红书笔记对齐、下载侧可直接消费的结构
function normalizeAweme(aweme) {
    const awemeId = String(aweme.aweme_id || '');
    const rawImages = Array.isArray(aweme.images) ? aweme.images : [];
    const isImage = aweme.media_type === 2 || rawImages.length > 0;
    const video = aweme.video || {};
    const coverObj = video.cover || {};
    let cover = Array.isArray(coverObj.url_list) ? coverObj.url_list[0] || '' : '';

    const images = [];
    const imageExts = [];
    const liveVideos = [];
    rawImages.forEach((item) => {
        const list = Array.isArray(item.url_list) ? item.url_list : [];
        const stillUrl = list[list.length - 1] || list[0] || '';
        images.push(toHttps(stillUrl));
        imageExts.push(getImageExt(stillUrl));
        const motionObj = item.video && item.video.play_addr;
        const motionUrl = motionObj && Array.isArray(motionObj.url_list) ? motionObj.url_list[0] || '' : '';
        liveVideos.push(toHttps(motionUrl));
    });
    if (!cover && images.length) cover = images[0];

    const playObj = video.play_addr || {};
    const playUrl = Array.isArray(playObj.url_list) ? playObj.url_list[0] || '' : '';
    const statistics = aweme.statistics || {};
    return {
        awemeId,
        noteId: awemeId,
        title: aweme.desc || '',
        type: isImage ? 'note' : 'video',
        cover: toHttps(cover),
        likedCount: statistics.digg_count || 0,
        time: aweme.create_time || 0,
        nickname: (aweme.author && aweme.author.nickname) || '',
        noteUrl: `https://www.douyin.com/${isImage ? 'note' : 'video'}/${awemeId}`,
        // 接口直链快照：签名 URL 会过期，解析后应尽快下载
        videoUrl: isImage ? '' : toHttps(playUrl),
        images,
        imageExts,
        liveVideos,
    };
}

// 下载侧把前端回传的快照字段还原成下载流程需要的结构
export const buildDySnapshotInfo = (options = {}) => ({
    videoUrl: options.videoUrl || '',
    cover: options.cover || '',
    user: options.user || '抖音用户',
    desc: options.desc || '',
    type: options.type || 'video',
    images: Array.isArray(options.images) ? options.images : [],
    imageExts: Array.isArray(options.imageExts) ? options.imageExts : [],
    liveVideos: Array.isArray(options.liveVideos) ? options.liveVideos : [],
    awemeId: options.awemeId || '',
});

async function parseProfileInWindow(win, profileUrl, limit) {
    resetCapture();
    logLine(`parse dy profile start: ${profileUrl}, limit=${limit || 0}`);
    await loadUrlBounded(win, profileUrl, PAGE_LOAD_MS);
    if (networkReady) await Promise.race([networkReady, sleep(8000)]);
    // 首屏请求可能早于调试器挂载，reload 一次保证接口被 Network 域捕获
    try {
        win.webContents.reload();
    } catch (e) {
        logLine(`initial reload failed: ${e.message}`);
    }

    const healthy = await waitHealthyFirstPage(win);
    if (!healthy) {
        logLine('parse dy profile failed: risk control not passed');
        return { errorMsg: '抖音风控验证未通过，请在弹出的窗口中完成验证后重试' };
    }

    const reachLimit = () => limit > 0 && capture.awemes.size >= limit;
    const reachEnd = () => capture.lastHasMore === 0 || (capture.lastMaxCursor === 0 && capture.awemes.size > 0);
    let idleRounds = 0;
    let noProgressRounds = 0;
    let lastSize = capture.awemes.size;
    for (let round = 0; round < MAX_SCROLL_ROUNDS && !reachEnd() && !reachLimit(); round++) {
        await execJs(win, SCROLL_JS);
        await sleep(2500);
        await drainFreshResponses(win);
        if (capture.awemes.size > lastSize) {
            lastSize = capture.awemes.size;
            idleRounds = 0;
            noProgressRounds = 0;
        } else {
            idleRounds += 1;
            noProgressRounds += 1;
        }
        // 网页端匿名访问只给首屏约 18 条，滚动不会触发翻页，连续无新增即结束避免空等
        if (noProgressRounds >= ANONYMOUS_NO_PROGRESS_ROUNDS) break;
        if (Date.now() - capture.lastApiAt > SCROLL_IDLE_MS && idleRounds >= 2) break;
    }

    const awemeList = Array.from(capture.awemes.values());
    const notesAll = awemeList.map(normalizeAweme);
    const notes = limit > 0 ? notesAll.slice(0, limit) : notesAll;
    const user = buildUser(capture.profile, awemeList[0]);
    let notice = '';
    if (capture.lastHasMore !== 0) {
        notice = `抖音网页端仅返回该账号最近 ${notesAll.length} 条作品`;
    } else if (!reachLimit()) {
        notice = `抖音网页端已停止返回更早内容，本次共获取 ${notesAll.length} 条作品`;
    }
    if (notice) logLine(`dy profile notice: ${notice}`);
    logLine(`parse dy profile done, captured=${notesAll.length}, returned=${notes.length}, has_more=${capture.lastHasMore}`);
    return {
        isProfile: true,
        profileUrl,
        notice,
        user,
        notes,
        total: notes.length,
    };
}

export const parseDyProfile = async (link, options = {}) => {
    const limit = Number(options.limit) || 0;
    logLine(`parseDyProfile enter link=${link} limit=${limit}`);
    const realLink = await getDyRealLink(link);
    if (!realLink) {
        return { isProfile: false, errorMsg: '抖音链接还原失败，请检查链接后重试' };
    }
    if (!isProfileLink(realLink)) {
        // 单条作品分享链接，交回原有单条解析流程；短链原样交给浏览器自行跳转
        return { isProfile: false, realLink: link };
    }
    const profileUrl = normalizeProfileUrl(realLink);
    if (!profileUrl) {
        return { isProfile: false, errorMsg: '抖音主页链接解析失败，请检查链接后重试' };
    }
    logLine(`parseDyProfile link=${link} realLink=${realLink} limit=${limit}`);
    const run = async () => {
        const win = await createParserWindow();
        if (!capture) resetCapture();
        return parseProfileInWindow(win, profileUrl, limit);
    };
    const task = taskQueue.then(run, run);
    taskQueue = task.catch(() => {});
    return task;
};

registHandle(HandleEvents.DY_PARSE_PROFILE, parseDyProfile);
