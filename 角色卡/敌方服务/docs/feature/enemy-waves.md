---
id: enemy-waves
type: feature
title: 敌人与波次
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related:
  - initial-implementation-enemy-service
events:
  - date: "2026-10-17"
    kind: created
    summary: 建立功能文档；v2 机械敌人实现完成并通过 23 项单元测试
  - date: "2026-10-17"
    kind: changed
    summary: v3 改为三类人类士兵，新增 GLB/动画/装具/头身命中盒/尸体淡出，38 项单元测试通过
  - date: "2026-10-17"
    kind: fixed
    summary: 修复骨骼装具继承 CharacterArmature 100 倍缩放导致的巨型面罩；Electron 截图确认人体尺度
---

# 敌人与波次

玩家开始一局后，会在训练场里遭遇一波一波的人类士兵：保持距离、侧向移动并短点射的**步枪兵**，体型更大、走得慢、三连发的**重机枪手**，以及快速冲上来挥拳的**突击兵**。玩家射击可以打身体，也可以打头造成 2 倍伤害（由战斗服务乘算）。敌人死亡会播放倒地动画、留下 4 秒后淡出的尸体，并可能掉下回血生命球。

**现在的状态：** 玩法与视觉代码已经写进敌方服务，并通过 38 项 Node 单元测试。环境 Provider 已提供 `loadGltf` / `AnimationMixer` / `cloneSkinned`；Electron 中已实际生成 6 个步枪兵并截图确认人类模型与装具为人体尺度、没有覆盖屏幕的巨型面板。走/跑/射击/受击/死亡动画的完整观感、尸体淡出、30 敌人性能与跨角色事件顺序仍未完整验收。

## 玩家会看到什么（接入 Pipeline 后）

1. 每一波从竞技场边缘生成人类士兵，间隔约 0.55 秒一个；第 1 波只有步枪兵，第 2 波开始有重机枪手，第 3 波开始有突击兵。
2. 步枪兵保持 9–16 米并侧向移动，每轮打三发、每发 7 伤害，然后短暂换弹。
3. 重机枪手保持 6–10 米缓慢逼近，每轮三发、每发 11 伤害；模型放大 1.12，带肩甲、胸板与腿板。
4. 突击兵直接冲向玩家，挥拳造成 14 伤害，冷却 1.2 秒；他不持长枪。
5. 敌人始终面向玩家；移动时播放走/跑，开火时播放 `Run_Shoot` 或 `Gun_Shoot`；动画切换有 0.15–0.2 秒交叉淡入淡出，不瞬切。
6. 敌人被击中时身体短暂闪白；Adventurer/Woman 播放 `HitRecieve`，Man 基础模型没有受击片段，只闪白。
7. 爆头返回 `headshot: true`；伤害倍率由战斗服务在调用前乘算一次。
8. 敌人死亡立即移出可命中列表，播放 `Death`，尸体保留 4 秒并在最后 1 秒淡出；命中与死亡产生血雾（没有机械爆炸）。
9. 18% 概率掉落生命球；生命球漂浮 25 秒，玩家靠近后恢复 30 生命（由 Pipeline/战斗服务实际加血）。
10. 敌人生命、速度和伤害随波次提高，分别最多 3 倍、+25% 和 2 倍。

## 当前流程

