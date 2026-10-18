# 功能导航：美术

本角色负责写实军事美术方向、CC0 素材获取与授权、PBR 材质映射、资产清单、人类士兵模型与动画验证，以及资源完整性验证。不编写游戏业务代码。

| 功能 ID | 名称 | 当前行为文档 | 主要负责角色 |
| --- | --- | --- | --- |
| `art-assets` | 写实军事 CC0 素材与视觉规范 | [docs/feature/art-assets.md](docs/feature/art-assets.md) | 美术 |

## 相关文档

- 美术方向与材质映射：[docs/design/2026-10-17_design_art-direction.md](docs/design/2026-10-17_design_art-direction.md)
- 素材入库变更：[docs/change/2026-10-17_change_asset-intake.md](docs/change/2026-10-17_change_asset-intake.md)
- 素材清单接口与消费说明：[api-spec.md](api-spec.md)
- 模块说明：[functional-description.md](functional-description.md)
- 工作线索：[memo.md](memo.md)
- 变更日志：[changelog.md](changelog.md)

## 边界

唯一写范围见 [boundary.md](boundary.md) 第 1 节：`resource/`、`test/美术/` 与本角色文档。`src/`、构建配置、角色卡与边界文档只读。
