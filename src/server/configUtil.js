import { registHandle } from './ipc';
import { HandleEvents } from '@/common/eventConst';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 应用配置统一存放在 userData/SmartDesk/config.json
const getAppConfigPath = () => path.resolve(app.getPath('userData'), 'SmartDesk');
const getUserConfigFile = () => path.resolve(getAppConfigPath(), 'config.json');
// 短视频下载默认目录：文档库/SmartDesk/videoDownload
const getDefaultVideoWorkspacePath = () => path.resolve(
    app.getPath('documents'),
    'SmartDesk',
    'videoDownload',
);

let AppConfig = {
    videoWorkspace: getDefaultVideoWorkspacePath(),
};

const saveAppConfig = () => {
    fs.writeFileSync(getUserConfigFile(), JSON.stringify(AppConfig, null, 2));
};

export const initAppConfig = () => {
    const configFile = getUserConfigFile();
    try {
        fs.accessSync(configFile, fs.constants.F_OK);
        const readConfig = JSON.parse(fs.readFileSync(configFile));
        AppConfig = { ...AppConfig, ...readConfig };
    } catch (err) {
        // 文件不存在时新建并写入默认配置
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        saveAppConfig();
    }
};

export const getVideoWorkSpace = () => AppConfig.videoWorkspace;

export const setVideoWorkSpace = (filePath) => {
    if (!filePath) return false;
    AppConfig.videoWorkspace = filePath;
    saveAppConfig();
    return true;
};

initAppConfig();

registHandle(HandleEvents.GET_VIDEO_WORKSPACE, getVideoWorkSpace);
registHandle(HandleEvents.SET_VIDEO_WORKSPACE, setVideoWorkSpace);
