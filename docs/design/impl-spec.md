# 实现规格冻结（impl-spec）

| 项 | 值 |
| --- | --- |
| 文档 ID | task-8 / docs/design/impl-spec.md |
| 版本 | v1.1 修复补充：服务可选访问 / 卸载生命周期闸门 / 有界源文件读取 |
| 补充优先级 | 本次修复条款覆盖下文旧草案：`agents` 必须经 `ctx.get('agents')` 读取；插件 active/generation 与 per-agent alive 联合保护旧派发快照及每个异步恢复边界；卸载先使闸门失效再注销；源文件必须使用带硬上限的 `fs.readBytes`，不得回退到无界 `readText`。 |
| 状态 | **冻结**。developer 按本文编码，**不需要再做任何设计决策** |
| 上游 | [plugin-design.md](plugin-design.md) v1.4（设计定稿）、`docs/research/api-findings.md`（task-1）、`docs/research/impl-prerequisites.md`（P1 谓词，**若存在则以它为准**） |
| 下游 | developer（编码）、tester（测试）、reviewer（审核） |
| 包名 | `dsh-ami` |

**证据标记**（沿用设计文档约定）：`[T1:L###]` task-1 报告行号、`[R:L###]` task-3 审核行号、`[Rv:L###]` task-5 复核行号、`[P:L##]` practices.md、`[H:L##]` host-plugin.md、`[待验证]` 未验证项。所有断言可回溯到设计文档章节或上述来源。

**本文与设计文档的关系**：设计文档解释「为什么」，本文只规定「做什么、叫什么、返回什么」。冲突时**以本文为准**，并在交付报告中指出冲突。

---

## 1. 文件清单与职责

```
dsh-ami/
├── package.json          清单           见 §4
├── cordis.patch.yml      bundle patch   见 §5
├── index.js              Host 入口      注册 + IO 编排（见 §2.2 / §3）
├── lib/
│   └── logic.js          纯逻辑         零 import 可在无 DSH 运行时下直接测试（见 §2.1）
├── locale/
│   ├── en.json                          见 §6
│   └── zh.json                          见 §6
├── icon.svg              图标           要求见 §7
└── README.md             使用说明       必写条目见 §8
```

| 文件 | 导出 | 允许的 import | 职责 |
| --- | --- | --- | --- |
| `lib/logic.js` | 见 §2.1 的 14 个具名导出 | **无（零 import）** | 全部纯计算：判定、命中序列、volatile 解包、体积预算与截断、文本包裹、告警节流键、状态迁移、注册门控 |
| `index.js` | `export const Config`、`export function apply(ctx, config)` | `schemastery`、`@deepseek-ai/cosmokit`（`isVolatile`）、`@deepseek-ai/dsh-llm`（`createUserMessage`）、`@deepseek-ai/dsh-home-paths`（`resolveDshHome`）、`node:path`、`./lib/logic.js` | 注册事件、生命周期、读盘、告警、消息构造、调用 logic.js |

**硬约束**：`lib/logic.js` 出现任何 `import` 即视为违规。tester 必须能直接 `import` 它并在**没有 DSH 运行时**的 Node 进程里跑完全部纯逻辑用例。

**代码量上限**（防止过度设计）：`lib/logic.js` ≤ 180 行，`index.js` ≤ 160 行。超出需在交付报告说明。

---

## 2. 函数签名与契约

### 2.1 `lib/logic.js`（纯逻辑，14 个具名导出）

#### 2.1.1 常量

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `TRUNCATION_MARKER` | `"\n\n[truncated: content exceeded maxInjectBytes]"` | 截断时追加在正文末尾，**必须**出现以便模型与 tester 识别内容不完整 |
| `SYSTEM_REMINDER_OPEN` | `"<system-reminder>"` | 与 shipped 插件外形一致 `[T1:L43]` |
| `SYSTEM_REMINDER_CLOSE` | `"</system-reminder>"` | 同上 |
| `INSTRUCTION_INTRO` | `"The following is the current content of ~/.dsh/AGENTS.md. It is re-supplied periodically as a standing instruction."` | 本插件原创文案，**不得**复制 shipped 插件文案 |
| `HIT_OFFSET` | `1` | 命中轮号 = `k * N + 1`（k ≥ 1），即严格「N 轮后下一轮」 |

