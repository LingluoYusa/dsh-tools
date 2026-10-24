# 边界测试报告：dsh-ami

| 项 | 值 |
| --- | --- |
| 任务 | task-10 基于真实代码变更做边界测试（**未安装插件**） |
| 被测对象 | `D:\MyTools\Test\dsh-ami\`（8 个文件，全部读完） |
| 基准文档 | [impl-spec.md](../design/impl-spec.md) v1.0 冻结、[plugin-design.md](../design/plugin-design.md) v1.4（E1–E35）、[impl-prerequisites.md](../research/impl-prerequisites.md)（P1/P2/P3） |
| 测试员 | tester |
| 运行时 | bundled Node `v24.21.0`（`C:\Users\15068\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`） |
| 沙箱 | workspace-write，只写 `docs/review/` 与 `tests/` |
| 结论摘要 | 任务项 **18/18 全部实测通过**；实际执行 **128 个用例 127 通过 1 失败**；**无阻塞级缺陷**；1 项非阻塞规格偏差（`index.js` 175 行 > 规格 160 行上限）；另有 6 项观察/风险 |

## 0. 测试项判定总览

| 组 | 项 | 用例数 | 实测通过 | 实测失败 | 未能测试 |
| --- | --- | --- | --- | --- | --- |
| A 纯逻辑 | 1–5 | 27 | 27 | 0 | 0 |
| B 框架交互 | 6–14 | 29（full）+ 30（fallback）+ 28（bogus） | 全部 | 0 | 0 |
| C 静态契约 | 15–18 | 14 | 13 | 1（`index.js` 行数，属附加规格一致性检查） | 0 |

**任务项层面的「未能测试」= 0**；无法在无 DSH 运行时验证的端到端行为集中列在第 6 节（不计入 18 项，因为它们本就不在 18 项的可测范围内）。

---

## 1. 执行方式与 mock 方案（必须先读）

### 1.1 命令别名（下文逐项引用）

```powershell
$node = 'C:\Users\15068\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# CMD-A    A 组
& $node tests\run-a.mjs

# CMD-B-full / CMD-B-fallback / CMD-B-bogus   B 组三种模式
& $node tests\run-b.mjs
$env:DSH_TEST_MODE='fallback'; & $node tests\run-b.mjs; Remove-Item Env:DSH_TEST_MODE
$env:DSH_TEST_MODE='bogus';    & $node tests\run-b.mjs; Remove-Item Env:DSH_TEST_MODE

# CMD-C    C 组
& $node tests\run-c.mjs

