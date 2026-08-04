/** @jest-environment jsdom */

import { Schema } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { TableLayout } from "../types";
import { TableView } from "./TableView";

const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver"
);
const cssDescriptor = Object.getOwnPropertyDescriptor(window, "CSS");

class MockIntersectionObserver implements IntersectionObserver {
  public static instances: MockIntersectionObserver[] = [];
  public static failConstruction = false;

  public constructor(public readonly callback: IntersectionObserverCallback) {
    if (MockIntersectionObserver.failConstruction) {
      throw new Error("observer unavailable");
    }
    MockIntersectionObserver.instances.push(this);
  }

  public readonly root = null;
  public readonly rootMargin = "1000px 0px 1000px 0px";
  public readonly thresholds = [0];
  public readonly observe = jest.fn((target: Element) => {
    this.targets.add(target);
  });
  public readonly unobserve = jest.fn((target: Element) => {
    this.targets.delete(target);
  });
  public readonly disconnect = jest.fn();
  public readonly takeRecords = () => [];

  public emit(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this
    );
  }

  private readonly targets = new Set<Element>();
}

const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {},
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: {},
    ...tableNodeSpecs,
    table: {
      ...tableNodeSpecs.table,
      attrs: { layout: { default: null } },
    },
  },
});

const createTableNode = (layout: TableLayout | null = null, rowCount = 1) => {
  const paragraph = schema.nodes.paragraph.create();
  const cell = schema.nodes.table_cell.create(null, paragraph);
  const row = schema.nodes.table_row.create(null, cell);
  return schema.nodes.table.create(
    { layout },
    Array.from({ length: rowCount }, () => row)
  );
};

const getScrollable = (view: TableView) => {
  const scrollable = view.table.parentElement;
  if (!scrollable) {
    throw new Error("Expected the table to have a scrollable parent");
  }

  return scrollable;
};

interface Geometry {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  clientHeight: number;
}

const setGeometry = (
  element: HTMLElement,
  geometry: Geometry,
  onRead: (name: string) => void = () => undefined
) => {
  for (const property of Object.keys(geometry) as Array<keyof Geometry>) {
    Object.defineProperty(element, property, {
      configurable: true,
      get: () => {
        onRead(property);
        return geometry[property];
      },
    });
  }
};