#### 2.1.2 函数契约

**`utf8Length(text: string): number`**
返回 UTF-8 字节数（不是字符数）。空串返回 0。非字符串入参返回 0，不抛错。

**`truncateToBytes(text: string, maxBytes: number): string`**
按 UTF-8 字节上限截断，**不得切断多字节字符**（用 `TextEncoder`/`Buffer.byteLength` 逐字符推进或等效实现）。`maxBytes <= 0` 返回空串。`utf8Length(text) <= maxBytes` 时原样返回。返回值**不含** `TRUNCATION_MARKER`（由调用方追加）。

**`isHitTurn(turn: number, n: number): boolean`**
纯整数判定，**唯一权威实现**：

```
isHitTurn(turn, n) =
  Number.isInteger(n) && n >= 1 &&
  Number.isInteger(turn) && turn > 1 &&
  (turn - 1) % n === 0
```

命中序列：`N+1, 2N+1, 3N+1 …`。`N=10` → 11、21、31；`N=2` → 3、5、7；`N=1` → 2、3、4 …（**第 1 轮不注入**）。任何入参非整数一律 `false`。

**`shouldInject(turn: number, n: number, state: {lastInjectedTurn:number, attemptedTurn:number}): boolean`**
= `isHitTurn(turn, n) && state.lastInjectedTurn !== turn && state.attemptedTurn !== turn`。
**不接收 `enabled`**（主开关在 `agent/created` 最外层，见 §3.1）。state 为 `null`/`undefined` 时按「两个水位线均为 -1」处理。

**`hitSequence(n: number, count: number): number[]`**
返回前 `count` 个命中轮号（供 tester 断言）。`count <= 0` 返回 `[]`；`n` 非法返回 `[]`。

**`resolveEveryTurns(raw: unknown, isVolatileFn: (v: unknown) => boolean): number`**
解包 volatile 包装对象 `[R:L53、R:L148-L156]`：

```
value = (typeof isVolatileFn === 'function' && isVolatileFn(raw)) ? raw.get() : raw
return Number.isInteger(value) ? value : NaN
```

**故意把 `isVolatile` 作为参数传入**，以保证本文件零 import。`index.js` 调用时传 `@deepseek-ai/cosmokit` 的 `isVolatile`（`[Rv:L39]` 证实其为该包具名导出）。返回 `NaN` 时调用方一律走「不注入」分支。

**`planInjection(text: string|null|undefined, config: {maxInjectBytes:number, truncateOversize:boolean}): {action:'inject'|'skip', text:string|null, reason:string}`**
体积预算与降级的**唯一权威实现**。判定顺序**必须**如下（短路）：

| 序 | 条件 | 返回 |
| --- | --- | --- |
| 1 | `text` 非字符串，或 `text.trim() === ''` | `{action:'skip', text:null, reason:'empty'}` |
| 2 | `utf8Length(text) <= maxInjectBytes` | `{action:'inject', text, reason:'ok'}` |
| 3 | `truncateOversize === true` | `{action:'inject', text: truncateToBytes(text, maxInjectBytes) + TRUNCATION_MARKER, reason:'truncated'}` |
| 4 | 否则 | `{action:'skip', text:null, reason:'inject-oversize'}` |

`maxInjectBytes` 非正整数时按 `Infinity` 处理（不截断），不抛错。

**`buildInstructionText(text: string, wrapSystemReminder: boolean): string`**
纯文本组装，**不构造消息对象**：

```
body = INSTRUCTION_INTRO + "\n\n" + text
return wrapSystemReminder
  ? SYSTEM_REMINDER_OPEN + "\n" + body + "\n" + SYSTEM_REMINDER_CLOSE
  : body
```

**`warningKey(path: string, versionOrReason: string|number|undefined): string`**
告警节流键 = `` `${path}#${versionOrReason ?? 'unknown'}` ``。同一键最多告警一次（见 §3.4）。

**`initialState(): {lastInjectedTurn:number, attemptedTurn:number, lastInjectedHash:string|null}`**
返回 `{ lastInjectedTurn: -1, attemptedTurn: -1, lastInjectedHash: null }`。

**`markAttempted(state, turn): state`**
就地写入 `state.attemptedTurn = turn` 并返回同一对象。**在读取前置位**，用于阻止同一 turn 内每 step 重复读盘。

