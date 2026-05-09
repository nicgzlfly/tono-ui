/**
 * Tono UI v0.7.1 — 同传 + 学习双模式
 *
 * 原生 → JS:
 *   onSessionStarted / onSessionStopped / onSessionFailed / onError / onApiKeyMissing
 *   onUtterance({ id, src?, tgt?, status, latencyMs?, speaker?: 'ME'|'OTHER'|'UNSURE', lang?: 'zh'|'en' })
 *   onPolished({ id, polished })   ← 学习模式 LLM 异步返回
 *   onLlmFailed({ id, reason, http_code, retried? })
 *   onFavoriteSaved({ ts, dedup, count })   ← v0.7 新增(契约见 changelog-learning §3)
 *   onFavoritesCleared()                    ← v0.7 新增
 *   onVadState({ state })
 *
 * JS → 原生:
 *   startSession / stopSession / openSettings / openCalibration / openReview
 *   getApiKey / saveApiKey
 *   exportLastSession / listLogs
 *   setSegmentMode / getSegmentMode
 *   setProductMode / getProductMode
 *   getTranslateMyVoice / setTranslateMyVoice
 *   saveFavorite(json)
 *   getFavoritesCount(): number          ← v0.7 新增
 *   listFavorites(): string (JSON array) ← v0.7 新增
 *   removeFavorite(ts: number): boolean  ← v0.7 新增
 *   clearFavorites()                     ← v0.7 新增
 *   retryPolish(uid, sourceText)         ← v0.7 新增
 *   getLlmStats(): string                ← v0.7 新增
 */

const VERSION = '0.7.1';
document.getElementById('ver').textContent = VERSION;

// -------- bridge wrapper（含 mock）--------
function mockFavoritesArray() {
  try { return JSON.parse(localStorage.getItem('mock_favs') || '[]'); }
  catch { return []; }
}
function mockFavoritesWrite(arr) {
  localStorage.setItem('mock_favs', JSON.stringify(arr));
}
const bridge = window.tono || (() => ({
  startSession() { console.log('[mock] startSession'); setTimeout(() => window.onSessionStarted?.(), 200); },
  stopSession() { setTimeout(() => window.onSessionStopped?.(), 100); },
  openSettings() {},
  openCalibration() { alert('mock: 打开校准页'); },
  openReview() { alert('mock: 打开语料本'); },
  exportLastSession() {},
  getApiKey() { return localStorage.getItem('mock_api_key') || ''; },
  saveApiKey(k) { localStorage.setItem('mock_api_key', k); },
  setSegmentMode(m) { localStorage.setItem('mock_seg', m); },
  getSegmentMode() { return localStorage.getItem('mock_seg') || 'NATURAL'; },
  setProductMode(m) { localStorage.setItem('mock_pmode', m); },
  getProductMode() { return localStorage.getItem('mock_pmode') || 'translate'; },
  saveFavorite(j) {
    const item = JSON.parse(j);
    const arr = mockFavoritesArray();
    const ts = Date.now();
    const dup = arr.some(x => x.src === item.src && (x.polished || '') === (item.polished || ''));
    if (!dup) { arr.push({ ...item, ts }); mockFavoritesWrite(arr); }
    setTimeout(() => window.onFavoriteSaved?.({ ts, dedup: dup, count: arr.length }), 60);
  },
  // v0.7 学习闭环新增（与 changelog-learning §3 对齐）
  getFavoritesCount() { return mockFavoritesArray().length; },
  listFavorites() { return JSON.stringify(mockFavoritesArray()); },
  removeFavorite(ts) {
    const arr = mockFavoritesArray();
    const before = arr.length;
    const next = arr.filter(x => x.ts !== ts);
    mockFavoritesWrite(next);
    return next.length !== before;
  },
  clearFavorites() { mockFavoritesWrite([]); setTimeout(() => window.onFavoritesCleared?.(), 30); },
  retryPolish(uid, _src) { console.log('[mock] retryPolish', uid); },
  getLlmStats() { return JSON.stringify({ calls: 0, cache_hits: 0, failures: 0, identical_returns: 0 }); },
}))();

