import { registHandle } from '../../ipc';
import { HandleEvents } from '@/common/eventConst';
import { getXHSRealLink } from './xhsParser';
import { getXhsLoginStatus } from './xhsLogin';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const PARTITION = 'persist:xhsParser';
const PAGE_LOAD_MS = 20000;
const FIRST_API_MS = 25000;
const RELOAD_WAIT_MS = 20000;
const SCROLL_IDLE_MS = 25000;
const MAX_SCROLL_ROUNDS = 60;
const FIND_CARD_STEPS = 40;
const NOTE_FEED_WAIT_MS = 15000;
const BACK_WAIT_MS = 8000;
const MANUAL_VERIFY_MS = 90000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toHttps = (url) => (url && url.startsWith('http://') ? url.replace('http://', 'https://') : url);

// 诊断日志落地到 userData/SmartDesk/xhs-parser.log，便于排查风控/抓包问题
const logLine = (msg) => {
    try {
        const file = path.resolve(app.getPath('userData'), 'SmartDesk', 'xhs-parser.log');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
    } catch (e) {
        // 日志失败不影响主流程
    }
};

let parserWin = null;
let createPromise = null;
let taskQueue = Promise.resolve();
let lifecycleWired = false;
let lastProfileUrl = '';

// 调试器抓到的运行时数据
let capture = null;

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

const resetCapture = () => {
    capture = {
        notes: new Map(),
        pendingUrls: {},
        lastApiAt: 0,
        gotHasMoreEnd: false,
        firstResponseHealthy: null,
        feedWaiters: new Map(),
    };
};
resetCapture();

function handleUserPostedBody(body) {
    let json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        return;
    }
    const data = json.data || {};
    const notes = Array.isArray(data.notes) ? data.notes : [];
    if (capture.firstResponseHealthy === null) {
        capture.firstResponseHealthy = notes.some((note) => !!note.note_id);
        logLine(`user_posted first response healthy=${capture.firstResponseHealthy}, notes=${notes.length}, has_more=${data.has_more}`);
    }
    notes.forEach((note) => {
        if (note.note_id) capture.notes.set(note.note_id, note);
    });
    capture.lastApiAt = Date.now();
    if (data.has_more === false) capture.gotHasMoreEnd = true;
    logLine(`user_posted captured, total=${capture.notes.size}, has_more=${data.has_more}`);
}

function handleFeedBody(body) {
    let json;
    try {
        json = JSON.parse(body);
    } catch (e) {
        return;
    }
    const items = (json.data && json.data.items) || [];
    logLine(`feed response items=${items.length}`);
    items.forEach((item) => {
        const card = item.note_card;
        if (!card || !card.note_id) return;
        const waiter = capture.feedWaiters.get(card.note_id);
        if (waiter) {
            capture.feedWaiters.delete(card.note_id);
            waiter(card);
        }
    });
}

async function handleDebugMessage(dbg, method, params) {
    if (!capture) return;
    if (method === 'Network.responseReceived') {
        const url = params.response && params.response.url;
        if (url && (url.indexOf('user_posted') !== -1 || url.indexOf('/feed') !== -1)) {
            capture.pendingUrls[params.requestId] = url;
            capture.lastApiAt = Date.now();
        }
        return;
    }
    if (method !== 'Network.loadingFinished') return;
    const url = capture.pendingUrls[params.requestId];
    if (!url) return;
    delete capture.pendingUrls[params.requestId];
    let body = '';
    try {
        const ret = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        body = ret.body;
    } catch (e) {
        // 预取/重定向请求可能读不到 body，忽略即可
        return;
    }
    if (url.indexOf('user_posted') !== -1) {
        handleUserPostedBody(body);
    } else if (url.indexOf('/feed') !== -1) {
        handleFeedBody(body);
    }
}

async function createParserWindow() {
    await app.whenReady();
    if (parserWin && !parserWin.isDestroyed()) return parserWin;
    if (createPromise) return createPromise;
    setupLifecycleWatcher();
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
                logLine(`debugger attached, href=${win.webContents.getURL()}`);
                dbg.on('message', async (event, method, params) => {
                    try {
                        await handleDebugMessage(dbg, method, params);
                    } catch (e) {
                        console.error('xhs debugger handle failed:', e.message);
                    }
                });
            } catch (e) {
                console.error('xhs debugger attach failed:', e.message);
                logLine(`debugger attach failed: ${e.message}`);
            }
        });
        parserWin = win;
        return win;
    })();
    try {
        await createPromise;
    } finally {
        createPromise = null;
    }
    return parserWin;
}

