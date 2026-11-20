import { registHandle } from '../ipc';
import { HandleEvents } from '@/common/eventConst';

const { dialog, shell } = require('electron');
const fs = require('fs');


export const selectDir = async (defaultPath) => {
    const options = { properties: ['openDirectory'] };
    if (defaultPath && typeof defaultPath === 'string') {
        try {
            if (fs.existsSync(defaultPath) && fs.statSync(defaultPath).isDirectory()) {
                options.defaultPath = defaultPath;
            }
        } catch (err) {
            console.log('默认目录无效，使用系统默认位置', err);
        }
    }
    return dialog.showOpenDialog(options).catch((err) => {
        console.log(err);
        return {};
    });
};

export const openDir = async (dir) => shell.openPath(dir)
    .then(() => {
        console.log('Directory opened');
        return true;
    })
    .catch((err) => {
        console.error(err);
        return false;
    });

registHandle(HandleEvents.SELECT_DIR, selectDir);
registHandle(HandleEvents.OPEN_DIR, openDir);
