# 变更日志：游戏管线

## 2026-10-17（v3 人类士兵、设置与契约）

### Model

- `src/models/game-config.js`
  - `ENEMY_TYPES` 改为 `RIFLEMAN:'rifleman'`、`HEAVY:'heavy'`、`BREACHER:'breacher'`；移除 `drone/brute/wraith` 与机械 `palette`。
  - `enemies` 新增 `headshotMultiplier: 2`、`modelPaths`、`animationNames`；三类人类敌人按设计 §12.2 配置：
    - 步枪兵：生命 70 / 速度 5.0 / 9–16 米 / 7 伤害 / 100 分 / 弹丸 34 / 三连发（间隔 0.12）/ 射击间隔 1.8 / 模型池 Adventurer、Woman Casual、Woman Formal。
    - 重机枪手：生命 200 / 速度 2.8 / 6–10 米 / 11 伤害 / 300 分 / 弹丸 30 / 三连发（间隔 0.14）/ 射击间隔 2.6 / `scale 1.12` / `armored true`。
    - 突击兵：生命 85 / 速度 7.2 / 近战 14 / 冷却 1.2 / 150 分 / Man 基础模型 / `melee true`。
  - 命中盒从 `coreRadius` 改为独立 `head` / `body`（width/height/depth/offsetY）。
  - 波次 `typeShares` 改为步枪兵/重机枪手/突击兵：第 1 波 1/0/0；第 2 波 0.8/0.2/0；第 3 波起 0.55/0.2/0.25。数量/缩放/间隔不变。
  - 新增 `settings.defaults`（1.0 / 0.8 / 75 / 0.7 / `high`）与 `settings.ranges`（0.25–3.0 / 0.4–1.5 / 65–95 / 0–1 / `high|low`）。
  - 新增武器/视图/后坐/镜头震动/FOV 冲击/抛壳/分层音频参数、`weapon.lookSensitivity`、`match.killHitstop`、`match.performance.fpsSmoothing`。
  - 新增 `clampSetting()` 与 `normalizeSettings()`；`getEnemyTypeShares()` 改为按 `ENEMY_TYPES` 动态返回。
- `src/models/events.js`：新增 `world:enemy-shot`、`world:blood`、`weapon:shell-eject`、`settings:changed`（`EVENTS` 共 26 个键，其中 25 个事件名，另含 `GAME_STATES`）。
- `src/models/contracts.js`：
  - `DamageResult`、`EnemyKilledPayload`、`HudHitmarkerPayload`、`HudKillfeedPayload` 增加 `headshot`；`critical` 保留为兼容别名，两者只给一个时自动同步。
  - `PlayerDamagePayload` 增加可选 `sourcePosition`；`HudDamagePayload` 增加 `direction`（-π..π）。
  - 新增 `Settings`、`PerformanceSnapshot` 类型，`createSettings()`、`isSettings()`、`createSettingsChangedPayload()`、`isPerformanceSnapshot()`、`createWorldEnemyShotPayload()`、`isWorldEnemyShotPayload()`、`createWorldBloodPayload()`、`isWorldBloodPayload()`、`createWeaponShellEjectPayload()`、`isWeaponShellEjectPayload()`、`isPlayerDamagePayload()`。
  - 默认敌人类型改为步枪兵，`world:enemy-spawn` 默认颜色改用步枪兵颜色。

### Pipeline

- `src/pipelines/public/game.js`：`createGame()` 返回值新增 `applySettings(partial)`、`getSettings()`、`getPerformance()`。
- `src/pipelines/impl/game-pipeline.js`：
  - 内部保存归一化设置（默认来自 `GAME_CONFIG.settings.defaults`）；`applySettings()` 合并当前设置、夹紧/校验、转发并发出 `settings:changed { settings }`；`getSettings()` 返回冻结副本。
  - 转发：战斗 `setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })`；渲染 `setQuality(quality)`，缺失时回退 `setPostProcessingEnabled(quality === 'high')`；音频 `setMasterVolume(masterVolume)`。缺失方法每个只警告一次；抛错记录。
  - `getSnapshot()` 增加 `settings` 与 `performance`。
  - `update(dt)` 记录帧数与平滑 FPS；`getPerformance()` 返回 `{ fps, frameCount, enemyCount, quality, postProcessing }`，敌人数量取 `enemies.getState().alive`，画质优先取渲染器 `getQuality()`。
  - 新增订阅：`world:enemy-shot` → `effects.enemyShot`/`muzzleSmoke` + `audio.enemyShot(distance, enemyType)`；`world:blood` → `effects.blood`；`weapon:shell-eject` → `effects.shell` + `audio.shellDrop`。
  - `hud:hitmarker.headshot` → 额外调用可选 `audio.headshot()`；击杀信息带 `headshot`。
  - `player:damage.sourcePosition` → 按玩家 yaw 计算 `hud:damage.direction`；用 `pendingDamageAudio` 避免同一次受伤播放两次音效。
  - 击杀后设置 0.05 秒顿帧；暂停时冻结、重开时清除。
