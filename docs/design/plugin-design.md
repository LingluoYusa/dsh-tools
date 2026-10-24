# 插件设计文档 AGENTS.md 周期注入

| 项 | 值 |
| --- | --- |
| 文档 ID | task-2 / docs/design/plugin-design.md |
| 版本 | v1.4 定稿（task-1 报告 + Lead 裁决 + task-3 审核 + task-5 复核 + **task-8 用户三条决策**） |
| 状态 | **设计定稿**。3 个阻塞项消除、NB-1~NB-8 落实、R-1/R-2/R-4/R-7 修正、用户决策 1/2/3 落实；未验证项以 `[U#]` / `[待验证]` / `[单源]` 显式保留 |
| 依赖 | `docs/research/api-findings.md`（task-1）、`docs/review/review-report.md`（task-3）、`docs/review/review-v12.md`（task-5）、`docs/design/impl-spec.md`（task-8 实现规格冻结） |
| 环境 | DSH `0.2.1-rc.2`、Session 格式 `4`、asar 根 `D:\DSH\resources\app.asar\dsh\` `[T1:L10-L12]` |
| 作者 | architect |
| 读者 | developer / tester / reviewer / lead |

## 0. 证据约定与决策速查

### 0.1 证据标记

| 标记 | 含义 |
| --- | --- |
| `[T1:L###]` | 来自 task-1 报告 `docs/research/api-findings.md` 第 ### 行（该行本身含 asar 源码路径与行号） |
| `[P:L##]` | 来自 `references\practices.md` 第 ## 行 |
| `[H:L##]` | 来自 `references\host-plugin.md` 第 ## 行 |
| `[R:L###]` | 来自 task-3 审核报告 `docs/review/review-report.md` 第 ### 行 |
| `[Rv:L###]` | 来自 task-5 复核报告 `docs/review/review-v12.md` 第 ### 行 |
| `[Lead]` | 由 Lead 在运行时实测提供（`Slots.listSubTree` 成功返回的 slot 树） |
| `[单源]` | 仅有一次运行时观测、审核方无法复现的证据。**不得当作确定性前提** |
| `[U#]` | task-1 报告 8.1 节列出的**未验证项**编号，禁止当事实使用 |
| `[待验证]` | 本文设计需要、但 task-1 报告与 Lead 证据均未覆盖的接口或行为 |
| `[需用户确认]` | 产品决策，不由源码决定 |
| `[推断]` | 由已证事实推导但未直接取证，使用前必须验证 |

**写作纪律**：凡未标注来源的技术断言都视为缺陷。本文不把任何 `[U#]` 或 `[待验证]` 内容写成已验证结论。Lead 四条裁决已全部落实，见 0.2。

### 0.2 决策速查表

| 决策点 | 结论 | 依据 |
| --- | --- | --- |
| 注入通道（裁决 1） | **`agent/pre-step` waterfall 条件化追加 user 消息**（主方案）；`agent.inject()` 为备选并附规避手段与代价 | T1:L205、T1:L394；`[P:L16]`；Lead 裁决 1 |
| 判定条件（v1.4 定稿） | **严格 N 轮后下一轮**：`(turn - 1) % N === 0 && turn > 1`，命中 N+1、2N+1、3N+1 …；不注册 sessionProjections、不写任何 session 事件 | T1:L143-L145、T1:L177；**用户决策 2（task-8）** |
| 注入通道（v1.4 定稿） | `agent/pre-step` 条件化改写，**用户决策 1 已定稿**（不再标 `[需用户确认]`） | `[P:L16]`；用户决策 1（task-8） |
| 子智能体默认值（v1.4 定稿） | `includeSubagents` 默认 **false**（只对主 agent）；谓词取值以 `docs/research/impl-prerequisites.md` 为准 | 用户决策 3（task-8）；BR-7 |
| 幂等水位线（裁决 2 / v1.2 修正） | per-agent 内存 `Map`，`agent/created` 建立、**由 `agent.ctx.effect` 返回函数清理（不依赖 `agent/disposed`）**、并保留 disposer | Lead 裁决 2；`[R:L79-L80]`；`[P:L19]` |
| 「轮」的权威锚点 | session 事件类型 `turn/end`（**不是 Host 事件**）；但本插件不用它，直接用 `payload.turn` | T1:L151-L166 |
| 与 shipped 插件（裁决 3） | 尾部追加，**不抢** `lastClaimedIndex+1`；`maxBytes` 思路做截断；成本量化进第 6 章 | T1:L42、T1:L68、T1:L80；Lead 裁决 3 |
| 压缩（裁决 4） | **不假设免疫**。按「可能被吞掉、下一周期重发」设计 | T1:L201-L203、`[U3]`；Lead 裁决 4 |
| 设置入口（v1.2 修正） | (a) Host `Config` + `settings` 自动表单：**`everyTurns` 必须 `.volatile()`** 否则整条 entry 从表单消失；(b) 注册 `plugins.bundle.config`（`[单源]`）兜底 | `[R:L50-L52]`、`[R:L143-L146]`、`[Lead]` |
| 读盘 | `ctx.get("fs")` 可选获取 → `resolve` → `stat().version` 比对 → `readText` | T1:L340、T1:L361 |
| 路径 | `join(resolveDshHome(), "AGENTS.md")`，**不自造第二个根** | T1:L346、T1:L350 |
| 改 N 是否需重启 | 表单描述符声明 `applies:"live"` → 无需重启；传播方式 `[待验证]` | T1:L231、`[U7]` |
| 消息构造（v1.2 修正） | `createUserMessage` 由 `@deepseek-ai/dsh-llm` 导出，输入 `{content, source}`。**B1 不再是硬阻塞** | `[R:L63-L67]` |
| volatile 取值（v1.2 新增） | `config.everyTurns` 是 `{get()}` 包装对象，必须 `isVolatile(...) ? .get() : ...` 解包 | `[R:L53]`、`[R:L148-L156]` |
| reject 决策（v1.2 新增） | `decision.kind === "reject"` 必须早返回，否则 `[...decision.messages]` 抛 TypeError | `[R:L33]`、`[R:L158-L166]` |
| 「写入下一轮」口径（v1.2 澄清） | 实际注入到**命中轮当轮**的首个 step；严格「下一轮生效」有替代判定式 | `[R:L132]`、BR-2b |
| 子智能体（v1.4 定稿） | `includeSubagents` 默认 **false**（只对主 agent，用户决策 3）；谓词 P1 以 `docs/research/impl-prerequisites.md` 为准，未到位时 fail-closed | `[R:L111]`、`[R:L134]`、`[Rv:L100-L113]`、BR-7 |
| 主开关（v1.3 修正） | `config.enabled` 检查提到 `agent/created` **最外层**；`shouldInject` 形参去掉 `enabled` | `[Rv:L87-L98]`、E32 |
| serial 事件（v1.3 修正） | `agent/created` 是 serial 事件，监听器**永不抛错**；fail-closed 用常量显式分支 | `[Rv:L100-L113]`、E33 |

---

## 1. 需求形式化

### 1.1 原始需求

> 可以设置指定多少轮后，自动把 `~/.dsh/AGENTS.md` 写入下一轮的上下文中；轮数要能在插件菜单里设置。

### 1.2 行为规格 BR

**BR-1 触发条件**
在某个 agent 的 `agent/pre-step` waterfall 中，同时满足下列全部条件时追加一条注入消息：

1. `config.enabled === true`；
2. `N` 是**解包后的 number**（`isVolatile(config.everyTurns) ? config.everyTurns.get() : config.everyTurns`，见 3.3）且 `(payload.turn - 1) % N === 0 && payload.turn > 1`（命中轮号 **N+1、2N+1、3N+1 …**，N=10 → 11、21、31）；
3. 该 agent 的幂等水位线 `lastInjectedTurn !== payload.turn`；
4. 该 turn 尚未尝试过读取（`attemptedTurn !== payload.turn`）；
5. 文件读取成功、非空、且在体积预算内；
6. 下游 decision 不是 reject（BLOCK-3，见 3.4.5）。

`payload` 形状来自 inspect Event 目录（权威）：`{ agent, messages, turn, step, signal }` `[T1:L143-L145]`。`turn` 是会话日志上的 1 基单调计数 `[T1:L135]`；`step` 是 turn 内 1 基计数、每轮重置 `[T1:L136]`。

**BR-2 计数口径**

计数单位是 **DSH turn**（`dsh-agent-loop` 的 1 基会话绝对轮号），命中轮号为 **N+1, 2N+1, 3N+1 …**。依据**用户决策 2（v1.4 定稿）**，判定式固定为 `(turn - 1) % N === 0 && turn > 1`，即严格「N 轮后、下一轮生效」。

`[需用户确认]` DSH turn 与「用户输入轮」并非严格 1:1：`agent.followup()` 会新开一轮 `[T1:L97]`，因此插件驱动的续跑也会让 turn 递增。三种口径对比：

| 候选 | 定义 | 结论 |
| --- | --- | --- |
| C1 | DSH turn | **采用**。唯一能零持久状态、可 resume 重放的稳定计数 `[T1:L177]` |
| C2 | agent step | 一个 turn 可含多个 step `[T1:L136]`，增速不稳定，弃用 |
| C3 | 用户输入次数 | 需要额外派生状态，且 `[待验证]` 是否有稳定事件可判定「用户输入」 |

采用 C1 的副作用：若会话中存在插件驱动的 followup，注入节奏会比用户感知的「N 轮对话」略快。写入 README。

**BR-2b 「写入下一轮」的实现口径（v1.4 定稿，用户决策 2）**

用户原话「多少轮后…写入下一轮的上下文」自 v1.4 起**按严格读法实现**：

- **判定式**：`(turn - 1) % N === 0 && turn > 1`，命中轮号 **N+1、2N+1、3N+1 …**（N=10 → 11、21、31）。
- **实际行为**：消息在该**命中轮的第一个 step** 进入上下文；而命中轮恰是「第 N 轮结束后的紧接着的下一轮」。
- **用户视角的等价表述**：「**第 N 轮结束后、下一轮开始时，规则回到上下文**」。turn 的边界由用户输入开启，用户看到的是「下一轮开口时 AGENTS.md 已经在了」。
- **位置**：追加在 `decision.messages` 尾部，落在默认 `next()` 生成的 runtime-context 快照之后 `[R:L118]`，详见 BR-4。

**`N = 1` 的语义（v1.4 明确）**：`(turn - 1) % 1 === 0` 对**所有** turn 恒成立，叠加 `turn > 1` 后 → **从第 2 轮起每一轮都注入，第 1 轮不注入**。这与「N=1 表示每轮都注入」的直觉**相差第 1 轮**，是严格读法的必然结果：第 1 轮开始时尚未有任何「已完成的 N 轮」。若要去掉该偏移，只能删除 `turn > 1`，但那会在会话尚无任何已完成轮次时注入，语义上不成立。该边界已在 Q16 记录为**已知后果**。

| 判定式 | 命中轮号 | 首次注入时点 | 用户感知 | 状态 |
| --- | --- | --- | --- | --- |
| `(turn-1) % N === 0 && turn > 1` | N+1、2N+1、3N+1 … | 第 N 轮结束后、第 N+1 轮开始时 | 「N 轮对话之后，下一轮拿到规则」 | **v1.4 采用（用户决策 2）** |
| `turn % N === 0` | N、2N、3N … | 第 N 轮开始时 | 「每 N 轮开始时重锚」 | 已废弃（v1.1–v1.3 曾采用） |

**BR-3 注入内容**

`~/.dsh/AGENTS.md` 的内容。路径固定为 `join(resolveDshHome(), "AGENTS.md")` `[T1:L346]`，解析优先级 显式配置 > `$DSH_HOME` > `~/.dsh` `[T1:L56]`。

**不提供路径配置项**：task-1 报告指出 `agent-instructions` 的注释强调插件「不应自造第二个根」`[T1:L350]`。本插件不暴露 `agentsFilePath`，避免与 harness 其他消费者看到不同文件。

包裹形式：`wrapSystemReminder === true`（默认）时复用 shipped 插件的 `<system-reminder>…</system-reminder>` 外形 `[T1:L43、T1:L122-L127]`，使模型看到的形态一致；同时在消息 `source` 上打本插件自己的 `kind` 以便识别。`[待验证]`：`source.kind` 是否接受任意字符串、是否会被渲染层特殊处理。

**BR-4 注入位置（Lead 裁决 3）**

追加到 `decision.messages` **尾部**，即模型看到的最后一条 user 消息。

- 理由一：**不抢** shipped `agent-instructions` 的插入位置。它插在「最后一条 claimed 消息」之后（`decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)` `[T1:L42]`）。尾部追加与它不同落点，避免顺序竞争。
- 理由二：只做追加，不重排、不删除其他监听器的贡献，满足 `[P:L10]`「使用最弱够用的机制」与 `[P:L16]` 的 spread 要求。
- 写法等价于 `decision.messages.toSpliced(decision.messages.length, 0, injected)`。
- 顺序副作用：两个监听器都改写 `messages` 时，最终顺序由注册顺序决定 `[T1:L386]`。因此本插件对「AGENTS.md 出现在哪个位置」**不做强保证**，只保证它在数组尾部方向。
- **相对位置（v1.2 补充，NB-7 `[R:L118]`）**：尾部追加会落在默认 `next()` 生成的 **runtime-context 快照之后**（`dsh-agent-loop` L916-L919、L1066-L1073 `[R:L118]`），而 shipped `agent-instructions` 的基线落在 `lastClaimedIndex + 1` `[T1:L42]`。即本插件的副本位于「runtime-context 之后、shipped 基线之外」。这一点必须写入 README。

`[需用户确认]` 备选：插到最前（更接近「系统规则」语义）。

**BR-5 幂等性（Lead 裁决 2）**

判定命中后，`agent/pre-step` 在**同一 turn 内会对每个 step 各触发一次** `[T1:L136]`，因此必须显式幂等。采用 per-agent 内存水位线：

- `lastInjectedTurn`：**仅在注入成功后**推进（成功 = 消息已构造并合并进返回的 decision）；
- `attemptedTurn`：**在尝试读取前置位**，用于避免同一 turn 内每个 step 都重复读盘与重复告警。

两个字段职责不同，缺一不可：若只保留 `lastInjectedTurn`，读取失败时该 turn 的每个 step 都会重试并告警（读盘风暴 + 告警风暴）；若只保留 `attemptedTurn`，无法表达「成功」语义，与裁决 2 的「失败不得推进水位线」冲突。

`[需用户确认]` 关于「失败不得推进」的解释：本文将其实现为「失败不推进 `lastInjectedTurn`，但推进 `attemptedTurn`，因此该 turn 不重试，下一个命中轮号（2N+1、3N+1 …）重新尝试」。另一种读法是「失败后在同一 turn 内持续重试直到成功」，代价是每 step 一次读盘。**本文采用前者**，若用户要后者只需删掉 `attemptedTurn` 判断。

水位线丢失的后果见 E9/E15。

**BR-6 N 的取值域与默认值**

- 取值域：整数，`1 ≤ N ≤ 1000`；
- `N = 0`、负数、非整数在 Config 层被拒绝（schemastery `.step(1).min(1).max(1000)`，见 4.1）；
- 默认值 `10` `[需用户确认]`；
- `N = 1` 合法，语义为「**从第 2 轮起每一轮都注入**」（第 1 轮不注入）——严格读法的必然结果，见 BR-2b；
- **该字段必须标记 `.volatile()`**（BLOCK-1）：不标记则整条 entry 不出现在设置表单，核心需求不成立（见 4.1/4.4）；
- **标记 volatile 后运行期取值是包装对象，必须解包**（BLOCK-2，见 3.3）。

**BR-7 生效范围与子智能体取舍（v1.3 修订，对应审核 S8 `[R:L111]`、复核 R-2 `[Rv:L100-L113]`、R-4 `[Rv:L120-L123]`）**

通过 `agent/created` 为每个 agent 在其 `agent.ctx` 上注册监听器 `[P:L19]`，隔离是天然的：注册随 agent 销毁而移除。

两种取值的行为（v1.3 明确表）：

| 取值 | 语义 | 是否需要谓词 | 谓词未就绪时的行为 |
| --- | --- | --- | --- |
| `true` | 对所有 agent 注册 | **否**，直接全注册 | 不受影响，正常注册（用户显式承担子智能体成本） |
| `false`（默认，用户决策 3） | 只对主 agent 注册 | 需要「主 agent vs 子智能体」判定谓词 P1 | **fail-closed**：不注册 + 一次性告警，提示用户显式设 `true` |

**P1 判定谓词的两个候选**（均 `[待验证]`；**取值以 `docs/research/impl-prerequisites.md` 为准**）：

1. `agent/created` payload 的 `source` 字段（审核实测 payload 为 `{agent, source, signal?}` `[R:L78]`，但 `source` 的取值语义未验证）；
2. 该 agent 所关联 session 是否为顶层会话（依赖 agent 与 session 的暴露关系，未验证）。

**决策路径（v1.4 定稿，用户决策 3 + P1 并行调研）**

默认值 **`false` 已由用户决策 3 定稿**（只对主 agent 注入）。可用性由并行调研 P1 保证，而不是通过改默认值回避：

1. **P1（主 agent 判定谓词）由 `docs/research/impl-prerequisites.md` 给出。** 本设计**预留接入点**，谓词取值**以该文档为准**：在 3.4.5 草案中体现为常量 `SUBAGENT_PREDICATE_READY` 与谓词函数 `isPrimaryAgent(agent, source)`；该文档到位后，把常量置 `true` 并把占位实现替换为文档给出的真实谓词。
2. **P1 谓词可用**（预期）→ 默认 `false` 正常工作，只对主 agent 注入，无可用性冲突。
3. **P1 确认谓词在 DSH 中不可得**（应急分支，**不自动切换**）→ 需**用户重新拍板**：或接受 `false` 下 fail-closed（插件不生效），或把默认值改为 `true` 并在 README 显著警告子智能体成本。本设计不自动改默认值。
4. **无论哪种结果，都不得交付开箱不可用的默认配置。** M1 的验收必须包含「按默认配置启动后，主 agent 的注入确实生效」这一条。

**监听器不得抛错（v1.3 新增，R-2 `[Rv:L100-L113]`）**：`agent/created` 是 **serial** 事件——`dsh-agent` L581 `await this.ctx.serial(entry.carrier, "agent/created", {...})`，其文档原文为「Rejects if the id is already registered or a serial `agent/created` listener fails」`[Rv:L103]`。因此本插件在该监听器内抛错会沿 serial 冒泡 → `announce()` 失败 → **该 agent 创建失败**，影响面远超「插件不生效」。

- **实现约束：该监听器永不抛错**（整体 try/catch，异常只告警，绝不冒泡）。
- fail-closed 必须是**常量化的显式分支**，不得调用未定义的函数（见 3.4.5 草案的 `SUBAGENT_PREDICATE_READY`）。

**`includeSubagents` 变更不追溯已存在的 agent（v1.3 新增，R-4 `[Rv:L120-L123]`）**：判定发生在 `agent/created` 时刻，且该字段为非 volatile（`[Rv:L122]`），运行期改 patch 不会重挂载已有 agent 的监听器。因此开关**只影响此后新建的 agent**；已运行的子智能体继续（或不继续）注入。README 必须明示这一点，避免用户以为改开关立即对全部 agent 生效。

默认值 **`false` 已定稿（用户决策 3）**；谓词 P1 的取值**以 `docs/research/impl-prerequisites.md` 为准**（见 Q8 / Q18）。

**BR-8 禁用与卸载**

`enabled: false` 时**零读盘、零注入、零注册**。v1.3 修正（R-1 `[Rv:L87-L98]`）：该检查必须位于 `agent/created` 监听器的**最外层**，且 3.3 的判定函数不再接收 `enabled` 形参——否则主开关会被静默绕过（见 E32）。卸载时通过 `ctx.effect` / `agent.ctx.effect` 的 disposer 移除全部监听器并清空 Map `[P:L8、L19]`。

**BR-9 与 shipped 基线的关系（新增，重要）**

`~/.dsh/AGENTS.md` **已经被 shipped 插件 `@deepseek-ai/dsh-agent-instructions` 自动加载**，以 user 消息形式进入上下文并被 `<system-reminder>` 包裹 `[T1:L34、T1:L38、T1:L43]`。它只在基线身份变化时重发完整基线、在文件被工具触碰后重发差异块，**不做每 N 轮重发** `[T1:L74-L80]`。

因此本插件的定位必须写清楚：**它提供的是「周期性重锚」，不是「首次加载」**。副作用是同一份文件在可见上下文中会出现多份副本，token 成本随会话长度线性增长（量化见 6.1）。这是需求的固有代价，必须在 README 与文档中向用户说明。

**BR-10 体积预算与降级（Lead 裁决 3）**

采用 shipped 插件同款 `maxBytes` 思路做量化控制 `[T1:L68]`，两级降级：

| 级别 | 触发 | 行为 |
| --- | --- | --- |
| L1 截断 | 内容字节数 > `maxInjectBytes` 且 `truncateOversize === true` | 截断到预算并追加**显式截断标记**（告知模型内容不完整）后注入 |
| L2 跳过 | 源文件字节数 > `maxSourceBytes`，或截断后仍无法构造消息，或 `truncateOversize === false` | 不注入、不中断 turn、告警一次（按版本节流） |

`[需用户确认]` L1 截断会让模型看到不完整规则。本文按 Lead 裁决 3 采用截断为默认（`truncateOversize: true`），但保留 `false` 以便退化为「宁可不注入也不注入半份」。

### 1.3 与用户原始描述的推断清单

| # | 推断内容 | 本文取值 | 状态 |
| --- | --- | --- | --- |
| A1 | 「轮」= DSH turn | C1 | `[需用户确认]`（followup 会额外计数） |
| A2 | 计数为每会话独立 | 是 | 由会话绝对轮号天然满足 `[T1:L177]` |
| A3 | 周期性重复注入，而非仅第 N 轮一次 | 周期性 | `[需用户确认]` |
| A4 | 注入全文而非摘要 | 全文，超预算时按 BR-10 截断 | `[需用户确认]` |
| A5 | 默认 N = 10 | 10 | `[需用户确认]` |
| A6 | 命中轮号 = **N+1、2N+1、3N+1 …**（`(turn-1) % N === 0 && turn > 1`） | 是 | **v1.4 已由用户决策 2 定稿**：严格「N 轮后下一轮生效」；`N=1` 的偏移后果见 BR-2b |
| A7 | 运行中改 N 立即对已存在会话生效 | 是 | 依据 `applies:"live"` `[T1:L231]`；传播方式 `[U7]` |
| A8 | 文件变更后下次注入读最新内容 | 是 | 用 `stat().version` 比对 `[T1:L361]` |
| A9 | resume 后计数继续累加 | 是 | 轮号跨 resume 单调递增 `[T1:L168-L177]` |
| A10 | 注入内容加 `<system-reminder>` 包裹 | 是 | 与 shipped 外形一致 `[T1:L43]`；可配置关闭 |
| A11 | 不在 UI 展示累计轮数/注入次数 | 不展示 | `[需用户确认]` |
| A12 | 默认**只对主 agent**生效（`includeSubagents: false`） | 否 | **v1.4 定稿（用户决策 3）**：默认 `false`；谓词 P1 取值以 `docs/research/impl-prerequisites.md` 为准（BR-7、Q8） |
| A13 | 不改动 `~/.dsh/AGENTS.md` 本体，不写入 | 只读 | 读路径无沙箱策略参数 `[T1:L337]` |
| A14 | 超预算时截断而非跳过 | 截断 | **Lead 裁决 3**；`[需用户确认]` 是否接受不完整规则 |

---

## 2. 架构设计

### 2.1 插件包结构

采用 bundle 形态 `[H:L3-L27]`。

**方案 A（主方案）Host-only，无 Client 半体**

```
dsh-ami/
├── package.json          # dsh.bundle.patch -> cordis.patch.yml   [H:L10-L17]
├── cordis.patch.yml      # insert 一行插件 含默认 config           [H:L21-L27]
├── index.js              # export function apply(ctx, config)      [H:L61]
├── README.md             # 说明重锚定位 体积成本 与未验证项
├── locale/
│   ├── en.json           # meta.title / meta.description           [H:L31-L33]
│   └── zh.json
└── icon.svg              # 原创图标 <= 256 KiB                      [H:L51]
```

**方案 B（兜底）Host + Client 半体**

当且仅当 4.4 的 (a) 落点经实测不成立时启用；且因 slot 键为 `[单源]`，启用前必须重新实测该 slot。在方案 A 基础上增加：

```
├── client.js             # 只渲染一个数值输入控件
└── package.json          # 增加 dsh.client 段与 ./client 导出      [H:L3]
```

`package.json`（方案 A 版）需同时导出运行时入口、locale 与图标 `[H:L44-L49]`：

```json
{
  "name": "dsh-ami",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

**方案 B 的 Client 半体约束**（若启用）：

- `package.json` 增加 `dsh.client` 段（`platform` / `immediately` / `inject`）与 `"./client": "./client.js"` 导出 `[H:L3]`；
- `client.js` 通过 `ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name:'plugins.bundle.config', id:'agents-md-periodic-inject', order: 5 }, ConfigRow))` 注册；
- key 必须等于 bundle 的包名 `[Lead][单源]`，且该 slot 是 `keyed` + `view:'page'` only `[Lead][单源]`。**该证据为单源**（Lead 单次运行时观测，reviewer 因 client inspect 通道整体超时无法复现 `[R:L86、R:L187]`），因此方案 B 的设计**不得以 slot 键为确定性前提**，实现前必须重新实测；
- 组件**只渲染一个数字输入控件**（`everyTurns`），不自绘页面、不重写任何宿主组件、不复制宿主 primitives `[P:L35]`；
- 样式只用 `--dsw-alias-*` token `[P:L34]`；文案走 Client locale 服务 `[P:L31-L37]`；
- 回写经 `settingsController.update` `[T1:L236]`，需处理 `SETTINGS_CONFLICT` `[T1:L233]`；
- `[待验证]`：`plugins.bundle.config` 的 props 形状（`[Lead]` 只提供了 slot 键与 purpose，未提供 props）。

**明确不做的事**

- 不注册新工具、不注册新命令、不改动其他插件的贡献。
- 不监听 `system-prompt/assemble` 追加文本（`[P:L17]`）。
- 不使用自定义 session event type，也不使用 `appendPluginRecord`（`[P:L21]`）。
- 不写 `agentsFilePath` 配置、不自造第二个 instruction 根 `[T1:L350]`。

### 2.2 Host 与 Client 半体划分

| 关注点 | 方案 A | 方案 B（兜底） |
| --- | --- | --- |
| 轮次判定 | Host `agent/pre-step` | 同左 |
| 读盘与注入 | Host `fs` 服务 | 同左 |
| Config 读取与校验 | Host（`export const Config`）`[H:L61-L64]` | 同左 |
| N 的编辑 UI | 宿主 `settings` 自动表单 | 自绘一个数值输入控件注册进 `plugins.bundle.config` |
| 运行状态展示 | 无 | 无（A11 决定不做） |

方案 A 下本插件**没有 Client 半体**，不涉及 slot 注册、theme token、React 组件崩溃风险 `[P:L35]`。

### 2.3 每会话状态归属 —— 结论：零持久状态 + per-agent 内存水位线

task-2 要求「选择成本最低且不破坏会话日志可重建性的方案」。结论：**不注册任何投影、不写任何 session 事件，只用 per-agent 内存水位线**。

| 方案 | 机制 | 日志可重建性 | 成本 | 结论 |
| --- | --- | --- | --- | --- |
| **A 零持久状态** | 直接用 `payload.turn` 做 `% N`，加 per-agent 内存水位线 | 完全满足 `[P:L7]`（水位线丢失只退化为多注入一次） | **最低** | **采用**（Lead 裁决 2） |
| B Host `Config` | 存 N 本身 | 不适用（非每会话） | 零 | 采用（N 的值） |
| C `ctx.sessionProjections` | 每会话派生状态 | 满足 | 需写 fold + `stateVersion` | **不需要** `[T1:L309]`、Lead 裁决 2 明确排除 |
| D `storage` / `storageDomain` | 插件自有数据 | 非日志派生 | 高 | 不需要 |
| E 写入 session 事件 | — | **违反 `[P:L21]`** | — | 排除 |

关键证据：`turn` 是会话日志上的 1 基单调计数，恢复时由持久事件重放得到同一 `lastTurn` `[T1:L172-L175]`。因此 `(turn - 1) % N === 0 && turn > 1` 天然满足「可 resume 重放」，无需任何持久化。

水位线的生命周期（Lead 裁决 2）：

1. `agent/created` 时在 `Map` 中为该 agent 建条目；
2. 所有 per-agent 注册包在**一个** `agent.ctx.effect()` 内，disposer 同时保存在插件自身 effect 的 Map 中（双 owner，`[P:L8、L19]`）；
3. 条目删除由 `agent.ctx.effect()` 的返回函数执行（在 `scope.dispose` 时运行）。**不依赖 `agent/disposed`**：挂在该 `agent.ctx` 上的 `agent/disposed` 监听不会执行（NB-3 `[R:L79-L80]`）；
4. 插件自身 effect 的返回值负责 `off()` 事件订阅 + 遍历 Map 释放 disposer + 清空 Map。

### 2.4 组件关系图

```
agent 创建
   │  agent/created (Host 事件 serial 监听器永不抛错)  [P:L19]、[Rv:L103]
   ▼
