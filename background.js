import { BilibiliApiError, getAccount, getFavoriteFolders, getFavoriteResources, getFollowingPage, getPlaybackSources, getPopularVideos, getRecommendations, getRemoteHistory, getVideoInfo, searchVideos } from "./api/bilibili.js";
import { addPlaybackHistory, defaultPlayerState, getPlaybackHistory, getPlayerState, setPlayerState } from "./storage/store.js";

const OFFSCREEN_PATH = "offscreen/offscreen.html";
const REFRESH_ALARM = "bilibili-mini-refresh-playback";
const ports = new Set();
const PLAY_MODES = ["ORDER", "LOOP", "ONE", "SHUFFLE"];

let playerState = defaultPlayerState();
let initialized = false;
let initialization = null;
let creatingOffscreen = null;
let playback = null;
let requestId = 0;
let recoveryInFlight = false;
let lastPersistAt = 0;
let playOperationId = 0;
const pendingStartRequests = new Set();
const shuffleHistory = [];

function publicState() {
  return { ...playerState, queue: [...playerState.queue] };
}

function notice(message) {
  for (const port of ports) {
    try { port.postMessage({ type: "NOTICE", message }); } catch (_) { ports.delete(port); }
  }
}

async function publish({ persist = true } = {}) {
  if (persist) await setPlayerState(playerState);
  const state = publicState();
  for (const port of ports) {
    try { port.postMessage({ type: "STATE", state }); } catch (_) { ports.delete(port); }
  }
}

async function initialize() {
  if (initialized) return;
  if (initialization) return initialization;
  initialization = (async () => {
    playerState = await getPlayerState();
    if (!PLAY_MODES.includes(playerState.playMode)) playerState.playMode = "ORDER";
    if (playerState.currentIndex >= 0 && !playerState.currentItem) playerState.currentItem = playerState.queue[playerState.currentIndex] || null;
    initialized = true;
    await publish();
  })();
  try { await initialization; } finally { initialization = null; }
}