```mermaid
flowchart TD
  A[Pipeline 调用 load()] --> B{素材加载器有 loadGltf?}
  B -->|否| B1[记录错误 URL/依赖<br>使用程序化人类回退]
  B -->|是| B2[读取 manifest.models.humans<br>预加载 4 个 GLB]
  B2 --> B3{单个模型成功?}
  B3 -->|否| B4[记录具体 URL 与错误<br>该模型回退]
  B3 -->|是| B5[缓存 scene/animations/scale]
  B1 --> C
  B5 --> C[Pipeline 调用 startWave n]
  C --> D[按 GAME_CONFIG 计算数量、类型占比与缩放]
  D --> E[生成队列：类型序列 + 0.55 秒间隔]
  E --> F[update dt 玩家快照]
  F --> G{队列还有敌人且间隔到?}
  G -->|是| H[getSpawnPoint 取边缘合法点]
  H --> I[按 modelPool 选择模型<br>createHumanVisual 克隆骨骼/建装具/命中盒]
  I --> J[登记 head 与 body 两个 targetId]
  J --> K[发出 world:enemy-spawn]
  K --> G
  G -->|否| L[推进每个敌人 AI]
  L --> M{类型}
  M -->|步枪兵| N[保持 9-16 米 / 侧移 / 三发点射]
  M -->|重机枪手| O[保持 6-10 米 / 缓慢逼近 / 三连发]
  M -->|突击兵| P[冲向玩家 / 近战 1.2 秒冷却]
  N --> Q[点射后换弹：压低枪口/头部/停止射击]
  O --> Q
  P --> R[障碍物滑动与竞技场边界]
  Q --> R
  R --> S[动画状态机：idle/walk/run/runShoot/shoot]
  S --> T[弹丸扫掠移动与碰撞]
  T --> U{命中玩家?}
  U -->|是| V[发出 player:damage + sourcePosition<br>移除弹丸]
  U -->|否，撞地/障碍/出界/超时| W[移除弹丸]
  V --> X[尸体计时与拾取物]
  W --> X
  X --> Y{队列空且存活为 0?}
  Y -->|是| Z[getState.waveComplete = true]
  Y -->|否| F

  AA[战斗服务射线命中命中盒] --> AB[applyDamage targetId damage]
  AB --> AC{part 是 head?}
  AC -->|是| AD[headshot = true / critical = true]
  AC -->|否| AE[headshot = false]
  AD --> AF[扣血，播放 HitRecieve 或闪白]
  AE --> AF
  AF --> AG[发出 world:blood]
  AG --> AH{生命归 0?}
  AH -->|否| AI[返回 hit true / killed false / score 0]
  AH -->|是| AJ[立即移除 head/body 命中盒]
  AJ --> AK[播放 Death，加入尸体列表]
  AK --> AL{18% 掉落?}
  AL -->|是| AM[生成生命球并发出 pickup:spawn]
  AL -->|否| AN[4 秒后淡出并释放]
  AM --> AN
  AN --> AO[返回 killed true / score / enemyType / headshot]
```

## 分步说明

### 1. 波次组成

- 数量、类型占比、生成间隔和缩放全部由 `src/models/game-config.js` 的 `GAME_CONFIG` 与已有纯函数决定；敌方服务不复制数值。
- `waves.js` 的 `composeWave(wave, random)` 为每个敌人独立抽取类型；`createWavePlan()` 汇总类型序列、数量、间隔与缩放。
- 类型占比：第 1 波步枪兵 100%；第 2 波 80/20/0；第 3 波起 55/20/25（步枪兵/重机枪手/突击兵）。

### 2. 生成敌人

- 每个敌人生成时调用竞技场提供的 `getSpawnPoint({ playerPosition, minDistance: 10 })`；返回点必须是有效三维坐标。查询失败会 `console.error` 并暂停本帧生成，队列保留到下一次 update。
- 按 `GAME_CONFIG.enemies[type].modelPool` 选择模型：步枪兵在 Adventurer / Woman Casual / Woman Formal 之间随机，重机枪手固定 Adventurer，突击兵固定 Man base。
- 生成后发出 `world:enemy-spawn { position, color }`。
- `startWave(n)` 会替换待生成队列，但不会清除已经存在的敌人。

### 3. 模型、装具与动画

- 模型缩放逐模型应用：Adventurer 0.985、Woman Casual 0.995、Woman Formal 1.000、Man base 0.373；重机枪手再乘 1.12。
- 四个模型前向都是 `+Z`，没有根运动；敌人根节点的 yaw 始终由“面向玩家”的 `atan2(dx, dz)` 决定。
- 动画按完整名后缀匹配：
  - Adventurer/Woman：`CharacterArmature|Idle_Gun`、`Walk`、`Run`、`Run_Shoot`、`Gun_Shoot`、`HitRecieve`、`Death`。
  - Man base：`HumanArmature|Man_Idle`、`Man_Standing`、`Man_Walk`、`Man_Run`、`Man_Punch`、`Man_Death`。
