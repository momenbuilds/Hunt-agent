// CLI entry: parse flags, load
// config + signal handler, build tools + skills + agent, launch the
// Ink TUI. MCP servers are spawned in parallel and torn down on exit.

// MUST be first — sets FORCE_COLOR before chalk-consuming modules
// (cli-highlight, ink-spinner, etc.) cache their color level.
import './forceColor.js';

import { type FSWatcher, existsSync, watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import { render } from 'ink';
import React from 'react';
import { Agent } from '../agent/agent.js';
import type { PromptProfile } from '../agent/systemPrompt.js';
import { type IngestServerHandle, startIngestServer } from '../browser/server.js';
import { CaptureStore } from '../browser/store.js';
import * as config from '../config/config.js';
import { CoverageStore } from '../coverage/store.js';
import { findingRequestForBurp } from '../findings/httpRequest.js';
import { Store as FindingsStore } from '../findings/store.js';
import { IntelligenceStore } from '../intelligence/store.js';
import * as llmFactory from '../llm/factory.js';
import { modelReliabilityWarning } from '../llm/modelWarnings.js';
import { detectOllamaContextWindow, probeToolSupport } from '../llm/probe.js';
import {
  GEMINI_DEFAULT_BASE_URL,
  GROQ_DEFAULT_BASE_URL,
  KIMI_DEFAULT_BASE_URL,
} from '../llm/providers.js';
import * as logger from '../logger/logger.js';
import { createSessionDebugLog } from '../logger/sessionDebug.js';
import { YoloPrompter } from '../permission/permission.js';
import {
  MODEL_ROLES,
  type ModelRole,
  ModelRouter,
  createProviderRegistry,
  formatProviderStatusTable,
} from '../providers/index.js';
import * as sessionStore from '../session/store.js';
import { skillSearchDirs } from '../skills/discovery.js';
import { LoadSkillTool } from '../skills/loadSkill.js';
import { Registry as SkillRegistry } from '../skills/registry.js';
import { newTarget } from '../target/target.js';
import { AskUserTool } from '../tools/ask.js';
import { registerBrowserCaptureTools } from '../tools/browserCapture.js';
import { CoverageTool } from '../tools/coverage.js';
import {
  FileEditTool,
  FileEditToolAlias,
  FileReadTool,
  FileReadToolAlias,
  FileWriteTool,
  FileWriteToolAlias,
} from '../tools/file.js';
import { ConfirmFindingTool } from '../tools/finding.js';
import { HTTPTool } from '../tools/http.js';
import { type MCPSession, discoverMCPTools } from '../tools/mcp.js';
import { BROWSER_MCP_NAMES, sessionMcpServers } from '../tools/mcpServers.js';
import { ReadPayloadsTool } from '../tools/payloads.js';
import { CommandPluginTool } from '../tools/plugin.js';
import { Registry as ToolRegistry } from '../tools/registry.js';
import { GlobTool, GrepTool } from '../tools/search.js';
import { BashTool, ShellTool } from '../tools/shell.js';
import { ReadSkillFileTool } from '../tools/skillFile.js';
import { WebFetchTool, WebSearchTool } from '../tools/web.js';
import { App } from '../ui/App.js';
import type { BannerData } from '../ui/Banner.js';
import { FirstRunPicker } from '../ui/FirstRunPicker.js';
import { TerminalSizeProvider } from '../ui/TerminalSize.js';
import { BridgedAskPrompter } from '../ui/askBridge.js';
import { BridgedPrompter } from '../ui/permBridge.js';
import { VERSION, describe } from '../version/version.js';

const GROQ_AUTO_COMPACT_THRESHOLD = 5500;

interface ParsedFlags {
  showVersion: boolean;
  showHelp: boolean;
  backend: string;
  model: string;
  provider: string;
  routes: string[];
  fallback: string;
  noFallback: boolean;
  baseURL: string;
  apiKey: string;
  skillsDirs: string[];
  resumeID: string;
  yolo: boolean;
  browser: boolean;
  burp: boolean;
  burpPort: number;
  noStream: boolean;
  logPath: string;
  debugSession: boolean;
  debugSessionPath: string;
  listSkills: boolean;
  listTools: boolean;
  listProviders: boolean;
  listLLMModels: boolean;
  providerStatus: boolean;
  providerAdd: string;
  providerRemove: string;
  modelUse: string;
  modelRoute: string;
  modelRoutes: boolean;
  modelFallbackRole: string;
  modelFallbackRefs: string[];
  modelStatus: boolean;
  modelTest: string;
  modelBench: boolean;
}

function parseFlags(argv: string[]): ParsedFlags {
  const out: ParsedFlags = {
    showVersion: false,
    showHelp: false,
    backend: '',
    model: '',
    provider: '',
    routes: [],
    fallback: '',
    noFallback: false,
    baseURL: '',
    apiKey: '',
    skillsDirs: [],
    resumeID: '',
    yolo: false,
    browser: false,
    burp: false,
    burpPort: 9999,
    noStream: false,
    logPath: '',
    debugSession: process.env.HUNT_AGENT_DEBUG_SESSION === '1',
    debugSessionPath: process.env.HUNT_AGENT_DEBUG_SESSION_PATH ?? '',
    listSkills: false,
    listTools: false,
    listProviders: false,
    listLLMModels: false,
    providerStatus: false,
    providerAdd: '',
    providerRemove: '',
    modelUse: '',
    modelRoute: '',
    modelRoutes: false,
    modelFallbackRole: '',
    modelFallbackRefs: [],
    modelStatus: false,
    modelTest: '',
    modelBench: false,
  };
  parseSubcommand(argv, out);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    switch (a) {
      case '--version':
      case '-v':
        out.showVersion = true;
        break;
      case '--help':
      case '-h':
        out.showHelp = true;
        break;
      case '--backend':
        out.backend = next();
        break;
      case '--model':
        out.model = next();
        break;
      case '--provider':
        out.provider = next();
        break;
      case '--route':
        out.routes.push(next());
        break;
      case '--fallback':
        out.fallback = next();
        break;
      case '--no-fallback':
        out.noFallback = true;
        break;
      case '--base-url':
        out.baseURL = next();
        break;
      case '--api-key':
        out.apiKey = next();
        break;
      case '--skills':
        out.skillsDirs = next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--resume':
        out.resumeID = next();
        break;
      case '--dangerously-skip-permissions':
        out.yolo = true;
        break;
      case '--browser':
        out.browser = true;
        break;
      case '--no-stream':
        out.noStream = true;
        break;
      case '--burp':
      case '--browser-ingest': {
        out.burp = true;
        // Optional inline port: --burp 9999. If the next arg
        // starts with '--' or is missing, fall back to the default.
        const peek = argv[i + 1];
        if (peek && !peek.startsWith('--')) {
          const n = Number.parseInt(peek, 10);
          if (Number.isFinite(n) && n > 0 && n < 65536) {
            out.burpPort = n;
            i += 1;
          }
        }
        break;
      }
      case '--log':
        out.logPath = next();
        break;
      case '--debug-session':
        out.debugSession = true;
        break;
      case '--debug-session-path':
        out.debugSession = true;
        out.debugSessionPath = next();
        break;
      case '--list-skills':
        out.listSkills = true;
        break;
      case '--list-tools':
        out.listTools = true;
        break;
      case '--list-providers':
        out.listProviders = true;
        break;
      case '--list-models':
        out.listLLMModels = true;
        break;
      case '--provider-status':
        out.providerStatus = true;
        break;
    }
  }
  return out;
}