# CMD-CHK  语法检查
& $node --check dsh-ami\index.js
& $node --check dsh-ami\lib\logic.js
```

工作目录固定为 `D:\MyTools\Test`。三种模式都用同一个入口，行为差异只来自 `tests/loader.mjs` 的解析钩子。

### 1.2 方案：`module.register()` 解析钩子 + 真实 profile 包 + 两个 stub

`index.js` 有 1 个静态 import（`@deepseek-ai/schemastery`）与 3 个惰性动态 import（`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/cosmokit`）。工作区解析不到这些包，因此用 `tests/loader.mjs`（`module.register()` 的 `resolve` 钩子，进程级按 specifier 匹配）分流：

| 包 | 处理 | 理由 |
| --- | --- | --- |
| `@deepseek-ai/schemastery` | **指向真实包** `profile:node_modules/@deepseek-ai/schemastery`（v3.18.5） | 静态 import 必须成功；用真包才能验证 `Config` 真实求值、`.volatile()` 与默认值 |
| `@deepseek-ai/cosmokit` | **指向真实包**（v1.8.6），`fallback` 模式下对工作区导入方改为抛错 | 用真包才能验证 `isVolatile` 的真实语义（`Symbol.for` 协议） |
| `@deepseek-ai/dsh-llm` | `tests/stubs/dsh-llm.mjs`（实现 `createUserMessage`：补 `id`/`role` 并冻结）；`nofactory`/`fallback` 模式下改为无该导出或抛错 | 该包只存在于 asar，Node 无法直接加载 |
| `@deepseek-ai/dsh-home-paths` | `tests/stubs/dsh-home-paths.mjs`；`fallback` 模式抛错 | 同上 |

`resolve` 钩子把 profile 包委托给 `nextResolve(specifier, { parentURL: 'file:///C:/Users/15068/.dsh/profiles/desktop/__dsh_test_anchor__.js' })`，即从 profile 根走正常 Node 解析。三种模式：

- **full**：真实 schemastery + 真实 cosmokit + 两个 stub。代表正常安装态。
- **fallback**：真实 schemastery；`dsh-llm` / `dsh-home-paths` / `cosmokit` 对工作区导入方抛错（模拟 README §9 的 M1/U2 linked 安装解析失败）。此时 `index.js` 走 `fallbackIsVolatile` / `fallbackHome` / 手动构造消息三条降级路径。
- **bogus**：真实 schemastery；cosmokit 指向语义不符的桩（`isVolatile` 恒 `false`），用于探明兜底分支的生效边界（观察项 O2）。

`agent/created`、`agent/pre-step`、`ctx.effect`、`ctx.get`、`ctx.logger.warn` 全部由 `tests/harness.mjs` 的假 ctx/agent 承载：`pre-step` 直接取注册的唯一监听器并按 waterfall 语义调用 `handler(payload, next)`，`next` 由用例给出。真实 decision 形态取自 asar 源码：默认 `{ kind: "enter", messages }`、reject 为 `{ kind: "reject" }`（`dsh-agent-loop` L909-L920、L922）。

### 1.3 保真性说明（不夸大的部分）

- 假 ctx 只实现被测代码实际用到的 5 个接口，**不是** Cordis 的真实 scope 实现；`ctx.effect` 的 disposer 语义按「调用即执行返回的清理函数」模拟。
- `agent/pre-step` 的调用点、waterfall 的 `next` 链、`decision` 的字段由真实 asar 源码定形（`dsh-agent-loop` L902-L927、L1043-L1074），但**没有**跑真实 DSH 进程。
- 未安装插件、未改 profile、未写 `$DSH_HOME`。

---

## 2. A 组：纯逻辑单元测试（真实 import，非静态审查）

被测模块 `lib/logic.js` 零 import，直接 `import` 即可（CMD-A）。**27/27 通过**。

### A1 命中序列（任务项 1）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A1a | `CMD-A` → `isHitTurn(t,2)` 扫 t=1..7 | `hits=[3,5,7]`；1/2/4/6 均 false | 通过 |
| A1b | `isHitTurn(t,10)` 扫 t=1..40 | `hits=[11,21,31]` | 通过 |
| A1c | `isHitTurn(t,1)` 扫 t=1..5 | `hits=[2,3,4,5]`；`isHitTurn(1,1)===false` | 通过 |
| A1d | `hitSequence(2,3)/(1,3)/(10,3)` 及非法 count | `[3,5,7]` / `[2,3,4]` / `[11,21,31]`；`hitSequence(2,0)===[]`、`(0,3)===[]`、`(NaN,3)===[]` | 通过 |

证据：实现与冻结式 `(turn-1) % n === 0 && turn > 1` 逐字一致（`lib/logic.js` L35-L39）。

### A2 双水位线（任务项 2）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A2a | `CMD-A` → `shouldInject(3,2,state)` → `markAttempted` → 再判 | 首次 `true`、置位后 `false`；`attemptedTurn=3`、`lastInjectedTurn=-1` | 通过 |
| A2b | `markAttempted` + `markInjected(3,'hash-1')` | `lastInjectedTurn=3`、`lastInjectedHash='hash-1'`；同 turn `false`、turn 5 `true` | 通过 |
| A2c | 模拟失败路径（只 `markAttempted` 不 `markInjected`） | `lastInjectedTurn` 保持 `-1`；同 turn 不重试；turn 4 不命中；**turn 5 重试 `true`** | 通过 |
| A2d | `state` 传 `null` / `undefined` | 按两条水位线 `-1` 处理，命中轮 `true` | 通过 |
| A2e | `markAttempted`/`markInjected` 返回值与 `initialState()` 形状 | 返回同一对象（就地写入）；初始值 `{-1,-1,null}` | 通过 |
| A2f | 集成侧：`CMD-B-full` → B12h | turn 3 读盘失败（readText=1）→ 同 turn 不重复读盘 → turn 5 重试成功注入 → 同 turn 不重复注入，W3 仅 1 条 | 通过 |

### A3 非法输入防御（任务项 3）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A3a | `CMD-A` → n ∈ {0,-1,1.5,NaN,undefined,null,"2",Infinity,-Infinity,{}} × turn ∈ {1,2,3,5,11} | 全部 `false`，无异常（50 组合） | 通过 |
| A3b | turn ∈ {0,-1,2.5,NaN,undefined,null,"3",Infinity,{}} | 全部 `false`，无异常 | 通过 |
| A3c | 非法 n / 非法 turn 下 `shouldInject` | 全部 `false`，无异常 | 通过 |
| A3d | `resolveEveryTurns` 非法值 | `1.5/NaN/undefined/null/"3"/{}/[]/true` → `NaN`；`3 → 3`、`0 → 0`；包装对象 + 谓词 → `3`；谓词返回 false / 非函数 → `NaN` | 通过 |

### A4 两级降级（任务项 4）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A4a | `CMD-A` → `planInjection('a'*100, {maxInjectBytes:10, truncateOversize:true})` | `{action:'inject', reason:'truncated'}`；正文 `"a"*10`（10 B）且 `endsWith(TRUNCATION_MARKER)` | 通过 |
| A4b | 同上但 `truncateOversize:false` | `{action:'skip', text:null, reason:'inject-oversize'}` | 通过 |
| A4c | 常量逐字比对 | `TRUNCATION_MARKER === "\n\n[truncated: content exceeded maxInjectBytes]"` | 通过 |
| A4d | `maxInjectBytes ∈ {0,-1,1.5,NaN,undefined}` | 一律按 `Infinity`：`reason:'ok'` 不截断、不抛错 | 通过 |
| A4e | `config` 为 `undefined` | 不抛错；超长文本 `ok`；`null` 文本 `empty` | 通过 |
| A4f | L2 源文件降级：`CMD-B-full` → B12c | `stat=1`、`readText=0`（**未读入内容**）、返回下游 decision、W2 `agents-md-inject: AGENTS.md exceeds maxSourceBytes` | 通过 |

### A5 边界值（任务项 5）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A5a | `CMD-A` → 内容恰好 16 B / 恰好 12 B（4 个汉字） | 均 `reason:'ok'` 原样返回，不截断 | 通过 |
| A5b | `""` / `"   "` / `"\n\t  "` / `null` / `undefined` / `0` / `{}` | 7 种输入均 `{action:'skip', text:null, reason:'empty'}` | 通过 |
| A5c | `"你"*10`（30 B）截到 10 B | 结果 3 个汉字 = **9 B**，无 `U+FFFD`；经 `planInjection` 后正文仍为 3 个汉字 + 标记 | 通过 |
| A5d | `"😀"*3`（12 B）截到 6 B / 3 B / 12 B | 6 B → `"😀"`（4 B，未切开代理对）；3 B → `""`；12 B → 原样；无替换字符 | 通过 |
| A5e | `truncateToBytes` 非法/边界 | `0/-1/1.5/NaN` → `""`；`Infinity` → 原样；`"abc"@3` → `"abc"`；`@2` → `"ab"`；非字符串 → `""` | 通过 |
| A5f | `utf8Length` | `"你"→3`、`"😀"→4`、`""→0`、`null/undefined/123→0` | 通过 |
| A5g | `buildInstructionText` 两态 | 与 §2.1 公式逐字一致（含 `<system-reminder>` 常量） | 通过 |
| A5h | `warningKey` | `p#v1`、`p#0`、`p#undefined→p#unknown`、`null→p#unknown` | 通过 |

