const axios = require("axios");

function toKstHourString(date) {
  const d = new Date(date);

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:00`;
}

async function getWeather(lat, lon, targetDate) {
  const url = "https://api.open-meteo.com/v1/kma";

  const res = await axios.get(url, {
    params: {
      latitude: lat,
      longitude: lon,
      hourly:
        "cloud_cover,precipitation_probability,precipitation,relative_humidity_2m,temperature_2m,wind_speed_10m,visibility",
      timezone: "Asia/Seoul",
      forecast_days: 3,
    },
    timeout: 10000,
  });

  const data = res.data;
  const targetHour = toKstHourString(targetDate);
  const idx = data.hourly.time.indexOf(targetHour);

  if (idx === -1) return null;

  return {
    source: "open-meteo-kma",
    time: data.hourly.time[idx],
    cloud: data.hourly.cloud_cover[idx],
    precipitationProbability: data.hourly.precipitation_probability[idx],
    precipitation: data.hourly.precipitation[idx],
    humidity: data.hourly.relative_humidity_2m[idx],
    temperature: data.hourly.temperature_2m[idx],
    wind: data.hourly.wind_speed_10m[idx],
    visibility: data.hourly.visibility[idx],
  };
}

function judgeWeather(weather, limits) {
  if (!weather) {
    return {
      ok: false,
      level: "unknown",
      reason: "날씨 정보 없음",
    };
  }

  const bad = [];

  if (weather.precipitationProbability >= limits.rainProbabilityLimit) {
    bad.push(`강수확률 ${weather.precipitationProbability}%`);
  }

  if (weather.precipitation >= limits.rainAmountLimit) {
    bad.push(`강수량 ${weather.precipitation}mm`);
  }

  if (weather.cloud >= limits.cloudLimit) {
    bad.push(`구름 ${weather.cloud}%`);
  }

  if (bad.length > 0) {
    return {
      ok: false,
      level: "bad",
      reason: bad.join(", "),
    };
  }

  return {
    ok: true,
    level:
      weather.cloud <= 25 &&
      weather.precipitationProbability <= 10 &&
      weather.precipitation === 0
        ? "excellent"
        : "normal",
    reason: "관측 가능",
  };
}

module.exports = {
  getWeather,
  judgeWeather,
};
