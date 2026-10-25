# dsh-tools

DSH 工具整合包。bundle 为每个子模块插入一行，每个子模块在 Plugins 页有自己的行与 Configure 二级配置页。

- 包名 `dsh-tools` 版本 `1.0.7`
- 当前子模块 `dsh-tools-ami`（目录 `components/ami`）中文名「记忆回声」：每 N 轮结束后把 `~/.dsh/AGENTS.md` 重新写进下一轮上下文
- `cordis.patch.yml` 插入两行：包根裸包名行 `dsh-tools`（只承载 Client 配置页，无设置）与子模块行 `dsh-tools-ami`（`name: 'dsh-tools/ami'`，Host 实现与 8 字段 config）
- Client 半边在包根 `client.js` 注册 `plugins.row.config`，key 为 `<bundle 包名>#<row id>`
- 单包一次 git 安装即可；拆分为独立子模块包需要子模块已发布到 npm 见 10.2

---

## 1. 定位：周期重锚 不是首次加载

`~/.dsh/AGENTS.md` 已由 shipped 插件 `@deepseek-ai/dsh-agent-instructions` 在会话开始时加载为基线。「记忆回声」不做首次加载，只在长会话里**周期性地把同一份全文重新锚定到上下文尾部**，降低指令在长上下文里被稀释或压缩吞掉的影响。

只读 `<dshHome>/AGENTS.md` 一个文件。不自造第二个 instruction 根，不读项目级 AGENTS.md。

## 2. 命中轮号

判定式为严格读法 `(turn - 1) % N === 0 && turn > 1`，命中轮号为 `N+1、2N+1、3N+1 …`。

| N | 命中轮号 | 首次注入时点 |
| --- | --- | --- |
| 1 | 2、3、4、5 … | 第 1 轮结束后（**第 1 轮永不注入**） |
| 2 | 3、5、7、9 … | 第 2 轮结束后 |
| 10 | 11、21、31 … | 第 10 轮结束后 |

语义是**严格「N 轮结束后、下一轮生效」**。`N = 1` 时第 1 轮不注入、从第 2 轮起每轮注入，这是严格读法的必然结果 不是缺陷。

## 3. 注入位置

注入消息追加在 `agent/pre-step` waterfall 返回的 `decision.messages` **尾部**，形态是一条 user 消息（`source.kind = "agents-md-periodic-inject"`）。

- 落在 runtime-context 快照之后、shipped 基线副本之外；
- 与 `@deepseek-ai/dsh-agent-instructions` 的 `lastClaimedIndex + 1` 落点不同 不抢位；
- 最终相对顺序仍由 pre-step 监听器注册顺序决定 因此**位置不做强保证**，只保证在尾部方向。

## 4. token 成本

- shipped 基线已有一份，子模块每次注入**再加一份副本**，与基线重复是必然。
- 成本随会话长度**线性增长**：`ΔT_total ≈ ΔT × floor(T_total / N)`，`ΔT ≈ ceil(injectedBytes / 3.5)`。
- 子模块**不产生额外 turn、不产生额外模型调用**（只在已有 step 准入时改写 decision）。
- 四个量化控制旋钮：`everyTurns`（线性缩放总成本）、`maxInjectBytes`（单次封顶）、`maxSourceBytes`（源文件过大整体跳过）、`onlyIfChanged`（内容未变则不注入）。

## 5. 设置入口

**每个子模块的设置只显示在它自己的 Configure 二级页面**，不在 bundle 详情一级页面直接展示。当前子模块「记忆回声」保留 7 个可编辑字段（3 个数字项和 4 个勾选项）；Host `enabled` 字段不由表单提供。

用户可达路径：

1. 侧栏 **Plugins** → **Installed plugins** → **dsh-tools**（打开 bundle 详情页）；
2. 行列表里有两条：`dsh-tools` 是包根承载行（没有设置，只用来加载 Client 配置页），**记忆回声**（row id `dsh-tools-ami`）是子模块行；
3. 点 **记忆回声** 行标题上的 **Configure**，二级页面提供 7 个设置控件，并保留「保存」「恢复默认值」和「打开 AGENTS.md」。

