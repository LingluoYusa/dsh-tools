# 交付前代码审核：dsh-ami

| 项 | 值 |
| --- | --- |
| 任务 | task-11 审核插件代码与测试结论（**未安装插件**） |
| 审核对象 | `dsh-ami/`（8 文件全部读完）、[test-report.md](test-report.md) |
| 基准 | [impl-spec.md](../design/impl-spec.md) v1.0 冻结、[plugin-design.md](../design/plugin-design.md) v1.4、[impl-prerequisites.md](../research/impl-prerequisites.md) |
| 独立复跑 | 自带探针（已删除）在 bundled Node `v24.21.0` 下 **full 41 项 + fallback 43 项断言全通过**；另有 3 项对抗探针 |
| 独立源码复核 | `dsh-fs-local` L729/L802-L812、`dsh-brand` L20-L22、`dsh-agent` L574-L593、`dsh-agent-instructions` L1122-L1161、profile 包解析实测 |
| 交付判定 | **可以作为可交付实现**（无阻塞项）；但有 1 项**风险声明必须修正**（U2）与 7 项可后续改进 |

---

## 1. 规格符合性（逐条判定）

### 1.1 文件清单与结构

| 规格 §1 | 实现 | 判定 |
| --- | --- | --- |
| 8 个文件（package.json / cordis.patch.yml / index.js / lib/logic.js / locale×2 / icon.svg / README.md） | 8/8 存在，路径与职责一致 | **符合** |
| `lib/logic.js` 零 import | 全文无 import / require（grep 0 命中，L1 仅注释） | **符合** |
| `lib/logic.js` ≤ 180 行 | 121 行 | **符合** |
| `index.js` ≤ 160 行 | **175 行** | **偏离（非阻塞，见 D-6）** |

### 1.2 `lib/logic.js` 函数契约（规格 §2.1）

| 契约 | 代码行号 | 判定 |
| --- | --- | --- |
| 5 个常量逐字一致（含 `TRUNCATION_MARKER` / `INSTRUCTION_INTRO` / `HIT_OFFSET=1`） | L3-L7 | **符合** |
| `utf8Length` 非字符串返回 0 | L12-L15 | **符合** |
| `truncateToBytes` 不切断多字节、`<=0` 返回空、不含标记 | L18-L32 | **符合** |
| `isHitTurn` = `Number.isInteger(n) && n>=1 && Number.isInteger(turn) && turn>1 && (turn-1)%n===0` | L35-L39 | **逐字符合** |
| `shouldInject(turn, n, state)` **不接收 `enabled`**、state 空按 -1 | L42-L47 | **符合**（R-1 修法已落地） |
| `hitSequence` 非法输入返回 `[]` | L50-L56 | **符合** |
| `resolveEveryTurns(raw, isVolatileFn)` 解包 + 非法返回 `NaN` | L59-L62 | **符合** |
| `planInjection` 四级短路顺序（empty→ok→truncated→inject-oversize）、非正整数上限按 `Infinity` | L65-L81 | **符合** |
| `buildInstructionText` 公式逐字一致 | L84-L89 | **符合** |
| `warningKey` 模板 `` `${path}#${v ?? 'unknown'}` `` | L92-L94 | **符合** |
| `initialState` = `{-1,-1,null}` | L97-L99 | **符合** |
| `markAttempted` / `markInjected` 就地写入并返回同一对象 | L102-L112 | **符合** |
| `canRegisterForAgent` 五分支短路顺序 | L115-L121 | **符合** |
| 具名导出数量 | 18 个（5 常量 + 13 函数） | **符合枚举**；规格 §1/§2.1 自称「14 个」为**规格计数笔误**（D-8） |

### 1.3 `index.js` 契约（规格 §2.2）

