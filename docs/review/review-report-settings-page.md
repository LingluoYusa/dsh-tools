# dsh-ami 全参数配置页 独立审核报告（task-5）

- 审核者：reviewer（Agent Teams）
- 审核日期：2026-10-20
- 被测修订：工作区 `D:\YhhCode\MyProject\dsh-ami`（`git HEAD` = `b1c951d` + 未提交改动；`git status` 见 §6.1）
- 审核对象：`index.js`、`client.js`、`lib/logic.js`、`package.json`、`locale/*.json`、`cordis.patch.yml`、`README.md`；官方产物只读解析 `D:\DSH\resources\app.asar`
- 方法：**不采信任何文档结论**。每一项先读工作区真实文件行，再对照官方实现真实行；D2 与客户端行为由本会话自跑脚本实测（脚本位于 `%TEMP%\dsh-ami-review\`，交付前已删除）。T1/T2/T4 只用于对照。

## 0. 结论速览

| 核查项 | 结论 | 关键证据 |
| --- | --- | --- |
| 1 需求符合度（8 参数可见可改、挂载点、持久化、bundle 关闭消失） | **通过（运行时未验证）** | `client.js:78-87` 8 字段；`client.js:14,313-319`；官方 `ui-plugin-manager` 行挂载链见 §1 |
| 2 代码正确性（volatile 解包全覆盖、enabled 闸门、生命周期） | **通过** | `index.js:222` 现读；grep `config.` 命中 0；见 §2 |
| 3 D2 复核（两个字节字段上界） | **通过（已修复）** | 自跑真实 schemastery：2**53 被拒、2**53-1 接受；见 §3 |
| 4 与 T1 结论一致性（API 签名、有无臆造） | **通过** | 逐条对照 asar 真实实现；见 §4 |
| 5 边界与失败语义 | **基本通过，1 项重要缺陷** | I-1：写后反馈状态被 revision effect 清除；见 §5、§8 |
| 6 交付完整性（exports/files/dsh.client/locale/README/注释） | **通过** | 见 §6 |
| 7 生效路径与诚实标注 | **通过（生效动作未执行）** | 已安装副本为旧版且无 `client.js`；见 §7 |

- 阻断级缺陷：**0**
- 重要缺陷：**1**（I-1，仅影响成功/失败状态条显示与失败草稿保留，不影响写入本身）
- 建议项：**3**（S-1 T4 报告 D2 段落过期、S-2 locale 中英标题不一致、S-3 工作区多出 IDE 文件）
- 自跑断言：真实 schemastery 24/24 通过；client.js 独立探针 31/31 通过；package.json/locale 结构 10/10 通过。

---

## 1. 需求符合度

### 1.1 8 个参数是否都能被看到并修改 —— 通过（静态 + 伪渲染实测，真实浏览器渲染未验证）

- 字段全集与顺序：`client.js:78-87` 的 `FIELDS` 恰为 8 项（3 个 `number` + 5 个 `boolean`），与 `index.js:27-36` 的 `Config` 逐项同名。
- 自跑 client.js 独立探针（`node` + `node:vm` 捕获 `window.__ModuleLoader__.load` + 自建 React hooks 运行时，非真实浏览器）实测渲染：
  - `PASS c14-eight-controls :: inputs=3 switches=5`
  - `PASS c15-number-constraints`（`everyTurns` 1/1000/1；`maxSourceBytes`/`maxInjectBytes` 1/9007199254740991/1，与真实 `Config` meta 一致）
  - `PASS c19-save-enabled-after-edit`、`PASS c20-mutate-ops-revision :: [{"ops":[{"op":"set","path":["everyTurns"],"value":5}],"rev":3}]`、`PASS c25-reset-8-unset`（8 个 `unset` 路径与 8 字段一致）
- 未验证：真实浏览器 DOM 渲染、中英文案实际显示、主题配色（见 §9）。

### 1.2 页面挂载点与 key —— 通过（严格 `dsh-ami#dsh-ami`）

