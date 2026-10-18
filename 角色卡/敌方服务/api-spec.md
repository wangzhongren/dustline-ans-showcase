# 接口说明：敌方服务（v3：人类士兵）

这份文档写给要接入敌方服务的 Pipeline 与（只读参考的）战斗服务。先说现状：**敌方服务已按 v3 设计改为三类人类士兵，实现完成并通过 38 项单元测试；环境 Provider 已提供 `loadGltf` / `cloneSkinned` / `AnimationMixer`，Electron 中已实际看到人类士兵与装具为人体尺度、没有巨型面板。** GLB 骨骼动画、尸体淡出、30 敌人帧率与跨角色联调仍未完整验收；加载失败时仍会记录错误并使用程序化人类士兵回退。

## 怎样导入

项目源码按 ES 模块编写。Pipeline 只能导入公共入口：

```js
import { createEnemies } from './src/services/public/enemies.js';
```

不要导入 `src/services/impl/enemies/` 下的文件。敌方服务只导入共享 Model 与 `src/providers/public/three.js`，不导入其他 Service、Pipeline、Interface 或 `providers/impl/`。

## 实际导出

| 文件 | 导出 | 说明 |
| --- | --- | --- |
| `src/services/public/enemies.js` | `createEnemies(options)` | 唯一公共工厂。 |
| `src/services/abstract/enemies.js` | 无运行时导出 | 只有 JSDoc 契约，导入无副作用。 |
| `src/services/impl/enemies/waves.js` | `pickEnemyType`、`composeWave`、`createWavePlan`、`createEnemyStats`、`shouldDropPickup` | 纯函数，供测试与内部使用。 |
| `src/services/impl/enemies/enemy.js` | `createEnemy`、`disposeObject3D` | 单个敌人的 AI、生命、受击与死亡。 |
| `src/services/impl/enemies/human-visual.js` | `HUMAN_MODEL_IDS`、`HUMAN_MODEL_DEFINITIONS`、`HEAVY_SCALE_MULTIPLIER`、`CORPSE_LIFETIME`、`CORPSE_FADE_DURATION`、`resolveAnimationClipMap`、`loadHumanModelCache`、`disposeHumanModelCache`、`createHumanVisual`、`getModelDefinition`、`disposeObject3D` | GLB 加载、动画映射、装具与命中盒。 |
| `src/services/impl/enemies/projectile.js` | `createProjectile`、`PROJECTILE_STATUS`、`ENEMY_TRACER_COLOR` | 敌方弹丸移动、扫掠碰撞与寿命。 |
| `src/services/impl/enemies/pickup.js` | `createPickup`、`PICKUP_STATUS` | 生命球外观、漂浮、拾取与寿命。 |
| `src/services/impl/enemies/enemy-manager.js` | `createEnemiesManager` | 内部编排。 |

## 冻结签名

```js
createEnemies({ renderer, colliders, getSpawnPoint, emit, assets? })
  -> {
       load(),                 // async，幂等
       reset(),
       startWave(n),
       update(dt, playerSnapshot),
       getTargetQuery(),
       getState(),
       dispose()
     }
```

### 参数

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `renderer` | 是 | 渲染器公共入口返回值；至少提供 `add(object)` 与 `remove(object)`。缺失或缺少方法时抛 `TypeError`。 |
| `colliders` | 否 | `Collider[]`，轴对齐盒 `{ min:{x,y,z}, max:{x,y,z} }`；省略时按空数组处理，非数组抛 `TypeError`。只读消费。 |
| `getSpawnPoint` | 是 | `({ playerPosition:{x,y,z}, minDistance:number }) => { x, y, z }`。返回竞技场内、障碍外、距玩家至少 `minDistance` 米的点。缺失抛 `TypeError`。 |
| `emit` | 是 | `(name, payload) => void`，由 Pipeline 绑定到共享事件总线。缺失抛 `TypeError`。 |
| `assets` | 否 | 素材 Provider 公共入口，需要 `loadGltf(url) -> { scene, animations }`；可选 `loadManifest()`。提供时预加载四个 GLB。缺失或加载失败时记录错误并回退。 |

### 返回方法

