# 功能导航：战斗服务

本角色负责第一人称玩家的移动、跳跃、冲刺、视角、碰撞、生命与恢复，以及 AR 步枪的射击、弹药、换弹、后坐力/镜头反馈、第一人称高细节武器模型与双手动画。命中判定通过 Pipeline 注入的目标查询完成，不直接依赖敌方服务。v3 起支持爆头 2 倍伤害、视图动画、镜头滚转/震动/FOV 冲击与战斗设置。

| 功能 ID | 名称 | 当前行为文档 | 主要负责角色 |
| --- | --- | --- | --- |
| `player-combat` | 玩家移动与射击 | [docs/feature/player-combat.md](docs/feature/player-combat.md) | 战斗服务 |

## 相关文档

- 初始实现与 v3 升级变更：[docs/change/2026-10-17_change_initial-implementation.md](docs/change/2026-10-17_change_initial-implementation.md)
- ADS 红点镜黑块修复：[docs/fix/2026-10-17_fix_ads-black-scope.md](docs/fix/2026-10-17_fix_ads-black-scope.md)
- 接口、导出、设置与事件：[api-spec.md](api-spec.md)
- 模块说明：[functional-description.md](functional-description.md)
- 工作线索：[memo.md](memo.md)
- 变更日志：[changelog.md](changelog.md)

## 边界

唯一写范围见 [boundary.md](boundary.md) 第 1 节：`src/services/{abstract,public}/combat.js`、`src/services/impl/combat/`（含 `view-model.js`）、`test/战斗服务/` 与本角色文档。`src/models/`、Provider、Pipeline、其他 Service 与角色卡均只读。
