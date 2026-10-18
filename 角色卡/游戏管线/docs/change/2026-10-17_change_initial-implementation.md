---
id: initial-implementation-model-contracts
type: change
title: 初始实施：共享 Model 与 Pipeline 对局编排
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related:
  - match-flow
events:
  - date: "2026-10-17"
    kind: created
    summary: 写入三个共享 Model 文件并通过导入与纯函数冒烟检查
  - date: "2026-10-17"
    kind: implemented
    summary: 实现 Pipeline 状态机、主循环、计分、波次、HUD 与暂停/死亡/重开；20 项单元测试通过
  - date: "2026-10-17"
    kind: implemented
    summary: v3 人类敌人、设置契约、设置/性能 API、爆头与反馈映射；32 项单元测试通过；服务 setter 待实现
---

# 初始实施：共享 Model 与 Pipeline 对局编排

## 改在哪里

本次完成两个阶段。Model 阶段先建立所有角色共享的数据与事件；Pipeline 阶段再把战斗、敌方、环境、效果和音频服务串成一次完整对局。

| 位置 | 改动 |
| --- | --- |
| `src/models/events.js` | 全部事件名、对局状态值、`isKnownEvent()` 与 `isGameState()`。 |
| `src/models/game-config.js` | `GAME_CONFIG`、`ENEMY_TYPES`，以及波次数量、缩放和类型占比三个纯函数。 |
| `src/models/contracts.js` | 输入、快照、命中查询、HUD/世界事件载荷的 JSDoc 类型、构造函数与校验器。 |
| `src/pipelines/impl/game-state.js` | 纯状态机、计分账本、波次横幅。 |
| `src/pipelines/impl/game-pipeline.js` | 服务编排、总线事件、主循环、波次、HUD、死亡、静音、武器视图可见性、O3 菜单镜头、O4 只读快照。 |
| `src/pipelines/public/game.js` | 唯一公共入口 `createGame()`。 |
| `test/游戏管线/game-state.test.js` | 20 项单元测试。 |
| 本角色文档 | 功能说明、变更记录、导航、模块说明、接口说明、工作线索、变更日志。 |

## 以前怎样，现在怎样

**以前：** 项目里只有共享 Model 的初始版本，没有 `createGame()`、状态机或主循环。界面点“开始”不会真正进入对局；计分、波次、暂停、死亡结算和重开都没有运行时实现。

**现在：** 界面可以从 `src/pipelines/public/game.js` 创建对局，并调用：

```js
const game = createGame({ bus, renderer, arena, combat, enemies, effects, audio });
game.start();
game.setInput(command);
game.update(deltaSeconds);
game.pause();
game.resume();
game.restart();
game.toggleMute();
game.getState();
game.getSnapshot();
game.dispose();
```

对局会按 `menu → playing → paused / over → playing` 推进；击杀会加分并发出击杀信息；每波清空后等待 4.5 秒开始下一波；生命归零只结算一次；重开会把分数、波次、击杀和存活时间清零。菜单状态下 `update(dt)` 会推进 O3 环绕镜头。

**用户还看不到的部分：** Pipeline 还没有被界面装配接入，真实 Electron 窗口里还没有菜单、HUD 或结算画面。本阶段的证据只到单元测试和导入冒烟。

## 这次只改什么

本次只做本角色边界内的工作：

- 写 `src/models/` 三个文件（已存在，本次未改内容）、`src/pipelines/` 三个文件、`test/游戏管线/game-state.test.js` 与本角色文档。
- 不实现界面、Electron、Vite、HUD DOM 或 Provider。
- 不修改 `package.json`、测试 loader、共享事件总线或其他角色文件。
- 不声称 Electron 视觉、完整操作流程或性能已经验收。

## 对局实际行为

