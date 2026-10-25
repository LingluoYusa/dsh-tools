import z from "@deepseek-ai/schemastery";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildInstructionText, canRegisterForAgent, initialState, markAttempted, markInjected,
  planInjection, resolveSettings, shouldInject, warningKey,
} from "./lib/logic.js";

const WARN = {
  missing: "agents-md-inject: AGENTS.md not found",
  sourceOversize: "agents-md-inject: AGENTS.md exceeds maxSourceBytes",
  readError: "agents-md-inject: read failed",
  injectOversize: "agents-md-inject: content exceeds maxInjectBytes and truncateOversize is false",
  build: "agents-md-inject: message construction failed",
  predicate: "agents-md-inject: subagent predicate not ready (fail-closed)",
  noFs: "agents-md-inject: fs service unavailable",
  created: "agents-md-inject: agent/created handler failed",
  buildFallback: "agents-md-inject: createUserMessage unavailable  using manual message construction",
  agentsUnavailable: "agents-md-inject: agents service unavailable, injection disabled",
  homeFallback: "agents-md-inject: dsh-home-paths unavailable, falling back to $DSH_HOME or ~/.dsh",
};
const READ_WARNINGS = { missing: WARN.missing, "source-oversize": WARN.sourceOversize, "read-error": WARN.readError };

// 8 个字段全部 volatile 配置页经 configForms 写入
// 非 volatile 路径会被 settings.write 拒绝 因此表单只投影 volatile 字段
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  everyTurns: z.number().step(1).min(1).max(1000).default(10).volatile(),
  maxSourceBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576).volatile(),
  maxInjectBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384).volatile(),
  truncateOversize: z.boolean().default(true).volatile(),
  wrapSystemReminder: z.boolean().default(true).volatile(),
  onlyIfChanged: z.boolean().default(false).volatile(),
  includeSubagents: z.boolean().default(false).volatile(),
});

// P1 主 agent 判定 必须用 includes 不能用 length 并发下会误判
// 返回 primary / other / unavailable 服务缺失要与普通非主 agent 分开告警
const SUBAGENT_PREDICATE_READY = true;
const probePrimaryAgent = (ctx, agent) => {
  try {
    const agents = ctx.get("agents");
    if (typeof agents?.roots !== "function") return "unavailable";
    return agents.roots().includes(agent) ? "primary" : "other";
  } catch { return "unavailable"; }
};

// 裸包名惰性解析 失败即降级 避免 linked 安装解析失败拖垮整体加载
const deps = { createUserMessage: undefined, resolveDshHome: undefined, isVolatile: undefined };
const depErrors = { createUserMessage: undefined, resolveDshHome: undefined, isVolatile: undefined };
const DEP_SPECS = [["createUserMessage", "@deepseek-ai/dsh-llm"], ["resolveDshHome", "@deepseek-ai/dsh-home-paths"], ["isVolatile", "@deepseek-ai/cosmokit"]];
let depsPromise;
const loadDeps = () => { if (depsPromise === undefined) depsPromise = resolveDeps(); return depsPromise; };
async function resolveDeps() {
  for (const [key, spec] of DEP_SPECS) {
    try { deps[key] = (await import(spec))[key]; } catch (error) { deps[key] = undefined; depErrors[key] = error; }
  }
  return deps;
}
// 依赖降级诊断 保留解析错误 自身永不抛错
function reportDegradations(ctx, warned) {
  try {
    if (depErrors.resolveDshHome !== undefined) warnOnce(ctx, warned, "home-fallback", WARN.homeFallback, depErrors.resolveDshHome);
  } catch { /* 诊断告警永不冒泡 */ }
}

// 兜底 volatile 判定 解析失败时仍能识别 {get} 包装对象
const fallbackIsVolatile = (value) => value !== null && typeof value === "object" && typeof value.get === "function";
// 兜底 home 解析 与 resolveDshHome 的 ~/.dsh 回落语义一致
const fallbackHome = () => { const env = process.env.DSH_HOME; return typeof env === "string" && env.length > 0 ? env : join(homedir(), ".dsh"); };
const agentsMdPath = () => join(typeof deps.resolveDshHome === "function" ? deps.resolveDshHome() : fallbackHome(), "AGENTS.md");
const isLoopback = (address) => typeof address === "string" && (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" || address.startsWith("127."));
const isLocalHost = (host) => {
  if (typeof host !== "string" || host.length === 0) return false;
  const value = host.toLowerCase();
  const name = value.startsWith("[") ? value.slice(1, value.indexOf("]")) : value.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
};
const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};
const guardOpenRequest = (req, res) => {
  if (!isLoopback(req.socket?.remoteAddress) || !isLocalHost(req.headers?.host)) {
    sendJson(res, 403, { ok: false, error: "loopback only" });
    return false;
  }
  const origin = req.headers?.origin;
  if (typeof origin === "string" && origin.length > 0) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { originHost = undefined; }
    if (originHost !== req.headers.host) {
      sendJson(res, 403, { ok: false, error: "cross-origin request" });
      return false;
    }
  }
  return true;
};
const openAgentsFile = async () => {
  const target = agentsMdPath();
  const info = await stat(target);
  if (!info.isFile()) throw new Error("AGENTS.md is not a file");
  const command = process.platform === "win32" ? { file: "notepad.exe", args: [target] }
    : process.platform === "darwin" ? { file: "open", args: [target] }
      : { file: "xdg-open", args: [target] };
  await new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", resolve);
    child.unref();
  });
};
const mountOpenAgentsRoute = (webServer, owner) => owner.effect(() => webServer.register({
  kind: "exact",
  path: "/api/dsh-tools/ami/open-agents",
  handler: async (req, res) => {
    if (!guardOpenRequest(req, res)) return;
    if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "POST only" }); return; }
    try { await openAgentsFile(); sendJson(res, 200, { ok: true }); }
    catch (error) { sendJson(res, 404, { ok: false, error: String(error?.message ?? error) }); }
  },
}), "dsh-tools-ami: open AGENTS.md");

