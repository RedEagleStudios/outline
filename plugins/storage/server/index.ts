import { existsSync, mkdirSync } from "node:fs";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import {
  PluginManager,
  PluginPriority,
  Hook,
} from "@server/utils/PluginManager";
import router from "./api/files";

if (env.FILE_STORAGE === "local" || env.FILE_STORAGE_LOCAL_FALLBACK) {
  const rootDir = env.FILE_STORAGE_LOCAL_ROOT_DIR;
  try {
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true });
      Logger.debug("utils", `Created ${rootDir} for local storage`);
    }
  } catch (err) {
    Logger.fatal(
      `Failed to create directory for local file storage at ${env.FILE_STORAGE_LOCAL_ROOT_DIR}`,
      err
    );
  }
}

const enabled =
  !!env.FILE_STORAGE_UPLOAD_MAX_SIZE &&
  (env.FILE_STORAGE === "local" || env.FILE_STORAGE === "r2");

if (enabled) {
  PluginManager.add([
    {
      name: "File storage",
      description: "Plugin for proxying file uploads and authorized downloads",
      type: Hook.API,
      value: router,
      priority: PluginPriority.Normal,
    },
  ]);
}