**`markInjected(state, turn, hash): state`**
就地写入 `state.lastInjectedTurn = turn` 与 `state.lastInjectedHash = hash` 并返回同一对象。**仅在注入成功后才调用**。

**`canRegisterForAgent(config: {enabled:boolean, includeSubagents:boolean}, predicateReady: boolean, isPrimary: boolean): {register:boolean, reason:string}`**

| 条件（按序短路） | 返回 |
| --- | --- |
| `config.enabled !== true` | `{register:false, reason:'disabled'}` |
| `config.includeSubagents === true` | `{register:true, reason:'all-agents'}` |
| `predicateReady !== true` | `{register:false, reason:'predicate-not-ready'}` |
| `isPrimary !== true` | `{register:false, reason:'not-primary'}` |
| 否则 | `{register:true, reason:'primary-only'}` |

**该函数是 R-2 fail-closed 的唯一权威实现**，把 serial 监听器的门控逻辑移出 IO 层以便纯逻辑测试。`reason === 'predicate-not-ready'` 时调用方必须发一次 W6 告警（§3.4）。

### 2.2 `index.js`（Host 入口）

#### 2.2.1 导出

**`export const Config`**：schemastery `z.object`，字段与默认值见 §5；`everyTurns` **必须**带 `.volatile()`（否则整条 entry 从设置表单消失 `[R:L50-L52]`）。类型只使用已取证能力（`z.object` / `z.boolean` / `z.number` / `.step` / `.min` / `.max` / `.default` / `.volatile`）`[T1:L62-L72]`。

**`export function apply(ctx, config): void`**：唯一入口。**不得** default 导出 class，不得混用导出形式 `[H:L59-L64]`。

#### 2.2.2 内部函数契约

**`readAgentsMd(ctx, config, signal): Promise<{text: string|null, reason: string, version: string|number|undefined}>`**

| 步骤 | 行为 |
| --- | --- |
| 1 | `const fs = ctx.get('fs')`；为 `undefined` → `{text:null, reason:'no-fs'}`（**不抛错** `[T1:L340、T1:L388]`、`[P:L20]`） |
| 2 | 等待 `loadDeps()` 后固定路径；`const target = await fs.resolve(path, { signal })`，恢复后检查生命周期及取消信号 |
| 3 | `const info = await fs.stat(target, signal)`；`undefined` → `{text:null, reason:'missing'}`；恢复后检查生命周期及取消信号 |
| 4 | 非普通文件 → `{text:null, reason:'missing'}` |
| 5 | `info.size > config.maxSourceBytes` → `{text:null, reason:'source-oversize', version: info.version}`；size 缺失不可当成可无界读取 |
| 6 | 缓存同时绑定 `targetKey + version`，二者都已知且相同才复用 |
| 7 | `await fs.readBytes(target, signal, config.maxSourceBytes)`；提供者 inclusive cap，超限抛 `FS_TOO_LARGE`。防御检查返回 byteLength，fatal UTF-8 解码并对前 8192 字节作 NUL 拒绝。读后 `stat(target, signal)` 版本一致才写缓存；各 await 后检查插件及 agent 生命周期 |
| 8 | `FS_TOO_LARGE` → `source-oversize`；其他读取异常 → `read-error`；保留已取得版本。生命周期失效 → `inactive`，调用方不得告警、注入或推进成功水位线。调用方在恢复后仍检查原 turn 取消信号 |

读路径**不带** `sandboxPolicy` 参数（读接口无此参数 `[T1:L337]`）。缓存按 agent 持有。

**`warnOnce(ctx, key, message, error?): void`**
按 `key` 节流：`Map<string, true>` 中已存在则直接返回；否则记入并调用 `ctx.logger.warn(message, error)`。`error` 为 `undefined` 时只传 message。节流表由插件的 `ctx.effect` 拥有，卸载即释放。

**`buildMessage(text, config): UserMessage`**
```
import { createUserMessage } from '@deepseek-ai/dsh-llm'   // [R:L63-L67]
content = [{ type:'text', text: buildInstructionText(text, config.wrapSystemReminder) }]
source  = { kind: 'agents-md-periodic-inject' }            // 本插件自有 kind [R:L66]
return createUserMessage({ content, source })              // role/id 由工厂补
```
`[待验证]` B10：渲染层是否特殊处理未知 `source.kind`（仅写入侧已被 shipped 插件证明可行 `[R:L66]`）。构造失败必须由调用方 try/catch（§3.2 步 11）。

