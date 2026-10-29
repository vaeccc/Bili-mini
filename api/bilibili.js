const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const VIEW_URL = "https://api.bilibili.com/x/web-interface/view";
const PLAY_URL = "https://api.bilibili.com/x/player/wbi/playurl";
const RECOMMEND_URL = "https://api.bilibili.com/x/web-interface/index/top/feed/rcmd";
const POPULAR_URL = "https://api.bilibili.com/x/web-interface/popular";
const FOLLOWING_URL = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all";
const SEARCH_URL = "https://api.bilibili.com/x/web-interface/search/type";
const HISTORY_URL = "https://api.bilibili.com/x/web-interface/history/cursor";
const FAVORITE_FOLDERS_URL = "https://api.bilibili.com/x/v3/fav/folder/created/list-all";
const FAVORITE_RESOURCES_URL = "https://api.bilibili.com/x/v3/fav/resource/list";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

// Extensions cannot reliably override browser-controlled headers such as
// Referer and User-Agent. The public APIs used here work without spoofing
// them; CDN compatibility is verified separately in a real offscreen context.
const BROWSER_HEADERS = { accept: "application/json, text/plain, */*" };

let wbiKeyCache = null;
let wbiKeyExpiresAt = 0;

export class BilibiliApiError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function parseVideoInput(value) {
  const source = String(value || "").trim();
  const match = source.match(/(BV[1-9A-HJ-NP-Za-km-z]{10})/i);
  if (!match) throw new BilibiliApiError("INVALID_VIDEO", "请输入包含 BV 号的 B 站视频链接或 BV 号");
  let page = 1;
  try {
    const url = new URL(source);
    const parsedPage = Number(url.searchParams.get("p"));
    if (Number.isInteger(parsedPage) && parsedPage > 0) page = parsedPage;
  } catch (_) {
    const pageMatch = source.match(/[?&#]p=(\d+)/i);
    if (pageMatch) page = Math.max(1, Number(pageMatch[1]) || 1);
  }
  return { bvid: `BV${match[1].slice(2)}`, page };
}

function basenameWithoutExtension(url) {
  return new URL(url).pathname.split("/").pop().split(".")[0];
}

function makeMixinKey(imgKey, subKey) {
  const source = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((index) => source[index]).join("").slice(0, 32);
}

async function md5(value) {
  // MD5 is the format mandated by B站 WBI. Web Crypto intentionally does not
  // expose MD5, so the small implementation below keeps this dependency-free.
  const source = new TextEncoder().encode(value);
  const paddedLength = (((source.length + 8) >>> 6) + 1) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
  const rotateLeft = (number, amount) => ((number << amount) | (number >>> (32 - amount))) >>> 0;
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f;
      let g;
      if (index < 16) { f = (b & c) | (~b & d); g = index; }
      else if (index < 32) { f = (d & b) | (~d & c); g = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; g = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * index) % 16; }
      const nextD = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constants[index] + words[g]) >>> 0, shifts[(index >>> 4) * 4 + (index % 4)])) >>> 0;
      a = nextD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24]
    .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}

function encodeWbiValue(value) {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ""));
}

