<template>
  <div class="ollama-chat">
    <el-card class="server-card">
      <div class="server-row">
        <div class="server-title">
          <el-icon><Connection /></el-icon>
          <span>局域网测试服务</span>
          <el-tag
            v-if="serverStatus.running"
            type="success"
            size="small"
          >
            运行中 · 端口 {{ serverStatus.port }}
          </el-tag>
          <el-tag
            v-else
            type="danger"
            size="small"
          >
            已停止
          </el-tag>
          <el-tag
            v-if="serverStatus.tokenConfigured"
            type="warning"
            size="small"
          >
            令牌校验已启用
          </el-tag>
        </div>
        <div class="server-actions">
          <el-button
            v-if="serverStatus.running"
            size="small"
            @click="handleStopServer"
          >
            停止服务
          </el-button>
          <el-button
            v-else
            type="primary"
            size="small"
            @click="handleStartServer"
          >
            启动服务
          </el-button>
          <el-button
            size="small"
            @click="loadServerStatus"
          >
            <el-icon><Refresh /></el-icon>
            <span>刷新状态</span>
          </el-button>
        </div>
      </div>
      <el-alert
        v-if="!serverStatus.running && serverStatus.error"
        type="error"
        :closable="false"
        :title="serverStatus.error"
        class="server-error"
      />
      <div
        v-if="serverStatus.running"
        class="lan-urls"
      >
        <el-text
          type="info"
          size="small"
        >
          局域网内其他电脑用浏览器打开以下地址即可测试：
        </el-text>
        <div
          v-for="url in serverStatus.urls"
          :key="url"
          class="lan-url-row"
        >
          <el-link
            :href="url"
            target="_blank"
            type="primary"
          >
            {{ url }}
          </el-link>
          <el-button
            text
            size="small"
            @click="copyText(url)"
          >
            <el-icon><CopyDocument /></el-icon>
            复制
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card class="chat-card">
      <template #header>
        <div class="chat-header">
          <div class="chat-title">
            <el-icon><ChatLineRound /></el-icon>
            <span>Ollama 单轮对话测试</span>
            <el-text
              type="info"
              size="small"
            >
              {{ endpointText }}
            </el-text>
          </div>
          <div class="chat-tools">
            <el-select
              v-model="model"
              class="model-select"
              size="small"
              :disabled="sending || modelsLoading || !modelList.length"
              placeholder="选择模型"
            >
              <el-option
                v-for="id in modelList"
                :key="id"
                :label="id"
                :value="id"
              />
            </el-select>
            <el-button
              size="small"
              :loading="modelsLoading"
              @click="loadModels"
            >
              <el-icon><Refresh /></el-icon>
            </el-button>
            <el-button
              size="small"
              @click="openTokenDialog"
            >
              <el-icon><Lock /></el-icon>
              <span>令牌</span>
            </el-button>
            <el-button
              size="small"
              :disabled="sending || !messages.length"
              @click="messages = []"
            >
              <el-icon><Delete /></el-icon>
              <span>清空</span>
            </el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="modelsError"
        type="warning"
        :closable="false"
        :title="modelsError"
        class="models-error"
      />

      <div
        ref="messageBox"
        class="messages"
      >
        <div
          v-if="!messages.length"
          class="empty-state"
        >
          <el-text type="info">
            输入一条消息开始测试，单轮对话不带上下文；Enter 发送，Shift + Enter 换行
          </el-text>
        </div>
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message-row"
          :class="msg.role"
        >
          <div class="bubble">
            <div
              v-if="msg.content"
              class="content"
            >
              {{ msg.content }}
              <span
                v-if="msg.pending && msg.content"
                class="caret"
              />
            </div>
            <div
              v-if="msg.pending && !msg.content"
              class="typing-dots"
            >
              <i /><i /><i />
            </div>
            <div
              v-if="msg.error"
              class="error"
            >
              {{ msg.error }}
            </div>
          </div>
        </div>
      </div>

      <div class="composer">
        <el-input
          v-model="input"
          type="textarea"
          :rows="2"
          resize="none"
          :disabled="sending || !serverStatus.running"
          placeholder="给模型发消息…（Enter 发送，Shift + Enter 换行）"
          @keydown="handleKeydown"
        />
        <el-button
          type="primary"
          class="send-btn"
          :loading="sending"
          :disabled="!input.trim() || !serverStatus.running || !model"
          @click="handleSend"
        >
          {{ sending ? '生成中…' : '发送' }}
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="tokenDialogVisible"
      title="访问令牌"
      width="420px"
    >
      <el-text
        type="info"
        size="small"
      >
        仅当局域网服务启用令牌校验时需要，令牌仅保存在本机浏览器 localStorage。
      </el-text>
      <el-input
        v-model="token"
        type="password"
        show-password
        placeholder="Bearer Token"
        class="token-input"
        @keyup.enter="saveToken"
      />
      <template #footer>
        <el-button @click="tokenDialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          @click="saveToken"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import {
    getLanServerStatus,
    startLanServerApi,
    stopLanServerApi,
} from '@/render/common/ipcUtil';