async function hasOffscreen() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [documentUrl] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    if (!await hasOffscreen()) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "在扩展弹窗关闭后持续播放用户有权访问的视频音频。"
      });
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const result = await chrome.runtime.sendMessage({ type: "PING", target: "offscreen" });
        if (result?.ok) return;
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("后台播放器未能启动");
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function sendToPlayer(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

async function syncFromPlayer() {
  if (!playerState.currentItem) return;
  try {
    const status = await sendToPlayer({ type: "PING" });
    if (!status?.hasSource) return;
    playerState.playing = Boolean(status.playing);
    playerState.currentTime = status.currentTime || 0;
    playerState.duration = status.duration || playerState.duration;
  } catch (_) {
    // A paused player after a browser restart has no source by design.
  }
}

function scheduleRefresh(expiresAt) {
  chrome.alarms.clear(REFRESH_ALARM).catch(() => undefined);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
  // Refresh five minutes early. Alarms survive service worker suspension; an
  // audio error remains the fallback if the browser delays an alarm.
  const when = Math.max(Date.now() + 30_000, expiresAt - 5 * 60_000);
  chrome.alarms.create(REFRESH_ALARM, { when });
}

async function setMetadata(item) {
  await sendToPlayer({ type: "SET_METADATA", item }).catch(() => undefined);
}

async function playSelectedUrl(startAt = 0, operationId = playOperationId) {
  if (!playback?.urls?.[playback.index] || !playerState.currentItem) throw new Error("没有可用播放地址");
  let lastResult = null;
  // The primary CDN and every URL in backupUrl can differ. Try the complete
  // list during initial startup as well as later recovery, before re-signing.
  while (playback.index < playback.urls.length) {
    if (operationId !== playOperationId) return false;
    const thisRequestId = ++requestId;
    pendingStartRequests.add(thisRequestId);
    let result;
    try {
      result = await withTimeout(sendToPlayer({
        type: "PLAY_SOURCE",
        url: playback.urls[playback.index],
        startAt,
        requestId: thisRequestId
      }), 15_000);
    } finally {
      pendingStartRequests.delete(thisRequestId);
    }
    if (operationId !== playOperationId) return false;
    if (result?.ok) return true;
    lastResult = result;
    playback.index += 1;
  }
  throw new BilibiliApiError("PLAYBACK", "音轨无法开始播放", { result: lastResult });
}

function withTimeout(promise, timeoutMs, timeoutResult = { ok: false, error: "PLAYBACK_TIMEOUT" }) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(timeoutResult), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolveAndPlay(item, startAt = 0, { reason = "start", operationId = playOperationId } = {}) {
  const sources = await getPlaybackSources(item);
  if (operationId !== playOperationId || playerState.currentItem?.id !== item.id) return false;
  playback = {
    urls: sources.urls,
    index: 0,
    expiresAt: sources.expiresAt,
    renewalCount: reason === "renewal" ? 1 : 0,
    videoUrls: sources.videoUrls,
    videoExpiresAt: sources.videoExpiresAt,
    videoQuality: sources.videoQuality
  };
  playerState.currentTime = startAt;
  playerState.duration = sources.duration || item.duration || 0;
  playerState.error = "";
  await setMetadata(item);
  scheduleRefresh(sources.expiresAt);
  await publish();
  await playSelectedUrl(startAt, operationId);
  return true;
}

async function playItem(item, index, startAt = 0) {
  await initialize();
  const operationId = ++playOperationId;
  playback = null;
  scheduleRefresh(0);
  playerState.currentItem = item;
  playerState.currentIndex = index;
  playerState.playing = false;
  playerState.currentTime = startAt;
  playerState.duration = item.duration || 0;
  playerState.error = "";
  rememberShuffle(index);
  await addPlaybackHistory(item);
  await Promise.all([...ports].map((port) => sendHistory(port)));
  await publish();
  try {
    await resolveAndPlay(item, startAt, { operationId });
  } catch (error) {
    if (operationId !== playOperationId) return;
    playerState.playing = false;
    playerState.error = describeError(error);
    await publish();
    notice(playerState.error);
  }
}

function describeError(error) {
  if (error instanceof BilibiliApiError) {
    const result = error.detail?.result;
    if (result?.error === "MEDIA_ERROR") return `音轨加载失败（浏览器媒体错误 ${result.mediaError || "未知"}）`;
    if (result?.error === "PLAYBACK_TIMEOUT") return "音轨加载超时，请稍后重试";
    if (result?.error === "STALE_REQUEST") return "播放请求已更新";
    if (result?.error === "NotAllowedError") return "浏览器阻止了后台音频启动，请再次点击播放";
    if (result?.error === "NotSupportedError") return "浏览器不支持此音轨格式";
    return error.message;
  }
  return error?.message || "播放失败，请稍后重试";
}

async function addInputAndPlay(input) {
  const video = await getVideoInfo(input);
  const existingIndexes = new Map(playerState.queue.map((item, index) => [item.id, index]));
  const newPages = video.pages.filter((item) => !existingIndexes.has(item.id));
  playerState.queue = [...playerState.queue, ...newPages];
  const firstPage = video.pages.find((item) => item.page === video.requestedPage) || video.pages[0];
  const targetIndex = playerState.queue.findIndex((item) => item.id === firstPage.id);
  shuffleHistory.length = 0;
  await playItem(playerState.queue[targetIndex], targetIndex, 0);
}

async function pause() {
  await initialize();
  await sendToPlayer({ type: "PAUSE" });
}

async function resume() {
  await initialize();
  if (!playerState.currentItem) return notice("请先输入 B 站视频链接或 BV 号");
  if (!playback) return playItem(playerState.currentItem, playerState.currentIndex, playerState.currentTime);
  const result = await sendToPlayer({ type: "RESUME" });
  if (!result?.ok) await recoverPlayback(playerState.currentTime, "resume");
}

async function seek(position) {
  await initialize();
  if (!playerState.currentItem) return;
  const result = await sendToPlayer({ type: "SEEK", position });
  if (!result?.ok) return notice("当前音轨还不能调整进度");
  playerState.currentTime = result.currentTime;
  playerState.duration = result.duration || playerState.duration;
  await publish();
}

async function recoverPlayback(position, cause = "error") {
  if (!playerState.playing && cause !== "resume") return;
  if (recoveryInFlight || !playerState.currentItem) return;
  recoveryInFlight = true;
  try {
    if (playback && playback.index < playback.urls.length) {
      try {
        await playSelectedUrl(position);
        return;
      } catch (_) {
        // The complete CDN list has failed; request a fresh signed URL below.
      }
    }
    if (playback?.renewalCount >= 1) throw new BilibiliApiError("PLAYBACK", "播放地址刷新后仍无法播放");
    await resolveAndPlay(playerState.currentItem, position, { reason: "renewal" });
  } catch (error) {
    playerState.playing = false;
    playerState.error = `${cause === "expiry" ? "播放地址已过期，" : ""}${describeError(error)}`;
    await publish();
    notice(playerState.error);
  } finally {
    recoveryInFlight = false;
  }
}

function queueIndexFor(offset, { automatic = false } = {}) {
  const { queue, currentIndex, playMode } = playerState;
  if (!queue.length || currentIndex < 0) return -1;
  if (playMode === "ONE" && automatic) return currentIndex;
  if (playMode === "SHUFFLE") {
    if (offset < 0) {
      const currentPosition = shuffleHistory.lastIndexOf(currentIndex);
      if (currentPosition > 0) {
        shuffleHistory.splice(currentPosition);
        return shuffleHistory[currentPosition - 1];
      }
      return -1;
    }
    const candidates = queue.map((_, index) => index).filter((index) => index !== currentIndex);
    if (!candidates.length) return automatic ? currentIndex : -1;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  const candidate = currentIndex + offset;
  if (candidate >= 0 && candidate < queue.length) return candidate;
  if (playMode === "LOOP") return offset < 0 ? queue.length - 1 : 0;
  return -1;
}

function rememberShuffle(index) {
  if (playerState.playMode !== "SHUFFLE") return;
  if (shuffleHistory[shuffleHistory.length - 1] !== index) shuffleHistory.push(index);
  if (shuffleHistory.length > 200) shuffleHistory.shift();
}

async function moveQueue(offset, options = {}) {
  await initialize();
  const nextIndex = queueIndexFor(offset, options);
  if (nextIndex < 0) return;
  await playItem(playerState.queue[nextIndex], nextIndex, 0);
}

async function selectQueueIndex(index) {
  await initialize();
  const selectedIndex = Number(index);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= playerState.queue.length) return;
  await playItem(playerState.queue[selectedIndex], selectedIndex, 0);
}

async function removeQueueIndex(index) {
  await initialize();
  const selectedIndex = Number(index);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= playerState.queue.length) return;
  const removingCurrent = selectedIndex === playerState.currentIndex;
  playerState.queue.splice(selectedIndex, 1);
  if (selectedIndex < playerState.currentIndex) playerState.currentIndex -= 1;
  if (!playerState.queue.length) {
    ++playOperationId;
    playback = null;
    scheduleRefresh(0);
    await sendToPlayer({ type: "PAUSE" }).catch(() => undefined);
    await setMetadata(null);
    playerState.currentIndex = -1;
    playerState.currentItem = null;
    playerState.playing = false;
    playerState.currentTime = 0;
    playerState.duration = 0;
    await publish();
    return;
  }
  if (removingCurrent) {
    const nextIndex = Math.min(selectedIndex, playerState.queue.length - 1);
    await playItem(playerState.queue[nextIndex], nextIndex, 0);
    return;
  }
  await publish();
}

