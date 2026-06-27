const { telegram } = require("./config");
const { sendTelegram } = require("./telegram");

async function main() {
  console.log("🛰️ Starlink Observer AI v2 starting...");

  await sendTelegram(
    telegram.token,
    telegram.chatId,
    "✅ Starlink Observer AI v2 Railway 연결 성공"
  );

  console.log("✅ Telegram test message sent");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
