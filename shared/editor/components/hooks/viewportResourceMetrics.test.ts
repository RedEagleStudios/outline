import {
  ViewportResourceBudget,
  type ViewportResourceBudgetMember,
} from "./viewportResourceBudget";
import { ViewportResourceMetricsCollector } from "./viewportResourceMetrics";

describe("ViewportResourceMetricsCollector", () => {
  it("aggregates counters, peaks, document size, and finishes once", () => {
    const collector = new ViewportResourceMetricsCollector();
    const budget = new ViewportResourceBudget(1, collector.budgetObserver);
    const callbacks = {
      onLeaseGranted: jest.fn(),
      onEarlyEvictionRequested: jest.fn(),
      onEarlyEvictionCancelled: jest.fn(),
    };
    const first = budget.register(callbacks);
    const second = budget.register(callbacks);
    first.requestLease();
    first.markCooling();
    second.requestLease();
    first.releaseLease();
    second.pin();
    collector.observeDocumentSize(42);
    collector.recordFrameRegistered();
    collector.recordFrameRegistered();
    collector.recordFrameUnregistered();
    collector.recordFrameUnregistered();
    collector.recordFrameUnregistered();
    collector.recordGatedIframeEntered();
    collector.recordGatedIframeExited();
    collector.recordGatedIframeExited();

    expect(collector.finish()).toEqual({
      documentSize: 42,
      membersRegistered: 2,
      leaseGrants: 2,
      pressureEvictionRequests: 1,
      leaseReleases: 2,
      pins: 1,
      gatedIframeEntries: 1,
      gatedIframeExits: 1,
      maxFrameCandidates: 2,
      maxLeased: 1,
      maxQueued: 1,
      maxPinned: 1,
      maxGatedIframes: 1,
    });
    expect(collector.finish()).toBeUndefined();
    collector.observeDocumentSize(1000);
    collector.recordFrameRegistered();
    collector.recordGatedIframeEntered();
    budget.register(callbacks).requestLease();
    expect(collector.finish()).toBeUndefined();
  });

  it("isolates observer exceptions from budget callbacks", () => {
    const onLeaseGranted = jest.fn();
    const budget = new ViewportResourceBudget(1, {
      onEvent: () => {
        throw new Error("metrics failed");
      },
    });
    budget
      .register({
        onLeaseGranted,
        onEarlyEvictionRequested: jest.fn(),
        onEarlyEvictionCancelled: jest.fn(),
      })
      .requestLease();
    expect(onLeaseGranted).toHaveBeenCalledTimes(1);
  });

  it("captures the exact queue peak with multiple waiters", () => {
    const collector = new ViewportResourceMetricsCollector();
    const budget = new ViewportResourceBudget(1, collector.budgetObserver);
    const callbacks = {
      onLeaseGranted: jest.fn(),
      onEarlyEvictionRequested: jest.fn(),
      onEarlyEvictionCancelled: jest.fn(),
    };
    budget.register(callbacks).requestLease();
    budget.register(callbacks).requestLease();
    budget.register(callbacks).requestLease();
    expect(collector.finish()?.maxQueued).toBe(2);
  });

  it("delivers observer reentry after the current mutation stabilizes", () => {
    const events: string[] = [];
    let queuedMember: ViewportResourceBudgetMember | undefined;
    let didReenter = false;
    const budget = new ViewportResourceBudget(1, {
      onEvent: (metric) => {
        events.push(metric);
        if (metric === "leaseRequested" && queuedMember && !didReenter) {
          didReenter = true;
          queuedMember.requestLease();
        }
      },
    });
    const holderGranted = jest.fn();
    const queuedGranted = jest.fn();
    const holder = budget.register({
      onLeaseGranted: holderGranted,
      onEarlyEvictionRequested: jest.fn(),
      onEarlyEvictionCancelled: jest.fn(),
    });
    queuedMember = budget.register({
      onLeaseGranted: queuedGranted,
      onEarlyEvictionRequested: jest.fn(),
      onEarlyEvictionCancelled: jest.fn(),
    });

    holder.requestLease();

    expect(events.slice(-3)).toEqual([
      "leaseRequested",
      "leaseGranted",
      "leaseRequested",
    ]);
    expect(holderGranted).toHaveBeenCalledTimes(1);
    expect(queuedGranted).not.toHaveBeenCalled();
    expect(budget.getSnapshot()).toEqual(
      expect.objectContaining({ leased: 1, queued: 1 })
    );
  });
});
