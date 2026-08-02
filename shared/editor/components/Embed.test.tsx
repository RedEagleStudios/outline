/** @jest-environment jsdom */

import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { light } from "../../styles/theme";
import type { EmbedDescriptor, EmbedProps } from "../embeds";
import Embed from "./Embed";

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

const transformEmbed: EmbedDescriptor = {
  id: "frame-test",
  title: "Frame test",
  regexMatch: [/^https:\/\/example\.com\/(.*)$/],
  transformMatch: (matches) => `/_health?embed-test=${matches[1]}`,
  matcher: (url) => url.match(/^https:\/\/example\.com\/(.*)$/) ?? false,
};

const customEmbedRender = jest.fn<void, [EmbedProps]>();
const CustomEmbed = (props: EmbedProps) => {
  customEmbedRender(props);
  return <div data-custom-embed>custom</div>;
};
const customEmbed: EmbedDescriptor = {
  id: "custom-test",
  title: "Custom test",
  regexMatch: [/^https:\/\/custom\.example\.com\/(.*)$/],
  component: CustomEmbed,
  matcher: (url) =>
    url.match(/^https:\/\/custom\.example\.com\/(.*)$/) ?? false,
};

const pointerEvent = (type: string, pageY: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientY: pageY });
  Object.defineProperty(event, "pageY", { value: pageY });
  return event;
};

