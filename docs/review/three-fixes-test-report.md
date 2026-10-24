# 三项修复与卸载快照竞态的独立回归报告

| 项 | 值 |
| --- | --- |
| 任务 | task-15 独立回归三项修复和卸载快照竞态（**未安装插件**） |
| 被测对象 | `D:\MyTools\Test\dsh-ami\`（task-14 修复后：`index.js` 254 行、`lib/logic.js` 121 行、`README.md` 151 行、`package.json` 33 行） |
| 修复项 | ① `ctx.get('agents')` 服务访问 ② active/generation + alive 卸载闸门 ③ `fs.readBytes` 硬预算 + 严格 UTF8/NUL 校验 + 版本缓存 |
| 运行时 | bundled Node `v24.21.0` |
| 执行规模 | **59 个用例全部通过**（服务代理+快照 16/16、readBytes 预算 17/17、loadDeps 闸门 2/2、回归 full 12/12、回归 fallback 12/12）+ `node --check` 两项 exit 0 |
| 结论 | **三项修复全部「已生效」**；**未发现阻塞级缺陷**；6 项非阻塞观察 |

## 0. 判定总览

| 修复 | 判定 | 关键证据（类型） |
| --- | --- | --- |
| ① `ctx.get('agents')` 服务访问 | **已生效** | S0a：`ctx.agents` 抛错 getter 下 getter 调用 **0** 次、`ctx.get('agents')` 正常、主 agent 注册成功（实测）；`index.js` L43 静态核对（静态） |
| ② 卸载闸门（旧 created 快照） | **已生效** | S1：前序 listener 挂起 → 卸载 → 旧快照恢复后 preStep **0**，控制组证明 agent fiber 仍 active（实测） |
| ② 卸载闸门（在途 pre-step） | **已生效** | S2/S3/S5/S9/S10/S11：resolve / stat / readBytes / next 五个挂起点 + agent 单独 dispose 全部 decision 原样不追加（实测） |
| ② 卸载闸门（buildMessage 窗口） | **已生效** | S4a/S4b：构造窗口内卸载 → 构造后检查拦截（实测） |
| ② 卸载闸门（loadDeps 初始化） | **已生效** | S8：`loadDeps` 挂起期间卸载 → 恢复后零注册零告警（实测，独立进程） |
| ③ `readBytes` 硬预算 | **已生效** | B1–B6：size 缺失/伪小仍传精确 cap；cap+1 与 `FS_TOO_LARGE` 均挡为 source-oversize 且不缓存；恰好 cap 允许（实测） |
| ③ 严格文本校验 | **已生效** | B7 无效 UTF-8 / B8 NUL → read-error；B9 多字节 UTF-8 通过（实测） |
| ③ 版本缓存 | **已生效** | B10 targetKey+version 命中不重读；B10b version 变化重读；B11 读后变更不缓存（实测） |
| ③ signal 透传 | **已生效** | B12：resolve/stat/stat#2/readBytes 收到同一 signal（实测） |
| 回归（N1/N2/N10、volatile、reject/spread、默认排子 agent、失败重试） | **无回归** | R1–R12 full 与 fallback 双模式 12/12（实测） |

---

## 1. 测试方案（必读）

### 1.1 命令

```powershell
$node = 'C:\Users\15068\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node tests\run-service-snapshot.mjs                     # 服务代理 + 快照竞态 16/16
& $node tests\run-budget.mjs                              # readBytes 预算矩阵 17/17
& $node tests\run-depsgate.mjs                            # loadDeps 初始化闸门 2/2（独立进程）
& $node tests\run-regress.mjs                             # 回归 12/12（full）
$env:DSH_TEST_MODE='fallback'; & $node tests\run-regress.mjs   # 回归 12/12（fallback）
& $node --check dsh-ami\index.js
& $node --check dsh-ami\lib\logic.js
```

工作目录 `D:\MyTools\Test`。loader 仍映射**真实** `@deepseek-ai/schemastery`（profile v3.18.5）与 `@deepseek-ai/cosmokit`（v1.8.6），仅 stub `@deepseek-ai/dsh-llm`（同步工厂，附可选同步钩子）与 `@deepseek-ai/dsh-home-paths`。

### 1.2 派发快照 mock 的保真依据（对齐真实 Cordis 源码）

`tests/cordis-mock.mjs` 逐条对齐 `asar:.../@deepseek-ai/cordis/lib/index.js`：

| mock 行为 | Cordis 源码 | 行号 |
| --- | --- | --- |
| 派发时对回调做**快照数组** | `dispatch()` = `(_hooks[name]\|\|[]).filter(...).map(hook => hook.callback.bind(thisArg))` | L258-L264 |
| `serial` 遍历快照，`await` 每个回调 | `for (const cb of this.dispatch("serial", args)) { await cb(...args); }` | L289-L294 |
| `waterfall` 用快照 + `shift()` 推进 `next` | `const cbs = this.dispatch(...); const next = () => (cbs.shift() ?? inner)(...args)` | L317-L325 |
| `off` 只从注册表 splice，**不动在途快照** | `register()` 推入 `hooks`；`unregister()` 只 `hooks.splice(index, 1)` | L335-L359 |
| fiber 已 dispose 后再 `on/effect` 抛 `INACTIVE_EFFECT` | `on()` 首行 `this.ctx.fiber.assertActive()` | L373 |

这正是「off 只删除 hooks 而不删除派发 callbacks」的语义：**卸载后旧回调仍会执行**，所以闸门是唯一防线。S1 额外提供**控制组**证明该场景有区分力（卸载后 agent fiber 仍 active，直接 `agent.ctx.effect(...)` 可以成功注册 → 无闸门必然泄漏）。

### 1.3 服务代理 mock

`ctx.agents` 定义为**抛错 getter**（访问即抛），服务只经 `ctx.get('agents')` 返回；`ctx.get('fs')` 同理。这比真实 Cordis 更严格（真实两者都可用），用于证明修复未走属性路径。S0a 实测 getter 调用 **0** 次。

### 1.4 修复的 fs 契约已对真实后端核实（静态）

| 修复调用（index.js） | 真实后端签名 | 证据 |
| --- | --- | --- |
| `fs.resolve(path, { signal })` L104 | `async resolve(path, opts)`，读 `opts.signal` / `opts.cwd` | `dsh-fs-local/lib/index.js` L780-L788 |
| `fs.stat(target, signal)` L107/L123 | `async stat(target, signal)` 位置参数 | 同文件 L802-L812 |
| `fs.readBytes(target, signal, limit)` L117 | `async readBytes(target, signal, maxBytes)` 位置参数 | 同文件 L837-L842 |
| `error.code === "FS_TOO_LARGE"` L134 | `readWholeBytes` 在 `info.size > maxBytes` 与流式 `bytes > maxBytes` 时抛 `FsError(..., "FS_TOO_LARGE")`；`FsError.code` 为实例字段 | 同文件 L387-L409、L34-L39 |
| NUL 采样 8192 B L89 | `const BINARY_SAMPLE_BYTES = 8192`；`readWholeText` 用 `raw.subarray(0, BINARY_SAMPLE_BYTES).includes(0)` | 同文件 L97、L369-L375 |
| `bytes instanceof Uint8Array` L120 | `readWholeBytes` 返回 `Buffer.concat(...)`（Buffer 是 Uint8Array 子类） | 同文件 L408 |
| 沙箱后端兼容 | `SandboxedFileSystem extends LocalFileSystem`，只覆写 write/edit，**未覆写 `readBytes`** | `dsh-fs-sandbox/lib/index.js` L103、L125-L166 |

⇒ 修复的 fs 调用签名与语义**与真实后端逐字一致**，不是猜测。

---

## 2. 修复 ①：`ctx.get('agents')` 服务访问

命令：`& $node tests\run-service-snapshot.mjs`。类型：**实测**。

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| S0a | `ctx.agents` 抛错 getter + `ctx.get('agents')` 返回含该 agent 的 roots → 派发 `agent/created` | `preStep=1`；`ctx.agents` getter 调用 **0** 次；`ctx.get` 调用序列含 `agents` | 已生效 |
| S0b | 服务可用但 roots 不含该 agent | `preStep=0`；业务告警 0（普通非主 agent 静默） | 已生效 |
| S0c | `ctx.get('agents')` 返回 undefined | `preStep=0`；1 条 `agents-md-inject: agents service unavailable, injection disabled` | 已生效 |
| S0d | 服务存在但 `roots()` 抛错 | `preStep=0`；1 条告警；**未抛出** | 已生效 |
| S0e | `includeSubagents:true` 且服务缺失 | `preStep=1`（显式 opt-in 逃生通道保留）；告警 0 | 已生效 |

静态核对：`index.js` L41-L47 `probePrimaryAgent` 内仅 `ctx.get("agents")`，全文件无 `ctx.agents` 属性访问（R11 禁令扫描同时覆盖）。

---

## 3. 修复 ②：卸载闸门（旧 created 快照 / 在途 pre-step）

命令：`& $node tests\run-service-snapshot.mjs`、`& $node tests\run-depsgate.mjs`。类型：**实测**。

### 3.1 旧 created 快照

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| S1 | 快照含 [前序 listener, 插件 listener]；前序 listener 在 gate 上挂起 → 卸载插件（`off` 只移除注册表项，快照仍有 2 个回调）→ 释放 gate → 旧快照执行插件 listener | 插件 listener 恢复后 `preStep=0`（**未复活注册**）；`pluginScope.count("agent/created")===1` 证明 off 只删注册表；agent fiber 仍 active；告警 **0** | 已生效 |
| S1 控制组 | 卸载后直接 `agent.ctx.effect(() => agent.ctx.on("agent/pre-step", ...))` | 注册成功（计数 1）→ 证明该场景若无闸门必然泄漏，用例有区分力 | 通过 |

### 3.2 在途 pre-step（五个 await 挂起点 + agent 单独释放）

| 用例 | 挂起点 | 卸载方式 | 观察结果 | 判定 |
| --- | --- | --- | --- | --- |
| S9 | `fs.resolve()` | 插件卸载 | decision `messages=1`（M0 引用不变）、`startsRequestSeries` 保留、`preStep=0` | 已生效 |
| S10 | 首次 `fs.stat()` | 插件卸载 | 同上 | 已生效 |
| S2 | `fs.readBytes()` | 插件卸载 | 同上；`readBytes` 已进入 1 次 | 已生效 |
| S11 | 读后 `fs.stat()` | 插件卸载 | 同上 | 已生效 |
| S3 | 下游 `next()` | 插件卸载 | 同上 | 已生效 |
| S5 | `fs.readBytes()` | **仅 `agent.ctx` effect dispose** | 同上 | 已生效 |

### 3.3 buildMessage 窗口与初始化窗口

| 用例 | 执行方式 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| S4a | 真实 `createUserMessage`（同步）内同步钩子调用 `agent.ctx.disposers[0]()` | 构造后检查拦截 → `messages=1`、`preStep=0` | 已生效 |
| S4b | 同步钩子内卸载插件 | 同上 | 已生效 |
| S8 | stub 模块顶层 `await` 闸门使 `loadDeps()` 停在 pending；`agent/created` 在 L236 `await loadDeps()` 挂起 → 卸载 → 释放闸门 | 恢复后 `preStep=0`、业务告警 **0**（L237 闸门早返回）；独立进程运行 | 已生效 |
| S8b | 闸门释放后新作用域正常 `agent/created` | `preStep=1`（初始化未被破坏） | 已生效 |
| S6 | 插件卸载后新 agent 派发 `agent/created` | `preStep=0`；原 agent 的监听器也被释放（1→0） | 已生效 |
| S7 | 卸载后在新作用域重新 `apply` | 新 agent `preStep=1`、告警 0（两次 apply 的 generation 相互独立） | 已生效 |

### 3.4 闸门覆盖的静态核对（**静态**）

`index.js` 全部 `await` 点之后均有 `isCurrent()` 检查：`readAgentsMd` L97→L98、L104→L105、L107→L108、L117→L118、L123→L124；`buildMessage` L140→L141；created handler L236→L237；pre-step handler L165→L166、L182→L183、L189→L190/L195、L196→L197、L198→L200。**无遗漏的 await 点**。`alive`（per-agent）与 `active/generation`（插件级）两级闸门分别覆盖 agent 单独释放与插件卸载。

---

## 4. 修复 ③：`readBytes` 硬预算 / 严格解码 / 缓存 / signal

命令：`& $node tests\run-budget.mjs`（`maxSourceBytes = 64`）。类型：**实测**。

| 用例 | 场景 | 观察结果 | 判定 |
| --- | --- | --- | --- |
| B1 | `stat.size` 缺失 | `readBytes.limit === 64`（精确 cap）；正常注入 | 已生效 |
| B2 | `stat.size` 伪小（谎报 4 B，实际 40 B） | `readBytes.limit === 64`（**不信任 size**）；正常注入 | 已生效 |
| B3 | 坏 provider 返回 cap+1（65 B） | 挡为 `source-oversize`（W2）；`readBytes` 第二次仍被调用 → **未写缓存** | 已生效 |
| B4 | provider 抛 `FS_TOO_LARGE` | 归类 `source-oversize`（W2）；不缓存（下轮重读） | 已生效 |
| B5 | 内容恰好 = cap（64 B） | 允许并注入 | 已生效 |
| B6 | `info.size > cap` | `readBytes` **0 次**（不读入内容）→ W2 | 已生效 |
| B7 | 无效 UTF-8（0xFF 0xFE 0xFD） | `read-error`（W3） | 已生效 |
| B8 | 前 8192 B 含 NUL | `read-error`（W3） | 已生效 |
| B9 | 多字节有效 UTF-8「你好世界」 | 注入文本含原文 | 已生效 |
| B10 | targetKey + version 相同 | 两次命中 `readBytes` 仅 **1** 次，两次都注入 | 已生效 |
| B10b | version 变化（v1→v2） | `readBytes` **2** 次 | 已生效 |
| B11 | 读后版本变更（v1→v2） | `read-error`（W3）且 `readBytes` 2 次 → **不写缓存** | 已生效 |
| B12 | signal 透传 | `resolve(path,{signal})`、`stat`、`stat#2`、`readBytes` 四处收到**同一 signal 对象** | 已生效 |
| B13 | `maxSourceBytes = 0` | 拒绝为 `read-error`，`resolve` 0 次（不进入读盘） | 已生效 |
| B14 | provider 返回非 Uint8Array | `read-error` | 已生效 |
| B15 | `info.type = "directory"` | 等同 missing，`readBytes` 0 次 | 已生效 |
| B16 | 偏移 9000 处有 NUL | 未被拒绝（8192 B 采样窗口之外）→ 与后端 `readWholeText` 语义一致 | 观察 |

