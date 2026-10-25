# dsh-tools-agents-ui

`dsh-tools` 的 companion 包。只承载 Plugins 页 `dsh-tools/agents` 行的 Configure 二级配置页 不含 Host 注入逻辑。

## 为什么独立成包

DSH 的 `@deepseek-ai/dsh-client-modules` 只把包的浏览器半边挂到 specifier 为裸包名的 Loader 行。根包的组件行是子路径 `dsh-tools/agents` 该行无法承载 `dsh.client` 因此配置页必须由自己的裸包名行 `dsh-tools-agents-ui` 加载。

## 与根包的关系

- 根包 `dsh-tools` 提供 AGENTS.md 周期注入与 Config namespace `dsh-tools-agents`。
- 本包提供 Client 配置页 注册到 `plugins.row.config` key 为 `dsh-tools#dsh-tools-agents`。
- 两个 bundle 必须同时安装并启用。关闭本 bundle 或它的行只会失去 Configure 页面 Host 注入不受影响；根包缺失时表单显示不可用。

## 安装

1. `plugin_manager` 的 `install_bundle` 指向本目录 `D:\YhhCode\MyProject\dsh-tools\ui`（本地目录为 linked 安装）；
2. 同时安装根包 `D:\YhhCode\MyProject\dsh-tools`；
3. 重启 DSH 进程并刷新浏览器页面。

`github:` 安装只装仓库根目录 不会带上本包 发布时需单独发布或从本地目录安装。

## 文件

- `client.js` Client 半边 配置表单
- `cordis.patch.yml` 只插入裸包名行 `dsh-tools-agents-ui`
- `index.js` 空 Host apply
- `locale/*.json` 包显示元数据
