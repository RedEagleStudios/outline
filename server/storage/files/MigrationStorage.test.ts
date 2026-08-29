import { Readable } from "node:stream";
import BaseStorage from "./BaseStorage";
import { MigrationStorage } from "./MigrationStorage";

class MemoryStorage extends BaseStorage {
  public readonly files = new Map<string, Buffer>();

  public readonly requiresSignedUrls: boolean;

  constructor(
    private readonly name: string,
    requiresSignedUrls = false
  ) {
    super();
    this.requiresSignedUrls = requiresSignedUrls;
  }

  async getPresignedPost() {
    return {};
  }

  async getFileStream(key: string) {
    const value = this.files.get(key);
    return value ? Readable.from(value) : null;
  }

  getUploadUrl() {
    return `${this.name}/upload`;
  }

  getUrlForKey(key: string) {
    return `${this.name}/${key}`;
  }

  async getSignedUrl(key: string) {
    return `${this.name}/signed/${key}`;
  }

  async store() {
    return this.name;
  }

  async getFileHandle() {
    return {
      path: this.name,
      cleanup: async () => undefined,
    };
  }

  async getFileExists(key: string) {
    return this.files.has(key);
  }

  async stat(key: string) {
    return { size: this.files.get(key)?.byteLength ?? 0 };
  }

  async moveFile(fromKey: string, toKey: string) {
    const value = this.files.get(fromKey);
    if (value) {
      this.files.set(toKey, value);
      this.files.delete(fromKey);
    }
  }

  async deleteFile(key: string) {
    this.files.delete(key);
  }
}

describe("MigrationStorage", () => {
  let primary: MemoryStorage;
  let fallback: MemoryStorage;
  let storage: MigrationStorage;

  beforeEach(() => {
    primary = new MemoryStorage("r2", true);
    fallback = new MemoryStorage("local");
    storage = new MigrationStorage(primary, fallback);
  });

  it("uses the primary provider when the object has migrated", async () => {
    primary.files.set("uploads/image.png", Buffer.from("primary"));
    fallback.files.set("uploads/image.png", Buffer.from("fallback"));

    expect(await storage.getSignedUrl("uploads/image.png")).toEqual(
      "r2/signed/uploads/image.png"
    );
    expect(storage.requiresSignedUrls).toBe(true);
  });

  it("falls back to local storage for an object missing from R2", async () => {
    fallback.files.set("uploads/image.png", Buffer.from("fallback"));

    expect(await storage.getSignedUrl("uploads/image.png")).toEqual(
      "local/signed/uploads/image.png"
    );
    expect(await storage.stat("uploads/image.png")).toEqual({ size: 8 });
  });

  it("deletes both copies", async () => {
    primary.files.set("uploads/image.png", Buffer.from("primary"));
    fallback.files.set("uploads/image.png", Buffer.from("fallback"));

    await storage.deleteFile("uploads/image.png");

    expect(primary.files.has("uploads/image.png")).toBe(false);
    expect(fallback.files.has("uploads/image.png")).toBe(false);
  });

  it("moves both copies", async () => {
    primary.files.set("uploads/old.png", Buffer.from("primary"));
    fallback.files.set("uploads/old.png", Buffer.from("fallback"));

    await storage.moveFile("uploads/old.png", "uploads/new.png");

    expect(primary.files.has("uploads/new.png")).toBe(true);
    expect(fallback.files.has("uploads/new.png")).toBe(true);
  });
});