async function requestBody(url) {
  const maxAttempts = 3;
  const retryableStatus = (status) => status === 412 || status === 429 || status >= 500;
  let lastStatus = 0;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: BROWSER_HEADERS,
        referrer: "https://www.bilibili.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: controller.signal
      });
      lastStatus = response.status;
      if (response.ok) return response.json();
      if (!retryableStatus(response.status) || attempt === maxAttempts - 1) {
        throw new BilibiliApiError("NETWORK", `B 站请求失败（HTTP ${response.status}）`, { status: response.status });
      }
    } catch (error) {
      if (error instanceof BilibiliApiError) throw error;
      lastError = error;
      if (attempt === maxAttempts - 1) {
        throw new BilibiliApiError("NETWORK", error?.name === "AbortError" ? "B 站请求超时，请稍后重试" : "无法连接 B 站，请检查网络", { cause: error?.message, status: lastStatus });
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw new BilibiliApiError("NETWORK", lastError ? "无法连接 B 站，请检查网络" : `B 站请求失败（HTTP ${lastStatus}）`, { cause: lastError?.message, status: lastStatus });
}

async function requestJson(url) {
  const body = await requestBody(url);
  if (Number(body?.code) !== 0) {
    throw new BilibiliApiError(`BILI_${body?.code ?? "UNKNOWN"}`, body?.message || "B 站未返回可用数据", { body });
  }
  return body.data;
}

function normalizeVideo(raw = {}) {
  return {
    bvid: raw.bvid || "",
    title: raw.title || "未命名视频",
    cover: raw.pic || raw.cover || "",
    duration: Number(raw.duration) || 0,
    owner: raw.owner?.name || raw.upper?.name || raw.author || raw.uname || "",
    views: Number(raw.stat?.view || raw.play || raw.view) || 0,
    pubdate: Number(raw.pubdate || raw.pub_time || 0) || 0
  };
}

function normalizeImage(url) {
  const value = String(url || "");
  if (value.startsWith("//")) return `https:${value}`;
  return value.replace(/^http:\/\//i, "https://");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDuration(value) {
  const parts = String(value || "").split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 ? parts[0] : 0;
}

async function getWbiMixinKey() {
  if (wbiKeyCache && Date.now() < wbiKeyExpiresAt) return wbiKeyCache;

  // nav can return -101 for logged-out users while still returning wbi_img.
  let response;
  try {
    response = await fetch(NAV_URL, { credentials: "include", headers: BROWSER_HEADERS, referrer: "https://www.bilibili.com/", referrerPolicy: "strict-origin-when-cross-origin" });
  } catch (error) {
    throw new BilibiliApiError("NETWORK", "无法获取 WBI 密钥", { cause: error?.message });
  }
  const body = await response.json();
  const imageUrl = body?.data?.wbi_img?.img_url;
  const subUrl = body?.data?.wbi_img?.sub_url;
  if (!imageUrl || !subUrl) throw new BilibiliApiError("WBI_KEY", "无法获取 B 站 WBI 密钥");

  wbiKeyCache = makeMixinKey(basenameWithoutExtension(imageUrl), basenameWithoutExtension(subUrl));
  wbiKeyExpiresAt = Date.now() + 30 * 60 * 1000;
  return wbiKeyCache;
}

async function makeWbiQuery(params) {
  const mixinKey = await getWbiMixinKey();
  const sorted = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));
  const query = sorted.map(([key, value]) => `${key}=${encodeWbiValue(value)}`).join("&");
  return `${query}&w_rid=${await md5(query + mixinKey)}`;
}

function getUrls(stream = {}) {
  return [stream.baseUrl || stream.base_url, ...(stream.backupUrl || stream.backup_url || [])].filter(Boolean);
}

function getDeadline(urls) {
  for (const url of urls) {
    try {
      const deadline = Number(new URL(url).searchParams.get("deadline"));
      if (Number.isFinite(deadline) && deadline > 0) return deadline * 1000;
    } catch (_) {
      // Ignore malformed backup URLs and keep looking.
    }
  }
  return 0;
}

export async function getVideoInfo(input) {
  const { bvid, page: requestedPage } = parseVideoInput(input);
  const data = await requestJson(`${VIEW_URL}?bvid=${encodeURIComponent(bvid)}`);
  const pages = (data.pages || []).map((page, index) => ({
    id: `${data.bvid}:${page.cid}`,
    bvid: data.bvid,
    aid: data.aid,
    cid: Number(page.cid),
    title: page.part || `P${page.page || index + 1}`,
    videoTitle: data.title || "未命名视频",
    cover: data.pic || "",
    duration: Number(page.duration) || 0,
    page: Number(page.page) || index + 1
  }));
  const fallback = {
    id: `${data.bvid}:${data.cid}`,
    bvid: data.bvid,
    aid: data.aid,
    cid: Number(data.cid),
    title: data.title || "未命名视频",
    videoTitle: data.title || "未命名视频",
    cover: data.pic || "",
    duration: Number(data.duration) || 0,
    page: 1
  };
  return { bvid: data.bvid, title: data.title || "未命名视频", requestedPage, pages: pages.length ? pages : [fallback] };
}

