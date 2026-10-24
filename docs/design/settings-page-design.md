# dsh-ami 全参数配置页 设计（task-2）

> 交付物：本文件。读者：developer（照做即可开工）、tester（按 §8 验收）。
> 依据：`docs/research/settings-page-findings.md`（task-1，711 行）+ 本轮实读的工作区源码与 app.asar 内产物 + Lead 亲自核实的 ui-plugin-manager 证据。
> 约束：本文只给设计，不改任何源码。

## 0. 结论摘要

- **推荐方案 A**：`Config` 8 个字段**全部** `.volatile()`；同步改造 11 行 `config.*` 读取点；新增 Client 半体 `client.js`，注册到 **`plugins.row.config`**（key = **`dsh-ami#dsh-ami`**），表单由页面 owner 通过 props 提供。
- 一句话理由：官方设置写通道只允许 volatile 路径（`dsh-settings/lib/index.js:507,520`），表单也只投影 volatile 字段（`:122-131`），且 `autoGenerate` 无任何 shipped 客户端消费（`dsh-settings/README.md:39`）—— 所以"全部参数可编辑"在官方机制下只有"全字段 volatile + 自建 Client 页"这一条路。
- **用户可达路径**：侧栏 **Plugins** → Installed plugins → **dsh-ami** → 行 `dsh-ami` 的 **Configure** 控件 → 打开配置页。**不在** Settings 面板里（官方机制原话："A plugin that carries its own configuration renders it on this page rather than in Settings"）。bundle 关闭时该行不显示 Configure 控件。
- 硬阻塞：profile 里 dsh-ami 是 github tarball 的**复制安装**，改工作区**不生效**，必须改成本地 link 安装并重启 DSH 进程（§7）。

---

## 1. 事实基线

### 1.1 工作区源码

| 事实 | 位置 |
| --- | --- |
| `Config` 8 字段，仅 `everyTurns` 带 `.volatile()` | `index.js` L27-L36（L29） |
| `config` 被闭包捕获：`apply` / `registerForAgent` / `readAgentsMd` / `buildMessage` | `index.js` L215、L150、L94、L139 |
| volatile 判定兜底（duck-type `{get}`） | `index.js` L69 |
| `deps.isVolatile` 惰性加载 + 降级 | `index.js` L50-L60 |
| 唯一已解包读取点 `resolveEveryTurns` | `index.js` L161 + `lib/logic.js` L59-L62 |
| `lib/logic.js` 零 import 纯逻辑，18 具名导出 | `lib/logic.js` L1；`README.md` L151 |
| 无 `dsh.client`、无 `./client` 导出 | `package.json` L7-L11、L28-L32 |
| patch 写全 8 字段，insert 行 `id: dsh-ami` | `cordis.patch.yml` L1-L12 |
| 包 locale 只有 `meta.title` / `meta.description` | `locale/en.json` L2-L5、`locale/zh.json` L2-L5 |
| README 第 5 节声称"设置表单只暴露 everyTurns" | `README.md` L44-L48 |

### 1.2 Host 设置服务与写入链（T1 §1.2/§2/§4，行号为 `dsh-settings/lib/index.js`）

| 事实 | 行号 |
| --- | --- |
| `volatileForm(schema)`：只投影 volatile 字段；无 volatile 的 entry 不进 `describe()` | L118-L131、L419 |
| `describe()` 描述符 `{ autoGenerate, ns, schema, revision, applies:"live", value, base, user }`；**`ns = entry.options.id`** | L413-L464（L426、L432、L436-L439、L443、L446） |
| `update` / `replace` / `mutate(ops, revision)`；ops = `{op:"set"|"unset", path:[...], value?}` | L470-L473、L479-L482、L488-L500 |
| `write`：非 volatile 路径抛 `Config field "X" is not volatile`；revision 不符抛 `SettingsConflictError`（`code = SETTINGS_CONFLICT`） | L501-L537（L507、L511、L520）、L163-L181 |
| `get writable()` 恒 `true` | L396-L398 |
| `config-editor.edit`：先把新值 `resolveConfig(fiber.runtime, resolved)` 提交进**活配置**，再原子写 profile patch，最后 `reconcileProfilePatches`；失败回滚 | `dsh-config-editor/lib/index.js` L69-L135（L82-L83、L99-L110、L123、L125-L130） |
| `next` 与继承层深等时**删除** patch 行的 `config` 键 | 同上 L99-L104 |

### 1.3 volatile 的运行时契约（T1 §4.1/§4.2，**决定性**）

- 包装对象是 `Object.freeze({ get, [Symbol.for("cosmokit.volatile.write")] })`，解包**只能** `.get()`（`dsh-client-ui-settings/lib/client.js` L53-L69；Host 侧同源用法 `dsh-settings/lib/index.js` L98）。
- `@deepseek-ai/cordis-plugin-loader/README.md:51-53` 原文要点：volatile-only 变更时 `_commitVolatile` 把新值**提交进正在运行的引用**，**不重新调用 `apply`**，`config` 对象身份不变，并发出 `loader/volatile-update`。
- **推论**：闭包里的 `config` 长期有效；但**必须在使用点读 `.get()`**，不能把解包结果缓存成闭包常量。
- 限制：volatile 字段必须位于固定对象路径、祖先不能也是 volatile（`dsh-client-ui-settings/lib/client.js` L502-L513）——顶层 8 个字段各自 `.volatile()` 满足。

### 1.4 Client 表单 API（T1 §1.2/§1.3，`dsh-client-ui-settings/lib/client.js`）

| 事实 | 行号 |
| --- | --- |
| 服务键名 **`configForms`** | L1252、L1270 |
| `get(entryId)` → `ConfigFormController`（同一 entryId 返回同一 controller） | L1294-L1301 |
| `whileServed(namespaces, register)` → disposer，须用 `ctx.effect` 包裹 | L1315-L1334（JSDoc L1302-L1314） |
| 快照 `{ status: "loading"\|"ready"\|"unavailable", value, base, user, revision, writable }` | L1108-L1115、L1122、L1209-L1232 |
| `set(field,value)` / `unset(field)` / `mutate(ops, expectedRevision?)` → `Promise<boolean>`；串行队列；`!response.ok` 时 `recover()` 重读并返回 `false` | L1140-L1146、L1153-L1158、L1165-L1188 |
| 写走 **provider 的 ctx**（`remote.settings.mutate`），调用方**不需要**声明 `remote.settings` | L1258-L1263、L1170 |
| 页面 owner 暴露的 `form` 形状 = `{ state: form.getSnapshot(), mutate: (ops, revision) => form.mutate(ops, revision) }` | L3833-L3840（T1 引，同文件） |

