import "dotenv/config";
import { createBot } from "#interfaces/telegram/bot.js";
import { parseCliOptions } from "#interfaces/cli/options.js";

const token = process.env.TG_BOT_API_TOKEN;
const { metricsEnabled } = parseCliOptions(process.argv.slice(2));

if (!token) {
  throw new Error("TG_BOT_API_TOKEN не найден в окружении");
}

createBot(token, { metricsEnabled });
