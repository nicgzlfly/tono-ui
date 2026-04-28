/**
 * Tono UI — 在 Android WebView 里运行，通过 window.tono Bridge 调原生层。
 *
 * 原生 → JS 接口（原生主动 dispatch）：
 *   onSessionStarted()
 *   onUtterance({ id, src?, tgt?, status: 'partial' | 'final', latencyMs? })
 *   onSessionFailed(msg)
 *   onError(msg)
 *   onApiKeyMissing()
 *
 * JS → 原生（window.tono.*）：
 *   startSession()
 *   stopSession()
 *   openSettings()                 — 拉起原生设置 Activity
 *   getApiKey() : string | ""
 *
 * 调试模式：浏览器里没有 window.tono 时，用 mock 让 UI 单独可调。
 */

const VERSION = '0.1.0';
document.getElementById('ver').textContent = VERSION;

// -------- bridge wrapper --------
const bridge = window.tono || (() => {
  const handlers = [];
  return {
    startSession() { console.log('[mock] startSession'); setTimeout(() => window.onSessionStarted?.(), 200); },
    stopSession() { console.log('[mock] stopSession'); },
    openSettings() { console.log('[mock] openSettings'); },
    getApiKey() { return localStorage.getItem('mock_api_key') || ''; },
    _mockUtterance(payload) { window.onUtterance?.(payload); },
  };
})();

// -------- state --------
const state = {
  recording: false,
  utterances: new Map(),  // id -> dom node
};
const $status = document.getElementById('status');
const $utts = document.getElementById('utterances');
const $rec = document.getElementById('rec-btn');
const $settings = document.getElementById('settings-btn');
const $dialog = document.getElementById('settings-dialog');
const $apiKey = document.getElementById('api-key-input');

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = 'status' + (cls ? ' ' + cls : '');
}

// -------- 原生 → JS 钩子 --------
window.onSessionStarted = () => {
  setStatus('监听中', 'on');
  $rec.classList.add('active');
};

window.onSessionStopped = () => {
  setStatus('已停止');
  $rec.classList.remove('active');
};

window.onSessionFailed = (msg) => {
  setStatus(`失败: ${msg}`, 'err');
  $rec.classList.remove('active');
};

window.onError = (msg) => setStatus(`错误: ${msg}`, 'err');

window.onApiKeyMissing = () => {
  setStatus('需要 API Key', 'err');
  showSettings();
};

window.onUtterance = (u) => {
  // u: { id, src?, tgt?, status: 'partial'|'final', latencyMs? }
  let node = state.utterances.get(u.id);
  if (!node) {
    node = document.createElement('div');
    node.className = 'utt partial';
    node.innerHTML = '<div class="src"></div><div class="tgt"></div><div class="meta"></div>';
    $utts.appendChild(node);
    state.utterances.set(u.id, node);
    // auto scroll
    requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }
  if (u.src !== undefined) node.querySelector('.src').textContent = u.src;
  if (u.tgt !== undefined) node.querySelector('.tgt').textContent = u.tgt;
  if (u.status === 'final') {
    node.classList.remove('partial');
    if (u.latencyMs != null) {
      node.querySelector('.meta').textContent = `延迟 ${u.latencyMs}ms`;
    }
  }
};

// -------- 录音按钮（按住）--------
function startRec() {
  if (state.recording) return;
  state.recording = true;
  setStatus('连接中…');
  bridge.startSession();
}
function stopRec() {
  if (!state.recording) return;
  state.recording = false;
  bridge.stopSession();
  setStatus('已停止');
  $rec.classList.remove('active');
}

['mousedown', 'touchstart'].forEach(e => $rec.addEventListener(e, ev => { ev.preventDefault(); startRec(); }));
['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(e => $rec.addEventListener(e, stopRec));

// -------- 设置 --------
function showSettings() {
  $apiKey.value = bridge.getApiKey?.() || '';
  if (typeof $dialog.showModal === 'function') $dialog.showModal();
  else $dialog.setAttribute('open', '');
}

$settings.addEventListener('click', () => bridge.openSettings ? bridge.openSettings() : showSettings());

document.getElementById('save-btn').addEventListener('click', () => {
  const key = $apiKey.value.trim();
  if (!key) return;
  if (window.tono?.saveApiKey) window.tono.saveApiKey(key);
  else localStorage.setItem('mock_api_key', key);
  $dialog.close();
  setStatus('已保存 API Key');
});
document.getElementById('cancel-btn').addEventListener('click', () => $dialog.close());

// -------- 启动检查 --------
if (!bridge.getApiKey || !bridge.getApiKey()) {
  // 首次启动或没 key
  if (window.tono) bridge.openSettings();
  else showSettings();
}

setStatus('就绪');
