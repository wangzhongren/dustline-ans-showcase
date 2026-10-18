---
id: initial-implementation-enemy-service
type: change
title: 敌方服务实施与 v3 人类士兵升级
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related:
  - enemy-waves
events:
  - date: "2026-10-17"
    kind: created
    summary: 写入敌方服务全部实现与 23 项单元测试并通过；Electron 视觉验收未执行
  - date: "2026-10-17"
    kind: changed
    summary: v3 改为三类人类士兵；新增 human-visual.js 与 13 项视觉测试，总计 38 项通过
  - date: "2026-10-17"
    kind: fixed
    summary: 修复骨骼装具继承 CharacterArmature 100 倍缩放导致的巨型面罩；真实 GLB 探针、Electron 截图与构建通过
---

# 敌方服务实施与 v3 人类士兵升级

## v3 更新（2026-10-17）

### 改在哪里

| 位置 | 改动 |
| --- | --- |
| `src/services/abstract/enemies.js` | 契约更新：三类人类士兵、`headshot`、`load()`、可选 `assets`、`world:enemy-shot` / `world:blood`、尸体语义。 |
| `src/services/public/enemies.js` | `createEnemies` 接受并校验可选 `assets`，返回 `load()`。 |
| `src/services/impl/enemies/human-visual.js` | **新增**：四个 GLB 加载缓存、逐模型缩放、重甲 ×1.12、动画后缀映射与 Man 回退、`AnimationMixer` 交叉淡入淡出、程序化装具、头/身命中盒、受击闪白、死亡与 4 秒尸体淡出、实例释放。 |
| `src/services/impl/enemies/enemy.js` | 改为人类士兵 AI：步枪兵/重机枪手三发点射与换弹停顿，突击兵近战；朝向玩家；视觉委托给 `human-visual.js`。 |
| `src/services/impl/enemies/enemy-manager.js` | 模型池选择、`headshot` 返回、4 秒尸体、`world:blood` 替代爆炸、`player:damage.sourcePosition`、`getState().types`、模型预加载与释放。 |
| `src/services/impl/enemies/waves.js` | 类型选择与数值改为步枪兵/重机枪手/突击兵。 |
| `src/services/impl/enemies/projectile.js` | 曳光色常量、颜色参数、线段扫掠碰撞、`getSourcePosition()`。 |
| `src/services/impl/enemies/pickup.js` | 释放辅助改为从 `human-visual.js` 导入；掉落逻辑不变。 |
| `test/敌方服务/waves.test.js` | 更新为 25 项 v3 测试。 |
| `test/敌方服务/human-visual.test.js` | **新增** 13 项视觉测试。 |
| 本角色文档 | 更新 `feature-map.md`、`api-spec.md`、`functional-description.md`、`changelog.md`、`memo.md`、`docs/feature/enemy-waves.md` 与本文。 |

### 以前怎样，现在怎样

**以前（v2）：** 敌人是 Drone / Brute / Wraith 程序化机械单位，命中红色光学核心算暴击，死亡播放机械爆炸，没有骨骼动画与人类装具。

**现在（v3）：** 敌人是三类人类士兵：

- 步枪兵：70 生命 / 5.0 速度 / 9–16 米 / 三发点射每发 7 伤害 / 100 分；模型池 Adventurer、Woman Casual、Woman Formal。
- 重机枪手：200 生命 / 2.8 速度 / 6–10 米 / 三发点射每发 11 伤害 / 300 分；模型 Adventurer 放大 1.12 并加重甲。
- 突击兵：85 生命 / 7.2 速度 / 近战 14 伤害 / 1.2 秒冷却 / 150 分；Man 基础模型，不持长枪。

玩家射击命中独立头/身命中盒；头部返回 `headshot: true`（兼容 `critical`），伤害 2 倍由战斗服务在调用前乘算。受击播放 `HitRecieve`（Man 只闪白），死亡播放 `Death`，尸体保留 4 秒后淡出。敌人开火发出 `world:enemy-shot`，命中/死亡发出 `world:blood`；不再有机械爆炸。

### 动画映射与缩放

| 模型 | 缩放 | 动画家族 |
| --- | --- | --- |
| Adventurer | 0.985 | `CharacterArmature|Idle_Gun/Walk/Run/Run_Shoot/Gun_Shoot/HitRecieve/Death` |
| Woman Casual | 0.995 | 同上 |
| Woman Formal | 1.000 | 同上 |
| Man base | 0.373 | `HumanArmature|Man_Idle/Man_Standing/Man_Walk/Man_Run/Man_Punch/Man_Death` |