const SOURCE = { kind: "agents-md-periodic-inject" };
const hashText = (text) => createHash("sha256").update(text).digest("hex");

// 告警按 key 节流 同一键只告警一次
function warnOnce(ctx, warned, key, message, error) {
  if (warned.has(key)) return;
  warned.set(key, true);
  try {
    if (error === undefined) ctx.logger.warn(message);
    else ctx.logger.warn(message, error);
  } catch { /* 诊断不得中断 agent */ }
}

// 与 fs.readText 一致 前 8192B 拒绝 NUL 并严格验证完整 UTF-8
function decodeSource(bytes) {
  if (bytes.subarray(0, 8192).includes(0)) throw new Error("binary source");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// 读盘 全部失败路径收敛为 reason 不抛错 入参为已解包的设置
async function readAgentsMd(ctx, settings, signal, cache, isCurrent) {
  let version;
  try {
    await loadDeps();
    if (!isCurrent()) return { text: null, reason: "inactive", version };
    signal.throwIfAborted();
    const fs = ctx.get("fs");
    if (fs === undefined || fs === null) return { text: null, reason: "no-fs", version };
    const limit = settings.maxSourceBytes;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid source limit");
    const target = await fs.resolve(agentsMdPath(), { signal });
    if (!isCurrent()) return { text: null, reason: "inactive", version };
    signal.throwIfAborted();
    const info = await fs.stat(target, signal);
    if (!isCurrent()) return { text: null, reason: "inactive", version };
    signal.throwIfAborted();
    if (info === undefined || info === null) return { text: null, reason: "missing", version };
    version = info.version;
    if (info.type !== undefined && info.type !== "file") return { text: null, reason: "missing", version };
    if (Number.isFinite(info.size) && info.size > limit) return { text: null, reason: "source-oversize", version };
    if (cache.text !== null && target.targetKey !== undefined && target.targetKey === cache.targetKey
      && version !== undefined && version === cache.version) return { text: cache.text, reason: "ok", version };
    // inclusive cap 超限抛 FS_TOO_LARGE provider 内部负责多读 1B 探测
    const bytes = await fs.readBytes(target, signal, limit);
    if (!isCurrent()) return { text: null, reason: "inactive", version };
    signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array)) throw new Error("invalid source bytes");
    if (bytes.byteLength > limit) return { text: null, reason: "source-oversize", version };
    const text = decodeSource(bytes);
    const after = await fs.stat(target, signal);
    if (!isCurrent()) return { text: null, reason: "inactive", version };
    signal.throwIfAborted();
    if (version !== undefined && after?.version !== version) return { text: null, reason: "read-error", version };
    if (target.targetKey !== undefined && version !== undefined) {
      cache.text = text;
      cache.targetKey = target.targetKey;
      cache.version = version;
    }
    return { text, reason: "ok", version };
  } catch (error) {
    return { text: null, reason: error?.code === "FS_TOO_LARGE" ? "source-oversize" : "read-error", version };
  }
}

// 构造注入消息 工厂不可用时手动构造等价对象 入参为已解包的设置
async function buildMessage(ctx, warned, text, settings, isCurrent) {
  await loadDeps();
  if (!isCurrent()) return null;
  const content = [{ type: "text", text: buildInstructionText(text, settings.wrapSystemReminder) }];
  const source = { ...SOURCE };
  if (typeof deps.createUserMessage === "function") return deps.createUserMessage({ content, source });
  warnOnce(ctx, warned, "build-fallback", WARN.buildFallback, depErrors.createUserMessage);
  return { id: randomUUID(), role: "user", content, source };
}

