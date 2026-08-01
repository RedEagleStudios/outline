import * as React from "react";
import { registerViewportObserver } from "./viewportObserverRegistry";
import type {
  ViewportConfirmationHandle,
  ViewportObserverOptions,
  ViewportObserverSubscription,
} from "./viewportObserverRegistry";
import { subscribeViewportLifecycle } from "./viewportLifecycleEvents";
import type { ViewportLifecycleSubscription } from "./viewportLifecycleEvents";
import { useViewportResourceBudget } from "./viewportResourceBudgetContext";
import type {
  ViewportResourceBudget,
  ViewportResourceBudgetMember,
} from "./viewportResourceBudget";

interface BudgetLeaseToken {
  budget: ViewportResourceBudget;
  member: ViewportResourceBudgetMember;
  generation: number;
  scope: object;
  target: Element;
}

export type ViewportLifecyclePhase =
  | "waiting"
  | "active"
  | "cooling"
  | "pinned";

export interface ViewportLifecycleOptions extends ViewportObserverOptions {
  /** Enables viewport resource gating. */
  enabled?: boolean;
  /** Cooling duration before an outside target is unmounted. */
  coolingMs?: number;
  /** Dwell duration before a budgeted resource requests admission. */
  admissionMs?: number;
  /** Whether the owning editor node is selected. */
  selected?: boolean;
  /** Whether the owning editor node is being resized. */
  resizing?: boolean;
}

export interface ViewportLifecycleResult<T extends Element> {
  /** Stable callback ref used to set the observed target. */
  ref: (target: T | null) => void;
  /** Whether the resource-owning child should be mounted. */
  shouldMount: boolean;
  /** Current viewport lifecycle phase. */
  phase: ViewportLifecyclePhase;
  /** Permanently mounts the resource for this component lifetime. */
  pin: () => void;
}

/**
 * Controls mounting of a resource according to viewport and browser lifecycle.
 *
 * @param options - viewport lifecycle configuration.
 * @returns the stable target ref and current lifecycle state.
 */
