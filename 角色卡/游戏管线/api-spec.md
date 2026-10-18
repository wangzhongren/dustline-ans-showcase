# 接口说明：游戏管线

这份文档写给要接入对局的界面装配、要消费事件的音频/效果实现，以及后续独立测试角色。当前状态：

- **v3 Model 阶段：已实现，本角色测试通过。** 人类敌人配置、设置默认值/范围、4 个新事件、爆头/方向/设置/性能契约已写入；导入冒烟通过（events 26 键、contracts 40 个导出）。
- **v3 Pipeline 设置/契约阶段：已实现，单元测试通过。** `createGame()` 新增 `applySettings()`、`getSettings()`、`getPerformance()`，并接入爆头、受伤方向、敌人枪声/血雾/抛壳与击杀顿帧；`test/游戏管线/game-state.test.js` 实测 **32 pass / 0 fail**。
- **服务侧 v3 setter 尚未实现。** 战斗 `setSettings()`、渲染 `setQuality()`/`getQuality()`、音频 `setMasterVolume()`/`enemyShot()`/`headshot()`/`shellDrop()`、效果 `enemyShot()`/`blood()`/`shell()` 由其他角色负责；缺少时 Pipeline 只警告一次并跳过。
- **尚未验证：** 还没有接入 Electron 做真实画面、设置面板、完整操作流程或性能检查；也还没有跨角色集成测试报告。`getPerformance()` 是运行时仪表，不是帧率验收。

## 1. 怎样导入

项目源码按 ES 模块编写。根 `package.json` 已切换为 `"type": "module"`，Node 测试可直接运行 `node --test`；Vite/浏览器按普通 ES 模块导入即可。

```js
// 界面装配：创建对局
import { createGame } from './src/pipelines/public/game.js';

// 所有角色：事件名、数值、数据结构
import { EVENTS } from './src/models/events.js';
import {
  GAME_CONFIG,
  ENEMY_TYPES,
  normalizeSettings,
  clampSetting
} from './src/models/game-config.js';
import {
  createInputCommand,
  createSettings,
  isSettings,
  isPerformanceSnapshot
} from './src/models/contracts.js';
```

界面与测试只能导入 `src/pipelines/public/game.js`，不得导入 `src/pipelines/impl/`。Pipeline 只导入 Model 与共享事件总线，不导入任何 Service 实现；Service 的 `emit` 由装配层接到 `bus.emit`，Pipeline 通过订阅总线结果事件完成协作。

## 2. `createGame(options)` 精确签名

```js
createGame({ bus, renderer, arena, combat, enemies, effects, audio, options })
  -> {
       start(),
       pause(),
       resume(),
       restart(),
       update(deltaSeconds),
       setInput(command),
       toggleMute(),
       applySettings(partial),
       getSettings(),
       getPerformance(),
       getState(),
       getSnapshot(),
       dispose()
     }
```

### 参数

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `bus` | 是 | 共享事件总线，必须提供 `on`、`off`、`emit`。 |
| `renderer` | 是 | 至少提供 `setCameraPose(pose)`；v3 可选 `setQuality(quality)`、`getQuality()`、`setPostProcessingEnabled(enabled)`、`isPostProcessingEnabled()`/`getPostProcessingEnabled()`。 |
| `arena` | 是 | 至少提供 `update(dt)`。 |
| `combat` | 是 | 必须提供 `reset`、`update(dt, input)`、`damagePlayer(amount)`、`heal(amount)`、`getSnapshot()`、`getWeaponState()`；可选 `setViewVisible(visible)`、`setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })`。 |
| `enemies` | 是 | 必须提供 `reset`、`startWave(n)`、`update(dt, playerSnapshot)`、`getState()`；`getState().alive` 用于性能仪表。 |
| `effects` | 是 | 必须提供 `tracer`、`impact`、`explosion`、`spawn`、`update(dt)`、`clear()`；v3 可选 `enemyShot(position, direction, color)`、`muzzleSmoke(position, direction)`、`blood(position, direction, color)`、`shell(position, velocity)`。 |
| `audio` | 是 | 必须提供 `shoot`、`hit`、`kill`、`explosion`、`hurt`、`reload`、`empty`、`pickup`、`waveStart`、`gameOver`、`setMuted`；可选 `isMuted`、`setMasterVolume(volume)`、`enemyShot(distance, enemyType)`、`headshot()`、`shellDrop()`。 |
| `options` | 否 | 必须是对象。当前没有可调字段，保留给装配层后续扩展；不传也能正常工作。 |

