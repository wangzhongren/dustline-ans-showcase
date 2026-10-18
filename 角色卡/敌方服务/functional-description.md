# 模块说明：敌方服务（v3：人类士兵）

## 这个模块解决什么问题

一局游戏里，玩家需要面对一波接一波的敌人。敌方服务负责把“第几波、出什么敌人、敌人在哪里、怎么移动和攻击、被打中后怎么扣血和死亡、死亡后掉不掉生命球”这些规则真正执行出来。

v3 起敌人不再是无人机或机械单位，而是三类人类士兵：**步枪兵、重机枪手、突击兵**。他们使用 Quaternius 的 CC0 骨骼模型，叠加程序化战术装具，播放走、跑、射击、受击与死亡动画；玩家可以打头（爆头）或打身体。

它不负责：玩家移动和射击、得分与 HUD、画面特效和声音、场景与出生点布局。那些分别属于战斗服务、Pipeline、环境引擎和竞技场服务。

## 现在能做什么

- **波次**：按共享配置计算第 n 波的数量、类型占比和缩放；第 1 波只有步枪兵，第 2 波起出现重机枪手，第 3 波起出现突击兵。生成间隔 0.55 秒。
- **三类人类士兵**：
  - 步枪兵：保持 9–16 米，侧向移动，三发点射（每发 7 伤害），100 分。
  - 重机枪手：保持 6–10 米，缓慢逼近，三发点射（每发 11 伤害），300 分；模型放大 1.12 并加装肩甲/胸板/腿板。
  - 突击兵：快速贴身，近战 14 伤害、1.2 秒冷却，150 分；不持长枪，播放 `Man_Punch`。