const TOKEN_KEY = 'smartdesk-lan-token';
let seq = 0;
const nextId = () => {
    seq += 1;
    return `msg-${seq}`;
};

export default {
    name: 'OllamaChat',
    data() {
        return {
            serverStatus: {
                running: false, port: 3100, urls: [], tokenConfigured: false, error: '',
            },
            modelList: [],
            model: '',
            modelsLoading: false,
            modelsError: '',
            config: null,
            messages: [],
            input: '',
            sending: false,
            token: localStorage.getItem(TOKEN_KEY) || '',
            tokenDialogVisible: false,
        };
    },
    computed: {
        baseUrl() {
            return this.serverStatus.running ? `http://127.0.0.1:${this.serverStatus.port}` : '';
        },
        endpointText() {
            return this.config ? `Ollama: ${this.config.ollamaBaseUrl}` : '';
        },
    },
    mounted() {
        this.init();
    },
    methods: {
        async init() {
            await this.loadServerStatus();
            if (this.serverStatus.running) {
                await this.loadConfig();
                await this.loadModels();
            }
        },
        async loadServerStatus() {
            try {
                this.serverStatus = await getLanServerStatus();
            } catch (err) {
                this.$message.error(`服务状态获取失败：${err?.message || err}`);
            }
        },
        async handleStartServer() {
            await startLanServerApi();
            await this.loadServerStatus();
            if (this.serverStatus.running) {
                this.$message.success('局域网服务已启动');
                await this.loadConfig();
                await this.loadModels();
            } else {
                this.$message.error(this.serverStatus.error || '服务启动失败');
            }
        },
        async handleStopServer() {
            await stopLanServerApi();
            await this.loadServerStatus();
            this.$message.info('局域网服务已停止');
        },
        authHeaders() {
            const headers = { 'Content-Type': 'application/json' };
            if (this.token) headers.Authorization = `Bearer ${this.token}`;
            return headers;
        },
        async loadConfig() {
            const resp = await fetch(`${this.baseUrl}/api/config`, { headers: this.authHeaders() });
            if (resp.status === 401) {
                this.tokenDialogVisible = true;
                return null;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this.config = await resp.json();
            if (this.config.defaultModel) this.model = this.config.defaultModel;
            return this.config;
        },
        async loadModels() {
            if (!this.baseUrl) return;
            this.modelsLoading = true;
            this.modelsError = '';
            try {
                const resp = await fetch(`${this.baseUrl}/api/models`, { headers: this.authHeaders() });
                const data = await resp.json();
                if (resp.status === 401) {
                    this.tokenDialogVisible = true;
                    return;
                }
                if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
                this.modelList = Array.isArray(data.models) ? data.models : [];
                if (!this.modelList.length) throw new Error('模型服务返回了空列表');
                if (!this.modelList.includes(this.model)) {
                    const preferred = data.defaultModel || this.config?.defaultModel;
                    const matched = this.modelList
                        .find((id) => id === preferred || id.replace(/:latest$/, '') === preferred);
                    this.model = matched || this.modelList[0];
                }
            } catch (err) {
                this.modelsError = `模型列表获取失败：${err.message || err}`;
            } finally {
                this.modelsLoading = false;
            }
        },
        openTokenDialog() {
            this.tokenDialogVisible = true;
        },
        async saveToken() {
            localStorage.setItem(TOKEN_KEY, this.token.trim());
            this.token = this.token.trim();
            this.tokenDialogVisible = false;
            if (this.serverStatus.running) {
                await this.loadConfig();
                await this.loadModels();
            }
        },
        patchMessage(id, patch) {
            const target = this.messages.find((msg) => msg.id === id);
            if (target) Object.assign(target, patch);
        },
        async handleSend() {
            const text = this.input.trim();
            if (!text || this.sending) return;
            this.input = '';
            this.sending = true;
            const assistantId = nextId();
            this.messages.push({ id: nextId(), role: 'user', content: text });
            this.messages.push({
                id: assistantId, role: 'assistant', content: '', pending: true, error: '',
            });
            this.scrollToBottom();
            try {
                const resp = await fetch(`${this.baseUrl}/api/chat`, {
                    method: 'POST',
                    headers: this.authHeaders(),
                    body: JSON.stringify({ message: text, model: this.model }),
                });
                if (resp.status === 401) {
                    this.tokenDialogVisible = true;
                    throw new Error('未授权，请先配置访问令牌');
                }
                if (!resp.ok || !resp.body) {
                    const body = await resp.json().catch(() => ({}));
                    throw new Error(body.error || `请求失败（HTTP ${resp.status}）`);
                }
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let streaming = true;
                while (streaming) {
                    const { done, value } = await reader.read();
                    if (done) {
                        streaming = false;
                    } else {
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const raw of lines) {
                            const line = raw.trim();
                            if (line.startsWith('data:')) {
                                const data = line.slice(5).trim();
                                if (data && data !== '[DONE]') {
                                    let parsed = null;
                                    try {
                                        parsed = JSON.parse(data);
                                    } catch (err) {
                                        parsed = null;
                                    }
                                    if (parsed) {
                                        if (parsed.error) throw new Error(parsed.error);
                                        if (parsed.delta) {
                                            const target = this.messages.find((msg) => msg.id === assistantId);
                                            if (target) target.content += parsed.delta;
                                            this.scrollToBottom();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                this.patchMessage(assistantId, { error: err.message || '请求失败' });
            } finally {
                this.patchMessage(assistantId, { pending: false });
                this.sending = false;
            }
        },
        handleKeydown(event) {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                this.handleSend();
            }
        },
        scrollToBottom() {
            this.$nextTick(() => {
                const box = this.$refs.messageBox;
                if (box) box.scrollTop = box.scrollHeight;
            });
        },
        async copyText(text) {
            try {
                await navigator.clipboard.writeText(text);
                this.$message.success('已复制');
            } catch (err) {
                this.$message.error('复制失败');
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.ollama-chat {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

.server-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.server-title,
.chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.server-actions,
.chat-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.server-error {
  margin-top: 10px;
}

.lan-urls {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lan-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;

  :deep(.el-card__body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.model-select {
  width: 260px;
}

.models-error {
  margin-bottom: 10px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background-color: #f9fafb;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 240px;
}

.empty-state {
  margin: auto;
}

.message-row {
  display: flex;
  width: 100%;

  &.user {
    justify-content: flex-end;
  }

  &.assistant {
    justify-content: flex-start;
  }
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-row.user .bubble {
  background-color: #409eff;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message-row.assistant .bubble {
  background-color: #fff;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}

.caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background-color: #409eff;
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}

.typing-dots {
  display: flex;
  gap: 5px;
  padding: 4px 2px;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: #9ca3af;
    animation: bounce 1.2s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.15s;
    }

    &:nth-child(3) {
      animation-delay: 0.3s;
    }
  }
}

@keyframes bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

.error {
  margin-top: 6px;
  color: #dc2626;
  font-size: 13px;
}

.composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding-top: 14px;
}

.send-btn {
  height: 40px;
}

.token-input {
  margin-top: 12px;
}
</style>
