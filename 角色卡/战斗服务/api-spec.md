# 接口说明：战斗服务

本文件说明 Pipeline 如何创建战斗服务、能读到什么、会收到哪些事件，以及当前测试证据。

跨角色契约来源：

- 已确认设计 `docs/governance/2026-10-17_bootstrap-and-game-design.md` v3 §12.2–§12.4、§12.6–§12.7。
- 调度记录 `docs/scheduling/neon-strike-delivery.md` V3-2 冻结契约。
- 共享 Model：`src/models/game-config.js`、`src/models/events.js`、`src/models/contracts.js`。

## 1. 导入

Pipeline 只能从公共入口导入：

```js
import { createCombat } from './src/services/public/combat.js';
```

`src/services/impl/combat/`、`src/services/abstract/combat.js` 不供外部直接调用。战斗服务不导入其他 Service、Pipeline、Interface、`src/providers/impl/` 或 `three` 包；Three.js 符号只来自 `src/providers/public/three.js`。

## 2. `createCombat(options)`

```js
createCombat({ renderer, colliders, targetQuery, emit, spawn?, viewport?, assets? })
  -> {
       reset,
       update,
       damagePlayer,
       heal,
       getSnapshot,
       getWeaponState,
       setViewVisible,
       setSettings,
       getSettings,
       load,
       dispose
     }
```

冻结签名与本实现一致，没有额外必填字段。

### 参数

| 字段 | 必需 | 类型 | 说明 |
| --- | --- | --- | --- |
| `renderer` | 是 | `Renderer` | `src/providers/public/renderer.js` 创建的渲染器。缺失或缺少 `setCameraPose`、`getWorldPosition`、`raycast`、`attachToCamera`、`detachFromCamera` 时抛 `TypeError`。 |
| `colliders` | 否 | `Collider[]` | 竞技场 AABB 障碍；只读消费，内部复制并冻结。无效项 `console.error` 后跳过。缺省为空数组。 |
| `targetQuery` | 是 | `HitTargetQuery` | `{ listHittable(), applyDamage(targetId, damage) }`。缺失或方法不完整时抛 `TypeError`。 |
| `emit` | 是 | `(eventName, payload) => void` | 事件发射函数。缺失或非函数时抛 `TypeError`。监听器抛错会被捕获并 `console.error`，不中断战斗逻辑。 |
| `spawn` | 否 | `{ x, y, z }` | 可选出生点；缺省 `{ x: 0, y: 0, z: 8 }`，面朝 -Z。 |
| `viewport` | 否 | `{ width, height }` | 可选画布 CSS 像素尺寸，用于屏幕中心射线；缺省 1600 × 900（设计窗口）。 |
| `assets` | 否 | `AssetLoader` | 可选素材加载器，需提供 `loadManifest()` 与 `loadTexture(url, options)`。提供时 `load()` 预加载金属/钢/木材/织物 PBR 贴图；缺失时使用程序化材质。 |

`Collider = { min: { x, y, z }, max: { x, y, z } }`，世界坐标轴对齐盒，只读。

### 返回方法