- **状态**：`menu`、`playing`、`paused`、`over`；每次变化发 `game:state { state }`。非法调用是安全空操作。
- **开始/重开**：复位战斗、敌人与效果，得分/击杀归零、波次 1、存活时间 0，`enemies.startWave(1)`，发 `wave:start` 与 `hud:banner`（`第 1 波` / `敌人来袭` / 2200 毫秒），播放波次音效。
- **主循环**：`dt` 上限 0.05 秒。对局中推进战斗、敌人、效果、竞技场；暂停和结算中不推进业务时间，只刷新 HUD。
- **计分与事件**：订阅总线上 13 个结果事件。`enemy:killed` 加分并累计击杀；`player:damage` 转发伤害；`pickup:collected` 治疗；`world:*` 映射到效果与音频；`weapon:*` 映射到音效；`player:died` 触发结算。
- **HUD**：至少每 0.05 秒发一次 `hud:update`，载荷为 `{ score, wave, kills, health, maxHealth, ammo, magazineSize, reloading, reloadProgress, yaw, muted }`。
- **波次**：`enemies.getState().waveComplete` 为真时发 `wave:cleared` 并计时 4.5 秒；计时结束波次 +1、开始下一波。暂停冻结计时，不会重复启动待开始的波次。
- **死亡**：快照 `alive === false` 或 `player:died` 时进入 `over`，发 `hud:gameover { score, wave, kills, survivedSeconds }`，播放结束音效；每局一次。
- **静音**：`toggleMute()` 调用 `audio.setMuted()` 并立即刷新 HUD。
- **O3/O4**：菜单环绕镜头按 `GAME_CONFIG.match.menuCamera` 计算；`getState()`/`getSnapshot()` 只读，快照可序列化。没有写接口。
- **武器视图**：调用可选的 `combat.setViewVisible()`。`menu`/`over` 隐藏，`playing`/`paused` 显示；开始/重开在 `reset()` 后重新显示，暂停/恢复/死亡时同步切换。方法不存在时安全跳过，失败记录错误。
- **释放**：`dispose()` 只退订本对局的总线处理并清空计时，不释放注入服务。

## 怎样确认

Model 阶段已由项目管理在调度记录 `docs/scheduling/neon-strike-delivery.md` 中标记 `model-contracts: verified`。Pipeline 阶段本次实际运行：

```sh
node --test test/游戏管线/game-state.test.js
```

观察结果：

```text
tests 20
pass 20
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 70.2225
```

覆盖范围：状态机合法/非法迁移、计分账本、波次横幅、必需服务校验、O3 菜单镜头、武器视图可见性、开始事件顺序、击杀计分与音效、伤害/拾取转发、弹道转发、暂停冻结与恢复、`update(1.0)` 只传 0.05 秒、死亡单次结算、`player:died` 事件结算、重开复位、4.5 秒波次间隔、静音与 HUD、O4 快照、`dispose` 退订。

公共入口导入冒烟：

```sh
node --input-type=module -e "import('./src/pipelines/public/game.js').then(m=>console.log(typeof m.createGame)).catch(e=>{console.error(e);process.exit(1)})"
```

实际输出：`function`（退出码 0）。

## 已知限制与未解决事项

- **没有 Electron 视觉/流程验证。** 菜单镜头构图、真实 HUD、暂停画面、死亡结算和重开后的场景清理都没有在真实窗口中查看。这不等于界面验收通过。
- 没有与真实战斗、敌方、环境、效果、音频服务联调；测试使用契约兼容的假服务加真实共享事件总线。
- 真实敌方服务在下一波开始后是否及时清除 `waveComplete`，需要集成测试确认。
- 波次清空时会额外发 `wave:cleared`；这是 Model 已登记、设计流程图使用的事件，不属于契约变更。
- `pickup:spawn` 只把位置传给 `effects.spawn()`，颜色使用效果服务默认值。
- `createGame` 的 `options` 当前只做类型校验，没有可调字段；需要调整 HUD 间隔或镜头参数时应先更新契约并回报项目管理。
- 战斗服务的 `viewport` 缺口仍未解决：屏幕中心射线依赖装配层传入实际画布尺寸。
- 连续开始/重开 5 次后的对象数量、内存与帧率未测量。
- 根 `package.json` 仍是 `"type": "commonjs"`，所以 Node 测试继续使用临时 ESM loader；界面装配切换为 ESM 后可直接运行 `node --test`。（这是 v2 初始实施时的情况；后续装配已切换为 ESM，v3 测试直接使用 `node --test`。）
- 本次未修改任何 Model 导出的字段或事件名，因此其他角色的既有契约证据不因本次实现而失效；但真实接线后的集成行为仍需复测。（仅指 v2 初始实施；v3 的 Model 变化见下一节。）

## v3 修订：人类士兵、设置与反馈契约

### 改在哪里

