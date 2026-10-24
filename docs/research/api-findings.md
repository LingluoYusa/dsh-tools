# DSH 插件开发前技术调研：每 N 轮注入 `~/.dsh/AGENTS.md`

> 目标插件：可配置「每 N 轮」自动把 `~/.dsh/AGENTS.md` 写入下一轮上下文；N 可在插件设置里修改。
> 本文为 task-1 交付物，供 architect 直接设计使用，无需二次查源码。

## 0. 证据约定与环境

| 项 | 值 |
|---|---|
| DSH 版本 | `0.2.1-rc.2`（`asar:package.json` L3 `@deepseek-ai/dsh-desktop-runtime`） |
| Session 格式版本 | `4`（`asar:node_modules/@deepseek-ai/dsh-session/lib/index.js` L56） |
| asar 根 | `D:\DSH\resources\app.asar\dsh\` |
| 本文路径简写 | `asar:<rel>` 表示 `<asar 根>/<rel>`；`L<n>` 表示该文件第 n 行 |

**证据等级**

- **已验证**：来自 `cordis_inspect_query` 的权威返回，或 asar 内源码 + 确切行号。
- **未验证**：无法在运行时确认，已显式标注原因，**禁止当作事实使用**。

**本次工具的实际限制（影响证据强度，务必知悉）**

| 限制 | 现象 | 后果 |
|---|---|---|
| `cordis_inspect_query` 的 `input` 无法传对象 | 传 `{"service":"agents"}` 等 5 次全部被拒：`Service.listService rejected input: "input" must be an object` | **拿不到单个 Service 的精确契约**（含 `Agent`）。已改用「Service 目录（一次成功调用）+ asar 源码」取证 |
| Client `Slots.listSubTree` 超时 | 3 次调用均 `timed out after 10000ms`（提示需重连页面） | **Client slot 树未在运行时枚举**，slot 键来自 Client 源码；已在 Q5 标注未验证 |
| asar 内无法用 shell/glob/grep | `rg` 报 `os error 3`；`ops_glob` 报 `POLICY_DENIED` | 只能逐个 `read` 文件。**这是漏读风险的来源** |

---

## 1. Q1 现有 `AGENTS.md` 加载与注入链路

### 1.1 结论

`~/.dsh/AGENTS.md` **已经被 shipped 插件自动加载**，以 **user 角色消息**（不是 system prompt section、不是 runtime context）形式进入模型上下文，并被 `<system-reminder>` 包裹。

| 问题 | 结论 | 证据 |
|---|---|---|
| 谁读取 | 插件包 `@deepseek-ai/dsh-agent-instructions` | `asar:node_modules/@deepseek-ai/dsh-agent-instructions/package.json` L2-L3（`description: "Workspace context loader for AGENTS.md/CLAUDE.md instruction files"`） |
| 插件标识 | `name = "agent-instructions"`；`inject = ["sessionProjections","workingDirectory"]` | `.../dsh-agent-instructions/lib/index.js` L878、L1196 |
| 什么时机 | 每次 `agent/pre-step` waterfall 内；基线在「可见基线身份不一致」时生成 | 同文件 L1406-L1424（监听器）、L1246-L1253（`keepVisibleBaseline` 判断） |
| 以什么形式 | **user message**，`source = { kind:"agent-instructions", form:"instructions", baseline:true, baselineIdentity, changes }` | L897-L909（`agentInstructionsMessage`）、L1304-L1313、L1335-L1344 |
| 如何进入这一步 | 插到「最后一条 claimed 消息」之后（改写 waterfall 返回值） | L1418-L1419：`decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)` |
| 文本外形 | `<system-reminder>…</system-reminder>` 包裹 | L122-L127（`SYSTEM_REMINDER_OPEN/CLOSE`、intro 文案）、L324-L334（`buildInstructionText`） |

### 1.2 `~/.dsh/AGENTS.md` 的确切读取位置

用户级全局根有两个，**顺序固定**，且两者构成**同一个去重候选组**：

| 顺序 | 目录 scope | 绝对路径 | 展示路径 | 证据 |
|---|---|---|---|---|
| 1 | `user-global` | `<dshHome>/AGENTS.md` | `~/.dsh/AGENTS.md` | L161、L168、L480-L487 |
| 2 | `agents-global` | `<agentsHome>/AGENTS.md` | `~/.agents/AGENTS.md` | L161、L480-L497 |

- `USER_GLOBAL_FILE = "AGENTS.md"`（L168）；`USER_GLOBAL_DIRECTORIES = ["user-global","agents-global"]`（L161）。
- `instructionCandidateGroup()` 把 `agents-global` 折叠为 `user-global`（L197-L199），所以**内容（trim 后）相同的两份只渲染 harness home 那一份**（`dedupInstructionFilesByCandidateGroup`，L730-L746）。
- `dshHome` 解析优先级：显式配置 > `$DSH_HOME` > `~/.dsh`（`asar:node_modules/@deepseek-ai/dsh-home-paths/lib/index.js` L99-L111）。

项目级还会向上遍历到项目根（首个含 `.git` 的祖先），逐层收集 `AGENTS.md`/`CLAUDE.md` 与 `AGENTS.local.md`/`CLAUDE.local.md`（L574-L582、L646-L676）。

### 1.3 Config（可直接在 patch 里覆盖）

`asar:.../dsh-agent-instructions/lib/index.js` L25-L31，schemastery：

```js
const Config = z.object({
  projectRootMarkers: z.array(z.string()).default([".git"]),
  maxBytes: z.number().required(),                              // 渲染总预算 必需
  maxSourceBytes: z.number().step(1).min(1).default(1048576),    // 单文件上限
  instructionFileCandidates: z.array(z.string()).default(["AGENTS.md","CLAUDE.md"]),
  localInstructionFileCandidates: z.array(z.string()).default(["AGENTS.local.md","CLAUDE.local.md"])
});
```

### 1.4 变更传播（与本插件的差异点）

`agent-instructions` 不做「每 N 轮重发」。它只在：
1. 基线身份变化（cwd / projectRoot / 配置变化）时重发**完整基线**（L1294-L1315）；
2. 文件被 `read`/`write`/`edit` 触碰后，经 `tools/result` → `step/end` → 走 `agent.inbox.prepend/replace` 重发**差异块**（L1425-L1444、L1389-L1405、L1346-L1365）。

> **对 architect 的关键含义**：用户要的「每 N 轮重发同一份 `~/.dsh/AGENTS.md`」是与 shipped 行为**正交的新行为**，不会与基线冲突；但要注意去重逻辑（L1346-L1355 `alreadySupplied`）只针对本插件自己的消息，不覆盖第三方消息。

---

## 2. Q2 `agent.inject()` 完整契约

### 2.1 实现（已验证，源码级）

`asar:node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` L800-L814：

```js
send(message, target, wakeup) {
  const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort.signal.aborted;
  const resolvedTarget = wakingAfterAbort ? "next-turn" : target;
  this.inbox.splice(resolvedTarget, Infinity, 0, [message]);
  if (wakeup) this.wakeDriver(wakingAfterAbort);
}
followup(input) { this.send(input, "next-turn", true); }
steer(input)    { this.send(input, "next-step", true); }
inject(input)   { this.send(input, "next-step", false); }
```

| 方法 | 目标队列 | 是否唤醒 | 语义 |
|---|---|---|---|
| `agent.inject(msg)` | `next-step` | **否** | 排队等下一个被准入的 step |
| `agent.steer(msg)` | `next-step` | 是 | 打断式插入下一个 step |
| `agent.followup(msg)` | `next-turn` | 是 | 新开一轮 |

### 2.2 契约表

| 项 | 结论 | 证据 |
|---|---|---|
| 签名 | `inject(input: UserMessage): void`（单参数、无返回） | L812-L814；参数由 `createUserMessage` 生产（见 L136-L147 同款用法） |
| 落点（持久事件） | session 事件 **`agent/inbox/spliced`**，data `{ target:"next-step", start, inserted, removedCount?, outcome? }` | `ReactLoopInbox.mutate` L180-L208（L204 `this.session.append("agent/inbox/spliced", splice)`）；字段构造 L196-L202 |
| 事件类型已注册 | `agent/inbox/spliced` 在 `KNOWN_SESSION_EVENT_TYPES` 中 | `asar:.../dsh-session/lib/index.js` L81 |
| 何时进入下一步 | 下一个 step 边界：`inbox.claim(target, turn)` 先无条件取走 `next-step` | L103-L111、L906 |
| 是否会唤醒 | **不会**（`wakeup=false` → 不调用 `wakeDriver`） | L804、L812-L814；另见 `practices.md` L29 原文 |
| 生命周期通知 | 插入发 `agent/inbox/inserted`；被 claim 发 `agent/inbox/claimed`（带 `turn`）；被丢弃发 `agent/inbox/discarded` | L205-L206、L106-L109；inspect Event 目录同名事件 |

### 2.3 两个必须知道的边界（风险）

1. **idle 时不唤醒 → 消息滞留。** 若在 agent 空闲时 `inject()`，消息留在 inbox，直到**下一次**别的输入唤醒 agent 才被 claim。这符合「写入下一轮的上下文」，但意味着**注入本身不会触发模型调用**。
2. **`turn/end` 窗口内注入会立刻多开一轮。** `turn()` 在 `finally` 追加 `turn/end` 后执行 `if (!this.inbox.hasPending) return false;`（L1037）。若在 `turn/end` 的 `session/event` 监听里 `inject()`，`hasPending` 变 true → 驱动 `kick()` 的 `while (await this.turn())` 继续（L889）→ **立即开下一轮，产生一次只有注入内容的模型调用**。要在「不唤醒」前提下注入，请用 Q4 的 pre-step 方案。
3. `agent.cancel()` 默认 `keepInbox=false`，会 `inbox.clear()`（L815-L821）→ 已注入但未 claim 的消息会被丢弃（记 `outcome:"canceled"`）。

---

## 3. Q3 轮次定义与计数

### 3.1 turn 与 step 的语义差别（已验证）

`asar:.../dsh-agent-loop/lib/index.js`：

| 概念 | 定义 | 证据 |
|---|---|---|
| turn | 会话日志上的 1 基单调计数；每个 turn 追加 `turn/start {turn}` | `turn()` L938-L949（L943 `const turn = phase.turn + 1`、L945 append） |
| step | **turn 内**的 1 基计数，每轮重置为 0；每 step 追加 `step/start {turn, step}` 与 `step/end` | L955-L974（L955 `const step = phase.step + 1`、L970 append、L994-L997 `step/end`）、L1040 `phase.step = 0` |

### 3.2 `agent/pre-step` 能否直接拿到 turn

**能。** inspect Event 目录（权威）：

```
'agent/pre-step'(this: Scoped<Agent>,
  payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
mode: waterfall
```

源码侧一致：`this.dispatch.waterfall("agent/pre-step", { messages: claimed, ...position, signal }, ...)`，其中 `position = { turn, step }`（L909-L913、L956-L959）。

### 3.3 「一轮结束」的稳定锚点 —— **`turn/end`（session 事件）**

**先澄清 Lead 的疑问**：Cordis Host 事件目录中**确实没有** `turn/end`。`practices.md` L28 说的 `turn/end` 是 **session 事件类型**（`session/event` 的 `event.type`）。三方证据：

1. `asar:.../dsh-session/lib/index.js` L136-L137：`KNOWN_SESSION_EVENT_TYPES` 含 `"turn/end"`、`"turn/start"`。
2. `asar:.../dsh-agent-loop/lib/index.js` L1029-L1032：`this.session.append("turn/end", { turn, reason: turnEnds })`。
3. `turnBoundaryProjectionDefinition.apply` 以 `event.type === "turn/end"` 关闭 turn（L1390-L1393）。

| 候选锚点 | 是否「一轮结束」 | 证据与理由 |
|---|---|---|
| **session 事件 `turn/end`** | ✅ **权威** | data `{ turn, reason }`；`turn` 即轮号（L1029-L1032）。`reason.kind` 取值：`completed`/`blocked`/`aborted`/`error`/`max-tokens`/`forked`（L961、L966、L1013-L1025、L1163、L62-L75） |
| Host 事件 `agent/turn-stopping`（serial） | ⚠️ 近似，非终点 | 仅在「模型无待办且 next-step 空」时 await 派发，**在 `turn/end` 之前**（L1000-L1007）；且监听器若往 next-step 注入，turn 会继续（L1007 再判一次） |
| session 事件 `assistant/message` | ❌ 每个 step 一条 | 在 `step()` 内每次模型响应后追加（L1156-L1162），一个 turn 可有多条 |
| session 事件 `session/event` | ❌ 是**通道**不是锚点 | `session/event` 是 post-commit 广播（inspect Event 目录：`mode: emit`），需自己按 `event.type` 过滤 |

**推荐写法**：`ctx.on("session/event", (session, event) => { if (event.type === "turn/end") { /* event.data.turn, event.data.reason */ } })`。

### 3.4 会话恢复（resume）后 turn 编号是否延续 —— **延续**

三重证据：

1. 构造时从恢复出的投影读 `lastTurn`：`const lastTurn = this.loopCtx.sessionProjections.stateOf(session,"turnBoundary")?.lastTurn ?? 0;`，随后 `phase = { kind:"idle", lastTurn }`（L782-L786）。
2. 恢复路径用持久事件播种 session：`SessionPreparation.create(this.runtime.ctx.sessions.prepare(id, { seed: [...persisted, ...closers], ... }))`（L1994-L1999）。
3. 中断的 turn 会被补写收尾事件：`const closers = interruptedTurnClosers(persisted); if (closers.length > 0) await handle.append(closers);`（L1992-L1993）。
4. `turnBoundary.apply` 对 `turn/start` 记录 `lastTurn: event.data.turn`（L1385-L1389）→ 冷启动重放日志即得同一 lastTurn。

> **对 architect 的关键含义**：轮号是**会话绝对轮号**且跨 resume 单调递增。`turn % N === 0` 这种判定**不需要任何每会话状态存储**（见 Q6）。

---

## 4. Q4 注入点选型对比

| 维度 | `agent.inject()` | `ctx.systemPrompt.section()` | `ctx.systemPrompt.context()` | `agent/pre-step` 改写 `messages` |
|---|---|---|---|---|
| 作用范围 | 单个 agent | 注册它的 context（全局或 `agent.ctx` 作用域） | 同左 | 注册它的 context；每次 pre-step |
| 模型看到的位置 | user 消息（被 claim 后进入 surface） | **system 消息**（surface 节点 0，或 in-history 追加） | **user 消息**，`source.kind="runtime-context"` | 完全由你决定（agent-instructions 选 user 消息） |
| 是否记入会话日志 | ✅ 先 `agent/inbox/spliced`，claim 后再落 `user/message` | ✅ `system/message`（带 `surfaceOp`） | ✅ `user/message` + surface replace | ✅ 返回的额外消息在 `step()` 里以 `user/message` 追加 |
| 频率 | 调用一次，进下一个 step | **每一步**都渲染 | **每一步**都渲染（内容不变则不重复提交） | 每次 pre-step，可自行按 turn 条件化 |
| 是否唤醒 agent | ❌ 不唤醒 | —（被动渲染） | —（被动渲染） | ❌ 不唤醒（只在已有 step 准入时执行） |
| 失败模式 | idle 时滞留；turn/end 窗口内注入会多开一轮；`cancel()` 会清空 | 注册期冲突抛错（同名 section 重复注册）；`order` 必须有限数；全局注册会泄漏到所有 agent | 同 section；且**会替换**上一份快照 | 必须 spread decision，否则丢 `startsRequestSeries`；顺序与其它监听器耦合 |

**关键证据**

- `systemPrompt.section()` / `context()` / `variable()` 都是 **effect 作用域注册**，返回 Cordis disposer；`order` 非有限数抛 `TypeError`：
  `asar:.../dsh-system-prompt/lib/index.js` L253-L256（section）、L279-L282（context）、L310-L313（variable）。
- section 落点：`SystemPromptProjection.project()` —— 首个 system 节点占 surface 节点 0；可 in-history 时追加新 `system/message`，否则替换（L239-L296，尤其 L264-L282）。
- context 落点：`RuntimeContextProjection.project()` 生成 `user/message`，`source.kind="runtime-context"`，内容与保留值相同则**不提交**（L334-L349）；渲染头部文案见 L136-L140（`"Current runtime context. This snapshot supersedes earlier runtime-context snapshots."`）。
- pre-step 改写必须 spread：`practices.md` L16 原文 —— *"When rewriting an `agent/pre-step` decision, spread it (`{ ...decision, messages }`) so fields such as `startsRequestSeries` survive."*
- pre-step 返回的额外消息**确实入日志**：`step()` 内 `else this.session.append("user/message", message, { surfaceOp:"append" })`（L1072）。

**关于「是否会被 compaction 吞掉」—— 未验证。**
已验证的相关事实：模型可见面由 `surfaceOp: "append" | 替换` 组成（`dsh-session/lib/index.js` L157-L204），且 `compaction/start`、`compaction/summary`、`compaction/prune`、`compaction/end` 都是已注册 session 事件（L89-L92）。
**未验证原因**：本次未读 `@deepseek-ai/dsh-compaction*` 源码，无法断言四类注入各自在压缩中的存留行为。**architect 不要假设任何注入点免疫压缩**；若要强保证，需要在设计评审时补一次针对 `dsh-compaction-basic` 的调研。

**对本需求的最优选型（建议，非 API 事实）**：`agent/pre-step` 条件化改写。理由：(a) 天然拿到 `turn`；(b) 不唤醒 agent；(c) 只在真有 step 准入时注入，不会造成「只有注入内容的空转轮」；(d) 与 shipped 的 agent-instructions 同一机制、同一插入位置，行为可预测。

---

## 5. Q5 插件设置入口

### 5.1 Host 插件如何声明 Config（已验证）

- 导出形式二选一：`export function apply(ctx, config)` + 可选 `export const Config`；或 default 导出 service class。**不可混用**（`references/host-plugin.md` L59-L64）。
- `Config` 用 schemastery：`z.object({...})`。真实样例：`dsh-agent-instructions` L25-L31；`SystemPrompt` 用 `static Config = z.object({...})`（`dsh-system-prompt/lib/index.js` L214-L220）。
- patch 覆盖：`cordis.patch.yml` 里 `config:` 覆盖；**匹配的 override 会整体替换 config**（`host-plugin.md` L3）。
- 写 config 前先查 schema：`Config.listConfigs`（`host-plugin.md` L64）。

`Config.listConfigs` 实测（已验证）：返回 207 个条目，字段 `{ id, patchId, name, status }`，`status ∈ {tree, schema, absent, inactive}`，支持 `nextOffset` 分页。
> `status` 各值的**确切语义未验证**（未读 inspect provider 源码）；观察到 `@deepseek-ai/dsh-settings` 行为 `absent`、`@deepseek-ai/dsh-plugin-manager` 行为 `schema`。

### 5.2 自动表单：`settings` 服务把 Config 投影成表单（已验证）

`asar:.../dsh-settings/lib/index.js`：

| 事实 | 证据 |
|---|---|
| service key = `settings`，`SettingsForms` 依赖 `["configEditor","profileContext"]` | L322-L330 |
| `describe()` 读取每个 entry 的 `fiber.runtime.Config`（须有 `toJSON`） | L413-L420、L538-L541 |
| 只投影 **volatile** 字段：`volatileForm(schema)` | L122-L131、L418-L419 |
| **`autoGenerate` 默认 true**（除非插件 `configure({auto:false})`） | L426、L433、L442 |
| 描述符形状 | L441-L451：`{ autoGenerate, ns, schema, revision, applies:"live", value, base, user, secrets? }` |
| 写回 | `update(ns, patch, expectedRevision)` L470-L473；`replace` L479-L482；`mutate(ns, ops, expectedRevision)` L488-L500 |
| 冲突保护 | `SettingsConflictError`，code `SETTINGS_CONFLICT`，带 `expected`/`actual` revision（L163-L181、L511） |
| 变更事件 | Host 事件 `settings/document-updated(ns, revision)`（L435、L461；inspect Event 目录同名） |
| 页面策略 | `settings.configure({auto?}, owner?)` 注册本实例页面策略，重复注册抛错（L370-L381） |
| 远端入口 | service `settingsController`：`@Remote describe()` / `update` / `replace` / `mutate` / `openSettingsDocument`（host Service 目录） |

### 5.3 Client slot（**源码证据，运行时未验证**）

`Slots.listSubTree` 三次超时，因此以下 slot 键来自 Client 源码而非运行时树：

| slot 键 | 类型 | 归属 | 证据 |
|---|---|---|---|
| `settings.section` | list（root scope） | Settings 页面左侧/顶部分区容器 | `asar:.../dsh-client-ui-settings-plugins/lib/client.js` L201-L212（`ctx.slots.inject("settings.section", () => ctx.slots.register({ name:"settings.section", id:"plugins", order:15, label, locale, inject, children }))`） |
| `settings.plugins.tab` | list（root scope），声明为 `settings.section` id=`plugins` 的 child | 插件页内各 tab | 同文件 L208-L211（children 声明）、L124 / L68（`renderSlot("settings.plugins.tab", {}, { only })`）、L183-L188（`ctx.slots.entries` + `resolveSlotLabel`） |
| `conversation.composer.dock` | 装饰位 | 模板示例用 | `references/templates/decoration/client.js` L16-L18 |

Client 注册形状（模板，已验证可读）：

```js
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
  name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
}, Decoration));
```

`settings.section` 的组件 props 形状：`PluginsSettingsSection({ t, renderSlot, useTabs })`（同文件 L37），其中 `useTabs` 是 hook selector（L40）。

### 5.4 是否需要自研 Client 半体

| 方案 | 是否需要 Client 半体 | 依据 |
|---|---|---|
| **A. 只放 Host `Config`（推荐给「轮数」这类数值）** | **不需要** | `settings` 服务已把带 `Config` 的插件投影成表单且 `autoGenerate` 默认 true（5.2）；`@deepseek-ai/dsh-client-ui-settings` 的定位是 *"Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract"*（其 `package.json` L3） |
| B. 自定义设置页/自定义控件 | 需要 | 注册进 `settings.plugins.tab`（5.3），Client 清单见 `host-plugin.md` L29-L49 与模板 `package.json` L13-L20 |

**未验证**：方案 A 中表单**具体渲染在哪个页面**（Settings → 内置插件 / 插件管理侧栏 / 其它）未能确认——需 `Slots.listSubTree` 或浏览器实测。方案 A 的「无需 Client 半体」结论依赖 `autoGenerate` 语义，**建议在实现后按 `references/verification.md` 做一次页面实测**。

---

## 6. Q6 每会话状态的持久化

### 6.1 硬约束（practices.md L21 原文，必须遵守）

> *"Do not append session events with a new `type`. Readers accept an unknown stored event only when its envelope carries `ignorable: true`, and live `Session.append()` cannot set that marker, so the Session would refuse to reopen. `appendPluginRecord()` writes ignorable `plugin:` records, but it is reserved for DSH's experimental packages because a Session format migration keeps those records only on a best-effort basis. Derive state from existing events, or keep plugin-owned data in a storage service found through inspection."*

源码印证：`KNOWN_SESSION_EVENT_TYPES` 是硬集合，且注释明确 *"Downstream (out-of-repo) plugin events are outside this list by construction"*（`dsh-session/lib/index.js` L65-L142）。

### 6.2 方案对比

| 方案 | 适用 | 代价 | 证据 |
|---|---|---|---|
| **A. 从现有事件派生（本需求首选）** | 「每 N 轮」判定 | 零存储 | `turn/end` 的 `data.turn` 即轮号（L1029-L1032）；轮号跨 resume 单调（Q3.4） |
| B. Host `Config`（全局） | N 的值本身 | 非每会话；改后影响所有会话 | Q5.1 |
| C. `ctx.sessionProjections` | 需要每会话派生状态时 | 要写纯函数 fold + `stateVersion` | 见下 |
| D. `storage` / `storageDomain` | 插件自有数据 | 非日志派生 | service `storage`：`mount/form`；`storageDomain`：`open(spec)`/`get`/`closeAll`（host Service 目录） |

### 6.3 `sessionProjections` 契约（host Service 目录，权威）

```
register<K extends keyof SessionProjectionMap, S extends SessionProjectionStateMap[K]>(
  definition: Omit<ProjectionDefinition<K,S>,'wire'> & { wire: NonNullable<ProjectionDefinition<K,S>['wire']> }): () => void