### 1.5 注册点（T1 §2 + Lead 核实）

| slot | 声明者 | key 形式 | 是否传 `form` |
| --- | --- | --- | --- |
| `settings.plugins.tab` | ui-settings-plugins | 普通 list（id/order/label） | **不传**（props 只有 `{}` + `t` + inject 面） |
| `plugins.item` | ui-plugin-manager | 普通 list，id = Host entry id | 传（`view:'page'` 时；`formFor(openItem.id)`） |
| `plugins.bundle.config` | ui-plugin-manager | keyed by 包名 | **不传**（只 `{ view:'page' }`） |
| **`plugins.row.config`** | ui-plugin-manager | keyed by `<包名>#<rowId>` | **传**（`view:'page'` 时；`formFor(openRow.rowId)`） |

Lead 核实的具体位置（`ui-plugin-manager/lib/client.js`）：RowDetail 渲染 row config 传 `{ view:'page', form }`（L2818-L2821）；`form: formFor(openRow.rowId)`（L4143）；`formFor` 实现（L3833-L3840）；对照 `plugins.bundle.config` 只传 `{ view:'page' }`（L2964）、`plugins.item` 用 `formFor(openItem.id)`（L4180）。官方 README 原话：`plugins.row.config` "gives that row a **Configure** control opening the row's page"，且 "a bundle that is off shows no configure control"。

### 1.6 命名空间

**settings 命名空间 = `entry.options.id` = `dsh-ami`**（不是 `include:dsh-ami`）。证据链：`dsh-settings/lib/index.js` L432/L443/L502 用 `entry.options.id`；`dsh-config-editor/lib/index.js` L31-L34 保留 `entry.options.id` 并按它匹配 patch 行；profile 合成树 `C:\Users\15068\.dsh\profiles\desktop\cordis.yml` L1382-L1392 顶层行就是 `id: dsh-ami`；官方四页硬编码的命名空间（`bash-sandbox`、`agent-loop`、`subagent`）与 `cordis.yml` 的 patch 行 id 一一对应。`include:` 前缀只出现在只读 inventory 的展示层（`ui-settings-plugin-inventory/lib/client.js` L130-L132）。

### 1.7 安装与生效（T1 §6）

- profile 依赖是 `"dsh-ami": "github:LingluoYusa/dsh-ami"`（`…/profiles/desktop/package.json:21`），`node_modules\dsh-ami` 是**普通目录**，与工作区 4 个文件 SHA256 全等 → 改工作区无效。
- `plugin_manager install_bundle` 传工作区绝对路径 → 变成 `link:` 安装，此后改工作区即改实际加载代码；link 安装不受 `files` 过滤。
- 替换已安装包 / 改 Host 模块：**需要重启 DSH 进程**；client 改动保守做法是**重启 + 刷新页面**（`host-plugin.md` L70；`dsh-client-modules/README.md` L46、L78、L138）。
- 本会话审批通道禁用，**plugin_manager 动作无法执行**（T1 §6.4、§9 第 9 条）。

---

## 2. 方案选择

### 2.1 三个候选

| | A. 全字段 volatile + 自建 Client 页 | B. 只做 volatile 子集 | C. 自研 Host 写入通道 |
| --- | --- | --- | --- |
| 能否编辑 8 个参数 | 能 | **不能**（只有 `everyTurns` 是 volatile，其余字段在数据层就不存在） | 能 |
| 满足用户诉求 | 是 | 否 | 是 |
| 运行时语义影响 | 8 个字段变 `{get}` 包装 → 11 行读取点必须同步改造（漏一处即静默错值） | 无 | 同 A，且额外自研通道 |
| 改动量 | 中（Host 11 行 + 1 纯函数 + 新增 client.js） | 小但无意义 | 大 |
| 可维护性 | 高：持久化/revision/冲突/原子写/回滚全由官方承担 | — | 低：重造官方已有能力 |
| 与官方机制一致性 | 高：官方注释 "editable **without remounting**"（`dsh-settings` L118-L121） | 与 `autoGenerate` 语义相符但无客户端消费 | 低：`settings.write` 明确拒绝非 volatile 路径 |

### 2.2 判定

- **B 必然失败**：`volatileForm` 只投影 volatile（`dsh-settings` L118-L131）；`autoGenerate` 默认 true 但**没有任何 shipped 客户端消费它**（`dsh-settings/README.md:39` 原文）—— 这正是"设置页没有 dsh-ami 参数页"的根因，也是 B 连 `everyTurns` 都显示不出来的原因。
- **C 不划算**：客户端不能直接调 Host 的 `configEditor`（Host service，`dsh-config-editor/lib/index.js` L16-L22），官方 `settingsController` 已暴露 `describe/update/replace/mutate`；且 `settings.write` 对非 volatile 路径硬抛错（L507、L520），绕开它就要自己实现 entry 定位、revision 冲突、原子写与失败回滚（L69-L135 整段）。
- **取 A**，并加两条**必须**的加固：
  1. `agent/pre-step` 增加 `enabled` 现读闸门 —— 因为 volatile 变更**不 remount**（§1.3），否则关掉主开关对已存在的 agent 无效。
  2. 所有读取点经统一 `resolveSettings()` 解包 —— 否则出现 §4.1 的静默错误（插件彻底失效）。

---

## 3. 注册点定案：`plugins.row.config`

### 3.1 定案

```js
ctx.slots.inject("plugins.row.config", () =>
  ctx.slots.register({
    name: "plugins.row.config",
    key: "dsh-ami#dsh-ami",     // <bundle 包名>#<row id>，必须严格等于此值
    locale: "settings.dshAmi",  // Client 字典命名空间
  }, DshAmiRowConfig));
```

- **key 必须严格等于 `dsh-ami#dsh-ami`**：`row.rowId` = `dsh-ami` = settings 命名空间（§1.6），这样 `formFor(openRow.rowId)` 才会在 `configurations` 里命中并返回 `form`（Lead 核实 `ui-plugin-manager/lib/client.js` L3833-L3840、L4143）。
- 用 `whileServed(["dsh-ami"], ...)` 再包一层：Host 不服务该命名空间时根本不注册（页面隐藏，`dsh-client-ui-settings/lib/client.js` L1315-L1334）。

### 3.2 为什么不选其它三个