| 契约 | 代码行号 | 判定 |
| --- | --- | --- |
| `export const Config`，`everyTurns` 带 `.volatile()`，8 字段与 §5.1 一致 | L25-L34 | **符合** |
| `export function apply(ctx, config)`，无 default 导出 | L150 | **符合** |
| `readAgentsMd` 8 步行为（no-fs / missing / 非普通文件 / size 超限不读 / version 缓存 / readText / 捕获不冒泡） | L72-L89 | **符合**；**签名多一个 `cache` 形参**（D-1） |
| `warnOnce` 按 key 节流、`error` 为空只传 message | L64-L69 | **符合**；**签名多一个 `warned` 形参**（D-2） |
| `buildMessage` 用 `createUserMessage`、`source.kind` 冻结值 | L92-L99 | **符合**；**改为 async**（README 偏差 4，D-3） |
| `registerForAgent` 顺序与 `states.set` 时机 | L102-L148 | **符合**；形参以 `states,warned` 取代 `source`（D-4） |
| §3.1 `agent/created` 七步顺序（try→enabled→gate→state→effect→states.set→插件清理） | L154-L173 | **符合** |
| §3.2 pre-step 十三步顺序（含 reject 在 build 之前） | L106-L138 | **符合** |
| §3.4 W1–W8 字符串与节流键逐字一致 | L10-L21、L113、L119、L132、L161、L165 | **符合**；新增 `build-fallback` 键（README 偏差 3，D-7） |
| §3.5 P1 接入点（常量 + 谓词） | L37-L40 | **符合语义**（签名 `(ctx, agent)` 与规格占位不同，D-5） |

### 1.4 静态清单文件

| 文件 | 判定 | 证据 |
| --- | --- | --- |
| `package.json` | **与规格 §4 逐字一致**（name/version/private/type/description/exports/files/dsh） | 全文 25 行比对 |
| `cordis.patch.yml` | **与规格 §5 逐字一致**（id/name/8 字段） | 全文 12 行比对 |
| `locale/en.json`、`locale/zh.json` | **与规格 §6 逐字一致**，键集合相同、无模板文案 | 各 6 行比对 |
| `icon.svg` | **符合 §7**：603 B ≤ 256 KiB、`viewBox="0 0 64 64"`、无 `<script>` / `<foreignObject>` / `<image>` / 外链 / 事件属性、自带配色不依赖宿主变量 | 全文 8 行 |
| `README.md` | **§8 的 11 条全部有独立小标题**（§1 定位 / §2 命中轮号 / §3 注入位置 / §4 token 成本 / §5 设置入口 / §6 配置表 / §7 子智能体 / §8 失败语义 / §9 未验证项 / §10 安装卸载 / §11 不做什么） | 逐条对照 |

### 1.5 三处已知偏差的判定（Lead 指定复核）

| # | 偏差 | 判定 | 理由 |
| --- | --- | --- | --- |
| ① | 三个裸包名由静态 import 改为惰性动态 import + 降级 | **合理且必要，但保护不完整** | 规格 §1 只规定「允许的 import」，未强制静态；惰性化把 dsh-llm 的解析失败从「致命链接错误」降级为「功能等价的手工构造」。**但它无法覆盖 schemastery**（见 §6.1） |
| ② | `index.js` 175 行 > 160 行上限 | **偏离，非阻塞** | 规格 §1 允许「超出需在交付报告说明」；README 偏差记录 4 条中**没有这一条**（tester D1 同结论） |
| ③ | `source.kind = "agents-md-periodic-inject"` | **不是偏差** | 该值是 impl-spec §2.2.2 的冻结值；README 偏差 2 说明的是它与 task-1 调研示例 `"agents-md-periodic"` 不同 |

### 1.6 规格侧自身缺陷（实现无需改）

| # | 规格问题 | 判定 |
| --- | --- | --- |
| D-8 | §1/§2.1 自称「14 个具名导出」，§2.1 实际枚举 18 个 | **规格笔误**，实现正确 |
| D-10 | §3.5 L257 称「`canRegisterForAgent` 的短路顺序保证 `isPrimaryAgent` 在常量 false 时永不被求值」，但 §3.1 L191 与实现都把它作为**实参先求值** | **规格自相矛盾**；实参求值无法被被调函数的短路阻止（见对抗 A-1） |
| D-9 | §4 的 `package.json` 未声明 `peerDependencies`，而 impl-prerequisites §2.6 建议声明 | **规格遗漏**；实现照规格写（见 §6.1 建议） |

---

## 2. 设计关键点核对（带代码行号）

