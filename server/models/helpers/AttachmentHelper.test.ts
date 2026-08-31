import { AttachmentPreset } from "@shared/types";
import env from "@server/env";
import AttachmentHelper from "./AttachmentHelper";

describe("AttachmentHelper", () => {
  describe("getKey", () => {
    it("should return the correct key for a private attachment", () => {
      const key = AttachmentHelper.getKey({
        id: "123",
        name: "test.png",
        userId: "456",
      });

      expect(key).toEqual("uploads/456/123/test.png");
    });

    it("should return the correct key for a long file name", () => {
      const key = AttachmentHelper.getKey({
        id: "123",
        name: "a".repeat(300),
        userId: "456",
      });

      expect(key).toEqual(
        `uploads/456/123/${"a".repeat(AttachmentHelper.maximumFileNameLength)}`
      );
    });

    it("should remove invalid characters from the key", () => {
      const key = AttachmentHelper.getKey({
        id: "123",
        name: "test/../one.png",
        userId: "456",
      });

      expect(key).toEqual("uploads/456/123/test/one.png");
    });
  });

  describe("presetToAcl", () => {
    const originalFileStorage = env.FILE_STORAGE;
    const originalAcl = env.AWS_S3_ACL;

    afterEach(() => {
      env.FILE_STORAGE = originalFileStorage;
      env.AWS_S3_ACL = originalAcl;
    });

    it("should record private ACL for R2 attachments", () => {
      env.FILE_STORAGE = "r2";
      env.AWS_S3_ACL = "";

      expect(
        AttachmentHelper.presetToAcl(AttachmentPreset.DocumentAttachment)
      ).toEqual("private");
    });

    it("should retain public-read ACL for R2 avatars", () => {
      env.FILE_STORAGE = "r2";

      expect(AttachmentHelper.presetToAcl(AttachmentPreset.Avatar)).toEqual(
        "public-read"
      );
    });

    it("should retain configured ACL for S3 attachments", () => {
      env.FILE_STORAGE = "s3";
      env.AWS_S3_ACL = "public-read";

      expect(
        AttachmentHelper.presetToAcl(AttachmentPreset.DocumentAttachment)
      ).toEqual("public-read");
    });
  });
});
