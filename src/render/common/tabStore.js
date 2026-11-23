import { reactive } from 'vue';

// 侧边栏菜单配置: 普通项为单页面, group 项为可展开的功能分类
export const menuConfig = [
    {
        path: '/dashboard',
        title: '工作台',
        icon: 'Monitor',
        closable: false,
    },
    {
        group: '素材工具箱',
        icon: 'Box',
        children: [
            {
                path: '/tool/video-download',
                title: '短视频下载',
                icon: 'VideoCamera',
                closable: true,
            },
            {
                path: '/tool/head-cut',
                title: '一键裁切头像',
                icon: 'Crop',
                closable: true,
            },
            {
                path: '/tool/smart-cut',
                title: '一键智能裁切',
                icon: 'MagicStick',
                closable: true,
            },
        ],
    },
    {
        group: '生产工具',
        icon: 'Tools',
        children: [
            {
                path: '/prod/workflow-admin',
                title: '工作流调用配置',
                icon: 'SetUp',
                closable: true,
            },
            {
                path: '/prod/workflow',
                title: '生图工作流',
                icon: 'PictureFilled',
                closable: true,
            },
            {
                path: '/prod/lora-library',
                title: 'LoRA 模型管理',
                icon: 'CollectionTag',
                closable: true,
            },
            {
                path: '/prod/lora-batch-train',
                title: 'LoRA 批量训练',
                icon: 'Histogram',
                closable: true,
            },
            {
                path: '/prod/api-doc',
                title: '调用文档',
                icon: 'Document',
                closable: true,
            },
            {
                path: '/prod/ollama-guide',
                title: 'ollama调用说明',
                icon: 'ChatDotRound',
                closable: true,
            },
            {
                path: '/prod/ollama-chat',
                title: 'ollama测试',
                icon: 'ChatLineRound',
                closable: true,
            },
        ],
    },
    {
        path: '/setting',
        title: '设置',
        icon: 'Setting',
        closable: false,
    },
];

// 拍平成 path -> 菜单项 的索引, 便于路由变化时查找标题/图标
const menuIndex = {};
menuConfig.forEach((item) => {
    if (item.children) {
        item.children.forEach((child) => {
            menuIndex[child.path] = child;
        });
    } else {
        menuIndex[item.path] = item;
    }
});

const homeTab = {
    path: '/dashboard',
    title: '工作台',
    icon: 'Monitor',
    closable: false,
};

export const tabState = reactive({
    tabs: [homeTab],
    activePath: homeTab.path,
});

// 路由切换时调用: 不存在则打开新标签, 已存在则仅激活
export const openTab = (path) => {
    const menuItem = menuIndex[path];
    if (!menuItem) return;
    const existed = tabState.tabs.find((tab) => tab.path === path);
    if (!existed) {
        tabState.tabs.push({
            path: menuItem.path,
            title: menuItem.title,
            icon: menuItem.icon,
            closable: menuItem.closable !== false,
        });
    }
    tabState.activePath = path;
};

// 关闭标签, 返回关闭后应跳转的路径; 关闭的不是当前标签则返回空串
export const closeTab = (path) => {
    const index = tabState.tabs.findIndex((tab) => tab.path === path);
    if (index === -1) return '';
    const target = tabState.tabs[index];
    if (!target.closable) return '';
    tabState.tabs.splice(index, 1);
    if (tabState.activePath !== path) return '';
    const next = tabState.tabs[index] || tabState.tabs[index - 1] || tabState.tabs[0];
    tabState.activePath = next.path;
    return next.path;
};
