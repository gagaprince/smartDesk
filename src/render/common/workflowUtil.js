// ComfyUI 工作流相关页面的共享工具: 默认值、状态元信息、草稿绑定辅助
import { reactive } from 'vue';

// 工作流注册表变更信号: 管理页保存/删除/热加载后递增,
// 被 keep-alive 缓存的生书页与文档页据此静默刷新定义
export const workflowRegistryState = reactive({ version: 0 });

export const bumpWorkflowRegistry = () => {
    workflowRegistryState.version += 1;
};

// 任务状态 -> Element Plus 标签类型与中文文案
export const JOB_STATUS_META = {
    queued: { type: 'info', text: '排队中' },
    running: { type: 'warning', text: '生成中' },
    success: { type: 'success', text: '成功' },
    error: { type: 'danger', text: '失败' },
};

// 依据参数定义生成一份默认提交值
export const buildDefaultValues = (params) => {
    const values = {};
    params.forEach((param) => {
        if (param.default !== null && param.default !== undefined) {
            values[param.key] = param.default;
        } else if (param.type === 'bool') {
            values[param.key] = false;
        }
    });
    return values;
};

export const formatTime = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

// 动态枚举来源选项（工作流调用配置页）
export const ENUM_SOURCE_OPTIONS = [
    { value: 'comfyui_loras', label: 'ComfyUI LoRA 列表' },
    { value: 'checkpoints', label: '底模 Checkpoint 列表' },
    { value: 'samplers', label: '采样器列表' },
    { value: 'schedulers', label: '调度器列表' },
    { value: 'vaes', label: 'VAE 列表' },
];

export const TYPE_OPTIONS = [
    { value: 'string', label: '字符串 string' },
    { value: 'int', label: '整数 int' },
    { value: 'float', label: '小数 float' },
    { value: 'bool', label: '布尔 bool' },
    { value: 'enum', label: '枚举 enum' },
    { value: 'image', label: '图片 image（上传/Base64）' },
];

// 草稿以路径拼出来的字符串作为 key
export const pathKey = (segments) => segments.join('>');

// 读取图中指定路径的值
export const getAtPath = (graph, segments) => {
    let cursor = graph;
    for (const segment of segments) {
        if (cursor === null || typeof cursor !== 'object') return undefined;
        cursor = cursor[segment];
    }
    return cursor;
};

// 工作流图是纯 JSON 数据, 用 JSON 方式深拷贝后改值并返回新图
const deepClone = (value) => JSON.parse(JSON.stringify(value));

export const setAtPath = (graph, segments, value) => {
    const next = deepClone(graph);
    let cursor = next;
    segments.slice(0, -1).forEach((segment) => {
        cursor = cursor[segment];
    });
    cursor[segments[segments.length - 1]] = value;
    return next;
};

// 解析结果中的一个输入 -> 一份外部参数草稿
export const buildDraft = (input) => ({
    key: input.suggest_key || input.input_name.replace(/[^a-zA-Z0-9_]/g, '_'),
    label: input.suggest_label || input.input_name,
    type: input.inferred_type === 'unknown' ? 'string' : input.inferred_type,
    required: false,
    default: input.current_value,
    choices: input.choices,
    enum_source: input.enum_source,
    multiline: input.multiline,
    min: input.min,
    max: input.max,
    path: input.path,
});
