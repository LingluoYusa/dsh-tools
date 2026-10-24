# dsh-ami 设置页配置表单 调研结论

调研任务：task-1（researcher）。目标：查清"让 dsh-ami 的全部 8 个配置参数可在 DSH 设置页面编辑"所需的确切接口与约束。

调研时间：2026-10-20。所有结论均来自本机实际安装产物，路径与行号可直接复核。

## 0 结论速览

1. **设置页不是自动生成的**。Host 侧 `settings.describe` 只会为"含 `.volatile()` 字段的 entry"产出一份表单描述；但**没有任何 Client 插件会自动渲染它**（`dsh-settings/README.md:39` 明说 `autoGenerate` 目前无 shipped client 使用）。必须由插件自己的 Client 半边注册页面。
2. **dsh-ami 目前完全没有 Client 半边**：`package.json` 无 `dsh.client` 段、无 `./client` 导出（`package.json:7-32`）。这是"设置页里没有参数页面"的**根因**。
3. **表单寻址用 patch id 而不是完整 entry id**。Host 侧命名空间 = `entry.options.id`（`dsh-settings/lib/index.js:432,443,502`），对 dsh-ami 就是 **`dsh-ami`**，**不是** `include:dsh-ami`。`include:` 前缀只出现在插件清单（inventory）里。
4. **要让 8 个参数都可编辑，8 个字段必须全部 `.volatile()`**。Host 写路径对非 volatile 字段直接抛错（`dsh-settings/lib/index.js:507,520`），表单也只投影 volatile 字段（`:122-131`）。
5. **8 个字段全 volatile 后，现有 index.js/lib/logic.js 的 11 处 `config.*` 读取全部失效**（读到的是 `{get}` 包装对象而非标量）。这是本次改造最大的风险点，见第 7、8 节。
6. **工作区改动不会生效**：profile 里的 `node_modules\dsh-ami` 是 github tarball 的**复制**，与工作区当前逐字节相同（SHA256 全等）。必须走 `plugin_manager install_bundle` 本地 link 安装或手工同步，见第 6 节。
7. `cordis_inspect_query` 带 `input` 必报 `"input" must be an object`（本会话复现 3 次），无 input 时 Client 查询 10s 超时；本节结论均改用源码求证，见第 2 节末尾。

---

## 1 Client 侧配置表单 API

### 1.1 证据可用性说明（先看这条）

`@deepseek-ai/dsh-client-ui-settings` 的 `package.json` 声明 `"types": "lib/types/index.d.ts"` 且 `files` 含 `lib/types/**/*.d.ts`，但**app.asar 内实际不存在这些 .d.ts，也不存在 `src/*`**。实测读取失败：

- `.../dsh-client-ui-settings/lib/types/index.d.ts` → not found
- `.../dsh-client-ui-settings/lib/types/client/index.d.ts` → not found
- `.../dsh-client-ui-settings/lib/types/client/config-form.d.ts` → not found
- `.../dsh-client-ui-settings/src/client/config-form.ts` → not found

**可用的权威产物是 `lib/client.js`**（bundled、保留完整 JSDoc 与 `//#region lib/types/...` 标记）。以下签名全部抄自该文件，行号即该文件行号。

路径：`D:\DSH\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-client-ui-settings\lib\client.js`

### 1.2 `ctx.configForms` 服务

```js
// :1252  var ConfigForms = class extends Service {
// :1270    super(ctx, "configForms");
// :1287    describe()            -> this.mirror          // 跨命名空间读面
// :1294    get(entryId)          -> ConfigFormController // 单 entry 共享表单
// :1315    whileServed(namespaces, register) -> disposer
```

- `describe()` 返回 `SettingsDescribeMirror`（`:1353`），读面方法：
  - `getSnapshot()`（`:1372`）→ `{ status: "idle"|"loading"|"ready", view, error }`
  - `view.namespaces` 是数组，每项 `{ autoGenerate, ns, schema, revision, applies: "live", value, base, user, secrets? }`（Host 侧产出，见 `dsh-settings/lib/index.js:441-451`）
  - `view.writable`（Host 侧 `settings.describe.writable`，ui-settings README:36 称其为"写是否被接受"的权威）
  - `subscribe(listener)`（`:1380`）、`load()`（`:1388`）、`ensure()`（`:1401`）、`acceptView(view)`（`:1413`）、`namespace(ns)`（`:1432`）
- `get(entryId)`（`:1294-1301`）：
  ```js
  get(entryId) {
    const existing = this.forms.get(entryId);
    if (existing !== void 0) return existing;
    const form = new ConfigFormController(this.owner, { namespace: entryId }, this.mirror, this.schema);
    this.forms.set(entryId, form);
    this.mirror.ensure();
    return form;
  }
  ```
  重复调用返回**同一个** controller（provider 拥有，调用方只负责释放自己的订阅）。
  JSDoc 原文（`:1290-1293`）："Get the shared form values and write queue for one Host plugin entry. @param entryId Unique Host plugin entry id."——**注意这里的"entry id"实际是 `entry.options.id`（patch id），见第 3 节。**

### 1.3 `ConfigFormController` 精确字段与读写

`var ConfigFormController = class {`（`:1080`）

snapshot store 初值（`:1108-1115`）：

```js
this.store = createSnapshotStore({
  status: "loading", value: void 0, base: void 0,
  user: void 0, revision: void 0, writable: false,
});
```

`derive()`（`:1209-1232`）填充：`revision = view.revision`、`base = view.base`、`user = view.user`、`writable = mirrored.view.writable`、`value = decoded`；命名空间不在 mirror 中时 `status = "unavailable"`；`decode` 校验失败时保持 `status`（不覆盖 value）。