| # | 设计关键点 | 代码位置 | 判定 |
| --- | --- | --- | --- |
| 1 | 严格读法 `(turn-1) % N === 0 && turn > 1` | `logic.js` **L35-L39** | **已落地**，逐字一致 |
| 2 | `enabled` 在 `agent/created` **最外层**，`shouldInject` 不再收 `enabled` | `index.js` **L159**（try 内第一条）、`logic.js` **L42** | **已落地**（R-1/E32） |
| 3 | volatile 解包，包装对象不参与算术 | `index.js` **L107**、`logic.js` **L59-L62** | **已落地**（全文无第二处使用 `config.everyTurns`） |
| 4 | `agent/created` 监听器永不抛错 | `index.js` **L155-L167**（try/catch 包住全部逻辑） | **已落地**（R-2/E33），正常路径无逃逸（见 §6.2） |
| 5 | pre-step `{ ...decision, messages }` spread | `index.js` **L138** | **已落地**（F7） |
| 6 | reject 早返回 | `index.js` **L127**（在 `buildMessage` 之前） | **已落地**（F8/E28） |
| 7 | 三处 `signal.throwIfAborted()` | `index.js` **L110 / L124 / L135** | **已落地**（规格 §3.2 步 3/7/11） |
| 8 | 双水位线：`markAttempted` 在读盘前、`markInjected` 仅成功后 | `index.js` **L109**（前）、**L136**（后）；失败路径 L115/L120/L133 均不推进 | **已落地** |
| 9 | 两级降级：源超限不读入、渲染超限截断/跳过 | `index.js` **L80**（stat 后先判 size）、`logic.js` **L65-L81** | **已落地** |
| 10 | 告警节流（W1–W8 键） | `index.js` **L64-L69**、L113/L114/L119/L132/L161/L165 | **已落地** |
| 11 | `agent.ctx.effect` 返回函数含 `states.delete(agent)` | `index.js` **L141-L144** | **已落地**（F10/NB-3） |
| 12 | 插件 effect 释放订阅 + 遍历 disposer + 清空 Map | `index.js` **L168-L173** | **已落地** |
| 13 | `states.set` 在 effect 成功之后（R-7/E35） | `index.js` **L146-L147**（effect 在 L105） | **已落地** |
| 14 | per-agent 监听只注册在 `agent.ctx` | `index.js` **L106** | **已落地**（F11） |

---

## 3. practices.md 硬规则合规

| 禁令 | 判定 | 证据 |
| --- | --- | --- |
| F1 不监听 `system-prompt/assemble` | **合规** | 全文 0 命中（grep 仅命中 README 散文） |
| F2 不写自定义 session event type | **合规** | 无 `session.append`；监听事件仅 `agent/created` / `agent/pre-step` |
| F3 不用 `appendPluginRecord` | **合规** | 0 命中 |
| F4 不注册 `sessionProjections` | **合规** | 0 命中 |
| F5 不改动他人贡献 | **合规** | 只有 `[...decision.messages, message]`，无 slice/filter/splice/sort/reverse |
| F6 created 监听器不抛错 | **合规** | L157-L166（见 §6.2 的边界） |
| F7 spread | **合规** | L138 |
| F8 reject 不访问 messages | **合规** | L127 |
| F9 不直接对 `config.everyTurns` 运算 | **合规** | 仅 L107 传给 `resolveEveryTurns` |
| F10 不依赖 `agent/disposed` | **合规** | 全文 0 命中 |
| F11 per-agent 监听只在 agent.ctx | **合规** | L106 |
| F12 logic.js 零 import | **合规** | grep 0 命中 |
| F13 不用 console | **合规** | 0 命中，全部 `ctx.logger.warn` |
| F14 未命中路径零 IO | **合规** | L108 `shouldInject` 为纯整数运算后才可能 IO |
| F15 不自造 P1 谓词 | **合规** | L38-L40 与 impl-prerequisites §1.7 逐字一致（`roots().includes(agent)`） |
| F16 不轮询 `agent/status` | **合规** | 0 命中 |
| F17 不用第二个 instruction 根 | **合规** | 只 `join(dshHome,'AGENTS.md')` |

`practices.md` 其他要点：可选服务用 `ctx.get("fs")`（L74，缺 fs 不抛错，E18 ✓）；未注册工具/命令 ✓；locale 文案真实描述能力 ✓；icon 原创且合规 ✓。