### A6 附加：注册门控纯逻辑（E29/E32/R-2）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| A6 | `CMD-A` → `canRegisterForAgent` 五分支 | `disabled`（enabled 最优先，`config` 为 undefined 亦然）/ `all-agents` / `predicate-not-ready` / `not-primary` / `primary-only` 全部与规格表一致 | 通过 |

---

## 3. B 组：框架交互测试（真实 import index.js 并调用 apply）

**full 29/29、fallback 30/30、bogus 28/28 通过**。下文以 full 模式为主，fallback/bogus 的增量用例单独标注。

### B0 前置：真实求值（CMD-B-full）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B0 | `mod.Config["~standard"].validate({})`（真实 schemastery） | `issues=[]`；8 字段默认值 `[true,1048576,16384,true,true,false,false]` 全部正确；`isVolatile(everyTurns)===true`、`everyTurns.get()===10`；`(11-1) % everyTurns` → `NaN`（E27 事实成立）；`typeof apply === "function"`、`"default" in mod === false` | 通过 |
| B0b | `validate({everyTurns: 0/-1/1.5/1001/"3"})` 与 `validate({enabled:"false"/1})` | 非法 N 全部产生 issues；`N=1` 通过且 `everyTurns.get()===1`；非布尔 `enabled` 被拒（E5/E6） | 通过 |

