const BADGE_ATTR = "data-etf2l-badge";
const SCAN_DEBOUNCE_MS = 500;
const RETRY_DELAY_MS = 30 * 1000;
const CHAT_SELECTOR = "#chat, .chat, .chatbox, .messages";
const PROFILE_LINK_SELECTOR = 'a[href*="/profile/"], a[href*="steamcommunity.com/profiles/"]';
const KNOWN_LEVELS = new Set(["prem", "high", "div1", "div2", "div3", "div4", "mid", "low", "open", "fresh"]);

let scanTimer = null;
let lastSentKey = "";
// Last known badge text per steamId. TF2Center (Apache Wicket) re-renders DOM
// chunks over WebSocket, wiping our badges; this lets us restore them without
// re-querying the API.
const badgeTexts = new Map();

if (/^\/lobbies\/\d+\/?$/.test(location.pathname)) {
  installObserver();
  scheduleScan();
} else {
  console.debug("[ETF2L] Not a lobby page, skipping:", location.pathname);
}

function installObserver() {
  const obs = new MutationObserver((mutations) => {
    if (mutations.some(isRelevantMutation)) scheduleScan();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// Skip mutations caused by our own badges and by the chat — otherwise every
// chat message (and every badge we insert) re-triggers a scan.
function isRelevantMutation(m) {
  const el = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
  if (!el || el.closest(`.etf2l-badge, ${CHAT_SELECTOR}`)) return false;

  const nodes = [...m.addedNodes, ...m.removedNodes];
  if (
    nodes.length &&
    nodes.every((n) => n.nodeType === Node.ELEMENT_NODE && n.classList.contains("etf2l-badge"))
  ) {
    return false;
  }
  return true;
}

function scheduleScan(delay = SCAN_DEBOUNCE_MS) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanAndRender, delay);
}

async function scanAndRender() {
  const players = findPlayers();
  if (!players.length) return;

  const steamIds = [...new Set(players.map((p) => p.steamId64))].filter(Boolean);

  const key = steamIds.join(",");
  if (key === lastSentKey) {
    // Roster unchanged — just restore badges that a page re-render wiped.
    for (const p of players) {
      const node = ensureBadgeNode(p);
      const known = badgeTexts.get(p.steamId64);
      if (known !== undefined && node.textContent !== known) setBadge(node, known);
    }
    return;
  }
  lastSentKey = key;

  for (const p of players) setBadge(ensureBadgeNode(p), "…");

  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: "ETF2L_LOOKUP", steamIds });
  } catch (e) {
    console.warn("ETF2L lookup failed:", e);
  }

  if (!resp?.ok) {
    if (resp) console.warn("ETF2L lookup failed:", resp.error);
    // Forget this roster so the next scan retries instead of short-circuiting.
    lastSentKey = "";
    for (const p of players) setBadge(ensureBadgeNode(p), "");
    scheduleScan(RETRY_DELAY_MS);
    return;
  }

  const map = resp.result || {};
  let hadErrors = false;
  for (const p of players) {
    const entry = map[p.steamId64];
    if (entry?.ok) {
      badgeTexts.set(p.steamId64, entry.badge || "");
      setBadge(ensureBadgeNode(p), entry.badge);
    } else {
      hadErrors = true;
      setBadge(ensureBadgeNode(p), "");
    }
  }

  if (hadErrors) {
    lastSentKey = "";
    scheduleScan(RETRY_DELAY_MS);
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
  const anchors = Array.from(document.querySelectorAll(PROFILE_LINK_SELECTOR));
  const map = new Map();

  for (const a of anchors) {
    if (a.closest(CHAT_SELECTOR)) continue;

    const sid = parseSteamId64FromUrl(a.href || a.getAttribute("href"));
    if (!sid || !sid.startsWith("7656119")) continue;

    // TF2Center wraps each slot in .playerSlot/.lobbySlot; the generic list is
    // a fallback in case the markup changes.
    const slot = a.closest(".playerSlot, .lobbySlot");
    const row =
      slot ||
      a.closest("tr, li, .slot, .lobby-player, .player, .player-row, .team-player, div") ||
      a.parentElement ||
      a;

    // The same player can be linked outside their slot too (e.g. the "Leader"
    // row of the lobby options) — slot links always win, then longer text.
    const prev = map.get(sid);
    if (!prev) {
      map.set(sid, { steamId64: sid, anchor: a, row, inSlot: !!slot });
    } else {
      const newText = (a.textContent || "").trim();
      const oldText = (prev.anchor.textContent || "").trim();
      const better =
        (!!slot && !prev.inSlot) ||
        (!!slot === prev.inSlot && newText.length > oldText.length);
      if (better) {
        prev.anchor = a;
        prev.row = row;
        prev.inSlot = !!slot;
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

  // Prefer the visible name link of THIS player: the row may turn out to be a
  // shared container that also holds other players' links.
  let target = anchor;
  if (row) {
    const candidates = Array.from(scope.querySelectorAll(PROFILE_LINK_SELECTOR)).filter(
      (a) => parseSteamId64FromUrl(a.href) === steamId64
    );
    const nameLink = candidates.find((a) => (a.textContent || "").trim().length > 0);
    if (nameLink) target = nameLink;
  }

  target.insertAdjacentElement("afterend", span);
  return span;
}

function setBadge(node, text) {
  if (!node) return;
  const t = (text || "").trim();
  node.textContent = t;
  node.style.display = t ? "inline-block" : "none";

  const level = t.toLowerCase();
  node.dataset.level = KNOWN_LEVELS.has(level) ? level : "";
}