// -------- state --------
const state = {
  recording: false,
  mode: bridge.getProductMode?.() || 'translate',
  utterances: new Map(),
  favoriteSet: new Set(),
};
const $status = document.getElementById('status');
const $utts = document.getElementById('utterances');
const $rec = document.getElementById('rec-btn');
const $recLabel = $rec.querySelector('.rec-label');
const $vadState = document.getElementById('vad-state');
const $settings = document.getElementById('settings-btn');
const $dialog = document.getElementById('settings-dialog');
const $apiKey = document.getElementById('api-key-input');
const $review = document.getElementById('review-btn');
const $reviewCount = document.getElementById('review-count');
const $toast = document.getElementById('toast');

// -------- toast / 收藏徽标 --------
let _toastTimer = null;
function showToast(msg, kind) {
  if (!$toast) return;
  $toast.textContent = msg;
  $toast.className = 'toast' + (kind ? ' ' + kind : '');
  $toast.hidden = false;
  // 触发重绘以重启动画
  void $toast.offsetWidth;
  $toast.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    $toast.classList.remove('show');
    setTimeout(() => { $toast.hidden = true; }, 220);
  }, 1800);
}
function refreshFavCount() {
  const n = (typeof bridge.getFavoritesCount === 'function') ? bridge.getFavoritesCount() : 0;
  if (!$reviewCount) return;
  if (n > 0) {
    $reviewCount.textContent = n > 99 ? '99+' : String(n);
    $reviewCount.hidden = false;
  } else {
    $reviewCount.hidden = true;
  }
}

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = 'status' + (cls ? ' ' + cls : '');
}
function setVad(label, cls) {
  $vadState.textContent = label;
  $vadState.className = 'vad-state ' + (cls || '');
}
function applyMode(m) {
  state.mode = m;
  document.body.dataset.mode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  bridge.setProductMode?.(m);
}

