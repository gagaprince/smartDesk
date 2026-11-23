import { createRouter, createWebHashHistory } from 'vue-router';

import Home from '@/render/views/Home.vue';
import Dashboard from '@/render/views/Dashboard.vue';
import Setting from '@/render/views/Setting.vue';
import BatchVideoDownload from '@/render/views/BatchVideoDownload.vue';
import HeadCut from '@/render/views/HeadCut.vue';
// eslint-disable-next-line import/extensions
import SmartCut from '@/render/views/SmartCut.vue';
import LoraLibrary from '@/render/views/LoraLibrary.vue';
// eslint-disable-next-line import/extensions
import LoraBatchTrain from '@/render/views/LoraBatchTrain.vue';
import WorkflowAdminPage from '@/render/views/WorkflowAdminPage.vue';
import WorkflowPage from '@/render/views/WorkflowPage.vue';
import WorkflowApiDoc from '@/render/views/WorkflowApiDoc.vue';
import OllamaGuide from '@/render/views/OllamaGuide.vue';
import OllamaChat from '@/render/views/OllamaChat.vue';

const routes = [
    {
        path: '/',
        name: 'Home',
        component: Home,
        redirect: '/dashboard',
        children: [
            {
                path: 'dashboard',
                name: 'dashboard',
                component: Dashboard,
            },
            {
                path: 'tool/video-download',
                name: 'video-download',
                component: BatchVideoDownload,
            },
            {
                path: 'tool/head-cut',
                name: 'head-cut',
                component: HeadCut,
            },
            {
                path: 'tool/smart-cut',
                name: 'smart-cut',
                component: SmartCut,
            },
            {
                path: 'prod/lora-library',
                name: 'lora-library',
                component: LoraLibrary,
            },
            {
                path: '/prod/lora-batch-train',
                name: 'lora-batch-train',
                component: LoraBatchTrain,
            },
            {
                path: 'prod/workflow-admin',
                name: 'workflow-admin',
                component: WorkflowAdminPage,
            },
            {
                path: 'prod/workflow',
                name: 'workflow',
                component: WorkflowPage,
            },
            {
                path: 'prod/api-doc',
                name: 'api-doc',
                component: WorkflowApiDoc,
            },
            {
                path: 'prod/ollama-guide',
                name: 'ollama-guide',
                component: OllamaGuide,
            },
            {
                path: 'prod/ollama-chat',
                name: 'ollama-chat',
                component: OllamaChat,
            },
            {
                path: 'setting',
                name: 'setting',
                component: Setting,
            },
        ],
    },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

export default router;