| 成员 | 行号 | 签名 / 语义 |
|---|---|---|
| `getSnapshot()` | `:1122` | 返回 `{ status, value, base, user, revision, writable }`；`status ∈ "loading"\|"ready"\|"unavailable"` |
| `subscribe(listener)` | `:1130` | 返回 disposer |
| `set(field, value)` | `:1140-1146` | `mutate([{ op:"set", path:[field], value }])`，返回 `Promise<boolean>`（Host 是否接受） |
| `unset(field)` | `:1153-1158` | `mutate([{ op:"unset", path:[field] }])`，清除覆盖、恢复继承 |
| `mutate(ops, expectedRevision?)` | `:1165-1182` | `ops` 为有序操作数组，`structuredClone` 后入队；`expectedRevision` 省略时取 `pendingRevision ?? snapshot.revision` |
| `dispose()` | `:1194-1199` | 停止派生、等待在途写落定 |

- **op 形状**：`{ op: "set", path: ["field"], value }` / `{ op: "unset", path: ["field"] }`。`path` 是数组（支持嵌套 / 数组下标）。
- **写契约**（`:1165-1182`）：
  - 串行队列 `tail`，按序执行；`writeGeneration` 处理被超越的写。
  - `this.ctx.remote.settings.mutate(namespace, ops, revision)`——写用的是 **provider 的 ctx**（`this.owner`，`:1263` 注释说明原因），因此调用方**不需要**在自己的 `inject` 里声明 `remote.settings`。
  - `response.ok === false` → `recover()`（`:1184`）重读 Host 最新值并返回 `false`；冲突时保留调用方的 draft。
  - 成功时 `mirror.acceptView(response.value)` 折入共享 mirror。
- **订阅**：`mirror.subscribe` → `derive()`（`:1116-1118`）；mirror 由 `remote.settings.describe` 一次读取 + `settings/document-updated` 事件 + `connection/reset` 刷新（`:1488-1498`）。

### 1.4 `whileServed(namespaces, register)`

`:1315-1334`，JSDoc 原文（`:1302-1314`）：

> Keep a registration alive while the Host serves any of some namespaces: `register` runs once one of them is in the describe mirror, and its disposer runs when none is or when the returned disposer runs. … The caller owns the returned disposer and wraps it in `ctx.effect`; unlike `bind`, nothing is registered on the caller's context here.

实现要点：`served = new Set(mirror.view.namespaces.map(v => v.ns))`，`namespaces.some(ns => served.has(ns))` 为真则调用 `register(served)`（传入**全部**已服务命名空间的 Set），否则调用上一次的 disposer。返回的 disposer 退订 + 触发当前 disposer。

**用法（官方四页统一写法）**：

```js
ctx.effect(() => ctx.configForms.whileServed([NS_A], () =>
  ctx.slots.inject("plugins.item", () =>
    ctx.slots.register({ name: "plugins.item", id: "…", order: 30, label: () => t("title"), locale: NS, inject: () => card.inject() }, Card))),
  "dsh-ami: page");
```

### 1.5 不确定项（第 1 节）

- `.d.ts` 与 `src/` 均不在 app.asar 内，无法交叉核对类型层；上表签名以 `lib/client.js` 的 JS 实现与 JSDoc 为准。
- `ConfigFormController.decode` 的 `spec.decode` 分支（`:1234`）在本包内无调用者（provider 自身不传 `decode`），属未使用路径。

---

## 2 设置页注册点

### 2.1 五个相关 slot 的定位

| slot | 声明者 | 位置 | 用途 |
|---|---|---|---|
| `settings.section` | ui-settings（slot 类型声明）| ui-settings README:44 | Settings 左侧导航的一个"章节"（导航项 + 页面），章节可声明子 slot |
| `settings.plugins.tab` | ui-settings-plugins | `ui-settings-plugins/lib/client.js:208-211` | Settings → 内置插件 章节内的 tab 行 |
| `plugins.item` | ui-plugin-manager（main 面板子 slot）| `ui-plugin-manager/lib/client.js:4432-4435` | 侧栏 Plugins 页 → "Built-in plugin settings" 分组的官方插件配置页 |
| `plugins.bundle.config` | 同上 `:4440-4443` | keyed by 包名 | 某个 bundle 详情页内的配置区 |
| `plugins.row.config` | 同上 `:4444-4447` | keyed by `<包名>#<rowId>` | 单行配置页（该行出现 Configure 入口） |

### 2.2 `settings.section` 的注册形状（ui-settings-plugins 自身）

`ui-settings-plugins/lib/client.js:201-212`：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "plugins",
  order: 15,
  label: () => t("nav"),
  locale: NS,
  inject: sectionInjected,
  children: { "settings.plugins.tab": { kind: "list", scope: "root" } }
}, PluginsSettingsSection));
```

- 选项：`{ name, id, order, label, locale, inject, children }`；`children` 用于声明该章节拥有的子 slot。
- **传给条目的 props**：`{ t, renderSlot, useTabs, ...inject() 的返回值 }`（组件签名 `function PluginsSettingsSection({ t, renderSlot, useTabs })`，`:37`）。
- 章节**不会**被传入表单对象。

### 2.3 `settings.plugins.tab` 的注册形状与 props

章节渲染（`ui-settings-plugins/lib/client.js:66-68` / `:116-125`）：

```js
renderSlot("settings.plugins.tab", {}, { only: single.id })   // 单 tab
renderSlot("settings.plugins.tab", {}, { only: row.id })      // 多 tab
```

即 **props 只有 `{}` + 框架注入的 `t` + 注册的 `inject()` 面**；**没有 `view`，没有 `form`**。

tab 行的选项投影（`:183-188`）：`{ id: entry.options.id ?? "", order: entry.options.order ?? 0, label: resolveSlotLabel(entry.options.label) ?? "" }`，按 `order` 升序。

官方唯一占用者（只读清单）注册（`ui-settings-plugin-inventory/lib/client.js:757-764`）：

```js
ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
  name: "settings.plugins.tab", id: "all", order: 10,
  label: () => t("tab"), locale: NS, inject: injected
}, PluginInventorySettingsTab));
```

组件 props 实测为 `{ list, presetName, resolveText, t, useClientSync, retryClient }`（`:283`），其中 `list/presetName/resolveText/retryClient` 来自 `inject()`，`hooks: { clientSync }` 被框架映射成 `useClientSync`。

### 2.4 `plugins.item` 的注册形状与 props（**官方配置页正解**）

声明（`ui-plugin-manager/lib/client.js:4432-4435`）：`"plugins.item": { kind: "list", scope: "root" }`，是 `main` 面板注册的 children 之一（`:4411-4461`）。

卡片渲染（`:2672-2684`）：

```js
renderSlot("plugins.item", { view: "summary" }, { only: item.id })
```

详情页渲染（`:2710-2755`）：

```js
function ItemDetail({ item, t, onBack, renderSlot, form }) { … }
  …
  renderSlot("plugins.item", { view: "summary" }, { only: item.id })      // 描述行
  …
  renderSlot("plugins.item", { view: "page", form }, { only: item.id })   // 配置区
