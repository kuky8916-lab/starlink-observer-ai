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
    return getSunAltitudeDeg(site, date) <= -8;
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

function estimateMagnitude({ elevationDeg, rangeKm, sunAltitudeDeg, cloudCover }) {
  let mag = 3.2;

  if (elevationDeg >= 75) mag -= 2.6;
  else if (elevationDeg >= 60) mag -= 2.1;
  else if (elevationDeg >= 45) mag -= 1.5;
  else if (elevationDeg >= 30) mag -= 0.8;
  else mag -= 0.2;

  if (rangeKm <= 450) mag -= 1.0;
  else if (rangeKm <= 650) mag -= 0.6;
  else if (rangeKm <= 900) mag -= 0.2;
  else if (rangeKm >= 1300) mag += 0.8;

  if (sunAltitudeDeg <= -18) mag += 0.6;
  else if (sunAltitudeDeg <= -12) mag += 0.1;
  else if (sunAltitudeDeg <= -8) mag += 0.5;

  if (cloudCover >= 60) mag += 1.4;
  else if (cloudCover >= 40) mag += 0.8;
  else if (cloudCover >= 25) mag += 0.4;

  return Math.round(mag * 10) / 10;
}

function starRating(magnitude) {
  if (magnitude <= -1.0) return "★★★★★";
  if (magnitude <= 0.0) return "★★★★";
  if (magnitude <= 1.0) return "★★★";
  if (magnitude <= 2.0) return "★★";
  return "★";
}

export function scorePass({ site, elevationDeg, rangeKm, weather, date }) {
  if (!isObservableNight(date, site)) return 0;

  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);
  const visibility = Number(weather.visibility ?? 0);
  const sunAltitudeDeg = getSunAltitudeDeg(site, date);

  let score = 0;

  if (elevationDeg >= 80) score += 32;
  else if (elevationDeg >= 65) score += 28;
  else if (elevationDeg >= 50) score += 22;
  else if (elevationDeg >= 35) score += 15;
  else if (elevationDeg >= 25) score += 8;
  else return 0;

  if (sunAltitudeDeg <= -16) score += 20;
  else if (sunAltitudeDeg <= -12) score += 17;
  else if (sunAltitudeDeg <= -10) score += 12;
  else if (sunAltitudeDeg <= -8) score += 7;
  else return 0;

  if (cloud <= 5) score += 24;
  else if (cloud <= 15) score += 20;
  else if (cloud <= 25) score += 14;
  else if (cloud <= 40) score += 7;
  else if (cloud <= 55) score -= 8;
  else if (cloud <= 70) score -= 25;
  else return 0;

  if (rain <= 5) score += 10;
  else if (rain <= 15) score += 6;
  else if (rain <= 30) score += 1;
  else if (rain <= 45) score -= 18;
  else return 0;

  if (visibility >= 20000) score += 6;
  else if (visibility >= 12000) score += 3;
  else if (visibility > 0 && visibility < 8000) score -= 12;

  if (rangeKm <= 450) score += 8;
  else if (rangeKm <= 650) score += 5;
  else if (rangeKm <= 900) score += 2;
  else if (rangeKm >= 1300) score -= 12;

  const magnitude = estimateMagnitude({
    elevationDeg,
    rangeKm,
    sunAltitudeDeg,
    cloudCover: cloud
  });

  if (magnitude <= -1) score += 10;
  else if (magnitude <= 0) score += 7;
  else if (magnitude <= 1) score += 4;
  else if (magnitude <= 2) score += 1;
  else score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function isHardWeatherFail(weather) {
  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);

  if (cloud >= 75) return true;
  if (rain >= 50) return true;

  return false;
}

function makePassKey(candidate) {
  const bucket = Math.floor(candidate.date.getTime() / (12 * 60 * 1000));
  return `${candidate.city}-${bucket}`;
}

function collapseSamePasses(candidates) {
  const map = new Map();

  for (const c of candidates) {
    const key = makePassKey(c);
    const old = map.get(key);

    if (!old || c.score > old.score) {
      map.set(key, c);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

function successProbability(score, weather) {
  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);

  let p = score;

  if (cloud >= 50) p -= 12;
  if (rain >= 30) p -= 10;

  return Math.max(0, Math.min(98, Math.round(p)));
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

      const sunAltitudeDeg = getSunAltitudeDeg(site, date);

      const magnitude = estimateMagnitude({
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
        sunAltitudeDeg,
        cloudCover: Number(nearestWeather.cloudCover ?? 100)
      });

      const score = scorePass({
        site,
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
        weather: nearestWeather,
        date
      });

      candidates.push({
        city: site.name,
        lat: site.lat,
        lon: site.lon,
        satName: sat.name,
        date,
        elevationDeg: look.elevationDeg,
        azimuthDeg: look.azimuthDeg,
        direction: directionText(look.azimuthDeg),
        rangeKm: look.rangeKm,
        weather: nearestWeather,
        sunAltitudeDeg,
        magnitude,
        stars: starRating(magnitude),
        probability: successProbability(score, nearestWeather),
        score
      });
    }
  }

  const collapsed = collapseSamePasses(candidates);
  const best = collapsed[0] || null;

  const selected = [];

  for (const c of collapsed) {
    if (c.score < CONFIG.scoring.minScoreToNotify) continue;

    const tooClose = selected.some(d => {
      return Math.abs(d.date.getTime() - c.date.getTime()) < 25 * 60 * 1000;
    });

    if (!tooClose) selected.push(c);

    if (selected.length >= CONFIG.starlink.maxResultsPerCity) break;
  }

  return {
    city: site.name,
    totalCandidates: candidates.length,
    totalPasses: collapsed.length,
    best,
    selected: selected.sort((a, b) => a.date - b.date)
  };
}
