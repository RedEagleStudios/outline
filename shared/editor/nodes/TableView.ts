import type { Node } from "prosemirror-model";
import { TableView as ProsemirrorTableView } from "prosemirror-tables";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { TableLayout } from "../types";
import { isBrowser } from "../../utils/browser";
import { registerTableMeasurement } from "./TableMeasurementCoordinator";
import type {
  TableMeasurement,
  TableMeasurementRegistration,
} from "./TableMeasurementCoordinator";

interface TableGeometryMeasurement {
  readonly shadowLeft: boolean;
  readonly shadowRight: boolean;
  readonly height: number;
  readonly width: number;
}

interface TableViewMeasurement
  extends TableGeometryMeasurement, TableMeasurement {}

interface StickyHeaderMeasurement {
  readonly sticky: boolean;
  readonly stickyScrollOffset: number | null;
}

const estimatedTableFrameHeight = 17;
const estimatedTableRowHeight = 33;

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
    if (isBrowser) {
      this.measurementRegistration = registerTableMeasurement({
        dom: this.dom,
        readMeasurement: (headerOffset, includeSticky) =>
          this.measure(headerOffset, includeSticky),
        writeMeasurement: (measurement) => this.applyMeasurement(measurement),
        resetSticky: () => this.cleanupStickyHeader(),
        setRenderingContainment: (managed) =>
          this.setRenderingContainment(managed),
      });
    }
  }

  public destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.scrollable?.removeEventListener("scroll", this.localScrollHandler);
    this.measurementRegistration?.unregister();
    this.cleanupStickyHeader();
  }

  public override update(node: Node) {
    const didUpdate = super.update(node);
    if (didUpdate) {
      this.node = node;
      this.updateFullWidthClass();
      this.updateRenderingContainment();
      this.measurementRegistration?.notifyLocalScroll();
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

  private setRenderingContainment(managed: boolean) {
    this.renderingContainmentEligible = managed;
    this.updateRenderingContainment();
  }

  private updateRenderingContainment() {
    const css = this.dom.ownerDocument.defaultView?.CSS;
    const supported =
      css?.supports("content-visibility", "auto") === true &&
      css.supports("contain-intrinsic-block-size", "auto 100px");
    const shouldManage =
      this.renderingContainmentEligible &&
      this.node.attrs.layout !== TableLayout.fullWidth &&
      supported;

    if (shouldManage) {
      this.dom.classList.add(EditorStyleHelper.tableContentVisibility);
      this.updateIntrinsicBlockSize();
      return;
    }

    if (
      !this.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ) {
      return;
    }

    this.dom.classList.remove(EditorStyleHelper.tableContentVisibility);
    this.dom.style.removeProperty("--table-intrinsic-block-size");
  }

  private updateIntrinsicBlockSize() {
    if (
      !this.dom.classList.contains(EditorStyleHelper.tableContentVisibility)
    ) {
      return;
    }

    const estimate =
      estimatedTableFrameHeight +
      Math.max(1, this.node.childCount) * estimatedTableRowHeight;
    this.dom.style.setProperty("--table-intrinsic-block-size", `${estimate}px`);
  }

  private measure(
    headerOffset: number,
    includeSticky: boolean
  ): TableViewMeasurement {
    return {
      ...this.measureTableGeometry(),
      ...(includeSticky
        ? this.measureStickyHeader(headerOffset)
        : { sticky: false, stickyScrollOffset: null }),
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

  private scrollable: HTMLDivElement | null = null;

  private readonly localScrollHandler = () => {
    this.measurementRegistration?.notifyLocalScroll();
  };

  private measurementRegistration: TableMeasurementRegistration | undefined;

  private renderingContainmentEligible = false;

  /**
   * Cleans up the scroll listener and resets header styles.
   */
  private cleanupStickyHeader() {
    if (!isBrowser) {
      return;
    }

    // Reset sticky header state
    this.dom.classList.remove(EditorStyleHelper.tableStickyHeader);
    this.dom.style.removeProperty("--sticky-scroll-offset");
  }

  private measureStickyHeader(headerOffset: number): StickyHeaderMeasurement {
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

  private destroyed = false;
}
