# tono-ui

Tono 同声传译 Android app 的 WebView 前端，通过 GitHub Pages 提供热更新。

发布地址：https://nicgzlfly.github.io/tono-ui/

## 本地预览（mock 模式）

```bash
python3 -m http.server 8000
open http://localhost:8000
```

浏览器没有 `window.tono` 原生 Bridge 时，UI 自动进入 mock 模式：
- 录音按钮可点，但没真翻译
- API Key 存 localStorage，方便单独调样式

## 与原生 APK 的契约

### JS → 原生（`window.tono.*`）
- `startSession()` — 开始一次同传 session（开 WebSocket、录音、串流）
- `stopSession()` — 结束 session
- `openSettings()` — 拉起原生设置 Activity
- `getApiKey() : string` — 取存储的 API Key
- `saveApiKey(key)` — 保存 API Key（设置页用）

### 原生 → JS（全局函数 dispatch）
- `onSessionStarted()`
- `onSessionStopped()`
- `onSessionFailed(msg)`
- `onUtterance({ id, src?, tgt?, status: 'partial'|'final', latencyMs? })`
- `onError(msg)`
- `onApiKeyMissing()`

## 热更新

改 HTML/JS/CSS → `git push` → 用户下次启动 app，WebView 自动加载新版（缓存策略见 APK 端 `MainActivity.kt`）。