| 候选 | 不选的理由 |
| --- | --- |
| `settings.plugins.tab` | props **只有 `{}` + `t` + inject 面，没有 `form`、没有 `view`**（`ui-settings-plugins/lib/client.js` L66-L68、L116-L125），且它是 Settings 面板里的**只读清单 tab**。T1 §2.3 已明确"不要用它承载编辑表单"。 |
| `plugins.item` | 能拿到 `form`，但语义是"官方插件"，会出现在 Built-in plugin settings 分组；Lead 明确要求不使用。 |
| `plugins.bundle.config` | 只传 `{ view:'page' }`、**不传 form**（`ui-plugin-manager/lib/client.js` L2964），且 bundle 详情页可能对应多个 row，没有单一 form；必须自持 controller。 |

### 3.3 props 契约与两个渲染分支

props = `{ t, view, form?, ...inject() 面 }`。

- `view === "summary"`：返回**一行摘要**（字符串或轻量元素）。官方 README 片段即 `({ t, view }) => view === "summary" ? t("summary") : <Form .../>`。
- `view === "page"`：渲染完整表单；`form === undefined`（命名空间未服务 / 非 ready）时渲染不可用态。
- `form` 形状：`{ state, mutate }`，其中 `state = { status, value, base, user, revision, writable }`，`status ∈ "loading"|"ready"|"unavailable"`。
- **写入**：`form.mutate([{ op:"set", path:[key], value }], form.state.revision)`。
- **复位**：`form.mutate([{ op:"unset", path:[key] }], form.state.revision)`。

### 3.4 用户可达路径（写进交付说明）

1. 侧栏 **Plugins** 页 → **Installed plugins** → **dsh-ami**。
2. 在 bundle 详情里找到 row **`dsh-ami`**，点其 **Configure** 控件。
3. 打开的页面即本配置页（`view === "page"`）。
4. bundle 关闭时该行不出现 Configure 控件（官方 README 明示），此时用户需先在 Plugins 页启用 bundle。

> 注意：这不是 Settings 面板里的页面。官方机制原话："A plugin that carries its own configuration renders it on this page rather than in Settings"。

---

## 4. Host 改造清单

### 4.1 静默错误清单（grep 命中 11 行：`index.js` 8 行 + `lib/logic.js` 3 行，后者含 4 个判定）

volatile 包装对象**恒为 truthy 且不是 number/boolean**，所以：

| 文件:行 | 现状 | 不改的后果 |
| --- | --- | --- |
| `index.js:102` | `const limit = config.maxSourceBytes;` | 非 SafeInteger → 抛 `invalid source limit`（L103）→ 每次读盘降级 `read-error` |
| `index.js:142` | `buildInstructionText(text, config.wrapSystemReminder)` | 恒真 → 永远包 `<system-reminder>` |
| `index.js:161` | `resolveEveryTurns(config.everyTurns, …)` | **已正确**（`lib/logic.js:60` 已解包） |
| `index.js:179` | `if (config.onlyIfChanged && …)` | 恒真 → 去重行为反转 |
| `index.js:229` | `if (!isCurrent() \|\| !config.enabled) return;` | 恒假 → **主开关彻底失效** |
| `index.js:231` | `config.includeSubagents === true ? …` | 恒 false → 子智能体 opt-in 失效 |
| `index.js:165` | `readAgentsMd(ctx, config, …)` | 间接触发 102 |
| `index.js:173` | `planInjection(read.text, config)` | 间接触发 logic.js 66-67、73 |
| `lib/logic.js:66-67` | `Number.isInteger(config?.maxInjectBytes) && …` | 退化 `Infinity` → **注入上限完全失效** |
| `lib/logic.js:73` | `if (config?.truncateOversize === true)` | 恒 false → 超限一律 skip 而非截断 |
| `lib/logic.js:116` | `if (config?.enabled !== true) …` | 恒成立 → `canRegisterForAgent` **永远 disabled** |
| `lib/logic.js:117` | `if (config?.includeSubagents === true) …` | 恒 false |

**这 11 行是正确性红线，不是风格问题。**

### 4.2 `lib/logic.js`：新增统一解包纯函数

放置位置：`lib/logic.js`（保持"零 import、裸 Node 可直接测试"的既有约束，L1）。签名沿用 `resolveEveryTurns(raw, isVolatileFn)` 的"由 index.js 注入 isVolatileFn"约定（L58-L62）。

```js
// 私有 解包 volatile 包装 isVolatileFn 由 index.js 注入以保持零 import
const unwrap = (value, isVolatileFn) =>
  typeof isVolatileFn === "function" && isVolatileFn(value) ? value.get() : value;

// 把 Config 的 8 个字段归一化为普通值 供纯逻辑消费
// 必须在使用点现读 不能把结果缓存成闭包常量
export function resolveSettings(raw, isVolatileFn) {
  return {
    enabled: unwrap(raw?.enabled, isVolatileFn),
    everyTurns: unwrap(raw?.everyTurns, isVolatileFn),
    maxSourceBytes: unwrap(raw?.maxSourceBytes, isVolatileFn),
    maxInjectBytes: unwrap(raw?.maxInjectBytes, isVolatileFn),
    truncateOversize: unwrap(raw?.truncateOversize, isVolatileFn),
    wrapSystemReminder: unwrap(raw?.wrapSystemReminder, isVolatileFn),
    onlyIfChanged: unwrap(raw?.onlyIfChanged, isVolatileFn),
    includeSubagents: unwrap(raw?.includeSubagents, isVolatileFn),
  };
}
```

- **不做类型强制**（不写 `=== true`、不归一整数）：`canRegisterForAgent`（L115-L121）与 `isHitTurn`（L34-L39）本来就用严格比较/整数判定，保持值原样即可。
- `resolveEveryTurns` **保留**为薄包装（既有纯函数回归测试不破），实现改为复用 `unwrap`：

```js
export function resolveEveryTurns(raw, isVolatileFn) {
  const value = unwrap(raw, isVolatileFn);
  return Number.isInteger(value) ? value : NaN;
}
```

- `planInjection(text, config)`（L65-L81）、`buildInstructionText(text, wrap)`（L84-L89）、`canRegisterForAgent(config, ...)`（L115-L121）**签名与实现完全不动** —— 只要调用方传入 `resolveSettings()` 的结果，它们读到的就是普通值。这是本方案改动量最小的关键。
- 具名导出 18 → **19**；`README.md` L151 的计数同步。

### 4.3 `index.js`：逐行改造

先在 `apply` 内加一个插件级读取器（放在 `const warned = new Map();` 之后，即 L217 附近）：

```js
// 每次使用点现读并解包 volatile 变更不重挂载 闭包 config 长期有效
const readSettings = () => resolveSettings(config, deps.isVolatile ?? fallbackIsVolatile);
```

> **不要**把 `readSettings()` 的结果存进变量跨事件复用；`config` 对象身份不变（§1.3），但字段值会就地更新。

