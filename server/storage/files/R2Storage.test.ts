import { R2Storage } from "./R2Storage";

describe("R2Storage", () => {
  it("uses proxy uploads and signed downloads", () => {
    const storage = new R2Storage();

    expect(storage.getUploadUrl()).toEqual("/api/files.create");
    expect(storage.requiresSignedUrls).toBe(true);
  });
});
