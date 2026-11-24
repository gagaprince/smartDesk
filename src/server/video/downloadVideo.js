import { registHandle } from '../ipc';
import { HandleEvents } from '@/common/eventConst';
import { parseDyShareLink } from '@/server/lib/dy/dyBrowser';
import { buildDySnapshotInfo } from '@/server/lib/dy/dyProfileParser';
import { getVideoInfoFromDLpanda } from '@/server/lib/tt/ttParser';
import { getVideoInfoByLinkFromKs } from '@/server/lib/ks/ksParser';
import { getVideoInfoByXHSLink } from '@/server/lib/xhs/xhsParser';
import { parseXhsNoteInWindow } from '@/server/lib/xhs/xhsProfileParser';
import { Download } from '@/server/download/download';
import { getVideoWorkSpace } from '../configUtil';
import { formatDay } from '../util/date';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1';
// 单个作品（含可能的浏览器回退解析）总耗时上限，超时按失败跳过，保证整批不会被一条任务冻死
const WORK_OVERALL_TIMEOUT_MS = 240000;

// 下载相关诊断日志，便于在看不到主进程控制台时定位失败原因
const logDownload = (msg) => {
    try {
        const file = path.resolve(app.getPath('userData'), 'SmartDesk', 'video-download.log');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
    } catch (e) {
        // 日志失败不影响下载主流程
    }
};

const getImgExt = (url) => {
    const match = (url || '').match(/\.(jpeg|jpg|png|webp|gif|bmp)(\?|$)/i);
    return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
};

// 获取短视频内容
async function getVideoInfoByDYLink(originLink, options) {
    // 主页批量解析已拿到接口直链快照，直接消费，避免逐条跳详情页（签名 URL 会过期，拿不到时再回退窗口解析）
    if (options && options.dyWindowParse) {
        const snapshot = buildDySnapshotInfo(options);
        if (snapshot.videoUrl || (snapshot.images && snapshot.images.length)) {
            return {
                ...snapshot,
                downloadRefer: originLink,
            };
        }
    }
    const videoInfo = await parseDyShareLink(originLink);
    if (videoInfo && videoInfo.errorMsg) {
        return videoInfo;
    }
    if (!videoInfo || (!videoInfo.videoUrl && !(videoInfo.images && videoInfo.images.length))) {
        return { errorMsg: '抖音作品解析失败，请稍后重试' };
    }
    return {
        ...videoInfo,
        downloadRefer: originLink,
    };
}
async function getVideoInfoByTTLink(originLink) {
    const ret = await getVideoInfoFromDLpanda(originLink);
    console.log(ret);
    return ret;
}
async function getVideoInfoByKSLink(originLink) {
    const videoInfo = await getVideoInfoByLinkFromKs(originLink);
    return videoInfo;
}


// 检测是什么平台
// https://v.douyin.com/iFCvgktY/
// https://www.tiktok.com/t/ZPRTuroNq/
// https://v.kuaishou.com/vLhwdi
function checkPL(link = '') {
    if (link.indexOf('douyin') !== -1) {
        return 'dy';
    } else if (link.indexOf('tiktok') !== -1) {
        return 'tt';
    } else if (link.indexOf('kuaishou') !== -1) {
        return 'ks';
    } else if (link.indexOf('xhslink') !== -1 || link.indexOf('xiaohongshu.com') !== -1) {
        return 'xhs';
    }

    return 'none';
}

/**
 *
 * @param {*} link
 * videoInfo {
 *  videoUrl, cover, user, desc
 * }
 */
export const getVideoInfoByLink = async (link, options) => {
    let videoInfo;
    switch (checkPL(link)) {
        case 'dy':
            videoInfo = await getVideoInfoByDYLink(link, options);
            break;
        case 'tt':
            videoInfo = await getVideoInfoByTTLink(link);
            break;
        case 'ks':
            videoInfo = await getVideoInfoByKSLink(link);
            break;
        case 'xhs':
            if (options && options.xhsWindowParse) {
                videoInfo = await parseXhsNoteInWindow({
                    noteId: options.noteId,
                    xsecToken: options.xsecToken,
                    profileUrl: options.profileUrl,
                    noteUrl: options.noteUrl,
                });
            } else {
                videoInfo = await getVideoInfoByXHSLink(link);
            }
            break;
        default:
    }
    console.log('videoInfo:', videoInfo);
    return {
        user: 'tt暂时无用户信息',
        cover: 'https://p0.meituan.net/travelcube/bef32336873e45d3350b9201ab505f7b23324.png',
        desc: 'tt暂时无简介',
        ...videoInfo,
    };
};

