import { registerViewportObserver } from "../components/hooks/viewportObserverRegistry";
import type { ViewportObserverSubscription } from "../components/hooks/viewportObserverRegistry";

/** Measurements collected for one managed table. */
export interface TableMeasurement {
  readonly shadowLeft: boolean;
  readonly shadowRight: boolean;
  readonly height: number;
  readonly width: number;
  readonly sticky: boolean;
  readonly stickyScrollOffset: number | null;
}

/** A table registered with the document measurement coordinator. */
export interface CoordinatedTable {
  readonly dom: HTMLElement;
  readonly readMeasurement: (
    headerOffset: number,
    includeSticky: boolean
  ) => TableMeasurement;
  readonly writeMeasurement: (measurement: TableMeasurement) => void;
  readonly resetSticky: () => void;
  readonly setRenderingContainment: (managed: boolean) => void;
}

/** Handle for a table registered with the document measurement coordinator. */
export interface TableMeasurementRegistration {
  /** Requests a measurement caused by local horizontal scrolling. */
  notifyLocalScroll: () => void;
  /** Permanently removes the table from coordination. */
  unregister: () => void;
}

interface EntryState {
  table: CoordinatedTable;
  subscription: ViewportObserverSubscription | undefined;
  near: boolean;
  stickyEligible: boolean;
  active: boolean;
}

const coordinators = new WeakMap<Document, TableMeasurementCoordinator>();

class TableMeasurementCoordinator {
  public constructor(private readonly document: Document) {
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  public register(table: CoordinatedTable): TableMeasurementRegistration {
    const state: EntryState = {
      table,
      subscription: undefined,
      near: false,
      stickyEligible: false,
      active: true,
    };
    this.entries.add(state);
    this.pendingRegistration.add(state);
    this.scheduleFrame();

    return {
      notifyLocalScroll: () => {
        if (state.active && state.near) {
          this.enqueue(state);
        }
      },
      unregister: () => this.unregister(state),
    };
  }

  private readonly entries = new Set<EntryState>();
  private readonly pendingRegistration = new Set<EntryState>();
  private readonly queued = new Set<EntryState>();
  private frame: number | undefined;
  private listeningForScroll = false;

  private scheduleFrame() {
    if (
      this.frame !== undefined ||
      this.document.visibilityState === "hidden"
    ) {
      return;
    }
    this.frame = this.document.defaultView?.requestAnimationFrame(this.flush);
  }

  private readonly flush = () => {
    this.frame = undefined;
    if (this.document.visibilityState === "hidden") {
      this.queued.clear();
      return;
    }

    const registrations = [...this.pendingRegistration];
    this.pendingRegistration.clear();
    registrations.forEach((state) => this.observeIfEligible(state));

    const targets = [...this.queued].filter(
      (state) => state.active && state.near
    );
    this.queued.clear();
    if (!targets.length) {
      return;
    }
    const headerOffset = this.getHeaderOffset();
    const measurements = targets.map((state) => ({
      state,
      measurement: state.table.readMeasurement(
        headerOffset,
        state.stickyEligible
      ),
    }));
    measurements.forEach(({ state, measurement }) => {
      if (state.active && state.near) {
        state.table.writeMeasurement(measurement);
      }
    });
  };

  private observeIfEligible(state: EntryState) {
    if (!state.active) {
      return;
    }
    if (!state.table.dom.isConnected) {
      state.table.setRenderingContainment(false);
      return;
    }
    state.stickyEligible = !state.table.dom.parentElement?.closest("table");

    state.subscription = registerViewportObserver(
      state.table.dom,
      (entry) => this.setNear(state, entry.isIntersecting),
      { rootMargin: "1000px 0px" }
    );
    state.table.setRenderingContainment(
      state.stickyEligible && Boolean(state.subscription)
    );
    if (!state.subscription) {
      this.setNear(state, true);
    }
  }

  private setNear(state: EntryState, near: boolean) {
    if (!state.active) {
      return;
    }
    state.near = near;
    if (near) {
      this.enqueue(state);
    } else {
      this.queued.delete(state);
      state.table.resetSticky();
    }
    this.updateScrollListener();
  }

  private enqueue(state: EntryState) {
    this.queued.add(state);
    this.scheduleFrame();
  }

  private readonly handleScroll = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      [...this.entries].some((state) => state.table.dom.contains(target))
    ) {
      return;
    }
    this.entries.forEach((state) => {
      if (state.near && state.stickyEligible) {
        this.queued.add(state);
      }
    });
    this.scheduleFrame();
  };

  private readonly handleVisibilityChange = () => {
    if (this.document.visibilityState === "hidden") {
      if (this.frame !== undefined) {
        this.document.defaultView?.cancelAnimationFrame(this.frame);
        this.frame = undefined;
      }
      this.queued.clear();
      this.entries.forEach((state) => state.table.resetSticky());
      return;
    }

    this.queued.clear();
    this.entries.forEach((state) => {
      state.near = false;
      state.table.resetSticky();
      state.subscription?.unsubscribe();
      state.subscription = undefined;
      this.pendingRegistration.add(state);
    });
    this.updateScrollListener();
    this.scheduleFrame();
  };

  private updateScrollListener() {
    const shouldListen = [...this.entries].some(
      (state) => state.active && state.near && state.stickyEligible
    );
    if (shouldListen === this.listeningForScroll) {
      return;
    }
    this.listeningForScroll = shouldListen;
    if (shouldListen) {
      this.document.addEventListener("scroll", this.handleScroll, {
        passive: true,
        capture: true,
      });
    } else {
      this.document.removeEventListener("scroll", this.handleScroll, {
        capture: true,
      });
    }
  }

  private unregister(state: EntryState) {
    if (!state.active) {
      return;
    }
    state.active = false;
    state.subscription?.unsubscribe();
    state.table.setRenderingContainment(false);
    this.entries.delete(state);
    this.pendingRegistration.delete(state);
    this.queued.delete(state);
    state.table.resetSticky();
    this.updateScrollListener();
    if (
      this.frame !== undefined &&
      this.pendingRegistration.size === 0 &&
      this.queued.size === 0
    ) {
      this.document.defaultView?.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    if (this.entries.size) {
      return;
    }
    this.document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );
    coordinators.delete(this.document);
  }

  private getHeaderOffset(): number {
    const value = this.document.defaultView
      ?.getComputedStyle(this.document.documentElement)
      .getPropertyValue("--header-offset");
    return value ? parseFloat(value) : 60;
  }
}

/**
 * Registers a table with the single measurement coordinator for its document.
 *
 * @param table - table DOM and measurement operations.
 * @returns a registration used for local notifications and teardown.
 */
export function registerTableMeasurement(
  table: CoordinatedTable
): TableMeasurementRegistration {
  const document = table.dom.ownerDocument;
  let coordinator = coordinators.get(document);
  if (!coordinator) {
    coordinator = new TableMeasurementCoordinator(document);
    coordinators.set(document, coordinator);
  }
  return coordinator.register(table);
}
