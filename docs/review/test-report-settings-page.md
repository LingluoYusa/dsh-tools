# dsh-ami 配置页改造 测试报告（task-4）

- 测试者：tester（Agent Teams）
- 测试日期：2026-10-20
- 被测修订：工作区 `D:\YhhCode\MyProject\dsh-ami`（`git HEAD` = `b1c951d065b196575cfdaacdd9d4c6bd87915c51` + 未提交改动）
- 环境：Node `v22.21.0`；`@deepseek-ai/schemastery 3.18.5`；`@deepseek-ai/cosmokit 1.8.6`（均取自 profile 实测版本 `C:\Users\15068\.dsh\profiles\desktop\node_modules`）
- 依据：`docs/design/settings-page-design.md` §4.3 H0-H12、§8 验收清单；`docs/research/settings-page-findings.md` §7 11 行清单
- 结论来源：全部来自本会话真实命令输出；implementation-notes.md 的结论**未被采信**，仅作对照

## 0. 结论速览

| 项 | 数量 | 结果 |
| --- | --- | --- |
| 可执行断言总数（6 个脚本/检查） | **93** | **93 通过 / 0 失败** |
| 静态交叉核对（asar / package.json / locale / README） | 14 token + 3 项 | 全部一致 |
| 阻断级缺陷 | **0** | — |
| 低危缺口 | 1（D2，见 §4） | 页面已拦截，Host schema 未拦截 |
| 未验证项（必须运行时） | 6 类 | 见 §5 |

**最重要的实测事实（决定用户症状与修复是否生效）**：
profile 已安装副本 `C:\Users\15068\.dsh\profiles\desktop\node_modules\dsh-ami` 与 **git HEAD（旧版）逐字节相同**，且**不含 `client.js`、不含 `dsh.client`、`exports` 里没有 `./client`**。
即：当前运行/已安装的是**改造前的版本**，`index.js` / `lib/logic.js` / `package.json` / `client.js` 的工作区改动**完全没有生效** —— 这正是"设置页面里没有能修改配置表的页面"的直接原因。改造代码本身经 93 项断言验证正确，但**必须重新安装（link）+ 重启 DSH + 刷新页面**才会出现配置页。

---

## 1. 被测对象（逐文件 SHA256 前 16 位）

| 文件 | 工作区（被测） | 已安装副本 | 相同 |
| --- | --- | --- | --- |
| `index.js` | `954DF5CF8FAFC93E` | `5E58BC03EF528C99` | 否 |
| `lib/logic.js` | `A90390E4F39E853A` | `6665895221E517CB` | 否 |
| `package.json` | `FF083F2D70222D8C` | `C66CDDF7AD11A561` | 否 |
| `client.js` | `C7131A39EE3B105A` | **不存在** | 否 |
| `cordis.patch.yml` | `E653D1F24DFFDB5E` | `E653D1F24DFFDB5E` | 是 |
| `locale/en.json` | `D6C408EDCD1F909A` | `5FDB46189B3D…` | 否 |
| `locale/zh.json` | `94866E71DA043CD8` | `285D1B36FD46…` | 否 |

命令与输出（节选，完整见 §2.10）：

```
$ git rev-parse HEAD
b1c951d065b196575cfdaacdd9d4c6bd87915c51

$ git show HEAD:index.js | SHA256  vs  installed\index.js
index.js       HEAD=5E58BC03EF528C99 installed=5E58BC03EF528C99 same=True
package.json   HEAD=C66CDDF7AD11A561 installed=C66CDDF7AD11A561 same=True
lib/logic.js   HEAD=6665895221E517CB installed=6665895221E517CB same=True
```

---

## 2. 用例与实测输出

### 2.1 真实改动审阅（不采信 notes）

**输入/命令**：`git status --short`、`git diff --stat`、`git diff`、读 `docs/review/implementation-notes.md`、`docs/design/settings-page-design.md` §8、`docs/research/settings-page-findings.md` §7

**实际输出**：

```
 M README.md      M index.js       M lib/logic.js    M locale/en.json
 M locale/zh.json M package.json
?? client.js  ?? docs/design/settings-page-design.md
?? docs/research/settings-page-findings.md  ?? docs/review/implementation-notes.md

 README.md      | 55 ++++++++++++++++++++++++----------------
 index.js       | 61 +++++++++++++++++++++++++++----------------
 lib/logic.js   | 21 +++++++++++++++-
 locale/en.json |  2 +-
 locale/zh.json |  2 +-
 package.json   | 10 ++++++++++
 6 files changed, 104 insertions(+), 47 deletions(-)
```

逐点核对 diff 与 notes §1/§2 一致：`Config` 8 字段全 `.volatile()`；`index.js` 新增 `readSettings` 并移除 `resolveEveryTurns` 导入；pre-step 新增 `enabled` 闸门；`lib/logic.js` 新增 `unwrap` + `resolveSettings`；`package.json` 新增 `./client`、`files.client.js`、`dsh.client`；`cordis.patch.yml` **未改**（`git diff` 为空）。

**结果**：通过（与设计一致，无夹带改动）。

### 2.2 语法与加载

**输入/命令**：

```powershell
node --version
node --check index.js ; node --check lib/logic.js ; node --check client.js
node -e "JSON.parse(fs.readFileSync('package.json','utf8'))"  # 及 locale/en.json locale/zh.json
```

**实际输出**：

```
v22.21.0
check index.js exit=0
check lib/logic.js exit=0
check client.js exit=0
json ok package.json
json ok locale/en.json
json ok locale/zh.json
```

**结果**：通过。

**补充（真实 import 尝试）**：`import("file:///D:/YhhCode/MyProject/dsh-ami/index.js")` 因裸说明符 `@deepseek-ai/schemastery` 在**工作区目录树**无 `node_modules` 而无法解析（工作区无 `node_modules`，实测 `Test-Path D:\YhhCode\MyProject\dsh-ami\node_modules` = False）。按 task 允许的降级方式处理：把 `index.js` 的**两处裸说明符改写为绝对路径**（其余字节不变，实测仅 2 行不同），导入 profile 实测版 schemastery 后驱动，见 §2.6。

```
INFO index.js 改写行数=2 (仅 2 处裸说明符)
```

### 2.3 读取点覆盖（H0-H12 与 T1 §7 的 11 行清单）

**输入/命令**：`ops_grep pattern="config\.|settings\.|config\?\.|settings\?\." path=index.js` 与 `path=lib/logic.js`；`ops_grep pattern="\bconfig\b" path=index.js`

**实际输出**：

`index.js` 的 `config.` 读取 **0 处**；`settings.*` 读取 8 处，全部来自 `readSettings()` 的解包结果：

