import type {
  ViewportResourceBudgetMetric,
  ViewportResourceBudgetObserver,
  ViewportResourceBudgetSnapshot,
} from "./viewportResourceBudget";

/** Immutable aggregate metrics for one enabled editor lifetime. */
export interface ViewportResourceMetricsSummary {
  readonly documentSize: number;
  readonly membersRegistered: number;
  readonly leaseGrants: number;
  readonly pressureEvictionRequests: number;
  readonly leaseReleases: number;
  readonly pins: number;
  readonly gatedIframeEntries: number;
  readonly gatedIframeExits: number;
  readonly maxFrameCandidates: number;
  readonly maxLeased: number;
  readonly maxQueued: number;
  readonly maxPinned: number;
  readonly maxGatedIframes: number;
}

/** Collects analytics-neutral viewport resource metrics for one editor lifetime. */
export class ViewportResourceMetricsCollector {
  /** Observer passed to the viewport resource budget. */
  public readonly budgetObserver: ViewportResourceBudgetObserver = {
    onEvent: (metric, snapshot) => this.recordBudgetEvent(metric, snapshot),
  };

  /**
   * Records the current ProseMirror document content size.
   *
   * @param size - current document content size.
   * @returns nothing.
   */
  public observeDocumentSize(size: number): void {
    if (this.finished) {
      return;
    }
    this.documentSize = Math.max(0, size);
  }

  /** Records registration of one gated Frame candidate. */
  public recordFrameRegistered(): void {
    if (this.finished) {
      return;
    }
    this.frameCandidates += 1;
    this.maxFrameCandidates = Math.max(
      this.maxFrameCandidates,
      this.frameCandidates
    );
  }

  /** Records removal of one gated Frame candidate. */
  public recordFrameUnregistered(): void {
    if (this.finished) {
      return;
    }
    this.frameCandidates = Math.max(0, this.frameCandidates - 1);
  }

  /** Records entry of one iframe into the gated metrics scope. */
  public recordGatedIframeEntered(): void {
    if (this.finished) {
      return;
    }
    this.mounted += 1;
    this.gatedIframeEntries += 1;
    this.maxGatedIframes = Math.max(this.maxGatedIframes, this.mounted);
  }

  /** Records exit of one iframe from the gated metrics scope. */
  public recordGatedIframeExited(): void {
    if (this.finished) {
      return;
    }
    if (this.mounted === 0) {
      return;
    }
    this.mounted -= 1;
    this.gatedIframeExits += 1;
  }

  /** Returns the immutable final summary once. */
  public finish(): ViewportResourceMetricsSummary | undefined {
    if (this.finished) {
      return undefined;
    }
    this.finished = true;
    return Object.freeze({
      documentSize: this.documentSize,
      membersRegistered: this.membersRegistered,
      leaseGrants: this.leaseGrants,
      pressureEvictionRequests: this.pressureEvictionRequests,
      leaseReleases: this.leaseReleases,
      pins: this.pins,
      gatedIframeEntries: this.gatedIframeEntries,
      gatedIframeExits: this.gatedIframeExits,
      maxFrameCandidates: this.maxFrameCandidates,
      maxLeased: this.maxLeased,
      maxQueued: this.maxQueued,
      maxPinned: this.maxPinned,
      maxGatedIframes: this.maxGatedIframes,
    });
  }

  private documentSize = 0;
  private membersRegistered = 0;
  private leaseGrants = 0;
  private pressureEvictionRequests = 0;
  private leaseReleases = 0;
  private pins = 0;
  private gatedIframeEntries = 0;
  private gatedIframeExits = 0;
  private frameCandidates = 0;
  private mounted = 0;
  private maxFrameCandidates = 0;
  private maxLeased = 0;
  private maxQueued = 0;
  private maxPinned = 0;
  private maxGatedIframes = 0;
  private finished = false;

  private recordBudgetEvent(
    metric: ViewportResourceBudgetMetric,
    snapshot: ViewportResourceBudgetSnapshot
  ): void {
    if (this.finished) {
      return;
    }
    if (metric === "memberRegistered") {
      this.membersRegistered += 1;
    } else if (metric === "leaseGranted") {
      this.leaseGrants += 1;
    } else if (metric === "pressureEvictionRequested") {
      this.pressureEvictionRequests += 1;
    } else if (metric === "leaseReleased") {
      this.leaseReleases += 1;
    } else if (metric === "pinned") {
      this.pins += 1;
    }
    this.maxLeased = Math.max(this.maxLeased, snapshot.leased);
    this.maxQueued = Math.max(this.maxQueued, snapshot.queued);
    this.maxPinned = Math.max(this.maxPinned, snapshot.pinned);
  }
}
