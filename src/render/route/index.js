import { createRouter, createWebHashHistory } from 'vue-router';

import Home from '@/render/views/Home.vue';
import Dashboard from '@/render/views/Dashboard.vue';
import Setting from '@/render/views/Setting.vue';
import BatchVideoDownload from '@/render/views/BatchVideoDownload.vue';
import HeadCut from '@/render/views/HeadCut.vue';
import WorkflowAdminPage from '@/render/views/WorkflowAdminPage.vue';
import WorkflowPage from '@/render/views/WorkflowPage.vue';

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
