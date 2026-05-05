import { exec, spawn } from "child_process";
import path from "path";
import { promisify } from "util";
import type { ITesterantoConfig } from "../../../../Types";
import type { IMode } from "../../../types";
import { getContainerInfo } from "../utils";
import { getAiderServiceName } from "../utils/aider/getAiderServiceName";
import { parseDockerEvent } from "../utils/docker/parseDockerEvent";
import { generateServiceName } from "../utils/generateServiceName";
import { chromeServiceConfig } from "../../../runtimes/web/docker";
import { getBaseServiceName } from "../utils/test/getBaseServiceName";
import { getBddServiceName } from "../utils/test/getBddServiceName";
import { getInputFiles } from "../utils/test/getInputFiles";
import { Server_Api } from "./Server_Api";
import { BuildKitBuilder } from "./utils/BuildKit_Utils";
import { handleDockerEventUtil } from "./utils/docker/handleDockerEventUtil";
import { generateAiderService } from "./utils/generateAiderService";
import { generateBddService } from "./utils/generateBddService";
import { generateBuilderService } from "./utils/generateBuilderService";
import { generateCheckService } from "./utils/generateCheckService";
import { generateYaml } from "./utils/generateYaml";
import { yamlValueToString } from "./utils/yamlValueToString";
import { handleFileEventUtil } from "../utils/file/handleFileEventUtil";

const execAsync = promisify(exec);

export class Server_DockerCompose extends Server_Api {
  private dockerEventsCleanup: (() => void) | null = null;
  private testLaunchLocks: Map<string, boolean> = new Map();

  constructor(
    configs: ITesterantoConfig,
    mode: IMode,
    getCurrentTestResults: () => any,
    projectRoot?: string,
    resourceChangedCallback?: (path: string) => void
  ) {
    super(configs, mode, getCurrentTestResults, projectRoot, resourceChangedCallback);
  }

  async dockerComposeUp(services?: string[]): Promise<void> {
    // Build images using BuildKit before starting services
    if (services && services.length > 0) {
      for (const serviceName of services) {
        await this.ensureImageExists(serviceName);
      }
    } else {
      // Build all images if no specific services provided
      for (const [configKey, configValue] of Object.entries(this.configs.runtimes)) {
        const imageName = `testeranto-${configValue.runtime || 'node'}-${configKey}:latest`;
        await this.ensureImageExists(imageName, configKey, configValue);
      }
    }

    const serviceArgs = services ? services.join(' ') : '';
    const composePath = `testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" up -d ${serviceArgs}`.trim();

    try {
      const { stdout, stderr } = await execAsync(command);
      console.log(`[Server_DockerCompose] dockerComposeUp: ${stdout}`);
      if (stderr) console.error(`[Server_DockerCompose] dockerComposeUp stderr: ${stderr}`);
    } catch (error: any) {
      console.error(`[Server_DockerCompose] dockerComposeUp failed: ${error.message}`);
      throw error;
    }
  }

