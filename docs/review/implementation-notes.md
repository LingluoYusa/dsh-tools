# dsh-ami 配置页改造 实现说明（task-3）

实现者：developer。依据 `docs/research/settings-page-findings.md`（T1）与 `docs/design/settings-page-design.md`（T2）。
本次只改源码与本文档，未调用 `plugin_manager`（安装/生效由 Lead 负责）。

## 1. 改动文件清单

| 文件 | 类型 | 摘要 |
| --- | --- | --- |
| `lib/logic.js` | 改 | 新增私有 `unwrap` 与导出 `resolveSettings`；`resolveEveryTurns` 改为复用 `unwrap` |
| `index.js` | 改 | `Config` 8 字段全 `.volatile()`；11 处读取点改为现读 `resolveSettings()`；pre-step 增加 `enabled` 闸门 |
| `client.js` | 新增 | Client 半边 注册 `plugins.row.config` 全参数表单 |
| `package.json` | 改 | 新增 `exports["./client"]`、`files` 里的 `client.js`、`dsh.client` |
| `locale/en.json` | 改 | 只改 `meta.description` 提到可在 Plugins 页改全部参数 |
| `locale/zh.json` | 改 | 同上（中文） |
| `README.md` | 改 | 第 5 节重写、第 6 节表格与注意、第 7 节、第 9 节 U5、第 10 节、附录第 6/8 条与新增第 9 条 |
| `cordis.patch.yml` | **未改** | 8 字段完整覆盖语义保持（`git diff` 为空） |

## 2. 关键 diff 摘要

### 2.1 `lib/logic.js`（具名导出 18 → 19，仍为零 import）

```js
const unwrap = (value, isVolatileFn) =>
  typeof isVolatileFn === "function" && isVolatileFn(value) ? value.get() : value;

export function resolveSettings(raw, isVolatileFn) {
  return { enabled: unwrap(raw?.enabled, isVolatileFn), /* … 8 个字段 … */ };
}
```

- `resolveEveryTurns` 保留为薄包装，行为不变（既有回归断言不破）。
- `planInjection` / `buildInstructionText` / `canRegisterForAgent` **签名与实现完全未动** —— 调用方传已解包的普通值即可。

### 2.2 `index.js`

- `Config`：8 个字段全部 `.volatile()`。
- `apply` 内新增读取器（**不缓存结果**，volatile 变更不重挂载 `apply`）：

```js
const readSettings = () => resolveSettings(config, deps.isVolatile ?? fallbackIsVolatile);
```

- `registerForAgent(ctx, readSettings, …)`：参数由 `config` 换成函数；pre-step 顶部 `const settings = readSettings()` 后先判 `settings.enabled !== true` 再判命中轮号（关掉主开关对已存在 agent 立即生效）。
- `agent/created`：`const settings = readSettings()`；`enabled` / `includeSubagents` / `canRegisterForAgent` 全部改用解包后的值。
- `readAgentsMd` / `buildMessage` 形参改名 `settings`，内部读 `settings.maxSourceBytes` / `settings.wrapSystemReminder`。
- 失败语义、`warnOnce` 节流、双水位线、生命周期闸门与清理逻辑**未动**。

### 2.3 `client.js`（新增，324 行）

- 入口 `window.__ModuleLoader__.load({ id: "dsh-ami", factory(require) { … } })`，只 `require("react")`，**不 require `@deepseek-ai/dsh-client-ui-primitives`**（自绘控件）。
- `inject = ["slots", "locale", "configForms"]`。
- 字典：`ctx.locale.bind("settings.dshAmi")` + `ctx.effect(() => ctx.locale.register("settings.dshAmi", { zh, en }), …)`，zh/en 键一一对应（已用脚本校验）。
- 注册：

```js
ctx.effect(() => ctx.configForms.whileServed(["dsh-ami"], () =>
  ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register({ name: "plugins.row.config", key: "dsh-ami#dsh-ami", locale: "settings.dshAmi" },
      DshAmiRowConfig))), "dsh-ami: row config page");
```

