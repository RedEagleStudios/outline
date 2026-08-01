import type { Node } from "prosemirror-model";
import { TableView as ProsemirrorTableView } from "prosemirror-tables";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { TableLayout } from "../types";
import { isBrowser } from "../../utils/browser";

interface TableGeometryMeasurement {
  readonly shadowLeft: boolean;
  readonly shadowRight: boolean;
  readonly height: number;
  readonly width: number;
}

interface TableViewMeasurement extends TableGeometryMeasurement {
  readonly sticky: boolean;
  readonly stickyScrollOffset: number | null;
}

interface StickyHeaderMeasurement {
  readonly sticky: boolean;
  readonly stickyScrollOffset: number | null;
}

export class TableView extends ProsemirrorTableView {
  public constructor(
    public node: Node,
    public cellMinWidth: number
  ) {
    super(node, cellMinWidth);

    this.dom.removeChild(this.table);
    this.dom.classList.add(EditorStyleHelper.table);

    // Add an extra wrapper to enable scrolling
    this.scrollable = this.dom.appendChild(document.createElement("div"));
    this.scrollable.appendChild(this.table);
    this.scrollable.classList.add(EditorStyleHelper.tableScrollable);

    if (isBrowser) {
      this.scrollable.addEventListener("scroll", this.localScrollHandler, {
        passive: true,
      });
    }

    this.updateFullWidthClass();
    this.scheduleInitialUpdate();
  }

