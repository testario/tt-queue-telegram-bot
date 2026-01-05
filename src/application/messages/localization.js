import { TIME_OPTIONS } from "../config/time.js";
/**
 * @typedef {import("../types.js").LocaleCode} LocaleCode
 * @typedef {import("../types.js").LocaleDefinition} LocaleDefinition
 * @typedef {import("../types.js").LocalizationConfig} LocalizationConfig
 * @typedef {import("../types.js").LocalizationResult} LocalizationResult
 */

import { en } from "./locales/en.js";
import { es } from "./locales/es.js";
import { fr } from "./locales/fr.js";
import { de } from "./locales/de.js";
import { ru } from "./locales/ru.js";

/** @type {Record<LocaleCode, LocaleDefinition>} */
const locales = { ru, en, es, fr, de };

/**
 * Функция для выбора локализации по коду
 * @param {LocaleCode} code 
 * @returns {LocaleDefinition}
 */
const pickLocale = (code) => (code && locales[code]) || null;

/**
 * Функция для получения объекта локализации для объединения с базовой локалью
 * @param {LocaleCode} primary 
 * @param {LocaleCode} fallback 
 * @returns {LocalizationConfig}
 */
const mergeWithFallback = (primary, fallback) => {
  const result = { ...fallback };
  Object.entries(primary || {}).forEach(([key, value]) => {
    const fallbackValue = fallback?.[key];
    const isObject =
      value && typeof value === "object" && !Array.isArray(value) && typeof fallbackValue === "object";

    if (isObject) {
      result[key] = mergeWithFallback(value, fallbackValue || {});
      return;
    }
    result[key] = value;
  });
  return result;
};

/**
 * Создает локализацию (сообщения и UI) с учетом запрошенной и запасной локалей.
 * @param {LocalizationConfig} [config]
 * @returns {LocalizationResult}
 */
const createLocalization = ({ locale, fallbackLocale } = {}) => {
  const requested = pickLocale(locale) || pickLocale(fallbackLocale) || locales.ru;
  const fallback = pickLocale(fallbackLocale) || locales.ru;

  const formatDate = (date) =>
    date.toLocaleString(requested.dateLocale || requested.code || "ru", TIME_OPTIONS);

  const messages = mergeWithFallback(
    requested.createMessages({ formatDate }),
    fallback.createMessages({ formatDate })
  );
  const ui = mergeWithFallback(requested.createUi(), fallback.createUi());

  return {
    locale: requested.code,
    messages,
    ui,
  };
};

export { createLocalization };

