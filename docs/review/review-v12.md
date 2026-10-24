# v1.2 增量复核报告：3 个阻塞项是否真的消除

| 项 | 值 |
| --- | --- |
| 任务 | task-5 复核 v1.2 修订（交付前最后一道验证） |
| 审核对象 | [plugin-design.md](../design/plugin-design.md) v1.2（1034 行）、对照 [review-report.md](review-report.md)（task-3，207 行） |
| 方法 | 逐条核对 v1.2 文档文本行号 + 重新打开 asar 源码复核（本任务内重读的 4 处决定性源码见下） |
| 本任务内重新读取的源码 | `dsh-settings` L410-L421、`cosmokit` L100-L119、`dsh-agent` L574-L593、`dsh-agent-loop` L919-L928 |
| 结论 | **3 个阻塞项全部已消除**；但代码草案残留 **1 个阻塞级实现缺陷（R-1，v1.1 遗留）** 与 **1 个高风险实现缺陷（R-2）** → **有条件可交付编码** |

---

## 1. 三个阻塞项的三态判定

### BLOCK-1（`.volatile()`）→ **已消除**

| 检查点 | v1.2 文档行号 | 落地情况 |
| --- | --- | --- |
| Config 草案带 `.volatile()` | **L625** `everyTurns: z.number().step(1).min(1).max(1000).default(10).volatile(),` | ✅ 已落地 |
| 字段注释说明必要性 | L621-L624 | ✅ |
| 4.1 解释「不标 volatile → 整条 entry 消失」 | L645-L650（引 `dsh-settings` L413-L419 / L122-L131 / schemastery L235-L238、L240-L252） | ✅ |
| 4.4 给出确定性路径 | L755-L757、L761 | ✅ |
| 决策速查 / BR-6 / 风险表同步 | L42、L150、L946、L954 | ✅ |
| 需求覆盖表 R2 改判 | L1001 | ✅ |

**我的独立源码复核（本任务重读）**：`dsh-settings` L417-L419 `const form = volatileForm(schema); if (form === void 0) return [];`；`volatileForm` 仅对 `meta.volatile` 或含 volatile 后代的 object 返回非 undefined（L122-L131）。`everyTurns` 在固定对象路径上标 volatile，不违反 schemastery L241-L252 的「volatile 不能有 volatile 祖先」约束。→ 判定**已消除**。

### BLOCK-2（`.get()` 解包）→ **已消除**

| 检查点 | v1.2 文档行号 | 落地情况 |
| --- | --- | --- |
| 3.3 判定契约强制 `n` 为 number + 完整证据链 | L396-L401 | ✅ |
| 解包代码 | **L399-L400** `isVolatile(config.everyTurns) ? config.everyTurns.get() : config.everyTurns` | ✅ |
| 3.4.5 草案使用解包 | **L489-L490** `readEveryTurns`、**L506** 调用点 | ✅ |
| 组件关系图标注 | L325 | ✅ |
| 第 5 章边界条目 | **L834** E27（`NaN` → 判定恒假 → 静默永不注入） | ✅ |
| 测试要点 | L930（测试点 11） | ✅ |

**我的独立源码复核（本任务重读）**：`cosmokit` L102-L110 `createVolatile` 返回 `Object.freeze({ get: () => current, [write]: ... })`；L116-L118 `isVolatile` 以 `write in value` 判定（跨 ESM/CJS 副本有效）。`isVolatile` 确为 `@deepseek-ai/cosmokit` 的具名导出（cosmokit L418 导出列表），且 `dsh-settings` L8 就是这么导入的 → **不是新引入的未验证 API**。→ 判定**已消除**。

### BLOCK-3（reject 早返回 + signal）→ **已消除**

| 检查点 | v1.2 文档行号 | 落地情况 |
| --- | --- | --- |
| 早返回 | **L517** `if (decision.kind === 'reject') return decision;` | ✅ |
| `signal.throwIfAborted()` | **L509**（读盘前）、**L514**（读盘后）、**L519**（`next()` 后） | ✅ |
| BR-1 触发条件 6 | L70 | ✅ |
| 组件关系图 | L329、L333、L335 | ✅ |
| 第 5 章边界条目 | **L835** E28 | ✅ |
| 测试要点 | L931（测试点 12） | ✅ |

**我的独立源码复核（本任务重读）**：`dsh-agent-loop` L921-L922 `signal.throwIfAborted(); if (decision.kind === "reject") return decision;` —— reject 时 `decision.messages` 不存在，早返回是唯一正确处置；草案现在的写法与框架一致。→ 判定**已消除**。

**三个阻塞项小结**：BLOCK-1 / BLOCK-2 / BLOCK-3 均为**已消除**，且都有文档行号 + 源码复核双重证据。

---

## 2. NB-1~NB-8 复核表

