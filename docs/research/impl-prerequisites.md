# 编码硬前提调研：主 agent 判定 / 裸包名解析 / 消息构造

> task-7 交付物。为 developer 扫清三个编码阻塞点。全部结论附文件路径 + 行号。
> 路径简写：`asar:<rel>` = `D:\DSH\resources\app.asar\dsh\<rel>`；`profile:` = `C:\Users\15068\.dsh\profiles\desktop\`。
> 本次调研**未安装插件、未修改 profile**，只读。

---

## P1 主 agent 判定（最高优先级，B7）

### 1.1 结论先行

**可判定，一行谓词：**

```js
// agent/created 内：只处理主 agent
const isMainAgent = (agent) => ctx.agents.roots().includes(agent);
```

等价的持久谱系写法（不依赖 agents 服务）：

```js
const isMainAgent = (agent) => agent.session.header.parentSession === undefined;
```

**`source: SessionStartSource` 不可用于此判定** —— 见 1.3。

### 1.2 `SessionStartSource` 的取值集合

类型是 TS 联合（未打包 `.d.ts`），取值由 `AgentRegistry.announce` 的调用方决定。inspect Event 目录（权威）：

```
'agent/created'(this: Scoped<Agent>,
  payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }
): undefined | Promise<undefined>        mode: serial
```

`asar:node_modules/@deepseek-ai/dsh-agent/lib/index.js` L564-L590 —— JSDoc L567 明说取值语义：

> `@param source - fresh creation, resume, clear, or compaction source.`

```js
async announce(agent, source, signal) {          // L574
  ...
  await this.ctx.serial(entry.carrier, "agent/created", { agent, source, ...signal === void 0 ? {} : { signal } });  // L581-L585
}
```

| 取值 | 语义 | 证据 |
|---|---|---|
| `"startup"` | 新建（create / createAgent / register） | `asar:.../dsh-agent-loop/lib/index.js` L1841（`prepared.publish("startup")`）、L1909（`setupAndPublish(..., "startup", ...)`）；`dsh-agent` L494（`announce(agent, "startup")`） |
| `"resume"` | 从持久化恢复 | `dsh-agent-loop` L2012（`setupAndPublish(..., "resume", owned, ...)`） |
| `"clear"` | 清空后重建 | 仅由 JSDoc L567 列出；**未找到调用点（未验证）** |
| `"compaction"` | 压缩后重建 | 仅由 JSDoc L567 列出；**未找到调用点（未验证）** |

### 1.3 `source` 为什么不能区分主 / 子会话

**子智能体走的是同一个工厂、同一批 source 值。** 链路：

```
ctx.subagents.startActivation → SubagentManager.materializeTracked
  → ctx.agents.create({ sessionId, parentAgent: parent, ... })   或
    ctx.agents.resume({ resumeSessionId, parentAgent: parent, ... })
  → AgentLoop.createAgent / resumeWith → setupAndPublish(..., "startup" | "resume", ...)
  → AgentHandle.publish(source) → agents.announce(agent, source, ...)
  → agent/created
