/** Callbacks used by a viewport resource budget member. */
export interface ViewportResourceBudgetCallbacks {
  /** Called after the member has synchronously acquired a lease. */
  onLeaseGranted: () => void;
  /** Called when the member should confirm whether it may release its lease. */
  onEarlyEvictionRequested: () => void;
  /** Called when a pending early-eviction request is no longer needed. */
  onEarlyEvictionCancelled: () => void;
}

/** Read-only diagnostic counts for a viewport resource budget. */
export interface ViewportResourceBudgetSnapshot {
  /** Maximum number of unpinned leases. */
  readonly capacity: number;
  /** Number of active and cooling leases. */
  readonly leased: number;
  /** Number of active leases. */
  readonly active: number;
  /** Number of cooling leases. */
  readonly cooling: number;
  /** Number of members waiting for leases. */
  readonly queued: number;
  /** Number of pinned members. */
  readonly pinned: number;
}

/** A state mutation reported by a viewport resource budget. */
export type ViewportResourceBudgetMetric =
  | "memberRegistered"
  | "leaseRequested"
  | "leaseGranted"
  | "pressureEvictionRequested"
  | "leaseReleased"
  | "pinned";

/** Analytics-neutral observer for viewport resource budget mutations. */
export interface ViewportResourceBudgetObserver {
  /** Receives a metric and a state-after-mutation snapshot. */
  onEvent: (
    metric: ViewportResourceBudgetMetric,
    snapshot: ViewportResourceBudgetSnapshot
  ) => void;
}

/** Handle for one member of a viewport resource budget. */
export interface ViewportResourceBudgetMember {
  /** Requests a lease, granting it synchronously when capacity is available. */
  requestLease: () => void;
  /** Cancels this member's queued lease request. */
  cancelLeaseRequest: () => void;
  /** Marks this lease active and therefore ineligible for early eviction. */
  markActive: () => void;
  /** Marks this lease cooling and places it at the newest end of the LRU. */
  markCooling: () => void;
  /** Releases this member's lease. */
  releaseLease: () => void;
  /** Removes this member from budgeting and tracks it as pinned. */
  pin: () => void;
  /** Permanently removes this member from the budget. */
  unregister: () => void;
}

interface MemberState {
  callbacks: ViewportResourceBudgetCallbacks;
  registered: boolean;
  queued: boolean;
  pinned: boolean;
  lease: "none" | "active" | "cooling";
  leaseVersion: number;
  coolingOrder: number;
  evictionRequested: boolean;
  evictionVersion: number;
}

interface LeaseGrantedDelivery {
  kind: "leaseGranted";
  member: MemberState;
  version: number;
}

interface EvictionRequestedDelivery {
  kind: "evictionRequested";
  member: MemberState;
  version: number;
}

interface EvictionCancelledDelivery {
  kind: "evictionCancelled";
  member: MemberState;
  version: number;
}

type CallbackDelivery =
  | LeaseGrantedDelivery
  | EvictionRequestedDelivery
  | EvictionCancelledDelivery;

/**
 * Coordinates a hard upper bound on unpinned viewport resource leases.
 *
 * @param capacity - maximum simultaneous unpinned leases; must be a
 * positive integer.
 * @throws RangeError when capacity is not a positive integer.
 */
export class ViewportResourceBudget {
  /** Default maximum number of simultaneous unpinned leases. */
  public static readonly defaultCapacity = 8;

  /** Maximum number of simultaneous unpinned leases. */
  public readonly capacity: number;