```
index.js:102  const limit = settings.maxSourceBytes;
index.js:142  buildInstructionText(text, settings.wrapSystemReminder)
index.js:164  if (settings.enabled !== true) return next();          // 新增 pre-step 闸门
index.js:165  if (!shouldInject(payload.turn, settings.everyTurns, state)) return next();
index.js:182  if (settings.onlyIfChanged === true && digest === state.lastInjectedHash) return next();
index.js:236  if (settings.enabled !== true) return;                 // agent/created
index.js:238  const verdict = settings.includeSubagents === true ? "primary" : probePrimaryAgent(ctx, agent);
index.js:240  const gate = canRegisterForAgent(settings, SUBAGENT_PREDICATE_READY, verdict === "primary");
```

`index.js` 中 `\bconfig\b` 仅 3 处命中，无遗漏：

```
index.js:218  export function apply(ctx, config) {
index.js:221  // 每次使用点现读并解包 volatile 变更不重挂载 闭包 config 长期有效
index.js:222  const readSettings = () => resolveSettings(config, deps.isVolatile ?? fallbackIsVolatile);
```

`lib/logic.js` 中 `config` 仅 7 处，全部是纯函数形参（调用方传已解包值）：

```
logic.js:84-86  planInjection(text, config) -> config?.maxInjectBytes
logic.js:92     config?.truncateOversize === true
logic.js:134-136 canRegisterForAgent(config, ...) -> config?.enabled / config?.includeSubagents
```

**对照 H0-H12**：H0（8 字段 volatile）✅ / H1（注释）✅ / H2（import 切换）✅ / H3（`readAgentsMd` 形参改名 + `settings.maxSourceBytes`）✅ / H4（`buildMessage` + `settings.wrapSystemReminder`）✅ / H5（`registerForAgent` 收 `readSettings` 函数）✅ / H6（pre-step 现读 + enabled 闸门 + `settings.everyTurns`）✅ / H7（传 `settings`）✅ / H8（`planInjection(read.text, settings)`）✅ / H9（`settings.onlyIfChanged === true`）✅ / H10（`buildMessage(..., settings, ...)`）✅ / H11（`agent/created` 现读 + 拆成两句 enabled 判定 + `canRegisterForAgent(settings, ...)`）✅ / H12（`registerForAgent(ctx, readSettings, ...)`）✅

**对照 T1 §7 的 11 行**：11 行全部落在 `settings.*` 或解包后的纯函数入参上，**无遗漏**；**未发现把 volatile 包装对象当标量参与比较/算术的路径**（`config.` 在 `index.js` 命中 0；`lib/logic.js` 的 `config` 只出现在函数体内，且 §2.6 集成测试以真实 cosmokit volatile 引用驱动验证了这些分支的实际行为）。

**结果**：通过。

### 2.4 纯函数回归（`lib/logic.js`，裸 Node 零依赖）

**输入/命令**：临时脚本 `%TEMP%\dsh-ami-t4\logic.test.mjs`，直接 `import file:///D:/YhhCode/MyProject/dsh-ami/lib/logic.js`

**实际输出（25/25 通过）**：

```
PASS a-N1-sequence :: hits(1..12)=2,3,4,5,6,7,8,9,10,11,12
PASS a-N2-sequence :: hits(1..12)=3,5,7,9,11
PASS a-N10-sequence :: hits(1..100)=11,21,31,41,51,61,71,81,91
PASS a-exhaustive-equivalence-1..200 :: isHitTurn === (turn-1)%N===0 && turn>1 for N in {1,2,10} t in 1..200
PASS a-invalid-N :: N<=0 / 非整数 一律不命中
PASS a-shouldInject-watermark :: 双水位线语义不变
PASS b-canRegisterForAgent-16-combos :: 16 combos all match spec order
PASS b-wrapped-enabled-false :: volatile enabled:false -> disabled
PASS b-wrapped-optin-escape-hatch :: includeSubagents:true 不求值谓词
PASS b-nonboolean-truthy-is-not-enabled :: 未解包 -> disabled (回归哨兵)
PASS c-plan-boundaries :: maxInjectBytes 8/9->ok 7+truncate->truncated 7+off->inject-oversize 1->truncated 0/-5/7.5/undefined->ok ...
PASS c-truncated-marker :: len=53
PASS c-wrapped-equals-bare :: 逐字段相同
PASS c-multibyte-not-split :: text="中\n\n[truncated: content exceeded maxInjectBytes]"
PASS c-huge-maxInjectBytes :: 2**53 被 Number.isInteger 接受为上限 不截断
PASS d-wrapped-equals-plain :: 8 字段 wrapped/plain/mixed 均正确
PASS d-key-set-and-count :: keys=enabled,everyTurns,maxSourceBytes,maxInjectBytes,truncateOversize,wrapSystemReminder,onlyIfChanged,includeSubagents
PASS d-missing-fields-undefined :: 缺字段/undefined 输入不抛错 返回 undefined
PASS d-no-isVolatileFn-returns-raw :: 无 isVolatileFn 时不解包
PASS d-over-eager-isVolatileFn-throws :: 若 isVolatileFn 对裸值误报 true 会抛 TypeError (fail-fast)
PASS d-fallback-duck-on-real-shape :: index.js fallbackIsVolatile 形状可识别
PASS e-resolveEveryTurns :: 非整数一律 NaN 0 原样返回
PASS a8-buildInstructionText-wrap :: wrapSystemReminder 解包后两态正确
PASS a9-exports-and-zero-import :: exports=19 (5 常量 + 14 函数) 零 import
PASS a9-index-import-list :: index.js 具名导入已切换

SUMMARY total=25 pass=25 fail=0
```

覆盖任务要求的 (a)(b)(c)(d)(e)：
- **(a) 命中轮号**：N=1/2/10 的命中序列与 `(turn-1)%N===0 && turn>1` 在 t∈1..200 上**逐一等价**；`turn===1` 永不命中；N≤0/非整数不命中。
- **(b) `canRegisterForAgent`**：enabled/includeSubagents/predicateReady/isPrimary 全 16 组合的 `register` 与 `reason` 与规格顺序（disabled → all-agents → predicate-not-ready → not-primary → primary-only）完全一致；volatile 包装两态正确。
- **(c) `planInjection`**：`truncateOversize` 两态、`maxInjectBytes` 边界（相等/多 1/少 1/1/0/负数/小数/缺省）、空文本、多字节不切断、2**53 上限。
- **(d) `resolveSettings`**：`{get(){…}}` 包装、裸值、混合、缺字段、无 `isVolatileFn`、真实 frozen `{get}` 形状全部正确。
- **(e) `resolveEveryTurns`**：wrapped/bare 整数 → 原值；小数/字符串/undefined/NaN → `NaN`；0 原样返回（由 `isHitTurn` 再拒绝）。