### B6 主开关（任务项 6）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B6 | `CMD-B-full` → `apply(ctx, {enabled:false})` → 派发 `agent/created` | `agent/pre-step` 监听器 **0**；`fs` 调用总数 **0**；`ctx.get` 调用 **0**；`logger.warn` **0**；per-agent effect **0** —— 零注册零读盘零注入零告警 | 通过 |

### B7 volatile 解包（任务项 7）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B7a | `CMD-B-full` → `everyTurns = cosmokit.createVolatile(3)`（真实包装）→ 驱动 turn 2/3/4/5/7 | 命中序列 `2:1 3:1 4:2 5:1 7:2`（N=3 命中 4/7） | 通过 |
| B7b | 同一流程但 `everyTurns = 3`（裸 number） | 同上 `2:1 3:1 4:2 5:1 7:2` | 通过 |
| B7c | `CMD-B-fallback` → `everyTurns = { get: () => 3 }`（裸包装对象，cosmokit 解析失败） | `2:1 3:1 4:2 5:1 7:2` —— 兜底 duck-type 生效 | 通过 |
| B7d | `CMD-B-full` → `everyTurns = { get: () => 3 }`（真实 cosmokit 在场） | `2:1 3:1 4:1 7:1`、`readText=0` —— **裸 `{get}` 不被真实 `isVolatile` 识别**（见观察 O1） | 通过（观察） |
| B7e | `CMD-B-bogus` → cosmokit 桩 `isVolatile` 恒 `false` | `2:1 3:1 4:1 7:1`、`readText=0`、`warns=0` —— 静默永不注入（见观察 O2） | 通过（观察） |

### B8 reject 场景 E28（任务项 8）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B8 | `CMD-B-full` → 命中轮 turn=2，`next()` 返回 `{kind:'reject'}` | 返回 `{"kind":"reject"}`；`"messages" in decision === false`；**无 TypeError**；`readText=1`；`warns=0` | 通过 |

### B9 spread 保真（任务项 9）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B9 | `next()` 返回 `{kind:'enter', messages:[m0], startsRequestSeries:true, extra:{a:1}}` | 结果 `kind='enter'`、`startsRequestSeries===true`、`extra` 保留、`messages.length===2` | 通过 |

