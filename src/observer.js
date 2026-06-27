import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  ecfToLookAngles,
  degreesToRadians,
  radiansToDegrees
} from "satellite.js";

import SunCalc from "suncalc";
import { CONFIG } from "./config.js";
import { findNearestWeather } from "./weather.js";

const EARTH_RADIUS_KM = 6371;
const PASS_BUCKET_MINUTES = 50;

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
  if (site) return getSunAltitudeDeg(site, date) <= -8;

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

function vectorLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function isSatelliteSunlit(positionEci, date) {
  const sun = SunCalc.getPosition(date, 0, 0);

  const sunDirection = {
    x: Math.cos(sun.altitude) * Math.cos(sun.azimuth),
    y: Math.cos(sun.altitude) * Math.sin(sun.azimuth),
    z: Math.sin(sun.altitude)
  };

  const proj = dot(positionEci, sunDirection);

  if (proj > 0) return true;

  const satDistance = vectorLength(positionEci);
  const perpendicularDistanceSq = satDistance * satDistance - proj * proj;

  if (perpendicularDistanceSq < 0) return false;

  return Math.sqrt(perpendicularDistanceSq) > EARTH_RADIUS_KM;
}

export function getLookAngles(site, satrec, date) {
  const pv = propagate(satrec, date);
  if (!pv.position) return null;

  const gmst = gstime(date);
  const positionEcf = eciToEcf(pv.position, gmst);
  const geo = eciToGeodetic(pv.position, gmst);

  const observerGd = {
    longitude: degreesToRadians(site.lon),
    latitude: degreesToRadians(site.lat),
    height: 0
  };

  const look = ecfToLookAngles(observerGd, positionEcf);

  return {
    azimuthDeg: normalizeDegrees(radiansToDegrees(look.azimuth)),
    elevationDeg: radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat,
    satLatDeg: radiansToDegrees(geo.latitude),
    satLonDeg: normalizeDegrees(radiansToDegrees(geo.longitude)),
    satHeightKm: geo.height,
    sunlit: isSatelliteSunlit(pv.position, date)
  };
}

function estimateMagnitude({
  elevationDeg,
  rangeKm,
  sunAltitudeDeg,
  cloudCover,
  sunlit
}) {
  let mag = sunlit ? 3.5 : 7.0;

  if (elevationDeg >= 85) mag -= 2.7;
  else if (elevationDeg >= 75) mag -= 2.3;
  else if (elevationDeg >= 65) mag -= 1.9;
  else if (elevationDeg >= 55) mag -= 1.4;
  else if (elevationDeg >= 45) mag -= 0.9;
  else if (elevationDeg >= 35) mag -= 0.4;
  else mag += 0.2;

  if (rangeKm <= 300) mag -= 1.2;
  else if (rangeKm <= 420) mag -= 0.8;
  else if (rangeKm <= 600) mag -= 0.4;
  else if (rangeKm <= 850) mag -= 0.1;
  else if (rangeKm >= 1200) mag += 0.8;

  if (sunAltitudeDeg <= -24) mag += 0.9;
  else if (sunAltitudeDeg <= -18) mag += 0.5;
  else if (sunAltitudeDeg <= -14) mag += 0.2;
  else if (sunAltitudeDeg <= -10) mag += 0.5;
  else if (sunAltitudeDeg <= -8) mag += 1.0;

  if (cloudCover >= 60) mag += 1.6;
  else if (cloudCover >= 40) mag += 1.0;
  else if (cloudCover >= 25) mag += 0.6;
  else if (cloudCover >= 10) mag += 0.25;

  return Math.round(mag * 10) / 10;
}

function starRating(magnitude) {
  if (magnitude <= -1.0) return "★★★★★";
  if (magnitude <= -0.2) return "★★★★☆";
  if (magnitude <= 0.8) return "★★★☆☆";
  if (magnitude <= 1.8) return "★★☆☆☆";
  return "★☆☆☆☆";
}

