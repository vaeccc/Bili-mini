const STATE_KEY = "bilibiliMiniPlayerState";
const HISTORY_KEY = "bilibiliMiniPlaybackHistory";

export const defaultPlayerState = () => ({
  queue: [],
  currentIndex: -1,
  currentItem: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  playMode: "ORDER",
  error: ""
});

export async function getPlayerState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = { ...defaultPlayerState(), ...(stored[STATE_KEY] || {}) };
  delete state.volume;
  // A direct URL is deliberately never persisted. Playback requires a fresh URL.
  state.playing = false;
  state.error = "";
  return state;
}

export async function setPlayerState(state) {
  const safeState = {
    ...state,
    playing: Boolean(state.playing),
    runtime: undefined,
    sourceUrls: undefined,
    expiresAt: undefined
  };
  delete safeState.volume;
  await chrome.storage.local.set({ [STATE_KEY]: safeState });
}

export async function getPlaybackHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

export async function addPlaybackHistory(item) {
  if (!item?.id || !item?.bvid) return;
  const history = await getPlaybackHistory();
  const next = [item, ...history.filter((entry) => entry.id !== item.id)].slice(0, 50);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}