- 组件两个 view 分支：`summary` 返回一行文本；`page` 在 `form === undefined` 或 `form.state.status !== "ready"` 时渲染 `unavailable`，否则渲染表单。
- 8 行控件：布尔用自绘 `role="switch"` 开关，数字用 `<input type="number">` 且 `min` / `max` / `step` 与 `Config` 逐项一致（`everyTurns` 1..1000 step 1；`maxSourceBytes` / `maxInjectBytes` min 1 step 1）。
- 写入：本地草稿 + 显式保存，`form.mutate(ops, form.state.revision)`；复位 8 个 `{ op: "unset", path: [key] }`；`false` 与 reject 都走状态条 `writeFailed` 并保留草稿。
- 客户端预校验用 `Number.isSafeInteger` + min/max，失败时字段下提示且禁用保存；Host 侧仍由完整 schema 兜底。
- 样式只用 `--dsw-alias-*` token（含 `--dsw-alias-switch-thumb` / `--dsw-alias-button-primary-fill` / `--dsw-alias-label-primary-foreground`，均已从 `dsh-client-ui-theme` 的 token 表核对存在），无字面色值。

### 2.4 `package.json`

```jsonc
"exports": { ".": "./index.js", "./client": "./client.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
"files": ["index.js", "client.js", "lib/logic.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-plugin-manager"] }
}
```

`dsh.bundle.patch` 未动。与官方 `dsh-client-ui-settings-agent-loop/package.json` 的 `dsh.client` 段同构（已从 app.asar 解出核对）。

## 3. 11 处 `config.*` 读取点覆盖表

| # | 位置 | 改法 | 状态 |
| --- | --- | --- | --- |
| 1 | `index.js` 原 102 `config.maxSourceBytes` | `readAgentsMd(ctx, settings, …)` 读 `settings.maxSourceBytes` | 已覆盖 |
| 2 | `index.js` 原 142 `config.wrapSystemReminder` | `buildMessage(…, settings, …)` 读 `settings.wrapSystemReminder` | 已覆盖 |
| 3 | `index.js` 原 161 `config.everyTurns` | 经 `settings.everyTurns`（原 `resolveEveryTurns` 已解包） | 已覆盖 |
| 4 | `index.js` 原 179 `config.onlyIfChanged` | `settings.onlyIfChanged === true` | 已覆盖 |
| 5 | `index.js` 原 229 `config.enabled` | pre-step 与 `agent/created` 双处 `settings.enabled !== true` | 已覆盖（并新增 pre-step 闸门） |
| 6 | `index.js` 原 231 `config.includeSubagents` | `settings.includeSubagents === true` | 已覆盖 |
| 7 | `index.js` 原 165 整 config 传递 | 改传 `settings` | 已覆盖 |
| 8 | `index.js` 原 173 整 config 传递 | 改传 `settings` | 已覆盖 |
| 9 | `lib/logic.js` 66-67 `maxInjectBytes` | 由调用方传已解包 `settings`（函数体未动） | 已覆盖 |
| 10 | `lib/logic.js` 73 `truncateOversize` | 同上 | 已覆盖 |
| 11 | `lib/logic.js` 116-117 `enabled` / `includeSubagents` | 同上（`canRegisterForAgent(settings, …)`） | 已覆盖 |

复核命令：`ops_grep pattern="config\." path=index.js` 与 `path=lib/logic.js` —— 前者零命中；后者 5 处均为纯函数形参 `config`，其调用方已传解包值。

## 4. 语法检查结果

```
> node --check client.js
client.js exit=0
> node --check index.js
index.js exit=0
> node --check lib/logic.js
lib/logic.js exit=0
> node -e "JSON.parse(...)"  # package.json / locale/en.json / locale/zh.json
json ok package.json
json ok locale/en.json
json ok locale/zh.json
```

（`node` 为 `D:\NVM\Nodejs\node.exe` v22.21.0。）

## 5. 自测结果（临时脚本，跑完已删除）

纯函数回归（对应 T2 §8.1）：

