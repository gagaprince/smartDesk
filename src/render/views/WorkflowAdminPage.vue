<template>
  <div class="workflow-admin-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>工作流调用配置</span>
          <div>
            <el-button @click="handleReload">
              <el-icon><Refresh /></el-icon>
              <span>重新加载注册表</span>
            </el-button>
            <el-button
              type="primary"
              @click="openCreate"
            >
              <el-icon><UploadFilled /></el-icon>
              <span>导入新工作流</span>
            </el-button>
          </div>
        </div>
      </template>
      <el-text
        type="info"
        class="intro-text"
      >
        仅接受 ComfyUI 的 API 格式 JSON（开发者模式 Save (API Format) 导出）。
        导入后勾选需要对外暴露的控件，保存即自动生成调用表单与 HTTP 接口文档。
      </el-text>
      <el-table
        v-loading="loading"
        :data="registry"
        row-key="workflow_id"
        size="small"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-cell">
              <el-text
                v-if="row.ok"
                type="info"
              >
                {{ row.description || '暂无说明' }}
              </el-text>
              <el-alert
                v-else
                type="error"
                :closable="false"
                show-icon
                title="模板自检失败"
                :description="row.error || ''"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column
          prop="workflow_id"
          label="工作流 ID"
          width="200"
        />
        <el-table-column
          prop="name"
          label="名称"
        />
        <el-table-column
          label="状态"
          width="100"
        >
          <template #default="{ row }">
            <el-tag :type="row.ok ? 'success' : 'danger'">
              {{ row.ok ? '正常' : '失效' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="param_count"
          label="参数数"
          width="90"
        />
        <el-table-column
          prop="node_count"
          label="节点数"
          width="90"
        />
        <el-table-column
          label="更新时间"
          width="180"
        >
          <template #default="{ row }">
            {{ formatTime(row.updated_at) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="160"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :disabled="!row.ok"
              @click="openEdit(row)"
            >
              编辑
            </el-button>
            <el-popconfirm
              title="确认删除该工作流配置？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              @confirm="handleDelete(row)"
            >
              <template #reference>
                <el-button
                  link
                  type="danger"
                  size="small"
                >
                  删除
                </el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer
      v-model="drawerOpen"
      :title="editId ? `编辑工作流：${editId}` : '导入并配置工作流'"
      size="1120px"
      destroy-on-close
    >
      <el-steps
        :active="step"
        align-center
        class="wizard-steps"
      >
        <el-step title="导入 JSON" />
        <el-step title="参数绑定" />
        <el-step title="在线试跑" />
        <el-step title="保存生成" />
      </el-steps>

      <div
        v-if="step === 0"
        class="step-panel"
      >
        <el-upload
          drag
          accept=".json,application/json"
          :auto-upload="false"
          :show-file-list="false"
          :limit="1"
          :on-change="handleFileChange"
        >
          <el-icon class="upload-icon">
            <UploadFilled />
          </el-icon>
          <div class="upload-text">
            点击或拖拽 API 格式 JSON 到此处
          </div>
          <template #tip>
            <div class="upload-hint">
              ComfyUI 设置中打开 Enable Dev mode options 后，用工作流菜单的
              Save (API Format) 导出
            </div>
          </template>
        </el-upload>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="只接受 API 格式"
          description="UI 图格式（nodes/links 数组）会被拒绝并提示导出方法；子图会在 ComfyUI 导出时自动拍平，无需手工处理。"
        />
      </div>

      <BindingStep
        v-if="step === 1 && parseResult"
        :result="parseResult"
        :graph="graph"
        :drafts="drafts"
        @toggle="toggleExport"
        @update-draft="updateDraft"
        @update-fixed="updateFixedValue"
      />
      <div
        v-if="step === 2 && parseResult"
        class="step-panel"
      >
        <el-alert
          type="info"
          :closable="false"
          show-icon
          :title="`输出节点：${meta.output_node || '未选择'}`"
          description="试跑不会保存任何配置，仅用于验证参数绑定是否正确。"
        />
        <el-text
          v-if="draftList.length === 0"
          type="info"
        >
          没有勾选任何外部参数，可直接试跑验证固定模板。
        </el-text>
        <DynamicParamsForm
          v-else
          :params="draftList"
          :values="trialValues"
          @change="handleTrialValueChange"
        />
        <el-button
          type="primary"
          :loading="trialSubmitting"
          :disabled="!meta.output_node"
          @click="handleTrial"
        >
          提交试跑
        </el-button>
        <el-card
          v-if="trialJob"
          class="trial-card"
        >
          <template #header>
            <span>试跑结果</span>
          </template>
          <el-descriptions
            :column="2"
            size="small"
            border
          >
            <el-descriptions-item label="状态">
              <el-tag :type="statusMeta(trialJob.status).type">
                {{ statusMeta(trialJob.status).text }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="任务 ID">
              {{ trialJob.job_id }}
            </el-descriptions-item>
          </el-descriptions>
          <el-alert
            v-if="trialJob.status === 'error'"
            type="error"
            :closable="false"
            show-icon
            :title="trialJob.error || '试跑失败'"
          />
          <el-image
            v-if="trialJob.status === 'success' && trialJob.image_url"
            :src="resolveImageUrl(trialJob.image_url)"
            :preview-src-list="[resolveImageUrl(trialJob.image_url)]"
            fit="contain"
            class="trial-image"
          />
        </el-card>
      </div>

      <div
        v-if="step === 3 && parseResult"
        class="step-panel"
      >
        <el-form
          label-position="top"
          class="save-form"
        >
          <el-form-item
            label="工作流 ID（英文标识，也是 HTTP 路径的一部分）"
            required
          >
            <el-input
              v-model="meta.workflow_id"
              :disabled="!!editId"
              placeholder="例如 qwen_lora_txt2img"
            />
          </el-form-item>
          <el-form-item
            label="工作流名称"
            required
          >
            <el-input v-model="meta.name" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input
              v-model="meta.description"
              type="textarea"
              :rows="2"
            />
          </el-form-item>
          <el-form-item
            label="输出节点"
            required
          >
            <el-select
              v-model="meta.output_node"
              style="max-width: 360px"
            >
              <el-option
                v-for="id in parseResult.output_candidates"
                :key="id"
                :label="id"
                :value="id"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          :title="`已勾选 ${draftList.length} 个外部参数`"
          :description="draftList.length
            ? draftList.map((item) => item.key).join('、')
            : '该工作流将以全固定值方式运行'"
        />
        <el-button
          type="primary"
          size="large"
          @click="handleSave"
        >
          保存并生成接口文档
        </el-button>
        <el-alert
          v-if="saveResult"
          type="success"
          :closable="false"
          show-icon
          title="保存成功"
          class="save-result"
        >
          <template #default>
            <div class="save-paths">
              <p>定义：{{ saveResult.definition_path }}</p>
              <p>模板：{{ saveResult.template_path }}</p>
              <p>文档：{{ saveResult.doc_path }}</p>
              <p v-if="saveResult.backed_up.length > 0">
                旧版本已备份：{{ saveResult.backed_up.length }} 个文件
              </p>
            </div>
          </template>
        </el-alert>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerOpen = false">
            关闭
          </el-button>
          <el-button
            v-if="step > 0"
            @click="step -= 1"
          >
            上一步
          </el-button>
          <el-button
            v-if="step === 1"
            type="primary"
            :disabled="!parseResult"
            @click="goTrialStep"
          >
            下一步：试跑
          </el-button>
          <el-button
            v-if="step === 2"
            type="primary"
            :disabled="!parseResult"
            @click="step = 3"
          >
            下一步：保存
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>
<script>
import DynamicParamsForm from '@/render/components/DynamicParamsForm.vue';
import BindingStep from '@/render/components/workflow/BindingStep.vue';
import {
    createWorkflow,
    deleteWorkflowApi,
    fetchJob,
    fetchRegistry,
    fetchWorkflowDetail,
    parseWorkflowGraph,
    reloadRegistry,
    resolveImageUrl,
    trialWorkflow,
    updateWorkflow,
} from '@/render/common/comfyuiApi';
import {
    JOB_STATUS_META,
    bumpWorkflowRegistry,
    buildDefaultValues,
    buildDraft,
    formatTime,
    pathKey,
    setAtPath,
} from '@/render/common/workflowUtil';

const POLL_INTERVAL = 2000;

const defaultMeta = () => ({
    workflow_id: '',
    name: '',
    description: '',
    output_node: '',
});

export default {
    name: 'WorkflowAdminPage',
    components: { DynamicParamsForm, BindingStep },
    data() {
        return {
            registry: [],
            loading: true,
            drawerOpen: false,
            step: 0,
            editId: null,
            parseResult: null,
            graph: {},
            drafts: {},
            meta: defaultMeta(),
            saveResult: null,
            trialValues: {},
            trialJob: null,
            trialSubmitting: false,
            pollTimer: null,
        };
    },
    computed: {
        draftList() {
            return Object.values(this.drafts);
        },
    },
    mounted() {
        this.loadRegistry();
    },
    activated() {
        if (this.trialJob
            && ['queued', 'running'].includes(this.trialJob.status)
            && !this.pollTimer) {
            this.startTrialPolling(this.trialJob.job_id);
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
        pathKey,
        statusMeta(status) {
            return JOB_STATUS_META[status] || { type: 'info', text: status };
        },
        stopPolling() {
            if (this.pollTimer !== null) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },
        async loadRegistry() {
            this.loading = true;
            try {
                this.registry = await fetchRegistry();
            } catch (err) {
                this.$message.error(`加载注册表失败：${err.message || err}`);
            } finally {
                this.loading = false;
            }
        },
        resetWizard() {
            this.step = 0;
            this.editId = null;
            this.parseResult = null;
            this.graph = {};
            this.drafts = {};
            this.meta = defaultMeta();
            this.saveResult = null;
            this.trialValues = {};
            this.trialJob = null;
            this.trialSubmitting = false;
            this.stopPolling();
        },
        openCreate() {
            this.resetWizard();
            this.drawerOpen = true;
        },
        applyParseResult(result, template, existing = []) {
            const nextDrafts = {};
            const parsedByPath = {};
            result.nodes.forEach((node) => {
                node.inputs.forEach((input) => {
                    parsedByPath[pathKey(input.path)] = input;
                    if (input.kind !== 'widget' || !input.suggest_export) return;
                    nextDrafts[pathKey(input.path)] = buildDraft(input);
                });
            });
            existing.forEach((param) => {
                const primaryPath = (
                    param.path || (param.paths && param.paths[0]) || []
                ).map((segment) => String(segment));
                const parsed = parsedByPath[pathKey(primaryPath)];
                const migrated = { ...param };
                // 旧版本把 LoadImage 文件名误判为 enum, 重新解析后自动迁移为 image
                if (parsed && parsed.inferred_type === 'image') {
                    migrated.type = 'image';
                    migrated.choices = null;
                    migrated.enum_source = null;
                    migrated.multiline = false;
                }
                nextDrafts[pathKey(primaryPath)] = {
                    ...migrated,
                    path: primaryPath,
                    paths: param.paths
                        ? param.paths.map((candidate) => candidate.map(
                            (segment) => String(segment),
                        ))
                        : null,
                };
            });
            this.drafts = nextDrafts;
            this.parseResult = result;
            this.graph = template;
            if (!this.meta.output_node) {
                this.meta.output_node = result.output_candidates[0] || '';
            }
        },
        handleFileChange(uploadFile) {
            const file = uploadFile.raw;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const template = JSON.parse(reader.result);
                    const result = await parseWorkflowGraph(template);
                    this.applyParseResult(result, template);
                    this.step = 1;
                    this.$message.success(`解析成功：${result.node_count} 个节点`);
                } catch (err) {
                    this.$message.error(`导入失败：${err.message || err}`);
                }
            };
            reader.onerror = () => {
                this.$message.error('读取文件失败');
            };
            reader.readAsText(file);
        },
        async openEdit(entry) {
            this.resetWizard();
            this.drawerOpen = true;
            this.step = 1;
            try {
                const detail = await fetchWorkflowDetail(entry.workflow_id);
                const template = detail.template;
                const result = await parseWorkflowGraph(template);
                this.applyParseResult(result, template, detail.definition.params);
                this.editId = entry.workflow_id;
                this.meta = {
                    workflow_id: detail.definition.workflow_id,
                    name: detail.definition.name,
                    description: detail.definition.description,
                    output_node: detail.definition.output_node,
                };
            } catch (err) {
                this.$message.error(`加载工作流失败：${err.message || err}`);
            }
        },
        toggleExport(input) {
            const key = pathKey(input.path);
            if (this.drafts[key]) {
                delete this.drafts[key];
            } else {
                this.drafts[key] = buildDraft(input);
            }
        },
        updateDraft(key, patch) {
            this.drafts[key] = { ...this.drafts[key], ...patch };
        },
        updateFixedValue(path, value) {
            this.graph = setAtPath(this.graph, path, value);
        },
        handleTrialValueChange(key, value) {
            this.trialValues = { ...this.trialValues, [key]: value };
        },
        goTrialStep() {
            this.trialValues = buildDefaultValues(this.draftList);
            this.step = 2;
        },
        startTrialPolling(jobId) {
            this.stopPolling();
            this.pollTimer = window.setInterval(async () => {
                try {
                    const latest = await fetchJob(jobId);
                    this.trialJob = latest;
                    if (['success', 'error'].includes(latest.status)) {
                        this.stopPolling();
                        this.trialSubmitting = false;
                    }
                } catch (err) {
                    this.stopPolling();
                    this.trialSubmitting = false;
                }
            }, POLL_INTERVAL);
        },
        async handleTrial() {
            if (!this.meta.output_node) {
                this.$message.warning('请先在保存步骤选择输出节点');
                return;
            }
            this.trialSubmitting = true;
            this.trialJob = null;
            try {
                const job = await trialWorkflow({
                    name: this.meta.name || '试跑工作流',
                    output_node: this.meta.output_node,
                    template: this.graph,
                    param_defs: this.draftList,
                    params: this.trialValues,
                });
                this.trialJob = job;
                this.startTrialPolling(job.job_id);
            } catch (err) {
                this.trialSubmitting = false;
                this.$message.error(`试跑提交失败：${err.message || err}`);
            }
        },
        async handleSave() {
            if (!/^[a-z0-9_]+$/.test(this.meta.workflow_id)) {
                this.$message.warning('工作流 ID 只能包含小写字母、数字和下划线');
                return;
            }
            if (!this.meta.name.trim()) {
                this.$message.warning('请填写工作流名称');
                return;
            }
            const keys = this.draftList.map((item) => item.key);
            if (new Set(keys).size !== keys.length) {
                this.$message.warning('参数 key 存在重复，请修改');
                return;
            }
            if (keys.some((key) => !key.trim())) {
                this.$message.warning('存在未填写 key 的参数');
                return;
            }
            const payload = {
                workflow_id: this.meta.workflow_id,
                name: this.meta.name,
                description: this.meta.description,
                output_node: this.meta.output_node,
                template: this.graph,
                params: this.draftList,
            };
            try {
                const result = this.editId
                    ? await updateWorkflow(this.editId, payload)
                    : await createWorkflow(payload);
                this.saveResult = result;
                this.$message.success('保存成功，注册表已热加载');
                await this.loadRegistry();
                bumpWorkflowRegistry();
            } catch (err) {
                this.$message.error(`保存失败：${err.message || err}`);
            }
        },
        async handleDelete(entry) {
            try {
                await deleteWorkflowApi(entry.workflow_id);
                this.$message.success(`已删除 ${entry.name}`);
                await this.loadRegistry();
                bumpWorkflowRegistry();
            } catch (err) {
                this.$message.error(`删除失败：${err.message || err}`);
            }
        },
        async handleReload() {
            try {
                const result = await reloadRegistry();
                this.$message.success(
                    `热加载完成：成功 ${result.loaded.length} 个，失败 ${Object.keys(result.failed).length} 个`,
                );
                await this.loadRegistry();
                bumpWorkflowRegistry();
            } catch (err) {
                this.$message.error(`热加载失败：${err.message || err}`);
            }
        },
    },
};
</script>
<style scoped>
.workflow-admin-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.intro-text {
  display: block;
  margin-bottom: 12px;
}
.expand-cell {
  padding: 8px 16px;
}
.wizard-steps {
  margin-bottom: 24px;
}
.step-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.upload-icon {
  font-size: 48px;
  color: #409eff;
}
.upload-text {
  font-size: 14px;
  color: #606266;
}
.upload-hint {
  font-size: 12px;
  color: #909399;
}
.trial-card {
  max-width: 720px;
}
.trial-image {
  margin-top: 12px;
  max-width: 420px;
  border-radius: 8px;
}
.save-form {
  max-width: 720px;
}
.save-result {
  max-width: 720px;
}
.save-paths p {
  margin: 2px 0;
}
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