  public destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    TableView.removePendingInitialView(this);
    this.scrollable?.removeEventListener("scroll", this.localScrollHandler);
    this.cancelScheduledUpdates();
    this.cleanupStickyHeader();
  }

  public override update(node: Node) {
    const didUpdate = super.update(node);
    if (didUpdate) {
      this.node = node;
      this.updateFullWidthClass();
      this.scheduleClassListUpdate(node);
    }
    return didUpdate;
  }

  public override ignoreMutation(record: MutationRecord): boolean {
    if (
      record.type === "attributes" &&
      record.target === this.dom &&
      (record.attributeName === "class" || record.attributeName === "style")
    ) {
      return true;
    }

    return (
      record.type === "attributes" &&
      (record.target === this.table || this.colgroup.contains(record.target))
    );
  }

  private updateFullWidthClass() {
    if (!isBrowser) {
      return;
    }

    this.dom.classList.toggle(
      EditorStyleHelper.tableFullWidth,
      this.node.attrs.layout === TableLayout.fullWidth
    );
  }

  private measure(headerOffset: number): TableViewMeasurement {
    return {
      ...this.measureTableGeometry(),
      ...this.measureStickyHeader(headerOffset),
    };
  }

  private measureTableGeometry(): TableGeometryMeasurement {
    const scrollLeft = this.scrollable?.scrollLeft ?? 0;
    const scrollWidth = this.scrollable?.scrollWidth ?? 0;
    const clientWidth = this.scrollable?.clientWidth ?? 0;
    const height = this.scrollable?.clientHeight ?? 0;

    return {
      shadowLeft: scrollLeft > 0,
      shadowRight:
        scrollWidth > clientWidth && scrollLeft + clientWidth < scrollWidth - 1,
      height,
      width: clientWidth,
    };
  }

  private applyMeasurement(measurement: TableViewMeasurement) {
    this.applyTableGeometry(measurement);
    this.applyStickyMeasurement(measurement);
  }

  private applyTableGeometry(measurement: TableGeometryMeasurement) {
    this.dom.classList.toggle(
      EditorStyleHelper.tableShadowLeft,
      measurement.shadowLeft
    );
    this.dom.classList.toggle(
      EditorStyleHelper.tableShadowRight,
      measurement.shadowRight
    );
    this.dom.style.setProperty("--table-height", `${measurement.height}px`);
    this.dom.style.setProperty("--table-width", `${measurement.width}px`);
  }

  private scheduleClassListUpdate(node: Node) {
    if (!isBrowser || this.destroyed) {
      return;
    }

    this.node = node;
    if (TableView.pendingInitialViews.has(this)) {
      return;
    }
    if (this.classListAnimationFrame !== null) {
      return;
    }

    this.classListAnimationFrame = requestAnimationFrame(() => {
      this.classListAnimationFrame = null;
      if (!this.destroyed && this.dom) {
        this.applyTableGeometry(this.measureTableGeometry());
      }
    });
  }

  private scrollable: HTMLDivElement | null = null;

  private readonly localScrollHandler = () => {
    this.scheduleClassListUpdate(this.node);
  };

  private scrollHandler: (() => void) | null = null;

  private classListAnimationFrame: number | null = null;

  private stickyHeaderAnimationFrame: number | null = null;

  /** Default height of the app's fixed header */
  private static readonly HEADER_HEIGHT = 60;

  private static pendingInitialViews = new Set<TableView>();

  private static initialAnimationFrame: number | null = null;

  private static flushInitialUpdates = () => {
    TableView.initialAnimationFrame = null;
    const views = Array.from(TableView.pendingInitialViews);
    TableView.pendingInitialViews.clear();
    const liveViews = views.filter((view) => !view.destroyed);

    liveViews.forEach((view) => view.prepareStickyHeader());
    const headerOffset = TableView.getDocumentHeaderOffset();
    const measurements = liveViews.map((view) => ({
      view,
      measurement: view.measure(headerOffset),
    }));

    measurements.forEach(({ view, measurement }) => {
      if (!view.destroyed) {
        view.applyMeasurement(measurement);
      }
    });
  };

  private static getDocumentHeaderOffset(): number {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      "--header-offset"
    );
    return value ? parseFloat(value) : TableView.HEADER_HEIGHT;
  }

  private static removePendingInitialView(view: TableView) {
    TableView.pendingInitialViews.delete(view);
    if (
      TableView.pendingInitialViews.size === 0 &&
      TableView.initialAnimationFrame !== null
    ) {
      cancelAnimationFrame(TableView.initialAnimationFrame);
      TableView.initialAnimationFrame = null;
    }
  }

  private scheduleInitialUpdate() {
    if (!isBrowser || this.destroyed) {
      return;
    }

    TableView.pendingInitialViews.add(this);
    if (TableView.initialAnimationFrame === null) {
      TableView.initialAnimationFrame = requestAnimationFrame(
        TableView.flushInitialUpdates
      );
    }
  }

  private prepareStickyHeader() {
    if (
      this.scrollHandler ||
      this.dom.closest(`table .${EditorStyleHelper.table}`)
    ) {
      return;
    }

    this.scrollHandler = () => {
      this.scheduleStickyHeaderUpdate();
    };
    document.addEventListener("scroll", this.scrollHandler, {
      passive: true,
      capture: true,
    });
  }

  /**
   * Cleans up the scroll listener and resets header styles.
   */
  private cleanupStickyHeader() {
    if (!isBrowser) {
      return;
    }

    if (this.scrollHandler) {
      document.removeEventListener("scroll", this.scrollHandler, {
        capture: true,
      });
      this.scrollHandler = null;
    }

    // Reset sticky header state
    this.dom.classList.remove(EditorStyleHelper.tableStickyHeader);
    this.dom.style.removeProperty("--sticky-scroll-offset");
  }

  private scheduleStickyHeaderUpdate() {
    if (
      !isBrowser ||
      this.destroyed ||
      this.stickyHeaderAnimationFrame !== null
    ) {
      return;
    }

    this.stickyHeaderAnimationFrame = requestAnimationFrame(() => {
      this.stickyHeaderAnimationFrame = null;
      if (!this.destroyed) {
        this.updateStickyHeader();
      }
    });
  }

  private cancelScheduledUpdates() {
    if (!isBrowser) {
      return;
    }

    if (this.classListAnimationFrame !== null) {
      cancelAnimationFrame(this.classListAnimationFrame);
      this.classListAnimationFrame = null;
    }

    if (this.stickyHeaderAnimationFrame !== null) {
      cancelAnimationFrame(this.stickyHeaderAnimationFrame);
      this.stickyHeaderAnimationFrame = null;
    }
  }

  /**
   * Updates the header row transform to create a sticky effect.
   */
  private updateStickyHeader() {
    if (!isBrowser || this.destroyed) {
      return;
    }

    this.applyStickyMeasurement(
      this.measureStickyHeader(this.getHeaderOffset())
    );
  }

  private measureStickyHeader(headerOffset: number): StickyHeaderMeasurement {
    if (!this.scrollHandler) {
      return { sticky: false, stickyScrollOffset: null };
    }

    const headerRow = this.table.querySelector<HTMLElement>("tr");
    if (!headerRow) {
      return { sticky: false, stickyScrollOffset: null };
    }

    const tableRect = this.table.getBoundingClientRect();
    const headerRowHeight = headerRow.getBoundingClientRect().height;
    const sticky =
      tableRect.top < headerOffset &&
      tableRect.bottom > headerOffset + headerRowHeight;

    return {
      sticky,
      stickyScrollOffset: sticky
        ? Math.min(-tableRect.top, tableRect.height - headerRowHeight)
        : null,
    };
  }

  private applyStickyMeasurement(
    measurement: Pick<TableViewMeasurement, "sticky" | "stickyScrollOffset">
  ) {
    if (measurement.sticky && measurement.stickyScrollOffset !== null) {
      this.dom.classList.add(EditorStyleHelper.tableStickyHeader);
      this.dom.style.setProperty(
        "--sticky-scroll-offset",
        `${measurement.stickyScrollOffset}px`
      );
      return;
    }

    this.dom.classList.remove(EditorStyleHelper.tableStickyHeader);
    this.dom.style.removeProperty("--sticky-scroll-offset");
  }

  /**
   * Gets the current header offset from the CSS variable.
   *
   * @returns the offset in pixels from the top of the viewport.
   */
  private getHeaderOffset(): number {
    if (!isBrowser) {
      return TableView.HEADER_HEIGHT;
    }

    return TableView.getDocumentHeaderOffset();
  }

  private destroyed = false;
}