---

## 5. 回归（N1/N2/N10、volatile、reject/spread、子 agent、失败重试、静态）

命令：`& $node tests\run-regress.mjs`（full 与 fallback 各 12/12）。类型：**实测**。

| 用例 | 内容 | 观察结果 |
| --- | --- | --- |
| R1 | 纯逻辑命中序列 | N=1 → 2/3/4/5；N=2 → 3/5/7；N=10 → 11/21/31；turn 1 永不命中 |
| R2/R3/R4 | 框架层逐轮驱动 | N=2 → `[3,5,7]`；N=1 → `[2,3,4,5]`；N=10 → `[11,21,31]` |
| R5 | volatile 解包 | 真实 `createVolatile(3)` 与裸 `3` 均为 `[4,7]` |
| R6 | reject 早返回 | 返回 `{kind:"reject"}`，无 TypeError |
| R7 | spread 保真 | `startsRequestSeries` / `extra` 保留，注入在尾部（`source.kind=agents-md-periodic-inject`） |
| R8 | 子 agent 默认排除 | 默认 `preStep=0` 且静默；`includeSubagents:true` → `preStep=1` |
| R9 | 失败后下周期重试 | turn 3 失败 → 同 turn 不重读（`readBytes=1`）→ turn 5 重试成功（`readBytes=2`、注入）；W3 节流 1 条 |
| R10 | 双水位线纯逻辑 | 失败只推进 `attemptedTurn`，`lastInjectedTurn` 保持 -1 |
| R11 | 禁令扫描（**静态**） | 0 命中；`lib/logic.js` 零 import；事件集合 = `{agent/created, agent/pre-step}`；具名导出仍 18 个 |
| R12 | JSON 与打包（**静态**） | `package.json` / 两个 locale 合法；`files` 覆盖全部 7 个运行时文件 |
| 语法（**实测**） | `node --check` | `index.js` exit 0、`lib/logic.js` exit 0 |

