const SHEET_WEBAPP_URL =
  process.env.SHEET_WEBAPP_URL ||
  process.env.GOOGLE_SHEET_WEBAPP_URL ||
  "";

function formatKstForSheet(date, timezone) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function gradeText(score) {
  if (score >= 90) return "매우 좋음";
  if (score >= 80) return "좋음";
  if (score >= 70) return "추천";
  if (score >= 60) return "보통";
  return "낮음";
}

export async function saveStarlinkResults(siteResults, config) {
  if (!SHEET_WEBAPP_URL) {
    console.log("Sheet save skipped: SHEET_WEBAPP_URL is not set.");
    return { ok: false, skipped: true, reason: "missing SHEET_WEBAPP_URL" };
  }

  const rows = siteResults
    .flatMap(site => site.selected || [])
    .map(r => ({
      city: r.city,
      dateText: formatKstForSheet(r.date, config.timezone),
      satName: r.satName,
      elevationDeg: r.elevationDeg,
      direction: r.direction,
      rangeKm: r.rangeKm,
      magnitude: r.magnitude,
      weatherCloud: r.weather?.cloudCover ?? "",
      weatherRain: r.weather?.precipitationProbability ?? "",
      probability: r.probability,
      score: r.score,
      stars: r.stars,
      grade: gradeText(r.score)
    }));

  if (rows.length === 0) {
    console.log("Sheet save skipped: no selected rows.");
    return { ok: true, saved: 0 };
  }

  const response = await fetch(SHEET_WEBAPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ rows })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Sheet save failed: HTTP ${response.status} ${text}`);
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    result = { ok: true, raw: text };
  }

  console.log(`Sheet save result: ${JSON.stringify(result)}`);
  return result;
}