- 注册：`client.js:307`（`inject`）、`client.js:313-319`（`whileServed(["dsh-ami"])` + `slots.inject("plugins.row.config")` + `slots.register({name, key: ROW_KEY, locale}, ...)`），`ROW_KEY = "dsh-ami#dsh-ami"`（`client.js:14`）。
- 官方槽为 keyed 槽：`ui-plugin-manager/lib/client.js:4444-4447` 声明 `"plugins.row.config": { kind: "keyed", scope: "root" }`。
- key 的匹配规则与拼装：官方 `rowConfigKey(bundle, rowId) => \`${bundle}#${rowId}\``（同文件 `:27-29`），Configure 控件的显示条件为 `ledger.rows.has(rowConfigKey(pkg.name, row.rowId))`（`:3908-3918`），ledger 的 rows 直接取注册项的 `entry.options.key`（`:48,63`）。
- `rowId` 就是 bundle patch 声明的行 id，与 settings 命名空间同值：官方构建行为 `rows.push({ rowId: row.id, ... })`（asar 内 `dsh-plugin-manager` 构建代码，实测二进制检索 `rowId: row.id`），而 `cordis.patch.yml:1-3` 的行 id 为 `dsh-ami`；settings 侧命名空间 = `entry.options.id`（`dsh-settings/lib/index.js:432,443,502`）。三者一致 → key `dsh-ami#dsh-ami` 正确。
- 页面 owner 传 `form` 的条件是 `configurations.some(v => v.ns === id)`，调用 `formFor(openRow.rowId)`（`ui-plugin-manager/lib/client.js:3833-3840`、`:4143`），因此 `rowId = "dsh-ami"` 同时满足 key 与 form 两处匹配。
- 官方 README 原文佐证：`ui-plugin-manager/README.md:73,83`（"keyed by `<package name>#<row id>` … gives that row a **Configure** control … a bundle that is off shows no configure control"）。

### 1.3 写入是否经 `form.mutate` 真正持久化 —— 通过（链路静态核实；端到端未验证）

真实链路逐段核对：

1. `client.js:237` `await form.mutate(ops, state.revision)`（`client.js:251` 复位同）。
2. `form.mutate` 由页面提供：`{ state: form.getSnapshot(), mutate: (ops, revision) => form.mutate(ops, revision) }`（`ui-plugin-manager/lib/client.js:3833-3840`）。
3. 落到 `ConfigFormController.mutate`，`ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision)`，返回 `Promise<boolean>`；`!response.ok` → `recover()` 重读后返回 `false`（`ui-settings/lib/client.js:1165-1182,1184-1188`）。
4. Host：`settings.mutate` → `write`，非 volatile 路径抛 `Config field "X" is not volatile`（`dsh-settings/lib/index.js:507,520`），revision 不符抛 `SettingsConflictError`（`:511`）。
5. `configEditor.edit`：先 `resolveConfig(fiber.runtime, resolved)` 提交活配置（`dsh-config-editor/lib/index.js:82-83`），再 `writeFileAtomic(path, ...)` 原子写 profile patch（`:123`），`reconcileProfilePatches`（`:125`），失败回滚（`:127-128`）；`next` 与继承层深等时删除该行 `config` 键（`:99-104`）。
6. 写后 `this.describe()` 刷新镜像（`dsh-settings/lib/index.js:536`）→ 页面取到新值。

未验证：真实 profile patch 落盘内容、复位后 `config` 键删除、双窗口冲突（见 §9）。

### 1.4 bundle 关闭时页面是否自然消失 —— 通过（机制核实）

- `whileServed(["dsh-ami"], …)` 仅在 Host 服务该命名空间时注册；未服务即不注册（`ui-settings/lib/client.js:1315-1334`）。
- Configure 控件由 ledger 的 `entry.options.key` 集合驱动（`ui-plugin-manager/lib/client.js:48,63,3908-3918`）；browser half 随 Loader 行卸载而消失（`ui-plugin-manager/README.md:83,131`）。
- 双保险：`form === undefined` 或 `status !== "ready"` 时渲染 `unavailable`（`client.js:298-300`），探针 `c12`/`c13` 实测通过。

---