```
ok A1 wrapped===bare / ok A1 mixed / ok A2 eight keys / ok A3 missing undefined
ok A4 int / ok A4 float NaN / ok A5 planInjection equal / ok A6 disabled
ok A7 opt-in / ok A8 no wrapper / ok A9 export count 19 (19)
ALL PASS
```

`client.js` 结构自测（用假 `window.__ModuleLoader__` + 假 ctx 捕获注册）：

```
ok loader id / ok inject / ok dict ns / ok dict key parity / ok slot name / ok slot key
ok slot locale / ok whileServed ns / ok field count 8 / ok all used keys present ()
ok summary branch / ok page without form / ok page with form / ok form is component
ALL PASS
```

表单行为自测（极简 hooks 运行时 + 假 form）：

```
ok 3 number inputs / ok 5 switches / ok 8 field rows
ok everyTurns attrs (min1 max1000 step1) / ok maxSourceBytes attrs / ok maxInjectBytes attrs
ok save disabled with no changes / ok save enabled after edit / ok input shows draft
ok float blocks save / ok field error shown / ok out of range blocks save
ok mutate set everyTurns 5 / ok mutate revision 3
ok switch aria off / ok switch writes nothing yet / ok mutate set onlyIfChanged true
ok reset unsets 8 / ok failure message shown
ALL PASS
```

## 6. 如何验证（运行时，需 Lead 先做前置）

前置（T2 §7）：把 profile 里 `github:` 复制安装改为工作区 link 安装（`install_bundle` 指向 `D:\YhhCode\MyProject\dsh-ami`），然后**重启 DSH 进程**并**刷新浏览器页面**。Host 侧改动必然需要重启；Client 侧保守同样重启。

1. **命名空间已服务**：页面 console 读 `ctx.configForms.describe().getSnapshot().view.namespaces.map(n => n.ns)` 应含 `dsh-ami`；该项 `value` 应有 8 个键。
2. **入口可达**：侧栏 Plugins → Installed plugins → dsh-ami → 行 `dsh-ami` 标题上出现 Configure 控件（`aria-label` 为「配置 dsh-ami」/「Configure dsh-ami」）；点击进入配置页。
3. **8 个控件**：中文标签 8 个，切英文后变英文；控制台无 `slot entry crashed in 'plugins.row.config'`。
4. **写入**：改 `everyTurns` 为 5 保存 → profile patch 该 entry 的 `config` 含完整 8 字段且 `everyTurns: 5`；不重启会话下一个命中轮号按 5 注入。
5. **复位**：点「恢复默认值」→ patch 行 `config` 键被删除（回落继承层），页面显示 shipped 默认。
6. **主开关**：关 `enabled` → 已存在 agent 下一个命中轮号不注入不读盘；重开恢复（验证新增的 pre-step 闸门）。
7. **校验**：输入 `0` / `1.5` / `1001`（everyTurns）与 `2**53`（maxSourceBytes）→ 客户端阻止保存并提示。
8. **边界**：双窗口同时改同一字段 → 后写者 `mutate` 返回 `false`，状态条提示且页面刷新为最新值；关闭 bundle → Configure 控件消失。

## 7. 遗留问题与未决项

| # | 内容 | 处置 |
| --- | --- | --- |
| R1 | 本会话审批通道禁用，**link 安装与重启未执行**，因此页面与 Host 运行时均**未实测** | 由 Lead 执行 T2 §7 步骤后由 tester 按 §8 验收 |
| R2 | `plugins.row.config` 的注册 key `dsh-ami#dsh-ami` 依据 T2 §3.1 与 Lead 的 `list_bundles` 实证，未在 live 页面复核 | 验收第 2 步确认 |
| R3 | `form.state.status === "loading"` 期间按设计渲染 `unavailable` 文案（可能是极短暂闪烁） | 若体验不佳可改为 loading 占位 |
| R4 | 包根 `locale/*.json` 不进 Client 字典（无该管线），UI 文案全在 `client.js` 内联字典 | 已按 T2 §5.4 处理，仅更新 `meta.description` |
| R5 | `--dsw-alias-state-error-primary` 等 token 已从 `dsh-client-ui-theme` 的 token 表核对存在，但未在真机主题下目视确认明暗配色 | 验收第 3 步顺带确认 |
| R6 | 首次保存后 profile patch 固化 8 字段，此后 bundle 升级改默认值不再自动生效 | 已在 README 第 6 节写明，用户可点「恢复默认值」回落 |

