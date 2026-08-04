import {
  prepareForPrint,
  printWithPreparation,
  registerEditorPrintFallback,
} from "./printPreparation";

function addImage(
  options: { complete?: boolean; loading?: string; src?: string } = {},
  targetDocument = document
) {
  const editor = targetDocument.createElement("div");
  editor.className = "ProseMirror";
  const image = targetDocument.createElement("img");
  image.src =
    options.src ?? "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  if (options.loading) {
    image.setAttribute("loading", options.loading);
  }
  Object.defineProperty(image, "complete", {
    configurable: true,
    value: options.complete ?? true,
  });
  editor.append(image);
  targetDocument.body.append(editor);
  return image;
}

describe("printPreparation", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-outline-print-preparing");
    jest.restoreAllMocks();
  });

  it("prepares complete images, decodes, and restores loading", async () => {
    const image = addImage({ loading: "lazy" });
    const decode = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: decode,
    });

    const cleanup = await prepareForPrint();
    expect(
      document.documentElement.getAttribute("data-outline-print-preparing")
    ).toBe("true");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(decode).toHaveBeenCalled();
    cleanup();
    expect(image.getAttribute("loading")).toBe("lazy");
  });

  it.each(["load", "error"])("settles a delayed image on %s", async (event) => {
    const image = addImage({ complete: false });
    const preparation = prepareForPrint({ timeout: 1000 });
    image.dispatchEvent(new Event(event));
    const cleanup = await preparation;
    cleanup();
    expect(image.hasAttribute("loading")).toBe(false);
  });

  it("settles each image once when one dispatches both load and error", async () => {
    const first = addImage({ complete: false });
    const second = addImage({ complete: false });
    let resolveDecode: (() => void) | undefined;
    Object.defineProperty(first, "decode", {
      configurable: true,
      value: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDecode = resolve;
          })
      ),
    });
    const preparation = prepareForPrint({ timeout: 1000 });
    let prepared = false;
    void preparation.then(() => {
      prepared = true;
    });

    first.dispatchEvent(new Event("load"));
    first.dispatchEvent(new Event("error"));
    resolveDecode?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(prepared).toBe(false);

    second.dispatchEvent(new Event("load"));
    const cleanup = await preparation;
    cleanup();
  });

  it("settles decode rejection", async () => {
    const image = addImage();
    Object.defineProperty(image, "decode", {
      configurable: true,
      value: jest.fn().mockRejectedValue(new Error("decode")),
    });
    const cleanup = await prepareForPrint();
    cleanup();
    expect(
      document.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);
  });

  it("bounds preparation with an overall timeout", async () => {
    jest.useFakeTimers();
    addImage({ complete: false });
    const preparation = prepareForPrint({ timeout: 25 });
    await jest.advanceTimersByTimeAsync(25);
    const cleanup = await preparation;
    cleanup();
    jest.useRealTimers();
  });

  it("does not restore shared state until every lease is cleaned", async () => {
    const image = addImage({ loading: "lazy" });
    const first = await prepareForPrint();
    const second = await prepareForPrint();
    first();
    expect(image.getAttribute("loading")).toBe("eager");
    second();
    expect(image.getAttribute("loading")).toBe("lazy");
  });

  it("ref-counts editor fallback and handles beforeprint and afterprint", () => {
    const image = addImage({ loading: "lazy" });
    const unregisterFirst = registerEditorPrintFallback(document);
    const unregisterSecond = registerEditorPrintFallback(document);
    window.dispatchEvent(new Event("beforeprint"));
    expect(image.getAttribute("loading")).toBe("eager");
    unregisterFirst();
    expect(image.getAttribute("loading")).toBe("eager");
    window.dispatchEvent(new Event("afterprint"));
    expect(image.getAttribute("loading")).toBe("lazy");
    unregisterSecond();
    window.dispatchEvent(new Event("beforeprint"));
    expect(image.getAttribute("loading")).toBe("lazy");
  });

  it("prints after preparation and cleans up when print throws", async () => {
    const image = addImage({ complete: false });
    const print = jest.spyOn(window, "print").mockImplementation(() => {
      expect(image.getAttribute("loading")).toBe("eager");
      throw new Error("print");
    });
    const result = printWithPreparation({ timeout: 1000 });
    expect(print).not.toHaveBeenCalled();
    image.dispatchEvent(new Event("load"));
    await expect(result).rejects.toThrow("print");
    expect(image.hasAttribute("loading")).toBe(false);
    expect(
      document.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);
  });

  it("releases a thrown application print fallback lease for later cycles", async () => {
    const image = addImage({ loading: "lazy" });
    const unregister = registerEditorPrintFallback(document);
    jest.spyOn(window, "print").mockImplementation(() => {
      window.dispatchEvent(new Event("beforeprint"));
      throw new Error("print");
    });

    await expect(printWithPreparation()).rejects.toThrow("print");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(
      document.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);

    window.dispatchEvent(new Event("beforeprint"));
    expect(image.getAttribute("loading")).toBe("eager");
    window.dispatchEvent(new Event("afterprint"));
    expect(image.getAttribute("loading")).toBe("lazy");
    unregister();
  });

  it("leaves a successful application print fallback lease for afterprint", async () => {
    const image = addImage({ loading: "lazy" });
    const unregister = registerEditorPrintFallback(document);
    jest.spyOn(window, "print").mockImplementation(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });

    await printWithPreparation();
    expect(image.getAttribute("loading")).toBe("eager");
    expect(
      document.documentElement.getAttribute("data-outline-print-preparing")
    ).toBe("true");

    window.dispatchEvent(new Event("afterprint"));
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(
      document.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);
    unregister();
  });

  it("isolates preparation and printing to a supplied iframe document", async () => {
    const mainImage = addImage({ loading: "lazy" });
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!frameDocument || !frameWindow) {
      throw new Error("iframe document unavailable");
    }
    const frameImage = addImage(
      {
        complete: false,
        loading: "lazy",
        src: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
      },
      frameDocument
    );
    const mainPrint = jest.spyOn(window, "print").mockImplementation();
    const framePrint = jest.spyOn(frameWindow, "print").mockImplementation();
    const frameSetTimeout = jest.spyOn(frameWindow, "setTimeout");

    await printWithPreparation({ document: frameDocument, timeout: 0 });

    expect(framePrint).toHaveBeenCalledTimes(1);
    expect(mainPrint).not.toHaveBeenCalled();
    expect(frameSetTimeout).toHaveBeenCalledTimes(1);
    expect(mainImage.getAttribute("loading")).toBe("lazy");
    expect(frameImage.getAttribute("loading")).toBe("lazy");
    expect(
      document.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);
    expect(
      frameDocument.documentElement.hasAttribute("data-outline-print-preparing")
    ).toBe(false);
  });
});
