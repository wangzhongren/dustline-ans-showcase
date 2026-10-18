# 模块说明：美术

## 这个角色负责什么

美术负责让游戏看起来像阴天下的写实军事训练场，并保证所有外部素材都能合法、可追溯地使用。具体包括：

- 按设计 §2.4 获取 CC0 天空、PBR 贴图和步枪模型；
- 按设计 §12.5 获取并验证四个 CC0 人类士兵动画 GLB（动画名、骨架、尺寸、朝向、根运动、授权）；
- 校验文件真实性与授权，维护 `resource/asset-manifest.json` 与 `resource/ATTRIBUTIONS.md`；
- 规定哪种材质贴到哪种表面、整体色彩与光照、界面配色；
- 用自动测试检查资源完整性，并在实现完成后用实际画面做视觉验收；
- 发现视觉偏差时向项目管理报告，由环境引擎或界面装配调整代码。

本角色**不写** `src/` 业务代码、构建配置、角色卡或边界文档。

## 写范围

只写 `boundary.md` 第 1 节列出的路径：

- `resource/`：素材、清单、授权；
- `test/美术/`：资源完整性测试；
- `角色卡/美术/` 下的导航、备忘、模块说明、接口说明与 `docs/{design,feature,change,fix}/`。

## 输入与输出

| 方向 | 内容 | 来源/去向 |
| --- | --- | --- |
| 输入 | 已确认设计 §2.4 的素材清单与写实军事方向 | `docs/governance/2026-10-17_bootstrap-and-game-design.md` |
| 输入 | v3 设计 §12.5 的四个 Quaternius 人类模型与 §12.2 的兵种/动画期望 | `docs/governance/2026-10-17_bootstrap-and-game-design.md` |
| 输入 | 素材清单冻结契约与 Provider 加载接口 | `docs/scheduling/neon-strike-delivery.md` §3.3、§4 |
| 输出 | `resource/` 素材文件 | 环境引擎的 Provider |
| 输出 | `resource/asset-manifest.json` | 环境引擎的素材加载器 |
| 输出 | `models.humans` 模型池（实际动画名、缩放、朝向、根运动） | 敌方服务的 `human-visual.js` |
| 输出 | `resource/ATTRIBUTIONS.md` | 主菜单授权说明、验收检查 |
| 输出 | 美术方向、材质映射、界面配色 | 环境引擎、界面装配 |
| 输出 | `test/美术/asset-manifest.test.js` | 本角色与项目管理验收 |

## 当前状态

- 素材入库完成，29 个素材文件（1 HDRI + 5 GLB + 23 JPG），全部通过魔数与非空校验。
- 清单、授权、测试和文档完成；`node --test test/美术/asset-manifest.test.js` 为 11 pass / 0 fail。
- v2 首轮视觉验收通过（menu-04 / gameplay-03）。
- v3 视觉复核（menu-02、gameplay-08、spawn-1…4、HIP/ADS 武器截图）确认人类士兵、场景道具、低角度光照、后处理、低饱和与无霓虹方向成立。
- v3 静态视觉验收通过（2026-10-17 材质复核后）：武器护木/弹匣/枪托为深色聚合物，无蓝/酒红；人类士兵、场景道具、低角度光照、后处理、低饱和与无霓虹方向成立。
- 仍需录屏或实际游玩确认：动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡、30 敌人性能与低画质回退。
- v3 四个人类 GLB 已完成结构/动画/尺寸/朝向/根运动验证：Adventurer 1.827 m、Woman Casual 1.810 m、Woman Formal 1.800 m、Man base 4.827 m；缩放分别为 0.985 / 0.995 / 1.000 / 0.373；全部 +Z、无根运动。
- 静态截图未验证：动画过渡、脚底贴地/滑步、装具逐帧穿模、30 敌人性能与低画质回退。
- Man 基础模型缺 `Punch_Left/Right`、持枪与受击片段；突击兵只能用 `Man_Punch`、`Man_Walk`、`Man_Run`、`Man_Death`。

## 与其他角色的边界

- **环境引擎**：读取清单并实现 `createAssetLoader`、`loadGltf`、渲染与 HDRI 环境；美术只提供资源和规范，不改其代码。
- **敌方服务**：读取 `models.humans`，加载 GLB、按条目缩放、映射实际动画名并叠加程序化装具（`human-visual.js`）；美术只提供模型、清单和视觉规范。
- **界面装配**：按美术方向的色彩与面板约定实现 HUD、菜单和授权说明；美术不直接改界面文件。
- **项目管理**：跨角色契约、调度与验收；素材缺失或视觉偏差通过项目管理协调。
- **独立测试**：只读核对清单、授权与文件；不改美术资源。
