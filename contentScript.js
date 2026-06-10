// contentScript.js

const BADGE_ATTR = "data-etf2l-badge";
const SCAN_DEBOUNCE_MS = 500;

let scanTimer = null;
let lastSentKey = "";

// Запускаемся только на страницах конкретного лобби вида:
// https://tf2center.com/lobbies/1313617

(() => {
  // Только страницы конкретного лобби: /lobbies/1313617
  if (!/^\/lobbies\/\d+\/?$/.test(location.pathname)) {
    console.debug("[ETF2L] Not a lobby page, skipping:", location.pathname);
    return;
  }

  const BADGE_ATTR = "data-etf2l-badge";
  const SCAN_DEBOUNCE_MS = 500;

  let scanTimer = null;
  let lastSentKey = "";

  function main() {
    installObserver();
    scheduleScan();
  }

  function installObserver() {
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndRender, SCAN_DEBOUNCE_MS);
  }

  // ... дальше весь твой код: scanAndRender/findPlayers/etc ...

  main();
})();


function detectLobbyMode() {
  // Простейшая эвристика: смотрим на текст страницы.
  const text = document.body?.innerText?.toLowerCase() || "";
  if (text.includes("highlander")) return "highlander";
  if (text.includes("6v6")) return "6v6";
  return "";
}

async function scanAndRender() {
  const lobbyMode = detectLobbyMode();
  const players = findPlayers();

  if (!players.length) return;

  // Уникальные SteamID64
  const steamIds = [...new Set(players.map((p) => p.steamId64))].filter(Boolean);

  // Чтобы не спамить одинаковыми запросами
  const key = `${lobbyMode}:${steamIds.join(",")}`;
  if (key === lastSentKey) {
    // всё равно обновим DOM (на случай, если элементы пересоздались)
    for (const p of players) ensureBadgeNode(p);
    return;
  }
  lastSentKey = key;

  // рисуем "..." пока грузим
  for (const p of players) {
    const node = ensureBadgeNode(p);
    setBadge(node, "…");
  }

  const resp = await chrome.runtime.sendMessage({
    type: "ETF2L_LOOKUP",
    steamIds,
    lobbyMode
  });

  if (!resp?.ok) {
    console.warn("ETF2L lookup failed:", resp?.error);
    for (const p of players) setBadge(ensureBadgeNode(p), "");
    return;
  }

  const map = resp.result || {};
  for (const p of players) {
    const badgeText = map[p.steamId64] || "";
    setBadge(ensureBadgeNode(p), badgeText);
  }
}

function parseSteamId64FromUrl(url) {
  const s = String(url || "");

  // tf2center.com/profile/<steamid64> или /profile/<steamid64>
  let m = s.match(/(?:tf2center\.com)?\/profile\/(\d{16,20})(?:\/|$)/i);
  if (m) return m[1];

  // steamcommunity.com/profiles/<steamid64> (на всякий)
  m = s.match(/steamcommunity\.com\/profiles\/(\d{16,20})(?:\/|$)/i);
  if (m) return m[1];

  return null;
}

function findPlayers() {
  const anchors = Array.from(document.querySelectorAll('a[href*="/profile/"], a[href*="tf2center.com/profile/"]'));
  const map = new Map(); // steamId64 -> {steamId64, anchor, row}

  for (const a of anchors) {
    if (a.closest('#chat, .chat, .chatbox, .messages')) continue;

    const sid = parseSteamId64FromUrl(a.href || a.getAttribute("href"));
    if (!sid || !sid.startsWith("7656119")) continue;

    const row =
      a.closest("tr, li, .slot, .lobby-player, .player, .player-row, .team-player, div") ||
      a.parentElement ||
      a;

    const prev = map.get(sid);
    if (!prev) {
      map.set(sid, { steamId64: sid, anchor: a, row });
    } else {
      // предпочитаем ссылку на ник (у неё обычно есть текст), а не аватар
      const newText = (a.textContent || "").trim();
      const oldText = (prev.anchor.textContent || "").trim();
      if (newText.length > oldText.length) {
        prev.anchor = a;
        prev.row = row;
      }
    }
  }

  return Array.from(map.values()).slice(0, 30);
}




function ensureBadgeNode(player) {
  const { steamId64, anchor, row } = player;
  const scope = row || anchor?.parentElement || document;

  const existing = Array.from(scope.querySelectorAll(`.etf2l-badge[${BADGE_ATTR}="${steamId64}"]`));
  if (existing.length) {
    // если уже есть несколько — оставляем один, остальные удаляем
    for (let i = 1; i < existing.length; i++) existing[i].remove();
    return existing[0];
  }

  const span = document.createElement("span");
  span.className = "etf2l-badge";
  span.setAttribute(BADGE_ATTR, steamId64);
  span.textContent = "";

  // вставляем после ссылки с текстом (ник), если она есть в этом ряду
  let target = anchor;
  if (row) {
    const candidates = Array.from(
      row.querySelectorAll('a[href*="/profile/"], a[href*="tf2center.com/profile/"]')
    );
    const nameLink = candidates.find(x => (x.textContent || "").trim().length > 0);
    if (nameLink) target = nameLink;
  }

  target.insertAdjacentElement("afterend", span);
  return span;
}


function setBadge(node, text) {
  if (!node) return;
  const t = (text || "").replace(/^ETF2L:\s*/i, "").trim();
  node.textContent = t;
  node.style.display = t ? "inline-block" : "none";

  // небольшая “цветовая” эвристика по дивизиону (можно убрать)
  node.dataset.level =
    t.includes("PREM") ? "prem" :
    t.includes("DIV1") ? "div1" :
    t.includes("DIV2") ? "div2" :
    t.includes("MID") ? "mid" :
    t.includes("LOW") ? "low" :
    t.includes("OPEN") ? "open" :
    "";
}
