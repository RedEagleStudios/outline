import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "@shared/test/editor";
import { DropdownMenuController } from "./DropdownMenuController";
import { DropdownView } from "./DropdownView";

const describeDOM = typeof document === "undefined" ? describe.skip : describe;

describeDOM("DropdownMenuController", () => {
  function setup(ownerDocument = document) {
    const node = schema.nodes.dropdown.create({
      id: "chip",
      dropdownId: "status",
      selectedOptionId: "design",
    });
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [node]),
      ]),
    });
    const host = ownerDocument.createElement("div");
    ownerDocument.body.appendChild(host);
    const editorView = new EditorView(host, { state });
    const controller = new DropdownMenuController();
    controller.attach(editorView);
    let pos: number | undefined = 1;
    const dropdownView = new DropdownView(
      node,
      editorView,
      () => pos,
      controller
    );
    return {
      controller,
      dropdownView,
      editorView,
      host,
      deletePosition: () => (pos = undefined),
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it("owns owner-document listeners only while open and cleans once", () => {
    const context = setup();
    const doc = context.editorView.dom.ownerDocument;
    const ownerWindow = doc.defaultView;
    if (!ownerWindow) {
      throw new Error("Expected owner window");
    }
    const addDocument = jest.spyOn(doc, "addEventListener");
    const removeDocument = jest.spyOn(doc, "removeEventListener");
    const addWindow = jest.spyOn(ownerWindow, "addEventListener");
    const removeWindow = jest.spyOn(ownerWindow, "removeEventListener");

    context.controller.toggle(context.dropdownView);
    expect(addDocument).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function)
    );
    expect(addWindow).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true
    );
    context.controller.close();
    context.controller.close();
    expect(
      removeDocument.mock.calls.filter(([name]) => name === "pointerdown")
    ).toHaveLength(1);
    expect(
      removeWindow.mock.calls.filter(([name]) => name === "scroll")
    ).toHaveLength(1);

    context.dropdownView.destroy();
    context.controller.destroy();
    context.editorView.destroy();
    context.host.remove();
  });

  it("closes safely without dispatching when the active position is stale", () => {
    const context = setup();
    const dispatch = jest.spyOn(context.editorView, "dispatch");
    context.controller.toggle(context.dropdownView);
    context.deletePosition();
    context.controller.handleSelect({
      id: "open",
      label: "Open Issue",
      color: "#BA1A1A",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(context.controller.activeView).toBeUndefined();

    context.dropdownView.destroy();
    context.controller.destroy();
    context.editorView.destroy();
    context.host.remove();
  });

  it("isolates listeners to a secondary owner document", () => {
    const secondary = document.implementation.createHTMLDocument("secondary");
    const context = setup(secondary);
    const secondaryAdd = jest.spyOn(secondary, "addEventListener");
    const primaryAdd = jest.spyOn(document, "addEventListener");
    context.controller.toggle(context.dropdownView);
    expect(secondaryAdd).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function)
    );
    expect(primaryAdd).not.toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function)
    );

    context.dropdownView.destroy();
    context.controller.destroy();
    context.editorView.destroy();
    context.host.remove();
  });
});