## 2. 代码正确性（volatile 解包逐个核对）

### 2.1 是否还有把 volatile 包装对象当标量的路径 —— 无

`ops_grep`（工作区 `**/*.js`，pattern `resolveEveryTurns|config\.|config\?\.|\bconfig\b`）实测输出：`index.js` 中 `config` 仅 3 处，全部不是字段读取：

```
index.js:218  export function apply(ctx, config) {
index.js:221  // 每次使用点现读并解包 volatile 变更不重挂载 闭包 config 长期有效
index.js:222  const readSettings = () => resolveSettings(config, deps.isVolatile ?? fallbackIsVolatile);
```

`index.js` 的 `config.<field>` / `config?.<field>` 命中 **0**。`lib/logic.js` 的 `config` 只出现在纯函数形参（`:84-86`、`:92`、`:134-136`），调用方传入的都是 `resolveSettings()` 的结果。

### 2.2 全部读取点覆盖（对照 T1 §7 的 11 行 + 2 个新增闸门）

| # | 位置 | 读取方式 | 结论 |
| --- | --- | --- | --- |
| 1 | `index.js:102` | `settings.maxSourceBytes`（形参由 `:168` 传入已解包对象） | 覆盖 |
| 2 | `index.js:142` | `settings.wrapSystemReminder`（`:192` 传入） | 覆盖 |
| 3 | `index.js:165` | `settings.everyTurns`（`:162` 现读） | 覆盖 |
| 4 | `index.js:182` | `settings.onlyIfChanged === true` | 覆盖 |
| 5 | `index.js:236` | `settings.enabled !== true`（`:234` 现读） | 覆盖 |
| 6 | `index.js:238` | `settings.includeSubagents === true` | 覆盖 |
| 7 | `index.js:168` | `readAgentsMd(ctx, settings, …)` | 覆盖（间接触发 1） |
| 8 | `index.js:176` | `planInjection(read.text, settings)` | 覆盖（间接触发 9、10） |
| 9 | `lib/logic.js:85-86` | `config?.maxInjectBytes` | 覆盖（入参已解包） |
| 10 | `lib/logic.js:92` | `config?.truncateOversize === true` | 覆盖（入参已解包） |
| 11 | `lib/logic.js:135` | `config?.enabled !== true` | 覆盖（入参已解包） |
| 12 | `lib/logic.js:136` | `config?.includeSubagents === true` | 覆盖（入参已解包） |
| 新增 | `index.js:164` | pre-step `enabled` 现读闸门 | 覆盖 |
| 新增 | `index.js:240` | `canRegisterForAgent(settings, …)` | 覆盖 |

`resolveEveryTurns` 已从 `index.js:5-8` 的 import 列表移除（`git diff` 可见 `-planInjection, resolveEveryTurns, shouldInject, warningKey,` → `+planInjection, resolveSettings, …`），生产路径不再有旧的单字段解包分支。

### 2.3 每次使用点现读 —— 通过

`index.js:222` 的 `readSettings` 是闭包函数，每次调用都重新 `resolveSettings(config, …)`；两个调用点都在事件回调内部（`:162` pre-step、`:234` agent/created），没有把结果缓存成跨事件常量。`registerForAgent` 收的是函数本身（`:151`、`:245`），不是快照。

### 2.4 `enabled` 闸门 / 失败语义 / 生命周期与清理 —— 未被破坏

- pre-step 闸门：`index.js:163-164`（现读 `settings.enabled !== true` 即 `next()`，已存在 agent 下一命中轮号立即停）。
- `agent/created` 闸门：`index.js:235-236`。
- 失败语义：`readAgentsMd` 全部失败路径仍收敛为 reason 不抛错（`:94-136`）；`buildMessage` 工厂不可用仍手动构造（`:144-146`）；`agent/created` 整体 try/catch（`:232,246-249`）；`warnOnce` 不变（`:78-85`）。
- 生命周期：per-agent effect 的清理仍保留 `alive = false`、`offPre()`、`states.delete(agent)`（`:207-211`）；插件 effect 清理仍递增 `generation`、`offCreated()`、遍历 dispose、清空 `states`/`warned`（`:251-258`）。`git diff` 未触碰这两段。

