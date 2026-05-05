import { join } from "node:path";
import type { IBaseTestConfig, ITesterantoConfig } from "../../../Types";
import { BuildKitBuilder } from "../../serverClasses/v3/technological/utils/BuildKit_Utils.js";

// Import the node runtime file as text
// import nodeContent from "../../../../../../dist/prebuild/node/node.mjs" with { type: "text" };
// dist / prebuild / server / runtimes / web / web.mjs
import nodeContent from "../../../../dist/prebuild/node/node.mjs" with { type: "text" };
// Import the native detection module
import nativeDetectionContent from "./native_detection.js" with { type: "text" };
import { config } from "node:process";
import type { IConfigSlice } from "../../types.js";

// Write the node file to a location that will be mounted in the container
const nodeScriptPath = join(process.cwd(), "testeranto", "node_runtime.ts");
await Bun.write(nodeScriptPath, nodeContent);

// Write the native detection module
const nativeDetectionPath = join(process.cwd(), "testeranto", "runtimes", "node", "native_detection.js");
await Bun.write(nativeDetectionPath, nativeDetectionContent);

export const nodeDockerComposeFile = (
  config: ITesterantoConfig,
  container_name: string,
  projectConfigPath: string,
  nodeConfigPath: string,
  slice: IConfigSlice
) => {
  // For node builder service, we need a proper build configuration
  const service: any = {
    build: {
      context: '..',
      dockerfile:
        config.runtimes[container_name]?.dockerfile ||
        "testeranto/runtimes/node/node.Dockerfile",
    },
    container_name,
    environment: {
      NODE_ENV: "production",
      ENV: "node",
    },
    working_dir: "/workspace",
    volumes: [
      `../src:/workspace/src`,
      `../dist:/workspace/dist`,
      `../testeranto:/workspace/testeranto`,
      // Note: node_modules is NOT mounted to avoid platform incompatibility
    ],
    command: nodeBuildCommand(
      projectConfigPath,
      nodeConfigPath,
      slice
    ),
    networks: ["allTests_network"],
  };

  return service;
};

export const nodeBuildCommand = (
  projectConfigPath: string,
  nodeConfigPath: string,
  configSlice: IConfigSlice,
) => {
  const configJson = JSON.stringify(configSlice);
  return `bun /workspace/testeranto/node_runtime.ts /workspace/${projectConfigPath} /workspace/${nodeConfigPath} '${configJson}'`;
};

export { nodeBddCommand } from "./utils/nodeBddCommand";

// BuildKit-based building
export const nodeBuildKitBuild = async (
  config: ITesterantoConfig,
  configKey: string,
): Promise<void> => {
  const runtimeConfig = config.runtimes[configKey];

  if (!runtimeConfig) {
    throw new Error(`Configuration not found for ${configKey}`);
  }

  const buildKitConfig = runtimeConfig.buildKitOptions || {};

  const buildKitOptions = {
    runtime: "node",
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

  console.log(`[Node BuildKit] Building image for ${configKey}...`);

  const result = await BuildKitBuilder.buildImage(buildKitOptions);

  if (result.success) {
    console.log(
      `[Node BuildKit] Successfully built image in ${result.duration}ms`,
    );
  } else {
    console.error(`[Node BuildKit] Build failed:\n${result.logs}`);
    throw new Error(`BuildKit build failed for ${configKey}:\n${result.logs}`);
  }
};