---

## 4. 独立复跑 tester 的关键结论

**方法**：自写临时探针（`docs/review/.tmp-review-probe.mjs`，**已删除**），用 `node:module` 的 `registerHooks` 把 `schemastery` / `cosmokit` 指向 `profile:node_modules`、把 `dsh-llm` / `dsh-home-paths` 指向等价 stub；用假 ctx/agent 承载 `agent/created`、`agent/pre-step`、`ctx.effect`、`ctx.get`、`ctx.logger`。

命令与结果（bundled Node `v24.21.0`）：

```
& $node docs\review\.tmp-review-probe.mjs            → MODE=full     PASS=41  exit=0
$env:PROBE_MODE='fallback'; & $node ...              → MODE=fallback PASS=43  exit=0
```

| 复跑项 | tester 结论 | 我的独立结果 | 判定 |
| --- | --- | --- | --- |
| 命中序列（严格读法） | N=2 → 3、5、7 | turn 1/2 不注入、turn 3 注入；`hitSequence(1,3)=[2,3,4]`、`(10,3)=[11,21,31]` | **复现** |
| `enabled:false` 零注册零读盘 | B6 通过 | pre 监听 0、`ctx.get` 0、stat 0、readText 0、warn 0 | **复现** |
| reject 早返回 | B8 通过 | 返回 `{kind:'reject'}`、无 `messages`、无 TypeError | **复现** |
| spread 保真 | B9 通过 | `startsRequestSeries===true` 保留、messages 追加 1 条 | **复现** |
| 卸载清理 | B13 通过 | `agent/pre-step` 1→0、`agent/created` 订阅解除 | **复现** |
| 同 turn 不重复读盘 | A2f/B12h 通过 | 同 turn 二次调用不注入且 readText 不增 | **复现** |
| serial 监听器不冒泡 | B14e 通过 | `roots()` 抛错 → 不抛、W8 一次 | **复现** |
| fallback 降级 | B7c/B12i 通过 | duck-type volatile 生效、手工消息含 id/role/source、`build-fallback` 告警 | **复现** |
| O1 裸 `{get}` 不被真实 `isVolatile` 识别 | 观察项 | `cosmokit.isVolatile({get(){}}) === false` | **复现** |

**tester 结论全部可复现**；我未发现任何 tester 结论与实测不符之处。

**我额外独立验证的、tester 未覆盖的源码事实**：

- `FsInfo` 形状 = `{version, type, size}`：`dsh-fs-local` **L802-L812** 逐字确认；`type` 取值含 `"file"`（L867）与 `"directory"`（L729）。→ 插件 `index.js` **L79** 的 `info.type !== "file"` 与 L80 的 `info.size` 与真实 API 一致，**不是猜测**。
- `createUserMessage` 的 `id` 与手工兜底的 `randomUUID()` 运行时等价：`dsh-brand` **L20-L22** `brandString(value){return value}` 是编译期 brand、运行时恒等。→ 手工兜底消息与工厂产物在会话层无差异，**兜底路径风险基本为零**。

---

## 5. 对抗性检查

假设真实安装，以下场景会失败或产生副作用。

