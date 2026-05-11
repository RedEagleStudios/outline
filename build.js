/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const { exec } = require("child_process");
const { readdirSync, existsSync } = require("fs");
const { copyFile, mkdir, rm } = require("fs/promises");

const getDirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
}

async function build() {
  // Clean previous build
  console.log("Clean previous build…");

  await Promise.all([
    rm("./build/server", {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
    rm("./build/plugins", {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  ]);

  const d = getDirectories("./plugins");

  // Compile server and shared
  console.log("Compiling…");
  await Promise.all([
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/server ./server"
    ),
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/shared ./shared"
    ),
  ]);

  for (const plugin of d) {
    const hasServer = existsSync(`./plugins/${plugin}/server`);

    if (hasServer) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/server" "./plugins/${plugin}/server"`
      );
    }

    const hasShared = existsSync(`./plugins/${plugin}/shared`);

    if (hasShared) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/shared" "./plugins/${plugin}/shared"`
      );
    }
  }

  // Copy static files
  console.log("Copying static files…");
  await Promise.all([
    copyFile(
      "./server/collaboration/Procfile",
      "./build/server/collaboration/Procfile"
    ),
    copyFile("./server/static/error.dev.html", "./build/server/error.dev.html"),
    copyFile(
      "./server/static/error.prod.html",
      "./build/server/error.prod.html"
    ),
    copyFile("package.json", "./build/package.json"),
    ...d.map(async (plugin) => {
      const source = `./plugins/${plugin}/plugin.json`;

      if (!existsSync(source)) {
        return;
      }

      const destination = `./build/plugins/${plugin}/plugin.json`;
      await mkdir(`./build/plugins/${plugin}`, { recursive: true });
      await copyFile(source, destination);
    }),
  ]);

  console.log("Done!");
}

void build();