const SCROLL_JS = `(function () {
    window.scrollTo(0, document.body.scrollHeight);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 2000, bubbles: true }));
    document.querySelectorAll('*').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 300) el.scrollTop = el.scrollHeight;
    });
    return true;
})()`;

// 部分账号的 user_posted 接口会被平台降级（条数变少、has_more 提前结束），
// 但 SSR 首屏渲染的 section.note-item 仍带完整 noteId 与 xsec_token，作为补充数据源
const COLLECT_DOM_JS = `(function () {
    return Array.from(document.querySelectorAll('section.note-item')).map((sec) => {
        const anchor = sec.querySelector('a.cover') || sec.querySelector('a[href*="xsec_token"]');
        const href = anchor ? anchor.getAttribute('href') : '';
        let xsecToken = '';
        try {
            xsecToken = new URL(href, location.origin).searchParams.get('xsec_token') || '';
        } catch (e) {
            xsecToken = '';
        }
        const titleEl = sec.querySelector('.title');
        const img = sec.querySelector('img');
        return {
            noteId: sec.getAttribute('data-note-id'),
            href,
            xsecToken,
            title: titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '',
            cover: img ? img.src : '',
            isVideo: !!sec.querySelector('.play-icon'),
        };
    }).filter((item) => item.noteId);
})()`;

async function waitHealthyFirstPage(win) {
    const isHealthy = () => capture.notes.size > 0 && capture.firstResponseHealthy === true;
    const nudge = () => win.webContents.executeJavaScript(SCROLL_JS).catch(() => {});

    // 阶段一：调试器挂载可能晚于首批请求，主动滚动触发翻页接口
    let deadline = Date.now() + FIRST_API_MS;
    while (Date.now() < deadline) {
        if (isHealthy()) return true;
        if (capture.firstResponseHealthy === false) break;
        await nudge();
        await sleep(2000);
    }
    logLine(`phase1 end, healthy=${capture.firstResponseHealthy}, notes=${capture.notes.size}`);

    // 阶段二：完全没抓到接口时，刷新页面让 XHR 在调试器监听下重新发起
    if (capture.firstResponseHealthy === null) {
        resetCapture();
        logLine('no api captured, reloading profile page');
        await win.webContents.reload().catch((e) => logLine(`reload failed: ${e.message}`));
        deadline = Date.now() + RELOAD_WAIT_MS;
        while (Date.now() < deadline) {
            if (isHealthy()) return true;
            if (capture.firstResponseHealthy === false) break;
            await nudge();
            await sleep(2000);
        }
        logLine(`phase2 end, healthy=${capture.firstResponseHealthy}, notes=${capture.notes.size}`);
    }

    // 阶段三：确认被风控降级（或刷新后仍无数据），置顶弹窗让用户手动过验证
    logLine('manual verification window shown');
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    }, 5000);
    const manualDeadline = Date.now() + MANUAL_VERIFY_MS;
    while (Date.now() < manualDeadline) {
        if (isHealthy()) {
            win.hide();
            logLine('manual verification passed');
            return true;
        }
        await nudge();
        await sleep(2500);
    }
    win.hide();
    logLine('manual verification timeout');
    return false;
}

