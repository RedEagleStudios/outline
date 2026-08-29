import type { Blob } from "node:buffer";
import type { Readable } from "node:stream";
import type { PresignedPost } from "@aws-sdk/s3-presigned-post";
import Logger from "@server/logging/Logger";
import type { AppContext } from "@server/types";
import BaseStorage from "./BaseStorage";

/**
 * Uses a primary storage provider while retaining a read fallback during migration.
 */
export class MigrationStorage extends BaseStorage {
  public readonly requiresSignedUrls: boolean;

  /**
   * Initializes the migration bridge.
   *
   * @param primary the destination storage provider.
   * @param fallback the source storage provider.
   */
  constructor(primary: BaseStorage, fallback: BaseStorage) {
    super();
    this.primary = primary;
    this.fallback = fallback;
    this.requiresSignedUrls = primary.requiresSignedUrls;
  }

  /** @inheritdoc */
  public getPresignedPost(
    ctx: AppContext,
    key: string,
    acl: string,
    maxUploadSize: number,
    contentType: string
  ): Promise<Partial<PresignedPost>> {
    return this.primary.getPresignedPost(
      ctx,
      key,
      acl,
      maxUploadSize,
      contentType
    );
  }

  /** @inheritdoc */
  public getFileStream(
    key: string,
    range?: { start?: number; end?: number }
  ): Promise<NodeJS.ReadableStream | null> {
    return this.getReadableStorage(key).then((storage) =>
      storage.getFileStream(key, range)
    );
  }

  /** @inheritdoc */
  public getUploadUrl(isServerUpload?: boolean): string {
    return this.primary.getUploadUrl(isServerUpload);
  }

  /** @inheritdoc */
  public getUrlForKey(key: string): string {
    return this.primary.getUrlForKey(key);
  }

  /** @inheritdoc */
  public async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    const storage = await this.getReadableStorage(key);
    return storage.getSignedUrl(key, expiresIn);
  }

  /** @inheritdoc */
  public store({
    body,
    contentLength,
    contentType,
    key,
    acl,
  }: {
    body: Buffer | Uint8Array | Blob | string | Readable;
    contentLength?: number;
    contentType?: string;
    key: string;
    acl?: string;
  }): Promise<string | undefined> {
    return this.primary.store({
      body,
      contentLength,
      contentType,
      key,
      acl,
    });
  }

  /** @inheritdoc */
  public async getFileHandle(key: string) {
    const storage = await this.getReadableStorage(key);
    return storage.getFileHandle(key);
  }

  /** @inheritdoc */
  public async getFileExists(key: string): Promise<boolean> {
    if (await this.primary.getFileExists(key)) {
      return true;
    }

    return this.fallback.getFileExists(key);
  }

  /** @inheritdoc */
  public async stat(key: string) {
    const storage = await this.getReadableStorage(key);
    return storage.stat(key);
  }

  /** @inheritdoc */
  public async moveFile(fromKey: string, toKey: string): Promise<void> {
    const [primaryExists, fallbackExists] = await Promise.all([
      this.primary.getFileExists(fromKey),
      this.fallback.getFileExists(fromKey),
    ]);
    const moves: Promise<void>[] = [];

    if (primaryExists) {
      moves.push(this.primary.moveFile(fromKey, toKey));
    }
    if (fallbackExists) {
      moves.push(this.fallback.moveFile(fromKey, toKey));
    }

    await Promise.all(moves);
  }

  /** @inheritdoc */
  public async deleteFile(key: string): Promise<void> {
    await Promise.all([
      this.primary.deleteFile(key),
      this.fallback.deleteFile(key),
    ]);
  }

  private primary: BaseStorage;

  private fallback: BaseStorage;

  private async getReadableStorage(key: string): Promise<BaseStorage> {
    if (await this.primary.getFileExists(key)) {
      return this.primary;
    }

    Logger.warn("Reading file from migration fallback storage", { key });
    return this.fallback;
  }
}
