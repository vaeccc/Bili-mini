import { setIcon } from "./icons.js";

const placeholderImage = new URL("../icons/bilibili-128.png", import.meta.url).href;
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.src !== placeholderImage) image.src = placeholderImage;
}, true);

const status = document.querySelector("#status");
const accountAvatar = document.querySelector("#account-avatar");
const accountName = document.querySelector("#account-name");
const accountDetail = document.querySelector("#account-detail");
const accountAction = document.querySelector("#account-action");
const librarySection = document.querySelector(".library");
const feedPane = document.querySelector(".feed-pane");
const libraryContent = document.querySelector("#library-content");
const libraryHeading = document.querySelector("#library-heading");
const librarySubtitle = document.querySelector("#library-subtitle");
const videoShell = document.querySelector("#video-shell");
const playerPanel = document.querySelector("#player-panel");
const playerEmpty = document.querySelector("#player-empty");
const miniPlayer = document.querySelector("#mini-player");
const miniCoverButton = document.querySelector("#mini-cover-button");
const miniCover = document.querySelector("#mini-cover");
const miniInfo = document.querySelector("#mini-info");
const miniTitle = document.querySelector("#mini-title");
const miniSubtitle = document.querySelector("#mini-subtitle");
const miniPrevious = document.querySelector("#mini-previous");
const miniToggle = document.querySelector("#mini-toggle");
const miniNext = document.querySelector("#mini-next");
const miniCurrentTime = document.querySelector("#mini-current-time");
const miniDuration = document.querySelector("#mini-duration");
const miniProgress = document.querySelector("#mini-progress");
const video = document.querySelector("#video");
const videoRecovery = document.querySelector("#video-recovery");
const videoRecoveryText = document.querySelector("#video-recovery-text");
const videoRetry = document.querySelector("#video-retry");
const nowPlaying = document.querySelector("#now-playing");
const cover = document.querySelector("#cover");
const title = document.querySelector("#title");
const subtitle = document.querySelector("#subtitle");
const toggle = document.querySelector("#toggle");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const time = document.querySelector("#time");
const progress = document.querySelector("#progress");
const playMode = document.querySelector("#play-mode");
const clearQueue = document.querySelector("#clear-queue");
const queuePanel = document.querySelector("#queue-panel");
const queue = document.querySelector("#queue");

let currentState = null;
let accountRefreshPending = false;
let loadedVideoItemId = "";
let requestedVideoItemId = "";
let videoUrls = [];
let videoUrlIndex = 0;
let videoReady = false;
let desiredVideoTime = 0;
let videoExpiresAt = 0;
let videoSyncTimer = null;
let videoSourceRetryItemId = "";
let videoSourceRetryCount = 0;
let progressSeeking = false;
let queueSignature = "";
let feedObserver = null;
let feedFlowTimer = null;
let videoRequestId = 0;
let searchRequestId = 0;
let historyRequestId = 0;
let favoriteRequestId = 0;
let followingRequestId = 0;
let popularRequestId = 0;
let historyEmptyPages = 0;
let favoriteEmptyPages = 0;
let searchDraft = "";
let searchComposing = false;
let foldersLoaded = false;
let foldersError = "";
const TOPIC_PAGES = {
  music: { heading: "音乐", subtitle: "音乐相关视频", keyword: "音乐" },
  live: { heading: "直播", subtitle: "直播相关视频", keyword: "直播" },
  anime: { heading: "番剧", subtitle: "番剧相关视频", keyword: "番剧" },
  manga: { heading: "漫画", subtitle: "漫画相关视频", keyword: "漫画" },
  article: { heading: "专栏", subtitle: "专栏相关视频", keyword: "专栏" }
};
const library = { tab: "recommend", account: null, recommendations: [], recommendationsLoaded: false, recommendationsLoading: false, recommendationsError: "", recommendationsPage: 0, recommendationsComplete: false, popular: [], popularLoaded: false, popularLoading: false, popularError: "", popularPage: 0, popularComplete: false, topicFeeds: {}, folders: [], selectedFolder: null, favoriteVideos: [], favoritePage: 0, favoriteLoading: false, favoriteError: "", favoriteComplete: false, historyItems: [], remoteHistoryItems: [], remoteHistoryCursor: "", remoteHistoryLoaded: false, remoteHistoryLoading: false, remoteHistoryError: "", remoteHistoryComplete: false, followingVideos: [], followingOffset: "", followingLoaded: false, followingLoading: false, followingError: "", followingComplete: false, searchKeyword: "", searchResults: [], searchLoading: false, searchError: "", searchPage: 0, searchComplete: false };

const port = chrome.runtime.connect({ name: "bilibili-mini-popup" });