config.enabled ?  否 → return                        # R-1 主开关最外层
   │ 是
includeSubagents 或 谓词就绪 ?  否 → 告警 return      # R-2 fail-closed 常量分支
   ▼ 是
在 agent.ctx 上注册 agent/pre-step waterfall
   │ effect 成功后 states.set(agent, state)           # R-7 避免 Map 残留
   │
   │  每个 step 准入时触发（同一 turn 会多次触发）
   ▼
(turn - 1) % N == 0 且 turn > 1 且 lastInjectedTurn != turn 且 attemptedTurn != turn ?
   │ N 必须是解包后的 number 见 3.3
   │ 否 → return next()                      # 未命中路径零 IO 零分配
   ▼ 是
attemptedTurn = turn                          # 先置尝试标记
signal.throwIfAborted()
ctx.get("fs") -> resolve -> stat().version 比对 -> readText
   │ 失败 / 空 / 超 maxSourceBytes -> return next()   # 不推进 lastInjectedTurn
   ▼ 成功
signal.throwIfAborted()
await next() 取下游 decision
   │ kind == "reject" -> return decision      # reject 无 messages 必须早返回
   ▼
lastInjectedTurn = turn                       # 仅成功才推进水位线
返回 { ...decision, messages: [ ...decision.messages, injected ] }
   ▼
