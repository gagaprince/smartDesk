import axios from 'axios';

const fs = require('fs');

// 连接与响应头阶段的最长等待（秒），覆盖服务器接受连接但不返回数据导致的永久挂起
const DEFAULT_CONNECT_TIMEOUT = 30;

export class Download {
    constructor({
        url, filePath,
        timeout = 10,
        connectTimeout = DEFAULT_CONNECT_TIMEOUT,
        success,
        fail,
        headers,
    }) {
        this.writer = null;
        this.status = 'init';
        this.downloadUrl = url;
        this.filePath = filePath;
        this.headers = headers;
        this.success = success;
        this.fail = fail;
        this.timeout = timeout;
        this.connectTimeout = connectTimeout;
        this.timeoutId = null;
    }

    async downloadFile() {
        const options = {
            url: this.downloadUrl,
            method: 'GET',
            responseType: 'stream',
            // axios 的 timeout 在 node 端主要作用于拿到响应头之前，避免连接阶段无限挂起
            timeout: this.connectTimeout * 1000,
        };
        if (this.headers) {
            options.headers = this.headers;
        }
        const response = await axios(options);
        const writer = fs.createWriteStream(this.filePath);
        this.writer = writer;
        console.log(this.filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            let settled = false;
            const clearIdleTimer = () => {
                if (this.timeoutId) {
                    clearTimeout(this.timeoutId);
                    this.timeoutId = null;
                }
            };
            const finishWith = (fn, value) => {
                if (settled) return;
                settled = true;
                clearIdleTimer();
                fn(value);
            };
            // 立即启动空闲计时，不必等第一个 data 事件，覆盖“有响应头但长时间没有 body”
            const resetIdleTimer = () => {
                clearIdleTimer();
                this.timeoutId = setTimeout(() => {
                    response.data.destroy();
                    writer.destroy();
                    finishWith(reject, new Error(`${this.timeout} seconds without data, download aborted`));
                }, this.timeout * 1000);
            };
            resetIdleTimer();
            response.data.on('data', resetIdleTimer);
            writer.on('finish', () => {
                finishWith(resolve);
            });
            writer.on('error', (e) => {
                console.log('写入文件报错了', e);
                response.data.destroy();
                finishWith(reject, e);
            });
            response.data.on('error', (e) => {
                console.log('下载流报错了', e);
                writer.destroy();
                finishWith(reject, e);
            });
        });
    }

    async startDownload() {
        this.status = 'downloading';
        try {
            await this.downloadFile();
            this.status = 'finished';
            if (this.success) this.success();
        } catch (error) {
            this.status = 'error';
            // 清理可能写了一半的残缺文件，避免被当成成功结果
            try {
                if (this.filePath && fs.existsSync(this.filePath)) {
                    fs.unlinkSync(this.filePath);
                }
            } catch (cleanupErr) {
                console.log('清理残缺文件失败', cleanupErr.message);
            }
            if (this.fail) this.fail(error);
        }
    }

    stopDownload() {
        if (this.writer && this.status === 'downloading') {
            this.writer.end();
        }
    }
}
