# 模块说明：游戏管线

## 这个角色负责什么

游戏管线负责让一局游戏按顺序发生：菜单 → 对局 → 波次 → 受伤/死亡 → 结算 → 重开；同时负责所有角色共享的数据契约。界面只把按钮点击变成“开始/暂停/恢复/重开”命令，敌人、战斗、环境服务只做自己那一部分，最后由 Pipeline 把它们串起来。

当前状态：**v3 Model 与 Pipeline 设置/契约骨架已实现。** 本角色 32 项单元测试通过；服务侧 v3 setter 仍由其他角色实现，Electron 真实画面、设置面板交互和完整流程还没有验证。

## 当前已有内容

| 文件 | 内容 | 当前状态 |
| --- | --- | --- |
| `src/models/events.js` | `EVENTS` 共 26 个键：25 个事件名（新增敌人枪声、血雾、抛壳、设置变更）加 `GAME_STATES`；`isKnownEvent()`、`isGameState()`。 | 已实现。 |
| `src/models/game-config.js` | 玩家/武器/人类敌人/波次/竞技场/对局/设置数值；命中盒、模型路径、动画名、设置默认值与范围；波次数量、缩放、类型占比与设置归一化辅助。 | 已实现，深度冻结。 |
| `src/models/contracts.js` | 输入命令、玩家快照、命中查询、伤害结果、HUD/世界/设置/性能载荷的类型、构造函数和校验器。 | 已实现，40 个导出。 |
| `src/pipelines/public/game.js` | 唯一公共入口 `createGame()`，含设置与性能方法。 | 已实现。 |
| `src/pipelines/impl/game-state.js` | 纯状态机、计分账本、波次横幅。 | 已实现，单元测试覆盖。 |
| `src/pipelines/impl/game-pipeline.js` | 服务编排、总线事件、主循环、设置转发、性能仪表、爆头/方向反馈、O3/O4。 | 已实现，单元测试覆盖。 |
| `test/游戏管线/game-state.test.js` | 状态机、计分、暂停、死亡、重开、波次、HUD、设置、性能、爆头/方向、新事件映射、顿帧、O3/O4、`dispose`。 | 32 pass / 0 fail。 |

## 一次对局现在怎样运行

1. **菜单**：状态 `menu`。`update(dt)` 只按 `GAME_CONFIG.match.menuCamera` 推进 O3 环绕镜头，不推进战斗或敌人。
2. **开始**：`start()` 从 `menu` 进入 `playing`，复位战斗、敌人和效果，得分/击杀归零、波次设为 1，调用 `enemies.startWave(1)`，发 `game:state`、`wave:start`、`hud:banner` 和一次 `hud:update`，播放波次音效。
3. **对局中**：每帧最多推进 0.05 秒；累加存活时间，调用 `combat.update(dt, input)`、`enemies.update(dt, combat.getSnapshot())`、`effects.update(dt)`、`arena.update(dt)`。总线上的击杀、伤害、拾取、射击、爆炸等结果事件由 Pipeline 计分、转发或映射到效果/音频。
4. **设置**：`applySettings(partial)` 把局部设置合并到当前设置，夹紧/校验后保存，转发给战斗、渲染和音频，再发 `settings:changed { settings }`；`getSettings()` 返回冻结副本。设置变化不重开对局，也不重置分数。服务缺少 v3 setter 时只警告一次并跳过。
5. **性能仪表**：每次 `update(dt)` 累加帧数并用原始帧时间平滑 FPS；`getPerformance()` 返回 `{ fps, frameCount, enemyCount, quality, postProcessing }`。这只是运行时读数，不是验收过的帧率。
6. **暂停**：`pause()` 只从 `playing` 生效；暂停后 `update(dt)` 不推进任何业务时间，只按间隔刷新 HUD。`resume()` 恢复。
7. **波次**：敌人清空后发 `wave:cleared` 并计时 4.5 秒；计时结束波次 +1，开始下一波并再次发 `wave:start`、`hud:banner`。
8. **爆头与反馈**：`hud:hitmarker.headshot` 额外播放可选爆头音；`enemy:killed` 的 `headshot` 进入 `hud:killfeed`；击杀后冻结 0.05 秒业务更新（暂停冻结、重开清除）。`player:damage.sourcePosition` 会换算成相对玩家朝向的 `hud:damage.direction`。
9. **敌人枪声/血雾/抛壳**：`world:enemy-shot` 映射到 `effects.enemyShot`（或 `muzzleSmoke`）与 `audio.enemyShot(distance, enemyType)`；`world:blood` → `effects.blood`；`weapon:shell-eject` → `effects.shell` + `audio.shellDrop`。
10. **死亡**：生命归零或收到 `player:died` 时进入 `over`，发 `game:state` 和 `hud:gameover`，播放结束音效。每局只结算一次。
11. **重开**：`restart()` 从 `paused`、`over` 或 `playing` 完整重置，重新进入 `playing` 并发第 1 波事件；已应用的设置保留。
12. **静音**：`toggleMute()` 切换状态、调用 `audio.setMuted()`，并立即刷新带 `muted` 的 HUD。
13. **只读状态（O4）**：`getState()` 返回状态；`getSnapshot()` 返回可序列化的冻结对象（含 `settings` 与 `performance`），供测试钩子读取。
14. **武器视图**：调用可选的 `combat.setViewVisible()`；菜单与结算隐藏第一人称武器，对局与暂停显示，开始/重开在 `reset()` 之后重新显示。
15. **释放**：`dispose()` 退订本对局注册的总线处理并清空波次计时；不释放注入服务，服务生命周期归装配层。

