const API_BASE = "https://api-v2.etf2l.org";
// Career-best can only improve over time, so a long TTL is safe. It also
// offsets the cost of paginating the full match history.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Bumped whenever badge semantics change, so stale values don't survive updates.
const CACHE_PREFIX = "etf2l4:";
const LEGACY_CACHE_PREFIXES = ["etf2l:", "etf2l2:", "etf2l3:"];

const CONCURRENCY = 2;
const QUEUE_STEP_MS = 250;
const RATE_LIMIT_FALLBACK_MS = 60 * 1000;
const RATE_LIMIT_ATTEMPTS = 3;
// Safety cap: 50 pages x 20 results = the last 1000 matches.
const MAX_RESULT_PAGES = 50;

const queue = [];
let inFlight = 0;
// Set when the API answers 429; the queue waits until this timestamp.
let pausedUntil = 0;

// In-flight lookups by steamId, so concurrent lookups share one request chain.
const pending = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "ETF2L_LOOKUP") return;

  (async () => {
    const { steamIds } = msg;
    if (!Array.isArray(steamIds) || steamIds.length === 0) {
      sendResponse({ ok: true, result: {} });
      return;
    }

    const result = {};
    await Promise.all(
      steamIds.map(async (sid) => {
        try {
          result[sid] = { ok: true, badge: await getBadgeForSteamId(sid) };
        } catch (e) {
          console.warn(`ETF2L lookup failed for ${sid}:`, e);
          result[sid] = { ok: false };
        }
      })
    );

    sendResponse({ ok: true, result });
  })().catch((e) => {
    console.error("ETF2L_LOOKUP error:", e);
    sendResponse({ ok: false, error: String(e) });
  });

  return true;
});

pruneCache();

async function getBadgeForSteamId(steamId64) {
  const cacheKey = `${CACHE_PREFIX}${steamId64}`;

  const cached = await cacheGet(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.badge;

  const badge = await dedupe(steamId64, () => lookupBadge(steamId64));

  // Only reached on success: fetch errors throw and are never cached.
  await cacheSet(cacheKey, { ts: Date.now(), badge });
  return badge;
}

async function lookupBadge(steamId64) {
  const json = await apiGet(`/player/${encodeURIComponent(steamId64)}`);
  const player = json?.player;
  if (!player) return ""; // not registered on ETF2L

  let best = bestDivisionFromTeams(player);

  // tier 0 is Premiership — nothing in the history can beat it.
  if (!best || best.tier > 0) {
    best = betterDivision(best, await bestDivisionFromHistory(steamId64));
  }

  return best ? normalizeDivision(best.name) : "";
}

// Best division among the player's CURRENT teams. Catches divisions a team is
// seeded into before any match has been played.
function bestDivisionFromTeams(player) {
  const teams = Array.isArray(player?.teams) ? player.teams : [];

  let best = null;
  for (const team of teams) {
    for (const comp of Object.values(team?.competitions || {})) {
      best = betterDivision(best, seasonDivision(comp?.category, comp?.division));
    }
  }
  return best;
}

// Best division across the player's full match history. Unlike /player, this
// also covers teams the player has since left.
async function bestDivisionFromHistory(steamId64) {
  const base = `/player/${encodeURIComponent(steamId64)}/results`;
  const first = await apiGet(base);
  if (!first) return null;

  let best = bestDivisionFromResults(first.data);

  const lastPage = Math.min(Number(first.last_page) || 1, MAX_RESULT_PAGES);
  if (lastPage <= 1 || (best && best.tier === 0)) return best;

  const pages = [];
  for (let p = 2; p <= lastPage; p++) pages.push(apiGet(`${base}?page=${p}`));
  for (const page of await Promise.all(pages)) {
    best = betterDivision(best, bestDivisionFromResults(page?.data));
  }
  return best;
}

function bestDivisionFromResults(items) {
  if (!Array.isArray(items)) return null;

  // Note: the `merced` flag can't be used to skip merc matches — API v2 sets
  // it to true on every result (verified on multiple players).
  let best = null;
  for (const r of items) {
    best = betterDivision(best, seasonDivision(r?.competition?.category, r?.division));
  }
  return best;
}

// Only official league seasons count; cups often run with mixed-level teams
// and would inflate the badge.
function seasonDivision(category, div) {
  if (!div || div.tier == null || !div.name) return null;
  if (!String(category || "").toLowerCase().includes("season")) return null;
  return { tier: Number(div.tier), name: String(div.name) };
}

// Lower tier = higher division (0 = Premiership).
function betterDivision(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.tier < a.tier ? b : a;
}

function dedupe(key, fn) {
  let p = pending.get(key);
  if (!p) {
    p = fn().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

// GET against the API. Returns parsed JSON, or null on 404. On 429 the whole
// queue is paused per Retry-After and the request is re-queued a few times.
async function apiGet(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await enqueue(() => doFetch(path));
    } catch (e) {
      if (!e?.rateLimited || attempt >= RATE_LIMIT_ATTEMPTS) throw e;
    }
  }
}

async function doFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Accept": "application/json" }
  });

  if (res.status === 404) return null;

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After")) * 1000 || RATE_LIMIT_FALLBACK_MS;
    pausedUntil = Math.max(pausedUntil, Date.now() + retryAfter);
    const err = new Error("ETF2L API rate limit (429)");
    err.rateLimited = true;
    throw err;
  }

  if (!res.ok) throw new Error(`ETF2L API HTTP ${res.status}`);

  return res.json();
}

function normalizeDivision(raw) {
  const r = raw.trim().toLowerCase();
  if (!r) return null;

  if (r.startsWith("prem")) return "PREM";
  if (r.startsWith("high")) return "HIGH";
  if (r.startsWith("mid")) return "MID";
  if (r.startsWith("low")) return "LOW";
  if (r.startsWith("open")) return "OPEN";
  if (r.startsWith("fresh")) return "FRESH";

  const m = r.match(/^div(?:ision)?\s*(\d)/);
  if (m) return `DIV${m[1]}`;

  return raw.toUpperCase().slice(0, 12);
}

async function cacheGet(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? null;
}

async function cacheSet(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// Storage only ever grew before: expired entries were ignored but never removed.
// Runs on every service worker startup.
async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const stale = Object.keys(all).filter((k) => {
      if (k.startsWith(CACHE_PREFIX)) return now - (all[k]?.ts ?? 0) >= CACHE_TTL_MS;
      return LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p));
    });
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch (e) {
    console.warn("ETF2L cache prune failed:", e);
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pumpQueue();
  });
}

function pumpQueue() {
  const wait = pausedUntil - Date.now();
  if (wait > 0) {
    setTimeout(pumpQueue, wait + 50);
    return;
  }

  while (inFlight < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    inFlight++;
    job.fn()
      .then(job.resolve, job.reject)
      .finally(() => {
        inFlight--;
        setTimeout(pumpQueue, QUEUE_STEP_MS);
      });
  }
}
