# dsh-tools

DSH（DeepSeek Harness）插件整合包。一个 bundle 内按子模块组织功能 每个子模块在 Plugins 页有独立的行与 Configure 二级配置页。

当前版本 `1.0.9` 单包一次安装 仓库：`github:LingluoYusa/dsh-tools`

## 当前模块

### 记忆回声（`dsh-tools-ami`）

在长会话里周期性把 `~/.dsh/AGENTS.md` 重新锚定到上下文尾部 降低指令在长上下文里被稀释或压缩吞掉的影响。

- 默认每 10 轮注入一次 命中轮号为 `N+1、2N+1 …` 第 1 轮不注入
- 只读 `<dshHome>/AGENTS.md` 一个文件 不读项目级文件
- 支持按字节截断、内容未变跳过、内容改变立即注入、可选对子智能体生效
- 读取或构造失败只告警 不中断 turn 不抛错

## 界面入口

Plugins → Installed plugins → `dsh-tools` → 行「记忆回声」→ **Configure**。

可编辑 8 个字段：

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `everyTurns` | 注入间隔（轮）1–1000 | `10` |
| `maxSourceBytes` | 源文件大小上限（字节） | `1048576` |
| `maxInjectBytes` | 单次注入正文预算（字节） | `16384` |
| `truncateOversize` | 超限时截断 否则跳过 | `true` |
| `wrapSystemReminder` | 用 system-reminder 包裹 | `true` |
| `onlyIfChanged` | 命中轮号但内容未变则跳过 | `false` |
| `injectOnChange` | 内容改变则立即注入 并重置注入间隔 | `false` |
| `includeSubagents` | 对子智能体生效 只影响之后新建的 agent | `false` |

`enabled` 开关不在表单里 由 bundle patch 控制。

## 安装

经官方 Plugin Manager 或 `plugin_manager` 的 `install_bundle` 安装一个 bundle 即可：

- git 安装：`github:LingluoYusa/dsh-tools`
- 本地开发：`install_bundle` 指向工作区目录 依赖变为 `link:` 改动即生效 Host 改动仍需重启 DSH

安装或更新后重启 DSH 进程并刷新浏览器页面。

## 仓库结构

```
dsh-tools/
├── cordis.patch.yml        子模块行与默认 config
├── index.js                包根承载行 只负责加载 Client 配置页
├── client.js               注册 plugins.row.config 配置页
├── components/ami/         记忆回声 Host 实现与显示元数据
├── lib/logic.js            纯逻辑模块 零 import 可直接测试
├── locale/                  bundle 显示元数据
├── icon.svg                 bundle 图标
└── docs/                    历史设计与评审记录
```

## 新增子模块

1. `cordis.patch.yml` 增加一行 `id: dsh-tools-<name>` / `name: 'dsh-tools/<name>'`
2. `components/<name>/` 放该子模块的 Host 实现与 locale/icon
3. 包根 `client.js` 为该 row id 追加一个 `plugins.row.config` 注册（key `dsh-tools#dsh-tools-<name>`）

包根的裸包名承载行只有一条 所有子模块共用。

## 开发

- 无构建步骤 JS 直接运行 依赖 `@deepseek-ai/schemastery` 其余包由宿主提供
- 改动后至少跑 `node --check index.js client.js components/ami/index.js`
- `docs/` 是历史设计与评审记录 当前行为以代码与本 README 为准