| 方法 | 签名 | 行为 |
| --- | --- | --- |
| `reset()` | `() => void` | 复位玩家到出生点、满血、朝向 0、武器满弹匣、无后坐力/震动/换弹、相机姿态与视图动画状态。设置保持不变。可重复调用，不重复挂载模型，不发事件。 |
| `update(dt, input)` | `(number, InputCommand) => void` | 推进一帧。`dt` 限制在 `GAME_CONFIG.match.deltaClamp`（0.05 秒）。非法 `dt` 抛 `RangeError`；非法输入由 `createInputCommand` 抛 `TypeError`。死亡后只更新相机与视图动画，不移动、不射击。 |
| `damagePlayer(amount)` | `(number) => void` | 扣血并重置 5 秒恢复延迟；`amount` 必须大于 0。生命归零时只发一次 `player:died`。**不发出 `hud:damage`**；该事件由 Pipeline 统一发布带方向的版本。 |
| `heal(amount)` | `(number) => void` | 恢复生命，不超过上限；死亡时无效。`amount` 必须大于 0。不直接发事件。 |
| `getSnapshot()` | `() => PlayerSnapshot` | 返回 Model 约定的完整只读快照，见 §3。 |
| `getWeaponState()` | `() => WeaponState` | 返回弹药、换弹与瞄准状态，见 §4。 |
| `setViewVisible(visible)` | `(boolean) => void` | 显示/隐藏第一人称视图模型（含双手、枪口闪光、烟雾与弹壳）。默认可见；`reset()` 恢复可见。非布尔值抛 `TypeError`。 |
| `setSettings(partial)` | `(partial?) => Readonly<CombatSettings>` | 合并、校验并夹紧 `mouseSensitivity`、`adsSensitivityMultiplier`、`fov`。非法类型抛 `TypeError`；超范围数字夹到边界。返回冻结副本。 |
| `getSettings()` | `() => Readonly<CombatSettings>` | 返回战斗相关设置的冻结副本，字段见 §5。 |
| `load()` | `() => Promise<void>` | 异步预加载视图模型贴图。幂等：重复调用返回同一个 Promise；完成后立即 resolve。没有 `assets` 时记录一次提示并立即 resolve；加载失败记录错误并继续使用程序化材质。 |
| `dispose()` | `() => void` | 从相机取下并释放第一人称视图几何与材质。可重复调用。 |

## 3. `PlayerSnapshot`（精确字段）

```js
{
  x, y, z,             // 脚底位置；y = 0 为地面
  eyeHeight,           // 1.68
  yaw, pitch,          // 弧度；pitch 由服务限制在 ±1.55
  velocityX, velocityZ,
  health, maxHealth,
  alive                // boolean
}
```

通过 `src/models/contracts.js` 的 `createPlayerSnapshot` 构造，不附加内部状态（如 `grounded`、`regenTimer`、`recoilPitch`）。

## 4. `WeaponState`（精确字段）

```js
{
  ammo,             // 当前弹匣子弹数
  magazineSize,     // 30
  reloading,        // boolean
  reloadProgress,   // 0–1；未换弹时为 0
  aiming            // boolean
}
```

字段集合保持 v2 兼容；后坐力、震动、FOV 冲击与视图动画状态不对 Pipeline 暴露。

## 5. `CombatSettings`（精确字段）

```js
{
  mouseSensitivity: 1.0,          // 0.25 .. 3.0
  adsSensitivityMultiplier: 0.8,  // 0.4 .. 1.5
  fov: 75                         // 65 .. 95
}
```

- 最终鼠标视角灵敏度 = `GAME_CONFIG.weapon.lookSensitivity`（0.0022 弧度/像素）× `mouseSensitivity` ×（ADS 时再乘 `adsSensitivityMultiplier`）。
- 基础 FOV 取 `settings.fov`；ADS 时再乘 `GAME_CONFIG.weapon.ads.fovMultiplier`（0.72）。
- 每发 FOV 冲击叠加在最终 FOV 上，并按配置回收。
- 设置使用 Model 的 `normalizeSettings` / `clampSetting` 校验和夹紧；未提供的字段保持当前值。

## 6. 行为与数值

所有玩法数值取自 `GAME_CONFIG`，服务内不复制第二份：

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 玩家速度 / 冲刺 / 跳跃 / 重力 | 5.6 / ×1.55 / 6.2 / 20 | `game-config.js` `player` |
| 眼高 / 碰撞半径 | 1.68 / 0.45 | `game-config.js` `player` |
| 生命 / 恢复延迟 / 恢复速度 | 100 / 5 秒 / 8 每秒 | `game-config.js` `player` |
| 射击间隔 / 弹匣 / 换弹 | 0.095 秒 / 30 / 1.5 秒 | `game-config.js` `weapon` |
| 伤害 / 爆头倍率 | 26 / ×2 | `weapon.damage` / `enemies.headshotMultiplier` |
| 腰射散布 / 移动追加 | 0.012 / +0.006 弧度 | `game-config.js` `weapon` |
| 后坐力抬升 / 水平漂移 / 滚转 | 0.012 / 0.004 / 0.006 弧度 | `weapon.recoil` |
| 后坐力回正 / 最大俯仰 | 指数衰减，速率 8 / 0.16 弧度 | `weapon.recoil` |
| 镜头震动 | 振幅 0.0025 米，24 Hz，0.07 秒 | `weapon.cameraShake` |
| 每发 FOV 冲击 | +1.2°，回收 16°/秒；ADS ×0.6 | `weapon.fovPunch` |
| ADS FOV / 散布 / 后坐力 / 移速 | ×0.72 / ×0.35 / ×0.55 / ×0.6 | `game-config.js` `weapon.ads` |
| 命中扫描距离 | 120 米 | `weapon.range` |