| # | 位置 | 现状 | 改为 |
| --- | --- | --- | --- |
| H0 | `index.js` L29-L35 | 仅 `everyTurns` 带 `.volatile()` | **8 个字段全部** `.volatile()` |
| H1 | `index.js` L25-L26 | 注释只解释 everyTurns | 改为"8 字段全部 volatile：配置页经 configForms 写入，非 volatile 路径会被 settings.write 拒绝" |
| H2 | `index.js` L6-L8 import | 现有具名导入 | 增加 `resolveSettings`；`resolveEveryTurns` 从 import 列表移除（改由 `readSettings` 统一解包） |
| H3 | `index.js` L94-L136 `readAgentsMd(ctx, config, …)` | 参数名 `config`，L102 读 `config.maxSourceBytes` | 参数改名 `settings`，L102 用 `settings.maxSourceBytes` |
| H4 | `index.js` L139-L147 `buildMessage(ctx, warned, text, config, …)` | L142 `config.wrapSystemReminder` | 参数改名 `settings`，L142 用 `settings.wrapSystemReminder` |
| H5 | `index.js` L150-L213 `registerForAgent(ctx, config, agent, …)` | 参数 `config` | 参数换成 **`readSettings`（函数）** |
| H6 | `index.js` L159-L162 | `const n = resolveEveryTurns(config.everyTurns, …)`；`shouldInject(payload.turn, n, state)` | 顶部 `const settings = readSettings();`；`if (settings.enabled !== true) return next();`；`shouldInject(payload.turn, settings.everyTurns, state)` |
| H7 | `index.js` L165 | `readAgentsMd(ctx, config, payload.signal, cache, isCurrent)` | `readAgentsMd(ctx, settings, …)` |
| H8 | `index.js` L173 | `planInjection(read.text, config)` | `planInjection(read.text, settings)` |
| H9 | `index.js` L179 | `config.onlyIfChanged && …` | `settings.onlyIfChanged === true && …` |
| H10 | `index.js` L189 | `buildMessage(ctx, warned, plan.text, config, isCurrent)` | `buildMessage(ctx, warned, plan.text, settings, isCurrent)` |
| H11 | `index.js` L225-L243 `agent/created` | L229 `!isCurrent() \|\| !config.enabled`；L231 `config.includeSubagents === true`；L233 `canRegisterForAgent(config, …)` | 回调内 `const settings = readSettings();`；L229 拆成 `if (!isCurrent()) return; if (settings.enabled !== true) return;`；L231 `settings.includeSubagents === true`；L233 `canRegisterForAgent(settings, …)` |
| H12 | `index.js` L238 | `registerForAgent(ctx, config, agent, states, warned, isCurrent)` | `registerForAgent(ctx, readSettings, agent, states, warned, isCurrent)` |

**不需要改的**：`index.js` L50-L60 依赖加载、L62-L66 降级诊断、L69 `fallbackIsVolatile`、L78-L85 `warnOnce`、L88-L91 `decodeSource`、L215-L219 `apply` 骨架、L244-L251 清理；`lib/logic.js` 的 `planInjection` / `buildInstructionText` / `canRegisterForAgent` / `shouldInject` / `isHitTurn` / `hitSequence` / `truncateToBytes` / `utf8Length` / `warningKey` / `initialState` / `markAttempted` / `markInjected`。

H6 的 `settings.enabled` 闸门同时覆盖"关掉后已存在 agent 立即停注入"（§4.6）。

### 4.4 是否保留非 volatile 字段

**不保留**。`volatileForm` 不投影非 volatile 字段（L118-L131），`settings.write` 也拒绝非 volatile 路径（L507、L520）；任何"保留一个非 volatile 字段"的折中都等于该字段不可编辑。

### 4.5 写入持久化与复位语义

一次写入的链路：

1. Client：`form.mutate(ops, form.state.revision)`（`dsh-client-ui-settings/lib/client.js` L1165-L1182，写走 provider 的 ctx）。
2. Host：`settings.mutate`（`dsh-settings` L488-L500）→ `write` 校验 entry / volatile 表单 / volatile 路径 / revision（L504、L506、L507、L511）。
3. `config-editor.edit`：先把新值 `resolveConfig(fiber.runtime, resolved)` **提交进活配置**（L82-L83），再把该 entry 的 `config` 行原子写进 profile patch（L98-L110、L123），最后 `reconcileProfilePatches` 应用到运行中的 entry（L125）；失败回滚文件（L126-L130）。
4. `settings.write` 结束后重新 `describe()`（L536）→ `settings/document-updated` → Client 镜像刷新。

**落盘内容**：
- `change` 的入参 `current` 是 `projectForm(form, entry.options.config)`，而 `entry.options.config` 是**组合后的有效配置**（含 bundle patch 的 8 个字段）；`strip(raw, form)` 会把所有 volatile 键从 override 层剥掉再与 `next` 合并 —— 所以**第一次写入后 profile patch 行里的 `config` 是完整 8 字段**（正好满足 `README.md` L63"用户 patch 必须写全 8 个字段"）。
- **复位**：`unset` 在 Host 侧优先用继承层 `base` 回填（L491-L498），`base` = bundle patch 的 8 个值；全部 `unset` 后 `next` 与继承层**深等**，`config-editor` 走 L99-L104 分支**删除该 patch 行的 `config` 键**，回落到继承层 —— 页面显示 shipped 默认值。
- **字段级复位**只能恢复继承值，不能删除更低配置层提供的值（`dsh-settings/README.md:74`）。

**不变量**：`write` 的 `validatePaths`（L513-L523）会拒绝任何非 volatile 键。因此 profile patch 行里**不能**出现 Config 之外的键，否则后续写入必失败。当前 8 字段即全集。

### 4.6 运行中变更的生效时机

| 字段 | 生效时机 | 依据 |
| --- | --- | --- |
| `everyTurns` | 下一次 `agent/pre-step` | 现读 |
| `maxSourceBytes` / `maxInjectBytes` / `truncateOversize` / `wrapSystemReminder` | 下一次命中轮号 | 本来每次现读，现在经 `resolveSettings` |
| `onlyIfChanged` | 下一次命中轮号 | 打开后若文件自上次注入未变，该命中轮号被跳过（`state.lastInjectedHash` 每 agent 保留） |
| `enabled` | **立即**，含已存在的 agent | H6 的 pre-step 闸门；`agent/created` 处的检查只影响新 agent |
| `includeSubagents` | 只影响此后新建的 agent | 判定在 `agent/created`（L225-L231），**不追溯**已存在的 subagent；`README.md` L75 的说明保持成立 |

---

## 5. Client 改造清单

### 5.1 `package.json`

