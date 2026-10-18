# 功能导航：敌方服务

本角色负责一个系统功能：人类士兵波次、三类敌人的 AI 与攻击、敌方弹丸、受击死亡、生命拾取物，以及供战斗服务射线检测的可命中目标登记。

| 功能 ID | 名称 | 当前状态 | 说明文档 |
| --- | --- | --- | --- |
| `enemy-waves` | 敌人与波次 | v3 人类士兵实现完成，38 项单元测试通过；Electron 已确认人类士兵与装具为人体尺度、无巨型面板 | [docs/feature/enemy-waves.md](docs/feature/enemy-waves.md) |

## 当前进度说明

- 2026-10-17（v3）：敌人从 Drone/Brute/Wraith 机械单位改为三类人类士兵——步枪兵 `rifleman`、重机枪手 `heavy`、突击兵 `breacher`；新增 `src/services/impl/enemies/human-visual.js`。
- 当前可以：按波次生成三类人类士兵；使用四个 Quaternius GLB、骨骼动画与程序化战术装具；头/身独立命中盒与爆头标记；受击闪白/`HitRecieve`、死亡动画与 4 秒尸体淡出；点射、换弹停顿、枪口闪光与曳光；`world:blood` 血雾与 18% 生命球掉落；`reset()` 清理全部敌人与尸体。
- 动画映射：Adventurer/Woman 使用 `CharacterArmature|Idle_Gun/Walk/Run/Run_Shoot/Gun_Shoot/HitRecieve/Death`；Man base 使用 `Man_Idle/Man_Standing/Man_Walk/Man_Run/Man_Punch/Man_Death`，缺失状态回退为最近片段或只闪白。
- 环境依赖已就绪：`src/providers/public/three.js` 已导出 `AnimationMixer` 与 `cloneSkinned`，素材加载器已有 `loadGltf(url)`。2026-10-17 修复了骨骼装具继承 `CharacterArmature` 100 倍缩放导致巨型面罩的问题；装具现在按骨骼真实世界缩放抵消，步枪跟随右手。Electron 截图见 `test/敌方服务/evidence/spawn-1.png` … `spawn-4.png`，画面中 6 个步枪兵为人体尺度，没有巨型面板。
- 跨角色待办：战斗服务需把命中判断从 `part === 'core'` 改为 `part === 'head'`；Pipeline 需把 `world:explosion` 映射改为 `world:blood`，并转发 `player:damage.sourcePosition`；HUD 名称改为“步枪兵/重机枪手/突击兵”。
- 尚未逐项验收：走/跑/射击/受击/死亡动画观感、尸体淡出、30 敌人帧率与跨角色事件顺序。不能声称完整视觉已验收。

## 相关文档

- 功能说明：[docs/feature/enemy-waves.md](docs/feature/enemy-waves.md)
- 接口与实际导出：[api-spec.md](api-spec.md)
- 本次变更记录：[docs/change/2026-10-17_change_initial-implementation.md](docs/change/2026-10-17_change_initial-implementation.md)
- 模块说明：[functional-description.md](functional-description.md)
- 变更日志：[changelog.md](changelog.md)
