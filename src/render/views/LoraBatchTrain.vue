<template>
  <div class="lora-batch-page">
    <el-card class="section-card">
      <template #header>
        <div class="card-header">
          <el-icon><FolderOpened /></el-icon>
          <span>目录配置</span>
        </div>
      </template>
      <el-form label-width="150px">
        <el-form-item label="批量训练工作区">
          <div class="dir-row">
            <el-input
              v-model="config.workspaceDir"
              class="dir-input"
              placeholder="任务素材与数据集的根目录"
            >
              <template #append>
                <el-icon
                  class="select-folder"
                  color="#fece65"
                  size="20"
                  @click="selectWorkspace"
                >
                  <Folder />
                </el-icon>
              </template>
            </el-input>
            <el-button
              :disabled="!config.workspaceDir"
              @click="openDir(config.workspaceDir)"
            >
              打开目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="LoRA 导出目录">
          <div class="dir-row">
            <el-input
              v-model="config.loraExportDir"
              class="dir-input"
              placeholder="训练完成后模型复制到的 ComfyUI loras 目录"
            >
              <template #append>
                <el-icon
                  class="select-folder"
                  color="#fece65"
                  size="20"
                  @click="selectExportDir"
                >
                  <Folder />
                </el-icon>
              </template>
            </el-input>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="section-card">
      <template #header>
        <div class="card-header">
          <el-icon><Histogram /></el-icon>
          <span>新建训练任务（小红书主页 → 无人值守全流程）</span>
        </div>
      </template>
      <div class="xhs-login-row">
        <span class="login-label">小红书登录：</span>
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
        >
          主页解析需要登录态，与短视频下载页共用
        </el-text>
      </div>
      <el-input
        v-model="form.profileUrlText"
        type="textarea"
        :rows="3"
        placeholder="粘贴小红书主页分享文案或链接，例如：https://xhslink.cn/o/xxxx"
      />
      <div class="project-row">
        <span class="login-label">项目名：</span>
        <el-input
          v-model="form.projectName"
          class="project-input"
          placeholder="留空自动命名，仅支持英文数字下划线短横线"
        />
        <el-button
          size="small"
          @click="fillSuggestName"
        >
          自动命名
        </el-button>
        <span class="login-label">触发词固定：</span>
        <el-tag>gaga</el-tag>
      </div>
      <div class="params-row">
        <el-tag
          v-for="item in paramTags"
          :key="item"
          size="small"
          type="info"
        >
          {{ item }}
        </el-tag>
      </div>
      <div class="action-row">
        <el-button
          type="primary"
          :loading="creating"
          @click="createJob"
        >
          创建并开始
        </el-button>
        <el-text
          type="info"
          size="small"
        >
          流程：下载 15 个作品 → 抽帧头部裁切（20~40 张）→ 人工确认素材 → 打标 → 预缓存 → 训练 1200 步 → 导出 → 自动生图预览打标
        </el-text>
      </div>
    </el-card>

    <el-card class="section-card">
      <template #header>
        <div class="card-header">
          <span>任务队列（{{ jobs.length }}）</span>
          <el-button
            size="small"
            @click="loadJobs"
          >
            刷新
          </el-button>
        </div>
      </template>
      <el-empty
        v-if="!jobs.length"
        description="暂无训练任务"
      />
      <el-table
        v-else
        :data="jobs"
        style="width: 100%"
      >
        <el-table-column
          prop="projectName"
          label="项目 / 人物"
          min-width="160"
        >
          <template #default="scope">
            <div class="job-name">
              {{ scope.row.projectName }}
            </div>
            <div class="job-nickname">
              {{ scope.row.nickname || '未解析' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="阶段"
          width="110"
        >
          <template #default="scope">
            {{ scope.row.status === 'awaiting_confirm' ? '待确认' : (stageLabel(scope.row.stage) || '排队中') }}
          </template>
        </el-table-column>
        <el-table-column
          label="进度"
          min-width="170"
        >
          <template #default="scope">
            <el-progress
              :percentage="currentPercent(scope.row)"
              :status="progressStatus(scope.row)"
            />
            <div class="stage-message">
              {{ currentMessage(scope.row) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="状态"
          width="100"
        >
          <template #default="scope">
            <el-tag :type="statusType(scope.row.status)">
              {{ statusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="素材"
          width="90"
        >
          <template #default="scope">
            {{ scope.row.stats.datasetCount || '-' }} 张
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="360"
        >
          <template #default="scope">
            <el-button
              link
              type="primary"
              size="small"
              @click="openDetail(scope.row)"
            >
              详情
            </el-button>
            <el-button
              v-if="scope.row.status === 'awaiting_confirm'"
              link
              type="success"
              size="small"
              @click="confirmJob(scope.row)"
            >
              确认继续
            </el-button>
            <el-button
              v-if="scope.row.status === 'awaiting_confirm'"
              link
              type="warning"
              size="small"
              @click="recropJob(scope.row)"
            >
              重新裁切
            </el-button>
            <el-button
              v-if="scope.row.status === 'running' || scope.row.status === 'queued'"
              link
              type="warning"
              size="small"
              @click="stopJob(scope.row)"
            >
              停止
            </el-button>
            <el-button
              v-if="scope.row.status === 'failed' || scope.row.status === 'stopped'"
              link
              type="primary"
              size="small"
              @click="retryJob(scope.row)"
            >
              重试
            </el-button>
            <el-button
              link
              type="danger"
              size="small"
              :disabled="scope.row.status === 'running' || scope.row.status === 'queued'"
              @click="removeJob(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer
      v-model="detailVisible"
      title="任务详情"
      size="560px"
    >
      <template v-if="detailJob">
        <el-alert
          v-if="detailJob.status === 'awaiting_confirm'"
          class="detail-alert"
          type="warning"
          :closable="false"
          show-icon
          title="素材待人工确认"
        >
          <div class="confirm-tip">
            请检查下方裁切素材，可删除糊图/废图，确认合格后再继续打标与训练（素材下限 {{ detailJob.params.minImages }} 张）。
          </div>
          <div class="confirm-actions">
            <el-button
              type="success"
              size="small"
              @click="confirmJob(detailJob)"
            >
              确认素材合格，继续训练
            </el-button>
            <el-button
              type="warning"
              size="small"
              @click="recropJob(detailJob)"
            >
              重新裁切
            </el-button>
          </div>
        </el-alert>
        <el-alert
          v-if="detailJob.error"
          class="detail-alert"
          type="error"
          :closable="false"
          show-icon
        >
          {{ detailJob.error }}
        </el-alert>
        <el-descriptions
          :column="1"
          border
          size="small"
          class="detail-desc"
        >
          <el-descriptions-item label="项目名">
            {{ detailJob.projectName }}
          </el-descriptions-item>
          <el-descriptions-item label="小红书人物">
            {{ detailJob.nickname || '未解析' }}
          </el-descriptions-item>
          <el-descriptions-item label="任务目录">
            <el-button
              link
              type="primary"
              @click="openDir(detailJob.paths.jobDir)"
            >
              打开
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="下载素材">
            视频 {{ detailJob.stats.rawVideos }} 个 / 图片 {{ detailJob.stats.rawImages }} 张（失败 {{ detailJob.stats.failedDownloads }} 个作品）
          </el-descriptions-item>
          <el-descriptions-item label="训练素材">
            {{ detailJob.stats.datasetCount }} 张
            <template v-if="detailJob.stats.trimmed">
              （已精简 {{ detailJob.stats.trimmed }} 张）
            </template>
          </el-descriptions-item>
          <el-descriptions-item label="训练进度">
            {{ detailJob.stats.trainStep }}/{{ detailJob.stats.trainTotal }} 步
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailJob.paths.exportFile"
            label="导出模型"
          >
            <el-button
              link
              type="primary"
              @click="openDir(config.loraExportDir)"
            >
              {{ baseName(detailJob.paths.exportFile) }}
            </el-button>
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="detail-title">
          阶段时间线
        </h4>
        <el-timeline class="stage-timeline">
          <el-timeline-item
            v-for="meta in stageMeta"
            :key="meta.key"
            :type="timelineType(detailJob.stageStatus[meta.key].status)"
            :timestamp="detailJob.stageStatus[meta.key].message || ''"
          >
            {{ meta.label }}
            <el-tag
              size="small"
              :type="statusType(detailJob.stageStatus[meta.key].status)"
              class="stage-tag"
            >
              {{ statusLabel(detailJob.stageStatus[meta.key].status) }}
            </el-tag>
          </el-timeline-item>
        </el-timeline>

        <h4 class="detail-title">
          训练素材（{{ datasetImages.length }}）
          <el-button
            link
            type="primary"
            size="small"
            :loading="datasetLoading"
            @click="loadDataset"
          >
            刷新
          </el-button>
        </h4>
        <div class="dataset-grid">
          <div
            v-for="img in datasetImages"
            :key="img.path"
            class="dataset-cell"
          >
            <el-image
              :src="img.thumb"
              fit="cover"
              class="dataset-thumb"
            />
            <el-button
              class="dataset-delete"
              type="danger"
              size="small"
              circle
              @click="deleteDatasetImage(img)"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          <el-text
            v-if="!datasetLoading && !datasetImages.length"
            type="info"
            size="small"
          >
            裁切完成后可在此查看
          </el-text>
        </div>

        <h4 class="detail-title">
          运行日志
        </h4>
        <div class="log-box">
          <div
            v-for="(line, index) in detailJob.logs"
            :key="index"
            class="log-line"
          >
            <span class="log-time">{{ formatTime(line.time) }}</span>
            <span class="log-stage">[{{ stageLabel(line.stage) || line.stage }}]</span>
            <span>{{ line.message }}</span>
          </div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import {
    selectDirectory,
    getXhsLoginStatus,
    xhsLogin,
    xhsLogout,
    getLoraBatchConfig,
    setLoraBatchConfig,
    listLoraBatchJobs,
    createLoraBatchJob,
    stopLoraBatchJob,
    retryLoraBatchJob,
    removeLoraBatchJob,
    confirmLoraBatchJob,
    recropLoraBatchJob,
    openLoraBatchDir,
    listSmartCutImages,
    deleteSmartCutFile,
} from '@/render/common/ipcUtil';
import { RenderReceiveEvents } from '@/common/eventConst';

const stageMeta = [
    { key: 'download', label: '素材下载' },
    { key: 'crop', label: '智能裁切' },
    { key: 'caption', label: '提示词打标' },
    { key: 'precache', label: '预缓存' },
    { key: 'train', label: '模型训练' },
    { key: 'export', label: '导出模型' },
    { key: 'preview', label: '预览生图' },
];

export default {
    name: 'LoraBatchTrain',
    data() {
        return {
            stageMeta,
            config: { workspaceDir: '', loraExportDir: '' },
            xhsStatus: { loggedIn: false, nickname: '' },
            xhsLogging: false,
            form: { profileUrlText: '', projectName: '' },
            creating: false,
            jobs: [],
            pollTimer: null,
            detailVisible: false,
            detailJobId: '',
            datasetImages: [],
            datasetLoading: false,
            paramTags: [
                '下载作品 15 个',
                '视频抽帧 3 张',
                '素材 20~40 张',
                '训练 1200 步',
                'rank32 / alpha16',
            ],
        };
    },
    computed: {
        detailJob() {
            return this.jobs.find((job) => job.id === this.detailJobId) || null;
        },
    },
    mounted() {
        this.loadConfig();
        this.loadJobs();
        this.refreshXhsLoginStatus();
        window.ipcRenderer.on(RenderReceiveEvents.LORA_BATCH_PROGRESS, this.onProgress);
    },
    activated() {
        // keep-alive 缓存下切回标签时主动重连状态, 避免推送事件丢失导致界面停在旧阶段
        this.loadJobs();
        this.syncPolling();
    },
    deactivated() {
        this.stopPolling();
    },
    beforeUnmount() {
        this.stopPolling();
        window.ipcRenderer.removeListener(
            RenderReceiveEvents.LORA_BATCH_PROGRESS,
            this.onProgress,
        );
    },
    methods: {
        async loadConfig() {
            try {
                this.config = await getLoraBatchConfig();
            } catch (err) {
                this.$message.error(`配置加载失败：${err.message || err}`);
            }
        },
        async selectWorkspace() {
            const ret = await selectDirectory(this.config.workspaceDir);
            if (ret && !ret.canceled && ret.filePaths && ret.filePaths[0]) {
                this.config.workspaceDir = ret.filePaths[0];
                await setLoraBatchConfig({ workspaceDir: this.config.workspaceDir });
                this.$message.success('工作区目录已保存');
            }
        },
        async selectExportDir() {
            const ret = await selectDirectory(this.config.loraExportDir);
            if (ret && !ret.canceled && ret.filePaths && ret.filePaths[0]) {
                this.config.loraExportDir = ret.filePaths[0];
                await setLoraBatchConfig({ loraExportDir: this.config.loraExportDir });
                this.$message.success('LoRA 导出目录已保存');
            }
        },
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
                this.$message.error(`登录异常: ${err.message || err}`);
            } finally {
                this.xhsLogging = false;
            }
        },
        async handleXhsLogout() {
            await xhsLogout();
            await this.refreshXhsLoginStatus();
            this.$message.success('已退出小红书登录');
        },
        fillSuggestName() {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            this.form.projectName = `face_${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        },
        async createJob() {
            if (!this.form.profileUrlText.trim()) {
                this.$message.warning('请先粘贴小红书主页链接');
                return;
            }
            this.creating = true;
            try {
                const job = await createLoraBatchJob({
                    profileUrlText: this.form.profileUrlText,
                    projectName: this.form.projectName,
                });
                this.$message.success(`任务 ${job.projectName} 已创建并开始`);
                this.form.profileUrlText = '';
                this.form.projectName = '';
                await this.loadJobs();
            } catch (err) {
                this.$message.error(`创建失败：${err.message || err}`);
            } finally {
                this.creating = false;
            }
        },
        async loadJobs() {
            try {
                this.jobs = await listLoraBatchJobs();
            } catch (err) {
                this.$message.error(`任务列表加载失败：${err.message || err}`);
            }
            this.syncPolling();
        },
        syncPolling() {
            const hasActive = this.jobs.some(
                (job) => job.status === 'queued' || job.status === 'running',
            );
            if (hasActive && !this.pollTimer) {
                this.pollTimer = setInterval(() => this.loadJobs(), 5000);
            } else if (!hasActive) {
                this.stopPolling();
            }
        },
        stopPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },
        onProgress(payload) {
            if (payload.type === 'remove') {
                this.jobs = this.jobs.filter((job) => job.id !== payload.jobId);
                this.syncPolling();
                return;
            }
            if (!payload.job) return;
            const index = this.jobs.findIndex((job) => job.id === payload.jobId);
            if (index === -1) {
                this.jobs.unshift(payload.job);
            } else {
                this.jobs.splice(index, 1, payload.job);
            }
            this.syncPolling();
        },
        async stopJob(job) {
            try {
                await stopLoraBatchJob(job.id);
                this.$message.success('已请求停止任务');
            } catch (err) {
                this.$message.error(err.message || err);
            }
        },
        async retryJob(job) {
            try {
                await retryLoraBatchJob(job.id);
                this.$message.success('任务已重新入队，将从断点阶段继续');
                await this.loadJobs();
            } catch (err) {
                this.$message.error(err.message || err);
            }
        },
        async confirmJob(job) {
            try {
                await this.$confirm('确认当前裁切素材合格，继续打标与训练？', '人工确认', {
                    type: 'warning',
                    confirmButtonText: '确认继续',
                });
                await confirmLoraBatchJob(job.id);
                this.$message.success('已确认，任务继续执行');
                await this.loadJobs();
            } catch (err) {
                if (err !== 'cancel') this.$message.error(err.message || err);
            }
        },
        async recropJob(job) {
            try {
                await this.$confirm('将清空当前裁切素材并从智能裁切阶段重新执行，下载的原始素材保留。确认重新裁切？', '重新裁切', {
                    type: 'warning',
                    confirmButtonText: '重新裁切',
                });
                await recropLoraBatchJob(job.id);
                this.$message.success('已重新入队，将重新裁切');
                this.datasetImages = [];
                await this.loadJobs();
            } catch (err) {
                if (err !== 'cancel') this.$message.error(err.message || err);
            }
        },
        async removeJob(job) {
            try {
                await this.$confirm(`删除任务记录 ${job.projectName}？磁盘上的素材文件不会被删除`, '确认', {
                    type: 'warning',
                });
                await removeLoraBatchJob(job.id);
                if (this.detailJobId === job.id) {
                    this.detailVisible = false;
                    this.detailJobId = '';
                }
                await this.loadJobs();
            } catch (err) {
                if (err !== 'cancel') this.$message.error(err.message || err);
            }
        },
        async openDetail(job) {
            this.detailJobId = job.id;
            this.detailVisible = true;
            this.datasetImages = [];
            await this.loadDataset();
        },
        async loadDataset() {
            if (!this.detailJob || !this.detailJob.paths.datasetDir) return;
            this.datasetLoading = true;
            try {
                const ret = await listSmartCutImages(this.detailJob.paths.datasetDir);
                this.datasetImages = (ret && ret.images) || [];
            } catch (err) {
                this.$message.error(`素材读取失败：${err.message || err}`);
            } finally {
                this.datasetLoading = false;
            }
        },
        async deleteDatasetImage(img) {
            try {
                await this.$confirm(`删除素材 ${img.name}？`, '确认', { type: 'warning' });
                await deleteSmartCutFile(img.path, this.detailJob.paths.datasetDir);
                this.$message.success('已删除');
                await this.loadDataset();
                await this.loadJobs();
                if (this.detailJob) {
                    this.detailJob.stats.datasetCount = this.datasetImages.length;
                }
            } catch (err) {
                if (err !== 'cancel') this.$message.error(err.message || err);
            }
        },
        async openDir(dir) {
            if (!dir) return;
            try {
                const ret = await openLoraBatchDir(dir);
                if (ret && !ret.success) {
                    this.$message.error(`打开目录失败：${ret.error || '未知错误'}`);
                }
            } catch (err) {
                this.$message.error(`打开目录失败：${err.message || err}`);
            }
        },
        baseName(filePath) {
            return filePath.split(/[\\/]/).pop();
        },
        stageLabel(key) {
            const meta = this.stageMeta.find((item) => item.key === key);
            return meta ? meta.label : '';
        },
        currentPercent(job) {
            if (job.status === 'done') return 100;
            if (!job.stage || !job.stageStatus[job.stage]) return 0;
            return job.stageStatus[job.stage].percent || 0;
        },
        currentMessage(job) {
            if (job.status === 'done') return '全部完成';
            if (job.status === 'awaiting_confirm') return '裁切完成，等待人工确认素材';
            if (!job.stage || !job.stageStatus[job.stage]) return job.error || '排队等待中';
            return job.stageStatus[job.stage].message || '';
        },
        progressStatus(job) {
            if (job.status === 'done') return 'success';
            if (job.status === 'failed') return 'exception';
            if (job.status === 'stopped' || job.status === 'awaiting_confirm') return 'warning';
            return undefined;
        },
        timelineType(stageStatus) {
            const map = {
                done: 'success',
                running: 'primary',
                failed: 'danger',
                stopped: 'warning',
                pending: 'info',
            };
            return map[stageStatus] || 'info';
        },
        statusType(status) {
            const map = {
                queued: 'info',
                running: 'primary',
                done: 'success',
                failed: 'danger',
                stopped: 'warning',
                awaiting_confirm: 'warning',
                pending: 'info',
            };
            return map[status] || 'info';
        },
        statusLabel(status) {
            const map = {
                queued: '排队中',
                running: '进行中',
                done: '已完成',
                failed: '失败',
                stopped: '已停止',
                awaiting_confirm: '待确认',
                pending: '待执行',
            };
            return map[status] || status;
        },
        formatTime(ts) {
            const d = new Date(ts);
            const pad = (n) => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
    },
};
</script>

<style lang="scss" scoped>
.lora-batch-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-card {
  margin: 0;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dir-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.dir-input {
  flex: 1;
  min-width: 0;
}
.select-folder {
  cursor: pointer;
}
.xhs-login-row,
.project-row,
.params-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.login-label {
  color: #606266;
  font-size: 14px;
}
.project-input {
  width: 280px;
}
.params-row {
  margin-top: 4px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.job-name {
  font-weight: 600;
}
.job-nickname {
  color: #909399;
  font-size: 12px;
}
.stage-message {
  color: #909399;
  font-size: 12px;
  margin-top: 2px;
}
.detail-alert,
.detail-desc {
  margin-bottom: 16px;
}
.confirm-tip {
  margin-bottom: 10px;
}
.confirm-actions {
  display: flex;
  gap: 10px;
}
.detail-title {
  margin: 16px 0 12px;
  font-size: 15px;
}
.stage-tag {
  margin-left: 8px;
}
.dataset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.dataset-cell {
  position: relative;
  width: 96px;
  height: 96px;
}
.dataset-thumb {
  width: 96px;
  height: 96px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
.dataset-delete {
  position: absolute;
  top: 2px;
  right: 2px;
  padding: 2px;
}
.log-box {
  max-height: 320px;
  overflow: auto;
  background: #1e1e1e;
  border-radius: 6px;
  padding: 10px 12px;
}
.log-line {
  color: #d4d4d4;
  font-size: 12px;
  line-height: 1.8;
  word-break: break-all;
}
.log-time {
  color: #858585;
  margin-right: 6px;
}
.log-stage {
  color: #4ec9b0;
  margin-right: 6px;
}
</style>