框架把该消息落为 user/message(surfaceOp:"append")   [T1:L199]
```

---

## 3. 关键机制设计

### 3.1 「一轮结束」的权威锚点 —— 澄清

Lead 的疑问成立：**Cordis Host 事件目录中确实没有 `turn/end`** `[T1:L153、T1:L423]`。`practices.md` L28 提到的 `turn/end` 是 **session 事件类型**（即 `session/event` 广播里的 `event.type`）。三方证据：

1. `KNOWN_SESSION_EVENT_TYPES` 含 `"turn/end"` `[T1:L155]`；
2. `this.session.append("turn/end", { turn, reason: turnEnds })` `[T1:L156]`；
3. `turnBoundaryProjectionDefinition.apply` 以 `event.type === "turn/end"` 关闭 turn `[T1:L157]`。

候选锚点对比 `[T1:L159-L166]`：

| 候选 | 是否「一轮结束」 | 说明 |
| --- | --- | --- |
| session 事件 `turn/end` | ✅ 权威 | data `{turn, reason}`；`reason.kind ∈ {completed, blocked, aborted, error, max-tokens, forked}` |
| Host 事件 `agent/turn-stopping` | ⚠️ 近似 | 在 `turn/end` **之前**派发；监听器往 next-step 注入会让 turn 继续 |
| session 事件 `assistant/message` | ❌ | 每个 step 一条 |
| `session/event` | ❌ | 是通道不是锚点，需自行按 `type` 过滤 |

**本设计的结论**：`turn/end` 是权威锚点，但**本插件不需要监听它**。`agent/pre-step` 的 `payload.turn` 携带同一个轮号，命中判定直接可用。这样同时规避了在 `turn/end` 窗口内注入引发的空转轮（见 3.4.2）。

若将来需要「turn 结束即动作」的变体，权威写法是：

```js
ctx.on('session/event', (session, event) => {
  if (event.type !== 'turn/end') return;
  // event.data.turn / event.data.reason
});
```

### 3.2 轮次计数如何从稳定事件推导

- **计数来源**：`agent/pre-step` payload 的 `turn` 字段 `[T1:L143-L145]`，与 `turn/end` 的 `data.turn` 同源 `[T1:L161]`。
- **稳定性**：turn 号由 `turn()` 在 `turn/start` 中分配 `[T1:L135]`，会话绝对、跨 resume 单调 `[T1:L168-L177]`。
- **不使用**：不轮询 `agent/status` `[P:L28]`；不订阅 `session/event` 做计数（无必要）；不注册投影（Lead 裁决 2）。

### 3.3 N 轮判定算法与水位线语义

判定是纯整数运算，无 IO：

```
shouldInject(turn, n, state):
    if not isInteger(n) or n < 1                -> false   # 运行期非法值防御
    if not isInteger(turn) or turn < 1          -> false   # payload 防御 E20
    if turn <= 1                                -> false   # 严格读法 第 1 轮不注入
    if (turn - 1) % n != 0                      -> false   # 用户决策 2
    if state.lastInjectedTurn == turn           -> false   # 水位线 已成功注入
    if state.attemptedTurn == turn              -> false   # 本轮已尝试 不重复读盘
    return true
```

**形参契约（v1.3 修正，R-1 `[Rv:L87-L98]`）**：本函数**不接收 `enabled`**。`config.enabled` 的检查已提升到调用方的最外层（见 3.4.5 与 BR-8），因此不存在「第三实参该传 `enabled` 还是 `config`」的歧义。v1.2 的形参是 `shouldInject(turn, n, enabled, state)`，而草案实参传的是整个 `config` 对象 → `if not enabled` 对对象恒假 → `enabled: false` 被静默绕过（仍读盘并注入，且无报错）。v1.3 采用「提到最外层」的修法，**形参、实参、边界条目 E32 三处已统一**。

**`n` 的取值契约（v1.2 新增，BLOCK-2 `[R:L53、R:L148-L156]`）**：`n` **必须是解包后的 number**，绝不能把 `config.everyTurns` 直接传进来。`everyTurns` 标记 `.volatile()` 后（见 4.1），`apply(ctx, config)` 收到的 `config.everyTurns` 是 `createVolatile()` 冻结包装对象。完整证据链：`schemastery` L265-L277（`meta.volatile` 时 `resolve` 返回 `createVolatile(value)`）→ `cosmokit` L102-L110（`Object.freeze({ get, [write] })`）、L116-L118（`isVolatile` 以 `write in value` 判定）→ `cordis` L1071/L1355（插件回调收到该包装对象）`[R:L53]`；`dsh-settings` L98 的 `plainConfig` 用同款 `isVolatile(value) ? value.get()` 佐证。

```js
import { isVolatile } from '@deepseek-ai/cosmokit';
const n = isVolatile(config.everyTurns) ? config.everyTurns.get() : config.everyTurns;
```

忘记解包的后果见 E27：`turn % obj` 得到 `NaN`，`Number.isInteger(NaN)` 为 false，判定恒假，**静默永不注入且无任何报错**。

命中轮号序列：`N+1, 2N+1, 3N+1 …`。`N=10` 时命中 turn 11、21、31 …；`N=1` 时命中 turn 2、3、4 …（**第 1 轮不注入**，见 BR-2b）。

**两个必须显式讨论的边界（Lead 裁决 2）：**

**(a) resume 后水位线丢失，且当前 turn 恰为命中轮号**

- 现象：恢复后 `Map` 为空 → `lastInjectedTurn = -1` → 若恢复发生在命中轮号上，该 turn 会补注入一次。
- 是否接受：**接受**。理由：(i) 轮号是真相源，恢复后重放得到的 turn 与崩溃前一致 `[T1:L172-L175]`；(ii) 若崩溃前已注入过，本次补注入只造成一份重复副本，对模型是同一份规则，语义无害；(iii) 要消除它必须持久化水位线，代价是引入投影或 storage，与 Lead 裁决 2「不注册 sessionProjections」直接冲突。
- 缓解：`attemptedTurn` 同样丢失，因此不会出现「每 step 重复」；最多多一份副本。
- `[待验证]`：resume 是否会在同一 turn 的 step>1 位置重放 pre-step（关联 E9）。若会，注入会落在该 turn 的中段而非第一步，属可接受的位置偏移。

**(b) 同一 turn 内 `agent/pre-step` 多次触发**

- 现象：一个 turn 可有多个 step `[T1:L136]`，每个 step 都触发一次 pre-step。
- 处理：`attemptedTurn` 在**尝试读取前置位**（第一层节流，避免每 step 读盘与告警）；`lastInjectedTurn` 在**注入成功后才推进**（第二层，表达成功语义）。失败时只推进 `attemptedTurn`，不推进 `lastInjectedTurn`，因此下一个命中轮号会重试。
- 边界：判定与置位之间没有 `await`，单线程事件循环下不存在竞态 `[T1:L889]` 的串行驱动。
- `[需用户确认]`：见 BR-5 对「失败不得推进」的两种解释。

### 3.4 注入调用序列

#### 3.4.1 主方案：`agent/pre-step` 条件化改写（Lead 裁决 1）

在 `agent/created` 里对 `agent.ctx` 注册 `agent/pre-step` waterfall；命中判定时把 AGENTS.md 渲染成一条 user 消息追加进 `decision.messages`，必须 `{ ...decision, messages }` 以保留 `startsRequestSeries` 等字段 `[P:L16]`。

理由 `[T1:L205、T1:L394]`：

- 天然拿到 `turn`，零持久状态判定；
- **不唤醒 agent**，不产生额外模型调用；
- 只在真有 step 准入时执行，**不会造成「只有注入内容的空转轮」**；
- 与 shipped 的 `agent-instructions` 同机制、同阶段，行为可预测。

**已定稿（用户决策 1，v1.4）**：本机制不在 task-2 原描述点名的「`ctx.systemPrompt.section()` 或 `agent.inject()`」两项之内，但它**不是** `system-prompt/assemble`（未被禁止），而是 `[P:L16]` 明确记载的受支持改写点。用户已确认采用，**不再标 `[需用户确认]`**（见 Q1）。

#### 3.4.2 备选方案：`agent.inject()` 的规避手段与代价

契约（源码级已验证）`[T1:L88-L117]`：

| 方法 | 目标队列 | 唤醒 | 语义 |
| --- | --- | --- | --- |
| `agent.inject(msg)` | `next-step` | **否** | 排队等下一个被准入的 step |
| `agent.steer(msg)` | `next-step` | 是 | 打断式插入 |
| `agent.followup(msg)` | `next-turn` | 是 | 新开一轮 |

`inject()` 的落点是 session 事件 `agent/inbox/spliced`，data `{ target:"next-step", start, inserted, removedCount?, outcome? }` `[T1:L113]`。三个已证实的坑与规避代价：

| 坑 | 现象 | 规避手段 | 规避代价 |
| --- | --- | --- | --- |
| **坑 1** `turn/end` 窗口内注入立即多开一轮 `[T1:L122、T1:L383]` | `turn()` 在 finally 追加 `turn/end` 后判 `if (!this.inbox.hasPending) return false;`；监听器内注入把 `hasPending` 置真 → `kick()` 的 `while (await this.turn())` 继续 → 产生一次**只有注入内容**的模型调用 | **禁止**在 `turn/end` 监听器内调用 `inject()`；改为在 turn 边界之外的时机调用 | 需要一个「非 turn 边界」的触发点。用 `setTimeout(...,0)` 宏任务躲开 `hasPending` 检查属对驱动内部时序的依赖 `[待验证]`，随版本可能失效；一旦时序判断错误就退化为坑 1 |
| **坑 2** idle 时不唤醒 → 消息滞留 inbox `[T1:L121、T1:L384]` | 注入留在 inbox 直到下一次别的输入唤醒 agent 才被 claim | 接受滞留，文档明确「注入不触发模型调用，随下一次用户输入生效」；**不**用 `followup()` 兜底 | 若用户此后无输入则注入永不生效；注入与用户输入的时间差可能很长，内容可能过期。`followup()` 虽能立即生效，但会新开一轮并产生一次只有注入内容的模型调用，代价更大 |
| **坑 3** `agent.cancel()` 默认 `keepInbox=false` 会 `inbox.clear()` `[T1:L123]` | 已注入未 claim 的消息被丢弃（记 `outcome:"canceled"`） | 接受丢弃（用户中止当前工作，丢弃是正确语义）；不做补偿重注 | 取消后注入内容消失，需等下一个命中轮号 |

**结论**：`agent.inject()` 仅在「无法使用 pre-step 改写」时作为降级方案，且必须同时接受坑 2 的滞留语义与坑 1 的时序脆弱性。本设计**默认不采用**。

#### 3.4.3 主方案 vs 备选：对比与选择理由（Lead 裁决 1）

| 维度 | 主方案 `agent/pre-step` 改写 | 备选 `agent.inject()` |
| --- | --- | --- |
| 是否额外开轮 | **否** | 坑 1：在 `turn/end` 窗口内会；需靠时序规避 |
| 是否产生额外模型调用 | **否** | 坑 1 场景下会（只有注入内容的空转轮） |
| 是否唤醒 agent | 否（被动，只在已有 step 准入时执行） `[T1:L189]` | 否（`wakeup=false`），导致坑 2 滞留 |
| 生效时机确定性 | **确定**：命中轮号的第一步必然被消费 | 不确定：取决于下一次唤醒，可能是下一次用户输入 |
| 是否记入会话日志 | 是：`user/message` + `surfaceOp:"append"` `[T1:L199]` | 是：先 `agent/inbox/spliced`，claim 后落 `user/message` `[T1:L113、T1:L187]` |
| 拿 turn 号 | **直接来自 payload** `[T1:L143-L145]` | 需另找触发点，通常要监听 `turn/end`（正是坑 1 的来源） |
| 与其他插件的关系 | 与 shipped `agent-instructions` 同机制、同阶段，可用 spread 共存 | 不参与 pre-step 链，但与 turn 驱动耦合 |
| 失败模式 | 必须 spread decision 否则丢 `startsRequestSeries` `[P:L16]` | 坑 1/2/3 三个 |
| 是否在 task-2 原点名机制内 | 否（**用户决策 1 已定稿**，见 Q1） | 是 |

**选择理由**：主方案在「无额外模型调用」与「生效时机确定」两项上严格优于备选，且其唯一代价（spread decision 的纪律要求）已有 `[P:L16]` 的明确规范与 shipped 插件的同款实现作为参照。备选的两个致命问题（坑 1、坑 2）恰好互相抵消：要规避坑 1 就必须躲开 turn 边界，而躲开边界就必然落进坑 2 的滞留语义，无法两全。

#### 3.4.4 `ctx.systemPrompt.section()` 为何不采用

| 维度 | 事实 | 结论 |
| --- | --- | --- |
| 渲染频率 | **每一步都渲染** `[T1:L188]` | 与「每 N 轮」语义不匹配；要做只能每轮动态注册/注销，复杂度陡增 |
| 可见位置 | system 消息，surface 节点 0 或 in-history `[T1:L187]` | 与 shipped 的 user 消息形态不一致，形成两份不同位置的副本 |
| 冲突 | 同名 section 重复注册抛错；`order` 非有限数抛 `TypeError` `[T1:L190、T1:L194]` | 注册期失败风险高 |

#### 3.4.5 代码草案（主方案）

```js
import { isVolatile } from '@deepseek-ai/cosmokit';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