| # | 触发条件 | 后果 | 分级 | 证据 |
| --- | --- | --- | --- | --- |
| A-1 | `includeSubagents: true` 且 `ctx.agents.roots()` 抛错（非本部署实现、或未来实现变更） | **用户显式 opt-in 的逃生通道失效**：本应「全注册」，实际 pre 监听 0 条 + 1 条 W8。原因是 `isPrimaryAgent(ctx, agent)` 作为**实参先求值**（L160），短路发生在被调函数内无法阻止它 | 低-中 | 我的对抗探针：`ADV includeSubagents=true + roots throw -> pre=0 warns=1 threw=false` |
| A-2 | `ctx.agents` 服务缺失（或 `roots` 不存在）且默认 `includeSubagents:false` | **静默 no-op**：插件不注册、不注入、**零告警**（`ctx.agents?.roots?.()` 返回 undefined → `isPrimary` false → reason `not-primary` 不告警）。用户无从知道插件为何无效 | 低-中 | 对抗探针：`ADV no agents service -> pre=0 warns=0` |
| A-3 | `ctx.logger.warn` 抛错（异常 logger、被替换的 logger） | **catch 块自身未受保护** → async 监听器 reject → `serial` 冒泡 → `announce()` 失败 → **agent 创建失败**。这正是 E33 想消除的后果 | 低 | 对抗探针：`ADV logger.warn throws -> listener rejected=true`；`dsh-agent` L581 |
| A-4 | 运行时模块解析拦截**按导入方路径收窄**（U2 的最坏情形） | **静态 `schemastery` 导入失败 → 插件完全无法加载**。惰性降级救不了它（静态 import 在模块链接期求值）。实测工作区对 4 个裸包**全部** `ERR_MODULE_NOT_FOUND`，schemastery 与 dsh-llm 同属一类风险 | **中-高（不可本地消除）** | 见 §6.1 |
| A-5 | 拦截**部分**生效（schemastery 可解析、`dsh-llm` 不可） | 插件正常加载，注入消息改由手工构造；每次激活告警一次 `build-fallback`。**功能等价**（`brandString` 恒等已证），但降级原因被 `catch {}` **静默丢弃**，安装后无法诊断 U2 | 低 | `index.js` **L49** `catch { deps[key] = undefined; }` |
| A-6 | 若 profile 显式配置 `dshHome`（非 `$DSH_HOME` 通道）且 `dsh-home-paths` 解析失败 | `fallbackHome()` 只认 `$DSH_HOME` → 读到**错误的 AGENTS.md 根**（当前部署 `DSH_HOME=C:\Users\15068\.dsh` 恰好正确，故本机无影响） | 低 | `index.js` **L57** 与 `dsh-home-paths` L101-L111 的优先级差异 |
| A-7 | `maxInjectBytes` 小于截断标记长度（如 10 B） | 单次注入实际字节 = `maxInjectBytes` + 标记 49 B，**超出预算**。规格 §2.1 表第 3 行就是这么定义的，因此是**规格层面的近似**，但 design 6.1「保证单次注入成本有硬上界」的表述不精确 | 低 | `logic.js` **L76**；tester A4a 亦观察到 10 B + 标记 |
| A-8 | `onlyIfChanged: true` 且副本被 compaction 吞掉 | 内容未变 → 不再注入 → **本该重锚却没锚**（设计 E22 已知，默认 false 规避） | 低 | `index.js` L122-L123 |
| A-9 | 同一 agent 被重复 `announce`（框架保证只一次，未来若重放） | 重复注册 pre-step 监听，旧 state 的 disposer 被 `states.set` 覆盖 → 该 agent 监听器 2 条、双份注入风险 | 低 | tester O4；`index.js` L146-L147 |
| A-10 | 运行中改 `includeSubagents` | **不追溯**已存在 agent（字段非 volatile、判定在 created 时刻）；用户以为立即全生效 | 低（已文档化） | README §7；设计 E34 |

---

## 6. 两项专项评估（Lead 指定）

### 6.1 U2：linked 安装的裸包名解析 —— 当前设计是**部分最优**

**实测事实（本任务新取证）**：从工作区 `D:\MyTools\Test` 用普通 Node 解析，**四个包全部 `ERR_MODULE_NOT_FOUND`**：

```
FAILED @deepseek-ai/schemastery :: ERR_MODULE_NOT_FOUND
FAILED @deepseek-ai/cosmokit     :: ERR_MODULE_NOT_FOUND
FAILED @deepseek-ai/dsh-llm      :: ERR_MODULE_NOT_FOUND
FAILED @deepseek-ai/dsh-home-paths :: ERR_MODULE_NOT_FOUND
```

而 `profile:node_modules/@deepseek-ai/` 下**只有** `schemastery` 与 `cosmokit`；`dsh-llm`、`dsh-home-paths` 磁盘上不存在。

**结论（三态）**：