function parseSubcommand(argv: string[], out: ParsedFlags): void {
  const subcommandStart = firstSubcommandIndex(argv);
  if (subcommandStart < 0) return;
  const head = argv[subcommandStart];
  const sub = argv[subcommandStart + 1];
  if (head === 'provider') {
    switch (sub) {
      case 'list':
        out.listProviders = true;
        break;
      case 'status':
        out.providerStatus = true;
        break;
      case 'add':
        out.providerAdd = argv[2] ?? '';
        break;
      case 'remove':
        out.providerRemove = argv[2] ?? '';
        break;
    }
    return;
  }
  if (head !== 'model') return;
  switch (sub) {
    case 'list':
      out.listLLMModels = true;
      break;
    case 'use':
      out.modelUse = argv[2] ?? '';
      break;
    case 'route':
      out.modelRoute = argv.slice(2).join(' ');
      break;
    case 'routes':
      out.modelRoutes = true;
      break;
    case 'fallback':
      out.modelFallbackRole = argv[2] ?? '';
      out.modelFallbackRefs = argv.slice(3);
      break;
    case 'status':
      out.modelStatus = true;
      break;
    case 'test':
      out.modelTest = argv[2] ?? '';
      break;
    case 'bench':
      out.modelBench = true;
      break;
  }
}

