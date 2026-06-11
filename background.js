const API_BASE = "https://api-v2.etf2l.org";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Bumped whenever badge semantics change, so stale values don't survive updates.
const CACHE_PREFIX = "etf2l3:";
const LEGACY_CACHE_PREFIXES = ["etf2l:", "etf2l2:"];

const CONCURRENCY = 3;
const QUEUE_STEP_MS = 120;
const RATE_LIMIT_FALLBACK_MS = 60 * 1000;

const queue = [];
let inFlight = 0;
// Set when the API answers 429; the queue waits until this timestamp.
let pausedUntil = 0;

// In-flight fetches by steamId, so concurrent lookups share one request.
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

  const player = await dedupe(steamId64, () => enqueue(() => fetchPlayer(steamId64)));
  const badge = player ? pickBestDivision(player) || "" : "";

  // Only reached on success: fetch errors throw and are never cached.
  await cacheSet(cacheKey, { ts: Date.now(), badge });
  return badge;
}

function dedupe(key, fn) {
  let p = pending.get(key);
  if (!p) {
    p = fn().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

// Returns the player object, or null if the player is not registered on ETF2L.
async function fetchPlayer(steamId64) {
  const res = await fetch(`${API_BASE}/player/${encodeURIComponent(steamId64)}`, {
    headers: { "Accept": "application/json" }
  });

  if (res.status === 404) return null;

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After")) * 1000 || RATE_LIMIT_FALLBACK_MS;
    pausedUntil = Date.now() + retryAfter;
    throw new Error("ETF2L API rate limit (429)");
  }

  if (!res.ok) throw new Error(`ETF2L API HTTP ${res.status}`);

  const json = await res.json();
  return json?.player ?? null;
}

// Career-best division across ALL game modes: the entry with the lowest tier
// (0 = Premiership) among official league seasons. Cups (Fun Cup, 1 Day Cup,
// etc.) are ignored — they often run with mixed-level teams and would inflate
// the badge.
function pickBestDivision(player) {
  const teams = Array.isArray(player?.teams) ? player.teams : [];

  let best = null;
  for (const team of teams) {
    for (const comp of Object.values(team?.competitions || {})) {
      const div = comp?.division;
      if (!div || div.tier == null || !div.name) continue;

      const category = String(comp.category || "").toLowerCase();
      if (!category.includes("season")) continue;

      if (!best || Number(div.tier) < best.tier) {
        best = { tier: Number(div.tier), name: String(div.name) };
      }
    }
  }

  return best ? normalizeDivision(best.name) : null;
}

function normalizeDivision(raw) {
  const r = raw.trim().toLowerCase();
  if (!r) return null;

  if (r.startsWith("prem")) return "PREM";
  if (r.startsWith("high")) return "HIGH";
  if (r.startsWith("mid")) return "MID";
  if (r.startsWith("low")) return "LOW";
  if (r.startsWith("open")) return "OPEN";

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
