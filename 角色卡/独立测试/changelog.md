# 变更日志：独立测试

## 2026-10-17

### 新增

- `test/独立测试/integration/game-flow.test.js`：7 个跨角色集成用例，覆盖开始/波次/HUD、移动与真实射线击杀、敌人弹丸伤害转发、暂停恢复、dt 上限、整波清空后推进、死亡与重开。
- `test/独立测试/e2e/electron-smoke.test.js`：2 个真实 Electron 用例，覆盖窗口冒烟与完整流程（开始、HUD、WASD、射击、换弹、瞄准、暂停、继续、重开、死亡、结算、再次出击）。
- `test/独立测试/fixtures/screenshots/`：菜单、对局、暂停、结算与未压缩应用菜单截图。
- `docs/test-plan.md`：测试分层、覆盖范围、替身边界、命令与判定。
- `docs/reports/2026-10-17_report_initial-verification.md`：初始独立验证报告。
- `feature-map.md`、`functional-description.md`、`changelog.md`。

### 更新

- `memo.md`：记录当前环境、验证结果、下一轮关注点与 HUD 一帧时序注意点。
- 2026-10-17 晚些时候：项目管理重新执行 `npm run pack` / `npm run dist` 后，本角色复验 `release/win-unpacked/DUSTLINE.exe`（15:51:17）与 `release/DUSTLINE Setup 1.0.0.exe`（15:51:40）；打包内 `index-ClkC91v5.js` 与当前 `dist` 哈希一致；刷新 `packaged-menu.png`；报告补充美术视觉结论与三项非阻断跟进。

### 测试结果

- 集成：7 pass / 0 fail。
- Electron E2E：2 pass / 0 fail。
- 现有单元/契约：132 pass / 0 fail。
- 无参数 `node --test`：154 pass / 0 fail（含重复发现的 HUD 用例与空 loader 文件，见报告说明）。
- `npm run build`：成功；存在单个 chunk 超过 500 kB 的警告。

### 说明

- 未修改生产代码、构建配置、其他角色测试或权限。
- 首轮 E2E 因测试等待 HUD 更新的位置早了一帧而失败，修正测试等待后复跑通过；不属于产品缺陷。

## 2026-10-17（v3 人类士兵升级）

### 更新

- `test/独立测试/integration/game-flow.test.js`：从 7 个用例扩展到 12 个，覆盖人类兵种替换、身体 26/爆头 52、血雾而非爆炸、受伤方向、第 2/3 波组成与生命缩放、设置/性能、假 GLB 装具世界尺度。
- `test/独立测试/e2e/electron-smoke.test.js`：从 2 个用例扩展到 4 个，新增画面取证（四方向人类士兵）、高/低画质性能采样、菜单/暂停设置、跨重启 FOV 持久化与恢复默认。
- `test/独立测试/fixtures/screenshots-v3/`：新增 v3 菜单、人类士兵对局、武器/ADS、设置、暂停、结算、低画质截图；v2 的 `fixtures/screenshots/` 保留。
- `docs/test-plan.md`：更新到 v3 覆盖范围、替身边界、性能采样方法与打包核对。
- `docs/reports/2026-10-17_report_initial-verification.md`：追加 §10 v3 验证；§1–§9 v2 历史保留。
- `feature-map.md`、`memo.md`、`functional-description.md`：同步 v3 测试资产、结果与未验证项。

### 测试结果

- 集成：12 pass / 0 fail（252.9609 ms）。
- Electron E2E：4 pass / 0 fail（25 925.1654 ms）。
- 角色单元/契约：209 pass / 0 fail（259.8718 ms）。
- `npm run build`：成功，68 modules，`index-B44tpa5e.js` 1,008.43 kB，SHA-256 `777f09e9…fb35e`；仅有 >500 kB chunk 警告。
- 性能采样：1584 × 861、6 个步枪兵；高画质 180.03 fps、低画质 180.12 fps（暂停画面，frameCount/墙钟）；不写“60fps”。

### 发现

- 未发现阻断核心流程的功能缺陷。
- `release/` 已由项目管理于 18:33/18:34 重新打包为 v3：未压缩应用、安装包均更新，打包内 `index-B44tpa5e.js`（1,008,431 字节，SHA-256 `777f09e9…fb35e`）与当前 `dist` 一致；已启动复核并新增 `packaged-menu-v3.png`。安装包安装/卸载仍未验证。
- 30 敌人高画质、人工两波手感/听音、5 次重开内存、安装/卸载、动画/穿模逐帧验收仍未验证。

### 说明

- 未修改生产代码、构建配置、其他角色测试或权限。
- E2E 的两处失败均来自测试时序/持久化状态：设置跨运行继承、环视截图期间玩家死亡；已通过恢复默认设置、拆分画面取证用例、指针锁定暂停恢复修正，不是产品缺陷。

### 打包复核（18:33–18:34）