缺少任一必需服务或方法时，`createGame` 立即抛出带字段名和方法名的 `TypeError`，不会创建半成品对局。v3 可选方法缺失不会让创建失败；使用时会记录一次警告并跳过。

`dispose()` **只**退订本对局在总线上注册的 16 个处理函数并清空波次计时；它**不**调用任何注入服务的 `dispose()`，也不清空整条总线（总线可能还有界面等消费者）。服务与渲染器由装配层负责释放。

## 3. 状态与迁移

状态取自 `EVENTS.GAME_STATES`：`menu`、`playing`、`paused`、`over`。每次状态变化都通过总线发 `EVENTS.GAME_STATE`，载荷为 `{ state }`。

| 当前状态 | 允许进入 | 触发方法 |
| --- | --- | --- |
| `menu` | `playing` | `start()`（`restart()` 也可从菜单开始） |
| `playing` | `paused` | `pause()` |
| `playing` | `over` | 生命归零或 `player:died` 事件 |
| `paused` | `playing` | `resume()`，或 `restart()` 完全重开 |
| `over` | `playing` | `restart()` |

非法调用是安全空操作：菜单中 `pause()`、对局中 `resume()`、结算中 `pause()` 都不会改变状态，也不会发事件。`restart()` 从 `playing` 调用时保持 `playing`，但会完整重置并再次发 `game:state { state:'playing' }`。

### 开始/重开做了什么

1. 状态进入 `playing`。
2. `combat.reset()`、`enemies.reset()`、`effects.clear()`。
3. 得分 0、击杀 0、波次 1、存活时间 0。
4. `enemies.startWave(1)`。
5. 发 `game:state`、`wave:start { wave:1 }`、`hud:banner { title:'第 1 波', subtitle:'敌人来袭', durationMs:2200 }`，并立即发一次 `hud:update`。
6. 调用 `audio.waveStart()`。

### 第一人称武器可见性

战斗服务提供可选的 `setViewVisible(visible)`。Pipeline 在以下时点调用它；方法不存在时安全跳过，调用失败会记录错误：

| 状态 | 可见性 | 调用时机 |
| --- | --- | --- |
| `menu` | 隐藏 | `createGame()` 初始化后立即调用。 |
| `playing` | 显示 | 开始/重开后（`reset()` 会把武器恢复可见，因此必须在 reset 之后显式调用）；恢复（`resume()`）后再次调用。 |
| `paused` | 显示 | `pause()` 后调用（暂停时画面仍显示武器）。 |
| `over` | 隐藏 | 死亡结算进入 `over` 后调用；重开时再显示。 |

`setViewVisible()` 是可选方法：旧版战斗服务或测试假对象没有它时，Pipeline 不会报错，也不会影响其他行为。

## 4. 主循环与暂停

`update(deltaSeconds)` 由装配层的渲染循环调用：

- `deltaSeconds` 必须是非负有限数字，否则抛 `RangeError`。
- 单帧上限为 `GAME_CONFIG.match.deltaClamp`（0.05 秒）。`update(1.0)` 实际只推进 0.05 秒。
- `menu`：只按 `GAME_CONFIG.match.menuCamera` 推进 O3 环绕镜头并调用 `renderer.setCameraPose({ position, yaw, pitch, fov })`，不推进任何业务。
- `playing`：累加存活时间，依次调用 `combat.update(dt, input)`、`enemies.update(dt, combat.getSnapshot())`、`effects.update(dt)`、`arena.update(dt)`，然后做波次协调、死亡检查和 HUD 刷新。
- `paused` / `over`：**不**推进战斗、敌人、波次计时、存活时间、效果或竞技场；只按刷新间隔发 `hud:update`。渲染由装配层继续调用 `renderer.render()`。
- 如果 `combat.update()` 同步发出 `player:died`，状态会在同一帧变为 `over`，本帧不会继续更新敌人、效果或竞技场。

输入由界面每帧调用 `setInput(command)` 写入。Pipeline 用 `createInputCommand()` 补齐缺省字段（无输入），再把完整命令交给战斗服务；瞬态字段（`jump`、`reload`）由战斗服务按自己的规则消费。

## 5. 波次协调

- 每帧读取 `enemies.getState().waveComplete`。
- 第一次看到 `true` 时发 `wave:cleared { wave }`，并开始 4.5 秒计时（`GAME_CONFIG.waves.waveInterval`）。
- 计时期间不会重复开始计时；暂停时计时冻结。
- 计时结束后波次 `+1`，调用 `enemies.startWave(wave)`，发 `wave:start { wave }`、`hud:banner { title:'第 N 波', subtitle:'敌人来袭', durationMs:2200 }`，调用 `audio.waveStart()`，并立即刷新 HUD。
- 同一时刻不会同时存在两个待开始的波次。