export function scorePass({
  site,
  elevationDeg,
  rangeKm,
  weather,
  date,
  sunlit = true
}) {
  if (!isObservableNight(date, site)) return 0;
  if (!sunlit) return 0;

  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);
  const visibility = Number(weather.visibility ?? 0);
  const sunAltitudeDeg = getSunAltitudeDeg(site, date);

  if (cloud >= 70) return 0;
  if (rain >= 45) return 0;

  let score = 0;

  if (elevationDeg >= 85) score += 24;
  else if (elevationDeg >= 75) score += 22;
  else if (elevationDeg >= 65) score += 19;
  else if (elevationDeg >= 55) score += 15;
  else if (elevationDeg >= 45) score += 11;
  else if (elevationDeg >= 35) score += 6;
  else if (elevationDeg >= 25) score += 2;
  else return 0;

  if (sunAltitudeDeg <= -24) score += 11;
  else if (sunAltitudeDeg <= -18) score += 17;
  else if (sunAltitudeDeg <= -15) score += 16;
  else if (sunAltitudeDeg <= -12) score += 12;
  else if (sunAltitudeDeg <= -10) score += 7;
  else if (sunAltitudeDeg <= -8) score += 3;
  else return 0;

  if (cloud <= 3) score += 20;
  else if (cloud <= 8) score += 17;
  else if (cloud <= 15) score += 13;
  else if (cloud <= 25) score += 8;
  else if (cloud <= 40) score += 3;
  else if (cloud <= 55) score -= 10;
  else score -= 25;

  if (rain <= 2) score += 8;
  else if (rain <= 8) score += 6;
  else if (rain <= 15) score += 3;
  else if (rain <= 30) score -= 6;
  else score -= 20;

  if (visibility >= 20000) score += 4;
  else if (visibility >= 12000) score += 2;
  else if (visibility > 0 && visibility < 8000) score -= 12;

  if (rangeKm <= 300) score += 7;
  else if (rangeKm <= 420) score += 5;
  else if (rangeKm <= 600) score += 3;
  else if (rangeKm <= 850) score += 1;
  else if (rangeKm >= 1200) score -= 12;

  const magnitude = estimateMagnitude({
    elevationDeg,
    rangeKm,
    sunAltitudeDeg,
    cloudCover: cloud,
    sunlit
  });

  if (magnitude <= -1.0) score += 17;
  else if (magnitude <= -0.2) score += 13;
  else if (magnitude <= 0.8) score += 8;
  else if (magnitude <= 1.8) score += 2;
  else score -= 18;

  return Math.max(0, Math.min(96, Math.round(score)));
}

function successProbability(score, weather) {
  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);

  let p = score;

  if (cloud >= 25) p -= 4;
  if (cloud >= 40) p -= 8;
  if (cloud >= 55) p -= 12;
  if (rain >= 15) p -= 5;
  if (rain >= 30) p -= 10;

  return Math.max(0, Math.min(96, Math.round(p)));
}

function isHardWeatherFail(weather) {
  const cloud = Number(weather.cloudCover ?? 100);
  const rain = Number(weather.precipitationProbability ?? 100);

  if (cloud >= 70) return true;
  if (rain >= 45) return true;

  return false;
}

function makePassKey(candidate) {
  const bucket = Math.floor(candidate.date.getTime() / (PASS_BUCKET_MINUTES * 60 * 1000));
  return `${candidate.city}-${candidate.satName}-${bucket}`;
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

  return Array.from(map.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.date - b.date;
  });
}

function selectBestPerCity(collapsed) {
  if (collapsed.length === 0) return [];
  return [collapsed[0]];
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

      if (!look.sunlit) continue;
      if (look.elevationDeg < CONFIG.starlink.minElevationDeg) continue;

      const sunAltitudeDeg = getSunAltitudeDeg(site, date);

      const magnitude = estimateMagnitude({
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
        sunAltitudeDeg,
        cloudCover: Number(nearestWeather.cloudCover ?? 100),
        sunlit: look.sunlit
      });

      const score = scorePass({
        site,
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
        weather: nearestWeather,
        date,
        sunlit: look.sunlit
      });

      if (score <= 0) continue;

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

  const selected = selectBestPerCity(collapsed).filter(
    c => c.score >= CONFIG.scoring.minScoreToNotify
  );

  return {
    city: site.name,
    totalCandidates: candidates.length,
    totalPasses: collapsed.length,
    best,
    selected
  };
}

