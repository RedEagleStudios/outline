import type { PresignedPost } from "@aws-sdk/s3-presigned-post";
import type { AppContext } from "@server/types";
import S3Storage from "./S3Storage";

/**
 * Cloudflare R2 storage using permanent, bucket-scoped S3 credentials.
 */
export class R2Storage extends S3Storage {
  public readonly requiresSignedUrls: boolean = true;

  /**
   * Initializes R2 storage.
   */
  constructor() {
    super({
      defaultCacheControl: "max-age=31557600",
    });
  }

  /** @inheritdoc */
  public async getPresignedPost(
    ctx: AppContext,
    key: string,
    acl: string,
    maxUploadSize: number,
    contentType = "image"
  ): Promise<Partial<PresignedPost>> {
    return this.getProxyPresignedPost(
      ctx,
      key,
      acl,
      maxUploadSize,
      contentType
    );
  }

  /** @inheritdoc */
  public getUploadUrl() {
    return "/api/files.create";
  }

  protected readonly supportsAcl: boolean = false;
}
