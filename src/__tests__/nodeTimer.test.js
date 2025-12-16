import { jest } from "@jest/globals";
import { NodeTimer } from "#infrastructure/timers/NodeTimer.js";

describe("NodeTimer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("выполняет запланированную задачу", () => {
    const timer = new NodeTimer();
    const callback = jest.fn();

    timer.schedule("task", 50, callback);
    jest.advanceTimersByTime(60);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("cancel отменяет задачу и не вызывает callback", () => {
    const timer = new NodeTimer();
    const callback = jest.fn();

    timer.schedule("task", 50, callback);
    timer.cancel("task");
    jest.advanceTimersByTime(60);

    expect(callback).not.toHaveBeenCalled();
  });

  test("cancelAll удаляет все задачи", () => {
    const timer = new NodeTimer();
    const first = jest.fn();
    const second = jest.fn();

    timer.schedule("first", 50, first);
    timer.schedule("second", 50, second);
    timer.cancelAll();
    jest.advanceTimersByTime(60);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});