async function clearQueue() {
  await initialize();
  ++playOperationId;
  playback = null;
  scheduleRefresh(0);
  await sendToPlayer({ type: "PAUSE" }).catch(() => undefined);
  await setMetadata(null);
  playerState.queue = [];
  playerState.currentIndex = -1;
  playerState.currentItem = null;
  playerState.playing = false;
  playerState.currentTime = 0;
  playerState.duration = 0;
  playerState.error = "";
  await publish();
}

async function cyclePlayMode() {
  await initialize();
  const position = PLAY_MODES.indexOf(playerState.playMode);
  playerState.playMode = PLAY_MODES[(position + 1) % PLAY_MODES.length];
  shuffleHistory.length = 0;
  rememberShuffle(playerState.currentIndex);
  await publish();
}

async function sendViewSource(port) {
  await initialize();
  if (!playerState.currentItem) {
    port.postMessage({ type: "NOTICE", message: "当前没有可显示的视频" });
    return;
  }
  if (!playerState.playing) return;
  await syncFromPlayer();
  const videoExpired = playback?.videoExpiresAt && Date.now() >= playback.videoExpiresAt - 30_000;
  if (!playback?.videoUrls?.length || videoExpired) {
    try {
      const sources = await getPlaybackSources(playerState.currentItem);
      playback = {
        ...(playback || {}),
        videoUrls: sources.videoUrls,
        videoExpiresAt: sources.videoExpiresAt,
        videoQuality: sources.videoQuality
      };
    } catch (error) {
      port.postMessage({ type: "NOTICE", message: `视频画面不可用：${describeError(error)}` });
      return;
    }
  }
  if (!playback.videoUrls?.length) {
    port.postMessage({ type: "NOTICE", message: "当前视频没有可显示的画面" });
    return;
  }
  port.postMessage({
    type: "VIEW_SOURCE",
    urls: playback.videoUrls,
    expiresAt: playback.videoExpiresAt,
    quality: playback.videoQuality,
    startAt: playerState.currentTime,
    duration: playerState.duration || playerState.currentItem.duration,
    playing: playerState.playing,
    itemId: playerState.currentItem.id
  });
}