```jsonc
"exports": {
  ".": "./index.js",
  "./client": "./client.js",          // 新增
  "./locale/*.json": "./locale/*.json",
  "./icon": "./icon.svg"
},
"files": [
  "index.js",
  "client.js",                        // 新增
  "lib/logic.js",
  "cordis.patch.yml",
  "locale/*.json",
  "icon.svg",
  "README.md"
],
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {                         // 新增
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-plugin-manager"
    ]
  }
}
```

- `dsh.client.inject` 三项：locale 提供 `ctx.locale`；ui-settings 提供 `configForms`；ui-plugin-manager 声明 `plugins.row.config`（T1 §5.1/§5.3 与官方 `ui-settings-subagent/package.json:29-39` 同构）。不加 `immediately`（官方配置页均不加，模板的 `immediately: true` 是给装饰件的）。不加 `@deepseek-ai/dsh-api-remotes`（只读表单不需要，`remote.settings` 由 provider 自己声明，T1 §5.1）。
- `files` 对 link 安装不过滤，但为发布正确性仍要加 `client.js`。

### 5.2 `client.js` 结构（骨架）

```js
window.__ModuleLoader__.load({
  id: "dsh-ami",                        // 必须等于包名
  factory(require) {
    const React = require("react");
    const h = React.createElement;      // 手写 plain JS 不用 JSX 构建链

    const DICT_NS = "settings.dshAmi";  // Client 字典命名空间 与下面区分
    const NS = "dsh-ami";               // Host settings 命名空间 = entry.options.id
    const ROW_KEY = "dsh-ami#dsh-ami";  // <bundle 包名>#<row id>

    const en = { /* §5.4 */ };
    const zh = { /* §5.4 */ };

    // 与 index.js 的 Config 一一对应 顺序即渲染顺序
    const FIELDS = [
      { key: "enabled", kind: "boolean" },
      { key: "everyTurns", kind: "number", min: 1, max: 1000, step: 1 },
      { key: "maxSourceBytes", kind: "number", min: 1, step: 1 },
      { key: "maxInjectBytes", kind: "number", min: 1, step: 1 },
      { key: "truncateOversize", kind: "boolean" },
      { key: "wrapSystemReminder", kind: "boolean" },
      { key: "onlyIfChanged", kind: "boolean" },
      { key: "includeSubagents", kind: "boolean" },
    ];

    // 客户端预校验 Host 侧最终由 schemastery 兜底 (dsh-settings/lib/index.js:83)
    function validate(field, raw) {
      if (field.kind === "boolean") return undefined;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isSafeInteger(n)) return "invalidNumber";
      if (field.min !== undefined && n < field.min) return "invalidNumber";
      if (field.max !== undefined && n > field.max) return "invalidNumber";
      return undefined;
    }

    const styles = {
      section: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "760px",
                 color: "var(--dsw-alias-label-primary)" },
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" },
      hint: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-tertiary)" },
      input: { width: "160px", padding: "4px 8px", font: "inherit", color: "var(--dsw-alias-label-primary)" },
      error: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-state-error-primary)" },
    };

    // 自绘开关 不 require dsh-client-ui-primitives (practices.md L33-L36)
    function Switch({ checked, disabled, onChange, label }) {
      return h("button", {
        type: "button", role: "switch", "aria-checked": checked ? "true" : "false",
        "aria-label": label, disabled: disabled === true, onClick: () => onChange(!checked),
      }, checked ? "on" : "off");
    }

    function DshAmiForm({ t, form }) {
      const state = form.state;                     // 快照 非 store
      const [draft, setDraft] = React.useState(null);
      const [status, setStatus] = React.useState("idle");   // idle|saving|saved|failed
      const [message, setMessage] = React.useState(null);
      const [basedOn, setBasedOn] = React.useState(state.revision);

      // revision 变化 = Host 值已更新 丢弃草稿重新以最新值为准
      React.useEffect(() => {
        if (state.revision === basedOn) return;
        setBasedOn(state.revision);
        setDraft(null);
      }, [state.revision, basedOn]);

      const value = state.value ?? {};
      const current = draft ?? value;

      const save = async () => {
        const ops = FIELDS
          .filter((f) => !Object.is(current[f.key], value[f.key]))
          .map((f) => ({ op: "set", path: [f.key], value: current[f.key] }));
        if (ops.length === 0) return;
        setStatus("saving"); setMessage(null);
        try {
          const ok = await form.mutate(ops, state.revision);
          setStatus(ok ? "saved" : "failed");
          if (!ok) setMessage(t("writeFailed"));
        } catch (error) {
          setStatus("failed");
          setMessage(String(error?.message ?? error));
        }
      };

      const reset = async () => {
        const ops = FIELDS.map((f) => ({ op: "unset", path: [f.key] }));
        setStatus("saving"); setMessage(null);
        try {
          const ok = await form.mutate(ops, state.revision);
          setStatus(ok ? "saved" : "failed");
          if (!ok) setMessage(t("writeFailed"));
        } catch (error) {
          setStatus("failed");
          setMessage(String(error?.message ?? error));
        }
      };

      // 渲染 8 行（boolean → Switch，number → input[type=number] min/max/step）
      // 底部：保存 / 恢复默认值 两个按钮 + 状态条（saving/saved/writeFailed）
      return h("div", { style: styles.section }, /* ... */);
    }

    // 注册进 plugins.row.config 的组件 两个 view 分支
    function DshAmiRowConfig(props) {
      const { t, view, form } = props;
      if (view === "summary") return t("summary");
      if (form === undefined || form.state.status !== "ready") {
        return h("p", { style: styles.hint }, t("unavailable"));
      }
      return h(DshAmiForm, { t, form });
    }

    const inject = ["slots", "locale", "configForms"];

    function apply(ctx) {
      const t = ctx.locale.bind(DICT_NS);
      ctx.effect(() => ctx.locale.register(DICT_NS, { zh, en }), "dsh-ami: dictionaries");
      ctx.effect(() => ctx.configForms.whileServed([NS], () =>
        ctx.slots.inject("plugins.row.config", () =>
          ctx.slots.register({
            name: "plugins.row.config",
            key: ROW_KEY,
            locale: DICT_NS,
          }, DshAmiRowConfig))), "dsh-ami: row config page");
    }

    return { inject, apply };
  },
});
```

要点：