**新增子模块的方式**：`cordis.patch.yml` 插入新行（`id` = 新 row id，`name` = 新子模块的模块路径如 `dsh-tools/<name>`）；子模块 Host 实现放在 `components/<name>/`；包根 `client.js` 为新 row id 追加一个 `plugins.row.config` 注册（key `dsh-tools#<新 row id>`）。包根的裸包名承载行只需要一条，所有子模块共用。

**不在 Settings 面板里**。官方机制原话：A plugin that carries its own configuration renders it on this page rather than in Settings。bundle 被关闭时该行不出现 Configure 控件，需先在 Plugins 页启用。包根承载行被单独关闭时同样会失去 Configure 页面，Host 注入不受影响。

- 8 个字段全部 `.volatile()`：`settings.write` 对非 volatile 路径直接抛 `Config field "..." is not volatile`，设置表单也只投影 volatile 字段。漏掉一个字段的症状是该字段根本不进表单。
- 页面注册在 slot `plugins.row.config`，注册 key 为 `dsh-tools#dsh-tools-ami`（`<bundle 包名>#<row id>`），由包根 `client.js` 注册；Host settings namespace 为 `dsh-tools-ami`（= `cordis.patch.yml` 里子模块 insert entry 的 `id`）。
- 写入走 Client 表单的 `form.mutate([{ op:"set", path:[key], value }], revision)`，持久化、revision 冲突检测、原子写与失败回滚全部由官方 `dsh-config-editor` 承担，`applies: "live"` 无需重启会话。
- 子模块在每次 `agent/pre-step` 与 `agent/created` **现读并解包** volatile 字段（volatile 变更不会重新调用 `apply`，因此不能把解包结果缓存成闭包常量）。

## 6. 配置表（记忆回声）

| 字段 | 类型 | 默认 | 单位 / 取值域 | volatile | 修改入口 |
| --- | --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | — | **是** | patch（当前 UI 未提供） |
| `everyTurns` | number | `10` | DSH turn 1–1000 整数 | **是** | 配置页 / patch |
| `maxSourceBytes` | number | `1048576` | 字节 1 – `Number.MAX_SAFE_INTEGER` 整数 | **是** | 配置页 / patch |
| `maxInjectBytes` | number | `16384` | 字节 1 – `Number.MAX_SAFE_INTEGER` 整数 | **是** | 配置页 / patch |
| `truncateOversize` | boolean | `true` | — | **是** | 配置页 / patch |
| `wrapSystemReminder` | boolean | `true` | — | **是** | 配置页 / patch |
| `onlyIfChanged` | boolean | `false` | — | **是** | 配置页 / patch |
| `includeSubagents` | boolean | `false` | — | **是** | 配置页 / patch |

**注意**：二级页面保留 7 个可编辑字段，Host `enabled` 仍由 patch 配置，未新增到 Client 表单。匹配的 override 会整体替换 config，用户 patch 必须写全 8 个字段。首次在配置页保存后，profile patch 的该行会固化为完整 8 字段，此后子模块升级修改默认值不再自动生效；点「恢复默认值」会 `unset` 表单中的 7 个字段并回落到继承层（bundle patch 的 shipped 默认值），此时若与继承层深等则删除该行的 `config` 键。

两个字节上限字段显式声明 `.max(Number.MAX_SAFE_INTEGER)`：运行时 `readAgentsMd` 用 `Number.isSafeInteger` 校验源上限，若 schema 允许 `2**53` 这类值写入，会抛 `invalid source limit` 并静默降级为 `read-error`（每个命中轮号都不注入）。页面与 Host 两侧都拦这个上界。

体积两级降级：超过 `maxInjectBytes` 时按 `truncateOversize` 决定「截断并追加显式截断标记 `[truncated: content exceeded maxInjectBytes]`」或「跳过并告警」；若 stat 已知源文件超过 `maxSourceBytes` 则先跳过。size 缺失或文件在读取期间增长时，`fs.readBytes(target, signal, maxSourceBytes)` 的 inclusive 硬上限以 `FS_TOO_LARGE` 拒绝超限文件，不返回截断内容；恰好等于上限的文件允许读取。读取结果须通过 NUL 采样与严格 UTF-8 校验，缓存仅绑定有效的 targetKey + version。