鼠标灵敏度由设置驱动，基础值集中在 `game-config.js` 的 `weapon.lookSensitivity`。

第一人称视图的基础缩放来自 `game-config.js` 的 `weapon.viewModel.scale`（0.85）；v3 实机复核后视图层再乘 0.82，最终为 **0.697**，让武器与双手落在画面右下约 27% 宽度、40% 高度以内。腰射位置 `(0.27, -0.28, -0.58)`，ADS `(0, -0.095, -0.42)`，冲刺 `(0.34, -0.34, -0.5)`。这些是画面占比参数，来自 `game-config.js` 的 `weapon.viewModel`；视图层只做缩放复核修正。

## 7. 命中判定顺序

1. 从 `renderer.getWorldPosition(viewport.width / 2, viewport.height / 2)` 取屏幕中心射线。
2. 用两个 `Math.random()` 在散布圆锥内偏移方向（圆盘采样）。
3. `targetQuery.listHittable()` 取出 `object` 数组，调用 `renderer.raycast(origin, direction, 120, objects)`。
4. 同时用纯数学射线-AABB 检查 `colliders`，得到最近墙体命中。
5. 比较敌人命中与墙体命中的距离，取更近者：
   - 敌人对象 `userData.targetId` 为非空字符串：`userData.part === 'head'` 表示爆头；在调用 `applyDamage` 前把伤害乘以 `GAME_CONFIG.enemies.headshotMultiplier`（2），且只乘一次。
   - 非目标：发 `world:impact`。
   - 都没命中：弹道终点为 `origin + direction × 120`。
6. 命中敌人时调用一次 `targetQuery.applyDamage(targetId, damage)`，随后发命中标记与血雾；击杀时发 `enemy:killed`。
7. `applyDamage` 返回的 `headshot` / `critical` 只用于反馈与计分展示，不再参与伤害计算。

## 8. 事件

事件名全部来自 `EVENTS` 常量。战斗服务发出的事件：

| 事件 | 载荷 | 触发时机 | 消费方 |
| --- | --- | --- | --- |
| `EVENTS.WORLD_SHOT` (`world:shot`) | `{ from:{x,y,z}, to:{x,y,z}, muzzlePosition:{x,y,z}, color }` | 每次成功发射，先于命中结果事件 | 效果服务 |
| `EVENTS.WORLD_IMPACT` (`world:impact`) | `{ position:{x,y,z}, normal:{x,y,z}, color }` | 子弹命中墙体/箱子等非目标 | 效果服务 |
| `EVENTS.WORLD_BLOOD` (`world:blood`) | `{ position:{x,y,z}, direction:{x,y,z}, color }` | 子弹命中敌人（含击杀） | 效果服务 |
| `EVENTS.WEAPON_SHELL_EJECT` (`weapon:shell-eject`) | `{ position:{x,y,z}, velocity:{x,y,z} }` | 每次开火，弹壳从抛壳口抛出 | 效果/音频服务（经 Pipeline 映射） |
| `EVENTS.HUD_HITMARKER` (`hud:hitmarker`) | `{ killed:boolean, headshot:boolean }` | 命中带 `targetId` 的敌人 | 界面/音频 |
| `EVENTS.ENEMY_KILLED` (`enemy:killed`) | `{ enemyType, score, headshot, critical, position, color }` | `applyDamage` 返回 `killed:true`。`critical` 与 `headshot` 同义。**只有战斗服务发此事件** | Pipeline（计分）、界面击杀信息、效果 |
| `EVENTS.PLAYER_DIED` (`player:died`) | `{}` | 生命第一次归零，每次死亡只发一次 | Pipeline（结算）、界面/音频 |
| `EVENTS.WEAPON_RELOAD_START` (`weapon:reload-start`) | `{ durationSeconds: 1.5 }` | 手动或空仓自动开始换弹 | 界面/音频 |
| `EVENTS.WEAPON_RELOAD_END` (`weapon:reload-end`) | `{}` | 换弹完成、弹匣已满 | 界面/音频 |
| `EVENTS.WEAPON_EMPTY` (`weapon:empty`) | `{}` | 最后一发打空（每次打空一次） | 音频 |