README 同步（**静态**）：L65 写明 `readBytes(target, signal, maxSourceBytes)` inclusive 上限与 `FS_TOO_LARGE`、恰好等于上限允许、NUL 采样与严格 UTF-8、缓存绑定 targetKey+version；L72/L73 写明 `ctx.get("agents")` 与服务缺失告警；L86 写明 active/generation 闸门与 agent effect 单独释放；偏差记录第 5 条不再写死行数（与 254 行现状不冲突）。

---

## 6. 缺陷与观察

### 6.1 阻塞级缺陷

**无。** 三项修复均实测生效，59 个用例全部通过，未发现修复引入的回归。

### 6.2 非阻塞观察

| # | 观察 | 证据 | 影响 |
| --- | --- | --- | --- |
| O1 | `readBytes` 是 **backend 实现方法**而非 `FileSystem` 抽象基类声明的方法（基类 L58-L96 只声明 `watch`/`sandboxMode`/`processPathFromHostPath`）。若将来换用非 `LocalFileSystem` 派生的 fs 后端且未实现 `readBytes`，插件会静默退化为 `read-error`（告警可见但原因不明） | 静态：`dsh-fs` L58-L96 vs `dsh-fs-local` L837-L842；当前部署链已核实（`SandboxedFileSystem extends LocalFileSystem`，未覆写 `readBytes`） | 低。当前部署无风险 |
| O2 | 每次 fresh read 触发 **3 次 stat**（修复的前置 stat + `readWholeBytes` 内部 `statRegularFile` + 修复的读后 stat） | 静态：`index.js` L107/L123 + `dsh-fs-local` L388 | 极低（命中轮才发生） |
| O3 | `decodeSource` 抛的是 `new Error("binary source")`，丢失了后端 `FsError` 携带的 `displayPath` 与 `FS_NOT_TEXT` 码，W3 告警无法区分「二进制」与「UTF-8 非法」 | 静态：`index.js` L88-L91 vs `dsh-fs-local` L329/L373 | 低。可诊断性损失 |
| O4 | NUL 采样窗口为前 8192 B，窗口外的 NUL 不拒绝 | 实测 B16；与后端 `readWholeText` 完全一致 | 无（有意对齐后端语义） |
| O5 | `deps.createUserMessage` 若返回 `undefined`（而非 `null`），L197 的 `message === null` 不会拦截，会把 `undefined` 推入 `decision.messages` | 静态：`index.js` L197 | 极低。真实工厂恒返回冻结对象 |
| O6 | 卸载闸门阻止注入但不中断底层 IO：`fs.readBytes` 在途时卸载，底层读会继续到完成再被丢弃 | 实测 S2/S5/S11（decision 正确、无迟到注入） | 无功能影响，仅浪费一次读 |

