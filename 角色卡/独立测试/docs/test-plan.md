# 独立测试方案（v3）

- 角色：独立测试
- 更新：2026-10-17（v3 人类士兵、射击手感与美术升级；V3-4 ADS 黑镜修复回归）
- 被测候选：DUSTLINE 1.0.0（Electron 44.9.0，Node 24.11.1，npm 11.6.2）
- 依据：已确认设计 `docs/governance/2026-10-17_bootstrap-and-game-design.md` §12（v3，SHA-256 `781b…45ff`）；调度记录 `docs/scheduling/neon-strike-delivery.md` V3 节
- 边界：只写 `test/独立测试/` 与本角色文档；不修改业务源码、构建配置、其他角色测试或权限

## 1. 为什么这样测

玩家真正要做的事仍然是：双击桌面程序，看到菜单，点击开始，移动和射击，抵御人类士兵的波次，暂停再继续，死亡后重开。v3 把敌人从无人机换成三类人类士兵，并新增爆头、方向受击、设置面板、画质切换、后处理与性能仪表。只测各角色内部函数不能说明这些环节接在一起是否仍然成立，因此本角色从真实入口走完整流程，并把“没测到”的部分单独列出。

测试分四层：

1. **其他角色的单元/契约测试**：只复跑，作为回归基线，不替它们补断言。
2. **跨角色集成**：真实模块 + 契约兼容替身，验证状态流、事件顺序、计分、设置与人类装具尺度。
3. **Electron 端到端**：真实窗口、真实构建产物、真实输入，验证玩家能完成一局并保存设置。
4. **构建与打包**：真实执行命令并核对产物，不根据代码推断。

## 2. 覆盖范围

### 2.1 集成测试

文件：`test/独立测试/integration/game-flow.test.js`

使用真实模块：

- `src/common/shared/event-bus.js`（共享事件总线）
- `src/pipelines/public/game.js`（真实 `createGame` Pipeline）
- `src/services/public/combat.js`（真实战斗服务）
- `src/services/public/enemies.js`（真实敌方服务）
- `src/services/public/effects.js`（真实效果服务）
- `src/services/public/audio.js`（真实音频编排服务）
- `src/models/game-config.js`、`events.js`、`contracts.js`
- `src/services/impl/environment/arena-layout.js` 的布局、碰撞体与出生点纯函数
- `src/providers/public/three.js`（仅用于构造测试假人类 GLB）

替身与理由：

| 替身 | 为什么替换 | 保留了什么 |
| --- | --- | --- |
| 假渲染器 | Node 中不创建 WebGLRenderer | Provider 公共契约的 add/remove/attachToCamera/detachFromCamera/setCameraPose/getCameraPose/getWorldPosition/raycast，并记录 `setQuality`/`getQuality`/后处理状态；`raycast` 只返回当前目标查询里真实存在的命中盒 |
| 假竞技场服务 | 不构建 Three.js 场景，避免把渲染环境带入 Node | 直接复用真实布局、AABB 碰撞体、22–28 米出生点与 10 米玩家距离规则；一个用例把出生点固定，仅用于缩短弹丸命中时间 |
| 假音频引擎 | 不创建 AudioContext | 记录 tone/noise/setMuted/setMasterVolume 调用，由真实音频编排服务驱动 |
| 假人类素材 | 不读取真实 GLB 文件 | `loadGltf` 返回带 `CharacterArmature` 100 倍缩放的假骨骼场景；真实敌方服务仍执行克隆、装具挂载、动画映射与命中盒创建 |

覆盖场景（12 个用例）：

- 菜单 → 开始 → `playing` → 第 1 波 → `hud:update`（生命 100、弹药 30、波次 1）；第 1 波全部为步枪兵，状态只含 `rifleman/heavy/breacher`，不出现 `drone/brute/wraith`
- 真实 `getTargetQuery()` / `raycast` / `applyDamage`：身体命中 26、爆头 52（2 倍），爆头命中标记与击杀信息带 `headshot/critical`
- 人类敌人死亡使用 `world:blood` / `effects.blood`，不发 `world:explosion`、不调用 `effects.explosion`
- 真实敌人弹丸发出 `player:damage { amount, sourcePosition }`，Pipeline 扣血并发布 `hud:damage { amount, direction }`；方向在 -π..π；另有右/左/正后方的方向换算断言
- 暂停冻结战斗、敌人、存活时间与弹药；恢复后继续；`update(1.0)` 被限制为 0.05 秒
- 清空整波敌人后等待约 4.5 秒推进到第 2 波
- 第 2 波 4 步枪兵 + 4 重机枪手、第 3 波 3/3/3 的组成；第 1 波 70 生命与第 10 波 133 生命通过真实命中次数（3 次 / 6 次）观察缩放
- 死亡 → `game:state: over` → `hud:gameover`；重开复位得分/波次/击杀/生命/弹药
- 设置：默认值、范围夹紧、非法值抛错、`applySettings` 转发到真实战斗服务/假渲染器/假音频引擎、`settings:changed`、快照、重开后保留、`getPerformance()` 字段
- 人类装具：通过真实敌方服务加载假 GLB，验证头盔/面罩包围盒 < 0.5 米、装具世界缩放约 1、装具不贴近世界原点或相机、敌人根节点留在 22–28 米出生环带