```

关键证据 `asar:.../dsh-subagent/lib/index.js` L1809-L1824：

```js
const handle = create === void 0 ? await this.ownerCtx.agents.resume({
  resumeSessionId: childId,
  parentAgent: parent,            // L1811
  ...
}) : await this.ownerCtx.agents.create({
  sessionId: childId,
  parentAgent: parent,            // L1817
  ...
});
```

⇒ 子会话的 `source` 是 `"startup"` / `"resume"`，**与主会话完全同值**。`source` 只回答「这次是怎么起来的」，不回答「这是谁的孩子」。

### 1.4 真正区分主 / 子的两条事实

#### 途径 A（推荐）：运行时归属 `ctx.agents.roots()`

`asar:.../dsh-agent/lib/index.js`：

```js
enter(agent, owner) {                       // L512
  ...
  const entry = { id, agent, owner, carrier, announced: false, ... };   // L517-L525
  this.store.set(id, entry);                                            // L526
}
/** All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root. */
roots() {                                   // L623
  return [...this.store.values()].filter((entry) => entry.owner === void 0).map((entry) => entry.agent);
}
isOwnedBy(id, owner) { return this.store.get(id)?.owner === owner; }    // L607-L609
```

- `owner` 由工厂写入：`asar:.../dsh-agent-loop/lib/index.js` L1791 `detachAgent = loopCtx.agents.enter(agent, parentAgent);`
- 且 **`enter` 先于 `announce`**：L1790-L1794 —— `enter` → `sessions.announce` → `agents.announce`（后者才派发 `agent/created`）。
  ⇒ 在 `agent/created` 监听器里，registry 已持有该 entry 与它的 `owner`，`roots()` 判断**当下即可用**。

**误判情形**：无。`roots()` 的语义就是「没有 owning agent context」，正是「主 agent」。

#### 途径 B：持久谱系 `session.header.parentSession`

`asar:.../dsh-subagent/lib/index.js` L1735-L1747：

```js
liveLineage(agent) {
  const lineage = [agent];
  let parentSession = agent.session.header.parentSession;   // L1738
  while (parentSession !== void 0) {
    const parent = this.ctx.agents.get(parentSession);
    ...
    parentSession = parent.session.header.parentSession;    // L1744
  }
}
```

配合 `authorizeLineage` L1657-L1662（`parentSession !== parent.id` → `UNAUTHORIZED`），可确认 `header.parentSession` 是**子会话记录的持久直接父 id**。

**优点**：跨 resume / 冷恢复 / fork 稳定。
**未验证**：`sessions.fork()`（`asar:.../dsh-session` L1387）是否也给 `header.parentSession` 赋值。若会，则用户主动 fork 出来的会话会被判为「非主 agent」。**建议用途径 A**。

### 1.5 备选途径逐个评估

| 途径 | 签名（Service 目录，权威） | 可行性 | 结论 |
|---|---|---|---|
| **`ctx.agents.roots()`** | `roots(): Agent[]` | ✅ **推荐** | 语义精确、`agent/created` 时已就绪、无副作用 |
| `ctx.agents.isOwnedBy(id, owner)` | `isOwnedBy(id: SessionId, owner: Agent): boolean` | ⚠️ 需先知道 owner | 无法直接用于「我是主吗」，只能反查某个已知父 |
| `agent.session.header.parentSession` | 无服务方法 | ✅ 可用 | 持久、跨 resume 稳定；fork 行为未验证 |
| `ctx.agentTeams.tryMembership(agent)` | `tryMembership(agent: Agent): TeamMembership \| undefined` | ⚠️ 仅覆盖 teammate | 只能识别「是某团队成员」，对普通 subagent / workflow 子会话返回 undefined；且依赖 agent-teams 插件已加载（当前 profile 已含 `@deepseek-ai/dsh-experimental-agent-team-profile`） |
| `ctx.subagents.listChildren(parentSessionId)` | `async listChildren(parentSessionId: SessionId, signal?): Promise<SubagentCatalogEntry[]>` | ❌ 反向查询 | 需要父 id 才能列子，且**要求 `sessionQuery` 服务**（`dsh-subagent` L2346-L2349 抛 `SUBAGENT_CONTROL_QUERY_UNAVAILABLE`）；不能回答「我是不是子」 |
| `ctx.subagents.listDescendants(rootSessionId)` | 同上 | ❌ 同 listChildren | 同上 |
| agent 的 `cwd` / `session` 头其它字段 | — | ❌ | 子会话的 cwd 由 `workingDirectory.set(child, create.cwd, ...)` 显式设置（`dsh-subagent` L1802-L1804），与父可相同可不同，**无判别力** |

### 1.6 子会话来源覆盖度

| 子会话类型 | 是否带 `parentAgent` | 证据 |
|---|---|---|
| subagent（spawn / fork in-process） | ✅ | `dsh-subagent` L1811 / L1817 `parentAgent: parent` |
| **teammate** | ✅（teammate 就是 subagent） | `asar:.../dsh-experimental-agent-team/lib/index.js` L4 `import { steerHostSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal"`；L9 `import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent"` |
| workflow 子 run | ✅（同一子会话模型） | `asar:.../dsh-tool-workflow/lib/index.js` L95-L105：`workflow/agent-start` 载荷带 `childId`；该包把执行委托给 `ctx.workflowEngine`（L47-L53 注释）。**`@deepseek-ai/dsh-workflow` 内的实际创建调用未读（未验证）** |
| 用户新建 / 恢复的会话 | ❌ 无 parent | `dsh-agent-loop` L1823-L1842（`create` 不传 parentAgent）、L1969-L2020（`resumeWith` 从 `options.parentAgent` 取，用户路径为 undefined） |

### 1.7 落地写法（可直接用）

```js
export function apply(ctx, config) {
  ctx.on("agent/created", async ({ agent, source }) => {
    if (!config.includeSubagents && !ctx.agents.roots().includes(agent)) return;
    // 只对主 agent 注册 per-agent 行为
    ctx.effect(() => agent.ctx.effect(function* () {
      yield agent.ctx.on("agent/pre-step", handler);
    }, "my-plugin: per-agent"), "my-plugin: agent registration");
  });
}
```

> `agent/created` 是 `serial` 模式（inspect Event 目录），监听器必须 `await` 完成后再返回；抛错会使发布失败（`dsh-agent` L580-L589）。

---

## P2 裸包名解析

### 2.1 结论先行

| 包 | 能否 `import` | 确定性 | 依据 |
|---|---|---|---|
| `@deepseek-ai/schemastery` | ✅ **能** | **已验证** | 物理存在于 `profile:node_modules/@deepseek-ai/schemastery`（且是 `@deepseek-ai/dsh` 自身依赖） |
| `@deepseek-ai/cosmokit` | ✅ **能** | **已验证** | 物理存在于 `profile:node_modules/@deepseek-ai/cosmokit` |
| `@deepseek-ai/dsh-llm` | ✅ **能** | **已验证（间接）** | 磁盘上任何位置都不存在；由**运行时模块解析拦截**提供（见 2.4） |

**但强烈建议：Host 半体不写任何 `@deepseek-ai/*` 值导入**（除 `schemastery`，见 2.6 建议）。理由见 2.5。

### 2.2 profile 的真实解析拓扑（实测）

`profile:pnpm-workspace.yaml`：

```yaml
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
```

`profile:node_modules/@deepseek-ai/` 的**完整内容只有两项**：

```
cosmokit      link=
schemastery   link=
```

实测（`Test-Path` 全部 False）：

| 路径 | 存在 |
|---|---|
| `profile:node_modules/@deepseek-ai/dsh-tools` | ❌ |
| `profile:node_modules/@deepseek-ai/dsh-llm` | ❌ |
| `profile:node_modules/@deepseek-ai/dsh` | ❌ |
| `profile:node_modules/@deepseek-ai/cordis` | ❌ |
| `C:\Users\15068\node_modules` | ❌ |
| `C:\Users\node_modules` | ❌ |
| `C:\node_modules` | ❌ |
| `D:\node_modules` | ❌ |
| 整个 profile 树内名为 `dsh-tools` 的目录 | ❌（递归搜索无结果） |
| profile 树内的 reparse point / symlink 投影 | ❌（`-Attributes ReparsePoint` 无结果） |
| `$env:NODE_OPTIONS` | 空 |

⇒ **不存在任何可用普通 Node 解析规则到达 `@deepseek-ai/dsh-tools` 的位置。**

### 2.3 反证：peer-only 导入在运行时确实成功

`profile:node_modules/@jiaoqsh/dsh-document/package.json`：

```json
"peerDependencies": {                     // L58-L63
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-fs": ">=0.1.0-rc.6 <0.3.0",
  "@deepseek-ai/dsh-system-prompt": ">=0.1.0-rc.6 <0.3.0",
  "@deepseek-ai/dsh-tools": ">=0.1.0-rc.6 <0.3.0"
},
"dependencies": {                         // L64-L68
  "@deepseek-ai/schemastery": "^3.18.4",
  "@firecrawl/anydoc": "0.1.9",
  "@firecrawl/pdf-inspector-wasm": "1.14.2"
}
```

`profile:node_modules/@jiaoqsh/dsh-document/lib/index.js`：

```
L1: import Schema from "@deepseek-ai/schemastery";     ← 真实 dependency  pnpm 已装
L4: import { defineTool } from "@deepseek-ai/dsh-tools"; ← 仅 peer  磁盘上不存在
L613: export { Config, ..., apply, inject, name, ... }
```

**该插件是活的**：`cordis_inspect_query` host `Tool.listTools` 返回了 `read_document`（完整 schema）。
⇒ `@deepseek-ai/dsh-tools` 的裸名导入**在运行时被成功解析**，尽管它不在磁盘上。

### 2.4 机制：运行时安装「profile 模块解析拦截」

`asar:.../dsh/lib/profile-boot-C14i-8IN.js`：

```js
return {
  profile,
  resolution: await createRuntimeResolution({          // L241-L244
    installAnchor: resolvedProfile?.installAnchor ?? INSTALL_ANCHOR,
    profile
  }),
  ...
};
```

```js
const ctx = await boot(NAME, rootConfig, readProfilePatches(...), async (hostCtx) => {
  app.current = hostCtx;
  hostCtx.provide("profileContext", profileContext);
  await hostCtx.plugin(PluginPackages, { resolution: composed.resolution });   // L306
  ...
});
```

`asar:.../dsh-app-boot/lib/index.js`：

```js
* @param resolution - the same immutable package resolution used for profile boot.
* @throws when Node's profile module resolution cannot be installed.        // L3272
*/
async function collectConfigSchemas(profile, entries, resolution, diagnostics = []) {
  ...
  const interception = installRuntimeInterception(resolution);              // L3280
```

JSDoc L3265-L3266 补充：*"Calls must not overlap another profile-resolution interception; module imports remain cached after the interception is released."*

⇒ DSH 在进程内安装一层 **Node 模块解析拦截**，把「随 dsh 安装的包名」映射到 dsh 安装目录。这与 `dsh-desktop-host/lib/cli.js` L1 / L42 使用的同一机制一致：

```js
import { registerHooks } from "node:module";            // L1
...
return registerHooks({ resolve(specifier, context, nextResolve) { ... } });   // L42
```

`registerHooks` 的 resolve 钩子是**进程级**的，按 specifier 匹配，与导入方所在目录无关。

### 2.5 风险与「本地目录安装（linked）」的差异

- `references/host-plugin.md` L35：*"Local directory installation links the checkout instead"* —— `install_bundle` 传绝对目录时，profile 里是**链接**而非拷贝。
- Node ESM 默认解析 **realpath**。链接包的 realpath 在工作区（如 `D:\MyTools\Test\<pkg>`），其裸名解析会从工作区向上走，**看不到** `profile:node_modules`。
- 因此链接包的裸名解析**完全依赖 2.4 的拦截**。

**未验证**：拦截的作用域规则（是否只对 profile 目录下的导入方生效，还是全局按 specifier 生效）。我读了 `installRuntimeInterception` 的调用点与契约注释，**未读其函数体**。
**风险**：若拦截按导入方路径收窄（类似同文件 L48-L52 对 libreoffice 的 `canonical.startsWith(source)` 校验），则链接包导入 `@deepseek-ai/dsh-llm` 会失败。

### 2.6 确定的写法建议

| 项 | 建议 | 依据 |
|---|---|---|
| `@deepseek-ai/*` 依赖声明 | 写进 `peerDependencies`（含版本范围），**不要**写 `dependencies` | `autoInstallPeers: false` ⇒ peer 不会被安装，这正是设计预期；`dsh-document` L58-L63 就是这么做的 |
| 真实第三方包 | 写进 `dependencies` | `dsh-document` L64-L68（`@firecrawl/*` 被真实安装） |
| Host 半体裸名导入 | **除 `schemastery` 外一律不写** | `profile:node_modules/dsh-ops/lib/config.js` L5-L9 原文见下 |
| `Config` 的 schema | 用 `@deepseek-ai/schemastery`（它物理存在于 profile，且是 dsh 自身依赖） | 2.2 + `dsh-tool-workflow` L1 / `dsh-subagent` L1 / `dsh-agent-loop` L3 均为该包 |
| 若坚持零裸名导入 | 复制 `dsh-ops` 模式：不导出 `Config`，自己显式校验并抛错 | 但会**失去设置页自动表单**（见 task-1 Q5），不满足「轮数可在插件菜单设置」 |

`profile:node_modules/dsh-ops/lib/config.js` L5-L9（第三方插件的权威经验）：

> *"The plugin deliberately exports no Schemastery `Config`: this host half must resolve with no `@deepseek-ai/*` value import of its own (**the profile loader supplies those names**, and every extra one is another way for the plugin to fail to load). Validation is therefore explicit and fails loud, naming the offending key, which is what the loader's own schema would have done."*

实测：`profile:node_modules/dsh-ops/lib/index.js` 的 11 条 import **全部是相对路径**（无任何裸名）。

**交付前的一次性验证（成本极低，不违反"不安装"约束时由 developer 执行）**：
安装后调 `cordis_inspect_query` host `Config.listConfigs`，确认本插件 entry 的 `status === "schema"`（说明 `Config` 被成功求值、裸名导入成功）；再用 `Slots`/设置页确认表单出现。

---

## P3 消息构造契约

### 3.1 `createUserMessage` 精确签名

`asar:node_modules/@deepseek-ai/dsh-llm/lib/index.js` L37-L64：

```js
function createMessage(input) {                                    // L37
  return deepFreeze(structuredClone({ ...input, id: brandString(randomUUID()) }));   // L38-L41
}

/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {                                 // L59
  return createMessage({ ...input, role: "user" });                 // L60-L63
}
```

| 字段 | 是否必填 | 说明 |
|---|---|---|
| `content` | ✅ 必填 | `ContentBlock[]`；**纯文本块形状 = `{ type: "text", text: string }`** |
| `source` | ✅ 必填 | 至少含 `kind: string`；见 3.3 |
| `role` | 自动 | 固定 `"user"`（L62） |
| `id` | **自动** | `brandString(randomUUID())`（L40）；**不要自己传** |

**文本块形状**的直接证据：`createSystemMessage`（同文件 L86-L95）

```js
function createSystemMessage(text) {
  return createMessage({
    role: "system",
    content: text.length === 0 ? [] : [{ type: "text", text }],     // L89-L92
    source: { kind: "system-prompt" }                               // L93
  });
}
```

`createMessage` 是 `deepFreeze(structuredClone(...))` ⇒ 传入的对象**不会被就地修改**，返回的是冻结副本。

### 3.2 `agent/pre-step` 返回的额外消息 —— 框架**不补全**任何字段

`asar:.../dsh-agent-loop/lib/index.js` L1066-L1074：

```js
let contextAdmitted = false;
if (firstAttempt) for (const message of decision.messages) if (message.source.kind === "runtime-context") {
    if (context !== void 0 && !contextAdmitted) {
      this.session.append("user/message", context, { surfaceOp: "append" });   // L1069
      contextAdmitted = true;
    }
  } else this.session.append("user/message", message, { surfaceOp: "append" });  // L1072
if (context !== void 0 && !contextAdmitted) this.session.append("user/message", context, { surfaceOp: "append" });
firstAttempt = false;                                                          // L1074
```

必须知道的四点：

1. **零字段补全**：`message` 原样交给 `session.append`。框架只**追加** `surfaceOp: "append"`（L1072），**不要自己加**。
2. **`message.source.kind` 是无保护解引用**（L1067）。消息若缺 `source`，这里直接抛 `TypeError` ⇒ **`source.kind` 是硬性要求**。
3. **只在 `firstAttempt` 追加**（L1067）；`firstAttempt` 在 L1074 置 false。后续 attempt（如 `agent/request-error` 重试）**不会**重复追加 decision 消息 ⇒ 不会重复注入。
4. `runtime-context` 那条消息会被**替换**为框架重算的 `context`（L1068-L1071），你传的原对象不生效 —— 所以**不要**用 `source.kind === "runtime-context"`。

### 3.3 `source` 的必填 / 可选字段，以及自定义 `kind` 是否安全

**会话层不校验 `source`。** `asar:.../dsh-session/lib/index.js` L242-L277（`validateSessionEventData`）对 `user/message` 只检查：

- `developer/message` ↔ `role === "developer"` 必须同时出现（L247）
- `tool-addition` / `tool-removal` 块要求 developer 角色（L248）
- `tool/result` 的 `error` 必须配 `isError: true`（L271-L276）

**没有任何 `source` 形状检查**，也没有已知 kind 白名单。
另：`deriveEventMessage` 对 `user/message` 直接返回 `event.data`（L221）⇒ `user/message` 的 `data` **就是整条消息**。

⇒ **自定义 `kind` 字符串是安全的**；未知 kind 只会「不被特殊处理」。代码里大量自定义 kind 的先例：

| 例子 | source | 证据 |
|---|---|---|
| 系统提示 | `{ kind: "system-prompt" }` | `dsh-llm` L93 |
| 工具结果 | `{ kind: "tool", callId }` | `dsh-llm` L104-L107 |
| 运行时上下文快照 | `{ kind: "runtime-context", form: "snapshot", sections }` | `dsh-agent-loop` L343-L347 |
| 工作区指令 | `{ kind: "agent-instructions", form: "instructions", baseline: true, baselineIdentity, changes }` | `dsh-agent-instructions` L1304-L1313 |
| 模型切换通知 | `{ kind: "model-selection", form: "notice", summary }` | `dsh-agent-loop` L141-L145 |

**已识别并会被特殊处理的 kind（务必避开）**：
`"runtime-context"`（`dsh-agent-loop` L218 `const SOURCE = "runtime-context"`、L220-L222 `isOwned`、L1067）、`"agent-instructions"`（`dsh-agent-instructions` L910-L912、L1204-L1206）、`"system-prompt"`（`dsh-llm` L93）、`"model-selection"`（`dsh-agent-loop` L141-L145）、`"tool"`（`dsh-llm` L104-L107）。

**必填 / 可选汇总**：`kind` 必填（被 L1067 读取）；`form`、`baseline`、`baselineIdentity`、`changes`、`summary`、`sections`、`callId` 全部**可选**，仅在对应 kind 下有意义。

### 3.4 最小可用调用示例（可直接复制）

```js
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// 每 N 轮注入 AGENTS.md 的一条 user 消息
function buildInjection(text) {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "agents-md-periodic", form: "injection" }
  });
}
```

在 `agent/pre-step` 中插入（必须 spread decision）：

```js
ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
  const decision = await next();
  if (decision.kind === "reject") return decision;
  if (turn % config.everyTurns !== 0) return decision;
  const injected = buildInjection(await readAgentsMd(ctx, signal));
  return { ...decision, messages: [...decision.messages, injected] };
});
```

要点：

- 必须 `{ ...decision, messages }`，否则丢 `startsRequestSeries`（`references/practices.md` L16）。
- 不要给消息加 `surfaceOp`（框架在 `dsh-agent-loop` L1072 补）。
- 不要自己生成 `id` / `role`（`createUserMessage` 已处理，`dsh-llm` L40、L62）。
- 注入消息必须带 `source.kind`（`dsh-agent-loop` L1067 无保护解引用）。

---

## 未验证清单

| # | 未验证内容 | 原因 | 影响 |
|---|---|---|---|
| U1 | `SessionStartSource` 的 `"clear"` / `"compaction"` 调用点 | 仅 JSDoc（`dsh-agent` L567）列出，未找到调用者 | 不影响 P1（两种取值都不区分主/子） |
| U2 | `installRuntimeInterception` 的作用域规则（全局 vs 按导入方路径收窄） | 只读了调用点与契约注释（`dsh-app-boot` L3265-L3280），未读函数体 | **影响 linked 安装能否导入 `@deepseek-ai/dsh-llm`**；缓解：只用 `schemastery` + 安装后查 `Config.listConfigs` |
| U3 | `sessions.fork()` 是否写入 `header.parentSession` | 未读 `dsh-session` L1387 的 `fork` 实现 | 若写入，途径 B 会把用户 fork 判为非主 agent；**故推荐途径 A** |
| U4 | `@deepseek-ai/dsh-workflow` 内 workflow 子 run 的实际创建调用 | 只确认了 `workflow/agent-start` 带 `childId`（`dsh-tool-workflow` L103）与委托关系 | 低风险：子 run 走同一子会话模型 |
| U5 | `SessionStartSource` 的 TS 类型声明原文 | asar 未打包 `lib/types/**/*.d.ts`（`read` 返回 not found） | 取值集合由 JSDoc + 调用点归纳，非类型原文 |
| U6 | `agent/created` 期间 `ctx.agents.roots()` 的**并发**可见性 | 只证明了本 agent 的 entry 已 `enter`（`dsh-agent-loop` L1790-L1794） | 单 agent 判定安全；若同一 tick 多个 agent 并发创建，`roots()` 可能包含无关 agent —— 因此**必须用 `.includes(agent)` 而不是 `.length === 1`** |

## 证据索引

| 文件 | 路径 |
|---|---|
| dsh-agent | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent\lib\index.js` |
| dsh-agent-loop | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js` |
| dsh-subagent | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-subagent\lib\index.js` |
| dsh-experimental-agent-team | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-experimental-agent-team\lib\index.js` |
| dsh-tool-workflow | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-tool-workflow\lib\index.js` |
| dsh-llm | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-llm\lib\index.js` |
| dsh-session | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session\lib\index.js` |
| dsh-app-boot | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-app-boot\lib\index.js` |
| dsh profile-boot | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\profile-boot-C14i-8IN.js` |
| dsh-desktop-host cli | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js` |
| profile 根 | `C:\Users\15068\.dsh\profiles\desktop\` |
| dsh-ops（第三方参考） | `C:\Users\15068\.dsh\profiles\desktop\node_modules\dsh-ops\lib\` |
| dsh-document（第三方参考） | `C:\Users\15068\.dsh\profiles\desktop\node_modules\@jiaoqsh\dsh-document\` |
