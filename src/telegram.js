const axios = require("axios");

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) {
    throw new Error("Telegram Token 또는 Chat ID가 없습니다.");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(
    url,
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    },
    {
      timeout: 10000,
    }
  );
}

module.exports = {
  sendTelegram,
};