### 2.5 `resolveSettings` 与真实 volatile 引用联调 —— 通过

自跑脚本用 profile 实测 `@deepseek-ai/cosmokit 1.8.6` 的 `isVolatile` 驱动真实 `Config`：

```
PASS s12-resolveSettings-scalars :: {"enabled":true,"everyTurns":10,"maxSourceBytes":1048576,"maxInjectBytes":16384,...}
PASS s13-cosmokit-isVolatile-detects :: type=object
PASS s14-planInjection-real-settings :: truncated
PASS s15-canRegisterForAgent-real-settings :: {"register":true,"reason":"primary-only"}
```

即 8 个 `{get}` 引用经 `resolveSettings` 后全部是普通标量，`planInjection`/`canRegisterForAgent` 收到的是标量。

---

## 3. D2 复核（两个字节字段的安全整数上界）

### 3.1 代码与文档同步 —— 通过

- `index.js:30-31`：`maxSourceBytes` / `maxInjectBytes` 均已带 `.max(Number.MAX_SAFE_INTEGER)`（`git diff` 可见 `-…min(1).default(1048576),` → `+…min(1).max(Number.MAX_SAFE_INTEGER).default(1048576).volatile(),`）。
- `client.js:81-82`：`min: 1, max: Number.MAX_SAFE_INTEGER, step: 1`，与 `Config` 的 `.step(1).min(1).max(Number.MAX_SAFE_INTEGER)` 逐项一致（探针 `c15` 实测 `max=9007199254740991`）。
- `README.md:68-69` 取值域已写 `1 – Number.MAX_SAFE_INTEGER`；`README.md:77` 已解释原因（`readAgentsMd` 用 `Number.isSafeInteger` 校验，schema 放行 `2**53` 会静默降级为 `read-error`）。

### 3.2 自跑真实 schemastery 校验 —— 通过

命令（`%TEMP%\dsh-ami-review\schema.probe.mjs`）：从工作区 `index.js` 源码抽出真实 `Config`（仅把 2 处裸说明符改写为绝对路径，实测 `INFO rewritten-lines=2`），用 `C:\Users\15068\.dsh\profiles\desktop\node_modules\@deepseek-ai\schemastery`（3.18.5）执行。实际输出：

```
PASS s1-volatile-maxSourceBytes :: meta={"step":1,"min":1,"max":9007199254740991,"default":1048576,"volatile":true}
PASS s1-volatile-maxInjectBytes :: meta={"step":1,"min":1,"max":9007199254740991,"default":16384,"volatile":true}
PASS s2-maxSourceBytes-2pow53-REJECTED :: $.maxSourceBytes expected number <= 9007199254740991 but got 9007199254740992
PASS s3-maxSourceBytes-2pow53minus1-ACCEPTED :: value=9007199254740991
PASS s6-maxInjectBytes-2pow53-REJECTED :: $.maxInjectBytes expected number <= 9007199254740991 but got 9007199254740992
PASS s7-maxInjectBytes-2pow53minus1-ACCEPTED :: value=9007199254740991
PASS s8-maxInjectBytes-MAXplus2-REJECTED
SUMMARY pass=24 fail=0
```

结论：**D2 已真实修复** —— `2**53`（及 `2**53+2`）被 schema 拒绝，`2**53-1` 被接受；8 个字段 `meta.volatile === true`，默认值与 README 表格一致。

---

## 4. 与 T1 结论的一致性（有无臆造 API）

全部 API 以 asar 真实实现为准逐条核对，**未发现臆造或签名不符**：