**结果**：通过。

### 2.5 schema 边界与真实 schemastery/cosmokit 集成

**输入/命令**：临时脚本 `%TEMP%\dsh-ami-t4\schema.test.mjs`；从**真实 `index.js` 源码**抽出 `Config` 定义（不改写字段），用 profile 实测 `schemastery 3.18.5` 与 `cosmokit 1.8.6` 执行 `Config(raw)`

**实际输出（11/11 通过 + 2 条 INFO）**：

```
INFO schema-versions schemastery=3.18.5(default export) cosmokit-isVolatile=function
INFO config-src-extracted "const Config = z.object({" ... "  includeSubagents: z.boolean().default(false).volatile(),"
PASS s1-schema-8-volatile-fields :: enabled=true everyTurns=true maxSourceBytes=true maxInjectBytes=true truncateOversize=true wrapSystemReminder=true onlyIfChanged=true includeSubagents=true
PASS s2-defaults-and-volatile-refs :: enabled=true everyTurns=10 maxSourceBytes=1048576 maxInjectBytes=16384 truncateOversize=true wrapSystemReminder=true onlyIfChanged=false includeSubagents=false
PASS s3-real-config-resolveSettings :: real cosmokit refs unwrap; duck-typed {get} 不被真实 isVolatile 识别 (生产走 cosmokit 引用 无影响)
PASS s4-everyTurns-boundaries :: 1 -> 1 | 1000 -> 1000 | 0 -> rejected($.everyTurns expected number >= 1 but got 0) | 1001 -> rejected(expected number <= 1000) | 1.5 -> rejected(expected number multiple of 1) | "10" -> rejected(expected number but got 10) | -3 -> rejected | NaN -> rejected | 2**53 -> rejected(expected number <= 1000)
PASS s5-maxSourceBytes-boundaries :: 0 -> rejected | -1 -> rejected | 1 -> ACCEPTED(1) | 1048576 -> ACCEPTED(1048576) | 2**53 -> ACCEPTED(9007199254740992) | 2**53+2 -> ACCEPTED(9007199254740994) | Infinity -> rejected | 1.5 -> rejected
PASS s6-maxInjectBytes-and-boolean-types :: maxInjectBytes:0 -> rejected | -1 -> rejected | 2**53 -> ACCEPTED | enabled:"true" -> rejected | enabled:1 -> rejected | truncateOversize:null -> ACCEPTED(->true) | includeSubagents:"yes" -> rejected | unknown key -> ACCEPTED | null input -> rejected(TypeError)
PASS s7-write-side-shape-after-validation :: ref.get()=3 ownKeys=["get"]
PASS s8-planInjection-with-real-config :: schema 接受的 2**53 会让 index.js:103 的 SafeInteger 检查抛错 (见报告 D2)
PASS s9-patch-coverage :: cordis.patch.yml config = enabled,everyTurns,maxSourceBytes,maxInjectBytes,truncateOversize,wrapSystemReminder,onlyIfChanged,includeSubagents (未修改 8 字段完整)

SUMMARY total=11 pass=11 fail=0
```

要点：
1. **8 个字段 `meta.volatile === true`**（用真实 schemastery 读 `Config.dict[k].meta.volatile`），默认值与 README 表格逐项一致。
2. `Config({})` 产出的 8 个值**都是 cosmokit volatile 引用**（`isVolatile()` = true，冻结对象，own keys 只有 `get` + write symbol），`resolveSettings(parsed, isVolatile)` 能正确解包为普通值 —— 证明 Host 侧解包链路与真实运行时契约一致。
3. 越界一律 `ValidationError` 且不产生脏值：`everyTurns` 0/1001/1.5/"10"/-3/NaN/2**53 全部拒绝；`maxSourceBytes`/`maxInjectBytes` 0/-1/1.5/Infinity 拒绝；布尔字段传字符串/数字/`"yes"` 拒绝。
4. **D2 缺口**：`maxSourceBytes` / `maxInjectBytes` 的 **2**53 与 2**53+2 被 schema 接受**（只有 `.step(1).min(1)`，无 max、无 SafeInteger 约束）。见 §4 D2。
5. 观察项：`truncateOversize: null` 被接受并回落默认 `true`（schemastery 默认语义）；schema **不拒绝 Config 之外的未知键**（`{nope:1}` 通过校验）—— 写路径的 `validatePaths` 才是拦截点（设计 §4.5 的不变量在写层成立）。

**结果**：通过（含 1 个低危缺口与 2 个观察项）。

### 2.6 Host 集成（真实 `index.js` + 真实 volatile 引用 + 模拟 DSH 服务）

**输入/命令**：临时脚本 `%TEMP%\dsh-ami-t4\host.test.mjs`。做法：`index.js` 仅把 `@deepseek-ai/schemastery` 与 `./lib/logic.js` 两处说明符改为绝对路径（实测仅 2 行不同），其余字节不变；`apply(ctx, cfg)` 的 `cfg` 由真实 `Config(raw)` 产出；通过 `Symbol.for("cosmokit.volatile.write")` **就地改值**模拟 Loader 的 live 更新；`ctx`/`agent.ctx`/`fs` 为最小桩。

**实际输出（15/15 通过 + 1 条 INFO）**：

```
INFO index.js 改写行数=2 (仅 2 处裸说明符)
PASS h0-registration :: agent/created -> registerForAgent 使用真实 cosmokit volatile 引用
PASS h1-happy-inject-turn11 :: turn 11 -> 1 message len=169
PASS h2-non-hit-turn :: turn 12 (N=10) -> 0 message 且未读盘
PASS h3-enabled-live-gate :: enabled 现读 关->已存在 agent 立即停且零读盘 重开恢复 (H6 闸门)
PASS h4-wrapSystemReminder-false :: len=132 无 <system-reminder>
PASS h5-maxSourceBytes-oversize :: agents-md-inject: AGENTS.md exceeds maxSourceBytes
PASS h6-maxInjectBytes-truncate-and-skip :: 截断并追加标记 / 关闭后跳过并告警
PASS h7-onlyIfChanged :: 未变跳过 变更恢复 (lastInjectedHash)
PASS h12-many-turns-still-registered :: per-agent effect 只注册一次
PASS h10-subagent-not-registered-by-default :: 非主 agent 默认零注册
PASS h11-subagent-optin-and-enabled-gate :: includeSubagents=true 绕过谓词 / enabled=false 零注册
PASS h8-maxSourceBytes-2pow53-degrades-to-read-error :: schema 接受 2**53 -> index.js:103 抛 invalid source limit -> 收敛 read-error 不中断 turn (D2)
PASS h9-fs-failure-does-not-break-turn :: fs stat 抛错被收敛 不冒泡 不中断 turn :: agents-md-inject: dsh-home-paths unavailable, falling back to $DSH_HOME or ~/.dsh | agents-md-inject: read failed
PASS h13-fs-service-missing :: fs 服务缺失 -> no-fs 降级 不注入不抛错

SUMMARY total=15 pass=15 fail=0
```