| # | task-3 要求 | v1.2 行号 | 判定 |
| --- | --- | --- | --- |
| NB-1 | 表单取舍必须写明（只暴露 `everyTurns`，其余走 patch） | L652-L659（表格 + 策略）、L992 Q17、L907 M2(d) | **已落实** |
| NB-2 | 4.2 不得称「JSON Schema 就是描述符形态」 | L661-L665（改标「人类可读等价物」+ wire 为 `{uid,refs}`） | **已落实** |
| NB-3 | 删除 `agent/disposed` 死代码并保留 `states.delete` | L311、L525-L526、L545、L602-L605 | **已落实** |
| NB-4 | B1 定性纠正 | L550-L553、L943、L964、L1014 | **已落实** |
| NB-5 | slot 键降级为单源 | L24、L42、L239、L268、L762-L764、L965、L1025 | **已落实** |
| NB-6 | B4 关闭 | L665、L730、L1017 | **已落实** |
| NB-7 | 补注入相对 runtime-context 的位置 | L127、L94 | **已落实** |
| NB-8 | 补 `signal` 检查 | L509/L514/L519、L546 | **已落实** |

补充：task-3 的 NB-9（`includeSubagents:false` 不可实现）已由 BR-7 的 fail-closed 规则正面处置（L171-L173）；NB-10（经验系数）保持「方法而非事实」（L846），无需改动。**8/8 落实，无遗漏。**

---

## 3. 需求口径复核

| 口径 | v1.2 行号 | 判定 |
| --- | --- | --- |
| **R2 插件菜单设置** | L755-L757 给出确定性链路（`.volatile()` → `volatileForm !== undefined` → entry 保留 → 表单可写回）；L761 状态列；L907 M2(b) 页面实测为验收 | **正面回应**。机制层确定性成立；残留 U5（表单具体页面位置，L968、L188）属 M2 实测项，不影响编码 |
| **R5 写入下一轮** | BR-2b L88-L109：明确「实际注入命中轮当轮首个 step」+ 用户视角等价表述 + 严格读法的替代判定式 `(turn-1) % N === 0 and turn > 1` + 两式差异表；L1004 改判为「覆盖（口径已澄清）」 | **正面回应**。替代式与表中命中轮号（N+1、2N+1…）自洽（N=10 → 11、21） |
| **S8 子智能体** | BR-7 L153-L173：默认 `includeSubagents: false`、理由（乘性成本 L157）、两个候选谓词 L166-L169、fail-closed 规则 L171、B7 升为 M3 硬前置 L173；L836 E29；L1006 | **正面回应（决策明确）**，但 fail-closed **未落到代码草案**（见 R-2） |

---

## 4. 对抗性回归（修订后的草案是否引入/遗留新问题）

### R-1（阻塞级实现缺陷，v1.1 遗留、v1.2 未修正）`enabled` 主开关失效

- 位置：**L506** `if (!shouldInject(payload.turn, readEveryTurns(config), config, state)) return next();`
- 矛盾：3.3 的形参契约是 **L386** `shouldInject(turn, n, enabled, state)`，第三位是 `enabled`；草案传入的是**整个 `config` 对象**。
- 触发条件：用户把 `enabled` 设为 `false`（经 patch）。
- 后果：`if not enabled` 对对象恒假 → 主开关被绕过 → **仍会读盘并注入**，与 BR-8（L177）、4.1 注释（L621）、BR-1 条件 1（L65）三处承诺直接冲突，且**无任何报错**。
- 归属：v1.1 的草案（`shouldInject(payload.turn, config, state)`）已存在同类不匹配，task-3 未捕获，v1.2 未修正 → 非 v1.2 新引入，但**必须在 M3 前修正**。
- 修正文本（改 L506）：
  ```js
  if (!shouldInject(payload.turn, readEveryTurns(config), config.enabled, state)) return next();
  ```
  或者反向统一 3.3 的形参为 `(turn, config, state)` 并在函数内自行解包与读 `config.enabled`（二选一，不得两边不一致）。

### R-2（高风险实现缺陷）fail-closed 未落到代码，且 `agent/created` 是 serial 事件

- 位置：**L497-L499** `ctx.on('agent/created', ({ agent, source }) => { if (!config.includeSubagents && !isPrimaryAgent(agent, source)) return; ... })`，L548 说明 `isPrimaryAgent` 是占位符。
- 源码事实（本任务重读）：`dsh-agent` L581 `await this.ctx.serial(entry.carrier, "agent/created", {...})`；L473-L480 文档原文「Rejects if the id is already registered or a serial `agent/created` listener fails」。
- 后果：若 B7 未定而 `isPrimaryAgent` 以未定义函数形态存在（或该谓词实现抛错），监听器抛错会沿 `serial` 冒泡 → `announce()` 失败 → **该 agent 创建失败**，影响面远超「本插件不生效」。
- 而 BR-7 L171 承诺的 fail-closed 是「不注册任何 agent + 激活时告警」，草案没有对应分支。
- 修正建议：把 B7 表达为一个**已判定的常量**，并在监听器整体加 try/catch：
  ```js
  ctx.on('agent/created', ({ agent, source }) => {
    if (!PREDICATE_READY) { warnOnce(); return; }
    try { /* 注册逻辑 */ } catch (error) { ctx.logger.warn(...); }
  });
  ```
  原则：`agent/created` 监听器**永不抛错**，否则会把插件缺陷放大为 agent 创建失败。