async function parseProfileInWindow(win, profileUrl, limit) {
    resetCapture();
    logLine(`parse profile start: ${profileUrl}, limit=${limit || 0}`);
    await Promise.race([
        win.loadURL(profileUrl).catch((e) => console.error('xhs profile load failed:', e.message)),
        sleep(PAGE_LOAD_MS),
    ]);
    const healthy = await waitHealthyFirstPage(win);
    if (!healthy) {
        logLine('parse profile failed: risk control not passed');
        return { errorMsg: '小红书风控验证未通过，请在弹出的窗口中完成验证后重试' };
    }
    const domCardMap = new Map();
    const collectDomCards = async () => {
        const cards = await win.webContents.executeJavaScript(COLLECT_DOM_JS).catch(() => []);
        (cards || []).forEach((card) => {
            if (!domCardMap.has(card.noteId)) domCardMap.set(card.noteId, card);
        });
    };
    await collectDomCards();
    let idleRounds = 0;
    const reachLimit = () => limit > 0 && capture.notes.size >= limit;
    for (let round = 0; round < MAX_SCROLL_ROUNDS && !capture.gotHasMoreEnd && !reachLimit(); round++) {
        await win.webContents.executeJavaScript(SCROLL_JS).catch(() => {});
        await sleep(2500);
        if (Date.now() - capture.lastApiAt > SCROLL_IDLE_MS) {
            idleRounds += 1;
            if (idleRounds >= 2) break;
        } else {
            idleRounds = 0;
        }
    }
    await collectDomCards();
    const pageUser = await win.webContents.executeJavaScript(`(function () {
        try {
            const state = window.__INITIAL_STATE__ || {};
            const info = (state.profile && state.profile.userInfo) || {};
            return {
                nickname: info.nickname || '',
                userId: info.redId || info.id || '',
                fans: info.fans || '',
                avatar: info.images || '',
                desc: info.desc || '',
            };
        } catch (e) {
            return {};
        }
    })()`).catch(() => ({}));
    const xhrNotes = Array.from(capture.notes.values()).map((note) => {
        const cover = note.cover || {};
        const coverUrl = cover.url_default || cover.url_pre || cover.url || '';
        return {
            noteId: note.note_id,
            title: note.display_title || '',
            type: note.type === 'video' ? 'video' : 'image',
            cover: toHttps(coverUrl),
            xsecToken: note.xsec_token || '',
            likedCount: (note.interact_info && note.interact_info.liked_count) || '',
            time: note.time || 0,
            nickname: (note.user && (note.user.nickname || note.user.nick_name)) || '',
            noteUrl: `https://www.xiaohongshu.com/explore/${note.note_id}?xsec_token=${encodeURIComponent(note.xsec_token || '')}&xsec_source=pc_feed`,
        };
    });
    const xhrIds = new Set(xhrNotes.map((note) => note.noteId));
    const domOnlyNotes = Array.from(domCardMap.values())
        .filter((card) => !xhrIds.has(card.noteId))
        .map((card) => ({
            noteId: card.noteId,
            title: card.title,
            type: card.isVideo ? 'video' : 'image',
            cover: toHttps(card.cover),
            xsecToken: card.xsecToken,
            likedCount: '',
            time: 0,
            nickname: pageUser.nickname || '',
            noteUrl: card.href
                ? `https://www.xiaohongshu.com${card.href}`
                : `https://www.xiaohongshu.com/explore/${card.noteId}?xsec_token=${encodeURIComponent(card.xsecToken)}&xsec_source=pc_user`,
        }));
    const notes = [...xhrNotes, ...domOnlyNotes];
    // 接口条数明显少于首屏卡片数：该账号在网页端被平台限流，更早作品只在 App 可见
    const notice = domCardMap.size > capture.notes.size
        ? `小红书网页端共获取该账号最近 ${notes.length} 条作品（首屏 ${domCardMap.size} 条 + 翻页 ${capture.notes.size} 条，平台已停止返回更早内容），更早的作品仅 App 内可见，网页端无法获取`
        : '';
    if (notice) logLine(`web limited profile: xhr=${xhrNotes.length}, dom=${domCardMap.size}, merged=${notes.length}`);
    // user_posted 接口按发布时间倒序返回，Map 保留插入顺序，前 limit 条即最新作品
    const resultNotes = limit > 0 ? notes.slice(0, limit) : notes;
    logLine(`parse profile done, captured=${notes.length}, returned=${resultNotes.length}`);
    return {
        isProfile: true,
        profileUrl,
        notice,
        user: {
            nickname: pageUser.nickname || (resultNotes[0] && resultNotes[0].nickname) || '小红书用户',
            userId: pageUser.userId || '',
            fans: pageUser.fans || '',
            avatar: pageUser.avatar || '',
            desc: pageUser.desc || '',
        },
        notes: resultNotes,
        total: resultNotes.length,
    };
}

function pickVideoUrl(card) {
    const stream = card.video && card.video.media && card.video.media.stream;
    if (!stream) return '';
    const groups = ['EF5', 'EF4', 'EF6', 'EF7'].map((key) => stream[key]).filter(Array.isArray);
    for (const group of groups) {
        const item = group.find((v) => v && v.master_url);
        if (item) return toHttps(item.master_url);
    }
    for (const group of groups) {
        const item = group.find((v) => v && Array.isArray(v.backup_urls) && v.backup_urls.length);
        if (item) return toHttps(item.backup_urls[0]);
    }
    return '';
}

function normalizeNoteCard(card, noteUrl) {
    const imageList = Array.isArray(card.image_list) ? card.image_list : [];
    const images = imageList
        .map((img) => toHttps(img.url_default || img.url_pre || img.url || ''))
        .filter(Boolean);
    const isVideo = card.type === 'video';
    const cover = toHttps(images[0] || (card.video && card.video.image && card.video.image.first_frame_fileid) || '');
    if (isVideo) {
        const videoUrl = pickVideoUrl(card);
        return {
            videoUrl,
            cover,
            user: (card.user && card.user.nickname) || '小红书用户',
            type: 'video',
            desc: card.desc || card.title || '',
            images: [],
            downloadRefer: noteUrl,
        };
    }
    return {
        videoUrl: '',
        cover,
        user: (card.user && card.user.nickname) || '小红书用户',
        type: 'image',
        desc: card.desc || card.title || '',
        images,
        downloadRefer: noteUrl,
    };
}

