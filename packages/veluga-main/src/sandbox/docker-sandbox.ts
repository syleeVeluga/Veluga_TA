import { spawn } from 'node:child_process';
import type { AuditLogger } from '../audit-logger.js';

export interface DockerSandboxSpec {
  image: string;
  network: 'none';
  readOnly: true;
  capDrop: ['ALL'];
  capAdd: [];
  securityOpt: ['no-new-privileges'];
  user: string;
  memory: string;
  cpus: string;
  timeoutSeconds: number;
  mounts: Array<{ source: string; target: string; mode: 'ro' | 'rw' }>;
}

export interface SandboxRunResult {
  command: string[];
  dockerArgs: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxed: true;
}

export const DEFAULT_DOCKER_SANDBOX_SPEC: DockerSandboxSpec = {
  image: process.env.VELUGA_SANDBOX_IMAGE ?? 'veluga-sandbox:1.0',
  network: 'none',
  readOnly: true,
  capDrop: ['ALL'],
  capAdd: [],
  securityOpt: ['no-new-privileges'],
  user: '65534:65534',
  memory: '512m',
  cpus: '1.0',
  timeoutSeconds: 30,
  mounts: []
};

export class DockerSandbox {
  constructor(private readonly spec: DockerSandboxSpec = DEFAULT_DOCKER_SANDBOX_SPEC, private readonly audit?: AuditLogger) {}

  buildDockerArgs(command: string[]): string[] {
    if (!command.length) throw new Error('sandbox command is required');
    const args = [
      'run',
      '--rm',
      '--network',
      this.spec.network,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      this.spec.securityOpt[0],
      '--user',
      this.spec.user,
      '--memory',
      this.spec.memory,
      '--cpus',
      this.spec.cpus
    ];
    for (const mount of this.spec.mounts) {
      args.push('--mount', `type=bind,source=${mount.source},target=${mount.target},readonly=${mount.mode === 'ro'}`);
    }
    return [...args, this.spec.image, ...command];
  }

  async run(command: string[], context: { userId: string; policyVersionId: string }): Promise<SandboxRunResult> {
    const dockerArgs = this.buildDockerArgs(command);
    const result = await runDocker(dockerArgs, this.spec.timeoutSeconds);
    this.audit?.append({
      session_id: 'sandbox',
      user_id: context.userId,
      event_type: 'sandbox.run',
      payload: { tool: command[0], docker_args: dockerArgs, exit_code: result.exitCode },
      policy_version_id: context.policyVersionId
    });
    return { command, dockerArgs, ...result, sandboxed: true };
  }
}

function runDocker(dockerArgs: string[], timeoutSeconds: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', dockerArgs, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout: Buffer.concat(stdout).toString('utf8'), stderr: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString('utf8');
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: timedOut ? `${stderrText}${stderrText ? '\n' : ''}sandbox command timed out after ${timeoutSeconds}s` : stderrText
      });
    });
  });
}
