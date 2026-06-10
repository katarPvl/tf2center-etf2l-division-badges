// background.js (MV3 service worker)

const API_BASE = "https://api-v2.etf2l.org";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

// Небольшая очередь, чтобы не упираться в лимиты.
// Small request queue to avoid hitting API rate limits.
const CONCURRENCY = 3;
const queue = [];
let inFlight = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.type !== "ETF2L_LOOKUP") return;

    const { steamIds, lobbyMode } = msg;
    if (!Array.isArray(steamIds) || steamIds.length === 0) {
      sendResponse({ ok: true, result: {} });
      return;
    }

    const result = {};
    await Promise.all(
      steamIds.map(async (sid) => {
        result[sid] = await getBadgeForSteamId(sid, lobbyMode);
      })
    );

    sendResponse({ ok: true, result });
  })().catch((e) => {
    console.error("ETF2L_LOOKUP error:", e);
    sendResponse({ ok: false, error: String(e) });
  });

  // Важно: async response
  return true;
});

// --------- Cache helpers ---------

async function cacheGet(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? null;
}

async function cacheSet(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// --------- Queue helpers ---------

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pumpQueue();
  });
}

function pumpQueue() {
  while (inFlight < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    inFlight++;
    job.fn()
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        inFlight--;
        // небольшая пауза между пачками
        setTimeout(pumpQueue, 120);
      });
  }
}

// --------- ETF2L lookup ---------

async function getBadgeForSteamId(steamId64, lobbyMode) {
  const cacheKey = `etf2l:${steamId64}:${lobbyMode || "unknown"}`;
  const cached = await cacheGet(cacheKey);

  const now = Date.now();
  if (cached && (now - cached.ts) < CACHE_TTL_MS) return cached.badge;

  const badge = await enqueue(async () => {
    const results = await fetchPlayerResults(steamId64, 20);
    const best = pickBestDivisionFromResults(results, lobbyMode);
    return best ? `ETF2L: ${best}` : "";

  });

  await cacheSet(cacheKey, { ts: now, badge });
  return badge;
}

// API: /player/{id}/results with limit/page query params.
async function fetchPlayerResults(steamId64, limit = 20) {
  const url = new URL(`${API_BASE}/player/${encodeURIComponent(steamId64)}/results`);
  url.searchParams.set("limit", String(limit));
  // url.searchParams.set("page", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" }
  });

  if (!res.ok) {
    // 404 значит "игрок не найден" — просто не показываем бейдж
    return null;
  }

  const json = await res.json();
  return json;
}

// --------- Division heuristics ---------

function pickBestDivisionFromResults(apiResponse, lobbyMode) {
  // Тут главная неопределённость: точные поля в ответе.
  // Поэтому сделано “бережно”: пытаемся достать из ожидаемых мест,
  // иначе парсим по названию соревнования.
  //
  // Тебе почти наверняка придётся 1 раз посмотреть в DevTools -> Console:
  // console.log(apiResponse)
  // и поправить getCompetitionName()/getTeamType()/extractDivisionDirect().
  if (!apiResponse) return null;

  const items = extractResultItems(apiResponse);
  if (!items.length) return null;

  const mode = (lobbyMode || "").toLowerCase();

  // 1) сначала пробуем найти результаты под режим лобби (6v6 vs HL)
  const filtered = items.filter((r) => matchesMode(r, mode));
  const candidates = filtered.length ? filtered : items;

  // 2) берём самый свежий, где удаётся понять дивизион
  for (const r of candidates) {
    const div =
      extractDivisionDirect(r) ||
      parseDivisionFromText(getCompetitionName(r) || "");
    if (div) return div;
  }

  return null;
}

function extractResultItems(apiResponse) {
  // Часто в API это что-то вроде { results: { data: [...] } } или { data: [...] }
  if (!apiResponse) return [];

  if (Array.isArray(apiResponse)) return apiResponse;

  // пробуем распространённые варианты
  const paths = [
    ["results", "data"],
    ["results"],
    ["data"],
    ["player_results", "data"],
    ["player_results"]
  ];

  for (const p of paths) {
    let cur = apiResponse;
    for (const k of p) cur = cur?.[k];
    if (Array.isArray(cur)) return cur;
  }

  return [];
}

function matchesMode(resultItem, mode) {
  if (!mode) return true;

  const name = (getCompetitionName(resultItem) || "").toLowerCase();
  if (mode.includes("6")) return name.includes("6v6");
  if (mode.includes("high")) return name.includes("highlander");
  return true;
}

function getCompetitionName(resultItem) {
  // Попробуй в реальном JSON: где лежит название?
  return (
    resultItem?.competition?.name ||
    resultItem?.competition?.description ||
    resultItem?.competition_name ||
    resultItem?.competition ||
    ""
  );
}

function extractDivisionDirect(resultItem) {
  const candidates = [
    resultItem?.division?.name,
    resultItem?.division,
    resultItem?.competition?.division?.name,
    resultItem?.competition?.division,
    resultItem?.tier
  ];

  for (const v of candidates) {
    const div = normalizeDivisionValue(v);
    if (div) return div;
  }
  return null;
}

function normalizeDivisionValue(v) {
  if (!v) return null;

  if (typeof v === "string" || typeof v === "number") {
    return normalizeDivision(String(v));
  }

  if (typeof v === "object") {
    const maybe =
      v.name ?? v.title ?? v.division ?? v.tier ?? v.level ?? v.short ?? v.abbr;
    if (maybe) return normalizeDivision(String(maybe));
  }

  return null;
}


function parseDivisionFromText(text) {
  const t = text.toLowerCase();

  // HL / 6v6 встречаются форматы: "Premiership", "Division 1", "Division 2", "Mid", "Low", "Open"
  if (t.includes("prem")) return "PREM";
  if (t.includes("division 1") || t.includes("div 1") || t.includes("div1")) return "DIV1";
  if (t.includes("division 2") || t.includes("div 2") || t.includes("div2")) return "DIV2";
  if (t.includes("division 3") || t.includes("div 3") || t.includes("div3")) return "DIV3";
  if (t.includes("division 4") || t.includes("div 4") || t.includes("div4")) return "DIV4";
  if (t.includes("mid")) return "MID";
  if (t.includes("low")) return "LOW";
  if (t.includes("open")) return "OPEN";

  return null;
}

function normalizeDivision(raw) {
  const r = raw.trim().toLowerCase();
  if (!r) return null;

  if (r.startsWith("prem")) return "PREM";
  if (r === "1" || r.includes("division 1") || r.includes("div1")) return "DIV1";
  if (r === "2" || r.includes("division 2") || r.includes("div2")) return "DIV2";
  if (r === "3" || r.includes("division 3") || r.includes("div3")) return "DIV3";
  if (r === "4" || r.includes("division 4") || r.includes("div4")) return "DIV4";
  if (r.includes("mid")) return "MID";
  if (r.includes("low")) return "LOW";
  if (r.includes("open")) return "OPEN";

  return raw.toUpperCase();
}
