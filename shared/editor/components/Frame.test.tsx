/** @jest-environment jsdom */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import Frame from "./Frame";
import { ViewportResourceBudgetProvider } from "./hooks/viewportResourceBudgetContext";
import { useViewportResourceBudget } from "./hooks/viewportResourceBudgetContext";
import type { ViewportResourceBudget } from "./hooks/viewportResourceBudget";
import { ViewportResourceMetricsCollector } from "./hooks/viewportResourceMetrics";

class ObserverMock {
  static instances: ObserverMock[] = [];
  callback: IntersectionObserverCallback;
  target?: Element;
  observe = jest.fn((target: Element) => {
    this.target = target;
  });
  unobserve = jest.fn();
  disconnect = jest.fn();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    ObserverMock.instances.push(this);
  }

  emit(isIntersecting: boolean) {
    if (!this.target) {
      return;
    }
    this.callback(
      [{ target: this.target, isIntersecting } as IntersectionObserverEntry],
      this as never
    );
  }
}

describe("Frame", () => {
  let container: HTMLDivElement;

  const render = (props: React.ComponentProps<typeof Frame> = {}) => {
    act(() => {
      ReactDOM.render(
        <Frame
          src="/_health?frame-test=1"
          style={{ width: "640px", height: "360px" }}
          {...props}
        />,
        container
      );
    });
  };

  const emit = (isIntersecting: boolean) => {
    act(() => ObserverMock.instances.at(-1)?.emit(isIntersecting));
  };

  const expireOutside = () => {
    const mainObserver = ObserverMock.instances[0];
    if (!mainObserver) {
      return;
    }
    act(() => mainObserver.emit(false));
    act(() => jest.advanceTimersByTime(30000));
    act(() => mainObserver.emit(false));
    act(() => jest.runOnlyPendingTimers());
    const confirmationObserver = ObserverMock.instances.at(-1);
    if (confirmationObserver !== mainObserver) {
      act(() => confirmationObserver?.emit(false));
    }
  };

  const renderBudgeted = (
    viewportGating: boolean,
    collector?: ViewportResourceMetricsCollector
  ) => {
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider
          enabled
          capacity={1}
          collector={collector}
        >
          <Frame
            src="/_health?frame-continuity=1"
            viewportGating={viewportGating}
          />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ObserverMock.instances = [];
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

  it("keeps default behavior deferred and does not register viewport work", () => {
    const addWindow = jest.spyOn(window, "addEventListener");
    const addDocument = jest.spyOn(document, "addEventListener");
    render();
    expect(container.querySelector("iframe")).toBeNull();
    expect(ObserverMock.instances).toHaveLength(0);
    expect(addWindow).not.toHaveBeenCalledWith(
      "beforeprint",
      expect.any(Function)
    );
    expect(addDocument).not.toHaveBeenCalledWith(
      "fullscreenchange",
      expect.any(Function)
    );
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    addWindow.mockRestore();
    addDocument.mockRestore();
  });

  it("forwards and clears object and callback refs with gating off", () => {
    const objectRef = React.createRef<HTMLIFrameElement>();
    const callbackRef = jest.fn<void, [HTMLIFrameElement | null]>();
    const handleFocus = jest.fn();

    render({ ref: objectRef, onFocus: handleFocus });
    expect(jest.getTimerCount()).toBe(1);
    expect(objectRef.current).toBeNull();
    act(() => jest.advanceTimersByTime(0));
    const iframe = container.querySelector("iframe");
    expect(objectRef.current).toBe(iframe);
    act(() => iframe?.focus());
    expect(handleFocus).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(objectRef.current).toBeNull();

    render({ ref: callbackRef });
    act(() => jest.advanceTimersByTime(0));
    const callbackIframe = container.querySelector("iframe");
    expect(callbackRef).toHaveBeenLastCalledWith(callbackIframe);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(callbackRef).toHaveBeenLastCalledWith(null);
    expect(ObserverMock.instances).toHaveLength(0);
  });

  it("keeps the stable wrapper while waiting and mounts near the viewport", () => {
    render({ viewportGating: true });
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(ObserverMock.instances).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
    emit(true);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.firstElementChild).toBe(wrapper);
  });

  it("retains the same iframe through cooling and viewport reentry", () => {
    render({ viewportGating: true });
    emit(true);
    const iframe = container.querySelector("iframe");
    emit(false);
    act(() => jest.advanceTimersByTime(29999));
    expect(container.querySelector("iframe")).toBe(iframe);
    emit(true);
    expect(container.querySelector("iframe")).toBe(iframe);
  });

  it("removes only the iframe after cooling expiry and a fresh outside entry", () => {
    render({ viewportGating: true });
    const wrapper = container.firstElementChild;
    const mainObserver = ObserverMock.instances[0];
    act(() => mainObserver.emit(true));
    act(() => mainObserver.emit(false));
    act(() => jest.advanceTimersByTime(30000));
    act(() => mainObserver.emit(false));
    expect(container.querySelector("iframe")).not.toBeNull();
    act(() => jest.runOnlyPendingTimers());
    const confirmationObserver = ObserverMock.instances.at(-1);
    expect(confirmationObserver).not.toBe(mainObserver);
    act(() => confirmationObserver?.emit(false));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.firstElementChild).toBe(wrapper);
  });

  it("fails open when IntersectionObserver is unavailable", () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    render({ viewportGating: true });
    expect(container.querySelector("iframe")).toBeNull();
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it.each([
    ["selected", { isSelected: true }],
    ["resizing", { isResizing: true }],
  ] as const)("mounts and pins immediately when %s", (_name, props) => {
    render({ viewportGating: true, ...props });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expireOutside();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it.each(["focus", "fullscreen", "print"] as const)(
    "pins after iframe %s interaction",
    (trigger) => {
      render({ viewportGating: true });
      emit(true);
      const iframe = container.querySelector("iframe");
      const wrapper = container.firstElementChild;
      act(() => {
        if (trigger === "focus") {
          iframe?.focus();
        } else if (trigger === "fullscreen") {
          Object.defineProperty(document, "fullscreenElement", {
            configurable: true,
            value: iframe,
          });
          document.dispatchEvent(new Event("fullscreenchange"));
        } else {
          window.dispatchEvent(new Event("beforeprint"));
        }
      });
      expireOutside();
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(container.firstElementChild).toBe(wrapper);
    }
  );

  it("composes iframe events and sets then clears the forwarded ref", () => {
    const ref = React.createRef<HTMLIFrameElement>();
    const handleFocus = jest.fn();
    act(() => {
      ReactDOM.render(
        <Frame
          ref={ref}
          src="/_health?frame-test=ref"
          viewportGating
          onFocus={handleFocus}
        />,
        container
      );
    });
    emit(true);
    const iframe = container.querySelector("iframe");
    expect(ref.current).toBe(iframe);
    act(() => iframe?.focus());
    expect(handleFocus).toHaveBeenCalledTimes(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(ref.current).toBeNull();
  });

  it("clears and reassigns the forwarded ref across gated eviction", () => {
    const callbackRef = jest.fn<void, [HTMLIFrameElement | null]>();
    render({ ref: callbackRef, viewportGating: true });
    emit(true);
    const firstIframe = container.querySelector("iframe");
    expect(callbackRef).toHaveBeenLastCalledWith(firstIframe);

    expireOutside();
    expect(callbackRef).toHaveBeenLastCalledWith(null);

    emit(true);
    const secondIframe = container.querySelector("iframe");
    expect(secondIframe).not.toBe(firstIframe);
    expect(callbackRef).toHaveBeenLastCalledWith(secondIframe);
  });

  it("does not pin on load and keeps wrapper dimensions stable", () => {
    render({ viewportGating: true });
    const wrapper = container.firstElementChild as HTMLElement;
    const initialHeight = wrapper.style.height;
    const initialWidth = wrapper.style.width;
    const initialScrollHeight = wrapper.scrollHeight;
    emit(true);
    act(() => {
      container.querySelector("iframe")?.dispatchEvent(new Event("load"));
    });
    expect(wrapper.style.height).toBe(initialHeight);
    expect(wrapper.style.width).toBe(initialWidth);
    expect(wrapper.scrollHeight).toBe(initialScrollHeight);
    expireOutside();
    expect(container.querySelector("iframe")).toBeNull();
    expect(wrapper.style.height).toBe(initialHeight);
    expect(wrapper.style.width).toBe(initialWidth);
  });

  it("cleans observer registration when unmounted", () => {
    render({ viewportGating: true });
    const observer = ObserverMock.instances[0];
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(observer.unobserve).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("never mounts a queued frame and frees a lease when a frame pins", () => {
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Frame src="/_health?budget-frame=1" viewportGating />
          <Frame src="/_health?budget-frame=2" viewportGating />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const mainObserver = ObserverMock.instances[0];
    const firstTarget = mainObserver.observe.mock.calls[0][0];
    const secondTarget = mainObserver.observe.mock.calls[1][0];
    act(() => {
      mainObserver.callback(
        [
          { target: firstTarget, isIntersecting: true },
          { target: secondTarget, isIntersecting: true },
        ] as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.advanceTimersByTime(100);
    });
    const firstIframe = firstTarget.querySelector("iframe");
    expect(firstIframe).not.toBeNull();
    expect(secondTarget.querySelector("iframe")).toBeNull();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    act(() => firstIframe?.focus());
    expect(firstTarget.querySelector("iframe")).toBe(firstIframe);
    expect(secondTarget.querySelector("iframe")).not.toBeNull();
    expect(container.querySelectorAll("iframe")).toHaveLength(2);
  });

  it("commits holder removal before granting an earlier DOM contender", () => {
    let budget: ViewportResourceBudget | undefined;
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={1}>
          <Probe />
          <Frame src="/_health?order=contender" viewportGating />
          <Frame src="/_health?order=holder" viewportGating />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const mainObserver = ObserverMock.instances[0];
    const contender = mainObserver.observe.mock.calls[0][0];
    const holder = mainObserver.observe.mock.calls[1][0];
    act(() => {
      mainObserver.callback(
        [
          { target: holder, isIntersecting: true },
        ] as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.advanceTimersByTime(100);
      mainObserver.callback(
        [
          { target: contender, isIntersecting: true },
        ] as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.advanceTimersByTime(100);
      mainObserver.callback(
        [
          { target: holder, isIntersecting: false },
        ] as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.runOnlyPendingTimers();
    });
    expect(holder.querySelector("iframe")).not.toBeNull();
    expect(contender.querySelector("iframe")).toBeNull();

    const mutations: string[] = [];
    let rawCount = 1;
    let maxRawCount = rawCount;
    const mutationObserver = new MutationObserver(() => undefined);
    mutationObserver.observe(container, { childList: true, subtree: true });
    const confirmation = ObserverMock.instances.at(-1);
    act(() => {
      confirmation?.callback(
        [
          { target: holder, isIntersecting: false },
        ] as IntersectionObserverEntry[],
        confirmation as never
      );
    });
    for (const record of mutationObserver.takeRecords()) {
      for (const removed of record.removedNodes) {
        if (
          removed instanceof HTMLIFrameElement ||
          (removed instanceof Element && removed.querySelector("iframe"))
        ) {
          rawCount -= 1;
          mutations.push("remove-holder");
        }
      }
      for (const added of record.addedNodes) {
        if (
          added instanceof HTMLIFrameElement ||
          (added instanceof Element && added.querySelector("iframe"))
        ) {
          rawCount += 1;
          maxRawCount = Math.max(maxRawCount, rawCount);
          mutations.push("add-contender");
        }
      }
    }
    mutationObserver.disconnect();

    expect(mutations).toEqual(["remove-holder", "add-contender"]);
    expect(maxRawCount).toBe(1);
    expect(holder.querySelector("iframe")).toBeNull();
    expect(contender.querySelector("iframe")).not.toBeNull();
    expect(budget?.getSnapshot()).toMatchObject({
      capacity: 1,
      leased: 1,
      active: 1,
      cooling: 0,
      pinned: 0,
    });
  });

  it("commits a multi-victim removal batch before either queued insertion", () => {
    let budget: ViewportResourceBudget | undefined;
    const Probe = () => {
      budget = useViewportResourceBudget();
      return null;
    };
    act(() => {
      ReactDOM.render(
        <ViewportResourceBudgetProvider enabled capacity={2}>
          <Probe />
          <Frame src="/_health?batch=contender-1" viewportGating />
          <Frame src="/_health?batch=contender-2" viewportGating />
          <Frame src="/_health?batch=holder-1" viewportGating />
          <Frame src="/_health?batch=holder-2" viewportGating />
        </ViewportResourceBudgetProvider>,
        container
      );
    });
    const mainObserver = ObserverMock.instances[0];
    const contenderOne = mainObserver.observe.mock.calls[0][0];
    const contenderTwo = mainObserver.observe.mock.calls[1][0];
    const holderOne = mainObserver.observe.mock.calls[2][0];
    const holderTwo = mainObserver.observe.mock.calls[3][0];
    act(() => {
      mainObserver.callback(
        [holderOne, holderTwo].map((target) => ({
          target,
          isIntersecting: true,
        })) as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.advanceTimersByTime(100);
      mainObserver.callback(
        [contenderOne, contenderTwo].map((target) => ({
          target,
          isIntersecting: true,
        })) as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.advanceTimersByTime(100);
      mainObserver.callback(
        [holderOne, holderTwo].map((target) => ({
          target,
          isIntersecting: false,
        })) as IntersectionObserverEntry[],
        mainObserver as never
      );
      jest.runOnlyPendingTimers();
    });

    const mutations: string[] = [];
    let rawCount = 2;
    let maxRawCount = rawCount;
    const mutationObserver = new MutationObserver(() => undefined);
    mutationObserver.observe(container, { childList: true, subtree: true });
    const confirmation = ObserverMock.instances.at(-1);
    act(() => {
      confirmation?.callback(
        [holderOne, holderTwo].map((target) => ({
          target,
          isIntersecting: false,
        })) as IntersectionObserverEntry[],
        confirmation as never
      );
    });
    for (const record of mutationObserver.takeRecords()) {
      for (const removed of record.removedNodes) {
        if (removed instanceof HTMLIFrameElement) {
          rawCount -= 1;
          mutations.push("remove");
        }
      }
      for (const added of record.addedNodes) {
        if (added instanceof HTMLIFrameElement) {
          rawCount += 1;
          maxRawCount = Math.max(maxRawCount, rawCount);
          mutations.push("add");
        }
      }
    }
    mutationObserver.disconnect();

    expect(mutations).toEqual(["remove", "remove", "add", "add"]);
    expect(maxRawCount).toBe(2);
    expect(contenderOne.querySelectorAll("iframe")).toHaveLength(1);
    expect(contenderTwo.querySelectorAll("iframe")).toHaveLength(1);
    expect(holderOne.querySelector("iframe")).toBeNull();
    expect(holderTwo.querySelector("iframe")).toBeNull();
    expect(budget?.getSnapshot()).toMatchObject({
      capacity: 2,
      leased: 2,
      active: 2,
      cooling: 0,
      pinned: 0,
    });
  });

  it("keeps an active gated iframe through live disable", () => {
    const collector = new ViewportResourceMetricsCollector();
    renderBudgeted(true, collector);
    emit(true);
    act(() => jest.advanceTimersByTime(100));
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();

    renderBudgeted(false, collector);
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(collector.finish()).toEqual(
      expect.objectContaining({
        maxFrameCandidates: 1,
        gatedIframeEntries: 1,
        gatedIframeExits: 1,
        maxGatedIframes: 1,
      })
    );
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelector("iframe")).toBe(iframe);
  });

  it("keeps a cooling gated iframe through live disable", () => {
    renderBudgeted(true);
    emit(true);
    act(() => jest.advanceTimersByTime(100));
    const iframe = container.querySelector("iframe");
    emit(false);

    renderBudgeted(false);
    expect(container.querySelector("iframe")).toBe(iframe);
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelector("iframe")).toBe(iframe);
  });

  it("keeps a pinned gated iframe through live disable", () => {
    renderBudgeted(true);
    emit(true);
    act(() => jest.advanceTimersByTime(100));
    const iframe = container.querySelector("iframe");
    act(() => iframe?.focus());

    renderBudgeted(false);
    expect(container.querySelector("iframe")).toBe(iframe);
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelector("iframe")).toBe(iframe);
  });

  it("uses the legacy zero-delay fail-open when disabling before first mount", () => {
    renderBudgeted(true);
    expect(container.querySelector("iframe")).toBeNull();

    renderBudgeted(false);
    expect(container.querySelector("iframe")).toBeNull();
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("does not let continuity bypass gating after re-enable", () => {
    renderBudgeted(false);
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    renderBudgeted(true);
    expect(container.querySelector("iframe")).toBeNull();
    const observer = ObserverMock.instances.at(-1);
    act(() => observer?.emit(true));
    act(() => jest.advanceTimersByTime(99));
    expect(container.querySelector("iframe")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("cleans a pending disable timer on StrictMode unmount", () => {
    const renderStrict = (viewportGating: boolean) => {
      act(() => {
        ReactDOM.render(
          <React.StrictMode>
            <ViewportResourceBudgetProvider enabled capacity={1}>
              <Frame
                src="/_health?frame-continuity-strict=1"
                viewportGating={viewportGating}
              />
            </ViewportResourceBudgetProvider>
          </React.StrictMode>,
          container
        );
      });
    };
    renderStrict(true);
    renderStrict(false);
    expect(jest.getTimerCount()).toBe(1);
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});