function firstSubcommandIndex(argv: string[]): number {
  const flagsWithValue = new Set([
    '--backend',
    '--model',
    '--provider',
    '--route',
    '--fallback',
    '--base-url',
    '--api-key',
    '--skills',
    '--resume',
    '--log',
    '--debug-session-path',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === 'provider' || arg === 'model') return i;
    if (flagsWithValue.has(arg)) i += 1;
  }
  return -1;
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.showVersion) {
    process.stdout.write(`${describe()}\n`);
    return 0;
  }
  if (flags.showHelp) {
    printHelp();
    return 0;
  }

  logger.init(flags.logPath);
  logger.info('startup', { version: VERSION, pid: process.pid });

  // Root abort controller — tripped by SIGINT/SIGTERM/SIGHUP so MCP
  // shutdowns, in-flight HTTP calls, and tool execs unwind cleanly.
  const rootCtl = new AbortController();
  const onSig = (s: NodeJS.Signals) => {
    logger.warn('signal received, shutting down', { signal: s });
    rootCtl.abort();
  };
  process.on('SIGINT', () => onSig('SIGINT'));
  process.on('SIGTERM', () => onSig('SIGTERM'));
  process.on('SIGHUP', () => onSig('SIGHUP'));

  // Config.
  let cfg = config.load();
  if (flags.backend) cfg = { ...cfg, backend: flags.backend as config.Config['backend'] };
  if (flags.provider) cfg.provider = flags.provider;
  if (flags.model) cfg.model = flags.model;
  if (flags.baseURL) cfg.base_url = flags.baseURL;
  if (flags.apiKey) cfg.api_key = flags.apiKey;
  if (flags.provider || flags.model) {
    cfg.models.default = routeRefFromProviderModel(
      flags.provider || cfg.provider || (cfg.backend === '' ? 'ollama' : cfg.backend),
      flags.model || cfg.model,
    );
  }
  for (const route of flags.routes) {
    const parsed = parseRouteAssignment(route);
    if (!parsed) {
      process.stderr.write(`invalid --route value "${route}" (expected role=provider:model)\n`);
      return 1;
    }
    setModelRoute(cfg, parsed.role, parsed.ref);
  }
  if (flags.fallback) {
    cfg.fallbacks.default = flags.fallback
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (flags.skillsDirs.length) cfg.skills_dirs = [...cfg.skills_dirs, ...flags.skillsDirs];
  if (cfg.backend === 'kimi' && !cfg.api_key) {
    cfg.api_key = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '';
  }
  if (cfg.backend === 'groq' && !cfg.api_key) {
    cfg.api_key = process.env.GROQ_API_KEY || '';
  }
  if (cfg.backend === 'gemini' && !cfg.api_key) {
    cfg.api_key = process.env.GEMINI_API_KEY || '';
  }

  const commandResult = await handleProviderModelCommand(flags, cfg);
  if (commandResult !== undefined) return commandResult;

  // Browser MCP is opt-in PER SESSION via --browser, and never persisted:
  // a user must pass --browser each time they want it. We build a
  // session-only server list rather than mutating cfg.mcp_servers, because
  // cfg is written back to config.json by /model and /skills — persisting
  // browser there would silently re-enable it on every future launch.
  // Without the flag we also drop any 'browser' entry an older build left
  // in config, so it can never start automatically.
  // Strip any stale browser entry from the persisted config too, so a later
  // config.save() (from /model, /skills) removes it from config.json.
  cfg.mcp_servers = cfg.mcp_servers.filter((s) => !BROWSER_MCP_NAMES.has(s.name));
  const sessionServers = sessionMcpServers(cfg.mcp_servers, flags.browser);
  if (flags.browser) {
    logger.info('browser MCP enabled for this session', { source: '--browser' });
  }

  // LLM client.
  let client: ReturnType<typeof llmFactory.newFromConfig>;
  try {
    client = llmFactory.newFromConfig(cfg, { noFallback: flags.noFallback });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  // Skills: walk built-in + project-local (.hunt-agent/skills) + user dirs.
  const skills = new SkillRegistry();
  const allSkillDirs = skillSearchDirs(cfg.skills_dirs);
  for (const d of allSkillDirs) skills.loadDir(d);
  // Apply persisted on/off state from config. Disabled skills stay in the
  // registry (so /skills can list them with [off]) but are hidden from
  // the system prompt and refused by load_skill.
  skills.setDisabledNames(cfg.disabled_skills);

  // Engagement target — shared with http tool + agent system prompt.
  const target = newTarget();

  // Bridges between agent prompters and the React tree. The publishers
  // are slotted in once the Ink App mounts; until then, prompts buffer
  // by holding the most recently set callback in these mutable holders.
  // A future polish pass will replace this with a React context provider.
  const permHolder: {
    publish: ((req: import('../ui/permBridge.js').PermissionRequest | null) => void) | null;
  } = { publish: null };
  const askHolder: {
    publish: ((req: import('../ui/askBridge.js').AskRequest | null) => void) | null;
  } = { publish: null };
  const bannerHolder: {
    publish: ((patch: Partial<BannerData>) => void) | null;
  } = { publish: null };
  // System-notice bridge — small "kind: system" appends from outside
  // the agent loop. Used by the live-reload watcher to surface
  // "skill reloaded" without spinning up a permission/ask modal.
  const noticeHolder: {
    publish: ((text: string) => void) | null;
  } = { publish: null };
  const bridgedPerm = new BridgedPrompter((req) => permHolder.publish?.(req));
  const bridgedAsk = new BridgedAskPrompter((req) => askHolder.publish?.(req));
  const prompter = new YoloPrompter(bridgedPerm, flags.yolo);
  if (flags.yolo) {
    process.stderr.write(
      '⚠  YOLO mode active: every tool call will auto-approve. Authorized engagements / lab targets only.\n',
    );
  }

  // Findings store + notifier.
  const findingsStore = new FindingsStore('findings');
  const captureStore = new CaptureStore({ maxEntries: 5000 });

  // Session id is computed up here (was previously right before Agent
  // construction) because per-session stores like CoverageStore need it
  // to derive a stable file path before tools are registered.
  const sessionDir = sessionStore.dirFromPath('');
  sessionStore.cleanupStaleTemps(sessionDir, 60_000);
  let sessionID = flags.resumeID;
  let resuming = false;
  if (!sessionID) {
    sessionID = sessionStore.newID();
  } else {
    sessionStore.validateID(sessionID);
    resuming = true;
  }
  const sessionStoreInstance = sessionStore.Store.newWithID(sessionDir, sessionID);
  const sessionDebug = createSessionDebugLog({
    enabled: flags.debugSession,
    path: flags.debugSessionPath,
    sessionID,
  });
  if (sessionDebug.enabled) {
    sessionDebug.write('session_start', {
      version: VERSION,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      resume: resuming,
      backend: cfg.backend,
      model: cfg.model,
      base_url: cfg.base_url,
    });
    process.stderr.write(`debug session log: ${sessionDebug.path}\n`);
  }

  // Coverage tracking: which (endpoint, param, vuln_class) tuples the
  // agent has tried. Persists alongside findings so resumes keep state.
  const coverageStore = new CoverageStore(`findings/coverage-${sessionID}.json`);
  const intelligenceStore = new IntelligenceStore();

  // Tools.
  const tools = new ToolRegistry();
  tools.register(new ShellTool());
  tools.register(new BashTool());
  tools.register(new FileReadTool());
  tools.register(new FileReadToolAlias());
  tools.register(new FileWriteTool());
  tools.register(new FileWriteToolAlias());
  tools.register(new FileEditTool());
  tools.register(new FileEditToolAlias());
  tools.register(new GlobTool());
  tools.register(new GrepTool());
  tools.register(new HTTPTool(target));
  tools.register(new WebFetchTool());
  tools.register(new WebSearchTool());
  tools.register(new AskUserTool(bridgedAsk));
  tools.register(
    new ConfirmFindingTool(findingsStore, (finding, path) => {
      captureStore.addBurpIssue({
        id: `finding:${finding.slug}`,
        title: finding.title,
        severity: finding.severity,
        confidence: 'Certain',
        url: finding.url,
        method: finding.method,
        parameter: finding.parameter,
        detail: [
          finding.impact,
          finding.responseExcerpt ? `\nEvidence:\n${finding.responseExcerpt}` : '',
          finding.curl ? `\nReproduce:\n${finding.curl}` : '',
        ].join('\n'),
        remediation: finding.remediation,
        path,
        rawRequestB64: Buffer.from(findingRequestForBurp(finding), 'utf8').toString('base64'),
      });
    }),
  );
  tools.register(new LoadSkillTool(skills));
  tools.register(new ReadPayloadsTool(skills));
  tools.register(new ReadSkillFileTool(skills));
  tools.register(new CoverageTool(coverageStore));
  for (const p of cfg.plugins) tools.register(new CommandPluginTool(p));

  // Burp/browser ingest server + capture-aware tools. The server only binds
  // when --burp is set; the tools are always registered so
  // the agent can call _status and learn the extension isn't running.
  registerBrowserCaptureTools((t) => tools.register(t), captureStore);
  let ingestHandle: IngestServerHandle | null = null;
  const startBurpBridge = async (
    port = flags.burpPort,
  ): Promise<{ url: string; alreadyRunning: boolean }> => {
    if (ingestHandle) return { url: ingestHandle.url, alreadyRunning: true };
    ingestHandle = await startIngestServer({
      store: captureStore,
      port,
      onEvent: (text) => noticeHolder.publish?.(text),
    });
    return { url: ingestHandle.url, alreadyRunning: false };
  };
  const closeBurpBridge = async (): Promise<void> => {
    const handle = ingestHandle as IngestServerHandle | null;
    if (handle) await handle.close();
  };
  if (flags.burp) {
    try {
      const result = await startBurpBridge(flags.burpPort);
      process.stderr.write(
        `Hunt-agent Burp bridge listening at ${result.url} — set this URL in the Burp plugin.\n`,
      );
    } catch (err) {
      process.stderr.write(
        `warning: --burp failed to start on :${flags.burpPort}: ${(err as Error).message}\n`,
      );
    }
  }

  // Spawn MCP children in parallel. Each child does its own handshake +
  // tool discovery, which can include network I/O (e.g. `npx -y ...`
  // fetching a package on first run) — running them serially multiplied
  // startup time linearly by the number of MCP servers.
  const mcpResults = await Promise.allSettled(sessionServers.map((s) => discoverMCPTools(s)));
  const mcpSessions: MCPSession[] = [];
  mcpResults.forEach((res, i) => {
    const s = sessionServers[i];
    if (!s) return;
    if (res.status === 'fulfilled') {
      mcpSessions.push(res.value.session);
      for (const t of res.value.tools) tools.register(t);
    } else {
      const err = res.reason instanceof Error ? res.reason.message : String(res.reason);
      process.stderr.write(`mcp ${s.name}: ${err}\n`);
    }
  });

  // List-and-exit modes.
  if (flags.listSkills) {
    for (const sk of skills.list()) {
      process.stdout.write(`- ${sk.name}\n    ${sk.description}\n    (${sk.path})\n`);
    }
    await Promise.all(mcpSessions.map((s) => s.close()));
    await closeBurpBridge();
    return 0;
  }
  if (flags.listTools) {
    for (const n of tools.names()) {
      const t = tools.get(n);
      const gated = t?.requiresPermission() ? ' [permission required]' : '';
      process.stdout.write(`- ${n}${gated}\n    ${t?.description() ?? ''}\n`);
    }
    await Promise.all(mcpSessions.map((s) => s.close()));
    await closeBurpBridge();
    return 0;
  }

  // First-run setup. Asked exactly once, before the agent is built (so
  // the system prompt is constructed with the chosen profile). The
  // answer persists in ~/.hunt-agent/config.json so subsequent
  // launches skip this step.
  if (cfg.tooling_profile === undefined) {
    const picked = await runFirstRunPicker();
    if (picked === null) {
      await Promise.all(mcpSessions.map((s) => s.close()));
      process.stderr.write('first-run setup cancelled — exiting.\n');
      return 0;
    }
    cfg.tooling_profile = picked;
    try {
      await config.save(cfg);
    } catch (err) {
      process.stderr.write(
        `warning: could not persist tooling_profile: ${(err as Error).message}\n`,
      );
    }
  }

  // Session + agent. (sessionID + sessionStoreInstance were created up
  // top so coverage / future per-session stores can reuse them.)
  const agent = new Agent({
    client,
    tools,
    skills,
    prompter,
    store: sessionStoreInstance,
    target,
    thinkingEnabled: cfg.thinking_enabled,
    maxSteps: cfg.max_steps > 0 ? cfg.max_steps : undefined,
    autoCompactThreshold: effectiveAutoCompactThreshold(cfg),
    toolingProfile: cfg.tooling_profile,
    promptProfile: effectivePromptProfile(cfg),
    intelligence: intelligenceStore,
    // --no-stream takes precedence over the config default so users can
    // toggle off streaming for a single launch without rewriting config.
    streamingEnabled: flags.noStream ? false : cfg.streaming_enabled,
  });

  let resumeSummary = '';
  if (resuming) {
    try {
      agent.resumeSaved();
      resumeSummary = buildResumeSummary(sessionID, agent.formatMemory());
    } catch (err) {
      process.stderr.write(`resume: ${(err as Error).message}\n`);
      return 1;
    }
  }

  // Live skill reload. fs.watch each loaded skill directory; on any
  // change, debounce 250 ms, clear the registry, re-walk every dir,
  // re-apply the disabled-skills set, and tell the agent to rebuild
  // its system prompt so the change takes effect on the next turn.
  // We surface a one-line system notice in the transcript so the user
  // can confirm the reload landed.
  const skillDirsToWatch = allSkillDirs.filter((d) => existsSync(d));
  const watchers: FSWatcher[] = [];
  let reloadTimer: NodeJS.Timeout | null = null;
  const triggerReload = (): void => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      try {
        skills.clear();
        for (const d of skillDirsToWatch) skills.loadDir(d);
        // Persisted disabled state stays — only what's on disk changes.
        skills.setDisabledNames(cfg.disabled_skills);
        agent.rebuildFromSkills();
        const count = skills.listEnabled().length;
        noticeHolder.publish?.(`skills: reloaded (${count} enabled)`);
        logger.info('skills reloaded', { enabled: count, total: skills.list().length });
      } catch (err) {
        logger.warn('skills reload failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }, 250);
  };
  const watchedDirs = new Set<string>();
  const watchDir = (d: string): void => {
    if (watchedDirs.has(d) || !existsSync(d)) return;
    watchedDirs.add(d);
    try {
      // Recursive watching keeps payloads/ + nested dirs covered too.
      // Not supported on every libuv platform; fall back to a shallow
      // watch and rely on debounced full-reload for inner-file events.
      watchers.push(fsWatch(d, { recursive: true }, triggerReload));
    } catch {
      try {
        watchers.push(fsWatch(d, triggerReload));
      } catch {
        // best-effort — a watcher failure shouldn't block startup.
      }
    }
  };
  for (const d of skillDirsToWatch) watchDir(d);

  // When the user scaffolds a skill via `/skills new`, its dir (e.g.
  // ./.hunt-agent/skills) may not have existed at startup, so it wasn't being
  // watched. Add it to the reload walk + a watcher so subsequent edits
  // hot-reload like any other skill.
  const onSkillCreated = (skillRootDir: string): void => {
    if (!skillDirsToWatch.includes(skillRootDir)) skillDirsToWatch.push(skillRootDir);
    watchDir(skillRootDir);
    triggerReload();
  };

  // Banner data.
  const bannerData: BannerData = {
    provider: providerLabel(cfg.backend),
    model: client.model() || cfg.model || '(unset)',
    endpoint: cfg.base_url || defaultEndpoint(cfg.backend),
    state: localityFor(cfg.backend),
    status: `Session ${sessionID.slice(0, 8)} — type /help to begin`,
    cwd: prettyCwd(),
    toolSupport: 'probing',
  };

  // Probe the active model in the background. Two probes:
  //   1. Tool-calling: does this model emit `tool_calls`? If not, the
  //      agent loop spins until max_steps every turn — we'd rather show
  //      a banner pill so the user notices before sending a prompt.
  //   2. Ollama num_ctx: if smaller than auto_compact_threshold, the
  //      backend silently truncates input. Warn so the user can bump it.
  //
  // Both probes are best-effort; errors collapse to 'unknown' state and
  // never block startup. Re-run after every applyProvider() so a /model
  // swap re-probes the new model.
  const runProbes = async (signal: AbortSignal): Promise<void> => {
    bannerHolder.publish?.({ toolSupport: 'probing', contextWindow: undefined });
    const modelWarning = modelReliabilityWarning(cfg.backend, agent.client.model());
    if (modelWarning) {
      process.stderr.write(`${modelWarning}\n`);
      noticeHolder.publish?.(modelWarning);
    }
    const probeP = probeToolSupport(agent.client, signal).then((r) => {
      bannerHolder.publish?.({ toolSupport: r.toolSupport });
      if (r.toolSupport === 'no' && r.detail) {
        process.stderr.write(`⚠  model ${agent.client.model()}: ${r.detail}\n`);
      }
    });
    const ctxP =
      cfg.backend === 'ollama' || cfg.backend === ''
        ? detectOllamaContextWindow(
            cfg.base_url || defaultEndpoint(cfg.backend),
            agent.client.model(),
            signal,
          ).then((info) => {
            if (!info) return;
            bannerHolder.publish?.({ contextWindow: info.numCtx });
            const threshold = agent.getAutoCompactThreshold();
            // Heuristic: warn when num_ctx is smaller than 1.5x the
            // auto-compact threshold. The agent compacts at `threshold`
            // tokens, but the prompt itself (system + skills + tools)
            // also occupies the window — 1.5x leaves a sane buffer.
            if (threshold > 0 && info.numCtx < Math.floor(threshold * 1.5)) {
              process.stderr.write(
                `⚠  ollama num_ctx is ${info.numCtx} (source: ${info.source}), but auto-compact threshold is ${threshold}. Conversations will silently truncate. Bump with: ollama show <m> --modelfile > m && echo "PARAMETER num_ctx 32768" >> m && ollama create <m>-32k -f m\n`,
              );
            }
          })
        : Promise.resolve();
    await Promise.allSettled([probeP, ctxP]);
  };
  void runProbes(rootCtl.signal);

  // Mount the Ink app; wire bridge publishers into its dispatch via
  // bindPermPublisher / bindAskPublisher. The agent goroutine pushes
  // PermissionRequest / AskRequest through the bridges; the App reducer
  // surfaces them as modals. readConfig / applyProvider feed the
  // interactive /provider + /model pickers.
  const inkApp = render(
    React.createElement(
      TerminalSizeProvider,
      null,
      React.createElement(App, {
        agent,
        bannerData,
        parentSignal: rootCtl.signal,
        yoloInitial: flags.yolo,
        bindPermPublisher: (publish) => {
          permHolder.publish = publish;
        },
        bindAskPublisher: (publish) => {
          askHolder.publish = publish;
        },
        bindBannerPublisher: (publish) => {
          bannerHolder.publish = publish;
        },
        bindNoticePublisher: (publish) => {
          noticeHolder.publish = publish;
        },
        resumeSummary,
        sessionDebug,
        setYolo: (on: boolean) => prompter.setYolo(on),
        onSkillCreated,
        readConfig: () => ({
          backend: cfg.backend,
          baseURL: cfg.base_url,
          apiKey: cfg.api_key,
          model: cfg.model,
        }),
        persistDisabledSkills: async (names: string[]) => {
          cfg.disabled_skills = [...names].sort();
          await config.save(cfg);
        },
        applyProvider: async (change) => {
          cfg.backend = change.backend;
          cfg.model = change.model;
          if (change.baseURL !== undefined) cfg.base_url = change.baseURL;
          if (change.apiKey !== undefined) cfg.api_key = change.apiKey;
          const next = llmFactory.newFromConfig(cfg, { noFallback: flags.noFallback });
          agent.setClient(next);
          agent.setAutoCompactThreshold(effectiveAutoCompactThreshold(cfg));
          agent.setPromptProfile(effectivePromptProfile(cfg));
          await config.save(cfg);
          // New client → re-probe so the banner pill reflects the new
          // model's capabilities, not the old one's.
          bannerHolder.publish?.({
            provider: providerLabel(cfg.backend),
            model: next.model() || cfg.model || '(unset)',
            endpoint: cfg.base_url || defaultEndpoint(cfg.backend),
            state: localityFor(cfg.backend),
          });
          void runProbes(rootCtl.signal);
        },
        runProviderCommand: async (args: string[]) => providerCommandText(args, cfg),
        runModelCommand: async (args: string[]) =>
          modelCommandText(args, cfg, flags.noFallback, async () => {
            const next = llmFactory.newFromConfig(cfg, { noFallback: flags.noFallback });
            agent.setClient(next);
            bannerHolder.publish?.({
              provider: providerLabel(cfg.backend),
              model: next.model() || cfg.models.default || cfg.model || '(unset)',
              endpoint: cfg.base_url || defaultEndpoint(cfg.backend),
              state: localityFor(cfg.backend),
            });
            void runProbes(rootCtl.signal);
          }),
        startBurpBridge,
      }),
    ),
    {
      exitOnCtrlC: false, // we handle Ctrl-C explicitly to abort the agent first
    },
  );

  await inkApp.waitUntilExit();
  sessionDebug.write('session_exit');
  // Trip the root abort signal before tearing down MCP sessions and the
  // ingest server. The TUI's own Ctrl-C path aborts the per-run signal
  // (runCtl) and then calls exit(), but never the root signal — so any
  // background tool that holds rootCtl.signal (e.g. plugins, long-lived
  // MCP requests) would otherwise keep running while we close.
  rootCtl.abort();
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* best-effort */
    }
  }
  if (reloadTimer) clearTimeout(reloadTimer);
  await Promise.all(mcpSessions.map((s) => s.close()));
  await closeBurpBridge();
  return 0;
}