## 8. D2 修复（task-6）

T4 报出的低危缺陷 D2：`maxSourceBytes` / `maxInjectBytes` 只有 `.step(1).min(1)`，schema 接受 `2**53` 这类超出安全整数的值；运行时 `index.js:102-103` 的 `Number.isSafeInteger(limit)` 抛 `invalid source limit` → 收敛为 `read-error` → 每个命中轮号静默不注入。页面已拦截该输入，只有绕过页面的写入路径可达。

### 8.1 改动行

| 文件 | 行 | 改动 |
| --- | --- | --- |
| `index.js` | 30 | `maxSourceBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576).volatile(),` |
| `index.js` | 31 | `maxInjectBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384).volatile(),` |
| `client.js` | 81 | `{ key: "maxSourceBytes", kind: "number", min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },` |
| `client.js` | 82 | `{ key: "maxInjectBytes", kind: "number", min: 1, max: Number.MAX_SAFE_INTEGER, step: 1 },` |
| `README.md` | 68-69 | §6 表格两行取值域改为「字节 1 – `Number.MAX_SAFE_INTEGER` 整数」 |
| `README.md` | 77 | §6 注意段新增一段：说明两个字节上限字段声明 `.max(Number.MAX_SAFE_INTEGER)` 的原因（否则写入 `2**53` 会静默降级为 `read-error`） |

未改其他字段与其他文件；`cordis.patch.yml` 未动。`everyTurns` 的 `.max(1000)` 与其余 6 个字段原样保留。

### 8.2 语法检查

```
> node --check index.js
index.js exit=0
> node --check client.js
client.js exit=0
```

### 8.3 真实 schemastery 断言

profile 里 `@deepseek-ai/schemastery` 是 3.18.5。用临时 ESM resolve hook 把裸包名映射到
`C:\Users\15068\.dsh\profiles\desktop\node_modules\@deepseek-ai\schemastery\lib\index.mjs`，
再 `import { Config } from "./index.js"` 直接断言（未在工作区创建 `node_modules`）：

```
> node --import ./.tmp-d2-register.mjs ./.tmp-d2-test.mjs
maxSourceBytes resolved = 9007199254740991
ok volatile wrapper confirmed
ok maxSourceBytes 2**53 rejected
ok maxSourceBytes 2**53-1 accepted
ok maxInjectBytes 2**53 rejected
ok maxInjectBytes 2**53-1 accepted
ok maxSourceBytes 0 rejected
ok maxSourceBytes 1.5 rejected
ok maxInjectBytes 0 rejected
ok defaults kept
ok maxSourceBytes 1 accepted
ok everyTurns 1001 still rejected
ok everyTurns 1000 accepted
ALL PASS
```

顺带确认：`Config({...})` 返回的字段确实是 volatile 包装对象（`{ get }`），断言需 `.get()` 取值。

### 8.4 client.js 侧一致性

```
> node ./.tmp-d2-client.mjs
ok maxSourceBytes max
ok maxSourceBytes min/step
ok maxInjectBytes max
ok maxInjectBytes min/step
ok everyTurns untouched
ALL PASS
```

渲染出的 `<input type="number">` 现在带 `max="9007199254740991"`，与 `Config` 的 `.min()/.max()/.step()` 逐项一致。

### 8.5 验证方式（运行时）

页面输入 `9007199254740991`（= `Number.MAX_SAFE_INTEGER`）应可保存；输入 `9007199254740992`（= `2**53`）应被客户端 `Number.isSafeInteger` 拦下并提示 `invalidNumber`。绕过页面的写入路径（直接 `settings.mutate`）现在会被 Host schema 拒绝，不再产生 `read-error` 静默降级。