## 5.1 设置（v3）

设置在 Pipeline 内部以完整、冻结的对象保存，初始值来自 `GAME_CONFIG.settings.defaults`。

```js
{
  mouseSensitivity: 1.0,          // 0.25 .. 3.0
  adsSensitivityMultiplier: 0.8,  // 0.4 .. 1.5
  fov: 75,                        // 65 .. 95
  masterVolume: 0.7,              // 0 .. 1
  quality: 'high'                 // 'high' | 'low'
}
```

- `applySettings(partial)`：把 `partial` 合并到当前设置（不是重置为默认值），校验/夹紧后保存，转发给服务，发 `settings:changed { settings }`，并返回冻结的设置副本。非对象参数抛 `TypeError`；非有限数字抛 `TypeError`；非法 `quality` 抛 `RangeError`。
- `getSettings()`：返回新的冻结副本；修改它不会影响 Pipeline。
- 转发：
  - `combat.setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })`
  - `renderer.setQuality(quality)`；没有该方法但有 `setPostProcessingEnabled` 时调用 `setPostProcessingEnabled(quality === 'high')`
  - `audio.setMasterVolume(masterVolume)`
- 任一 setter 缺失：每个服务/方法只警告一次，设置仍然保存并发布事件；setter 抛错时记录 `console.error`。
- 设置变化不会重开对局、不会重置分数；`restart()` 保留当前设置。

## 5.2 性能仪表（v3）

- `update(dt)` 每次调用累加 `frameCount`，并用原始 `dt` 计算指数平滑 FPS（系数 `GAME_CONFIG.match.performance.fpsSmoothing`）。
- `getPerformance()` 返回冻结对象：

```js
{
  fps,             // 平滑后的近期帧率；没有采样时为 0
  frameCount,      // 自创建以来 update() 的调用次数
  enemyCount,      // enemies.getState().alive；不可用时为 0
  quality,         // 渲染器 getQuality() 优先，否则用 settings.quality
  postProcessing   // 渲染器状态优先，否则 quality === 'high'
}
```

这是运行时仪表，不是验收过的性能承诺；文档不写“60fps”。

## 5.3 爆头、受伤方向与 v3 反馈映射

- `hud:hitmarker { killed, headshot }`：始终调用 `audio.hit()`；`headshot === true` 时额外调用可选 `audio.headshot()`。
- `enemy:killed { enemyType, score, headshot, critical, position, color }`：`headshot` 与 `critical` 互为别名；killfeed 同时带两者。
- `player:damage { amount, sourcePosition? }`：
  - 无 `sourcePosition`：只调用 `combat.damagePlayer(amount)`。
  - 有 `sourcePosition`：按玩家 yaw 计算方向，调用 `combat.damagePlayer(amount)` 后发 `hud:damage { amount, direction }`。方向 0 为正前方，正值在右，负值在左，范围 -π..π。
  - 真实战斗服务的 `damagePlayer()` 也会同步发一次不含方向的 `hud:damage`；Pipeline 用内部标志保证受伤音效只播放一次。界面仍可能收到两次 `hud:damage`（见第 11 节）。
- `world:enemy-shot` → `effects.enemyShot(position, direction, color)`；方法缺失时退回 `effects.muzzleSmoke(position, direction)`；并调用 `audio.enemyShot(distance, enemyType)`，距离按玩家快照与枪口位置计算。
- `world:blood` → `effects.blood(position, direction, color)`。
- `weapon:shell-eject` → `effects.shell(position, velocity)` + `audio.shellDrop()`。
- 击杀顿帧：收到 `enemy:killed` 后冻结最多 `GAME_CONFIG.match.killHitstop`（0.05 秒）的业务更新；暂停时计时冻结，`restart()` 清除。

## 6. 总线事件接线

装配层把各服务的 `emit` 直接接到 `bus.emit`。Pipeline 在 `createGame` 中订阅下列结果事件，在 `dispose` 中全部退订。处理函数抛错会记录到 `console.error`，不会静默吞掉。