async function runDownload(link, options = {}) {
    const info = await getVideoInfoByLink(link, options);
    if (info) {
        console.log(info);
        const {
            videoUrl, user, type = 'video', images = [], imageExts = [], liveVideos = [], downloadRefer = '',
        } = info;
        if (!videoUrl && (!images || !images.length)) {
            return info;
        }
        // LoRA 批量训练传入 targetDir 时按 任务目录/作者 组织, 否则沿用 工作区/日期/作者 的默认结构
        const safeUser = String(user || '小红书用户').replace(/[\\/:*?"<>|]/g, '_');
        const fileDir = options.targetDir
            ? path.resolve(options.targetDir, safeUser)
            : path.resolve(getVideoWorkSpace(), formatDay(), user);
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true }); // recursive选项确保创建嵌套目录
        }
        // 单个文件最多再重试 2 次：抖音 CDN 偶发“响应头到达但 body 挂起”，退避后重试通常可成功
        const MAX_DOWNLOAD_RETRY = 2;
        const startDownload = (url, filePath, headers = null) => new Promise((resolve) => {
            let attempt = 0;
            const runOnce = () => {
                const downloader = new Download({
                    url,
                    filePath,
                    headers: headers || undefined,
                    success: () => {
                        resolve(filePath);
                    },
                    fail: (e) => {
                        attempt += 1;
                        global.logRender('下载出错：', e);
                        console.log(`download attempt ${attempt} failed: ${e}`);
                        if (attempt <= MAX_DOWNLOAD_RETRY) {
                            setTimeout(runOnce, attempt * 1000);
                        } else {
                            logDownload(`download failed after ${attempt} attempts: ${url} :: ${e && e.message}`);
                            resolve('');
                        }
                    },
                });
                downloader.startDownload();
            };
            runOnce();
        });
        if (type === 'video') {
            const filePath = path.resolve(fileDir, `${Date.now()}.mp4`);
            const ret = await startDownload(videoUrl, filePath, {
                Referer: downloadRefer || videoUrl,
                'User-Agent': MOBILE_UA,
                Range: 'bytes=0-',
            });
            info.fileDir = fileDir;
            info.filePath = ret;
        } else {
            // 下载图文/实况照片（实况照片额外下载每一张的动态mp4）
            let ret = '';
            const time = Date.now();
            for (let i = 0; i < images.length; i++) {
                const ext = imageExts[i] || getImgExt(images[i]);
                const filePath = path.resolve(fileDir, `${time}_${i}.${ext}`);
                ret = await startDownload(images[i], filePath);
                if (type === 'livePhoto' && liveVideos[i]) {
                    const livePath = path.resolve(fileDir, `${time}_${i}_live.mp4`);
                    await startDownload(liveVideos[i], livePath, {
                        Referer: downloadRefer || liveVideos[i],
                        'User-Agent': MOBILE_UA,
                        Range: 'bytes=0-',
                    });
                }
            }
            info.fileDir = fileDir;
            info.filePath = ret;
        }
    }
    return info;
}

// 对外处理入口：竞速一个整体超时，任何环节挂起都按失败返回，保证串行队列继续往后走
export const downloadSmallVideoByLink = async (link, options = {}) => {
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            logDownload(`overall timeout, skip: ${link}`);
            resolve({ errorMsg: '单个作品处理超时，已自动跳过' });
        }, WORK_OVERALL_TIMEOUT_MS);
    });
    try {
        const result = await Promise.race([runDownload(link, options), timeout]);
        if (result && result.errorMsg) {
            logDownload(`work failed: ${link} :: ${result.errorMsg}`);
        }
        return result;
    } finally {
        clearTimeout(timer);
    }
};

registHandle(HandleEvents.GET_VIDEO_INFO, getVideoInfoByLink);
registHandle(HandleEvents.DOWNLOAD_SMALL_VIDEO, downloadSmallVideoByLink);
