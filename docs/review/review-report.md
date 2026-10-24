# 对抗性审核报告：每 N 轮注入 `~/.dsh/AGENTS.md`

| 项 | 值 |
| --- | --- |
| 任务 | task-3 对抗性审核调研与设计文档的技术断言 |
| 审核对象 | [api-findings.md](../research/api-findings.md)（426 行）、[plugin-design.md](../design/plugin-design.md)（883 行） |
| 审核员 | reviewer |
| 环境 | DSH `0.2.1-rc.2`、Session 格式 `4`、asar 根 `D:\DSH\resources\app.asar\dsh\` |
| 本次实际执行的取证 | `read`（asar 源码逐行）、host `Event.listEvents`（成功）、client `Slots.listSubTree` ×3（全部超时）、client `Theme.listTokens`（超时） |
| 结论摘要 | **3 项阻塞**（其中 1 项直接导致核心需求不成立）、**10 项非阻塞**、**11 项无法验证** |

审核方法：不采信两份文档的转述，逐条回到 asar 源码行号复核；凡两份文档标注 `[待验证]` / `[U#]` 的，逐条检查是否被下游写成已验证事实；对设计草案做「照此实现会怎样失败」的推演。

---

## 1. 断言复核表

三态判定：**成立** / **不成立** / **无法验证**。「证据强度」列说明该判定是直接源码、运行时证据还是间接推断。

### 1.1 注入机制（争议点 1）

| # | 断言（来源） | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| A1 | `agent.inject(msg)` = `send(msg,"next-step",false)`，不唤醒（T1 L88-L117、设计 3.4.2） | **成立** | `dsh-agent-loop/lib/index.js` L800-L814 逐字一致 | 直接源码 |
| A2 | `followup`→`next-turn`+唤醒、`steer`→`next-step`+唤醒 | **成立** | 同文件 L806-L811 | 直接源码 |
| A3 | **在 `turn/end` 监听里 `inject()` 会立即多开一轮**，产生只有注入内容的模型调用（T1 L122、设计 R2/坑 1） | **成立** | ① `turn()` 在 `finally` 追加 `turn/end`（L1027-L1032）② 之后判 `if (!this.inbox.hasPending) return false;`（L1037）③ `kick()` 为 `while (await this.turn());`（L889）；`session/event` 是 `mode: emit`（host Event 目录原文 "Post-commit, fire-and-forget append feed"），`EventsService.emit` 同步派发（cordis L280-L282） | 源码链完整；仅 `Session.append`→`emit` 的调用点未逐行读取 |
| A4 | idle 时 `inject()` 不唤醒 → 消息滞留 inbox（T1 L121、设计坑 2） | **成立** | L812-L814 `wakeup=false` 不调用 `wakeDriver`；`practices.md` L29 原文一致 | 直接源码 + 官方文档 |
| A5 | `agent.cancel()` 默认 `keepInbox=false` 清空 inbox（T1 L123、设计坑 3） | **成立** | L815-L821 | 直接源码 |
| A6 | `agent/pre-step` 是 waterfall，payload `{agent,messages,turn,step,signal}`（T1 L143-L145、设计 BR-1） | **成立** | host `Event.listEvents` 实测签名逐字一致；源码 L909-L913 派发 `{messages, turn, step, signal}` 且 `agentEvents` 的 `fused()` 补 `agent`（`dsh-agent` L242-L246） | 运行时权威 + 源码 |
| A7 | 在 `agent.ctx` 上注册 `agent/pre-step` 能收到该 agent 的事件（设计 3.4.1/3.8） | **成立** | 派发经 `agentCarrier(agent)`（`dsh-agent` L230-L232 = `scopeTarget(agent, agent)`），过滤逻辑 `scopeTarget` 允许 tag 等于 key 或祖先（`dsh-scope` L327-L338）；`agent.ctx` 带 `[kScope]=agent`（`dsh-scope` L296-L306、`dsh-agent-loop` L777-L779） | 直接源码 |
| A8 | pre-step 返回的额外消息落为 `user/message` + `surfaceOp:"append"`（T1 L199、设计 3.4.1） | **成立** | `dsh-agent-loop` L1066-L1073，非 `runtime-context` 的消息走 L1072 `surfaceOp:"append"` | 直接源码 |
| A9 | 改写 decision 必须 spread（T1 L198、设计 3.4.1） | **成立** | `practices.md` L16 原文；`step()` 读 `decision.startsRequestSeries`（L1056） | 直接源码 + 文档 |
| A10 | 设计 3.4.5 草案在 `decision.kind === "reject"` 时会抛错 | **不成立（设计缺陷）** | `preStep` 在 reject 时原样返回 decision（L922），此时 `decision.messages` 可能不存在；草案直接 `[...decision.messages, injected]`。对照：shipped `agent-instructions` L1412 与 `dsh-agent` L195 都显式判 reject | 直接源码 |

**争议点 1 复核结论**：researcher 的两条源码证据（L800-L814、L1037/L889）**逐字成立**，Lead 的裁决依据成立。设计最终采用 `agent/pre-step` 条件化改写作为主方案，在机制自洽性上成立（A6-A9 全部成立）；但草案实现有一个真实缺陷 A10。

### 1.2 轮次与会话语义

| # | 断言 | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| B1 | turn 是 1 基会话绝对轮号，跨 resume 单调延续 | **成立** | L938-L949（`const turn = phase.turn + 1`、`turn/start`）、L782-L786（构造时读 `turnBoundary.lastTurn`）、L1992-L1999（seed 重放 + `interruptedTurnClosers`） | 直接源码 |
| B2 | `turn/end` 是 session 事件而非 Host 事件 | **成立** | host Event 目录无 `turn/end`（本次实测）；`dsh-session` L136-L137 在 `KNOWN_SESSION_EVENT_TYPES` 中；L1029-L1032 追加 | 运行时权威 + 源码 |
| B3 | step 每 turn 重置，一个 turn 可多 step → 同 turn 内 pre-step 多次触发 | **成立** | L955-L959、L1040 `phase.step = 0` | 直接源码 |
| B4 | 设计「不假设免疫压缩」的处理方式（E7/E8） | **成立（处理正确）** | 设计未把 `[U3]` 写成事实，且给出「下周期重发」自愈路径；`compaction/start|summary|prune|end` 确为已注册 session 事件（`dsh-session` L89-L92） | 直接源码 |

### 1.3 Config 与设置入口（争议点 2 的一半，含 Lead 的 C1/C2）

| # | 断言 | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| C1 | **设计 4.1 的 Config 无 `.volatile()` → 该 entry 从设置表单整条消失** | **成立（阻塞）** | `dsh-settings/lib/index.js` L413-L419：`const form = volatileForm(schema); if (form === void 0) return [];`；L122-L131：非 `meta.volatile` 且非 object 的节点返回 `undefined`，object 只保留「有 volatile 后代」的字段 | 直接源码 |
| C2 | **标记 volatile 后，未标 volatile 的字段不会出现在表单里，也不可经 settings 写回** | **成立** | 同 L122-L131；另 L505-L507 `write()` 对非 volatile 路径抛 `Config field "..." is not volatile`；L153-L158 `isVolatilePath` | 直接源码 |
| C3 | schemastery 提供 `.volatile()` 修饰符 | **成立** | `schemastery/lib/index.mjs` L235-L238 `extra("volatile", true)`；L240-L252 校验「volatile 不能有 volatile 祖先」 | 直接源码 |
| C4 | **volatile 字段的解析值是包装对象，必须 `.get()` 解包** | **成立（阻塞，与 C1 耦合）** | ① `schemastery` L265-L277：`meta.volatile` 时 `Schema.resolve` 返回 `createVolatile(value)`；② `cosmokit/lib/index.js` L102-L110 `createVolatile` 返回 `Object.freeze({ get: () => current, [write]: ... })`，L116-L118 `isVolatile` 以 `write in value` 判定；③ `cordis` L956-L961 `resolveConfig` 走 `Config["~standard"].validate`，L1071 以 `this.config` 调用插件回调，L1355 `this.config = this._resolveConfig(...)` → **插件 `apply(ctx, config)` 收到的 `config.everyTurns` 是包装对象**；④ `dsh-settings` L98 `plainConfig` 用 `isVolatile(value) ? value.get()` 佐证 | 直接源码链 |
| C5 | `autoGenerate` 默认 true、描述符 `applies:"live"` | **成立** | `dsh-settings` L426 `?? true`、L446 `applies: "live"` | 直接源码 |
| C6 | 设计 4.2 的「等价 JSON Schema 草案」就是设置描述符里的 schema 形态 | **不成立** | `schemastery` L70-L83 `toJSON()` 返回 `{uid, refs}` 引用包，节点是 `{type:"number", meta:{...}, uid}`；`dsh-settings` L103-L116 `plainSchema` 用 `new z(schema.toJSON())` 再走 `node.meta`，L444 描述符 `schema: form.toJSON()` | 直接源码 |
| C7 | B4：`z.number().step(1)` 经 `toJSON` 输出 `integer` 还是 `number` | **成立（输出 `number`）** | `schemastery` L609 `defineMethod("number", [], () => "number")`，L560 `new Schema({type:name})` | 直接源码 |
| C8 | R7「非 volatile 字段不出现在表单里」 | **成立** | 同 C1/C2 | 直接源码 |

### 1.4 消息构造（B1 复核）

| # | 断言 | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| E1 | `UserMessage` 构造器 `createUserMessage` 由 **`@deepseek-ai/dsh-llm`** 导出 | **成立** | `dsh-llm/lib/index.js` L59-L64 定义并导出；三个独立引用：`dsh-agent-instructions` L2、`dsh-agent` L5、`dsh-agent-loop` L6 全部 `import { createUserMessage } from "@deepseek-ai/dsh-llm"` | 直接源码（三处互证） |
| E2 | 必填字段 | **成立** | `dsh-llm` L37-L42 `createMessage({...input, id})`、L59-L64 补 `role:"user"` → 输入至少需 `content`（ContentBlock[]）与 `source`；`id`/`role` 由工厂生成 | 直接源码 |
| E3 | 是否需经 session/agent 工厂 | **成立（不需要）** | `createUserMessage` 是纯函数；shipped `agent-instructions` 作为**非 agent-loop 包**直接调用（L880-L887） | 直接源码 |
| E4 | `source.kind` 可用插件自定义字符串 | **部分成立** | shipped 插件用 `{kind:"agent-instructions", form:"instructions", ...}`（L885-L887）；渲染层是否特殊处理未知 kind **无法验证**（B10 未消解） | 直接源码（仅写入侧） |
| E5 | 设计把 B1 定性为「编码前唯一硬阻塞 / 构造器导出包名未知」 | **不成立（定性过重）** | 同 E1-E3：包名、导出名、必填字段均可从源码确定 | 直接源码 |

### 1.5 文件、路径与清理

| # | 断言 | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| F1 | `resolveDshHome()` 优先级 显式 > `$DSH_HOME` > `~/.dsh` | **成立** | `dsh-home-paths` L101-L111 | 直接源码 |
| F2 | 基类 `fs.watch` 默认拒绝 | **成立** | `dsh-fs` L70-L73 `Promise.reject(new FsError("Filesystem watching is not supported...", "FS_IO_ERROR"))` | 直接源码 |
| F3 | host 插件可经 `ctx.get("fs")` 读文件且读路径无 policy 参数 | **成立（源码级）** | `agent-instructions` L1237-L1238 可选获取 `ctx.get("fs")`；本次未逐行读 L831-L851 的 `streamText` 调用点 | 直接源码 + 间接 |
| F4 | `maxSourceBytes` 默认 1048576 与 shipped 一致 | **成立** | `agent-instructions` L19 `DEFAULT_MAX_SOURCE_BYTES = 1048576`、L28 | 直接源码 |
| F5 | `~/.dsh/AGENTS.md` 的确切候选常量（`USER_GLOBAL_FILE` L168 等） | **无法验证** | 本次未逐行读 `agent-instructions` L161/L168/L480-L497 | — |
| F6 | `agent/created` payload `{agent,source,signal?}`（serial）、`agent/disposed` payload `{agent}`（emit）（设计 B2 标为待验证） | **成立（B2 可关闭）** | host `Event.listEvents` 实测签名；源码 `dsh-agent` L581-L585、L549-L554 | 运行时权威 + 源码 |
| F7 | 在 `agent.ctx` 注册的 `agent/disposed` 监听能收到事件（设计 3.8 第 3 步、BR-8） | **不成立** | `dsh-agent-loop` teardown 顺序：L1721 `await machine?.scope.dispose()`（agent.ctx 注册在此解绑）先于 L1731 `detachAgent?.()`（→ `emitDisposed`）；Event 目录描述亦为 "after driver quiescence and scoped-registration unwind" | 直接源码 + 运行时权威 |
| F8 | 因此会泄漏 Map 条目 | **不成立（不泄漏）** | `agent.ctx.effect` 的返回函数内含 `states.delete(agent)`（设计 3.4.5），该 disposer 在 L1721 执行 | 直接源码 |

### 1.6 Client slot（争议点 2 的另一半）

| # | 断言 | 判定 | 证据 | 证据强度 |
| --- | --- | --- | --- | --- |
| G1 | `settings.section` / `settings.general.item` / `settings.plugins.tab` / `plugins.tab` / `plugins.bundle.config` 真实存在 | **无法验证** | client inspect 通道在本会话**整体不可用**：`Slots.listSubTree` 连续 3 次 `timed out after 10000ms`，且不带 input 的 `Theme.listTokens` 同样超时 → 说明是页面/通道问题而非 slot 不存在 | 无法验证（环境） |
| G2 | 设计把 slot 键从「源码推断」升级为「运行时已验证」（`[Lead]`） | **证据强度降级（非阻塞）** | 该升级仅有一次 Lead 运行的单一来源，本审核无法独立复现。**不判为不成立**，但文档应标注 single-source | — |
| G3 | `plugins.bundle.config` key = bundle 包名、`view:'page'` only、props 形状 | **无法验证** | 同 G1 | — |

### 1.7 未验证项是否被写成事实（争议点 3，本次最重要）

逐条核对两份文档后，**未发现把 `[U1]`-`[U7]` 或 `[待验证]` 直接写成已验证事实的情形**：设计 8.2、附 A 完整保留 U1-U7，并在 BR-1/3.3/3.5/3.6/4.4/附 A 逐处标注 `[待验证]`。争议点 3 的答案是：**未发现该违规**。

但有 3 处「未验证 → 已验证」的**定性偏移**（详见第 4 章 NB-4/NB-5/NB-6）：B1 被高估为「包名未知的硬阻塞」、slot 键被升格为「运行时已验证」、B2/B4 本可关闭却仍列为待验证。三者方向不同，但都属于证据分级不准。

---

## 2. 对抗场景表

假设照设计文档（含 3.4.5 草案原文）实现，以下是会真实失败的场景。

| # | 场景 | 触发条件 | 后果 | 严重度 |
| --- | --- | --- | --- | --- |
| S1 | **插件菜单里根本没有轮数** | 按 4.1 原样声明 Config（无 `.volatile()`），安装后打开设置页 | `volatileForm` 返回 `undefined` → `describe()` 跳过该 entry → 表单无此插件。**用户需求「轮数要能在插件菜单里设置」不成立**（C1） | 阻塞 |
| S2 | **表单里只有轮数一项** | 修好 S1（给 `everyTurns` 加 `.volatile()`） | `volatileForm` 只保留 volatile 子树 → `enabled`/`maxSourceBytes`/`maxInjectBytes`/`truncateOversize`/`wrapSystemReminder`/`onlyIfChanged`/`includeSubagents` 全部不可见，且 `settings.write` 对非 volatile 路径直接抛错 → 用户只能改 patch（C2） | 高（非阻塞） |
| S3 | **修好 S1 后反而永不注入** | 加 `.volatile()` 但代码仍写 `payload.turn % config.everyTurns` | `config.everyTurns` 是 `{get()}` 包装对象 → `turn % obj = NaN`、`Number.isInteger(obj) = false` → `shouldInject` 恒 false → **静默失效，无任何报错**（C4） | 阻塞 |
| S4 | **其他插件的 reject 决策把 turn 打断** | 任一前置/后置 pre-step 监听器返回 `{kind:"reject"}` | 草案 `[...decision.messages, injected]` 抛 `TypeError` → 异常冒泡出 `preStep` → `turn()` 捕获为 `turnEnds.kind = "error"`（L1010-L1026）→ 用户看到 turn 失败（A10） | 阻塞 |
| S5 | **resume 后补注入一次** | 会话在 turn = N 的倍数处崩溃/恢复，水位线 `Map` 为空 | `lastInjectedTurn = -1` → 该 turn 多注入一份副本。设计 3.3(a) 已接受，语义无害 | 低（已接受） |
| S6 | **fork 后注入节奏不可预期** | 用户 fork 会话 | 新会话轮号是否继承父会话未验证（设计 E16/B8）→ 可能 fork 后立刻注入或很久不注入。行为自洽但**无法承诺** | 中（未验证） |
| S7 | **compaction 吞掉已注入副本** | 长会话触发 `compaction/start|summary|prune` | 注入副本被压缩/替换 → 重锚效果削弱，直到下一个命中轮号才恢复。设计 E7/E8 已按此设计（不假设免疫） | 中（已接受，未验证） |
| S8 | **子智能体注入爆炸** | `includeSubagents` 默认 true + workflow 扇出大量子 agent + 用户把 N 调成 1 | 每个 agent 每个 turn 各注入一份全文 → 上下文与 token 成本随 agent 数×turn 数乘性增长；且 `includeSubagents:false` 因缺少判定谓词**无法实现**（设计 3.6） | 高 |
| S9 | **AGENTS.md 过大导致每轮 token 暴涨** | 文件 > `maxInjectBytes`（默认 16384） | L1 截断 → 模型看到**不完整规则**（默认 `truncateOversize:true`）；若设为 false 则退化为跳过，重锚失效 | 中（已量化） |
| S10 | **降级到 `agent.inject()` 后出现空转轮** | 主方案因故不可用，改用备选且在 `turn/end` 监听里注入 | `hasPending` 置真 → `while (await this.turn())` 继续 → 产生一次只有注入内容的模型调用（A3） | 高（设计已规避） |
| S11 | **idle 注入长期滞留** | 备选方案下 agent 空闲时 `inject()`，此后用户无输入 | 注入留在 inbox 永不生效，内容可能过期（A4） | 中（设计已规避） |
| S12 | **运行中改 N 后同 turn 重复注入** | 设置改动若以「重新 `apply`」传播，水位线 `Map` 随插件重载清空 | 同一 turn 内 `lastInjectedTurn` 丢失 → 该 turn 再次注入一份。设计 B5 标注传播方式未验证，但结论「不影响正确性」**过于乐观**：重复注入确实会发生（仅一次） | 中（未验证） |
| S13 | **卸载/销毁后监听器残留** | 若只依赖 `agent.ctx` 不保留 disposer，或依赖 `agent/disposed` 清理 | 设计已用双 owner 规避；但设计 3.8 第 3 步（`agent/disposed` 删条目）**不会执行**（F7），真正生效的是 `agent.ctx.effect` disposer。若 developer 按注释误删 effect 内的 `states.delete`，则残留 | 中（实现风险） |
| S14 | **同 turn 多 step 重复读盘/重复注入** | 一个 turn 内有多个 step（tool 循环） | `attemptedTurn`/`lastInjectedTurn` 双水位线可拦；但若 resume 重放 step>1（B9 未验证）则位置偏移 | 低（已设计） |
| S15 | **注入位置不在预期位置** | 多个 pre-step 监听器都改写 `messages` | 最终顺序由注册顺序决定；且尾部追加会落在默认 `next()` 生成的 **runtime-context 快照之后**（`dsh-agent-loop` L916-L919、L1066-L1073），而 shipped `agent-instructions` 落在 `lastClaimedIndex+1`。设计只说「尾部方向」，未说明这一相对位置 | 低（文档缺失） |

---

## 3. 需求覆盖表

用户原话拆解为 5 个验收点。

| # | 验收点 | 设计覆盖 | 判定 | 说明 |
| --- | --- | --- | --- | --- |
| R1 | **可设置轮数** | 4.1 `everyTurns` + 4.5 校验 | **部分覆盖** | Config 字段存在且校验完整，但按现草案该字段不会出现在任何 UI（S1/S3） |
| R2 | **在插件菜单里设置** | 4.4 落点 (a) 推荐 + 落点 (b) 兜底 | **未覆盖（阻塞）** | 落点 (a) 因 C1 确定性失败；落点 (b) 需 Client 半体且 slot 键本审核无法复现（G1）。**核心需求当前不成立** |
| R3 | **每 N 轮** | BR-2 / 3.3 `turn % N === 0` | **覆盖** | 判定式自洽；但命中轮号为 N、2N…，与「N 轮后」的严格读法差一轮（设计 A6/Q3 已标 `[需用户确认]`） |
| R4 | **自动注入 `~/.dsh/AGENTS.md`** | BR-3 路径 + 3.4.1 通道 + 6.2 读盘 | **覆盖** | 路径与读盘方式均有源码证据；写入侧 `source.kind` 与渲染层交互未验证 |
| R5 | **写入下一轮的上下文** | BR-1 / 3.4.1 | **部分覆盖** | 实际注入到**命中 turn 当轮**的 step（不是下一轮）；且落在 runtime-context 之后。设计 A6/Q3 已提示口径差异，但未量化「下一轮」的实现含义 |

**额外发现的需求口径问题**：`includeSubagents` 默认 true 且 false 不可实现（R3 的边界），意味着「每 N 轮」在子智能体上同样生效——这是用户原话未表达的行为，属设计自行扩大的范围（S8）。

---

## 4. 问题分级与修正建议

### 4.1 阻塞项（3 项，M2/M3 前必须解决）

**BLOCK-1（对应 Lead C1）设置入口缺失，核心需求不成立**
- 判定：**成立**。`dsh-settings` L413-L419 对 `volatileForm(schema) === undefined` 的 entry 直接 `return []`；L122-L131 使纯 `z.number()` 字段不构成 volatile 子树。
- 修正：`everyTurns: z.number().step(1).min(1).max(1000).default(10).volatile()`。
- 归属：architect 改 4.1 + 4.4；developer 在 M2 落地并做页面实测。
- 验收：安装后设置表单中该 entry 出现且 `everyTurns` 可改、改后下一轮生效。

**BLOCK-2（对应 Lead C2 的实现面）volatile 值必须解包**
- 判定：**成立**。`cosmokit` L102-L110 + `schemastery` L265-L277 + `cordis` L1071/L1355 构成完整链：`apply(ctx, config)` 收到的 `config.everyTurns` 是 `{get()}` 冻结对象。
- 修正（任选其一，建议前者）：
  ```js
  const n = isVolatile(config.everyTurns) ? config.everyTurns.get() : config.everyTurns;
  ```
  或在每次 `agent/pre-step` 现读 `config.everyTurns.get()`。`isVolatile` 从 `@deepseek-ai/cosmokit` 导入（`dsh-settings` L8 即此用法）。
- 同时修正设计 3.3 的 `shouldInject(turn, n, ...)` 契约：`n` 必须是解包后的 number，并保留 `Number.isInteger` 防御（C7 已证 toJSON 输出 `number`）。
- 归属：architect 改 3.3/3.4.5/4.1；developer 实现。

**BLOCK-3（新发现）pre-step 草案未处理 reject 决策**
- 判定：**成立**。`dsh-agent-loop` L922 原样返回 reject decision；草案 `[...decision.messages, injected]` 会抛 `TypeError` 并让 turn 以 `error` 结束。
- 修正：
  ```js
  const decision = await next();
  if (decision.kind === "reject") return decision;
  ```
  另建议补 `signal.throwIfAborted()`（shipped 插件 L1411 同款做法）。
- 归属：architect 改 3.4.5；developer 实现。

### 4.2 非阻塞项（10 项）

| # | 问题 | 判定 | 修正建议 |
| --- | --- | --- | --- |
| NB-1 | C2：表单只含 volatile 字段，其余 7 个字段不可见也不可写（`write()` L505-L507 抛错） | 成立 | 4.2/4.4 必须写明取舍：要么把希望可配的字段一并 `.volatile()`，要么明确「插件菜单只暴露轮数，其余走 patch」。二选一写进 README |
| NB-2 | 4.2 称「上表会以 JSON Schema 形式出现在设置描述符里」 | 不成立 | 描述符 schema 是 schemastery `toJSON` 的 `{uid,refs}` 形态（`schemastery` L70-L83、`dsh-settings` L103-L116/L444）。把 4.2 改标为「人类可读等价物，实际 wire 形态为 schemastery toJSON」；方案 B 写 Client 组件时按后者取值 |
| NB-3 | 3.8 第 3 步「`agent/disposed` 时删除条目」不会执行 | 不成立 | 删掉该监听（或保留但注释说明它是死代码）；清理唯一有效路径是 `agent.ctx.effect` 的返回函数，**必须保留其中的 `states.delete(agent)`**。B2 可关闭（Event 目录已给出 payload） |
| NB-4 | B1 被定性为「唯一硬阻塞 / 导出包名未知」 | 不成立（高估） | 改为：`import { createUserMessage } from "@deepseek-ai/dsh-llm"`，输入 `{content, source}`（role/id 由工厂补）。**残余风险只剩一项**：本地 linked bundle 能否解析该裸包名——这才是 M3 前要验证的唯一问题 |
| NB-5 | slot 键被升格为「运行时已验证」 | 证据单源 | 文档标注 single-source（`[Lead]`，reviewer 未能复现：client 通道本会话不可用）；落点 (b) 的设计不得以此为确定性前提 |
| NB-6 | B4 仍列为待验证 | 已可关闭 | `schemastery` L609 输出 `type:"number"`；保留 `Number.isInteger` 防御即可 |
| NB-7 | BR-4 未说明注入相对 runtime-context 的位置 | 文档缺失 | README 写明：本插件的副本位于 runtime-context 快照之后、shipped 基线之外，位置不做强保证 |
| NB-8 | 读取前后未检查 `signal` | 实现风险 | 在 `await readAgentsMd` 后、`await next()` 前后各加 `signal.throwIfAborted()`（对齐 `agent-instructions` L1235/L1411） |
| NB-9 | `includeSubagents:false` 不承诺生效 | 设计已承认 | 保留；README 与 Q8 已说明，无需改动 |
| NB-10 | 6.1 的 `ΔT ≈ bytes/3.5` 等系数 | 经验值 | 设计已标注「方法而非事实」，保留；M4 用真实测量替换 |

### 4.3 无法验证清单（本审核明确不判成立）

| # | 内容 | 原因 |
| --- | --- | --- |
| N1 | Client slot 键、scope、purpose、props（U2/G1） | client inspect 通道本会话整体不可用：`Slots.listSubTree` ×3 + `Theme.listTokens` 均 10s 超时 |
| N2 | 自动 Config 表单的**具体页面位置**（U5/B3） | 同 N1 |
| N3 | 四类注入点被 compaction 吞掉的行为（U3） | 未读 `dsh-compaction` / `dsh-compaction-basic` 的折叠逻辑；设计已按「不假设免疫」处理，判定为处理正确 |
| N4 | 第三方 bundle 能否解析并 import `@deepseek-ai/dsh-llm` | 未安装插件（硬约束禁止），无法实测模块图 |
| N5 | `source.kind` 未知值是否被渲染层特殊处理（B10） | 仅验证了写入侧（shipped 插件用自定义 kind） |
| N6 | 配置改动的传播方式：原地 `updateVolatile` 还是重新 `apply`（B5） | 未读 loader 的 `internal/update` 钩子 |
| N7 | fork 后新会话轮号是否重置（B8） | 未读 fork 实现 |
| N8 | `Config.listConfigs` 的 `status` 语义（U4） | 未读 inspect provider 源码 |
| N9 | `sessionProjections` key 约束是否对下游开放（U6） | 未读类型声明（asar 未打包 `.d.ts`） |
| N10 | `settings/document-updated` 的 ns 与 entry id 对应（U7） | 未读相关类型 |
| N11 | `agent-instructions` L161/L168/L480-L497 的候选常量与去重细节 | 未逐行复核 |

---

## 5. 总体结论

1. **争议点 1（注入机制）**：researcher 的两条源码证据**成立**，Lead 的裁决依据正确；设计最终采用 `agent/pre-step` 条件化改写**自洽**（A6-A9 全成立），但 3.4.5 草案有一个会打断 turn 的真实缺陷（BLOCK-3）。
2. **争议点 2（Client slot）**：本审核**无法复现** slot 运行时树（client 通道不可用），`[Lead]` 证据为单源；但 4.4 的**推荐落点 (a) 本身已确定性失败**——不是 slot 问题，而是 C1（缺 `.volatile()`）+ C4（缺 `.get()`）。因此「插件菜单设置轮数」当前不成立。
3. **争议点 3（未验证项）**：**未发现把 U1-U7 写成已验证事实**，设计在这一点上纪律良好；问题出在证据分级的两个方向性偏差（B1 高估、slot 键升格）。
4. **交付前必须做的 3 件事**：加 `.volatile()`、加 `.get()` 解包、补 reject 早返回。三者都可在 M2 内完成，不需要推翻架构。
5. 架构选择（pre-step + 零持久状态 + per-agent 内存水位线 + 双 owner 清理）在源码层面**成立**，无需推翻；只需按第 4 章修正。