- 核对新 `release/win-unpacked/DUSTLINE.exe`（18:33:43）、`release/DUSTLINE Setup 1.0.0.exe`（18:34:16）与打包内 `index-B44tpa5e.js` 哈希。
- 用 Playwright `executablePath` 启动未压缩应用：默认模式标题/装载/开始按钮正常、O4 钩子为 `undefined`；`DUSTLINE_TEST=1` 下进入 playing、HUD 100/30/波次 1、第 1 波敌人为 2 个步枪兵，无页面异常。
- 新增截图 `fixtures/screenshots-v3/packaged-menu-v3.png`；报告追加 §11。
- 安装包安装/卸载、快捷方式、签名与图标仍未验证。

## 2026-10-17（V3-4 ADS 黑镜修复复测）

### 更新

- `test/独立测试/e2e/electron-smoke.test.js`：新增第 5 个用例“Electron ADS 黑镜回归：真实右键瞄准后中心亮度、红点、HIP 恢复与前后截图”。真实 Electron + `DUSTLINE_TEST=1` + pointer lock；等待 HUD/武器/准星/ADS 指示器进入 ADS；保存 `ads-after.png`、160×160 `ads-center-after.png`、`hip-after.png`；在页面内用 `ImageBitmap` + `OffscreenCanvas` 解码采样平均亮度、方差、唯一颜色、红点像素/亮度/质心；松开右键断言 `aiming === false`。
- E2E 启动流程增加窗口 `show()/focus()`，并新增 `ensurePointerLock()`；ADS 用例在无法取得指针锁定时标记 NOT RUN 而不是伪造通过。
- `test/独立测试/fixtures/screenshots-v3-ads-fix/`：新增修复前（只读复制自战斗服务证据）、修复后全屏、中心裁剪与 HIP 截图；不覆盖 v2/v3 截图。
- `docs/test-plan.md`：新增 2.2.1 ADS 黑镜回归范围、阈值、截图目录与 V3-4 复测命令。
- `docs/reports/2026-10-17_report_initial-verification.md`：追加 §12 V3-4 ADS 黑镜修复独立复测；§1–§11 历史保留。
- `feature-map.md`、`memo.md`、`functional-description.md`：同步 ADS 回归资产、阈值与观察项。

### 测试结果

- 战斗结构（collision/weapon/view-model）：65 pass / 0 fail（170.1043 ms）。
- 敌方（waves/human-visual）：38 pass / 0 fail（166.1812 ms）。
- 界面（settings/hud-format）：27 pass / 0 fail（93.9218 ms）。
- 跨角色集成：12 pass / 0 fail（294.627 ms）。
- Electron E2E：5 pass / 0 fail / 0 skipped（31,702.4025 ms）。
- `npm run build`：成功，68 modules，`index-0WrKp_Kr.js` 1,009.43 kB，SHA-256 `6b8491f903310287b9e00998eeed6b646726e5fcf068ce236a331eb0095b971d`；仅 >500 kB chunk 警告。

### 发现

- ADS 中心 160×160 平均亮度 130.17/255；镜片中心 40×40 平均亮度 113.57/255；maxR 245；红点像素 37；高亮红点质心 (80,101)，比画面几何中心低约 21 px；唯一颜色 814、方差 1647.41；HIP `aiming === false`。黑镜修复的自动化中心采样断言 PASS。
- 首次 E2E 运行因 Playwright Electron 窗口未聚焦，Chromium 以 `WrongDocumentError` 拒绝 pointer lock，导致完整流程射击与 ADS 用例 2 项失败；显式聚焦窗口后同构建 5/5 通过。属于测试环境问题，未修改生产代码。
- 红点质心比屏幕几何中心低约 21 px（约 2.4% 高度），本轮不判定为缺陷，交战斗/美术确认是否需进一步对齐。
- O4 钩子未暴露相机 FOV，未对 ADS FOV 54° 做数值断言；已记录为验证边界。

### 说明

- 未修改生产代码、构建配置、其他角色测试或权限；只复制战斗服务的修复前证据，不改动来源。
- 本轮未运行 `pack`/`dist`；§11 的打包产物是修复前构建，需要项目管理重新打包后复验。

### 打包复测（19:12–19:13）

- 核对 `release/win-unpacked/DUSTLINE.exe`（247,184,896 字节，19:12:40）、`release/DUSTLINE Setup 1.0.0.exe`（132,636,138 字节，19:13:10）与打包内 `index-0WrKp_Kr.js`（1,009,431 字节，SHA-256 `6b8491f9…971d`，与当前 `dist` 一致）。
- 用 Playwright `executablePath` 启动打包应用（`DUSTLINE_TEST=1`，显式聚焦），真实 pointer lock 下右键 ADS 复跑中心采样：160×160 平均亮度 142.79/255、镜片中心 40×40 113.63/255、maxR 220、红点像素 36、质心 (79,103)（中心下方 23 px）；HIP `aiming=false`；页面异常 0。
- 新增 `fixtures/screenshots-v3-ads-fix/packaged-ads-after.png`、`packaged-ads-center-after.png`、`packaged-hip-after.png`；首次打包运行含 HUD 方向受击三角，保留为 `packaged-ads-*-with-damage-chevron.png`，连通域分析确认实际红点簇 (79.5,101.6)。
- 新增手工复跑脚本 `fixtures/ads-packaged-verify.mjs`（不属于 `node --test` 套件，不被生产代码引用）。
- 报告追加 §13；安装/卸载、签名、人工视觉验收与 ADS FOV 数值断言仍未验证。
