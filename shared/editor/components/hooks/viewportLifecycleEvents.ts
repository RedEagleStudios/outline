import { flushSync } from "react-dom";

export interface ViewportLifecycleCallbacks {
  /** Permanently pins the target for printing. */
  onBeforePrint: () => void;
  /** Reports whether the document is currently visible. */
  onVisibilityChange: (visible: boolean) => void;
  /** Reports the current fullscreen element. */
  onFullscreenChange: (element: Element | null) => void;
  /** Reports loss of top-level window focus. */
  onWindowBlur: () => void;
}

export interface ViewportLifecycleSubscription {
  /** Removes this lifecycle subscription. */
  unsubscribe: () => void;
}

interface LifecycleSubscription extends ViewportLifecycleCallbacks {
  active: boolean;
}

const subscriptions = new Set<LifecycleSubscription>();
let listening = false;

const handleBeforePrint = () => {
  flushSync(() => {
    for (const subscription of subscriptions) {
      if (subscription.active) {
        subscription.onBeforePrint();
      }
    }
  });
};
const handleVisibilityChange = () => {
  const visible = document.visibilityState !== "hidden";
  for (const subscription of subscriptions) {
    if (subscription.active) {
      subscription.onVisibilityChange(visible);
    }
  }
};
const handleFullscreenChange = () => {
  for (const subscription of subscriptions) {
    if (subscription.active) {
      subscription.onFullscreenChange(document.fullscreenElement);
    }
  }
};
const handleWindowBlur = () => {
  for (const subscription of subscriptions) {
    if (subscription.active) {
      subscription.onWindowBlur();
    }
  }
};

const startListening = () => {
  if (
    listening ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  listening = true;
  window.addEventListener("beforeprint", handleBeforePrint);
  window.addEventListener("blur", handleWindowBlur);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
};

const stopListening = () => {
  if (!listening || typeof window === "undefined") {
    return;
  }
  listening = false;
  window.removeEventListener("beforeprint", handleBeforePrint);
  window.removeEventListener("blur", handleWindowBlur);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
};

/**
 * Subscribes a viewport target to shared browser lifecycle events.
 *
 * @param callbacks - callbacks for shared lifecycle events.
 * @returns a unique removable subscription.
 */
export function subscribeViewportLifecycle(
  callbacks: ViewportLifecycleCallbacks
): ViewportLifecycleSubscription {
  const subscription: LifecycleSubscription = { ...callbacks, active: true };
  subscriptions.add(subscription);
  startListening();
  return {
    unsubscribe: () => {
      if (!subscription.active) {
        return;
      }
      subscription.active = false;
      subscriptions.delete(subscription);
      if (subscriptions.size === 0) {
        stopListening();
      }
    },
  };
}
