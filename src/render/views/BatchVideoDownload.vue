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
      <div class="action-row">
        <el-button
          type="primary"
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
  </div>
</template>
<script>
import {
    openDirectory,
    getVideoWorkspace,
    setVideoWorkspace,
    selectDirectory,
    downloadSmallVideoByLink,
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
        };
    },
    mounted() {
        this.initDownloadPath();
    },
    methods: {
        async initDownloadPath() {
            this.downloadPath = await getVideoWorkspace();
        },
        async selectDownloadDir() {
            const ret = await selectDirectory();
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
        download() {
            const originLinks = this.formObj.originLinks;
            if (!originLinks || !originLinks.trim()) {
                this.$message.warning('请先粘贴短视频分享链接');
                return;
            }
            if (!this.downloadPath) {
                this.$message.warning('请先选择短视频保存目录');
                return;
            }
            const list = originLinks.split('\n');
            this.videoInfos = [];
            this.errorMsgs = [];
            this.batchDownload(list);
        },
        openFile(filePath) {
            if (filePath) openDirectory(filePath);
        },
        openDir(fileDir) {
            if (fileDir) openDirectory(fileDir);
        },
        batchDownload(links) {
            const tasks = links.map((linkContent) => async () => {
                if (!linkContent || !linkContent.trim()) return;
                const link = this._getRealLink(linkContent);
                if (!link) {
                    this.errorMsgs.push(`无法从内容中解析链接: ${linkContent}`);
                    return;
                }
                try {
                    const videoInfo = await downloadSmallVideoByLink(link, { link });
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
.error-alert {
    margin-top: 16px;
}
.cover {
    width: 120px;
    height: 80px;
    display: block;
}
</style>
