/** @jest-environment jsdom */
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { ThemeProvider } from "styled-components";
import { basicExtensions } from "@shared/editor/nodes";
import Dropdown from "@shared/editor/nodes/Dropdown";
import DropdownDefinition from "@shared/editor/nodes/DropdownDefinition";
import { DropdownMenuController } from "@shared/editor/nodes/DropdownMenuController";
import { light } from "@shared/styles/theme";
import { ySyncPluginKey } from "y-prosemirror";
import Editor, { type Editor as EditorInstance } from "~/editor";
import useDictionary from "~/hooks/useDictionary";

jest.mock("~/components/Lightbox", () => () => null);

const value = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "dropdown",
          attrs: {
            id: "first",
            dropdownId: "status",
            selectedOptionId: "design",
          },
        },
        { type: "text", text: " and " },
        {
          type: "dropdown",
          attrs: {
            id: "second",
            dropdownId: "status",
            selectedOptionId: "open",
          },
        },
      ],
    },
    {
      type: "dropdown_definition",
      attrs: {
        id: "status",
        name: "Status",
        options: [
          { id: "design", label: "Design", color: "#9E77ED" },
          { id: "open", label: "Open Issue", color: "#BA1A1A" },
        ],
      },
    },
  ],
};

interface TestEditorProps {
  cacheOnly?: boolean;
  readOnly?: boolean;
  setEditor: (editor: EditorInstance | null) => void;
}

function TestEditor({ cacheOnly, readOnly, setEditor }: TestEditorProps) {
  const dictionary = useDictionary();
  return (
    <ThemeProvider theme={light}>
      <Editor
        ref={setEditor}
        cacheOnly={cacheOnly}
        defaultValue={value}
        dictionary={dictionary}
        embeds={[]}
        extensions={[...basicExtensions, DropdownDefinition, Dropdown]}
        onClickLink={() => undefined}
        placeholder="Dropdown integration test"
        readOnly={readOnly}
        userId="dropdown-integration-user"
      />
    </ThemeProvider>
  );
}

describe("native dropdown integration", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });

  it("opens its singleton widget on first interaction without a transaction", () => {
    const refreshAll = jest.spyOn(
      DropdownMenuController.prototype,
      "refreshAll"
    );
    const editors: EditorInstance[] = [];
    act(() => {
      ReactDOM.render(
        <TestEditor setEditor={(value) => value && editors.push(value)} />,
        container
      );
    });
    const editor = editors[0];
    if (!editor) {
      throw new Error("Expected editor instance");
    }
    expect(
      Array.from(editor.renderers).filter(
        (renderer) => renderer.props.node.type.name === "dropdown"
      )
    ).toHaveLength(0);
    expect(document.querySelector("[role='menu']")).toBeNull();

    const button = container.querySelector<HTMLButtonElement>(
      ".component-dropdown button"
    );
    act(() => button?.click());

    expect(document.querySelectorAll("[role='menu']")).toHaveLength(1);

    act(() => {
      editor.view.dispatch(
        editor.view.state.tr.setNodeAttribute(1, "selectedOptionId", "open")
      );
    });
    expect(refreshAll).not.toHaveBeenCalled();
    expect(
      document.querySelector("[role='menuitemradio'][aria-checked='true']")
        ?.textContent
    ).toBe("Open Issue");

    act(() => {
      editor.view.dispatch(editor.view.state.tr.insertText("!", 3));
    });
    expect(refreshAll).not.toHaveBeenCalled();
    const definitionPos = editor.view.state.doc.child(0).nodeSize;
    act(() => {
      editor.view.dispatch(
        editor.view.state.tr.setNodeMarkup(definitionPos, undefined, {
          id: "status",
          name: "Updated status",
          options: [
            { id: "ready", label: "Ready", color: "#17834F" },
            { id: "blocked", label: "Blocked", color: "#BA1A1A" },
          ],
        })
      );
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[role='menu']")?.getAttribute("aria-label")
    ).toBe("Updated status");
    expect(
      document.querySelector("[role='menuitemradio'][aria-checked='true']")
        ?.textContent
    ).toBe("Ready");
  });

  it("conservatively refreshes and closes for a broad remote replacement", () => {
    const refreshAll = jest.spyOn(
      DropdownMenuController.prototype,
      "refreshAll"
    );
    const editors: EditorInstance[] = [];
    act(() => {
      ReactDOM.render(
        <TestEditor setEditor={(editor) => editor && editors.push(editor)} />,
        container
      );
    });
    const editor = editors[0];
    const button = container.querySelector<HTMLButtonElement>(
      ".component-dropdown button"
    );
    act(() => button?.click());
    expect(document.querySelector("[role='menu']")).not.toBeNull();

    const replacement = editor.view.state.schema.nodes.paragraph.create(null, [
      editor.view.state.schema.text("replacement"),
    ]);
    act(() => {
      editor.view.dispatch(
        editor.view.state.tr
          .replaceWith(0, editor.view.state.doc.content.size, replacement)
          .setMeta(ySyncPluginKey, { isChangeOrigin: true })
      );
    });
    expect(refreshAll).toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).toBeNull();
  });

  it("excludes dropdown renderers in cache-only and ordinary instances", () => {
    const editors: EditorInstance[] = [];
    act(() => {
      ReactDOM.render(
        <>
          <TestEditor
            cacheOnly
            readOnly
            setEditor={(value) => value && editors.push(value)}
          />
          <TestEditor setEditor={(value) => value && editors.push(value)} />
        </>,
        container
      );
    });
    expect(editors).toHaveLength(2);
    editors.forEach((editor) => {
      expect(
        Array.from(editor.renderers).some(
          (renderer) => renderer.props.node.type.name === "dropdown"
        )
      ).toBe(false);
    });
  });

  it("closes and refreshes native state when becoming read-only", () => {
    const editors: EditorInstance[] = [];
    const render = (readOnly: boolean) => (
      <TestEditor
        readOnly={readOnly}
        setEditor={(editor) => editor && editors.push(editor)}
      />
    );
    act(() => {
      ReactDOM.render(render(false), container);
    });
    const button = container.querySelector<HTMLButtonElement>(
      ".component-dropdown button"
    );
    act(() => button?.click());
    expect(document.querySelector("[role='menu']")).not.toBeNull();

    act(() => {
      ReactDOM.render(render(true), container);
    });
    expect(document.querySelector("[role='menu']")).toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.querySelector("[aria-hidden='true']")).toBeNull();
  });
});