### R-3（低）未命中路径的求值顺序

- 位置：L506。`readEveryTurns(config)` 在 `enabled` 与整数判定之前求值。
- 后果：`isVolatile` + `.get()` 是廉价操作，功能无影响；但与 6.3 L881「未命中路径必须先做整数比较、不分配对象」的表述不完全一致。建议把 `config.enabled` 检查提到最外层（同时修 R-1）。

### R-4（低）`includeSubagents` 对已存在 agent 不追溯

- 位置：L499 的判定发生在 `agent/created` 时刻；`includeSubagents` 为非 volatile（L637），运行时改 patch 后不重挂载已有 agent 的监听器。
- 后果：开关只影响此后新建的 agent；已运行的子智能体继续（或不继续）注入。建议在 README 与 BR-7 明示「不追溯」，避免用户以为改开关立即对全部 agent 生效。

### R-5（低，已覆盖）新增裸包名依赖

- 位置：L485 `import { isVolatile } from '@deepseek-ai/cosmokit'`、L486 `import { createUserMessage } from '@deepseek-ai/dsh-llm'`。
- 判定：两个导出均经源码验证存在（cosmokit L418；dsh-llm L59-L64，三处引用互证），**不是新的未验证 API**；裸包名解析风险已被 M1 L906 明确列入验收。→ 已覆盖，不构成新问题。

### R-6（低，已覆盖）构造与读取失败的捕获

- 位置：L511 `readAgentsMd`、L520 `buildMessage` 在草案中是占位调用，无 try/catch；但 E4（L811）与 E24（L831）已要求「捕获异常 → 不注入 → 告警 → 返回 `next()`」。
- 判定：设计要求完整，实现时把 `readAgentsMd`/`buildMessage` 包进 try/catch 即可；不新增设计问题。

### R-7（低）`states.set` 与 effect 创建的原子性

- 位置：L501-L502 `states.set(agent, state)` 先于 L504 `agent.ctx.effect(...)`。
- 后果：若 effect 创建抛错（如 agent.ctx 已非 active），Map 条目会残留到插件卸载。建议把 `states.set` 放到 effect 成功之后，或在 catch 中删除。

### 回归小结

| # | 性质 | 严重度 | 是否阻塞编码 |
| --- | --- | --- | --- |
| R-1 | v1.1 遗留，v1.2 未修 | 阻塞级（主开关静默失效） | **是（一行修正）** |
| R-2 | v1.2 新增设计（fail-closed 未落代码）+ serial 事件放大 | 高 | 否（M1 内加固） |
| R-3~R-7 | 低 | 低 | 否 |

---

## 5. 结论：是否可交付给 developer 开始编码

**有条件可交付。** 条件只有两条，且都是小改动：

1. **修正 L506**（R-1）：第三实参由 `config` 改为 `config.enabled`，或反向统一 3.3 的形参定义——两边必须一致。**不修则 `enabled:false` 主开关失效**，属 BR-8 的硬承诺违约。
2. **加固 L497-L499**（R-2）：`agent/created` 监听器不得抛错；B7 未定时走常量化的 fail-closed 分支（不注册 + 一次性告警），不得调用未定义的 `isPrimaryAgent`。

依据：

- 3 个阻塞项**全部已消除**，均有文档行号 + 独立源码复核证据（第 1 章）。
- NB-1~NB-8 **8/8 落实**（第 2 章）。
- 需求口径 R2 / R5 / S8 **均正面回应**（第 3 章）；R2 残留 U5 页面位置属 M2 实测验收项，不阻塞编码。
- 对抗回归发现的其余问题（R-3~R-7）均为低风险或已被既有条目覆盖。
- 未发现把 `[U#]` / `[待验证]` / `[单源]` 写成已验证事实的新增违规；v1.2 反而主动把 slot 键降级为 `[单源]`（L24、L965）。

**仍无法验证的部分（不因本次修订而改变）**：Client slot 键与 props（client inspect 通道本会话仍不可用，v1.2 已按 `[单源]` 标注）；U5 表单具体页面位置；U3 compaction 折叠行为（未读 `dsh-compaction*`，设计已按「不假设免疫」处理）；B5 配置传播方式；B7 子智能体判定谓词（v1.2 已升为 M3 硬前置）；B8 fork 轮号；B10 渲染层对未知 `source.kind` 的处理；本地 linked bundle 的裸包名解析（M1 验收项）。