**`maxInjectBytes` 只限制截断前的正文预算**，并非完整注入文本的硬上界。完整文本还包含截断标记（46 B）、固定 intro（含换行 117 B）及可选 wrapper（37 B）。因此截断时文本总字节数最多为 `maxInjectBytes + 200`（`wrapSystemReminder: true`），或 `maxInjectBytes + 163`（`false`）；这不含消息对象及模型协议封装开销。

## 7. 子智能体

- 默认 `includeSubagents: false`，**只对主 agent 生效**。
- 主 agent 判定使用 `ctx.get("agents")?.roots().includes(agent)`（必须用 `includes` 而不是 `length === 1`，并发创建时会误判）；`source` 参数不能用于此判定，因为子智能体走同一工厂、`source` 同为 `"startup"` / `"resume"`。
- **服务缺失不再静默**：若 `ctx.get("agents")` 不存在、`roots` 不是函数、或 `roots()` 抛错，判定结果为 `unavailable` → **发一次性告警 `agents-unavailable` 且不注册**；普通「非主 agent」仍静默（正常路径）。
- **谓词惰性求值**：`includeSubagents === true` 时**不调用**谓词，直接进入 all-agents 分支。因此 `roots()` 异常不会破坏这条用户显式 opt-in 的逃生通道。
- **运行中改 `includeSubagents` 不追溯已存在的 agent**：判定发生在 `agent/created` 时刻。该字段现在可在配置页改动，但只影响此后新建的 agent。

## 8. 失败语义

读取失败 / 文件不存在 / 空文件 / 超限 / 消息构造失败，一律**不注入且不中断 turn**，异常不冒泡。

- `agent/created` 是 serial 事件，监听器整体 try/catch **永不抛错**（否则会导致 agent 创建失败）。
- 告警统一由不抛错的 `warnOnce` 包住 `ctx.logger.warn`：即使 logger 抛错也不会中断 pre-step 或导致 agent 创建失败。
- 按版本节流的告警键为 `path#version`；另有四条一次性诊断键：`build-fallback`、`home-fallback`、`agents-unavailable`、`predicate-not-ready`。
- 告警一律走 `ctx.logger.warn`，按文件版本节流：同一 `path#version` 最多一条。
- 双水位线：`attemptedTurn` 在尝试读取**前置位**（同 turn 后续 step 不再读盘）；`lastInjectedTurn` **仅在注入成功后**推进。失败只推进前者，因此该 turn 不重试，下一个命中轮号重新尝试。
- 子模块 effect 激活时设置 `active` 并递增 `generation`；卸载时先关闭闸门并递增代次，再释放订阅与每个 per-agent disposer。异步恢复后的旧 created / pre-step 回调不会重新注册或迟到注入；agent effect 单独释放也关闭其 `alive` 闸门。清理仍保留 `states.delete(agent)` 并清空状态表。

## 9. 未验证项与风险

| # | 内容 | 影响 |
| --- | --- | --- |
| U3 | 压缩（compaction）是否吞掉注入 | 重锚效果未知；按「可能被吞掉、下一个命中轮号重发」设计，不假设免疫 |
| U5 | 行「记忆回声」的 Configure 控件与 7 个控件渲染 | 机制与 `dsh-delete-session` 相同（裸包名承载行加载 Client + `plugins.row.config`）仍需重启 DSH 后**运行时实测**；包根承载行 `dsh-tools` 无设置属预期 |
| B10 | 渲染层对未知 `source.kind` 的处理 | 显示形态未知；写入侧已由 shipped 插件证明可行 |
| B8 | fork 后轮号是否重置 | 判定完全由轮号决定 两种情况行为都自洽 |
| B9 | resume 是否重放同一 turn 的 step>1 | 可能造成注入位置偏移 仍只注入一次 |
| M1 / U2 | 本地 linked 安装下裸包名能否解析 | 运行时模块解析拦截的**作用域未验证**（是否只对 profile 目录下的导入方生效） |