**`registerForAgent(ctx, config, agent, source): void`**
按 §3.1 的顺序执行门控与注册；**必须**被 `agent/created` 监听器的 try/catch 包住；**必须**在 `agent.ctx.effect(...)` 成功返回后才写 `states.set`。

---

## 3. 精确的判定与降级规则

### 3.1 `agent/created` 处理顺序（v1.1 生命周期补充）

**优先约束**：每次插件 effect 捕获 generation 并定义 `isCurrent = active && generation === captured`。所有 created 回调入口及依赖等待后先检查该条件，失效直接退出；仅通过 `ctx.get('agents')` 做主 agent 判定。per-agent 注册另有 `alive` 标志，agent effect 清理时先置 false。pre-step 每个 await 恢复后以及合并消息、写成功水位线前检查联合闸门；失效时返回已经取得的下游 decision，尚未调用下游时只调用一次 `next()`。插件卸载先 `active=false` 并递增 generation，再 off/dispose/clear。旧派发快照不得重新注册；在途回调不得迟到注入。以下旧草案只描述主流程，不得省略这些闸门。


1. 监听器整体包 `try { ... } catch (error) { warnOnce(ctx, 'agent-created-handler', W8, error) }`。
   **`agent/created` 是 serial 事件**：`dsh-agent` L581 `await this.ctx.serial(entry.carrier, "agent/created", {...})`，抛错会让 `announce()` 失败即 **agent 创建失败** `[Rv:L100-L113]`。监听器**永不抛错**。
2. `if (!config.enabled) return;` —— **主开关最外层** `[Rv:L87-L98]`。
3. `const gate = canRegisterForAgent(config, SUBAGENT_PREDICATE_READY, isPrimaryAgent(agent, source))`。
   - `gate.reason === 'predicate-not-ready'` → `warnOnce(ctx, 'predicate-not-ready', W6)` 后 `return`。
   - `!gate.register` → `return`。
   - `isPrimaryAgent` **只能在 `SUBAGENT_PREDICATE_READY === true` 时被求值**（§3.5）。
4. `const state = initialState()`。
5. `const dispose = agent.ctx.effect(() => { ...注册 pre-step...; return () => { offPre(); states.delete(agent); } })`。
6. `state.dispose = dispose; states.set(agent, state);` —— **在 effect 成功之后**（R-7 `[Rv:L135-L138]`）。
7. 插件的 `ctx.effect` 返回值：`offCreated()` + 遍历 `states` 释放每个 disposer + `states.clear()`。

### 3.2 `agent/pre-step` 处理顺序（冻结）

| 序 | 动作 | 失败/不命中时 |
| --- | --- | --- |
| 1 | `if (!shouldInject(payload.turn, resolveEveryTurns(config.everyTurns, isVolatile), state)) return next();` | 直接 `next()`（零 IO、零分配） |
| 2 | `markAttempted(state, payload.turn)` | — |
| 3 | `payload.signal.throwIfAborted()` | 异常按框架语义冒泡（**这是正确的**，不要吞） |
| 4 | `const r = await readAgentsMd(ctx, config, payload.signal)` | 内部已捕获；`r.text === null` 时按 `r.reason` 发对应告警后 `return next()` |
| 5 | `const plan = planInjection(r.text, config)` | `plan.action === 'skip'` → 必要时告警 → `return next()` |
| 6 | `onlyIfChanged` 门控：`if (config.onlyIfChanged && hash(plan.text) === state.lastInjectedHash) return next();` | — |
| 7 | `payload.signal.throwIfAborted()` | — |
| 8 | `const decision = await next();` | — |
| 9 | `if (decision.kind === 'reject') return decision;` | reject 决策**没有** `messages` 字段 `[R:L33、R:L158-L166]` |
| 10 | `let msg; try { msg = buildMessage(plan.text, config) } catch (e) { warnOnce(...W5); return decision; }` | 构造失败不注入、**不推进** `lastInjectedTurn` |
| 11 | `payload.signal.throwIfAborted()` | — |
| 12 | `markInjected(state, payload.turn, hash(plan.text))` | **仅成功才推进** |
| 13 | `return { ...decision, messages: [...decision.messages, msg] };` | **必须 spread**，否则丢 `startsRequestSeries` `[P:L16]` |