function formatTime(total) {
  const seconds = Math.max(0, Math.floor(Number(total) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatHistoryTime(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (!Number.isFinite(date.getTime()) || Number(timestamp) <= 0) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setCoverSource(image, source) {
  const requested = source || placeholderImage;
  // Progress events must not keep retrying an image that already fell back.
  if (image.dataset.requestedSource === requested) return;
  image.dataset.requestedSource = requested;
  image.src = requested;
}

function formatCount(value) {
  const count = Number(value) || 0;
  if (count >= 100000000) return `${(count / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (count >= 10000) return `${(count / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return count ? String(count) : "";
}

function videoMeta(item) {
  return [item?.owner || item?.bvid, item?.duration ? formatTime(item.duration) : "", item?.views ? `${formatCount(item.views)}播放` : ""]
    .filter(Boolean)
    .join(" · ");
}

function isGenericPageTitle(value) {
  return /^video[_-]?\d/i.test(String(value || ""));
}

function displayVideoTitle(item) {
  return item?.videoTitle || item?.title || "未命名视频";
}

function displayPart(item) {
  const page = Number(item?.page) || 1;
  const part = String(item?.title || "").trim();
  if (!part || part === item?.videoTitle || isGenericPageTitle(part)) return `P${page}`;
  return `P${page} · ${part}`;
}

function playerPageVisible() {
  return library.tab === "player";
}

function syncPlayerVisibility() {
  const visible = playerPageVisible();
  playerPanel.hidden = !visible;
  if (!visible) {
    videoShell.hidden = true;
    if (loadedVideoItemId || requestedVideoItemId || video.src) releaseVideo();
  }
  return visible;
}

function render(nextState) {
  if (nextState.currentItem?.id !== currentState?.currentItem?.id) {
    releaseVideo();
    videoSourceRetryItemId = "";
    videoSourceRetryCount = 0;
  }
  currentState = nextState;
  const showPlayer = syncPlayerVisibility();
  const item = nextState.currentItem;
  const queueLength = (nextState.queue || []).length;
  const index = Number(nextState.currentIndex);
  const hasSelection = Boolean(item) && index >= 0 && index < queueLength;
  const ordered = nextState.playMode === "ORDER" || nextState.playMode === "ONE";
  const previousUnavailable = !hasSelection || (ordered && index === 0);
  const nextUnavailable = !hasSelection || (ordered && index === queueLength - 1) || (nextState.playMode === "SHUFFLE" && queueLength < 2);
  const showMiniPlayer = Boolean(item) && !showPlayer;
  miniPlayer.hidden = !showMiniPlayer;
  playerEmpty.hidden = Boolean(item);
  nowPlaying.hidden = !item;
  toggle.disabled = !item;
  previous.disabled = previousUnavailable;
  next.disabled = nextUnavailable;
  previous.title = hasSelection && previousUnavailable ? "已经是第一首" : "上一首";
  next.title = hasSelection && nextUnavailable ? (nextState.playMode === "SHUFFLE" ? "没有其他播放项" : "已经是最后一首") : "下一首";
  progress.disabled = !item;
  miniProgress.disabled = !item;
  if (item) {
    setCoverSource(cover, item.cover);
    cover.alt = item.videoTitle || item.title || "视频封面";
    title.textContent = displayVideoTitle(item);
    title.title = title.textContent;
    subtitle.textContent = displayPart(item);
    subtitle.title = subtitle.textContent;
  }
  document.querySelector(".playing-pulse").hidden = !item || !nextState.playing;
  setIcon(toggle, nextState.playing ? "pauseCircle" : "playCircle");
  toggle.title = nextState.playing ? "暂停" : "播放";
  toggle.setAttribute("aria-label", toggle.title);
  progress.max = String(nextState.duration || item?.duration || 0);
  if (!progressSeeking) progress.value = String(Math.min(Number(progress.max), nextState.currentTime || 0));
  updateProgressFill(progress);
  time.textContent = `${formatTime(nextState.currentTime)} / ${formatTime(nextState.duration || item?.duration)}`;
  miniPrevious.disabled = previousUnavailable;
  miniToggle.disabled = !item;
  miniNext.disabled = nextUnavailable;
  miniPrevious.title = previous.title;
  miniNext.title = next.title;
  clearQueue.disabled = queueLength === 0;
  if (item) {
    setCoverSource(miniCover, item.cover);
    miniCover.alt = item.videoTitle || item.title || "视频封面";
    miniTitle.textContent = displayVideoTitle(item);
    miniSubtitle.textContent = displayPart(item);
    miniInfo.title = `${miniTitle.textContent} · ${miniSubtitle.textContent}`;
  }
  setIcon(miniToggle, nextState.playing ? "pauseCircle" : "playCircle");
  miniToggle.title = nextState.playing ? "暂停" : "播放";
  miniToggle.setAttribute("aria-label", miniToggle.title);
  miniProgress.max = String(nextState.duration || item?.duration || 0);
  if (!progressSeeking) miniProgress.value = String(Math.min(Number(miniProgress.max), nextState.currentTime || 0));
  updateProgressFill(miniProgress);
  miniCurrentTime.textContent = formatTime(nextState.currentTime);
  miniDuration.textContent = formatTime(nextState.duration || item?.duration);
  const modeLabels = { ORDER: "顺序播放", LOOP: "列表循环", ONE: "单曲循环", SHUFFLE: "随机播放" };
  playMode.textContent = modeLabels[nextState.playMode] || modeLabels.ORDER;
  const nextQueue = nextState.queue || [];
  const nextQueueSignature = `${nextState.currentIndex}|${nextQueue.map((queueItem) => `${queueItem.id || queueItem.bvid || ""}:${queueItem.page || 1}:${displayVideoTitle(queueItem)}`).join("\u001f")}`;
  if (nextQueueSignature !== queueSignature) {
    queueSignature = nextQueueSignature;
    const queueItems = nextQueue.map((queueItem, index) => {
    const row = document.createElement("li");
    row.className = "queue-row";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-current", String(index === nextState.currentIndex));
    button.title = `${displayVideoTitle(queueItem)} · ${displayPart(queueItem)}`;
    const number = document.createElement("span");
    number.className = "queue-number";
    number.textContent = String(index + 1);
    const itemTitle = document.createElement("span");
    itemTitle.className = "queue-title";
    itemTitle.textContent = `${displayVideoTitle(queueItem)} · ${displayPart(queueItem)}`;
    button.append(number, itemTitle);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-remove";
    remove.dataset.removeIndex = String(index);
    remove.setAttribute("aria-label", `移除${displayVideoTitle(queueItem)}`);
    remove.title = "从播放列表移除";
    setIcon(remove, "x");
    row.append(button, remove);
    return row;
    });
    queue.replaceChildren(...queueItems);
    if (!queueItems.length) {
      const empty = document.createElement("li");
      empty.className = "queue-empty";
      empty.textContent = "播放列表为空，从推荐、搜索或收藏中选择视频即可播放。";
      queue.append(empty);
    }
  }
  if (nextState.error) status.textContent = nextState.error;
  if (!showPlayer) {
    videoShell.hidden = true;
  } else if (!item || !nextState.playing) {
    videoShell.hidden = true;
    releaseVideo();
  } else if (loadedVideoItemId !== item.id && requestedVideoItemId !== item.id) {
    requestVideoSource();
  }
  syncVideo(nextState);
}

function command(type, detail = {}) {
  port.postMessage({ type, ...detail });
}

function makeVideoList(videos) {
  const list = document.createElement("ul");
  list.className = "video-list";
  for (const item of videos) {
    const row = document.createElement("li");
    const play = document.createElement("button");
    play.type = "button";
    play.className = "video-entry";
    const page = Number(item.page) || 1;
    play.dataset.playBvid = page > 1 ? `${item.bvid}?p=${page}` : item.bvid;
    const itemLabel = displayVideoTitle(item);
    play.title = `播放《${itemLabel}》${page > 1 ? `（P${page}）` : ""}`;
    play.setAttribute("aria-label", play.title);
    const coverWrap = document.createElement("span");
    coverWrap.className = "video-cover";
    const image = document.createElement("img");
    image.src = item.cover || placeholderImage;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    coverWrap.append(image);
    if (item.historyProgress != null && item.duration > 0 && item.historyProgress >= 0) {
      const amount = Math.min(100, Math.max(0, item.historyProgress / item.duration * 100));
      const bar = document.createElement("span");
      bar.className = "history-progress";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.width = `${amount}%`;
      bar.append(fill);
      coverWrap.append(bar);
    }
    const copy = document.createElement("div");
    copy.className = "video-copy";
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = itemLabel;
    itemTitle.title = itemLabel;
    const owner = document.createElement("span");
    owner.className = "video-meta";
    owner.title = videoMeta(item);
    owner.classList.toggle("has-duration", Boolean(item.duration));
    const author = document.createElement("span");
    author.className = "video-meta-owner";
    author.textContent = item.owner || item.bvid || "";
    owner.append(author);
    if (item.duration) {
      const duration = document.createElement("span");
      duration.className = "video-meta-duration";
      duration.textContent = formatTime(item.duration);
      owner.append(duration);
    }
    if (item.views) {
      const views = document.createElement("span");
      views.className = "video-meta-views";
      views.textContent = `${formatCount(item.views)}播放`;
      owner.append(views);
    }
    copy.append(itemTitle, owner);
    play.append(coverWrap, copy);
    row.append(play);
    list.append(row);
  }
  return list;
}

function makeFeaturedVideo(item) {
  const card = document.createElement("section");
  card.className = "featured-video";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "featured-video-button";
  const page = Number(item.page) || 1;
  const itemLabel = displayVideoTitle(item);
  play.dataset.playBvid = page > 1 ? `${item.bvid}?p=${page}` : item.bvid;
  play.title = `播放《${itemLabel}》${page > 1 ? `（P${page}）` : ""}`;
  play.setAttribute("aria-label", play.title);
  const image = document.createElement("img");
  image.src = item.cover || placeholderImage;
  image.alt = "";
  const copy = document.createElement("span");
  copy.className = "featured-video-copy";
  const kicker = document.createElement("small");
  kicker.textContent = "今日推荐";
  const itemTitle = document.createElement("strong");
  itemTitle.textContent = itemLabel;
  itemTitle.title = itemLabel;
  const owner = document.createElement("span");
  owner.textContent = videoMeta(item) || "B站视频";
  copy.append(kicker, itemTitle, owner);
  play.append(image, copy);
  card.append(play);
  return card;
}

function makeHistoryList(items) {
  return makeVideoList(items.map((item) => ({
    ...item,
    title: displayVideoTitle(item),
    owner: item.viewAt ? formatHistoryTime(item.viewAt) : displayPart(item),
    historyProgress: item.progress
  })));
}

function makeLibraryState(text, options = {}) {
  const { kind = "empty", actionLabel = "", onAction = null } = options;
  const state = document.createElement("div");
  state.className = `library-state is-${kind}`;
  state.setAttribute("role", kind === "error" ? "alert" : "status");
  if (kind === "loading") state.setAttribute("aria-busy", "true");
  const icon = document.createElement("span");
  icon.className = "library-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = kind === "loading" ? "…" : kind === "error" ? "!" : "♪";
  const message = document.createElement("p");
  message.textContent = text;
  if (kind !== "empty") state.append(icon);
  state.append(message);
  if (actionLabel && onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "state-action";
    action.textContent = actionLabel;
    action.addEventListener("click", onAction);
    state.append(action);
  }
  return state;
}

function requestRecommendations(page = 1) {
  if (library.recommendationsLoading || library.recommendationsComplete) return;
  library.recommendationsError = "";
  library.recommendationsLoading = true;
  command("GET_RECOMMENDATIONS", { page });
}

function requestPopular(page = 1) {
  if (library.popularLoading || library.popularComplete) return;
  library.popularError = "";
  library.popularLoading = true;
  command("GET_POPULAR", { page, requestId: ++popularRequestId });
}

function refreshPopular() {
  popularRequestId += 1;
  library.popular = [];
  library.popularLoaded = false;
  library.popularLoading = false;
  library.popularError = "";
  library.popularPage = 0;
  library.popularComplete = false;
}

function requestSearch(page = 1) {
  if (!library.searchKeyword || library.searchLoading || library.searchComplete) return;
  library.searchLoading = true;
  library.searchError = "";
  command("SEARCH_VIDEOS", { keyword: library.searchKeyword, page, requestId: ++searchRequestId });
}

function getTopicFeed(tab) {
  if (!library.topicFeeds[tab]) {
    library.topicFeeds[tab] = { videos: [], loaded: false, loading: false, error: "", page: 0, complete: false };
  }
  return library.topicFeeds[tab];
}

function requestTopic(tab, page = 1) {
  const config = TOPIC_PAGES[tab];
  const feed = getTopicFeed(tab);
  if (!config || feed.loading || feed.complete) return;
  feed.loading = true;
  feed.error = "";
  command("SEARCH_VIDEOS", { keyword: config.keyword, page, context: tab });
}

function requestFavoriteResources(page = 1) {
  if (!library.selectedFolder || library.favoriteLoading || library.favoriteComplete) return;
  library.favoriteLoading = true;
  library.favoriteError = "";
  command("GET_FAVORITE_RESOURCES", { folderId: library.selectedFolder.id, page, requestId: ++favoriteRequestId });
}

function requestRemoteHistory() {
  if (!library.account?.loggedIn || library.remoteHistoryLoading || library.remoteHistoryComplete) return;
  library.remoteHistoryLoading = true;
  library.remoteHistoryError = "";
  command("GET_REMOTE_HISTORY", { viewAt: library.remoteHistoryCursor, requestId: ++historyRequestId });
}

function refreshRemoteHistory() {
  historyRequestId += 1;
  historyEmptyPages = 0;
  library.remoteHistoryItems = [];
  library.remoteHistoryCursor = "";
  library.remoteHistoryLoaded = false;
  library.remoteHistoryLoading = false;
  library.remoteHistoryError = "";
  library.remoteHistoryComplete = false;
  if (library.account?.loggedIn) requestRemoteHistory();
}

function requestFollowing() {
  if (!library.account?.loggedIn || library.followingLoading || library.followingComplete) return;
  library.followingLoading = true;
  library.followingError = "";
  command("GET_FOLLOWING", { offset: library.followingOffset, requestId: ++followingRequestId });
}

function isFeedTab(tab = library.tab) {
  return tab === "search" || tab === "home" || tab === "recommend" || Boolean(TOPIC_PAGES[tab]) || (tab === "favorites" && Boolean(library.selectedFolder)) || (tab === "history" && Boolean(library.account?.loggedIn)) || (tab === "following" && Boolean(library.account?.loggedIn));
}

function currentFeedError() {
  if (library.tab === "search") return library.searchError;
  if (library.tab === "home") return library.recommendationsError;
  if (library.tab === "recommend") return library.popularError;
  if (TOPIC_PAGES[library.tab]) return getTopicFeed(library.tab).error;
  if (library.tab === "favorites") return library.favoriteError;
  if (library.tab === "history") return library.remoteHistoryError;
  if (library.tab === "following") return library.followingError;
  return "";
}

function retryCurrentFeed() {
  if (library.tab === "search") library.searchError = "";
  if (library.tab === "home") library.recommendationsError = "";
  if (library.tab === "recommend") library.popularError = "";
  if (TOPIC_PAGES[library.tab]) getTopicFeed(library.tab).error = "";
  if (library.tab === "favorites") { library.favoriteError = ""; favoriteEmptyPages = 0; }
  if (library.tab === "history") { library.remoteHistoryError = ""; historyEmptyPages = 0; }
  if (library.tab === "following") library.followingError = "";
  status.textContent = "";
  requestCurrentFeedPage();
  renderLibrary();
}

function appendFeedFooter(complete, loading) {
  const error = currentFeedError();
  if (error) {
    libraryContent.append(makeLibraryState(error, { kind: "error", actionLabel: "重试", onAction: retryCurrentFeed }));
    return;
  }
  const footer = document.createElement("p");
  footer.className = complete ? "feed-end" : "load-more";
  footer.textContent = complete ? "已显示全部内容" : loading ? "正在加载更多…" : "继续下滑加载更多";
  libraryContent.append(footer);
}

function requestCurrentFeedPage() {
  const loading = () => ({
    search: library.searchLoading, home: library.recommendationsLoading,
    recommend: library.popularLoading, favorites: library.favoriteLoading,
    history: library.remoteHistoryLoading, following: library.followingLoading
  }[library.tab] || library.topicFeeds[library.tab]?.loading);
  if (currentFeedError() || loading()) return;
  if (library.tab === "search") requestSearch(library.searchPage + 1);
  else if (library.tab === "home") requestRecommendations(library.recommendationsPage + 1);
  else if (library.tab === "recommend") requestPopular(library.popularPage + 1);
  else if (TOPIC_PAGES[library.tab]) requestTopic(library.tab, getTopicFeed(library.tab).page + 1);
  else if (library.tab === "favorites" && library.selectedFolder) requestFavoriteResources(library.favoritePage + 1);
  else if (library.tab === "history" && library.account?.loggedIn) requestRemoteHistory();
  else if (library.tab === "following" && library.account?.loggedIn) requestFollowing();
  if (loading()) renderLibrary();
}

function observeFeedEnd() {
  if (feedObserver) feedObserver.disconnect();
  feedObserver = null;
  if (!isFeedTab() || library.tab === "player") return;
  const sentinel = libraryContent.querySelector(".load-more");
  if (!sentinel) return;
  feedObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) requestCurrentFeedPage();
  }, { root: feedPane, rootMargin: "0px 0px 180px 0px" });
  feedObserver.observe(sentinel);
}

function fillFeedViewport() {
  if (!isFeedTab() || library.tab === "player" || feedPane.scrollHeight > feedPane.clientHeight + 100) return;
  requestCurrentFeedPage();
}

function scheduleFeedFlow() {
  clearTimeout(feedFlowTimer);
  feedFlowTimer = setTimeout(() => {
    observeFeedEnd();
    fillFeedViewport();
  }, 0);
}

function renderTopicPage(tab) {
  const config = TOPIC_PAGES[tab];
  const feed = getTopicFeed(tab);
  libraryHeading.textContent = config.heading;
  librarySubtitle.textContent = config.subtitle;
  if (!feed.videos.length) {
    const message = feed.error || (feed.loading ? "正在加载内容…" : (feed.loaded ? "暂时没有相关内容。" : "准备加载内容…"));
    libraryContent.append(makeLibraryState(message, {
      kind: feed.error ? "error" : (feed.loaded ? "empty" : "loading"),
      actionLabel: feed.error ? "重新加载" : "",
      onAction: feed.error ? () => {
        feed.loaded = false;
        feed.complete = false;
        feed.error = "";
        renderLibrary();
      } : null
    }));
    if (!feed.loaded) {
      feed.loaded = true;
      requestTopic(tab, 1);
    }
    return;
  }
  libraryContent.append(makeVideoList(feed.videos));
  appendFeedFooter(feed.complete, feed.loading);
}

function renderSearchPage() {
  libraryHeading.textContent = "搜索";
  librarySubtitle.textContent = library.searchKeyword ? `搜索：${library.searchKeyword}` : "站内视频搜索";
  const form = document.createElement("form");
  form.className = "search-form";
  const input = document.createElement("input");
  input.type = "search";
  input.value = searchDraft;
  input.placeholder = "搜索视频、音乐或 UP 主";
  input.setAttribute("aria-label", "搜索 B 站视频");
  input.addEventListener("input", () => { searchDraft = input.value; });
  input.addEventListener("compositionstart", () => { searchComposing = true; });
  input.addEventListener("compositionend", () => {
    searchComposing = false;
    searchDraft = input.value;
    renderLibrary();
  });
  const submit = document.createElement("button");
  submit.type = "submit";
  setIcon(submit, "search", "搜索");
  submit.setAttribute("aria-label", "搜索");
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.isComposing || searchComposing) return;
    const keyword = input.value.trim();
    if (!keyword) return;
    library.searchKeyword = keyword;
    searchDraft = keyword;
    library.searchResults = [];
    library.searchLoading = false;
    library.searchError = "";
    library.searchPage = 0;
    library.searchComplete = false;
    renderLibrary();
    requestSearch(1);
    renderLibrary();
  });
  libraryContent.append(form);
  if (!library.searchKeyword) {
    libraryContent.append(makeLibraryState("输入关键词搜索 B 站视频。"));
    return;
  }
  if (library.searchLoading && !library.searchResults.length) {
    libraryContent.append(makeLibraryState("正在搜索…", { kind: "loading" }));
    return;
  }
  if (library.searchError && !library.searchResults.length) {
    libraryContent.append(makeLibraryState(library.searchError, { kind: "error", actionLabel: "重试", onAction: retryCurrentFeed }));
    return;
  }
  if (library.searchResults.length) {
    libraryContent.append(makeVideoList(library.searchResults));
    appendFeedFooter(library.searchComplete, library.searchLoading);
  } else {
    libraryContent.append(makeLibraryState("没有找到相关视频。"));
  }
}

