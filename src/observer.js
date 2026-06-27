import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  degreesToRadians,
  radiansToDegrees
} from "satellite.js";

import { CONFIG } from "./config.js";
import { findNearestWeather } from "./weather.js";

export async function fetchStarlinkTles() {
  const res = await fetch(CONFIG.starlink.tleUrl);
  if (!res.ok) throw new Error(`TLE fetch error: ${res.status}`);

  const text = await res.text();
  const lines = text.split("\n").map(v => v.trim()).filter(Boolean);

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
    } catch {}
  }

  return sats;
}

export function getKstHour(date) {
  return Number(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: CONFIG.timezone,
      hour: "2-digit",
      hour12: false
    }).format(date)
  );
}

export function isObservableNight(date) {
  const hour = getKstHour(date);
  return hour >= 20 || hour <= 4;
}

export function getLookAngles(site, satrec, date) {
  const pv = propagate(satrec, date);
  if (!pv.position) return null;

  const gmst = gstime(date);
  const positionEcf = eciToEcf(pv.position, gmst);

  const observerGd = {
    longitude: degreesToRadians(site.lon),
    latitude: degreesToRadians(site.lat),
    height: 0
  };

  const look = ecfToLookAngles(observerGd, positionEcf);

  return {
    azimuthDeg: normalizeDegrees(radiansToDegrees(look.azimuth)),
    elevationDeg: radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat
  };
}

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

export function directionText(azimuthDeg) {
  if (azimuthDeg >= 337.5 || azimuthDeg < 22.5) return "북";
  if (azimuthDeg < 67.5) return "북동";
  if (azimuthDeg < 112.5) return "동";
  if (azimuthDeg < 157.5) return "남동";
  if (azimuthDeg < 202.5) return "남";
  if (azimuthDeg < 247.5) return "남서";
  if (azimuthDeg < 292.5) return "서";
  return "북서";
}

export function scorePass({ elevationDeg, weather, date }) {
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

export function findPassesForSite(site, sats, weather) {
  const now = new Date();
  const end = new Date(
    now.getTime() + CONFIG.starlink.lookAheadHours * 3600 * 1000
  );

  const targetSats = sats.slice(0, CONFIG.starlink.maxSatellitesToCheck || 700);
  const candidates = [];

  for (
    let t = now.getTime();
    t <= end.getTime();
    t += CONFIG.starlink.stepSeconds * 1000
  ) {
    const date = new Date(t);

    if (!isObservableNight(date)) continue;

    for (const sat of targetSats) {
      const look = getLookAngles(site, sat.satrec, date);
      if (!look) continue;

      if (look.elevationDeg < CONFIG.starlink.minElevationDeg) continue;

      const nearestWeather = findNearestWeather(weather, date);

      const score = scorePass({
        elevationDeg: look.elevationDeg,
        weather: nearestWeather,
        date
      });

      candidates.push({
        city: site.name,
        satName: sat.name,
        date,
        elevationDeg: look.elevationDeg,
        azimuthDeg: look.azimuthDeg,
        direction: directionText(look.azimuthDeg),
        rangeKm: look.rangeKm,
        weather: nearestWeather,
        score
      });
    }
  }

  const sorted = candidates.sort((a, b) => b.score - a.score);
  const best = sorted[0] || null;

  const selected = [];

  for (const c of sorted) {
    if (c.score < CONFIG.scoring.minScoreToNotify) continue;

    const tooClose = selected.some(d => {
      return Math.abs(d.date.getTime() - c.date.getTime()) < 15 * 60 * 1000;
    });

    if (!tooClose) selected.push(c);

    if (selected.length >= CONFIG.starlink.maxResultsPerCity) break;
  }

  return {
    city: site.name,
    totalCandidates: candidates.length,
    best,
    selected: selected.sort((a, b) => a.date - b.date)
  };
}