对应设计 §8.2 的 B3/B4/B5/B6/B7/B8/B9/B10（以模拟服务驱动，**非真实 DSH 事件总线**）：
- **B4（决定性的"不 remount"契约）**：`enabled` 改为 false 后，**已存在 agent** 的下一个命中轮号 0 注入且 `fs.readBytes` 计数不增；改回 true 立即恢复 —— 新增的 pre-step 闸门真实生效。
- **B3**：`everyTurns` 在 pre-step 现读，命中轮号按最新值判定。
- **B5**：`includeSubagents=false` 时非主 agent 零注册；改为 true 后新 agent 注册并注入；已存在 agent 不追溯。
- **B6**：`onlyIfChanged` 打开且内容/版本未变 → 命中轮号跳过；版本变化后恢复注入。
- **B7/B8**：`maxSourceBytes` 超限 → 跳过 + 告警；`maxInjectBytes` 超限 → 追加 `[truncated: content exceeded maxInjectBytes]`，`truncateOversize=false` → 跳过 + 告警。
- **B9**：`wrapSystemReminder=false` 时注入文本不含 `<system-reminder>`。
- **B10**：`fs.stat` 抛错、`fs` 服务缺失均被收敛为 `read-error` / `no-fs` 告警，`decision` 原样返回、不中断 turn。

**结果**：通过。

### 2.7 Client 半边：静态 + 伪 React 渲染行为

**输入/命令**：临时脚本 `%TEMP%\dsh-ami-t4\client.test.mjs`。用 `node:vm` 提供假 `window.__ModuleLoader__.load` 捕获模块定义，用自建 hooks 的伪 React 运行时驱动组件（**不是真实浏览器渲染**）。

**实际输出（15/15 通过）**：

```
PASS c1-module-shape :: id/factory/inject 与官方 decoration 模板同构
PASS c2-apply-registers :: key=dsh-ami#dsh-ami locale=settings.dshAmi whileServed=["dsh-ami"]
PASS c3-locale-dict :: keys=27 en===zh 缺失=0
PASS c4-summary-branch :: summary 分支返回一行文本
PASS c5-unavailable-branches :: form===undefined / status!=='ready' 均渲染 unavailable
PASS c6-fields-and-attrs :: min/max/step 与 Config 逐项一致
PASS c7-client-validation-blocks-save :: "0"->err=true,saveDisabled=true | "1.5"->true | "1001"->true | ""->true | "abc"->true | "1000"->err=false,saveDisabled=false
PASS c8-2pow53-blocked-by-client :: 客户端 Number.isSafeInteger 拦截 2**53 (Host schema 不拦 见 schema 报告 s5)
PASS c13-readonly-state :: writable:false -> 只读提示 + 控件禁用
PASS c14-source-static-hygiene :: tokens=14 无字面色值 无 ui-primitives
PASS c15-format-vs-official-template :: 与官方 templates/decoration/client.js 同形 (factory 返回 exports 对象)
PASS c9-save-mutate-ops :: mutate([{"op":"set","path":["everyTurns"],"value":5}], revision=3)
PASS c10-reset-unset-8 :: enabled,everyTurns,maxSourceBytes,maxInjectBytes,truncateOversize,wrapSystemReminder,onlyIfChanged,includeSubagents
PASS c11-switch-toggle :: [{"op":"set","path":["onlyIfChanged"],"value":true}]
PASS c12-mutate-false-and-reject :: false 与 reject 都显示失败 草稿保留

SUMMARY total=15 pass=15 fail=0
```

与设计 §3/§5 的一致性（逐项）：
- slot 名 `plugins.row.config` ✅；注册 key `dsh-ami#dsh-ami` ✅；字典 NS `settings.dshAmi` ✅；Host 命名空间 `dsh-ami` ✅
- `whileServed(["dsh-ami"], …)` 包裹注册 ✅；`ctx.effect` 包住 `locale.register` 与 `whileServed`，两个回调**都返回 disposer**（清理链完整）✅；effect 标签与设计一致 ✅
- 模块形态与官方 `templates/decoration/client.js` 同形（`window.__ModuleLoader__.load({ id, factory(require){…return {inject, apply}} })`）✅
- `inject = ["slots","locale","configForms"]` ✅；仅 `require("react")`，**不 require `@deepseek-ai/dsh-client-ui-primitives`** ✅
- 8 行控件（3 个 number + 5 个 switch），`min/max/step` 与 `Config` 逐项一致（`everyTurns` 1..1000 step 1；两个字节字段 min 1 step 1）✅
- 客户端预校验拦截 `0 / 1.5 / 1001 / "" / "abc"` 与 `2**53`，并禁用保存 ✅；保存发 `{op:"set"}` + `state.revision`，复位发 8 个 `{op:"unset"}` ✅；`mutate` 返回 `false` 或 reject 均显示失败文案且保留草稿 ✅
- 字典 `en`/`zh` 27 键**一一对应**，含设计 §5.4 要求的全部 key（含 8 个 `*Hint`、`readOnly`）✅
- 样式只出现 14 个 `--dsw-*` token，**无字面色值** ✅

**结果**：通过（**渲染结果本身未验证**，见 §5）。

### 2.8 `package.json` / locale 静态核对（27/27 通过）

**输入/命令**：`node -e` 读 `package.json` 与 `locale/*.json` 断言

**实际输出**：

```
PASS exports[./client] === ./client.js      PASS client.js exists on disk
PASS files includes client.js               PASS exports[.] unchanged
PASS dsh.bundle.patch unchanged             PASS dsh.client.platform === web
PASS dsh.client.inject === 官方三项          PASS no immediately (官方配置页同构)
PASS files entry exists: index.js / client.js / lib/logic.js / cordis.patch.yml / icon.svg / README.md
PASS en.meta.title present                  PASS en.meta.description present
PASS zh.meta.title present                  PASS zh.meta.description present
SUMMARY pass=27 fail=0
```

**结果**：通过。

### 2.9 官方侧交叉验证（只读解析 `app.asar`）