/**
 * B站帐号登录由浏览器完成，扩展只读取当前 Chrome profile 已有的登录态。
 * No cookie value is returned, stored, or sent anywhere by this function.
 */
export async function getAccount() {
  const body = await requestBody(NAV_URL);
  const data = body?.data || {};
  const loggedIn = Number(body?.code) === 0 && Boolean(data.isLogin);
  return {
    loggedIn,
    mid: loggedIn ? Number(data.mid) : 0,
    name: loggedIn ? data.uname || "B站用户" : "",
    avatar: loggedIn ? data.face || "" : "",
    level: loggedIn ? Number(data.level_info?.current_level) || 0 : 0
  };
}

export async function getRecommendations(page = 1, pageSize = 12) {
  const size = Math.min(20, Math.max(1, Number(pageSize) || 12));
  const data = await requestJson(`${RECOMMEND_URL}?ps=${size}&fresh_type=3&feed_version=V8&fresh_idx=${Math.max(1, Number(page) || 1)}`);
  const recommendations = (data.item || []).map(normalizeVideo).filter((item) => item.bvid);
  return recommendations.length ? recommendations : getPopularVideos(page, size);
}

export async function getPopularVideos(page = 1, pageSize = 12) {
  const size = Math.min(20, Math.max(1, Number(pageSize) || 12));
  const popular = await requestJson(`${POPULAR_URL}?pn=${Math.max(1, Number(page) || 1)}&ps=${size}`);
  return (popular.list || []).map(normalizeVideo).filter((item) => item.bvid);
}

export async function getFollowingPage(offset = "") {
  // The web dynamic-feed endpoint controls its own page size; `offset` is the
  // cursor returned by the previous response. Keep the query compatible with
  // the public web endpoint instead of sending unsupported pagination fields.
  const params = new URLSearchParams({ type: "all", platform: "web" });
  if (offset) params.set("offset", String(offset));
  const data = await requestJson(`${FOLLOWING_URL}?${params.toString()}`);
  const videos = (data?.items || []).map((item) => {
    const archive = item?.modules?.module_dynamic?.major?.archive;
    if (!archive?.bvid) return null;
    return {
      bvid: archive.bvid,
      title: archive.title || "未命名视频",
      cover: normalizeImage(archive.cover),
      duration: Number(archive.duration) || 0,
      owner: item?.modules?.module_author?.name || "",
      views: Number(archive?.stat?.view || 0) || 0,
      pubdate: Number(item?.modules?.module_author?.pub_ts || 0) || 0
    };
  }).filter((item) => item?.bvid);
  return {
    videos,
    offset: String(data?.offset || ""),
    hasMore: Boolean(data?.has_more)
  };
}

export async function getFollowing() {
  return (await getFollowingPage()).videos;
}

export async function getRemoteHistory(viewAt = "", pageSize = 20) {
  const size = Math.min(30, Math.max(1, Number(pageSize) || 20));
  const params = new URLSearchParams({ type: "all", ps: String(size) });
  if (viewAt) params.set("view_at", String(viewAt));
  const data = await requestJson(`${HISTORY_URL}?${params.toString()}`);
  const items = (data?.list || []).map((raw) => {
    const history = raw.history || raw;
    const bvid = history.bvid || raw.bvid || "";
    const cid = Number(history.cid || raw.cid || 0);
    return {
      id: `${bvid}:${cid || raw.oid || 0}`,
      bvid,
      cid,
      title: raw.title || history.part || "未命名视频",
      videoTitle: raw.title || "未命名视频",
      cover: normalizeImage(raw.cover || raw.pic),
      duration: Number(raw.duration || history.duration) || 0,
      owner: raw.author_name || raw.owner?.name || "",
      views: Number(raw.stat?.view || 0) || 0,
      viewAt: Number(raw.view_at || 0) || 0,
      page: Number(history.page) || 1
    };
  }).filter((item) => item.bvid);
  const cursor = data?.cursor || {};
  const nextViewAt = cursor.view_at ?? cursor.max ?? items.at(-1)?.viewAt ?? 0;
  return {
    items,
    viewAt: Number(nextViewAt) || 0,
    hasMore: Boolean(cursor.has_more ?? (items.length >= size))
  };
}

