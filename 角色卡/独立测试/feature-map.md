# 独立测试：功能导航

本角色没有直接负责的用户业务功能；职责是独立验证其他角色的跨角色接口、完整玩家流程与回归结果。测试设计与实际结果分别记录在测试方案和日期化报告中。

## 本角色文档

| 文档 | 内容 |
| --- | --- |
| [测试方案](docs/test-plan.md) | 测试分层、覆盖范围、替身边界、命令与判定（v3） |
| [2026-10-17 初始验证报告](docs/reports/2026-10-17_report_initial-verification.md) | v2 与 v3 的集成/E2E/构建/打包实际结果、截图、缺陷与未验证项；§1–§9 为 v2，§10 为 v3，§11 为 v3 重新打包复核，§12 为 V3-4 ADS 黑镜修复复测，§13 为修复后打包应用 ADS 复测 |
| [工作线索](memo.md) | 当前候选、下一步与已知限制 |
| [变更日志](changelog.md) | 本角色文档与测试资产的变更记录 |

## 被测系统功能

本角色的用例不复制各角色的功能流程，只链接到它们当前的功能说明：

| 功能 | 负责角色 | 功能文档 |
| --- | --- | --- |
| 对局生命周期与计分 | 游戏管线 | [match-flow](../游戏管线/docs/feature/match-flow.md) |
| 玩家移动与射击 | 战斗服务 | [player-combat](../战斗服务/docs/feature/player-combat.md) |
| 敌人与波次 | 敌方服务 | [enemy-waves](../敌方服务/docs/feature/enemy-waves.md) |
| 对局界面与输入 | 界面装配 | [match-interface](../界面装配/docs/feature/match-interface.md) |
| 桌面启动与打包 | 界面装配 | [desktop-shell](../界面装配/docs/feature/desktop-shell.md) |
| 竞技场、视觉与音效 | 环境引擎 | [环境引擎 feature-map](../环境引擎/feature-map.md) |
| 写实军事素材与视觉规范 | 美术 | [美术 feature-map](../美术/feature-map.md) |

## 测试资产

| 路径 | 用途 |
| --- | --- |
| `test/独立测试/integration/game-flow.test.js` | 真实模块 + 契约兼容替身的跨角色集成 |
| `test/独立测试/e2e/electron-smoke.test.js` | 真实 Electron 窗口的冒烟、画面取证、完整流程、ADS 中心亮度/红点回归与设置持久化（5 个用例） |
| `test/独立测试/fixtures/screenshots/` | v2 实际运行截图（菜单、对局、暂停、结算、打包应用） |
| `test/独立测试/fixtures/screenshots-v3/` | v3 实际运行截图（人类士兵、ADS、设置、低画质等；不覆盖 v2） |
| `test/独立测试/fixtures/screenshots-v3-ads-fix/` | V3-4 ADS 黑镜修复前后与 HIP 截图（不覆盖 v2/v3） |

新增或修改测试前，先在测试方案或日期化方案中说明范围；已确认的同版方案不重复索取授权。