| `client.js` 用法 | 官方真实签名 | 结论 |
| --- | --- | --- |
| `ctx.locale.bind(ns)` → `t`（`:310`） | `bind(ns) { … t = (key, params) => this.translate(ns, key, params) … }`（`dsh-client-locale/lib/client.js:1414-1422`） | 一致 |
| `ctx.locale.register(ns, { zh, en })` 返回 disposer（`:311`） | `register(ns, localeOrDicts, dict)`，`Object.entries`，返回 disposer（同文件 `:1387-1413`） | 一致 |
| `ctx.slots.inject(name, cb)`（`:313-314`） | 官方四页同一嵌套写法（`ui-settings-agent-loop/lib/client.js:158-165`） | 一致 |
| `ctx.slots.register({ name, key, locale }, Comp)`（`:315-319`） | 官方 README 片段即 `{ name:'plugins.row.config', key:'@acme/dsh-sidebar#sidebar', locale:'acmeSidebar' }`（`ui-plugin-manager/README.md:75-81`）；`main` 槽也使用 `key` 选项（`ui-plugin-manager/lib/client.js:4417-4421`） | 一致 |
| `ctx.configForms.whileServed([NS], register)` 返回 disposer（`:313`） | `whileServed(namespaces, register)`（`ui-settings/lib/client.js:1315-1334`，JSDoc `:1302-1314` 明示"caller owns the returned disposer and wraps it in ctx.effect"） | 一致 |
| `form.state`（`:183,189,230,237`） | 页面 owner 提供 `{ state: form.getSnapshot(), mutate: (ops, revision) => form.mutate(ops, revision) }`（`ui-plugin-manager/lib/client.js:3833-3840`）；快照字段 `{status,value,base,user,revision,writable}`（`ui-settings/lib/client.js:1108-1115,1223-1231`） | 一致 |
| `form.mutate(ops, rev)` 返回 `Promise<boolean>`（`:237,251`） | `mutate` 返回 `enqueue(...)` → `true` / `!ok` 时 `recover()` 后 `false`（同文件 `:1165-1188`） | 一致 |
| `ctx.effect(fn, label)`（`:311,313`） | 官方同形（`ui-settings-agent-loop/lib/client.js:150-165`） | 一致 |
| `inject = ["slots","locale","configForms"]`（`:307`） | 官方 agent-loop 页完全相同三项（`ui-settings-agent-loop/lib/client.js:139-143`） | 一致 |
| `dsh.client.inject` 三个包名 | 与官方 `ui-settings-agent-loop/package.json:29-38` 三项逐字相同 | 一致 |
| 模块形态 `window.__ModuleLoader__.load({ id, factory })`（`:3-5`） | `dsh-client-modules/README.md:34,38`（`<id>/client` 与裸 id 同源） | 一致 |

`client.js` 只 `require("react")`（`:6`），未 require `@deepseek-ai/dsh-client-ui-primitives`；探针 `c31-no-ui-primitives-require` 实测通过。

---

## 5. 边界与失败语义

| 场景 | 代码位置 | 实测/核对 |
| --- | --- | --- |
| 非法/越界输入（0、1.5、1001、空串、非数字、2**53） | `client.js:133-141` 校验 + `:162-163` min/max/step + `:277` 保存禁用 | 探针 `c22`（0 → 显示 `invalidNumber` 且保存禁用）、`c23`（2**53 被 `Number.isSafeInteger` 拦截）、`c24`（2**53-1 放行）；Host 侧 schema 兜底见 §3 |
| Host 拒绝写入（`mutate` 返回 `false`） | `client.js:238-239` | 探针 `c28-mutate-false-shows-failure` 通过（文案 `writeFailed`） |
| `mutate` reject（remote 异常） | `client.js:240-243` | 探针 `c29-mutate-reject-shows-failure` 通过 |
| revision 冲突 | 官方 `SettingsConflictError`（`dsh-settings/lib/index.js:511`）→ `ok:false` → `recover()`（`ui-settings/lib/client.js:1184-1188`） | 链路核对通过；**但反馈状态会被清除，见 I-1** |
| `status !== "ready"`（loading/unavailable） | `client.js:298-300` | 探针 `c13` 通过；`ui-settings` derive 的三种状态见 `:1215-1231` |
| `writable === false` 只读 | `client.js:230`（禁用）+ `:302`（提示） | 探针 `c26`/`c27` 通过 |
| `form === undefined`（命名空间未服务） | `client.js:298-300` | 探针 `c12` 通过 |
| 复位 `unset` 语义 | `client.js:251`（8 个 unset） | 探针 `c25` 通过；Host 侧 `mutate` 用继承层回填（`dsh-settings/lib/index.js:489-499`），深等时删 `config` 键（`dsh-config-editor/lib/index.js:99-104`） |
| 被 home patch / 命令行覆盖 | — | `dsh-config-editor/lib/index.js:122` 会抛错 → `mutate` 返回 `false`；本机是否存在该覆盖**未验证**（§9） |