临时脚本（`.tmp-d2-loader.mjs` / `.tmp-d2-register.mjs` / `.tmp-d2-test.mjs` / `.tmp-d2-client.mjs`）跑完已删除。

## 9. I-1 / S-2 修复（task-7）

T5 审核放行的条件下修复：1 项重要缺陷 I-1 + 1 项用户可见建议 S-2 + T6 遗留的 hint 上界。

### 9.1 I-1 写后状态反馈（client.js）

原 `client.js` 的 revision effect 里有 `setStatus("idle"); setMessage(null);`，而写入成功必然使 Host revision 递增，于是「已保存」提示刚设置就被自身 effect 清掉；失败冲突路径还会 `setDraft(null)` 丢掉用户草稿，违反设计 §5.3「失败保留草稿并提示」。

修复后的 effect（`client.js:191-199`）：

```js
// revision 变化说明 Host 值已更新 只在未失败且非写入中时丢弃草稿
React.useEffect(() => {
  if (state.revision === basedOn) return;
  setBasedOn(state.revision);
  // 失败或写入中保留草稿 否则会丢用户输入与失败提示
  if (status === "failed" || status === "saving") return;
  setDraft(null);
  setErrors({});
}, [state.revision, basedOn, status]);
```

- 删除 `setStatus("idle")` / `setMessage(null)`：状态改由 `edit()` 在用户继续编辑时清除。
- 清草稿与清错误只在未失败时执行；`status` 加入依赖数组；保留 `state.revision === basedOn` 守卫防死循环。

**相对 T7 指示的一处加固（需留意）**：T7 写的是「仅在 `status !== "failed"` 时清草稿」，实现里多排除了 `status === "saving"`。原因是失败路径的真实时序：`ConfigFormController.mutate` 在 `response.ok === false` 时先 `await this.recover()`（重读 Host → revision 递增）再 `return false`，因此 **revision 变化先发生、`setStatus("failed")` 后发生**。若只排除 `"failed"`，effect 会在 `status === "saving"` 时就把草稿清掉，冲突场景仍会丢草稿（实测确认：见 9.3 的对照实验，该写法下 (b) 断言失败）。排除 `"saving"` 不产生副作用：成功路径本来就在 `save()` 里显式 `setDraft(null)`。

### 9.2 S-2 locale 标题统一 + hint 上界

| 文件 | 行 | 改动 |
| --- | --- | --- |
| `locale/zh.json` | 3 | `meta.title` `"AGENTS回声"` → `"AGENTS.md 周期注入"` |
| `locale/en.json` | 3 | `meta.title` `"dsh-ami"` → `"AGENTS.md periodic inject"` |
| `client.js` | 25 | `maxSourceBytesHint` 补上界：`Integer 1 - 9007199254740991 (Number.MAX_SAFE_INTEGER).` |
| `client.js` | 27 | `maxInjectBytesHint` 补上界：同上 |
| `client.js` | 55 | `maxSourceBytesHint` 补上界：`整数 1 至 9007199254740991（Number.MAX_SAFE_INTEGER）。` |
| `client.js` | 57 | `maxInjectBytesHint` 补上界：同上 |

两个 `meta.title` 现在与配置页标题（`client.js` 的 `en.title` / `zh.title`）逐字一致；两个 `description` 保留原措辞。README §6 已有上界说明，按要求未动。

### 9.3 自测（伪 React 探针，跑完已删）

`node ./.tmp-i1-test.mjs`：

```
ok (d) zh/en key parity
ok (c) en maxSourceBytesHint has bound / ok (c) en maxInjectBytesHint has bound
ok (c) zh maxSourceBytesHint has bound / ok (c) zh maxInjectBytesHint has bound
ok (a) save enabled after edit / ok (a) saving shown / ok (a) saved shown after resolve
ok (a) saved survives revision change / ok (a) saved survives second render
ok (a) edit clears status
ok (b) saving shown during failed write / ok (b) draft kept while saving
ok (b) writeFailed shown / ok (b) draft kept after failure
ok (b) no idle overwrite / ok (b) mutate called once
ok S-2 en title / ok S-2 zh title
ALL PASS
```