| 位置 | 改动 |
| --- | --- |
| `src/models/game-config.js` | 人类敌人（步枪兵/重机枪手/突击兵）、命中盒 head/body、模型路径、动画名、设置默认/范围、视图/后坐/抛壳/分层音频参数、`normalizeSettings()`、`clampSetting()`。 |
| `src/models/events.js` | 新增 `world:enemy-shot`、`world:blood`、`weapon:shell-eject`、`settings:changed`。 |
| `src/models/contracts.js` | `headshot`（`critical` 兼容别名）、`sourcePosition`、`direction`、`Settings`、`PerformanceSnapshot` 与新载荷构造函数/校验器。 |
| `src/pipelines/public/game.js` | `createGame()` 返回 `applySettings()`、`getSettings()`、`getPerformance()`。 |
| `src/pipelines/impl/game-pipeline.js` | 设置合并/转发/事件、性能仪表、爆头与受伤方向、敌人反馈映射、0.05 秒击杀顿帧。 |
| `test/游戏管线/game-state.test.js` | 20 → 32 项测试，新增 v3 覆盖。 |
| 本角色文档 | 功能说明、接口说明、导航、模块说明、备忘、日志与本节。 |

### 以前怎样，现在怎样

**以前（v2）：** 敌人是 `drone/brute/wraith` 机械单位，命中核心造成 2 倍伤害；没有设置项、没有性能接口；`hud:killfeed` 只有 `critical`；受伤只有 `amount`；`createGame()` 只有对局方法。

**现在（v3 本阶段）：**

- 敌人类型改为 `rifleman/heavy/breacher`，数值按设计 §12.2；步枪兵模型池含 Adventurer 与两个 Animated Woman 变体，重机枪手用放大 1.12 的 Adventurer，突击兵用 Man 基础模型；波次占比按 1 / 0.8+0.2 / 0.55+0.2+0.25。
- `GAME_CONFIG.settings` 提供默认值与范围；`normalizeSettings()` 补默认值并夹紧，非法类型/画质抛错。
- `createGame()` 新增 `applySettings(partial)`、`getSettings()`、`getPerformance()`；设置转发给战斗/渲染/音频并广播 `settings:changed`；`getSnapshot()` 含 `settings` 与 `performance`。
- 爆头：`DamageResult`、`enemy:killed`、`hud:hitmarker`、`hud:killfeed` 均带 `headshot`，`critical` 保留为兼容别名；爆头命中额外播放可选音效。
- 受伤方向：`player:damage.sourcePosition` 换算为 `hud:damage.direction`（相对玩家朝向）。
- 反馈：`world:enemy-shot`、`world:blood`、`weapon:shell-eject` 映射到效果/音频；击杀后 0.05 秒顿帧。
- 性能：`update(dt)` 采样平滑 FPS 与帧数；`getPerformance()` 返回 `{ fps, frameCount, enemyCount, quality, postProcessing }`。

### 这次只改什么

- 只写本角色边界内的 Model、Pipeline、测试与文档。
- 不实现战斗/敌方/环境/界面内部，也不修改 `main.js`、`index.html`、构建配置或其他角色文件。
- 不声称 Electron 视觉、真实服务联调、设置面板或实际帧率已经验证。

### 怎样确认

```sh
node --test test/游戏管线/game-state.test.js
```

实际结果（Node v24，Windows 11，2026-10-17）：

```text
tests 32
pass 32
fail 0
cancelled 0
skipped 0
todo 0
```

导入冒烟：`events 26`、`contracts 40`、`createGame function`，退出码 0。

覆盖：人类敌人与波次占比、设置默认/范围/夹紧/非法值、设置转发与渲染器回退、缺失 setter 容错、`settings:changed` 与快照、爆头命中/击杀信息、受伤方向、重复受伤音效抑制、敌人枪声/血雾/抛壳映射、性能字段、击杀顿帧与暂停/重开，以及原有对局流程。

### 已知限制（v3 本阶段）

- 服务 v3 setter（战斗 `setSettings`、渲染 `setQuality`、音频 `setMasterVolume` 等）尚未实现；Pipeline 只警告一次并跳过。
- 真实战斗服务的 `damagePlayer()` 会同步发一次不含方向的 `hud:damage`，Pipeline 带来源时会再发一次带方向的同类事件；音效已去重，但界面可能收到两次事件。需要战斗角色或项目管理确认最终契约。
- 其他角色的旧测试仍引用 `drone/brute/wraith`，在其所有者更新前会失败；本角色未修改这些文件。
- 没有 Electron 真实画面、设置面板、完整流程或真实 FPS 证据。
