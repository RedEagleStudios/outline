/** @jest-environment jsdom */

import { registerViewportObserver } from "./viewportObserverRegistry";

class ObserverMock {
  static instances: ObserverMock[] = [];
  callback: IntersectionObserverCallback;
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    ObserverMock.instances.push(this);
  }
}

describe("viewportObserverRegistry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ObserverMock.instances = [];
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: ObserverMock,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("pools canonical options and uniquely dispatches duplicate callbacks", () => {
    const target = document.createElement("div");
    const callback = jest.fn();
    const first = registerViewportObserver(target, callback, {
      rootMargin: "10px 20px",
      threshold: [1, 0, 1],
    });
    const second = registerViewportObserver(target, callback, {
      rootMargin: "10px 20px 10px 20px",
      threshold: [0, 1],
    });
    expect(ObserverMock.instances).toHaveLength(1);
    expect(ObserverMock.instances[0].observe).toHaveBeenCalledTimes(1);

    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    };
    ObserverMock.instances[0].callback(
      [entry],
      ObserverMock.instances[0] as never
    );
    expect(callback).toHaveBeenCalledTimes(2);
    first?.unsubscribe();
    ObserverMock.instances[0].callback(
      [entry],
      ObserverMock.instances[0] as never
    );
    expect(callback).toHaveBeenCalledTimes(3);
    second?.unsubscribe();
    expect(ObserverMock.instances[0].unobserve).toHaveBeenCalledWith(target);
    expect(ObserverMock.instances[0].disconnect).toHaveBeenCalledTimes(1);
    ObserverMock.instances[0].callback(
      [entry],
      ObserverMock.instances[0] as never
    );
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("separates actual root identities", () => {
    const target = document.createElement("div");
    const first = registerViewportObserver(target, jest.fn(), {
      root: document.createElement("div"),
    });
    const second = registerViewportObserver(target, jest.fn(), {
      root: document.createElement("div"),
    });
    expect(ObserverMock.instances).toHaveLength(2);
    first?.unsubscribe();
    second?.unsubscribe();
  });

  it("batches fresh confirmations without rotating the main observer", () => {
    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("div");
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();
    const first = registerViewportObserver(firstTarget, firstCallback);
    const second = registerViewportObserver(secondTarget, secondCallback);
    const mainObserver = ObserverMock.instances[0];
    const entry: IntersectionObserverEntry = {
      target: firstTarget,
      isIntersecting: false,
      boundingClientRect: firstTarget.getBoundingClientRect(),
      intersectionRatio: 0,
      intersectionRect: firstTarget.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    };

    const firstConfirmation = jest.fn();
    const secondConfirmation = jest.fn();
    first?.requestFreshConfirmation(firstConfirmation);
    second?.requestFreshConfirmation(secondConfirmation);
    expect(ObserverMock.instances).toHaveLength(1);
    jest.runOnlyPendingTimers();
    expect(ObserverMock.instances).toHaveLength(2);
    const confirmationObserver = ObserverMock.instances[1];
    expect(confirmationObserver.observe).toHaveBeenCalledWith(firstTarget);
    expect(confirmationObserver.observe).toHaveBeenCalledWith(secondTarget);
    expect(confirmationObserver.observe).toHaveBeenCalledTimes(2);
    expect(mainObserver.disconnect).not.toHaveBeenCalled();
    expect(mainObserver.observe).toHaveBeenCalledTimes(2);

    mainObserver.callback([entry], mainObserver as never);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(firstConfirmation).not.toHaveBeenCalled();
    confirmationObserver.callback([entry], confirmationObserver as never);
    expect(firstConfirmation).toHaveBeenCalledWith({ status: "fresh", entry });
    confirmationObserver.callback([entry], confirmationObserver as never);
    expect(firstConfirmation).toHaveBeenCalledTimes(1);

    first?.unsubscribe();
    expect(mainObserver.unobserve).toHaveBeenCalledWith(firstTarget);
    second?.unsubscribe();
    expect(mainObserver.unobserve).toHaveBeenCalledWith(secondTarget);
    expect(mainObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(secondConfirmation).not.toHaveBeenCalled();
  });

  it("observes a shared target once and resolves requesters independently", () => {
    const target = document.createElement("div");
    const first = registerViewportObserver(target, jest.fn());
    const second = registerViewportObserver(target, jest.fn());
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();
    const canceledCallback = jest.fn();
    first?.requestFreshConfirmation(firstCallback);
    second?.requestFreshConfirmation(secondCallback);
    const canceled = first?.requestFreshConfirmation(canceledCallback);
    canceled?.cancel();
    canceled?.cancel();
    jest.runOnlyPendingTimers();

    const confirmationObserver = ObserverMock.instances[1];
    expect(confirmationObserver.observe).toHaveBeenCalledTimes(1);
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    };
    confirmationObserver.callback([entry], confirmationObserver as never);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(canceledCallback).not.toHaveBeenCalled();
    expect(confirmationObserver.disconnect).toHaveBeenCalledTimes(1);
    first?.unsubscribe();
    second?.unsubscribe();
  });

  it("cleans a fresh batch before reporting a throwing callback", () => {
    const target = document.createElement("div");
    const first = registerViewportObserver(target, jest.fn());
    const second = registerViewportObserver(target, jest.fn());
    const error = new Error("fresh callback failed");
    const throwingCallback = jest.fn(() => {
      throw error;
    });
    const laterCallback = jest.fn();
    first?.requestFreshConfirmation(throwingCallback);
    second?.requestFreshConfirmation(laterCallback);
    jest.runOnlyPendingTimers();
    const confirmationObserver = ObserverMock.instances[1];
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    };

    expect(() =>
      confirmationObserver.callback([entry], confirmationObserver as never)
    ).toThrow(error);
    expect(throwingCallback).toHaveBeenCalledTimes(1);
    expect(laterCallback).toHaveBeenCalledTimes(1);
    expect(confirmationObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(ObserverMock.instances[0].disconnect).not.toHaveBeenCalled();

    first?.requestFreshConfirmation(jest.fn());
    jest.runOnlyPendingTimers();
    expect(ObserverMock.instances).toHaveLength(3);
    confirmationObserver.callback([entry], confirmationObserver as never);
    first?.unsubscribe();
    second?.unsubscribe();
  });

  it("confirms 100 targets with one additional observer", () => {
    const subscriptions = Array.from({ length: 100 }, () =>
      registerViewportObserver(document.createElement("div"), jest.fn())
    );
    for (const subscription of subscriptions) {
      subscription?.requestFreshConfirmation(jest.fn());
    }
    expect(ObserverMock.instances).toHaveLength(1);
    jest.runOnlyPendingTimers();
    expect(ObserverMock.instances).toHaveLength(2);
    expect(ObserverMock.instances[0].observe).toHaveBeenCalledTimes(100);
    expect(ObserverMock.instances[0].disconnect).not.toHaveBeenCalled();
    expect(ObserverMock.instances[1].observe).toHaveBeenCalledTimes(100);
    for (const subscription of subscriptions) {
      subscription?.unsubscribe();
    }
  });

  it("reports confirmation construction and observation failures once", () => {
    const target = document.createElement("div");
    const subscription = registerViewportObserver(target, jest.fn());
    const callback = jest.fn();
    subscription?.requestFreshConfirmation(callback);
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("unsupported");
        }
      },
    });
    jest.runOnlyPendingTimers();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ status: "unavailable" });
    expect(ObserverMock.instances[0].disconnect).not.toHaveBeenCalled();
    subscription?.unsubscribe();
  });

  it("cleans up a confirmation observation failure", () => {
    const target = document.createElement("div");
    const subscription = registerViewportObserver(target, jest.fn());
    const callback = jest.fn();
    subscription?.requestFreshConfirmation(callback);
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class ObserverFailure extends ObserverMock {
        observe = jest.fn(() => {
          throw new Error("failed");
        });
      },
    });
    jest.runOnlyPendingTimers();
    const confirmationObserver = ObserverMock.instances[1];
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ status: "unavailable" });
    expect(confirmationObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(ObserverMock.instances[0].disconnect).not.toHaveBeenCalled();
    subscription?.unsubscribe();
  });

  it("settles every unavailable callback before reporting an error", () => {
    const first = registerViewportObserver(
      document.createElement("div"),
      jest.fn()
    );
    const second = registerViewportObserver(
      document.createElement("div"),
      jest.fn()
    );
    const error = new Error("unavailable callback failed");
    const throwingCallback = jest.fn(() => {
      throw error;
    });
    const laterCallback = jest.fn();
    first?.requestFreshConfirmation(throwingCallback);
    second?.requestFreshConfirmation(laterCallback);
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class ObserverFailure extends ObserverMock {
        observe = jest.fn(() => {
          throw new Error("observe failed");
        });
      },
    });

    expect(() => jest.runOnlyPendingTimers()).toThrow(error);
    const failedObserver = ObserverMock.instances[1];
    expect(throwingCallback).toHaveBeenCalledTimes(1);
    expect(laterCallback).toHaveBeenCalledTimes(1);
    expect(failedObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(ObserverMock.instances[0].disconnect).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: ObserverMock,
    });
    first?.requestFreshConfirmation(jest.fn());
    jest.runOnlyPendingTimers();
    expect(ObserverMock.instances).toHaveLength(3);
    first?.unsubscribe();
    second?.unsubscribe();
  });

  it("reports constructor and observe failures", () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("unsupported");
        }
      },
    });
    expect(registerViewportObserver(document.body, jest.fn())).toBeUndefined();

    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class ObserverFailure extends ObserverMock {
        observe = jest.fn(() => {
          throw new Error("failed");
        });
      },
    });
    expect(registerViewportObserver(document.body, jest.fn())).toBeUndefined();
  });
});