// -------- 原生 → JS --------
window.onSessionStarted = () => {
  setStatus(state.mode === 'learn' ? '学习中' : '同传中', 'on');
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

window.onError = (e) => setStatus(`错误: ${e?.msg || e}`, 'err');

window.onIdleHint = () => {
  setStatus('未检测到说话 — 请大点声或靠近麦克风', 'err');
};
window.onIdleAutoStop = () => {
  setStatus('30 秒无声音，已自动停止', 'err');
};
window.onTtsBacklog = (e) => {
  const ms = e?.pending_ms || 0;
  const speed = e?.speed || 1.0;
  if (speed > 1.0) setStatus(`译音排队 ${(ms/1000).toFixed(1)}s · ${speed}x 加速`, 'err');
  else if (ms > 1000) setStatus(`译音排队 ${(ms/1000).toFixed(1)}s`, '');
};
window.onApiKeyMissing = () => { setStatus('需要 API Key', 'err'); bridge.openSettings?.(); };

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
    node.dataset.id = u.id;
    // 学习模式同屏对照:🎤 你说的(原话) + ✨ 译文 + 🎯 地道版本(润色),纯文本对照(B 版无差异高亮)
    node.innerHTML = `
      <div class="head"></div>
      <div class="compare">
        <div class="row-src"><span class="lbl lbl-src">🎤 你说的</span><div class="src"></div></div>
        <div class="row-tgt"><span class="lbl lbl-tgt">✨ 译文</span><div class="tgt"></div></div>
        <div class="row-polished" hidden><span class="lbl lbl-polished">🎯 地道版本</span><div class="polished"></div></div>
      </div>
      <div class="llm-status" hidden></div>
      <div class="meta"></div>
    `;
    if ($utts.firstChild) $utts.insertBefore(node, $utts.firstChild);
    else $utts.appendChild(node);
    state.utterances.set(u.id, node);
    requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = 0;
    });
  }
  if (u.src !== undefined) node.querySelector('.src').textContent = u.src;
  if (u.tgt !== undefined) node.querySelector('.tgt').textContent = u.tgt;

  // speaker × 语向 = 4 组合
  node.dataset.speaker = u.speaker || '';
  node.dataset.lang = u.lang || '';
  // v0.6.0：在 head 显示 speaker + 语向 双标签
  const head = node.querySelector('.head');
  if (head && (u.speaker || u.lang)) {
    const speakerTag = u.speaker === 'ME' ? '🎤 我'
      : u.speaker === 'OTHER' ? '🗣 对方' : '? 未知';
    const langTag = u.lang === 'zh' ? '🇨🇳 中文'
      : u.lang === 'en' ? '🇬🇧 英文' : '';
    head.textContent = `${speakerTag} · ${langTag}`;
  }

  // 卡片视觉分类（学习模式按 4 组合，同传模式仅 me/other）
  node.classList.remove('me','other','combo-me-zh','combo-other-zh','combo-me-en','combo-other-en');
  if (u.speaker === 'ME') node.classList.add('me');
  else if (u.speaker === 'OTHER') node.classList.add('other');
  if (state.mode === 'learn') {
    node.classList.add(`combo-${(u.speaker||'unknown').toLowerCase()}-${(u.lang||'unknown').toLowerCase()}`);
  }

  if (u.status === 'final') {
    node.classList.remove('partial');
    const meta = node.querySelector('.meta');
    const parts = [];
    if (u.latencyMs != null) parts.push(`延迟 ${u.latencyMs}ms`);
    meta.textContent = parts.join(' · ');

    // 学习模式 + 任何中文段：加收藏按钮（v0.6.0 解耦 speaker）
    if (state.mode === 'learn' && u.lang === 'zh' && !node.querySelector('.fav-btn')) {
      const btn = document.createElement('button');
      btn.className = 'fav-btn';
      btn.textContent = '💾 收藏';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (btn.dataset.busy === '1' || btn.classList.contains('saved')) return;
        const polishedText = node.querySelector('.polished').textContent.replace(/^🎯\s*/, '');
        const item = {
          src: node.querySelector('.src').textContent,
          tgt: node.querySelector('.tgt').textContent,
          polished: polishedText,
          speaker: u.speaker, lang: u.lang,
        };
        // 把 fav-btn 标记为 pending，等 onFavoriteSaved 回调再做最终视觉反馈（AC-L8）
        btn.dataset.busy = '1';
        btn.classList.add('saving');
        btn.textContent = '⏳ 收藏中…';
        state.pendingFav = btn;
        bridge.saveFavorite?.(JSON.stringify(item));
      });
      meta.appendChild(btn);
    }
  }
};

// v0.7：收藏入库回执（AC-L4 + AC-L8）
window.onFavoriteSaved = (e) => {
  const btn = state.pendingFav;
  if (btn) {
    btn.classList.remove('saving');
    btn.dataset.busy = '';
    btn.classList.add('saved', 'pop');
    btn.textContent = e?.dedup ? '✓ 已在语料本' : '✓ 已收藏';
    setTimeout(() => btn.classList.remove('pop'), 420);
    state.pendingFav = null;
  }
  // 全局徽标 + toast
  if (typeof e?.count === 'number') {
    if ($reviewCount) {
      $reviewCount.textContent = e.count > 99 ? '99+' : String(e.count);
      $reviewCount.hidden = e.count <= 0;
      $review?.classList.add('bump');
      setTimeout(() => $review?.classList.remove('bump'), 420);
    }
  } else {
    refreshFavCount();
  }
  showToast(e?.dedup ? '📚 这句已在语料本里' : `📚 已收藏 · 共 ${e?.count ?? '?'} 条`, e?.dedup ? 'dim' : 'ok');
};

// v0.7：语料本被清空后回写徽标
window.onFavoritesCleared = () => {
  refreshFavCount();
  showToast('🗑 语料本已清空', 'dim');
};

