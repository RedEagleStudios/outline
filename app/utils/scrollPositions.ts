import Storage from "@shared/utils/Storage";

/**
 * Returns the storage key used to remember the scroll position of a route.
 * Edit-mode routes share the position of the document they belong to.
 *
 * @param pathname the location pathname.
 * @returns the normalized key.
 */
export function scrollPositionKey(pathname: string): string {
  return pathname.replace(/\/edit\/?$/, "").replace(/\/+$/, "") || "/";
}

/**
 * Returns the remembered scroll offset for a route, if any.
 *
 * @param key the key returned by `scrollPositionKey`.
 * @returns the scroll offset in pixels, or undefined when nothing is stored.
 */
export function getScrollPosition(key: string): number | undefined {
  return readPositions()[key]?.top;
}

/**
 * Persists the scroll offset for a route in browser storage. Offsets at the
 * top of the page are removed, and only the most recently updated routes are
 * kept.
 *
 * @param key the key returned by `scrollPositionKey`.
 * @param top the scroll offset in pixels.
 */
export function setScrollPosition(key: string, top: number) {
  const positions = readPositions();

  if (top <= 0) {
    if (!(key in positions)) {
      return;
    }
    delete positions[key];
  } else {
    positions[key] = { top: Math.round(top), updatedAt: Date.now() };
  }

  const keys = Object.keys(positions);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => positions[a].updatedAt - positions[b].updatedAt)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((staleKey) => delete positions[staleKey]);
  }

  Storage.set(STORAGE_KEY, positions);
}

const STORAGE_KEY = "scrollPositions";

/** Maximum number of routes to remember. */
const MAX_ENTRIES = 200;

interface ScrollPosition {
  /** Scroll offset in pixels. */
  top: number;
  /** Epoch milliseconds of the last update, used for eviction. */
  updatedAt: number;
}

function readPositions(): Record<string, ScrollPosition> {
  const value: unknown = Storage.get(STORAGE_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const positions: Record<string, ScrollPosition> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.top === "number" &&
      typeof entry.updatedAt === "number"
    ) {
      positions[key] = { top: entry.top, updatedAt: entry.updatedAt };
    }
  }
  return positions;
}
