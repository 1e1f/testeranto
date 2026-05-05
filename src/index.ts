import pkg from "../package.json";

const version = pkg.version;

import readline from "readline";
import { join } from "path";
import fs from "fs/promises";

const init = async () => {
  console.log("initializing the testeranto folder");
  const testerantoDir = join(process.cwd(), "testeranto");
  const bundlesDir = join(testerantoDir, "bundles");
  const reportsDir = join(testerantoDir, "reports");
  await fs.mkdir(testerantoDir, { recursive: true });
  await fs.mkdir(bundlesDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
}

const mode = process.argv[2] as "once" | "dev" | "-v" | "init";

(async () => {
  if (mode === "-v") {
    console.log(`v${version} `);
    process.exit(0);
  }

  if (mode === "init") {
    await init();
    process.exit(0);
  }

  console.log(`testeranto v${version} running in ${mode} mode`);

  if (mode !== "once" && mode !== "dev" && mode != "-v") {
    console.error(`The 3rd argument should be '-v', 'init', 'dev' or 'once', not '${mode}'.`);
    console.error(`The process was given the following arguments:  '${process.argv}'.`);
    process.exit(-1);
  }

  console.log(`Press 'q' to initiate a graceful shutdown. Press 'CTRL + c' to quit forcefully.`);

  const { Server_Testeranto } = await import("./server/serverClasses/v3/technological/Server_Testeranto");
  const config = (await import(process.cwd() + '/testeranto/testeranto.ts')).default;
  const server = new Server_Testeranto(config, mode);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on("keypress", async (str, key) => {
    if (key.name === "q") {
      console.log("Testeranto is shutting down gracefully...");
      await server.stop();
      process.exit(0);
    }
    // Handle Ctrl+C through keypress when in raw mode
    if (key.ctrl && key.name === "c") {
      console.log("Testeranto is shutting down forcefully!");
      process.exit(1);
    }
  });

  process.on("SIGINT", async () => {
    console.log("Testeranto is shutting down forcefully!");
    process.exit(1);
  });

  server.start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });


  if (mode === 'once') {
    // In once mode, the server will handle its own lifecycle
    // No need for timeouts or forced exits
  }
})();