function renderAccount() {
  const account = library.account;
  document.querySelector("#account-panel").classList.toggle("logged-in", Boolean(account?.loggedIn));
  if (!account?.loggedIn) {
    accountAvatar.hidden = true;
    accountAvatar.removeAttribute("src");
    accountName.textContent = "未登录 B站";
    accountDetail.textContent = "登录后可查看自己的收藏夹";
    accountAction.textContent = "去登录";
    accountAction.title = "前往 B站登录";
    accountAction.setAttribute("aria-label", "前往 B站登录");
    return;
  }
  accountAvatar.hidden = !account.avatar;
  accountAvatar.src = account.avatar || "";
  accountAvatar.alt = `${account.name} 的头像`;
  accountAvatar.title = account.name;
  accountName.textContent = account.name;
  accountDetail.textContent = "已登录";
  accountAction.textContent = "↻";
  accountAction.title = "刷新账号状态";
  accountAction.setAttribute("aria-label", "刷新账号状态");
}

function renderLibrary() {
  // Keep drafts, focus and Chinese IME composition across async list updates.
  if (searchComposing && library.tab === "search") return;
  searchComposing = false;
  const searchInput = libraryContent.querySelector('.search-form input');
  const focused = searchInput && document.activeElement === searchInput && library.tab === "search";
  const selection = focused ? [searchInput.selectionStart, searchInput.selectionEnd] : null;
  const scrollTop = feedPane.scrollTop;
  renderLibraryContent();
  if (focused) {
    const replacement = libraryContent.querySelector('.search-form input');
    replacement?.focus({ preventScroll: true });
    if (replacement && selection[0] !== null) replacement.setSelectionRange(...selection);
  }
  feedPane.scrollTop = scrollTop;
}

