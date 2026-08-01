/** @jest-environment jsdom */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { useViewportLifecycle } from "./useViewportLifecycle";
import { registerViewportObserver } from "./viewportObserverRegistry";
import { ViewportResourceBudgetProvider } from "./viewportResourceBudgetContext";
import { useViewportResourceBudget } from "./viewportResourceBudgetContext";
import type { ViewportResourceBudget } from "./viewportResourceBudget";
import type {
  ViewportLifecycleOptions,
  ViewportLifecycleResult,
} from "./useViewportLifecycle";

class ObserverMock {
  static instances: ObserverMock[] = [];
  static constructorError = false;
  static observeError = false;
  callback: IntersectionObserverCallback;
  target?: Element;
  observe = jest.fn((target: Element) => {
    if (ObserverMock.observeError) {
      throw new Error("observe failed");
    }
    this.target = target;
  });
  unobserve = jest.fn();
  disconnect = jest.fn();
  constructor(callback: IntersectionObserverCallback) {
    if (ObserverMock.constructorError) {
      throw new Error("construction failed");
    }
    this.callback = callback;
    ObserverMock.instances.push(this);
  }
  emit(isIntersecting: boolean) {
    if (this.target) {
      this.callback(
        [{ target: this.target, isIntersecting } as IntersectionObserverEntry],
        this as never
      );
    }
  }
}

