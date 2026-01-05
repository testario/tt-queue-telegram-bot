/**
 * @typedef {import("../types.js").LocalizationConfig} LocalizationConfig
 */

const DEFAULT_LOCALE = "ru";
const DEFAULT_FALLBACK_LOCALE = "ru";

/** @type {LocalizationConfig} */
const I18N_CONFIG = {
  locale: process.env.BOT_LOCALE || DEFAULT_LOCALE,
  fallbackLocale: process.env.BOT_FALLBACK_LOCALE || DEFAULT_FALLBACK_LOCALE,
};

export { I18N_CONFIG };