// volatile 字段取值必须解包 否则 turn % obj = NaN 静默失效
const readEveryTurns = (config) =>
  isVolatile(config.everyTurns) ? config.everyTurns.get() : config.everyTurns;

// P1 主 agent 谓词接入点 取值以 docs/research/impl-prerequisites.md 为准
// 该文档到位前置 false 走 fail-closed 常量分支 不得调用未定义函数
const SUBAGENT_PREDICATE_READY = false;
// P1 就绪前的占位实现 常量分支下永不执行 就绪后替换为文档给出的真实谓词
const isPrimaryAgent = (agent, source) => false;

export function apply(ctx, config) {
  // Map 保存 per-agent 水位线与 disposer 满足双 owner 清理
  const states = new Map();

  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', ({ agent, source }) => {
      // agent/created 是 serial 事件 监听器永不抛错
      try {
        // R-1 主开关最外层 enabled:false 时零读盘零注入零注册
        if (!config.enabled) return;

        if (!config.includeSubagents) {
          // R-2 fail-closed 常量分支 不调用未定义函数
          if (!SUBAGENT_PREDICATE_READY) {
            warnOnce(ctx, 'subagent predicate not ready: fail-closed');
            return;
          }
          if (!isPrimaryAgent(agent, source)) return;
        }

        const state = { lastInjectedTurn: -1, attemptedTurn: -1, dispose: null };
        const dispose = agent.ctx.effect(() => {
          const offPre = agent.ctx.on('agent/pre-step', async (payload, next) => {
            // 未命中路径先做整数比较 不分配对象
            if (!shouldInject(payload.turn, readEveryTurns(config), state)) return next();

            state.attemptedTurn = payload.turn;      // 先置尝试标记 避免每 step 重试

            let text;
            try {
              payload.signal.throwIfAborted();
              text = await readAgentsMd(ctx, config, payload.signal);
            } catch (error) {
              warnOnce(ctx, 'read failed: skip injection', error);   // E4
              return next();
            }
            if (!text) return next();                // 空或超限 不推进水位线

            payload.signal.throwIfAborted();
            const decision = await next();
            // reject 决策没有 messages 字段 必须早返回
            if (decision.kind === 'reject') return decision;

            let injected;
            try {
              injected = buildMessage(text, config);
            } catch (error) {
              warnOnce(ctx, 'message build failed: skip injection', error);   // E24
              return decision;
            }

            payload.signal.throwIfAborted();
            state.lastInjectedTurn = payload.turn;   // 仅成功才推进水位线
            // 展开 decision 保留 startsRequestSeries 等字段
            return { ...decision, messages: [...decision.messages, injected] };
          });
          // effect 返回函数是唯一有效清理路径 必须保留 states.delete
          return () => { offPre(); states.delete(agent); };
        });

        state.dispose = dispose;
        states.set(agent, state);                  // R-7 effect 成功后才入 Map
      } catch (error) {
        // serial 监听器永不抛错 异常只告警
        ctx.logger.warn('agents-md-inject: agent/created handler failed', error);
      }
    });

    return () => {
      offCreated();
      for (const s of states.values()) s.dispose?.();
      states.clear();
    };
  });
}
```

**v1.3 对草案的修正（累计）**：

| # | 修正 | 证据 |
| --- | --- | --- |
| **R-1** | `if (!config.enabled) return;` 提到 `agent/created` 最外层；`shouldInject` 形参去掉 `enabled`（统一为 `(turn, n, state)`） | `[Rv:L87-L98]` |
| **R-2** | `agent/created` 监听器整体 try/catch **永不抛错**；fail-closed 用常量 `SUBAGENT_PREDICATE_READY` 显式分支，**不调用未定义函数** | `[Rv:L100-L113]` |
| **R-7** | `states.set(agent, state)` 移到 `agent.ctx.effect(...)` 成功之后，避免 Map 残留 | `[Rv:L135-L138]` |
| **R-6** | `readAgentsMd` / `buildMessage` 各自 try/catch，把 E4 / E24 的承诺落到代码 | `[Rv:L130-L133]` |
| BLOCK-2 | `readEveryTurns(config)` 解包 volatile；`shouldInject` 收到的是 number | `[R:L53、R:L148-L156]` |
| BLOCK-3 | `if (decision.kind === "reject") return decision;` 早返回 | `[R:L33、R:L158-L166]`；`dsh-agent-loop` L922 |
| NB-3 | 无 `agent/disposed` 监听（该监听不会执行，属死代码）。清理唯一有效路径是 effect 返回函数里的 `states.delete(agent)`，**必须保留** | `[R:L79-L80]` |
| NB-8 | 三处 `signal.throwIfAborted()`（读盘前、读盘后、`next()` 后），对齐 shipped 插件 L1411 | `[R:L179]` |

`SUBAGENT_PREDICATE_READY` 与 `isPrimaryAgent` 的关系：前者对应 **P1（主 agent 判定谓词）**的可用性，**取值以 `docs/research/impl-prerequisites.md` 为准**；为 `false` 时 `isPrimaryAgent` **永不执行**（常量分支直接返回），因此即便谓词实现尚不存在也不会抛错。fail-closed 语义见 BR-7。

**最终编排顺序以 `docs/design/impl-spec.md` §3.1 / §3.2 为准**。本文草案为等价简化：未展开 `planInjection`（体积预算与截断）与 `onlyIfChanged` 门控两步，且 `readAgentsMd` 的返回形状在实现规格中为 `{text, reason, version}`。两文冲突时以 impl-spec 为准。

**B1 已在 v1.2 定性纠正（NB-4 `[R:L63-L67]`）**：`createUserMessage` 由 **`@deepseek-ai/dsh-llm`** 导出（`dsh-llm` L59-L64），输入至少 `{content, source}`，`role:"user"` 与 `id` 由工厂补（L37-L42、L59-L64）；它是**纯函数**，不需要 session 或 agent 工厂。三处独立引用互证：`dsh-agent-instructions` L2、`dsh-agent` L5、`dsh-agent-loop` L6 全部 `import { createUserMessage } from "@deepseek-ai/dsh-llm"` `[R:L63]`。

- v1.1 把 B1 定为「编码前唯一硬阻塞 / 导出包名未知」**属定性过重** `[R:L67]`，v1.2 予以纠正。
- **残余风险只剩一项**：本地 linked bundle 能否解析并 import 这个裸包名（`[R:L175、R:L190、N4]`）。这是 M1 的构建验证项，**不是设计未知**。
- `[待验证]`：`source.kind` 用自定义字符串在**写入侧**已被 shipped 插件证明可行（它用 `{kind:"agent-instructions", …}` `[R:L66]`），但渲染层是否特殊处理未知 kind **无法验证**（B10）。

**B2 已关闭（v1.2，NB-3 `[R:L78]`）**：`agent/created` payload 实测为 `{agent, source, signal?}`（serial 模式），`agent/disposed` payload 为 `{agent}`（emit 模式）；源码侧 `dsh-agent` L581-L585、L549-L554 一致。

### 3.5 会话恢复 resume / fork

| 场景 | 行为 | 依据 |
| --- | --- | --- |
| resume | 轮号从日志重放得到同一 `lastTurn`，判定自然继续，无需重置 | `[T1:L168-L177]` 四重证据 |
| resume 水位线 | `Map` 为空，`lastInjectedTurn = -1` → 若恢复点恰在命中轮号上会补注入一次 | 见 3.3(a)，**接受** |
| 中断的 turn | 恢复时会补写收尾事件 `interruptedTurnClosers` | `[T1:L174]` |
| fork | `reason.kind` 含 `forked`，说明 fork 会结束当前 turn `[T1:L161]`；**fork 出的新会话轮号是否从 1 重新开始、是否继承父会话轮号，task-1 未覆盖** | `[待验证]` |

`[待验证]` fork 的影响：若新会话轮号重置为 1，首次注入点为 turn N，行为可预期；若继承父轮号，首个命中点取决于继承值，可能出现「fork 后立刻注入」或「很久不注入」。**处理策略**：判定完全由轮号决定，两种情况行为都自洽，不需要额外代码；但验收测试必须覆盖 fork 并记录实际表现（E16）。

### 3.6 多 agent 与子智能体

- **隔离机制**：在 `agent/created` 中对 `agent.ctx` 注册，注册随 agent 销毁而移除 `[P:L19]`。每个 agent 独立持有监听器、水位线与读盘缓存。
- **是否生效（v1.4 定稿）**：默认 `includeSubagents: false`（用户决策 3），**只对主 agent 生效**；`true` 表示对所有 agent 注册。行为表、fail-closed 与 P1 接入点见 BR-7 `[R:L111]`、`[Rv:L100-L113]`。
- `[待验证]` **P1**：判定「某 agent 是否为子智能体」的谓词，**取值以 `docs/research/impl-prerequisites.md` 为准**。设计侧已预留接入点（`SUBAGENT_PREDICATE_READY` + `isPrimaryAgent`），未到位时走 fail-closed（BR-7）。
- **计数是否共享**：不共享。每个 agent 有自己的 `payload.turn` 与水位线，子智能体的 turn 计数独立，互不干扰。

### 3.7 与 shipped `agent-instructions` 的关系（Lead 裁决 3）

| 维度 | shipped `agent-instructions` | 本插件 |
| --- | --- | --- |
| 读取目标 | `<dshHome>/AGENTS.md` + `~/.agents/AGENTS.md` + 项目级逐层 `[T1:L51-L58]` | 仅 `<dshHome>/AGENTS.md` `[T1:L346]` |
| 触发 | 基线身份变化时重发完整基线；文件被工具触碰后重发差异块 `[T1:L76-L78]` | 每 N 轮重发全文 |
| 机制 | `agent/pre-step` waterfall | 同机制 |
| 插入位置 | `toSpliced(lastClaimedIndex + 1, 0, desired)` `[T1:L42]` | **尾部追加**，不抢同一落点 |
| 消息形式 | user 消息 + `<system-reminder>` 包裹 `[T1:L43]` | 同外形，`source.kind` 用本插件自己的值 |
| 去重 | `alreadySupplied` 只针对它自己的消息，**不覆盖第三方消息** `[T1:L80]` | 无跨插件去重 |

**结论**：

1. **不抢插入位置**：它插在 `lastClaimedIndex + 1`，本插件追加尾部。两者落点不同，避免顺序竞争。最终相对顺序仍由监听器注册顺序决定 `[T1:L386]`，因此对「AGENTS.md 出现在哪个位置」不做强保证，只保证在尾部方向。
2. **重复是必然的**：`alreadySupplied` 不覆盖第三方消息 `[T1:L80]`，因此同一份文件会出现多份副本。这是「周期重锚」的固有形态（E19），不试图消除，改为**量化控制**（BR-10 + 6.1）。
3. **不修改它、不依赖它**：不读它的 DOM/样式/组件源码，不覆盖它的 Config，不假设它的实现细节。

### 3.8 注册与清理

严格按 `[P:L8、L19]`：

1. 在 `agent/created` 里取 `agent.ctx`；
2. 把所有 per-agent 注册（**仅** `agent/pre-step` 监听）包在**一个** `agent.ctx.effect()` 内；
3. 把该 disposer **同时**保存在插件自身 effect 的 `Map` 中（双 owner，任一 teardown 都能清理）；
4. 插件 effect 的返回值负责 `off()` 事件订阅 + 遍历 Map 释放 disposer + 清空 Map。

**v1.2 修正（NB-3 `[R:L79-L80]`）：不得依赖 `agent/disposed` 监听做清理。** `dsh-agent-loop` 的 teardown 顺序是 L1721 `await machine?.scope.dispose()`（`agent.ctx` 上的注册在此解绑）**先于** L1731 `detachAgent?.()`（→ `emitDisposed`）；Event 目录对该事件的描述亦为 "after driver quiescence and scoped-registration unwind"。因此挂在 `agent.ctx` 上的 `agent/disposed` 监听**不会执行**，属死代码。

- 清理的**唯一有效路径**是 `agent.ctx.effect()` 返回函数里的 `states.delete(agent)`，**必须保留**（3.4.5 草案已如此实现）。审核 F8 确认该路径不泄漏 Map 条目 `[R:L80]`。
- 若 developer 出于可读性保留 `agent/disposed` 监听，必须在该行注释标明「死代码 仅为说明意图」，且**不得**删除 effect 内的 `states.delete`。

**B2 已关闭**（`[R:L78]`）：`agent/created` payload 实测为 `{agent, source, signal?}`（serial 模式），`agent/disposed` payload 为 `{agent}`（emit 模式）；源码侧 `dsh-agent` L581-L585、L549-L554 一致。

---

## 4. 配置设计

### 4.1 Config 声明（真实形式：schemastery）

`[T1:L211-L216]`：Host 插件导出 `export const Config = z.object({...})`，用 schemastery；真实样例见 `dsh-agent-instructions` 与 `dsh-system-prompt`。

```js
import z from 'schemastery';

