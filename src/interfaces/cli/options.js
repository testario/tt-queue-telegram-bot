const METRICS_FLAGS = new Set(["--metrics", "-m"]);

/**
 * @param {string[]} [argv]
 * @returns {{ metricsEnabled: boolean }}
 */
const parseCliOptions = (argv = []) => ({
  metricsEnabled: argv.some((arg) => METRICS_FLAGS.has(arg)),
});

export { parseCliOptions };
