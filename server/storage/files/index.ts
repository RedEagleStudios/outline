import env from "@server/env";
import LocalStorage from "./LocalStorage";
import { MigrationStorage } from "./MigrationStorage";
import { R2Storage } from "./R2Storage";
import S3Storage from "./S3Storage";

const storage = (() => {
  if (env.FILE_STORAGE === "local") {
    return new LocalStorage();
  }

  if (env.FILE_STORAGE === "r2") {
    const primary = new R2Storage();
    return env.FILE_STORAGE_LOCAL_FALLBACK
      ? new MigrationStorage(primary, new LocalStorage())
      : primary;
  }

  return new S3Storage();
})();

export default storage;
