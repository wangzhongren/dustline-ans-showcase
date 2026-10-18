# 变更日志：敌方服务

## 2026-10-17 v3 修复：骨骼装具继承 100 倍缩放导致巨型面罩

- **根因**：Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约 98.5 倍。`human-visual.js` 旧逻辑只用 `1 / 模型清单缩放` 抵消，挂在 `Head` 等骨骼上的面罩/头盔因此变成覆盖屏幕的巨大深色面板。
- **修复**：挂骨骼前用 `getWorldScale` 测量骨骼真实世界缩放，按逐轴倒数设置装具 `scale` 与局部偏移，使装具按米计算；根节点装具不受影响。步枪挂在敌人根节点（不继承骨骼缩放），每帧把挂点移动到右手 `WristR` 的世界位置，保持人体尺度并跟随手部动画。
- **骨骼名**：GLTFLoader 会去掉骨骼名中的点（`UpperArmL`、`WristR`、`LowerLegL`、`FootL`）；查找候选名同时覆盖点号与非点号写法，并按候选优先级选择手部骨骼。
- **测试**：假场景改为 `CharacterArmature` 100 倍缩放 + 真实骨骼名；新增装具世界尺度/骨骼跟随/步枪跟随右手断言。单元测试 38 项通过。
- **真实 GLB 探针**：四个模型装具世界缩放 1.00（重机枪手步枪 1.12），最大装具包围盒 0.59 m，面罩 0.17×0.11×0.11 m，步枪挂点距 `WristR` 约 0.036 m。
- **Electron 证据**：`test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`，6 个步枪兵生成、玩家受伤 79→65，无巨型面板。`npm run build` 成功（68 modules）。

## 2026-10-17 v3：敌人改为人类士兵

- `src/services/abstract/enemies.js`：契约更新为三类人类士兵、`headshot`、`load()`、可选 `assets`、`world:enemy-shot` / `world:blood` 事件与尸体语义。
- `src/services/public/enemies.js`：`createEnemies` 接受并校验可选 `assets`（`loadGltf` / `loadManifest`），返回 `load()`。
- 新增 `src/services/impl/enemies/human-visual.js`：四个 GLB 加载缓存、逐模型缩放、重甲 ×1.12、动画后缀映射与 Man 回退、`AnimationMixer` 交叉淡入淡出、程序化头盔/面罩/背心/弹匣袋/护膝/手套/靴子/步枪/重甲、头/身命中盒、受击闪白、死亡与 4 秒尸体淡出、实例释放。
- `src/services/impl/enemies/enemy.js`：改为人类士兵 AI；步枪兵/重机枪手三发点射与换弹停顿，突击兵近战；朝向玩家；动画与枪口闪光交给视觉层。
- `src/services/impl/enemies/enemy-manager.js`：按 `modelPool` 选择模型；命中返回 `headshot`；死亡后保留尸体 4 秒；用 `world:blood` 替代 `world:explosion`；`player:damage` 带 `sourcePosition`；`getState()` 增加 `types` 统计；预加载模型缓存。
- `src/services/impl/enemies/waves.js`：类型选择与数值改为步枪兵/重机枪手/突击兵。
- `src/services/impl/enemies/projectile.js`：曳光色 `ENEMY_TRACER_COLOR`；支持颜色参数；线段扫掠碰撞；`getSourcePosition()`。
- `src/services/impl/enemies/pickup.js`：仅调整释放辅助的导入来源；掉落逻辑不变（18% / 30 生命 / 25 秒）。
- `test/敌方服务/waves.test.js`：更新为 25 项 v3 测试（波次、AI、爆头、死亡尸体、血雾、拾取、弹丸）。
- 新增 `test/敌方服务/human-visual.test.js`：13 项模型映射、动画回退、命中盒、装具、加载失败与释放测试。
- 文档：更新 `feature-map.md`、`api-spec.md`、`functional-description.md`、`docs/feature/enemy-waves.md` 与本次变更记录。

**验证：** `node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js` → 38 pass / 0 fail（2026-10-17，Node v24.11.1，Windows 11）。

**未落地/未验证：** 环境 Provider 尚无 `loadGltf` / `AnimationMixer` / `cloneSkinned`；Electron 视觉、跨角色联调、帧率与重开内存未测。

## 2026-10-17 敌方服务首次实现（v2 机械敌人）

- 新增 `src/services/abstract/enemies.js`：工厂参数、返回接口、命中查询、波次状态与事件约定的 JSDoc 契约。
- 新增 `src/services/public/enemies.js`：`createEnemies(options)` 公共入口，校验 renderer / getSpawnPoint / emit 与 colliders。
- 新增 `src/services/impl/enemies/waves.js`：`pickEnemyType`、`composeWave`、`createWavePlan`、`createEnemyStats`、`shouldDropPickup` 五个纯函数。
- 新增 `src/services/impl/enemies/enemy.js`：Drone / Brute / Wraith 程序化模型、AI、生命、受击闪白、血条、避障滑动、`disposeObject3D`。
- 新增 `src/services/impl/enemies/projectile.js`：暖红色敌方弹丸的移动、地面/障碍/边界/玩家碰撞与寿命。
- 新增 `src/services/impl/enemies/pickup.js`：生命球外观、漂浮、25 秒寿命与拾取判定。
- 新增 `src/services/impl/enemies/enemy-manager.js`：波次生成、目标登记、`applyDamage`、死亡爆炸、掉落、玩家伤害事件、重置与释放。
- 新增 `test/敌方服务/waves.test.js`：23 项测试全部通过。
- **未实现/未验证**：Electron 视觉与操作验收、与真实竞技场/战斗/Pipeline/效果/音频的联调、30 敌人帧率与重开内存测量。
- **契约修正（2026-10-17）**：`listHittable()` 改为返回 `[{ object, targetId }]`，与 Model 的 `HittableEntry` 及战斗服务 `entry.object` 读取方式一致；测试补充条目形状与 `entry.object.userData` 断言。未修改战斗服务或 Model。