| 方法 | 行为 |
| --- | --- |
| `load()` | 异步预加载 `adventurer`、`woman-casual`、`woman-formal`、`man-base` 四个 GLB。幂等：重复调用返回同一个 Promise。任何模型失败只记录具体 URL 与错误并使用回退，不会 reject。Pipeline 应在对局开始前 `await enemies.load()`。 |
| `reset()` | 清空存活敌人、尸体、弹丸、拾取物、目标登记、生成队列、计时器与波次状态；释放实例几何体与材质。可重复调用。模型模板缓存保留，供重开继续使用。 |
| `startWave(n)` | 开始第 n 波；替换待生成队列，**不**清除已有敌人。n 必须是 ≥1 的整数，否则抛 `TypeError`。 |
| `update(dt, playerSnapshot)` | 推进生成、AI、弹丸、尸体淡出与拾取物。`dt` 必须是非负有限数字，`playerSnapshot` 必须含有限数字 `x/y/z`，否则抛 `TypeError`。`dt === 0` 时不推进。 |
| `getTargetQuery()` | 返回命中的目标查询对象（见下）。 |
| `getState()` | 返回 `{ wave, alive, pendingSpawns, totalInWave, spawned, waveComplete, types }`。`alive` 只统计存活敌人，不含尸体；`types` 按 `rifleman` / `heavy` / `breacher` 统计存活数量。 |
| `dispose()` | 执行 `reset()`、释放模型模板缓存并标记服务已释放；之后 `update()` 安全返回。 |

### 玩家快照

敌方服务只读取：

```js
{
  x, y, z,          // 脚底位置（米）
  eyeHeight,        // 眼睛高度；缺省时使用 GAME_CONFIG.player.eyeHeight（1.68）
  alive             // 缺省 true
}
```

`yaw`、`pitch`、`velocityX/Z`、`health` 等字段不会被修改，也不会被使用。

## 命中目标查询与爆头

```js
const query = enemies.getTargetQuery();

query.listHittable()
// -> [{ object, targetId }]；object 是命中盒网格，网格.userData 至少包含：
//    { targetId: string, part: 'head' | 'body' }
//    entry.targetId 与 entry.object.userData.targetId 相同。

query.applyDamage(targetId, damage)
// -> {
//      hit: boolean,        // 是否命中有效存活目标
//      killed: boolean,     // 本次伤害是否击杀
//      headshot: boolean,   // 命中的网格 part 是否为 'head'
//      critical: boolean,   // 兼容旧名称，与 headshot 同义
//      position: { x, y, z }, // 敌人脚底世界位置
//      color: number,       // 敌人效果颜色（0xRRGGBB）
//      score: number,       // 击杀得分；未击杀为 0
//      enemyType: string    // 'rifleman' | 'heavy' | 'breacher'
//    }
```

- 每个存活敌人有两个不可见命中盒：头部 `enemy-<n>:head` 与身体 `enemy-<n>:body`。头盒中心约 1.62 m、0.28 m 见方；身体盒中心约 0.98 m、0.62 × 1.12 × 0.38 m；重机枪手再乘 1.12。命中盒固定挂在敌人根节点，不对骨骼网格逐三角检测。
- **爆头只由战斗服务加倍一次。** 战斗服务在调用 `applyDamage` 前按 `GAME_CONFIG.weapon.criticalMultiplier`（2 倍）乘算；敌方服务的 `headshot` / `critical` 只用于反馈、计分展示与 HUD。
- 未知或已死亡目标返回 `hit: false`，不会抛错。
- `damage` 必须是非负有限数字；负数按 0 处理，非数字抛 `TypeError`。
- 敌人死亡后两个命中盒立即从 `listHittable()` 消失；尸体继续播放死亡动画 4 秒，最后 1 秒淡出，随后释放。
- 敌方服务不发出 `enemy:killed`、`hud:killfeed` 或得分事件；由 Pipeline 根据返回值处理。

## 发出的事件

事件名一律取自 `src/models/events.js` 的 `EVENTS`。

| 事件 | 何时 | 载荷 |
| --- | --- | --- |
| `world:enemy-spawn` | 每个敌人生成成功 | `{ position:{x,y,z}, color:number }` |
| `world:enemy-shot` | 步枪兵/重机枪手每发点射 | `{ position:{x,y,z}, direction:{x,y,z}, color:number, enemyType:string }` |
| `world:blood` | 命中敌人与敌人死亡 | `{ position:{x,y,z}, direction:{x,y,z}, color:number }`，替代 v2 的机械爆炸 |
| `pickup:spawn` | 掉落生命球 | `{ position:{x,y,z}, amount:number }`，`amount` 为 30 |
| `pickup:collected` | 玩家进入拾取范围 | `{ position:{x,y,z}, amount:number }` |
| `player:damage` | 敌方弹丸命中玩家或突击兵近战命中 | `{ amount:number, sourcePosition:{x,y,z} }`，已按波次缩放；`sourcePosition` 供 HUD 方向指示 |

不发出：`world:explosion`、`enemy:killed`、`hud:*`、`wave:start`、`wave:cleared`、`sound:*`。

## 人类士兵行为

