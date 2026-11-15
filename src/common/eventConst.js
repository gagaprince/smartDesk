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
};

export const RenderReceiveEvents = {
    PING: 'render_ping',
    PONG: 'render_pong',
    HEAD_CUT_PROGRESS: 'head_cut_progress',
};
