import { CONFIG, validateConfig } from "./config.js";
import { getWeatherForecast } from "./weather.js";
import { sendTelegram } from "./telegram.js";
import { fetchStarlinkTles } from "./tle.js";
import { saveStarlinkResults } from "./sheet.js";
import {
  findPassesForSite,
  isObservableNight
} from "./observer.js";

validateConfig();

const sentCache = new Set();

function formatKstShort(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: CONFIG.timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function grade(score) {
  if (score >= 90) return "🟢 매우 좋음";
  if (score >= 80) return "🟢 좋음";
  if (score >= 70) return "🟡 좋음";
  if (score >= 60) return "🟠 애매함";
  return "🔴 어려움";
}

function formatMagnitude(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "계산불가";
  }

  return `${Number(value).toFixed(1)} mag`;
}

function weatherValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Math.round(Number(value))}%`;
}

function reasonText(r) {
  return [
    `고도 ${Math.round(r.elevationDeg)}°`,
    `${r.direction}`,
    `거리 ${Math.round(r.rangeKm)}km`,
    `구름 ${weatherValue(r.weather.cloudCover)}`,
    `강수 ${weatherValue(r.weather.precipitationProbability)}`
  ].join(" · ");
}

function failReason(best) {
  if (!best) return "후보 위성 없음";
  if (!isObservableNight(best.date, { lat: best.lat, lon: best.lon })) return "밝은 시간대";
  if (best.weather.cloudCover >= 75) return "구름 많음";
  if (best.weather.precipitationProbability >= 50) return "강수확률 높음";
  if (best.elevationDeg < 35) return "고도 낮음";
  if (best.score < CONFIG.scoring.minScoreToNotify) return "점수 부족";
  return "기준 미달";
}

function buildGoodMessage(siteResults) {
  const good = siteResults
    .flatMap(r => r.selected)
    .filter(r => r.score >= CONFIG.scoring.minScoreToNotify)
    .sort((a, b) => b.score - a.score);

  if (good.length === 0) return null;

  const lines = [];

  lines.push("🛰️ <b>Starlink Observer AI V2.4</b>");
  lines.push("오늘 실제 관측 추천 후보입니다.");
  lines.push("");

  const best = good[0];

  lines.push("⭐ <b>오늘 최고의 관측</b>");
  lines.push(`${grade(best.score)} <b>${best.city}</b>`);
  lines.push(`${formatKstShort(best.date)} | ${best.score}점 | 성공률 ${best.probability}%`);
  lines.push(`${best.stars} | 밝기 ${formatMagnitude(best.magnitude)}`);
  lines.push(`${reasonText(best)}`);
  lines.push(`태양고도 ${Math.round(best.sunAltitudeDeg)}° | ${best.satName}`);
  lines.push("");

  const others = good.slice(1);

  if (others.length > 0) {
    lines.push("📍 <b>지역별 후보</b>");
    lines.push("");

    for (const r of others) {
      lines.push(`${grade(r.score)} <b>${r.city}</b>`);
      lines.push(`${formatKstShort(r.date)} | ${r.score}점 | 성공률 ${r.probability}%`);
      lines.push(`${r.stars} | 밝기 ${formatMagnitude(r.magnitude)}`);
      lines.push(`${reasonText(r)}`);
      lines.push(`태양고도 ${Math.round(r.sunAltitudeDeg)}° | ${r.satName}`);
      lines.push("");
    }
  }

  lines.push("기준: 고도각 + 태양고도 + 위성햇빛 + 밝기 + 구름 + 강수 + 거리");

  return lines.join("\n");
}

function buildTestMessage(siteResults) {
  const lines = [];

  lines.push("🛰️ <b>Starlink Observer AI V2.4 테스트 리포트</b>");
  lines.push(`${CONFIG.scoring.minScoreToNotify}점 이상 관측 후보는 없습니다.`);
  lines.push("");

  for (const r of siteResults) {
    if (!r.best) {
      lines.push(`🔴 <b>${r.city}</b> | 후보 없음`);
      lines.push("- 야간 시간대에 고도/날씨/위성햇빛 조건을 만족한 위성이 없습니다.");
      lines.push("");
      continue;
    }

    lines.push(`${grade(r.best.score)} <b>${r.city}</b>`);
    lines.push(`${formatKstShort(r.best.date)} | 최고 ${r.best.score}점 | 성공률 ${r.best.probability}%`);
    lines.push(`${r.best.stars} | 밝기 ${formatMagnitude(r.best.magnitude)}`);
    lines.push(`탈락 이유: ${failReason(r.best)}`);
    lines.push(`${reasonText(r.best)}`);
    lines.push(`태양고도 ${Math.round(r.best.sunAltitudeDeg)}° | 후보 ${r.totalPasses ?? r.totalCandidates}개`);
    lines.push("");
  }

  lines.push("개발 모드: 기준 미달이어도 상태 확인용 메시지를 보냅니다.");

  return lines.join("\n");
}

function makeCacheKey(message) {
  return message.replace(/\s+/g, " ").slice(0, 500);
}

async function runObserver() {
  console.log(`[${new Date().toISOString()}] Starlink Observer AI V2.4 started`);

  const tles = await fetchStarlinkTles();
  console.log(`Loaded Starlink TLE: ${tles.length}`);

  const siteResults = [];

  for (const site of CONFIG.observerSites) {
    console.log(`Checking ${site.name}`);

    const weather = await getWeatherForecast(site.lat, site.lon);
    const result = findPassesForSite(site, tles, weather);

    console.log(
      `${site.name}: candidates=${result.totalCandidates}, passes=${result.totalPasses ?? "n/a"}, best=${result.best?.score ?? "none"}`
    );

    siteResults.push(result);
  }

  const message = buildGoodMessage(siteResults) || buildTestMessage(siteResults);
  const cacheKey = makeCacheKey(message);

  if (sentCache.has(cacheKey)) {
    console.log("Same result already sent. Skip.");
    return;
  }

  sentCache.add(cacheKey);

  await sendTelegram(message);
  console.log("Telegram sent.");

  try {
    await saveStarlinkResults(siteResults, CONFIG);
  } catch (err) {
    console.error("Sheet save failed:", err);
    try {
      await sendTelegram(`⚠️ Starlink DB 저장 실패\n${err.message}`);
    } catch {}
  }
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

