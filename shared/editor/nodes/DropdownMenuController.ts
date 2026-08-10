import { action, computed, observable } from "mobx";
import type { EditorView } from "prosemirror-view";
import type { DropdownDefinition, DropdownOption } from "../lib/dropdowns";
import type { DropdownView } from "./DropdownView";

/** Owns the single active dropdown menu state for one Dropdown extension. */
export class DropdownMenuController {
  @observable.ref activeView?: DropdownView;
  @observable.ref rect?: DOMRect;
  @observable revision = 0;

  private editorView?: EditorView;
  private menuElement?: HTMLElement;
  private requestWidgetMount?: () => void;
  private widgetMounted = false;
  private readonly views = new Set<DropdownView>();

  /** Returns the active dropdown definition.
   *
   * @returns the active definition, or undefined while closed.
   */
  @computed
  get definition(): DropdownDefinition | undefined {
    const revision = this.revision;
    void revision;
    return this.activeView?.definition;
  }

  /** Returns the active selected option identifier.
   *
   * @returns the selected option identifier, or undefined while closed.
   */
  @computed
  get selectedOptionId(): string | undefined {
    const revision = this.revision;
    void revision;
    return this.activeView?.selectedOptionId;
  }

  /** Attaches the controller to its editor view.
   *
   * @param editorView the owning ProseMirror view.
   * @param requestWidgetMount requests the low-level editor's first widget render.
   * @returns nothing.
   */
  attach(editorView: EditorView, requestWidgetMount?: () => void): void {
    this.editorView = editorView;
    this.requestWidgetMount = requestWidgetMount;
  }

  /** Marks the singleton widget as mounted in the editor React tree.
   *
   * @returns nothing.
   */
  markWidgetMounted = (): void => {
    this.widgetMounted = true;
  };

  /** Marks the singleton widget as absent from the editor React tree.
   *
   * @returns nothing.
   */
  markWidgetUnmounted = (): void => {
    this.widgetMounted = false;
    this.menuElement = undefined;
  };

  /** Registers a native dropdown view.
   *
   * @param view the dropdown view to register.
   * @returns nothing.
   */
  register(view: DropdownView): void {
    this.views.add(view);
  }

  /** Unregisters a native dropdown view.
   *
   * @param view the dropdown view to unregister.
   * @returns nothing.
   */
  unregister(view: DropdownView): void {
    if (this.activeView === view) {
      this.close();
    }
    this.views.delete(view);
  }

  /** Toggles the menu anchored to a dropdown view.
   *
   * @param view the dropdown view used as the active anchor.
   * @returns nothing.
   */
  @action
  toggle(view: DropdownView): void {
    if (!this.editorView?.editable) {
      return;
    }
    if (this.activeView === view) {
      this.close();
      return;
    }
    this.close();
    this.activeView = view;
    view.setExpanded(true);
    const doc = this.editorView.dom.ownerDocument;
    doc.addEventListener("pointerdown", this.handlePointerDown);
    doc.defaultView?.addEventListener(
      "scroll",
      this.handlePositionChange,
      true
    );
    doc.defaultView?.addEventListener("resize", this.handlePositionChange);
    this.updatePosition();
    if (!this.widgetMounted) {
      this.requestWidgetMount?.();
    }
  }

  /** Closes the active menu and optionally restores chip focus.
   *
   * @param restoreFocus whether to restore focus to the active chip.
   * @returns nothing.
   */
  @action
  close(restoreFocus = false): void {
    const activeView = this.activeView;
    const editorView = this.editorView;
    if (!activeView || !editorView) {
      return;
    }
    const doc = editorView.dom.ownerDocument;
    doc.removeEventListener("pointerdown", this.handlePointerDown);
    doc.defaultView?.removeEventListener(
      "scroll",
      this.handlePositionChange,
      true
    );
    doc.defaultView?.removeEventListener("resize", this.handlePositionChange);
    this.activeView = undefined;
    this.rect = undefined;
    this.menuElement = undefined;
    activeView.setExpanded(false);
    if (restoreFocus) {
      activeView.focus();
    }
  }

  /** Records the current portal menu element for outside-pointer detection.
   *
   * @param element the mounted menu wrapper, or null after unmount.
   * @returns nothing.
   */
  setMenuElement = (element: HTMLElement | null): void => {
    this.menuElement = element ?? undefined;
  };

  /** Selects an option through the active native view.
   *
   * @param option the option to select.
   * @returns nothing.
   */
  handleSelect = (option: DropdownOption): void => {
    if (!this.activeView?.select(option)) {
      this.close();
      return;
    }
    this.close();
  };

  /** Handles menu Escape activation and restores chip focus.
   *
   * @returns nothing.
   */
  handleEscape = (): void => this.close(true);

  /** Notifies the singleton widget that its active native view changed.
   *
   * @param view the native view that changed.
   * @returns nothing.
   */
  @action
  notifyViewUpdated(view: DropdownView): void {
    if (this.activeView === view) {
      this.revision += 1;
    }
  }

  /** Refreshes all native views after definition or broad replacement changes.
   *
   * @returns nothing.
   */
  @action
  refreshAll(): void {
    this.views.forEach((view) => view.refresh());
    if (this.activeView && !this.activeView.isCurrent()) {
      this.close();
      return;
    }
    this.updatePosition();
  }

  /** Closes the menu and releases all controller resources.
   *
   * @returns nothing.
   */
  destroy(): void {
    this.close();
    this.views.clear();
    this.editorView = undefined;
    this.requestWidgetMount = undefined;
    this.widgetMounted = false;
  }

  @action
  private updatePosition(): void {
    this.rect = this.activeView?.dom.getBoundingClientRect();
  }

  private handlePositionChange = (): void => this.updatePosition();

  private handlePointerDown = (event: PointerEvent): void => {
    const editorView = this.editorView;
    const target = event.target;
    const ownerWindow = editorView?.dom.ownerDocument.defaultView;
    if (!ownerWindow || !(target instanceof ownerWindow.Node)) {
      return;
    }
    if (
      this.activeView?.dom.contains(target) ||
      this.menuElement?.contains(target)
    ) {
      return;
    }
    this.close();
  };
}