describe("useViewportLifecycle", () => {
  let container: HTMLDivElement;
  let current: ViewportLifecycleResult<HTMLDivElement>;
  const render = (options: ViewportLifecycleOptions, strict = false) => {
    const Consumer = () => {
      current = useViewportLifecycle<HTMLDivElement>(options);
      return (
        <div ref={current.ref}>
          {current.shouldMount ? <span data-resource>mounted</span> : "waiting"}
        </div>
      );
    };
    act(() => {
      ReactDOM.render(
        strict ? (
          <React.StrictMode>
            <Consumer />
          </React.StrictMode>
        ) : (
          <Consumer />
        ),
        container
      );
    });
  };

  const renderBudgeted = (options: ViewportLifecycleOptions, capacity = 8) => {
    const Consumer = () => {
      current = useViewportLifecycle<HTMLDivElement>(options);
      return (
        <div ref={current.ref}>
          {current.shouldMount ? <span data-resource>mounted</span> : "waiting"}
        </div>
      );
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={capacity}>
          <Consumer />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
  };

  const emitTarget = (
    observer: ObserverMock,
    target: Element,
    isIntersecting: boolean
  ) => {
    observer.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      observer as never
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ObserverMock.instances = [];
    ObserverMock.constructorError = false;
    ObserverMock.observeError = false;
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: ObserverMock,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
  });

  it("implements waiting, active, cooling, reentry, and fresh expiry", () => {
    render({ enabled: true, coolingMs: 100 });
    const observer = ObserverMock.instances[0];
    act(() => observer.emit(false));
    expect(current.phase).toBe("waiting");
    act(() => observer.emit(true));
    expect(current.phase).toBe("active");
    act(() => observer.emit(false));
    expect(current.phase).toBe("cooling");
    act(() => observer.emit(true));
    expect(current.phase).toBe("active");
    act(() => observer.emit(false));
    act(() => jest.advanceTimersByTime(100));
    expect(current.phase).toBe("cooling");
    act(() => jest.runOnlyPendingTimers());
    act(() => ObserverMock.instances.at(-1)?.emit(false));
    expect(current.phase).toBe("waiting");
  });

  it("dwells before requesting and receiving a budget lease", () => {
    renderBudgeted({ enabled: true, admissionMs: 100 });
    const observer = ObserverMock.instances[0];
    act(() => observer.emit(true));
    act(() => jest.advanceTimersByTime(99));
    expect(current.phase).toBe("waiting");
    expect(current.shouldMount).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(current.phase).toBe("active");
    expect(current.shouldMount).toBe(true);
  });

  it("preserves an active budgeted resource and lease while hidden", () => {
    renderBudgeted({ enabled: true, admissionMs: 0 });
    act(() => ObserverMock.instances[0].emit(true));
    act(() => jest.advanceTimersByTime(0));
    const resource = container.querySelector("[data-resource]");
    expect(current.phase).toBe("active");
    expect(resource).not.toBeNull();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(current.phase).toBe("active");
    expect(container.querySelector("[data-resource]")).toBe(resource);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(ObserverMock.instances).toHaveLength(2);
    expect(current.phase).toBe("active");
    expect(container.querySelector("[data-resource]")).toBe(resource);
  });

  it("invalidates an active lease when the provider is replaced", () => {
    let observedBudget: ViewportResourceBudget | undefined;
    const Probe = () => {
      observedBudget = useViewportResourceBudget();
      return null;
    };
    const Consumer = () => {
      current = useViewportLifecycle<HTMLDivElement>({
        enabled: true,
        admissionMs: 0,
      });
      return (
        <div ref={current.ref}>
          {current.shouldMount ? <span data-resource /> : null}
        </div>
      );
    };
    const renderCapacity = (capacity: number) => {
      act(() => {
        ReactDOM.render(
          <ViewportResourceBudgetProvider enabled capacity={capacity}>
            <Probe />
            <Consumer />
          </ViewportResourceBudgetProvider>,
          container
        );
      });
    };
    renderCapacity(1);
    act(() => ObserverMock.instances[0].emit(true));
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelector("[data-resource]")).not.toBeNull();
    const firstBudget = observedBudget;

    renderCapacity(2);
    expect(current.phase).toBe("waiting");
    expect(container.querySelector("[data-resource]")).toBeNull();
    expect(firstBudget?.getSnapshot().leased).toBe(0);
    expect(observedBudget).not.toBe(firstBudget);
    const replacementObserver = ObserverMock.instances.at(-1);
    act(() => replacementObserver?.emit(true));
    expect(container.querySelector("[data-resource]")).toBeNull();
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelector("[data-resource]")).not.toBeNull();
  });

  it("enforces FIFO capacity and early-evicts a fresh outside cooling lease", () => {
    const results: ViewportLifecycleResult<HTMLDivElement>[] = [];
    let budget: ViewportResourceBudget | undefined;
    const Consumer = ({ index }: { index: number }) => {
      results[index] = useViewportLifecycle<HTMLDivElement>({
        enabled: true,
        admissionMs: 100,
      });
      return <div ref={results[index].ref} />;
    };
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Probe />
          <Consumer index={0} />
          <Consumer index={1} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const mainObserver = ObserverMock.instances[0];
    const firstTarget = mainObserver.observe.mock.calls[0][0];
    const secondTarget = mainObserver.observe.mock.calls[1][0];
    act(() => {
      emitTarget(mainObserver, firstTarget, true);
      emitTarget(mainObserver, secondTarget, true);
      jest.advanceTimersByTime(100);
    });
    expect(results[0].phase).toBe("active");
    expect(results[1].phase).toBe("waiting");
    expect(budget?.getSnapshot()).toMatchObject({ leased: 1, queued: 1 });

    act(() => emitTarget(mainObserver, firstTarget, false));
    expect(results[0].phase).toBe("cooling");
    const manualCallbacks = {
      onLeaseGranted: jest.fn(),
      onEarlyEvictionRequested: jest.fn(),
      onEarlyEvictionCancelled: jest.fn(),
    };
    const manualContender = budget?.register(manualCallbacks);
    act(() => manualContender?.requestLease());
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      jest.runOnlyPendingTimers();
    });
    expect(results[0].phase).toBe("cooling");
    expect(results[0].shouldMount).toBe(true);
    expect(budget?.getSnapshot().leased).toBe(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      jest.runOnlyPendingTimers();
    });
    const confirmation = ObserverMock.instances.at(-1);
    if (!confirmation) {
      throw new Error("Expected confirmation observer");
    }
    act(() => emitTarget(confirmation, firstTarget, false));
    expect(results[0].phase).toBe("waiting");
    expect(manualCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget?.getSnapshot().leased).toBe(1);
    manualContender?.unregister();
  });

  it("cancels a pending committed release on same-batch reentry", () => {
    const results: ViewportLifecycleResult<HTMLDivElement>[] = [];
    let budget: ViewportResourceBudget | undefined;
    const Consumer = ({ index }: { index: number }) => {
      results[index] = useViewportLifecycle<HTMLDivElement>({
        enabled: true,
        admissionMs: 0,
      });
      return (
        <div ref={results[index].ref}>
          {results[index].shouldMount ? <span data-resource={index} /> : null}
        </div>
      );
    };
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Probe />
          <Consumer index={0} />
          <Consumer index={1} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const main = ObserverMock.instances[0];
    const holder = main.observe.mock.calls[0][0];
    const contender = main.observe.mock.calls[1][0];
    act(() => {
      emitTarget(main, holder, true);
      jest.advanceTimersByTime(0);
      emitTarget(main, contender, true);
      jest.advanceTimersByTime(0);
      emitTarget(main, holder, false);
      jest.runOnlyPendingTimers();
    });
    const resource = holder.querySelector("[data-resource]");
    const confirmation = ObserverMock.instances.at(-1);
    if (!confirmation) {
      throw new Error("Expected an eviction confirmation observer");
    }
    act(() => {
      emitTarget(confirmation, holder, false);
      emitTarget(main, holder, true);
    });

    expect(holder.querySelector("[data-resource]")).toBe(resource);
    expect(results[0].phase).toBe("active");
    expect(results[1].phase).toBe("waiting");
    expect(budget?.getSnapshot()).toMatchObject({
      leased: 1,
      active: 1,
      cooling: 0,
      queued: 1,
    });
  });

  it("restores cooling when queue pressure disappears before commit", () => {
    const results: ViewportLifecycleResult<HTMLDivElement>[] = [];
    let budget: ViewportResourceBudget | undefined;
    const Consumer = ({ index }: { index: number }) => {
      results[index] = useViewportLifecycle<HTMLDivElement>({
        enabled: true,
        admissionMs: 0,
        coolingMs: 100,
      });
      return (
        <div ref={results[index].ref}>
          {results[index].shouldMount ? <span data-resource={index} /> : null}
        </div>
      );
    };
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Probe />
          <Consumer index={0} />
          <Consumer index={1} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const main = ObserverMock.instances[0];
    const holder = main.observe.mock.calls[0][0];
    const contender = main.observe.mock.calls[1][0];
    act(() => {
      emitTarget(main, holder, true);
      jest.advanceTimersByTime(0);
      emitTarget(main, holder, false);
      jest.advanceTimersByTime(20);
      emitTarget(main, contender, true);
      jest.advanceTimersByTime(0);
      jest.runOnlyPendingTimers();
    });
    const resource = holder.querySelector("[data-resource]");
    const confirmation = ObserverMock.instances.at(-1);
    if (!confirmation) {
      throw new Error("Expected an eviction confirmation observer");
    }
    act(() => {
      emitTarget(confirmation, holder, false);
      emitTarget(main, contender, false);
    });

    expect(holder.querySelector("[data-resource]")).toBe(resource);
    expect(results[0].phase).toBe("cooling");
    expect(results[0].shouldMount).toBe(true);
    expect(budget?.getSnapshot()).toMatchObject({
      leased: 1,
      cooling: 1,
      queued: 0,
    });
    act(() => jest.advanceTimersByTime(79));
    expect(results[0].phase).toBe("cooling");
  });

  it("pins the exact held member when pinning cancels a pending release", () => {
    const results: ViewportLifecycleResult<HTMLDivElement>[] = [];
    let budget: ViewportResourceBudget | undefined;
    const Consumer = ({ index }: { index: number }) => {
      results[index] = useViewportLifecycle<HTMLDivElement>({
        enabled: true,
        admissionMs: 0,
      });
      return (
        <div ref={results[index].ref}>
          {results[index].shouldMount ? <span data-resource={index} /> : null}
        </div>
      );
    };
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Probe />
          <Consumer index={0} />
          <Consumer index={1} />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const main = ObserverMock.instances[0];
    const holder = main.observe.mock.calls[0][0];
    const contender = main.observe.mock.calls[1][0];
    act(() => {
      emitTarget(main, holder, true);
      jest.advanceTimersByTime(0);
      emitTarget(main, contender, true);
      jest.advanceTimersByTime(0);
      emitTarget(main, holder, false);
      jest.runOnlyPendingTimers();
    });
    const resource = holder.querySelector("[data-resource]");
    const confirmation = ObserverMock.instances.at(-1);
    if (!confirmation) {
      throw new Error("Expected an eviction confirmation observer");
    }
    act(() => {
      emitTarget(confirmation, holder, false);
      results[0].pin();
    });

    expect(holder.querySelector("[data-resource]")).toBe(resource);
    expect(results[0].phase).toBe("pinned");
    expect(contender.querySelector("[data-resource]")).not.toBeNull();
    expect(budget?.getSnapshot()).toMatchObject({
      leased: 1,
      active: 1,
      pinned: 1,
      queued: 0,
    });
  });

  it("ignores a queued pre-refresh outside entry while the pool stays alive", () => {
    const keeperTarget = document.createElement("div");
    const keeper = registerViewportObserver(keeperTarget, jest.fn(), {
      rootMargin: "1000px 0px",
    });
    render({ enabled: true, coolingMs: 100 });
    const staleObserver = ObserverMock.instances[0];
    const target = ObserverMock.instances[0].target;
    if (!target) {
      throw new Error("Expected an observed lifecycle target");
    }

    act(() => staleObserver.emit(true));
    act(() => staleObserver.emit(false));
    act(() => jest.advanceTimersByTime(100));
    expect(current.phase).toBe("cooling");

    act(() => {
      const bounds = target.getBoundingClientRect();
      staleObserver.callback(
        [
          {
            target,
            isIntersecting: false,
            boundingClientRect: bounds,
            intersectionRatio: 0,
            intersectionRect: bounds,
            rootBounds: null,
            time: 0,
          },
        ],
        staleObserver as never
      );
    });
    expect(current.phase).toBe("cooling");
    act(() => jest.runOnlyPendingTimers());
    act(() => ObserverMock.instances.at(-1)?.emit(false));
    expect(current.phase).toBe("waiting");
    keeper?.unsubscribe();
  });

  it("cancels a pending confirmation when the main observer reports inside", () => {
    render({ enabled: true, coolingMs: 100 });
    const mainObserver = ObserverMock.instances[0];
    act(() => mainObserver.emit(true));
    act(() => mainObserver.emit(false));
    act(() => jest.advanceTimersByTime(100));
    expect(current.phase).toBe("cooling");

    act(() => mainObserver.emit(true));
    expect(current.phase).toBe("active");
    act(() => jest.runOnlyPendingTimers());
    expect(ObserverMock.instances).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fails open on unavailable confirmation through a zero-delay timer", () => {
    render({ enabled: true, coolingMs: 100 });
    const mainObserver = ObserverMock.instances[0];
    act(() => mainObserver.emit(true));
    act(() => mainObserver.emit(false));
    act(() => jest.advanceTimersByTime(100));
    ObserverMock.constructorError = true;

    act(() => jest.advanceTimersToNextTimer());
    expect(current.phase).toBe("cooling");
    act(() => jest.advanceTimersToNextTimer());
    expect(current.phase).toBe("pinned");
    expect(mainObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fails open when observation is absent", () => {
    render({ enabled: false });
    expect(current.shouldMount).toBe(true);
    expect(ObserverMock.instances).toHaveLength(0);
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    render({ enabled: true });
    expect(current.phase).toBe("waiting");
    expect(current.shouldMount).toBe(false);
    act(() => jest.advanceTimersByTime(0));
    expect(current.phase).toBe("pinned");
    expect(current.shouldMount).toBe(true);
  });

  it("does not update state when the default-off ref attaches and handles option transitions", () => {
    let renderCount = 0;
    let transitionResult: ViewportLifecycleResult<HTMLDivElement> | undefined;
    const getTransitionResult = () => {
      if (!transitionResult) {
        throw new Error("Expected the lifecycle hook to render");
      }
      return transitionResult;
    };
    const Consumer = ({ enabled }: { enabled: boolean }) => {
      renderCount += 1;
      transitionResult = useViewportLifecycle<HTMLDivElement>({ enabled });
      return (
        <div ref={transitionResult.ref}>{transitionResult.shouldMount}</div>
      );
    };

    act(() => {
      ReactDOM.render(<Consumer enabled={false} />, container);
    });
    expect(renderCount).toBe(1);
    expect(getTransitionResult().shouldMount).toBe(true);
    expect(ObserverMock.instances).toHaveLength(0);

    act(() => {
      ReactDOM.render(<Consumer enabled />, container);
    });
    expect(renderCount).toBe(3);
    expect(getTransitionResult().shouldMount).toBe(false);
    expect(ObserverMock.instances).toHaveLength(1);

    act(() => {
      ReactDOM.render(<Consumer enabled={false} />, container);
    });
    expect(getTransitionResult().shouldMount).toBe(true);
    expect(ObserverMock.instances[0].disconnect).toHaveBeenCalledTimes(1);
    const renderCountAfterDisable = renderCount;
    const attachedElement = container.firstElementChild;
    if (!(attachedElement instanceof HTMLDivElement)) {
      throw new Error("Expected the lifecycle target to remain attached");
    }

    act(() => {
      getTransitionResult().ref(attachedElement);
    });
    expect(renderCount).toBe(renderCountAfterDisable);
    expect(ObserverMock.instances).toHaveLength(1);
  });

  it.each(["constructor", "observe"] as const)(
    "fails open when observer %s fails",
    (failure) => {
      ObserverMock.constructorError = failure === "constructor";
      ObserverMock.observeError = failure === "observe";
      render({ enabled: true });
      expect(current.phase).toBe("waiting");
      expect(current.shouldMount).toBe(false);
      act(() => jest.advanceTimersByTime(0));
      expect(current.phase).toBe("pinned");
      expect(current.shouldMount).toBe(true);
    }
  );

  it("mounts selected and resizing synchronously then pins", () => {
    render({ enabled: true, selected: true });
    expect(container.textContent).toBe("mounted");
    expect(current.phase).toBe("pinned");
    render({ enabled: true, resizing: true });
    expect(current.shouldMount).toBe(true);
  });

  it("waits for fresh geometry after visibility returns", () => {
    render({ enabled: true, coolingMs: 10 });
    act(() => ObserverMock.instances[0].emit(true));
    act(() => ObserverMock.instances[0].emit(false));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => jest.advanceTimersByTime(20));
    expect(current.phase).toBe("cooling");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(current.phase).toBe("cooling");
    act(() => jest.runOnlyPendingTimers());
    act(() => ObserverMock.instances.at(-1)?.emit(false));
    expect(current.phase).toBe("waiting");
  });

  it("reschedules the remaining cooling time after an early visibility return", () => {
    render({ enabled: true, coolingMs: 100 });
    act(() => ObserverMock.instances[0].emit(true));
    act(() => ObserverMock.instances[0].emit(false));
    act(() => jest.advanceTimersByTime(30));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => jest.advanceTimersByTime(20));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => ObserverMock.instances.at(-1)?.emit(false));
    act(() => jest.advanceTimersByTime(49));
    expect(ObserverMock.instances).toHaveLength(2);
    expect(current.phase).toBe("cooling");
    act(() => jest.advanceTimersByTime(1));
    expect(current.phase).toBe("cooling");
    act(() => jest.runOnlyPendingTimers());
    expect(ObserverMock.instances).toHaveLength(3);
    act(() => ObserverMock.instances.at(-1)?.emit(false));
    expect(current.phase).toBe("waiting");
  });

  it("pins for print, contained fullscreen, and parent-observable focus", () => {
    render({ enabled: true });
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(current.phase).toBe("pinned");

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    render({ enabled: true });
    const child = document.createElement("span");
    ObserverMock.instances.at(-1)?.target?.appendChild(child);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: child,
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(current.phase).toBe("pinned");

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    render({ enabled: true });
    const target = ObserverMock.instances.at(-1)?.target;
    if (target instanceof HTMLElement) {
      target.tabIndex = 0;
      target.focus();
    }
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(current.phase).toBe("pinned");
  });

  it.each(["direct", "print", "fullscreen", "blur"] as const)(
    "removes shared lifecycle listeners on %s pin while mounted",
    (trigger) => {
      const removeWindow = jest.spyOn(window, "removeEventListener");
      const removeDocument = jest.spyOn(document, "removeEventListener");
      render({ enabled: true });
      const target = ObserverMock.instances[0].target;

      act(() => {
        if (trigger === "direct") {
          current.pin();
        } else if (trigger === "print") {
          window.dispatchEvent(new Event("beforeprint"));
        } else if (trigger === "fullscreen") {
          Object.defineProperty(document, "fullscreenElement", {
            configurable: true,
            value: target,
          });
          document.dispatchEvent(new Event("fullscreenchange"));
        } else if (target instanceof HTMLElement) {
          target.tabIndex = 0;
          target.focus();
          window.dispatchEvent(new Event("blur"));
        }
      });

      expect(current.phase).toBe("pinned");
      expect(container.isConnected).toBe(true);
      expect(removeWindow).toHaveBeenCalledWith(
        "beforeprint",
        expect.any(Function)
      );
      expect(removeWindow).toHaveBeenCalledWith("blur", expect.any(Function));
      expect(removeDocument).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function)
      );
      expect(removeDocument).toHaveBeenCalledWith(
        "fullscreenchange",
        expect.any(Function)
      );
      removeWindow.mockRestore();
      removeDocument.mockRestore();
    }
  );

  it("cleans observers and listeners through StrictMode replay", () => {
    const addWindow = jest.spyOn(window, "addEventListener");
    const removeWindow = jest.spyOn(window, "removeEventListener");
    const addDocument = jest.spyOn(document, "addEventListener");
    const removeDocument = jest.spyOn(document, "removeEventListener");
    render({ enabled: true }, true);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(
      ObserverMock.instances.every(
        (observer) => observer.disconnect.mock.calls.length === 1
      )
    ).toBe(true);
    for (const event of ["beforeprint", "blur"]) {
      expect(
        addWindow.mock.calls.filter(([type]) => type === event)
      ).toHaveLength(1);
      expect(
        removeWindow.mock.calls.filter(([type]) => type === event)
      ).toHaveLength(1);
    }
    for (const event of ["visibilitychange", "fullscreenchange"]) {
      expect(
        addDocument.mock.calls.filter(([type]) => type === event)
      ).toHaveLength(1);
      expect(
        removeDocument.mock.calls.filter(([type]) => type === event)
      ).toHaveLength(1);
    }
    addWindow.mockRestore();
    removeWindow.mockRestore();
    addDocument.mockRestore();
    removeDocument.mockRestore();
  });
});