### 2.2 Electron 端到端

文件：`test/独立测试/e2e/electron-smoke.test.js`

启动方式：`playwright-core` 的 `_electron.launch({ args: ['.'], env: { ...process.env, DUSTLINE_TEST: '1' } })`，从项目根目录启动真实 `electron/main.js` 与 `dist/`。

只通过 O4 只读钩子 `window.__DUSTLINE_TEST__ = { getState, getSnapshot, getHud, getSettings, getPerformance }` 读取状态；不添加写入钩子。设置只通过真实 DOM 控件修改。

覆盖场景（5 个用例）：

- 冒烟：窗口标题 `DUSTLINE · 尘埃战线`、canvas、装载完成、开始按钮、O4 钩子、默认设置与性能仪表、菜单截图
- 画面取证：开始对局后用真实 `mousemove` 输入环视四个方向，截取人类士兵、HUD、波次横幅与武器画面
- 完整流程：HUD 100/30/波次 1、WASD、射击耗弹、R 换弹、右键 ADS、ESC 暂停、暂停中采样高/低画质性能、低画质截图、死亡结算、再次出击复位
- ADS 黑镜回归：真实右键 ADS 后采样镜片中心亮度与红点，松开右键恢复 HIP，保存前后截图（详见 2.2.1）
- 设置：菜单与暂停面板、灵敏度/FOV/音量/画质、低画质 `getPerformance().postProcessing === false`、localStorage `dustline.settings.v3`、关闭 Electron 后重新启动验证 FOV 持久化、恢复默认

性能记录方法：在暂停画面采样 3 秒（渲染循环继续，敌人保留在场上且玩家不会继续受伤），每 250 ms 读一次 `getPerformance()`，并用 `frameCount` 增量 ÷ 墙钟时间计算实测帧率。记录客户区分辨率、设备像素比、敌人数量、画质与后处理状态。该数字是当前机器的运行采样，不是性能承诺。

### 2.2.1 ADS 黑镜回归（V3-4）

客户反馈右键 ADS 时红点镜内是黑色实心块。战斗服务把镜体改为开放隧道后，本角色在真实 Electron 对局中新增独立回归，不再只断言“能进入 ADS”：

1. 启动真实 Electron（`DUSTLINE_TEST=1`），通过开始按钮进入对局，按住右键 ADS。
2. 同时等待并断言 `getHud().aiming === true`、`getSnapshot().weapon.aiming === true`、准星 `.crosshair.aiming` 与 `#ads-indicator` 可见；等待约 650 ms 让视图模型完成 ADS 插值。
3. 保存全屏 `ads-after.png` 与以画面中心为中心的 160×160 裁剪 `ads-center-after.png`。
4. 在渲染进程内把裁剪 PNG 解码为 `ImageBitmap`，用 `OffscreenCanvas` 二维上下文 `getImageData` 统计：
   - 160×160 平均亮度 `0.2126R+0.7152G+0.0722B` 必须 > 40/255；
   - 镜片中心 40×40 的平均亮度必须 > 60/255（修复前约 53/255，黑镜会失败；修复后约 99–113）；
   - 中心裁剪内至少 3 个红点像素满足 `R > 120 && R > 1.4G && R > 1.4B`，`maxR >= 150`，高亮红点质心距画面中心 ≤ 45 px；
   - 唯一颜色数 > 32、亮度方差 > 50，证明看到的是场景而不是纯色填充。
5. 保存 `hip-after.png`：松开右键后断言 HUD/武器 `aiming === false`，武器回到右下腰射且不遮挡画面中心（状态 + 截图，不设像素阈值）。
6. 修复前证据从 `test/战斗服务/evidence/ads-fix/ads-before.png` 只读复制为 `ads-before.png`，不覆盖来源。
7. 无法在 Electron 获得 pointer lock 时，记录 `hasFocus`/锁定元素并把用例标记为 NOT RUN，不伪造通过。