function renderLibraryContent() {
  librarySubtitle.removeAttribute("title");
  librarySection.classList.toggle("hide-section-heading", library.tab !== "search");
  document.querySelectorAll("[data-library-tab], [data-account-tab]").forEach((button) => {
    const active = (button.dataset.libraryTab || button.dataset.accountTab) === library.tab;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const playerVisible = library.tab === "player";
  librarySection.hidden = playerVisible;
  queuePanel.hidden = !playerVisible;
  playerPanel.hidden = !playerVisible;
  libraryContent.replaceChildren();
  scheduleFeedFlow();
  if (playerVisible) return;
  if (library.tab === "account") {
    libraryHeading.textContent = "我的主页";
    librarySubtitle.textContent = "账号内容";
    const account = library.account;
    if (!account?.loggedIn) {
      libraryContent.append(makeLibraryState("登录 B站后查看你的关注、收藏和历史。", {
        actionLabel: "去 B站登录",
        onAction: () => command("OPEN_BILIBILI_LOGIN")
      }));
      return;
    }
    const summary = document.createElement("div");
    summary.className = "account-library-card";
    const avatar = document.createElement("img");
    avatar.src = account.avatar || placeholderImage;
    avatar.alt = `${account.name} 的头像`;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = account.name || "B站用户";
    name.title = name.textContent;
    const meta = document.createElement("div");
    meta.className = "account-meta";
    const detail = document.createElement("span");
    detail.textContent = account.level ? `B站 Lv.${account.level}` : "B站账号";
    const loginStatus = document.createElement("span");
    loginStatus.className = "account-status";
    loginStatus.textContent = "已登录";
    meta.append(detail, loginStatus);
    copy.append(name, meta);
    summary.append(avatar, copy);
    libraryContent.append(summary);
    if (Number.isSafeInteger(account.mid) && account.mid > 0) {
      const uidRow = document.createElement("div");
      uidRow.className = "account-uid";
      const uid = document.createElement("span");
      uid.textContent = `UID：${account.mid}`;
      const copyUid = document.createElement("button");
      copyUid.type = "button";
      copyUid.textContent = "复制";
      copyUid.setAttribute("aria-label", `复制 UID ${account.mid}`);
      copyUid.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(account.mid));
          status.textContent = "UID 已复制";
        } catch (_) {
          status.textContent = "复制失败，请手动选择 UID";
        }
      });
      uidRow.append(uid, copyUid);
      libraryContent.append(uidRow);
    }
    const membership = document.createElement("section");
    membership.className = "account-membership";
    const membershipLabel = document.createElement("span");
    membershipLabel.textContent = "大会员";
    const membershipStatus = document.createElement("strong");
    membershipStatus.textContent = account.vipActive === true ? "已开通" : account.vipActive === false ? "未开通" : "状态未知";
    membershipStatus.classList.toggle("is-active", account.vipActive === true);
    membership.append(membershipLabel, membershipStatus);
    libraryContent.append(membership);
    const management = document.createElement("section");
    management.className = "account-management";
    const heading = document.createElement("strong");
    heading.textContent = "账号管理";
    const headingRow = document.createElement("div");
    headingRow.className = "account-management-heading";
    const refreshAccount = document.createElement("button");
    refreshAccount.type = "button";
    refreshAccount.textContent = accountRefreshPending ? "刷新中…" : "刷新状态";
    refreshAccount.disabled = accountRefreshPending;
    refreshAccount.addEventListener("click", () => {
      if (accountRefreshPending) return;
      accountRefreshPending = true;
      refreshAccount.disabled = true;
      refreshAccount.textContent = "刷新中…";
      status.textContent = "正在刷新账号状态…";
      command("GET_ACCOUNT");
    });
    headingRow.append(heading, refreshAccount);
    const hint = document.createElement("p");
    hint.textContent = "切换或退出账号会同步退出此浏览器中的 B 站登录。";
    const accountActions = document.createElement("div");
    accountActions.className = "account-actions";
    const switchAccount = document.createElement("button");
    switchAccount.type = "button";
    switchAccount.textContent = "切换账号";
    switchAccount.addEventListener("click", () => {
      if (confirm("切换账号会退出当前 B 站账号，并打开登录页。")) command("SWITCH_BILIBILI_ACCOUNT");
    });
    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "退出登录";
    logout.addEventListener("click", () => {
      if (confirm("退出当前 B 站账号？此浏览器中的 B 站页面也会同步退出。")) command("LOGOUT_BILIBILI");
    });
    accountActions.append(switchAccount, logout);
    management.append(headingRow, hint, accountActions);
    libraryContent.append(management);
    return;
  }
  if (library.tab === "search") {
    renderSearchPage();
    return;
  }
  if (TOPIC_PAGES[library.tab]) {
    renderTopicPage(library.tab);
    return;
  }
  const listTabs = new Set(["home", "recommend"]);
  const headings = { home: ["主页", "首页推荐"], recommend: ["热门", "全站热门视频"] };
  if (listTabs.has(library.tab)) {
    const isPopular = library.tab === "recommend";
    const feed = isPopular ? {
      items: library.popular,
      loaded: library.popularLoaded,
      loading: library.popularLoading,
      error: library.popularError,
      complete: library.popularComplete
    } : {
      items: library.recommendations,
      loaded: library.recommendationsLoaded,
      loading: library.recommendationsLoading,
      error: library.recommendationsError,
      complete: library.recommendationsComplete
    };
    [libraryHeading.textContent, librarySubtitle.textContent] = headings[library.tab];
    if (!feed.items.length) {
      libraryContent.append(makeLibraryState(feed.loading ? "正在加载内容…" : (feed.error || (feed.loaded ? "暂时没有可显示的内容。" : "准备加载内容…")), {
        kind: feed.error ? "error" : feed.loaded && !feed.loading ? "empty" : "loading",
        actionLabel: feed.error ? "重新加载" : "",
        onAction: feed.error ? () => {
          if (isPopular) {
            library.popularError = "";
            library.popularLoaded = false;
            library.popularComplete = false;
          } else {
            library.recommendationsError = "";
            library.recommendationsLoaded = false;
            library.recommendationsComplete = false;
          }
          renderLibrary();
        } : null
      }));
      if (!feed.loaded) {
        if (isPopular) {
          library.popularLoaded = true;
          requestPopular(1);
        } else {
          library.recommendationsLoaded = true;
          requestRecommendations(1);
        }
      }
      return;
    }
    if (library.tab === "home" && feed.items.length > 1) {
      libraryContent.append(makeFeaturedVideo(feed.items[0]));
      libraryContent.append(makeVideoList(feed.items.slice(1)));
    } else {
      libraryContent.append(makeVideoList(feed.items));
    }
    appendFeedFooter(feed.complete, feed.loading);
    return;
  }
  if (library.tab === "history") {
    libraryHeading.textContent = "历史";
    if (!library.account?.loggedIn) {
      librarySubtitle.textContent = "本地播放记录";
      if (library.historyItems.length) libraryContent.append(makeHistoryList(library.historyItems));
      else libraryContent.append(makeLibraryState("还没有播放历史。"));
      return;
    }
    librarySubtitle.textContent = "B站账号观看记录";
    if (library.remoteHistoryError && !library.remoteHistoryItems.length) {
      libraryContent.append(makeLibraryState(library.remoteHistoryError, {
        kind: "error",
        actionLabel: "重新加载",
        onAction: () => {
          library.remoteHistoryError = "";
          historyEmptyPages = 0;
          library.remoteHistoryLoaded = false;
          library.remoteHistoryComplete = false;
          requestRemoteHistory();
          renderLibrary();
        }
      }));
      return;
    }
    if (!library.remoteHistoryItems.length && !library.remoteHistoryLoaded) {
      libraryContent.append(makeLibraryState(library.remoteHistoryLoading ? "正在加载 B站历史…" : "准备加载 B站历史…", { kind: "loading" }));
      if (!library.remoteHistoryLoading) requestRemoteHistory();
      return;
    }
    if (library.remoteHistoryItems.length) {
      libraryContent.append(makeHistoryList(library.remoteHistoryItems));
      appendFeedFooter(library.remoteHistoryComplete, library.remoteHistoryLoading);
    } else if (library.remoteHistoryComplete) {
      libraryContent.append(makeLibraryState("B站暂无可显示的视频观看历史。"));
    } else {
      libraryContent.append(makeLibraryState(library.remoteHistoryLoading ? "正在加载 B站历史…" : "正在查找视频观看记录…", { kind: "loading" }));
      appendFeedFooter(false, library.remoteHistoryLoading);
    }
    return;
  }
  if (library.tab === "following") {
    libraryHeading.textContent = "特别关注";
    librarySubtitle.textContent = "B站关注内容";
    if (!library.account?.loggedIn) {
      libraryContent.append(makeLibraryState("登录 B站后可查看特别关注内容。", {
        actionLabel: "去 B站登录",
        onAction: () => command("OPEN_BILIBILI_LOGIN")
      }));
      return;
    }
    if (library.followingError && !library.followingVideos.length) {
      libraryContent.append(makeLibraryState(library.followingError, {
        kind: "error",
        actionLabel: "重新加载",
        onAction: () => {
          library.followingError = "";
          library.followingLoaded = false;
          renderLibrary();
        }
      }));
      return;
    }
    if (!library.followingVideos.length && (!library.followingLoaded || library.followingLoading)) {
      libraryContent.append(makeLibraryState(library.followingLoading ? "正在加载特别关注…" : "准备加载特别关注…", { kind: "loading" }));
      if (!library.followingLoaded && !library.followingLoading) {
        requestFollowing();
      }
      return;
    }
    if (library.followingVideos.length) {
      libraryContent.append(makeVideoList(library.followingVideos));
      appendFeedFooter(library.followingComplete, library.followingLoading);
    } else {
      libraryContent.append(makeLibraryState("特别关注中暂时没有可播放的视频。"));
    }
    return;
  }
  if (library.tab !== "favorites") return;
  libraryHeading.textContent = "收藏";
  librarySubtitle.textContent = library.selectedFolder?.title || "我的收藏夹";
  librarySubtitle.title = librarySubtitle.textContent;
  if (!library.account?.loggedIn) {
    libraryContent.append(makeLibraryState("登录 B站后即可查看浏览器账号中的收藏夹。", {
      actionLabel: "去 B站登录",
      onAction: () => command("OPEN_BILIBILI_LOGIN")
    }));
    return;
  }
  if (library.selectedFolder) {
    const back = document.createElement("button");
    back.type = "button";
    back.dataset.backFolders = "true";
    back.className = "folder-back";
    back.title = `返回收藏夹列表：${library.selectedFolder.title}`;
    back.textContent = `← ${library.selectedFolder.title}`;
    libraryContent.append(back);
    if (library.favoriteError && !library.favoriteVideos.length) {
      libraryContent.append(makeLibraryState(library.favoriteError, {
        kind: "error",
        actionLabel: "重新加载",
        onAction: () => {
          library.favoriteError = "";
          library.favoriteComplete = false;
          favoriteEmptyPages = 0;
          requestFavoriteResources(library.favoritePage + 1);
          renderLibrary();
        }
      }));
    } else if (library.favoriteVideos.length) {
      libraryContent.append(makeVideoList(library.favoriteVideos));
      appendFeedFooter(library.favoriteComplete, library.favoriteLoading);
    } else if (library.favoriteComplete) {
      libraryContent.append(makeLibraryState("这个收藏夹还没有可播放的视频。"));
    } else {
      libraryContent.append(makeLibraryState(library.favoriteLoading ? "正在加载收藏夹视频…" : "准备加载收藏夹视频…", { kind: "loading" }));
      if (!library.favoriteLoading && !library.favoriteComplete) requestFavoriteResources(1);
    }
    return;
  }
  if (!library.folders.length) {
    libraryContent.append(makeLibraryState(foldersError || (foldersLoaded ? "暂无收藏夹。" : "正在加载收藏夹…"), {
      kind: foldersError ? "error" : foldersLoaded ? "empty" : "loading",
      actionLabel: foldersError ? "重试" : "",
      onAction: () => { foldersError = ""; foldersLoaded = false; command("GET_ACCOUNT"); renderLibrary(); }
    }));
    return;
  }
  const folders = document.createElement("div");
  folders.className = "folder-list";
  for (const folder of library.folders) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.folderId = String(folder.id);
    const image = document.createElement("img");
    const placeholder = new URL("./assets/folder-placeholder.svg", import.meta.url).href;
    image.addEventListener("error", () => { image.src = placeholder; }, { once: true });
    image.src = folder.cover || placeholder;
    image.alt = "";
    const folderTitle = document.createElement("span");
    folderTitle.textContent = folder.title;
    button.title = `${folder.title} · ${folder.count} 个视频`;
    const count = document.createElement("small");
    count.textContent = `${folder.count} 个视频`;
    button.append(image, folderTitle, count);
    folders.append(button);
  }
  libraryContent.append(folders);
}