---

## 7. 未能测试清单

| # | 未能测试内容 | 原因 |
| --- | --- | --- |
| N1 | 真实 DSH 运行时安装态端到端（`Config.listConfigs` 的 `schema` 状态、真实 `agent/created` / `agent/pre-step` 派发） | 严禁安装、不改 profile、无法启动第二个 DSH 运行时 |
| N2 | 真实 `dsh-fs-local` 在真实文件系统上的读行为（含真实 `FS_TOO_LARGE` 流式探测） | 本次为契约级 mock + 源码核实（1.4 节）；未跑真实后端 |
| N3 | 真实 Cordis 实例上的快照派发 | 本次用逐行对齐 `dispatch/serial/waterfall/register` 的 mock；未在真实 Cordis 上复现 |
| N4 | 真实 `ctx.agents.roots()` 的并发可见性（U6） | 需真实 AgentRegistry 与并发创建 |
| N5 | linked 安装下裸包名能否被运行时拦截命中（M1/U2） | 需真实安装 |
| N6 | 设置表单（U5）、压缩（U3）、fork/resume（B8/B9）、渲染层未知 `source.kind`（B10） | 需真实会话与 Web UI |

---

## 8. 临时文件清理

全部测试产物位于 `tests/`，任务结束前已核对绝对路径并**整体删除**：

- `tests/run-service-snapshot.mjs`、`tests/run-budget.mjs`、`tests/run-depsgate.mjs`、`tests/run-regress.mjs`
- `tests/cordis-mock.mjs`、`tests/fs-mock.mjs`、`tests/util.mjs`、`tests/loader.mjs`
- `tests/stubs/dsh-llm.mjs`、`tests/stubs/dsh-home-paths.mjs`
- `tests/` 目录本身

未创建 `node_modules`、未写入 `$DSH_HOME`、未修改 `dsh-ami/` 与 `docs/design`、`docs/research`。本次唯一新增持久文件为本报告。