| 订阅事件 | Pipeline 行为 |
| --- | --- |
| `enemy:killed` | 仅 `playing` 时：累加 `score` 和 `kills`，发 `hud:killfeed { enemyType, score, headshot, critical }`，调用 `audio.kill()`，设置 0.05 秒击杀顿帧。 |
| `player:damage` | 仅 `playing` 时：调用 `combat.damagePlayer(amount)`；有 `sourcePosition` 时再发带 `direction` 的 `hud:damage`。 |
| `pickup:collected` | 仅 `playing` 时：调用 `combat.heal(payload.amount)` 与 `audio.pickup()`。 |
| `hud:damage` | 调用 `audio.hurt()`；带来源的受伤转发流程会抑制战斗服务同步发出的那一次，避免双音。 |
| `hud:hitmarker` | 调用 `audio.hit()`；`headshot === true` 时再调用可选 `audio.headshot()`。 |
| `world:shot` | `effects.tracer(from, to, color)`，调用 `audio.shoot()`。 |
| `world:impact` | `effects.impact(position, normal, color)`。 |
| `world:explosion` | `effects.explosion(position, color, scale)`，调用 `audio.explosion()`。 |
| `world:enemy-spawn` | `effects.spawn(position, color)`。 |
| `world:enemy-shot` | `effects.enemyShot` 或 `muzzleSmoke`；`audio.enemyShot(distance, enemyType)`。 |
| `world:blood` | `effects.blood(position, direction, color)`。 |
| `pickup:spawn` | `effects.spawn(position)`（颜色使用效果服务默认值）。 |
| `weapon:reload-start` | 调用 `audio.reload()`。 |
| `weapon:empty` | 调用 `audio.empty()`。 |
| `weapon:shell-eject` | `effects.shell(position, velocity)` 与 `audio.shellDrop()`。 |
| `player:died` | 读取战斗快照；`alive === false` 时结算。 |

事件载荷先经过 `src/models/contracts.js` 的构造函数归一化；非法载荷会被记录并忽略，不会把坏数据写进 HUD。

## 7. Pipeline 发出的事件

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `game:state` | `{ state }` | 每次状态变化（开始、暂停、恢复、结算、重开）。 |
| `hud:update` | `{ score, wave, kills, health, maxHealth, ammo, magazineSize, reloading, reloadProgress, yaw, muted }` | 开始/状态变化/静音时立即；对局中至少每 0.05 秒一次；暂停/结算中继续按间隔刷新。 |
| `wave:start` | `{ wave }` | 第 1 波与每个后续波次开始。 |
| `wave:cleared` | `{ wave }` | 检测到本波清空时。 |
| `hud:banner` | `{ title:'第 N 波', subtitle:'敌人来袭', durationMs:2200 }` | 每个波次开始。 |
| `hud:killfeed` | `{ enemyType, score, headshot, critical }` | 每次击杀。 |
| `hud:damage` | `{ amount, direction }` | `player:damage` 带 `sourcePosition` 时；`direction` 相对玩家朝向。 |
| `settings:changed` | `{ settings }`（完整归一化设置） | 每次成功 `applySettings()` 后。 |
| `hud:gameover` | `{ score, wave, kills, survivedSeconds }` | 每局仅一次。 |

`hud:hitmarker` 与战斗服务自己发出的 `hud:damage` 仍由战斗服务产生；Pipeline 只订阅并映射音频。带 `sourcePosition` 的 `player:damage` 是例外：Pipeline 会额外发一次带方向的 `hud:damage`。

## 8. 死亡、静音与只读状态

- **死亡：** `combat.getSnapshot().alive === false` 或收到 `player:died` 时，若当前是 `playing` 且尚未结算，则进入 `over`，发 `game:state`、`hud:gameover`，调用 `audio.gameOver()`，并立即刷新 HUD。每局只发一次 `hud:gameover`。
- **静音：** `toggleMute()` 翻转内部布尔值，调用 `audio.setMuted(muted)`，并立即发一次 `hud:update`。初始值优先读取 `audio.isMuted()`；该方法不可用时从 `false` 开始。
- **O3 菜单镜头：** 菜单状态下的 `update(dt)` 按 `GAME_CONFIG.match.menuCamera` 的参数环绕竞技场中心；状态离开菜单后由战斗服务接管相机。
- **O4 只读状态：** `getState()` 返回状态字符串；`getSnapshot()` 返回冻结的普通对象：

```js
{
  state: 'menu' | 'playing' | 'paused' | 'over',
  player: PlayerSnapshot,      // combat.getSnapshot()
  weapon: WeaponState,         // combat.getWeaponState()
  score, wave, kills, survivedSeconds,
  enemies: {                   // enemies.getState()
    wave, alive, pendingSpawns, totalInWave, spawned, waveComplete
  },
  muted,
  settings: Settings,          // 完整、冻结的当前设置
  performance: {               // getPerformance()
    fps, frameCount, enemyCount, quality, postProcessing
  }
}
```

该对象可由 `JSON.stringify` 序列化，供 `?test=1` 的 `window.__DUSTLINE_TEST__` 使用。Pipeline 没有提供任何写入接口；`applySettings()` 是配置入口，不是对局状态写接口。