function setVideoTime(position) {
  desiredVideoTime = Math.max(0, Number(position) || 0);
  if (!videoReady || !Number.isFinite(video.duration)) return;
  if (Math.abs(video.currentTime - desiredVideoTime) > 0.35) {
    video.currentTime = Math.min(desiredVideoTime, Math.max(0, video.duration - 0.05));
  }
}

function syncVideo(nextState = currentState) {
  if (!nextState?.currentItem || loadedVideoItemId !== nextState.currentItem.id) return;
  setVideoTime(nextState.currentTime);
  if (nextState.playing && videoReady && video.paused) video.play().catch(() => undefined);
  if (!nextState.playing && !video.paused) video.pause();
}

function releaseVideo() {
  videoRequestId += 1;
  videoRecovery.hidden = true;
  if (videoSyncTimer) clearInterval(videoSyncTimer);
  videoSyncTimer = null;
  video.pause();
  video.removeAttribute("src");
  video.load();
  videoUrls = [];
  videoExpiresAt = 0;
  videoReady = false;
  loadedVideoItemId = "";
  requestedVideoItemId = "";
}

function requestVideoSource(refresh = false) {
  if (!playerPageVisible() || !currentState?.playing || !currentState.currentItem) return;
  requestedVideoItemId = currentState.currentItem.id;
  videoRetry.disabled = true;
  videoRetry.textContent = "恢复中…";
  command("GET_VIEW_SOURCE", { refresh, requestId: ++videoRequestId });
}

