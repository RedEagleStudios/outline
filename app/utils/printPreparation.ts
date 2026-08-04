const PRINT_PREPARING_ATTRIBUTE = "data-outline-print-preparing";
const DEFAULT_TIMEOUT = 5000;

interface DocumentPrintState {
  leases: number;
  editors: number;
  images: Map<HTMLImageElement, string | null>;
  fallbackCleanup?: () => void;
  handleBeforePrint?: () => void;
  handleAfterPrint?: () => void;
}

/** Options controlling application print preparation. */
export interface PrintPreparationOptions {
  document?: Document;
  timeout?: number;
}

const states = new WeakMap<Document, DocumentPrintState>();

function getMountedEditorImages(document: Document): HTMLImageElement[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(".ProseMirror img[src]")
  ).filter((image) => Boolean(image.getAttribute("src")));
}

function getState(document: Document): DocumentPrintState {
  const existing = states.get(document);
  if (existing) {
    return existing;
  }

  const state: DocumentPrintState = {
    leases: 0,
    editors: 0,
    images: new Map(),
  };
  states.set(document, state);
  return state;
}

function acquire(document: Document): () => void {
  const state = getState(document);
  state.leases += 1;
  document.documentElement.setAttribute(PRINT_PREPARING_ATTRIBUTE, "true");

  getMountedEditorImages(document).forEach((image) => {
    if (!state.images.has(image)) {
      state.images.set(image, image.getAttribute("loading"));
    }
    image.setAttribute("loading", "eager");
  });

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    state.leases -= 1;
    if (state.leases > 0) {
      return;
    }

    document.documentElement.removeAttribute(PRINT_PREPARING_ATTRIBUTE);
    state.images.forEach((loading, image) => {
      if (loading === null) {
        image.removeAttribute("loading");
      } else {
        image.setAttribute("loading", loading);
      }
    });
    state.images.clear();
  };
}

async function decode(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode !== "function") {
    return;
  }
  try {
    await image.decode();
  } catch {
    // Decode failures must not prevent printing.
  }
}

function scheduleTimeout(
  document: Document,
  callback: () => void,
  timeout: number
): () => void {
  const view = document.defaultView;
  if (view) {
    const timer = view.setTimeout(callback, timeout);
    return () => view.clearTimeout(timer);
  }

  const timer = globalThis.setTimeout(callback, timeout);
  return () => globalThis.clearTimeout(timer);
}

function waitForImages(
  document: Document,
  images: HTMLImageElement[],
  timeout: number
) {
  return new Promise<void>((resolve) => {
    if (!images.length) {
      resolve();
      return;
    }

    let remaining = images.length;
    const cleanups = new Set<() => void>();
    let finished = false;
    const finishOne = () => {
      remaining -= 1;
      if (!remaining) {
        finish();
      }
    };
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      cancelTimeout();
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
      resolve();
    };
    const cancelTimeout = scheduleTimeout(
      document,
      finish,
      Math.max(0, timeout)
    );

    images.forEach((image) => {
      if (image.complete) {
        void decode(image).then(finishOne);
        return;
      }

      let settled = false;
      const cleanup = () => {
        image.removeEventListener("load", settle);
        image.removeEventListener("error", settle);
        cleanups.delete(cleanup);
      };
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        void decode(image).then(finishOne);
      };
      image.addEventListener("load", settle, { once: true });
      image.addEventListener("error", settle, { once: true });
      cleanups.add(cleanup);
    });
  });
}

/**
 * Activates print rendering and waits for mounted editor images to settle.
 *
 * @param options - target document and overall timeout.
 * @returns an exact, idempotent cleanup callback.
 */
export async function prepareForPrint(
  options: PrintPreparationOptions = {}
): Promise<() => void> {
  const document = options.document ?? window.document;
  const cleanup = acquire(document);
  const images = getMountedEditorImages(document);
  await waitForImages(document, images, options.timeout ?? DEFAULT_TIMEOUT);
  return cleanup;
}

/**
 * Prints the application document after print preparation settles.
 *
 * @param options - target document and overall timeout.
 * @returns a promise settled after printing and cleanup.
 */
export async function printWithPreparation(
  options: PrintPreparationOptions = {}
): Promise<void> {
  const document = options.document ?? window.document;
  const cleanup = await prepareForPrint({ ...options, document });
  const state = getState(document);
  const fallbackCleanupBeforePrint = state.fallbackCleanup;
  try {
    document.defaultView?.print();
  } catch (error) {
    if (
      state.fallbackCleanup &&
      state.fallbackCleanup !== fallbackCleanupBeforePrint
    ) {
      state.fallbackCleanup();
      state.fallbackCleanup = undefined;
    }
    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Registers an editor document for direct-browser-print fallback handling.
 *
 * @param document - document containing the mounted editor.
 * @returns an idempotent lifecycle cleanup callback.
 */
export function registerEditorPrintFallback(document: Document): () => void {
  const state = getState(document);
  state.editors += 1;
  if (state.editors === 1) {
    state.handleBeforePrint = () => {
      state.fallbackCleanup ??= acquire(document);
    };
    state.handleAfterPrint = () => {
      state.fallbackCleanup?.();
      state.fallbackCleanup = undefined;
    };
    document.defaultView?.addEventListener(
      "beforeprint",
      state.handleBeforePrint
    );
    document.defaultView?.addEventListener(
      "afterprint",
      state.handleAfterPrint
    );
  }

  let unregistered = false;
  return () => {
    if (unregistered) {
      return;
    }
    unregistered = true;
    state.editors -= 1;
    if (state.editors > 0) {
      return;
    }
    state.fallbackCleanup?.();
    state.fallbackCleanup = undefined;
    if (state.handleBeforePrint && state.handleAfterPrint) {
      document.defaultView?.removeEventListener(
        "beforeprint",
        state.handleBeforePrint
      );
      document.defaultView?.removeEventListener(
        "afterprint",
        state.handleAfterPrint
      );
    }
    state.handleBeforePrint = undefined;
    state.handleAfterPrint = undefined;
  };
}