`hud:damage` **不由战斗服务发出**。敌方服务发 `player:damage { amount, sourcePosition? }`，Pipeline 调用 `combat.damagePlayer(amount)`，然后由 Pipeline 统一发布一次 `hud:damage { amount, direction }`，避免重复的受伤闪烁。

一次开火的事件顺序：`weapon:reload-start` / `weapon:empty`（若本发打空）→ `weapon:shell-eject` → `world:shot` → `hud:hitmarker` → `world:blood` → `enemy:killed`（若击杀）；命中墙体时 `world:impact` 代替命中敌人事件。

## 9. 第一人称视图模型

`src/services/impl/combat/view-model.js` 程序化构建高细节 AR-15 风格步枪，并挂到相机下：

| 部件 | 几何/材质 |
| --- | --- |
| 上/下机匣、缓冲座 | 深灰金属（`#3A3D3F`，metalness 0.66，roughness 0.55，envMapIntensity 0.22） |
| 护木、握把、枪托、弹匣 | 深色暖调聚合物（`#262420`，metalness 0.02，roughness 0.88，envMapIntensity 0.03） |
| 枪管、枪口制退器 | 更暗的金属（metalness 0.72，roughness 0.46，envMapIntensity 0.2） |
| 顶部/侧面导轨、红点镜体、背带环 | 钢灰金属（metalness 0.6，roughness 0.52，envMapIntensity 0.2） |
| 棱角磨损条、制退器切口、弹匣底边 | 更亮的磨损金属（`#6A6E70`，envMapIntensity 0.18） |
| 红点镜片 | 半透明暗棕玻璃；中心一个很小的暗红点，不使用霓虹色 |
| 双手 | 手套（深灰织物）+ 卡其战术袖口与袖筒；右手握把、左手护木 |
| 木材 | 只保留握把两侧的小面积木纹装饰，不放在画面中心 |
| 枪口闪光、烟雾 | 暖色叠加球/锥 + 灰色半透明烟雾，默认隐藏 |
| 弹壳 | 黄铜色小圆柱，8 个对象池 |

材质使用偏暖的贴图色调（`VIEW_MODEL_TEXTURE_TINTS`），并压低 `envMapIntensity`，避免阴天蓝色 HDRI 把机匣/护木染成蓝紫色。**Fabric084 的颜色贴图本身是蓝色，Wood066 偏红**；因此手套/袖口/木材只使用它们的法线/粗糙度细节，颜色保留材质基色：手套 `#2B2E2A`、袖口 `#8A8268`、木材 `#3A3028`。护木/弹匣/握把/枪托始终使用聚合物 `#262420`，不套用钢/木颜色图。红点镜片为浅中性 `#B0AEA6`、`opacity: 0.12`、`depthWrite: false`。枪托整体前移，ADS 时托底不贴近相机近裁剪面。

红点镜是**开放隧道**而不是实心盒：`view-model-optic-frame` 由四面薄壁（`view-model-optic-wall-top/bottom/left/right`）围成，外宽 0.042、外高 0.045、长 0.075、壁厚 0.005，中心内宽 0.032、内高 0.035，前后贯通；前后金属环为 `view-model-optic-front-ring` / `view-model-optic-rear-ring`。镜片 `view-model-optic-glass` 在隧道前端，红点 `view-model-optic-red-dot` 为 `#FF2A1F`、`toneMapped: false`、`depthWrite: false`，位于镜片靠相机一侧的中心轴上。结构尺寸集中在导出的 `OPTIC_STRUCTURE`。

