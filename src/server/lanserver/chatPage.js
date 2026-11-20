// 局域网访问用的自包含聊天测试页(单文件 HTML, 无外部依赖, 离线可用)
// 注意: 本模块以模板字符串导出, 页面内脚本避免使用反引号与 ${ 插值
export const CHAT_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmartDesk · Ollama 模型测试台</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; background: #eef1f6; }
.app { display: flex; flex-direction: column; height: 100%; max-width: 980px; margin: 0 auto; background: #fff; box-shadow: 0 0 24px rgba(15,23,42,.08); }
.header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
.header-left h1 { margin: 0; font-size: 16px; font-weight: 650; }
.endpoint { display: inline-block; margin-top: 2px; font-size: 12px; color: #6b7280; font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
.header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.model-box { display: flex; align-items: center; gap: 6px; }
.model-select { height: 32px; max-width: 260px; padding: 0 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; outline: none; }
.model-select:focus { border-color: #409eff; }
button { height: 32px; padding: 0 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; font-size: 13px; color: #374151; cursor: pointer; }
button:hover:not(:disabled) { border-color: #9ca3af; background: #f9fafb; }
button:disabled { opacity: .5; cursor: not-allowed; }
.refresh-btn { width: 34px; padding: 0; font-size: 16px; }
.send-btn { height: 40px; padding: 0 22px; border: none; background: #409eff; color: #fff; font-weight: 600; }
.send-btn:hover:not(:disabled) { background: #2f8ae8; }
.send-btn:disabled { background: #a0c7f5; }
.token-btn { color: #6b7280; }
.token-btn.active { border-color: #e6a23c; color: #e6a23c; }
.messages { flex: 1; overflow-y: auto; padding: 26px 22px; display: flex; flex-direction: column; gap: 16px; background: #f9fafb; }
.empty-state { margin: auto; text-align: center; color: #6b7280; }
.empty-state p { margin: 6px 0; font-size: 14px; }
.empty-hint { font-size: 12.5px !important; color: #9ca3af; }
.message-row { display: flex; width: 100%; }
.message-row.user { justify-content: flex-end; }
.message-row.assistant { justify-content: flex-start; }
.bubble { position: relative; max-width: 78%; padding: 11px 15px; border-radius: 14px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.message-row.user .bubble { background: #409eff; color: #fff; border-bottom-right-radius: 4px; }
.message-row.assistant .bubble { background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
.content:empty { display: none; }
.caret { display: inline-block; width: 7px; height: 15px; margin-left: 2px; vertical-align: text-bottom; background: #409eff; animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.typing-dots { display: flex; gap: 5px; padding: 4px 2px; }
.typing-dots i { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; animation: bounce 1.2s infinite ease-in-out; }
.typing-dots i:nth-child(2) { animation-delay: .15s; }
.typing-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%,60%,100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-5px); opacity: 1; } }
.error { margin-top: 6px; color: #dc2626; font-size: 13px; }
.composer { display: flex; gap: 10px; align-items: flex-end; padding: 14px 20px 18px; border-top: 1px solid #e5e7eb; background: #fff; }
.input-box { flex: 1; resize: none; padding: 10px 13px; border: 1px solid #d1d5db; border-radius: 10px; font-size: 14px; line-height: 1.6; outline: none; max-height: 160px; font-family: inherit; }
.input-box:focus { border-color: #409eff; box-shadow: 0 0 0 3px rgba(64,158,255,.12); }
.input-box:disabled { background: #f3f4f6; }
.token-mask { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 10; }
.token-dialog { width: 380px; background: #fff; border-radius: 12px; padding: 22px; box-shadow: 0 12px 32px rgba(0,0,0,.2); }
.token-dialog h2 { margin: 0 0 10px; font-size: 15px; }
.token-dialog p { margin: 0 0 14px; font-size: 12.5px; color: #6b7280; line-height: 1.6; }
.token-dialog input { width: 100%; height: 36px; padding: 0 10px; border: 1px solid #d1d5db; border-radius: 8px; outline: none; margin-bottom: 14px; }
.token-dialog .actions { display: flex; justify-content: flex-end; gap: 8px; }
.token-dialog .primary { background: #409eff; color: #fff; border: none; }
.model-error { font-size: 12px; color: #dc2626; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<div class="app">
  <header class="header">
    <div class="header-left">
      <h1>Ollama 模型测试台</h1>
      <span class="endpoint" id="endpoint">连接中…</span>
    </div>
    <div class="header-right">
      <span class="model-error" id="modelError" title=""></span>
      <div class="model-box">
        <select class="model-select" id="modelSelect" disabled><option value="">模型加载中…</option></select>
        <button class="refresh-btn" id="refreshBtn" title="刷新模型列表">↻</button>
      </div>
      <button class="token-btn" id="tokenBtn" title="配置访问令牌">🔑 令牌</button>
      <button id="clearBtn" disabled>清空对话</button>
    </div>
  </header>
  <main class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <p>👋 输入一条消息开始测试</p>
      <p class="empty-hint">单轮对话, 不带上下文与工具调用; Enter 发送, Shift + Enter 换行</p>
    </div>
  </main>
  <footer class="composer">
    <textarea class="input-box" id="inputBox" rows="2" placeholder="给模型发消息…(Enter 发送, Shift + Enter 换行)" disabled></textarea>
    <button class="send-btn" id="sendBtn" disabled>发送</button>
  </footer>
</div>
<div class="token-mask" id="tokenMask" style="display:none">
  <div class="token-dialog">
    <h2>访问令牌</h2>
    <p>服务端启用了令牌校验, 请输入 Bearer Token (仅保存在当前浏览器 localStorage)。</p>
    <input id="tokenInput" type="password" placeholder="Token">
    <div class="actions">
      <button id="tokenCancel">取消</button>
      <button class="primary" id="tokenSave">保存</button>
    </div>
  </div>
</div>
<script>
(function () {
  var TOKEN_KEY = 'smartdesk-lan-token';
  var state = { messages: [], sending: false, model: '', modelList: [], config: null, authRequired: false };
  var el = {
    messages: document.getElementById('messages'),
    empty: document.getElementById('emptyState'),
    select: document.getElementById('modelSelect'),
    refresh: document.getElementById('refreshBtn'),
    clear: document.getElementById('clearBtn'),
    input: document.getElementById('inputBox'),
    send: document.getElementById('sendBtn'),
    endpoint: document.getElementById('endpoint'),
    modelError: document.getElementById('modelError'),
    tokenBtn: document.getElementById('tokenBtn'),
    tokenMask: document.getElementById('tokenMask'),
    tokenInput: document.getElementById('tokenInput'),
    tokenSave: document.getElementById('tokenSave'),
    tokenCancel: document.getElementById('tokenCancel')
  };
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(v) { localStorage.setItem(TOKEN_KEY, v); }
  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (getToken()) h.Authorization = 'Bearer ' + getToken();
    return h;
  }
  function showTokenDialog() { el.tokenMask.style.display = 'flex'; el.tokenInput.value = getToken(); el.tokenInput.focus(); }
  el.tokenBtn.onclick = showTokenDialog;
  el.tokenCancel.onclick = function () { el.tokenMask.style.display = 'none'; };
  el.tokenSave.onclick = function () { setToken(el.tokenInput.value.trim()); el.tokenMask.style.display = 'none'; loadModels(); };
  function setModelError(msg) {
    el.modelError.textContent = msg || '';
    el.modelError.title = msg || '';
    el.tokenBtn.classList.toggle('active', state.authRequired);
  }
  function loadConfig() {
    return fetch('/api/config', { headers: authHeaders() }).then(function (resp) {
      if (resp.status === 401) { state.authRequired = true; setModelError('需要访问令牌'); showTokenDialog(); return null; }
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    }).then(function (cfg) {
      if (!cfg) return;
      state.config = cfg;
      state.authRequired = !!cfg.authRequired;
      el.endpoint.textContent = 'Ollama: ' + cfg.ollamaBaseUrl;
      if (cfg.defaultModel) state.model = cfg.defaultModel;
    }).catch(function () { el.endpoint.textContent = '配置加载失败, 请刷新重试'; });
  }
  function renderSelect() {
    el.select.innerHTML = '';
    if (!state.modelList.length) {
      var opt = document.createElement('option');
      opt.value = ''; opt.textContent = '无可用模型';
      el.select.appendChild(opt);
      el.select.disabled = true;
      return;
    }
    state.modelList.forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      if (id === state.model) opt.selected = true;
      el.select.appendChild(opt);
    });
    el.select.disabled = state.sending;
  }
  function loadModels() {
    setModelError('');
    el.refresh.disabled = true;
    return fetch('/api/models', { headers: authHeaders() }).then(function (resp) {
      return resp.json().then(function (data) {
        if (resp.status === 401) { state.authRequired = true; setModelError('需要访问令牌'); showTokenDialog(); return; }
        if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
        var list = Array.isArray(data.models) ? data.models : [];
        state.modelList = list;
        if (!list.length) throw new Error('模型服务返回了空列表');
        if (list.indexOf(state.model) === -1) {
          var preferred = data.defaultModel || (state.config && state.config.defaultModel);
          var matched = list.filter(function (id) { return id === preferred || id.replace(/:latest$/, '') === preferred; })[0];
          state.model = matched || list[0];
        }
        renderSelect();
        el.input.disabled = false;
      });
    }).catch(function (err) {
      setModelError('模型列表获取失败: ' + err.message);
      if (!state.modelList.length && state.model) state.modelList = [state.model];
      renderSelect();
    }).then(function () { el.refresh.disabled = false; });
  }
  el.select.onchange = function () { state.model = el.select.value; };
  el.refresh.onclick = function () { if (!state.sending) loadModels(); };
  function scrollBottom() { el.messages.scrollTop = el.messages.scrollHeight; }
  function renderMessages() {
    el.empty.style.display = state.messages.length ? 'none' : 'block';
    var existing = el.messages.querySelectorAll('.message-row');
    state.messages.forEach(function (msg, idx) {
      var row = existing[idx];
      if (!row) {
        row = document.createElement('div');
        row.className = 'message-row ' + msg.role;
        row.innerHTML = '<div class="bubble"></div>';
        el.messages.appendChild(row);
      }
      var bubble = row.querySelector('.bubble');
      var html = '';
      if (msg.content) html += '<div class="content"></div>';
      if (msg.pending && !msg.content) html += '<div class="typing-dots"><i></i><i></i><i></i></div>';
      if (msg.pending && msg.content) html += '<span class="caret"></span>';
      if (msg.error) html += '<div class="error"></div>';
      bubble.innerHTML = html;
      var content = bubble.querySelector('.content');
      if (content) content.textContent = msg.content;
      var errorBox = bubble.querySelector('.error');
      if (errorBox) errorBox.textContent = '⚠️ ' + msg.error;
    });
    while (el.messages.querySelectorAll('.message-row').length > state.messages.length) {
      el.messages.removeChild(el.messages.lastChild);
    }
    el.clear.disabled = state.sending || !state.messages.length;
    scrollBottom();
  }
  function patchMessage(id, patch) {
    state.messages = state.messages.map(function (m) { return m.id === id ? Object.assign({}, m, patch) : m; });
    renderMessages();
  }
  var seq = 0;
  function handleSend() {
    var text = el.input.value.trim();
    if (!text || state.sending) return;
    el.input.value = '';
    state.sending = true;
    el.send.disabled = true;
    el.send.textContent = '生成中…';
    seq += 1;
    var userId = 'msg-' + seq;
    seq += 1;
    var assistantId = 'msg-' + seq;
    state.messages.push({ id: userId, role: 'user', content: text });
    state.messages.push({ id: assistantId, role: 'assistant', content: '', pending: true, error: '' });
    renderMessages();
    fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: text, model: state.model })
    }).then(function (resp) {
      if (resp.status === 401) { state.authRequired = true; setModelError('需要访问令牌'); showTokenDialog(); throw new Error('未授权, 请先配置令牌'); }
      if (!resp.ok || !resp.body) return resp.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.error || ('请求失败 (HTTP ' + resp.status + ')'));
      });
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          lines.forEach(function (raw) {
            var line = raw.trim();
            if (line.indexOf('data:') !== 0) return;
            var data = line.slice(5).trim();
            if (!data || data === '[DONE]') return;
            var parsed;
            try { parsed = JSON.parse(data); } catch (e) { return; }
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              state.messages = state.messages.map(function (m) {
                return m.id === assistantId ? Object.assign({}, m, { content: m.content + parsed.delta }) : m;
              });
              renderMessages();
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      patchMessage(assistantId, { error: err.message || '请求失败' });
    }).then(function () {
      patchMessage(assistantId, { pending: false });
      state.sending = false;
      el.send.disabled = false;
      el.send.textContent = '发送';
    });
  }
  el.send.onclick = handleSend;
  el.clear.onclick = function () { if (!state.sending) { state.messages = []; renderMessages(); } };
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });
  loadConfig().then(loadModels);
})();
</script>
</body>
</html>`;