### B10 注入落点（任务项 10）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B10 | `next()` 返回 `[m0, m1]` | `messages.length===3`；`[0]===m0`、`[1]===m1`（引用同一，顺序不变）；注入项 `role='user'`、`source.kind='agents-md-periodic-inject'`、`content[0].type='text'`、文本以 `<system-reminder>` 开头且含源文本、`id` 为非空字符串 | 通过 |
| B10b | 同上但 `wrapSystemReminder:false` | 文本无 `<system-reminder>`，以 `INSTRUCTION_INTRO` 开头 | 通过 |

### B11 序列化中断（任务项 11）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B11a | `CMD-B-full` → `signal.throwIfAborted()` 直接抛 `AbortError` | handler 以 `AbortError` reject（**未被吞掉**）；`next` 未被调用；`readText=0` | 通过 |
| B11b | 信号在第 3 次 `throwIfAborted()`（构建消息之后）抛错 | handler 以 `ABORTED-LATE` reject；`readText=1`；随后同 turn 再调用 → 不补注入、不重复读盘（`attemptedTurn` 已置位） | 通过 |

### B12 失败不中断（任务项 12）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B12a | `CMD-B-full` → `fs.readText` 抛异常 | 返回下游 decision（`messages.length===1`，turn 正常结束）；`warns` 恰 1 条 `agents-md-inject: read failed` | 通过 |
| B12b | `ctx.get('fs')` 返回 `undefined` | 不注入；1 条 `agents-md-inject: fs service unavailable`；不抛错（E18） | 通过 |
| B12c | `info.size > maxSourceBytes` | `stat=1`、`readText=0`；1 条 W2 | 通过 |
| B12d | `fs.stat` 返回 `undefined` | 不注入；1 条 W1 `AGENTS.md not found` | 通过 |
| B12e | `info.type='directory'` | 等同 missing；1 条 W1 | 通过 |
| B12f | 纯空白文件 | `readText=1`；不注入；**0 告警**（`empty` 不告警） | 通过 |
| B12g | 200 B 内容 + `maxInjectBytes:20` | 注入且含截断标记；本路径 0 告警 | 通过 |
| B12h | turn 3 首次读盘失败、turn 5 重试 | 同 turn 不重复读盘；下一命中轮重试成功；成功后同 turn 不重复注入；W3 仅 1 条（按 `path#version` 节流） | 通过 |
| B12i | `CMD-B-fallback` → `createUserMessage` 不可用 | 注入项仍为 `role='user'` + `source.kind` + 非空 `id`；告警 1 条 `createUserMessage unavailable  using manual message construction`（按 key 节流） | 通过 |

### B13 卸载清理（任务项 13）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B13 | `CMD-B-full` → 触发 `ctx.effect` 返回的 disposer | per-agent `agent/pre-step` 监听器 1 → **0**；`agent/created` 订阅解除；disposer 之后新建 agent **不再注册**（`states.clear` + 遍历释放均生效） | 通过 |
| B13b | 单独调用 `agent.ctx.effect` 的 disposer | 该 agent 监听器 → 0；插件未卸载时新 agent 仍正常注册（0 → 1） | 通过 |
| B13c | 同一 agent 二次派发 `agent/created` | 监听器变 **2**（重复注册，见观察 O4）；真实框架每 agent 只 `announce` 一次，不触发 | 通过（观察） |

### B14 主 agent 判定 P1（任务项 14）

| 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B14a | `ctx.agents.roots() = [agent]` | 注册（`preStep=1`），0 告警（reason=`primary-only`） | 通过 |
| B14b | `roots=[parent]`，事件为 child（子智能体） | child 与 parent 均 **0** 注册；**0 告警**（`not-primary` 不告警） | 通过 |
| B14c | 删除 `ctx.agents` | fail-closed 不注册、不抛错、0 告警 | 通过 |
| B14d | `includeSubagents:true` + 子 agent | 子 agent 注册（reason=`all-agents`） | 通过 |
| B14e | `ctx.agents.roots()` 抛错（E33 行为证据） | 不注册；1 条 W8 `agents-md-inject: agent/created handler failed` + 原错误；二次触发不再告警（节流） | 通过 |
| B14f | `roots=[other, agent]`（模拟并发创建） | `includes` 精确匹配：agent 注册、child 不注册 | 通过 |