**对 U2 的防御性写法**：`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/cosmokit` 三个裸包名是**惰性动态 import + 降级**（见子模块 `packages/ami/index.js`）。

- 惰性降级只保护上述三个包，解析失败时走降级分支，不会导致模块加载失败。
- `@deepseek-ai/schemastery` **仍是静态 import**（`Config` 必须是同步具名导出），在模块链接期求值；子模块 `package.json` 已把它写进 `dependencies`（`~3.18.5`），正常安装即可解析。
- 安装后必须实测子模块确实加载：`cordis_inspect_query` host `Config.listConfigs` 中 `dsh-tools-ami` 的 `status === "schema"`，且 Plugins 页能列出「记忆回声」行。

**惰性降级表**：

| 依赖 | 不可用时的降级 | 告警 |
| --- | --- | --- |
| `@deepseek-ai/dsh-llm` | 手动构造等价 user 消息 `{ id, role: "user", content, source }` | `build-fallback`（附解析错误对象） |
| `@deepseek-ai/dsh-home-paths` | 回落 `$DSH_HOME`，再回落 `~/.dsh` | `home-fallback`（附解析错误对象） |
| `@deepseek-ai/cosmokit` | 用 duck-type（`typeof value.get === "function"`）识别 volatile 包装对象 | 不告警（功能等价降级） |

**`fallbackHome()` 与 `resolveDshHome()` 的优先级差异**：`resolveDshHome()` 的优先级是「显式配置的 dshHome > `$DSH_HOME` > `~/.dsh`」；兜底的 `fallbackHome()` **只认 `$DSH_HOME` 与 `~/.dsh`**，**不覆盖「显式配置 dshHome」这一最高优先级**。当前部署 `DSH_HOME` 已设置故无影响；若宿主显式配置了非 `$DSH_HOME` 的 dshHome 且 `dsh-home-paths` 又不可用，兜底会读到错误的 AGENTS.md 根。

**不使用** `runtime-context` / `agent-instructions` / `system-prompt` / `model-selection` / `tool` 这些会被框架特殊处理的 `source.kind`。

## 10. 安装与卸载

经 `plugin_manager` 的 `install_bundle`（本地目录为 linked 安装）与 `remove_bundle` 完成。**不要**手工改 profile 的 `package.json` 或 `cordis.patch.yml`。

单包一次安装即可：

1. `install_bundle` 指向仓库地址 `github:LingluoYusa/dsh-tools` 或本地工作区 `D:\YhhCode\MyProject\dsh-tools`；
2. 重启 DSH 进程并刷新浏览器页面。

**注意**：

- `github:` 复制安装取的是仓库快照。改工作区后必须提交并推送，再在 Plugins 页 Remove 后重新 Add（第三方 git 包没有 Update 按钮）；
- `link:` 本地安装可直接联调 改动即生效 但 Host 模块变更仍需重启 DSH；
- 判断是否真的生效看 `plugin_manager` 结果的 `application` 字段（`applied` / `restart-required` / `overridden` / `failed`），以及 Plugins 页是否出现「记忆回声」行的 Configure 控件。

### 10.1 新配置记录与入口

- 子模块 row id、Host Config namespace、Client namespace 均为 `dsh-tools-ami`；行模块名是 `dsh-tools/ami`。
- `cordis.patch.yml` 插入 profile 的两个 entry：`id: dsh-tools` / `name: 'dsh-tools'`（包根承载行，只加载 Client 配置页）与 `id: dsh-tools-ami` / `name: 'dsh-tools/ami'`（子模块行，`Config` 与 `apply` 在这里）。
- Client 配置页注册到 `plugins.row.config`，key 为 `dsh-tools#dsh-tools-ami`。
- 旧 `dsh-ami`、`dsh-tools-agents` 等历史配置记录不读取、不迁移、不删除。子模块从默认值开始，保存后由官方机制写入 profile patch 的新 entry；本项目不创建或维护物理配置目录。
- API 使用 `/api/dsh-tools/ami/open-agents`；Client 字典为 `settings.dshToolsAmi`，表单 DOM 前缀为 `dsh-tools-ami-`。AGENTS.md 仍从既有 dsh home 读取，`source.kind` 与周期注入规则不变。
- 仅修改工作区源码，未安装插件或操作 profile。安装并重启 DSH、刷新页面后验证行与 Configure 页面。

