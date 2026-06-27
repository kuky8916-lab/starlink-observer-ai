import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  timezone: "Asia/Seoul",

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },

  observerSites: [
    { name: "대전", lat: 36.3504, lon: 127.3845 },
    { name: "용인", lat: 37.2411, lon: 127.1776 },
    { name: "안산", lat: 37.3219, lon: 126.8309 }
  ],

  starlink: {
    tleUrl: "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle",
    minElevationDeg: 20,
    maxResultsPerCity: 3,
    lookAheadHours: 24,
    stepSeconds: 30
  },

  scoring: {
    minScoreToNotify: 60,
    excellentScore: 80,
    cloudPenaltyStrong: 70,
    rainPenaltyStrong: 60
  },

  schedule: {
    intervalMinutes: Number(process.env.INTERVAL_MINUTES || 60)
  }
};

export function validateConfig() {
  const missing = [];

  if (!CONFIG.telegram.token) missing.push("TELEGRAM_BOT_TOKEN");
  if (!CONFIG.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");

  if (missing.length > 0) {
    throw new Error(`환경변수 누락: ${missing.join(", ")}`);
  }
}