---

## 4. C 组：静态契约检查（补充，不替代 A/B）

命令 `CMD-C`（13/14 通过）与 `CMD-CHK`（两项 exit 0）。

| 项 | 用例 | 实际执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- | --- |
| 15 | C15 | `CMD-C` → 定位 `ctx.on("agent/created"` 并检查 `=> {` 之后第一条语句即 `try`、`catch (error)` 走 `WARN.created`、注册点唯一 | `try@+96 catch@+517 单处注册 走 WARN.created`；行为证据见 B14e | 通过 |
| 16 | C16 | 扫 `index.js`/`lib/logic.js` 的禁令串：`system-prompt/assemble`、`appendPluginRecord`、`sessionProjections`/`sessionProjection`、`session.append`、`console.`、`agent/status`、`agentsFilePath`；并抽取所有 `.on("…")` 事件名 | 禁令 **0 命中**；监听事件集合 = `["agent/pre-step","agent/created"]`（无自定义 session 事件、无投影注册、无 console） | 通过 |
| 16 | C16b | `lib/logic.js` 检查 `import` / `from "…"` / `require(` | 全部不存在（F12 成立） | 通过 |
| 16 | C16c | 检查 `{ ...decision, messages: [...decision.messages, message] }`、reject 早返回、无 `decision.messages.slice/filter/splice/sort/reverse` | 前两者存在、后者 0 命中（F5/F7/F8 成立） | 通过 |
| 16 | C16d | 检查 pre-step 注册位置 | 仅 `agent.ctx.on("agent/pre-step")` 一处；插件 `ctx` 上无 pre-step（F11 成立） | 通过 |
| 17 | C17a | `JSON.parse` `package.json` / `locale/en.json` / `locale/zh.json` | 3 个文件解析成功，`name=dsh-ami` | 通过 |
| 17 | C17b | 比对两个 locale 的键集合 | `meta.title` + `meta.description`，键集合一致，无模板文案 | 通过 |
| 17 | C17c | `cordis.patch.yml` 结构检查 | `- insert:` + `id` + `name: 'dsh-ami'` + config 8 字段齐全 | 通过 |
| 17 | C17d | `exports` / `dsh.bundle.patch` 指向的文件 | `./index.js`、`./icon.svg`、`./cordis.patch.yml`、两个 locale 均存在 | 通过 |
| 17 | CMD-CHK | `node --check index.js` / `node --check lib\logic.js` | 两项 `exit 0` | 通过 |
| 18 | C18a | 递归列出包内文件并与 `files` 逐项做 glob 匹配（双向） | `runtime=[cordis.patch.yml,icon.svg,index.js,lib/logic.js,locale/en.json,locale/zh.json,README.md]`；`uncovered=[]`、`missing=[]` | 通过 |
| 18 | C18b | `icon.svg` 体积与内容检查 | `bytes=603`（≤ 256 KiB = 262144）；`viewBox="0 0 64 64"`；无 `<script>` / `foreignObject` / `<image>` / 外部 `href` / `url(http…)` / 事件属性 | 通过 |
| 18 | C18c | 提取 `lib/logic.js` 具名导出并与规格 §2.1 比对 | 导出 18 个、缺 0、多 0（规格正文自称「14 个」但 §2.1 实际枚举 18 个，见观察 O6） | 通过 |
| 附加 | C18d-logic | `lib/logic.js` 行数 | 121 行 ≤ 180 | 通过 |
| 附加 | C18d-index | `index.js` 行数 | **175 行 > 160 行上限（超 15 行）** | **失败（非阻塞，见缺陷 D1）** |

---