视图动画由纯状态对象驱动：待机呼吸、行走摆动、冲刺下压/倾斜、ADS 平滑过渡、射击后坐、换弹三阶段（弹匣下落/插入、拉机柄）、抛壳重力与寿命、枪口闪光与烟雾。双手与弹匣/拉机柄都是根节点的子组，因此跟随射击、冲刺与 ADS 变换。

屏幕空间回归：`view-model.test.js` 用透视相机投影可见网格包围盒，验证腰射只占右下约 27% 宽、40% 高，最小 X 不越过画面中心；ADS 红点镜水平居中、整体宽度不超过 20%，且腰射/ADS 都没有部件贴近/穿过近裁剪面。

贴图行为：

- 提供 `assets` 时，`load()` 读取素材清单的 `metal` / `steel` / `wood` / `fabric` 组，按颜色（sRGB）、法线、粗糙度、金属度（仅金属/钢）加载，并使用柔和色调。
- 未提供或加载失败时保留程序化材质；不读取 `resource/`、不导入 `providers/impl/`。
- 贴图由素材加载器缓存和释放；视图模型只引用，不重复 dispose 共享贴图。
- `dispose()` 释放自己创建的几何与材质，可重复调用。

## 10. 内部模块的实际导出

公共入口之外，这些函数供本角色测试与公共入口内部使用，不属于 Pipeline 契约：

- `src/services/impl/combat/collision.js`：`applySpreadToDirection`、`clamp`、`clampCircleToBounds`、`crossVector`、`isValidCollider`、`moveCircle`、`normalizeVector`、`rayAabbIntersection`、`raycastColliders`、`resolveCircleAabb`、`resolveCircleColliders`。
- `src/services/impl/combat/weapon.js`：`createWeaponState`、`getRecoilState`、`getReloadProgress`、`getShotDamage`、`getSpread`、`getWeaponViewState`、`resetWeaponState`、`startReload`、`updateWeapon`。
- `src/services/impl/combat/player.js`：`applyLook`、`createPlayerState`、`damagePlayerState`、`getCameraPose`、`getLookSensitivity`、`getPlayerSnapshot`、`healPlayerState`、`readSpawn`、`resetPlayerState`、`updatePlayer`、`updatePlayerRegen`。
- `src/services/impl/combat/view-model.js`：`MAX_SHELLS`、`MUZZLE_FLASH_DURATION`、`OPTIC_STRUCTURE`、`SMOKE_LIFETIME`、`VIEW_MODEL_MATERIALS`、`VIEW_MODEL_SCALE`、`VIEW_MODEL_TEXTURE_TINTS`、`createViewState`、`createViewModel`、`getMuzzleLocalPosition`、`getReloadAnimation`、`getReloadPhase`、`getViewTransform`、`resetViewState`、`triggerViewFire`、`updateViewState`。
- `src/services/abstract/combat.js`：无运行时导出，只有 JSDoc 类型与事件说明。

## 11. 错误处理

- 缺少 `renderer`、`targetQuery`、`emit`，或渲染器缺少必需方法：抛带字段名的 `TypeError`。
- `assets` 提供但缺少 `loadTexture` / `loadManifest`：抛 `TypeError`。
- `update` 的 `dt` 非有限或为负：`RangeError`。
- `damagePlayer`/`heal` 的数值非有限或不大于 0：`RangeError`。
- `setViewVisible` 的参数不是布尔值：`TypeError`。
- `setSettings` 的参数不是对象，或设置值类型非法：`TypeError`；数字超范围夹到边界。
- `listHittable`、`renderer.raycast`、`renderer.setCameraPose`、`targetQuery.applyDamage`、事件监听器、贴图加载抛错：捕获并 `console.error`，本帧继续，不静默吞掉。
- 无效碰撞体：构造时 `console.error` 并跳过，不阻断服务创建。

## 12. 测试证据

