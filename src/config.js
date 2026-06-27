require("dotenv").config();

module.exports = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  locations: [
    {
      name: "대전",
      lat: 36.3504,
      lon: 127.3845,
    },
    {
      name: "용인",
      lat: 37.2411,
      lon: 127.1776,
    },
    {
      name: "안산",
      lat: 37.3219,
      lon: 126.8309,
    },
  ],

  weather: {
    cloudLimit: 40,
    rainProbabilityLimit: 20,
    rainAmountLimit: 0.2,
  },
};
