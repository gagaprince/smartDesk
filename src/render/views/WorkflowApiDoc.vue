<template>
  <div class="api-doc">
    <el-card class="head-card">
      <div class="head-row">
        <div class="head-title">
          <el-icon><Document /></el-icon>
          <span>工作流 HTTP 调用文档</span>
          <el-tag
            v-if="serviceReady"
            type="success"
            size="small"
          >
            服务在线
          </el-tag>
          <el-tag
            v-else-if="!loading"
            type="danger"
            size="small"
          >
            服务离线
          </el-tag>
        </div>
        <el-button
          type="primary"
          :loading="loading"
          @click="loadAll"
        >
          <el-icon><Refresh /></el-icon>
          <span>刷新文档</span>
        </el-button>
      </div>
      <el-text
        type="info"
        size="small"
      >
        文档内容根据「工作流调用配置」中已注册的工作流动态生成，新增或修改配置并热加载后，点击刷新即可同步。
      </el-text>
    </el-card>

    <el-alert
      v-if="!serviceReady && !loading"
      type="warning"
      :closable="false"
      show-icon
      title="comfyui-ctrl 子服务未运行"
      description="接口当前不可调用，静态文档仍可查看。应用启动时会自动拉起该子服务，也可重启应用或检查 subprojects/comfyui-ctrl 虚拟环境。"
    />

    <el-card>
      <template #header>
        <div class="card-header">
          <el-icon><Tickets /></el-icon>
          <span>接口总览</span>
        </div>
      </template>
      <el-descriptions
        :column="1"
        border
        size="small"
      >
        <el-descriptions-item label="服务基址">
          <code>{{ baseUrl || 'http://127.0.0.1:8888' }}</code>
        </el-descriptions-item>
        <el-descriptions-item label="统一前缀">
          <code>/api/v1</code>（健康检查 <code>/health</code> 不带前缀）
        </el-descriptions-item>
        <el-descriptions-item label="响应包络">
          <code>{ "code": 0, "message": "ok", "data": ... }</code>，
          <code>code !== 0</code> 或 HTTP 4xx/5xx 表示失败，错误信息在 message / detail 中
        </el-descriptions-item>
        <el-descriptions-item label="内容类型">
          <code>Content-Type: application/json</code>
        </el-descriptions-item>
      </el-descriptions>
      <el-table
        :data="endpointRows"
        size="small"
        border
        class="endpoint-table"
      >
        <el-table-column
          label="方法"
          width="90"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.method === 'POST' ? 'success' : 'primary'"
              size="small"
            >
              {{ row.method }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="path"
          label="路径"
          min-width="300"
        >
          <template #default="{ row }">
            <code>{{ row.path }}</code>
          </template>
        </el-table-column>
        <el-table-column
          prop="desc"
          label="说明"
          min-width="200"
        />
      </el-table>
    </el-card>

    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <el-icon><Reading /></el-icon>
          <span>工作流接口文档</span>
        </div>
      </template>
      <el-alert
        v-if="workflows.length === 0 && !loading"
        type="info"
        :closable="false"
        show-icon
        title="暂无已注册工作流"
        description="请到「工作流调用配置」栏目导入 ComfyUI API 格式 JSON 并完成参数绑定。"
      />
      <template v-if="workflow">
        <el-form
          label-position="top"
          class="switch-form"
        >
          <el-form-item label="工作流切换">
            <el-select
              v-model="selectedId"
              filterable
              style="max-width: 480px"
            >
              <el-option
                v-for="item in workflows"
                :key="item.workflow_id"
                :label="`${item.name}（${item.workflow_id}）`"
                :value="item.workflow_id"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <el-descriptions
          :column="1"
          border
          size="small"
          class="workflow-meta"
        >
          <el-descriptions-item label="工作流名称">
            {{ workflow.name }}
          </el-descriptions-item>
          <el-descriptions-item label="工作流 ID">
            <code>{{ workflow.workflow_id }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="功能说明">
            {{ workflow.description || '暂无说明' }}
          </el-descriptions-item>
          <el-descriptions-item label="调用地址">
            <code>POST {{ baseUrl }}/api/v1/workflows/{{ workflow.workflow_id }}/invoke</code>
          </el-descriptions-item>
          <el-descriptions-item label="请求体结构">
            <code>{ "params": { 参数键值对 } }</code>，未传的可选参数使用服务端默认值
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="block-title">
          参数文档
        </h4>
        <el-table
          :data="workflow.params"
          size="small"
          border
        >
          <el-table-column
            prop="key"
            label="参数键"
            min-width="150"
          >
            <template #default="{ row }">
              <code>{{ row.key }}</code>
            </template>
          </el-table-column>
          <el-table-column
            prop="label"
            label="名称"
            min-width="130"
          />
          <el-table-column
            label="类型"
            width="110"
          >
            <template #default="{ row }">
              <el-tag
                size="small"
                effect="plain"
              >
                {{ row.type }}
              </el-tag>
              <el-text
                v-if="row.multiline"
                size="small"
                type="info"
              >
                （多行）
              </el-text>
            </template>
          </el-table-column>
          <el-table-column
            label="必填"
            width="70"
          >
            <template #default="{ row }">
              <el-tag
                :type="row.required ? 'danger' : 'info'"
                size="small"
              >
                {{ row.required ? '必填' : '可选' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="默认值"
            min-width="140"
          >
            <template #default="{ row }">
              <code v-if="row.default !== null && row.default !== undefined">{{ formatValue(row.default) }}</code>
              <el-text
                v-else
                type="info"
              >
                无
              </el-text>
            </template>
          </el-table-column>
          <el-table-column
            label="取值说明"
            min-width="200"
          >
            <template #default="{ row }">
              {{ rangeText(row) }}
            </template>
          </el-table-column>
        </el-table>

        <h4 class="block-title">
          请求示例（JSON）
        </h4>
        <div class="code-block">
          <pre><code>{{ requestExample }}</code></pre>
          <el-button
            class="copy-btn"
            text
            @click="copyText(requestExample, 'json')"
          >
            <el-icon><CopyDocument /></el-icon>
            <span>{{ copyKey === 'json' ? '已复制' : '复制' }}</span>
          </el-button>
        </div>

        <h4 class="block-title">
          curl 调用示例
        </h4>
        <div class="code-block">
          <pre><code>{{ curlExample }}</code></pre>
          <el-button
            class="copy-btn"
            text
            @click="copyText(curlExample, 'curl')"
          >
            <el-icon><CopyDocument /></el-icon>
            <span>{{ copyKey === 'curl' ? '已复制' : '复制' }}</span>
          </el-button>
        </div>
        <el-text
          type="info"
          size="small"
        >
          Windows PowerShell 中 curl 默认是 Invoke-WebRequest 的别名，请改用 curl.exe，或在 Git Bash / CMD 中执行；JSON 中的中文可直接提交，服务端按 UTF-8 解析。
        </el-text>

        <h4 class="block-title">
          响应示例与任务轮询
        </h4>
        <p class="plain-text">
          invoke 接口同步返回任务信息（data 为 JobInfo），生图为异步过程：拿到
          <code>job_id</code> 后用
          <code>GET /api/v1/jobs/{job_id}</code> 轮询，status 变为
          <code>success</code> 后通过 <code>GET /api/v1/jobs/{job_id}/image</code>
          取结果图（成功时直接返回图片文件）。
        </p>
        <div class="code-block">
          <pre><code>{{ responseExample }}</code></pre>
          <el-button
            class="copy-btn"
            text
            @click="copyText(responseExample, 'resp')"
          >
            <el-icon><CopyDocument /></el-icon>
            <span>{{ copyKey === 'resp' ? '已复制' : '复制' }}</span>
          </el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script>
import {
    fetchWorkflows,
    getComfyuiBase,
    getComfyuiHealth,
} from '@/render/common/comfyuiApi';
import { workflowRegistryState } from '@/render/common/workflowUtil';

export default {
    name: 'WorkflowApiDoc',
    data() {
        return {
            workflowRegistryState,
            baseUrl: '',
            serviceReady: false,
            loading: false,
            workflows: [],
            selectedId: '',
            copyKey: '',
            endpointRows: [
                { method: 'GET', path: '/health', desc: '服务健康检查（不带 /api/v1 前缀）' },
                { method: 'GET', path: '/api/v1/workflows', desc: '列出全部已注册工作流及参数定义' },
                { method: 'GET', path: '/api/v1/workflows/{workflow_id}', desc: '获取单个工作流定义' },
                { method: 'POST', path: '/api/v1/workflows/{workflow_id}/invoke', desc: '提交一次生图任务，返回 JobInfo' },
                { method: 'GET', path: '/api/v1/jobs', desc: '任务列表（内存保留最近 50 条）' },
                { method: 'GET', path: '/api/v1/jobs/{job_id}', desc: '查询单个任务状态' },
                { method: 'GET', path: '/api/v1/jobs/{job_id}/image', desc: '下载成功任务的结果图片' },
            ],
        };
    },
    computed: {
        workflow() {
            return this.workflows.find((item) => item.workflow_id === this.selectedId) || null;
        },
        paramsExample() {
            const target = {};
            if (!this.workflow) return target;
            this.workflow.params.forEach((param) => {
                if (param.type === 'image') {
                    target[param.key] = 'data:image/png;base64,<BASE64编码的图片内容>';
                } else if (param.default !== null && param.default !== undefined) {
                    target[param.key] = param.default;
                } else if (param.required) {
                    target[param.key] = this.placeholderOf(param);
                }
            });
            return target;
        },
        requestExample() {
            return JSON.stringify({ params: this.paramsExample }, null, 2);
        },
        curlExample() {
            if (!this.workflow || !this.baseUrl) return '';
            const url = `${this.baseUrl}/api/v1/workflows/${this.workflow.workflow_id}/invoke`;
            // shell 单引号字符串中, 单引号需转义为 '\'' 才能安全提交
            const body = this.requestExample.replace(/'/g, "'\\''");
            return [
                `curl -X POST '${url}' \\`,
                "  -H 'Content-Type: application/json' \\",
                `  -d '${body}'`,
            ].join('\n');
        },
        responseExample() {
            if (!this.workflow) return '';
            const payload = {
                code: 0,
                message: 'ok',
                data: {
                    job_id: '20261115xxxx',
                    workflow_id: this.workflow.workflow_id,
                    workflow_name: this.workflow.name,
                    status: 'success',
                    submitted_params: this.paramsExample,
                    image_url: '/api/v1/jobs/20261115xxxx/image',
                    error: null,
                    node_errors: null,
                    created_at: '2026-11-15T10:00:00',
                    finished_at: '2026-11-15T10:00:12',
                },
            };
            return JSON.stringify(payload, null, 2);
        },
    },
    watch: {
        // 管理页保存/删除/热加载后自动刷新文档数据
        'workflowRegistryState.version': function onRegistryChange() {
            if (this.serviceReady) {
                this.loadAll();
            }
        },
    },
    mounted() {
        this.loadAll();
    },
    methods: {
        async loadAll() {
            this.loading = true;
            try {
                this.baseUrl = await getComfyuiBase();
                const status = await getComfyuiHealth();
                this.serviceReady = Boolean(status && status.ready);
                if (this.serviceReady) {
                    this.workflows = await fetchWorkflows();
                    const stillExists = this.workflows
                        .some((item) => item.workflow_id === this.selectedId);
                    if ((!this.selectedId || !stillExists) && this.workflows.length) {
                        this.selectedId = this.workflows[0].workflow_id;
                    }
                }
            } catch (err) {
                this.serviceReady = false;
                this.$message.error(`文档加载失败：${err?.message || err}`);
            } finally {
                this.loading = false;
            }
        },
        placeholderOf(param) {
            if (param.choices && param.choices.length) return param.choices[0];
            if (param.type === 'int' || param.type === 'float') {
                return param.min !== null && param.min !== undefined ? param.min : 0;
            }
            if (param.type === 'bool') return false;
            return '';
        },
        rangeText(param) {
            if (param.type === 'image') {
                return '图片：data URL / base64 / 已上传文件名';
            }
            if (param.choices && param.choices.length) {
                return `枚举：${param.choices.join(' / ')}`;
            }
            if (param.enum_source) {
                return `动态枚举（${param.enum_source}），可通过 /admin/enums 接口获取可选项`;
            }
            const parts = [];
            if (param.min !== null && param.min !== undefined) parts.push(`最小 ${param.min}`);
            if (param.max !== null && param.max !== undefined) parts.push(`最大 ${param.max}`);
            return parts.join('，') || '—';
        },
        formatValue(value) {
            if (typeof value === 'string') return value;
            return JSON.stringify(value);
        },
        async copyText(text, key) {
            try {
                await navigator.clipboard.writeText(text);
                this.copyKey = key;
                this.$message.success('已复制到剪贴板');
                setTimeout(() => {
                    if (this.copyKey === key) this.copyKey = '';
                }, 1500);
            } catch (err) {
                this.$message.error('复制失败，请手动选择文本复制');
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.api-doc {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.head-title {
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

.endpoint-table {
  margin-top: 12px;
}

.switch-form {
  margin-bottom: 4px;
}

.workflow-meta {
  margin-bottom: 16px;
}

.block-title {
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.plain-text {
  font-size: 13px;
  line-height: 1.8;
  color: #606266;
}

.code-block {
  position: relative;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background-color: #1e1e2e;

  pre {
    margin: 0;
    padding: 14px 16px;
    overflow: auto;
  }

  code {
    color: #e6e6e6;
    font-family: Consolas, Monaco, 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre;
  }

  .copy-btn {
    position: absolute;
    top: 6px;
    right: 8px;
    color: #c9d1d9;
  }
}

:deep(.el-descriptions code),
.plain-text code {
  padding: 1px 5px;
  border-radius: 3px;
  background-color: #f4f4f5;
  color: #c7254e;
}
</style>