export function useViewportLifecycle<T extends Element>(
  options: ViewportLifecycleOptions = {}
): ViewportLifecycleResult<T> {
  const {
    enabled = false,
    root = null,
    rootMargin = "1000px 0px",
    threshold = 0,
    coolingMs = 30000,
    admissionMs = 100,
    selected = false,
    resizing = false,
  } = options;
  const budget = useViewportResourceBudget();
  const [target, setTarget] = React.useState<T | null>(null);
  const targetRef = React.useRef<T | null>(null);
  const budgetScope = React.useMemo(
    () => ({
      admissionMs,
      budget,
      coolingMs,
      enabled,
      root,
      rootMargin,
      target,
      threshold,
    }),
    [
      admissionMs,
      budget,
      coolingMs,
      enabled,
      root,
      rootMargin,
      target,
      threshold,
    ]
  );
  const [phase, setPhase] = React.useState<ViewportLifecyclePhase>("waiting");
  const phaseRef = React.useRef(phase);
  const deadlineRef = React.useRef<number>();
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const admissionTimerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const failOpenTimerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const observerRef = React.useRef<ViewportObserverSubscription>();
  const confirmationRef = React.useRef<ViewportConfirmationHandle>();
  const lifecycleRef = React.useRef<ViewportLifecycleSubscription>();
  const visibleRef = React.useRef(true);
  const generationRef = React.useRef(0);
  const memberRef = React.useRef<ViewportResourceBudgetMember>();
  const heldLeaseRef = React.useRef<BudgetLeaseToken>();
  const mountAuthorizationRef = React.useRef<BudgetLeaseToken>();
  const pendingReleaseRef = React.useRef<BudgetLeaseToken>();
  const queuedRef = React.useRef(false);
  const insideRef = React.useRef(false);
  const pressureRef = React.useRef(false);

  const updatePhase = React.useCallback((next: ViewportLifecyclePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);
  const clearFailOpenTimer = React.useCallback(() => {
    if (failOpenTimerRef.current !== undefined) {
      clearTimeout(failOpenTimerRef.current);
      failOpenTimerRef.current = undefined;
    }
  }, []);
  const clearAdmission = React.useCallback(() => {
    if (admissionTimerRef.current !== undefined) {
      clearTimeout(admissionTimerRef.current);
      admissionTimerRef.current = undefined;
    }
  }, []);
  const clearConfirmation = React.useCallback(() => {
    confirmationRef.current?.cancel();
    confirmationRef.current = undefined;
  }, []);
  const pin = React.useCallback(() => {
    clearAdmission();
    clearTimer();
    clearFailOpenTimer();
    clearConfirmation();
    deadlineRef.current = undefined;
    observerRef.current?.unsubscribe();
    observerRef.current = undefined;
    const lifecycle = lifecycleRef.current;
    lifecycleRef.current = undefined;
    lifecycle?.unsubscribe();
    queuedRef.current = false;
    const token = heldLeaseRef.current;
    pendingReleaseRef.current = undefined;
    mountAuthorizationRef.current = undefined;
    heldLeaseRef.current = undefined;
    const member = token?.member ?? memberRef.current;
    member?.cancelLeaseRequest();
    member?.pin();
    updatePhase("pinned");
  }, [
    clearAdmission,
    clearConfirmation,
    clearFailOpenTimer,
    clearTimer,
    updatePhase,
  ]);
  const ref = React.useCallback(
    (element: T | null) => {
      if (!enabled || targetRef.current === element) {
        return;
      }
      generationRef.current += 1;
      mountAuthorizationRef.current = undefined;
      pendingReleaseRef.current = undefined;
      targetRef.current = element;
      setTarget(element);
    },
    [enabled]
  );

  React.useLayoutEffect(() => {
    if (
      enabled &&
      (selected || resizing) &&
      pendingReleaseRef.current !== undefined
    ) {
      pin();
    }
  }, [enabled, pin, resizing, selected]);

  React.useEffect(() => {
    const generation = ++generationRef.current;
    clearTimer();
    clearAdmission();
    clearFailOpenTimer();
    clearConfirmation();
    observerRef.current?.unsubscribe();
    lifecycleRef.current?.unsubscribe();
    observerRef.current = undefined;
    lifecycleRef.current = undefined;
    memberRef.current?.unregister();
    memberRef.current = undefined;
    heldLeaseRef.current = undefined;
    mountAuthorizationRef.current = undefined;
    pendingReleaseRef.current = undefined;
    queuedRef.current = false;
    insideRef.current = false;
    pressureRef.current = false;

    if (!enabled) {
      deadlineRef.current = undefined;
      if (phaseRef.current !== "waiting") {
        updatePhase("waiting");
      }
      return;
    }
    if (!target) {
      return;
    }
    const observedTarget = target;
    const wasPinned = phaseRef.current === "pinned";
    deadlineRef.current = undefined;
    if (!wasPinned && phaseRef.current !== "waiting") {
      updatePhase("waiting");
    }

    visibleRef.current =
      typeof document === "undefined" || document.visibilityState !== "hidden";

    let scheduleDeadline = () => undefined;
    let requestConfirmation = () => undefined;

    const isCurrentToken = (
      token: BudgetLeaseToken | undefined
    ): token is BudgetLeaseToken =>
      !!token &&
      heldLeaseRef.current === token &&
      token.budget === budget &&
      token.scope === budgetScope &&
      token.target === observedTarget &&
      token.generation === generation &&
      generationRef.current === generation &&
      memberRef.current === token.member;

    const prepareCommittedRelease = (token: BudgetLeaseToken) => {
      if (!isCurrentToken(token)) {
        return;
      }
      pendingReleaseRef.current = token;
      mountAuthorizationRef.current = undefined;
      updatePhase("waiting");
    };

    if (budget) {
      let registeredMember: ViewportResourceBudgetMember | undefined;
      registeredMember = budget.register({
        onLeaseGranted: () => {
          if (
            !registeredMember ||
            generationRef.current !== generation ||
            !insideRef.current ||
            phaseRef.current !== "waiting"
          ) {
            queuedRef.current = false;
            registeredMember?.releaseLease();
            return;
          }
          queuedRef.current = false;
          const token: BudgetLeaseToken = {
            budget,
            member: registeredMember,
            generation,
            scope: budgetScope,
            target: observedTarget,
          };
          heldLeaseRef.current = token;
          mountAuthorizationRef.current = token;
          pendingReleaseRef.current = undefined;
          updatePhase("active");
        },
        onEarlyEvictionRequested: () => {
          if (
            generationRef.current !== generation ||
            phaseRef.current !== "cooling"
          ) {
            return;
          }
          pressureRef.current = true;
          clearTimer();
          requestConfirmation();
        },
        onEarlyEvictionCancelled: () => {
          const pending = pendingReleaseRef.current;
          if (pending && isCurrentToken(pending) && pressureRef.current) {
            pendingReleaseRef.current = undefined;
            mountAuthorizationRef.current = pending;
            pressureRef.current = false;
            clearConfirmation();
            updatePhase("cooling");
            pending.member.markCooling();
            if (visibleRef.current) {
              const deadline = deadlineRef.current;
              if (deadline !== undefined && Date.now() >= deadline) {
                requestConfirmation();
              } else {
                scheduleDeadline();
              }
            }
            return;
          }
          if (
            generationRef.current !== generation ||
            !pressureRef.current ||
            phaseRef.current !== "cooling"
          ) {
            return;
          }
          pressureRef.current = false;
          clearConfirmation();
          if (visibleRef.current) {
            scheduleDeadline();
          }
        },
      });
      memberRef.current = registeredMember;
    }

    if (wasPinned || selected || resizing) {
      pin();
      return;
    }

    const clearObservation = () => {
      clearTimer();
      clearAdmission();
      clearConfirmation();
      if (queuedRef.current) {
        queuedRef.current = false;
        memberRef.current?.cancelLeaseRequest();
      }
      observerRef.current?.unsubscribe();
      observerRef.current = undefined;
    };

    const scheduleFailOpen = () => {
      clearObservation();
      deadlineRef.current = undefined;
      const lifecycle = lifecycleRef.current;
      lifecycleRef.current = undefined;
      lifecycle?.unsubscribe();
      clearFailOpenTimer();
      failOpenTimerRef.current = setTimeout(() => {
        failOpenTimerRef.current = undefined;
        if (generationRef.current === generation) {
          pin();
        }
      }, 0);
    };

    const scheduleAdmission = () => {
      if (
        !budget ||
        admissionTimerRef.current !== undefined ||
        queuedRef.current ||
        heldLeaseRef.current
      ) {
        return;
      }
      admissionTimerRef.current = setTimeout(
        () => {
          admissionTimerRef.current = undefined;
          if (
            generationRef.current !== generation ||
            !visibleRef.current ||
            !insideRef.current ||
            phaseRef.current !== "waiting"
          ) {
            return;
          }
          queuedRef.current = true;
          memberRef.current?.requestLease();
        },
        Math.max(0, admissionMs)
      );
    };

    requestConfirmation = () => {
      if (
        confirmationRef.current ||
        generationRef.current !== generation ||
        !visibleRef.current ||
        phaseRef.current !== "cooling"
      ) {
        return;
      }
      const observer = observerRef.current;
      if (!observer) {
        scheduleFailOpen();
        return;
      }
      try {
        confirmationRef.current = observer.requestFreshConfirmation(
          (result) => {
            confirmationRef.current = undefined;
            if (
              generationRef.current !== generation ||
              !visibleRef.current ||
              phaseRef.current !== "cooling"
            ) {
              return;
            }
            if (result.status === "unavailable") {
              scheduleFailOpen();
              return;
            }
            if (result.entry.isIntersecting) {
              clearTimer();
              deadlineRef.current = undefined;
              pressureRef.current = false;
              const token = heldLeaseRef.current;
              pendingReleaseRef.current = undefined;
              if (isCurrentToken(token)) {
                mountAuthorizationRef.current = token;
                token.member.markActive();
              }
              updatePhase("active");
              return;
            }
            if (!budget) {
              const deadline = deadlineRef.current;
              if (deadline !== undefined && Date.now() >= deadline) {
                deadlineRef.current = undefined;
                updatePhase("waiting");
              } else {
                scheduleDeadline();
              }
              return;
            }
            const token = heldLeaseRef.current;
            if (!isCurrentToken(token)) {
              return;
            }
            if (pressureRef.current) {
              prepareCommittedRelease(token);
              return;
            }
            const deadline = deadlineRef.current;
            if (deadline === undefined) {
              return;
            }
            if (Date.now() >= deadline) {
              deadlineRef.current = undefined;
              prepareCommittedRelease(token);
              return;
            }
            scheduleDeadline();
          }
        );
      } catch (_err) {
        scheduleFailOpen();
      }
    };

    scheduleDeadline = () => {
      clearTimer();
      const deadline = deadlineRef.current;
      if (deadline === undefined) {
        return;
      }
      const delay = Math.max(0, deadline - Date.now());
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        requestConfirmation();
      }, delay);
    };

    const handleEntry = (entry: IntersectionObserverEntry) => {
      if (generationRef.current !== generation || !visibleRef.current) {
        return;
      }
      if (entry.isIntersecting) {
        insideRef.current = true;
        clearConfirmation();
        clearTimer();
        pressureRef.current = false;
        const pending = pendingReleaseRef.current;
        if (pending && isCurrentToken(pending)) {
          pendingReleaseRef.current = undefined;
          mountAuthorizationRef.current = pending;
          deadlineRef.current = undefined;
          updatePhase("active");
          pending.member.markActive();
          return;
        }
        if (phaseRef.current === "cooling") {
          deadlineRef.current = undefined;
          updatePhase("active");
          memberRef.current?.markActive();
        } else if (phaseRef.current === "waiting") {
          if (budget) {
            scheduleAdmission();
          } else {
            updatePhase("active");
          }
        }
        return;
      }
      insideRef.current = false;
      if (confirmationRef.current) {
        return;
      }
      if (phaseRef.current === "waiting") {
        clearAdmission();
        if (queuedRef.current) {
          queuedRef.current = false;
          memberRef.current?.cancelLeaseRequest();
        }
        return;
      }
      if (phaseRef.current === "active") {
        deadlineRef.current = Date.now() + coolingMs;
        updatePhase("cooling");
        memberRef.current?.markCooling();
        if (!pressureRef.current) {
          scheduleDeadline();
        }
        return;
      }
      if (phaseRef.current === "cooling") {
        scheduleDeadline();
      }
    };

    function registerObserver(): ViewportObserverSubscription | undefined {
      return registerViewportObserver(observedTarget, handleEntry, {
        root,
        rootMargin,
        threshold,
      });
    }

    observerRef.current = registerObserver();
    if (!observerRef.current) {
      scheduleFailOpen();
      return;
    }
    lifecycleRef.current = subscribeViewportLifecycle({
      onBeforePrint: pin,
      onVisibilityChange: (visible) => {
        visibleRef.current = visible;
        clearObservation();
        if (visible) {
          observerRef.current = registerObserver();
          if (!observerRef.current) {
            scheduleFailOpen();
            return;
          }
          if (phaseRef.current === "cooling") {
            if (pressureRef.current) {
              requestConfirmation();
            } else {
              const deadline = deadlineRef.current;
              if (deadline !== undefined && Date.now() >= deadline) {
                requestConfirmation();
              } else {
                scheduleDeadline();
              }
            }
          }
        }
      },
      onFullscreenChange: (element) => {
        if (element && observedTarget.contains(element)) {
          pin();
        }
      },
      onWindowBlur: () => {
        if (
          typeof document !== "undefined" &&
          document.activeElement &&
          observedTarget.contains(document.activeElement)
        ) {
          pin();
        }
      },
    });

    return () => {
      generationRef.current += 1;
      clearTimer();
      clearAdmission();
      clearFailOpenTimer();
      clearConfirmation();
      observerRef.current?.unsubscribe();
      lifecycleRef.current?.unsubscribe();
      observerRef.current = undefined;
      lifecycleRef.current = undefined;
      const member = memberRef.current;
      memberRef.current = undefined;
      queuedRef.current = false;
      const heldLease = heldLeaseRef.current;
      heldLeaseRef.current = undefined;
      pendingReleaseRef.current = undefined;
      mountAuthorizationRef.current = undefined;
      pressureRef.current = false;
      (heldLease?.member ?? member)?.unregister();
    };
  }, [
    admissionMs,
    budget,
    budgetScope,
    clearAdmission,
    clearTimer,
    clearConfirmation,
    clearFailOpenTimer,
    coolingMs,
    enabled,
    pin,
    resizing,
    root,
    rootMargin,
    target,
    threshold,
    updatePhase,
    selected,
  ]);

  const authorization = mountAuthorizationRef.current;
  const shouldMount =
    !enabled ||
    selected ||
    resizing ||
    phase === "pinned" ||
    (!budget && phase !== "waiting") ||
    (!!budget &&
      authorization?.budget === budget &&
      authorization.scope === budgetScope &&
      authorization.target === target &&
      authorization.generation === generationRef.current &&
      authorization.member === memberRef.current);

  React.useLayoutEffect(() => {
    const pending = pendingReleaseRef.current;
    if (
      shouldMount ||
      phase !== "waiting" ||
      !pending ||
      heldLeaseRef.current !== pending ||
      mountAuthorizationRef.current !== undefined ||
      pending.budget !== budget ||
      pending.scope !== budgetScope ||
      pending.target !== target ||
      pending.generation !== generationRef.current ||
      pending.member !== memberRef.current
    ) {
      return;
    }

    pendingReleaseRef.current = undefined;
    heldLeaseRef.current = undefined;
    mountAuthorizationRef.current = undefined;
    deadlineRef.current = undefined;
    pressureRef.current = false;
    queuedRef.current = false;
    pending.member.cancelLeaseRequest();
    pending.member.releaseLease();
  }, [budget, budgetScope, phase, shouldMount, target]);

  return {
    ref,
    shouldMount,
    phase,
    pin,
  };
}
