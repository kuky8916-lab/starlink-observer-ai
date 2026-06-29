import { CONFIG } from "./config.js";
import { readFile, writeFile } from "node:fs/promises";

let cachedTles = [];
let lastUpdated = 0;

const CACHE_FILE = "/tmp/starlink_tle_cache.json";

const DEFAULT_TLE_URLS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/starlink.txt",
  "https://celestrak.org/NORAD/elements/supplemental/starlink.txt",
  "https://www.celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle",
  "https://www.celestrak.org/NORAD/elements/starlink.txt"
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

async function fetchTextWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StarlinkObserverAI/2.6 Railway",
        "Accept": "text/plain,*/*"
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

async function saveDiskCache(satellites) {
  try {
    await writeFile(
      CACHE_FILE,
      JSON.stringify({
        updated: Date.now(),
        satellites
      }),
      "utf-8"
    );
  } catch (err) {
    console.error(`TLE disk cache save skipped: ${err.message}`);
  }
}

async function loadDiskCache() {
  try {
    const text = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(text);

    if (!Array.isArray(data.satellites) || data.satellites.length < 100) {
      return null;
    }

    return {
      satellites: data.satellites,
      updated: Number(data.updated || 0)
    };
  } catch {
    return null;
  }
}

export async function fetchStarlinkTles(forceRefresh = false) {
  const cacheMinutes = CONFIG.starlink?.tleCacheMinutes ?? 60;

  if (
    !forceRefresh &&
    cachedTles.length > 0 &&
    Date.now() - lastUpdated < cacheMinutes * 60 * 1000
  ) {
    console.log(`Using memory TLE cache: ${cachedTles.length}`);
    return cachedTles;
  }

  const urls = getTleUrls();
  let lastError = null;

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Fetching TLE: ${url} attempt ${attempt}`);

        const text = await fetchTextWithTimeout(url, 20000);
        const satellites = parseTleText(text);

        if (satellites.length < 100) {
          throw new Error(`TLE parse too few satellites: ${satellites.length}`);
        }

        cachedTles = satellites;
        lastUpdated = Date.now();

        await saveDiskCache(satellites);

        console.log(
          `Loaded ${satellites.length} Starlink TLEs (${new Date(lastUpdated).toISOString()})`
        );

        return cachedTles;
      } catch (err) {
        lastError = err;
        console.error(`TLE fetch failed: ${url} attempt ${attempt} - ${err.message}`);
        await sleep(1500 * attempt);
      }
    }
  }

  if (cachedTles.length > 0) {
    console.log(`Using old memory TLE cache because live fetch failed: ${cachedTles.length}`);
    return cachedTles;
  }

  const diskCache = await loadDiskCache();

  if (diskCache) {
    cachedTles = diskCache.satellites;
    lastUpdated = diskCache.updated || Date.now();

    console.log(
      `Using disk TLE cache because live fetch failed: ${cachedTles.length}`
    );

    return cachedTles;
  }

  console.error(
    `No TLE available. Live fetch failed: ${lastError?.message ?? "unknown error"}`
  );

  return [];
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