async function sendAccount(port) {
  try {
    const account = await getAccount();
    port.postMessage({ type: "ACCOUNT", account });
    if (account.loggedIn) {
      const folders = await getFavoriteFolders(account.mid);
      port.postMessage({ type: "FAVORITE_FOLDERS", folders });
    }
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: describeError(error) });
  }
}

async function logoutBilibili() {
  const authCookieNames = new Set([
    "SESSDATA",
    "bili_jct",
    "DedeUserID",
    "DedeUserID__ckMd5",
    "sid",
    "bili_ticket",
    "bili_ticket_expires"
  ]);
  const cookies = await chrome.cookies.getAll({ domain: "bilibili.com" });
  await Promise.all(cookies.filter((cookie) => authCookieNames.has(cookie.name)).map((cookie) => {
    const domain = cookie.domain.replace(/^\./, "");
    const details = { url: `https://${domain}${cookie.path || "/"}`, name: cookie.name, storeId: cookie.storeId };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    return chrome.cookies.remove(details);
  }));
  for (const port of ports) {
    try { await sendAccount(port); } catch { /* The popup may have closed. */ }
  }
}

async function sendHistory(port) {
  try {
    port.postMessage({ type: "HISTORY", items: await getPlaybackHistory() });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `历史记录读取失败：${describeError(error)}` });
  }
}

async function sendRemoteHistory(port, viewAt = "") {
  try {
    const result = await getRemoteHistory(viewAt);
    port.postMessage({ type: "REMOTE_HISTORY", ...result });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `B站历史读取失败：${describeError(error)}` });
  }
}

async function sendRecommendations(port, page = 1) {
  try {
    const currentPage = Math.max(1, Number(page) || 1);
    port.postMessage({ type: "RECOMMENDATIONS", page: currentPage, videos: await getRecommendations(currentPage) });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `推荐加载失败：${describeError(error)}` });
  }
}

async function sendPopular(port, page = 1) {
  try {
    const currentPage = Math.max(1, Number(page) || 1);
    port.postMessage({ type: "POPULAR_RESULTS", page: currentPage, videos: await getPopularVideos(currentPage) });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `热门加载失败：${describeError(error)}` });
  }
}

async function sendFollowing(port, offset = "") {
  try {
    const result = await getFollowingPage(offset);
    port.postMessage({ type: "FOLLOWING", ...result });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `特别关注加载失败：${describeError(error)}` });
  }
}

async function sendSearch(port, keyword, page = 1, context = "") {
  try {
    const currentPage = Math.max(1, Number(page) || 1);
    port.postMessage({ type: "SEARCH_RESULTS", keyword: String(keyword || ""), page: currentPage, context: String(context || ""), videos: await searchVideos(keyword, currentPage) });
  } catch (error) {
    port.postMessage({ type: "NOTICE", context: String(context || ""), message: `搜索失败：${describeError(error)}` });
  }
}

