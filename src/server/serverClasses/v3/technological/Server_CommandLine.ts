import { exec } from 'child_process';
import { promisify } from 'util';
import type { ITesterantoConfig } from "../../../../Types";
import type { IMode } from "../../../types";
import { Server_FS } from "./Server_FS";

const execAsync = promisify(exec);

/**
 * Server_CommandLine - Technological Layer (+2)
 * 
 * Extends: Server_Runtime (+1.5)
 * Extended by: Server_HTTP (+3)
 * Provides: Command line operations
 * To be mocked in: Tests
 */
export class Server_CommandLine extends Server_FS {
  private processes: Map<string, any> = new Map();

  constructor(
    configs: ITesterantoConfig,
    mode: IMode,
    getCurrentTestResults: () => any,
    projectRoot?: string,
    resourceChangedCallback?: (path: string) => void
  ) {
    super(configs, mode, getCurrentTestResults, projectRoot, resourceChangedCallback);
  }

  // Command execution
  async execCommand(command: string, options?: any): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options?.cwd,
        shell: true,
        ...options
      });

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0
      };
    } catch (error: any) {
      return {
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || error.message,
        exitCode: error.code || 1
      };
    }
  }

  async spawnProcess(command: string, args?: string[], options?: any): Promise<any> {
    const { spawn } = await import('child_process');
    const process = spawn(command, args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });

    const processId = `process-${Date.now()}`;
    this.processes.set(processId, process);

    return {
      id: processId,
      pid: process.pid,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      kill: (signal?: string) => process.kill(signal)
    };
  }

  // Process management
  async getStdout(processId: string): Promise<string> {
    const process = this.processes.get(processId);
    if (process) {
      return new Promise((resolve, reject) => {
        let data = '';
        process.stdout.on('data', (chunk) => {
          data += chunk.toString();
        });
        process.stdout.on('end', () => {
          resolve(data);
        });
        process.stdout.on('error', reject);
      });
    }
    return `stdout for process ${processId}`;
  }

  async getStderr(processId: string): Promise<string> {
    const process = this.processes.get(processId);
    if (process) {
      return new Promise((resolve, reject) => {
        let data = '';
        process.stderr.on('data', (chunk) => {
          data += chunk.toString();
        });
        process.stderr.on('end', () => {
          resolve(data);
        });
        process.stderr.on('error', reject);
      });
    }
    return `stderr for process ${processId}`;
  }

  async killProcess(processId: string, signal?: string): Promise<void> {
    const process = this.processes.get(processId);
    if (process && process.kill) {
      process.kill(signal);
      this.processes.delete(processId);
    }
    console.log(`[Server_CommandLine] Would kill process ${processId} with signal ${signal}`);
  }

  // Process status
  async isProcessRunning(processId: string): Promise<boolean> {
    const process = this.processes.get(processId);
    return !!process;
  }

  async getProcessExitCode(processId: string): Promise<number | null> {
    const process = this.processes.get(processId);
    if (process) {
      return new Promise((resolve) => {
        process.on('exit', (code: number) => {
          resolve(code);
        });
        process.on('error', () => {
          resolve(null);
        });
      });
    }
    return null;
  }

  /**
   * Spawn a `docker build` process and return its stdout/stderr streams.
   * This is the mockable technological layer.
   */
  async spawnDockerBuild(
    buildContext: string,
    dockerfilePath: string,
  ): Promise<{ stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream }> {
    const { spawn, execSync } = await import('child_process');

    try {
      execSync('docker info', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'Docker is not available. Make sure Docker Desktop is running and `docker` is in your PATH.\n' +
        'If Docker is installed but not found, add it to your PATH:\n' +
        '  export PATH="/usr/local/bin:$PATH"'
      );
    }

    const child = spawn('docker', [
      'build',
      '-f', dockerfilePath,
      buildContext,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      stdout: child.stdout,
      stderr: child.stderr,
    };
  }
}