function showVideoFailure(message) {
  const itemId = currentState?.currentItem?.id;
  releaseVideo();
  // Keep state updates from automatically retrying the same failed item.
  requestedVideoItemId = itemId || "";
  videoShell.hidden = true;
  videoRecoveryText.textContent = `${message}，可单独重试画面。`;
  videoRecovery.hidden = false;
  videoRetry.disabled = false;
  videoRetry.textContent = "重试画面";
}

videoRetry.addEventListener("click", () => {
  if (videoRetry.disabled) return;
  videoSourceRetryCount = 0;
  requestVideoSource(true);
});

function loadVideoSource(message) {
  if (!playerPageVisible() || !currentState?.playing || message.requestId !== videoRequestId || message.itemId !== currentState?.currentItem?.id) return;
  if (videoSourceRetryItemId !== message.itemId) {
    videoSourceRetryItemId = message.itemId;
    videoSourceRetryCount = 0;
  }
  releaseVideo();
  if (!message.urls?.length) return;
  loadedVideoItemId = message.itemId;
  requestedVideoItemId = message.itemId;
  videoUrls = message.urls;
  videoExpiresAt = Number(message.expiresAt) || 0;
  videoUrlIndex = 0;
  desiredVideoTime = message.startAt || 0;
  videoShell.hidden = false;
  video.src = videoUrls[videoUrlIndex];
  video.load();
  videoSyncTimer = setInterval(() => {
    if (videoExpiresAt && Date.now() >= videoExpiresAt - 30_000 && currentState?.currentItem?.id === message.itemId) {
      videoExpiresAt = 0;
      requestVideoSource(true);
      return;
    }
    syncVideo();
  }, 1000);
}

video.addEventListener("loadedmetadata", () => {
  videoReady = true;
  setVideoTime(desiredVideoTime);
  syncVideo();
});
video.addEventListener("error", () => {
  if (!playerPageVisible() || !currentState?.playing || loadedVideoItemId !== currentState.currentItem?.id || !videoUrls.length) return;
  videoReady = false;
  videoUrlIndex += 1;
  if (videoUrlIndex < videoUrls.length) {
    video.src = videoUrls[videoUrlIndex];
    video.load();
  } else {
    if (videoSourceRetryCount < 1 && currentState?.playing) {
      videoSourceRetryCount += 1;
      requestVideoSource(true);
      return;
    }
    showVideoFailure("视频画面加载失败");
  }
});

