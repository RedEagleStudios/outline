/** @jest-environment jsdom */

import { Schema } from "prosemirror-model";
import { downloadImageNode } from "./Image";

const schema = new Schema({
  nodes: {
    doc: { content: "inline*" },
    text: { group: "inline" },
    image: {
      inline: true,
      group: "inline",
      attrs: { src: {}, alt: { default: null } },
      toDOM: (node) => ["img", node.attrs],
    },
  },
});

describe("downloadImageNode", () => {
  const createObjectURL = jest.fn(() => "blob:download");
  const revokeObjectURL = jest.fn();
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeEach(() => {
    jest.useFakeTimers();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    Reflect.deleteProperty(global, "fetch");
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    fetchMock.mockReset();
  });

  it("removes the temporary link immediately and revokes only the Blob URL after 250ms", async () => {
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const blob = new Blob(["image"], { type: "image/png" });
    fetchMock.mockResolvedValue({ blob: async () => blob } as Response);
    const node = schema.nodes.image.create({
      src: "https://example.com/original.png",
      alt: "diagram",
    });

    await downloadImageNode(node);

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[href="blob:download"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(249);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
    expect(revokeObjectURL).not.toHaveBeenCalledWith(node.attrs.src);
  });

  it("keeps the outer promise pending until its only retry finishes", async () => {
    let rejectRetry: (reason: Error) => void = () => undefined;
    const retry = new Promise<Response>((_resolve, reject) => {
      rejectRetry = reject;
    });
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockReturnValueOnce(retry);
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    const node = schema.nodes.image.create({
      src: "https://example.com/image.png",
    });

    let settled = false;
    const download = downloadImageNode(node).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    rejectRetry(new Error("network"));
    await download;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(settled).toBe(true);
    expect(open).toHaveBeenCalledWith(node.attrs.src, "_blank");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
