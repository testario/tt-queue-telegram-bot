/**
 * @typedef {import("../types.js").LocalizationResult} LocalizationResult
 */

import { I18N_CONFIG } from "../config/i18n.js";
import { createLocalization } from "./localization.js";

/** @type {LocalizationResult} */
const localization = createLocalization(I18N_CONFIG);
const { messages: templates, ui, locale: messagesLocale } = localization;

export { messagesLocale, templates, ui };

