function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scoreBrightness(brightness) {
  const b = Number(brightness);
  if (!Number.isFinite(b)) return 0;
  if (b <= 1.5) return 30;
  if (b <= 2.0) return 25;
  if (b <= 2.5) return 18;
  if (b <= 3.0) return 8;
  return 0;
}

function scoreElevation(maxElev) {
  const e = Number(maxElev);
  if (!Number.isFinite(e)) return 0;
  if (e >= 80) return 20;
  if (e >= 60) return 17;
  if (e >= 45) return 12;
  if (e >= 30) return 6;
  return 0;
}

function scoreDuration(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m)) return 0;
  if (m >= 5) return 10;
  if (m >= 3) return 7;
  if (m >= 2) return 4;
  return 0;
}

function scoreWeather(weather) {
  if (!weather) return { score: 0, penaltyReason: "날씨 정보 없음" };

  let score = 40;
  const reasons = [];

  if (weather.precipitationProbability >= 50) {
    score -= 40;
    reasons.push(`강수확률 ${weather.precipitationProbability}%`);
  } else if (weather.precipitationProbability >= 30) {
    score -= 25;
    reasons.push(`강수확률 ${weather.precipitationProbability}%`);
  } else if (weather.precipitationProbability >= 20) {
    score -= 12;
    reasons.push(`강수확률 ${weather.precipitationProbability}%`);
  }

  if (weather.precipitation >= 0.2) {
    score -= 40;
    reasons.push(`강수량 ${weather.precipitation}mm`);
  } else if (weather.precipitation > 0) {
    score -= 15;
    reasons.push(`강수량 ${weather.precipitation}mm`);
  }

  if (weather.cloud >= 80) {
    score -= 25;
    reasons.push(`구름 ${weather.cloud}%`);
  } else if (weather.cloud >= 60) {
    score -= 15;
    reasons.push(`구름 ${weather.cloud}%`);
  } else if (weather.cloud >= 40) {
    score -= 8;
    reasons.push(`구름 ${weather.cloud}%`);
  }

  return {
    score: clamp(score, 0, 40),
    penaltyReason: reasons.join(", "),
  };
}

function calculateScore(pass, weather) {
  const brightness = scoreBrightness(pass.brightness);
  const elevation = scoreElevation(pass.maxElev);
  const duration = scoreDuration(pass.mins);
  const weatherScore = scoreWeather(weather);

  const total = brightness + elevation + duration + weatherScore.score;

  let grade = "❌ 비추천";
  if (total >= 85) grade = "⭐⭐⭐ 강력 추천";
  else if (total >= 70) grade = "⭐⭐ 추천";
  else if (total >= 55) grade = "⭐ 조건부";

  return {
    total,
    grade,
    detail: {
      brightness,
      elevation,
      duration,
      weather: weatherScore.score,
      weatherPenalty: weatherScore.penaltyReason,
    },
  };
}

module.exports = {
  calculateScore,
};