**水位线语义**：`attemptedTurn` = 本 turn 已尝试（第一层，防每 step 读盘）；`lastInjectedTurn` = 本 turn 已成功注入（第二层，表达成功语义）。失败只推进前者，因此该 turn 不重试，下一个命中轮号重新尝试。

**哈希函数**：`hash(text)` 用 `node:crypto` 的 `createHash('sha256').update(text).digest('hex')`。只在命中轮号上计算，代价可忽略。

### 3.3 命中序列（冻结）

| N | 命中轮号 | 首次注入时点 |
| --- | --- | --- |
| 1 | 2、3、4、5 … | 第 1 轮结束后、第 2 轮开始时（**第 1 轮不注入**） |
| 2 | 3、5、7、9 … | 第 2 轮结束后 |
| 10 | 11、21、31 … | 第 10 轮结束后 |

判定式 `(turn - 1) % N === 0 && turn > 1`（用户决策 2，v1.4 定稿）。**`N = 1` 的偏移是严格读法的必然结果**，不是缺陷；README 必须写明。

### 3.4 告警（冻结字符串与节流键）

| 代号 | 触发 | message（逐字） | 节流键 |
| --- | --- | --- | --- |
| W1 | `reason === 'missing'` | `agents-md-inject: AGENTS.md not found` | `warningKey(path, version)` |
| W2 | `reason === 'source-oversize'` | `agents-md-inject: AGENTS.md exceeds maxSourceBytes` | `warningKey(path, version)` |
| W3 | `reason === 'read-error'` | `agents-md-inject: read failed` | `warningKey(path, version)` |
| W4 | `plan.reason === 'inject-oversize'` | `agents-md-inject: content exceeds maxInjectBytes and truncateOversize is false` | `warningKey(path, version + '#inject-oversize')` |
| W5 | `buildMessage` 抛错 | `agents-md-inject: message construction failed` | `'build#' + turn` |
| W6 | `gate.reason === 'predicate-not-ready'` | `agents-md-inject: subagent predicate not ready (fail-closed)` | `'predicate-not-ready'`（每次激活一次） |
| W7 | `reason === 'no-fs'` | `agents-md-inject: fs service unavailable` | `'no-fs'`（每次激活一次） |
| W8 | `agent/created` 监听器 catch | `agents-md-inject: agent/created handler failed` | `'agent-created-handler'`（每次激活一次） |

`reason === 'empty'`、`'ok'`、`'truncated'` **不告警**。告警一律 `ctx.logger.warn`，**不得**用 `console`。

### 3.5 P1 谓词接入点（冻结）

```
// 取值以 docs/research/impl-prerequisites.md 为准
const SUBAGENT_PREDICATE_READY = false;                  // P1 到位后置 true
const isPrimaryAgent = (agent, source) => false;         // P1 到位后替换为文档给出的实现
```

- 该文档**尚不存在**时：保持 `false`，插件在默认 `includeSubagents: false` 下走 fail-closed（不注册 + W6 一次）。
- 该文档**存在**时：developer 按文档把常量置 `true` 并替换谓词实现，**不得自行发明谓词**。
- `canRegisterForAgent` 的短路顺序保证 `isPrimaryAgent` 在常量 `false` 时**永不被求值**，因此占位实现不会造成任何风险。

---

## 4. `package.json` 全文

```json
{
  "name": "dsh-ami",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Re-injects ~/.dsh/AGENTS.md into the agent context after every N turns.",
  "exports": {
    ".": "./index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": [
    "index.js",
    "lib/logic.js",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "README.md"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

依据：`[H:L10-L17]`（manifest 形态）、`[H:L44-L49]`（`exports`/`files` 必须包含 locale 与 icon）。**`files` 必须含 `lib/logic.js`**，否则打包后运行时缺模块。本地 linked 安装不受 `files` 过滤，但发布/打包时受。

---

## 5. `cordis.patch.yml` 全文

```yaml
- insert:
    - id: dsh-ami
      name: 'dsh-ami'
      config:
        enabled: true
        everyTurns: 10
        maxSourceBytes: 1048576
        maxInjectBytes: 16384
        truncateOversize: true
        wrapSystemReminder: true
        onlyIfChanged: false
        includeSubagents: false