截图目录：`test/独立测试/fixtures/screenshots-v3-ads-fix/`，不覆盖 v2 的 `fixtures/screenshots/` 或 v3 的 `fixtures/screenshots-v3/`。

本次运行还发现：Playwright 启动的 Electron 窗口在未聚焦时 Chromium 以 `WrongDocumentError` 拒绝 pointer lock。测试启动后显式 `show()/focus()` 窗口，并在 ADS 用例中确认 `document.pointerLockElement.id === 'game'`；这是测试环境处理，不是产品缺陷，也不放宽 ADS 断言。

### 2.3 构建与打包

- `npm run build`：必须成功。
- `dist/` 与 `dist/resource/`：必须存在。
- `release/win-unpacked/DUSTLINE.exe`、`release/DUSTLINE Setup 1.0.0.exe`：必须存在且非空。
- 打包产物是否为当前候选：核对 `release/win-unpacked/resources/app/dist/assets/` 与当前 `dist/assets/` 的构建文件名、大小与 SHA-256。
- 不在本角色重跑 `npm run dist`，除非前一次产物缺失或损坏；安装/卸载与快捷方式属于未验证项，需人工确认。
- 项目管理在全部 v3 阶段完成后重新打包时，本角色复验新产物；18:33/18:34 的 v3 产物已核对哈希并启动，结果见报告 §11。安装包本身的安装/卸载仍未验证。
- V3-4 修复后的 19:12/19:13 打包产物已核对：打包内 `index-0WrKp_Kr.js` 与当前 `dist` 同哈希；用 `executablePath` 启动打包应用并复跑真实 ADS 中心采样与 HIP 回归，结果见报告 §13，截图在 `fixtures/screenshots-v3-ads-fix/packaged-*.png`。复跑脚本为 `fixtures/ads-packaged-verify.mjs`（手工验证，不属于 `node --test` 套件）。

### 2.4 视觉证据

截图目录：`test/独立测试/fixtures/screenshots-v3/`（不覆盖 v2 的 `fixtures/screenshots/`）；ADS 黑镜修复证据在 `test/独立测试/fixtures/screenshots-v3-ads-fix/`（不覆盖前两者）。

截图只作为真实运行证据。画面是否符合写实军事方向由美术角色确认；本角色不替代视觉验收。

## 3. 验收判定

| 判定 | 含义 |
| --- | --- |
| PASS | 在当前候选与环境实际执行，断言全部通过 |
| FAIL | 实际执行且断言失败；记录复现步骤、预期/实际、影响角色 |
| NOT RUN | 本次未执行 |
| NOT VERIFIED | 已尝试但环境或操作受限；记录具体错误，不算通过 |

测试代码出现等待时序问题时，先修正测试本身并复跑；不能通过放宽产品断言或删除检查来“通过”。

## 4. 命令

```sh
node --test test/独立测试/integration/game-flow.test.js
node --test test/独立测试/e2e/electron-smoke.test.js
node --test test/项目管理/event-bus.test.js test/美术/asset-manifest.test.js \
  test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js \
  test/环境引擎/scene-systems.test.js \
  test/战斗服务/collision.test.js test/战斗服务/weapon.test.js \
  test/战斗服务/view-model.test.js \
  test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js \
  test/游戏管线/game-state.test.js \
  test/界面装配/settings.test.js test/界面装配/hud-format.test.js
npm run build
```

V3-4 ADS 黑镜复测（2026-10-17）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js
node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js
node --test test/独立测试/integration/game-flow.test.js
npm run build
node --test test/独立测试/e2e/electron-smoke.test.js
```

E2E 与打包启动需要桌面会话；无法启动 Electron 时，E2E 记为未运行并保留具体错误。

## 5. 不在本方案内

- 人工完整两波游玩与手感评价
- 人工听音（分层枪声、爆头提示、敌人枪声、环境声）
- 30 个人类士兵同时存在时的帧率、输入延迟与稳定性
- 连续重开 5 次的内存/场景对象增长测量
- NSIS 安装、卸载、桌面/开始菜单快捷方式
- 代码签名、发布证书、安装包图标
- 骨骼动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡的逐帧视觉验收

这些项目在日期化报告中明确列为未验证，不能由本方案自动视为通过。

## 6. 缺陷与复测

发现缺陷时向项目管理报告：候选版本、环境、最小复现步骤、预期、实际、影响角色与范围。修复后复测原问题和受影响的完整流程；新版本结果写新报告，不覆盖旧报告。