(b) 的时序刻意构造成「revision 递增发生在 mutate 返回 false 之前」，以复现 `recover()` 的真实顺序。

**对照实验（证明测试有效）**：把 effect 临时还原为修复前的写法重跑同一脚本，得到 5 处失败 ——
`(a) saved survives revision change`、`(a) saved survives second render`、`(b) saving shown during failed write`、`(b) draft kept while saving`、`(b) draft kept after failure`；恢复修复版后重新全绿。

### 9.4 语法与 JSON 检查

```
> node --check client.js
client.js exit=0
> node -e "JSON.parse(fs.readFileSync(f))"   # locale/en.json / locale/zh.json
json ok locale/en.json title=AGENTS.md periodic inject
json ok locale/zh.json title=AGENTS.md 周期注入
```

### 9.5 未改文件

`index.js` / `lib/logic.js` / `package.json` / `cordis.patch.yml` / `README.md` 本次均未改动。

临时脚本 `.tmp-i1-test.mjs` 跑完已删除。

## 10. T9 探针与双挂载点（task-9）

### 10.1 现场事实（Lead 实测）

Desktop 端 Plugins 页里官方配置卡片（Subagent / Web search / Agent loop / Shell）都正常，唯独 dsh-ami 的 bundle 详情页完全没有配置 UI；浏览器实时槽位树里 `plugins.row.config` 的 `keyDomain` 仍是 "none are taken yet"。说明页面 client 模块图、`configForms` 与 slot 机制都正常，问题只在 dsh-ami 的 client 半边没有执行到注册那一步。Host 侧已排除（`dsh.client` 声明、`client.js` 存在且逐字节一致、组合器定位、三个 inject 依赖包都合规）。

### 10.2 改动（只改 client.js）

| 行 | 改动 |
| --- | --- |
| `client.js:3` | 新增脚本执行期探针 `console.info("[dsh-ami] client bundle script executed");`（在 `window.__ModuleLoader__.load(...)` 之前） |
| `client.js:7` | factory 内第一行探针 `console.info("[dsh-ami] factory materialized");` |
| `client.js:185` | `DshAmiForm` 的 `state` 改为由卡片订阅后经 props 传入（原来是 `form.state`） |
| `client.js:295-313` | 新增 `makeCard(form)`：卡片自持 controller，`React.useState(() => form.getSnapshot())` + `React.useEffect` 内 `setState(form.getSnapshot())` 与 `return form.subscribe(...)`；**忽略 owner 传入的 `props.form`**；hooks 全部在任何早返回之前调用 |
| `client.js:317-329` | `apply`：新增 apply 探针；`const form = ctx.configForms.get(NS)` 自持 controller；`mount(name, key)` 统一 `ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({name, key, locale}, Card)))`；挂 `plugins.bundle.config`（key `dsh-ami`）与 `plugins.row.config`（key `dsh-ami#dsh-ami`）两个槽 |

- **去掉了 `ctx.configForms.whileServed([NS], ...)` 包裹**，改为直接注册：dsh-ami entry 常驻 active，命名空间必然被 serve；去掉后消除一个"条件不满足就什么都不发生"的静默失败点。不可用态改由卡片按 `state.status !== "ready"` 自行渲染。
- **自持 controller 不 dispose**：`configForms.get(ns)` 返回的是 provider 共享拥有的 `ConfigFormController`，调用方只释放自己的订阅（effect 返回的 disposer）。卡片内没有任何 `form.dispose()` 调用。
- 双挂载点渲染同一个 `Card` 组件；`plugins.bundle.config` 的 key 就是 bundle 包名 `dsh-ami`，`plugins.row.config` 的 key 是 `<包名>#<rowId>`。
- 保留既有全部能力：8 控件（3 number + 5 switch）、`min`/`max`/`step` 校验、保存/复位、I-1 修复后的状态反馈、中英字典、`--dsw-alias-*` 主题 token。

### 10.3 自测（伪 React 探针，跑完已删）

