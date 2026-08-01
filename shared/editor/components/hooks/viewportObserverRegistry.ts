/** Options used to configure a pooled viewport observer. */
export interface ViewportObserverOptions {
  /** The element used as the intersection root. */
  root?: Element | null;
  /** The CSS margin applied to the intersection root. */
  rootMargin?: string;
  /** The intersection thresholds to observe. */
  threshold?: number | number[];
}

/** A fresh intersection delivered by a confirmation observer. */
export interface ViewportConfirmationFresh {
  status: "fresh";
  entry: IntersectionObserverEntry;
}

/** A confirmation which could not be obtained. */
export interface ViewportConfirmationUnavailable {
  status: "unavailable";
}

/** The result of requesting a fresh viewport confirmation. */
export type ViewportConfirmationResult =
  | ViewportConfirmationFresh
  | ViewportConfirmationUnavailable;

/** A handle which cancels one pending confirmation request. */
export interface ViewportConfirmationHandle {
  /** Cancels this request without invoking its callback. */
  cancel: () => void;
}

/** An individual subscription to the pooled viewport observer. */
export interface ViewportObserverSubscription {
  /** Stops this individual subscription. */
  unsubscribe: () => void;
  /**
   * Requests one entry from a short-lived confirmation observer.
   *
   * @param callback - callback invoked once when confirmation completes.
   * @returns a cancellation handle.
   */
  requestFreshConfirmation: (
    callback: (result: ViewportConfirmationResult) => void
  ) => ViewportConfirmationHandle;
}

interface ConfirmationRequest {
  batch: ConfirmationBatch;
  callback: (result: ViewportConfirmationResult) => void;
  subscription: TargetSubscription;
  target: Element;
  active: boolean;
}

interface ConfirmationBatch {
  requests: Map<Element, Set<ConfirmationRequest>>;
  frame: number | undefined;
  observer: IntersectionObserver | undefined;
}

interface ConfirmationDelivery {
  callback: (result: ViewportConfirmationResult) => void;
  result: ViewportConfirmationResult;
}

interface TargetSubscription {
  callback: (entry: IntersectionObserverEntry) => void;
  confirmations: Set<ConfirmationRequest>;
  active: boolean;
}

interface ObserverRegistry {
  observer: IntersectionObserver | undefined;
  confirmation: ConfirmationBatch | undefined;
  activeConfirmations: Set<ConfirmationBatch>;
  targets: Map<Element, Set<TargetSubscription>>;
  key: string;
  root: Element | null;
  rootMargin: string;
  threshold: number[];
}

const viewportRegistries = new Map<string, ObserverRegistry>();
const rootedViewportRegistries = new WeakMap<
  Element,
  Map<string, ObserverRegistry>
>();

const canonicalizeRootMargin = (rootMargin = "0px"): string => {
  const values = rootMargin.trim().split(/\s+/);
  const top = values[0] || "0px";
  const right = values[1] || top;
  const bottom = values[2] || top;
  const left = values[3] || right;
  return `${top} ${right} ${bottom} ${left}`;
};

const canonicalizeThreshold = (threshold: number | number[] = 0): number[] =>
  [...new Set(Array.isArray(threshold) ? threshold : [threshold])].sort(
    (left, right) => left - right
  );

const removeRegistry = (registry: ObserverRegistry) => {
  const registries = registry.root
    ? rootedViewportRegistries.get(registry.root)
    : viewportRegistries;
  registries?.delete(registry.key);
  if (registry.root && registries?.size === 0) {
    rootedViewportRegistries.delete(registry.root);
  }
};

const settleRequest = (request: ConfirmationRequest) => {
  if (!request.active) {
    return;
  }
  request.active = false;
  request.subscription.confirmations.delete(request);
};