export async function searchVideos(keyword, page = 1, pageSize = 20) {
  const query = String(keyword || "").trim();
  if (!query) return [];
  const size = Math.min(20, Math.max(1, Number(pageSize) || 20));
  const data = await requestJson(`${SEARCH_URL}?search_type=video&keyword=${encodeURIComponent(query)}&page=${Math.max(1, Number(page) || 1)}&page_size=${size}&order=totalrank&duration=0&category_id=`);
  return (data?.result || []).map((raw) => ({
    bvid: raw.bvid || "",
    title: stripHtml(raw.title) || "未命名视频",
    cover: normalizeImage(raw.pic),
    duration: parseDuration(raw.duration),
    owner: raw.author || "",
    views: Number(raw.play || raw.video_review || 0) || 0,
    pubdate: Number(raw.pubdate || 0) || 0
  })).filter((item) => item.bvid);
}

export async function getFavoriteFolders(mid) {
  if (!Number(mid)) throw new BilibiliApiError("LOGIN_REQUIRED", "请先在 B站网页中登录");
  const data = await requestJson(`${FAVORITE_FOLDERS_URL}?up_mid=${encodeURIComponent(mid)}`);
  return (data?.list || []).map((folder) => ({
    id: Number(folder.id),
    title: folder.title || "未命名收藏夹",
    cover: normalizeImage(folder.cover),
    count: Number(folder.media_count) || 0
  }));
}

export async function getFavoriteResources(folderId, page = 1, pageSize = 20) {
  if (!Number(folderId)) throw new BilibiliApiError("INVALID_FOLDER", "无效的收藏夹");
  const data = await requestJson(`${FAVORITE_RESOURCES_URL}?media_id=${encodeURIComponent(folderId)}&pn=${Math.max(1, Number(page) || 1)}&ps=${Math.min(20, Math.max(1, Number(pageSize) || 20))}&platform=web`);
  return (data?.medias || []).map(normalizeVideo).filter((item) => item.bvid);
}

export async function getPlaybackSources(item) {
  const query = await makeWbiQuery({
    bvid: item.bvid,
    cid: item.cid,
    fnval: 16,
    fnver: 0,
    fourk: 1,
    wts: Math.floor(Date.now() / 1000)
  });
  const data = await requestJson(`${PLAY_URL}?${query}`);
  const audioStreams = Array.isArray(data?.dash?.audio) ? data.dash.audio : [];
  const audio = [...audioStreams].sort((left, right) => Number(right.bandwidth || 0) - Number(left.bandwidth || 0))[0];
  const urls = getUrls(audio);
  if (!urls.length) throw new BilibiliApiError("NO_AUDIO", "该视频没有可播放的音轨");
  // Keep popup bandwidth modest and favor AVC, which has the broadest Chrome
  // support. This stream is display-only; audio always comes from dash.audio.
  const videos = Array.isArray(data?.dash?.video) ? data.dash.video : [];
  const avcVideos = videos.filter((stream) => Number(stream.codecid) === 7);
  const video = [...(avcVideos.length ? avcVideos : videos)]
    .sort((left, right) => Number(left.bandwidth || 0) - Number(right.bandwidth || 0))[0];
  const videoUrls = getUrls(video);
  return {
    urls,
    expiresAt: getDeadline(urls),
    duration: Number(data?.timelength) ? Number(data.timelength) / 1000 : Number(item.duration) || 0,
    audioId: audio.id || 0,
    videoUrls,
    videoExpiresAt: getDeadline(videoUrls),
    videoQuality: video?.id || 0
  };
}
