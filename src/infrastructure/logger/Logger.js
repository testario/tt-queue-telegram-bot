const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const COLORS = {
  error: { start: "\x1b[31m", end: "\x1b[0m" }, // red
  warn: { start: "\x1b[33m", end: "\x1b[0m" }, // yellow
  info: { start: "\x1b[36m", end: "\x1b[0m" }, // cyan
  debug: { start: "\x1b[90m", end: "\x1b[0m" }, // gray
};

// Цвета префиксов зависят только от уровня вложенности (по сегментам).
const PREFIX_LEVEL_COLORS = [
  { start: "\x1b[34m", end: "\x1b[0m" }, // level 1: blue
  { start: "\x1b[33m", end: "\x1b[0m" }, // level 2: yellow
  { start: "\x1b[35m", end: "\x1b[0m" }, // level 3: magenta
  { start: "\x1b[32m", end: "\x1b[0m" }, // level 4: green
];

const noop = () => {};

const colorizePrefix = (prefix, outerColor) => {
  if (!prefix) {
    return "";
  }
  const segments = prefix.split(":");
  return segments
    .map((segment, index) => {
      const palette = PREFIX_LEVEL_COLORS[index % PREFIX_LEVEL_COLORS.length];
      // Reset к цвету уровня лога после сегмента.
      return `${palette.start}${segment}${palette.end}${outerColor}`;
    })
    .join(":");
};

class Logger {
  constructor({ level = "info", prefix = "", writer = console } = {}) {
    this.level = level;
    this.prefix = prefix;
    this.writer = writer;
  }

  log(level, message, context) {
    if (LEVELS[level] > LEVELS[this.level]) {
      return;
    }
    const time = new Date().toISOString();
    const color = COLORS[level] || COLORS.info;
    const scopedPrefix = colorizePrefix(this.prefix, color.start);
    const scoped = this.prefix ? `[${scopedPrefix}] ` : "";
    const contextPart =
      context && Object.keys(context).length > 0
        ? ` | ${JSON.stringify(context)}`
        : "";
    const text = `${color.start}${time} ${level.toUpperCase()} ${scoped}${message}${contextPart}${color.end}`;
    const printer = this.writer[level] || this.writer.log || noop;
    printer.call(this.writer, text);
  }

  info(message, context) {
    this.log("info", message, context);
  }

  warn(message, context) {
    this.log("warn", message, context);
  }

  error(message, context) {
    this.log("error", message, context);
  }

  debug(message, context) {
    this.log("debug", message, context);
  }

  child(suffix) {
    const prefix = this.prefix ? `${this.prefix}:${suffix}` : suffix;
    return new Logger({ level: this.level, prefix, writer: this.writer });
  }
}

const createLogger = (options = {}) => new Logger(options);

const createNullLogger = () => ({
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  child: () => createNullLogger(),
});

export { Logger, createLogger, createNullLogger };


