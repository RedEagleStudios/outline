/** @jest-environment jsdom */

import { subscribeViewportLifecycle } from "./viewportLifecycleEvents";

describe("viewportLifecycleEvents", () => {
  it("shares listeners, flushes print pins, dispatches state, and tears down", () => {
    const addWindow = jest.spyOn(window, "addEventListener");
    const removeWindow = jest.spyOn(window, "removeEventListener");
    const addDocument = jest.spyOn(document, "addEventListener");
    const removeDocument = jest.spyOn(document, "removeEventListener");
    const callbacks = {
      onBeforePrint: jest.fn(),
      onVisibilityChange: jest.fn(),
      onFullscreenChange: jest.fn(),
      onWindowBlur: jest.fn(),
    };
    const first = subscribeViewportLifecycle(callbacks);
    const second = subscribeViewportLifecycle(callbacks);
    expect(
      addWindow.mock.calls.filter(([name]) => name === "beforeprint")
    ).toHaveLength(1);
    expect(
      addWindow.mock.calls.filter(([name]) => name === "afterprint")
    ).toHaveLength(0);

    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(callbacks.onBeforePrint).toHaveBeenCalledTimes(2);
    expect(callbacks.onWindowBlur).toHaveBeenCalledTimes(2);
    expect(callbacks.onVisibilityChange).toHaveBeenCalledTimes(2);
    expect(callbacks.onFullscreenChange).toHaveBeenCalledTimes(2);

    first.unsubscribe();
    second.unsubscribe();
    window.dispatchEvent(new Event("beforeprint"));
    expect(callbacks.onBeforePrint).toHaveBeenCalledTimes(2);
    expect(
      removeWindow.mock.calls.filter(([name]) => name === "beforeprint")
    ).toHaveLength(1);
    expect(
      removeDocument.mock.calls.filter(([name]) => name === "visibilitychange")
    ).toHaveLength(1);
    addWindow.mockRestore();
    removeWindow.mockRestore();
    addDocument.mockRestore();
    removeDocument.mockRestore();
  });
});