| 类型 | 生命 | 速度 | 行为 | 攻击 | 分值 |
| --- | --- | --- | --- | --- | --- |
| 步枪兵 `rifleman` | 70 | 5.0 | 保持 9–16 米，侧向移动，三发点射 | 7 伤害，弹速 34 | 100 |
| 重机枪手 `heavy` | 200 | 2.8 | 保持 6–10 米，缓慢逼近，三发点射 | 11 伤害，弹速 30 | 300 |
| 突击兵 `breacher` | 85 | 7.2 | 快速贴身 | 近战 14 伤害，1.2 秒冷却 | 150 |

- 所有敌人始终面向玩家（模型前向 +Z，`root.rotation.y = atan2(dx, dz)`），位移由 AI 控制；模型无根运动。
- 步枪兵/重机枪手每轮点射后进入换弹停顿：停止射击，步枪下压、头部微低（约 1.2 / 1.6 秒），随后恢复。
- 重机枪手模型在清单缩放（0.985）之上再乘 1.12，并增加肩甲、胸板与腿板。
- 突击兵使用 Man 基础模型，不持长枪，攻击播放 `Man_Punch`。

## 波次与数值来源

全部来自 `GAME_CONFIG` 与 `src/models/game-config.js` 的纯函数：

- 数量：`getWaveEnemyCount(n)`（第 1 波 6、第 5 波 13、第 10 波 22、32 上限）。
- 生成间隔：`waves.spawnInterval`（0.55 秒）；波次间隔 4.5 秒由 Pipeline 负责。
- 类型占比：`getEnemyTypeShares(n)`；第 1 波步枪兵 100%；第 2 波 80/20/0；第 3 波起 55/20/25（步枪兵/重机枪手/突击兵）。
- 缩放：`getEnemyScaling(n)`；生命 +10%/波（上限 3 倍）、速度 +2%/波（上限 +25%）、伤害 +5%/波（上限 2 倍）。
- 敌人基础值、保持距离、伤害、分值、颜色、弹丸速度、点射发数/间隔、射击间隔、接触冷却均来自 `GAME_CONFIG.enemies`。
- 掉落概率 18%、恢复 30、寿命 25 秒、拾取半径 0.8 米、玩家半径 0.45 均来自 `GAME_CONFIG`。
- 设计未单列的实现默认值集中在 `enemy.js` 的 `ENEMY_BEHAVIOR` / `COLLISION` 与 `human-visual.js` 的 `ANIMATION_BEHAVIOR`：换弹时长、侧移切换、首次开火延迟、碰撞半径、交叉淡入淡出、尸体淡出、装具尺寸等。

## 模型与动画映射（来自美术验证）

| 模型 | CLI 标识 | 清单缩放 | 动画家族 |
| --- | --- | --- | --- |
| Quaternius Adventurer | `adventurer` | 0.985 | `CharacterArmature|*` |
| Animated Woman Casual | `woman-casual` | 0.995 | `CharacterArmature|*` |
| Animated Woman Formal | `woman-formal` | 1.000 | `CharacterArmature|*` |
| Man（基础人类） | `man-base` | 0.373 | `HumanArmature|*` |

| 状态 | Adventurer / Woman | Man 缺失时 |
| --- | --- | --- |
| idle | `Idle_Gun` | `Man_Idle` → `Man_Standing` |
| walk | `Walk` | `Man_Walk` → `Man_Idle` |
| run | `Run` | `Man_Run` → `Man_Walk` |
| runShoot | `Run_Shoot` | 无片段 → 退回 `run` |
| shoot | `Gun_Shoot` | 无片段 → 退回 `idle` |
| hit | `HitRecieve` | 无片段 → 只闪白 |
| attack | `Punch_Right/Left` | `Man_Punch` |
| death | `Death` | `Man_Death` |

- 片段按 `|` 后的后缀匹配完整名；缺失时按上表回退，绝不瞬切：状态切换使用 `AnimationMixer` 交叉淡入淡出 0.15–0.2 秒。
- `mixer.timeScale` 按移动速度/片段参考速度调整（0.75–1.35），减少滑步。
- 装具（头盔、面罩、背心、弹匣袋、护膝、手套、靴子、重甲、程序化步枪）挂在 `Head` / `Hips` / 四肢骨骼或根节点；模型没有内嵌贴图，装具全部程序化。

## 环境 Provider 依赖与骨骼缩放修复

环境 Provider 已按 V3-2 冻结契约提供：

- `src/providers/public/three.js`：`AnimationMixer` 与 `cloneSkinned`（SkeletonUtils clone）。
- 素材加载器：`loadGltf(url) -> { scene, animations }`；`loadModel` 仍返回 scene。

