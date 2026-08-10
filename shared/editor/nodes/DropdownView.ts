import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Decoration, EditorView, NodeView } from "prosemirror-view";
import {
  getDropdownDefinition,
  getSelectedDropdownOption,
} from "../lib/dropdowns";
import type { DropdownDefinition, DropdownOption } from "../lib/dropdowns";
import type { DropdownMenuController } from "./DropdownMenuController";

interface DecorationWithAttrs extends Decoration {
  type: {
    attrs?: {
      class?: string;
    };
  };
}

/** Native dropdown chip NodeView with no per-node React lifecycle. */
export class DropdownView implements NodeView {
  readonly dom: HTMLSpanElement;

  private readonly button: HTMLButtonElement;
  private readonly caret: HTMLSpanElement;
  private node: ProsemirrorNode;
  private destroyed = false;

  constructor(
    node: ProsemirrorNode,
    private readonly editorView: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly controller: DropdownMenuController,
    decorations: readonly Decoration[] = []
  ) {
    this.node = node;
    const doc = editorView.dom.ownerDocument;
    this.dom = doc.createElement("span");
    this.dom.contentEditable = "false";
    this.button = doc.createElement("button");
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.setAttribute("aria-expanded", "false");
    this.caret = doc.createElement("span");
    this.caret.textContent = "▾";
    this.caret.setAttribute("aria-hidden", "true");
    this.dom.appendChild(this.button);
    this.button.addEventListener("mousedown", this.handleMouseDown);
    this.button.addEventListener("click", this.handleClick);
    this.button.addEventListener("keydown", this.handleKeyDown);
    this.controller.register(this);
    this.updateDecorations(decorations);
    this.refresh();
  }

  /** Returns the current document definition for this chip.
   *
   * @returns the current dropdown definition.
   */
  get definition(): DropdownDefinition {
    return getDropdownDefinition(this.editorView.state.doc, this.node.attrs);
  }

  /** Returns the selected option identifier.
   *
   * @returns the selected option identifier.
   */
  get selectedOptionId(): string {
    return getSelectedDropdownOption(
      this.definition,
      this.node.attrs.selectedOptionId
    ).id;
  }

  /** Returns the stable document identity for this chip.
   *
   * @returns the dropdown node identifier.
   */
  get id(): string {
    return this.node.attrs.id;
  }

  /** Updates this view when ProseMirror preserves node identity.
   *
   * @param node the replacement ProseMirror node.
   * @param decorations the current node decorations.
   * @returns true when this view can represent the replacement node.
   */
  update(node: ProsemirrorNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type || node.attrs.id !== this.node.attrs.id) {
      return false;
    }
    this.node = node;
    this.updateDecorations(decorations);
    this.refresh();
    return true;
  }

  /** Refreshes label, color and editability from live editor state.
   *
   * @returns nothing.
   */
  refresh() {
    if (this.destroyed) {
      return;
    }
    const selected = getSelectedDropdownOption(
      this.definition,
      this.node.attrs.selectedOptionId
    );
    this.button.textContent = selected.label;
    this.button.style.backgroundColor = selected.color;
    this.dom.dataset.id = this.node.attrs.id;
    this.dom.dataset.dropdownId = this.node.attrs.dropdownId;
    this.dom.dataset.selectedOptionId = this.node.attrs.selectedOptionId;
    this.button.disabled = !this.editorView.editable;
    if (this.editorView.editable) {
      this.button.appendChild(this.caret);
    } else {
      this.caret.remove();
      this.controller.close();
    }
    this.controller.notifyViewUpdated(this);
  }

  /** Reports whether getPos still resolves to this dropdown identity.
   *
   * @returns true when the document contains the same dropdown.
   */
  isCurrent() {
    const pos = this.getPos();
    if (pos === undefined) {
      return false;
    }
    const current = this.editorView.state.doc.nodeAt(pos);
    return (
      current?.type === this.node.type &&
      current.attrs.id === this.node.attrs.id
    );
  }

  /** Dispatches the exact selected-option attribute transaction when current.
   *
   * @param option the option to select.
   * @returns true when the transaction was dispatched.
   */
  select(option: DropdownOption) {
    const pos = this.getPos();
    if (pos === undefined || !this.isCurrent()) {
      return false;
    }
    this.editorView.dispatch(
      this.editorView.state.tr.setNodeAttribute(
        pos,
        "selectedOptionId",
        option.id
      )
    );
    this.editorView.focus();
    return true;
  }

  /** Updates the chip's expanded ARIA state.
   *
   * @param expanded whether the menu is expanded.
   * @returns nothing.
   */
  setExpanded(expanded: boolean) {
    this.button.setAttribute("aria-expanded", String(expanded));
  }

  /** Focuses the native chip button.
   *
   * @returns nothing.
   */
  focus() {
    this.button.focus();
  }

  /** Prevents ProseMirror from interpreting native chip DOM mutations.
   *
   * @returns true for every native chip mutation.
   */
  ignoreMutation() {
    return true;
  }

  /** Keeps chip activation events out of ProseMirror handling.
   *
   * @param event the DOM event being considered.
   * @returns true when the event originated from the button.
   */
  stopEvent(event: Event) {
    const ownerWindow = this.dom.ownerDocument.defaultView;
    return (
      event.target === this.button ||
      (!!ownerWindow &&
        event.target instanceof ownerWindow.Node &&
        this.button.contains(event.target))
    );
  }

  /** Removes listeners and controller registration exactly once.
   *
   * @returns nothing.
   */
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.button.removeEventListener("mousedown", this.handleMouseDown);
    this.button.removeEventListener("click", this.handleClick);
    this.button.removeEventListener("keydown", this.handleKeyDown);
    this.controller.unregister(this);
  }

  private updateDecorations(decorations: readonly Decoration[]) {
    const classes = decorations
      .map(
        (decoration) => (decoration as DecorationWithAttrs).type.attrs?.class
      )
      .filter((value): value is string => typeof value === "string");
    this.dom.className = ["component-dropdown", "dropdown", ...classes].join(
      " "
    );
  }

  private handleMouseDown = (event: MouseEvent) => event.preventDefault();

  private handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.editorView.editable) {
      this.controller.toggle(this);
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.editorView.editable) {
      this.controller.toggle(this);
    }
  };
}