```

`form` 的来源（`:3833-3840`）：

```js
const formFor = (id) => {
  if (!configurations?.some((view) => view.ns === id)) return void 0;
  const form = props.configForm(id);
  return { state: form.getSnapshot(), mutate: (ops, revision) => form.mutate(ops, revision) };
};
```

`props.configForm` / `props.configurations` 由 controller 注入（`:1032-1034`）：

```js
hooks: { …, configurations: this.ctx.configForms.describe() },
configForm: (id) => this.ctx.configForms.get(id),
```

**结论**：`plugins.item` 占用者收到的 props = `{ t, view: "summary"|"page", form?: { state, mutate }, ...inject() 面（hooks 映射为 useXxx） }`。
- `form` 只在 **`view === "page"`** 且 `configForms.describe()` 中存在 `ns === 注册 id` 时给出；否则 `undefined`（`plugins.row.config` 同理，`:2818-2821`）。
- `plugins.bundle.config` **只传 `{ view: "page" }`，不传 `form`**（`:2961-2965`）——bundle 配置页必须自己持有表单。
- 注册 id 必须等于 settings 命名空间，否则拿不到 `form`；官方 shell 页即因此自持 controller（其命名空间是 `bash-sandbox`/`pwsh-sandbox`，注册 id 却是 `shell`，见 `ui-settings-shell/lib/client.js:115-117,182-189`）。

官方四页注册形状（三个可直接照抄）：

| 包 | inject（服务） | 命名空间 | 注册 id / order |
|---|---|---|---|
| ui-settings-shell | `["slots","locale","configForms"]` | `bash-sandbox` / `pwsh-sandbox` | `shell` / 40 |
| ui-settings-agent-loop | `["slots","locale","configForms"]` | `agent-loop` | `agent-loop` / 30 |
| ui-settings-subagent | `["slots","locale","remote","remote.session","configForms"]` | `subagent` + `subagent-model-selection-settings` | `subagent` / 10 |

（`ui-settings-shell/lib/client.js:161-165,182-189`；`ui-settings-agent-loop/lib/client.js:139-143,158-165`；`ui-settings-subagent/lib/client.js:803-809,839-846`。）

### 2.5 `plugins.bundle.config` / `plugins.row.config`（是否更适合第三方 bundle）

ui-plugin-manager README:73 原文：

> `plugins.item` (list) for an official plugin, listed in Built-in plugin settings by its `label`; `plugins.bundle.config` (keyed by the bundle's package name) for a bundle's own configuration, shown on the bundle's page between its description and its rows; and `plugins.row.config` (keyed by `<package name>#<row id>`) for one row's configuration, which gives that row a **Configure** control opening the row's page.

README:75-83 给出可复制片段：

```tsx
ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
  name: 'plugins.row.config',
  key: '@acme/dsh-sidebar#sidebar',
  locale: 'acmeSidebar',
}, ({ t, view }) => view === 'summary' ? t('summary') : <SidebarForm t={t} />))
```

README:83：「The bundle's patch must declare the row under that id, and the registration exists while the bundle is on, so a bundle that is off shows no configure control.」
README:129：「Custom item pages use the Host entry id as their registration id; row pages use the bundle package and row id. The page owner supplies `form.state` and `form.mutate(operations, expectedRevision)` when the entry exposes editable Config fields.」

**dsh-ami 的定位**：它既是 bundle（`package.json:28-32` 声明 `dsh.bundle.patch`，且在 profile 的 `dsh.profile.bundles` 中，`C:\Users\15068\.dsh\profiles\desktop\package.json:15`），又不是官方插件。因此：
- `plugins.item`（id=`dsh-ami`）语义上是"官方插件"位置，但 slot 本身不校验，第三方同样可注册；优点是**能自动拿到 `form`**，且卡片出现在 Plugins 页首屏分组。
- `plugins.bundle.config`（key=`dsh-ami`）语义上正是"bundle 自己的配置"，但**不传 `form`**，需自持表单；入口在 Plugins → Installed → dsh-ami 详情页。
- `plugins.row.config`（key=`dsh-ami#dsh-ami`）需要 row 存在且 bundle 为 on。

三者都需要**同一个 settings 命名空间 `dsh-ami`**（否则写被 Host 拒绝）。

### 2.6 `cordis_inspect_query` 复现情况（记录）

| 调用 | 结果 |
|---|---|
| `client / Slots / listSubTree` + `input={"root":"settings.plugins.tab"}` | `Error: Client Cordis inspect Slots.listSubTree rejected input: "input" must be an object` |
| `host / Config / listConfigs` + `input={"name":"dsh-ami"}` | `Error: Host Cordis inspect Config.listConfigs rejected input: "input" must be an object` |
| `client / Slots / listSubTree` + `input={"root":"settings.plugins.tab"}`（再次，参数为字符串形式） | 同样报 `"input" must be an object` |
| `host / Config / listConfigs`（无 input） | 成功，返回 208 条 entry 的第 1 页（`total: 208`, `nextOffset: 25`），但**无 offset 参数则无法翻页**，未能在其中定位 dsh-ami |
| `client / Slots / listSubTree`（无 input） | `Error: Slots.listSubTree: Client inspect query Slots.listSubTree timed out after 10000ms` |