export const Config = z.object({
  // 总开关 非 volatile 只能改 patch 不进设置表单
  enabled: z.boolean().default(true),
  // 每 N 轮注入一次 单位 DSH turn 整数 1..1000
  // 必须 volatile 否则整条 entry 从设置表单消失 见 4.4
  everyTurns: z.number().step(1).min(1).max(1000).default(10).volatile(),
  // 源文件字节上限 超过直接跳过 默认与 shipped 一致
  maxSourceBytes: z.number().step(1).min(1).default(1048576),
  // 单次注入渲染字节预算 超过则截断
  maxInjectBytes: z.number().step(1).min(1).default(16384),
  // 超预算时截断 true 或直接跳过 false
  truncateOversize: z.boolean().default(true),
  // 是否复用 system-reminder 包裹外形
  wrapSystemReminder: z.boolean().default(true),
  // 内容未变时是否仍然注入 false 表示始终注入
  onlyIfChanged: z.boolean().default(false),
  // 是否对子智能体生效 默认 false 见 BR-7 与 3.6
  includeSubagents: z.boolean().default(false),
});
```

字段类型只使用 task-1 已取证的 schemastery 能力（`z.object` / `z.boolean` / `z.number` / `.step` / `.min` / `.max` / `.default` / `.volatile`）`[T1:L62-L72]`，不使用未取证的 enum/union helper。

`maxSourceBytes` 默认值与 shipped 插件同名配置一致 `[T1:L68]`，保持用户预期统一。

**`.volatile()` 是核心需求成立的必要条件（v1.2 新增，BLOCK-1 `[R:L50、R:L143-L146]`）**：

- `dsh-settings` L413-L419：`const form = volatileForm(schema); if (form === void 0) return [];` —— 若 schema 中不存在 volatile 子树，**该 entry 整条被跳过**，插件不会出现在设置表单里。
- L122-L131：非 `meta.volatile` 且非 object 的节点返回 `undefined`；object 只保留「有 volatile 后代」的字段。因此纯 `z.number()` 字段不构成 volatile 子树。
- `.volatile()` 由 schemastery 提供（L235-L238 `extra("volatile", true)`），L240-L252 校验「volatile 不能有 volatile 祖先」——本插件是扁平结构，满足该约束 `[R:L52]`。
- 结论：**不给 `everyTurns` 加 `.volatile()`，则核心需求「轮数在插件菜单里设置」不成立**（审核 S1/R2 `[R:L104、R:L129]`）。

**哪些字段标 volatile（v1.2 明确取舍，NB-1 `[R:L51、R:L172]`）**：

| 类别 | 字段 | 在设置表单 | 写回 |
| --- | --- | --- | --- |
| volatile | `everyTurns` | ✅ 出现且可改 | ✅ 经 `settings.update` |
| 非 volatile | 其余 7 个 | ❌ 不出现 | ❌ `settings.write` 抛 `Config field "..." is not volatile`（`dsh-settings` L505-L507、L153-L158 `[R:L51]`） |

**本插件策略**：设置表单**只暴露 `everyTurns`**（这正是用户原话要求的唯一可配置项）；其余 7 个字段只经 `cordis.patch.yml` 修改。取舍理由：把 8 个字段全部标 volatile 会把运维型参数（体积预算、子智能体开关）也暴露给普通用户，且放宽 `settings.write` 的路径校验；用户原话只要求「轮数」。**该策略必须写入 README。**

### 4.2 人类可读等价物（v1.2 定性修正，NB-2）

**定性修正**：v1.1 称「上表会以 JSON Schema 形式出现在设置描述符里」**不成立**。设置描述符里的 schema 是 schemastery `toJSON()` 的 `{uid, refs}` 引用包形态（`schemastery` L70-L83；`dsh-settings` L103-L116 `plainSchema`、L444 `schema: form.toJSON()`）`[R:L55]`。

因此下面这份 JSON Schema **只是人类可读的等价物**，用于评审与文档；**不是 wire 形态**。方案 B 写 Client 组件时必须按 `toJSON()` 的 `{uid, refs}` 形态取值 `[R:L173]`。另据 C7 `[R:L56]`：`z.number().step(1)` 经 `toJSON` 输出 `type:"number"`（schemastery L609），**不是 `integer`**；因此下方数值字段写 `"type":"number"`，整数约束由 `.step(1)` 与运行期 `Number.isInteger` 防御保证（B4 已关闭）。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AGENTS.md Periodic Inject",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": {
      "type": "boolean",
      "default": true,
      "title": "Enable periodic injection",
      "description": "When false the plugin does not count turns or read the file."
    },
    "everyTurns": {
      "type": "number",
      "minimum": 1,
      "maximum": 1000,
      "default": 10,
      "title": "Inject every N turns",
      "description": "Positive integer unit: DSH turns. Injection lands on turn N then 2N and so on. Marked volatile so it appears in the settings form."
    },
    "maxSourceBytes": {
      "type": "number",
      "minimum": 1,
      "default": 1048576,
      "title": "Max source file size in bytes",
      "description": "Files larger than this are skipped with a warning. Unit: bytes."
    },
    "maxInjectBytes": {
      "type": "number",
      "minimum": 1,
      "default": 16384,
      "title": "Max injected content size in bytes",
      "description": "Content beyond this budget is truncated with an explicit marker. Unit: bytes."
    },
    "truncateOversize": {
      "type": "boolean",
      "default": true,
      "title": "Truncate oversize content",
      "description": "When false oversize content is skipped instead of truncated."
    },
    "wrapSystemReminder": {
      "type": "boolean",
      "default": true,
      "title": "Wrap content in system-reminder",
      "description": "Match the shape used by the shipped AGENTS.md loader."
    },
    "onlyIfChanged": {
      "type": "boolean",
      "default": false,
      "title": "Only inject when the file changed",
      "description": "Leave false to re-anchor the same content every N turns."
    },
    "includeSubagents": {
      "type": "boolean",
      "default": false,
      "title": "Inject into subagents too",
      "description": "Leave false to keep subagent contexts untouched. See README for the current limitation."
    }
  }
}
```

**B4 已关闭（v1.2，NB-6 `[R:L56]`）**：`z.number().step(1)` 经 `toJSON` 输出 `"type":"number"`（schemastery L609），不是 `integer`。整数约束在表单层可能退化为小数输入，**`Number.isInteger` 防御必须保留**（3.3 判定已含）。

**单位说明**：`everyTurns` 单位是 DSH turn（BR-2 的 C1）；`maxSourceBytes` / `maxInjectBytes` 单位是字节。

### 4.3 cordis.patch.yml 示例

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

形态参照 `[H:L21-L27]`。**注意** `[H:L3]`：匹配的 override 会**整体替换** config，因此用户 patch 里必须写全字段，否则被覆盖的行会丢字段。

### 4.4 用户如何在插件菜单修改后生效

需求「轮数要能在插件菜单里设置」（审核 R2）在 v1.1 中**不成立**：落点 (a) 因缺 `.volatile()` 确定性失败 `[R:L129]`。v1.2 通过 BLOCK-1 修正后给出**确定性路径**。

**确定性路径（v1.2 结论）**：`everyTurns` 标记 `.volatile()` → `volatileForm(schema) !== undefined` → `settings.describe()` 保留该 entry → 表单中出现 `everyTurns` 且可经 `settings.update` 写回 `[R:L50-L52、R:L143-L146]`。这是 R2 的**主路径**，不需要任何 Client 代码。

| 落点 | 机制 | 需要 Client 代码 | 状态 |
| --- | --- | --- | --- |
| **(a) Host `Config` + `settings` 自动表单（主路径）** | `export const Config` + `everyTurns.volatile()`；`autoGenerate` 默认 `true` `[T1:L229-L230]`；描述符含 `applies:"live"` `[T1:L231]` | **否** | **v1.2 修正后机制确定性成立**；**表单具体页面位置仍 `[待验证]`**（U5 `[R:L188]`） |
| **(b) 注册 `plugins.bundle.config`（兜底）** | slot `plugins.bundle.config` 为 `keyed` + root scope + `view:'page'` only `[Lead][单源]`。key 用本 bundle 包名 | **是**（第 2 章方案 B） | **单源证据，不得作为确定性前提** `[R:L87、R:L176]`；props 形状 `[待验证]` |

slot 键证据（Lead 提供，**单源**；审核因 client inspect 通道整体不可用无法复现 `[R:L86-L88、R:L187]`）`[Lead][单源]`：

| slot 键 | kind | scope | purpose 摘要 |
| --- | --- | --- | --- |
| `settings.section` | list | root | One settings page per list entry |
| `settings.general.item` | list | root | 单条偏好行 无需独立页面 |
| `settings.plugins.tab` | list | root | Plugins 设置分区内的一页 |
| `plugins.tab` | list | root | Installed tab 之后的 tab |
| `plugins.bundle.config` | keyed | root | bundle 自己的配置位 `view:'page'` only |

**推荐**：**主路径 (a)**，因为它零 Client 代码，且 `plugins.bundle.config` 的 purpose 描述（「a bundle's own configuration … rendered on the bundle's page」）与 (a) 的自动表单高度吻合，很可能 (a) 的表单就渲染在该位置。M2 做一次页面实测作为验收 `[R:L146]`：

- 若 `everyTurns` 在插件页可见可改 → 采用 (a)，不写任何 Client 代码；
- 若不可见 → 启用 (b)，但**必须先重新实测 `plugins.bundle.config`**（slot 键为 `[单源]`），再按第 2 章方案 B 写 Client 半体，注册一个数字输入控件（key = bundle 包名）。

**v1.2 修正**：v1.1 称「`everyTurns` 是否会被投影尚未验证」已不成立——审核已取证投影规则（`dsh-settings` L122-L131、L413-L419）`[R:L50-L51]`：**只有 volatile 字段进表单且可写回**。因此原来的 (a1)(a2) 排查步骤不再需要，改为三条确定性要求：

1. `everyTurns` 必须 `.volatile()`（BLOCK-1）；
2. 其余 7 个字段只经 `cordis.patch.yml` 修改，不进表单、不可写回（NB-1，见 4.1）；
3. 表单**具体页面位置**仍 `[待验证]`（U5），M2 仍必须做一次页面实测作为验收。

**写入与生效链路**（已验证）：

1. 写回经 `update(ns, patch, expectedRevision)`，冲突抛 `SETTINGS_CONFLICT` 并带 `expected`/`actual` revision `[T1:L232-L233]`；
2. 变更事件为 Host 事件 `settings/document-updated(ns, revision)` `[T1:L234]`；
3. 描述符声明 `applies:"live"` `[T1:L231]` → **无需重启**。

**本插件的写法与链路无关**：在每次 `agent/pre-step` 时**现读并解包** `config.everyTurns`，而不是在 `apply` 时快照进局部常量。因此无论设置改动是「原地更新同一 config 对象」还是「重新执行 `apply` 生成新闭包」，下一次判定都会使用新值。

**v1.2 修正（S12 `[R:L115]`）**：v1.1 称该差异「不影响正确性」**过于乐观**。若传播方式是重新 `apply`，插件重载会清空水位线 `Map`，同一 turn 内 `lastInjectedTurn` 丢失 → **该 turn 会重复注入一份**（仅一次，语义无害，但与 v1.1 的说法不符）。处置：接受一次重复；若必须消除则需跨重载保留水位线，而持久化与 Lead 裁决 2 冲突。`[待验证]` B5 仍开放。

### 4.5 校验与拒绝行为

- Config 在插件激活时校验 `[H:L64]`。非法 `everyTurns`（0 / 负数 / 超 1000）导致该行激活失败并给诊断，不静默取默认值。
- 运行期若取到非法值（热更新中间态），判定函数返回「不注入」（3.3 已含防御），不抛异常、不中断 turn。

---

## 5. 边界与失败模式

**统一原则**：任何读取失败都**不注入、不中断 turn、不抛异常**；告警按文件版本节流（每个版本最多告警一次）避免刷屏。`[U3]` 相关场景**不假设免疫压缩**（Lead 裁决 4）。

