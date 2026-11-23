export const Event = {
    TEST: 'test',
};

export const HandleEvents = {
    TEST: 'test',
    OPEN_DEV_TOOLS: 'open_dev_tools',
    // 目录选择与打开
    SELECT_DIR: 'select_dir',
    OPEN_DIR: 'open_dir',
    // 短视频下载目录配置（配置入口在功能页内）
    GET_VIDEO_WORKSPACE: 'get_video_workspace',
    SET_VIDEO_WORKSPACE: 'set_video_workspace',
    // 短视频解析与下载
    GET_VIDEO_INFO: 'get_video_info',
    DOWNLOAD_SMALL_VIDEO: 'download_small_video',
    // 小红书网页版登录态（个人主页批量解析前置）
    XHS_LOGIN: 'xhs_login',
    XHS_LOGIN_STATUS: 'xhs_login_status',
    XHS_LOGOUT: 'xhs_logout',
    XHS_PARSE_PROFILE: 'xhs_parse_profile',
    // 一键裁切头像（Python headcut 子项目）
    HEAD_CUT: 'head_cut',
    HEAD_CUT_STOP: 'head_cut_stop',
    HEAD_CUT_LIST_FILES: 'head_cut_list_files',
    HEAD_CUT_READ_IMAGE: 'head_cut_read_image',
    HEAD_CUT_DELETE_FILE: 'head_cut_delete_file',
    // 一键智能裁切（图片/视频 + 多部位, Python headcut.smartcut_cli）
    SMART_CUT: 'smart_cut',
    SMART_CUT_STOP: 'smart_cut_stop',
    SMART_CUT_LIST_FILES: 'smart_cut_list_files',
    SMART_CUT_READ_IMAGE: 'smart_cut_read_image',
    SMART_CUT_DELETE_FILE: 'smart_cut_delete_file',
    // 生产工具: comfyui-ctrl FastAPI 子服务
    GET_COMFYUI_BASE: 'get_comfyui_base',
    GET_COMFYUI_HEALTH: 'get_comfyui_health',
    // 工作台: 显卡状态与本地服务启停管理
    GET_DASHBOARD_OVERVIEW: 'get_dashboard_overview',
    START_SERVICE: 'start_service',
    STOP_SERVICE: 'stop_service',
    RELEASE_VRAM: 'release_vram',
    OPEN_SERVICE_HOME: 'open_service_home',
    // Ollama 本地模型清单（文档页展示用, 主进程代理避免渲染层跨域限制）
    GET_OLLAMA_MODELS: 'get_ollama_models',
    // 局域网 HTTP 服务（Ollama 聊天测试页 + 显存清理接口）
    GET_LAN_SERVER_STATUS: 'get_lan_server_status',
    START_LAN_SERVER: 'start_lan_server',
    STOP_LAN_SERVER: 'stop_lan_server',
    // LoRA 批量训练（小红书主页 -> 素材 -> 裁切 -> 训练 -> 导出 -> 预览）
    LORA_BATCH_GET_CONFIG: 'lora_batch_get_config',
    LORA_BATCH_SET_CONFIG: 'lora_batch_set_config',
    LORA_BATCH_LIST_JOBS: 'lora_batch_list_jobs',
    LORA_BATCH_CREATE_JOB: 'lora_batch_create_job',
    LORA_BATCH_STOP_JOB: 'lora_batch_stop_job',
    LORA_BATCH_RETRY_JOB: 'lora_batch_retry_job',
    LORA_BATCH_REMOVE_JOB: 'lora_batch_remove_job',
    LORA_BATCH_OPEN_DIR: 'lora_batch_open_dir',
    LORA_BATCH_CONFIRM_JOB: 'lora_batch_confirm_job',
    LORA_BATCH_RECROP_JOB: 'lora_batch_recrop_job',
};

export const RenderReceiveEvents = {
    PING: 'render_ping',
    PONG: 'render_pong',
    HEAD_CUT_PROGRESS: 'head_cut_progress',
    SMART_CUT_PROGRESS: 'smart_cut_progress',
    LORA_BATCH_PROGRESS: 'lora_batch_progress',
};