describe("Embed viewport integration", () => {
  let container: HTMLDivElement;
  let view: EditorView;
  let schema: Schema;

  beforeEach(() => {
    customEmbedRender.mockClear();
    jest.useFakeTimers();
    ObserverMock.instances = [];
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: ObserverMock,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    schema = new Schema({
      nodes: {
        doc: { content: "embed*" },
        text: {},
        embed: {
          attrs: {
            href: {},
            width: { default: 0 },
            height: { default: 400 },
          },
        },
      },
    });
    view = new EditorView(document.createElement("div"), {
      state: EditorState.create({ schema }),
    });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    view.destroy();
    container.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const render = ({
    descriptor = transformEmbed,
    href = "https://example.com/one",
    viewportGating,
    embedsDisabled = false,
    isSelected = false,
    resizable = false,
    onChangeSize,
    width = 0,
    height = 400,
  }: {
    descriptor?: EmbedDescriptor;
    href?: string;
    viewportGating?: boolean;
    embedsDisabled?: boolean;
    isSelected?: boolean;
    resizable?: boolean;
    onChangeSize?: (size: { width: number; height?: number }) => void;
    width?: number;
    height?: number;
  } = {}) => {
    const node = schema.nodes.embed.create({ href, width, height });
    act(() => {
      ReactDOM.render(
        <Embed
          theme={light}
          view={view}
          node={node}
          isSelected={isSelected}
          isEditable
          getPos={() => 0}
          decorations={[]}
          embeds={[descriptor]}
          embedsDisabled={embedsDisabled}
          viewportGating={viewportGating}
          onChangeSize={
            onChangeSize ?? (resizable ? () => undefined : undefined)
          }
        />,
        container
      );
    });
  };

  it("gates only an explicitly enabled transformMatch frame", () => {
    render({ viewportGating: true });
    expect(ObserverMock.instances).toHaveLength(1);
    expect(container.querySelector("iframe")).toBeNull();
    act(() => ObserverMock.instances[0].emit(true));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("keeps normal transformMatch embeds on deferred default behavior", () => {
    render();
    expect(ObserverMock.instances).toHaveLength(0);
    expect(container.querySelector("iframe")).toBeNull();
    act(() => jest.advanceTimersByTime(0));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("never registers custom component or disabled embeds", () => {
    render({
      descriptor: customEmbed,
      href: "https://custom.example.com/one",
      viewportGating: true,
    });
    expect(container.querySelector("[data-custom-embed]")).not.toBeNull();
    expect(ObserverMock.instances).toHaveLength(0);

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    render({ viewportGating: true, embedsDisabled: true });
    expect(ObserverMock.instances).toHaveLength(0);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each([true, false])(
    "forwards runtime lifecycle props to a custom embed when gating is %s",
    (viewportGating) => {
      render({
        descriptor: customEmbed,
        href: "https://custom.example.com/one",
        viewportGating,
        isSelected: true,
      });

      expect(customEmbedRender).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isSelected: true,
          isResizing: false,
          viewportGating,
          style: expect.objectContaining({ height: 400 }),
        })
      );
    }
  );

  it("propagates selection and resize state to the generic frame", () => {
    render({ viewportGating: true, isSelected: true });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector(".ProseMirror-selectednode")).not.toBeNull();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    ObserverMock.instances = [];
    render({ viewportGating: true, resizable: true });
    expect(container.querySelector("iframe")).toBeNull();
    const resizeHandle = container.firstElementChild?.lastElementChild;
    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", 400));
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("keeps resize wrapper and observed iframe wrapper ref ownership distinct", () => {
    const computedStyle = jest.spyOn(window, "getComputedStyle");
    render({ viewportGating: true, resizable: true });
    const resizeWrapper = container.firstElementChild;
    const observedFrameWrapper = ObserverMock.instances[0].target;
    expect(resizeWrapper).not.toBe(observedFrameWrapper);
    expect(resizeWrapper?.contains(observedFrameWrapper ?? null)).toBe(true);

    const resizeHandle = resizeWrapper?.lastElementChild;
    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", 400));
    });
    expect(computedStyle).toHaveBeenCalledWith(resizeWrapper);
    expect(observedFrameWrapper?.querySelector("iframe")).not.toBeNull();
  });

  it("keeps the transient height visible and commits it with viewport gating off by default", () => {
    const onChangeSize = jest.fn();
    render({ onChangeSize });

    const frame = container.firstElementChild?.firstElementChild;
    const resizeHandle = container.firstElementChild?.lastElementChild;
    if (!(frame instanceof HTMLElement)) {
      throw new Error("Expected embed frame wrapper");
    }
    expect(frame.style.height).toBe("400px");

    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", 400));
    });
    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", 500));
    });

    expect(frame.style.height).toBe("500px");

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", 500));
    });
    expect(onChangeSize).toHaveBeenCalledWith({ width: 0, height: 500 });
    expect(frame.style.height).toBe("500px");
  });

  it("synchronizes external node width and height updates", () => {
    render({ width: 320, height: 240 });
    const frame = container.firstElementChild?.firstElementChild;
    if (!(frame instanceof HTMLElement)) {
      throw new Error("Expected embed frame wrapper");
    }
    expect(frame.style.width).toBe("320px");
    expect(frame.style.height).toBe("240px");

    render({ width: 480, height: 240 });
    expect(frame.style.width).toBe("480px");
    expect(frame.style.height).toBe("240px");

    render({ width: 480, height: 300 });
    expect(frame.style.width).toBe("480px");
    expect(frame.style.height).toBe("300px");
  });

  it("pins a gated iframe through resize commit", () => {
    const onChangeSize = jest.fn();
    render({ viewportGating: true, onChangeSize });
    expect(container.querySelector("iframe")).toBeNull();

    const resizeHandle = container.firstElementChild?.lastElementChild;
    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", 400));
    });
    expect(container.querySelector("iframe")).not.toBeNull();

    act(() => {
      document.dispatchEvent(pointerEvent("pointermove", 500));
    });
    expect(container.querySelector<HTMLElement>("iframe")?.style.height).toBe(
      "500px"
    );

    act(() => {
      document.dispatchEvent(pointerEvent("pointerup", 500));
    });
    expect(onChangeSize).toHaveBeenCalledWith({ width: 0, height: 500 });
    expect(container.querySelector("iframe")).not.toBeNull();
  });
});