## 9. 错误与日志

- 缺少必需服务/方法、`options` 不是对象：创建时抛 `TypeError`。
- `update` 的 `dt` 非法：抛 `RangeError`。
- `setInput` 的输入非法：由 `createInputCommand()` 抛 `TypeError`。
- `applySettings` 参数不是对象、设置项不是有限数字：抛 `TypeError`；非法 `quality`：抛 `RangeError`。
- 服务调用失败（渲染器、战斗、敌人、效果、音频）：捕获并用 `console.error` 记录具体动作，主循环继续。
- v3 可选 setter/效果/音频方法缺失：每个方法只 `console.warn` 一次并跳过，不静默吞掉。
- 总线处理函数失败：`subscribe` 包装层记录事件名与错误；事件总线本身也会隔离并记录监听器异常。
- 不存在静默 `catch`。`dispose` 退订失败同样会记录。

## 10. 验证命令与实际结果

在项目根目录运行（Node v24，Windows 11，2026-10-17）：

```sh
node --test test/游戏管线/game-state.test.js
```

实际结果：

```text
tests 32
pass 32
fail 0
cancelled 0
skipped 0
todo 0
```

（`duration_ms` 每次运行都会波动，这里不记录为固定值。）

覆盖：人类敌人与波次占比、设置默认/范围/夹紧/非法值、applySettings 转发与渲染器回退、缺失 setter 容错、settings:changed 与快照、爆头命中/击杀信息、受伤方向、重复受伤音效抑制、敌人枪声/血雾/抛壳映射、性能字段、击杀顿帧与暂停/重开，以及状态机合法/非法迁移、计分账本、必需服务校验、O3 菜单镜头、武器视图可见性、开始事件顺序、击杀计分与音效、伤害/拾取转发、弹道转发、暂停冻结与恢复、0.05 秒钳制、死亡单次结算、`player:died` 事件结算、重开复位、4.5 秒波次间隔、静音与 HUD、O4 快照、`dispose` 退订。

导入冒烟：

```sh
node --input-type=module -e "Promise.all([import('./src/models/events.js'),import('./src/models/game-config.js'),import('./src/models/contracts.js'),import('./src/pipelines/public/game.js')]).then(([e,c,k,g])=>{console.log('events',Object.keys(e.EVENTS).length,'contracts',Object.keys(k).length,'game',typeof g.createGame)}).catch(e=>{console.error(e);process.exit(1)})"
```

实际输出：`events 26 contracts 40 game function`（退出码 0）。

## 11. 已知限制与尚未验证

- **没有 Electron 视觉/流程验证。** 菜单镜头构图、真实 HUD 刷新、设置面板、暂停画面、死亡结算界面和重开后的场景清理都还没有在真实窗口中查看。
- **服务 v3 setter 尚未实现。** 战斗 `setSettings()`、渲染 `setQuality()`/`getQuality()`、音频 `setMasterVolume()`/`enemyShot()`/`headshot()`/`shellDrop()`、效果 `enemyShot()`/`blood()`/`shell()` 目前由 Pipeline 警告并跳过；设置只会保存在 Pipeline 并发布事件。
- **可能的重复 `hud:damage`。** 真实战斗服务当前会在 `damagePlayer()` 内发一次不含方向的 `hud:damage`，Pipeline 在带来源的受伤流程中会再发一次带方向的同类事件。音效已去重，但界面可能收到两次事件。建议战斗角色在 v3 中停止由 `damagePlayer` 发 `hud:damage`，或由项目管理确认接受重复闪烁。
- **其他角色的旧测试会暂时失败。** 敌方/战斗/界面/独立测试仍有 `drone/brute/wraith` 或旧 `enemies.*` 配置引用；由各自所有者更新，本角色未修改这些文件。
- 没有与真实战斗、敌方、环境、效果、音频服务的联调测试；当前证据是契约兼容的假服务加真实共享总线。
- `getPerformance()` 只是运行时仪表；真实 FPS、30 敌人高画质性能、连续开始/重开 5 次后的对象数量与内存稳定性都未测量。
- `enemies.getState().waveComplete` 由敌方服务负责置位；真实服务在下一波开始后是否及时清除该标志，需要集成测试确认。
- `options` 目前没有可调字段；若装配层需要覆盖 HUD 间隔或镜头参数，应先更新契约并回报项目管理。
- 战斗服务的 `viewport` 缺口仍未解决：屏幕中心射线依赖装配层传入实际画布尺寸，与 Pipeline 无关但会影响完整流程。