**输入/命令**：临时只读脚本解析 `D:\DSH\resources\app.asar`（18309 个文件），检索官方包与 token

**实际输出（节选）**：

```
=== 官方 templates/decoration/client.js（22 行）===
window.__ModuleLoader__.load({ id:'@local/my-decoration', factory(require){ … return { inject:['slots'], apply(ctx){…} }; } });
→ 与 client.js 的模块形态同构

=== ui-plugin-manager README:73 ===
"…`plugins.row.config` (keyed by `<package name>#<row id>`) for one row's configuration,
 which gives that row a **Configure** control opening the row's page."
=== ui-plugin-manager/lib/client.js:27 ===
function rowConfigKey(bundle, rowId) { return `${bundle}#${rowId}`; }
=== ui-plugin-manager/lib/client.js:2818 ===
renderSlot("plugins.row.config", { view:"page", form }, { entryKey: key })   // key = rowConfigKey(pkg.name, row.rowId)
=== ui-plugin-manager/lib/client.js:3833 ===
const formFor = (id) => { … return { state: form.getSnapshot(), mutate:(ops,rev)=>form.mutate(ops,rev) }; }
=== ui-settings/lib/client.js:1270/1315 ===
super(ctx, "configForms");  whileServed(namespaces, register) { … }
→ 服务名 configForms、whileServed 语义与"调用方用 ctx.effect 包住返回值"与 client.js 用法一致
=== ui-settings/lib/client.js:1108-1114 / 1223-1231 ===
snapshot = { status, value, base, user, revision, writable }  // client.js 读取的字段全部存在
=== dsh-settings/lib/index.js:432/443/502 ===
ns: entry.options.id      // 设置命名空间 = entry.options.id
=== profile cordis.yml:1382-1392 ===
- id: dsh-ami
  name: dsh-ami
  config: { enabled, everyTurns, maxSourceBytes, maxInjectBytes, truncateOversize, wrapSystemReminder, onlyIfChanged, includeSubagents }
→ 命名空间 "dsh-ami" 与 row id "dsh-ami" 成立，key "dsh-ami#dsh-ami" 与 whileServed(["dsh-ami"]) 均能命中

=== token 检索（client.js 用到的 14 个）===
FOUND --dsw-alias-bg-layer-2 / border-l2 / border-l4 / brand-primary / button-primary-fill /
      label-primary / label-primary-foreground / label-secondary / label-tertiary /
      state-error-primary / state-success-primary / switch-thumb / radius-sm / (--dsw-alias)
tokens=14 missing=0
=== dsh.client.inject 三个包在 asar 中均存在 ===
/dsh/node_modules/@deepseek-ai/dsh-client-locale/…
/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/package.json
/dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/package.json
```

**结果**：通过（静态一致）。

### 2.10 安装生效路径

**输入/命令**：

```powershell
Get-Item "$p\node_modules\dsh-ami" | Select LinkType,Target          # $p = profile desktop
Get-FileHash … -Algorithm SHA256                                     # 工作区 vs 已安装
Select-String "$p\node_modules\.modules.yaml" -Pattern 'dsh-ami'
Get-Content "$p\package.json" -Raw
Get-ChildItem "$p\node_modules\dsh-ami" -Recurse -File
```

**实际输出**：

```
LinkType : (空)          Target : (空)         → 普通目录 不是 symlink/junction
dependencies: "dsh-ami": "github:LingluoYusa/dsh-ami"
.modules.yaml: "dsh-ami@https://codeload.github.com/LingluoYusa/dsh-ami/tar.gz/b1c951d065b196575cfdaacdd9d4c6bd87915c51(@deepseek-ai/cosmokit@1.8.6)"

已安装目录仅 8 个文件：
 cordis.patch.yml  icon.svg  index.js  package.json  README.md
 lib\logic.js  locale\en.json  locale\zh.json
→ 没有 client.js

已安装 package.json：exports 只有 "."、"./locale/*.json"、"./icon"；files 无 client.js；dsh 段只有 bundle.patch，没有 client
```

**结论（关键）**：
1. **改工作区不会生效**：profile 是 `github:` 的**复制安装**（普通目录），已安装副本 = git HEAD 旧版（§1 哈希）；`client.js`、`dsh.client`、`./client` 导出**全部不存在于已安装副本**。
2. 因此当前页面**不可能**出现 8 参数配置页 —— 与用户症状一致，且与实现代码的正确性无关。

**让修复生效的最小步骤**（`plugin_manager` 在本会话审批通道禁用，未执行，由 Lead 负责）：
1. `plugin_manager` `install_bundle`，目标为工作区绝对路径 `D:\YhhCode\MyProject\dsh-ami`（变为 `link:`，link 安装不受 `files` 过滤）；
2. **重启 DSH 进程**（Host 侧 `index.js` / `lib/logic.js` 已进 Node 模块缓存；替换已安装包同样需要重启）；
3. **刷新浏览器页面**（`client.js` / `package.json` 的 `dsh.client` 改动，保守做法是重启 + 刷新；不要因 slot id 未变就假定浏览器代码已更新）；
4. 判定生效看 `plugin_manager` 结果的 `application` 字段（`applied` / `restart-required` / `overridden` / `failed`），以及 Plugins 页 dsh-ami 行是否出现 Configure 控件。

**结果**：通过（事实已实测；安装动作本身未执行）。

---

## 3. 用例统计

| 套件 | 断言数 | 通过 | 失败 |
| --- | --- | --- | --- |
| 2.4 纯函数回归 `logic.test.mjs` | 25 | 25 | 0 |
| 2.5 schema 边界 `schema.test.mjs` | 11 | 11 | 0 |
| 2.6 Host 集成 `host.test.mjs` | 15 | 15 | 0 |
| 2.7 Client 静态 + 伪渲染 `client.test.mjs` | 15 | 15 | 0 |
| 2.8 package.json / locale | 27 | 27 | 0 |
| **合计** | **93** | **93** | **0** |

---

## 4. 缺陷与观察项

### D2（低危，非阻断）`maxSourceBytes` / `maxInjectBytes` 超大值通过 Host schema，运行时退化为 `read-error`

- **文件/行号**：`index.js:30-31`（schema 只有 `.step(1).min(1)`，无 `.max()`、无 SafeInteger 约束）→ `index.js:102-103`（`if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid source limit")`）
- **最小复现**：
  1. `schema.test.mjs` s5：`Config({ maxSourceBytes: 2**53 })` → `ACCEPTED(9007199254740992)`（`2**53+2` 同样接受）；
  2. `host.test.mjs` h8：以 `maxSourceBytes: 2**53` 驱动真实 `index.js`，命中轮号 0 注入，告警 `agents-md-inject: read failed`，`decision` 原样返回；
  3. 等价的最小复现（patch 或 CLI 写入 `maxSourceBytes: 9007199254740992`）→ 此后每个命中轮号都降级为 `read-error`，永不注入。