| # | 场景 | 预期行为 | 依据 / 状态 |
| --- | --- | --- | --- |
| E1 | `AGENTS.md` 不存在 | `fs.stat` 返回 undefined → 不注入 → `next()` 原样放行。告警一次 | `[T1:L324]` `stat` 可返回 undefined |
| E2 | 文件存在但为空 / 仅空白 | 视为无内容 → 不注入 → 不告警（或 debug 级）。**不推进** `lastInjectedTurn` | 设计决策 |
| E3 | 源文件超过 `maxSourceBytes` | 不读入内容，直接跳过并告警（BR-10 的 L2 降级） | `[T1:L68]` 同款预算思路 |
| E4 | 读取失败（权限 / IO / 编码） | 捕获异常 → 不注入 → 告警一次 → 返回 `next()`。异常不得冒泡打断 turn | `readText` 契约 `[T1:L326]` |
| E5 | `N = 0` | schemastery `.min(1)` 拒绝 → 插件行激活失败并给诊断 | `[T1:L212-L216]`、`[H:L64]` |
| E6 | `N` 负数 / 非整数 / 非数字 / > 1000 | 同上，Config 层拒绝；运行期非法值退化为不注入 | 4.1、3.3 |
| E7 | 压缩 compaction（**Lead 裁决 4**） | **行为未知**。已证 `compaction/start|summary|prune|end` 是已注册 session 事件 `[T1:L202]`，但四类注入点被压缩吞掉的具体行为未取证 `[T1:L201-L203、U3]`。**按「可能被吞掉」设计**：不假设免疫，靠下一个命中轮号（2N+1、3N+1 …）自然重发。这是**可接受的降级**——重锚的周期性本身提供了自愈 | `[U3]`；M4 补一次 `dsh-compaction-basic` 调研 |
| E8 | 上下文裁剪 / 消息被丢弃 | 同 E7，取决于 surface 与 compaction 实现。同样按「可能被丢弃、下周期重发」设计 | `[U3]` |
| E9 | 注入重复 | 主判据 `(turn - 1) % N === 0 && turn > 1` + `lastInjectedTurn` 水位线，同一 turn 内正常路径不会重复。风险场景：(a) resume 后水位线丢失且恢复点恰在命中轮号 → 补注入一次（3.3(a)，**接受**）；(b) turn 中断后 resume 重放同一 turn 的 step>1 → 位置偏移，仍只注入一次（受水位线保护） | `[待验证]` B9 |
| E10 | 并发 turn | 同一 session 的 turn 由 `kick()` 的 `while (await this.turn())` 串行驱动 `[T1:L889]`，天然不并发 | `[T1:L889]`；`[待验证]` 同一 session 是否可能存在多 agent 并行 |
| E11 | 插件卸载 | 插件 effect 释放：`off()` 事件订阅 + 遍历 Map 释放每个 `agent.ctx` disposer + 清空 Map。双 owner 保证 agent 先销毁时也不泄漏 | `[P:L8、L19]` |
| E12 | 文件运行中被删除 / 改名 | 等同 E1，下次命中轮号时重新 `stat` 发现 | `[T1:L324]` |
| E13 | `DSH_HOME` / HOME 不可解析 | `resolveDshHome()` 回落到 `~/.dsh` `[T1:L56]`；若仍失败 → 等同 E1 并告警 | `[T1:L99-L111]` |
| E14 | 路径指向目录 | `stat` 判为非普通文件 → 等同 E1 | 设计决策 |
| E15 | resume 后水位线丢失 | `Map` 为空 → `lastInjectedTurn = -1`。若恢复点恰在命中轮号上补注入一次。**接受**（3.3(a)），最多一份重复副本 | Lead 裁决 2 |
| E16 | fork | 行为自洽（命中序列不变）；新会话轮号是否重置未验证 | `[待验证]` B8。验收测试必须记录实际表现 |
| E17 | `agent.cancel()` | 本设计不使用 inbox，不受影响；若降级到 `inject()` 路线，已注入未 claim 的消息会被 `inbox.clear()` 丢弃 | `[T1:L123]` |
| E18 | profile 缺少 `fs` 服务 | `ctx.get("fs")` 返回 undefined → 插件整体 no-op，**不抛错** | `[T1:L340、T1:L388]`、`[P:L20]` |
| E19 | 与 shipped 基线重复 | 同一份文件出现多份副本（`alreadySupplied` 不覆盖第三方消息 `[T1:L80]`）。**接受**，这是「周期重锚」的固有形态；由 BR-10 + 6.1 做量化控制 | `[T1:L80、T1:L385]` |
| E20 | `payload.turn` / `payload.step` 缺失或非预期 | 判定前做类型防御：非整数直接返回 `next()` | 设计决策；`[待验证]` 是否有版本会改 payload |
| E21 | 其他插件在 pre-step 丢弃或重排消息 | 只做尾部追加且 spread decision，不删除他人内容；若下游丢弃我们的消息则本次注入静默失效 | `[P:L16]` |
| E22 | `onlyIfChanged: true` 且内容未变 | 跳过注入。若上一份副本已被压缩掉（E7），会造成「本该重锚却没锚」的缺口 | 设计决策 → 因此默认 `false` |
| E23 | 内容超过 `maxInjectBytes` | `truncateOversize: true` → 截断 + 显式截断标记后注入（L1）；`false` → 跳过并告警（L2） | BR-10、Lead 裁决 3 |
| E24 | 注入消息构造失败（字段非法 / 模块解析失败） | 捕获 → 不注入 → 告警 → 返回 `next()`。**不推进** `lastInjectedTurn` | 见 3.4.5、附 A B1 |
| E25 | 同一 turn 内 pre-step 多次触发 | `attemptedTurn` 在第一层拦截（不重复读盘），`lastInjectedTurn` 在第二层拦截（不重复注入）。失败时只推进 `attemptedTurn` | 3.3(b)、Lead 裁决 2 |
| E26 | 运行中把 `everyTurns` 改小 | 下一次判定立即按新值；若新值使当前 turn 立即命中，则允许当轮注入（水位线仍防重复） | `[T1:L231]` `applies:"live"`；`[需用户确认]` |
| E27 | **忘记解包 volatile（BLOCK-2）** | `turn % config.everyTurns` 的右操作数是包装对象 → `NaN`；`Number.isInteger(NaN)` 为 false → 判定恒假 → **静默永不注入，无任何报错**（审核 S3 `[R:L106]`）。防御：3.3 强制 `n` 为解包后的 number；建议 M3 首轮加一次自检断言 | `[R:L53、R:L106]` |
| E28 | 下游 pre-step 返回 `{kind:"reject"}`（BLOCK-3） | `decision.messages` 可能不存在，`[...decision.messages, injected]` 抛 `TypeError` → 冒泡出 `preStep` → `turn()` 捕获为 `turnEnds.kind="error"`（L1010-L1026）→ 用户看到 turn 失败。**防御：`if (decision.kind === "reject") return decision;` 早返回** | `[R:L33、R:L107、R:L158-L166]` |
| E29 | 子智能体扇出（S8） | `includeSubagents: false`（默认，用户决策 3）且 P1 谓词未就绪时 fail-closed **不注册任何 agent** 并告警；`true` 时全注册（用户显式承担成本）。谓词以 `docs/research/impl-prerequisites.md` 为准（BR-7） | `[R:L111、R:L134]`、`[Rv:L100-L113]` |
| E30 | 设置改动以「重新 `apply`」传播（S12） | 水位线 `Map` 被清空 → 同一 turn 可能重复注入一份。**接受**（仅一次） | `[R:L115]` |
| E31 | agent 销毁时的清理 | 唯一有效路径是 `agent.ctx.effect()` 返回函数内的 `states.delete(agent)`（在 `scope.dispose` 时执行）；`agent/disposed` 监听不会执行，**不得**作为清理依据 | `[R:L79-L80]` |
| E32 | **`enabled: false`（R-1）** | 主开关在 `agent/created` **最外层**拦截 → **零读盘、零注入、零注册**。v1.2 草案因形参不匹配会把 `enabled: false` 静默绕过（`if not enabled` 对对象恒假，仍读盘并注入且无报错）。v1.3 已修，且 BR-8 / BR-1 条件 1 / 4.1 注释三处承诺一致 | `[Rv:L87-L98]` |
| E33 | **`agent/created` 监听器抛错（R-2）** | 该事件是 **serial** 模式（`dsh-agent` L581），监听器抛错会沿 serial 冒泡 → `announce()` 失败 → **该 agent 创建失败**，影响面远超「插件不生效」。**防御：监听器整体 try/catch，异常只告警绝不冒泡**；fail-closed 用常量分支而非未定义函数 | `[Rv:L100-L113]` |
| E34 | **运行期改 `includeSubagents`（R-4）** | 判定发生在 `agent/created` 时刻且该字段非 volatile → **不追溯已存在的 agent**，只影响此后新建的 agent。README 必须明示 | `[Rv:L120-L123]` |
| E35 | `agent.ctx.effect(...)` 创建抛错（R-7） | `states.set` 在 effect 成功之后执行，因此不会残留 Map 条目；异常被 `agent/created` 的 try/catch 吞掉并告警（E33） | `[Rv:L135-L138]` |

---

## 6. 性能与成本

### 6.1 token 与延迟影响的估算方式（含膨胀量化控制，Lead 裁决 3）

**估算模型**（方法而非事实，经验系数需实测替换）：

- 单次注入增量 `ΔT ≈ ceil(injectedBytes / 3.5)`，中文与代码混合文本的经验比；
- 可见副本数 `k(T) ≈ 1 + floor(T / N)`，其中 `1` 是 shipped 基线 `[T1:L34]`，`T` 为会话总 turn 数；
- 会话累计增量 `ΔT_total ≈ k_extra × ΔT = ΔT × floor(T / N)`；
- 每轮平均增量 `ΔT_avg = ΔT / N`。

**关键成本特征（必须向用户说明）**：shipped 插件已加载一份基线，本插件每次注入**再加一份副本**，因此 `ΔT_total` 随会话长度**线性增长**。这是 A3「周期性注入」的固有代价，也是 E19 的必然结果。

**量化控制旋钮**（Lead 裁决 3）：

| 旋钮 | 作用 | 默认 |
| --- | --- | --- |
| `everyTurns` N | 直接线性缩放 `ΔT_total`（`ΔT_total ∝ 1/N`） | 10 |
| `maxInjectBytes` | 给单次注入封顶，防大文件把 `ΔT` 放大 | 16384 |
| `maxSourceBytes` | 源文件过大时整体跳过（L2 降级） | 1048576 |
| `onlyIfChanged` | 内容未变则不注入，把 `k_extra` 降为「内容变更次数」 | false |
| E7 压缩 | 若副本被压缩吞掉则 `k` 自然下降，但重锚效果同时削弱（**未知**，不假设） | — |

**降级行为**：见 BR-10 的两级降级（L1 截断 / L2 跳过），保证单次注入成本有硬上界，不随文件体积失控。

**延迟**：本设计**不产生额外模型调用、不额外开轮**（这正是选择 pre-step 而非 `turn/end` + `inject()` 的核心收益，见 3.4.3）。增量延迟仅来自 prompt 变长导致的 prefill 增长。测量方式：同一脚本会话，插件开/关各跑一次，比较 TTFT 与总 token，而不是比较单次请求绝对值。

`[待验证]` B11：能否在运行中读取真实 token 计数（task-1 未覆盖）。若不能，上式的经验比只能靠外部测量校准。

### 6.2 避免重复读盘

- **只在命中时读盘**：判定命中发生在 turn N+1、2N+1、3N+1 …，因此**每 N 轮才触碰一次磁盘**。这是主要成本控制点。
- **同轮只读一次**：`attemptedTurn` 在读取前置位，同一 turn 的后续 step 不会重复读盘（E25）。
- **版本比对缓存**：采用 `agent-instructions` 的做法——`stat(target).version` 比对，未变则复用缓存文本 `[T1:L361]`。缓存键为 `(path, version)`，按 agent 持有。
- **先 stat 再读**：用 `stat` 拿大小，超 `maxSourceBytes` 直接跳过（E3），避免读入大文件再丢弃。
- **不使用 `watch` 作为依赖**：基类 `FileSystem.watch` 默认拒绝 `[T1:L356]`；`LocalFileSystem` 虽已实现（chokidar）`[T1:L357]`，但依赖后端能力会降低可移植性。`watch` 仅作为可选优化。

### 6.3 每 step 的监听器开销

`agent/pre-step` 每步触发，因此监听器的**未命中路径必须极廉价**：先做整数比较，不命中直接 `return next()`，不做任何 IO、不分配对象。命中路径每 N 轮一次，代价可忽略。

注意：命中但读取失败时，`attemptedTurn` 已置位，因此该 turn 剩余 step 全部走未命中路径，不会形成读盘风暴（E25）。

**求值顺序（v1.3 修正，R-3 `[Rv:L115-L118]`）**：`config.enabled` 的检查已提升到 `agent/created` 监听器最外层（R-1），因此 `enabled: false` 时连 pre-step 监听器都不会注册。`readEveryTurns(config)` 是 `isVolatile` + `.get()` 两次廉价调用，位于整数比较之前求值，功能无影响、代价可忽略（R-3 判定为低风险）。

`[待验证]`：`next()` 的调用开销是否随监听器链长度增长——本插件只是链上一环，不改变该性质。

### 6.4 测量与验收指标

| 指标 | 采集方式 | 预期 |
| --- | --- | --- |
| 注入次数 | 统计注入消息条数 | `floor(T_total / N)`（忽略水位线丢失带来的 ±1） |
| 额外 turn 数 | 对比插件开/关的 turn 总数 | **0**（不得出现空转轮） |
| 额外模型调用 | 对比 request 数 | **0** |
| `ΔT_total` | 会话总 token 差值 | `≈ ΔT × floor(T_total / N)` |
| 读盘次数 | 计数 `readText` 调用 | `≤ floor(T_total / N)`，且同轮不重复 |
| TTFT | 插件开/关对比 | 无显著劣化（差异应仅由 prompt 变长解释） |