## 这个模块怎样和别的角色配合

- **界面装配**：通过 `createGame()` 发送开始/暂停/恢复/重开命令，调用 `update(dt)`、`setInput(command)`、`applySettings(saved)`，并订阅 `game:state`、`hud:*`、`settings:changed` 事件。界面负责中文敌人名称（步枪兵/重机枪手/突击兵）与设置面板，不实现游戏规则。
- **战斗服务**：Pipeline 读取 `PlayerSnapshot` 与 `WeaponState`，转发 `player:damage → damagePlayer`、`pickup:collected → heal`；v3 通过 `combat.setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })` 下发设置。战斗服务负责输入消费、灵敏度、射击和生命规则。
- **敌方服务**：Pipeline 每帧把玩家快照交给 `enemies.update()`，读取 `getState().waveComplete` 决定下一波，根据 `enemy:killed` 计分；敌人类型、命中盒、模型/动画名来自共享 Model。
- **环境引擎**：效果与音频服务由 Pipeline 在事件处理时调用；`effects.enemyShot/blood/shell` 与 `audio.enemyShot/headshot/shellDrop/setMasterVolume` 是 v3 可选方法；竞技场 `update(dt)` 只在 `playing` 推进。
- **项目管理**：共享事件总线由项目管理维护；Pipeline 只通过 `on/off/emit` 使用它。

所有角色都可以导入 Model，Model 不反向导入任何运行层。

## 写范围

只有 `角色卡/游戏管线/boundary.md` 第 1 节列出的文件可以修改。v3 本次实际写入：三个 Model 文件、三个 Pipeline 文件、`test/游戏管线/game-state.test.js`，以及本角色的功能/变更/接口/说明/导航/备忘/日志文档。

## 不做什么

- 不在界面层重复实现状态、计分或波次规则。
- 不让服务互相导入；服务之间需要的数据由 Pipeline 注入。
- 不在 Model 中放渲染、音频、DOM、Three.js 或网络访问。
- 不在 `dispose()` 中释放注入服务或清空整条总线（其他消费者可能仍在使用）。
- 不修改其他角色的文件、共享事件总线、`package.json` 或测试 loader。
- 不声称 Electron 画面、完整操作流程或性能已经验收。

## 当前验证

- 单元测试：
  ```sh
  node --test test/游戏管线/game-state.test.js
  ```
  实际结果：**32 pass / 0 fail**（Node v24，Windows 11，2026-10-17）。
- 导入冒烟：`EVENTS` 26 个键、`contracts` 40 个导出、`createGame` 为 `function`，退出码 0。
- 覆盖：人类敌人与波次占比、设置默认/范围/夹紧/非法值、设置转发与渲染器回退、缺失 setter 容错、`settings:changed` 与快照、爆头命中/击杀信息、受伤方向、重复受伤音效抑制、敌人枪声/血雾/抛壳映射、性能字段、击杀顿帧与暂停/重开，以及原有状态机、计分、暂停、死亡、重开、波次、HUD、O3/O4、`dispose`。
- 尚未验证：Electron 真实渲染与设置面板、真实服务联调、完整人工流程、真实 FPS 与内存曲线。服务 v3 setter 目前尚未实现，Pipeline 只能警告并跳过。