// 直达笔记页时，详情来自 SSR 内嵌的 __INITIAL_STATE__，字段为驼峰命名
function pickSsrVideoUrl(card) {
    const stream = card.video && card.video.media && card.video.media.stream;
    if (!stream) return '';
    const groups = ['EF5', 'EF4', 'EF6', 'EF7'].map((key) => stream[key]).filter(Array.isArray);
    for (const group of groups) {
        const item = group.find((v) => v && v.masterUrl);
        if (item) return toHttps(item.masterUrl);
    }
    for (const group of groups) {
        const item = group.find((v) => v && Array.isArray(v.backupUrls) && v.backupUrls.length);
        if (item) return toHttps(item.backupUrls[0]);
    }
    return '';
}

function normalizeSsrNoteCard(card, noteUrl) {
    const imageList = Array.isArray(card.imageList) ? card.imageList : [];
    const images = imageList
        .map((img) => toHttps(img.urlDefault || img.urlPre || img.url || ''))
        .filter(Boolean);
    const isVideo = card.type === 'video';
    const cover = toHttps(images[0] || '');
    const user = (card.user && card.user.nickname) || '小红书用户';
    const desc = card.desc || card.title || '';
    if (isVideo) {
        return {
            videoUrl: pickSsrVideoUrl(card),
            cover,
            user,
            type: 'video',
            desc,
            images: [],
            downloadRefer: noteUrl,
        };
    }
    return {
        videoUrl: '',
        cover,
        user,
        type: 'image',
        desc,
        images,
        downloadRefer: noteUrl,
    };
}

async function waitFeedCard(win, noteId) {
    const feedPromise = new Promise((resolve) => {
        capture.feedWaiters.set(noteId, resolve);
    });
    const clickJs = `(function () {
        const sections = Array.from(document.querySelectorAll('section.note-item'));
        const sec = sections.find((el) => el.getAttribute('data-note-id') === '${noteId}');
        if (!sec) return false;
        const anchor = sec.querySelector('a.cover') || sec.querySelector('a');
        if (!anchor) return false;
        anchor.click();
        return true;
    })()`;
    const clicked = await win.webContents.executeJavaScript(clickJs).catch(() => false);
    if (!clicked) {
        logLine(`note card not found in current viewport: ${noteId}`);
        return null;
    }
    const card = await Promise.race([
        feedPromise,
        sleep(NOTE_FEED_WAIT_MS).then(() => null),
    ]);
    if (!card) logLine(`feed detail timeout: ${noteId}`);
    return card;
}

async function backToProfile(win, profileUrl) {
    await win.webContents.executeJavaScript('window.history.back()').catch(() => {});
    const deadline = Date.now() + BACK_WAIT_MS;
    while (Date.now() < deadline) {
        const href = await win.webContents.executeJavaScript('location.href').catch(() => '');
        if (href.indexOf('/user/profile/') !== -1) {
            await sleep(1200);
            return;
        }
        await sleep(800);
    }
    // back 失效时直接重新打开主页
    await Promise.race([
        win.loadURL(profileUrl).catch(() => {}),
        sleep(PAGE_LOAD_MS),
    ]);
    await sleep(3000);
}

// 直达笔记页后，从 SSR 注入的 __INITIAL_STATE__ 轮询完整详情（媒体地址水化通常在 1 秒内完成）
const buildSsrCardJs = (noteId) => `(function () {
    try {
        const state = window.__INITIAL_STATE__ || {};
        const map = ((state.note || {}).noteDetailMap) || {};
        const entry = map['${noteId}'];
        const card = entry && entry.note ? entry.note : null;
        if (!card) return null;
        if (card.type === 'video') {
            const stream = card.video && card.video.media && card.video.media.stream;
            const ready = stream && Object.keys(stream).some((key) => Array.isArray(stream[key])
                && stream[key].some((it) => it && (it.masterUrl || (Array.isArray(it.backupUrls) && it.backupUrls.length))));
            if (!ready) return null;
        } else if (!Array.isArray(card.imageList) || !card.imageList.length) {
            return null;
        }
        return JSON.stringify(card);
    } catch (e) {
        return null;
    }
})()`;