**重要缺陷 I-1（写后状态反馈被自身 effect 清除，且失败草稿被丢弃）**

- 位置：`client.js:192-199`（revision 变化时 `setStatus("idle"); setMessage(null)`）与 `client.js:232-244`/`:246-258`（写完成后 `setStatus("saved"|"failed")`、失败时 `setMessage(writeFailed)`）。
- 机制：成功写入时 `ConfigFormController.mutate` 内部 `mirror.acceptView(response.value)` 会更新共享镜像并触发页面重渲染（`ui-settings/lib/client.js:1413-1426`），而成功写必然使 revision 递增（`dsh-settings/lib/index.js:428` 按 `raw` 是否变化 `revision + 1`；写后 `:536` 重新 `describe()`）。失败冲突路径同样 `recover()` → `mirror.load()` → revision 变化。新 revision 一进 props，`:193` 的判断成立，effect 在 `setStatus("saved"/"failed")` 之后执行，把状态重置为 `idle`、把 `writeFailed` 文案清空，并 `setDraft(null)` 丢弃草稿。
- 后果：用户几乎看不到「已保存」，冲突/失败时也看不到失败说明；同时与设计 §5.3「失败保留草稿并提示」及 T4 报告 `c12-mutate-false-and-reject :: 草稿保留` 的表述不一致（`docs/design/settings-page-design.md:466-468`、`docs/review/test-report-settings-page.md:284`）。注意设计 §5.2 的骨架 effect 本来只重置 `basedOn`/`draft`（`docs/design/settings-page-design.md:379-383`），实现多加了 `status`/`message` 两行。
- 影响面：**不影响写入是否成功**（值已持久化、页面也会刷新为最新值），只影响反馈与草稿保留；且本会话无浏览器，未做运行时实测（时序结论来自代码与 React effect/被动效果执行顺序，标记为静态推断）。
- 最小修复（二选一）：
  1. 删除 `client.js:197-198` 两行（`status`/`message` 的清除），保留 `edit()` 中已有的 `setStatus("idle"); setMessage(null);`（`client.js:212-213`）——这样「已保存」/失败文案会保留到用户下一次编辑；
  2. 若确实要"失败保留草稿"，把 `:195` 改为条件式：仅当 `status !== "failed"` 时 `setDraft(null)`。

---

## 6. 交付完整性

### 6.1 `package.json` / locale 结构（自跑 10/10 通过）

```
PASS exports-client :: ./client.js
PASS files-client
PASS dsh-client-platform :: web
PASS dsh-client-inject :: ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-plugin-manager"]
PASS bundle-patch :: ./cordis.patch.yml
PASS en-meta :: {"title":"dsh-ami","description":"… All eight parameters are editable …"}
PASS zh-meta :: {"title":"AGENTS回声","description":"… 8 个参数都可在 Plugins 页本行的 Configure 配置页修改。"}
PASS no-ui-keys-in-locale-json :: meta
```

- `exports` 含 `"./client"`（`package.json:9`）、`files` 含 `client.js`（`:15`）、`dsh.client.platform = "web"` 与三项 inject（`:34-41`）、`dsh.bundle.patch` 未变（`:31-33`）。
- `locale/en.json`、`locale/zh.json` 均为合法 JSON，只有 `meta.title`/`meta.description` 两键，无 UI key 混入（UI 文案在 `client.js` 内联字典）。
- `cordis.patch.yml` 未被修改（`git status` 中无该文件），8 字段完整（`:5-12`）。
- 客户端字典键：探针 `c9-dict-parity :: en=27 zh=27`、`c10-dict-required-keys :: missing=`（8 个标签 + 8 个 Hint + summary/title/intro/unavailable/save/reset/saving/saved/invalidNumber/writeFailed/readOnly 全含）。