1. **模块级 `inject` 是 `["slots","locale","configForms"]`**：`slots`/`locale` 见官方页写法（T1 §2.4），`configForms` 是 `whileServed` 的来源（`dsh-client-ui-settings/lib/client.js` L1270）。
2. **表单直接用页面给的 `form`**（`{state, mutate}`），不自建 controller、不需要 `useSyncExternalStore`；`form.state` 是快照，重渲染由 ui-plugin-manager 的 `configurations` hook 驱动（Lead 核实 L3833-L3840）。
3. **`ctx.effect` 包住字典注册与页面注册**：`locale.register` 返回 disposer（L1398-L1412），`whileServed` 返回 disposer（L1329-L1333），`ctx.effect` 回调的返回值即清理函数。
4. **`view` 两分支必须都实现**：`summary` 返回一行文本，`page` 渲染表单。
5. **不 require 任何 Harness Client 包**（`practices.md` L35 原文禁止 `@deepseek-ai/dsh-client-ui-primitives`），控件自绘；样式只用 `--dsw-alias-*` token（`practices.md` L34）。上表 token 名取自 `dsh-client-ui-settings-plugins/lib/client.js` L11 的官方 CSS；`--dsw-alias-state-error-primary` 需用 client `Theme.listTokens` 复核（本轮 client inspect 超时，见 §9 R6）。
6. **React hooks 必须在所有早返回之前调用**：`DshAmiForm` 内先 `useState/useEffect` 再渲染；`view`/`status` 的分支放在子组件或渲染表达式里，不要写在 hooks 之前。
7. `form.mutate` 由 `formFor` 以箭头函数提供（`(ops, revision) => form.mutate(ops, revision)`），`this` 已绑定，可直接调用。

### 5.3 交互：保存 / 复位 / 反馈

- **模型**：本地草稿 + 显式保存（一次原子写入，单次 revision 检查），符合"保存/重置"要求。
- 布尔：`Switch` 只改草稿，**不**立即写 Host。
- 数字：`<input type="number" min max step>`；`onChange` 更新草稿，`onBlur` 校验；校验失败显示字段级 `invalidNumber` 并禁用保存。
- **保存**：对"与 `state.value` 不同"的字段生成 `{op:"set"}`，`form.mutate(ops, state.revision)`；必须同时处理 `false`（Host 拒绝，controller 已自动重读并保留 draft）与 Promise reject（remote 异常）。
- **恢复默认值**：8 个 `{op:"unset"}`，Host 侧回填继承层（§4.5）。
- **反馈**：状态条 `saving` / `saved` / `writeFailed`；失败保留草稿并提示"已重新加载，请重试"，不静默回滚。冲突文案参考官方 "Settings changed elsewhere. Discard your draft and try again."（T1 §8 第 7 条）。
- `state.writable === false` 时禁用控件并显示只读提示（Host `writable` 恒 true，属防御）。

### 5.4 locale

- **UI 文案写在 `client.js` 内联字典**，命名空间 `DICT_NS = "settings.dshAmi"`（唯一即可，命名风格对齐官方 `settings.agentLoop`）；`ctx.locale.register(DICT_NS, { zh, en })`，`zh`/`en` 键必须一一对应（T1 §5.2）。
- **包根 `locale/*.json` 是 Host 展示元数据**（`meta.title`/`meta.description`，`host-plugin.md` L31-L53），**不存在**把它们灌进 Client 字典的管线（`dsh-client-locale/lib/client.js` 只注册内联字典，L1503-L1560）。因此：
  - 不要把 UI key 写进 `locale/*.json`（会永不生效并造成重复维护）。
  - 可选：把 `locale/en.json` / `locale/zh.json` 的 `meta.description` 改成提到"可在 Plugins 页 Configure 中修改全部参数"，让插件行描述与能力一致。
- 内联字典 key 清单（`en`/`zh` 各一份）：

| 类别 | key |
| --- | --- |
| tab 摘要与页面 | `summary` `title` `intro` `unavailable` |
| 字段标签 | `enabled` `everyTurns` `maxSourceBytes` `maxInjectBytes` `truncateOversize` `wrapSystemReminder` `onlyIfChanged` `includeSubagents` |
| 字段说明 | 上述 8 个各配 `…Hint`（如 `everyTurnsHint` = "1-1000 第 1 轮不注入"） |
| 交互与错误 | `save` `reset` `saving` `saved` `invalidNumber` `writeFailed` `readOnly` |

---

## 6. 边界与失败语义

1. **非整数 / 越界**：客户端 `Number.isSafeInteger` + `min`/`max`；不合法 → 字段级提示 + 保存禁用。Host 兜底由 `config-editor` 的 `resolveConfig`（L83）用完整 schema 校验，不合法即抛错、写被拒、旧值保留（`dsh-settings/README.md:48`）。UI 必须同时处理 `false` 与 reject。
2. **Host 拒绝写入**：entry 不存在 / 非唯一 id（`config-editor` L30-L35、`dsh-settings` L504）、无 volatile 字段（L506）、路径非 volatile（L507、L520）、entry 非 active（`config-editor` L81）、被 home patch 或命令行覆盖（L122）→ 统一表现为 `mutate` 返回 `false` + 状态条提示 + 镜像自动重读。
3. **revision 冲突**：`SettingsConflictError`（`dsh-settings` L163-L181）→ `{ok:false}` → controller `recover()` 重读（`dsh-client-ui-settings/lib/client.js` L1184-L1188）→ 提示 `writeFailed`/冲突文案，保留草稿。连续快速操作由串行队列 + generation 保证不乱序（L1165-L1208），UI 仍在 `saving` 期间禁用按钮。
4. **非 volatile 字段**：方案 A 下不存在；若未来新增字段忘记 `.volatile()`，症状是**该字段根本不进表单**（`volatileForm` L118-L131）而非报错 —— 因此 §8 的 D1 用"字段数 == 8"做回归哨兵。
5. **命名空间未服务**：`whileServed(["dsh-ami"], ...)` 不注册 → 无配置页（`dsh-client-ui-settings/lib/client.js` L1315-L1334）。二次防御：`form === undefined` 或 `form.state.status !== "ready"` 时渲染 `unavailable`。
6. **bundle 关闭**：官方机制保证该行不出现 Configure 控件（README:83），配置页自然不可达。
7. **写入失败反馈**：状态条 + 保留草稿 + "已重新加载"提示，不静默丢弃输入、不静默回滚。
8. **卸载**：`remove_bundle` 后 Host 不再服务该命名空间 → `whileServed` 释放注册；bundle 关闭 → Configure 控件消失。

---

## 7. 生效与验证步骤（硬阻塞，必须先做）

1. **改安装方式**：当前是 `github:LingluoYusa/dsh-ami` 的**复制**（§1.7），改工作区不生效。需用 `plugin_manager` `install_bundle` 指向工作区绝对路径 `D:\YhhCode\MyProject\dsh-ami`，把它变成 `link:` 安装。
   - **本会话审批通道禁用，plugin_manager 动作无法执行**（T1 §6.4、§9 第 9 条）；此步必须由具备 Full access 的一方完成。