- `test/游戏管线/game-state.test.js`：从 20 项扩展到 32 项，覆盖人类敌人与波次占比、设置默认/范围/夹紧/非法值、设置转发与渲染器回退、缺失 setter 容错、设置事件与快照、爆头命中/击杀信息、受伤方向、重复受伤音效抑制、敌人枪声/血雾/抛壳映射、性能字段、击杀顿帧与暂停/重开、以及原有对局流程。

### 验证

```sh
node --test test/游戏管线/game-state.test.js
# tests 32 / pass 32 / fail 0
```

```sh
node --input-type=module -e "Promise.all([...]).then(...)"
# events 26 keys; contracts 40 exports; createGame function
```

### 未验证

- 没有 Electron 真实画面、设置面板交互或完整人工流程；没有与真实 v3 服务联调。
- 服务 v3 setter（战斗/渲染/音频）与效果/音频新方法尚未实现，Pipeline 目前只能警告并跳过。
- 真实 FPS、30 敌人高画质性能、内存稳定性未测量。
- 其他角色的旧测试仍引用 `drone/brute/wraith`，在其所有者更新前会失败；本角色未修改这些文件。

---

## 2026-10-17

### Model 阶段（已完成，项目管理标记 verified）

- 新增 `src/models/events.js`：21 个事件名、`GAME_STATES`、`isKnownEvent()`、`isGameState()`。
- 新增 `src/models/game-config.js`：`GAME_CONFIG`、`ENEMY_TYPES`、`getWaveEnemyCount()`、`getEnemyScaling()`、`getEnemyTypeShares()`。
- 新增 `src/models/contracts.js`：29 个纯函数，覆盖输入、玩家快照、命中查询、伤害结果、HUD/世界/波次/拾取/武器载荷。
- 验证：临时 ESM loader 导入冒烟输出 `22 26 function`；纯函数冒烟输出 `behavior smoke OK`。

### Pipeline 阶段（已实现，单元测试通过）

- 新增 `src/pipelines/impl/game-state.js`：
  - `createGameStateMachine()`、`getAllowedTransitions()`：`menu→playing→paused→playing→over→playing`，非法迁移返回 `false`。
  - `createMatchAccounting()`、`addKillScore()`、`advanceSurvivalTime()`、`advanceWaveNumber()`、`createWaveBanner()`、`WAVE_BANNER_DURATION_MS`。
- 新增 `src/pipelines/impl/game-pipeline.js`：
  - `createGamePipeline()` 创建对局编排；校验必需服务与方法。
  - 主循环：dt 上限 0.05 秒；菜单 O3 环绕镜头；对局中推进战斗/敌人/效果/竞技场；暂停与结算冻结业务时间。
  - 订阅 13 个总线结果事件：击杀计分、伤害/拾取转发、世界效果、武器音效、死亡结算。
  - 波次：清空后发 `wave:cleared`，4.5 秒后开始下一波并发 `wave:start`、`hud:banner`、`audio.waveStart()`。
  - HUD：至少每 0.05 秒发一次 `hud:update`，状态变化、静音、波次开始时立即刷新。
  - 死亡：`player:died` 或快照 `alive === false` 时进入 `over`，发 `hud:gameover` 一次。
  - 武器视图：调用可选的 `combat.setViewVisible()`；`playing`/`paused` 显示，`menu`/`over` 隐藏，开始/重开在 `reset()` 之后重新显示，暂停/恢复/死亡时同步切换。方法不存在时安全跳过，失败记录错误。
  - O4：`getState()`、`getSnapshot()` 只读；`dispose()` 只退订与清计时，不释放注入服务。
- 新增 `src/pipelines/public/game.js`：唯一公共入口 `createGame()`。
- 新增 `test/游戏管线/game-state.test.js`：20 项测试，覆盖状态机、计分、暂停、死亡、重开、波次、HUD、静音、武器视图可见性、O3/O4 与 `dispose`。
- 新增/更新角色文档：`docs/feature/match-flow.md`、`docs/change/2026-10-17_change_initial-implementation.md`、`feature-map.md`、`memo.md`、`functional-description.md`、`api-spec.md`。
- 验证：
  ```sh
  node --test test/游戏管线/game-state.test.js
  # tests 20 / pass 20 / fail 0
  ```
  ```sh
  node --input-type=module -e "import('./src/pipelines/public/game.js').then(m=>console.log(typeof m.createGame)).catch(e=>{console.error(e);process.exit(1)})"
  # function
  ```
- 未验证：Electron 真实画面与完整流程、真实服务联调、性能与连续重开的内存稳定性。