## 5. 缺陷与观察

### 5.1 阻塞级缺陷

**无。** A/B/C 三组的功能项全部实测通过；未发现会导致插件加载失败、turn 中断、agent 创建失败、静默永不注入（在真实生产形态下）或重复注入的问题。

### 5.2 非阻塞缺陷

| # | 缺陷 | 分级 | 最小复现 | 期望行为 |
| --- | --- | --- | --- | --- |
| D1 | `index.js` 175 行，超过 [impl-spec.md](../design/impl-spec.md) §1 的「`index.js` ≤ 160 行」上限 15 行，且 README「附. 与实现规格的偏差记录」4 条中**未说明**该超限 | 非阻塞（规格允许「超出需在交付报告说明」） | `CMD-C` 的 `C18d-index`，或 `(Get-Content dsh-ami\index.js).Count` → `175` | 或压缩到 ≤160 行，或在 README 偏差记录补一条「index.js 行数超限及原因」 |

### 5.3 观察项（非缺陷，含风险提示）

| # | 观察 | 证据 | 影响评估 |
| --- | --- | --- | --- |
| O1 | 裸 `{ get: () => 3 }` 对象**不被真实** `isVolatile` 识别（真实实现按 `Symbol.for("cosmokit.volatile.write")` 判定，`cosmokit` L83/L116-L118） | `CMD-B-full` 的 B7d：不注入、`readText=0`；`cosmokit.isVolatile({get(){}})` 实测 `false` | **无生产影响**：`config.everyTurns` 由 schemastery 解析为真实 `createVolatile` 包装（B0 实测 `isVolatile===true`），裸 `{get}` 只出现在 fallback 兜底路径（B7c 实测可用） |
| O2 | 兜底 duck-type 仅在**解析失败**时生效；若 `cosmokit` 能被解析但其 `isVolatile` 语义不符（恒 `false`），`resolveEveryTurns` 得到 `NaN` → **静默永不注入且无任何告警** | `CMD-B-bogus` 的 B7e：`2:1 3:1 4:1 7:1`、`readText=0`、`warns=0` | 低风险：真实 cosmokit 用全局 Symbol 跨 ESM/CJS 副本识别（其 JSDoc 明说「Identify references across ESM/CJS copies」），版本偏移不会触发。若要更稳，可在 `resolveEveryTurns` 返回 `NaN` 时按节流键告警一次 |
| O3 | `payload.signal.throwIfAborted()` 在 `payload.signal` 缺失时抛 `TypeError` 并冒泡出 pre-step（`index.js` L110/L124/L135）；代码对 `payload.turn` 有整数防御，对 `signal` 没有 | 静态阅读；`dsh-agent-loop` L909-L913 显示框架固定注入 `signal`，未实测缺失场景 | 低风险：框架契约保证 `signal` 存在；E20 只要求 turn/step 防御 |
| O4 | 同一 agent 重复派发 `agent/created` 会重复注册 pre-step 监听器，且旧 state 的 disposer 被覆盖（`states.set` 覆盖同键） | `CMD-B-full` 的 B13c：监听器 1 → 2 | 低风险：`AgentRegistry.announce` 每 agent 只派发一次；若未来出现重放，会造成一次多余监听 |
| O5 | `index.js` L159 用 `if (!config.enabled)` 真值判断，`logic.js` L116 用 `config?.enabled !== true`；两者对合法布尔 config 一致，对非法值（如 `"false"`）语义不同 | 静态阅读；B0b 实测 schemastery 会拒绝非布尔 `enabled` | 无实际影响（Config 层已拦截） |
| O6 | [impl-spec.md](../design/impl-spec.md) §1 与 §2.1 自称「14 个具名导出」，但 §2.1 实际枚举 5 个常量 + 13 个函数 = 18 个；实现导出全部 18 个 | `CMD-C` 的 C18c：`导出 18 个 缺 0 个 多 0 个` | 规格计数笔误，非代码缺陷 |

