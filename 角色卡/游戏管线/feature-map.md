# 功能导航：游戏管线

本角色负责对局生命周期、状态机、计分、波次协调，以及所有角色共享的 Model 契约。

| 功能 ID | 一句话用途 | 当前状态 | 说明文档 |
| --- | --- | --- | --- |
| `match-flow` | 让一局游戏从菜单开始，经过战斗、暂停、死亡结算，并能重新开始；v3 还负责设置转发、爆头/受伤方向反馈与性能仪表。 | v3 Model + Pipeline 设置/契约阶段已实现；32 项单元测试通过；服务 v3 setter 尚未实现；Electron 画面与完整流程尚未验证。 | [docs/feature/match-flow.md](docs/feature/match-flow.md) |

## 当前进度说明

- **v3 Model 阶段（当前，已实现并通过本角色测试）**：`src/models/game-config.js` 已改为人类士兵（步枪兵/重机枪手/突击兵），加入 `settings.defaults/ranges`、`normalizeSettings()`、`clampSetting()`、模型路径、动画名与视图/后坐/抛壳/分层音频参数；`events.js` 新增 4 个事件；`contracts.js` 新增 `Settings`、`PerformanceSnapshot`、爆头/方向/敌人枪声/血雾/抛壳/设置变更载荷与校验器。
- **v3 Pipeline 阶段（设置与契约骨架，已实现并通过本角色测试）**：`createGame()` 新增 `applySettings()`、`getSettings()`、`getPerformance()`；设置变更会转发给战斗/渲染/音频并发出 `settings:changed`；快照包含 `settings` 与 `performance`；新增爆头、受伤方向、敌人枪声/血雾/抛壳映射与 0.05 秒击杀顿帧。
- **依赖状态**：战斗 `setSettings()`、渲染器 `setQuality()`/`getQuality()`、音频 `setMasterVolume()`/`enemyShot()`/`headshot()`/`shellDrop()`、效果 `enemyShot()`/`blood()`/`shell()` 由其他角色实现，目前尚未落地；缺少时 Pipeline 只警告一次并跳过，不阻塞设置保存与事件发布。
- **证据**：`node --test test/游戏管线/game-state.test.js` → **32 pass / 0 fail**；四个入口导入冒烟通过（`events 26`、`contracts 40`、`createGame function`）。
- **尚未验证**：Electron 真实画面、真实服务联调、设置面板实际交互、完整人工操作流程、性能与内存稳定性；未测量真实 FPS，`getPerformance()` 只是运行时仪表。

本导航只列本角色直接负责的系统功能；测试和文档维护是角色工作，不单独算功能点。