2. **Host 改动（`index.js` / `lib/logic.js`）→ 必须重启 DSH 进程**（Node 模块已缓存；`host-plugin.md` L70）。
3. **Client 改动（`client.js` / `package.json` 的 `dsh.client`）→ 保守做法：重启 DSH 进程 + 刷新浏览器页面**。不要因为 slot id 不变就判定浏览器代码已更新（`host-plugin.md` L70 原话）；本机 HMR 的 `root: []` 是否覆盖 link 目录的 `client.js` 未确认（T1 §6.4）。
4. **判断是否真的生效**：
   - `plugin_manager` 结果看 `application` 字段（`applied` / `restart-required` / `overridden` / `failed`），不要靠日志或进程列表推断。
   - 运行时确认命名空间：在页面 console 或临时探针里读 `ctx.configForms.describe().getSnapshot().view.namespaces.map(n => n.ns)` 应含 `dsh-ami`（T1 §3.4 的 live 复核建议）。
   - 页面出现 Plugins → dsh-ami → row `dsh-ami` 的 Configure 控件。
5. **回滚**：若 link 安装出问题，重新 `install_bundle` 或恢复 github 依赖；profile patch 里的 `config` 行由设置页维护，与本设计无关。

---

## 8. 验收清单（tester）

### 8.1 纯函数回归（裸 Node 直接跑 `lib/logic.js`，零依赖）

| # | 断言 |
| --- | --- |
| A1 | `resolveSettings` 对 `{get:()=>v}` 与裸值 `v` 返回相同结果；混合包装时逐字段正确 |
| A2 | `Object.keys(resolveSettings({}, ()=>false))` 恰好 8 个键，且与 `index.js` 的 `Config` 字段集合完全一致（静态比对，防漏 volatile） |
| A3 | `resolveSettings` 对缺字段返回 `undefined`，不抛错 |
| A4 | `resolveEveryTurns({get:()=>10}, duck) === 10`；`resolveEveryTurns({get:()=>1.5}, duck)` 为 `NaN`（既有行为不回归） |
| A5 | `planInjection(text, resolveSettings({maxInjectBytes:{get:()=>4}, truncateOversize:{get:()=>true}}, duck))` 与传裸值结果**逐字段相同**（`action`/`reason`/`text`） |
| A6 | `canRegisterForAgent(resolveSettings({enabled:{get:()=>false}}, duck), true, true).register === false` |
| A7 | `canRegisterForAgent(resolveSettings({enabled:{get:()=>true}, includeSubagents:{get:()=>true}}, duck), false, false).register === true`（opt-in 逃生通道不回归） |
| A8 | `buildInstructionText("x", resolveSettings({wrapSystemReminder:{get:()=>false}}, duck).wrapSystemReminder)` 不含 `<system-reminder>` |
| A9 | `lib/logic.js` 具名导出 19 个（5 常量 + 14 函数），仍为零 `import` |

### 8.2 Host 运行时

| # | 断言 |
| --- | --- |
| B1 | dsh-ami entry 的 schema 8 字段全部 `meta.volatile === true`（inspect 带 input 不可用时，用临时探针读 `ctx.settings`/loader entry 的 `runtime.Config.toJSON()`） |
| B2 | `describe()` 中 namespace `dsh-ami` 的 `value` 含 8 个键（证明 `volatileForm` 投影了 8 个字段） |
| B3 | 改 `everyTurns` → **不重启会话**，下一个命中轮号按新值注入 |
| B4 | 关 `enabled` → **已存在的 agent** 下一个命中轮号不注入、不读盘；重新打开 → 恢复（验证 H6 闸门；这是"不 remount"契约的实测点） |
| B5 | 开 `includeSubagents` → 此后新建的 subagent 也注册；已存在的 subagent 不追溯 |
| B6 | `onlyIfChanged` 打开且文件未变 → 命中轮号被跳过；改动文件 → 恢复注入 |
| B7 | `maxSourceBytes` 小于当前文件 → 下一次命中轮号 `source-oversize` 且不注入；改回 → 恢复 |
| B8 | `maxInjectBytes` / `truncateOversize` → 分别表现为"截断并追加标记"与"跳过并告警"（`lib/logic.js` L65-L81 四级短路） |
| B9 | 关 `wrapSystemReminder` → 注入文本不含 `<system-reminder>` |
| B10 | 所有失败路径都不中断 turn、不冒泡（`warnOnce` 语义不回归） |

### 8.3 Client 页面

| # | 断言 |
| --- | --- |
| C1 | Plugins → Installed plugins → dsh-ami → row `dsh-ami` 出现 **Configure** 控件；打开后 8 个控件全部渲染，中文标签；切 en 后英文 |
| C2 | 控制台无 `slot entry crashed in 'plugins.row.config'`；`client.js` 不出现 `dsh-client-ui-primitives` |
| C3 | `view === "summary"` 分支返回一行摘要且不报错（列表/详情渲染处可见） |
| C4 | 保存后 profile patch 该 entry 的 `config` 含**完整 8 字段**且值正确；重启后页面显示持久化值 |
| C5 | 恢复默认值 → patch 行的 `config` **键被删除**（回落继承层），页面回到 shipped 默认 |
| C6 | 双窗口同时改同一字段 → 后写者得到 `false`，显示失败提示，页面刷新为最新值，无半保存 |
| C7 | 输入 `0` / `1.5` / `1001`（everyTurns）→ 客户端阻止或 Host 拒绝并提示 |
| C8 | `maxSourceBytes` 输入超大值（如 `2**53`）→ 被拒且提示，不出现 `Infinity`/非法持久化 |
| C9 | 明暗主题下配色正常，无字面色值（只出现 `--dsw-*` token） |
| C10 | 关闭 bundle → Configure 控件消失；重新启用 → 恢复 |
| C11 | 卸载 dsh-ami → 页面/控件消失；重装 → 回来（`whileServed` 释放/重建） |

### 8.4 交叉验证

| # | 断言 |
| --- | --- |
| D1 | 页面字段数 == `Config` 字段数 == 8 == patch 字段数 |
| D2 | 页面控件 min/max/step 与 `Config` 的 `.min()/.max()/.step()` 逐项一致（`FIELDS` 表 vs `index.js` L29-L35） |
| D3 | `README.md` 第 5 节不再声称"只暴露 everyTurns"，第 6 节表格的 volatile/修改入口两列已更新，附录导出计数为 19 |
| D4 | `cordis.patch.yml` 未被修改，8 字段完整保留 |

---