```

依据 `[H:L21-L27]`。**注意** `[H:L3]`：匹配的 override 会**整体替换** config，用户 patch 必须写全 8 个字段。

### 5.1 Config 字段冻结表

| 字段 | schemastery | 类型 | 默认 | 单位 / 取值域 | volatile |
| --- | --- | --- | --- | --- | --- |
| `enabled` | `z.boolean().default(true)` | boolean | `true` | — | 否 |
| `everyTurns` | `z.number().step(1).min(1).max(1000).default(10).volatile()` | number | `10` | DSH turn，1–1000 整数 | **是** |
| `maxSourceBytes` | `z.number().step(1).min(1).default(1048576)` | number | `1048576` | 字节 | 否 |
| `maxInjectBytes` | `z.number().step(1).min(1).default(16384)` | number | `16384` | 字节 | 否 |
| `truncateOversize` | `z.boolean().default(true)` | boolean | `true` | — | 否 |
| `wrapSystemReminder` | `z.boolean().default(true)` | boolean | `true` | — | 否 |
| `onlyIfChanged` | `z.boolean().default(false)` | boolean | `false` | — | 否 |
| `includeSubagents` | `z.boolean().default(false)` | boolean | `false` | — | 否 |

**只有 `everyTurns` 标 volatile**：设置表单只暴露它，其余 7 个字段只经 `cordis.patch.yml` 修改；`settings.write` 对非 volatile 路径会抛 `Config field "..." is not volatile` `[R:L51]`。该策略必须写入 README。

**运行期取值**：`config.everyTurns` 是 `createVolatile()` 冻结包装对象，**必须**经 `resolveEveryTurns` 解包 `[R:L53]`；其余 7 个字段是普通值。

---

## 6. `locale/en.json` 与 `locale/zh.json` 全文

`locale/en.json`：

```json
{
  "meta": {
    "title": "AGENTS.md Periodic Re-anchor",
    "description": "Re-injects ~/.dsh/AGENTS.md into the context after every N turns. N is configurable in settings."
  }
}
```

`locale/zh.json`：

```json
{
  "meta": {
    "title": "AGENTS.md 周期重锚",
    "description": "每 N 轮结束后把 ~/.dsh/AGENTS.md 重新写入下一轮上下文，轮数可在设置中修改。"
  }
}
```

依据 `[H:L31-L33]`：`meta.title` 与 `meta.description` 必须描述**本插件实际能力**，不得留模板文案。两个 locale 的键集合必须完全一致。

---

## 7. `icon.svg` 要求

| 项 | 要求 |
| --- | --- |
| 原创性 | 必须原创，或使用许可允许再分发的素材并保留署名 `[H:L34]` |
| 体积 | ≤ 256 KiB `[H:L51]` |
| 位置 | 位于包内，`exports["./icon"]` 指向它；不得用绝对路径、URL 或指向包外的符号链接 `[H:L51]` |
| 外链 | **禁止**任何外部引用（`<image href="http...">`、外链字体、外链 CSS） |
| 脚本 | **禁止** `<script>`、事件属性、`<foreignObject>` |
| 格式 | SVG 1.1 子集，含 `viewBox`（建议 `0 0 64 64`），`width`/`height` 可省略 |
| 配色 | 图形可自带配色；**不得**依赖宿主 CSS 变量（图标在插件列表中以 `<img>` 渲染，拿不到 `--dsw-alias-*`） |
| 可读性 | 在浅色与深色背景下均可辨认（建议自带描边或底色） |
| 交付前 | 用 `read` 确认文件非空且为合法 SVG；仅在浏览器无法使用时才报告「渲染未验证」`[H:L53]` |

---

## 8. `README.md` 必写条目清单

README 必须**逐条**包含下列内容（顺序不限，但每条都要有独立可检索的小标题）：

| # | 条目 | 要点 |
| --- | --- | --- |
| 1 | 定位 | **周期重锚**，不是首次加载；`~/.dsh/AGENTS.md` 已由 shipped 插件 `@deepseek-ai/dsh-agent-instructions` 加载 `[T1:L34]` |
| 2 | 命中轮号 | `N+1、2N+1、3N+1 …`；**严格「N 轮后下一轮生效」**；`N=1` 时第 1 轮不注入、从第 2 轮起每轮注入 |
| 3 | 注入位置 | 追加在 `decision.messages` 尾部，落在 runtime-context 快照之后、shipped 基线之外；**位置不做强保证** `[R:L118]` |
| 4 | token 成本 | 与 shipped 基线重复是必然 `[T1:L80]`；成本随会话长度**线性增长**；给出四个控制旋钮（`everyTurns` / `maxInjectBytes` / `maxSourceBytes` / `onlyIfChanged`） |
| 5 | 设置入口 | 设置表单**只暴露 `everyTurns`**；其余 7 个字段只能改 `cordis.patch.yml` |
| 6 | 配置表 | 8 个字段的类型、默认值、单位、取值域（照抄 §5.1） |
| 7 | 子智能体 | 默认 `includeSubagents: false`（只对主 agent）；**变更不追溯已存在的 agent**（判定在 `agent/created` 时刻，且该字段非 volatile）`[Rv:L120-L123]` |
| 8 | 失败语义 | 读取失败/空文件/超限一律**不注入且不中断 turn**；告警按文件版本节流 |
| 9 | 未验证项 | 至少列出：压缩是否吞掉注入（U3）、设置表单具体页面位置（U5）、`source.kind` 渲染层处理（B10）、fork 后轮号（B8）、resume 重放 step>1（B9）、裸包名解析（M1 验收） |
| 10 | 安装与卸载 | 经 `plugin_manager` 的 `install_bundle` / `remove_bundle`；不要手工改 profile 的 `package.json` 或 `cordis.patch.yml` |
| 11 | 不做什么 | 不注册工具/命令、不改其他插件贡献、不写 session 事件 |

---

## 9. 编码禁令清单

违反任一条即视为交付不通过。

| # | 禁令 | 依据 |
| --- | --- | --- |
| F1 | **不得**监听 `system-prompt/assemble` 追加或修改文本/工具 | `[P:L17]` |
| F2 | **不得**追加自定义 `type` 的 session 事件 | `[P:L21]` |
| F3 | **不得**使用 `appendPluginRecord()` | `[P:L21]` |
| F4 | **不得**注册 `ctx.sessionProjections` 投影 | 设计裁决 2 |
| F5 | **不得**修改其他插件的贡献（不重排、不删除 `decision.messages` 中他人条目） | `[P:L10]` |
| F6 | **不得**在 `agent/created` 监听器内抛错（必须整体 try/catch） | `[Rv:L100-L113]` |
| F7 | **不得**改写 pre-step decision 时不做 spread（必须 `{ ...decision, messages }`） | `[P:L16]` |
| F8 | **不得**在 `decision.kind === 'reject'` 时访问 `decision.messages` | `[R:L33]` |
| F9 | **不得**把 `config.everyTurns` 直接参与算术（必须先解包） | `[R:L53]` |
| F10 | **不得**依赖 `agent/disposed` 监听做清理（挂在 `agent.ctx` 上不会执行） | `[R:L79-L80]` |
| F11 | **不得**在 `agent/ctx` 之外注册 per-agent 监听（防止泄漏到所有 agent） | `[P:L19]` |
| F12 | **不得**在 `lib/logic.js` 中出现任何 `import` | 本文 §1 |
| F13 | **不得**用 `console` 输出（一律 `ctx.logger`） | 设计 §3.4 |
| F14 | **不得**在插件未命中路径做 IO 或对象分配 | 设计 §6.3 |
| F15 | **不得**自行发明 P1 谓词（必须以 `docs/research/impl-prerequisites.md` 为准） | 用户决策 3 |
| F16 | **不得**轮询 `agent/status` | `[P:L28]` |
| F17 | **不得**使用 `agentsFilePath` 之类的第二个 instruction 根 | `[T1:L350]` |

---

## 10. developer 自检清单

编码完成后**逐条**自查并在交付报告给出结论（对应设计文档 E 表）：

| # | 自查项 | 对应 | 通过判据 |
| --- | --- | --- | --- |
| C1 | `lib/logic.js` 零 import，可在无 DSH 的 Node 进程 import | §1 | `node -e "import('./lib/logic.js')"` 成功 |
| C2 | `isHitTurn` 命中序列正确 | E 表 / §3.3 | `hitSequence(2,3) === [3,5,7]`；`hitSequence(1,3) === [2,3,4]` |
| C3 | `shouldInject` 双水位线生效 | BR-5 | 同 turn 第二次调用返回 `false` |
| C4 | `resolveEveryTurns` 解包 | BLOCK-2 / E27 | 包装对象 → number；非法 → `NaN` |
| C5 | `planInjection` 四级短路正确 | BR-10 / E3 / E23 | 空 → `empty`；超限 + truncate → `truncated`；超限 + 不截断 → `inject-oversize` |
| C6 | `truncateToBytes` 不切断多字节字符 | §2.1 | 截断结果 `utf8Length <= maxBytes` 且无替换字符 |
| C7 | `canRegisterForAgent` 短路顺序正确 | R-2 / E29 | `enabled:false` → `disabled`；谓词未就绪 → `predicate-not-ready` |
| C8 | 主开关在最外层 | R-1 / E32 | `enabled:false` 下 `readAgentsMd` 零调用 |
| C9 | `agent/created` 监听器永不抛错 | R-2 / E33 | 人为注入抛错路径后 agent 仍创建成功 |
| C10 | `states.set` 在 effect 成功之后 | R-7 / E35 | effect 抛错后 `states` 无残留条目 |
| C11 | reject 早返回 | BLOCK-3 / E28 | 构造 `{kind:'reject'}` 场景 turn 正常结束 |
| C12 | 注入消息构造路径正确 | B1 | 用 `@deepseek-ai/dsh-llm` 的 `createUserMessage`，输入含 `content` 与 `source` |
| C13 | 未产生额外 turn / 额外模型调用 | 6.4 | 开/关插件 turn 总数与 request 数一致 |
| C14 | 未命中路径零 IO | §6.3 | 非命中轮号不调用 `readText` |
| C15 | 告警按 §3.4 的键节流 | E1/E3/E4 | 同一版本重复触发只出现一条 |
| C16 | 卸载后无残留 | E11 | `offCreated()` + 全部 disposer 释放 + `states.clear()` |
| C17 | 无任何禁令违反 | §9 | F1–F17 逐条核对 |
| C18 | `package.json` 的 `files` 含 `lib/logic.js` | §4 | 逐字核对 |
| C19 | locale 双文件键一致且描述本插件 | §6 | 逐字核对 |
| C20 | README 覆盖 §8 全部 11 条 | §8 | 逐条打勾 |

---

## 11. 未验证项与阻塞（原样保留）

| # | 内容 | 影响 | 归属 |
| --- | --- | --- | --- |
| B1 | 本地 linked bundle 能否解析 `@deepseek-ai/dsh-llm` / `@deepseek-ai/cosmokit` 裸包名 | M1 验收 | developer |
| P1 | 主 agent 判定谓词 | `includeSubagents: false` 能否生效 | researcher（`docs/research/impl-prerequisites.md`） |
| B3/U5 | 设置表单具体页面位置 | M2 页面实测 | tester |
| B6/U3 | 压缩是否吞掉注入 | 重锚效果 | researcher |
| B8 | fork 后轮号是否重置 | 命中序列 | tester |
| B9 | resume 是否重放同一 turn 的 step>1 | 注入位置偏移 | tester |
| B10 | 渲染层对未知 `source.kind` 的处理 | 显示形态 | developer |
| B5/U7 | 配置改动的传播方式 | 是否多注入一次 | developer |
| U2 | `plugins.bundle.config` 的 slot 键（`[单源]`）与 props | 仅方案 B 兜底 | developer |

---

## 附. 变更记录

| 版本 | 变更 |
| --- | --- |
| v1.0 | 首版冻结。落实用户决策 1/2/3：判定式 `(turn - 1) % N === 0 && turn > 1`、命中 N+1/2N+1/3N+1、`N=1` 偏移写明；`includeSubagents` 默认 `false` + P1 接入点；`agent/pre-step` 通道定稿。文件划分 `lib/logic.js`（零 import 纯逻辑）+ `index.js`（注册与 IO 编排）；14 个纯函数与 4 个 host 函数的签名与契约冻结；`package.json` / `cordis.patch.yml` / `locale/{en,zh}.json` 全文；`icon.svg` 要求、README 11 条必写、17 条禁令、20 条自检 |