- 缺失回退：Man 的 idle 用 `Man_Idle` 或 `Man_Standing`；受击只闪白；射击/移动射击没有片段时退回跑/待机；近战用 `Man_Punch`；死亡用 `Man_Death`。
- 状态切换用 `AnimationMixer` 交叉淡入淡出 0.15–0.2 秒；`mixer.timeScale` 按移动速度调整（0.75–1.35），减少滑步。
- 装具：头盔、帽檐、面罩、背心、弹匣袋、侧袋、护膝、手套、靴子与程序化步枪；重机枪手额外肩甲、胸板、腿板；突击兵去掉长枪与弹匣袋，增加护腕。装具挂在 `Head` / `Hips` / 四肢骨骼或根节点。
- **骨骼缩放修正**：Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约 98.5 倍。挂骨骼前用 `getWorldScale` 测量骨骼真实世界缩放，并以逐轴倒数设置装具 `scale` 与局部偏移，使装具按米计算；否则面罩会变成覆盖屏幕的巨大面板。步枪挂在敌人根节点（不继承骨骼缩放），每帧跟随右手 `WristR`，保持人体尺度并跟随手部动画。
- **骨骼名兼容**：GLTFLoader 会去掉骨骼名里的点（`UpperArmL`、`WristR`、`LowerLegL`、`FootL`）。查找候选名同时覆盖 `UpperArm.L` 与 `UpperArmL` 两种写法，并按优先级选择手部骨骼。

### 4. 敌人行为

- 所有敌人都只读取玩家快照，不修改玩家生命；伤害通过 `player:damage` 事件交给 Pipeline。
- 步枪兵在射程带内（9–16 米）侧向移动；太远靠近、太近后退。重机枪手在 6–10 米内缓慢逼近并侧移。突击兵直线冲向玩家。
- 步枪兵/重机枪手按 `burstShots`、`burstInterval` 打三发，按 `fireInterval` 间隔重复；每轮点射后换弹停顿（1.2 / 1.6 秒），期间停止射击并压低枪口。
- 瞄准点是玩家脚底上方 60% 眼高处；弹丸从程序化步枪枪口发出，并发出 `world:enemy-shot` 与短暂枪口闪光。
- 突击兵接近到接触半径后造成近战伤害，冷却 1.2 秒，播放 `Man_Punch`。
- 移动使用私有的“轴分离滑动”辅助函数：先尝试 X 轴，再尝试 Z 轴，被障碍物挡住的轴取消位移；最后限制在 60 × 60 米竞技场内。

### 5. 命中与死亡

- `getTargetQuery().listHittable()` 返回 `[{ object, targetId }]`；`object` 是不可见命中盒，`userData` 含 `targetId` 与 `part`（`head` / `body`）。战斗服务按 `entry.object` 做射线检测。
- 头部命中返回 `headshot: true`，`critical` 作为兼容旧名称取相同值；**伤害倍数由战斗服务在调用前乘算一次**，敌方服务不重复加倍。
- 生命扣到 0 后保持为 0；敌人立即移出可命中列表，播放 `Death`，进入尸体列表。尸体保留 4 秒，最后 1 秒降低材质不透明度后移除并释放。
- 每次命中和死亡都会发出 `world:blood { position, direction, color }`；不再发出 `world:explosion`。
- 敌方服务**不发出** `enemy:killed`、`hud:killfeed` 或任何得分事件；这些由 Pipeline 处理。

### 6. 生命球

- 18% 概率掉落（`GAME_CONFIG.arena.pickupDropChance`），恢复 30（`pickupHealAmount`），寿命 25 秒（`pickupLifetime`），拾取半径 0.8 米（`pickupRadius`）。
- 生命球落到竞技场地面（y = 0），保留死亡位置的 X/Z；`pickup:spawn` 的位置也是这个地面投影点。
- 玩家进入范围时发出 `pickup:collected { position, amount }`；实际加血由 Pipeline 转交战斗服务。

### 7. 重置与释放

- `reset()` 清空存活敌人、尸体、弹丸、拾取物、目标登记、生成队列、计时器和波次状态；每个敌人实例的装具/命中盒几何体与材质、动画混合器都会被释放，模型模板缓存保留。
- `dispose()` 先执行 `reset()`，再释放模型模板缓存并标记服务已释放；之后 `update()` 安全返回。

## 失败时会怎样

