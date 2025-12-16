import "dotenv/config";
import { createBot } from "#interfaces/telegram/bot.js";

const token = process.env.TG_BOT_API_TOKEN;

if (!token) {
  throw new Error("TG_BOT_API_TOKEN не найден в окружении");
}

createBot(token);