1. **惰性化本身是正确且必要的**：`dsh-llm` / `dsh-home-paths` 若静态导入，一旦拦截不覆盖本插件就是致命链接错误；惰性化把它们变成「功能等价的手工构造 / `$DSH_HOME` 回落」。`@deepseek-ai/cosmokit` 的惰性化无害（duck-type 兜底），但在生产上**基本是死代码**：`schemastery` 自身静态 import 了 cosmokit（`schemastery/lib/index.mjs` L1），只要 schemastery 能加载，cosmokit 必然能加载。
2. **但它没有消除加载失败风险**：唯一保留的静态导入是 `schemastery`（`index.js` L1），而 schemastery 与其余三个同属「linked realpath 解析不到、必须靠运行时拦截」的一类。**若拦截按导入方路径收窄，插件在链接期就失败，惰性降级根本没有机会执行。** README §9「避免 linked 安装解析失败时整个插件加载失败」的表述**对 schemastery 不成立**，必须修正。
3. **是否应进一步改？** 评估四条路：
   - (i) 完全不写 `@deepseek-ai/*` 值导入（dsh-ops 模式）→ 必须放弃 `export const Config` → **丢失设置自动表单**，直接违反核心需求「轮数在插件菜单设置」。**否决**（impl-prerequisites §2.6 同结论）。
   - (ii) 全部静态 → 严格劣于现状。**否决**。
   - (iii) **`dependencies` 声明 `@deepseek-ai/schemastery`（推荐）**：`profile:pnpm-workspace.yaml` 为 `nodeLinker: hoisted` + `autoInstallPeers: false`，真实 dependency 会被安装到包自己的 `node_modules`，从而**不依赖拦截**即可解析。这正是唯一已知可用先例 `@jiaoqsh/dsh-document` 的做法（它把 schemastery 写在 `dependencies`，把 `@deepseek-ai/dsh-tools` 等只写 `peerDependencies`）。对 linked 安装中性（不会更差），对打包/发布安装是实质加固。
   - (iv) **`peerDependencies` 声明三个 peer-only 包（建议一并补）**：不改变解析（peer 不会被装），但把依赖契约显式化，并与 `dsh-document` 的可用先例对齐；`install_bundle` 的依赖诊断也能看到它们。
4. **不可本地消除的部分**：拦截的作用域规则只能安装后验证（`Config.listConfigs` 中该 entry `status === "schema"`，或直接观察插件是否出现在 Plugin Manager）。**这必须作为交付的硬验收，而不是可选项。**

### 6.2 `agent/created` 用 async 监听器是否与 serial 语义冲突

**不冲突，且正常路径不会逃逸；但 catch 块本身未受保护。**

- Cordis `serial` 的实现是 `const result = await cb(...)`（`cordis/lib/index.js` L289-L294），**会 await 返回的 Promise**，因此 `async` 监听器是被支持的写法。
- 返回值语义安全：`serial` 用 `isBailed(result)` 判断提前结束，本监听器所有路径都返回 `undefined`（L159/L161/L162/L163 与 catch），**不会误触 bail**。
- 内部 try/catch（L157-L166）覆盖了从 `config.enabled` 到 `registerForAgent` 的全部逻辑，**常规异常不会逃逸**——我的探针用 `roots()` 抛错验证：`threw=false`、仅 1 条 W8。
- **唯一逃逸路径**：catch 块里再次调用 `warnOnce` → `ctx.logger.warn`。若 logger 本身抛错（或被替换为抛错的实现），catch 内二次抛出 → async 函数 reject → `serial` 冒泡 → `announce()` 失败 → **agent 创建失败**（探针 A-3 已复现）。概率极低，但与 E33 的承诺不一致。
- **最小加固（1 行）**：把 catch 体的告警包一层，或让 `warnOnce` 自身永不抛：
  ```js
  } catch (error) { try { warnOnce(ctx, warned, "agent-created-handler", WARN.created, error); } catch {} }
  ```

---

## 7. 交付判定

**结论：可以作为可交付实现。** 无阻塞级缺陷；规格符合性、设计关键点、practices 硬规则、tester 结论（全部独立复现）均达标。下列为**必须修正的风险声明**与**可后续改进**项。

### 7.1 必须修正（不阻塞代码交付，但阻塞「风险声明准确性」）

