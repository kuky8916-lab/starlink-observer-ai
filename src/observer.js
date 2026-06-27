import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  degreesToRadians,
  radiansToDegrees
} from "satellite.js";

import SunCalc from "suncalc";
import { CONFIG } from "./config.js";
import { findNearestWeather } from "./weather.js";

export function parseSatellite(tle) {
  try {
    return {
      name: tle.name,
      satrec: twoline2satrec(tle.line1, tle.line2)
    };
  } catch {
    return null;
  }
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

export function getSunAltitudeDeg(site, date) {
  const pos = SunCalc.getPosition(date, site.lat, site.lon);
  return radiansToDegrees(pos.altitude);
}

export function isObservableNight(date, site = null) {
  if (site) {
    const sunAlt = getSunAltitudeDeg(site, date);
    return sunAlt <= -8;
  }

  const hour = getKstHour(date);
  return hour >= 20 || hour <= 4;
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

export function scorePass({ site, elevationDeg, rangeKm, weather, date }) {
  if (!isObservableNight(date, site)) return 0;

  let score = 0;

  if (elevationDeg >= 80) score += 42;
  else if (elevationDeg >= 65) score += 38;
  else if (elevationDeg >= 50) score += 32;
  else if (elevationDeg >= 35) score += 24;
  else if (elevationDeg >= 25) score += 14;
  else return 0;

  const sunAlt = getSunAltitudeDeg(site, date);

  if (sunAlt <= -12) score += 25;
  else if (sunAlt <= -10) score += 22;
  else if (sunAlt <= -8) score += 16;
  else return 0;

  const cloud = Number(weather.cloudCover ?? 100);

  if (cloud <= 10) score += 25;
  else if (cloud <= 25) score += 20;
  else if (cloud <= 40) score += 12;
  else if (cloud <= 60) score += 4;
  else if (cloud <= 75) score -= 20;
  else score -= 45;

  const rain = Number(weather.precipitationProbability ?? 100);

  if (rain <= 10) score += 8;
  else if (rain <= 30) score += 3;
  else if (rain <= 50) score -= 18;
  else score -= 40;

  const visibility = Number(weather.visibility ?? 0);

  if (visibility >= 20000) score += 5;
  else if (visibility >= 12000) score += 2;
  else if (visibility > 0 && visibility < 8000) score -= 10;

  if (rangeKm <= 600) score += 5;
  else if (rangeKm <= 900) score += 2;
  else if (rangeKm >= 1400) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function isHardWeatherFail(weather) {
  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);

  if (cloud >= 85) return true;
  if (rain >= 60) return true;

  return false;
}

export function findPassesForSite(site, rawTles, weather) {
  const now = new Date();
  const end = new Date(
    now.getTime() + CONFIG.starlink.lookAheadHours * 3600 * 1000
  );

  const sats = rawTles
    .slice(0, CONFIG.starlink.maxSatellitesToCheck || 700)
    .map(parseSatellite)
    .filter(Boolean);

  const candidates = [];

  for (
    let t = now.getTime();
    t <= end.getTime();
    t += CONFIG.starlink.stepSeconds * 1000
  ) {
    const date = new Date(t);

    if (!isObservableNight(date, site)) continue;

    const nearestWeather = findNearestWeather(weather, date);
    if (isHardWeatherFail(nearestWeather)) continue;

    for (const sat of sats) {
      const look = getLookAngles(site, sat.satrec, date);
      if (!look) continue;

      if (look.elevationDeg < CONFIG.starlink.minElevationDeg) continue;

      const score = scorePass({
        site,
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
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
        sunAltitudeDeg: getSunAltitudeDeg(site, date),
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
