import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = 'hunt-agent/hunt-agent';
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 1024 * 1024;

export interface UpdateResult {
  version: string;
  installDir?: string;
  output: string;
}

export async function runSelfUpdate(version = 'latest'): Promise<UpdateResult> {
  const repo = process.env.HUNT_AGENT_REPO || DEFAULT_REPO;
  const normalizedVersion = normalizeVersion(version);
  const installDir = detectInstallDir();
  const env = {
    ...process.env,
    HUNT_AGENT_REPO: repo,
    ...(normalizedVersion === 'latest' ? {} : { HUNT_AGENT_VERSION: normalizedVersion }),
    ...(installDir ? { HUNT_AGENT_INSTALL_DIR: installDir } : {}),
  };

  const output =
    process.platform === 'win32'
      ? await runWindowsInstaller(repo, env)
      : await runUnixInstaller(repo, env);

  return {
    version: normalizedVersion,
    installDir,
    output: compactOutput(output),
  };
}

function normalizeVersion(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'latest') return 'latest';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function detectInstallDir(): string | undefined {
  if (process.env.HUNT_AGENT_INSTALL_DIR) return process.env.HUNT_AGENT_INSTALL_DIR;
  const exe = basename(process.execPath).toLowerCase();
  if (exe === 'hunt-agent' || exe === 'hunt-agent.exe' || exe === 'hunt' || exe === 'hunt.exe')
    return dirname(process.execPath);
  return undefined;
}

async function runUnixInstaller(repo: string, env: NodeJS.ProcessEnv): Promise<string> {
  const scriptURL = `https://raw.githubusercontent.com/${repo}/main/install.sh`;
  const script = await fetchText(scriptURL);
  const dir = await mkdtemp(join(tmpdir(), 'hunt-agent-update-'));
  const file = join(dir, 'install.sh');
  try {
    await writeFile(file, script, 'utf8');
    await chmod(file, 0o755);
    const { stdout, stderr } = await execFileAsync('sh', [file], {
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return joinOutput(stdout, stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runWindowsInstaller(repo: string, env: NodeJS.ProcessEnv): Promise<string> {
  const scriptURL = `https://raw.githubusercontent.com/${repo}/main/install.ps1`;
  const command = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
    `iex ((Invoke-WebRequest -Uri ${quotePowerShell(scriptURL)} -UseBasicParsing).Content)`,
  ].join('; ');

  const shell = process.env.ComSpec ? 'powershell.exe' : 'pwsh';
  const { stdout, stderr } = await execFileAsync(
    shell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  return joinOutput(stdout, stderr);
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download failed: ${url} (${resp.status})`);
  return await resp.text();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function joinOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

function compactOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= 8) return lines.join('\n');
  return lines.slice(-8).join('\n');
}
