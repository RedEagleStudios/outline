/** @jest-environment jsdom */

import FileHelper from "./FileHelper";

describe("FileHelper", () => {
  const createObjectURL = jest.fn(() => "blob:dimensions");
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("isImage", () => {
    expect(FileHelper.isImage("image/png")).toBe(true);
    expect(FileHelper.isImage("image/jpeg")).toBe(true);
    expect(FileHelper.isImage("image/webp")).toBe(true);
    expect(FileHelper.isImage("image/gif")).toBe(true);
    expect(FileHelper.isImage("image/bmp")).toBe(true);
    expect(FileHelper.isImage("image/avif")).toBe(true);
    expect(FileHelper.isImage("image/heif-sequence")).toBe(true);
    expect(FileHelper.isImage("image/svg+xml")).toBe(true);
    expect(FileHelper.isImage("text/plain")).toBe(false);
    expect(FileHelper.isImage("application/json")).toBe(false);
  });

  it("isVideo", () => {
    expect(FileHelper.isVideo("video/mp4")).toBe(true);
    expect(FileHelper.isVideo("video/webm")).toBe(true);
    expect(FileHelper.isVideo("video/x-msvideo")).toBe(true);
    expect(FileHelper.isVideo("video/vnd.dlna.mpeg-tts")).toBe(true);
    expect(FileHelper.isVideo("text/plain")).toBe(false);
    expect(FileHelper.isVideo("application/json")).toBe(false);
  });

  it("isAudio", () => {
    expect(FileHelper.isAudio("audio/mpeg")).toBe(true);
    expect(FileHelper.isAudio("audio/wav")).toBe(true);
    expect(FileHelper.isAudio("audio/vnd.dolby.heaac.1")).toBe(true);
    expect(FileHelper.isAudio("audio/vnd.lucent.voice")).toBe(true);
    expect(FileHelper.isAudio("text/plain")).toBe(false);
    expect(FileHelper.isAudio("application/json")).toBe(false);
  });

  describe("dimension fallbacks", () => {
    it.each([
      ["load", false],
      ["error", true],
    ])("revokes the image URL once on %s", async (_event, fails) => {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        width: { value: 640 },
        height: { value: 480 },
      });
      jest.spyOn(window, "Image").mockImplementation(() => image);

      const dimensions = FileHelper.getImageDimensions(
        new File(["image"], "image.jpg", { type: "image/jpeg" })
      );
      const handler = fails ? image.onerror : image.onload;
      handler?.(new Event(fails ? "error" : "load"));

      if (fails) {
        await expect(dimensions).rejects.toBeInstanceOf(Event);
      } else {
        await expect(dimensions).resolves.toEqual({ width: 640, height: 480 });
      }
      expect(image.onload).toBeNull();
      expect(image.onerror).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:dimensions");
    });

    it.each([
      ["load", false],
      ["error", true],
    ])("revokes the video URL once on %s", async (_event, fails) => {
      const video = document.createElement("video");
      Object.defineProperties(video, {
        videoWidth: { value: 1280 },
        videoHeight: { value: 720 },
      });
      const createElement = document.createElement.bind(document);
      jest
        .spyOn(document, "createElement")
        .mockImplementation((tagName) =>
          tagName === "video" ? video : createElement(tagName)
        );

      const dimensions = FileHelper.getVideoDimensions(
        new File(["video"], "video.mp4", { type: "video/mp4" })
      );
      const handler = fails ? video.onerror : video.onloadedmetadata;
      handler?.(new Event(fails ? "error" : "loadedmetadata"));

      if (fails) {
        await expect(dimensions).rejects.toBeInstanceOf(Event);
      } else {
        await expect(dimensions).resolves.toEqual({ width: 1280, height: 720 });
      }
      expect(video.onloadedmetadata).toBeNull();
      expect(video.onerror).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:dimensions");
    });
  });
});
