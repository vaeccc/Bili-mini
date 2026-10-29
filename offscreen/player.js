const audio = new Audio();
audio.preload = "auto";

let activeRequestId = 0;
let lastProgressAt = 0;

function position() {
  return {
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0
  };
}

function notify(event, detail = {}) {
  chrome.runtime.sendMessage({ type: "PLAYER_EVENT", event, requestId: activeRequestId, ...detail }).catch(() => undefined);
}

function notifyProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastProgressAt < 500) return;
  lastProgressAt = now;
  if (navigator.mediaSession && Number.isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.currentTime, audio.duration),
        playbackRate: audio.playbackRate || 1
      });
    } catch (_) {
      // Position state is optional and may be rejected while metadata changes.
    }
  }
  notify("PROGRESS", position());
}

audio.addEventListener("playing", () => notify("PLAYING", position()));
audio.addEventListener("pause", () => { if (!audio.ended) notify("PAUSED", position()); });
audio.addEventListener("ended", () => notify("ENDED", position()));
audio.addEventListener("error", () => notify("ERROR", { ...position(), mediaError: audio.error?.code || 0 }));
audio.addEventListener("loadedmetadata", () => notifyProgress(true));
audio.addEventListener("durationchange", () => notifyProgress(true));
audio.addEventListener("timeupdate", () => notifyProgress());

if (navigator.mediaSession) {
  const actions = { play: "RESUME", pause: "PAUSE", previoustrack: "PREVIOUS", nexttrack: "NEXT" };
  for (const [action, command] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, () => chrome.runtime.sendMessage({ type: "MEDIA_ACTION", command }).catch(() => undefined)); } catch (_) {}
  }
  try {
    navigator.mediaSession.setActionHandler("seekto", ({ seekTime }) => {
      if (Number.isFinite(seekTime)) chrome.runtime.sendMessage({ type: "MEDIA_ACTION", command: "SEEK", position: seekTime }).catch(() => undefined);
    });
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  if (message.type === "PING") {
    sendResponse({ ok: true, hasSource: Boolean(audio.currentSrc || audio.src), ...position(), playing: !audio.paused && !audio.ended });
    return;
  }
  if (message.type === "PLAY_SOURCE") {
    const requestId = Number(message.requestId) || activeRequestId + 1;
    if (requestId < activeRequestId) {
      sendResponse({ ok: false, error: "STALE_REQUEST" });
      return;
    }
    activeRequestId = requestId;
    lastProgressAt = 0;
    audio.pause();
    audio.src = message.url;
    const startAt = Math.max(0, Number(message.startAt) || 0);
    let replied = false;
    let replyTimer = null;
    const reply = (result) => {
      if (replied) return;
      replied = true;
      if (replyTimer) clearTimeout(replyTimer);
      audio.removeEventListener("loadedmetadata", start);
      audio.removeEventListener("error", failed);
      sendResponse(result);
    };
    const start = () => {
      audio.removeEventListener("loadedmetadata", start);
      if (startAt > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 0.05));
      audio.play().then(() => reply({ ok: true })).catch((error) => reply({ ok: false, error: error?.name || "PLAYBACK_FAILED" }));
    };
    const failed = () => reply({
      ok: false,
      error: "MEDIA_ERROR",
      mediaError: audio.error?.code || 0,
      message: "媒体元素无法加载音轨"
    });
    audio.addEventListener("loadedmetadata", start, { once: true });
    audio.addEventListener("error", failed, { once: true });
    replyTimer = setTimeout(() => reply({ ok: false, error: "MEDIA_TIMEOUT", message: "音轨加载超时" }), 15_000);
    audio.load();
    return true;
  }
  if (message.type === "RESUME") {
    audio.play().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error?.name || "PLAYBACK_FAILED" }));
    return true;
  }
  if (message.type === "PAUSE") {
    audio.pause();
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "SEEK") {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      sendResponse({ ok: false, error: "SEEK_UNAVAILABLE" });
      return;
    }
    audio.currentTime = Math.min(Math.max(0, Number(message.position) || 0), audio.duration);
    notifyProgress(true);
    sendResponse({ ok: true, ...position() });
    return;
  }
  if (message.type === "SET_METADATA") {
    if (navigator.mediaSession && typeof MediaMetadata !== "undefined") {
      const item = message.item;
      navigator.mediaSession.metadata = item ? new MediaMetadata({
        title: item.title || item.videoTitle || "B站音乐 Mini",
        artist: item.videoTitle && item.title !== item.videoTitle ? item.videoTitle : "Bilibili",
        artwork: item.cover ? [{ src: item.cover, sizes: "320x180", type: "image/jpeg" }] : []
      }) : null;
    }
    sendResponse({ ok: true });
  }
});
