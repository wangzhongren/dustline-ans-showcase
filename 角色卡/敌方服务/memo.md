# 工作线索：敌方服务

- 2026-10-17：角色建立（ANS 引导）。
- 2026-10-17：敌方服务首次实现完成（v2 机械敌人）。公共入口 `createEnemies` 只在 `src/services/public/enemies.js`。
- 2026-10-17（v3）：客户确认敌人改为人类士兵。当前类型：`rifleman` / `heavy` / `breacher`；旧 drone/brute/wraith 已彻底移除。
- 视觉层集中在 `human-visual.js`：四个 GLB（adventurer、woman-casual、woman-formal、man-base）、逐模型缩放、重甲 ×1.12、程序化装具、头/身命中盒、动画状态机、尸体淡出。
- 动画事实：Adventurer/Woman = `CharacterArmature|Idle_Gun/Walk/Run/Run_Shoot/Gun_Shoot/HitRecieve/Death`；Man = `HumanArmature|Man_Idle/Standing/Walk/Run/Punch/Death`，没有 HitRecieve/Gun_Shoot/Run_Shoot/Punch_Left/Right；Man 受击只闪白，近战用 Man_Punch。
- 命中对象：`listHittable()` 返回 `{ object, targetId }`；`userData.part` 为 `head` / `body`，targetId 形如 `enemy-1:head` / `enemy-1:body`。爆头伤害由战斗服务乘算一次，本服务只返回 `headshot`（兼容 `critical`）。
- 死亡：立即移出可命中列表；播放 Death；尸体保留 4 秒，最后 1 秒淡出；`waveComplete` 只统计存活敌人，不等尸体消失。
- 事件：`world:enemy-shot`、`world:blood`（替代 `world:explosion`）、`player:damage` 带 `sourcePosition`。
- 弹速 30–34 m/s，已改为线段扫掠碰撞，避免一帧穿透玩家或障碍。
- 环境 Provider 已提供 `assets.loadGltf(url)`、Three 门面的 `AnimationMixer` 与 `cloneSkinned`（2026-10-17 17:35）。
- **2026-10-17 关键修复**：Quaternius GLB 的 `CharacterArmature` 自带 100 倍缩放，骨骼世界缩放约 98.5 倍。旧的 `1 / visualScale` 抵消不足，面罩等骨骼装具变成覆盖屏幕的巨大面板。现在用 `getWorldScale` 测量骨骼真实世界缩放并逐轴取倒数，装具尺寸/偏移按米计算；步枪在根节点、每帧跟随 `WristR`。GLTFLoader 会把骨骼名去点（`UpperArmL`/`WristR`），候选名同时覆盖两种写法。
- 真实 GLB 探针：装具世界缩放 1.00、最大包围盒 0.59 m、面罩 0.17×0.11×0.11 m、步枪距 `WristR` 0.036 m。Electron 截图 `test/敌方服务/evidence/spawn-1..4.png` 无巨型面板。
- 待办：完整动画观感/尸体淡出截图复核；等战斗/Pipeline 更新 `part === 'head'` 与 `world:blood`；30 敌人帧率与重开内存未测。
