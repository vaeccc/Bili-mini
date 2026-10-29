import { setIcon } from "./icons.js";

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
  currentState = nextState;
  const showPlayer = syncPlayerVisibility();
  const item = nextState.currentItem;
  const showMiniPlayer = Boolean(item) && !showPlayer;
  miniPlayer.hidden = !showMiniPlayer;
  playerEmpty.hidden = Boolean(item);
  nowPlaying.hidden = !item;
  toggle.disabled = !item;
  previous.disabled = !item;
  next.disabled = !item;
  progress.disabled = !item;
  if (item) {
    cover.src = item.cover || "";
    cover.alt = item.videoTitle || item.title || "视频封面";
    title.textContent = displayVideoTitle(item);
    subtitle.textContent = displayPart(item);
  }
  setIcon(toggle, nextState.playing ? "pauseCircle" : "playCircle");
  toggle.title = nextState.playing ? "暂停" : "播放";
  toggle.setAttribute("aria-label", toggle.title);
  progress.max = String(nextState.duration || item?.duration || 0);
  if (!progressSeeking) progress.value = String(Math.min(Number(progress.max), nextState.currentTime || 0));
  time.textContent = `${formatTime(nextState.currentTime)} / ${formatTime(nextState.duration || item?.duration)}`;
  miniPrevious.disabled = !item;
  miniToggle.disabled = !item;
  miniNext.disabled = !item;
  if (item) {
    miniCover.src = item.cover || "";
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
  miniProgress.style.setProperty("--progress", Number(miniProgress.max) > 0 ? `${(Number(miniProgress.value) / Number(miniProgress.max)) * 100}%` : "0%");
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
      empty.textContent = "播放列表为空";
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
    requestedVideoItemId = item.id;
    command("GET_VIEW_SOURCE");
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
    const image = document.createElement("img");
    image.src = item.cover || "";
    image.alt = "";
    const copy = document.createElement("div");
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = itemLabel;
    itemTitle.title = itemLabel;
    const owner = document.createElement("span");
    owner.textContent = videoMeta(item);
    owner.title = owner.textContent;
    copy.append(itemTitle, owner);
    const playIcon = document.createElement("span");
    playIcon.className = "video-play-icon";
    playIcon.setAttribute("aria-hidden", "true");
    setIcon(playIcon, "listPlay");
    play.append(image, copy, playIcon);
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
  const image = document.createElement("img");
  image.src = item.cover || "";
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
  const icon = document.createElement("b");
  icon.className = "video-play-icon";
  icon.setAttribute("aria-hidden", "true");
  setIcon(icon, "listPlay");
  copy.append(kicker, itemTitle, owner);
  play.append(image, copy, icon);
  card.append(play);
  return card;
}

