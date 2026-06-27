import { CONFIG, validateConfig } from "./config.js";
import { getWeatherForecast } from "./weather.js";
import { sendTelegram } from "./telegram.js";
import {
  fetchStarlinkTles,
  findPassesForSite,
  isObservableNight
} from "./observer.js";

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

function grade(score) {
  if (score >= 85) return "🟢 매우 좋음";
  if (score >= 70) return "🟡 관측 가능";
  if (score >= 50) return "🟠 부족";
  return "🔴 어려움";
}

function reasonText(r) {
  return [
    `방향 ${r.direction}`,
    `고도 ${Math.round(r.elevationDeg)}°`,
    `거리 ${Math.round(r.rangeKm)}km`,
    `구름 ${r.weather.cloudCover}%`,
    `강수확률 ${r.weather.precipitationProbability}%`
  ].join(" · ");
}

function failReason(best) {
  if (!best) return "후보 위성 없음";
  if (!isObservableNight(best.date)) return "밝은 시간대";
  if (best.weather.cloudCover >= 70) return "구름 많음";
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

  lines.push("🛰️ <b>Starlink Observer AI V2.1</b>");
  lines.push("실제 고도각 기준 관측 후보입니다.");
  lines.push("");

  for (const r of good) {
    lines.push(
      `${grade(r.score)} <b>${r.city}</b> | ${formatKst(r.date)} | ${r.score}점`
    );
    lines.push(`- ${reasonText(r)}`);
    lines.push(`- 위성: ${r.satName}`);
    lines.push("");
  }

  lines.push("기준: 실제 고도각 + 야간 + 구름 + 강수확률 + 가시거리");

  return lines.join("\n");
}

function buildTestMessage(siteResults) {
  const lines = [];

  lines.push("🛰️ <b>Starlink Observer AI V2.1 테스트 리포트</b>");
  lines.push("70점 이상 관측 후보는 없습니다.");
  lines.push("");

  for (const r of siteResults) {
    if (!r.best) {
      lines.push(`🔴 <b>${r.city}</b> | 후보 없음`);
      lines.push("- 야간 시간대에 고도 조건을 만족한 위성이 없습니다.");
      lines.push("");
      continue;
    }

    lines.push(
      `${grade(r.best.score)} <b>${r.city}</b> | 최고 ${r.best.score}점 | ${formatKst(r.best.date)}`
    );
    lines.push(`- 탈락 이유: ${failReason(r.best)}`);
    lines.push(`- ${reasonText(r.best)}`);
    lines.push(`- 후보 수: ${r.totalCandidates}개`);
    lines.push("");
  }

  lines.push("개발 모드: 기준 미달이어도 상태 확인용 메시지를 보냅니다.");

  return lines.join("\n");
}

function makeCacheKey(message) {
  return message.replace(/\s+/g, " ").slice(0, 500);
}

async function runObserver() {
  console.log(`[${new Date().toISOString()}] Starlink Observer AI V2.1 started`);

  const sats = await fetchStarlinkTles();
  console.log(`Loaded Starlink TLE: ${sats.length}`);

  const siteResults = [];

  for (const site of CONFIG.observerSites) {
    console.log(`Checking ${site.name}`);

    const weather = await getWeatherForecast(site.lat, site.lon);
    const result = findPassesForSite(site, sats, weather);

    console.log(
      `${site.name}: candidates=${result.totalCandidates}, best=${result.best?.score ?? "none"}`
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
