<template>
  <div class="ollama-guide">
    <el-card class="head-card">
      <div class="head-row">
        <div class="head-title">
          <el-icon><ChatDotRound /></el-icon>
          <span>Ollama 调用说明</span>
          <el-tag
            v-if="status.online"
            type="success"
            size="small"
          >
            服务在线（127.0.0.1:11434）
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
          @click="loadStatus"
        >
          <el-icon><Refresh /></el-icon>
          <span>刷新状态</span>
        </el-button>
      </div>
      <el-alert
        v-if="!status.online && !loading"
        type="warning"
        :closable="false"
        show-icon
        title="Ollama 当前未运行"
        description="可到「工作台」栏目打开 Ollama 开关，服务启动后本页会自动展示本地已安装的模型。"
        class="offline-alert"
      />
    </el-card>

    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <el-icon><CircleCheck /></el-icon>
          <span>本地模型清单</span>
        </div>
      </template>
      <el-table
        v-if="status.online"
        :data="status.models"
        size="small"
        border
      >
        <el-table-column
          prop="name"
          label="模型标签（model）"
          min-width="220"
        >
          <template #default="{ row }">
            <code>{{ row.name }}</code>
          </template>
        </el-table-column>
        <el-table-column
          label="大小"
          width="120"
        >
          <template #default="{ row }">
            {{ row.sizeMiB ? `${(row.sizeMiB / 1024).toFixed(2)} GB` : '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="参数规模"
          width="120"
        >
          <template #default="{ row }">
            {{ row.details?.parameter_size || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="量化"
          width="120"
        >
          <template #default="{ row }">
            {{ row.details?.quantization_level || '—' }}
          </template>
        </el-table-column>
      </el-table>
      <el-text
        v-else-if="!loading"
        type="info"
      >
        服务离线时无法获取模型列表。模型安装命令示例：curl.exe -fsSL https://ollama.com/install.sh 仅适用于 Linux，Windows 请在终端执行 ollama pull qwen2.5:7b。
      </el-text>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <el-icon><InfoFilled /></el-icon>
          <span>服务与接口总览</span>
        </div>
      </template>
      <el-descriptions
        :column="1"
        border
        size="small"
      >
        <el-descriptions-item label="服务地址">
          <code>http://127.0.0.1:11434</code>，仅监听本机，无需鉴权
        </el-descriptions-item>
        <el-descriptions-item label="启停方式">
          在 SmartDesk「工作台」用开关启停；也可手动执行 <code>ollama serve</code>
        </el-descriptions-item>
        <el-descriptions-item label="内容类型">
          所有 POST 请求带 <code>Content-Type: application/json</code>，请求与响应均为 JSON / NDJSON
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
          min-width="180"
        >
          <template #default="{ row }">
            <code>{{ row.path }}</code>
          </template>
        </el-table-column>
        <el-table-column
          prop="desc"
          label="说明"
          min-width="220"
        />
      </el-table>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <el-icon><Document /></el-icon>
          <span>常用参数说明（/api/generate、/api/chat 通用）</span>
        </div>
      </template>
      <el-table
        :data="paramRows"
        size="small"
        border
      >
        <el-table-column
          prop="key"
          label="字段"
          width="150"
        >
          <template #default="{ row }">
            <code>{{ row.key }}</code>
          </template>
        </el-table-column>
        <el-table-column
          prop="required"
          label="必填"
          width="80"
        />
        <el-table-column
          prop="desc"
          label="说明"
          min-width="320"
        />
      </el-table>
      <el-text
        type="info"
        size="small"
      >
        stream 默认值为 true：服务端按行返回多个 JSON（NDJSON 流式输出）；设为 false 时等全部生成结束后一次性返回完整 JSON，便于脚本处理。
      </el-text>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <el-icon><Tickets /></el-icon>
          <span>curl 调用示例</span>
        </div>
      </template>

      <h4 class="block-title">
        1. 查看本地已安装模型
      </h4>
      <h4 class="block-title">
        0. SmartDesk 局域网 HTTP 服务（聊天测试与显存清理）
      </h4>
      <el-descriptions
        :column="1"
        border
        size="small"
        class="lan-desc"
      >
        <el-descriptions-item label="服务状态">
          <el-tag
            :type="lanStatus.running ? 'success' : 'danger'"
            size="small"
          >
            {{ lanStatus.running ? `运行中（端口 ${lanStatus.port}）` : '已停止' }}
          </el-tag>
          <el-text
            type="info"
            size="small"
          >
            可在「生产工具 - ollama测试」栏目启停
          </el-text>
        </el-descriptions-item>
        <el-descriptions-item label="局域网地址">
          <div
            v-for="url in lanStatus.urls"
            :key="url"
            class="lan-url"
          >
            <code>{{ url }}</code>
            <el-button
              text
              size="small"
              @click="copyText(url, 'lan')"
            >
              复制
            </el-button>
          </div>
          <el-text
            v-if="!lanStatus.urls.length"
            type="info"
            size="small"
          >
            服务运行后自动展示；本机调用可用 {{ localBase }}
          </el-text>
        </el-descriptions-item>
        <el-descriptions-item label="聊天测试接口">
          <code>GET /api/config</code>、<code>GET /api/models</code>、
          <code>POST /api/chat</code>（SSE 流式，事件体为 delta 片段，结束行 data: [DONE]），
          浏览器直接打开服务根路径即为聊天测试页
        </el-descriptions-item>
        <el-descriptions-item label="显存清理接口">
          <code>POST {{ localBase }}/api/vram/release</code>，供局域网内其他服务调用，
          执行与工作台「清理显存」完全相同的逻辑（Ollama 卸载驻留模型 + ComfyUI /free 回收）
        </el-descriptions-item>
        <el-descriptions-item label="令牌校验">
          {{ lanStatus.tokenConfigured
            ? '已启用，所有 /api 请求需带 Authorization: Bearer token 头'
            : '未启用（默认），局域网内可直接调用；可在 lan-server.json 配置 token' }}
        </el-descriptions-item>
      </el-descriptions>
      <div class="code-block">
        <pre><code>{{ vramReleaseExample }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(vramReleaseExample, 'vram')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'vram' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>
      <div class="code-block">
        <pre><code>{{ vramResponseExample }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(vramResponseExample, 'vramResp')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'vramResp' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>
      <el-text
        type="info"
        size="small"
      >
        显卡未挂载时接口返回 HTTP 503；服务不可达时对应步骤标记 skipped 而非失败，首次调用需等待约 6 秒显存回收统计。
      </el-text>
      <div class="code-block">
        <pre><code>{{ examples.tags }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(examples.tags, 'tags')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'tags' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>

      <h4 class="block-title">
        2. 单轮补全（非流式，最适合脚本 / 二次封装）
      </h4>
      <div class="code-block">
        <pre><code>{{ examples.generate }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(examples.generate, 'generate')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'generate' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>

      <h4 class="block-title">
        3. 多轮对话（/api/chat，携带上下文）
      </h4>
      <div class="code-block">
        <pre><code>{{ examples.chat }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(examples.chat, 'chat')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'chat' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>

      <h4 class="block-title">
        4. 查看当前驻留显存的模型
      </h4>
      <div class="code-block">
        <pre><code>{{ examples.ps }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(examples.ps, 'ps')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'ps' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>

      <h4 class="block-title">
        5. 卸载驻留模型释放显存（keep_alive=0）
      </h4>
      <div class="code-block">
        <pre><code>{{ examples.unload }}</code></pre>
        <el-button
          class="copy-btn"
          text
          @click="copyText(examples.unload, 'unload')"
        >
          <el-icon><CopyDocument /></el-icon>
          <span>{{ copyKey === 'unload' ? '已复制' : '复制' }}</span>
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="Windows 环境提示"
        description="PowerShell 中 curl 默认是 Invoke-WebRequest 的别名，示例需用 curl.exe 执行，或在 CMD / Git Bash 中运行；JSON 体内的双引号在 CMD 下注意转义，推荐将请求体保存为 payload.json 后用 curl.exe -d @payload.json 提交。"
      />
    </el-card>
  </div>
</template>

<script>
import {
    getOllamaModels,
    getLanServerStatus,
} from '@/render/common/ipcUtil';

const BASE = 'http://127.0.0.1:11434';

export default {
    name: 'OllamaGuide',
    data() {
        return {
            loading: false,
            copyKey: '',
            status: { online: false, models: [] },
            lanStatus: {
                running: false, port: 3100, urls: [], tokenConfigured: false,
            },
            endpointRows: [
                { method: 'GET', path: '/api/tags', desc: '列出本地已安装的全部模型' },
                { method: 'POST', path: '/api/generate', desc: '单轮文本补全，适合一次性问答 / 脚本调用' },
                { method: 'POST', path: '/api/chat', desc: '多轮对话，messages 数组携带角色与上下文' },
                { method: 'GET', path: '/api/ps', desc: '查看当前加载到显存中的驻留模型' },
                { method: 'POST', path: '/api/show', desc: '查看模型详细参数、模板与系统提示词' },
            ],
            paramRows: [
                { key: 'model', required: '是', desc: '模型标签，与 /api/tags 返回的 name 一致，如 qwen2.5:7b' },
                { key: 'prompt', required: 'generate 必填', desc: '/api/generate 的输入文本；/api/chat 改用 messages' },
                { key: 'messages', required: 'chat 必填', desc: '消息数组，每项含 role（system/user/assistant）与 content' },
                { key: 'stream', required: '否', desc: '是否流式输出，默认 true；脚本对接建议显式设为 false' },
                { key: 'options', required: '否', desc: '推理参数对象，常用 temperature、top_p、num_predict（最大生成长度）、seed' },
                { key: 'keep_alive', required: '否', desc: '模型驻留时长，默认 5m；设为 0 立即卸载，-1 表示长期驻留' },
                { key: 'system', required: '否', desc: '系统提示词，仅 /api/generate 使用；chat 中放到 role=system 的消息' },
            ],
            examples: {
                tags: `curl.exe ${BASE}/api/tags`,
                generate: [
                    `curl.exe -X POST '${BASE}/api/generate' \\`,
                    "  -H 'Content-Type: application/json' \\",
                    "  -d '{",
                    '    "model": "qwen2.5:7b",',
                    '    "prompt": "用一句话介绍外置显卡",',
                    '    "stream": false,',
                    '    "options": { "temperature": 0.7, "num_predict": 256 }',
                    "  }'",
                ].join('\n'),
                chat: [
                    `curl.exe -X POST '${BASE}/api/chat' \\`,
                    "  -H 'Content-Type: application/json' \\",
                    "  -d '{",
                    '    "model": "qwen2.5:7b",',
                    '    "messages": [',
                    '      { "role": "system", "content": "你是 SmartDesk 内置助手，回答简洁准确。" },',
                    '      { "role": "user", "content": "如何释放显存？" },',
                    '      { "role": "assistant", "content": "可调用 /api/generate 并传 keep_alive=0 卸载模型。" },',
                    '      { "role": "user", "content": "那具体 curl 怎么写？" }',
                    '    ],',
                    '    "stream": false',
                    "  }'",
                ].join('\n'),
                ps: `curl.exe ${BASE}/api/ps`,
                unload: [
                    `curl.exe -X POST '${BASE}/api/generate' \\`,
                    "  -H 'Content-Type: application/json' \\",
                    "  -d '{ \"model\": \"qwen2.5:7b\", \"keep_alive\": 0 }'",
                ].join('\n'),
            },
        };
    },
    computed: {
        localBase() {
            return `http://127.0.0.1:${this.lanStatus.port || 3100}`;
        },
        lanExampleBase() {
            return this.lanStatus.urls[0] || this.localBase;
        },
        vramReleaseExample() {
            const lines = [
                `curl.exe -X POST '${this.localBase}/api/vram/release'`,
                '# 局域网内其他电脑改用本机局域网地址：',
                `# curl.exe -X POST '${this.lanExampleBase}/api/vram/release'`,
            ];
            if (this.lanStatus.tokenConfigured) {
                lines.push("# 启用令牌校验时追加请求头:  -H 'Authorization: Bearer <token>'");
            }
            return lines.join('\n');
        },
        vramResponseExample() {
            return JSON.stringify({
                success: true,
                message: '显存清理完成，当前占用 567 MiB，较清理前释放 667 MiB',
                steps: [
                    {
                        service: 'ollama',
                        success: true,
                        skipped: false,
                        message: 'Ollama 已卸载 1 个驻留模型',
                    },
                    {
                        service: 'comfyui',
                        success: true,
                        skipped: false,
                        message: 'ComfyUI 已触发模型卸载与显存回收',
                    },
                ],
                beforeUsedMiB: 1234,
                afterUsedMiB: 567,
                freedMiB: 667,
            }, null, 2);
        },
    },
    mounted() {
        this.loadStatus();
        this.loadLanStatus();
    },
    methods: {
        async loadLanStatus() {
            try {
                this.lanStatus = await getLanServerStatus();
            } catch (err) {
                // 状态获取失败不影响静态文档展示
            }
        },
        async loadStatus() {
            this.loading = true;
            try {
                this.status = await getOllamaModels();
            } catch (err) {
                this.status = { online: false, models: [] };
                this.$message.error(`状态获取失败：${err?.message || err}`);
            } finally {
                this.loading = false;
            }
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
.ollama-guide {
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

.offline-alert {
  margin-top: 12px;
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

.lan-desc {
  margin-bottom: 12px;
}

.lan-url {
  display: flex;
  align-items: center;
  gap: 6px;
}

.block-title {
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.block-title:first-of-type {
  margin-top: 4px;
}

.code-block {
  position: relative;
  margin-bottom: 16px;
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

:deep(.el-descriptions code) {
  padding: 1px 5px;
  border-radius: 3px;
  background-color: #f4f4f5;
  color: #c7254e;
}
</style>