function makeHistoryList(items) {
  return makeVideoList(items.map((item) => ({
    ...item,
    title: displayVideoTitle(item),
    owner: displayPart(item)
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
  command("GET_POPULAR", { page });
}

function requestSearch(page = 1) {
  if (!library.searchKeyword || library.searchLoading || library.searchComplete) return;
  library.searchLoading = true;
  library.searchError = "";
  command("SEARCH_VIDEOS", { keyword: library.searchKeyword, page });
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
  command("GET_FAVORITE_RESOURCES", { folderId: library.selectedFolder.id, page });
}

function requestRemoteHistory() {
  if (!library.account?.loggedIn || library.remoteHistoryLoading || library.remoteHistoryComplete) return;
  library.remoteHistoryLoading = true;
  library.remoteHistoryError = "";
  command("GET_REMOTE_HISTORY", { viewAt: library.remoteHistoryCursor });
}

function requestFollowing() {
  if (!library.account?.loggedIn || library.followingLoading || library.followingComplete) return;
  library.followingLoading = true;
  library.followingError = "";
  command("GET_FOLLOWING", { offset: library.followingOffset });
}

function isFeedTab(tab = library.tab) {
  return tab === "search" || tab === "home" || tab === "recommend" || Boolean(TOPIC_PAGES[tab]) || (tab === "favorites" && Boolean(library.selectedFolder)) || (tab === "history" && Boolean(library.account?.loggedIn)) || (tab === "following" && Boolean(library.account?.loggedIn));
}

function requestCurrentFeedPage() {
  if (library.tab === "search") return requestSearch(library.searchPage + 1);
  if (library.tab === "home") return requestRecommendations(library.recommendationsPage + 1);
  if (library.tab === "recommend") return requestPopular(library.popularPage + 1);
  if (TOPIC_PAGES[library.tab]) return requestTopic(library.tab, getTopicFeed(library.tab).page + 1);
  if (library.tab === "favorites" && library.selectedFolder) return requestFavoriteResources(library.favoritePage + 1);
  if (library.tab === "history" && library.account?.loggedIn) return requestRemoteHistory();
  if (library.tab === "following" && library.account?.loggedIn) return requestFollowing();
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
  if (!feed.complete) {
    const loadMore = document.createElement("p");
    loadMore.className = "load-more";
    loadMore.textContent = feed.loading ? "正在加载更多…" : "继续下滑加载更多";
    libraryContent.append(loadMore);
  }
}

function renderSearchPage() {
  libraryHeading.textContent = "搜索";
  librarySubtitle.textContent = library.searchKeyword ? `搜索：${library.searchKeyword}` : "站内视频搜索";
  const form = document.createElement("form");
  form.className = "search-form";
  const input = document.createElement("input");
  input.type = "search";
  input.value = library.searchKeyword;
  input.placeholder = "搜索视频、音乐或 UP 主";
  input.setAttribute("aria-label", "搜索 B 站视频");
  const submit = document.createElement("button");
  submit.type = "submit";
  setIcon(submit, "search", "搜索");
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const keyword = input.value.trim();
    if (!keyword) return;
    library.searchKeyword = keyword;
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
    libraryContent.append(makeLibraryState(library.searchError, { kind: "error" }));
    return;
  }
  if (library.searchResults.length) {
    libraryContent.append(makeVideoList(library.searchResults));
    if (!library.searchComplete) {
      const loadMore = document.createElement("p");
      loadMore.className = "load-more";
      loadMore.textContent = library.searchLoading ? "正在加载更多结果…" : "继续下滑加载更多";
      libraryContent.append(loadMore);
    }
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
  librarySubtitle.removeAttribute("title");
  librarySection.classList.toggle("hide-section-heading", library.tab !== "search");
  document.querySelectorAll("[data-library-tab]").forEach((button) => button.classList.toggle("active", button.dataset.libraryTab === library.tab));
  document.querySelectorAll("[data-account-tab]").forEach((button) => button.classList.toggle("active", button.dataset.accountTab === library.tab));
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
    avatar.src = account.avatar || "";
    avatar.alt = `${account.name} 的头像`;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = account.name || "B站用户";
    const detail = document.createElement("span");
    detail.textContent = account.level ? `B站 Lv.${account.level}` : "已登录";
    copy.append(name, detail);
    summary.append(avatar, copy);
    libraryContent.append(summary);
    const shortcuts = document.createElement("div");
    shortcuts.className = "account-shortcuts";
    for (const [label, tab] of [["关注", "following"], ["收藏", "favorites"], ["历史", "history"]]) {
      const shortcut = document.createElement("button");
      shortcut.type = "button";
      shortcut.textContent = label;
      shortcut.dataset.accountShortcut = tab;
      shortcuts.append(shortcut);
    }
    libraryContent.append(shortcuts);
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
    libraryContent.append(accountActions);
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
        kind: feed.error ? "error" : "loading",
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
    if (!feed.complete) {
      const loadMore = document.createElement("p");
      loadMore.className = "load-more";
      loadMore.textContent = feed.loading ? "正在加载更多…" : "继续下滑加载更多";
      libraryContent.append(loadMore);
    }
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
      if (!library.remoteHistoryComplete) {
        const loadMore = document.createElement("p");
        loadMore.className = "load-more";
        loadMore.textContent = library.remoteHistoryLoading ? "正在加载更多历史…" : "继续下滑加载更多";
        libraryContent.append(loadMore);
      }
    } else {
      libraryContent.append(makeLibraryState("B站暂无观看历史。"));
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
    if (library.followingError) {
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
    if (!library.followingLoaded || library.followingLoading) {
      libraryContent.append(makeLibraryState(library.followingLoading ? "正在加载特别关注…" : "准备加载特别关注…", { kind: "loading" }));
      if (!library.followingLoaded && !library.followingLoading) {
        library.followingLoading = true;
        command("GET_FOLLOWING", { offset: library.followingOffset });
      }
      return;
    }
    if (library.followingVideos.length) {
      libraryContent.append(makeVideoList(library.followingVideos));
      if (!library.followingComplete) {
        const loadMore = document.createElement("p");
        loadMore.className = "load-more";
        loadMore.textContent = library.followingLoading ? "正在加载更多关注…" : "继续下滑加载更多";
        libraryContent.append(loadMore);
      }
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
    back.textContent = `← ${library.selectedFolder.title}`;
    libraryContent.append(back);
    if (library.favoriteError && !library.favoriteVideos.length) {
      libraryContent.append(makeLibraryState(library.favoriteError, {
        kind: "error",
        actionLabel: "重新加载",
        onAction: () => {
          library.favoriteError = "";
          library.favoriteComplete = false;
          requestFavoriteResources(1);
          renderLibrary();
        }
      }));
    } else if (library.favoriteVideos.length) {
      libraryContent.append(makeVideoList(library.favoriteVideos));
      if (!library.favoriteComplete) {
        const loadMore = document.createElement("p");
        loadMore.className = "load-more";
        loadMore.textContent = library.favoriteLoading ? "正在加载更多收藏…" : "继续下滑加载更多";
        libraryContent.append(loadMore);
      }
    } else {
      libraryContent.append(makeLibraryState(library.favoriteLoading ? "正在加载收藏夹视频…" : "准备加载收藏夹视频…", { kind: "loading" }));
      if (!library.favoriteLoading && !library.favoriteComplete) requestFavoriteResources(1);
    }
    return;
  }
  if (!library.folders.length) {
    libraryContent.append(makeLibraryState("没有可读取的收藏夹，或正在刷新账号状态。", { kind: "loading" }));
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

function loadVideoSource(message) {
  if (message.itemId !== currentState?.currentItem?.id) return;
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
      requestedVideoItemId = message.itemId;
      command("GET_VIEW_SOURCE");
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
  videoReady = false;
  videoUrlIndex += 1;
  if (videoUrlIndex < videoUrls.length) {
    video.src = videoUrls[videoUrlIndex];
    video.load();
  } else {
    if (videoSourceRetryCount < 1 && currentState?.playing) {
      videoSourceRetryCount += 1;
      requestedVideoItemId = "";
      status.textContent = "正在重新获取视频画面…";
      command("GET_VIEW_SOURCE");
      return;
    }
    videoShell.hidden = true;
    status.textContent = "视频画面加载失败；后台音频仍在播放";
  }
});

toggle.addEventListener("click", () => command("TOGGLE"));
previous.addEventListener("click", () => command("PREVIOUS"));
next.addEventListener("click", () => command("NEXT"));
function startSeeking() { progressSeeking = true; }
function commitSeek(control) {
  progressSeeking = false;
  command("SEEK", { position: Number(control.value) });
}
progress.addEventListener("pointerdown", startSeeking);
miniProgress.addEventListener("pointerdown", startSeeking);
progress.addEventListener("change", () => commitSeek(progress));
miniProgress.addEventListener("change", () => commitSeek(miniProgress));
window.addEventListener("pointerup", () => { progressSeeking = false; });
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
  status.textContent = "";
  library.selectedFolder = null;
  library.favoriteVideos = [];
  renderLibrary();
  if (currentState) render(currentState);
}));
document.querySelectorAll("[data-library-tab]").forEach((button) => button.addEventListener("click", () => {
  library.tab = button.dataset.libraryTab;
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
  const accountShortcut = event.target.closest("button[data-account-shortcut]");
  const retryFollowing = event.target.closest("button[data-retry-following]");
  if (accountShortcut) {
    library.tab = accountShortcut.dataset.accountShortcut;
    status.textContent = "";
    renderLibrary();
  } else if (play) {
    status.textContent = "正在加入播放队列…";
    command("PLAY_INPUT", { input: play.dataset.playBvid });
  } else if (folder) {
    library.selectedFolder = library.folders.find((item) => item.id === Number(folder.dataset.folderId)) || null;
    library.favoriteVideos = [];
    library.favoritePage = 0;
    library.favoriteLoading = false;
    library.favoriteError = "";
    library.favoriteComplete = false;
    renderLibrary();
  } else if (event.target.closest("button[data-back-folders]")) {
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
    const wasLoggedIn = Boolean(library.account?.loggedIn);
    library.account = message.account;
    if (!message.account?.loggedIn) {
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
    const incoming = message.items || [];
    const known = new Set(library.remoteHistoryItems.map((item) => item.id || `${item.bvid}:${item.page || 1}`));
    const added = incoming.filter((item) => {
      const key = item.id || `${item.bvid}:${item.page || 1}`;
      return item.bvid && !known.has(key);
    });
    library.remoteHistoryItems.push(...added);
    library.remoteHistoryCursor = String(message.viewAt || "");
    library.remoteHistoryComplete = !message.hasMore || incoming.length === 0 || added.length === 0;
    library.remoteHistoryLoaded = true;
    library.remoteHistoryLoading = false;
    library.remoteHistoryError = "";
    renderLibrary();
  }
  if (message.type === "FOLLOWING") {
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
    if (String(message.keyword || "") !== library.searchKeyword) return;
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
  if (message.type === "FAVORITE_FOLDERS") { library.folders = message.folders || []; renderLibrary(); }
  if (message.type === "FAVORITE_RESOURCES" && library.selectedFolder?.id === message.folderId) {
    const incoming = message.videos || [];
    const known = new Set(library.favoriteVideos.map((item) => item.bvid));
    library.favoriteVideos.push(...incoming.filter((item) => item.bvid && !known.has(item.bvid)));
    library.favoritePage = Number(message.page) || library.favoritePage || 1;
    library.favoriteComplete = incoming.length < 20 || incoming.length === 0;
    library.favoriteLoading = false;
    library.favoriteError = "";
    renderLibrary();
  }
  if (message.type === "NOTICE") {
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
      library.favoriteLoading = false;
      library.favoriteError = noticeMessage;
      renderLibrary();
    }
    if (noticeMessage.startsWith("B站历史读取失败")) {
      library.remoteHistoryLoading = false;
      library.remoteHistoryLoaded = true;
      library.remoteHistoryError = noticeMessage;
      library.remoteHistoryComplete = true;
      renderLibrary();
    }
    if (noticeMessage.startsWith("搜索失败")) {
      if (message.context && TOPIC_PAGES[message.context]) {
        const feed = getTopicFeed(message.context);
        feed.loading = false;
        feed.loaded = true;
        feed.error = noticeMessage;
      } else {
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
  button.title = button.textContent.trim();
});
renderAccount();
renderLibrary();
command("GET_STATE");
command("GET_ACCOUNT");
command("GET_HISTORY");
