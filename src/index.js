import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong
} from "satellite.js";

import { CONFIG, validateConfig } from "./config.js";
import { getWeatherForecast, findNearestWeather } from "./weather.js";
import { sendTelegram } from "./telegram.js";

validateConfig();

const sentCache = new Set();

function formatKst(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: CONFIG.timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function getKstHour(date) {
  return Number(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: CONFIG.timezone,
      hour: "2-digit",
      hour12: false
    }).format(date)
  );
}

function isObservableNight(date) {
  const hour = getKstHour(date);

  // 밝은 시간대 완전 제외
  // 관측 가능 시간: 저녁 20시 ~ 새벽 04시
  return hour >= 20 || hour <= 4;
}

async function fetchStarlinkTles() {
  const res = await fetch(CONFIG.starlink.tleUrl);

  if (!res.ok) {
    throw new Error(`TLE fetch error: ${res.status}`);
  }

  const text = await res.text();
  const lines = text
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean);

  const sats = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;

    try {
      sats.push({
        name,
        satrec: twoline2satrec(line1, line2)
      });
    } catch {
      // 잘못된 TLE는 무시
    }
  }

  return sats;
}

function getSatellitePosition(satrec, date) {
  const pv = propagate(satrec, date);

  if (!pv.position) return null;

  const gmst = gstime(date);
  const gd = eciToGeodetic(pv.position, gmst);

  return {
    lat: degreesLat(gd.latitude),
    lon: degreesLong(gd.longitude),
    heightKm: gd.height
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateElevationDeg(observer, satPos) {
  const groundDistance = haversineKm(
    observer.lat,
    observer.lon,
    satPos.lat,
    satPos.lon
  );

  const h = Math.max(satPos.heightKm, 1);
  const angleRad = Math.atan2(h, groundDistance);

  return angleRad * 180 / Math.PI;
}

function scorePass({ elevationDeg, weather, date }) {
  if (!isObservableNight(date)) return 0;

  let score = 0;

  if (elevationDeg >= 80) score += 45;
  else if (elevationDeg >= 65) score += 40;
  else if (elevationDeg >= 50) score += 32;
  else if (elevationDeg >= 35) score += 24;
  else if (elevationDeg >= 25) score += 15;
  else return 0;

  score += 25;

  const cloud = weather.cloudCover;
  if (cloud <= 10) score += 30;
  else if (cloud <= 25) score += 25;
  else if (cloud <= 40) score += 15;
  else if (cloud <= 60) score += 5;
  else if (cloud <= 80) score -= 20;
  else score -= 40;

  const rain = weather.precipitationProbability;
  if (rain <= 10) score += 10;
  else if (rain <= 30) score += 5;
  else if (rain <= 50) score -= 15;
  else score -= 35;

  if ((weather.visibility ?? 0) >= 15000) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function grade(score) {
  if (score >= 85) return "🟢 매우 좋음";
  if (score >= 70) return "🟡 관측 가능";
  return "🔴 어려움";
}

function reasonText({ elevationDeg, weather }) {
  return [
    `고도 ${Math.round(elevationDeg)}°`,
    `야간 시간대`,
    `구름 ${weather.cloudCover}%`,
    `강수확률 ${weather.precipitationProbability}%`
  ].join(" · ");
}

function buildPassesForSite(site, sats, weather) {
  const now = new Date();
  const end = new Date(
    now.getTime() + CONFIG.starlink.lookAheadHours * 3600 * 1000
  );

  const candidates = [];
  const targetSats = sats.slice(0, CONFIG.starlink.maxSatellitesToCheck);

  for (
    let t = now.getTime();
    t <= end.getTime();
    t += CONFIG.starlink.stepSeconds * 1000
  ) {
    const date = new Date(t);

    if (!isObservableNight(date)) continue;

    for (const sat of targetSats) {
      const pos = getSatellitePosition(sat.satrec, date);
      if (!pos) continue;

      const elevationDeg = estimateElevationDeg(site, pos);
      if (elevationDeg < CONFIG.starlink.minElevationDeg) continue;

      const nearestWeather = findNearestWeather(weather, date);

      const score = scorePass({
        elevationDeg,
        weather: nearestWeather,
        date
      });

      if (score < CONFIG.scoring.minScoreToNotify) continue;

      candidates.push({
        city: site.name,
        satName: sat.name,
        date,
        elevationDeg,
        weather: nearestWeather,
        score
      });
    }
  }

  const deduped = [];

  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const tooClose = deduped.some(d => {
      return Math.abs(d.date.getTime() - c.date.getTime()) < 15 * 60 * 1000;
    });

    if (!tooClose) deduped.push(c);

    if (deduped.length >= CONFIG.starlink.maxResultsPerCity) break;
  }

  return deduped.sort((a, b) => a.date - b.date);
}

function buildMessage(results) {
  const good = results
    .flat()
    .filter(r => r.score >= CONFIG.scoring.minScoreToNotify)
    .filter(r => isObservableNight(r.date))
    .sort((a, b) => {
      if (a.city === b.city) return a.date - b.date;
      return b.score - a.score;
    });

  if (good.length === 0) {
    return null;
  }

  const lines = [];

  lines.push("🛰️ <b>Starlink Observer AI V2.0.1</b>");
  lines.push("관측 가능성이 높은 시간대만 선별했습니다.");
  lines.push("");

  for (const r of good) {
    lines.push(
      `${grade(r.score)} <b>${r.city}</b> | ${formatKst(r.date)} | ${r.score}점`
    );
    lines.push(`- ${reasonText(r)}`);
    lines.push(`- 위성: ${r.satName}`);
    lines.push("");
  }

  lines.push("기준: 야간 필수 + 고도 + 구름 + 강수확률 + 가시거리");
  lines.push("※ 밝은 시간대와 70점 미만은 전송 제외");

  return lines.join("\n");
}

function makeCacheKey(results) {
  return results
    .flat()
    .filter(r => r.score >= CONFIG.scoring.minScoreToNotify)
    .filter(r => isObservableNight(r.date))
    .map(r => `${r.city}-${formatKst(r.date)}-${r.score}`)
    .join("|");
}

async function runObserver() {
  console.log(`[${new Date().toISOString()}] Starlink Observer AI V2.0.1 started`);

  const sats = await fetchStarlinkTles();
  console.log(`Loaded Starlink TLE: ${sats.length}`);

  const allResults = [];

  for (const site of CONFIG.observerSites) {
    console.log(`Checking ${site.name}`);

    const weather = await getWeatherForecast(site.lat, site.lon);
    const passes = buildPassesForSite(site, sats, weather);

    allResults.push(passes);
  }

  const message = buildMessage(allResults);

  if (!message) {
    console.log("No good observation window.");
    return;
  }

  const cacheKey = makeCacheKey(allResults);

  if (sentCache.has(cacheKey)) {
    console.log("Same result already sent. Skip.");
    return;
  }

  sentCache.add(cacheKey);

  await sendTelegram(message);

  console.log("Telegram sent.");
}

async function main() {
  await runObserver();

  setInterval(async () => {
    try {
      await runObserver();
    } catch (err) {
      console.error(err);

      try {
        await sendTelegram(`❌ Starlink Observer AI 오류\n${err.message}`);
      } catch {}
    }
  }, CONFIG.schedule.intervalMinutes * 60 * 1000);
}

main().catch(async err => {
  console.error(err);

  try {
    await sendTelegram(`❌ Starlink Observer AI 시작 실패\n${err.message}`);
  } catch {}

  process.exit(1);
});