| # | 位置 | 问题 | 最小修正 |
| --- | --- | --- | --- |
| M-1 | `README.md` **L93-L99**（§9） | 声称惰性降级可避免「linked 安装解析失败时整个插件加载失败」，但 **`schemastery` 仍是静态导入且同样解析不到**（实测四包全 `ERR_MODULE_NOT_FOUND`）。风险声明对 schemastery 不成立 | 改写为：仅 `dsh-llm` / `dsh-home-paths` 被降级保护；`schemastery` 依赖运行时解析拦截，**安装后必须实测加载成功**（`Config.listConfigs` entry `status === "schema"`） |
| M-2 | `package.json` **L1-L25** | 未声明任何 `@deepseek-ai/*` 依赖，与 impl-prerequisites §2.6 建议不符 | 增补 `"dependencies": {"@deepseek-ai/schemastery": "~3.18.5"}` 与 `"peerDependencies"`（`@deepseek-ai/dsh-llm` / `dsh-home-paths` / `cosmokit` 版本范围），对齐 `@jiaoqsh/dsh-document` 先例 |
| M-3 | `README.md` 附. 偏差记录 | 未记录 `index.js` 175 行 > 160 行上限（tester D1） | 补第 5 条偏差说明（惰性 import + 降级机制导致） |

### 7.2 可后续改进（非阻塞）

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| I-1 | `index.js` **L160** | `isPrimaryAgent(ctx, agent)` 作为实参先求值，`includeSubagents:true` 时也被执行（规格 §3.5 L257 的「短路保证不求值」不成立，规格 §3.1 L191 自相矛盾） | 改为惰性：`config.includeSubagents === true ? true : (SUBAGENT_PREDICATE_READY && isPrimaryAgent(ctx, agent))` |
| I-2 | `index.js` **L39** | `ctx.agents` 缺失时静默返回 false → 零注册零告警（A-2） | `isPrimaryAgent` 区分「服务缺失」与「非主 agent」，前者发一次性告警 |
| I-3 | `index.js` **L164-L166** | catch 块内 `warnOnce` 未受保护，logger 抛错会让监听器 reject（A-3） | catch 内再包一层 try/catch（1 行） |
| I-4 | `index.js` **L49** | `catch { deps[key] = undefined; }` 丢弃解析错误，U2 无法在安装后诊断（A-5） | 保留错误对象并在首次降级时按节流键 debug 级输出一次 |
| I-5 | `logic.js` **L76** | 截断结果 = `maxInjectBytes` + 49 B 标记，超过预算（规格如此，但 design 6.1「硬上界」表述不精确） | 文档写明上界为 `maxInjectBytes + marker`；或把标记计入预算 |
| I-6 | `index.js` **L57** | `fallbackHome()` 只认 `$DSH_HOME`，忽略「显式配置 dshHome」的最高优先级（当前部署 `DSH_HOME` 已设置故无影响） | 文档标注该回落与 `resolveDshHome` 的语义差异 |
| I-7 | `impl-spec.md` §1/§2.1 | 「14 个具名导出」与实际 18 个不符（规格笔误） | 由规格 owner 更正为 18 |

### 7.3 仍无法验证（不得视为通过）

| # | 内容 | 原因 |
| --- | --- | --- |
| V-1 | 运行时解析拦截是否覆盖 linked 插件（U2 最坏情形 A-4） | 禁止安装；只能用 stub 验证「解析成功」与「解析失败」两条分支的行为正确性 |
| V-2 | 安装后 `Config.listConfigs` 的 entry `status === "schema"`、Plugin Manager 是否列出插件 | 需真实安装 |
| V-3 | 设置表单是否出现 `everyTurns` 且 `applies:"live"` 生效（U5/B3） | 需 Web UI |
| V-4 | 真实 `ctx.agents.roots()` 在 `agent/created` 期间的并发可见性（U6） | 需真实运行时；impl-prerequisites 已给「必须用 `includes`」的规避 |
| V-5 | compaction 是否吞掉注入（U3）、fork 轮号（B8）、resume 重放 step>1（B9） | 需真实长会话 |
| V-6 | 渲染层对未知 `source.kind` 的处理（B10） | 需真实 Web UI |

### 7.4 临时文件清理

本次审核唯一临时产物 `docs/review/.tmp-review-probe.mjs` **已删除**（`Test-Path` 为 False）；`docs/review/` 现仅有 `review-report.md`、`review-v12.md`、`test-report.md` 与本报告；未创建 `tests/`、未改代码目录、未改 `docs/design`、未改 `docs/research`、未安装、未改 profile。
