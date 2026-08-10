import { EditorState } from "prosemirror-state";
import { Decoration, EditorView } from "prosemirror-view";
import { schema } from "@shared/test/editor";
import { DropdownMenuController } from "./DropdownMenuController";
import { DropdownView } from "./DropdownView";

const describeDOM = typeof document === "undefined" ? describe.skip : describe;

describeDOM("DropdownView", () => {
  function setup(editable = true) {
    const node = schema.nodes.dropdown.create({
      id: "chip-1",
      dropdownId: "status",
      selectedOptionId: "design",
    });
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [node]),
      ]),
    });
    const editorView = new EditorView(document.createElement("div"), {
      state,
      editable: () => editable,
    });
    const controller = new DropdownMenuController();
    controller.attach(editorView);
    const decoration = Decoration.node(1, 2, { class: "remote-change" });
    const dropdownView = new DropdownView(
      node,
      editorView,
      () => 1,
      controller,
      [decoration]
    );
    return { node, editorView, controller, dropdownView };
  }

  it("renders native chip state and preserves decoration classes", () => {
    const { dropdownView, editorView } = setup();
    const button = dropdownView.dom.querySelector("button");

    expect(dropdownView.dom.classList).toContain("component-dropdown");
    expect(dropdownView.dom.classList).toContain("remote-change");
    expect(dropdownView.dom.dataset).toMatchObject({
      id: "chip-1",
      dropdownId: "status",
      selectedOptionId: "design",
    });
    expect(button?.textContent).toContain("Design");
    expect(button?.disabled).toBe(false);
    expect(button?.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(dropdownView.ignoreMutation()).toBe(true);
    expect(dropdownView.stopEvent(new MouseEvent("click"))).toBe(false);

    dropdownView.destroy();
    dropdownView.destroy();
    editorView.destroy();
  });

  it("accepts attribute updates only for the same type and identity", () => {
    const { node, dropdownView, editorView } = setup();
    expect(
      dropdownView.update(
        node.type.create({ ...node.attrs, selectedOptionId: "progress" }),
        []
      )
    ).toBe(true);
    expect(dropdownView.dom.textContent).toContain("In Progress");
    expect(
      dropdownView.update(node.type.create({ ...node.attrs, id: "other" }), [])
    ).toBe(false);
    expect(dropdownView.update(schema.nodes.paragraph.create(), [])).toBe(
      false
    );

    dropdownView.destroy();
    editorView.destroy();
  });

  it("renders disabled without a caret when read-only", () => {
    const { dropdownView, editorView } = setup(false);
    const button = dropdownView.dom.querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.querySelector("[aria-hidden='true']")).toBeNull();
    dropdownView.destroy();
    editorView.destroy();
  });

  it.each(["Enter", " "])("opens from the %s key", (key) => {
    const { dropdownView, editorView, controller } = setup();
    document.body.appendChild(dropdownView.dom);
    const button = dropdownView.dom.querySelector("button");
    button?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    expect(controller.activeView).toBe(dropdownView);
    expect(button?.getAttribute("aria-haspopup")).toBe("menu");
    expect(button?.getAttribute("aria-expanded")).toBe("true");

    controller.handleEscape();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    dropdownView.destroy();
    dropdownView.dom.remove();
    editorView.destroy();
  });

  it("resolves removed selections to the definition fallback option", () => {
    const { node, dropdownView, editorView } = setup();
    dropdownView.update(
      node.type.create({ ...node.attrs, selectedOptionId: "removed" }),
      []
    );
    expect(dropdownView.selectedOptionId).toBe("design");
    dropdownView.destroy();
    editorView.destroy();
  });
});
