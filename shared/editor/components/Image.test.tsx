/** @jest-environment jsdom */

import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import type { DefaultTheme } from "styled-components";
import Image from "./Image";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

const schema = new Schema({
  nodes: {
    doc: { content: "image*", toDOM: () => ["div", 0] },
    text: { group: "inline" },
    image: {
      attrs: {
        src: {},
        alt: { default: "" },
        width: { default: 320 },
        height: { default: 180 },
        layoutClass: { default: null },
        marks: { default: [] },
      },
      toDOM: () => ["span"],
    },
  },
  marks: {
    link: { attrs: { href: {} } },
  },
});

describe("Image", () => {
  let container: HTMLDivElement;
  let view: EditorView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    view = new EditorView(document.createElement("div"), {
      state: EditorState.create({
        schema,
        doc: schema.node("doc", undefined, [
          schema.node("image", { src: "https://example.com/image.png" }),
        ]),
      }),
    });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    view.destroy();
    container.remove();
  });

  it("lazily loads and asynchronously decodes only the network image", () => {
    const node = view.state.doc.firstChild;
    if (!node) {
      throw new Error("image node unavailable");
    }

    act(() => {
      ReactDOM.render(
        <Image
          theme={{} as DefaultTheme}
          view={view}
          node={node}
          isSelected={false}
          isEditable={false}
          getPos={() => 0}
          decorations={[]}
          onClick={() => undefined}
        />,
        container
      );
    });

    const networkImage = container.querySelector<HTMLImageElement>(
      'img[src="https://example.com/image.png"]'
    );
    const placeholder = container.querySelector<HTMLImageElement>(
      'img[src^="data:image/svg+xml"]'
    );
    expect(networkImage?.getAttribute("loading")).toBe("lazy");
    expect(networkImage?.getAttribute("decoding")).toBe("async");
    expect(networkImage?.style.display).toBe("block");
    expect(networkImage?.style.opacity).toBe("0");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.hasAttribute("loading")).toBe(false);
    expect(placeholder?.hasAttribute("decoding")).toBe(false);
    expect(placeholder?.style.position).toBe("absolute");

    act(() => {
      networkImage?.dispatchEvent(new Event("load", { bubbles: true }));
    });

    expect(networkImage?.style.opacity).toBe("1");
    expect(
      container.querySelector<HTMLImageElement>(
        'img[src^="data:image/svg+xml"]'
      )
    ).toBeNull();
  });
});
