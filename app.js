/**
 * Tono UI v0.3.0 — 持续监听 + VAD 切句模式 + 听语状态条
 *
 * 原生 → JS:
 *   onSessionStarted / onSessionStopped / onSessionFailed / onError / onApiKeyMissing
 *   onUtterance({ id, src?, tgt?, status, latencyMs? })
 *   onVadState({ state: 'speech' | 'silence' })
 *
 * JS → 原生 (window.tono.*):
 *   startSession / stopSession / openSettings
 *   getApiKey / saveApiKey
 *   exportLastSession / listLogs
 *   setSegmentMode(mode) / getSegmentMode()
 */

const VERSION = '0.3.0';
document.getElementById('ver').textContent = VERSION;

// -------- bridge wrapper（含 mock）--------
const bridge = window.tono || (() => {
  return {
    startSession() { console.log('[mock] startSession'); setTimeout(() => window.onSessionStarted?.(), 200); },
    stopSession() { console.log('[mock] stopSession'); setTimeout(() => window.onSessionStopped?.(), 100); },
    openSettings() { console.log('[mock] openSettings'); },
    exportLastSession() { console.log('[mock] export'); },
    getApiKey() { return localStorage.getItem('mock_api_key') || ''; },
    saveApiKey(k) { localStorage.setItem('mock_api_key', k); },
    setSegmentMode(m) { console.log('[mock] setSegmentMode', m); localStorage.setItem('mock_mode', m); },
    getSegmentMode() { return localStorage.getItem('mock_mode') || 'NATURAL'; },
  };
})();

// -------- state --------
const state = {
  recording: false,
  utterances: new Map(),
};
const $status = document.getElementById('status');
const $utts = document.getElementById('utterances');
const $rec = document.getElementById('rec-btn');
const $recLabel = $rec.querySelector('.rec-label');
const $vadState = document.getElementById('vad-state');
const $settings = document.getElementById('settings-btn');
const $dialog = document.getElementById('settings-dialog');
const $apiKey = document.getElementById('api-key-input');

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = 'status' + (cls ? ' ' + cls : '');
}

function setVad(label, cls) {
  $vadState.textContent = label;
  $vadState.className = 'vad-state ' + (cls || '');
}

// -------- 原生 → JS 钩子 --------
window.onSessionStarted = () => {
  setStatus('监听中', 'on');
  setVad('校准噪音…', 'calibrating');
  $rec.classList.add('active');
  $recLabel.textContent = '点击停止';
};

window.onSessionStopped = () => {
  setStatus('已停止');
  setVad('待机', '');
  $rec.classList.remove('active');
  $recLabel.textContent = '点击开始';
  state.recording = false;
};

window.onSessionFailed = (e) => {
  const msg = e?.msg || e || '未知';
  setStatus(`失败: ${msg}`, 'err');
  setVad('待机', '');
  $rec.classList.remove('active');
  $recLabel.textContent = '点击开始';
  state.recording = false;
};

window.onError = (e) => {
  const msg = e?.msg || e || '未知';
  setStatus(`错误: ${msg}`, 'err');
};

window.onApiKeyMissing = () => {
  setStatus('需要 API Key', 'err');
  showSettings();
};

window.onVadState = (e) => {
  const s = e?.state || e;
  if (s === 'speech') setVad('🎤 说话中', 'speech');
  else if (s === 'silence') setVad('💬 翻译中', 'translating');
  else setVad('监听中', '');
};

window.onUtterance = (u) => {
  let node = state.utterances.get(u.id);
  if (!node) {
    node = document.createElement('div');
    node.className = 'utt partial';
    node.innerHTML = '<div class="src"></div><div class="tgt"></div><div class="meta"></div>';
    $utts.appendChild(node);
    state.utterances.set(u.id, node);
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

// -------- 录音按钮（持续模式：点击切换）--------
function toggleRec() {
  if (!state.recording) {
    state.recording = true;
    setStatus('连接中…');
    bridge.startSession();
  } else {
    state.recording = false;
    setStatus('停止中…');
    bridge.stopSession();
  }
}
$rec.addEventListener('click', toggleRec);

// -------- 切句模式 --------
const $pills = document.querySelectorAll('.pill');
$pills.forEach(p => p.addEventListener('click', () => {
  const mode = p.dataset.mode;
  bridge.setSegmentMode(mode);
  $pills.forEach(x => x.classList.toggle('active', x === p));
}));

// 启动时同步 mode
const currentMode = bridge.getSegmentMode?.() || 'NATURAL';
$pills.forEach(x => x.classList.toggle('active', x.dataset.mode === currentMode));

// -------- 设置 --------
function showSettings() {
  $apiKey.value = bridge.getApiKey?.() || '';
  if (typeof $dialog.showModal === 'function') $dialog.showModal();
  else $dialog.setAttribute('open', '');
}

$settings.addEventListener('click', () => bridge.openSettings ? bridge.openSettings() : showSettings());

document.getElementById('export-btn').addEventListener('click', () => {
  if (bridge.exportLastSession) bridge.exportLastSession();
  else setStatus('mock 模式无日志', 'err');
});

document.getElementById('save-btn').addEventListener('click', () => {
  const key = $apiKey.value.trim();
  if (!key) return;
  bridge.saveApiKey?.(key);
  $dialog.close();
  setStatus('已保存 API Key');
});
document.getElementById('cancel-btn').addEventListener('click', () => $dialog.close());

// -------- 启动检查 --------
if (!bridge.getApiKey || !bridge.getApiKey()) {
  if (window.tono) bridge.openSettings();
  else showSettings();
}
setStatus('就绪');
