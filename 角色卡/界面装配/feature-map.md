# 功能导航：界面装配

本角色负责玩家看到的菜单、HUD、暂停与结算界面、设置面板与本地保存、键鼠输入与指针锁定，以及 Electron 桌面壳、Vite 构建和 Windows 打包。

| 功能 ID | 一句话用途 | 当前状态 | 说明文档 |
| --- | --- | --- | --- |
| `match-interface` | 让玩家在桌面窗口里开始一局、看到军用 HUD、用 WASD/鼠标战斗、调整设置、暂停/继续、死亡后查看成绩并重开。 | v3 已实现；层内测试 27 项通过；Electron 冒烟、设置面板、低画质后处理、暂停设置、跨重启设置持久化已实测；正式 v3 视觉验收待项目管理/美术。 | [docs/feature/match-interface.md](docs/feature/match-interface.md) |
| `desktop-shell` | 用 Electron 打开 1600×900 窗口，通过 `app://` 加载构建产物，并能生成未压缩应用目录和 NSIS 安装包。 | v3 构建与 Electron 冒烟通过；`npm run pack`/`dist` 本轮按任务要求未执行，等 PM 最终打包。 | [docs/feature/desktop-shell.md](docs/feature/desktop-shell.md) |

## 当前进度说明（v3）

- **人类敌人 HUD**：击杀信息使用“步枪兵 / 重机枪手 / 突击兵”；`drone/brute/wraith` 与无人机/幽影文案已从界面移除。
- **爆头反馈**：`hud:hitmarker.headshot` 使用更大、偏红的专用标记；`hud:killfeed.headshot` 显示“爆头”标签；`enemy:killed`/`hud:killfeed` 的 `headshot` 与兼容字段 `critical` 都读取。
- **方向受击**：`hud:damage.direction`（0 前、正值右、-PI..PI）在准星周围画短箭头；红色受伤边缘与低血状态保留。
- **设置**：`src/interface/impl/settings.js` 使用 Model 默认值/范围与 `normalizeSettings`/`clampSetting`；本地键 `dustline.settings.v3`；损坏/非法数据记录错误并回退默认值。
- **设置面板**：菜单与暂停都有“设置”按钮；滑杆（灵敏度、ADS 倍率、FOV、音量）、画质下拉、实时数值、恢复默认、关闭。变化实时 `game.applySettings()` 并保存；低画质经 Pipeline → 渲染器关闭后处理。
- **启动接线**：`main.js` 把 `assets` 传给敌方/战斗服务，等待 `enemies.load()` / `combat.load()`（缺失或失败只记录并回退），竞技场有 `getDecals()` 时传给效果服务；创建 Pipeline 后读取本地设置并 `applySettings`。
- **O4**：`?test=1` 下暴露只读 `getSettings()` 与 `getPerformance()`；`getHud()` 增加 `settingsVisible`。
- **验证**：`node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js` → 27 pass / 0 fail；`npm test` → 27 pass / 0 fail；`npm run build` 成功（68 modules）；`node scripts/smoke-electron.js` 全部 PASS；设置跨两次 Electron 启动保持，面板数值同步，随后恢复默认。
- **未验证**：正式 v3 视觉验收、真实爆头/方向受击观感、弹孔/血雾/枪口烟/抛壳的实际画面与音量听感、打包与安装/卸载。环境引擎 v3 方法已落地并接入装配；若服务侧继续修改，需要重新构建与冒烟。

## 证据入口

- 对局界面、设置与输入：[docs/feature/match-interface.md](docs/feature/match-interface.md)
- 桌面启动与打包：[docs/feature/desktop-shell.md](docs/feature/desktop-shell.md)
- 初始实施与 v3 变更：[docs/change/2026-10-17_change_initial-implementation.md](docs/change/2026-10-17_change_initial-implementation.md)
- 实际导出与回调接线：[api-spec.md](api-spec.md)
- 模块说明：[functional-description.md](functional-description.md)
- 工作线索：[memo.md](memo.md)
- 变更日志：[changelog.md](changelog.md)