- **模型与动画**：四个 GLB（Adventurer、Woman Casual、Woman Formal、Man base）按清单缩放；头/身命中盒；受击闪白 + `HitRecieve`（Man 只有闪白）；死亡播放 `Death`，尸体保留 4 秒后淡出。
- **装具**：头盔、面罩、防弹背心、弹匣袋、护膝、手套、靴子与程序化步枪；重机枪手额外肩甲/胸板/腿板。颜色限定在橄榄、卡其、装备黑，不使用霓虹或发光眼睛。
- **命中登记**：向 Pipeline 提供 `{ object, targetId }` 条目与 `applyDamage`；头部与身体使用不同 `targetId`，`applyDamage` 返回 `headshot`（兼容旧名称 `critical`）。爆头伤害由战斗服务乘算一次，敌方服务不再加倍。
- **弹丸**：可见暖橙色曳光弹，使用扫掠碰撞避免高速穿透；撞地面、障碍物、竞技场边界或玩家后移除；命中玩家发出带 `sourcePosition` 的 `player:damage`。
- **开火表现**：每发发出 `world:enemy-shot`，显示短暂枪口闪光；点射后进入换弹停顿，步枪下压、头部微低。
- **死亡与掉落**：命中与死亡发出 `world:blood` 血雾（不再有机械爆炸）；18% 概率掉生命球，25 秒后消失，玩家靠近发出 `pickup:collected`。
- **生命周期**：`startWave()` 只替换生成队列；`reset()` 可重复清空（含尸体）；`dispose()` 释放模型缓存，之后 `update()` 安全返回。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/services/abstract/enemies.js` | 敌方服务 JSDoc 契约（工厂参数、返回方法、命中查询、状态、事件、模型依赖），无运行时导出。 |
| `src/services/public/enemies.js` | `createEnemies(options)` 公共入口，校验必需参数与可选 `assets`。 |
| `src/services/impl/enemies/human-visual.js` | GLB 加载与缓存、模型/动画映射、`AnimationMixer` 状态机、程序化装具、头/身命中盒、尸体淡出与实例释放。 |
| `src/services/impl/enemies/enemy.js` | 单个敌人的 AI、点射/近战、生命、受击与死亡；把视觉委托给 `human-visual.js`。 |
| `src/services/impl/enemies/waves.js` | 纯函数：类型选择、波次组成、计划、敌人缩放数值、掉落判定。 |
| `src/services/impl/enemies/projectile.js` | 敌方弹丸的移动、扫掠碰撞、曳光颜色与寿命。 |
| `src/services/impl/enemies/pickup.js` | 生命球的外观、漂浮、拾取判定与寿命。 |
| `src/services/impl/enemies/enemy-manager.js` | 波次调度、模型池选择、生成、目标登记、命中结算、血雾、尸体计时、拾取、重置与释放。 |
| `test/敌方服务/waves.test.js` | 25 项波次、AI、命中、死亡、拾取与生命周期测试。 |
| `test/敌方服务/human-visual.test.js` | 13 项模型映射、动画回退、命中盒、装具、加载失败与释放测试。 |

## 明确的边界

- Pipeline 只能导入 `src/services/public/enemies.js`。
- 敌方服务只导入共享 Model 与 `src/providers/public/three.js`；不导入其他 Service、Pipeline、Interface、`providers/impl/`，也不直接导入 `three`。
- 玩家位置、生命和存活状态是只读快照；敌方服务不修改玩家，只发出 `player:damage`。
- 敌方服务不发出得分/击杀事件；`applyDamage()` 返回 `score`、`enemyType`、`headshot`，由 Pipeline 决定 HUD 与音效。
- 出生点与碰撞盒由竞技场服务提供；本模块不生成场景布局。
- 计分、波次推进、`wave:start` / `wave:cleared` 事件和波次间隔属于 Pipeline。
- 素材文件由美术角色维护；本模块只通过素材 Provider 的 `loadGltf(url)` 读取，不直接读 `resource/`。

## 关键实现决定

1. **视觉层独立为 `human-visual.js`**：`enemy.js` 只关心 AI 与生命；模型、动画、装具、命中盒、尸体淡出集中在一个文件，便于校准与测试。
2. **动画按后缀映射并做缺失回退**：CharacterArmature 家族用 `Idle_Gun / Walk / Run / Run_Shoot / Gun_Shoot / HitRecieve / Death`；Man 只有 `Man_Idle / Man_Standing / Man_Walk / Man_Run / Man_Punch / Man_Death`，因此突击兵的 idle/walk/run 使用 Man 片段，受击只闪白，近战用 `Man_Punch`。`AnimationMixer` 交叉淡入淡出 0.15–0.2 秒，避免瞬切。
3. **逐模型缩放 + 重甲 1.12**：模型本身的清单缩放（0.985 / 0.995 / 1.0 / 0.373）把身高归一到约 1.8 米；重机枪手再乘 1.12。命中盒以归一化人体尺寸为基准，只对重机枪手放大 1.12。
4. **装具挂骨骼时抵消真实世界缩放**：Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约 98.5 倍。挂骨骼前用 `getWorldScale` 测量骨骼真实世界缩放，并以逐轴倒数设置装具 `scale` 与局部偏移，使头盔/面罩/背心等按米计算；步枪挂在敌人根节点（不继承骨骼缩放），每帧跟随右手 `WristR` 的世界位置。GLTFLoader 会去掉骨骼名中的点（`UpperArmL`、`WristR`），查找时同时覆盖两种写法。
5. **头/身独立命中盒**：不可见盒状网格，`userData.part` 为 `head` / `body`，不对骨骼网格逐三角射线检测。死亡后立即从可命中列表移除，但尸体继续播放死亡动画 4 秒再淡出。
6. **高速弹丸扫掠碰撞**：敌方弹速 30–34 m/s，单帧位移可能超过玩家/障碍厚度；弹丸对移动前后线段做扫掠检测，避免穿透。
7. **环境能力已就绪，失败仍可回退**：环境 Provider 已提供 `AnimationMixer` / `cloneSkinned` / `loadGltf`；正常路径加载四个 GLB 并播放骨骼动画。若素材缺失、单个模型加载失败或克隆/混合器创建失败，记录明确 URL 与错误并构建程序化人类士兵（仍有头盔、背心、护膝、手套、步枪与命中盒），比赛不会中断。

## 当前没有做的事

- Electron 中已确认人类模型与装具为人体尺度、无巨型面板；走/跑/射击/受击/死亡动画的完整观感、尸体淡出、朝向与脚底贴地仍需逐项截图确认。
- 没有与真实竞技场、战斗服务、Pipeline、效果/音频 Service 联调。
- 没有做敌人之间的互相避让或寻路；目前只有障碍物滑动和竞技场边界限制。
- 没有测量 30 个人类士兵（含装具与命中盒）时的帧率，也没有做连续重开的桌面端内存测量。
- 模型没有根运动；滑步只通过 `mixer.timeScale` 近似修正，仍需截图/录屏确认。

## 当前验证

- 单元测试 38 项全部通过（2026-10-17）：`node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js`。
- `npm run build` 成功（68 modules；`dist/assets/index-C3760wmi.js`）。
- Electron 实机验证（2026-10-17）：6 个步枪兵生成，玩家受伤 79→65；截图中人类士兵与装具为人体尺度，没有覆盖屏幕的巨型面板。证据：`test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`。
- 真实 GLB 探针：四个模型全部装具世界缩放 1.00（重机枪手步枪 1.12），最大装具包围盒 0.59 m，面罩 0.17 × 0.11 × 0.11 m，步枪挂点距 `WristR` 约 0.036 m。
- 8 个模块导入冒烟通过；公共入口只导出 `createEnemies`。
- 完整骨骼动画观感、尸体淡出、30 敌人帧率与跨角色事件顺序仍未完整验收。