**已修复的关键视觉问题（2026-10-17）：** 真实 Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约为 98.5 倍。最初装具只抵消了模型清单缩放（0.985），没有抵消骨骼的 100 倍，导致面罩等装具变成覆盖屏幕的巨大深色面板。现在挂骨骼前用 `getWorldScale` 测量骨骼真实世界缩放，并以逐轴倒数设置装具 `scale` 与局部偏移，使装具与偏移按米计算；步枪挂在敌人根节点（不继承骨骼缩放），每帧把挂点移到右手 `WristR` 的世界位置，保持人体尺度并跟随手部动画。GLTFLoader 会把骨骼名中的点去掉（`UpperArmL`、`WristR`），查找候选名已同时覆盖两种写法。

真实 GLB 探针结果（Adventurer / Woman Casual / Woman Formal / Man base）：全部装具世界缩放 1.00（重机枪手步枪 1.12），最大装具包围盒 0.59 m（背心），面罩 0.17 × 0.11 × 0.11 m；步枪挂点距 `WristR` 约 0.036 m。Electron 实机截图见 `test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`，6 个步枪兵生成、玩家受伤 79→65，画面中没有巨型面板。

## 验证命令与结果

```sh
node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js
```

2026-10-17 实际结果（Node v24.11.1，Windows 11）：

```text
ℹ tests 38
ℹ pass 38
ℹ fail 0
ℹ duration_ms ~140
```

覆盖范围：波次数量与上限、三类兵种占比边界、缩放倍数与上限、生成数量与 0.55 秒间隔、生成点失败后的队列保留、`startWave` 保留旧敌人、头/身命中盒形状、爆头标记、击杀分值、生命下限、死亡立即移出命中列表、4 秒尸体淡出、`world:blood`、掉落与拾取、弹丸扫掠碰撞与寿命、步枪兵点射、重机枪手三连发、突击兵近战冷却、`reset()` 清理尸体、`dispose()`、GLB 映射与缩放、动画名映射与 Man 回退、装具与骨骼挂载、**装具在 100 倍 armature 下的世界尺度与骨骼跟随、步枪跟随右手**、模型加载失败日志、dispose 幂等、旧机械类型彻底移除。

其他验证：

```sh
npm run build
# 2026-10-17 → vite 构建成功，68 modules，dist/assets/index-C3760wmi.js
```

Electron 实机截图（真实 GLB、6 个步枪兵、无巨型面板）：`test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`。

模块导入冒烟实际输出：

```text
public.enemies: createEnemies
abstract.enemies: (none)
manager: createEnemiesManager
enemy: createEnemy,disposeObject3D
human-visual: CORPSE_FADE_DURATION,CORPSE_LIFETIME,HEAVY_SCALE_MULTIPLIER,HUMAN_MODEL_DEFINITIONS,HUMAN_MODEL_IDS,createHumanVisual,disposeHumanModelCache,disposeObject3D,getModelDefinition,loadHumanModelCache,resolveAnimationClipMap
waves: composeWave,createEnemyStats,createWavePlan,pickEnemyType,shouldDropPickup
projectile: ENEMY_TRACER_COLOR,PROJECTILE_STATUS,createProjectile
pickup: PICKUP_STATUS,createPickup
```

## 跨角色注意事项

- **战斗服务**：v2 用 `userData.part === 'core'` 判断暴击；v3 命中部位是 `part === 'head'`。战斗服务需按 v3 设计改为读取 `part === 'head'` 并在调用前乘算 2 倍伤害。敌方服务不再返回 `core`。
- **Pipeline**：原 `world:explosion` 映射需改为 `world:blood`；`player:damage` 现在带 `sourcePosition`；`enemy:killed` 的 `headshot` 由战斗服务根据结果补充。HUD 击杀信息应显示“步枪兵 / 重机枪手 / 突击兵”。
- **环境引擎**：已提供 `loadGltf`、`AnimationMixer`、`cloneSkinned`；敌方服务按冻结契约消费，无需修改环境文件。若后续更换模型，仍需重新核对骨骼名与 100 倍 armature 缩放。

## 尚未验证

- Electron 中已确认人类士兵与装具为人体尺度、没有巨型面板；但走/跑/射击/受击/死亡动画的完整观感、装具逐帧贴合、脚底贴地与滑步仍需逐项截图/录屏确认。
- 与真实竞技场 `getSpawnPoint()`、碰撞盒、Pipeline、战斗服务、效果/音频 Service 的完整事件联调。
- 30 个人类士兵（每个含装具与命中盒）时的帧率与连续重开后的内存曲线。
- 模型头部/手部骨骼的装具与步枪局部偏移已按真实 GLB 探针校准到人体尺度；仍建议在近距离截图复核握枪姿态。
