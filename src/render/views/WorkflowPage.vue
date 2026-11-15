<template>
  <div class="workflow-page">
    <el-row :gutter="16">
      <el-col
        :xs="24"
        :xl="10"
      >
        <el-card
          v-loading="loadingMeta"
          class="param-card"
        >
          <template #header>
            <div class="card-header">
              <span>生图参数</span>
              <el-button
                v-if="workflow"
                type="primary"
                :icon="Promotion"
                :loading="submitting"
                @click="handleGenerate"
              >
                开始生图
              </el-button>
            </div>
          </template>
          <el-alert
            v-if="workflows.length === 0 && !loadingMeta"
            type="info"
            :closable="false"
            show-icon
            title="暂无已注册工作流"
            description="请到「工作流调用配置」栏目导入 API 格式 JSON 并完成参数绑定。"
          />
          <template v-if="workflow">
            <el-form label-position="top">
              <el-form-item label="选择工作流">
                <el-select
                  v-model="selectedId"
                  filterable
                  style="max-width: 480px"
                  placeholder="选择工作流"
                  @change="handleSwitchWorkflow"
                >
                  <el-option
                    v-for="item in workflows"
                    :key="item.workflow_id"
                    :label="item.name"
                    :value="item.workflow_id"
                  />
                </el-select>
              </el-form-item>
            </el-form>
            <el-text
              type="info"
              class="workflow-desc"
            >
              {{ workflow.name }}：{{ workflow.description || '暂无说明' }}
            </el-text>
            <DynamicParamsForm
              :params="workflow.params"
              :values="paramValues"
              :disabled="submitting"
              @change="handleParamChange"
            />
          </template>
        </el-card>
      </el-col>
      <el-col
        :xs="24"
        :xl="14"
      >
        <el-card class="result-card">
          <template #header>
            <span>生成结果</span>
          </template>
          <div
            v-if="!currentJob"
            class="result-empty"
          >
            <el-text type="info">
              填写参数后点击「开始生图」，结果会显示在这里
            </el-text>
          </div>
          <div
            v-else
            class="result-body"
          >
            <el-descriptions
              :column="3"
              size="small"
              border
            >
              <el-descriptions-item label="任务状态">
                <el-tag :type="statusMeta(currentJob.status).type">
                  {{ statusMeta(currentJob.status).text }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="提交时间">
                {{ formatTime(currentJob.created_at) }}
              </el-descriptions-item>
              <el-descriptions-item label="完成时间">
                {{ formatTime(currentJob.finished_at) }}
              </el-descriptions-item>
            </el-descriptions>
            <el-alert
              v-if="currentJob.status === 'error'"
              type="error"
              :closable="false"
              show-icon
              :title="currentJob.error || '生图失败'"
              :description="currentJob.node_errors
                ? JSON.stringify(currentJob.node_errors)
                : ''"
            />
            <div
              v-if="busy"
              class="result-loading"
            >
              <el-icon class="is-loading">
                <Loading />
              </el-icon>
              <el-text>ComfyUI 正在生成，请稍候…</el-text>
            </div>
            <div
              v-if="currentJob.status === 'success' && currentJob.image_url"
              class="result-image-wrapper"
            >
              <el-image
                :src="resolveImageUrl(currentJob.image_url)"
                :preview-src-list="[resolveImageUrl(currentJob.image_url)]"
                fit="contain"
                class="result-image"
              />
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="jobs-card">
      <template #header>
        <div class="card-header">
          <el-icon><Picture /></el-icon>
          <span>最近任务</span>
        </div>
      </template>
      <el-table
        :data="jobs"
        size="small"
        row-key="job_id"
      >
        <el-table-column
          label="预览"
          width="92"
        >
          <template #default="{ row }">
            <el-image
              v-if="row.image_url && row.status === 'success'"
              :src="resolveImageUrl(row.image_url)"
              :preview-src-list="[resolveImageUrl(row.image_url)]"
              fit="cover"
              class="job-thumb"
            />
            <el-text
              v-else
              type="info"
            >
              -
            </el-text>
          </template>
        </el-table-column>
        <el-table-column
          label="提交时间"
          width="180"
        >
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="workflow_name"
          label="工作流"
          show-overflow-tooltip
        />
        <el-table-column
          label="状态"
          width="100"
        >
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.status).type">
              {{ statusMeta(row.status).text }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="180"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              @click="handleRefill(row)"
            >
              回填参数
            </el-button>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="row.status !== 'success'"
              @click="currentJob = row"
            >
              查看结果
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import { Promotion } from '@element-plus/icons-vue';
import DynamicParamsForm from '@/render/components/DynamicParamsForm.vue';
import {
    fetchJob,
    fetchJobs,
    fetchWorkflows,
    invokeWorkflow,
    resolveImageUrl,
} from '@/render/common/comfyuiApi';
import {
    JOB_STATUS_META,
    buildDefaultValues,
    formatTime,
} from '@/render/common/workflowUtil';

const POLL_INTERVAL = 2000;

export default {
    name: 'WorkflowPage',
    components: { DynamicParamsForm },
    data() {
        return {
            Promotion,
            workflows: [],
            selectedId: '',
            paramValues: {},
            loadingMeta: true,
            submitting: false,
            currentJob: null,
            jobs: [],
            pollTimer: null,
        };
    },
    computed: {
        workflow() {
            return this.workflows.find(
                (item) => item.workflow_id === this.selectedId,
            );
        },
        busy() {
            return this.currentJob
                && ['queued', 'running'].includes(this.currentJob.status);
        },
    },
    mounted() {
        this.loadMeta();
    },
    activated() {
        // keep-alive 重新激活时, 若任务仍在生成则恢复轮询
        if (this.busy && !this.pollTimer) {
            this.startPolling(this.currentJob.job_id);
        }
    },
    deactivated() {
        this.stopPolling();
    },
    beforeUnmount() {
        this.stopPolling();
    },
    methods: {
        resolveImageUrl,
        formatTime,
        statusMeta(status) {
            return JOB_STATUS_META[status] || { type: 'info', text: status };
        },
        stopPolling() {
            if (this.pollTimer !== null) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },
        async refreshJobs() {
            try {
                this.jobs = await fetchJobs();
            } catch (err) {
                // 最近任务只是辅助信息, 失败不影响主流程
            }
        },
        startPolling(jobId) {
            this.stopPolling();
            this.pollTimer = window.setInterval(async () => {
                try {
                    const latest = await fetchJob(jobId);
                    this.currentJob = latest;
                    if (['success', 'error'].includes(latest.status)) {
                        this.stopPolling();
                        this.submitting = false;
                        this.refreshJobs();
                        if (latest.status === 'success') {
                            this.$message.success('生图完成');
                        } else {
                            this.$message.error(latest.error || '生图失败');
                        }
                    }
                } catch (err) {
                    this.stopPolling();
                    this.submitting = false;
                    this.$message.error(`任务状态查询失败：${err.message || err}`);
                }
            }, POLL_INTERVAL);
        },
        async loadMeta() {
            this.loadingMeta = true;
            try {
                const workflowList = await fetchWorkflows();
                this.workflows = workflowList;
                const first = workflowList[0];
                if (first) {
                    this.selectedId = first.workflow_id;
                    this.paramValues = buildDefaultValues(first.params);
                }
                await this.refreshJobs();
            } catch (err) {
                this.$message.error(`加载工作流失败：${err.message || err}`);
            } finally {
                this.loadingMeta = false;
            }
        },
        handleSwitchWorkflow(workflowId) {
            const target = this.workflows.find(
                (item) => item.workflow_id === workflowId,
            );
            this.selectedId = workflowId;
            this.currentJob = null;
            if (target) {
                this.paramValues = buildDefaultValues(target.params);
            }
        },
        handleRefill(job) {
            const target = this.workflows.find(
                (item) => item.workflow_id === job.workflow_id,
            );
            if (!target) {
                this.$message.warning('该任务对应的工作流已不在注册表中，无法回填');
                return;
            }
            if (job.workflow_id !== this.selectedId) {
                this.selectedId = job.workflow_id;
            }
            this.paramValues = {
                ...buildDefaultValues(target.params),
                ...job.submitted_params,
            };
            this.currentJob = job;
            this.$message.success('已回填该任务的提交参数');
        },
        handleParamChange(key, value) {
            this.paramValues = { ...this.paramValues, [key]: value };
        },
        async handleGenerate() {
            if (!this.workflow) {
                this.$message.warning('工作流尚未加载完成');
                return;
            }
            const missing = this.workflow.params
                .filter((param) => param.required)
                .filter((param) => {
                    const value = this.paramValues[param.key];
                    return value === undefined
                        || value === null
                        || String(value).trim() === '';
                })
                .map((param) => param.label);
            if (missing.length) {
                this.$message.warning(`请先填写必填参数：${missing.join('、')}`);
                return;
            }
            this.submitting = true;
            try {
                const job = await invokeWorkflow(
                    this.workflow.workflow_id,
                    this.paramValues,
                );
                this.currentJob = job;
                this.$message.info('任务已提交，开始排队生成');
                this.startPolling(job.job_id);
                this.refreshJobs();
            } catch (err) {
                this.submitting = false;
                this.$message.error(`提交失败：${err.message || err}`);
            }
        },
    },
};
</script>

<style scoped>
.workflow-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.param-card .card-header {
  justify-content: space-between;
}
.workflow-desc {
  display: block;
  margin: -8px 0 12px;
}
.result-card {
  min-height: 420px;
}
.result-empty {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.result-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result-loading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.result-image-wrapper {
  display: flex;
  justify-content: center;
}
.result-image {
  max-width: 100%;
  max-height: 560px;
  border-radius: 8px;
}
.job-thumb {
  width: 72px;
  height: 72px;
  border-radius: 6px;
}
</style>