  async dockerComposeDown(): Promise<void> {
    const composePath = `testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" down`;


    console.log(`[Server_DockerCompose] ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command);
      console.log(`[Server_DockerCompose] dockerComposeDown: ${stdout}`);
      if (stderr) console.error(`[Server_DockerCompose] dockerComposeDown stderr: ${stderr}`);
    } catch (error: any) {
      console.error(`[Server_DockerCompose] dockerComposeDown failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure a Docker image exists locally, building it with BuildKit if needed.
   */
  private async ensureImageExists(
    imageNameOrService: string,
    configKey?: string,
    configValue?: any,
  ): Promise<void> {
    // Determine the image name
    let imageName: string;
    let runtime: string;
    let key: string;
    let dockerfilePath: string;

    if (configKey && configValue) {
      // Called with config details
      runtime = configValue.runtime || 'node';
      key = configKey;
      imageName = `testeranto-${runtime}-${key}:latest`;
      dockerfilePath = configValue.dockerfile;
    } else {
      // Called with just a service name - extract configKey from it
      // Service names follow pattern: {configKey}-{testName}-{type}
      const parts = imageNameOrService.split('-');
      key = parts[0];
      const config = this.configs.runtimes[key];
      if (!config) {
        this.logBusinessWarning(`No config found for key ${key}, skipping BuildKit build`);
        return;
      }
      runtime = config.runtime || 'node';
      imageName = `testeranto-${runtime}-${key}:latest`;
      dockerfilePath = config.dockerfile;
    }

    // Check if image already exists
    const imageExistsCmd = `docker image inspect ${imageName} > /dev/null 2>&1`;
    try {
      await execAsync(imageExistsCmd);
      this.logBusinessMessage(`Image ${imageName} already exists locally`);
      return;
    } catch {
      this.logBusinessMessage(`Image ${imageName} not found locally, building with BuildKit...`);
    }

    // Build with BuildKit
    const result = await BuildKitBuilder.buildImage({
      runtime,
      configKey: key,
      dockerfilePath,
      buildContext: process.cwd(),
      cacheMounts: configValue?.buildKitOptions?.cacheMounts || [],
      targetStage: configValue?.buildKitOptions?.targetStage,
      buildArgs: configValue?.buildKitOptions?.buildArgs || {},
    });

    if (result.success) {
      this.logBusinessMessage(`✅ Built image ${imageName} with BuildKit in ${result.duration}ms`);
    } else {
      throw new Error(`BuildKit build failed for ${imageName}:\n${result.logs}`);
    }
  }

  async dockerComposeDownThenUp(): Promise<void> {
    this.logBusinessMessage("Bringing down all Docker services...");
    await this.dockerComposeDown();
    this.logBusinessMessage("Bringing up all Docker services...");
    await this.dockerComposeUp();
    this.logBusinessMessage("Docker services restarted");
  }

  // Add logBusinessMessage for compatibility
  protected logBusinessMessage(message: string): void {
    console.log(`[Business] ${message}`);
  }

  // Override startDockerProcess to actually start the Docker service for the test
  protected async startDockerProcess(
    runtime: string,
    testName: string,
    configKey: string,
    configValue: any,
  ): Promise<void> {
    const serviceName = this.generateServiceName(configKey, testName, 'bdd');
    this.logBusinessMessage(`startDockerProcess: starting service ${serviceName} for test ${testName}`);
    await this.dockerComposeUp([serviceName]);
  }

  // Graph operations are now handled by the inherited graph methods

  // V2 Server_Docker.start() business logic: setup Docker Compose, bring down then up
  async setupDockerCompose(): Promise<void> {
    this.logBusinessMessage("Setting up Docker Compose (V2 business logic)...");

    // Generate services based on configs
    const services = this.generateServices();

    // Write docker-compose.yml file
    await this.writeComposeFile(services);

    this.logBusinessMessage("Docker Compose setup complete");
  }

  // Generate services based on configs (similar to V2 Server_Docker_Compose.generateServices())
  private generateServices(): Record<string, any> {
    this.logBusinessMessage("Generating Docker Compose services from configs...");

    const services: Record<string, any> = {};

    // Add builder services
    for (const [configKey, configValue] of Object.entries(this.configs.runtimes)) {
      const builderServiceName = `${configKey}-builder`;
      services[builderServiceName] = this.generateBuilderService(configKey, configValue);
    }

    // Add test services (BDD and checks only - no aider services)
    for (const [configKey, configValue] of Object.entries(this.configs.runtimes)) {
      if (configValue.tests) {
        for (const testName of configValue.tests) {
          // BDD service
          const bddServiceName = this.generateServiceName(configKey, testName, 'bdd');
          services[bddServiceName] = this.generateBddService(configKey, configValue, testName);

          // Check services (if checks exist)
          if (configValue.checks && configValue.checks.length > 0) {
            for (let i = 0; i < configValue.checks.length; i++) {
              const checkServiceName = this.generateServiceName(configKey, testName, `check-${i}`);
              services[checkServiceName] = this.generateCheckService(configKey, configValue, testName, i);
            }
          }
        }
      }
    }


    // Add network
    services.networks = {
      allTests_network: {
        driver: 'bridge'
      }
    };

    // Add chrome service for web runtime
    services.chrome = chromeServiceConfig();

    this.logBusinessMessage(`Generated ${Object.keys(services).length} services`);
    return services;
  }

  /**
   * Generate an aider service configuration for a given test.
   * Follows V2 pattern from generateServicesPure.ts and aiderDockerComposeFile.
   */
  private generateAiderService(configKey: string, configValue: any, testName: string): any {
    return generateAiderService(this.configs, configKey, configValue, testName, this.mode, process.cwd());
  }

  // Generate service name similar to V2
  protected generateServiceName(configKey: string, testName: string, type: string): string {
    return generateServiceName(configKey, testName, type);
  }

  // Generate builder service configuration
  private generateBuilderService(configKey: string, configValue: any): any {
    return generateBuilderService(configKey, configValue, this.mode);
  }

  // Generate BDD service configuration
  private generateBddService(configKey: string, configValue: any, testName: string): any {
    return generateBddService(configKey, configValue, testName);
  }


  // Generate check service configuration
  private generateCheckService(configKey: string, configValue: any, testName: string, checkIndex: number): any {
    return generateCheckService(configKey, configValue, testName, checkIndex);
  }


  // Write docker-compose.yml file
  private async writeComposeFile(services: Record<string, any>): Promise<void> {
    const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
    this.logBusinessMessage(`Writing docker-compose.yml to ${composePath}`);

    // Create YAML content
    const yamlContent = generateYaml(services);

    const dir = path.dirname(composePath);
    const dirExists = await this.fileExists(dir);
    if (!dirExists) {
      await this.mkdir(dir, true);
    }

    // Write file
    await this.writeFile(composePath, yamlContent);
    this.logBusinessMessage(`docker-compose.yml written successfully`);
  }

  // Generate YAML from services object
  private generateYaml(services: Record<string, any>): string {
    return generateYaml(services);
  }

  // Convert value to YAML string representation
  private yamlValueToString(value: any): string {
    return yamlValueToString(value);
  }

  // Graph updates are now handled exclusively by the Docker events watcher
  // Process nodes are added/updated/removed based on container events,
  // not by creating nodes at launch time.

  async dockerComposeStart(services?: string[]): Promise<void> {
    const serviceArgs = services ? services.join(' ') : '';
    const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" start ${serviceArgs}`.trim();

    console.log(`[Server_DockerCompose] dockerComposeStart: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command);
      console.log(`[Server_DockerCompose] dockerComposeStart: ${stdout}`);
      if (stderr) console.error(`[Server_DockerCompose] dockerComposeStart stderr: ${stderr}`);
    } catch (error: any) {
      console.error(`[Server_DockerCompose] dockerComposeStart failed: ${error.message}`);
      throw error;
    }
  }

  async dockerComposeStop(services?: string[]): Promise<void> {
    const serviceArgs = services ? services.join(' ') : '';
    const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" stop ${serviceArgs}`.trim();

    console.log(`[Server_DockerCompose] dockerComposeStop: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command);
      console.log(`[Server_DockerCompose] dockerComposeStop: ${stdout}`);
      if (stderr) console.error(`[Server_DockerCompose] dockerComposeStop stderr: ${stderr}`);
    } catch (error: any) {
      console.error(`[Server_DockerCompose] dockerComposeStop failed: ${error.message}`);
      throw error;
    }
  }

  async getServiceLogs(serviceName: string, tail: number = 100): Promise<string> {
    const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" logs --tail ${tail} ${serviceName}`;

    try {
      const { stdout } = await execAsync(command);
      return stdout;
    } catch (error: any) {
      console.error(`[Server_DockerCompose] getServiceLogs failed for ${serviceName}: ${error.message}`);
      throw error;
    }
  }

  async isServiceRunning(serviceName: string): Promise<boolean> {
    try {
      const info = await getContainerInfo(serviceName);
      return info.status === 'running';
    } catch {
      return false;
    }
  }

  async restartService(serviceName: string): Promise<void> {
    const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
    const command = `docker compose -f "${composePath}" restart ${serviceName}`;

    console.log(`[Server_DockerCompose] restartService: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command);
      console.log(`[Server_DockerCompose] restartService: ${stdout}`);
      if (stderr) console.error(`[Server_DockerCompose] restartService stderr: ${stderr}`);
    } catch (error: any) {
      console.error(`[Server_DockerCompose] restartService failed for ${serviceName}: ${error.message}`);
      throw error;
    }
  }

  // ========== File Events Watcher ==========

  private fileEventsCleanup: (() => void) | null = null;

  /**
   * Start a recursive file watcher on the testeranto/ directory.
   * Produces GraphOperation objects via handleFileEventUtil and applies them
   * via applyUpdate, following the same pattern as the Docker events watcher.
   */
  protected async startFileEventsWatcher(): Promise<() => void> {
    this.logBusinessMessage("Starting file events watcher...");

    const fs = await import('fs');
    const path = await import('path');

    const watchDir = path.join(process.cwd(), 'testeranto');

    // Check if directory exists
    try {
      await fs.promises.access(watchDir);
    } catch {
      this.logBusinessMessage(`Directory ${watchDir} does not exist, skipping file events watcher`);
      return () => { };
    }

    // Use fs.watch recursively (Node.js 19+ supports recursive on macOS)
    const watcher = fs.watch(watchDir, { recursive: true }, async (eventType: string, filename: string | null) => {
      if (!filename) return;

      const fullPath = path.join(watchDir, filename);

      // Normalize path separators
      const normalizedPath = fullPath.replace(/\\/g, '/');

      // Log every file system event
      // console.log(`[FileEventsWatcher] Raw event: eventType=${eventType}, filename=${filename}, normalizedPath=${normalizedPath}`);

      // Determine event type
      let fileEventType: 'change' | 'create' | 'delete';
      if (eventType === 'rename') {
        // rename can be create or delete; check existence
        try {
          await fs.promises.access(normalizedPath);
          fileEventType = 'create';
        } catch {
          fileEventType = 'delete';
        }
      } else {
        fileEventType = 'change';
      }

      // console.log(`[FileEventsWatcher] Determined event type: ${fileEventType} for ${normalizedPath}`);

      // Read file content for non-delete events
      let content: string | undefined;
      if (fileEventType !== 'delete') {
        try {
          content = await fs.promises.readFile(normalizedPath, 'utf-8');
          // console.log(`[FileEventsWatcher] Read content for ${normalizedPath}: length=${content.length}`);
        } catch {
          // File may have been deleted between event and read
          content = undefined;
          console.log(`[FileEventsWatcher] Failed to read content for ${normalizedPath}`);
        }
      }

      // Process through handleFileEventUtil
      const { handleFileEventUtil } = await import('../utils/file/handleFileEventUtil');
      const result = handleFileEventUtil(normalizedPath, fileEventType, content, process.cwd());

      // console.log(`[FileEventsWatcher] handleFileEventUtil returned ${result.operations.length} operations for ${normalizedPath}`);

      if (result.operations.length > 0) {
        // this.logBusinessMessage(
        //   `[FileEventsWatcher] Applying ${result.operations.length} operations for ${fileEventType} on ${normalizedPath}`,
        // );
        this.applyUpdate(result);
        this.saveGraph();
        this.broadcastGraphUpdated();
      }

      // If this is a tests.json file, also call handleTestResultChange to write the completion marker
      if (filename && filename.endsWith('tests.json') && fileEventType !== 'delete') {
        this.logBusinessMessage(`[FileEventsWatcher] Detected tests.json change, calling handleTestResultChange`);
        // Extract configKey and testName from the path
        // Path format: reports/{configKey}/{testName}/tests.json
        const pathParts = filename.replace(/\\/g, '/').split('/');
        const reportsIndex = pathParts.indexOf('reports');
        if (reportsIndex !== -1 && pathParts.length >= reportsIndex + 3) {
          const configKey = pathParts[reportsIndex + 1];
          const testNameParts = pathParts.slice(reportsIndex + 2, -1);
          const testName = testNameParts.join('/');
          if (configKey && testName) {
            this.logBusinessMessage(`[FileEventsWatcher] Calling handleTestResultChange for configKey=${configKey}, testName=${testName}`);
            await this.handleTestResultChange(configKey, testName, normalizedPath);
          }
        }
      }
    });

    this.logBusinessMessage(`File events watcher started on ${watchDir}`);

    // Perform an initial scan for existing tests.json files
    this.logBusinessMessage("Performing initial scan for existing tests.json files...");
    try {
      const reportsDir = path.join(watchDir, 'reports');
      await this.scanForTestsJsonFiles(reportsDir);
    } catch (err: any) {
      this.logBusinessMessage(`Initial scan for tests.json files failed: ${err.message}`);
    }

    return () => {
      watcher.close();
      this.logBusinessMessage("Stopped file events watcher");
    };
  }

  /**
   * Recursively scan a directory for inputFiles.json and tests.json files and process them.
   * Processes inputFiles.json files first so test nodes exist before tests.json processing.
   */
  private async scanForTestsJsonFiles(dir: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or can't be read
      return;
    }

    // First pass: process inputFiles.json files to create test nodes
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanForTestsJsonFiles(fullPath);
      } else if (entry.name === 'inputFiles.json') {
        this.logBusinessMessage(`[InitialScan] Found inputFiles.json at ${fullPath}`);
        console.log(`[InitialScan] Found inputFiles.json at ${fullPath}`);
        const normalizedPath = fullPath.replace(/\\/g, '/');
        let content: string;
        try {
          content = await fs.promises.readFile(fullPath, 'utf-8');
          console.log(`[InitialScan] Read content for ${normalizedPath}: length=${content.length}`);
        } catch {
          console.log(`[InitialScan] Failed to read content for ${normalizedPath}`);
          continue;
        }
        const { handleFileEventUtil } = await import('../utils/file/handleFileEventUtil');
        const result = handleFileEventUtil(normalizedPath, 'create', content, process.cwd());
        // console.log(`[InitialScan] handleFileEventUtil returned ${result.operations.length} operations for ${normalizedPath}`);
        if (result.operations.length > 0) {
          // this.logBusinessMessage(
          //   `[InitialScan] Applying ${result.operations.length} operations for ${normalizedPath}`,
          // );
          this.applyUpdate(result);
          this.saveGraph();
          this.broadcastGraphUpdated();
        } else {
          console.log(`[InitialScan] No operations returned for ${normalizedPath}`);
        }
      }
    }

    // Second pass: process tests.json files (test nodes should now exist)
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Already scanned subdirectories in first pass, but we need to scan again for tests.json
        // This is handled by the recursive call in the first pass, but we need to ensure
        // tests.json files are processed after inputFiles.json in the same directory.
        // Since the first pass already recursed into subdirectories, we just need to
        // process tests.json files at this level.
      } else if (entry.name === 'tests.json') {
        // this.logBusinessMessage(`[InitialScan] Found tests.json at ${fullPath}`);
        // console.log(`[InitialScan] Found tests.json at ${fullPath}`);
        const normalizedPath = fullPath.replace(/\\/g, '/');
        let content: string;
        try {
          content = await fs.promises.readFile(fullPath, 'utf-8');
          // console.log(`[InitialScan] Read content for ${normalizedPath}: length=${content.length}`);
        } catch {
          console.log(`[InitialScan] Failed to read content for ${normalizedPath}`);
          continue;
        }
        // const { handleFileEventUtil } = await import('../utils/file/handleFileEventUtil');
        const result = handleFileEventUtil(normalizedPath, 'create', content, process.cwd());
        // console.log(`[InitialScan] handleFileEventUtil returned ${result.operations.length} operations for ${normalizedPath}`);
        if (result.operations.length > 0) {
          // this.logBusinessMessage(
          //   `[InitialScan] Applying ${result.operations.length} operations for ${normalizedPath}`,
          // );
          this.applyUpdate(result);
          this.saveGraph();
          this.broadcastGraphUpdated();
        } else {
          console.log(`[InitialScan] No operations returned for ${normalizedPath}`);
        }
      }
    }
  }

  // Implement abstract methods from Server class
  protected async startDockerServices(): Promise<void> {
    this.logBusinessMessage("Starting Docker services (V2 business logic)...");

    // Setup API server (technological layer)
    await this.setupApi();

    // V2 Server_Docker.start() business logic:

    // 1. Setup Docker Compose
    await this.setupDockerCompose();

    // 2. Bring down any existing services
    this.logBusinessMessage("Bringing down existing Docker services...");
    await this.dockerComposeDown();

    // 3. Start Docker events watcher BEFORE bringing services up
    // This ensures we capture start/create events for all containers
    this.logBusinessMessage("Starting Docker events watcher before bringing services up...");
    this.dockerEventsCleanup = await this.startDockerEventsWatcher();

    // 4. Start file events watcher alongside Docker watcher
    this.logBusinessMessage("Starting file events watcher...");
    this.fileEventsCleanup = await this.startFileEventsWatcher();

    // 5. Start all services (events watcher will capture their start events)
    this.logBusinessMessage("Starting all Docker services...");
    await this.dockerComposeUp();

    this.logBusinessMessage("Docker services started");
  }

  protected async stopDockerServices(): Promise<void> {
    this.logBusinessMessage("Stopping Docker services...");

    // Clean up API server
    await this.cleanupApi();

    // Clean up Docker events watcher
    if (this.dockerEventsCleanup) {
      this.dockerEventsCleanup();
      this.dockerEventsCleanup = null;
    }

    // Clean up file events watcher
    if (this.fileEventsCleanup) {
      this.fileEventsCleanup();
      this.fileEventsCleanup = null;
    }

    // Stop all Docker services
    await this.dockerComposeDown();

    this.logBusinessMessage("Docker services stopped");
  }

  protected async cleanupDockerProcesses(): Promise<void> {
    this.logBusinessMessage("Cleaning up Docker processes...");

    // Clean up any remaining Docker resources
    // This could include removing containers, networks, volumes
    // For now, just log
    this.logBusinessMessage("Docker processes cleaned up");
  }

  // Implement other abstract methods from Server class
  async checkExistingTestResults(): Promise<void> {
    this.logBusinessMessage("Checking existing test results...");
    // Implementation would check for existing test results
  }

  async initializeFileWatching(): Promise<void> {
    this.logBusinessMessage("Initializing file watching...");
    // Implementation would setup file watchers
  }

  async startLoggingForAllServices(): Promise<void> {
    this.logBusinessMessage("Starting logging for all services...");
    // Implementation would start logging for all Docker services
  }

  async stopAllFileWatchers(): Promise<void> {
    this.logBusinessMessage("Stopping all file watchers...");
    // Implementation would stop all file watchers
  }

  async startDockerEventsWatcher(callback?: (event: any) => void): Promise<() => void> {
    this.logBusinessMessage("Starting Docker events watcher...");

    const eventCallback = callback || ((event) => {
      this.handleDockerEvent(event);
    });

    const dockerEvents = spawn('docker', ['events', '--format', '{{json .}}']);

    let isRunning = true;

    dockerEvents.stdout.on('data', (data) => {
      if (!isRunning) return;

      const raw = data.toString();
      // this.logBusinessMessage(`[DockerEventsWatcher] raw data received: ${raw.substring(0, 200)}`);

      const lines = raw.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            // this.logBusinessMessage(`[DockerEventsWatcher] parsed event: type=${event.Type}, action=${event.Action || event.status}, id=${(event.id || event.Actor?.ID || '?').substring(0, 12)}`);
            eventCallback(event);
          } catch (parseError: any) {
            this.logBusinessMessage(`[DockerEventsWatcher] failed to parse line: ${line.substring(0, 100)} error=${parseError.message}`);
          }
        }
      }
    });

    dockerEvents.stderr.on('data', (data) => {
      const stderr = data.toString();
      // if (stderr.trim()) {
      //   this.logBusinessMessage(`[DockerEventsWatcher] stderr: ${stderr.substring(0, 200)}`);
      // }
    });

    dockerEvents.on('error', (err) => {
      this.logBusinessMessage(`[DockerEventsWatcher] spawn error: ${err.message}`);
      isRunning = false;
    });

    dockerEvents.on('close', (code) => {
      this.logBusinessMessage(`[DockerEventsWatcher] process closed with code ${code}`);
      isRunning = false;
    });

    this.logBusinessMessage("Docker events watcher started");

    return () => {
      if (isRunning) {
        isRunning = false;
        dockerEvents.kill();
        this.logBusinessMessage("Stopped Docker events watcher");
      }
    };
  }

  // Graph operations are handled by the inherited methods from Server_Graph
  // applyUpdate and saveGraph are available through the inheritance chain

  // Handle a Docker event and update the graph accordingly
  private handleDockerEvent(event: any): void {
    const parsed = parseDockerEvent(event);
    if (!parsed) {
      this.logBusinessMessage(`[handleDockerEvent] Could not parse event: ${JSON.stringify(event).substring(0, 200)}`);
      return;
    }

    const result = handleDockerEventUtil(
      event,
      parsed.containerId,
      parsed.action,
      parsed.serviceName,
      parsed.processType,
      parsed.configKey,
      parsed.testName,
    );

    if (result.operations.length > 0) {
      // this.logBusinessMessage(`[handleDockerEvent] Applying ${result.operations.length} operations for ${parsed.action} on ${parsed.containerId}`);
      this.applyUpdate(result);
      this.saveGraph();
      this.broadcastGraphUpdated();
    }
  }


  // ========== Aider Launching (V2 pattern) ==========

  /**
   * Get the aider service name for a given test.
   */
  private getAiderServiceName(configKey: string, testName: string): string {
    return getAiderServiceName(configKey, testName);
  }

  /**
   * Get the BDD service name for a given test.
   */
  private getBddServiceName(configKey: string, testName: string): string {
    return getBddServiceName(configKey, testName);
  }

  /**
   * Get the base service name for a given test.
   */
  private getBaseServiceName(configKey: string, testName: string): string {
    return getBaseServiceName(configKey, testName);
  }

  /**
   * Launch an aider process for the given test.
   * Follows V2 Server_Docker_Test.launchAider pattern.
   */
  async launchAider(
    runtime: string,
    testName: string,
    configKey: string,
    configValue: any,
  ): Promise<string> {
    const lockKey = `aider:${configKey}:${testName}`;
    if (this.testLaunchLocks.get(lockKey)) {
      this.logBusinessMessage(`[launchAider] Skipping ${testName} - already launching`);
      return '';
    }

    this.testLaunchLocks.set(lockKey, true);
    try {
      // Do NOT start the service here.  Return the command so the caller
      // can open a terminal and let the user execute it.
      // The Docker events watcher will detect the container when it starts
      // and create the graph node asynchronously.
      const serviceName = this.getAiderServiceName(configKey, testName);
      const composePath = `${process.cwd()}/testeranto/docker-compose.yml`;
      const command = `docker compose -f "${composePath}" up -d ${serviceName}`;
      return command;
    } finally {
      setTimeout(() => {
        this.testLaunchLocks.delete(lockKey);
      }, 5000);
    }
  }


  /**
   * Inform aider about changes (e.g., test results).
   * Follows V2 Server_Docker_Test.informAider pattern.
   */
  async informAider(
    runtime: string,
    testName: string,
    configKey: string,
    configValue: any,
    files?: any,
  ): Promise<void> {
    this.logBusinessMessage(`[informAider] Informing aider: ${testName} for config ${configKey}`);

    try {
      // Create the aider message file
      await this.createAiderMessageFile(testName, configKey);

      // Get the aider service name
      const serviceName = this.getAiderServiceName(configKey, testName);

      // Restart the aider service to pick up the new message
      await this.restartService(serviceName);

      this.logBusinessMessage(`[informAider] Aider informed and service restarted: ${serviceName}`);
    } catch (error: any) {
      this.logBusinessError(`[informAider] Failed to inform aider:`, error);
      throw error;
    }
  }

  /**
   * Get input files for a test.
   * This is a simplified version - in V2 this is handled by the parent class.
   */
  private getInputFiles(configKey: string, testName: string): string[] {
    return getInputFiles(configKey, testName);
  }

  // Process nodes are no longer added manually. The Docker events watcher
  // handles adding/updating/removing process nodes based on container events.

  // ========== Broadcast Methods ==========

  broadcastProcessStatusChanged(nodeId: string, status: string, metadata: any): void {
    this.broadcastApiMessage('resourceChanged', {
      url: `/~/processes/${nodeId}`,
      message: `Process ${nodeId} status changed to ${status}`,
      nodeId,
      status,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  broadcastContainerStatusChanged(containerId: string, status: string, serviceName: string): void {
    this.broadcastApiMessage('resourceChanged', {
      url: `/~/containers/${containerId}`,
      message: `Container ${containerId} status changed to ${status}`,
      containerId,
      status,
      serviceName,
      timestamp: new Date().toISOString()
    });
  }

  broadcastGraphUpdated(): void {
    this.broadcastApiMessage('graphUpdated', {
      message: 'Graph updated',
      timestamp: new Date().toISOString()
    });
  }
}
