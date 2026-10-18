---
id: initial-implementation-interface-shell
type: change
title: 初始实施：DUSTLINE 界面、输入与桌面壳
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related:
  - match-interface
  - desktop-shell
events:
  - date: "2026-10-17"
    kind: created
    summary: 记录把 NEON STRIKE 骨架替换为 DUSTLINE 菜单、HUD、输入、Electron 壳与打包配置
  - date: "2026-10-17"
    kind: implemented
    summary: 界面、输入、Electron 主进程、Vite、resource 复制、打包与冒烟脚本完成
  - date: "2026-10-17"
    kind: verified
    summary: 12 项层内测试、120 项共享/角色回归、Electron 冒烟、暂停/死亡/重开、输入、缩放、pack、dist 与打包后启动通过；视觉验收与安装/卸载未执行
---

# 初始实施：DUSTLINE 界面、输入与桌面壳

## 改在哪里

本次把 ANS 引导前的 NEON STRIKE 骨架整体替换为 DUSTLINE，并完成界面、输入、桌面壳、构建、打包与装配接线。所有写入都在 `角色卡/界面装配/boundary.md` 第 1 节范围内。

| 位置 | 改动 |
| --- | --- |
| `index.html` | 完整替换；标题 `DUSTLINE · 尘埃战线`；菜单、HUD、暂停、结算、装载层结构。 |
| `src/style.css` | 新增；写实军事配色、半透明面板、细边框、颗粒/暗角、响应式 HUD。 |
| `src/main.js` | 新增装配入口：创建 Provider/Service/Pipeline/界面，主循环、缩放、O4 钩子与释放。 |
| `src/interface/public/index.js` | 新增界面公共入口 `createInterface()`。 |
| `src/interface/impl/hud.js` | 新增 HUD、菜单、暂停、结算、罗盘、击杀信息、纯格式化函数。 |
| `src/interface/impl/input.js` | 新增键鼠输入、指针锁定、ESC/失焦暂停、F11 全屏与 M 静音。 |
| `electron/main.js` | 新增 Electron 主进程：窗口、安全设置、`app://` 协议、开发/测试加载。 |
| `vite.config.js` | 新增；`base: './'`、`publicDir: false`、构建后复制 `resource/`。 |
| `package.json` | 改为 ESM；新增脚本、打包配置、`playwright-core` 开发依赖。 |
| `package-lock.json` | 随依赖安装更新。 |
| `scripts/smoke-electron.js` | 新增真实 Electron 启动冒烟。 |
| `test/界面装配/hud-format.test.js` | 新增 12 项 HUD 纯函数测试。 |
| 本角色文档 | 功能导航、两份功能说明、接口说明、模块说明、备忘、日志、本变更记录。 |

## 以前怎样，现在怎样

**以前：** 根目录只有引导前的 NEON STRIKE `index.html` 骨架；没有 `src/main.js`、`src/style.css`、界面层、Electron 主进程、Vite 配置、打包脚本或真实启动冒烟。`package.json` 仍是 CommonJS，测试要带临时 ESM loader。

**现在：** 双击/启动 Electron 后会出现 DUSTLINE 菜单，竞技场在背后由 Pipeline 的菜单镜头环绕；点击“进入训练场”后锁定鼠标、初始化音频并进入对局。HUD 显示罗盘、击杀信息、得分/波次、生命、弹药、准星、命中标记和波次横幅；ESC/指针锁定丢失暂停，死亡后显示成绩并可重开。`package.json` 已切为 `"type": "module"`，原有共享/角色测试可直接用 `node --test` 运行。

**玩家还看不到的部分：** 正式视觉验收尚未由美术/项目管理签字；安装包尚未实际安装；没有真人完整游玩两波的记录。

## 这次只改什么

- 只写界面装配边界内的页面、样式、界面层、装配入口、Electron 主进程、构建/打包配置、冒烟脚本、本角色测试与文档。
- 不修改 Model、共享事件总线、Pipeline、战斗/敌方/环境/音频服务或 Provider 源码。
- 不修改 `resource/` 素材与授权文件。
- 不改动其他角色的文档或测试。
- 不声称视觉、音频听感、性能、安装/卸载或完整两波流程已经验收。

## 实际行为

### 界面