toggle.addEventListener("click", () => command("TOGGLE"));
previous.addEventListener("click", () => command("PREVIOUS"));
next.addEventListener("click", () => command("NEXT"));
function startSeeking() { progressSeeking = true; }
function updateProgressFill(control) {
  const max = Number(control.max) || 0;
  const value = Math.min(Math.max(0, Number(control.value) || 0), max);
  control.style.setProperty("--progress", max > 0 ? `${value / max * 100}%` : "0%");
  control.setAttribute("aria-valuetext", `${formatTime(value)} / ${formatTime(max)}`);
}
function commitSeek(control) {
  progressSeeking = false;
  command("SEEK", { position: Number(control.value) });
}
progress.addEventListener("pointerdown", startSeeking);
miniProgress.addEventListener("pointerdown", startSeeking);
progress.addEventListener("input", () => { startSeeking(); updateProgressFill(progress); time.textContent = `${formatTime(progress.value)} / ${formatTime(progress.max)}`; });
miniProgress.addEventListener("input", () => { startSeeking(); updateProgressFill(miniProgress); miniCurrentTime.textContent = formatTime(miniProgress.value); });
progress.addEventListener("change", () => commitSeek(progress));
miniProgress.addEventListener("change", () => commitSeek(miniProgress));
window.addEventListener("pointerup", () => { progressSeeking = false; });
window.addEventListener("pointercancel", () => { progressSeeking = false; });
miniPrevious.addEventListener("click", () => command("PREVIOUS"));
miniToggle.addEventListener("click", () => command("TOGGLE"));
miniNext.addEventListener("click", () => command("NEXT"));
function openPlayerPage() {
  library.tab = "player";
  status.textContent = "";
  renderLibrary();
  if (currentState) render(currentState);
}
miniCoverButton.addEventListener("click", openPlayerPage);
miniInfo.addEventListener("click", openPlayerPage);
playMode.addEventListener("click", () => command("CYCLE_PLAY_MODE"));
queue.addEventListener("click", (event) => {
  const remove = event.target.closest("button[data-remove-index]");
  if (remove) {
    command("REMOVE_INDEX", { index: Number(remove.dataset.removeIndex) });
    return;
  }
  const button = event.target.closest("button[data-index]");
  if (button) command("PLAY_INDEX", { index: Number(button.dataset.index) });
});
clearQueue.addEventListener("click", () => command("CLEAR_QUEUE"));
accountAction.addEventListener("click", () => {
  if (library.account?.loggedIn) command("GET_ACCOUNT");
  else command("OPEN_BILIBILI_LOGIN");
});
document.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => {
  library.tab = button.dataset.accountTab;
  if (library.tab === "history" && library.account?.loggedIn) refreshRemoteHistory();
  status.textContent = "";
  library.selectedFolder = null;
  library.favoriteVideos = [];
  renderLibrary();
  if (currentState) render(currentState);
}));
document.querySelectorAll("[data-library-tab]").forEach((button) => button.addEventListener("click", () => {
  library.tab = button.dataset.libraryTab;
  if (library.tab === "recommend") {
    refreshPopular();
    feedPane.scrollTop = 0;
  }
  status.textContent = "";
  library.selectedFolder = null;
  library.favoriteVideos = [];
  renderLibrary();
  if (currentState) render(currentState);
}));
feedPane.addEventListener("scroll", () => {
  if (!isFeedTab()) return;
  if (feedPane.scrollTop + feedPane.clientHeight < feedPane.scrollHeight - 120) return;
  requestCurrentFeedPage();
});
libraryContent.addEventListener("click", (event) => {
  const play = event.target.closest("button[data-play-bvid]");
  const folder = event.target.closest("button[data-folder-id]");
  const retryFollowing = event.target.closest("button[data-retry-following]");
  if (play) {
    status.textContent = "正在加入播放队列…";
    command("PLAY_INPUT", { input: play.dataset.playBvid });
  } else if (folder) {
    favoriteRequestId += 1;
    favoriteEmptyPages = 0;
    library.selectedFolder = library.folders.find((item) => item.id === Number(folder.dataset.folderId)) || null;
    library.favoriteVideos = [];
    library.favoritePage = 0;
    library.favoriteLoading = false;
    library.favoriteError = "";
    library.favoriteComplete = false;
    renderLibrary();
  } else if (event.target.closest("button[data-back-folders]")) {
    favoriteRequestId += 1;
    library.selectedFolder = null;
    library.favoriteVideos = [];
    library.favoritePage = 0;
    library.favoriteLoading = false;
    library.favoriteError = "";
    library.favoriteComplete = false;
    renderLibrary();
  } else if (event.target.closest("button[data-open-login]")) {
    command("OPEN_BILIBILI_LOGIN");
  } else if (retryFollowing) {
    library.followingError = "";
    library.followingLoaded = false;
    renderLibrary();
  }
});