register<K extends Exclude<keyof SessionProjectionStateMap, keyof SessionProjectionMap>, S ...>(
  definition: Omit<ProjectionDefinition<K,S>,'wire'>): () => void
onChanged(listener: ProjectionChangeListener): () => void
stateOf<K extends keyof SessionProjectionStateMap>(session: Session, key: K): SessionProjectionStateMap[K] | undefined
snapshot(session, keys?): ProjectionSnapshot
checkpoint(session): ProjectionCheckpoint
restore/restoreFloor/viewCheckpoint/hydrate(...)
```

真实 definition 样例（可作为写法模板）：

| 样例 | key | 字段 | 证据 |
|---|---|---|---|
| inbox | `"inbox"` | `stateSchema`/`init`/`apply`/`wire.view`/`stateVersion:1` | `dsh-agent-loop/lib/index.js` L26-L62 |
| turnBoundary | `"turnBoundary"` | `openTurnStartSeq` / `lastStepStartSeq` / `lastStepBoundary` / `lastTurn`，`stateVersion:2` | 同文件 L1365-L1412 |

性能约束（`practices.md` L26-L27）：`apply(state,event)` 必须**纯、同步**，忽略的事件**返回同一引用**；`view()` 值未变时返回同一引用以抑制发布；`stateVersion` 在字段/fold 语义变化时递增。

**结论**：本需求**不需要**方案 C/D。用 `agent/pre-step` 的 `payload.turn`（或 `turn/end` 的 `data.turn`）做 `% N` 判定即可，天然满足「日志是唯一真相」与「可 resume 重放」。

---

## 7. Q7 文件读取约束

### 7.1 `fs` 服务契约（host Service 目录，权威）

```
watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
abstract processPath(target: FsTarget): string
processPathFromHostPath(hostPath: string): string | undefined
abstract fileUrl(target: FsTarget): string
abstract contains(parent: FsTarget, child: FsTarget): boolean
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
abstract readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?): Promise<Uint8Array>
abstract listDir(target: FsTarget, signal?): Promise<FsDirEntry[]>
abstract writeText(target, content, expected?: FsWriteIntent, signal?, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome>
abstract editText(target, edit: FsEditRequest, expected?: { version: FsVersion }, signal?, sandboxPolicy?): Promise<FsEditOutcome>
```

### 7.2 沙箱策略影响（已验证）

- **读路径不带 `sandboxPolicy` 参数**；只有 `writeText`/`editText` 带（见上）。
- `FileSystem.sandboxMode`：基类与裸 local 后端返回 `undefined`（不约束）；`@deepseek-ai/dsh-fs-sandbox` 覆盖为部署默认值（`asar:.../dsh-fs/lib/index.js` L74-L86）。
- `LocalFileSystem.resolve` 的 `cwd` 是**解析默认值，不是包含边界**：*"Reads resolve relative paths from `Config.cwd` (a resolution default, NOT a containment boundary …) enforce containment with a stricter backend or a `tools/execute` permission plugin"*（`asar:.../dsh-fs-local/lib/index.js` L719-L724）。
- **实证**：`agent-instructions` 就是这么读 `~/.dsh/AGENTS.md` 的——`ctx.get("fs")` 取服务（可选，缺失则 no-op），`fileSystem.resolve(...)` + `fileSystem.stat(...)` + `fileSystem.streamText(...)`，全程无 policy 参数：L1237-L1238、L1244、L1257-L1267、L703、L831-L851。**这证明 Host 插件读 `~/.dsh/AGENTS.md` 可行。**

### 7.3 路径解析

```js
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
const agentsFile = join(resolveDshHome(), "AGENTS.md");   // 显式 > $DSH_HOME > ~/.dsh
```

`resolveDshHome(configured?, env?)`（`dsh-home-paths/lib/index.js` L99-L111）；环境变量名常量 `DSH_HOME_ENV = "DSH_HOME"`（L15）。展示用符号化标签 `dshHomeDisplay()` → `~/.dsh` 或 `$DSH_HOME`（L145-L155）。
注意 `agent-instructions` 的注释强调：*"the row cannot point instruction loading at a second root that other harness consumers would not share"*（L68-L73）——即插件**不应**自造第二个根。

### 7.4 文件变更监听能力（已验证）

| 后端 | `watch` 行为 | 证据 |
|---|---|---|
| 基类 `FileSystem` | **默认拒绝**：`Promise.reject(new FsError("Filesystem watching is not supported by this provider.", "FS_IO_ERROR"))` | `dsh-fs/lib/index.js` L70-L73 |
| `LocalFileSystem`（本部署） | **已实现**：基于 chokidar，`ignoreInitial:true, depth:0`，单文件时只关心该路径，返回 `() => watcher.close()`；错误经 `changed(error)` 上报 | `dsh-fs-local/lib/index.js` L726-L750 |

另有 Remote 观察通道：`workspaceFiles.changes(workspaceFileScope, path, signal): AsyncIterable<WorkspaceFileWatchFrame>`（host Service 目录）。

> **建议**：`agent-instructions` 没有用 watch，而是用 `stat().version` 做「变了才重读」的缓存（L1129-L1156）。本插件建议同样用 `version` 缓存，**把 watch 当作可选优化**，避免依赖后端能力。

---

## 8. Q8 未知与风险清单

### 8.1 未验证项（禁止当事实使用）

| # | 未验证内容 | 原因 | 影响的决策 |
|---|---|---|---|
| U1 | 单个 Service（含 `Agent`）的精确契约类型 | `cordis_inspect_query` 的 `input` 对象 5 次被拒（`"input" must be an object`）；且 asar **未打包 `lib/types/**/*.d.ts`**（`read` 返回 not found），`lib/index.js` 已剥离 TS 接口 | `agent.inject()` 的**参数类型名**只能从源码推断为 `UserMessage`；类型级细节需以 `createUserMessage` 的产物为准 |
| U2 | Client slot 运行时树与 props | `Slots.listSubTree` 3 次 10s 超时 | Q5.3 的 slot 键来自源码，未经运行时确认 |
| U3 | 四类注入点被 compaction 吞掉的具体行为 | 未读 `@deepseek-ai/dsh-compaction*` | Q4 的「是否被压缩」列 |
| U4 | `Config.listConfigs` 的 `status` 取值语义 | 未读 inspect provider 源码 | 仅用于定位条目，不用于判断可配置性 |
| U5 | 自动 Config 表单在 Web UI 的**具体页面位置** | 同 U2 | Q5.4 方案 A 的落地验证 |
| U6 | `sessionProjections` 的 `SessionProjectionMap` 是否可由**下游插件**扩展（两个 register 重载的 key 约束） | 未读类型声明 | 若本插件要注册投影，需先确认 key 约束；当前建议不注册 |
| U7 | `settings/document-updated` 的 `SettingsNamespace` 与 entry id 的对应细节 | 未读相关类型 | 仅在需要监听设置变更时重要 |

### 8.2 风险

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R1 | **在 `turn/end` 监听里 `agent.inject()` 会立即多开一轮**，产生只有注入内容的模型调用 | `turn()` L1037 `if (!this.inbox.hasPending) return false;` + `kick()` L889 `while (await this.turn())` | 用 `agent/pre-step` 条件化改写，不要在 turn/end 里 inject |
| R2 | 在 agent **idle** 时 `inject()` 不唤醒，消息滞留到下次用户输入 | L804、L812-L814；`practices.md` L29 | 明确产品语义；若需立即生效必须 `followup()`（但会开新轮） |
| R3 | 重复注入导致上下文膨胀 | `~/.dsh/AGENTS.md` 基线已被 shipped 插件加载（Q1） | 每 N 轮重发时：只发一次、按 `version` 去重、并考虑复用 `agent-instructions` 的字节预算思路（`maxBytes`） |
| R4 | 监听器顺序耦合 | `practices.md` L16；`agent-instructions` 也改 pre-step（L1418-L1419） | 改写必须 `{...decision, messages}`；明确插入位置策略；避免与 agent-instructions 抢同一位置 |
| R5 | 注册在全局 context 会泄漏到所有 agent / 卸载不干净 | `practices.md` L8、L19（`agent.ctx` 注册有双 owner，需同时持有 disposer） | 在 `agent/created` 里对 `agent.ctx` 注册，包在**一个** `agent.ctx.effect()` 内，并把 disposer 按 agent 记在自己的 effect 里 |
| R6 | 插件在缺 `fs` 的 profile 里抛错 | `agent-instructions` 用 `ctx.get("fs")` 可选获取（L1237-L1238） | 声明 `inject` 或 `ctx.get` 可选获取；`practices.md` L20 |
| R7 | 非 volatile 字段不出现在表单里 | `volatileForm` 只投影 volatile（`dsh-settings` L122-L131、L418-L419） | N 这类普通数值字段无需 `volatile`，但**必须确认最终能出现在表单中**（关联 U5） |

### 8.3 建议的架构方向（建议，非 API 事实）

1. **N 的来源**：Host `Config`（schemastery `z.object({ everyTurns: z.number().step(1).min(1).default(N) })`），靠 `settings` 自动表单暴露；不写自定义 Client 半体（Q5.4 方案 A）。
2. **触发与注入**：在 `agent/created` 里对 `agent.ctx` 注册一个 `agent/pre-step` waterfall 监听器，当 `payload.turn % N === 0` 时把 `~/.dsh/AGENTS.md` 渲染成一条 user 消息并 `toSpliced` 进 `decision.messages`；**不唤醒、不写自定义事件、不建投影**。
3. **读取**：`ctx.get("fs")` → `resolve(join(resolveDshHome(),"AGENTS.md"))` → `stat().version` 比对 → `readText`；版本未变则复用缓存文本。
4. **不做的事**：不 append 新 session event type；不写 `appendPluginRecord()`；不替换 `system-prompt/assemble`；不轮询 `agent/status`。

---

## 附录 A 证据文件索引

| 别名 | 绝对路径 |
|---|---|
| `dsh-agent-instructions/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-instructions\lib\index.js` |
| `dsh-agent-loop/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js` |
| `dsh-session/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session\lib\index.js` |
| `dsh-system-prompt/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-system-prompt\lib\index.js` |
| `dsh-settings/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-settings\lib\index.js` |
| `dsh-fs/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-fs\lib\index.js` |
| `dsh-fs-local/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-fs-local\lib\index.js` |
| `dsh-home-paths/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-home-paths\lib\index.js` |
| `dsh-client-ui-settings-plugins/lib/client.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-settings-plugins\lib\client.js` |
| `practices.md` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\references\practices.md` |
| `host-plugin.md` | 同目录 `references\host-plugin.md` |
| `ui-plugin.md` | 同目录 `references\ui-plugin.md` |
| 模板 `templates/decoration/*` | 同目录 `templates\decoration\{package.json,cordis.patch.yml,index.js,client.js,locale\en.json,icon.svg}` |

## 附录 B inspect 调用记录

| 调用 | 结果 |
|---|---|
| host `Service.listService`（无 input） | ✅ 成功，返回完整 Service 目录（36KB 溢出，落盘 `C:\Users\15068\AppData\Local\Temp\dsh-spill-nReZyt\session-e1c8fbcd7ef0\74ad5e4bbddd-cordis_inspect_query.txt`） |
| host `Event.listEvents`（无 input） | ✅ 成功，返回全部 Host 事件与模式（确认**无** `turn/end` Host 事件） |
| host `Config.listConfigs`（无 input） | ✅ 成功，207 条，25/页 |
| client `Slots.listSubTree` | ❌ 3 次超时（10000ms） |
| host `Service.listService`（带 `input`） | ❌ 5 次：`"input" must be an object` |
