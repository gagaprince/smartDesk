<template>
  <div class="dashboard">
    <el-card class="toolbar-card">
      <div class="toolbar">
        <div class="toolbar-title">
          <el-icon><Monitor /></el-icon>
          <span>工作台</span>
          <el-text
            v-if="overview"
            type="info"
            size="small"
          >
            最近刷新：{{ formatTime(overview.updatedAt) }}
          </el-text>
        </div>
        <div class="toolbar-actions">
          <el-tooltip content="开启后每 5 秒自动刷新状态">
            <el-switch
              v-model="autoRefresh"
              active-text="自动刷新"
              inline-prompt
              style="margin-right: 12px;"
            />
          </el-tooltip>
          <el-button
            type="primary"
            :loading="loading"
            @click="fetchOverview"
          >
            <el-icon><Refresh /></el-icon>
            <span>立即刷新</span>
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card class="gpu-card">
      <template #header>
        <div class="card-header gpu-card-header">
          <div class="card-header">
            <el-icon><Cpu /></el-icon>
            <span>显卡状态</span>
          </div>
          <el-tooltip
            content="卸载 Ollama 驻留模型并通知 ComfyUI 释放模型与缓存，服务进程保持运行"
            placement="top"
          >
            <el-button
              type="warning"
              size="small"
              :loading="releasing"
              :disabled="!gpu.available"
              @click="onReleaseVram"
            >
              <el-icon v-if="!releasing"><Brush /></el-icon>
              <span>{{ releasing ? '清理中…' : '清理显存' }}</span>
            </el-button>
          </el-tooltip>
        </div>
      </template>
      <el-alert
        v-if="overview && !gpu.available"
        class="gpu-missing"
        type="error"
        :closable="false"
        show-icon
      >
        <template #title>
          <span class="gpu-missing-title">显卡未挂载</span>
        </template>
        <div class="gpu-missing-desc">
          {{ gpu.error || '未检测到 NVIDIA 显卡' }}
        </div>
        <div class="gpu-missing-hint">
          请检查外置显卡供电、雷电 / OCuLink 连接与驱动状态，挂载成功后本提示会自动消失
        </div>
      </el-alert>
      <div
        v-else-if="overview"
        class="gpu-body"
      >
        <div class="gpu-gauge">
          <el-progress
            type="dashboard"
            :percentage="totals.usedPercent"
            :width="180"
            :color="gaugeColor"
          >
            <template #default="{ percentage }">
              <div class="gauge-inner">
                <div class="gauge-percent">
                  {{ percentage }}%
                </div>
                <div class="gauge-label">
                  显存占用
                </div>
              </div>
            </template>
          </el-progress>
        </div>
        <div class="gpu-meta">
          <div
            v-for="item in gpu.gpus"
            :key="item.name"
            class="gpu-name-row"
          >
            <el-tag
              type="success"
              size="small"
            >
              已挂载
            </el-tag>
            <span class="gpu-name">{{ item.name }}</span>
          </div>
          <div class="vram-line">
            显存占用：<b>{{ formatGiB(totals.usedMiB) }}</b>
            / {{ formatGiB(totals.totalMiB) }}（{{ totals.usedPercent }}%）
          </div>
          <el-text
            type="info"
            size="small"
          >
            剩余可用 {{ formatGiB(totals.freeMiB) }}
          </el-text>
        </div>
      </div>
      <el-skeleton
        v-else
        :rows="3"
        animated
      />
      <div
        v-if="lastRelease"
        class="vram-release-result"
      >
        <el-alert
          :type="lastRelease.success ? 'success' : 'error'"
          :closable="false"
          :title="lastRelease.message"
          show-icon
        />
        <div class="release-steps">
          <div
            v-for="step in lastRelease.steps"
            :key="step.service"
            class="release-step"
          >
            <el-tag
              size="small"
              :type="stepTagType(step)"
            >
              {{ stepLabel(step) }}
            </el-tag>
            <span>{{ step.message }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <el-card class="service-card">
      <template #header>
        <div class="card-header">
          <el-icon><SwitchButton /></el-icon>
          <span>常用软件启停管理</span>
        </div>
      </template>
      <el-row :gutter="16">
        <el-col
          v-for="service in services"
          :key="service.id"
          :xs="24"
          :sm="12"
          :md="8"
        >
          <div
            class="service-item"
            :class="{ 'is-off': !service.running }"
          >
            <div class="service-head">
              <span class="service-label">{{ service.label }}</span>
              <el-tag
                :type="service.running ? 'success' : (service.starting ? 'warning' : 'info')"
                size="small"
                effect="light"
              >
                {{ service.running ? '运行中' : (service.starting ? '启动中' : '已停止') }}
              </el-tag>
            </div>
            <div class="service-port">
              端口：{{ service.port }}
            </div>
            <div class="service-control">
              <el-switch
                :model-value="service.running || service.starting"
                :loading="!!actionPending[service.id] || !!service.starting"
                :disabled="!service.configured"
                active-text="启动"
                inactive-text="停止"
                inline-prompt
                @change="(value) => onToggle(service, value)"
              />
              <el-button
                v-if="service.browser"
                text
                type="primary"
                :disabled="!service.running || !!actionPending[service.id]"
                @click="onOpenHome(service)"
              >
                <el-icon><Link /></el-icon>
                <span>浏览器打开主页</span>
              </el-button>
            </div>
            <el-text
              v-if="!service.configured"
              type="warning"
              size="small"
            >
              未在默认位置找到启动程序，可在配置文件中指定启动命令：{{ configFileHint }}
            </el-text>
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script>
import {
    getDashboardOverview,
    startDashboardService,
    stopDashboardService,
    releaseDashboardVram,
    openDashboardServiceHome,
} from '@/render/common/ipcUtil';

const POLL_INTERVAL = 5000;

export default {
    name: 'Dashboard',
    data() {
        return {
            overview: null,
            loading: false,
            autoRefresh: true,
            pollTimer: null,
            actionPending: {},
            releasing: false,
            lastRelease: null,
        };
    },
    computed: {
        gpu() {
            return this.overview?.gpu || {
                available: false, error: '', gpus: [], totals: null,
            };
        },
        totals() {
            return this.gpu.totals || {
                totalMiB: 0, usedMiB: 0, freeMiB: 0, usedPercent: 0,
            };
        },
        services() {
            return this.overview?.services || [];
        },
        configFileHint() {
            return this.overview?.configFile || 'userData/SmartDesk/dashboard-services.json';
        },
        gaugeColor() {
            const percent = this.totals.usedPercent;
            if (percent >= 90) return '#f56c6c';
            if (percent >= 70) return '#e6a23c';
            return '#67c23a';
        },
    },
    watch: {
        autoRefresh(value) {
            if (value) {
                this.startPolling();
            } else {
                this.stopPolling();
            }
        },
    },
    mounted() {
        this.fetchOverview();
    },
    activated() {
        if (this.autoRefresh) this.startPolling();
    },
    deactivated() {
        this.stopPolling();
    },
    beforeUnmount() {
        this.stopPolling();
    },
    methods: {
        async fetchOverview() {
            if (this.loading) return;
            this.loading = true;
            try {
                this.overview = await getDashboardOverview();
            } catch (err) {
                this.$message.error(`工作台状态获取失败：${err?.message || err}`);
            } finally {
                this.loading = false;
            }
        },
        startPolling() {
            this.stopPolling();
            this.pollTimer = window.setInterval(() => {
                this.fetchOverview();
            }, POLL_INTERVAL);
        },
        stopPolling() {
            if (this.pollTimer) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },
        async onToggle(service, wantRunning) {
            this.actionPending[service.id] = true;
            try {
                const ret = wantRunning
                    ? await startDashboardService(service.id)
                    : await stopDashboardService(service.id);
                if (ret?.starting) {
                    this.$message.info(ret.message);
                } else if (ret?.success) {
                    this.$message.success(ret.message);
                } else {
                    this.$message.error(ret?.message || '操作失败');
                }
            } catch (err) {
                this.$message.error(`操作失败：${err?.message || err}`);
            } finally {
                this.actionPending[service.id] = false;
                this.fetchOverview();
            }
        },
        async onOpenHome(service) {
            const ret = await openDashboardServiceHome(service.id);
            if (ret && !ret.success) {
                this.$message.error(ret.message || '打开失败');
            }
        },
        async onReleaseVram() {
            if (this.releasing) return;
            this.releasing = true;
            try {
                const ret = await releaseDashboardVram();
                this.lastRelease = ret;
                if (ret?.success) {
                    this.$message.success(ret.message);
                } else {
                    this.$message.error(ret?.message || '显存清理失败');
                }
            } catch (err) {
                this.$message.error(`显存清理失败：${err?.message || err}`);
            } finally {
                this.releasing = false;
                this.fetchOverview();
            }
        },
        stepTagType(step) {
            if (step.skipped) return 'info';
            return step.success ? 'success' : 'danger';
        },
        stepLabel(step) {
            if (step.skipped) return '跳过';
            return step.success ? '成功' : '失败';
        },
        formatGiB(mib) {
            return `${(Number(mib || 0) / 1024).toFixed(2)} GB`;
        },
        formatTime(iso) {
            if (!iso) return '';
            const date = new Date(iso);
            return date.toLocaleTimeString('zh-CN', { hour12: false });
        },
    },
};
</script>

<style lang="scss" scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.gpu-card-header {
  width: 100%;
  justify-content: space-between;
}

.vram-release-result {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.release-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.release-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.gpu-missing {
  border: 2px solid #f56c6c;
  border-radius: 6px;
}

.gpu-missing-title {
  font-size: 18px;
  font-weight: 700;
  color: #f56c6c;
}

.gpu-missing-desc {
  margin-top: 4px;
  color: #f56c6c;
  font-weight: 600;
}

.gpu-missing-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

.gpu-body {
  display: flex;
  align-items: center;
  gap: 40px;
  flex-wrap: wrap;
}

.gauge-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.gauge-percent {
  font-size: 26px;
  font-weight: 700;
}

.gauge-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.gpu-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gpu-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gpu-name {
  font-weight: 600;
}

.vram-line {
  font-size: 15px;
}

.service-item {
  height: 100%;
  padding: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
}

.service-item.is-off {
  background-color: #fafafa;
}

.service-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.service-label {
  font-size: 15px;
  font-weight: 600;
}

.service-port {
  font-size: 12px;
  color: #909399;
}

.service-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
