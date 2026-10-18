# 变更日志：项目管理

## 2026-10-17

- 绑定项目管理角色并读取边界、ANS 技能、设计 v2 与已批准配置。
- 实现共享事件总线 `src/common/shared/event-bus.js`，覆盖订阅/退订、重复订阅、once、异常隔离、派发期间变更与 clear。
- 新增 `test/项目管理/event-bus.test.js` 与临时 ESM 测试加载器；9 项测试通过。
- 建立 `docs/architecture.md`、`docs/architecture/shared-components.md`、`docs/project-rules.md`。
- 建立 `docs/scheduling/neon-strike-delivery.md`；记录 `task_ops` 因 config 范围不兼容而未使用的原因。
- 按依赖顺序向独立角色上下文分派实施任务。
- 完成 Model、Provider、战斗/敌方/环境 Service、Pipeline、界面装配、独立测试各阶段验收；修复 `listHittable` 跨角色契约不一致与菜单武器可见问题。
- 依据真实截图完成两轮视觉复核：环境调色/光照/阴影/加载器修复；美术确认最终截图达标。
- 最终回归：单元+集成 139/139、界面 12/12、Electron 冒烟全部 PASS；独立测试集成 7/7、E2E 2/2。
- 在最终源码上重建 `npm run build`、`npm run pack`、`npm run dist`，产出可运行应用目录与 NSIS 安装包。
- 2026-10-17（v3）：按设计 §12 协调人类士兵、射击手感、场景/后处理、设置面板升级；处理装备 100× 缩放与武器颜色贴图阻塞；v3 集成 12/12、E2E 4/4、角色套件 209/209；安装包重建并由独立测试复验；美术给出静态视觉验收 YES。
- 2026-10-17（v3 ADS 修复）：红点镜实心盒导致 ADS 全黑；战斗改开放隧道/透光镜片/高亮红点；独立测试真实 Electron ADS 中心亮度 130.17/255、红点 37 像素、E2E 5/5；重新 pack/dist 后打包应用复测 142.79/255、红点 36 像素，HIP 正常。