port.onMessage.addListener((message) => {
  if (message.type === "STATE") render(message.state);
  if (message.type === "VIEW_SOURCE") loadVideoSource(message);
  if (message.type === "ACCOUNT") {
    if (accountRefreshPending) {
      accountRefreshPending = false;
      status.textContent = "账号状态已更新";
    }
    const wasLoggedIn = Boolean(library.account?.loggedIn);
    const accountChanged = library.account?.mid !== message.account?.mid;
    if (accountChanged || !message.account?.loggedIn) historyRequestId += 1;
    if (accountChanged || !message.account?.loggedIn) favoriteRequestId += 1;
    if (accountChanged || !message.account?.loggedIn) followingRequestId += 1;
    library.account = message.account;
    foldersLoaded = !message.account?.loggedIn;
    foldersError = "";
    if (accountChanged || !message.account?.loggedIn) {
      library.folders = [];
      library.selectedFolder = null;
      library.favoriteVideos = [];
      library.favoriteLoading = false;
      library.favoriteError = "";
      library.favoriteComplete = false;
      library.favoritePage = 0;
      library.remoteHistoryItems = [];
      library.remoteHistoryCursor = "";
      library.remoteHistoryLoaded = false;
      library.remoteHistoryLoading = false;
      library.remoteHistoryError = "";
      library.remoteHistoryComplete = false;
      library.followingVideos = [];
      library.followingOffset = "";
      library.followingLoaded = false;
      library.followingLoading = false;
      library.followingError = "";
      library.followingComplete = false;
    } else if (!wasLoggedIn) {
      library.remoteHistoryItems = [];
      library.remoteHistoryCursor = "";
      library.remoteHistoryLoaded = false;
      library.remoteHistoryLoading = false;
      library.remoteHistoryError = "";
      library.remoteHistoryComplete = false;
      library.followingVideos = [];
      library.followingOffset = "";
      library.followingLoaded = false;
      library.followingLoading = false;
      library.followingError = "";
      library.followingComplete = false;
    }
    renderAccount();
    renderLibrary();
  }
  if (message.type === "HISTORY") { library.historyItems = message.items || []; renderLibrary(); }
  if (message.type === "REMOTE_HISTORY") {
    if (!library.account?.loggedIn || message.requestId !== historyRequestId) return;
    const incoming = message.items || [];
    const known = new Set(library.remoteHistoryItems.map((item) => item.id || `${item.bvid}:${item.page || 1}`));
    const added = incoming.filter((item) => {
      const key = item.id || `${item.bvid}:${item.page || 1}`;
      if (!item.bvid || known.has(key)) return false;
      known.add(key);
      return true;
    });
    library.remoteHistoryItems.push(...added);
    const nextCursor = String(message.viewAt || "");
    const cursorAdvanced = Boolean(nextCursor) && nextCursor !== library.remoteHistoryCursor;
    library.remoteHistoryCursor = nextCursor;
    historyEmptyPages = added.length ? 0 : historyEmptyPages + 1;
    library.remoteHistoryComplete = !message.hasMore || !message.rawCount || !cursorAdvanced;
    library.remoteHistoryLoaded = true;
    library.remoteHistoryLoading = false;
    library.remoteHistoryError = !library.remoteHistoryComplete && historyEmptyPages >= 3 ? "连续几页没有新的视频记录，点击重试继续加载。" : "";
    renderLibrary();
  }
  if (message.type === "FOLLOWING") {
    if (!library.account?.loggedIn || message.requestId !== followingRequestId) return;
    const incoming = message.videos || [];
    const known = new Set(library.followingVideos.map((item) => item.bvid));
    const added = incoming.filter((item) => item.bvid && !known.has(item.bvid));
    library.followingVideos.push(...added);
    library.followingOffset = String(message.offset || "");
    library.followingComplete = !message.hasMore || incoming.length === 0 || added.length === 0;
    library.followingLoaded = true;
    library.followingLoading = false;
    library.followingError = "";
    renderLibrary();
  }
  if (message.type === "SEARCH_RESULTS") {
    if (message.context && TOPIC_PAGES[message.context]) {
      const feed = getTopicFeed(message.context);
      const incoming = message.videos || [];
      const known = new Set(feed.videos.map((item) => item.bvid));
      const added = incoming.filter((item) => item.bvid && !known.has(item.bvid));
      feed.videos.push(...added);
      feed.page = Number(message.page) || feed.page || 1;
      feed.complete = incoming.length < 20 || added.length === 0;
      feed.loading = false;
      feed.error = "";
      renderLibrary();
      return;
    }
    if (message.requestId !== searchRequestId || String(message.keyword || "") !== library.searchKeyword) return;
    const incoming = message.videos || [];
    const known = new Set(library.searchResults.map((item) => item.bvid));
    const added = incoming.filter((item) => item.bvid && !known.has(item.bvid));
    library.searchResults.push(...added);
    library.searchPage = Number(message.page) || library.searchPage || 1;
    library.searchComplete = incoming.length < 20 || added.length === 0;
    library.searchLoading = false;
    library.searchError = "";
    renderLibrary();
  }
  if (message.type === "POPULAR_RESULTS") {
    if (message.requestId !== popularRequestId) return;
    const incoming = message.videos || [];
    const known = new Set(library.popular.map((item) => item.bvid));
    const added = incoming.filter((item) => item.bvid && !known.has(item.bvid));
    library.popular.push(...added);
    library.popularPage = Number(message.page) || library.popularPage || 1;
    library.popularComplete = incoming.length < 12 || added.length === 0;
    library.popularLoading = false;
    library.popularLoaded = true;
    renderLibrary();
  }
  if (message.type === "RECOMMENDATIONS") {
    const incoming = message.videos || [];
    const known = new Set(library.recommendations.map((item) => item.bvid));
    const added = incoming.filter((item) => item.bvid && !known.has(item.bvid));
    library.recommendations.push(...added);
    library.recommendationsPage = Number(message.page) || library.recommendationsPage || 1;
    library.recommendationsComplete = incoming.length < 12 || added.length === 0;
    library.recommendationsLoading = false;
    library.recommendationsLoaded = true;
    renderLibrary();
  }
  if (message.type === "FAVORITE_FOLDERS" && message.mid === library.account?.mid) {
    library.folders = message.folders || [];
    foldersLoaded = true;
    foldersError = "";
    renderLibrary();
  }
  if (message.type === "FAVORITE_RESOURCES" && library.selectedFolder?.id === message.folderId && message.requestId === favoriteRequestId) {
    const incoming = message.videos || [];
    const known = new Set(library.favoriteVideos.map((item) => item.bvid));
    const added = incoming.filter((item) => { if (!item.bvid || known.has(item.bvid)) return false; known.add(item.bvid); return true; });
    library.favoriteVideos.push(...added);
    library.favoritePage = Number(message.page) || library.favoritePage || 1;
    favoriteEmptyPages = added.length ? 0 : favoriteEmptyPages + 1;
    library.favoriteComplete = !message.hasMore || !message.rawCount;
    library.favoriteLoading = false;
    library.favoriteError = !library.favoriteComplete && favoriteEmptyPages >= 3 ? "连续几页没有新的视频，点击重试继续加载。" : "";
    renderLibrary();
  }
  if (message.type === "NOTICE") {
    if (message.scope === "following" && (!library.account?.loggedIn || message.requestId !== followingRequestId)) return;
    if (message.scope === "popular" && message.requestId !== popularRequestId) return;
    if (message.scope === "remote-history" && message.requestId !== historyRequestId) return;
    if (message.scope === "video") {
      if (message.requestId === videoRequestId && message.itemId === currentState?.currentItem?.id && playerPageVisible() && currentState?.playing) showVideoFailure(message.message);
      return;
    }
    if (message.scope === "folders") {
      if (message.mid !== library.account?.mid) return;
      foldersLoaded = true;
      foldersError = message.message;
      renderLibrary();
      return;
    }
    if (accountRefreshPending && message.scope === "account") {
      accountRefreshPending = false;
      if (library.tab === "account") renderLibrary();
    }
    const noticeMessage = String(message.message || "");
    if (noticeMessage.startsWith("推荐加载失败")) {
      library.recommendationsLoading = false;
      library.recommendationsError = noticeMessage;
      renderLibrary();
    }
    if (noticeMessage.startsWith("热门加载失败")) {
      library.popularLoading = false;
      library.popularError = noticeMessage;
      library.popularLoaded = true;
      renderLibrary();
    }
    if (noticeMessage.startsWith("特别关注加载失败")) {
      library.followingLoading = false;
      library.followingError = noticeMessage;
      library.followingLoaded = true;
      renderLibrary();
    }
    if (noticeMessage.startsWith("收藏夹加载失败")) {
      if (message.folderId !== library.selectedFolder?.id || message.requestId !== favoriteRequestId) return;
      library.favoriteLoading = false;
      library.favoriteError = noticeMessage;
      renderLibrary();
    }
    if (noticeMessage.startsWith("B站历史读取失败")) {
      library.remoteHistoryLoading = false;
      library.remoteHistoryLoaded = true;
      library.remoteHistoryError = noticeMessage;
      renderLibrary();
    }
    if (noticeMessage.startsWith("搜索失败")) {
      if (message.context && TOPIC_PAGES[message.context]) {
        const feed = getTopicFeed(message.context);
        feed.loading = false;
        feed.loaded = true;
        feed.error = noticeMessage;
      } else {
        if (message.requestId !== searchRequestId || message.keyword !== library.searchKeyword) return;
        library.searchLoading = false;
        library.searchError = noticeMessage;
      }
      renderLibrary();
    }
    status.textContent = noticeMessage;
  }
});
port.onDisconnect.addListener(() => { releaseVideo(); status.textContent = "后台连接已断开，请重新打开弹窗"; });
window.addEventListener("beforeunload", releaseVideo);
setIcon(previous, "previous");
setIcon(toggle, "playCircle");
setIcon(next, "next");
setIcon(miniPrevious, "previous");
setIcon(miniToggle, "playCircle");
setIcon(miniNext, "next");
setIcon(clearQueue, "trash", "清空");
document.querySelectorAll("[data-library-tab]").forEach((button) => {
  button.title = button.dataset.libraryTab === "recommend" ? "查看或刷新推荐" : button.textContent.trim();
});
renderAccount();
renderLibrary();
command("GET_STATE");
command("GET_ACCOUNT");
command("GET_HISTORY");