### 5.4 与规格一致的确认（正面结论，供 reviewer 引用）

- F1–F17 全部无违反证据：C16 系列扫描 0 命中；F6/F7/F8 有静态 + 行为双证据（C15、B14e、B9、B8）；F12 由 A 组「直接 import 成功」与 C16b 双向确认；F13/F16/F17 0 命中。
- E28（reject 早返回）、E32（`enabled:false` 零注册）、E33（serial 监听器永不抛错）、E35（`states.set` 在 effect 成功之后）均有实测证据。
- 未命中路径零 IO（F14）证据：B7a 中 5 次 pre-step 只有 2 个命中轮触发了 `stat`（`stat=2`、`readText=1`），非命中轮 0 IO。
- 无额外 turn / 模型调用（C13）静态证据：两个 `.js` 中不存在 `inject(` / `followup` / `steer` / `wakeDriver` / `inbox` 的使用（仅命中 `shouldInject` 标识符）。

---

## 6. 未能测试清单与原因

以下项**本次未执行**，不得视为通过：

| # | 未能测试内容 | 原因 | 归属 |
| --- | --- | --- | --- |
| N1 | 真实 DSH 进程内端到端：安装后 `Config.listConfigs` 的 `status === "schema"`、真实 `agent/pre-step` 派发、真实 `ctx.agents.roots()` 语义 | 任务明令**严禁安装插件**、不改 profile；本会话也无法启动第二个 DSH 运行时 | M1 验收 / developer |
| N2 | linked 安装下 `@deepseek-ai/dsh-llm` 等裸包名能否被运行时解析拦截命中（U2 的作用域规则） | 同上；本次用 stub 替代，只能验证「解析成功」与「解析失败」两种分支的行为正确性 | B1/U2 |
| N3 | 设置表单是否出现 `everyTurns`、能否改值并 `applies:"live"` 生效（U5/M2） | 需 Web UI 与已安装插件；本次只验证了 `Config` 的 volatile 元数据（B0） | U5 |
| N4 | 压缩（compaction）是否吞掉注入（U3/E7） | 需真实长会话触发压缩 | U3 |
| N5 | fork 后轮号是否重置（B8）、resume 是否重放同 turn 的 step>1（B9） | 需真实 session 生命周期 | B8/B9 |
| N6 | 渲染层对未知 `source.kind = "agents-md-periodic-inject"` 的处理（B10） | 需真实 Web UI 渲染 | B10 |
| N7 | E30：运行中改设置导致重新 `apply` 后水位线清空、可能多注入一份 | 需真实 `settings.update` 通道 | E30 |
| N8 | `W6 predicate-not-ready` 分支的行为触发 | `index.js` 将 `SUBAGENT_PREDICATE_READY` 硬编码为 `true`（L37，符合 impl-spec §3.5「文档存在时置 true」），该分支**在行为上不可达**；其纯逻辑判定已由 A6 覆盖（`predicate-not-ready` 返回值正确） | E29 |
| N9 | 真实并发创建多个 agent 时 `roots()` 的可见性（U6） | 本次仅用假 `roots()` 模拟了「含多个 agent」与「不含目标 agent」两种情况（B14f/B14b） | U6 |

---

## 7. 临时文件清理

测试产物全部位于 `tests/`，任务结束前已**全部删除**：

- `tests/run-a.mjs`、`tests/run-b.mjs`、`tests/run-c.mjs`、`tests/probe.mjs`、`tests/harness.mjs`、`tests/loader.mjs`
- `tests/stubs/dsh-llm.mjs`、`tests/stubs/dsh-llm-empty.mjs`、`tests/stubs/dsh-home-paths.mjs`、`tests/stubs/cosmokit-bogus.mjs`
- `tests/` 目录本身

未创建 `node_modules`、未写入 `$DSH_HOME`、未修改 `dsh-ami/`、`docs/design/`、`docs/research/`。本报告是本次唯一的持久交付物。