- Man 缺失 `HitRecieve`、`Gun_Shoot`、`Run_Shoot`、`Punch_Left/Right`、`Idle_Gun`：受击只闪白；射击状态回退到跑/待机；近战统一 `Man_Punch`；死亡 `Man_Death`。
- 重机枪手在模型缩放之上再乘 1.12；命中盒只对重机枪手乘 1.12（头中心 1.62 m、身体中心 0.98 m 为基准）。
- 模型自带的 `CharacterArmature` 100 倍缩放不作用于世界单位装具：装具按骨骼真实世界缩放的倒数抵消，步枪在根节点并跟随右手（详见下文修复记录）。
- 动画交叉淡入淡出 0.15–0.2 秒；`mixer.timeScale` 按速度调整以减少滑步。

### 这次只改什么

- 只写 `角色卡/敌方服务/boundary.md` 第 1 节列出的文件。
- 不修改 `src/models/`、`src/providers/`、其他 Service、Pipeline、界面或 `package.json`。
- 不发出 `enemy:killed`、HUD 事件、波次事件或声音；这些由 Pipeline 负责。
- 不声称 Electron 画面、操作手感、帧率或重开内存已经验收。

### 环境 Provider 依赖

环境 Provider 已按 V3-2 冻结契约提供 `AnimationMixer`、`cloneSkinned`（SkeletonUtils）与素材加载器的 `loadGltf(url) -> { scene, animations }`；本服务按契约消费，未修改环境 Provider 文件。

### v3 修复：骨骼装具继承 100 倍缩放（2026-10-17）

**问题（环境引擎提供的确凿证据）：** 中心射线命中的是一个 `userData.equipment = "face-mask"` 的网格；父链为 face-mask → Head/Neck/Chest 骨骼 → `CharacterArmature` scale 100 → Root_Scene → `human-soldier-rifleman`。敌人组仍在生成环位置，但面罩命中距离从约 9.28 m 缩小到 0.12 m，说明装具被骨骼的 100 倍缩放放大并偏移，形成覆盖屏幕的巨大深色面板。

**根因：** 真实 Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约 98.5 倍。旧实现只用 `1 / 模型清单缩放`（如 1/0.985）抵消，漏掉了骨骼继承的 100 倍。

**修复：**

- 挂骨骼前调用 `root.updateMatrixWorld(true)`，再用 `bone.getWorldScale()` 测量骨骼真实世界缩放，按逐轴倒数设置装具 `scale` 与局部偏移，使装具尺寸与偏移按米计算；根节点装具不受影响。
- 步枪挂在敌人根节点（不继承骨骼缩放），每帧移动到右手 `WristR` 的世界位置，保持人体尺度并跟随手部动画。
- GLTFLoader 会去掉骨骼名中的点（`UpperArmL`、`WristR`、`LowerLegL`、`FootL`）；查找候选名同时覆盖点号与非点号写法，并按候选优先级选择手部骨骼。

**验证：**

- 假场景改为 `CharacterArmature` 100 倍缩放 + 真实骨骼名；新增对每个装具的世界缩放/包围盒、骨骼跟随、步枪跟随右手的断言。
- 真实 GLB 探针：四个模型装具世界缩放 1.00（重机枪手步枪 1.12），最大装具包围盒 0.59 m，面罩 0.17×0.11×0.11 m，步枪挂点距 `WristR` 约 0.036 m。
- Electron 实机：`test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`，6 个步枪兵生成、玩家受伤 79→65，画面无巨型面板。
- `npm run build` 成功（68 modules，`dist/assets/index-C3760wmi.js`）。

### 怎样确认

在项目根目录实际运行：

```sh
node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js
```

实际结果（2026-10-17，Node v24.11.1，Windows 11）：

```text
ℹ tests 38
ℹ pass 38
ℹ fail 0
ℹ duration_ms ~140
```

覆盖内容：

- 波次数量、三类兵种占比边界、缩放倍数与上限。
- 生成数量、0.55 秒间隔、生成点失败保留队列、`startWave` 保留旧敌人、`waveComplete`。
- 头/身命中盒形状、爆头标记、击杀分值、未命中、生命不低于 0。
- 死亡立即移出可命中列表、4 秒尸体淡出与移除。
- `world:blood` 存在且没有 `world:explosion`。
- 掉落纯函数、生命球位置/收集、25 秒过期。
- 弹丸命中玩家、障碍、地面与超时（含高速扫掠）。
- 步枪兵点射与 `world:enemy-shot`、重机枪手三连发、突击兵近战冷却。
- `reset()` 清理尸体、`dispose()` 后安全 `update`。
- 四个 GLB 映射与逐模型缩放、动画名映射与 Man 回退、装具存在性与骨骼挂载、**100 倍 armature 下的装具世界尺度/骨骼跟随/步枪跟随右手**、模型加载失败日志、dispose 幂等、旧机械类型彻底移除。

