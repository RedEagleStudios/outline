/** @jest-environment jsdom */

import { NodeSelection, TextSelection } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { ThemeProvider } from "styled-components";
import { light } from "@shared/styles/theme";
import type { EmbedDescriptor } from "@shared/editor/embeds";
import { basicExtensions } from "@shared/editor/nodes";
import EmbedNode from "@shared/editor/nodes/Embed";
import type { ComponentProps } from "@shared/editor/types";
import Editor, { type Editor as EditorInstance } from "~/editor";
import useDictionary from "~/hooks/useDictionary";
import { NodeViewRenderer } from "./NodeViewRenderer";

jest.mock("~/components/Lightbox", () => () => null);

const embedDescriptor: EmbedDescriptor = {
  id: "component-view-test",
  title: "Component view test",
  regexMatch: [/^https:\/\/component-view\.test\/embed$/],
  transformMatch: () => "/_health?component-view-test=1",
  matcher: (url) =>
    url.match(/^https:\/\/component-view\.test\/embed$/) || false,
};

const document = {
  type: "doc",
  content: [
    {
      type: "embed",
      attrs: { href: "https://component-view.test/embed" },
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Selection target" }],
    },
  ],
};

interface TestEditorProps {
  readOnly?: boolean;
  viewportGatedEmbeds?: boolean;
  setEditor: (editor: EditorInstance | null) => void;
}

const TestEditor = ({
  readOnly,
  setEditor,
  viewportGatedEmbeds,
}: TestEditorProps) => {
  const dictionary = useDictionary();

  return (
    <ThemeProvider theme={light}>
      <Editor
        ref={setEditor}
        defaultValue={document}
        dictionary={dictionary}
        embeds={[embedDescriptor]}
        extensions={[...basicExtensions, EmbedNode]}
        onClickLink={() => undefined}
        placeholder="ComponentView test"
        readOnly={readOnly}
        userId="component-view-test-user"
        viewportGatedEmbeds={viewportGatedEmbeds}
      />
    </ThemeProvider>
  );
};

describe("ComponentView selection propagation", () => {
  let container: HTMLDivElement;
  let editor: EditorInstance | null;

  beforeEach(() => {
    container = global.document.createElement("div");
    global.document.body.appendChild(container);
    editor = null;
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  const renderEditor = (readOnly = false, viewportGatedEmbeds = false) => {
    act(() => {
      ReactDOM.render(
        <TestEditor
          readOnly={readOnly}
          setEditor={(value) => (editor = value)}
          viewportGatedEmbeds={viewportGatedEmbeds}
        />,
        container
      );
    });
    if (!editor) {
      throw new Error("Expected editor instance");
    }
    return editor;
  };

  it("propagates real EditorView selection and later node updates", () => {
    const instance = renderEditor();
    const { view } = instance;

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3))
      );
    });
    expect(container.querySelector(".ProseMirror-selectednode")).toBeNull();

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))
      );
    });
    expect(container.querySelector(".ProseMirror-selectednode")).not.toBeNull();

    act(() => {
      view.dispatch(
        view.state.tr.setNodeMarkup(0, undefined, {
          ...view.state.doc.nodeAt(0)?.attrs,
          width: 500,
          height: 300,
        })
      );
    });
    expect(container.querySelector(".ProseMirror-selectednode")).not.toBeNull();
    expect(
      container.querySelector('.component-embed [style*="width: 500px"]')
    ).not.toBeNull();

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))
      );
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3))
      );
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3))
      );
    });
    expect(container.querySelector(".ProseMirror-selectednode")).toBeNull();
  });

  it("keeps selected React UI disabled in read-only mode", () => {
    const instance = renderEditor(true);
    act(() => {
      instance.view.dispatch(
        instance.view.state.tr.setSelection(
          NodeSelection.create(instance.view.state.doc, 0)
        )
      );
    });
    expect(instance.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(container.querySelector(".ProseMirror-selectednode")).toBeNull();
  });

  it("disables existing NodeViews live but enables only newly created NodeViews", () => {
    const instance = renderEditor(false, true);
    const originalView = instance.view;
    const originalState = originalView.state;
    const originalDocument = originalState.doc;
    const originalSelection = originalState.selection;
    const originalRenderer = Array.from(instance.renderers)[0];
    expect(originalRenderer.props.viewportGating).toBe(true);

    const createNonEmbedRenderer = (nodeName: "image" | "dropdown") => {
      const fallbackSchema = new Schema({
        nodes: {
          doc: {},
          text: {},
          [nodeName]: {},
        },
      });
      const nodeType =
        originalView.state.schema.nodes[nodeName] ??
        fallbackSchema.nodes[nodeName];
      const renderer = new NodeViewRenderer<ComponentProps>(
        global.document.createElement("span"),
        () => null,
        {
          node: nodeType.create(),
          view: originalView,
          isSelected: false,
          isEditable: true,
          getPos: () => 0,
          decorations: [],
          viewportGating: undefined,
          theme: light,
        }
      );
      instance.renderers.add(renderer);
      return renderer;
    };
    const imageRenderer = createNonEmbedRenderer("image");
    const dropdownRenderer = createNonEmbedRenderer("dropdown");
    const imageSetProp = jest.spyOn(imageRenderer, "setProp");
    const dropdownSetProp = jest.spyOn(dropdownRenderer, "setProp");

    renderEditor(false, false);
    expect(instance.view).toBe(originalView);
    expect(instance.view.state).toBe(originalState);
    expect(instance.view.state.doc).toBe(originalDocument);
    expect(instance.view.state.selection).toBe(originalSelection);
    expect(originalRenderer.props.viewportGating).toBe(false);
    expect(imageSetProp).not.toHaveBeenCalled();
    expect(dropdownSetProp).not.toHaveBeenCalled();
    expect(imageRenderer.props.viewportGating).toBeUndefined();
    expect(dropdownRenderer.props.viewportGating).toBeUndefined();

    renderEditor(false, true);
    expect(originalRenderer.props.viewportGating).toBe(false);
    act(() => {
      originalView.dispatch(
        originalView.state.tr.setNodeMarkup(0, undefined, {
          ...originalView.state.doc.nodeAt(0)?.attrs,
          width: 420,
        })
      );
    });
    expect(originalRenderer.props.viewportGating).toBe(false);

    const embedNode = originalView.state.schema.nodes.embed.create({
      href: "https://component-view.test/embed",
    });
    const existingNodeSize = originalView.state.doc.nodeAt(0)?.nodeSize;
    if (existingNodeSize === undefined) {
      throw new Error("Expected mounted embed node");
    }
    act(() => {
      originalView.dispatch(originalView.state.tr.delete(0, existingNodeSize));
      originalView.dispatch(originalView.state.tr.insert(0, embedNode));
    });
    const replacementRenderer = Array.from(instance.renderers).find(
      (renderer) => renderer.props.node.type.name === "embed"
    );
    if (!replacementRenderer) {
      throw new Error("Expected replacement embed renderer");
    }
    expect(replacementRenderer).not.toBe(originalRenderer);
    expect(replacementRenderer.props.viewportGating).toBe(true);
    expect(instance.renderers.has(imageRenderer)).toBe(true);
    expect(instance.renderers.has(dropdownRenderer)).toBe(true);
  });
});