// v0.6.0：LLM 失败诊断（AC-L3 优雅降级 — 原话仍在,只追加状态行)
window.onLlmFailed = (e) => {
  const node = state.utterances.get(e?.id);
  if (!node) return;
  const status = node.querySelector('.llm-status');
  const httpPart = (e?.http_code && e.http_code > 0) ? ` (HTTP ${e.http_code})` : '';
  const retried = e?.retried ? ' · 已重试' : '';
  status.textContent = `🚫 润色失败:${e?.reason || '未知'}${httpPart}${retried}`;
  status.hidden = false;
  // 失败时不展开润色行,但保留原话/译文的对照
  const row = node.querySelector('.row-polished');
  if (row) row.hidden = true;
};

// v0.6.0：通话模式外放给对方提示
window.onOpponentSpeakerStart = () => {
  setStatus('📢 已切外放给对方听 — 请拿下耳机', 'err');
};
window.onOpponentSpeakerEnd = (e) => {
  setStatus(`✓ 外放完成 (${e?.total_ms||0}ms)，可重新戴耳机`, 'on');
};

// v0.7：润色版同屏显示(纯文本对照,B 版禁差异高亮 — 见 b-version-scope §3)
window.onPolished = (e) => {
  const node = state.utterances.get(e?.id);
  if (!node || !e?.polished) return;
  const p = node.querySelector('.polished');
  p.textContent = e.polished;
  const row = node.querySelector('.row-polished');
  if (row) row.hidden = false;
  // 出现润色版时清除可能残留的 LLM 失败提示
  const status = node.querySelector('.llm-status');
  if (status) status.hidden = true;
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

// -------- 模式 toggle --------
document.querySelectorAll('.mode-btn').forEach(b => {
  b.addEventListener('click', () => {
    if (state.recording) {
      setStatus('停止后才能切换模式', 'err');
      return;
    }
    if (state.mode === b.dataset.mode) return;
    // v0.5.1: 切换模式时清空卡片，避免新旧模式视觉混杂
    $utts.innerHTML = '';
    state.utterances.clear();
    applyMode(b.dataset.mode);
    setStatus(b.dataset.mode === 'learn' ? '已切到学习模式' : '已切到同传模式');
  });
});
applyMode(state.mode);

// -------- 切句模式 pills --------
document.querySelectorAll('.pill').forEach(p => p.addEventListener('click', () => {
  const mode = p.dataset.segmode;
  bridge.setSegmentMode?.(mode);
  document.querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x === p));
}));
const currentSeg = bridge.getSegmentMode?.() || 'NATURAL';
document.querySelectorAll('.pill').forEach(x => x.classList.toggle('active', x.dataset.segmode === currentSeg));

// -------- 设置 / 导出 / 语料本入口 --------
$settings.addEventListener('click', () => bridge.openSettings ? bridge.openSettings() : showSettings());
document.getElementById('export-btn').addEventListener('click', () => {
  if (bridge.exportLastSession) bridge.exportLastSession();
  else setStatus('mock 模式无日志', 'err');
});

// 📚 语料本入口 — 点击进入原生 ReviewActivity(AC-L5)
$review?.addEventListener('click', () => {
  // 消费 listFavorites:进入前先确保徽标数与底层一致(避免冷启动错位)
  refreshFavCount();
  if (bridge.openReview) bridge.openReview();
});

function showSettings() {
  $apiKey.value = bridge.getApiKey?.() || '';
  $dialog.showModal?.();
}
document.getElementById('save-btn').addEventListener('click', () => {
  const k = $apiKey.value.trim();
  if (!k) return;
  bridge.saveApiKey?.(k);
  $dialog.close();
});
document.getElementById('cancel-btn').addEventListener('click', () => $dialog.close());

// -------- 启动检查 --------
if (!bridge.getApiKey || !bridge.getApiKey()) {
  if (window.tono) bridge.openSettings();
  else showSettings();
}
setStatus('就绪');

// 启动时同步收藏总数徽标(消费 listFavorites/getFavoritesCount)
refreshFavCount();
