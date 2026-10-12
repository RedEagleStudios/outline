// based on: https://reacttraining.com/react-router/web/guides/scroll-restoration
import { observer } from "mobx-react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { UserPreference } from "@shared/types";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePrevious from "~/hooks/usePrevious";
import {
  getScrollPosition,
  scrollPositionKey,
  setScrollPosition,
} from "~/utils/scrollPositions";
import { useScrollContext } from "./ScrollContext";

type Props = {
  children: JSX.Element;
};

/** How long a restored position is re-applied while page content loads. */
const RESTORE_DURATION_MS = 3000;

/** Delay before a scroll offset is written to browser storage. */
const SAVE_DELAY_MS = 250;

/** Events that indicate the user is scrolling or interacting themselves. */
const USER_INTERACTION_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "mousedown",
] as const;

/**
 * Resets the scroll position when navigating between routes. When the
 * current user enables `UserPreference.RestoreScrollPosition`, the last scroll
 * offset of each route is remembered in browser storage and restored when the
 * route is visited again.
 */
function ScrollToTop({ children }: Props) {
  const location = useLocation<{ retainScrollPosition?: boolean }>();
  const previousLocationPathname = usePrevious(location.pathname);
  const scrollContainerRef = useScrollContext();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const restoreEnabled = !!user?.getPreference(
    UserPreference.RestoreScrollPosition
  );

  /** Route key that scroll events are currently attributed to. */
  const activeKeyRef = useRef(scrollPositionKey(location.pathname));
  /** Whether scroll events should be recorded for the active route. */
  const trackingRef = useRef(false);
  /** Latest unsaved offset and the route it belongs to. */
  const pendingRef = useRef<{ key: string; top: number } | undefined>();
  const saveTimerRef = useRef<number>();
  const cancelRestoreRef = useRef<() => void>();

  const getScrollTop = useCallback(
    () => scrollContainerRef?.current?.scrollTop ?? window.scrollY,
    [scrollContainerRef]
  );

  const flushPending = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = undefined;
    if (pending) {
      setScrollPosition(pending.key, pending.top);
    }
  }, []);

  const restore = useCallback(
    (target: number) => {
      const container = scrollContainerRef?.current;
      const scroller = container ?? window;
      const startedAt = performance.now();
      let frame = 0;
      trackingRef.current = false;

      const stop = () => {
        cancelAnimationFrame(frame);
        USER_INTERACTION_EVENTS.forEach((type) =>
          window.removeEventListener(type, stop, true)
        );
        cancelRestoreRef.current = undefined;
        trackingRef.current = true;
      };

      // Content such as documents loads asynchronously, so keep re-applying
      // the offset while the page grows until the user takes over.
      const step = () => {
        const maxTop = container
          ? container.scrollHeight - container.clientHeight
          : document.documentElement.scrollHeight - window.innerHeight;
        const desired = Math.max(0, Math.min(target, maxTop));
        if (Math.abs(getScrollTop() - desired) > 1) {
          scroller.scrollTo(0, desired);
        }
        if (performance.now() - startedAt >= RESTORE_DURATION_MS) {
          stop();
          return;
        }
        frame = requestAnimationFrame(step);
      };

      USER_INTERACTION_EVENTS.forEach((type) =>
        window.addEventListener(type, stop, { capture: true, passive: true })
      );
      cancelRestoreRef.current = stop;
      step();
    },
    [scrollContainerRef, getScrollTop]
  );

  // Hand over browser history scroll handling while restoration is enabled.
  useEffect(() => {
    if (!restoreEnabled || !("scrollRestoration" in window.history)) {
      return;
    }
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, [restoreEnabled]);

  // Record the scroll offset of the active route.
  useEffect(() => {
    if (!restoreEnabled) {
      return;
    }
    const scroller = scrollContainerRef?.current ?? window;

    const handleScroll = () => {
      if (!trackingRef.current) {
        return;
      }
      pendingRef.current = { key: activeKeyRef.current, top: getScrollTop() };
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flushPending, SAVE_DELAY_MS);
    };

    trackingRef.current = !cancelRestoreRef.current;
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", flushPending);
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", flushPending);
      flushPending();
      cancelRestoreRef.current?.();
      trackingRef.current = false;
    };
  }, [restoreEnabled, scrollContainerRef, getScrollTop, flushPending]);

  // Before the browser clamps the offset for the new route's content, save the
  // previous route and stop attributing scroll events until the new route has
  // been positioned.
  useLayoutEffect(() => {
    const key = scrollPositionKey(location.pathname);
    if (key === activeKeyRef.current) {
      return;
    }
    flushPending();
    cancelRestoreRef.current?.();
    activeKeyRef.current = key;
    trackingRef.current = false;
  }, [location.pathname, flushPending]);

  useEffect(() => {
    const resumeTracking = () => {
      trackingRef.current = restoreEnabled;
    };

    if (
      location.pathname === previousLocationPathname ||
      location.state?.retainScrollPosition
    ) {
      resumeTracking();
      return;
    }
    // exception for when entering or exiting document edit, scroll position should not reset
    if (
      location.pathname.match(/\/edit\/?$/) ||
      previousLocationPathname?.match(/\/edit\/?$/)
    ) {
      resumeTracking();
      return;
    }

    // Anchor links are scrolled into view by the editor.
    const target =
      restoreEnabled && !location.hash
        ? getScrollPosition(scrollPositionKey(location.pathname))
        : undefined;
    if (target) {
      restore(target);
      return;
    }

    (scrollContainerRef?.current || window).scrollTo(0, 0);
    resumeTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scrollContainerRef,
    location.pathname,
    previousLocationPathname,
    location.state?.retainScrollPosition,
  ]);

  return children;
}

export default observer(ScrollToTop);