### 6.2 README 与实现一致

- §5（`README.md:45-60`）：可达路径、`plugins.row.config`、key `dsh-ami#dsh-ami`、命名空间、`form.mutate(ops, revision)`、现读解包，与实现逐条相符。
- §6（`:62-81`）：8 行表格 volatile 列全为「是」、修改入口全为「配置页 / patch」；两个字节字段取值域与 `index.js:30-31` 一致。
- §9（`:102-140`）：未验证项 U3/U5/B10/B8/B9/M1/U2 如实保留，U5 明确「已实现但未在运行时实测」。
- §10（`:142-152`）：给出 link 安装 + 重启 DSH + 刷新页面的最小步骤。
- 附录第 9 条（`:174`）：具名导出 18 → 19；实测 `lib/logic.js` 为 5 常量 + 14 函数 = 19，一致。

### 6.3 注释规范

逐文件抽查：`index.js` 全部注释 ≤ 2 行且以空格代替中英文逗号（如 `:25-26`、`:163`、`:221`）；`client.js` 注释均 ≤ 2 行（`:1-2,9,11,13,76-77,89,111,132,143,179,191,293,307,312`）；`lib/logic.js` 同理（`:58,62,68-69,83,110,115,120,126,133`）。**通过**。

### 6.4 建议项 S-3（非缺陷）

`git status` 显示工作区多出未跟踪的 `.idea/GitCommitMessageStorage.xml`（IDE 产物，与本任务无关）。建议交付前清理或加入忽略，避免混入提交。

---

## 7. 生效路径（能否让用户真正看到）

### 7.1 已安装副本仍是旧版（本会话实测，非引用文档）

```
$ profile = C:\Users\15068\.dsh\profiles\desktop
LinkType='' Target=''                 → 普通目录 非 link
dependencies."dsh-ami" = github:LingluoYusa/dsh-ami
已安装目录仅 8 个文件（无 client.js）
index.js       workspace=E00EFDE9124A803C installed=5E58BC03EF528C99 same=False
package.json   workspace=FF083F2D70222D8C installed=C66CDDF7AD11A561 same=False
lib/logic.js   workspace=A90390E4F39E853A installed=6665895221E517CB same=False
client.js      workspace=A71464DF58D7953F installed=absent        same=False
```

结论：**用户当前看到的现象（设置页没有参数页）根因是改动未生效，而不是代码错误**。已安装副本无 `client.js`、无 `dsh.client`、`exports` 无 `./client`，页面不可能出现。

### 7.2 文档是否说明了生效步骤 —— 是

- `README.md:146-152`：github 复制安装改工作区不生效 → 需 `install_bundle` 指向工作区绝对路径（变 `link:`）→ 重启 DSH 进程 → 刷新浏览器页面；并说明用 `application` 字段与 Configure 控件判断生效。
- `README.md:107`（U5）与 `docs/review/test-report-settings-page.md:393-403`、`:450-458` 明确标注安装动作未执行、渲染未验证。

### 7.3 诚实性评估 —— 通过

T4 报告未声称视觉/端到端通过：§0 与 §5 列出 6 类运行时未验证项，§2.7 明确「渲染结果本身未验证」。未发现「安装成功即声称视觉通过」的过度声明。

---

## 8. 缺陷清单与最小修复建议

### 阻断（0）

无。

### 重要（1）

**I-1 写后状态反馈被 revision effect 清除，失败时草稿被丢弃**

- 位置：`client.js:192-199`（尤其 `:197-198`）与 `client.js:232-244`、`:246-258`。
- 证据：`ui-settings/lib/client.js:1413-1426`（`acceptView` 更新镜像触发重渲染）、`dsh-settings/lib/index.js:428,536`（写成功 revision 递增并重新 describe）；设计 §5.2 骨架本无这两行（`docs/design/settings-page-design.md:379-383`），设计 §5.3 要求「失败保留草稿并提示」（`:466-468`）。
- 最小修复：删除 `client.js:197-198`（`setStatus("idle"); setMessage(null);`），状态改由 `edit()`（`:212-213`）清除；若要满足"失败保留草稿"，把 `:195` 改为仅在 `status !== "failed"` 时 `setDraft(null)`。

