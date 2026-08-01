import { ViewportResourceBudget } from "./viewportResourceBudget";

const callbacks = () => ({
  onLeaseGranted: jest.fn(),
  onEarlyEvictionRequested: jest.fn(),
  onEarlyEvictionCancelled: jest.fn(),
});

describe("ViewportResourceBudget", () => {
  it("hard-bounds 100 requests at the default capacity", () => {
    const budget = new ViewportResourceBudget();
    const records = Array.from({ length: 100 }, callbacks);
    const members = records.map((record) => budget.register(record));
    members.forEach((member) => member.requestLease());
    expect(
      records.filter((record) => record.onLeaseGranted.mock.calls.length)
    ).toHaveLength(8);
    expect(budget.getSnapshot()).toEqual({
      capacity: 8,
      leased: 8,
      active: 8,
      cooling: 0,
      queued: 92,
      pinned: 0,
    });
  });

  it("grants waiters FIFO as leases release", () => {
    const budget = new ViewportResourceBudget(1);
    const records = [callbacks(), callbacks(), callbacks()];
    const members = records.map((record) => budget.register(record));
    members.forEach((member) => member.requestLease());
    expect(records[1].onLeaseGranted).not.toHaveBeenCalled();
    members[0].releaseLease();
    expect(records[1].onLeaseGranted).toHaveBeenCalledTimes(1);
    members[1].releaseLease();
    expect(records[2].onLeaseGranted).toHaveBeenCalledTimes(1);
  });

  it("selects oldest cooling victims and batches pressure", () => {
    const budget = new ViewportResourceBudget(3);
    const records = Array.from({ length: 6 }, callbacks);
    const members = records.map((record) => budget.register(record));
    members.slice(0, 3).forEach((member) => member.requestLease());
    members[0].markCooling();
    members[1].markCooling();
    members.slice(3).forEach((member) => member.requestLease());
    expect(records[0].onEarlyEvictionRequested).toHaveBeenCalledTimes(1);
    expect(records[1].onEarlyEvictionRequested).toHaveBeenCalledTimes(1);
    expect(records[2].onEarlyEvictionRequested).not.toHaveBeenCalled();
    members[0].releaseLease();
    expect(records[3].onLeaseGranted).toHaveBeenCalledTimes(1);
  });

  it("cancels pressure and tries the next victim after fresh-inside", () => {
    const budget = new ViewportResourceBudget(2);
    const records = Array.from({ length: 3 }, callbacks);
    const members = records.map((record) => budget.register(record));
    members[0].requestLease();
    members[1].requestLease();
    members[0].markCooling();
    members[1].markCooling();
    members[2].requestLease();
    members[0].markActive();
    expect(records[0].onEarlyEvictionCancelled).toHaveBeenCalledTimes(1);
    expect(records[1].onEarlyEvictionRequested).toHaveBeenCalledTimes(1);
    members[2].cancelLeaseRequest();
    expect(records[1].onEarlyEvictionCancelled).toHaveBeenCalledTimes(1);
  });

  it("pins queued and leased members without consuming capacity", () => {
    const budget = new ViewportResourceBudget(1);
    const records = Array.from({ length: 3 }, callbacks);
    const members = records.map((record) => budget.register(record));
    members.forEach((member) => member.requestLease());
    members[2].pin();
    members[0].pin();
    expect(records[1].onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot()).toEqual({
      capacity: 1,
      leased: 1,
      active: 1,
      cooling: 0,
      queued: 0,
      pinned: 2,
    });
  });

  it("unregisters every state and keeps instances isolated", () => {
    const firstBudget = new ViewportResourceBudget(1);
    const secondBudget = new ViewportResourceBudget(1);
    const first = firstBudget.register(callbacks());
    const waiterCallbacks = callbacks();
    const waiter = firstBudget.register(waiterCallbacks);
    const separateCallbacks = callbacks();
    const separate = secondBudget.register(separateCallbacks);
    first.requestLease();
    waiter.requestLease();
    separate.requestLease();
    first.unregister();
    expect(waiterCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(separateCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    waiter.unregister();
    separate.unregister();
    expect(firstBudget.getSnapshot().leased).toBe(0);
    expect(secondBudget.getSnapshot().leased).toBe(0);
  });

  it("destroys safely and makes stale handles harmless", () => {
    const budget = new ViewportResourceBudget(1);
    const record = callbacks();
    const member = budget.register(record);
    const waiter = budget.register(callbacks());
    member.requestLease();
    member.markCooling();
    waiter.requestLease();
    budget.destroy();
    expect(record.onEarlyEvictionCancelled).toHaveBeenCalledTimes(1);
    member.requestLease();
    member.releaseLease();
    expect(budget.getSnapshot().leased).toBe(0);
  });

  it("finishes reentrant and throwing callback work before rethrowing", () => {
    const budget = new ViewportResourceBudget(2);
    const error = new Error("grant failed");
    const second = callbacks();
    const secondMember = budget.register(second);
    const first = budget.register({
      ...callbacks(),
      onLeaseGranted: jest.fn(() => {
        secondMember.requestLease();
        throw error;
      }),
    });
    expect(() => first.requestLease()).toThrow(error);
    expect(second.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().leased).toBe(2);
  });

  it("validates reentrant grants and grants the next waiter exactly once", () => {
    const budget = new ViewportResourceBudget(1);
    const secondCallbacks = callbacks();
    const second = budget.register(secondCallbacks);
    let first = budget.register(callbacks());
    const firstCallbacks = callbacks();
    first = budget.register({
      ...firstCallbacks,
      onLeaseGranted: jest.fn(() => {
        second.requestLease();
        first.releaseLease();
      }),
    });

    first.requestLease();
    expect(secondCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot()).toEqual({
      capacity: 1,
      leased: 1,
      active: 1,
      cooling: 0,
      queued: 0,
      pinned: 0,
    });
  });

  it("skips planned callbacks invalidated by reentrant destruction", () => {
    const budget = new ViewportResourceBudget(2);
    const secondCallbacks = callbacks();
    const second = budget.register(secondCallbacks);
    const first = budget.register({
      ...callbacks(),
      onLeaseGranted: jest.fn(() => budget.destroy()),
    });

    first.requestLease();
    second.requestLease();
    expect(secondCallbacks.onLeaseGranted).not.toHaveBeenCalled();
    expect(budget.getSnapshot().leased).toBe(0);
  });

  it("does not retain eviction pressure after a reentrant queue change", () => {
    const budget = new ViewportResourceBudget(1);
    const waiterCallbacks = callbacks();
    const waiter = budget.register(waiterCallbacks);
    let holder = budget.register(callbacks());
    const holderCallbacks = callbacks();
    const evictionCallback = jest.fn(() => waiter.cancelLeaseRequest());
    holder = budget.register({
      ...holderCallbacks,
      onEarlyEvictionRequested: evictionCallback,
    });
    holder.requestLease();
    holder.markCooling();
    waiter.requestLease();

    expect(evictionCallback).toHaveBeenCalledTimes(1);
    expect(holderCallbacks.onEarlyEvictionCancelled).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().queued).toBe(0);
    expect(budget.getSnapshot().leased).toBeLessThanOrEqual(
      budget.getSnapshot().capacity
    );
  });

  it("rethrows the first error after still-valid reentrant work", () => {
    const budget = new ViewportResourceBudget(2);
    const error = new Error("first callback failed");
    const secondCallbacks = callbacks();
    const second = budget.register(secondCallbacks);
    const first = budget.register({
      ...callbacks(),
      onLeaseGranted: jest.fn(() => {
        second.requestLease();
        throw error;
      }),
    });

    expect(() => first.requestLease()).toThrow(error);
    expect(secondCallbacks.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().leased).toBeLessThanOrEqual(2);
  });

  it("rejects invalid capacity and tolerates repeated lifecycle calls", () => {
    expect(() => new ViewportResourceBudget(0)).toThrow(RangeError);
    expect(() => new ViewportResourceBudget(1.5)).toThrow(RangeError);
    const budget = new ViewportResourceBudget(1);
    const record = callbacks();
    const member = budget.register(record);
    member.requestLease();
    member.requestLease();
    member.unregister();
    member.unregister();
    member.requestLease();
    expect(record.onLeaseGranted).toHaveBeenCalledTimes(1);
    expect(budget.getSnapshot().leased).toBe(0);
  });
});