  public constructor(
    capacity = ViewportResourceBudget.defaultCapacity,
    observer?: ViewportResourceBudgetObserver
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        "Viewport resource capacity must be a positive integer"
      );
    }
    this.capacity = capacity;
    this.observer = observer;
  }

  /**
   * Registers one independently controlled budget member.
   *
   * @param callbacks - lifecycle callbacks for lease and eviction changes.
   * @returns a stable member handle.
   */
  public register(
    callbacks: ViewportResourceBudgetCallbacks
  ): ViewportResourceBudgetMember {
    return this.mutate(() => this.registerMember(callbacks));
  }

  private registerMember(
    callbacks: ViewportResourceBudgetCallbacks
  ): ViewportResourceBudgetMember {
    const member: MemberState = {
      callbacks,
      registered: !this.destroyed,
      queued: false,
      pinned: false,
      lease: "none",
      leaseVersion: 0,
      coolingOrder: 0,
      evictionRequested: false,
      evictionVersion: 0,
    };
    if (!this.destroyed) {
      this.members.add(member);
      this.report("memberRegistered");
    }
    return {
      requestLease: () => this.mutate(() => this.requestLease(member)),
      cancelLeaseRequest: () =>
        this.mutate(() => this.cancelLeaseRequest(member)),
      markActive: () => this.mutate(() => this.markActive(member)),
      markCooling: () => this.mutate(() => this.markCooling(member)),
      releaseLease: () => this.mutate(() => this.releaseLease(member)),
      pin: () => this.mutate(() => this.pin(member)),
      unregister: () => this.mutate(() => this.unregister(member)),
    };
  }

  /**
   * Returns current budget diagnostics.
   *
   * @returns immutable count values captured at call time.
   */
  public getSnapshot(): ViewportResourceBudgetSnapshot {
    let active = 0;
    let cooling = 0;
    let pinned = 0;
    for (const member of this.members) {
      active += member.lease === "active" ? 1 : 0;
      cooling += member.lease === "cooling" ? 1 : 0;
      pinned += member.pinned ? 1 : 0;
    }
    return {
      capacity: this.capacity,
      leased: active + cooling,
      active,
      cooling,
      queued: this.queue.length,
      pinned,
    };
  }

  /** Cancels all eviction work and permanently disables this budget. */
  public destroy(): void {
    this.mutate(() => this.destroyBudget());
  }

  private destroyBudget(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const deliveries: CallbackDelivery[] = [];
    for (const member of this.members) {
      const hadLease = member.lease !== "none";
      if (member.evictionRequested) {
        member.evictionRequested = false;
        member.evictionVersion += 1;
        deliveries.push({
          kind: "evictionCancelled",
          member,
          version: member.evictionVersion,
        });
      }
      member.registered = false;
      member.queued = false;
      member.pinned = false;
      member.lease = "none";
      member.leaseVersion += 1;
      if (hadLease) {
        this.report("leaseReleased");
      }
    }
    this.queue = [];
    this.members.clear();
    this.deliverCallbacks(deliveries);
  }

  private members = new Set<MemberState>();
  private queue: MemberState[] = [];
  private coolingSequence = 0;
  private destroyed = false;
  private observer?: ViewportResourceBudgetObserver;
  private mutationDepth = 0;
  private deliveringMetrics = false;
  private pendingMetrics: Array<{
    metric: ViewportResourceBudgetMetric;
    snapshot: ViewportResourceBudgetSnapshot;
  }> = [];

  private requestLease(member: MemberState) {
    if (
      !member.registered ||
      member.pinned ||
      member.queued ||
      member.lease !== "none"
    ) {
      return;
    }
    member.queued = true;
    this.queue.push(member);
    this.report("leaseRequested");
    this.reconcileAndDeliver();
  }

  private cancelLeaseRequest(member: MemberState) {
    if (!member.registered || !member.queued) {
      return;
    }
    member.queued = false;
    this.queue = this.queue.filter((candidate) => candidate !== member);
    this.reconcileAndDeliver();
  }

  private markActive(member: MemberState) {
    if (!member.registered || member.lease === "none") {
      return;
    }
    const deliveries: CallbackDelivery[] = [];
    if (member.evictionRequested) {
      member.evictionRequested = false;
      member.evictionVersion += 1;
      deliveries.push({
        kind: "evictionCancelled",
        member,
        version: member.evictionVersion,
      });
    }
    member.lease = "active";
    this.reconcileAndDeliver(deliveries);
  }

  private markCooling(member: MemberState) {
    if (!member.registered || member.lease === "none") {
      return;
    }
    if (member.lease !== "cooling") {
      member.lease = "cooling";
      member.coolingOrder = ++this.coolingSequence;
    }
    this.reconcileAndDeliver();
  }

  private releaseLease(member: MemberState) {
    if (!member.registered || member.lease === "none") {
      return;
    }
    member.lease = "none";
    member.leaseVersion += 1;
    member.evictionRequested = false;
    this.report("leaseReleased");
    this.reconcileAndDeliver();
  }

  private pin(member: MemberState) {
    if (!member.registered || member.pinned) {
      return;
    }
    const deliveries: CallbackDelivery[] = [];
    if (member.evictionRequested) {
      member.evictionRequested = false;
      member.evictionVersion += 1;
      deliveries.push({
        kind: "evictionCancelled",
        member,
        version: member.evictionVersion,
      });
    }
    const hadLease = member.lease !== "none";
    member.pinned = true;
    if (member.queued) {
      member.queued = false;
      this.queue = this.queue.filter((candidate) => candidate !== member);
    }
    member.lease = "none";
    member.leaseVersion += 1;
    if (hadLease) {
      this.report("leaseReleased");
    }
    this.report("pinned");
    this.reconcileAndDeliver(deliveries);
  }

  private unregister(member: MemberState) {
    if (!member.registered) {
      return;
    }
    const deliveries: CallbackDelivery[] = [];
    if (member.evictionRequested) {
      member.evictionRequested = false;
      member.evictionVersion += 1;
      deliveries.push({
        kind: "evictionCancelled",
        member,
        version: member.evictionVersion,
      });
    }
    const hadLease = member.lease !== "none";
    member.registered = false;
    member.queued = false;
    member.pinned = false;
    member.lease = "none";
    member.leaseVersion += 1;
    this.members.delete(member);
    this.queue = this.queue.filter((candidate) => candidate !== member);
    if (hadLease) {
      this.report("leaseReleased");
    }
    this.reconcileAndDeliver(deliveries);
  }

  private reconcileAndDeliver(deliveries: CallbackDelivery[] = []) {
    while (this.leasedCount < this.capacity && this.queue.length > 0) {
      const member = this.queue.shift();
      if (!member || !member.registered || !member.queued || member.pinned) {
        continue;
      }
      member.queued = false;
      member.lease = "active";
      member.leaseVersion += 1;
      this.report("leaseGranted");
      deliveries.push({
        kind: "leaseGranted",
        member,
        version: member.leaseVersion,
      });
    }

    const cooling = [...this.members]
      .filter((member) => member.lease === "cooling")
      .sort((left, right) => left.coolingOrder - right.coolingOrder);
    const victims = new Set(
      cooling.slice(0, Math.min(this.queue.length, cooling.length))
    );
    for (const member of cooling) {
      if (member.evictionRequested && !victims.has(member)) {
        member.evictionRequested = false;
        member.evictionVersion += 1;
        deliveries.push({
          kind: "evictionCancelled",
          member,
          version: member.evictionVersion,
        });
      }
    }
    for (const member of cooling) {
      if (victims.has(member) && !member.evictionRequested) {
        member.evictionRequested = true;
        member.evictionVersion += 1;
        this.report("pressureEvictionRequested");
        deliveries.push({
          kind: "evictionRequested",
          member,
          version: member.evictionVersion,
        });
      }
    }
    this.deliverCallbacks(deliveries);
  }

  private deliverCallbacks(deliveries: CallbackDelivery[]) {
    const errors: Error[] = [];
    for (const delivery of deliveries) {
      const { member, version } = delivery;
      let callback: (() => void) | undefined;
      if (
        delivery.kind === "leaseGranted" &&
        member.registered &&
        member.lease !== "none" &&
        member.leaseVersion === version
      ) {
        callback = member.callbacks.onLeaseGranted;
      } else if (
        delivery.kind === "evictionRequested" &&
        member.registered &&
        member.evictionRequested &&
        member.evictionVersion === version
      ) {
        callback = member.callbacks.onEarlyEvictionRequested;
      } else if (
        delivery.kind === "evictionCancelled" &&
        !member.evictionRequested &&
        member.evictionVersion === version
      ) {
        callback = member.callbacks.onEarlyEvictionCancelled;
      }
      if (!callback) {
        continue;
      }
      try {
        callback();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private get leasedCount() {
    let count = 0;
    for (const member of this.members) {
      count += member.lease === "none" ? 0 : 1;
    }
    return count;
  }

  private report(metric: ViewportResourceBudgetMetric): void {
    if (!this.observer) {
      return;
    }
    this.pendingMetrics.push({ metric, snapshot: this.getSnapshot() });
  }

  private mutate<Result>(operation: () => Result): Result {
    this.mutationDepth += 1;
    try {
      return operation();
    } finally {
      this.mutationDepth -= 1;
      this.flushMetrics();
    }
  }

  private flushMetrics(): void {
    if (this.mutationDepth !== 0 || this.deliveringMetrics || !this.observer) {
      return;
    }
    this.deliveringMetrics = true;
    try {
      while (this.pendingMetrics.length > 0) {
        const record = this.pendingMetrics.shift();
        if (!record) {
          continue;
        }
        try {
          this.observer.onEvent(record.metric, record.snapshot);
        } catch (_error) {
          // Metrics are best-effort and must not affect budget behavior.
        }
      }
    } finally {
      this.deliveringMetrics = false;
    }
  }
}
