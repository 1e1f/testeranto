import { join } from "node:path";
import type { ITesterantoConfig } from "../../../Types";
import type { IConfigSlice } from "../../types";
import { BuildKitBuilder } from "../../serverClasses/v3/technological/utils/BuildKit_Utils";
// import nodeContent from "../../../../dist/node/node.js" with { type: "text" };
import webContent from "../../../../dist/prebuild/web/web.mjs" with { type: "text" };
import hoistContent from "../../../../dist/prebuild/web/hoist.mjs" with { type: "text" };

// Write the web file to a location that will be mounted in the container
const webScriptPath = join(process.cwd(), "testeranto", "web_runtime.ts");
await Bun.write(webScriptPath, webContent);

const webHoistScriptPath = join(process.cwd(), "testeranto", "web_hoist.ts");
await Bun.write(webHoistScriptPath, hoistContent);

export const webDockerComposeFile = (
  config: ITesterantoConfig,
  container_name: string,
  projectConfigPath: string,
  webConfigPath: string,
  slice: IConfigSlice
) => {
  // // For web builder service, we need a proper build configuration
  // // Since this is a builder service (not BuildKit), it needs a build field
  // const runtimeConfig = config.runtimes[runtimeTestsName];
  // if (!runtimeConfig) {
  //   throw new Error(`Runtime config not found for ${runtimeTestsName}`);
  // }

  const service: any = {
    build: {
      context: '..',
      dockerfile: config.runtimes[container_name]?.dockerfile
    },
    container_name,
    environment: {
      NODE_ENV: "production",
      ENV: "web",
      MODE: process.env.MODE || "dev",
    },
    working_dir: "/workspace",
    volumes: [
      ...config.volumes,
      `../testeranto:/workspace/testeranto`,
    ],
    command: webBuildCommand(
      projectConfigPath,
      webConfigPath,
      slice
    ),
    networks: ["allTests_network"],
    expose: ["8000"],
  };

  return service;
};

// Chrome service configuration using browserless/chrome
export const chromeServiceConfig = () => {
  return {
    image: "browserless/chrome:latest",
    container_name: "chrome-service",
    environment: {
      CONNECTION_TIMEOUT: "60000",
      MAX_CONCURRENT_SESSIONS: "1",
      ENABLE_CORS: "true",
      PREBOOT_CHROME: "true",
      DEFAULT_BLOCK_ADS: "true"
    },
    shm_size: "2g",
    expose: ["3000"],
    ports: [
      "9222:3000"
    ],
    networks: ["allTests_network"],
  };
};

export const webBuildCommand = (
  projectConfigPath: string,
  webConfigPath: string,
  slice: IConfigSlice,
) => {
  const configJson = JSON.stringify(slice);
  return `bun /workspace/testeranto/web_runtime.ts /workspace/${projectConfigPath} /workspace/${webConfigPath} '${configJson}'`;
};

export const webBddCommand = (
  fpath: string,
  webConfigPath: string,
  configKey: string,
  // containerName: string,
) => {
  // fpath has .mjs extension (the bundled file), but we need to use the original test file path
  // for the directory structure. The original test file has .ts extension.
  // Convert .mjs back to .ts for the fs path to match the directory we created.
  const originalPath = fpath.replace(/\.mjs$/, '.ts');

  const jsonStr = JSON.stringify({
    ports: [1111],
    fs: `testeranto/reports/${configKey}/${originalPath}/`,
  });

  const command = `bun /workspace/testeranto/web_hoist.ts testeranto/bundles/${configKey}/${fpath} '${jsonStr}'`
  // console.log(`[SERVER.DOCKER.WEB] ${configKey} ${containerName} ${command}`)
  // ESBUILD_HOST is now set via environment in the Docker Compose service configuration
  return command;
};

// BuildKit-based building for web runtime
export const webBuildKitBuild = async (
  config: ITesterantoConfig,
  configKey: string,
): Promise<void> => {
  const runtimeConfig = config.runtimes[configKey];

  if (!runtimeConfig) {
    throw new Error(`Configuration not found for ${configKey}`);
  }

  const buildKitConfig = runtimeConfig.buildKitOptions || {};

  const buildKitOptions = {
    runtime: "web",
    configKey,
    dockerfilePath: runtimeConfig.dockerfile,
    buildContext: process.cwd(),
    cacheMounts: ["/root/.bun"],
    targetStage: buildKitConfig.targetStage, // Don't default to 'runtime'
    buildArgs: {
      NODE_ENV: "production",
      ...(buildKitConfig.buildArgs || {}),
    },
  };

  console.log(`[Web BuildKit] Building image for ${configKey}...`);

  const result = await BuildKitBuilder.buildImage(buildKitOptions);

  if (result.success) {
    console.log(
      `[Web BuildKit] Successfully built image in ${result.duration}ms`,
    );
  } else {
    console.error(`[Web BuildKit] Build failed: ${result.error}`);
    throw new Error(`BuildKit build failed: ${result.error}`);
  }
};
