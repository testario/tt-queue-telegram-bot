const stripAt = (value) =>
  typeof value === "string" ? value.replace(/^@+/, "") : value;

const formatReadyTime = (() => {
  const pluralizeRu = (value, [one, few, many]) => {
    const abs = Math.abs(value);
    const mod100 = abs % 100;
    const mod10 = abs % 10;

    if (mod100 > 10 && mod100 < 20) return many;
    if (mod10 > 1 && mod10 < 5) return few;
    if (mod10 === 1) return one;
    return many;
  };

  const fallbackDict = {
    ru: {
      hour: ["час", "часа", "часов"],
      minute: ["минута", "минуты", "минут"],
      second: ["секунда", "секунды", "секунд"],
      pluralize: pluralizeRu,
    },
    default: {
      hour: ["hour", "hours"],
      minute: ["minute", "minutes"],
      second: ["second", "seconds"],
      pluralize: (value, [one, many]) => (value === 1 ? one : many),
    },
  };

  const formatFallback = (ms, locale = "ru") => {
    const totalSeconds = Math.round(ms / 1000);
    const dict = fallbackDict[locale] || fallbackDict.default;

    const formatUnit = (value, unitKey) => {
      const forms = dict[unitKey];
      const word = forms.length === 3 ? dict.pluralize(value, forms) : dict.pluralize(value, forms);
      return `${value} ${word}`;
    };

    if (totalSeconds % 3600 === 0 && totalSeconds >= 3600) {
      const hours = totalSeconds / 3600;
      return formatUnit(hours, "hour");
    }

    if (totalSeconds % 60 === 0 && totalSeconds >= 60) {
      const minutes = totalSeconds / 60;
      return formatUnit(minutes, "minute");
    }

    return formatUnit(totalSeconds, "second");
  };

  return (ms, locale = "ru") => {
    try {
      const formatter = {
        second: new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "long" }),
        minute: new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "long" }),
        hour: new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "long" }),
      };

      const totalSeconds = Math.round(ms / 1000);

      if (totalSeconds % 3600 === 0 && totalSeconds >= 3600) {
        return formatter.hour.format(totalSeconds / 3600);
      }

      if (totalSeconds % 60 === 0 && totalSeconds >= 60) {
        return formatter.minute.format(totalSeconds / 60);
      }

      return formatter.second.format(totalSeconds);
    } catch (error) {
      return formatFallback(ms, locale);
    }
  };
})();

export { stripAt, formatReadyTime };