### 建议（3）

- **S-1** T4 报告的 D2 段落已过期：`docs/review/test-report-settings-page.md:422-430` 仍写「schema 只有 `.step(1).min(1)`，无 `.max()`」，而 `index.js:30-31` 在 T6 已补 `.max(Number.MAX_SAFE_INTEGER)`（本报告 §3 实测）。建议在 T4 报告追加一行「D2 已由 T6 修复」或更新该段，避免误导后续读者（本次审核未改动该文件）。
- **S-2** locale 中英标题不一致：`locale/zh.json:3` 为 `"AGENTS回声"`，`locale/en.json:3` 为 `"dsh-ami"`；同一插件在中文界面显示的名字与英文及页面标题（`client.js:47` 「AGENTS.md 周期注入」）都不同。建议统一为包名或统一为功能名。
- **S-3** 工作区存在未跟踪的 IDE 文件 `.idea/GitCommitMessageStorage.xml`，建议清理或忽略。

---

## 9. 未验证项（本报告不声称通过）

1. **真实浏览器渲染**：Configure 控件是否出现、8 个控件实际渲染、中英文案、明暗主题、控制台是否报 `slot entry crashed in 'plugins.row.config'` —— 未验证（本报告只做了模块捕获 + 伪 React 渲染断言）。
2. **link 安装 / 重启 / 刷新后的实际加载**：本会话审批通道禁用，`plugin_manager` 未执行；已安装副本经实测仍为旧版（§7.1）。
3. **端到端写入**：保存后 profile patch 是否固化为完整 8 字段、复位后 `config` 键是否被删除、双窗口 revision 冲突是否返回 `false`、失败回滚 —— 未验证。
4. **live Config 投影**：无法用 `cordis_inspect_query` 带 input 定位 dsh-ami entry；静态侧已由真实 schemastery 证明 8 字段 `meta.volatile === true` 且 `plainSchema` 会剥离 volatile 元数据（`dsh-settings/lib/index.js:103-117`），因此客户端 `decode` 校验应通过，但未在运行时观测。
5. **home patch / 命令行覆盖**：若存在，写会被拒（`dsh-config-editor/lib/index.js:122`）；本机未检查。
6. **I-1 的运行时表现**：结论由代码与 React effect 时序静态推断，未在真实浏览器复现。
7. **真实 DSH 事件总线下的并发 / abort 语义**：T4 §2.6 为模拟 `ctx`/`fs` 驱动，非真实事件总线。

---

## 10. 整体结论

**放行（有条件）。**

- 代码层：8 个参数全部 `.volatile()` 并在 `plugins.row.config`（key 严格 `dsh-ami#dsh-ami`）注册为可编辑表单；11 处（含新增闸门共 13 处）配置读取全部经 `resolveSettings()` 现读解包，未发现把 volatile 包装对象当标量的路径；`enabled` 闸门、失败语义、生命周期与清理均未被破坏；全部客户端 API 与官方真实签名一致，无臆造；D2 经本会话真实 schemastery 校验确认已修复（2**53 被拒、2**53-1 接受）；package.json / locale / README / 注释规范均完整。无阻断缺陷。
- 待办（不阻断交付，但建议随本次一并修复）：**I-1**（删除 `client.js:197-198` 两行，或改为条件式保留草稿），否则成功/失败状态条会被自身 effect 清掉，与设计 §5.3 及 T4 报告 `c12` 的表述不符；另建议处理 S-1/S-2/S-3。
- 生效层：**用户可见的问题在重新安装前不会消失**。实测已安装副本是 `github:` 复制安装的旧版（无 `client.js`、无 `dsh.client`），必须先 `install_bundle` 指向工作区（变 `link:`）→ 重启 DSH 进程 → 刷新页面，之后才可能出现 Configure 控件；该动作本会话未执行，属未验证项。