- **影响**：不会崩溃、不中断 turn，但注入静默失效并持续告警。**页面已拦截**（`client.test.mjs` c8：客户端 `Number.isSafeInteger` 阻止保存并提示），因此只有绕过页面的写入路径（手改 patch / CLI / 其它客户端）可达。
- **建议**：给两个字节字段加 `.max(Number.MAX_SAFE_INTEGER)`（或在 `readAgentsMd` 把非 SafeInteger 上限按 `Infinity`/跳过处理而不是抛错）。**本任务只报告，未修改实现文件。**
- **状态更新（T8 复验，2026-10-20）**：**D2 已由 T6 修复**：`index.js:30-31` 补 `.max(Number.MAX_SAFE_INTEGER)`，真实 schemastery 复验 `2**53` 被拒 / `2**53-1` 接受（复现见 §附 T7 复验）。

### D1（信息）schema 不拒绝 Config 之外的未知键

`schema.test.mjs` s6：`Config({ nope: 1 })` 通过校验（未知键保留）。设计 §4.5 的不变量由写路径 `dsh-settings` 的 `validatePaths` 保证（非 volatile 路径会被拒），因此不构成缺陷；仅说明"schema 校验"不等于"patch 行只含 8 键"的强制点。

### D3（信息）`truncateOversize: null` 被接受并回落默认值 `true`

schemastery 默认语义（`null` → default），页面不会发送 `null`。行为可接受，仅记录。

### D4（信息）`maxInjectBytes = 0` 在逻辑层等价于"无上限"

`schema.test.mjs` s6 证明 schema 拒绝 0；`logic.test.mjs` c-plan-boundaries 证明若绕过 schema 把 0 传给 `planInjection`，会被当作 `Infinity`（不截断）。因 schema 是必经路径，当前不可达。

### D5（信息）`resolveSettings` 在 `isVolatileFn` 过度报真时抛 `TypeError`

`logic.test.mjs` d-over-eager-isVolatileFn-throws：`resolveSettings({enabled:true}, ()=>true)` 抛 `value.get is not a function`。生产两条路径都精确：`cosmokit.isVolatile` 只认 `Symbol.for("cosmokit.volatile.write")` 引用（`schema.test.mjs` s3 实测鸭子类型 `{get}` 不被识别），`index.js:69` 的 `fallbackIsVolatile` 只认带 `get` 函数的对象，而 8 字段都是布尔/数字或真实引用。属 fail-fast 而非静默错值。

---

## 5. 未验证项清单（必须运行时确认，本报告不得声称通过）

1. **页面渲染结果（最重要）**：Plugins → Installed plugins → dsh-ami → 行 `dsh-ami` 是否出现 **Configure** 控件、点击后 8 个控件是否全部渲染、中英文案、明暗主题配色、summary 分支的实际渲染位置、控制台是否出现 `slot entry crashed in 'plugins.row.config'` —— **全部未验证**。本次只做了模块捕获 + 伪 React 运行时的结构/分支断言（§2.7），**不代表真实浏览器渲染通过**。
2. **Host live Config 投影（B1/B2）**：`cordis_inspect_query` 带 `input` 被拒（复现 2 次：`Config.listConfigs` 传 `{"name":"dsh-ami"}` 与 `{"offset":175,"limit":25}` 均返回 `rejected input: "input" must be an object`）；无 `input` 只能取第 1 页 25/208 条，无法翻页定位 dsh-ami entry。因此 **live 侧未观测**。静态侧证：真实 schemastery 证明 8 字段 `meta.volatile === true`；profile `cordis.yml:1382-1392` 合成树含完整 8 字段。
3. **写入链路端到端（C4/C5/C6）**：保存后 profile patch 该 entry 的 `config` 是否为完整 8 字段、复位后 `config` 键是否被删除、双窗口 revision 冲突是否返回 `false`、失败回滚 —— 未验证（需运行时）。
4. **主题 token 的运行时可用性（C9）**：`Theme.listTokens` client inspect **超时**（`Client inspect query Theme.listTokens timed out after 10000ms`）。改为对 `app.asar` 做静态检索：14/14 token 在官方文件中存在（§2.9），但**真实主题下的明暗配色未验证**。
5. **安装 / link 生效（§2.10 第 1-4 步）**：`plugin_manager` 审批通道在本会话禁用，**未执行**；`application` 字段、重启后行为、Configure 控件出现与否均未验证。
6. **真实 DSH 事件总线行为**：§2.6 的 B3-B10 由模拟 `ctx`/`agent.ctx`/`fs` 驱动真实 `index.js` 代码路径，**非真实 `agent/pre-step` payload、真实 `fs` provider、真实并发与 `signal` 语义**；真实运行时下的并发/abort 行为未验证。
7. **README D3 文案**：已静态核对（§2.11 见下），但文档措辞的"用户体验"未验证。

### 2.11（补）README 同步核对

`README.md:47` 已改为"**8 个参数全部可在 Plugins 页面修改**，不再只暴露 `everyTurns`"；`README.md:64-73` 表格 8 行 volatile 列全为 **是**、修改入口全为"配置页 / patch"；`README.md:144-150` 给出 link 安装 + 重启 + 刷新的最小步骤；`README.md:171-172` 记录具名导出 18 → 19。**结果：通过**。

---

## 6. 总体结论