命令（项目根目录，2026-10-17，Node v24.11.1，Windows 11）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
```

实际结果：

```text
tests 65
pass 65
fail 0
cancelled 0
skipped 0
todo 0
```

其中 `collision.test.js` 17 项、`weapon.test.js` 32 项、`view-model.test.js` 16 项。

覆盖：圆-AABB 四向推出、盒角对角推出、盒内最短边、多障碍不穿透、撞墙滑动、边界夹紧、竖直过滤、射线-AABB、散布角上限；射击间隔、弹匣耗尽、自动/手动换弹、换弹进度、伤害与爆头倍率、移动/瞄准散布、垂直/水平/滚转后坐力、指数回正、ADS 削弱、镜头震动、FOV 冲击、玩家移动/冲刺/跳跃/恢复/死亡/复位、设置夹紧与鼠标/ADS/FOV 生效、`createCombat` 依赖校验、快照字段、爆头/身体/墙体事件、血雾、弹壳、更近墙体阻挡伤害、死亡单次事件且不直接发 `hud:damage`、reset/dispose 幂等、`setViewVisible`、`load` 幂等与贴图预加载；视图模型的材质分层与偏暖色调、织物/木材只用法线/粗糙度而不套蓝色/偏红颜色图、红点镜开放隧道（薄壁/中心留空/低不透明度镜片/高亮红点/ADS 距离与居中）、呼吸、行走/冲刺、ADS 插值、后坐回正、换弹阶段、弹壳寿命、枪口世界位置、双手跟随、腰射/ADS 屏幕空间范围与近裁剪面、reset 与 dispose。

公共入口导入冒烟（2026-10-17）：六个模块均可导入，退出码 0；`createCombat`、`createViewModel` 与纯函数导出可见；最终缩放 0.697。

构建：`npm run build` 成功（68 modules，Vite v8.3.4），无导入警告。

实际画面证据（`test/战斗服务/evidence/`）：

- `2026-10-17_view-model-visible.png`、`2026-10-17_view-model-hidden.png`：运行时隐藏/显示整个视图模型的对照，用于证明画面中的巨型暗色板块不是武器/双手；隐藏武器后板块仍在，属于环境几何。环境引擎已接手修复。
- `2026-10-17_view-model-hip-final.png`：腰射，敌人隐藏，武器与双手落在右下。
- `2026-10-17_view-model-ads-final.png`：ADS 取景，红点镜居中、世界在四周可见。自动化浏览器无法取得 pointer lock，因此该图是在暂停状态手动设置视图模型 ADS 状态并匹配 ADS FOV 后截取；屏幕空间测试另行验证同一取景。
- `evidence/ads-fix/ads-before.png`：修复前，镜片内是黑色实心块。
- `evidence/ads-fix/ads-after.png`：修复后，可透过开放镜框看到沙袋/天空，中心有高亮红点。
- `evidence/ads-fix/hip-after.png`：修复后的腰射回归截图。

## 13. 未验证与依赖

- **Electron 实际画面与手感尚未最终验收**：武器比例、PBR 贴图、双手位置、后坐力/滚转/FOV 冲击、换弹动画、抛壳与烟雾已做运行时取景检查，但仍需项目管理/美术在真实对局中确认。
- **真实 Pipeline/敌方服务联调尚未全部执行**：单元测试使用假渲染器与假目标查询，只证明契约行为；运行时已确认菜单/对局、武器隐藏与取景。
- **主装配**：当前 `src/main.js` 已把 `assets` 传给 `createCombat` 并 `await combat.load()`；该文件由界面装配角色维护，本角色不修改。
- **渲染 Provider 的 roll**：当前 `src/providers/impl/three-renderer.js` 已应用 `roll`；本服务同时提供 `shakeX`/`shakeY` 与带 FOV 冲击的视野。
- **画布尺寸**：渲染 Provider 公共契约没有读取宽高的方法，服务接受可选 `viewport`，缺省 1600 × 900。窗口缩放后若装配层不更新该值，屏幕中心射线可能偏离准星。
- 手感数值来自设计或实现默认值，尚未经过真实对局调参。