// ---------- helpers ----------

async function providerCommandText(args: string[], cfg: config.Config): Promise<string> {
  const sub = args[0]?.toLowerCase() ?? '';
  switch (sub) {
    case 'list':
    case 'status': {
      const registry = createProviderRegistry(llmFactory.runtimeFromConfig(cfg));
      return formatProviderStatusTable(await registry.statuses());
    }
    case 'add': {
      const id = args[1] ?? '';
      if (!id) throw new Error('usage: /provider add <provider>');
      cfg.providers[id] = {
        ...providerConfigForAdd(id),
        ...(cfg.providers[id] ?? {}),
        enabled: true,
      };
      await config.save(cfg);
      return `provider ${id} enabled\n${providerSetupHint(id)}`;
    }
    case 'remove': {
      const id = args[1] ?? '';
      if (!id) throw new Error('usage: /provider remove <provider>');
      const current = cfg.providers[id] ?? providerConfigForAdd(id);
      cfg.providers[id] = { ...current, enabled: false };
      await config.save(cfg);
      return `provider ${id} disabled`;
    }
    default:
      throw new Error('usage: /provider list|status|add <provider>|remove <provider>');
  }
}

async function modelCommandText(
  args: string[],
  cfg: config.Config,
  noFallback: boolean,
  onChanged: () => Promise<void>,
): Promise<string> {
  const sub = args[0]?.toLowerCase() ?? '';
  switch (sub) {
    case 'use': {
      const ref = args[1] ?? '';
      if (!ref) throw new Error('usage: /model use <provider:model>');
      cfg.models.default = ref;
      await config.save(cfg);
      await onChanged();
      return `default model route set to ${ref}`;
    }
    case 'route': {
      const role = parseModelRole(args[1] ?? '');
      const ref = args[2] ?? '';
      if (!role || !ref) throw new Error('usage: /model route <role> <provider:model>');
      setModelRoute(cfg, role, ref);
      await config.save(cfg);
      await onChanged();
      return `${role} route set to ${ref}`;
    }
    case 'routes':
      return formatRoutes(cfg);
    case 'fallback': {
      const role = parseModelRole(args[1] ?? '');
      const refs = args.slice(2);
      if (!role || refs.length === 0) {
        throw new Error('usage: /model fallback <role> <provider:model>...');
      }
      cfg.fallbacks[role] = refs;
      await config.save(cfg);
      return `${role} fallback chain set to ${refs.join(', ')}`;
    }
    case 'status': {
      const runtime = llmFactory.runtimeFromConfig(cfg);
      const registry = createProviderRegistry(runtime);
      const router = new ModelRouter({
        registry,
        models: runtime.models,
        fallbacks: runtime.fallbacks,
        configuredProviderIds: configuredProviderIds(runtime),
        noFallback,
      });
      const result = await router.resolve('default', { messages: [] });
      const status = await result.resolved.provider.getStatus();
      return [
        `selected: ${result.resolved.providerId}:${result.resolved.model || '(unset)'}`,
        `status: ${status.status} · ${status.message}`,
        `capabilities: ${formatCapabilities(result.resolved.provider.capabilities)}`,
      ].join('\n');
    }
    case 'test': {
      const ref = args[1] ?? '';
      if (!ref) throw new Error('usage: /model test <provider:model>');
      const runtime = llmFactory.runtimeFromConfig(cfg);
      const registry = createProviderRegistry(runtime);
      const resolved = registry.resolveModelRef(ref, defaultProviderId(runtime));
      const start = Date.now();
      const response = await resolved.provider.complete({
        role: 'cheap',
        model: resolved.model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      return `ok ${resolved.providerId}:${resolved.model} (${Date.now() - start}ms)\n${response.content.trim()}`;
    }
    case 'bench': {
      const runtime = llmFactory.runtimeFromConfig(cfg);
      return runMiniBench(createProviderRegistry(runtime), runtime);
    }
    default:
      throw new Error(
        'usage: /model use|route|routes|fallback|status|test|bench (use /model list for the picker)',
      );
  }
}

async function handleProviderModelCommand(
  flags: ParsedFlags,
  cfg: config.Config,
): Promise<number | undefined> {
  if (flags.providerAdd) {
    cfg.providers[flags.providerAdd] = {
      ...providerConfigForAdd(flags.providerAdd),
      ...(cfg.providers[flags.providerAdd] ?? {}),
      enabled: true,
    };
    await config.save(cfg);
    process.stdout.write(`provider ${flags.providerAdd} enabled\n`);
    process.stdout.write(`${providerSetupHint(flags.providerAdd)}\n`);
    return 0;
  }
  if (flags.providerRemove) {
    const current =
      cfg.providers[flags.providerRemove] ?? providerConfigForAdd(flags.providerRemove);
    cfg.providers[flags.providerRemove] = { ...current, enabled: false };
    await config.save(cfg);
    process.stdout.write(`provider ${flags.providerRemove} disabled\n`);
    return 0;
  }
  if (flags.modelUse) {
    cfg.models.default = flags.modelUse;
    await config.save(cfg);
    process.stdout.write(`default model route set to ${flags.modelUse}\n`);
    return 0;
  }
  if (flags.modelRoute) {
    const parsed = parseModelRouteCommand(flags.modelRoute);
    if (!parsed) {
      process.stderr.write('usage: hunt-agent model route <role> <provider:model>\n');
      return 1;
    }
    setModelRoute(cfg, parsed.role, parsed.ref);
    await config.save(cfg);
    process.stdout.write(`${parsed.role} route set to ${parsed.ref}\n`);
    return 0;
  }
  if (flags.modelFallbackRole) {
    const role = parseModelRole(flags.modelFallbackRole);
    if (!role || flags.modelFallbackRefs.length === 0) {
      process.stderr.write('usage: hunt-agent model fallback <role> <provider:model>...\n');
      return 1;
    }
    cfg.fallbacks[role] = flags.modelFallbackRefs;
    await config.save(cfg);
    process.stdout.write(`${role} fallback chain set to ${flags.modelFallbackRefs.join(', ')}\n`);
    return 0;
  }
  if (flags.modelRoutes) {
    process.stdout.write(formatRoutes(cfg));
    return 0;
  }
  if (
    flags.listProviders ||
    flags.providerStatus ||
    flags.listLLMModels ||
    flags.modelStatus ||
    flags.modelTest ||
    flags.modelBench
  ) {
    const runtime = llmFactory.runtimeFromConfig(cfg);
    const registry = createProviderRegistry(runtime);
    if (flags.listProviders || flags.providerStatus) {
      process.stdout.write(`${formatProviderStatusTable(await registry.statuses())}\n`);
      return 0;
    }
    if (flags.listLLMModels) {
      const models = await registry.listModels();
      process.stdout.write(`${formatModels(models)}\n`);
      return 0;
    }
    if (flags.modelStatus) {
      const router = new ModelRouter({
        registry,
        models: runtime.models,
        fallbacks: runtime.fallbacks,
        configuredProviderIds: configuredProviderIds(runtime),
        noFallback: flags.noFallback,
      });
      const result = await router.resolve('default', { messages: [] });
      const status = await result.resolved.provider.getStatus();
      const text = [
        `selected: ${result.resolved.providerId}:${result.resolved.model || '(unset)'}`,
        `status: ${status.status} · ${status.message}`,
        `capabilities: ${formatCapabilities(result.resolved.provider.capabilities)}`,
        result.attempts.length
          ? `skipped:\n${result.attempts.map((a) => `- ${a.ref}: ${a.reason}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      process.stdout.write(`${text}\n`);
      return 0;
    }
    if (flags.modelTest) {
      const resolved = registry.resolveModelRef(flags.modelTest, defaultProviderId(runtime));
      const start = Date.now();
      const response = await resolved.provider.complete({
        role: 'cheap',
        model: resolved.model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      process.stdout.write(
        `ok ${resolved.providerId}:${resolved.model} (${Date.now() - start}ms)\n${response.content.trim()}\n`,
      );
      return 0;
    }
    if (flags.modelBench) {
      process.stdout.write(await runMiniBench(registry, runtime));
      return 0;
    }
  }
  return undefined;
}

function providerConfigForAdd(id: string): config.ProviderConfig {
  switch (id) {
    case 'codex-cli':
      return fullProviderConfig({
        type: 'local-cli',
        command: 'codex',
        args: ['exec', '--skip-git-repo-check', '-'],
        inputMode: 'stdin',
      });
    case 'claude-code':
      return fullProviderConfig({
        type: 'local-cli',
        command: 'claude',
        args: ['-p'],
        inputMode: 'argument',
      });
    case 'ollama':
      return fullProviderConfig({ type: 'local-llm', baseUrl: 'http://localhost:11434' });
    case 'lmstudio':
      return fullProviderConfig({
        type: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
      });
    case 'openai':
      return fullProviderConfig({
        type: 'api',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
      });
    case 'anthropic':
      return fullProviderConfig({
        type: 'api',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      });
    case 'openrouter':
      return fullProviderConfig({
        type: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKeyEnv: 'OPENROUTER_API_KEY',
      });
    case 'groq':
      return fullProviderConfig({
        type: 'openai-compatible',
        baseUrl: GROQ_DEFAULT_BASE_URL,
        apiKeyEnv: 'GROQ_API_KEY',
      });
    case 'gemini':
      return fullProviderConfig({
        type: 'api',
        baseUrl: GEMINI_DEFAULT_BASE_URL,
        apiKeyEnv: 'GEMINI_API_KEY',
      });
    case 'kimi':
      return fullProviderConfig({
        type: 'openai-compatible',
        baseUrl: KIMI_DEFAULT_BASE_URL,
        apiKeyEnv: 'MOONSHOT_API_KEY',
      });
    default:
      return fullProviderConfig({ type: 'openai-compatible', enabled: false });
  }
}

function fullProviderConfig(
  partial: Partial<config.ProviderConfig> & { type: config.ProviderConfig['type'] },
): config.ProviderConfig {
  return {
    enabled: true,
    name: undefined,
    baseUrl: '',
    apiKeyEnv: '',
    apiKey: '',
    model: '',
    models: [],
    command: '',
    args: [],
    inputMode: 'stdin',
    outputMode: 'stdout',
    shell: false,
    timeoutMs: undefined,
    maxOutputBytes: undefined,
    allowInteractive: false,
    ...partial,
  };
}

function providerSetupHint(id: string): string {
  switch (id) {
    case 'codex-cli':
      return 'Run `codex` and sign in through the official Codex CLI flow. Hunt never reads Codex credential files.';
    case 'claude-code':
      return 'Run `claude` and sign in through Claude Code or configure Anthropic-supported API auth. Hunt never reads Claude OAuth files, browser cookies, or keychains.';
    case 'ollama':
      return 'Start Ollama and pull a model, for example `ollama pull qwen2.5-coder:14b`.';
    case 'lmstudio':
      return 'Start the LM Studio local server and load a model.';
    default: {
      const cfg = providerConfigForAdd(id);
      return cfg.apiKeyEnv
        ? `Set ${cfg.apiKeyEnv} in your environment.`
        : 'Edit providers config with baseUrl/apiKeyEnv/model as needed.';
    }
  }
}

function parseRouteAssignment(value: string): { role: ModelRole; ref: string } | null {
  const idx = value.indexOf('=');
  if (idx <= 0) return null;
  const role = parseModelRole(value.slice(0, idx));
  const ref = value.slice(idx + 1).trim();
  return role && ref ? { role, ref } : null;
}

function parseModelRouteCommand(value: string): { role: ModelRole; ref: string } | null {
  const [roleRaw, ...rest] = value.trim().split(/\s+/);
  const role = parseModelRole(roleRaw ?? '');
  const ref = rest.join(' ').trim();
  return role && ref ? { role, ref } : null;
}

function parseModelRole(value: string): ModelRole | null {
  return MODEL_ROLES.includes(value as ModelRole) ? (value as ModelRole) : null;
}

function setModelRoute(cfg: config.Config, role: ModelRole, ref: string): void {
  (cfg.models as Partial<Record<ModelRole, string>>)[role] = ref;
}

function routeRefFromProviderModel(providerId: string, model: string): string {
  if (!model) return providerId;
  if (knownProviderPrefix(model)) return model;
  return providerId ? `${providerId}:${model}` : model;
}

function knownProviderPrefix(ref: string): boolean {
  const idx = ref.indexOf(':');
  if (idx <= 0) return false;
  return BUILT_IN_PROVIDER_IDS.has(ref.slice(0, idx));
}

function formatRoutes(cfg: config.Config): string {
  const lines = ['Model routes'];
  for (const role of MODEL_ROLES) {
    const ref = (cfg.models as Partial<Record<ModelRole, string>>)[role];
    if (ref) lines.push(`- ${role}: ${ref}`);
  }
  lines.push('', 'Fallbacks');
  for (const role of MODEL_ROLES) {
    const refs = (cfg.fallbacks as Partial<Record<ModelRole, string[]>>)[role];
    if (refs?.length) lines.push(`- ${role}: ${refs.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatModels(
  models: Awaited<ReturnType<ReturnType<typeof createProviderRegistry>['listModels']>>,
): string {
  if (models.length === 0) return 'no models found';
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const list = groups.get(model.provider) ?? [];
    list.push(model.id);
    groups.set(model.provider, list);
  }
  const out: string[] = [];
  for (const [provider, ids] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`${provider}:`);
    for (const id of ids) out.push(`- ${provider}:${id}`);
  }
  return out.join('\n');
}

function formatCapabilities(c: {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  longContext: boolean;
  local: boolean;
  requiresApiKey: boolean;
  requiresExternalCli: boolean;
}): string {
  return [
    c.streaming ? 'streaming' : '',
    c.toolCalling ? 'tool-calling' : '',
    c.jsonMode ? 'json' : '',
    c.vision ? 'vision' : '',
    c.longContext ? 'long-context' : '',
    c.local ? 'local' : 'remote',
    c.requiresApiKey ? 'api-key' : '',
    c.requiresExternalCli ? 'external-cli' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function configuredProviderIds(runtime: ReturnType<typeof llmFactory.runtimeFromConfig>): string[] {
  const ids = new Set<string>();
  for (const [id, cfg] of Object.entries(runtime.providers)) {
    if (cfg.enabled !== false) ids.add(id);
  }
  for (const ref of [
    ...Object.values(runtime.models),
    ...Object.values(runtime.fallbacks).flatMap((refs) => refs ?? []),
  ]) {
    if (!ref) continue;
    const idx = ref.indexOf(':');
    ids.add(idx > 0 ? ref.slice(0, idx) : ref);
  }
  return [...ids];
}

function defaultProviderId(runtime: ReturnType<typeof llmFactory.runtimeFromConfig>): string {
  const ref = runtime.models.default;
  if (!ref) return configuredProviderIds(runtime)[0] ?? 'ollama';
  const idx = ref.indexOf(':');
  return idx > 0 && BUILT_IN_PROVIDER_IDS.has(ref.slice(0, idx)) ? ref.slice(0, idx) : ref;
}

async function runMiniBench(
  registry: ReturnType<typeof createProviderRegistry>,
  runtime: ReturnType<typeof llmFactory.runtimeFromConfig>,
): Promise<string> {
  const ids = configuredProviderIds(runtime);
  const lines = ['Model bench'];
  for (const id of ids) {
    const provider = registry.get(id);
    if (!provider) continue;
    const status = await provider.getStatus();
    if (!status.healthy) {
      lines.push(`- ${id}: skipped (${status.message})`);
      continue;
    }
    const model = provider.defaultModel ?? id;
    const start = Date.now();
    try {
      const response = await provider.complete({
        role: 'cheap',
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      });
      lines.push(
        `- ${id}:${model} ${Date.now() - start}ms · ${response.content.trim().slice(0, 40)}`,
      );
    } catch (err) {
      lines.push(`- ${id}:${model} failed · ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const BUILT_IN_PROVIDER_IDS = new Set([
  'ollama',
  'lmstudio',
  'openai-compat',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'gemini',
  'kimi',
  'deepseek',
  'xai',
  'mistral',
  'together',
  'fireworks',
  'cohere',
  'codex-cli',
  'claude-code',
]);

function providerLabel(b: string): string {
  switch (b) {
    case 'ollama':
    case '':
      return 'Ollama';
    case 'lmstudio':
      return 'LM Studio';
    case 'openai-compat':
      return 'OpenAI-compatible';
    case 'kimi':
      return 'Kimi';
    case 'groq':
      return 'Groq';
    case 'gemini':
      return 'Gemini';
    default:
      return b;
  }
}

function localityFor(b: string): string {
  return b === 'openai-compat' || b === 'kimi' || b === 'groq' || b === 'gemini'
    ? 'remote'
    : 'local';
}

function defaultEndpoint(b: string): string {
  switch (b) {
    case 'ollama':
    case '':
      return 'http://localhost:11434';
    case 'lmstudio':
      return 'http://localhost:1234/v1';
    case 'kimi':
      return KIMI_DEFAULT_BASE_URL;
    case 'groq':
      return GROQ_DEFAULT_BASE_URL;
    case 'gemini':
      return GEMINI_DEFAULT_BASE_URL;
    default:
      return '';
  }
}

function effectiveAutoCompactThreshold(cfg: config.Config): number {
  if (cfg.backend !== 'groq') return cfg.auto_compact_threshold;
  if (cfg.auto_compact_threshold <= 0) return GROQ_AUTO_COMPACT_THRESHOLD;
  return Math.min(cfg.auto_compact_threshold, GROQ_AUTO_COMPACT_THRESHOLD);
}

function effectivePromptProfile(cfg: config.Config): PromptProfile {
  return cfg.backend === 'groq' || cfg.backend === 'gemini' ? 'compact' : 'full';
}

function buildResumeSummary(sessionID: string, memory: string): string {
  return [`Resumed session ${sessionID}`, '', 'Previous session recap:', '', memory].join('\n');
}

function prettyCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

/**
 * Show the first-run picker as a transient Ink scene and resolve with
 * the user's choice. Returns null if they Esc'd or Ctrl-C'd out. Uses
 * its own Ink render() so we mount + unmount cleanly before the main
 * TUI takes over the terminal.
 */
async function runFirstRunPicker(): Promise<config.ToolingProfile | null> {
  return new Promise((resolveOuter) => {
    let picked: config.ToolingProfile | null = null;
    const tree = React.createElement(
      TerminalSizeProvider,
      null,
      React.createElement(FirstRunPicker, {
        onPick: (p) => {
          picked = p;
          inkApp.unmount();
        },
        onCancel: () => {
          picked = null;
          inkApp.unmount();
        },
      }),
    );
    const inkApp = render(tree, { exitOnCtrlC: false });
    void inkApp.waitUntilExit().then(() => resolveOuter(picked));
  });
}

function printHelp(): void {
  process.stdout.write(`hunt-agent ${VERSION}

Usage:
  hunt-agent [flags]

Flags:
  --backend ollama|lmstudio|openai-compat|kimi|groq|gemini
  --provider <id>           provider for the default model route
  --model <id>
  --route role=provider:model
  --fallback provider:model[,provider:model...]
  --no-fallback             disable fallback routing for status/resolve checks
  --base-url <url>
  --api-key <key>
  --skills <dirs>            comma-separated extra skill directories
  --resume <session-id>
  --browser                  enable Browser MCP for this session only (not persisted)
  --burp [port]              start local Burp/hunt-agent bridge (default :9999)
  --browser-ingest [port]    deprecated alias for --burp
  --no-stream                disable streaming chat (fallback for backends
                             whose SSE/ND-JSON path drops tool_calls)
  --dangerously-skip-permissions   YOLO mode
  --list-skills / --list-tools
  --list-providers / --provider-status / --list-models
  --log <path>
  --debug-session           write a complete JSONL session debug log
  --debug-session-path <p>  custom path for --debug-session
  --version / --help

Commands:
  hunt-agent provider list|status|add <provider>|remove <provider>
  hunt-agent model list|use <provider:model>|route <role> <provider:model>
  hunt-agent model routes|fallback <role> <provider:model>...
  hunt-agent model status|test <provider:model>|bench

In the TUI: Enter send · Esc cancel turn · Ctrl-C quit · mouse-wheel scroll
Slash: /help /plan /clear /reset /exit /target /maxsteps /thinking /update
       /provider list|status|add|remove · /model list|use|route|routes|fallback|status|test|bench
`);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
