import { CONFIG } from "./config.js";

let cachedTles = [];
let lastUpdated = 0;

const DEFAULT_TLE_URLS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/starlink.txt"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTleUrls() {
  const urls = [];

  if (CONFIG.starlink?.tleUrl) {
    urls.push(CONFIG.starlink.tleUrl);
  }

  for (const url of DEFAULT_TLE_URLS) {
    if (!urls.includes(url)) urls.push(url);
  }

  return urls;
}

async function fetchTextWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StarlinkObserverAI/2.2"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseTleText(text) {
  const lines = text
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  const satellites = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (!line1.startsWith("1 ")) continue;
    if (!line2.startsWith("2 ")) continue;

    satellites.push({
      name,
      line1,
      line2
    });

    i += 2;
  }

  return satellites;
}

export async function fetchStarlinkTles(forceRefresh = false) {
  const cacheMinutes = CONFIG.starlink?.tleCacheMinutes ?? 60;

  if (
    !forceRefresh &&
    cachedTles.length > 0 &&
    Date.now() - lastUpdated < cacheMinutes * 60 * 1000
  ) {
    return cachedTles;
  }

  const urls = getTleUrls();
  let lastError = null;

  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Fetching TLE: ${url} attempt ${attempt}`);

        const text = await fetchTextWithTimeout(url, 30000);
        const satellites = parseTleText(text);

        if (satellites.length < 100) {
          throw new Error(`TLE parse too few satellites: ${satellites.length}`);
        }

        cachedTles = satellites;
        lastUpdated = Date.now();

        console.log(
          `Loaded ${satellites.length} Starlink TLEs (${new Date(lastUpdated).toISOString()})`
        );

        return cachedTles;
      } catch (err) {
        lastError = err;
        console.error(`TLE fetch failed: ${url} attempt ${attempt} - ${err.message}`);
        await sleep(3000 * attempt);
      }
    }
  }

  if (cachedTles.length > 0) {
    console.log("Using old cached TLE because live fetch failed.");
    return cachedTles;
  }

  throw new Error(`TLE fetch failed after retries: ${lastError?.message ?? "unknown error"}`);
}

export function clearTleCache() {
  cachedTles = [];
  lastUpdated = 0;
}

export function getTleCacheInfo() {
  return {
    count: cachedTles.length,
    updated: lastUpdated === 0 ? null : new Date(lastUpdated),
    ageMinutes:
      lastUpdated === 0
        ? null
        : Math.floor((Date.now() - lastUpdated) / 60000)
  };
}
