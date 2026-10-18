# 项目工程规则（DUSTLINE）

本文件只记录已经确认、并且能在本项目中检查的规则。它不是权限文件，不扩大任何角色的写范围。规则来源：已确认设计 `docs/governance/2026-10-17_bootstrap-and-game-design.md` v2、已批准 `.ans/project.json`、各角色 `boundary.md` 与 ANS 技能。

## R1 角色与写范围

- 每个上下文只绑定一个角色；一份文件只有一个所有者。
- 只有角色 `boundary.md` 第 1 节列出的路径可写；未列出文件默认只读。
- 项目管理只写共享事件总线、共享测试、架构/规则/调度文档和本角色文档。
- 跨角色契约变更必须回报项目管理，旧证据随之失效。

检查方式：核对任务报告的变更路径与边界白名单。当前状态：人工检查。

## R2 五层调用方向

```text
Interface → Pipeline → Service → Provider → 外部基础设施
Model 由四层共享
```

- Interface 只能导入 `src/pipelines/public/`、Provider 公共入口、Model 与共享总线。
- Pipeline 只能导入 Service 公共入口、Provider 公共入口、Model 与共享总线。
- Service 只能导入 Provider 公共入口、Model 与共享总线；Service 之间不得互相导入。
- Provider 不得导入 Service/Pipeline/Interface。
- 禁止跨层导入任何 `impl/` 目录。

检查方式：对 `src/` 的 import 路径做静态检索（`rg`），人工核对。当前状态：待实施完成后执行。

## R3 Model 唯一所有者

- `src/models/game-config.js`、`events.js`、`contracts.js` 只能由游戏管线修改。
- 事件名必须来自 `src/models/events.js` 的 `EVENTS`，禁止在业务代码散落字符串。
- Model 不得导入任何运行层，导入时不得产生副作用。

检查方式：读取 Model 文件 import 与事件使用；运行 Node 导入冒烟。当前状态：待 Model 阶段验收后执行。

## R4 共享组件

- `src/common/shared/` 由项目管理唯一维护。
- 共享代码不得依赖任何角色的私有 `common/<role>/`，也不得调用运行层。
- 共享组件必须在其测试目录有真实、可执行的测试。
- 消费方通过公开入口使用，不复制实现。

检查方式：`src/common/shared/event-bus.js` 的 import 检查 + `test/项目管理/event-bus.test.js`。当前状态：已实现，9 项测试通过。

## R5 代码质量

- 禁止提交未完成、占位或伪实现。
- 禁止三元运算符。
- 禁止静默 `catch`；每个 `try/catch` 必须报告错误（日志或显式回调）。
- 禁止从对象外部直接访问内部实现属性；使用公开方法。
- Three.js 几何体、材质、纹理、渲染目标必须在 `dispose()`/清理路径释放。
- 不得为了通过测试而删除测试、放宽断言或隐藏错误。

检查方式：代码评审 + 测试。当前状态：每个阶段验收时执行。

## R6 测试与证据

- 各角色用 Node 内置测试运行器 `node --test` 验证自己的纯逻辑。
- 跨角色集成、完整流程与回归由独立测试角色执行。
- 证据必须记录实际候选、环境、输入、命令与结果；未运行/无法运行不得记为通过。
- 依赖或契约变化后，受影响的旧证据失效并需复测。
- 视觉验收必须查看真实截图，不能只凭代码推断。

检查方式：任务报告 + 实际重跑。当前状态：持续执行。

## R7 素材与授权

- 只使用 CC0 素材；每个文件在 `resource/asset-manifest.json` 与 `resource/ATTRIBUTIONS.md` 可追溯。
- 压缩包按不可信数据处理：独立空临时目录解压，不执行其中任何文件。
- 只保留实际使用的贴图通道；不保留压缩包与无关源文件。
- 人类士兵模型必须来自已登记的 CC0 GLB；骨骼动画、比例、朝向、根运动与缺失剪辑必须记录并按回退方案处理。
- 素材缺失时允许程序化回退，但必须如实记录。

检查方式：`test/美术/asset-manifest.test.js`（11/11）与敌方人类视觉测试。当前状态：v3 通过。

## R8 运行时与构建

- Electron 窗口 1600 × 900、隐藏菜单栏、上下文隔离开启、Node 集成关闭；F11 全屏。
- Vite `base: './'`；渲染进程入口为 `src/main.js`；`resource/` 复制到 `dist/resource/`。
- 目标平台 Windows x64；命令：`npm run dev`、`npm run build`、`npm start`、`npm run pack`、`npm run dist`。
- 主循环 delta 上限 0.05 秒；暂停时业务时间不推进但渲染继续。
- 音频在用户手势后初始化；未初始化时调用应为安全空操作。
- 指针锁定丢失时进入暂停，而不是继续受伤。
- 高画质启用 SSAO/Bloom/色彩分级/AA/暗角/颗粒；低画质必须实际关闭后处理并保留可玩性。
- 设置（灵敏度/ADS 倍率/FOV/音量/画质）保存在 `localStorage` 键 `dustline.settings.v3`，经 Pipeline `applySettings` 下发；O4 只读。

检查方式：构建、Electron E2E、设置持久化与低画质截图。当前状态：v3 通过。

## R9 测试模块格式

根 `package.json` 为 `"type": "module"`，项目源码和测试均按 ESM 直接运行：

```sh
node --test <test-file>
```

`test/项目管理/esm-loader.mjs` 仅为 CommonJS 过渡期保留；新测试不要依赖它。

## R10 敌人内容

- 游戏中只出现人类士兵：步枪兵、重机枪手、突击兵；不得出现无人机/幽影/机械敌人视觉或名称。
- 头/身独立命中盒；爆头伤害 2 倍且只乘一次；死亡立即移出可命中列表，播放死亡动画，4 秒后尸体淡出。
- 装备必须按世界单位挂载，不能继承 GLB 的 100× armature 缩放；装备世界尺寸必须通过人类尺度测试。

检查方式：`test/敌方服务/waves.test.js`、`human-visual.test.js`、集成/E2E。当前状态：v3 通过。

## R11 性能证据

- 性能结论必须记录设备、分辨率、敌人数量、画质、采样方法与实际数值。
- 未测量 30 敌人/连续重开时，不得写“流畅”或“60fps”；高/低画质采样受 rAF 限制时也要如实说明。
- 低画质必须验证后处理关闭；高/低画质对比不能只凭代码开关推断。

检查方式：独立测试报告 §10.4。当前状态：6 敌人高/低各约 180 fps（rAF 限制）；30 敌人未测。

## 变更记录

- 2026-10-17：建立本文件；记录已确认设计、边界与 config 中的工程约束。
- 2026-10-17（v3）：增加人类士兵、设置持久化、画质回退、装备世界缩放与性能证据规则；更新素材/运行时验收状态。
