import {
    app, protocol, BrowserWindow, screen, globalShortcut,
} from 'electron';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer';
import {
    initIpc, registHandle, startComfyuiService, stopComfyuiService,
    startLanServer, stopLanServer,
} from '@/server/index';
import { HandleEvents } from '@/common/eventConst';

const path = require('path');

const isDevelopment = process.env.NODE_ENV !== 'production';

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true } },
]);

const openDevTools = () => {
    const winSelect = BrowserWindow.getFocusedWindow();
    if (winSelect) {
        winSelect.webContents.openDevTools();
    }
};

async function createWindow() {
    // Create the browser window.
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const win = new BrowserWindow({
        width,
        height,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
            contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
        },
    });

    initIpc(win);

    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
        if (!process.env.IS_TEST) win.webContents.openDevTools();
    } else {
        createProtocol('app');
        // Load the index.html when not in development
        win.loadURL('app://./index.html');
    }

    globalShortcut.register('CommandOrControl+Shift+I', openDevTools);

    registHandle(HandleEvents.OPEN_DEV_TOOLS, openDevTools);
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and its menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        stopComfyuiService();
        stopLanServer();
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
    if (isDevelopment && !process.env.IS_TEST) {
        // Install Vue Devtools
        installExtension(VUEJS3_DEVTOOLS).catch((e) => {
            console.error('Vue Devtools failed to install:', e.toString());
        });
    }
    createWindow();
    // 后台拉起 comfyui-ctrl FastAPI 子服务, 不阻塞窗口创建
    startComfyuiService()
        .then((status) => console.log('comfyui-ctrl 服务状态:', status))
        .catch((err) => console.error('comfyui-ctrl 启动失败:', err));
    // 局域网 Ollama 测试页与显存清理接口, 不阻塞窗口创建
    startLanServer();
});

app.on('before-quit', () => {
    stopComfyuiService();
    stopLanServer();
});

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === 'win32') {
        process.on('message', (data) => {
            if (data === 'graceful-exit') {
                app.quit();
            }
        });
    } else {
        process.on('SIGTERM', () => {
            app.quit();
        });
    }
}
