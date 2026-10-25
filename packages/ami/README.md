# dsh-tools-ami（记忆回声）

`dsh-tools` 整合包的第一个子模块。周期性把 `~/.dsh/AGENTS.md` 重新锚定到上下文尾部 降低长会话里的指令稀释。

## 在整合包中的位置

- bundle `dsh-tools` 的 `cordis.patch.yml` 插入本模块行：`id: dsh-tools-ami` / `name: 'dsh-tools-ami'`。
- 本包同时提供 Host 半边（`index.js` 的 `Config` 与 `apply`）与 Client 半边（`client.js` 注册 `plugins.row.config` key `dsh-tools#dsh-tools-ami`）。
- 行模块名就是裸包名 因此浏览器半边能被加载 这是二级配置页出现的前提。

## 配置

- Host settings namespace 与 profile row id 均为 `dsh-tools-ami`。
- 8 个字段全部 `.volatile()` 表单暴露其中 7 个 保存走官方 `configForms`。
- 打开 AGENTS.md 的接口为 `/api/dsh-tools/ami/open-agents`。

## 文件

- `index.js` Host 实现 周期注入与打开文件路由
- `client.js` Plugins 页 Configure 二级配置表单
- `lib/logic.js` 纯函数 命中判定 截断 解包
- `locale/*.json` 行显示元数据 记忆回声