- 主菜单：`DUSTLINE` 标题、`尘埃战线` 副标题、作战简报、操作表、`进入训练场` 按钮、Poly Haven / ambientCG / Quaternius / Poly Pizza 的 CC0 授权说明。
- 装载层：竞技场加载期间显示“正在装载训练场、材质与天光…”，完成后隐藏并启用开始按钮；启动失败时显示错误信息。
- HUD：顶部罗盘、左上击杀信息、右上得分/波次/击杀、底部生命条、右下弹药与换弹条、中央准星/ADS/命中标记、受伤红边、低血红边、波次横幅。
- 暂停：继续行动、重新开始、完整操作提醒。
- 结算：得分、波次、击杀、存活时间、再次出击。
- 视觉：面板 `rgba(20,24,22,0.72)`、边框 `rgba(190,196,188,0.35)`、正文 `#D8DCD4`、次要文字 `#9AA096`；橄榄绿/卡其/混凝土灰/锈迹/枪金属灰；Bahnschrift / Segoe UI / Segoe UI Mono；无霓虹色、无外部字体或图片。

### 输入与指针锁定

- WASD、Shift、Space、鼠标观察、左键连发、右键 ADS、R 换弹、M 静音、F11 全屏、ESC 暂停。
- 指针锁定丢失、窗口失焦或页面隐藏时暂停；丢失时清空按键，防止卡住移动/射击。
- 指针锁定后的前两次鼠标移动被忽略，避免点击开始时光标跳到中心造成视角大幅偏移。
- ESC 同时提供显式暂停兜底，即使浏览器没有派发指针锁定退出事件也能暂停。
- 右键菜单被阻止。

### O1 / O3 / O4

- **O1**：右键写入 `InputCommand.aim`；HUD 收拢准星、显示 `ADS · 瞄准`；FOV/武器居中由战斗服务处理。
- **O3**：界面不接管相机；菜单保持画布可见，Pipeline 在 `menu` 状态驱动环绕镜头，菜单使用半透明渐变。装配入口调用战斗服务 `setViewVisible(false)` 隐藏菜单中的第一人称武器，并在 `game:state` 为对局/暂停时恢复显示。
- **O4**：`?test=1` 时装配入口暴露 `window.__DUSTLINE_TEST__ = Object.freeze({ getState, getSnapshot, getHud })`；默认不暴露，只读。

### 桌面与构建

- 窗口 1600×900、最小 1280×720、标题 `DUSTLINE · 尘埃战线`、隐藏菜单栏、上下文隔离、无 Node 集成、沙箱。
- 生产用 `app://dustline/index.html`，`app://` 处理 `dist/` 内的页面、脚本、样式、清单、贴图、HDR 与 GLB；拒绝越界路径，缺失文件 404。
- 开发模式可由 `VITE_DEV_SERVER_URL` 指向 Vite；Vite 从项目根提供 `/resource/`。
- 构建复制 `resource/` 到 `dist/resource/`；打包配置生成 Windows x64 NSIS 安装包。

## 怎样确认

环境：Windows 11，Node v24.11.1，Electron 44.9.0，electron-builder 26.15.3，Vite 8.3.4，2026-10-17。

### 层内测试

```sh
npm test
```

实际结果：**12 pass / 0 fail**。

### 共享与角色回归（验证 ESM 切换）

```sh
node --test test/项目管理/event-bus.test.js test/美术/asset-manifest.test.js test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/敌方服务/waves.test.js test/游戏管线/game-state.test.js
```

实际结果：**120 pass / 0 fail**（战斗服务在此后新增 3 项测试，已复跑）。临时 ESM loader 不再需要。

### 构建

```sh
npm run build
```

实际结果：46 个模块；`dist/index.html` 8.66 kB、CSS 15.70 kB、JS 754.54 kB（gzip 199.22 kB）；`dist/` 约 19 MB，其中 `dist/resource/` 约 18 MB。Vite 提示单个 chunk 超过 500 kB（Three.js 体积），构建成功。

### Electron 冒烟与真实流程

```sh
node scripts/smoke-electron.js
```

全部检查 PASS：标题、canvas、装载、开始按钮、O4 钩子、开始后 `playing`、菜单隐藏、HUD 生命/弹药/波次、快照。

同一真实窗口进一步检查：