## 9. 兼容性与未决风险

### 9.1 兼容性

1. **`cordis.patch.yml` 不动**：8 字段全保留。`.volatile()` 只改 schema 元数据，不影响 patch 组合与覆盖语义（T1 §4.3）。
2. **首次设置写入后 profile patch 固化 8 字段**（§4.5）：符合"用户 patch 层跨升级存活"（`practices.md` L22），但意味着此后 bundle 升级改默认值不会生效 —— README 需写明，用户可点"恢复默认值"回落。
3. **旧配置迁移**：无字段增删改名 → 不需要迁移；`dsh-settings` 的 `settings.yaml` legacy import（L346-L363）不涉及 dsh-ami。
4. **不变量**：patch 行不能出现 Config 之外的键（否则写入必失败，§4.5）。当前 8 字段即全集。
5. **卸载/重装**：Host 侧 `remove_bundle`/`install_bundle` 路径不变；Client 侧替换已安装包需要重启（§7）。
6. **README 同步点**：§5（L44-L48 整节重写为"配置页在 Plugins 页 Configure"）、§6（L52-L61 表格 volatile/修改入口两列 + L63 说明）、§7（L75 "该字段非 volatile" 需删改）、§9 U5（L93 更新为已解决）、§10（L128-L130 增加 link 安装与重启说明）、附录（L149 `files/exports` 已变；L151 导出计数 18 → 19）。

### 9.2 未决风险

| # | 风险 | 影响 | 处置 |
| --- | --- | --- | --- |
| R1 | 本会话 `plugin_manager` 不可用（审批禁用），link 安装未执行 | 改动无法生效/验证 | 由具备 Full access 的一方执行 §7 第 1 步；tester 在此之前只能做纯函数与静态验收 |
| R2 | dsh-ami 的 live `patchId` 未直接观测（T1 §3.4） | 命名空间写错则拿不到 form | 源码三重推导为 `dsh-ami`；§7 第 4 步用 `describe()` 运行时复核 |
| R3 | link 安装后 client.js 改动能否免重启 | 需多一次重启 | 保守走"重启 + 刷新"（§7 第 3 步） |
| R4 | `plugins.row.config` 的 summary 分支渲染位置/频率未逐行读 | 摘要文案可能不显示 | 返回纯字符串（官方 README 片段同形），失败也不影响 page 分支 |
| R5 | `plugins.row.config` 的 `key` 是否需与 bundle 的 package name 完全一致（本包 `name: dsh-ami`） | key 不匹配则无 Configure | key 固定 `dsh-ami#dsh-ami`；C1 实测 |
| R6 | 本轮 client inspect 全部超时，主题 token 名单未经运行时确认 | 个别 token 名可能不存在 | 用官方 CSS 已出现的 token；落地前重试 `Theme.listTokens` 复核 `--dsw-alias-state-error-primary` |
| R7 | `@deepseek-ai/dsh-client-ui-primitives` 不 require 是否影响视觉一致性 | 控件外观与官方略有差异 | `practices.md` L35 明确禁止 require；自绘并复制官方控件的 `role="switch"` / `aria-checked` 行为 |
| R8 | 是否存在 home patch 覆盖 dsh-ami 导致表单写被拒（T1 §9 第 8 条） | 写入返回 false | 实现后试写一次；若被拒，检查 `~/.dsh` 的 home patch |
| R9 | 包 `locale/*.json` 不进 Client 字典 | 若照旧假设写 key，页面文案全显示为 key | 本设计改为 client.js 内联字典（§5.4），locale JSON 只更新 `meta.description` |

---

## 10. 实施顺序（给 developer）

1. **Host 先行**：`lib/logic.js` 加 `resolveSettings` → `index.js` 8 字段 volatile + H0-H12 → 用 §8.1 纯函数断言自测通过。此时 `describe()` 的 dsh-ami namespace 应已含 8 个键（B2），但页面还没出现。
2. **Client 跟进**：`client.js` → `package.json` → `locale/*.json` 文案。先本地做语法检查与 manifest 检查。
3. **生效**：按 §7 改 link 安装 + 重启 DSH 进程 + 刷新页面。
4. **文档**：README 同步（§9.1 第 6 条）。
5. **交给 tester**：按 §8 执行，重点 B3/B4/B5/C1/C4/C5/C10 与 R1/R2/R3 的实测结论回填。

工作量估计：Host 约 0.5 天，Client 约 1 天，README 0.5 天，测试 1 天。

---

## 附. 证据索引

| 别名 | 绝对路径 / 行号 |
| --- | --- |
| 工作区 | `D:\YhhCode\MyProject\dsh-ami\`（`index.js` L25-L36、L50-L60、L69、L94-L147、L150-L213、L215-L251；`lib/logic.js` L1、L34-L39、L59-L62、L65-L121；`package.json` L7-L32；`cordis.patch.yml` L1-L12；`locale/*.json`） |
| `dsh-settings/lib/index.js` | `D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-settings\lib\index.js` L98、L118-L131、L141-L158、L163-L181、L370-L398、L413-L464、L470-L537 |
| `dsh-config-editor/lib/index.js` | 同前缀 `dsh-config-editor\lib\index.js` L16-L35、L69-L135 |
| `dsh-client-ui-settings/lib/client.js` | 同前缀 `dsh-client-ui-settings\lib\client.js` L34-L69、L1080-L1244、L1252-L1335、L1353-L1474、L1481-L1498 |
| `dsh-client-ui-settings-plugins/lib/client.js` | 同前缀 `dsh-client-ui-settings-plugins\lib\client.js` L11、L37、L66-L68、L116-L125、L168-L212 |
| `dsh-client-locale/lib/client.js` | 同前缀 `dsh-client-locale\lib\client.js` L1387-L1428、L1491-L1560 |
| `dsh-client-ui-plugin-manager/lib/client.js` | 同前缀 `dsh-client-ui-plugin-manager\lib\client.js` L2818-L2821、L2964、L3833-L3840、L4143、L4180（Lead 核实；T1 §2.4 同文件） |
| `cordis-plugin-loader/README.md` | 同前缀 `@deepseek-ai\cordis-plugin-loader\README.md` L51-L53 |
| 技能参考 | `…\dsh-agent-preset\skills\cordis-plugin-development\references\{practices.md,host-plugin.md,ui-plugin.md}`；模板 `…\templates\decoration\{package.json,client.js}` |
| profile 合成树 | `C:\Users\15068\.dsh\profiles\desktop\cordis.yml` L1382-L1392；`…\profiles\desktop\package.json` L15、L21 |
| T1 报告 | 工作区 `docs\research\settings-page-findings.md`（§1-§9） |
