# 定向回归测试报告：task-12 收尾修订

| 项 | 值 |
| --- | --- |
| 任务 | task-13 收尾修订的定向回归测试（**未安装插件**） |
| 被测对象 | `D:\MyTools\Test\dsh-ami\`（task-12 修订后：`index.js` 190 行、`package.json` 33 行、`README.md` 151 行、`lib/logic.js` 未变 121 行） |
| 对照 | [test-report.md](test-report.md)（task-10 原始 128 用例）、[code-review.md](code-review.md)（task-11 发现 A-3 / M-1 / M-2 / M-3 / I-1 / I-2 / I-3 / I-4 / I-5 / I-6） |
| 运行时 | bundled Node `v24.21.0` |
| 执行规模 | **59 个用例全部通过**（R1 full 15/15、R1 fallback 16/16、R2 full 14/14、R2 fallback 14/14）+ 2 项 `node --check` exit 0 |
| 结论摘要 | **R1 五项修订全部「已生效」**；**R2 十项无回归**；**未发现 task-12 引入的新回归**；2 项既有行为观察（非本轮引入） |

## 0. 判定总览

| R1 修订项 | 判定 | 关键证据 |
| --- | --- | --- |
| I-3 `logger.warn` 抛错不逃逸 | **已生效** | R1.1a/R1.1b：`emit` 未 reject、logger 被调用 2 次后静默；R1.1c：正常路径不受影响；R1.1d：降级诊断路径无 `unhandledRejection` |
| I-1 谓词惰性求值 | **已生效** | R1.2a：`includeSubagents:true` + `roots()` 抛错 → 仍注册且 `rootsCalls=0`；R1.2b：`false` + 抛错 → 不注册 + 1 条告警 |
| I-2 服务缺失告警 | **已生效** | R1.3a/R1.3b：不注册 + 1 条 `agents service unavailable`；R1.3c：真子智能体静默 0 告警 |
| M-2 `package.json` 依赖声明 | **已生效** | R1.4：`dependencies` / `peerDependencies` 齐全，`files`/`exports`/`dsh.bundle.patch` 未破坏 |
| M-1/M-3/I-5/I-6 README | **已生效** | R1.5a/R1.5b/R1.5c/R1.5d 全部命中且数值准确 |
| （附加）I-4 降级诊断保留错误 | **已生效** | R1.4b：`home-fallback` 告警携带解析错误对象、按 key 节流；R1.4c：全依赖可用时 0 误报 |

| R2 回归项 | 结果 |
| --- | --- |
| 6 命中序列 / 7 `enabled:false` 零注册 / 8 volatile 解包 / 9 reject 早返回 / 10 spread 保真 / 11 双水位线 / 12 卸载清理 / 13 两级降级 / 14 语法与 JSON / 15 禁令扫描 | **10/10 通过（full 与 fallback 双模式）** |

---

## 1. 测试方案（必须先读）

### 1.1 命令

```powershell
$node = 'C:\Users\15068\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node tests\run-r1.mjs                                     # R1 full
$env:DSH_TEST_MODE='fallback'; & $node tests\run-r1.mjs      # R1 fallback
& $node tests\run-r2.mjs                                     # R2 full
$env:DSH_TEST_MODE='fallback'; & $node tests\run-r2.mjs      # R2 fallback
& $node --check dsh-ami\index.js
& $node --check dsh-ami\lib\logic.js
```

工作目录 `D:\MyTools\Test`。与 task-10 相同的 `module.register()` 解析钩子方案（`tests/loader.mjs`）：

| 包 | full | fallback |
| --- | --- | --- |
| `@deepseek-ai/schemastery` | 真实 profile 包 v3.18.5 | 真实 profile 包 v3.18.5（静态 import 必须成功） |
| `@deepseek-ai/cosmokit` | 真实 profile 包 v1.8.6 | 对工作区导入方抛错 → 走 `fallbackIsVolatile` |
| `@deepseek-ai/dsh-llm` | `tests/stubs/dsh-llm.mjs` | 抛错 → 走手动构造 + `build-fallback` |
| `@deepseek-ai/dsh-home-paths` | `tests/stubs/dsh-home-paths.mjs` | 抛错 → 走 `fallbackHome` + `home-fallback` |

假 ctx/agent/fs 由 `tests/harness.mjs` 提供（`on`/`effect`/`get`/`logger`/`agents.roots`），`pre-step` 按 waterfall 语义直接调用 `handler(payload, next)`。诊断类告警（`createUserMessage unavailable` / `dsh-home-paths unavailable`）用 `businessWarns()` 过滤，避免把 I-4 新增的诊断告警误判为业务回归。未安装插件、未改 profile、未写 `$DSH_HOME`。

### 1.2 I-3 的对抗构造

`throwingLogger = { calls, warn() { calls += 1; throw new Error("logger-boom"); } }` 替换 `ctx.logger`。若监听器 reject，`await ctx.emit("agent/created", …)` 会抛出使用例失败；因此「用例通过」等价于「async 监听器未 reject」。

---

## 2. R1 修订项逐条实测

### R1.1 I-3：catch 二次保护（task-11 探针 A-3 逃逸路径）

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.1a | 删除 `ctx.agents` + 抛错 logger → `emit("agent/created")` | **未 reject**；`logger.calls=2`（`agents-unavailable` 一次 + `agent-created-handler` 一次，两次都被吞）；二次 emit 不再调用 logger（节流键已置位） | 已生效 |
| R1.1b | `ctx.agents.roots()` 抛错 + 抛错 logger | **未 reject**；`logger.calls=2`；不注册 | 已生效 |
| R1.1c | `roots=[agent]`（正常注册）+ 抛错 logger | `preStep=1`；`agent/created` 路径 `logger.calls` 增量 **0** | 已生效 |
| R1.1d（fallback） | 抛错 logger + `dsh-home-paths` 不可解析 → `reportDegradations` 内部告警 | `process.on('unhandledRejection')` 捕获数 **0**；`emit` 正常 | 已生效 |

结论：`index.js` L180 的内层 `try { warnOnce(...) } catch {}` 确实封堵了 A-3 描述的逃逸路径；`reportDegradations` 的 try/catch（L60-L62）同样生效。

### R1.2 I-1：谓词惰性求值

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.2a | `includeSubagents:true` + `roots()` 计数并抛错 | `preStep=1`（**仍注册**）；`rootsCalls=0`（**未调用谓词**）；业务告警 0 | 已生效 |
| R1.2b | `includeSubagents:false` + `roots()` 抛错 | `preStep=0`；1 条 `agents-md-inject: agents service unavailable, injection disabled`；二次 emit 不再告警；**未抛错** | 已生效 |

结论：`index.js` L172 的三元短路保证 all-agents 分支不触达 `probePrimaryAgent`，逃生通道成立。

### R1.3 I-2：服务缺失不再静默

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.3a | `delete ctx.agents` | `preStep=0`；**1 条明确告警**（不再是静默 no-op） | 已生效 |
| R1.3b | `ctx.agents = {}`（`roots` 非函数） | `preStep=0`；1 条同款告警 | 已生效 |
| R1.3c | `roots=[parent]`、事件为 child（真子智能体） | `preStep=0`；业务告警 **0**（正常路径保持静默） | 已生效 |

### R1.4 M-2：package.json

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.4 | `JSON.parse` + 断言 + 递归 glob 覆盖检查 | `dependencies["@deepseek-ai/schemastery"]="~3.18.5"`；`peerDependencies` = `cosmokit` / `dsh-home-paths` / `dsh-llm` 三包齐全；`exports["."]`/`["./icon"]`/`["./locale/*.json"]`、`dsh.bundle.patch`、`type:"module"` 均未变；`files` 覆盖全部 7 个运行时文件（`uncovered=[]`） | 已生效 |
| R1.4c（full） | 全依赖可用时 apply + settle | `ctx.warns === []`（**无降级告警误报**） | 已生效 |
| R1.4b（fallback） | `dsh-home-paths` 不可解析 | 1 条 `agents-md-inject: dsh-home-paths unavailable, falling back to $DSH_HOME or ~/.dsh` + `Error(TEST-STUB: …)`；按 key 节流仅 1 条（I-4 生效） | 已生效 |

### R1.5 M-1 / M-3 / I-5 / I-6：README

| 用例 | 断言内容 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.5a | U2 风险声明准确性 | 命中 `schemastery`、`静态 import`、`只保护上述三个包`、`ERR_MODULE_NOT_FOUND`、`安装后必须实测`、`status === "schema"`、`会直接加载失败` 共 7 个关键声明 | 已生效 |
| R1.5b | 第 5 条偏差（行数） | README 声明 `190 行` / `160 行上限`，且实测 `index.js` **190 行**与声明一致；第 5 条编号存在 | 已生效 |
| R1.5c | 截断上界 | README 含 `maxInjectBytes + 标记长度` 与 `maxInjectBytes + 46`；实测 `TRUNCATION_MARKER` = **46 B**；`planInjection(100 B, maxInjectBytes=10)` 结果 = **56 B = 10 + 46**，说明准确 | 已生效 |
| R1.5d | fallbackHome 优先级差异 | 命中 `fallbackHome()`、`resolveDshHome()`、`显式配置`、`$DSH_HOME`、`~/.dsh`，并写明「兜底不覆盖显式配置 dshHome」 | 已生效 |

### R1 附加观察

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| R1.6 | 无 `fs` 服务（触发 W7）+ 抛错 logger → 驱动一次 pre-step | `preStep` **reject**（turn 失败） | 观察（见 O1） |

---

## 3. R2 既有行为回归（full 与 fallback 均 14/14）

| 项 | 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- | --- |
| 6 | R2.6 | `isHitTurn` / `hitSequence` | N=2→`[3,5,7]`；N=1→`[2,3,4,5]`；N=10→`[11,21,31]`；`turn 1` 永不命中 | 通过 |
| 7 | R2.7 | `enabled:false` + `agent/created` | `preStep=0`、fs 调用 0、`ctx.get` 0、业务告警 0、per-agent effect 0 | 通过 |
| 8 | R2.8a/R2.8b | 真实 `createVolatile(3)` / 裸 `3` | 两者均为 `2:1 3:1 4:2 5:1 7:2` | 通过 |
| 9 | R2.9 | `next()` 返回 `{kind:'reject'}` | 原样返回、`"messages" in decision === false`、无 TypeError | 通过 |
| 10 | R2.10 | `next()` 带 `startsRequestSeries:true` + `extra` | 字段保留、原消息引用顺序不变、注入在尾部（`source.kind=agents-md-periodic-inject`） | 通过 |
| 11 | R2.11a/R2.11b | 纯逻辑 + 集成（turn 3 读盘失败） | `lastInjectedTurn` 保持 -1；同 turn 不重复读盘（readText 恒 1）；turn 5 重试成功（readText 2、messages 2）；成功后同 turn 不重复；W3 节流 1 条 | 通过 |
| 12 | R2.12 | 调用插件 effect disposer | per-agent 监听 1→0、`agent/created` 订阅解除、后续新建 agent 不再注册 | 通过 |
| 13 | R2.13a/b/c | 截断 / 关截断 / 超源限 | 截断带标记且上界 56 B；`truncateOversize:false` → `inject-oversize`；超 `maxSourceBytes` → `readText=0` + W2 | 通过 |
| 14 | R2.14 + `node --check` | `JSON.parse` 三文件；两个 `.js` 语法检查 | JSON 全部合法、双 locale 键一致；`node --check` 两项 `exit 0` | 通过 |
| 15 | R2.15 | 禁令串扫描 + `logic.js` 零 import + 事件名集合 + 导出数 | 禁令 **0 命中**；`logic.js` 无 `import`/`require`；事件仅 `agent/created`+`agent/pre-step`；具名导出仍 **18 个**（与 README 第 8 条偏差一致） | 通过 |

---

## 4. 新回归评估

**未发现 task-12 引入的新回归。** 判定依据：

1. task-10 的 128 用例中被 R2 覆盖的 10 个方向全部复现通过（上表），且 `lib/logic.js` 逐字未变（121 行、18 个导出不变）。
2. I-1/I-2/I-3 的三处改动都在 `agent/created` 门控层，`agent/pre-step` 注入主链路（L117-L149）逐字未变，R2.9/R2.10/R2.11b/R2.12 证明主链路行为一致。
3. 新增的 `home-fallback` 诊断告警在**全依赖可用时不触发**（R1.4c 实测 `warns=[]`），不污染正常路径。
4. `enabled:false` 仍是最外层短路（L170 在 verdict 计算之前），R2.7 证明零注册零告警未被 I-2 的新告警破坏。

### 4.1 观察项（既有行为，非本轮引入，非阻塞）

| # | 观察 | 证据 | 影响 |
| --- | --- | --- | --- |
| O1 | I-3 只加固了 `agent/created` 的 catch。**`agent/pre-step` 内的告警路径（W1–W5、W7、`build-fallback`）仍未受保护**：`ctx.logger.warn` 抛错会让 pre-step handler reject → turn 失败 | R1.6 实测：无 fs 服务 + 抛错 logger → `preStep` reject | 低。与 task-11 A-3 同级；但 I-3 的承诺文本（README §8「catch 块内的告警自身再包一层」）只覆盖 `agent/created`，若后续想彻底消除该类风险需在 `warnOnce` 内部统一吞掉 logger 异常 |
| O2 | `probePrimaryAgent` 把「`roots()` 抛错」与「服务缺失」合并为 `unavailable`，告警文案统一为 `agents service unavailable, injection disabled`。roots 存在但瞬时抛错时，文案可能误导 | R1.2b 实测：roots 抛错产生的是 `agents service unavailable` 告警 | 低。诊断语义问题，不影响行为 |
| O3 | `reportDegradations` 通过 `loadDeps().then(...)` 异步执行；若插件在依赖解析完成前卸载，`warnOnce` 可能对已 `clear()` 的 `warned` 表再写一次（最多多一条告警） | 静态阅读 `index.js` L164 + L183-L188；R1.1d 证明不会产生 unhandledRejection | 极低 |
| O4 | M-2 的 `dependencies` 声明在 **linked 安装**下不会触发实际安装，`schemastery` 仍依赖运行时解析拦截 —— 即 M-1 的残余风险并未消除，只是被 README 明示 | README §9 L106 已写明；本机无法验证安装器行为（见第 5 节 N2） | 已知并已记录，属「当前唯一不可本地消除风险」 |
| O5 | `peerDependencies` 中 `@deepseek-ai/dsh-llm` / `dsh-home-paths` 使用 `*`，而 `cosmokit` 用 `~1.8.6`（与 profile 实测版本一致）。若安装器对 peer 做解析校验，`*` 不会失败但也不提供约束 | `R1.4` 实测键值；README 第 6 条偏差已解释「宿主提供，磁盘上不存在」 | 极低，设计如此 |

---

## 5. 未能测试清单与原因

| # | 未能测试内容 | 原因 |
| --- | --- | --- |
| N1 | 真实 DSH 进程内端到端：安装后 `Config.listConfigs` 的 `status === "schema"`、真实 `agent/pre-step` 派发、真实 `ctx.agents.roots()` | 严禁安装插件、不改 profile；无法启动第二个 DSH 运行时 |
| N2 | M-2 在真实安装器下的行为：linked 安装是否触发 `dependencies` 安装、`peerDependencies` 是否被解析校验 | 同上；只能在安装后验证（README §9 已把它列为硬验收项） |
| N3 | linked 安装下 `@deepseek-ai/schemastery` 能否被运行时解析拦截命中（M-1 的残余风险本体） | 同上；本次只能验证「解析成功」与「解析失败」两条分支的行为正确性 |
| N4 | 设置表单（U5）、压缩（U3）、fork/resume（B8/B9）、渲染层未知 `source.kind`（B10）、E30 设置传播 | 需真实会话与 Web UI |
| N5 | I-3 在真实 `serial` 派发链上的最终效果（`announce()` 是否成功） | 本次用假 ctx 直接 `await handler(...)`，已验证「监听器不 reject」这一等价充分条件；真实 `serial` 链路无法在无运行时下复现 |

---

## 6. 临时文件清理

全部测试产物位于 `tests/`，任务结束前已**全部删除**：

- `tests/run-r1.mjs`、`tests/run-r2.mjs`、`tests/harness.mjs`、`tests/loader.mjs`
- `tests/stubs/dsh-llm.mjs`、`tests/stubs/dsh-home-paths.mjs`、`tests/stubs/cosmokit-bogus.mjs`
- `tests/` 目录本身

未创建 `node_modules`、未写入 `$DSH_HOME`、未修改 `dsh-ami/` 与 `docs/design`、`docs/research`。本次唯一新增持久文件为本报告。
