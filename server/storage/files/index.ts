import env from "@server/env";
import LocalStorage from "./LocalStorage";
import { MigrationStorage } from "./MigrationStorage";
import { R2Storage } from "./R2Storage";
import S3Storage from "./S3Storage";

const getStorage = (provider: string) => {
  if (provider === "local") {
    return new LocalStorage();
  }

  if (provider === "r2") {
    return new R2Storage();
  }

  return new S3Storage();
};

const primary = getStorage(env.FILE_STORAGE);
const storage =
  env.FILE_STORAGE_FALLBACK && env.FILE_STORAGE_FALLBACK !== env.FILE_STORAGE
    ? new MigrationStorage(primary, getStorage(env.FILE_STORAGE_FALLBACK))
    : primary;

export default storage;
