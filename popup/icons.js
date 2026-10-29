const PATHS = {
  play: "M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712",
  pause: "M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 1.25-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 1.25-.587 1.413T8 19",
  previous: "M5.5 17V7q0-.425.288-.712T6.5 6t.713.288T7.5 7v10q0 .425-.288.713T6.5 18t-.712-.288T5.5 17m11.45-.025l-6.2-4.15q-.225-.15-.337-.362T10.3 12t.113-.462t.337-.363l6.2-4.15q.125-.1.275-.125t.275-.025q.4 0 .7.275t.3.725v8.25q0 .45-.3.725t-.7.275q-.125 0-.275-.025t-.275-.125",
  next: "M16.5 17V7q0-.425.288-.712T17.5 6t.713.288T18.5 7v10q0 .425-.288.713T17.5 18t-.712-.288T16.5 17m-11-.875v-8.25q0-.45.3-.725t.7-.275q.125 0 .275.025t.275.125l6.2 4.15q.225.15.338.363T13.7 12t-.112.463t-.338.362l-6.2 4.15q-.125.1-.275.125t-.275.025q-.4 0-.7-.275t-.3-.725",
  x: "m12 13.4-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9 4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z",
  flame: "M12 21a7 7 0 0 0 7-7c0-4-3-6-4-9-2 2-3 3-3 6-2-1-4-3-4-6-2 2 1 3 4 3 6a4 4 0 1 1-6-3c-1 3-1 5-1 8a7 7 0 0 0 7 7Z",
  search: "m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  music: "M9 18V5l10-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z",
  live: "M4 7h16v10H4zM8 4l2 3m6-3-2 3m-2 4v4m-2-2h4",
  anime: "M4 5h16v14H4zM8 9h.01M16 9h.01M8 14c2 2 6 2 8 0",
  manga: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  article: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4",
  channels: "M4 5h6v6H4zm10 0h6v6h-6zM4 13h6v6H4zm10 0h6v6h-6z",
  player: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  trash: "M7 21q-.825 0-1.412-.587T5 19V6q-.425 0-.712-.288T4 5t.288-.712T5 4h4q0-.425.288-.712T10 3h4q.425 0 .713.288T15 4h4q.425 0 .713.288T20 5t-.288.713T19 6v13q0 .825-.587 1.413T17 21zm3.713-4.288Q11 16.426 11 16V9q0-.425-.288-.712T10 8t-.712.288T9 9v7q0 .425.288.713T10 17t.713-.288m4 0Q15 16.426 15 16V9q0-.425-.288-.712T14 8t-.712.288T13 9v7q0 .425.288.713T14 17t.713-.288",
  repeat: "m6.85 19 .85.85q.3.3.288.7t-.288.7q-.3.3-.712.313t-.713-.288L3.7 18.7q-.15-.15-.213-.325T3.426 18t.063-.375t.212-.325l2.575-2.575q.3-.3.713-.287t.712.312q.275.3.288.7t-.288.7l-.85.85H17v-3q0-.425.288-.712T18 13t.713.288T19 14v3q0 .825-.587 1.413T17 19zm10.3-12H7v3q0 .425-.288.713T6 11t-.712-.288T5 10V7q0-.825.588-1.412T7 5h10.15l-.85-.85q-.3-.3-.288-.7t.288-.7q.3-.3.712-.312t.713.287L20.3 5.3q.15.15.213.325t.062.375t-.062.375t-.213.325l-2.575 2.575q-.3.3-.712.288T16.3 9.25q-.275-.3-.288-.7t.288-.7z"
};

const MATERIAL_NAMES = new Set(["play", "playCircle", "listPlay", "pause", "pauseCircle", "previous", "next", "x", "trash", "repeat"]);
const MATERIAL_FILES = {
  play: "play-arrow-rounded.svg",
  playCircle: "play-circle-rounded.svg",
  listPlay: "play-circle-outline-rounded.svg",
  pause: "pause-rounded.svg",
  pauseCircle: "pause-circle-rounded.svg",
  previous: "skip-previous-rounded.svg",
  next: "skip-next-rounded.svg",
  x: "close-rounded.svg",
  trash: "delete-rounded.svg",
  repeat: "repeat-rounded.svg",
  search: "search-rounded.svg",
  home: "home-rounded.svg",
  music: "music-note-rounded.svg",
  live: "live-tv-rounded.svg",
  anime: "movie-rounded.svg",
  manga: "menu-book-rounded.svg",
  article: "article-rounded.svg",
  channels: "apps-rounded.svg",
  player: "queue-music-rounded.svg"
};

export function setIcon(button, name, label = "") {
  if (!button) return;
  const path = PATHS[name] || PATHS.player;
  button.replaceChildren();
  const materialFile = MATERIAL_FILES[name];
  if (materialFile) {
    const icon = document.createElement("span");
    icon.className = "ui-icon material-file-icon";
    icon.setAttribute("aria-hidden", "true");
    const url = new URL(`./icons/material-symbols/${materialFile}`, import.meta.url).href;
    icon.style.setProperty("--icon-url", `url("${url}")`);
    button.append(icon);
    if (label) {
    button.title = label;
      const text = document.createElement("span");
      text.className = "button-label";
      text.textContent = label;
      button.append(text);
    }
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ui-icon");
  if (MATERIAL_NAMES.has(name)) svg.classList.add("material-symbol-icon");
  const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
  element.setAttribute("d", path);
  svg.append(element);
  button.append(svg);
  if (label) {
    button.title = label;
    const text = document.createElement("span");
    text.className = "button-label";
    text.textContent = label;
    button.append(text);
  }
}