describe("TableView lifecycle", () => {
  let nextAnimationFrame: number;
  let animationFrames: Map<number, FrameRequestCallback>;
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;
  let views: TableView[];

  const runAnimationFrame = (handle: number) => {
    const callback = animationFrames.get(handle);
    if (!callback) {
      throw new Error(`Expected animation frame ${handle}`);
    }
    animationFrames.delete(handle);
    callback(performance.now());
  };

  const runAllAnimationFrames = () => {
    while (animationFrames.size) {
      for (const handle of Array.from(animationFrames.keys())) {
        runAnimationFrame(handle);
      }
    }
  };

  const createView = (layout: TableLayout | null = null) => {
    const view = new TableView(createTableNode(layout), 100);
    document.body.appendChild(view.dom);
    views.push(view);
    return view;
  };

  const enableRenderingContainment = () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(window, "CSS", {
      configurable: true,
      value: {
        supports: jest.fn(
          (property: string, value: string) =>
            (property === "content-visibility" && value === "auto") ||
            (property === "contain-intrinsic-block-size" &&
              value === "auto 100px")
        ),
      },
    });
  };

  beforeEach(() => {
    nextAnimationFrame = 1;
    animationFrames = new Map();
    views = [];
    requestAnimationFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const handle = nextAnimationFrame++;
        animationFrames.set(handle, callback);
        return handle;
      });
    cancelAnimationFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((handle) => {
        animationFrames.delete(handle);
      });
  });

  afterEach(() => {
    views.forEach((view) => view.destroy());
    document.body.replaceChildren();
    MockIntersectionObserver.instances = [];
    MockIntersectionObserver.failConstruction = false;
    if (intersectionObserverDescriptor) {
      Object.defineProperty(
        globalThis,
        "IntersectionObserver",
        intersectionObserverDescriptor
      );
    } else {
      Reflect.deleteProperty(globalThis, "IntersectionObserver");
    }
    if (cssDescriptor) {
      Object.defineProperty(window, "CSS", cssDescriptor);
    } else {
      Reflect.deleteProperty(window, "CSS");
    }
    jest.restoreAllMocks();
  });

  it("manages containment only after a mounted top-level view is eligible", () => {
    enableRenderingContainment();
    const view = new TableView(createTableNode(null, 3), 100);
    views.push(view);

    runAllAnimationFrames();
    expect(
      view.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(false);

    document.body.appendChild(view.dom);
    view.destroy();
    const mounted = createView();
    expect(
      mounted.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(false);

    runAllAnimationFrames();
    expect(
      mounted.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(true);
  });

  it("estimates intrinsic block size from rows, updates it, and cleans up", () => {
    enableRenderingContainment();
    const view = new TableView(createTableNode(null, 3), 100);
    document.body.appendChild(view.dom);
    views.push(view);

    runAllAnimationFrames();
    expect(
      view.dom.style.getPropertyValue("--table-intrinsic-block-size")
    ).toBe("116px");

    expect(view.update(createTableNode(null, 10))).toBe(true);
    expect(
      view.dom.style.getPropertyValue("--table-intrinsic-block-size")
    ).toBe("347px");

    view.destroy();
    expect(
      view.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(false);
    expect(
      view.dom.style.getPropertyValue("--table-intrinsic-block-size")
    ).toBe("");
  });

  it("does not manage nested tables or observer fail-open paths", () => {
    enableRenderingContainment();
    const outer = document.body.appendChild(document.createElement("table"));
    const nested = createView();
    outer.appendChild(nested.dom);
    runAllAnimationFrames();

    expect(
      nested.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(false);

    nested.destroy();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    const failOpen = createView();
    runAllAnimationFrames();
    expect(
      failOpen.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ).toBe(false);
  });

  it("performs no geometry or computed-style reads in the constructor", () => {
    const scrollLeft = jest.spyOn(HTMLElement.prototype, "scrollLeft", "get");
    const scrollWidth = jest.spyOn(HTMLElement.prototype, "scrollWidth", "get");
    const clientWidth = jest.spyOn(HTMLElement.prototype, "clientWidth", "get");
    const clientHeight = jest.spyOn(
      HTMLElement.prototype,
      "clientHeight",
      "get"
    );
    const computedStyle = jest.spyOn(window, "getComputedStyle");
    const boundingRect = jest.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect"
    );
    const view = createView();

    expect(scrollLeft).not.toHaveBeenCalled();
    expect(scrollWidth).not.toHaveBeenCalled();
    expect(clientWidth).not.toHaveBeenCalled();
    expect(clientHeight).not.toHaveBeenCalled();
    expect(computedStyle).not.toHaveBeenCalled();
    expect(boundingRect).not.toHaveBeenCalled();
    expect(view).toBeDefined();
  });

  it("schedules eight initial views into one read-before-write frame", () => {
    const order: string[] = [];
    const batch = Array.from({ length: 8 }, (_, index) => {
      const view = createView();
      setGeometry(
        getScrollable(view),
        {
          scrollLeft: index ? 10 : 0,
          scrollWidth: 400,
          clientWidth: 200,
          clientHeight: 100,
        },
        () => order.push(`read-${index}`)
      );
      jest.spyOn(view.dom.classList, "toggle").mockImplementation((...args) => {
        if (args[0] !== EditorStyleHelper.tableFullWidth) {
          order.push(`write-${index}`);
        }
        return args[1] ?? false;
      });
      return view;
    });

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    runAllAnimationFrames();

    const firstWrite = order.findIndex((entry) => entry.startsWith("write"));
    const lastRead = Math.max(
      ...order.map((entry, index) => (entry.startsWith("read") ? index : -1))
    );
    expect(firstWrite).toBeGreaterThan(lastRead);
    expect(batch).toHaveLength(8);
  });

  it("applies full width immediately and shadows and dimensions after frame", () => {
    const view = createView(TableLayout.fullWidth);
    const scrollable = getScrollable(view);
    setGeometry(scrollable, {
      scrollLeft: 20,
      scrollWidth: 500,
      clientWidth: 200,
      clientHeight: 120,
    });

    expect(view.dom.classList.contains(EditorStyleHelper.tableFullWidth)).toBe(
      true
    );
    expect(view.dom.classList.contains(EditorStyleHelper.tableShadowLeft)).toBe(
      false
    );
    runAllAnimationFrames();

    expect(view.dom.classList.contains(EditorStyleHelper.tableShadowLeft)).toBe(
      true
    );
    expect(
      view.dom.classList.contains(EditorStyleHelper.tableShadowRight)
    ).toBe(true);
    expect(view.dom.style.getPropertyValue("--table-height")).toBe("120px");
    expect(view.dom.style.getPropertyValue("--table-width")).toBe("200px");
  });

  it.each([
    ["above", { top: 80, bottom: 300, height: 220 }, false, ""],
    ["crossing", { top: -20, bottom: 300, height: 320 }, true, "20px"],
    ["past", { top: -300, bottom: 40, height: 340 }, false, ""],
  ])("keeps sticky behavior when %s the range", (_, rect, sticky, offset) => {
    const view = createView();
    setGeometry(getScrollable(view), {
      scrollLeft: 0,
      scrollWidth: 200,
      clientWidth: 200,
      clientHeight: 100,
    });
    jest.spyOn(view.table, "getBoundingClientRect").mockReturnValue({
      ...rect,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    });
    const header = view.table.appendChild(document.createElement("tr"));
    jest.spyOn(header, "getBoundingClientRect").mockReturnValue({
      top: rect.top,
      bottom: rect.top + 30,
      height: 30,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    });

    runAllAnimationFrames();

    expect(
      view.dom.classList.contains(EditorStyleHelper.tableStickyHeader)
    ).toBe(sticky);
    expect(view.dom.style.getPropertyValue("--sticky-scroll-offset")).toBe(
      offset
    );
  });

  it("does not install sticky handling for nested tables", () => {
    const outer = document.createElement("table");
    const wrapper = document.createElement("div");
    wrapper.classList.add(EditorStyleHelper.table);
    outer.appendChild(wrapper);
    document.body.appendChild(outer);
    const view = createView();
    wrapper.appendChild(view.dom);
    const addListener = jest.spyOn(document, "addEventListener");

    runAllAnimationFrames();

    expect(addListener).not.toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      expect.anything()
    );
  });

  it("measures nested geometry initially and locally without sticky or document scroll work", () => {
    const outer = document.body.appendChild(document.createElement("table"));
    const view = createView();
    outer.appendChild(view.dom);
    const reads = jest.fn();
    setGeometry(
      getScrollable(view),
      {
        scrollLeft: 10,
        scrollWidth: 300,
        clientWidth: 100,
        clientHeight: 80,
      },
      reads
    );
    const rect = jest.spyOn(view.table, "getBoundingClientRect");
    const addListener = jest.spyOn(document, "addEventListener");

    runAllAnimationFrames();
    expect(reads).toHaveBeenCalled();
    expect(rect).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      expect.anything()
    );

    reads.mockClear();
    getScrollable(view).dispatchEvent(new Event("scroll"));
    runAllAnimationFrames();
    expect(reads).toHaveBeenCalled();
    expect(rect).not.toHaveBeenCalled();
  });

  it("gates pooled measurements and re-observes without stale hidden work", () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: MockIntersectionObserver,
    });
    let visibilityState: DocumentVisibilityState = "visible";
    jest
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibilityState);
    const order: string[] = [];
    const first = createView();
    const second = createView();
    [first, second].forEach((view, index) => {
      setGeometry(
        getScrollable(view),
        {
          scrollLeft: 0,
          scrollWidth: 300,
          clientWidth: 100,
          clientHeight: 80,
        },
        () => order.push(`read-${index}`)
      );
      jest.spyOn(view.dom.classList, "toggle").mockImplementation((name) => {
        if (
          name !== EditorStyleHelper.tableFullWidth &&
          name !== EditorStyleHelper.tableContentVisibility
        ) {
          order.push(`write-${index}`);
        }
        return false;
      });
    });

    runAllAnimationFrames();
    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(order).toEqual([]);
    observer.emit(first.dom, false);
    expect(order).toEqual([]);
    observer.emit(first.dom, true);
    observer.emit(second.dom, true);
    runAllAnimationFrames();
    const firstWrite = order.findIndex((value) => value.startsWith("write"));
    const lastRead = Math.max(
      ...order.map((value, index) => (value.startsWith("read") ? index : -1))
    );
    expect(firstWrite).toBeGreaterThan(lastRead);

    first.dom.classList.add(EditorStyleHelper.tableStickyHeader);
    observer.emit(first.dom, false);
    expect(
      first.dom.classList.contains(EditorStyleHelper.tableStickyHeader)
    ).toBe(false);
    order.length = 0;
    observer.emit(first.dom, true);
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    runAllAnimationFrames();
    expect(order).toEqual([]);
    expect(
      first.dom.classList.contains(EditorStyleHelper.tableStickyHeader)
    ).toBe(false);

    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    runAllAnimationFrames();
    expect(order).toEqual([]);
    expect(MockIntersectionObserver.instances).toHaveLength(2);
    MockIntersectionObserver.instances[1].emit(first.dom, true);
    runAllAnimationFrames();
    expect(order.some((value) => value.startsWith("read"))).toBe(true);

    first.destroy();
    expect(
      MockIntersectionObserver.instances[1].disconnect
    ).not.toHaveBeenCalled();
    second.destroy();
    expect(
      MockIntersectionObserver.instances[1].disconnect
    ).toHaveBeenCalledTimes(1);
  });

  it.each(["unavailable", "construction failure"])(
    "fails open when IntersectionObserver is %s",
    (failure) => {
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: failure === "unavailable" ? undefined : MockIntersectionObserver,
      });
      MockIntersectionObserver.failConstruction =
        failure === "construction failure";
      const view = createView();
      const reads = jest.fn();
      setGeometry(
        getScrollable(view),
        {
          scrollLeft: 0,
          scrollWidth: 200,
          clientWidth: 100,
          clientHeight: 80,
        },
        reads
      );

      runAllAnimationFrames();
      expect(reads).toHaveBeenCalled();
    }
  );

  it("skips destroyed pending views and cancels only an empty shared batch", () => {
    const first = createView();
    const second = createView();
    const firstGeometry = jest.fn();
    const secondGeometry = jest.fn();
    setGeometry(
      getScrollable(first),
      {
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 200,
        clientHeight: 100,
      },
      firstGeometry
    );
    setGeometry(
      getScrollable(second),
      {
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 200,
        clientHeight: 100,
      },
      secondGeometry
    );

    first.destroy();
    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
    runAllAnimationFrames();
    expect(firstGeometry).not.toHaveBeenCalled();
    expect(secondGeometry).toHaveBeenCalled();

    const third = createView();
    third.destroy();
    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the latest node when updated before the initial frame", () => {
    const view = createView();

    expect(view.update(createTableNode(TableLayout.fullWidth))).toBe(true);
    expect(view.dom.classList.contains(EditorStyleHelper.tableFullWidth)).toBe(
      true
    );
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    runAllAnimationFrames();
    expect(view.dom.classList.contains(EditorStyleHelper.tableFullWidth)).toBe(
      true
    );
  });

  it("applies initial state when a delayed frame eventually runs", () => {
    const view = createView();
    setGeometry(getScrollable(view), {
      scrollLeft: 10,
      scrollWidth: 300,
      clientWidth: 100,
      clientHeight: 80,
    });

    expect(view.dom.style.getPropertyValue("--table-width")).toBe("");
    runAllAnimationFrames();
    expect(view.dom.style.getPropertyValue("--table-width")).toBe("100px");
    expect(view.dom.classList.contains(EditorStyleHelper.tableShadowLeft)).toBe(
      true
    );
  });

  it("removes local and document listeners after live setup", () => {
    const view = createView();
    const scrollable = getScrollable(view);
    const localRemoveListener = jest.spyOn(scrollable, "removeEventListener");
    const documentRemoveListener = jest.spyOn(document, "removeEventListener");
    runAllAnimationFrames();

    view.destroy();

    expect(localRemoveListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function)
    );
    expect(documentRemoveListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      { capture: true }
    );
  });

  it("coalesces later local and document scroll updates in one frame", () => {
    const view = createView();
    const scrollable = getScrollable(view);
    runAllAnimationFrames();
    requestAnimationFrameSpy.mockClear();

    scrollable.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });

  it("limits a captured local scroll to its own table", () => {
    const first = createView();
    const second = createView();
    const firstReads = jest.fn();
    const secondReads = jest.fn();
    setGeometry(
      getScrollable(first),
      {
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
        clientHeight: 80,
      },
      firstReads
    );
    setGeometry(
      getScrollable(second),
      {
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 100,
        clientHeight: 80,
      },
      secondReads
    );
    runAllAnimationFrames();
    firstReads.mockClear();
    secondReads.mockClear();

    getScrollable(first).dispatchEvent(new Event("scroll", { bubbles: true }));
    runAllAnimationFrames();

    expect(firstReads).toHaveBeenCalled();
    expect(secondReads).not.toHaveBeenCalled();
  });

  it("cancels the queued shared frame without leaking across destroy calls", () => {
    const view = createView();
    const scrollable = getScrollable(view);
    runAllAnimationFrames();
    requestAnimationFrameSpy.mockClear();
    cancelAnimationFrameSpy.mockClear();

    scrollable.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    view.destroy();
    view.destroy();
    scrollable.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));

    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });
});