const deliverConfirmations = (deliveries: ConfirmationDelivery[]) => {
  const errors: Error[] = [];
  for (const delivery of deliveries) {
    try {
      delivery.callback(delivery.result);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length > 0) {
    throw errors[0];
  }
};

const finishEmptyBatch = (
  registry: ObserverRegistry,
  batch: ConfirmationBatch
) => {
  if (batch.requests.size !== 0) {
    return;
  }
  if (batch.frame !== undefined) {
    cancelAnimationFrame(batch.frame);
    batch.frame = undefined;
  }
  batch.observer?.disconnect();
  batch.observer = undefined;
  registry.activeConfirmations.delete(batch);
  if (registry.confirmation === batch) {
    registry.confirmation = undefined;
  }
};

const removeRequest = (
  registry: ObserverRegistry,
  batch: ConfirmationBatch,
  request: ConfirmationRequest,
  result?: ViewportConfirmationResult
) => {
  const requests = batch.requests.get(request.target);
  requests?.delete(request);
  if (requests?.size === 0) {
    batch.requests.delete(request.target);
    batch.observer?.unobserve(request.target);
  }
  settleRequest(request);
  finishEmptyBatch(registry, batch);
  if (result) {
    deliverConfirmations([{ callback: request.callback, result }]);
  }
};

const failBatch = (registry: ObserverRegistry, batch: ConfirmationBatch) => {
  batch.observer?.disconnect();
  batch.observer = undefined;
  registry.activeConfirmations.delete(batch);
  const requests = [...batch.requests.values()].flatMap((items) => [...items]);
  batch.requests.clear();
  if (registry.confirmation === batch) {
    registry.confirmation = undefined;
  }
  for (const request of requests) {
    settleRequest(request);
  }
  deliverConfirmations(
    requests.map((request) => ({
      callback: request.callback,
      result: { status: "unavailable" },
    }))
  );
};

const settleEntries = (
  registry: ObserverRegistry,
  batch: ConfirmationBatch,
  entries: IntersectionObserverEntry[]
) => {
  const deliveries: ConfirmationDelivery[] = [];
  for (const entry of entries) {
    const requests = batch.requests.get(entry.target);
    if (!requests) {
      continue;
    }
    batch.requests.delete(entry.target);
    batch.observer?.unobserve(entry.target);
    for (const request of requests) {
      settleRequest(request);
      deliveries.push({
        callback: request.callback,
        result: { status: "fresh", entry },
      });
    }
  }
  finishEmptyBatch(registry, batch);
  deliverConfirmations(deliveries);
};

const startConfirmationBatch = (
  registry: ObserverRegistry,
  batch: ConfirmationBatch
) => {
  batch.frame = undefined;
  if (registry.confirmation !== batch || batch.requests.size === 0) {
    finishEmptyBatch(registry, batch);
    return;
  }

  let observer: IntersectionObserver;
  try {
    observer = new IntersectionObserver(
      (entries) => {
        if (
          !registry.activeConfirmations.has(batch) ||
          batch.observer !== observer
        ) {
          return;
        }
        settleEntries(registry, batch, entries);
      },
      {
        root: registry.root,
        rootMargin: registry.rootMargin,
        threshold: registry.threshold,
      }
    );
    batch.observer = observer;
    registry.confirmation = undefined;
    registry.activeConfirmations.add(batch);
    for (const target of batch.requests.keys()) {
      observer.observe(target);
    }
  } catch (_err) {
    failBatch(registry, batch);
  }
};

const requestConfirmation = (
  registry: ObserverRegistry,
  target: Element,
  subscription: TargetSubscription,
  callback: (result: ViewportConfirmationResult) => void
): ViewportConfirmationHandle => {
  let batch = registry.confirmation;
  if (!batch) {
    batch = { requests: new Map(), frame: undefined, observer: undefined };
    registry.confirmation = batch;
    const scheduledBatch = batch;
    batch.frame = requestAnimationFrame(() =>
      startConfirmationBatch(registry, scheduledBatch)
    );
  }
  const request: ConfirmationRequest = {
    batch,
    callback,
    subscription,
    target,
    active: true,
  };
  let requests = batch.requests.get(target);
  if (!requests) {
    requests = new Set();
    batch.requests.set(target, requests);
  }
  requests.add(request);
  subscription.confirmations.add(request);
  return {
    cancel: () => removeRequest(registry, batch, request),
  };
};

const createMainObserver = (
  registry: ObserverRegistry
): IntersectionObserver | undefined => {
  let observer: IntersectionObserver;
  try {
    observer = new IntersectionObserver(
      (entries) => {
        if (registry.observer !== observer) {
          return;
        }
        for (const entry of entries) {
          const subscriptions = registry.targets.get(entry.target);
          for (const subscription of subscriptions ?? []) {
            if (subscription.active) {
              subscription.callback(entry);
            }
          }
        }
      },
      {
        root: registry.root,
        rootMargin: registry.rootMargin,
        threshold: registry.threshold,
      }
    );
  } catch (_err) {
    return undefined;
  }
  return observer;
};

/**
 * Registers a target with the shared viewport observer pool.
 *
 * @param target - element to observe.
 * @param callback - callback invoked for active target entries.
 * @param options - observer configuration.
 * @returns the subscription, or undefined when observation is unsupported.
 */
export function registerViewportObserver(
  target: Element,
  callback: (entry: IntersectionObserverEntry) => void,
  options: ViewportObserverOptions = {}
): ViewportObserverSubscription | undefined {
  if (typeof IntersectionObserver === "undefined") {
    return undefined;
  }
  const root = options.root ?? null;
  const rootMargin = canonicalizeRootMargin(options.rootMargin);
  const threshold = canonicalizeThreshold(options.threshold);
  const key = `${rootMargin}|${threshold.join(",")}`;
  let registries = root
    ? rootedViewportRegistries.get(root)
    : viewportRegistries;
  if (!registries && root) {
    registries = new Map();
    rootedViewportRegistries.set(root, registries);
  }
  let registry = registries?.get(key);
  if (!registry) {
    registry = {
      observer: undefined,
      confirmation: undefined,
      activeConfirmations: new Set(),
      targets: new Map(),
      key,
      root,
      rootMargin,
      threshold,
    };
    const observer = createMainObserver(registry);
    if (!observer) {
      return undefined;
    }
    registry.observer = observer;
    registries?.set(key, registry);
  }

  const subscription: TargetSubscription = {
    callback,
    confirmations: new Set(),
    active: true,
  };
  let subscriptions = registry.targets.get(target);
  const firstForTarget = !subscriptions;
  if (!subscriptions) {
    subscriptions = new Set();
    registry.targets.set(target, subscriptions);
  }
  subscriptions.add(subscription);
  if (firstForTarget) {
    try {
      registry.observer?.observe(target);
    } catch (_err) {
      subscriptions.delete(subscription);
      registry.targets.delete(target);
      if (registry.targets.size === 0) {
        registry.observer?.disconnect();
        removeRegistry(registry);
      }
      return undefined;
    }
  }

  return {
    requestFreshConfirmation: (confirmationCallback) => {
      if (!subscription.active) {
        confirmationCallback({ status: "unavailable" });
        return { cancel: () => undefined };
      }
      return requestConfirmation(
        registry,
        target,
        subscription,
        confirmationCallback
      );
    },
    unsubscribe: () => {
      if (!subscription.active) {
        return;
      }
      subscription.active = false;
      for (const request of [...subscription.confirmations]) {
        removeRequest(registry, request.batch, request);
      }
      const activeSubscriptions = registry.targets.get(target);
      activeSubscriptions?.delete(subscription);
      if (activeSubscriptions?.size === 0) {
        registry.targets.delete(target);
        registry.observer?.unobserve(target);
      }
      if (registry.targets.size === 0) {
        registry.observer?.disconnect();
        removeRegistry(registry);
      }
    },
  };
}
