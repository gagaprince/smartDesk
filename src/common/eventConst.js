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
    // 一键裁切头像（Python headcut 子项目）
    HEAD_CUT: 'head_cut',
    HEAD_CUT_STOP: 'head_cut_stop',
    HEAD_CUT_LIST_FILES: 'head_cut_list_files',
    HEAD_CUT_READ_IMAGE: 'head_cut_read_image',
    HEAD_CUT_DELETE_FILE: 'head_cut_delete_file',
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
};

export const RenderReceiveEvents = {
    PING: 'render_ping',
    PONG: 'render_pong',
    HEAD_CUT_PROGRESS: 'head_cut_progress',
};
