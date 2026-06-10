const BADGE_ATTR = "data-etf2l-badge";
const SCAN_DEBOUNCE_MS = 500;

let scanTimer = null;
let lastSentKey = "";

(() => {
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

  main();
})();

function detectLobbyMode() {
  const text = document.body?.innerText?.toLowerCase() || "";
  if (text.includes("highlander")) return "highlander";
  if (text.includes("6v6")) return "6v6";
  return "";
}

async function scanAndRender() {
  const lobbyMode = detectLobbyMode();
  const players = findPlayers();

  if (!players.length) return;

  const steamIds = [...new Set(players.map((p) => p.steamId64))].filter(Boolean);

  const key = `${lobbyMode}:${steamIds.join(",")}`;
  if (key === lastSentKey) {
    for (const p of players) ensureBadgeNode(p);
    return;
  }
  lastSentKey = key;

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

  let m = s.match(/(?:tf2center\.com)?\/profile\/(\d{16,20})(?:\/|$)/i);
  if (m) return m[1];

  m = s.match(/steamcommunity\.com\/profiles\/(\d{16,20})(?:\/|$)/i);
  if (m) return m[1];

  return null;
}

function findPlayers() {
  const anchors = Array.from(document.querySelectorAll('a[href*="/profile/"], a[href*="tf2center.com/profile/"]'));
  const map = new Map();

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
    for (let i = 1; i < existing.length; i++) existing[i].remove();
    return existing[0];
  }

  const span = document.createElement("span");
  span.className = "etf2l-badge";
  span.setAttribute(BADGE_ATTR, steamId64);
  span.textContent = "";

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

  node.dataset.level =
    t.includes("PREM") ? "prem" :
    t.includes("DIV1") ? "div1" :
    t.includes("DIV2") ? "div2" :
    t.includes("MID") ? "mid" :
    t.includes("LOW") ? "low" :
    t.includes("OPEN") ? "open" :
    "";
}