---

## 7. 实施计划

### 7.1 里程碑

| 里程碑 | 交付物 | 验收方式 | 前置 |
| --- | --- | --- | --- |
| **M1 包骨架可安装** | 包目录、`package.json`、`cordis.patch.yml`、`index.js`（空 `apply`）、`locale/{en,zh}.json`、`icon.svg`、README | (a) 安装后 Plugin Manager 能列出该插件，标题/描述/图标正确渲染 `[H:L53]`；(b) 确认 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/cosmokit` 两个裸包名在本地 linked bundle 中可解析（B1 残余风险 `[R:L175]`）；(c) **按 `docs/research/impl-prerequisites.md` 接入 P1 主 agent 判定谓词**（默认值已定稿为 `false`）；(d) **按默认配置启动后主 agent 的注入确实生效**（BR-7 决策路径第 4 条，禁止交付开箱不可用的默认） | 无 |
| **M2 Config 与设置入口** | `export const Config`（`everyTurns.volatile()`）、4.2 的人类可读等价物 | (a) 非法 `everyTurns` 导致激活失败并有诊断；(b) **页面实测** `everyTurns` 在插件设置中可见可改（R2 验收 `[R:L146]`）；(c) 改动后无需重启即生效；(d) 非 volatile 字段不出现在表单（NB-1 预期行为）；(e) `enabled: false` 时零读盘零注入（E32） | M1 |
| **M3 注入机制打通** | 3.4.5 的实现（含 volatile 解包 + reject 早返回 + signal 检查 + serial 监听器加固）+ 水位线 + 读盘缓存 | 跑 `2N+2` 个 turn：注入恰好出现在第 N+1、2N+1 轮；同轮后续 step 无重复；**turn 总数与不开插件一致**（无空转轮）；request 数一致；构造 reject 场景不抛错（BLOCK-3）；断言解包后的 `n` 是 number（BLOCK-2）；`enabled: false` 下零读盘零注入（R-1）；监听器抛错路径下 agent 仍创建成功（R-2） | M2 |
| **M4 边界与性能收口** | E1-E35 行为实现、BR-10 降级、6.4 指标 | 逐条执行 E 表；产出 6.4 指标对比表；补 E7 的压缩调研结论 | M3 |

### 7.2 teammate 分工建议

- **developer**：独占 `dsh-ami/` 目录，按 M1→M4 顺序实现，**严格遵循 `docs/design/impl-spec.md`**。不得改动其他插件、不得写 `docs/design/`。**M1 先验证 `@deepseek-ai/dsh-llm` / `@deepseek-ai/cosmokit` 的裸包名解析，并按 `docs/research/impl-prerequisites.md` 接入 P1 谓词**（默认值已定稿 `false`）。
- **tester**：基于 developer 的**真实变更**测试，产出 E1-E35 逐条结果 + 6.4 指标表。必须实测「额外 turn 数 = 0」「额外模型调用 = 0」「同轮不重复读盘」「volatile 已解包」「reject 不抛错」「`enabled:false` 零读盘零注入」「监听器抛错不影响 agent 创建」。临时脚本与会话产物在结束前清理。
- **reviewer**：核对是否违反 `[P]` 硬规则——未监听 `system-prompt/assemble`、未写自定义 session 事件类型、未用 `appendPluginRecord`、未注册投影、disposer 双 owner 齐全、pre-step 改写做了 spread；并核对每条断言能否回溯到 task-1 报告或 `[Lead]` 证据。
- **lead**：M3 前后跑最终回归并审核 diff。

### 7.3 测试要点

1. **命中序列（v1.4 严格读法）**：`N=2` 时注入出现在 turn **3、5、7**（即 N+1、2N+1、3N+1）；turn 1、2 不注入。`N=1` 时 turn 1 不注入，turn 2 起每轮注入。
2. **无空转轮**：插件开/关的 turn 总数与 request 数一致（对比 `inject()` 在 `turn/end` 注入的反例）。
3. **同轮幂等**：同一 turn 内多次 pre-step 只注入一次、只读盘一次。
4. **失败不推进水位线**：E1/E3/E4 下 turn 正常完成，且下一个命中轮号会重试。
5. **卸载**：卸载后 pre-step 不再触发，无残留订阅与 Map 条目。
6. **resume**：恢复后计数延续；命中轮号恢复时记录是否补注入一次（E15）。
7. **fork**：记录实际轮号行为（E16）。
8. **设置生效**：改 N 后下一轮即按新值判定（A7）。
9. **体积降级**：构造超 `maxInjectBytes` 的文件验证 L1 截断标记；超 `maxSourceBytes` 验证 L2 跳过。
10. **成本**：同一脚本会话，插件开/关对比 TTFT、总 token、读盘次数。
11. **volatile 解包（BLOCK-2）**：断言 `readEveryTurns(config)` 返回 number 而非对象；构造「忘记解包」的反例确认会静默失效（E27）。
12. **reject 场景（BLOCK-3）**：注册一个返回 `{kind:"reject"}` 的前置 pre-step 监听器，断言 turn 正常结束、无 TypeError（E28）。
13. **设置表单内容（NB-1）**：断言表单中**只有** `everyTurns`，且其余字段不出现在表单里。
14. **子智能体（S8）**：`includeSubagents: false` 下断言子智能体无注入；谓词未就绪时断言 fail-closed 无注册（E29）。
15. **主开关（R-1）**：`enabled: false` 下断言零读盘、零注入、无 `agent/pre-step` 注册（E32）。
16. **serial 监听器健壮性（R-2）**：让注册路径必然抛错，断言 agent 仍创建成功、只有告警（E33）。
17. **不追溯（R-4）**：运行中改 `includeSubagents`，断言已存在的 agent 不受影响、仅新建 agent 按新值（E34）。

---

## 8. 风险清单与开放问题

### 8.1 风险清单

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | `UserMessage` 构造（v1.2 纠正） | 已降级：`createUserMessage` 由 `@deepseek-ai/dsh-llm` 导出、输入 `{content, source}` `[R:L63-L67]` | 残余风险仅为本地 linked bundle 能否解析裸包名 `[R:L175]`；M1 验证模块解析 |
| R2 | 在 `turn/end` 监听里 `inject()` 会立即多开一轮 `[T1:L383]` | 每次注入产生一次只有注入内容的模型调用 | **本设计不使用该组合**；pre-step 天然规避 |
| R3 | `agent.inject()` idle 时不唤醒 `[T1:L384]` | 注入滞留至下次用户输入 | **本设计不使用 `inject()`**；降级时必须接受并写入文档 |
| R4 | 设置表单不投影 `everyTurns`（v1.2 已定性为「缺 `.volatile()` 必发生」） | 核心需求「插件菜单可设置 N」不成立 | **BLOCK-1 已修**：`everyTurns.volatile()`；M2 页面实测仍必须做 |
| R5 | 压缩吞掉注入内容 `[U3]` | 周期重锚效果被削弱 | 按「可能被吞掉、下周期重发」设计（Lead 裁决 4）；M4 补调研；README 声明未验证 |
| R6 | 与 shipped 基线重复导致 token 线性增长 `[T1:L385]` | 成本随会话上升 | BR-10 两级降级 + 6.1 的四个旋钮；README 说明 |
| R7 | 监听器顺序耦合 `[T1:L386]` | 与 shipped 及第三方 pre-step 插件互相影响 | spread decision、只做尾部追加、不抢 `lastClaimedIndex+1` `[P:L16]` |
| R8 | 全局 context 注册导致泄漏到所有 agent / 卸载不净 `[T1:L387]` | 资源泄漏、行为越界 | 在 `agent/created` 里对 `agent.ctx` 注册 + 双 owner disposer `[P:L8、L19]` |
| R9 | 缺 `fs` 的 profile 抛错 `[T1:L388]` | 插件激活失败 | `ctx.get("fs")` 可选获取，缺失即 no-op |
| R10 | 截断导致模型看到不完整规则 | 规则被误解 | 截断必须带显式标记；提供 `truncateOversize: false` 退化为跳过 |
| R11 | 使用了 task-1 未覆盖的接口 | 编码返工 | 附 A 即编码前必查清单 |
| R12 | **缺 `.volatile()` → 整条 entry 从设置表单消失** | 核心需求不成立 | **BLOCK-1 已修**；M2 页面实测 |
| R13 | **volatile 值未解包 → `turn % obj = NaN` 静默永不注入** | 功能静默失效且无报错 | **BLOCK-2 已修**；3.3 契约强制 number；E27 |
| R14 | **未处理 `decision.kind === "reject"`** | TypeError 打断 turn 并记为 error | **BLOCK-3 已修**；E28 |
| R15 | 子智能体注入成本乘性增长（S8） | token 随 agent 数 × turn 数增长 | BR-7：默认 `false`（用户决策 3）+ fail-closed；谓词 P1 以 `docs/research/impl-prerequisites.md` 为准 |
| R16 | 配置重载清空水位线 → 同 turn 重复注入一次（S12） | 多一份副本 | 接受；见 4.4 |
| R17 | **`enabled` 主开关被静默绕过**（`shouldInject` 形参 `enabled` 与实参 `config` 不匹配） | `enabled: false` 仍读盘并注入，违反 BR-8 且无任何报错 | **R-1 已修**：检查提到 `agent/created` 最外层 + 形参统一为 `shouldInject(turn, n, state)`；E32、测试点 15 |
| R18 | **`agent/created` 监听器抛错放大为 agent 创建失败**（serial 事件 `[Rv:L103]`） | 影响面远超「插件不生效」——该 agent 直接创建失败 | **R-2 已修**：监听器整体 try/catch 永不抛错 + 常量 `SUBAGENT_PREDICATE_READY` fail-closed 分支；E33、测试点 16 |

### 8.2 未验证项原样保留（Lead 裁决 4）

| # | 未验证内容 | 来源 | 影响 |
| --- | --- | --- | --- |
| **U1** | 单个 Service（含 `Agent`）的精确契约类型 | `[T1:L371]` | 类型级细节只能从源码推断。**v1.2 已把消息构造从该未知项中摘出**（`createUserMessage` 由 `@deepseek-ai/dsh-llm` 导出 `[R:L63-L67]`）；残余仅为裸包名模块解析 `[R:L190]` |
| **U2** | Client slot 键与 props 形状 | `[T1:L372]`；`[Lead][单源]` | **v1.2 修正**：slot 键证据为**单源**（Lead 单次观测，审核因 client inspect 通道整体超时无法复现 `[R:L87、R:L187]`），**不得作为确定性前提**；props 形状同样未验证。影响方案 B（兜底路径） |
| **U3** | 四类注入点被 compaction 吞掉的具体行为 | `[T1:L373]` | 见 E7/E8，按可能被吞掉设计 |
| **U4** | `Config.listConfigs` 的 `status` 取值语义 | `[T1:L374]` | 仅用于定位条目，不用于判断可配置性 |
| **U5** | 自动 Config 表单在 Web UI 的**具体页面位置** | `[T1:L375]`、`[R:L188]` | 保留。**仅剩位置未知**；「entry 是否出现」已由 BLOCK-1 修正为确定性成立 |
| **U6** | `sessionProjections` 的 key 约束是否可由下游插件扩展 | `[T1:L376]` | 不阻塞（本设计不注册投影，Lead 裁决 2） |
| **U7** | `settings/document-updated` 的 `SettingsNamespace` 与 entry id 对应细节 | `[T1:L377]` | 影响配置传播方式的确认，不阻塞正确性 |

### 8.3 开放问题与决策建议

| # | 开放问题 | 建议决策 |
| --- | --- | --- |
| Q1 | 注入通道采用 `agent/pre-step` 条件化改写？ | **已决策（用户决策 1，v1.4 定稿）**：采用。它是 `[P:L16]` 记载的受支持机制，规避 R2/R3 两个已证实的坑，且与 shipped 插件同机制 |
| Q2 | 「轮」= DSH turn 还是用户输入轮？ | 建议 DSH turn（C1），唯一可零持久状态、可 resume 重放的计数 |
| Q3 | 命中轮号取 N、2N … 还是 N+1、2N+1 …？ | **已决策（用户决策 2，v1.4 定稿）**：严格读法 `(turn-1) % N === 0 && turn > 1` → 命中 N+1、2N+1、3N+1 …。见 BR-2b |
| Q4 | 周期注入还是一次性？ | 建议周期性。AGENTS.md 是长期规则，需要反复重锚 |
| Q5 | 是否需要唤醒 agent 立即注入？ | 建议**否**。pre-step 路径不唤醒也不滞留；若用户要求立即生效则必须 `followup()`，会额外开轮 |
| Q6 | 改 N 是否需要重启？ | 依据 `applies:"live"` 判定无需重启 `[T1:L231]`；M2 页面实测确认 |
| Q7 | 默认 N = 10 是否合适？ | 建议 10；可按用户偏好调整 |
| Q8 | 子智能体是否生效？ | **已决策（用户决策 3，v1.4 定稿）**：默认 `false`，只对主 agent 注入。谓词 P1 取值以 `docs/research/impl-prerequisites.md` 为准；P1 不可得的应急分支需用户重新拍板（BR-7、Q18） |
| Q9 | 是否需要「立即注入一次」的手动入口？ | 建议不做，超出原始需求且需要 UI |
| Q10 | 是否需要展示累计轮数/注入次数？ | 建议不做。若要做则必须启用方案 B 并新增 Host 投影（与 Lead 裁决 2 冲突，需重新评估） |
| Q11 | 默认是否开启 `onlyIfChanged`？ | 建议 `false`。开启会破坏「周期重锚」的目的（E22） |
| Q12 | 超预算时截断还是跳过？ | Lead 裁决 3 定为截断（`truncateOversize: true`）。`[需用户确认]` 是否接受模型看到不完整规则 |
| Q13 | 失败后同轮重试还是等下个周期？ | 建议等下个周期（`attemptedTurn` 节流），避免读盘与告警风暴；见 BR-5 |
| Q14 | fork 后轮号语义？ | 行为自洽，无需代码改动；M4 测试记录实际表现即可 |
| Q15 | 设置落点选 (a) 还是 (b)？ | 建议 (a) 为主路径（BLOCK-1 修正后机制确定性成立、零 Client 代码）；(b) 仅为兜底且 slot 键为 `[单源]`，启用前必须重新实测 |
| Q16 | 「写入下一轮」取哪一式？ | **已决策（用户决策 2，v1.4 定稿）**：取严格式 `(turn-1) % N === 0 && turn > 1`（命中 N+1、2N+1 …）。**已知后果**：`N=1` 时第 1 轮不注入，从第 2 轮起每轮注入（BR-2b） |
| Q17 | 设置表单只暴露 `everyTurns`、其余 7 个字段只走 patch，是否接受？ | 建议接受（NB-1 取舍 `[R:L172]`）。若要暴露更多字段，逐个加 `.volatile()` 即可，但会放宽 `settings.write` 的路径校验 |
| Q18 | **默认配置是否开箱可用** | **不得交付开箱不可用的默认**。默认 `false` 已定稿，可用性由 P1（`docs/research/impl-prerequisites.md`）保证；若 P1 确认谓词在 DSH 中不可得，需用户重新拍板是否改默认 `true`（**不自动切换**）。M1 验收必须含「默认配置下主 agent 注入生效」（BR-7 决策路径、M1 验收 (d)） |

### 8.4 需求覆盖表（v1.2 最终结论）

审核第 3 章把用户原话拆为 5 个验收点 `[R:L122-L134]`。v1.2 修订后的逐条结论：

| # | 验收点 | v1.1 判定 | **v1.2 结论** | 依据 / 剩余风险 |
| --- | --- | --- | --- | --- |
| R1 | **可设置轮数** | 部分覆盖 | **覆盖** | `everyTurns` 字段 + 4.5 校验；`.volatile()` 使其可配置 |
| R2 | **在插件菜单里设置** | 未覆盖（阻塞） | **覆盖（机制确定性成立）** | BLOCK-1 修正后 `volatileForm(schema) !== undefined` → entry 保留 → 表单出现且可写回 `[R:L50-L52、R:L143-L146]`。**剩余**：表单具体页面位置 `[待验证]`（U5），M2 页面实测为验收 `[R:L146]` |
| R3 | **每 N 轮** | 覆盖 | **覆盖** | `(turn-1) % N === 0 && turn > 1`（**用户决策 2 定稿**），命中 N+1、2N+1、3N+1 … |
| R4 | **自动注入 `~/.dsh/AGENTS.md`** | 覆盖 | **覆盖** | 路径 `[T1:L346]` + pre-step 通道 + 6.2 读盘；消息构造路径已确定（B1 纠正 `[R:L63-L67]`）。剩余：`source.kind` 渲染层交互未验证（B10） |
| R5 | **写入下一轮的上下文** | 部分覆盖 | **覆盖（严格读法定稿）** | 命中轮 = N+1、2N+1 …，注入落在该轮首个 step，语义即「第 N 轮结束后、下一轮开始时规则回到上下文」（BR-2b、用户决策 2）。剩余：`N=1` 的偏移为已知后果（Q16） |

**额外口径问题（审核 S8 `[R:L134]`）**：`includeSubagents` 默认 true 曾把范围扩大到子智能体。**v1.4 定稿（用户决策 3）**：默认 `false`，只对主 agent 注入。可用性由并行调研 P1（`docs/research/impl-prerequisites.md`）保证，谓词取值以该文档为准；若 P1 确认谓词不可得，需用户重新拍板（**不自动改默认值**）——**不得交付开箱不可用的默认配置**（BR-7 决策路径、Q8、Q18）。

---

## 附 A. 编码前必查清单（未验证项汇总）

| # | 未验证内容 | 来源 | 阻塞的里程碑 | 建议归属 |
| --- | --- | --- | --- | --- |
| B1 | `UserMessage` 构造：**已确定** `import { createUserMessage } from "@deepseek-ai/dsh-llm"`，输入 `{content, source}` `[R:L63-L67]`。**残余风险**：本地 linked bundle 能否解析该裸包名 `[R:L175、R:L190]` | `[R:L63-L67]` | M1（模块解析） | developer |
| B2 | `agent/created` / `agent/disposed` payload | **已关闭** `[R:L78]` | — | — |
| B3 | `everyTurns` 是否进表单：**已确定**（加 `.volatile()` 即可）`[R:L50-L52]`；**剩余**：表单具体页面位置 | `[R:L50-L52、R:L188]` | M2 | tester 页面实测 |
| B4 | `step(1)` 经 `toJSON` 的类型 | **已关闭**：输出 `type:"number"` `[R:L56]`；保留 `Number.isInteger` 防御 | — | — |
| B5 | 配置改动的传播方式（原地更新 vs 重新 `apply`；后者会清空水位线并可能多注入一次） | `[T1:L377、U7]`、`[R:L115]` | M2（影响是否多注入一次） | developer |
| B6 | 压缩 / 裁剪对注入消息的处理 | `[T1:L201-L203、U3]` | M4 | researcher 补一次 `dsh-compaction-basic` 调研 |
| B7 | 子智能体（主 agent）判定谓词（候选：`agent/created` 的 `source`；或 session 顶层性） | BR-7、`[R:L111]` | **由并行调研 P1 交付，写入 `docs/research/impl-prerequisites.md`；谓词取值以该文档为准**。设计侧已预留接入点（`SUBAGENT_PREDICATE_READY` + `isPrimaryAgent`），未到位时 fail-closed | researcher（P1）→ developer 接入 |
| B8 | fork 后新会话轮号是否重置 | 3.5 `[待验证]` | M4 | tester |
| B9 | turn 中断后 resume 是否重放同一 turn 的 step>1（E9 位置偏移风险） | E9 `[待验证]` | M3/M4 | tester |
| B10 | `source.kind` 是否接受任意字符串 | BR-3 `[待验证]` | M3 | developer |
| B11 | 能否读取运行中真实 token 计数 | 6.1 `[待验证]` | M4（仅影响测量精度） | developer |
| B12 | `plugins.bundle.config` 的 slot 键（`[单源]`）与 props 形状 | `[Lead][单源]`、`[R:L87]` | 仅方案 B（启用前必须重新实测） | developer |
| B13 | `sessionProjections` key 约束是否对下游插件开放 | `[T1:L376、U6]` | 不阻塞（本设计不注册投影） | 备查 |

## 附 B. 变更记录

| 版本 | 变更 |
| --- | --- |
| v0.1 | 初稿。task-1 报告不存在，第 3/5/6 章为占位 |
| v1.1 | 按 Lead 四条裁决与补充 slot 证据补全全部章节。**裁决 1**：主方案定为 `agent/pre-step` 条件化追加，`agent.inject()` 降为备选并给出三个已证实坑的规避手段与代价、新增主备对比表与选择理由。**裁决 2**：判定式定为 `turn % N === 0`，不注册投影不写 session 事件；水位线为 per-agent 内存 `Map`（`agent/created` 建立、`agent/disposed` 清理、包在 `agent.ctx.effect` 内并保留 disposer）；显式讨论 resume 水位线丢失与同 turn 多次 pre-step 两个边界，并引入 `attemptedTurn` 与 `lastInjectedTurn` 双字段以同时满足「失败不得推进水位线」与「同轮不重复读盘」。**裁决 3**：明确与 shipped `agent-instructions` 的插入位置分工（不抢 `lastClaimedIndex+1`）、重复的必然性与量化控制（BR-10 两级降级 + 6.1 四旋钮）。**裁决 4**：E7/E8 按「可能被吞掉、下周期重发」设计，不假设免疫压缩；U1/U2/U5/U6 原样保留。**补充证据**：slot 键升级为运行时已验证，第 4.4 节给出 (a)(b) 两个确定性落点与推荐，第 2 章补方案 B 的 Client 半体约束，U2 降级为「props 形状未验证」 |
| **v1.2** | **按 task-3 审核报告修订，消除 3 个阻塞项。** **BLOCK-1**：`everyTurns` 加 `.volatile()`——不标则 `volatileForm(schema) === undefined` 使整条 entry 从设置表单消失，核心需求不成立（4.1/4.4 `[R:L50-L52]`）。**BLOCK-2**：新增 `readEveryTurns(config)` 用 `isVolatile(...) ? .get() : ...` 解包，3.3 判定契约强制 `n` 为 number，5 章新增 E27 记录「忘记解包 → `NaN` 静默失效」（`[R:L53、R:L148-L156]`）。**BLOCK-3**：代码草案补 `if (decision.kind === "reject") return decision;` 早返回与三处 `signal.throwIfAborted()`，5 章新增 E28（`[R:L33、R:L158-L166]`）。**NB-1**：4.1/4.4 明确 volatile 取舍——表单只暴露 `everyTurns`，其余 7 字段只走 patch，写回非 volatile 路径抛 `Config field "..." is not volatile`。**NB-2**：4.2 改标为「人类可读等价物」，wire 形态为 schemastery `toJSON` 的 `{uid, refs}`，数值字段改 `type:"number"`。**NB-3**：删除 `agent/disposed` 监听（死代码），强调清理唯一路径是 `agent.ctx.effect` 返回函数里的 `states.delete(agent)`；B2 关闭。**NB-4**：B1 纠正为 `@deepseek-ai/dsh-llm` 的 `createUserMessage`，残余风险仅裸包名解析。**NB-5**：slot 键降级为 `[单源]`，方案 B 不得以其为确定性前提。**NB-6**：B4 关闭（`type:"number"`）。**NB-7**：BR-4 补注入相对 runtime-context 快照的位置。**NB-8**：草案补 `signal.throwIfAborted()`。**需求口径**：新增 BR-2b 正面澄清「实际注入命中轮当轮」并给出严格读法的替代判定式；`includeSubagents` 默认改为 `false` 并给出 fail-closed 规则（BR-7）；新增 8.4 需求覆盖表，R1-R5 五个验收点全部给出最终结论 |
| **v1.3** | **按 task-5 复核报告修订，消除 R-1（阻塞级）与 R-2（高风险），并落实 R-4/R-7。** **R-1**：`config.enabled` 检查从 `shouldInject` 的形参提升到 `agent/created` 监听器**最外层**，3.3 形参统一为 `shouldInject(turn, n, state)`——v1.2 的形参 `(turn, n, enabled, state)` 与实参 `(turn, readEveryTurns(config), config, state)` 不匹配会让 `enabled: false` 静默绕过（仍读盘并注入且无报错），违反 BR-8；新增 E32、测试点 15、风险 R17（`[Rv:L87-L98]`）。**R-2**：`agent/created` 是 **serial** 事件（`dsh-agent` L581，抛错会让 `announce()` 失败即 agent 创建失败），草案改为监听器整体 try/catch **永不抛错**，fail-closed 落成常量 `SUBAGENT_PREDICATE_READY` 的显式分支（`isPrimaryAgent` 在常量分支下永不执行），并补 `includeSubagents` 两种取值的行为表；新增 E33、测试点 16、风险 R18（`[Rv:L100-L113]`）。**可用性冲突正面解决**：B7 从「M3 硬前置」提升为 **M1 必查项**，给出三条决策路径（M1 可解 → 默认 `false`；M1 不可解 → 默认改 `true` + README 显著警告；禁止交付开箱不可用的默认），写进 BR-7、M1 验收 (c)(d)、Q18（`[Rv:L100-L113]`）。**R-4**：BR-7 明示 `includeSubagents` 变更**不追溯**已存在 agent（判定在 `agent/created` 时刻且该字段非 volatile），新增 E34、测试点 17（`[Rv:L120-L123]`）。**R-7**：`states.set(agent, state)` 移到 `agent.ctx.effect(...)` 成功之后，新增 E35（`[Rv:L135-L138]`）。**R-6**：草案把 `readAgentsMd` / `buildMessage` 各自包进 try/catch，落实 E4 / E24 的承诺（`[Rv:L130-L133]`）。**R-3**：6.3 补求值顺序说明（`[Rv:L115-L118]`）。E 表扩至 E1-E35，M4 范围同步 |
| **v1.4** | **落实 task-8 用户三条决策，并新增 `docs/design/impl-spec.md` 实现规格冻结。** **决策 1（Q1）**：注入通道 `agent/pre-step` 条件化改写定稿，去掉 `[需用户确认]`（3.4.1、3.4.3、Q1）。**决策 2（Q3，实质变更）**：判定式由 `turn % N === 0` 改为 **`(turn - 1) % N === 0 && turn > 1`**，命中轮号由「N、2N、3N …」改为 **「N+1、2N+1、3N+1 …」**（N=10 → 11、21、31）；同步 BR-1 条件 2、BR-2、BR-2b（用户视角改为「第 N 轮结束后、下一轮开始时规则回到上下文」）、BR-5、BR-6、A6、2.3、2.4 关系图、3.3 伪代码与命中序列、3.3(a)、E7/E9/E29、6.2、7.1 M3、7.3 测试点 1、8.4 R3/R5、Q3/Q16，并明确 **`N=1` 的语义变化**（`(turn-1)%1===0` 恒真 + `turn>1` → 从第 2 轮起每轮注入、第 1 轮不注入）。**决策 3（Q8）**：`includeSubagents` 默认 `false` 定稿；主 agent 判定谓词 P1 以 `docs/research/impl-prerequisites.md` 为准，设计侧保留接入点（`SUBAGENT_PREDICATE_READY` + `isPrimaryAgent`），原「M1 不可解则自动改默认 true」降级为**需用户重新拍板的应急分支、不自动切换**（BR-7、A12、3.6、E29、M1(c)、7.2、Q8、Q18、附 A B7） |