- 指针锁定丢失 → 暂停层；继续 → `playing`。
- ESC → 暂停；继续 → `playing`（显式兜底）。
- 站立被敌人击杀 → `over`；结算层正确显示本局成绩（两次复跑分别观察到 `200` 分/第 `1` 波/`2` 击杀/`0:06` 与 `0` 分/第 `1` 波/`0` 击杀/`0:05`）。
- 再次出击 → `playing`，生命 `100`、波次 `1`、得分 `0`。
- 暂停层“重新开始” → `playing`，暂停层隐藏，生命 `100`、波次 `1`、得分 `0`。
- M 静音开/关；F11 进入/退出全屏；左键射击 `30 → 26`；右键 ADS 开/关；R 换弹回到 30 发。
- 窗口缩放后继续射击仍消耗弹药，无页面异常。
- 罗盘方向：+100 像素鼠标移动使 yaw 减小、方位角 `002° → 019°`；-100 像素使方位角 `019° → 333°`。

### 打包

```sh
npm run pack
npm run dist
```

实际结果：

- `npm run pack` 退出码 0，生成 `release/win-unpacked/DUSTLINE.exe`；目录约 400 MB。
- `npm run dist` 退出码 0，生成 `release/DUSTLINE Setup 1.0.0.exe`（约 126 MB）与 `.blockmap`（约 135 KB）。
- 打包后的 `release/win-unpacked/DUSTLINE.exe` 实际启动、加载素材、进入对局并 ESC 暂停成功。
- 首次 `npm run pack` 曾因 `EPERM: operation not permitted, rename 'release/win-unpacked.tmp' -> 'release/win-unpacked'` 失败；加入 `electronDist: node_modules/electron/dist` 后稳定通过。详细说明见 [desktop-shell](../feature/desktop-shell.md)。

## 已知限制与未解决事项

- **正式视觉验收未执行。** 已在本机真实窗口截图检查菜单与 HUD 布局，但项目管理/美术尚未逐项签字。
- **战斗服务新增了 `setViewVisible()`。** 装配入口已调用它在菜单/结算隐藏第一人称武器、在对局/暂停显示；这是战斗服务侧的增量公开接口，需要项目管理知悉并让其他消费方复测。
- **没有真人完整游玩两波。** 本次自动化验证到第 1 波死亡与重开；跨角色完整流程应由独立测试角色执行。
- **音频只验证了初始化与静音开关**，没有实际听感/音量平衡验收。
- **安装包只生成、未安装**；代码签名证书、应用图标、安装/卸载流程未验证。
- **性能与内存未测量**：30 个敌人、长时间对局、连续重开 5 次的情况没有数据。
- **测试目录入口**：Node v24.11.1 会把 `node --test test/界面装配/` 的目录参数当作模块加载；已增加 `test/界面装配/index.js` 导入真实测试文件，使任务书给定的命令原样可运行。
- **asar 关闭**：为配合 `app://` + `net.fetch(file://)` 与打包后路径读取，当前使用 `asar: false`；electron-builder 提示不建议，但实际包可运行。

## v3 界面设置、爆头/方向受击与启动接线

日期：2026-10-17。设计依据：`docs/governance/2026-10-17_bootstrap-and-game-design.md` §12.3–§12.7 与 `docs/scheduling/neon-strike-delivery.md` V3-2 冻结契约。其他角色仍在升级中；本轮只写本角色第 1 节白名单内的文件。

### 写入路径

- `index.html`、`src/style.css`、`src/main.js`
- `src/interface/public/index.js`
- `src/interface/impl/hud.js`、`input.js`、新增 `settings.js`
- `scripts/smoke-electron.js`
- `test/界面装配/settings.test.js`、`hud-format.test.js`、`index.js`
- 本角色 `feature-map.md`、`memo.md`、`changelog.md`、`functional-description.md`、`api-spec.md`
- `docs/feature/match-interface.md`、`docs/feature/desktop-shell.md`、本文件

未修改：`electron/main.js`、`vite.config.js`、`package.json`、`package-lock.json`。

### 设置与面板

- 新增 `src/interface/impl/settings.js`：
  - `createSettings({ storage, defaults, ranges })` 返回 `load/save/merge/get/reset/validate/getDefaults/getRanges`。
  - 字段来自 Model：鼠标灵敏度 0.25–3.0、ADS 倍率 0.4–1.5、FOV 65–95、主音量 0–1、画质 high/low。
  - 使用 `normalizeSettings` / `clampSetting`；本地键 `dustline.settings.v3`；storage 可注入。
  - 损坏 JSON、非法字段、读写失败记录 `console.error` 并回退默认值。
  - `createSettingsPanel()`：滑杆/画质下拉/数值输出/恢复默认/关闭；变化实时 `game.applySettings()` 并保存。