// 注册 per-agent 行为 必须在 effect 成功后才写 states
// readSettings 是函数 每次事件现读 不能缓存解包结果
function registerForAgent(ctx, readSettings, agent, states, warned, isGenerationCurrent) {
  if (!isGenerationCurrent()) return;
  const state = initialState();
  const cache = { text: null, targetKey: undefined, version: undefined };
  let alive = true;
  const isCurrent = () => alive && isGenerationCurrent();
  if (!isCurrent()) return;
  const dispose = agent.ctx.effect(() => {
    if (!isCurrent()) return () => {};
    const offPre = agent.ctx.on("agent/pre-step", async (payload, next) => {
      if (!isCurrent()) return next();
      const settings = readSettings();
      // 主开关现读 关掉后已存在的 agent 下一个命中轮号即停
      if (settings.enabled !== true) return next();
      if (!shouldInject(payload.turn, settings.everyTurns, state)) return next();
      markAttempted(state, payload.turn);
      payload.signal.throwIfAborted();
      const read = await readAgentsMd(ctx, settings, payload.signal, cache, isCurrent);
      if (!isCurrent()) return next();
      payload.signal.throwIfAborted();
      if (read.text === null) {
        if (read.reason === "no-fs") warnOnce(ctx, warned, "no-fs", WARN.noFs);
        else warnOnce(ctx, warned, warningKey(agentsMdPath(), read.version), READ_WARNINGS[read.reason]);
        return next();
      }
      const plan = planInjection(read.text, settings);
      if (plan.action === "skip") {
        if (plan.reason === "inject-oversize") warnOnce(ctx, warned, warningKey(agentsMdPath(), read.version + "#inject-oversize"), WARN.injectOversize);
        return next();
      }
      const digest = hashText(plan.text);
      if (settings.onlyIfChanged === true && digest === state.lastInjectedHash) return next();
      if (!isCurrent()) return next();
      payload.signal.throwIfAborted();
      const decision = await next();
      if (!isCurrent()) return decision;
      // reject 决策没有 messages 字段 必须早返回
      if (decision.kind === "reject") return decision;
      payload.signal.throwIfAborted();
      let message;
      try {
        message = await buildMessage(ctx, warned, plan.text, settings, isCurrent);
      } catch (error) {
        if (!isCurrent()) return decision;
        warnOnce(ctx, warned, "build#" + payload.turn, WARN.build, error);
        return decision;
      }
      if (!isCurrent()) return decision;
      payload.signal.throwIfAborted();
      if (message === null || !isCurrent()) return decision;
      markInjected(state, payload.turn, digest);
      // 展开 decision 保留 startsRequestSeries 等字段
      if (!isCurrent()) return decision;
      return { ...decision, messages: [...decision.messages, message] };
    });
    // effect 返回函数是唯一有效清理路径 必须保留 states.delete
    return () => {
      alive = false;
      offPre();
      states.delete(agent);
    };
  });
  if (!isCurrent()) { dispose?.(); return; }
  state.dispose = dispose;
  states.set(agent, state);
}

export function apply(ctx, config) {
  const webServer = ctx.get("webServer");
  if (webServer) mountOpenAgentsRoute(webServer, ctx);
  else ctx.inject(["webServer"], (sub) => mountOpenAgentsRoute(sub.webServer, sub));
  const states = new Map();
  const warned = new Map();
  // 每次使用点现读并解包 volatile 变更不重挂载 闭包 config 长期有效
  const readSettings = () => resolveSettings(config, deps.isVolatile ?? fallbackIsVolatile);
  let active = false;
  let generation = 0;
  ctx.effect(() => {
    active = true;
    const currentGeneration = ++generation;
    const isCurrent = () => active && generation === currentGeneration;
    void loadDeps().then(() => { if (isCurrent()) reportDegradations(ctx, warned); });
    const offCreated = ctx.on("agent/created", async ({ agent }) => {
      // agent/created 是 serial 事件 监听器永不抛错
      try {
        if (!isCurrent()) return;
        const settings = readSettings();
        // 主开关最外层 enabled:false 时零注册零读盘零注入
        if (settings.enabled !== true) return;
        // includeSubagents 为 true 时不求值谓词 保住显式 opt-in 的逃生通道
        const verdict = settings.includeSubagents === true ? "primary" : probePrimaryAgent(ctx, agent);
        if (verdict === "unavailable") { warnOnce(ctx, warned, "agents-unavailable", WARN.agentsUnavailable); return; }
        const gate = canRegisterForAgent(settings, SUBAGENT_PREDICATE_READY, verdict === "primary");
        if (gate.reason === "predicate-not-ready") { warnOnce(ctx, warned, "predicate-not-ready", WARN.predicate); return; }
        if (!gate.register) return;
        await loadDeps();
        if (!isCurrent()) return;
        registerForAgent(ctx, readSettings, agent, states, warned, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        warnOnce(ctx, warned, "agent-created-handler", WARN.created, error);
      }
    });
    return () => {
      active = false;
      generation += 1;
      offCreated();
      for (const state of states.values()) state.dispose?.();
      states.clear();
      warned.clear();
    };
  });
}

