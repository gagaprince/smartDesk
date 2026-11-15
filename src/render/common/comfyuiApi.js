// comfyui-ctrl FastAPI 子服务的渲染层调用封装
// 服务基址由主进程通过 IPC 提供, 后端统一响应包络 { code, message, data }
import { HandleEvents } from '@/common/eventConst';

const API_PREFIX = '/api/v1';

let baseUrl = '';

export const getComfyuiBase = async () => {
    if (!baseUrl) {
        baseUrl = await window.ipcRenderer.invoke(HandleEvents.GET_COMFYUI_BASE);
    }
    return baseUrl;
};

export const getComfyuiHealth = () => window.ipcRenderer.invoke(
    HandleEvents.GET_COMFYUI_HEALTH,
);

// 后端图片地址是相对路径, 统一拼成可直接访问的绝对地址
export const resolveImageUrl = (imageUrl) => {
    if (!imageUrl) return '';
    if (/^https?:\/\//.test(imageUrl)) return imageUrl;
    return `${baseUrl}${imageUrl}`;
};

const request = async (url, options = {}) => {
    const base = await getComfyuiBase();
    const response = await fetch(`${base}${API_PREFIX}${url}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!response.ok) {
        let detail = '';
        try {
            const errorBody = await response.json();
            detail = typeof errorBody.detail === 'string'
                ? errorBody.detail
                : JSON.stringify(errorBody.detail || errorBody);
        } catch (err) {
            // 非 JSON 错误响应时只保留状态码信息
        }
        throw new Error(
            detail ? `HTTP ${response.status}：${detail}` : `HTTP ${response.status}`,
        );
    }
    const envelope = await response.json();
    if (envelope.code !== 0) {
        throw new Error(envelope.message);
    }
    return envelope.data;
};

// ----- 生图工作流 -----

export const fetchWorkflows = () => request('/workflows');

export const fetchLoras = () => request('/workflows/loras');

export const invokeWorkflow = (workflowId, params) => request(
    `/workflows/${workflowId}/invoke`,
    { method: 'POST', body: JSON.stringify({ params }) },
);

export const fetchJob = (jobId) => request(`/jobs/${jobId}`);

export const fetchJobs = () => request('/jobs');

// ----- 工作流调用配置平台 -----

export const parseWorkflowGraph = (graph) => request('/admin/workflows/parse', {
    method: 'POST',
    body: JSON.stringify({ graph }),
});

export const trialWorkflow = (payload) => request('/admin/workflows/trial', {
    method: 'POST',
    body: JSON.stringify(payload),
});

export const fetchRegistry = () => request('/admin/workflows');

export const fetchWorkflowDetail = (workflowId) => request(
    `/admin/workflows/${workflowId}`,
);

export const createWorkflow = (payload) => request('/admin/workflows', {
    method: 'POST',
    body: JSON.stringify(payload),
});

export const updateWorkflow = (workflowId, payload) => request(
    `/admin/workflows/${workflowId}`,
    { method: 'PUT', body: JSON.stringify(payload) },
);

export const deleteWorkflowApi = (workflowId) => request(
    `/admin/workflows/${workflowId}`,
    { method: 'DELETE' },
);

export const reloadRegistry = () => request('/admin/workflows/reload', {
    method: 'POST',
});

export const fetchEnumOptions = (source) => request(`/admin/enums/${source}`);