async function fetchNoteByDirectNav(win, noteId, noteUrl) {
    await win.loadURL(noteUrl).catch((e) => logLine(`note direct nav aborted: ${e.message}`));
    const firstDeadline = Date.now() + NOTE_FEED_WAIT_MS;
    const hardDeadline = firstDeadline + MANUAL_VERIFY_MS;
    let shown = false;
    while (Date.now() < hardDeadline) {
        const raw = await win.webContents.executeJavaScript(buildSsrCardJs(noteId)).catch(() => null);
        if (raw) {
            try {
                const card = JSON.parse(raw);
                if (shown) win.hide();
                return card;
            } catch (e) {
                logLine(`ssr card parse failed: ${e.message}`);
            }
        }
        if (!shown && Date.now() >= firstDeadline) {
            shown = true;
            logLine(`ssr card not ready, show window for manual verify: ${noteId}`);
            win.setAlwaysOnTop(true);
            win.show();
            win.focus();
            setTimeout(() => {
                if (!win.isDestroyed()) win.setAlwaysOnTop(false);
            }, 5000);
        }
        await sleep(500);
    }
    if (shown) win.hide();
    return null;
}

// 优先直达笔记页读取 SSR 详情（不依赖主页虚拟列表，稳定快速）；失败时回退到主页内点击卡片抓 feed
export const parseXhsNoteInWindow = async ({
    noteId,
    xsecToken,
    profileUrl,
    noteUrl,
}) => {
    const status = await getXhsLoginStatus();
    if (!status.loggedIn) {
        return { errorMsg: '小红书登录态已失效，请重新扫码登录' };
    }
    const targetNoteUrl = noteUrl
        || `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken || '')}&xsec_source=pc_feed`;
    const run = async () => {
        const win = await createParserWindow();
        if (!capture) resetCapture();
        const ssrCard = await fetchNoteByDirectNav(win, noteId, targetNoteUrl);
        if (ssrCard) {
            logLine(`note detail via direct nav ok: ${noteId}`);
            return normalizeSsrNoteCard(ssrCard, targetNoteUrl);
        }
        logLine(`direct nav failed, fallback to click flow: ${noteId}`);
        const targetProfileUrl = profileUrl || lastProfileUrl;
        if (!targetProfileUrl) {
            return { errorMsg: '小红书笔记详情获取失败，请稍后重试' };
        }
        const href = await win.webContents.executeJavaScript('location.href').catch(() => '');
        if (href.indexOf('/user/profile/') === -1) {
            resetCapture();
            await Promise.race([
                win.loadURL(targetProfileUrl).catch(() => {}),
                sleep(PAGE_LOAD_MS),
            ]);
            await sleep(4000);
        }
        // 虚拟列表：逐步滚动找到目标卡片
        let card = null;
        for (let step = 0; step < FIND_CARD_STEPS; step++) {
            card = await waitFeedCard(win, noteId);
            if (card) break;
            const found = await win.webContents.executeJavaScript(`(function () {
                const sec = Array.from(document.querySelectorAll('section.note-item'))
                    .find((el) => el.getAttribute('data-note-id') === '${noteId}');
                if (sec) { sec.scrollIntoView({ block: 'center' }); return true; }
                window.scrollBy(0, 1400);
                return false;
            })()`).catch(() => false);
            if (found) {
                await sleep(1000);
                card = await waitFeedCard(win, noteId);
                if (card) break;
            }
            await sleep(1000);
        }
        await backToProfile(win, targetProfileUrl);
        if (!card) {
            logLine(`note detail failed: ${noteId}`);
            return { errorMsg: '小红书笔记详情获取失败，请稍后重试' };
        }
        return normalizeNoteCard(card, targetNoteUrl);
    };
    const task = taskQueue.then(run, run);
    taskQueue = task.catch(() => {});
    return task;
};

export const parseXhsProfile = async (link, options = {}) => {
    const status = await getXhsLoginStatus();
    if (!status.loggedIn) {
        return { isProfile: false, errorMsg: '请先完成小红书扫码登录' };
    }
    const limit = Number(options.limit) || 0;
    const realLink = await getXHSRealLink(link);
    if (!realLink) {
        return { isProfile: false, errorMsg: '小红书链接还原失败，请检查链接后重试' };
    }
    if (realLink.indexOf('/user/profile/') === -1) {
        return { isProfile: false, realLink };
    }
    logLine(`parseXhsProfile link=${link} realLink=${realLink} limit=${limit}`);
    lastProfileUrl = realLink;
    const run = async () => {
        const win = await createParserWindow();
        return parseProfileInWindow(win, realLink, limit);
    };
    const task = taskQueue.then(run, run);
    taskQueue = task.catch(() => {});
    return task;
};

registHandle(HandleEvents.XHS_PARSE_PROFILE, parseXhsProfile);
