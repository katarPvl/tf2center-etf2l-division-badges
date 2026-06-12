const BADGE_ATTR = "data-etf2l-badge";
const SCAN_DEBOUNCE_MS = 500;
const RETRY_DELAY_MS = 30 * 1000;
const CHAT_SELECTOR = "#chat, .chat, .chatbox, .messages";
const PROFILE_LINK_SELECTOR = 'a[href*="/profile/"], a[href*="steamcommunity.com/profiles/"]';
const KNOWN_LEVELS = new Set(["prem", "high", "div1", "div2", "div3", "div4", "mid", "low", "open", "fresh"]);

const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = { showWinProbability: true };
// Players with no ETF2L history rate as a Fresh newcomer (skill_contrib 0).
const UNKNOWN_SKILL = 0;
// Elo-like scale: a one-division skill gap (~6 points) gives roughly 65/35.
const PROB_SCALE = 20;

const settings = { ...DEFAULT_SETTINGS };

let scanTimer = null;
let lastSentKey = "";
// Last known data per steamId. TF2Center (Apache Wicket) re-renders DOM chunks
// over WebSocket, wiping injected elements; these let us restore everything
// without re-querying the API.
const badgeTexts = new Map();
const playerSkills = new Map();
let lastProb = null;

if (/^\/lobbies\/\d+\/?$/.test(location.pathname)) {
  chrome.storage.sync.get(SETTINGS_KEY).then(
    (data) => {
      Object.assign(settings, data?.[SETTINGS_KEY] || {});
      installObserver();
      scheduleScan();
    },
    () => {
      installObserver();
      scheduleScan();
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[SETTINGS_KEY]) {
      Object.assign(settings, changes[SETTINGS_KEY].newValue || {});
      renderWinProbability();
    }
  });
} else {
  console.debug("[ETF2L] Not a lobby page, skipping:", location.pathname);
}

function installObserver() {
  const obs = new MutationObserver((mutations) => {
    if (mutations.some(isRelevantMutation)) scheduleScan();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// Skip mutations caused by our own elements and by the chat — otherwise every
// chat message (and every node we insert) re-triggers a scan.
function isRelevantMutation(m) {
  const el = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
  if (!el || el.closest(`.etf2l-badge, .etf2l-winprob, ${CHAT_SELECTOR}`)) return false;

  const nodes = [...m.addedNodes, ...m.removedNodes];
  if (
    nodes.length &&
    nodes.every(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE &&
        (n.classList.contains("etf2l-badge") || n.classList.contains("etf2l-winprob"))
    )
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

  const key = players
    .map((p) => `${p.steamId64}:${p.team || ""}`)
    .sort()
    .join(",");
  if (key === lastSentKey) {
    // Roster unchanged — just restore what a page re-render wiped.
    for (const p of players) {
      const node = ensureBadgeNode(p);
      const known = badgeTexts.get(p.steamId64);
      if (known !== undefined && node.textContent !== known) setBadge(node, known);
    }
    renderWinProbability();
    return;
  }
  lastSentKey = key;

  for (const p of players) setBadge(ensureBadgeNode(p), "…");

  const steamIds = [...new Set(players.map((p) => p.steamId64))];

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
      playerSkills.set(p.steamId64, typeof entry.skill === "number" ? entry.skill : null);
      setBadge(ensureBadgeNode(p), entry.badge);
    } else {
      hadErrors = true;
      setBadge(ensureBadgeNode(p), "");
    }
  }

  lastProb = computeWinProbability(players);
  renderWinProbability();

  if (hadErrors) {
    lastSentKey = "";
    scheduleScan(RETRY_DELAY_MS);
  }
}

function computeWinProbability(players) {
  const teams = { blu: [], red: [] };
  for (const p of players) {
    if (!p.team) continue; // spectators, leader row, etc.
    const s = playerSkills.get(p.steamId64);
    teams[p.team].push(typeof s === "number" ? s : UNKNOWN_SKILL);
  }
  if (!teams.blu.length || !teams.red.length) return null;

  const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
  const diff = avg(teams.blu) - avg(teams.red);
  const pBlu = 1 / (1 + Math.pow(10, -diff / PROB_SCALE));

  const blu = Math.min(99, Math.max(1, Math.round(pBlu * 100)));
  return { blu, red: 100 - blu };
}

function renderWinProbability() {
  const container = document.querySelector(".balanceContainer");
  if (!container) return;

  let box = container.querySelector(".etf2l-winprob");
  if (!box) {
    box = document.createElement("div");
    box.className = "etf2l-winprob";
    container.insertAdjacentElement("afterbegin", box);
  }

  if (!settings.showWinProbability) {
    box.replaceChildren(makeToggle("ETF2L win %", "Show ETF2L win probability", true));
    box.classList.add("collapsed");
    return;
  }
  box.classList.remove("collapsed");

  if (!lastProb) {
    box.replaceChildren();
    return;
  }

  const bluLabel = document.createElement("span");
  bluLabel.className = "etf2l-wp-label blu";
  bluLabel.textContent = `BLU ${lastProb.blu}%`;

  const bar = document.createElement("div");
  bar.className = "etf2l-wp-bar";
  const fill = document.createElement("div");
  fill.className = "etf2l-wp-fill";
  fill.style.width = `${lastProb.blu}%`;
  bar.appendChild(fill);

  const redLabel = document.createElement("span");
  redLabel.className = "etf2l-wp-label red";
  redLabel.textContent = `RED ${lastProb.red}%`;

  box.replaceChildren(
    bluLabel,
    bar,
    redLabel,
    makeToggle("×", "Hide ETF2L win probability", false)
  );
}

function makeToggle(text, title, enable) {
  const btn = document.createElement("button");
  btn.className = "etf2l-wp-toggle";
  btn.type = "button";
  btn.textContent = text;
  btn.title = title;
  btn.addEventListener("click", () => saveShowWinProbability(enable));
  return btn;
}

async function saveShowWinProbability(value) {
  settings.showWinProbability = value;
  renderWinProbability();
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    const merged = { ...DEFAULT_SETTINGS, ...(data?.[SETTINGS_KEY] || {}) };
    merged.showWinProbability = value;
    await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
  } catch (e) {
    console.warn("ETF2L settings save failed:", e);
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

function teamOf(el) {
  if (el.closest(".blue-team")) return "blu";
  if (el.closest(".red-team")) return "red";
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
      map.set(sid, { steamId64: sid, anchor: a, row, inSlot: !!slot, team: slot ? teamOf(a) : null });
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
        prev.team = slot ? teamOf(a) : null;
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