即：**带 input 的 inspect 查询在本会话完全不可用**，无 input 的 Host 分页也无法定位目标 entry。第 3 节改用源码求证。

---

## 3 entryId / 命名空间形式

### 3.1 结论

**settings 表单按 `entry.options.id` 寻址；对 dsh-ami 该值是 `dsh-ami`，不是 `include:dsh-ami`。**

### 3.2 证据链（逐条）

1. Host settings 服务把命名空间直接写成 `entry.options.id`：
   - `dsh-settings/lib/index.js:432` `ns: entry.options.id,`（写进 revision 表）
   - `dsh-settings/lib/index.js:443` `ns: entry.options.id,`（写进 describe 描述符）
   - `dsh-settings/lib/index.js:502` `const entry = this.ownerContext.configEditor.entries().find((row) => row.options.id === ns);`（写路径按 `options.id` 反查）
   - `dsh-settings/lib/index.js:435,461` 事件也带 `entry.options.id` 作为 ns。

2. `configEditor.entries()` 只取 include 树的直接子项，并保留 `entry.options.id`：
   - `dsh-config-editor/lib/index.js:31` `filter((entry) => entry.parent.tree.ctx.fiber.entry?.id === "include")`
   - `dsh-config-editor/lib/index.js:33-34` 按 `entry.options.id` 去重。
   - `dsh-config-editor/lib/index.js:43,50,51,61,98,101,106,122` 全部用 `entry.options.id` 去匹配 profile patch 行的 `id`。

3. `entry.options.id` 就是 profile patch / bundle patch 里那一行的 `id`：
   - 工作区 bundle patch：`D:\YhhCode\MyProject\dsh-ami\cordis.patch.yml:1-3` → `- insert: - id: dsh-ami, name: 'dsh-ami'`
   - profile 合成树 `C:\Users\15068\.dsh\profiles\desktop\cordis.yml:1382-1392` → 顶层行 `- id: dsh-ami / name: dsh-ami / config: {…8 个字段…}`
   - `cordis.yml` 中其它行的 `id`（如 `plugin-manager`、`subagent`、`ui-settings`）与 inspect 的 `patchId` 字段一致；inspect 的 `id` 字段才是带树前缀的 `include:<patchId>`。

4. 官方页面的硬编码命名空间与上述规则吻合：
   - ui-settings-shell：`BASH_NS = "bash-sandbox"` / `PWSH_NS = "pwsh-sandbox"`（`:115-117`），而 `cordis.yml:196,201` 正是 `- id: bash-sandbox` / `- id: pwsh-sandbox`。
   - ui-settings-agent-loop：`AGENT_LOOP_NS = "agent-loop"`（`:97`），对应 `cordis.yml:433 - id: agent-loop`。
   - ui-settings-subagent：`SUBAGENT_NS = "subagent"`（`:801`）与 `SUBAGENT_MODEL_SELECTION_NS = "subagent-model-selection-settings"`（`:515`），对应 `cordis.yml:327` 与 `:478`。

5. `include:` 前缀只属于"清单"展示层，不属于设置表单：
   - `ui-settings-plugin-inventory/lib/client.js:130-132`：`/** Display an entry identity without the composition-only include: marker. */ function entrySubtitle(entryId) { return entryId.replace(/^include:/, ""); }`
   - 同一文件把 `row.entryId` 渲染成 `data-loader-entry`（`:240-243`），说明 inventory 用的是完整 `include:` id。

### 3.3 交叉校验（写路径）

`dsh-settings/lib/index.js:504`：`if (entry === void 0 || schema === void 0) throw new Error(\`No configurable plugin entry "${ns}"\`);`
若把 ns 写成 `include:dsh-ami`，`entries()` 中不存在该 `options.id`，写会直接抛错、表单也不会出现在 describe 里。

### 3.4 不确定项（第 3 节）

- 未能在 live inspect 中直接读到 dsh-ami 那条 entry 的 `patchId`（`input` 不可用 + 无法翻页）。上述结论是"源码 + cordis.yml 合成树 + 官方页面硬编码"三重一致推导，置信度高但非 live 观测。
- 建议实现后用 `ctx.configForms.describe().getSnapshot().view.namespaces.map(n => n.ns)` 或 Plugins 页 `configurations` 实际值做一次运行时确认。

---

## 4 volatile 语义

### 4.1 包装对象与解包方式

cosmokit 的 volatile 实现（源码内联在 `dsh-client-ui-settings/lib/client.js:34-69`，与 `@deepseek-ai/cosmokit` 同源）：

```js
const write = Symbol.for("cosmokit.volatile.write");           // :34

function createVolatile(value) {                               // :53
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value) => { current = value; },
  });
}

function isVolatile(value) {                                   // :67
  return typeof value === "object" && value !== null && write in value;
}
```

- **解包就是 `.get()`**，没有别的属性（`Object.freeze` 只含 `get` 与那个 symbol）。
- **判定用 `isVolatile(value)`**（基于 `Symbol.for("cosmokit.volatile.write")`，跨 ESM/CJS 副本可用）。
- 包装对象被 `Object.freeze`，其内部 `current` 只能由拥有者运行时通过 `[write]` 更新（`:57-59`）——这就是"volatile-only 配置变更不重挂载、只就地提交新值"的机制。

Host 侧同一用法：`dsh-settings/lib/index.js:98` `if (isVolatile(value)) return plainConfig(value.get());`

### 4.2 Loader 的 volatile 更新契约

`@deepseek-ai/cordis-plugin-loader/README.md:51-53` 原文要点：

> `Entry.update` … when only `config` changed on an active fiber in an unchanged context, the pure `equalExceptVolatile` … ignores volatile fields at fixed object paths … A volatile-only change **retains the raw Fiber config for later activation, then `_commitVolatile` parses it through the fiber's `internal/config` hook and schema, commits the new values into the running references** when every ordinary effective value still matches, and emits `loader/volatile-update` to the owning fiber with the changed paths.

