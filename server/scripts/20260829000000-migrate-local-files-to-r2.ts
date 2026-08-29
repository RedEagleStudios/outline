import "./bootstrap";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import invariant from "invariant";
import env from "@server/env";
import { Attachment } from "@server/models";
import { R2Storage } from "@server/storage/files/R2Storage";

interface MigrationFile {
  absolutePath: string;
  key: string;
  size: number;
}

interface MigrationOptions {
  concurrency: number;
  dryRun: boolean;
  verify: boolean;
}

/**
 * Copies local file storage to R2 without changing object keys.
 * Existing objects with matching sizes are skipped, making the script resumable.
 *
 * @returns a promise that resolves when migration and optional verification finish.
 */
export async function migrateLocalFilesToR2(): Promise<void> {
  const root = env.FILE_STORAGE_LOCAL_ROOT_DIR;
  const options = parseOptions(process.argv.slice(2));
  const storage = new R2Storage();
  const attachments = await Attachment.findAll({
    attributes: ["key", "contentType"],
  });
  const contentTypes = new Map(
    attachments.map((attachment) => [attachment.key, attachment.contentType])
  );
  const pending = new Set<Promise<void>>();
  let copied = 0;
  let skipped = 0;
  let verified = 0;

  invariant(root, "FILE_STORAGE_LOCAL_ROOT_DIR is required");

  for await (const file of walkFiles(root, root)) {
    let task: Promise<void>;
    task = migrateFile(storage, file, contentTypes, options)
      .then((result) => {
        if (result === "copied") {
          copied += 1;
        } else if (result === "verified") {
          verified += 1;
        } else {
          skipped += 1;
        }
      })
      .finally(() => pending.delete(task));

    pending.add(task);
    if (pending.size >= options.concurrency) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);
  console.log(
    `R2 migration complete: ${copied} copied, ${verified} verified, ${skipped} skipped`
  );
}

async function migrateFile(
  storage: R2Storage,
  file: MigrationFile,
  contentTypes: Map<string, string>,
  options: MigrationOptions
): Promise<"copied" | "skipped" | "verified"> {
  const exists = await storage.getFileExists(file.key);

  if (exists) {
    const remote = await storage.stat(file.key);
    if (remote.size === file.size) {
      if (!options.verify) {
        return "skipped";
      }

      const [localHash, remoteHash] = await Promise.all([
        hashStream(createReadStream(file.absolutePath)),
        storage.getFileStream(file.key).then((stream) => {
          invariant(stream, `R2 object could not be read: ${file.key}`);
          return hashStream(stream);
        }),
      ]);
      if (localHash === remoteHash) {
        return "verified";
      }
    }
  }

  if (options.dryRun) {
    console.log(`Would copy ${file.key}`);
    return "skipped";
  }

  const inferredContentType = mime.lookup(file.key);
  const contentType =
    contentTypes.get(file.key) ||
    (inferredContentType ? inferredContentType : "application/octet-stream");

  await storage.store({
    body: createReadStream(file.absolutePath),
    contentLength: file.size,
    contentType,
    key: file.key,
  });

  if (options.verify) {
    const remoteStream = await storage.getFileStream(file.key);
    invariant(remoteStream, `R2 object could not be read: ${file.key}`);
    const [localHash, remoteHash] = await Promise.all([
      hashStream(createReadStream(file.absolutePath)),
      hashStream(remoteStream),
    ]);
    invariant(localHash === remoteHash, `Checksum mismatch: ${file.key}`);
  }

  console.log(`Copied ${file.key}`);
  return "copied";
}

async function* walkFiles(
  root: string,
  directory: string
): AsyncGenerator<MigrationFile> {
  const entries = await opendir(directory);

  for await (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(root, absolutePath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    yield {
      absolutePath,
      key: path.relative(root, absolutePath),
      size: fileStat.size,
    };
  }
}

function parseOptions(args: string[]): MigrationOptions {
  const concurrencyArgument = args.find((argument) =>
    argument.startsWith("--concurrency=")
  );
  const concurrency = concurrencyArgument
    ? parseInt(concurrencyArgument.split("=")[1], 10)
    : 4;

  invariant(
    Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 32,
    "Concurrency must be an integer between 1 and 32"
  );

  return {
    concurrency,
    dryRun: args.includes("--dry-run"),
    verify: args.includes("--verify"),
  };
}

function hashStream(stream: NodeJS.ReadableStream): Promise<string> {
  const hash = createHash("sha256");

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.once("end", () => resolve(hash.digest("hex")));
    stream.once("error", reject);
  });
}

if (process.env.NODE_ENV !== "test") {
  void migrateLocalFilesToR2()
    .then(() => process.exit(0))
    .catch((error: Error) => {
      console.error(error);
      process.exit(1);
    });
}