- `index.html` 新增 `#settings` 面板、菜单 `#menu-settings-btn`、暂停 `#pause-settings-btn`、设置控件与数值输出。
- `src/style.css` 新增军用设置面板、滑杆、下拉与输出样式；无霓虹。
- `src/interface/public/index.js` 校验 `game.applySettings/getSettings`，接收 `settings` 存储，创建设置面板并注入 HUD；重新导出 `createSettings`。
- `src/main.js` 在 `createGame` 后 `createSettings({ storage: window.localStorage }).load()` 并 `game.applySettings(saved)`。

### HUD

- 敌人名称：`rifleman=步枪兵`、`heavy=重机枪手`、`breacher=突击兵`；移除 drone/brute/wraith 文案。
- `hud:hitmarker.headshot`：更大、偏红的专用命中标记与动画；`killed` 标记保留。
- `hud:killfeed.headshot`（兼容 `critical`）：击杀信息显示“爆头”。
- `hud:damage.direction`：准星周围短箭头，0 前、正值右；红色受伤边缘与低血状态保留。
- `getHud()` 增加 `settingsVisible`；武器标签保持 `AR-15 · 制式步枪`。
- 菜单简报、操作表、授权说明更新为人类士兵/爆头/设置。

### 输入隔离

- `input.js` 新增 `isBlocked` / `onBlockedEscape` 回调与 `clearPending()`。
- 设置面板打开时，移动/射击/换弹/视角输入不进入游戏；ESC 关闭面板。
- 从暂停打开设置时对局保持 `paused`。

### 装配

- `createEnemies` / `createCombat` 传 `assets`。
- `await enemies.load()` / `await combat.load()`；方法缺失或失败记录并继续，使用程序化回退。
- 竞技场有 `getDecals()` 时 `createEffects({ renderer, decals })`；否则 `createEffects({ renderer })` 并记录警告。
- O4 增加只读 `getSettings()` 与 `getPerformance()`。
- 装载提示更新为人类士兵模型、场景道具与后处理。

### 验证命令与实际结果

```sh
node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js
# tests 27 / pass 27 / fail 0

npm test
# tests 27 / pass 27 / fail 0

npm run build
# 成功；68 modules；dist/index.html 11.83 kB、CSS 18.59 kB、JS 1005.33 kB（gzip 292.79 kB）

node scripts/smoke-electron.js
# 全部 PASS；含 getSettings/getPerformance、设置面板、低画质关后处理、
# localStorage 写入、恢复默认、关闭面板、playing/HUD/快照
```

真实 Electron 补充检查：

- 两次启动：FOV 83 在第二次启动保留；打开面板时滑杆为 `83`、显示 `83°`；恢复默认回到 75。输出 `PASS: settings survived Electron relaunch` 与 `PASS: panel values reflect persisted settings on boot/open`。
- 暂停设置：ESC → `paused`；打开设置仍 `paused`、`settingsVisible=true`；ESC 关闭后暂停层仍在、state 仍 `paused`。
- 低画质：`getPerformance().quality === 'low'` 且 `postProcessing === false`。

### 未验证与依赖

- 正式 v3 视觉验收未执行。
- 真实战斗中的爆头标记、爆头击杀信息与方向受击箭头观感未人工验收。
- 环境引擎 v3 公共方法在本轮期间落地：`arena.getDecals()`、效果 `blood/bulletHole/muzzleSmoke/shell/enemyShot`、音频 `setMasterVolume/headshot/shellDrop/enemyShot`、渲染器 `setQuality/getQuality`。main 已把贴片系统传给效果服务；构建与冒烟通过，但实际弹孔/血雾/枪口烟/抛壳画面与音量听感仍需独立测试与视觉验收。
- `npm run pack` / `npm run dist` 本轮未执行（PM 统一最终打包）。
- 真人手感、音频听感、30 敌人性能、长时间内存、安装/卸载未验证。

## 相关功能

- [对局界面与输入](../feature/match-interface.md)
- [桌面启动与打包](../feature/desktop-shell.md)
- [游戏管线的对局生命周期](../../../游戏管线/docs/feature/match-flow.md)