**推论（对 dsh-ami 至关重要）**：
- 配置变化时 `apply(ctx, config)` **不会**被重新调用，`config` 对象的身份不变。
- 插件**必须在使用时（事件回调内）读取 `config.<field>.get()`**，不能把解包值缓存到闭包常量里。
- 现有代码的读取时机基本都在事件回调内（见第 7 节），结构上兼容；但**每一处都必须加 `.get()`**。

### 4.3 全字段 `.volatile()` 的写法与限制

Schemastery 侧（同文件内联实现）：

```js
Schema.prototype.volatile = function volatile() {              // :496
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
```

`validateVolatileSchema`（`:502-513`）限制：**volatile 字段必须位于固定对象路径，且其祖先不能也是 volatile**（`:507` "volatile fields require a fixed object path without an enclosing volatile field"）。`Config` 顶层 8 个字段各自 `.volatile()` 满足该限制。

Host 表单投影（`dsh-settings/lib/index.js:122-131`）：

```js
function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema);
  if (schema.type === "object") {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child);
      return field === void 0 ? [] : [[key, field]];
    }));
    return Object.keys(dict).length === 0 ? void 0 : z.object(dict);
  }
}
```

→ **只有 volatile 字段会出现在表单里**；一个 volatile 字段都没有的 entry 在 `describe()` 中根本不存在（`:419` `if (form === void 0) return [];`）。

### 4.4 写是否支持 boolean / number 全类型

**支持**，但经 JSON 形状校验：

- `cloneJsonShaped`（`dsh-settings/lib/index.js:237-273`）只接受 `null` / `string` / `boolean` / 有限 `number` / 数组 / 纯对象；Date、Map、BigInt、NaN/Infinity、循环引用一律抛 `TypeError`（`:242-246,270`）。
- `applyPathOp`（`:189-216`）按 path 写入，数组下标有范围校验。
- 类型正确性最终由 `config-editor` 的 `resolveConfig(fiber.runtime, resolved)` 用**完整 Config schema** 校验（`dsh-config-editor/lib/index.js:83`）；不合法即抛错，写被拒绝、插件旧值保留（`dsh-settings` README:48 "Browser validation uses the serialized Config schema; the Host validates complete configuration"）。
- 因此 `z.boolean()` / `z.number().step(1).min(1).max(1000)` 这些约束都**会在 Host 侧生效**，UI 侧只是提前提示。

### 4.5 默认值 / reset / 继承语义

- snapshot 三值：`value`（已解析生效值）、`base`（继承层，即 bundle/home patch 之下的值）、`user`（profile patch 中的原始覆盖值）。来源 `dsh-settings/lib/index.js:436-439`（`value` = 运行时 config 投影，`base` = inherited，`user` = override）。
- `set(field, value)`：写 profile patch。
- `unset(field)`：走 `mutate` 的 unset 分支（`:488-500`）——非数组路径时取 `base` 中的继承值再 `set` 回去（`:493-498`），即"恢复继承/默认"。
- 整体 reset：`config-editor` 在 `next` 与 `inherited` 深等时**删除 patch 里的 `config` 键**（`:99-104`），因此"改回默认"不会在 profile patch 里留下冗余覆盖。
- 注意 `dsh-settings` README:74 的限制：**字段级 reset 只能恢复继承值，不能删除由更低配置层提供的值**；unset 数组下标是删除元素。

### 4.6 不确定项（第 4 节）

- `dsh-settings` README:37 提到 "Home patches and command-line overlays take precedence; a form write that they would override is refused"（`dsh-config-editor/lib/index.js:122` 实现该检查）。若 dsh-ami 同时被 home patch 覆盖，表单写会被拒绝——本机未验证是否存在此类覆盖。
- `loader/volatile-update` 事件 dsh-ami 未监听；是否需要监听取决于是否要在配置变化时做主动清理（现有代码不需要）。

---

## 5 参考实现骨架

### 5.1 Client 半边的声明方式

`dsh-client-modules/README.md:34`：

> A browser plugin package declares `dsh.client` in its `package.json` with `platform: 'web'`, exports a `./client` bundle, and lists any non-baseline module requests under `dsh.client.external`.

`references/ui-plugin.md:3`：

> its `package.json` adds a `dsh.client` section (`platform`, `immediately`, `inject`) and a `./client` export beside the bundle patch.

手写（无构建）client 包的最小 manifest 模板：`…\dsh-agent-preset\skills\cordis-plugin-development\templates\decoration\package.json:6-20`：

```json
"exports": { ".": "./index.js", "./client": "./client.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
"files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
}
```

