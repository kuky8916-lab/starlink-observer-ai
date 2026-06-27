import { CONFIG } from "./config.js";

let cachedTles = [];
let lastUpdated = 0;

export async function fetchStarlinkTles(forceRefresh = false) {
  const cacheMinutes = CONFIG.starlink.tleCacheMinutes ?? 60;

  if (
    !forceRefresh &&
    cachedTles.length > 0 &&
    Date.now() - lastUpdated < cacheMinutes * 60 * 1000
  ) {
    return cachedTles;
  }

  const response = await fetch(CONFIG.starlink.tleUrl, {
    headers: {
      "User-Agent": "StarlinkObserverAI/2.1"
    }
  });

  if (!response.ok) {
    throw new Error(`TLE download failed (${response.status})`);
  }

  const text = await response.text();

  const lines = text
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  const satellites = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
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
  }

  cachedTles = satellites;
  lastUpdated = Date.now();

  console.log(
    `Loaded ${satellites.length} Starlink TLEs (${new Date(lastUpdated).toISOString()})`
  );

  return satellites;
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