async function sendFavoriteResources(port, folderId, page = 1) {
  try {
    const currentPage = Math.max(1, Number(page) || 1);
    port.postMessage({ type: "FAVORITE_RESOURCES", folderId: Number(folderId), page: currentPage, videos: await getFavoriteResources(folderId, currentPage) });
  } catch (error) {
    port.postMessage({ type: "NOTICE", message: `收藏夹加载失败：${describeError(error)}` });
  }
}

async function handleCommand(message) {
  switch (message.type) {
    case "PLAY_INPUT":
      try { await addInputAndPlay(message.input); } catch (error) { notice(describeError(error)); }
      break;
    case "TOGGLE":
      if (playerState.playing) await pause(); else await resume();
      break;
    case "PAUSE": await pause(); break;
    case "RESUME": await resume(); break;
    case "SEEK": await seek(message.position); break;
    case "PREVIOUS": await moveQueue(-1); break;
    case "NEXT": await moveQueue(1); break;
    case "PLAY_INDEX": await selectQueueIndex(message.index); break;
    case "REMOVE_INDEX": await removeQueueIndex(message.index); break;
    case "CLEAR_QUEUE": await clearQueue(); break;
    case "CYCLE_PLAY_MODE": await cyclePlayMode(); break;
    default: break;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bilibili-mini-popup") return;
  ports.add(port);
  port.onMessage.addListener(async (message) => {
    try {
      await initialize();
      if (message.type === "GET_STATE") {
        await syncFromPlayer();
        port.postMessage({ type: "STATE", state: publicState() });
      } else if (message.type === "GET_VIEW_SOURCE") await sendViewSource(port);
      else if (message.type === "GET_ACCOUNT") await sendAccount(port);
      else if (message.type === "LOGOUT_BILIBILI") await logoutBilibili();
      else if (message.type === "SWITCH_BILIBILI_ACCOUNT") {
        await logoutBilibili();
        await chrome.tabs.create({ url: "https://passport.bilibili.com/login" });
      }
      else if (message.type === "GET_HISTORY") await sendHistory(port);
      else if (message.type === "GET_REMOTE_HISTORY") await sendRemoteHistory(port, message.viewAt);
      else if (message.type === "GET_RECOMMENDATIONS") await sendRecommendations(port, message.page);
      else if (message.type === "GET_POPULAR") await sendPopular(port, message.page);
      else if (message.type === "GET_FOLLOWING") await sendFollowing(port, message.offset);
      else if (message.type === "SEARCH_VIDEOS") await sendSearch(port, message.keyword, message.page, message.context);
      else if (message.type === "GET_FAVORITE_RESOURCES") await sendFavoriteResources(port, message.folderId, message.page);
      else if (message.type === "OPEN_BILIBILI_LOGIN") await chrome.tabs.create({ url: "https://www.bilibili.com/" });
      else await handleCommand(message);
    } catch (error) {
      notice(describeError(error));
    }
  });
  port.onDisconnect.addListener(() => ports.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PLAYER_EVENT") {
    (async () => {
      await initialize();
      if (message.requestId && message.requestId !== requestId) return;
      // A failed initial load reports both a media event and the command
      // response. The command owns its sequential backup-URL retry loop, so
      // handling the event here would race it and replace the source twice.
      if (message.event === "ERROR" && pendingStartRequests.has(message.requestId)) return;
      if (message.event === "PLAYING") {
        playerState.playing = true;
        playerState.error = "";
      } else if (message.event === "PAUSED") {
        playerState.playing = false;
      } else if (message.event === "PROGRESS") {
        playerState.currentTime = message.currentTime;
        playerState.duration = message.duration || playerState.duration;
      } else if (message.event === "ENDED") {
        playerState.playing = false;
        await moveQueue(1, { automatic: true });
      } else if (message.event === "ERROR") {
        await recoverPlayback(message.currentTime || playerState.currentTime);
        return;
      }
      const persist = message.event !== "PROGRESS" || Date.now() - lastPersistAt > 3000;
      if (persist) lastPersistAt = Date.now();
      await publish({ persist });
    })().catch((error) => console.error("播放器事件处理失败", error));
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === "MEDIA_ACTION") {
    handleCommand({ type: message.command, position: message.position })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "MEDIA_ACTION_FAILED" }));
    return true;
  }
  return undefined;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) recoverPlayback(playerState.currentTime, "expiry");
});

initialize().catch((error) => console.error("播放器初始化失败", error));