`node ./.tmp-t9-test.mjs`（覆盖 a/b/c/d 四组）：

```
ok (d) script probe once / ok (d) factory probe once / ok (d) apply probe once / ok (d) probe order
ok (a) two registrations / ok (a) bundle.config key / ok (a) row.config key
ok (a) both locale / ok (a) same component / ok (a) slots.inject both
ok (a) whileServed not used / ok (a) self-owned ns
ok (c) loading renders unavailable / ok (c) owner props.form ignored / ok (c) summary branch
ok (b) subscribed once / ok (c) ready renders form / ok (b) 8 field rows
ok (b) 3 number inputs / ok (b) 5 switches
ok (b) mutate ops+revision / ok (b) saved survives revision change
ok (b) reset 8 unset / ok (b) reset revision
ok (b) failure keeps draft / ok (b) failure shows writeFailed
ok (b) form.dispose never called / ok (b) unsubscribed on unmount / ok (b) dispose still 0 after unmount
ALL PASS
```

要点：`owner props.form` 故意传入一个 `getSnapshot()` 会抛错的假对象，卡片仍正常渲染 → 证明已完全忽略它；卸载时只取消订阅（`listeners.size === 0`）且 `dispose` 计数恒为 0。

### 10.4 语法与 locale 检查

```
> node --check client.js
client.js exit=0
> node -e "JSON.parse(...)"   # locale 未改 仅回归
locale json ok AGENTS.md 周期注入 | AGENTS.md periodic inject
```

### 10.5 未改文件与探针去留

`index.js` / `lib/logic.js` / `package.json` / `locale/*` / `cordis.patch.yml` / `README.md` 本次均未改动。三处 `console.info` 探针是**临时定位用**，按 T9 要求保留在本次提交中，待重装验证通过后由后续任务移除。临时脚本 `.tmp-t9-test.mjs` 跑完已删除。

## 11. T10 探针移除（task-10）

用户已在 Desktop 端确认配置 UI 出现，T9 修复有效。三处临时 `console.info` 探针按计划移除。

### 11.1 删除的行（T9 提交版行号）

| 行 | 内容 |
| --- | --- |
| `client.js:3` | `console.info("[dsh-ami] client bundle script executed");`（脚本执行期） |
| `client.js:7` | `console.info("[dsh-ami] factory materialized");`（factory 第一行） |
| `client.js:316` | `console.info("[dsh-ami] apply invoked");`（apply 第一行） |

删除方式为整行删除，未改动任何相邻代码；`client.js` 由 333 行变为 330 行，`git diff --stat` 为 `3 deletions`。

### 11.2 结构完整性自查（删除后）

```
> Select-String -Path client.js -Pattern 'whileServed|makeCard|form.subscribe|configForms.get|mount\("|form.dispose'
294     function makeCard(form) {
301           return form.subscribe(() => setState(form.getSnapshot()));
319       const form = ctx.configForms.get(NS);
320       const Card = makeCard(form);
324       mount("plugins.bundle.config", NS);
325       mount("plugins.row.config", ROW_KEY);
```

- 自持 controller：`configForms.get(NS)` 保留；`form.subscribe` 保留；**无 `form.dispose` 命中**（只订阅不释放共享 controller）。
- 双挂载点：`plugins.bundle.config`（key `NS` = `dsh-ami`）与 `plugins.row.config`（key `ROW_KEY` = `dsh-ami#dsh-ami`）均在。
- **无 `whileServed` 命中**：T9 的直注册写法保持。
- 8 控件与校验、保存/复位、I-1 状态反馈、中英字典、主题 token 均未触碰（本次 diff 仅 3 行删除）。

### 11.3 无 console 残留

```
> Select-String -Path client.js -Pattern 'console\.' -AllMatches
console. hits = 0
```

### 11.4 语法检查

```
> node --check client.js
client.js exit=0
```

### 11.5 未改文件

`index.js` / `lib/logic.js` / `package.json` / `locale/*` / `cordis.patch.yml` / `README.md` 本次均未改动。
