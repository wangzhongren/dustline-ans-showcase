# 边界文档：界面装配

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `index.html` | 渲染进程页面骨架与 HUD/覆盖层结构 |
| 单文件 | `src/style.css` | 界面样式与视觉反馈 |
| 单文件 | `src/main.js` | 装配入口：创建各公共入口并接线 |
| 单文件 | `src/interface/public/index.js` | 界面层公共入口 |
| 单文件 | `src/interface/impl/hud.js` | HUD、菜单、暂停与结算展示 |
| 单文件 | `src/interface/impl/input.js` | 键鼠输入、指针锁定、全屏 |
| 单文件 | `src/interface/impl/settings.js` | 灵敏度、FOV、音量、画质设置与本地保存 |
| 单文件 | `electron/main.js` | Electron 窗口与应用生命周期 |
| 单文件 | `vite.config.js` | 渲染进程构建配置 |
| 单文件 | `package.json` | 脚本、依赖与打包配置 |
| 单文件 | `package-lock.json` | 依赖版本锁定 |
| 单文件 | `scripts/smoke-electron.js` | Electron 启动冒烟脚本 |
| 条件目录 | `build/` | 打包图标等构建资源 |
| 目录 | `test/界面装配/` | 本角色的单元/层内测试与夹具 |
| 单文件 | `角色卡/界面装配/feature-map.md` | 功能导航 |
| 单文件 | `角色卡/界面装配/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/界面装配/changelog.md` | 变更日志 |
| 单文件 | `角色卡/界面装配/functional-description.md` | 模块说明 |
| 单文件 | `角色卡/界面装配/api-spec.md` | 实际导出与测试证据 |
| 条件目录 | `角色卡/界面装配/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/界面装配/docs/feature/` | 功能说明 |
| 条件目录 | `角色卡/界面装配/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/界面装配/docs/fix/` | 修复记录 |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