### 10.2 为什么需要包根承载行 而不是拆独立包

两个框架约束共同决定当前结构：

1. `@deepseek-ai/dsh-client-modules` 只把包的浏览器半边挂到 specifier 为裸包名的 Loader 行：`exactPackageSpecifier()` 对含 `/` 或 `:` 的 specifier 返回 `undefined` 该行不产出 client source。子路径行 `dsh-tools/ami` 无法加载 `client.js` 因此需要一条包根行 `name: 'dsh-tools'` 来承载配置页。
2. DSH 安装策略启用了 `blockExoticSubdeps`：子依赖不允许 git/URL/tarball/file 这类非 registry 来源。官方多子模块整合包 `@deepseek-ai/dsh-experimental-agent-team-profile` 的子模块都是已发布到 npm 的独立包；本包若把子模块做成独立包、再用同仓库的 `git+...#path:` 依赖引入 安装时会被拒绝并报 `ERR_PNPM_EXOTIC_SUBDEP`。

因此当前采用单包结构：包根承载行加载 Client 配置页，子模块以子路径行 + 独立 Host 实现存在，所有子模块共用一条承载行。等功能稳定后若把子模块发布为 npm 包，可以再切回独立包形态（行名改成裸包名 去掉承载行）。

## 11. 不做什么

- 不注册工具、不注册命令；
- 不监听 `system-prompt/assemble`，不追加或修改 system prompt 文本与工具；
- 不写自定义 type 的 session 事件，不用 `appendPluginRecord()`，不注册 session 投影；
- 不修改其他插件的贡献（不重排、不删除 `decision.messages` 中他人条目）；
- 不在 `agent/ctx` 之外注册 per-agent 监听，不轮询 `agent/status`。

---

## 附. 与实现规格的偏差记录

1. `lib/logic.js` 之外的三个裸包名由静态 import 改为惰性动态 import + 降级（见第 9 节）。
2. `source.kind` 采用实现规格 §2.2 冻结值 `"agents-md-periodic-inject"`。
3. 新增一条降级告警 `build-fallback`，用于 `createUserMessage` 不可用时的手动构造路径。
4. `buildMessage` 因动态 import 变为 `async`。
5. `components/ami/index.js` 超过 impl-spec §1 的 160 行建议上限。原因：惰性依赖及降级诊断、可选服务防御、有限字节读取与版本缓存校验、插件与 agent 生命周期闸门。
6. `package.json` 新增依赖声明：`dependencies` 写 `@deepseek-ai/schemastery ~3.18.5`，`peerDependencies` 写 `@deepseek-ai/cosmokit ~1.8.6` 与 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-home-paths` 的 `*`。
7. 新增两条一次性诊断告警键 `agents-unavailable` 与 `home-fallback`。
8. `lib/logic.js` 具名导出 19 个（5 常量 + 13 函数 + `resolveSettings`）。
9. **task-3 配置页改造**：`Config` 8 个字段全部 `.volatile()`；新增 `resolveSettings` 统一解包；Client 表单注册 `plugins.row.config`。
10. **1.0.7 单包多子模块**：`cordis.patch.yml` 插入包根承载行 `id/name = dsh-tools` 与子模块行 `id: dsh-tools-ami` / `name: 'dsh-tools/ami'`；Host 实现位于 `components/ami` 显示名「记忆回声」（row id、Config namespace、Client key 为 `dsh-tools-ami` / `dsh-tools-ami` / `dsh-tools#dsh-tools-ami`）；包根 `client.js` 为子模块行注册 Configure 页；不拆独立包 因为 DSH 的 `blockExoticSubdeps` 禁止 git 子依赖 见 10.2。