1. **改造代码本身正确**：93/93 断言通过，覆盖语法、11 处读取点覆盖、命中轮号、注册门控、体积降级、volatile 解包（真实 cosmokit 引用 + 兜底鸭子类型两条路径）、`enabled` 现读闸门、失败不中断 turn、Client 注册契约/字段/校验/写入 ops/失败反馈/locale 键、package.json 与 locale 清单。
2. **无阻断缺陷**；1 个低危缺口 D2（两个字节字段的 schema 缺 `.max()`，页面已拦截，绕过页面的写入会使注入静默失效）。**该缺口已由 T6 修复并在 §附 T7 复验中闭环，见 §4 D2 的"状态更新"行。**
3. **用户症状的根因不是代码，而是未生效**：profile 仍是 `github:` 复制安装的旧版（无 `client.js`、无 `dsh.client`），改工作区不生效。必须先 link 安装 + 重启 DSH + 刷新页面，配置页才会出现；出现后 §5 的 6 类运行时项必须由 Lead 复测，本报告**不声称**任何视觉/运行时通过。
4. 测试过程未修改任何实现文件（`git status` 与开始时一致），临时脚本全部位于 `%TEMP%\dsh-ami-t4\` 并在交付前删除。

---

# 附 T7 复验（task-8，2026-10-20）

- 复验范围：T7 的 I-1（写后状态反馈）/ S-2（locale 标题统一）/ hint 上界，以及 T6 的 D2 修复（`.max(Number.MAX_SAFE_INTEGER)`）
- 被测文件哈希（SHA256 前 16 位）：`index.js` `E00EFDE9124A803C`、`client.js` `83308268B71BE628`、`locale/en.json` `1859CC3335C080C2`、`locale/zh.json` `87405E2347D0E576`
- 环境：Node `v22.21.0`；profile 实测 `@deepseek-ai/schemastery 3.18.5`
- **断言总计 41：41 通过 / 0 失败**（I-1 9 + 回归/S-2/hint 10 + D2 5 + 越界核对 15 + `node --check` 2）

## 附.1 I-1 复验（9/9 通过）

**方法**：`node:vm` 捕获 `window.__ModuleLoader__.load` 得到真实 `client.js` 的 factory；自建伪 React 运行时（`useState`/`useEffect` 带依赖比较与清理）驱动 `DshAmiForm`；用**时序探针**在 `form.mutate` 内部模拟页面 owner 的 revision 推进（`acceptView`）与 `recover()`，即"revision 先变、`setStatus` 后到"的真实顺序。

**逐行核对**（`client.js:191-199`）：

```
// revision 变化说明 Host 值已更新 只在未失败且非写入中时丢弃草稿
React.useEffect(() => {
  if (state.revision === basedOn) return;      // 守卫
  setBasedOn(state.revision);
  if (status === "failed" || status === "saving") return;   // 保留草稿
  setDraft(null);
  setErrors({});
}, [state.revision, basedOn, status]);          // 依赖数组
```

**实际输出**：

```
PASS i1-source-effect-deps :: deps=[state.revision,basedOn,status] 守卫=failed||saving
PASS i1-a1-success-bump-then-resolve :: passes=1 status=["saved"]
PASS i1-a2-success-resolve-then-bump :: passes=2 晚到 revision 变化不清 saved
PASS i1-b-fail-preserves-draft-and-message :: draft="5" status="writeFailed" passes=1
PASS i1-b2-retry-uses-fresh-revision :: revisions=[3,6]
PASS i1-c-edit-clears-status :: edit() -> status idle + message null -> 状态条消失
PASS i1-d1-external-revision-discards-draft-idle :: status=idle 时外部 revision 变化 -> 草稿丢弃 显示 Host 最新值 42
PASS i1-d2-external-revision-discards-draft-saved :: status=saved 时外部 revision 变化 -> 仍按 Host 最新值
PASS i1-contrast-guard-without-saving-fails :: 对照副本(仅排除 failed)：draft="10" saveDisabled=true -> 草稿被清 说明排除 "saving" 是必要的

SUMMARY total=9 pass=9 fail=0
```

对照任务要求的四条：

| 断言 | 结果 | 实测证据 |
| --- | --- | --- |
| (a) mutate 成功 + revision 递增后 status 仍为 `saved` | **通过** | 两种真实时序都测：`a1` 先 `acceptView` 再 resolve（`passes=1`，status=`saved`，成功后 save 变 disabled 证明草稿已清）；`a2` 先 `setStatus("saved")` 再晚到 revision 变化（`passes=2`，`saved` 未被清） |
| (b) mutate 返回 `false` → `message=writeFailed` 且草稿保留 | **通过** | `b`：`recover()` 先递增 revision（此刻 status 仍为 `saving`）再返回 false → 输入框仍为草稿 `"5"`、状态条 `writeFailed`、save 仍可点；`b2`：重试使用**新 revision 6**（首次 3）证明无闭包旧值 |
| (c) 保存成功后再次 edit 清掉状态提示 | **通过** | `c`：`edit()` 把 status 置 `idle`、message 置 null → `saved` 文案消失且状态 `<span>` 被移除 |
| (d) 外部 revision 变化且 status 非 failed → 草稿按 Host 最新值丢弃 | **通过** | `d1`（status=idle，Host 值 42）与 `d2`（status=saved，Host 值 77）都显示 Host 最新值、无 pending ops |
| 无死循环 | **通过** | 渲染 pass 数 1–2（上限 60），无级联 setState 循环 |
| 无闭包旧值 | **通过** | `b2` 重试 revision 从 3 正确变为 6；`a1` 的 mutate 收到点击时刻的 revision 3 |

**关于 `"saving"` 守卫的必要性（独立复现，非采信 notes）**：把 `client.js` 复制到临时文件、仅将守卫退化为 `if (status === "failed") return;` 后重跑 (b)：`draft="10" saveDisabled=true` —— 草稿在 `recover()` 引发的那次 revision 变化（status 仍为 `saving`）时被清空，失败提示场景丢输入。这证明 `|| status === "saving"` 是**载荷性**修复而非多余条件，也解释了为何"只排除 failed"不足。

## 附.2 回归 + S-2 + hint（10/10 通过）

**命令**：`node --check client.js` → `client.js exit=0`（另 `node --check index.js` → `exit=0`）

```
PASS r1-module-and-registration :: slot/key/locale/whileServed 未回归
PASS r2-unavailable-branches :: status!=='ready' / form undefined -> unavailable；summary 分支保留
PASS r3-eight-controls-and-constraints :: min/max/step = everyTurns[1,1000,1] maxSourceBytes[1,9007199254740991,1] maxInjectBytes[1,9007199254740991,1]
PASS r4-fields-vs-config-cross-check :: FIELDS === Config: everyTurns[1,1000,1] maxSourceBytes[1,9007199254740991,1] maxInjectBytes[1,9007199254740991,1]
PASS r5-out-of-range-blocked :: everyTurns="0"|"1.5"|"1001"|""|"abc" blocked | maxSourceBytes=9007199254740992 blocked | maxSourceBytes=0 blocked | maxInjectBytes=9007199254740992 blocked | maxSourceBytes=9007199254740991 accepted
PASS r6-save-and-reset-ops :: save=[{set,everyTurns,5},rev3] reset=8xunset
PASS r7-switch-writable-failure :: switch/writable=false/writeFailed 均未回归
PASS r8-source-hygiene :: 无 ui-primitives / 无字面色值
PASS s2-locale-title-unified :: en="AGENTS.md periodic inject" zh="AGENTS.md 周期注入" 与 client.js 页面标题逐字一致 两 JSON 合法
PASS s3-hint-upper-bound :: en.maxSourceBytesHint ok en.maxInjectBytesHint ok zh.maxSourceBytesHint ok zh.maxInjectBytesHint ok | keys=27 parity ok

