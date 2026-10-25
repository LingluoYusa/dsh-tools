// 纯逻辑模块 零 import 可在无 DSH 运行时的 Node 进程直接测试

export const TRUNCATION_MARKER = "\n\n[truncated: content exceeded maxInjectBytes]";
export const SYSTEM_REMINDER_OPEN = "<system-reminder>";
export const SYSTEM_REMINDER_CLOSE = "</system-reminder>";
export const INSTRUCTION_INTRO = "The following is the current content of ~/.dsh/AGENTS.md. It is re-supplied periodically as a standing instruction.";
export const HIT_OFFSET = 1;

const encoder = new TextEncoder();

// 返回 UTF-8 字节数 非字符串返回 0
export function utf8Length(text) {
  if (typeof text !== "string") return 0;
  return encoder.encode(text).length;
}

// 按字节上限截断 不切断多字节字符 返回值不含截断标记
export function truncateToBytes(text, maxBytes) {
  if (typeof text !== "string") return "";
  if (maxBytes === Infinity) return text;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) return "";
  if (utf8Length(text) <= maxBytes) return text;
  let used = 0;
  let out = "";
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (used + size > maxBytes) break;
    used += size;
    out += char;
  }
  return out;
}

// 唯一权威判定 命中 N+1 2N+1 3N+1 第 1 轮不注入
export function isHitTurn(turn, n) {
  return Number.isInteger(n) && n >= 1
    && Number.isInteger(turn) && turn > 1
    && (turn - 1) % n === 0;
}

// 双水位线门控 state 为空按两条水位线均为 -1 处理
export function shouldInject(turn, n, state) {
  if (!isHitTurn(turn, n)) return false;
  const lastInjectedTurn = state == null ? -1 : state.lastInjectedTurn;
  const attemptedTurn = state == null ? -1 : state.attemptedTurn;
  return lastInjectedTurn !== turn && attemptedTurn !== turn;
}

// 前 count 个命中轮号 供 tester 断言
export function hitSequence(n, count) {
  if (!Number.isInteger(n) || n < 1) return [];
  if (!Number.isInteger(count) || count <= 0) return [];
  const hits = [];
  for (let k = 1; k <= count; k += 1) hits.push(k * n + HIT_OFFSET);
  return hits;
}

// 私有 解包 volatile 包装 isVolatileFn 由 index.js 注入以保持零 import
const unwrap = (value, isVolatileFn) =>
  typeof isVolatileFn === "function" && isVolatileFn(value) ? value.get() : value;

// 解包 volatile 包装 isVolatile 由 index.js 传入以保持零 import
export function resolveEveryTurns(raw, isVolatileFn) {
  const value = unwrap(raw, isVolatileFn);
  return Number.isInteger(value) ? value : NaN;
}

// 把 Config 的 8 个字段归一化为普通值 供纯逻辑消费
// 必须在每个使用点现读 不能把结果缓存成闭包常量
export function resolveSettings(raw, isVolatileFn) {
  return {
    enabled: unwrap(raw?.enabled, isVolatileFn),
    everyTurns: unwrap(raw?.everyTurns, isVolatileFn),
    maxSourceBytes: unwrap(raw?.maxSourceBytes, isVolatileFn),
    maxInjectBytes: unwrap(raw?.maxInjectBytes, isVolatileFn),
    truncateOversize: unwrap(raw?.truncateOversize, isVolatileFn),
    wrapSystemReminder: unwrap(raw?.wrapSystemReminder, isVolatileFn),
    onlyIfChanged: unwrap(raw?.onlyIfChanged, isVolatileFn),
    includeSubagents: unwrap(raw?.includeSubagents, isVolatileFn),
  };
}

// 体积预算与降级 四级短路 非正整数上限按 Infinity 处理
export function planInjection(text, config) {
  const maxInjectBytes = Number.isInteger(config?.maxInjectBytes) && config.maxInjectBytes > 0
    ? config.maxInjectBytes
    : Infinity;
  if (typeof text !== "string" || text.trim() === "") {
    return { action: "skip", text: null, reason: "empty" };
  }
  if (utf8Length(text) <= maxInjectBytes) return { action: "inject", text, reason: "ok" };
  if (config?.truncateOversize === true) {
    return {
      action: "inject",
      text: truncateToBytes(text, maxInjectBytes) + TRUNCATION_MARKER,
      reason: "truncated",
    };
  }
  return { action: "skip", text: null, reason: "inject-oversize" };
}

// 纯文本组装 不构造消息对象
export function buildInstructionText(text, wrapSystemReminder) {
  const body = INSTRUCTION_INTRO + "\n\n" + text;
  return wrapSystemReminder
    ? SYSTEM_REMINDER_OPEN + "\n" + body + "\n" + SYSTEM_REMINDER_CLOSE
    : body;
}

// 告警节流键 同一键最多告警一次
export function warningKey(path, versionOrReason) {
  return `${path}#${versionOrReason ?? "unknown"}`;
}

// 初始水位线
export function initialState() {
  return { lastInjectedTurn: -1, attemptedTurn: -1, lastInjectedHash: null };
}

// 尝试标记 在读取前置位 阻止同 turn 每 step 重复读盘
export function markAttempted(state, turn) {
  state.attemptedTurn = turn;
  return state;
}

// 成功标记 仅在注入成功后调用
export function markInjected(state, turn, hash) {
  state.lastInjectedTurn = turn;
  state.lastInjectedHash = hash;
  return state;
}

// R-2 fail-closed 唯一权威实现 顺序短路
export function canRegisterForAgent(config, predicateReady, isPrimary) {
  if (config?.enabled !== true) return { register: false, reason: "disabled" };
  if (config?.includeSubagents === true) return { register: true, reason: "all-agents" };
  if (predicateReady !== true) return { register: false, reason: "predicate-not-ready" };
  if (isPrimary !== true) return { register: false, reason: "not-primary" };
  return { register: true, reason: "primary-only" };
}