浏览器侧入口格式（同上 `templates/decoration/client.js:1-22`）：

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',          // 必须等于包名
  factory(require) {
    const React = require('react');
    return { inject: ['slots'], apply(ctx) { /* ctx.slots.inject(...) */ } };
  },
});
```

官方配置页的 `dsh.client.inject` 写法（`ui-settings-subagent/package.json:29-39`）：

```json
"dsh": { "client": { "inject": [
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-plugin-manager",
  "@deepseek-ai/dsh-api-remotes"
], "platform": "web" } }
```

对应服务层 `inject`（`ui-settings-subagent/lib/client.js:803-809`）：`["slots","locale","remote","remote.session","configForms"]`。只读配置页可省掉 `remote*`（shell / agent-loop 只声明 `["slots","locale","configForms"]`）。

> 说明：官方包在 `client.js` 里 `require("@deepseek-ai/dsh-client-ui-primitives")` 却**没有**在 `dsh.client.external` 中声明它（见 `ui-settings-subagent/lib/client.js:9-10` 与 `package.json`），说明手写 bundle 的 `require` 边会被组合器观测到。这是推断，标记为不确定（见 5.5）。

### 5.2 locale 注册方式

官方统一写法（`ui-settings-agent-loop/lib/client.js:149-153`）：

```js
const NS = "settings.agentLoop";
const t = ctx.locale.bind(NS);
ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-settings-agent-loop: dictionaries");
```

`zh` / `en` 是纯对象字典，键必须一一对应（`ui-settings-plugin-inventory/lib/client.js:640-718` 是最完整的样例）。

### 5.3 可复制最小骨架（dsh-ami 用）

**package.json 增补**（不改动现有 `dsh.bundle`）：

```json
"exports": {
  ".": "./index.js",
  "./client": "./client.js",
  "./locale/*.json": "./locale/*.json",
  "./icon": "./icon.svg"
},
"files": ["index.js", "client.js", "lib/logic.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-plugin-manager"
    ]
  }
}
```

**client.js（结构骨架）**：

```js
window.__ModuleLoader__.load({
  id: "dsh-ami",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { SettingsForm, SettingsValueField, Switch } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "settings.dshAmi";
    const SETTINGS_NS = "dsh-ami";   // == Host entry.options.id 见第 3 节

    const en = { title: "AGENTS.md inject", description: "…", save: "Save", /* … */ };
    const zh = { title: "AGENTS.md 周期注入", description: "…", save: "保存", /* … */ };

    const FIELDS = [
      { key: "enabled",        kind: "boolean", labelKey: "enabled" },
      { key: "everyTurns",     kind: "number",  labelKey: "everyTurns" },
      { key: "maxSourceBytes", kind: "number",  labelKey: "maxSourceBytes" },
      { key: "maxInjectBytes", kind: "number",  labelKey: "maxInjectBytes" },
      { key: "truncateOversize",   kind: "boolean", labelKey: "truncateOversize" },
      { key: "wrapSystemReminder", kind: "boolean", labelKey: "wrapSystemReminder" },
      { key: "onlyIfChanged",      kind: "boolean", labelKey: "onlyIfChanged" },
      { key: "includeSubagents",   kind: "boolean", labelKey: "includeSubagents" },
    ];

    // 直接使用 Host 提供的 form（view === "page" 时存在）
    function Card(props) {
      const { t, view, form } = props;
      if (view === "summary") return t("description");
      if (form === undefined) return h("p", null, t("unavailable"));
      const snap = form.state;                      // { value, base, user, revision, writable, status }
      if (snap.status !== "ready") return h("p", null, t("unavailable"));
      // 逐字段渲染：布尔用 Switch，数字用 SettingsValueField(numeric)
      // 提交：form.mutate([{ op:"set", path:[key], value }], snap.revision)
      // 复位：form.mutate([{ op:"unset", path:[key] }], snap.revision)
      return h(SettingsForm, { /* labels, state, onSave, onDiscard */ }, /* fields */);
    }

    const inject = ["slots", "locale", "configForms"];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-ami: dictionaries");
      ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () =>
        ctx.slots.inject("plugins.item", () =>
          ctx.slots.register({
            name: "plugins.item",
            id: SETTINGS_NS,
            order: 50,
            label: () => t("title"),
            locale: NS,
          }, Card))), "dsh-ami: page");
    }

    return { inject, apply };
  },
});
```

要点：
- `id: "dsh-ami"` 必须与 `SETTINGS_NS` 一致，否则 `form` 为 `undefined`。
- 不注册 `inject()` 也行（走页面给的 `form`），此时组件只收到 `{ t, view, form }`。
- 若要像官方页一样自持表单（更强的 draft/校验控制），注册时加 `inject: () => card.inject()`，并在 `apply` 中 `ctx.configForms.get("dsh-ami")` 建 controller（见 5.4）。

### 5.4 官方 controller 模式（自持 draft 时照抄）

`ui-settings-agent-loop/lib/client.js:99-127` 是最短范例：

```js
var AgentLoopCardController = class {
  constructor(scope) {
    this.form = new SettingsFormModel(scope, [settingsNumberField("maxParallelToolCalls")]);
    this.store = this.form.bind(() => this.projection());
  }
  projection() { return { ...this.form.shell(), maxParallelToolCalls: this.form.field("maxParallelToolCalls") }; }
  inject() { return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }; }
  dispose() { this.form.dispose(); }
};
```

使用：`const card = new AgentLoopCardController(ctx.configForms.get(AGENT_LOOP_NS));` + `ctx.effect(() => () => card.dispose(), "…")`（`:154-157`）。
组件内通过 `props.useAgentLoopCard(s => s)` 取快照，用 `SettingsForm` / `SettingsValueField` 渲染（`:62-89`）。

### 5.5 不确定项（第 5 节）

- `@deepseek-ai/dsh-client-ui-primitives` **在 app.asar 内没有 README**（`…/dsh-client-ui-primitives/README.md` → not found），未读到其导出清单。
- 已确证存在的导出（从官方页面 `require` 与调用点）：`SettingsForm`、`SettingsValueField`、`SettingsFormModel`、`settingsNumberField`、`Switch`、`Tag`、`StateDot`、`Button`、`Menu`、`Modal`、`Tooltip`、`Input`、`TerminalBlock`、`SegmentedTabs`、`useAnchoredPosition`、`useDismissOnOutsidePointer`、`pointerModality`、多个 `Icon*`、`PluginArtwork*`。
- **`settingsBooleanField` 未在任何 shipped 页面中出现**，是否存在未证实。布尔字段建议直接用 `Switch`（官方 `SubagentModelSelectionFields` 用法，`ui-settings-subagent/lib/client.js:276-281`）+ `form.mutate([{op:"set",path:[key],value}], rev)`，或自行实现受控 checkbox。
- `dsh.client.external` 对 `@deepseek-ai/dsh-client-ui-primitives` 是否必需未证实（官方包未声明）。若加载报"missing supplier"，补 `"external": ["@deepseek-ai/dsh-client-ui-primitives"]`。
- 手写 `client.js` 是否要求先 `pnpm run build`：`dsh-client-modules/README.md:54` 说"host serves built client bundles"，但 decoration 模板与官方包都是直接把 `./client` 指向手写/构建产物；对 link 安装的手写包应直接生效（未实测）。

---

## 6 生效路径

### 6.1 当前安装方式：github tarball 的复制，改工作区无效

- profile 依赖：`C:\Users\15068\.dsh\profiles\desktop\package.json:21` → `"dsh-ami": "github:LingluoYusa/dsh-ami"`
- pnpm 实际解析（`…\desktop\node_modules\.modules.yaml`，`hoistedLocations`）：
  `"dsh-ami@https://codeload.github.com/LingluoYusa/dsh-ami/tar.gz/b1c951d065b196575cfdaacdd9d4c6bd87915c51(@deepseek-ai/cosmokit@1.8.6)": ["node_modules\\dsh-ami"]`
- `node_modules\dsh-ami` 是**普通目录（非 symlink/junction）**，`Get-Item` 的 `LinkType` 为空。
- **SHA256 逐字节对比（本会话实测）**：

  | 文件 | 工作区 vs 安装副本 |
  |---|---|
  | `index.js` | same = True |
  | `package.json` | same = True |
  | `lib\logic.js` | same = True |
  | `cordis.patch.yml` | same = True |

→ 修改 `D:\YhhCode\MyProject\dsh-ami` 后，**必须重新安装/同步**才会生效。

### 6.2 github 复制安装 vs `install_bundle` 本地目录 link

`@deepseek-ai/dsh-plugin-manager/README.md:50`：

> Source Web and development Desktop offer `link:<absolute workspace package directory>` from the running CLI installation … **Linked packages use that checkout's dependencies and peers; rebuilding and restarting remain necessary after code changes.**

`references/host-plugin.md:35`：

> Local directory installation **links the checkout** instead, so check the files directly; `files` does not filter a linked directory.

即：
- `github:` 安装 → pnpm 拉 tarball 解包成**副本**（当前状态）。
- `plugin_manager install_bundle` 传工作区绝对路径 → 依赖写成 `link:D:\YhhCode\MyProject\dsh-ami`，之后改工作区文件即改实际加载的代码；`files` 不参与过滤（新增 `client.js` 无需先发布）。

### 6.3 重启进程 / 刷新页面

依据：

- `dsh-plugin-manager/README.md:14`：「With HMR enabled in YAML, configuration changes apply immediately; without HMR, the running composition remains until restart.」
  本机 profile 启用了 HMR：`cordis.yml:9-13`（`- id: hmr`，`disabled: !!js '!ctx.get(''profileContext'')'` → 有 profile 时启用）。
- `dsh-plugin-manager/README.md:100`（HMR 分支）：安装新包/启用 bundle 由 HMR 重组；**替换已安装包**时「the previous version's plugins stop, its modules are evicted and its mappings removed before the new one is installed」，而 "without HMR it reports `restart-required`"。
- `references/host-plugin.md:70`：「Installing a new bundle can activate through HMR; **replacing an installed package requires restart to load a fresh JavaScript module generation.** Do not infer updated browser code from an unchanged slot id.」
- `dsh-client-modules/README.md:78`：客户端产物按 `mtimeMs/ctimeMs/size` 派生 revision，HMR 用 `rebuilt()` 触发 `invalidate`/`prefetch`；`:46` 另有一条硬限制——**Host release 变化时页面不会应用新图，只能刷新页面**。
- `dsh-client-modules/README.md:138`：「Bootstrap and code replacement limits — … Removing or replacing the bootstrap requires a page reload」。

**结论（保守可执行路径）**：
1. 把 dsh-ami 改成 link 安装（替换 github 副本）→ 这一步本身可能需要 **重启 DSH 进程**（替换已安装包）。
2. Host 代码（index.js / lib/logic.js）改动 → 必须**重启 DSH 进程**（Node 模块已缓存）。
3. Client 代码（client.js / locale / package.json 的 `dsh.client`）改动 → 先看是否能通过 HMR 生效；**最可靠做法是重启 DSH 进程 + 刷新浏览器页面**。不能仅凭 slot id 不变就判定浏览器代码已更新（host-plugin.md:70 原话）。
4. 判断是否真的生效：`plugin_manager` 的结果 `application` 字段（`applied` / `restart-required` / `overridden` / `failed`），以及页面是否出现新的 `plugins.item` 卡片。

### 6.4 不确定项（第 6 节）

- 本机 `hmr` 配置为 `root: []`（`cordis.yml:12-13`），未确认该值是否覆盖 link 目录的 `client.js` 监视；因此**不保证**改 client.js 后免重启。
- `dsh-client-ui-settings` 的 `describe()` 在 entry 卸载/替换时会发 `settings/document-updated`（`dsh-settings/lib/index.js:435,461`），但页面能否在无刷新下重挂载新插件取决于 client HMR，本机未实测。
- Desktop 版安装操作由 Desktop shell 拥有（`dsh-plugin-manager/README.md:146`），agent 侧 `plugin_manager` 工具需要 danger-full-access/审批；本会话审批已禁用，**未实际执行安装**。

---

## 7 影响面清单：现有 `config.*` 读取位置

`ops_grep pattern="config[.?]"` 于工作区 `index.js` + `lib/logic.js`，共 11 处命中。

### 7.1 index.js（8 处）

| 行号 | 代码 | 字段 | 全 volatile 后的错误行为 |
|---|---|---|---|
| 102 | `const limit = config.maxSourceBytes;` | maxSourceBytes | 包装对象非 SafeInteger → 抛 `invalid source limit` → 每次读盘都降级为 `read-error`（`:103`） |
| 142 | `buildInstructionText(text, config.wrapSystemReminder)` | wrapSystemReminder | 恒为真值 → 永远包裹 `<system-reminder>` |
| 161 | `resolveEveryTurns(config.everyTurns, deps.isVolatile ?? fallbackIsVolatile)` | everyTurns | **已正确**：`logic.js:60` 用 `isVolatile(raw) ? raw.get() : raw` |
| 179 | `if (config.onlyIfChanged && digest === state.lastInjectedHash) return next();` | onlyIfChanged | 恒为真值 → 永远去重（行为反转） |
| 229 | `if (!isCurrent() \|\| !config.enabled) return;` | enabled | 恒为假 → **主开关彻底失效**（关不掉） |
| 231 | `const verdict = config.includeSubagents === true ? … : …` | includeSubagents | `=== true` 永远 false → 子智能体 opt-in 失效 |
| 165 | `readAgentsMd(ctx, config, payload.signal, cache, isCurrent)`（传递整个 config） | — | 间接触发 102 |
| 173 | `planInjection(read.text, config)`（传递整个 config） | maxInjectBytes / truncateOversize | 见 logic.js |

另：`config` 被闭包捕获的入口为 `apply(ctx, config)`（`:215`）、`registerForAgent(ctx, config, …)`（`:150`）、`readAgentsMd(ctx, config, …)`（`:94`）、`buildMessage(ctx, warned, text, config, …)`（`:139`）。由于 volatile 变更不重挂载，这些闭包里的 `config` 引用**长期有效**，只要读的时候 `.get()` 即可。

### 7.2 lib/logic.js（3 处）

| 行号 | 代码 | 字段 | 全 volatile 后的错误行为 |
|---|---|---|---|
| 66-67 | `Number.isInteger(config?.maxInjectBytes) && config.maxInjectBytes > 0 ? config.maxInjectBytes : Infinity` | maxInjectBytes | 判定为 false → 退化为 `Infinity` → **截断上限完全失效**（AGENTS.md 全文注入） |
| 73 | `if (config?.truncateOversize === true)` | truncateOversize | 永远 false → 超限一律 skip 而非截断 |
| 116 | `if (config?.enabled !== true) return { register: false, reason: "disabled" };` | enabled | 恒成立 → `canRegisterForAgent` **永远返回 disabled** |
| 117 | `if (config?.includeSubagents === true) return { register: true, reason: "all-agents" };` | includeSubagents | 永远 false |

（`logic.js:59-62` 的 `resolveEveryTurns(raw, isVolatileFn)` 是**唯一已具备 volatile 解包**的函数，可作为其它字段的改造范式。）

### 7.3 结论

**"只加 `.volatile()` 而不改读取代码"会导致插件完全失效**（enabled 判定恒为 disabled、maxSourceBytes 校验抛错、maxInjectBytes 退化为 Infinity）。必须同步改造为逐字段 `.get()`。

---

## 8 对实现方案的关键约束

1. **必须新增 Client 半边**：`package.json` 加 `./client` 导出与 `dsh.client`（`platform: "web"` + `inject` 包名列表）；新增 `client.js`（`window.__ModuleLoader__.load` 格式）；`files` 加入 `client.js`（link 安装不受 `files` 过滤，但为发布正确性仍应加）。
2. **8 个字段全部 `.volatile()`**，否则表单里看不到、写了也会被 Host 拒绝（`dsh-settings/lib/index.js:419,507,520`）。
3. **同时改造 11 处 `config.*` 读取为 `.get()`**（第 7 节表），否则功能回归。建议在 `index.js` 内加一个统一解包助手（例如 `const read = (field) => (isVolatile(field) ? field.get() : field)`，`isVolatile` 已惰性加载并带 `fallbackIsVolatile` 兜底），把 `config` 的解包集中在少数几个边界上；`lib/logic.js` 保持纯函数，由调用方传入已解包标量（与现有 `resolveEveryTurns` 的风格一致）。
4. **设置命名空间固定为 `"dsh-ami"`**（= `entry.options.id` = `cordis.patch.yml` 里 insert 行的 `id`），**不要**用 `include:dsh-ami`。
5. **注册点选择**：
   - 首选 `plugins.item` + `id: "dsh-ami"`：可白拿页面提供的 `form`（`{state, mutate}`），实现量最小；与官方四页同构。
   - 备选 `plugins.bundle.config` + `key: "dsh-ami"`：语义最贴合"第三方 bundle 自己的配置"，但**不传 form**，必须自持 controller。
   - 不建议 `settings.plugins.tab`：那是 Settings → 内置插件的只读清单区，且不传 `form`、不传 `view`。
6. **写入用页面给的 `form.mutate(ops, revision)` 或 `ctx.configForms.get("dsh-ami")`**，不要直接调 `remote.settings`（`get` 的写走 provider 的 ctx，调用方无需 `remote.settings`）。
7. **revision 必须回传**：`mutate(ops, snapshot.revision)`；冲突时保留 draft 并提示（官方文案 "Settings changed elsewhere. Discard your draft and try again."，`ui-settings-subagent/lib/client.js:48`）。
8. **生效路径**：先把 github 副本换成工作区 link 安装（`install_bundle`），再重启 DSH 进程 + 刷新页面；不要假设 HMR 会自动换掉已加载的 Host 模块或浏览器 bundle。
9. **需要 locale**：新增字典命名空间（如 `settings.dshAmi`）并在 `ctx.effect` 内 `ctx.locale.register`；`zh`/`en` 键必须一一对应。
10. **显示元数据**：`locale/*.json` 的 `meta.title` / `meta.description` 与 `./icon` 已存在（工作区 `locale/zh.json`、`locale/en.json`、`icon.svg`），保持即可。

---

## 9 未决 / 不确定项汇总

| # | 项 | 状态 |
|---|---|---|
| 1 | dsh-ami 的 live `patchId` 未直接观测 | 源码三重推导为 `dsh-ami`；建议实现后运行时确认 |
| 2 | `lib/types/**/*.d.ts` 与 `src/` 不在 app.asar | 签名以 `lib/client.js` 实现 + JSDoc 为准 |
| 3 | `settingsBooleanField` 是否存在 | 未证实；先用 `Switch` + `mutate` |
| 4 | `dsh.client.external` 是否需声明 ui-primitives | 官方包未声明；若加载报 missing supplier 再补 |
| 5 | 手写 client.js 是否免构建 | 官方/模板均如此，但未在本机实测 |
| 6 | link 安装后 client.js 改动能否免重启 | 未实测；保守走重启 + 刷新 |
| 7 | `cordis_inspect_query` 带 input 全不可用 | 已复现 3 次并记录 |
| 8 | 是否存在 home patch 覆盖 dsh-ami 导致表单写被拒 | 未检查 `~/.dsh` home patch |
| 9 | 未实际执行安装 | 本会话审批禁用，`plugin_manager` 无法调用 |