SUMMARY total=10 pass=10 fail=0
```

- **8 控件 = 3 number + 5 switch**、8 行、`min/max/step` 由 `client.js` 的 `FIELDS` 与 `index.js` 的 `Config` **源码交叉解析逐项比对**（`r4`），全部一致。
- **S-2**：`locale/en.json` `meta.title` = `AGENTS.md periodic inject`，`locale/zh.json` = `AGENTS.md 周期注入`，与 `client.js` 字典 `en.title` / `zh.title` **逐字一致**；两 JSON 均 `JSON.parse` 通过，`meta.description` 仍非空。
- **hint 上界**：`maxSourceBytesHint` / `maxInjectBytesHint` 的中英四条都含 `9007199254740991` 与 `Number.MAX_SAFE_INTEGER`；字典 27 键 `en`/`zh` 仍一一对应。
- 未回归：save 发 `set` + revision、reset 发 8 个 `unset`、越界拦截、`writable=false` 只读、`status!=='ready'` 渲染 `unavailable`、summary 分支。

## 附.3 D2（T6）复验（5/5 通过）

**命令**：从当前 `index.js` 源码抽出 `Config`，用真实 `schemastery 3.18.5` 执行 `Config(raw)`；再用改写说明符的 `index.js` 副本驱动真实运行路径。

```
PASS d2-schema-meta-max :: meta={step:1,min:1,max:9007199254740991} volatile=true
PASS d2-2pow53-rejected :: maxSourceBytes 2**53 -> ValidationError: $.maxSourceBytes expected number <= 9007199254740991 but got 9007199254740992 | maxInjectBytes 2**53 -> ValidationError: $.maxInjectBytes expected number <= 9007199254740991 but got 9007199254740992
PASS d2-2pow53minus1-accepted :: 2**53-1 accepted -> 9007199254740991 / 9007199254740991 (SafeInteger=true)
PASS d2-boundaries-unchanged :: maxSourceBytes:0 -> rejected | -1 -> rejected | 1 -> ACCEPTED(1) | 1048576 -> ACCEPTED(1048576) | 1.5 -> rejected | everyTurns:1000 -> ACCEPTED | everyTurns:1001 -> rejected
PASS d2-runtime-2pow53minus1-injects :: maxSourceBytes=2**53-1 -> turn 11 正常注入 0 读取告警（旧版此处为 read-error）；仅降级告警 ["agents-md-inject: dsh-home-paths unavailable, falling back to $DSH_HOME or ~/.dsh","agents-md-inject: createUserMessage unavailable  using manual message construction"]

SUMMARY total=5 pass=5 fail=0
```

即：**D2 已闭环** —— `2**53` 现在被 Host schema 拒绝（不再是"接受后运行时 read-error"），`2**53-1`（`Number.MAX_SAFE_INTEGER`）接受且运行路径正常注入；`min(1)` 与 `step(1)` 的既有边界未变。

## 附.4 越界改动核对（15/15 通过）

**方法**：用 T4 报告 §1 记录的 7 个文件 SHA256 作为基线，对当前文件做**反向还原**后重算哈希比对（比 `git diff --stat` 更精确：`client.js` 是未跟踪文件，git 无法给出基线）。

```
PASS lib/logic.js 未变 (now=A90390E4F39E853A t4=A90390E4F39E853A)
PASS package.json 未变 (now=FF083F2D70222D8C t4=FF083F2D70222D8C)
PASS cordis.patch.yml 未变 (now=E653D1F24DFFDB5E t4=E653D1F24DFFDB5E)
PASS index.js 恰有 2 处 .max(Number.MAX_SAFE_INTEGER) (实际 2)
PASS index.js === T4 + 仅 2 处 .max 插入 (reconstructed=954DF5CF8FAFC93E t4=954DF5CF8FAFC93E)
PASS 还原片段命中 1 次 ×7 (effect 块 / 4 条 hint / FIELDS 2 处 max)
PASS client.js 反推 === T4 (reconstructed=C7131A39EE3B105A t4=C7131A39EE3B105A)
PASS locale/en.json 有改动 (now=1859CC3335C080C2 t4=D6C408EDCD1F909A) → T7 S-2 预期内
PASS locale/zh.json 有改动 (now=87405E2347D0E576 t4=94866E71DA043CD8) → T7 S-2 预期内

SUMMARY total=15 pass=15 fail=0
```

**结论**：
- `index.js` 相对 T4 **只多了 2 处 `.max(Number.MAX_SAFE_INTEGER)`**（去掉这两处后哈希逐字节等于 T4 的 `954DF5CF8FAFC93E`）—— 即 T6 的 D2 修复，属预期改动；**T7 未再改动 `index.js`**。
- `client.js` 相对 T4 **只有 7 处已记录改动**（1 个 effect 块、4 条 hint、2 处 `FIELDS` 上界），去掉后哈希逐字节等于 T4 的 `C7131A39EE3B105A`。
- `lib/logic.js` / `package.json` / `cordis.patch.yml` 与 T4 **逐字节相同**，无越界改动。
- `locale/*.json` 的改动即 T7 的 S-2（`meta.title`）+ T3 的 `meta.description`，属预期。

## 附.5 T7 复验结论与未验证项

**结论**：I-1 四条断言全部通过，且 `"saving"` 守卫经对照实验证明必要；S-2 中英标题已统一并与页面标题逐字一致；hint 上界已补；T4 的 8 控件/约束/写入 ops/越界拦截/只读/不可用态无回归；D2 已由 T6 闭环；T7 未越界改动 `index.js` / `lib/logic.js` / `package.json` / `cordis.patch.yml`。**未发现新缺陷**。

**未验证项（与 T4 相同，仍需运行时）**：
1. **I-1 的真实浏览器表现**：结论来自伪 React 运行时 + 时序探针（含两种真实时序与对照实验），**非真实 React 调度器/浏览器**；真实环境下的批处理顺序、`useEffect` 提交时机未验证。
2. **页面渲染本身**：Configure 控件、8 控件布局、中英切换、明暗主题 —— 仍未验证（未安装运行）。
3. **写入链路端到端**：`mutate` 与真实 `ConfigFormController`/`remote.settings` 的联调（本复验用的是符合官方 `{state, mutate}` 契约的假 form）未验证。
4. **link 安装 + 重启 + 刷新**：仍未执行（审批通道禁用，由 Lead 负责）。