### 未验证/未解决

- **Electron 视觉**：已确认人类士兵与装具为人体尺度、无巨型面板；走/跑/射击/受击/死亡动画的完整观感、装具逐帧贴合、朝向、脚底贴地、枪口闪光与尸体淡出仍需逐项截图/录屏确认。
- **跨角色待办**：战斗服务仍用 `part === 'core'`；Pipeline 仍映射 `world:explosion`；HUD 名称仍是旧机械名。
- 30 个敌人（含装具与命中盒）的帧率、连续重开内存未测。
- 模型头/手骨骼的装具与步枪局部偏移已按真实 GLB 探针校准到人体尺度；仍建议近距离截图复核握枪姿态。

---

## v2 首次实施（2026-10-17）

### 改在哪里

本次是敌方服务阶段，只新增本角色边界内的文件，没有修改其他角色的业务代码、共享 Model、Provider 或构建配置：

| 位置 | 改动 |
| --- | --- |
| `src/services/abstract/enemies.js` | 新增敌方服务 JSDoc 契约，无运行时导出。 |
| `src/services/public/enemies.js` | 新增 `createEnemies(options)` 公共入口与参数校验。 |
| `src/services/impl/enemies/waves.js` | 新增波次类型选择、组成、计划、敌人缩放数值与掉落判定纯函数。 |
| `src/services/impl/enemies/enemy.js` | 新增三类敌人的程序化模型、AI、生命、闪白、血条、避障与释放辅助。 |
| `src/services/impl/enemies/projectile.js` | 新增敌方弹丸移动、碰撞与寿命。 |
| `src/services/impl/enemies/pickup.js` | 新增生命球外观、漂浮、拾取与寿命。 |
| `src/services/impl/enemies/enemy-manager.js` | 新增波次调度、生成、目标登记、伤害结算、事件、重置与释放。 |
| `test/敌方服务/waves.test.js` | 新增 23 项单元测试。 |
| 本角色文档 | 新增 `feature-map.md`、`api-spec.md`、`functional-description.md`、`changelog.md`、`docs/feature/enemy-waves.md` 与本次变更记录；更新 `memo.md`。 |

### 以前怎样，现在怎样（v2）

**以前：** 敌方服务只有角色卡和边界，没有任何实现；游戏里没有敌人、波次、敌方弹丸或生命球。

**现在：** Pipeline 可以通过 `createEnemies()` 创建完整敌方服务：

- 调用 `startWave(n)` 按共享配置排队生成第 n 波敌人；
- 每帧 `update(dt, playerSnapshot)` 推进生成、AI、弹丸、拾取物、血条和闪白；
- 通过 `getTargetQuery().listHittable()` / `applyDamage()` 与战斗服务的射线命中对接；
- 通过 `getState()` 读取波次与存活数量，判断 `waveComplete`；
- 通过 `reset()` 清理重开，通过 `dispose()` 释放。

**但玩家还看不到变化：** 竞技场 Service、Pipeline 和界面尚未接入，Electron 里也没有实际运行过敌人。本阶段交付的是可测试的服务逻辑，不是已经能在桌面程序中游玩的内容。

### v2 关键实现决定

1. **命中条目符合 Model 契约。** `listHittable()` 返回 `[{ object, targetId }]`；`object` 是网格，`entry.targetId` 与 `object.userData.targetId` 相同，`userData.part` 区分 `body` / `core`。最初实现曾直接返回网格，项目管理复核后已按调度记录 §3.4.1 修正，未修改战斗服务或 Model。
2. **生命球落到地面。** 悬停敌人死在空中时，生命球沿竖直方向落到 y = 0，保留死亡位置的 X/Z；`pickup:spawn` 携带该地面点。
3. **暴击只加倍一次。** 战斗服务在调用 `applyDamage` 前乘算暴击伤害；敌方服务只返回标记与 `score`。
4. **表现参数集中。** 玩法数值全部来自 `GAME_CONFIG`；模型尺寸、悬停高度、开火距离余量、闪白时长、血条尺寸等设计未给出的表现默认值集中在 `enemy.js`。
5. **避障使用轴分离滑动。** 先尝试 X 轴，再尝试 Z 轴，被障碍挡住的轴取消位移。

### v2 验证

```sh
node --test test/敌方服务/waves.test.js
```

实际结果（2026-10-17）：23 项测试全部通过。v3 已把该文件更新为 25 项并新增 13 项视觉测试，总计 38 项。

### v2 已知限制

- 未在 Electron 中运行；未与真实竞技场、Pipeline、战斗/效果/音频联调。
- 30 敌人帧率与连续重开内存未测量。
- 视觉为机械敌人，已被 v3 人类士兵取代。