| 情况 | 结果 |
| --- | --- |
| `createEnemies()` 缺少 renderer / getSpawnPoint / emit | 抛出带字段名的 `TypeError`。 |
| `colliders` 不是数组 | 抛出 `TypeError`。 |
| `assets` 不是对象或 `loadGltf` 不是函数 | 抛出 `TypeError`。 |
| 没有提供 `assets` 或缺少 `loadGltf` | `load()` 记录明确错误；使用程序化人类士兵回退，不中断对局。 |
| 单个 GLB 加载失败 | 记录具体 URL 与错误；该模型回退，其余模型继续。 |
| `startWave()` 波次不是 ≥1 的整数 | 抛出 `TypeError`。 |
| `update()` 的 dt 非法 | 抛出 `TypeError`。 |
| `update()` 缺少玩家快照或 x/y/z 非有限数字 | 抛出 `TypeError`。 |
| `getSpawnPoint()` 抛错或返回非法点 | `console.error` 记录原因，本帧暂停生成，队列保留。 |
| `applyDamage()` 的 targetId 未知或目标已死 | 返回 `hit: false`，不抛错。 |
| `applyDamage()` 的 damage 非有限数字 | 抛出 `TypeError`。 |
| 环境门面缺少 `AnimationMixer` / `cloneSkinned` | 记录一次明确错误；模型静态或回退，不影响 AI 与命中。 |

## 当前验证

在项目根目录运行：

```sh
node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js
```

2026-10-17 实际结果：**38 项测试，38 pass / 0 fail**（耗时约 140 ms，Node v24.11.1，Windows 11）。

覆盖：波次数量、三类兵种占比边界、缩放与上限、生成间隔、生成点失败、`waveComplete`、头/身命中盒、爆头与击杀、生命下限、死亡立即移除与 4 秒尸体淡出、`world:blood`、掉落与拾取、弹丸扫掠碰撞与寿命、步枪兵点射、重机枪手三连发、突击兵近战冷却、`reset()` 清理尸体、`dispose()`、四个 GLB 映射与缩放、动画名映射与 Man 回退、装具与骨骼挂载、**100 倍 armature 下的装具世界尺度/骨骼跟随/步枪跟随右手**、模型加载失败日志、dispose 幂等、旧机械类型移除。

模块导入冒烟：8 个模块全部导入成功；公共入口只导出 `createEnemies`。

构建与实机：

```sh
npm run build
# 2026-10-17 → vite 构建成功，68 modules，dist/assets/index-C3760wmi.js
```

Electron 实机截图：`test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`。6 个步枪兵生成，玩家生命 79→65（敌人确实在射击）；画面中人类士兵与装具为人体尺度，没有覆盖屏幕的巨型面板。真实 GLB 探针：装具世界缩放 1.00（重机枪手步枪 1.12），最大装具包围盒 0.59 m，面罩 0.17×0.11×0.11 m，步枪挂点距 `WristR` 约 0.036 m。

**尚未验证：**

- Electron 中人类士兵的走/跑/射击/受击/死亡动画完整观感、装具逐帧贴合、朝向、脚底贴地、枪口闪光与尸体淡出仍需逐项截图/录屏确认。
- 与竞技场真实 `getSpawnPoint()`、障碍物碰撞盒、Pipeline、战斗服务、效果/音频 Service 的完整事件顺序联调。
- 30 个人类士兵（含装具与命中盒）时的帧率与连续重开后的内存表现。
- 战斗服务尚未改为读取 `part === 'head'`；Pipeline 尚未映射 `world:blood`。

## 历史记录

| 日期 | 类型 | 状态 | 变化 | 文档 |
| --- | --- | --- | --- | --- |
| 2026-10-17 | 变更 | 已实现，未在 Electron 视觉验收 | 建立波次、三类敌人、敌方弹丸、生命拾取物与命中目标登记（v2 机械敌人） | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
| 2026-10-17 | 变更 | 已实现，未在 Electron 视觉验收 | v3 改为人类士兵：四个 GLB、动画与装具、头/身命中盒与爆头、死亡尸体淡出、血雾 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
| 2026-10-17 | 修复 | 已修复并在 Electron 确认无巨型面板 | 骨骼装具继承 CharacterArmature 100 倍缩放导致面罩覆盖屏幕；改为按骨骼世界缩放抵消，步枪跟随右手 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
