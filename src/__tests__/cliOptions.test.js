import { parseCliOptions } from "#interfaces/cli/options.js";

describe("parseCliOptions", () => {
  test("по умолчанию метрики выключены", () => {
    expect(parseCliOptions()).toEqual({ metricsEnabled: false });
    expect(parseCliOptions([])).toEqual({ metricsEnabled: false });
  });

  test("включает метрики по длинному флагу", () => {
    expect(parseCliOptions(["--metrics"])).toEqual({ metricsEnabled: true });
  });

  test("включает метрики по короткому флагу", () => {
    expect(parseCliOptions(["-m"])).toEqual({ metricsEnabled: true });
  });

  test("игнорирует посторонние аргументы", () => {
    expect(parseCliOptions(["start", "--watch"])).toEqual({ metricsEnabled: false });
  });
});
