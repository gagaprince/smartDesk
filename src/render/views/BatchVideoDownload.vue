<template>
  <div class="video-download">
    <el-card class="config-card">
      <template #header>
        <div class="card-header">
          <el-icon><FolderOpened /></el-icon>
          <span>下载目录配置</span>
        </div>
      </template>
      <el-form label-width="120px">
        <el-form-item label="短视频保存目录">
          <div class="dir-row">
            <el-input
              v-model="downloadPath"
              class="dir-input"
              placeholder="选择短视频下载保存目录"
            >
              <template #append>
                <el-icon
                  class="select-folder"
                  color="#fece65"
                  size="20"
                  @click="selectDownloadDir"
                >
                  <Folder />
                </el-icon>
              </template>
            </el-input>
            <el-button
              class="open-dir-btn"
              :disabled="!downloadPath"
              @click="openDownloadDir"
            >
              打开目录
            </el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="download-card">
      <template #header>
        <div class="card-header">
          <el-icon><VideoCamera /></el-icon>
          <span>短视频下载（支持抖音 / TikTok / 快手 / 小红书，每行一条分享链接）</span>
        </div>
      </template>
      <el-input
        v-model="formObj.originLinks"
        type="textarea"
        :rows="6"
        placeholder="请粘贴短视频分享链接，支持多行批量下载"
      />
      <div class="xhs-login-row">
        <span class="login-label">小红书主页批量：</span>
        <template v-if="xhsStatus.loggedIn">
          <el-tag type="success">
            已登录<template v-if="xhsStatus.nickname">
              ：{{ xhsStatus.nickname }}
            </template>
          </el-tag>
          <el-button
            link
            type="primary"
            size="small"
            @click="handleXhsLogout"
          >
            退出登录
          </el-button>
        </template>
        <el-button
          v-else
          type="primary"
          plain
          size="small"
          :loading="xhsLogging"
          @click="handleXhsLogin"
        >
          小红书扫码登录
        </el-button>
        <el-text
          type="info"
          size="small"
          class="login-tip"
        >
          仅个人主页批量解析需要登录，单条笔记链接无需登录
        </el-text>
      </div>
      <div class="xhs-limit-row">
        <el-checkbox v-model="recentLimitEnabled">
          仅下载最近
        </el-checkbox>
        <el-input-number
          v-model="recentLimitCount"
          class="limit-input"
          :min="1"
          :max="100"
          :disabled="!recentLimitEnabled"
          size="small"
          controls-position="right"
        />
        <el-text
          type="info"
          size="small"
          class="limit-tip"
        >
          条作品（勾选后跳过手动选择，抓够即停，每个主页分别生效）
        </el-text>
      </div>
      <div class="action-row">
        <el-button
          type="primary"
          :loading="profileLoading"
          @click="download"
        >
          开始下载
        </el-button>
        <el-button @click="openDownloadDir">
          打开下载目录
        </el-button>
      </div>
      <el-alert
        v-if="errorMsgs.length"
        class="error-alert"
        type="error"
        :closable="false"
        show-icon
      >
        <div
          v-for="(msg, index) in errorMsgs"
          :key="index"
        >
          {{ msg }}
        </div>
      </el-alert>
      <el-alert
        v-if="noticeMsgs.length"
        class="error-alert"
        type="warning"
        :closable="false"
        show-icon
      >
        <div
          v-for="(msg, index) in noticeMsgs"
          :key="index"
        >
          {{ msg }}
        </div>
      </el-alert>
    </el-card>

    <el-card class="result-card">
      <template #header>
        <div class="card-header">
          <span>下载结果（{{ videoInfos.length }} 条）</span>
        </div>
      </template>
      <el-empty
        v-if="!videoInfos.length"
        description="暂无下载记录"
      />
      <el-table
        v-else
        :data="videoInfos"
        style="width: 100%"
      >
        <el-table-column
          sortable
          prop="user"
          label="作者"
          width="180"
        />
        <el-table-column
          label="封面"
          width="160"
        >
          <template #default="scope">
            <el-image
              class="cover"
              :src="scope.row.cover"
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column
          prop="desc"
          label="描述"
          show-overflow-tooltip
        />
        <el-table-column
          prop="type"
          label="类型"
          width="100"
        >
          <template #default="scope">
            {{ typeLabel(scope.row.type) }}
          </template>
        </el-table-column>
        <el-table-column
          fixed="right"
          label="操作"
          width="200"
        >
          <template #default="scope">
            <el-button
              link
              type="primary"
              size="small"
              @click="openFile(scope.row.filePath)"
            >
              打开文件
            </el-button>
            <el-button
              link
              type="primary"
              size="small"
              @click="openDir(scope.row.fileDir)"
            >
              打开目录
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="batchDownloadFlag"
      title="批量下载进度"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <el-text type="primary">
        正在下载，请稍候...
      </el-text>
      <div style="margin-top: 20px">
        <TaskListComponent
          v-if="batchDownloadFlag"
          :tasks="batchTasks"
          @complete="batchDownloadComplete"
        />
      </div>
    </el-dialog>
    <el-dialog
      v-model="profileDialogVisible"
      :title="`小红书主页作品（共 ${profileNotes.length} 条，已选 ${profileSelected.length} 条）`"
      width="860px"
      :close-on-click-modal="false"
    >
      <div class="profile-toolbar">
        <el-button
          size="small"
          @click="selectAllProfileNotes"
        >
          全选
        </el-button>
        <el-button
          size="small"
          @click="clearProfileSelection"
        >
          清空选择
        </el-button>
        <el-text
          type="info"
          size="small"
        >
          来自 {{ profileUserText }}
        </el-text>
      </div>
      <el-table
        ref="profileTableRef"
        :data="profileNotes"
        height="420"
        style="width: 100%"
        @selection-change="handleProfileSelectionChange"
      >
        <el-table-column
          type="selection"
          width="48"
        />
        <el-table-column
          label="封面"
          width="120"
        >
          <template #default="scope">
            <el-image
              class="profile-cover"
              :src="scope.row.cover"
              fit="cover"
            />
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          label="标题"
          show-overflow-tooltip
        />
        <el-table-column
          label="类型"
          width="90"
        >
          <template #default="scope">
            {{ typeLabel(scope.row.type) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="likedCount"
          label="点赞"
          width="90"
        />
      </el-table>
      <template #footer>
        <el-button @click="cancelProfileDownload">
          取消
        </el-button>
        <el-button
          type="primary"
          :disabled="!profileSelected.length"
          @click="confirmProfileDownload"
        >
          下载选中的 {{ profileSelected.length }} 条
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
<script>
import {
    openDirectory,
    getVideoWorkspace,
    setVideoWorkspace,
    selectDirectory,
    downloadSmallVideoByLink,
    xhsLogin,
    getXhsLoginStatus,
    xhsLogout,
    xhsParseProfile,
} from '@/render/common/ipcUtil';
import TaskListComponent from '@/render/components/tasklist/index.vue';

export default {
    name: 'BatchVideoDownload',
    components: {
        TaskListComponent,
    },
    data() {
        return {
            formObj: {
                originLinks: '',
            },
            downloadPath: '',
            batchDownloadFlag: false,
            batchTasks: [],
            videoInfos: [],
            errorMsgs: [],
            noticeMsgs: [],
            xhsStatus: { loggedIn: false, nickname: '', userId: '' },
            xhsLogging: false,
            profileLoading: false,
            profileDialogVisible: false,
            profileNotes: [],
            profileSelected: [],
            profileUserText: '',
            pendingDownloadItems: [],
            recentLimitEnabled: false,
            recentLimitCount: 10,
        };
    },
    mounted() {
        this.initDownloadPath();
        this.refreshXhsLoginStatus();
    },
    methods: {
        async refreshXhsLoginStatus() {
            try {
                this.xhsStatus = await getXhsLoginStatus();
            } catch (err) {
                console.error('小红书登录状态获取失败:', err);
            }
        },
        async handleXhsLogin() {
            this.xhsLogging = true;
            try {
                const ret = await xhsLogin();
                if (ret && ret.loggedIn) {
                    this.$message.success('小红书登录成功');
                } else if (ret && ret.errorMsg) {
                    this.$message.info(ret.errorMsg);
                }
                await this.refreshXhsLoginStatus();
            } catch (err) {
                this.$message.error(`小红书登录异常: ${err.message || err}`);
            } finally {
                this.xhsLogging = false;
            }
        },
        async handleXhsLogout() {
            try {
                await xhsLogout();
                await this.refreshXhsLoginStatus();
                this.$message.success('已退出小红书登录');
            } catch (err) {
                this.$message.error(`退出登录异常: ${err.message || err}`);
            }
        },
        async initDownloadPath() {
            this.downloadPath = await getVideoWorkspace();
        },
        async selectDownloadDir() {
            const ret = await selectDirectory(this.downloadPath);
            if (ret && !ret.canceled && ret.filePaths && ret.filePaths[0]) {
                this.downloadPath = ret.filePaths[0];
                await setVideoWorkspace(this.downloadPath);
                this.$message.success('下载目录已保存');
            }
        },
        openDownloadDir() {
            if (this.downloadPath) {
                openDirectory(this.downloadPath);
            }
        },
        typeLabel(type) {
            const map = {
                video: '视频',
                note: '图文',
                livePhoto: '实况照片',
            };
            return map[type] || '视频';
        },
        _getRealLink(content) {
            const contentReg = new RegExp(/.*?([a-zA-z]+:\/\/[^\s]*)\s{0,}.*?/g);
            const ret = contentReg.exec(content);
            if (ret && ret.length > 1) {
                return ret[1];
            }
            return '';
        },
        _isXhsLink(link) {
            return link.indexOf('xhslink') !== -1 || link.indexOf('xiaohongshu.com') !== -1;
        },
        async download() {
            const originLinks = this.formObj.originLinks;
            if (!originLinks || !originLinks.trim()) {
                this.$message.warning('请先粘贴短视频分享链接');
                return;
            }
            if (!this.downloadPath) {
                this.$message.warning('请先选择短视频保存目录');
                return;
            }
            const lines = originLinks.split('\n');
            this.videoInfos = [];
            this.errorMsgs = [];
            this.noticeMsgs = [];
            const normalItems = [];
            const profileNotesMap = new Map();
            const profileUsers = [];
            const recentLimit = this.recentLimitEnabled ? Number(this.recentLimitCount) || 10 : 0;
            const parseOptions = recentLimit > 0 ? { limit: recentLimit } : undefined;
            this.profileLoading = true;
            try {
                for (const line of lines) {
                    if (line && line.trim()) {
                        const link = this._getRealLink(line);
                        if (!link) {
                            this.errorMsgs.push(`无法从内容中解析链接: ${line}`);
                        } else if (this._isXhsLink(link)) {
                            const ret = await xhsParseProfile(link, parseOptions);
                            if (ret && ret.isProfile) {
                                if (ret.notice && !this.noticeMsgs.includes(ret.notice)) {
                                    this.noticeMsgs.push(ret.notice);
                                }
                                if (ret.user && ret.user.nickname && !profileUsers.includes(ret.user.nickname)) {
                                    profileUsers.push(ret.user.nickname);
                                }
                                (ret.notes || []).forEach((note) => {
                                    if (!profileNotesMap.has(note.noteId)) {
                                        profileNotesMap.set(note.noteId, {
                                            ...note,
                                            user: (ret.user && ret.user.nickname) || '',
                                            profileUrl: ret.profileUrl,
                                        });
                                    }
                                });
                            } else if (ret && ret.errorMsg) {
                                this.errorMsgs.push(ret.errorMsg);
                            } else {
                                normalItems.push({ link: (ret && ret.realLink) || link, options: { link } });
                            }
                        } else {
                            normalItems.push({ link, options: { link } });
                        }
                    }
                }
            } finally {
                this.profileLoading = false;
            }
            const profileNotes = Array.from(profileNotesMap.values());
            if (profileNotes.length && recentLimit > 0) {
                const items = [...normalItems];
                profileNotes.forEach((note) => items.push(this.buildProfileDownloadItem(note)));
                this.batchDownload(items);
            } else if (profileNotes.length) {
                this.profileUserText = profileUsers.join('、');
                this.profileNotes = profileNotes;
                this.profileSelected = [];
                this.pendingDownloadItems = normalItems;
                this.profileDialogVisible = true;
            } else {
                this.batchDownload(normalItems);
            }
        },
        buildProfileDownloadItem(note) {
            return {
                link: note.noteUrl,
                options: {
                    link: note.noteUrl,
                    xhsWindowParse: true,
                    noteId: note.noteId,
                    xsecToken: note.xsecToken,
                    profileUrl: note.profileUrl,
                    noteUrl: note.noteUrl,
                },
            };
        },
        handleProfileSelectionChange(rows) {
            this.profileSelected = rows;
        },
        selectAllProfileNotes() {
            this.$refs.profileTableRef.toggleAllSelection();
        },
        clearProfileSelection() {
            this.$refs.profileTableRef.clearSelection();
        },
        confirmProfileDownload() {
            this.profileDialogVisible = false;
            const items = [...this.pendingDownloadItems];
            this.profileSelected.forEach((note) => items.push(this.buildProfileDownloadItem(note)));
            this.pendingDownloadItems = [];
            this.batchDownload(items);
        },
        cancelProfileDownload() {
            this.profileDialogVisible = false;
            const items = this.pendingDownloadItems;
            this.pendingDownloadItems = [];
            if (items.length) this.batchDownload(items);
        },
        openFile(filePath) {
            if (filePath) openDirectory(filePath);
        },
        openDir(fileDir) {
            if (fileDir) openDirectory(fileDir);
        },
        batchDownload(items) {
            if (!items || !items.length) {
                this.$message.warning('没有可下载的任务，请检查链接或登录状态');
                return;
            }
            const tasks = items.map((item) => async () => {
                const { link, options = {} } = item;
                if (!link) return;
                try {
                    const videoInfo = await downloadSmallVideoByLink(link, options);
                    if (videoInfo && (videoInfo.videoUrl
                        || (videoInfo.images && videoInfo.images.length))) {
                        this.videoInfos.push(videoInfo);
                    } else if (videoInfo && videoInfo.errorMsg) {
                        this.errorMsgs.push(videoInfo.errorMsg);
                    } else {
                        this.errorMsgs.push(`解析失败: ${link}`);
                    }
                } catch (err) {
                    this.errorMsgs.push(`下载异常: ${err.message || err}`);
                }
            });
            this.batchTasks = tasks;
            this.batchDownloadFlag = true;
        },
        batchDownloadComplete() {
            this.batchDownloadFlag = false;
            this.batchTasks = [];
            if (!this.videoInfos.length) {
                this.$message({
                    message: this.errorMsgs[0] || '下载失败，请稍后重试',
                    type: 'error',
                });
            } else if (this.errorMsgs.length) {
                this.$message({
                    message: `完成 ${this.videoInfos.length} 条，${this.errorMsgs.length} 条失败`,
                    type: 'warning',
                });
            } else {
                this.$message({
                    message: '全部下载完毕',
                    type: 'success',
                });
            }
        },
    },
};
</script>
<style lang="scss" scoped>
.config-card,
.download-card,
.result-card {
    margin-bottom: 16px;
}
.card-header {
    display: flex;
    align-items: center;
    gap: 8px;
}
.select-folder {
    cursor: pointer;
}
.dir-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 12px;
    width: 100%;
}
.dir-input {
    flex: 1;
    min-width: 0;
}
.open-dir-btn {
    flex-shrink: 0;
}
.action-row {
    margin-top: 16px;
    text-align: center;
}
.xhs-login-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}
.login-label {
    color: #606266;
    font-size: 14px;
}
.login-tip {
    flex-basis: 100%;
}
.xhs-limit-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.limit-input {
    width: 120px;
}
.limit-tip {
    flex-basis: 100%;
}
.error-alert {
    margin-top: 16px;
}
.cover {
    width: 120px;
    height: 80px;
    display: block;
}
.profile-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}
.profile-cover {
    width: 80px;
    height: 100px;
    display: block;
}
</style>
