/** @jest-environment jsdom */

import { Schema } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { TableLayout } from "../types";
import { TableView } from "./TableView";

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

const createTableNode = (layout: TableLayout | null = null) => {
  const paragraph = schema.nodes.paragraph.create();
  const cell = schema.nodes.table_cell.create(null, paragraph);
  const row = schema.nodes.table_row.create(null, cell);
  return schema.nodes.table.create({ layout }, row);
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
    for (const handle of Array.from(animationFrames.keys())) {
      runAnimationFrame(handle);
    }
  };

  const createView = (layout: TableLayout | null = null) => {
    const view = new TableView(createTableNode(layout), 100);
    views.push(view);
    return view;
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
    jest.restoreAllMocks();
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

  it("keeps later local and document scroll updates on per-view frames", () => {
    const view = createView();
    const scrollable = getScrollable(view);
    runAllAnimationFrames();
    requestAnimationFrameSpy.mockClear();

    scrollable.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });

  it("cancels queued per-view frames without leaking across destroy calls", () => {
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

    expect(cancelAnimationFrameSpy).toHaveBeenCalledTimes(2);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });
});
