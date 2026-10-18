# 项目管理备忘

## 当前任务

- v3 全量升级（客户 2026-10-17 确认）：人类士兵、射击手感重做、美术/后处理/设置。
- 设计 §12 SHA-256 `781b0373c5f8fcacdb369d4205133cb0b566df0a4c88db9826b0fef5c32245ff`；config SHA-256 `eb05c4e2e36cb3a286acb60549d414da450870253dc6dfbc77a5d56eb45a151f`。
- 调度：`docs/scheduling/neon-strike-delivery.md` V3 节；仍为手工记录（task_ops 配置/角色卡路径限制不变）。
- 顺序：美术 GLB + 游戏管线 Model/设置 → 战斗 + 敌方 → 环境 + 界面 → 管线接线 → 独立测试 → 视觉验收。
- 视觉证据放 `test/项目管理/screenshots-v3/`，不要覆盖 v2 截图；E2E 截图放 `test/独立测试/fixtures/screenshots-v3/`。
- 性能必须实测；低画质关闭后处理并记录；未测不得写 60fps。
- v3 验收：无无人机/幽影、人类士兵动画/爆头/死亡、射击手感、设置持久化、后处理/道具、build/单元/集成/E2E/pack/dist。

## 工作线索

- `task_ops` 与已批准 config 不兼容：config 的 `writeFiles` 含 `角色卡/...`，CLI 拒绝为执行范围。不要为此修改 config（Governance 权限）；使用手工调度记录。
- Windows GBK 环境下 Python 需 `PYTHONUTF8=1` 才能读 UTF-8 文件。
- 根 `package.json` 已由界面装配切换为 ESM；源码与测试直接使用 `node --test`。`test/项目管理/esm-loader.mjs` 仅作 CommonJS 过渡期历史辅助保留。
- 最终候选：dist JS `index-ClkC91v5.js`；`release/win-unpacked/DUSTLINE.exe` 与 `release/DUSTLINE Setup 1.0.0.exe` 已在最终源码上重建。
- 最终回归：单元+集成 139/139、界面 12/12、Electron 冒烟全部 PASS；独立测试集成 7/7、E2E 2/2。
- 视觉：美术已确认 `menu-04.png`、`gameplay-03.png` 达标；三项非阻断后续已记录（沙袋织纹重映射、步枪暗部分离、木箱降红）。
- 未验证：真人 2 波手感/听音、30 敌人与连续重开性能/内存、安装包安装卸载/快捷方式/签名/图标。
- v3 最终：人类士兵/爆头/死亡淡出、AR-15 视图模型/双手/后坐/ADS、道具/贴片/后处理、设置面板/持久化/低画质、安装包重建均完成；集成 12/12、E2E 4/4、角色套件 209/209；美术静态视觉验收 YES。
- v3 未验证：真人 2 波手感/听音、30 敌人高画质、连续重开 5 次内存、安装包安装/卸载/快捷方式/签名/图标、动画过渡/脚滑/装具穿插逐帧观感、后处理逐 pass 对比。
- v3 缺陷修复：右键 ADS 红点镜内全黑。根因是实心镜体前脸+镜片 depthWrite+暗红点；战斗改开放框体/透光镜片/高亮红点，独立测试用 Electron ADS 中心亮度+红点采样回归；新截图目录 `screenshots-v3-ads-fix/`，重新 build/pack/dist。
- 冻结契约见调度记录 §3；任何 worker 提出的契约变更先回到项目管理评审。
- 视觉验收必须实际截图查看；不能只凭代码或 worker 报告。
- 不提交 git（目录不是仓库），不修改 `.ans/project.json`、角色卡边界、治理文档。

## 交付检查

1. 每个阶段核对实际文件、命令输出、文档更新。
2. 检查层间 import：Interface→Pipeline public；Pipeline→Service public；Service→Provider public；禁止 Service 互导、禁止跨层 `impl/`。
3. 拒绝三元运算符、静默 catch、Three.js 资源泄漏、未验证的“完成”。
4. 最终命令：`npm run build`、`npm start`、`npm run pack`、`npm run dist`；截图归档。
