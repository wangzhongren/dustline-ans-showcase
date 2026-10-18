# 初始独立验证报告（2026-10-17）

- 角色：独立测试
- 候选：DUSTLINE 1.0.0
- 被测内容：跨角色集成、Electron 完整流程、构建与打包产物、真实截图
- 结论：本次实际执行的集成测试 7/7 通过，Electron 端到端 2/2 通过，现有单元/契约测试 132/132 通过，无参数 `node --test` 154/154 通过，构建成功，重新打包后的未压缩应用可启动。未发现阻断核心流程的功能缺陷。美术角色已于 2026-10-17 接受写实军事视觉方向；人工两波游玩、听音、性能/内存、安装升级与三项非阻断视觉跟进仍未验证。

## 1. 环境与候选

| 项目 | 实际值 |
| --- | --- |
| 操作系统 | Windows 11 Home China 10.0.26200 |
| Node.js | v24.11.1 |
| npm | 11.6.2 |
| Electron | 44.9.0 |
| 应用版本 | 1.0.0 |
| 渲染引擎 | Chromium（Electron 内置）；Three.js 0.186.1 |
| 测试驱动 | playwright-core 1.64.1 |
| 构建工具 | Vite 8.3.4 |
| 日期 | 2026-10-17 |

本次验证没有修改任何生产代码、构建配置或其他角色测试。新增内容只有 `test/独立测试/` 与本角色文档。

候选标识：

- E2E 在 2026-10-17 15:47:42 重新构建的 `dist/` 上复跑：`dist/assets/index-ClkC91v5.js`（755.34 kB）、`dist/assets/index-C793tcTD.css`（15.70 kB）、`dist/index.html`（8.66 kB）。集成测试直接导入源码，不依赖 `dist/`。
- 项目管理和美术完成最终视觉/契约修改后，于 2026-10-17 15:51 重新执行 `npm run pack` 与 `npm run dist`。当前 `release/win-unpacked/DUSTLINE.exe` 时间为 15:51:17（247 184 896 字节），`release/DUSTLINE Setup 1.0.0.exe` 时间为 15:51:40（131 693 273 字节）。`release/win-unpacked/resources/app/dist/assets/index-ClkC91v5.js` 与当前 `dist/assets/index-ClkC91v5.js` 的 SHA-256 相同：`ead333ba45f319d09d839acfb8af038a99ef0bf586f0a8fe37ee2b62e5702b4c`。本角色已复验重新打包后的未压缩应用，详见 §9。

## 2. 执行的命令与结果

### 2.1 集成测试

```sh
node --test test/独立测试/integration/game-flow.test.js
```

结果：**7 pass / 0 fail / 0 skipped / 0 todo**，用时 139.137 ms。

通过的用例：

1. 开始对局：真实 Pipeline 进入 playing、第一波开始并发布 HUD
2. 移动与射击：真实战斗射线击杀敌人，得分/击杀/HUD 反馈增加
3. 真实敌人弹丸伤害经 Pipeline 转发给战斗服务
4. 暂停冻结战斗、敌人与存活时间，恢复后继续推进
5. 单帧时间被限制为 0.05 秒
6. 清空第 1 波后等待 4.5 秒推进到第 2 波
7. 死亡进入结算，重开重置得分/波次/击杀/生命并回到 playing

### 2.2 Electron 端到端

```sh
node --test test/独立测试/e2e/electron-smoke.test.js
```

结果：**2 pass / 0 fail / 0 skipped**，用时 14 953.3035 ms。本次在重新构建 `dist/` 之后复跑，证据对应当前构建产物。

- 冒烟用例：窗口标题、canvas、装载完成、开始按钮、O4 只读钩子、菜单截图。
- 完整流程用例：开始、HUD、WASD、射击、换弹、瞄准、暂停、继续、重开、死亡、结算、再次出击。

启动参数：`args: ['.']`，`cwd` 为项目根目录，环境变量 `DUSTLINE_TEST=1`。

### 2.3 现有单元/契约测试

```sh
node --test test/项目管理/event-bus.test.js test/美术/asset-manifest.test.js \
  test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js \
  test/战斗服务/collision.test.js test/战斗服务/weapon.test.js \
  test/敌方服务/waves.test.js test/游戏管线/game-state.test.js \
  test/界面装配/hud-format.test.js
```

结果：**132 pass / 0 fail / 0 skipped**，用时 155.9956 ms。

另外执行了无参数的全量发现：

```sh
node --test
```

结果：**154 pass / 0 fail / 0 skipped**，用时 15 237.915 ms。该数字包含 132 个现有测试、7 个集成用例、2 个 Electron E2E，以及 `test/界面装配/index.js` 再次导入 `hud-format.test.js` 造成的 12 个重复 HUD 用例；`test/项目管理/esm-loader.mjs` 也被测试运行器作为空测试文件发现。重复计数不影响通过结论。

### 2.4 构建

```sh
npm run build
```

结果：退出码 0。45 个模块转换完成，耗时 157 ms，资源目录已复制到 `dist/resource/`。

构建输出：

```text
dist/index.html                   8.66 kB │ gzip: 2.74 kB
dist/assets/index-C793tcTD.css   15.70 kB │ gzip: 4.19 kB
dist/assets/index-ClkC91v5.js   755.34 kB │ gzip: 199.39 kB
```

Vite 报告一条警告：单个 chunk 超过 500 kB。构建成功，但这是需要后续关注的体积警告，不是本次流程失败。

### 2.5 打包产物

| 产物 | 实际结果 |
| --- | --- |
| `release/win-unpacked/DUSTLINE.exe` | 存在，247 184 896 字节，2026-10-17 15:51:17（重新打包） |
| `release/DUSTLINE Setup 1.0.0.exe` | 存在，131 693 273 字节，2026-10-17 15:51:40（重新打包） |
| `release/win-unpacked/resources/app/dist/assets/index-ClkC91v5.js` | 与当前 `dist/` 同名文件 SHA-256 相同（`ead333ba45f319d09d839acfb8af038a99ef0bf586f0a8fe37ee2b62e5702b4c`） |
| `release/win-unpacked/` 总体积 | 约 400 MB |
| `dist/` 总体积 | 约 19 MB |

项目管理层在最终视觉/契约修改后重新执行了 `npm run pack` 与 `npm run dist`；两个产物均重新生成，未压缩应用内的构建文件与当前 `dist/` 哈希一致。

用 Playwright Electron 的 `executablePath` 启动重新打包后的未压缩应用：

- 窗口标题：`DUSTLINE · 尘埃战线`
- 开始按钮：可见且可用
- 装载遮罩：已隐藏
- `window.__DUSTLINE_TEST__`：`undefined`（默认关闭，符合 O4 设计）
- Electron 版本：44.9.0
- `app.getAppPath()`：`D:\work\creategame\shooter3d\release\win-unpacked\resources\app`
- 关闭：正常退出
- 截图：`test/独立测试/fixtures/screenshots/packaged-menu.png`（重新打包后刷新）
- 本次没有重新执行安装包安装/卸载；该部分仍为未验证。

## 3. 覆盖结果

| 流程步骤 | 结果 | 实际观察 |
| --- | --- | --- |
| 启动/菜单 | PASS | 真实 Electron 窗口标题为 `DUSTLINE · 尘埃战线`；`#game` canvas 存在；装载遮罩隐藏；开始按钮可见；O4 钩子仅在 `DUSTLINE_TEST=1` 时存在 |
| 开始 | PASS | 点击 `#start-btn` 后状态由 `menu` 变为 `playing`；`menuVisible=false`；HUD 不再隐藏 |
| HUD 初始值 | PASS | `health=100`、`ammo=30`、`wave=1`、`score=0`、`kills=0` |
| 移动 | PASS | E2E 中 W 使 Z 减小、S 使 Z 增大、A 使 X 减小、D 使 X 增大；每方向按住 350 ms，位置变化均超过 0.5 米 |
| 射击 | PASS | 左键按住 500 ms 后弹药从 30 降到 24；集成测试中用真实战斗射线与 `applyDamage` 以两发身体命中（26+26）击杀 50 生命无人机 |
| 命中/击杀反馈 | PASS | 集成测试观察到 `hud:hitmarker`（先 killed=false，后 killed=true）、`hud:killfeed`（drone/100）、`world:shot`、`world:explosion`；得分 +100、击杀 +1 |
| 第 1 波生成 | PASS | 集成测试 `totalInWave=6`、`spawned=6`；E2E 开始时观察到 `alive=1`、`pendingSpawns=5` |
| 波次推进 | PASS | 集成测试清空 6 个敌人后，等待 89–92 个 0.05 秒步长（约 4.5 秒），`wave` 从 1 变为 2，发出 `wave:cleared` 与第 2 波横幅 |
| 敌人伤害转发 | PASS | 使用固定 5 米出生点的真实无人机弹丸；在 400 步（20 秒模拟时间）上限内玩家生命下降，出现 `player:damage`、`hud:damage` |
| 暂停 | PASS | ESC 后状态为 `paused`，暂停界面可见；集成测试中 12 次 0.5 秒 update 后玩家位置、生命、弹药、存活时间与敌人状态均不变 |
| 恢复 | PASS | 点击 `#resume-btn` 后状态回到 `playing`；输入继续驱动移动；探针中指针锁定元素重新为 `#game` |
| 死亡结算 | PASS | E2E 静止观察：0 秒生命 100、2 秒 100、4 秒 68、6 秒 12、8 秒状态 `over`、生命 0；结算界面显示得分 0、波次 1、击杀 0、存活 0:06 |
| 重开 | PASS | 暂停界面重开与结算界面重开都回到 `playing`；得分 0、击杀 0、波次 1、生命 100、弹药 30、`alive=true`，可命中目标列表为空 |
| dt 上限 | PASS | `update(1.0)` 后玩家位移不超过 5.6 × 0.05 米，存活时间不超过 0.05 秒 |
| 指针锁定 | PASS | 本次自动化环境中 Electron 授予指针锁定，`document.pointerLockElement.id` 为 `game`；未出现指针锁定被拒绝的错误 |
| 页面异常 | PASS | 完整流程结束时没有未捕获的页面异常（`pageerror` 为空） |

## 4. 集成测试的真实模块与替代

真实模块：共享事件总线、真实 `createGame` Pipeline、真实战斗服务、真实敌方服务、真实效果服务、真实音频编排服务、真实 Model 与真实竞技场布局/碰撞/出生点纯函数。

替代部分：

- **渲染器**：Node 中不创建 WebGLRenderer。替身实现 Provider 公共契约，`raycast` 只返回当前 `getTargetQuery()` 列表中真实存在的敌人网格，保证战斗服务仍走真实命中扫描与 `applyDamage`。
- **竞技场服务**：不构建 Three.js 场景，但碰撞体与出生点直接来自真实 `arena-layout.js`。一个伤害用例把敌人出生点固定在玩家正前方 5 米，用于缩短弹丸飞行时间；敌人 AI、弹丸、伤害事件与 Pipeline 转发仍是真实实现。
- **音频引擎**：不创建 AudioContext；真实音频编排服务调用记录参数的假引擎。该用例证明接线存在，不证明实际听感。

## 5. 截图

| 文件 | 内容 |
| --- | --- |
| `test/独立测试/fixtures/screenshots/e2e-menu.png` | 真实 Electron 主菜单：DUSTLINE 标题、作战简报、操作说明、进入训练场按钮、背景竞技场 |
| `test/独立测试/fixtures/screenshots/e2e-gameplay.png` | 点击开始后的对局画面：HUD、罗盘、第 1 波横幅、生命 100、弹药 30、第一人称步枪、竞技场障碍 |
| `test/独立测试/fixtures/screenshots/e2e-pause.png` | ESC 暂停界面：已暂停、继续行动、重新开始、生命 68、画面中可见无人机 |
| `test/独立测试/fixtures/screenshots/e2e-gameover.png` | 死亡结算界面：你已倒下、得分 0、波次 1、击杀 0、存活 0:06、再次出击 |
| `test/独立测试/fixtures/screenshots/packaged-menu.png` | `release/win-unpacked/DUSTLINE.exe` 启动后的菜单，画面与开发构建一致 |

截图分辨率均为 1584 × 861 CSS 像素；这是 1600 × 900 窗口扣除窗口边框后的客户区尺寸，不是画面裁剪错误。

视觉结论：美术角色于 2026-10-17 复核 `test/项目管理/screenshots/menu-04.png` 与 `gameplay-03.png`，接受写实军事方向（低饱和橄榄绿、卡其、混凝土灰、阴天、无霓虹）。本角色本轮的 E2E 截图保留为实际运行证据，不代替该视觉结论；三项非阻断跟进见 §6.2。

## 6. 缺陷与观察

### 6.1 功能缺陷

本次实际执行的流程中没有发现阻断功能缺陷，也没有发现需要回派其他角色修复的断言失败。

### 6.2 非阻断观察

1. **构建体积警告**
   - 现象：`dist/assets/index-ClkC91v5.js` 为 755.34 kB，Vite 警告超过 500 kB。
   - 影响：构建仍成功；对启动时间与内存的实际影响本次未测量。
   - 归属：界面装配（构建配置）。
   - 说明：这是警告，不是本次流程失败。

2. **视觉方向已验收，三项跟进未完成**
   - 2026-10-17 美术角色复核 `test/项目管理/screenshots/menu-04.png` 与 `gameplay-03.png`，接受写实军事方向：低饱和橄榄绿、卡其、混凝土灰、阴天、无霓虹。
   - 三项非阻断跟进：fabric luma-preserving khaki remap（帆布在保持亮度的前提下重映射为卡其色）；rifle dark-tone separation（步枪暗部层次区分）；wood saturation（木材饱和度调整）。
   - 归属：按跟进项实际内容由项目管理分派给美术、环境引擎或战斗服务。
   - 说明：这些是视觉改进项，不阻断本次核心流程；视觉方向本身已通过美术验收。

3. **开发模式控制台安全警告**
   - 现象：未打包运行时 Electron 输出缺少 Content-Security-Policy 的安全警告。
   - 影响：本次未观察到功能影响；打包应用与开发模式的策略是否一致未验证。
   - 归属：界面装配。
   - 说明：属于安全加固观察，不影响本轮流程结论。

4. **测试过程说明**
   - 首轮 E2E 的换弹步骤读取 HUD 早于 `hud:update` 一帧，导致测试自身断言失败；改为等待 HUD 自身进入换弹状态后复跑通过。
   - 这是测试等待位置问题，不是产品缺陷；生产代码未改动。

## 7. 明确未验证

以下项目本次没有实际执行或没有足够证据，不能视为通过：

- 人工完成至少 2 波的真实游玩与手感评价。
- 人工听音：射击、命中、击杀、换弹、空仓、受伤、爆炸、拾取、波次与游戏结束音效。
- 30 个敌人同时存在、含弹丸与效果时的帧率、输入延迟和稳定性。
- 连续开始/重开 5 次后的场景对象数量与内存增长；本次只执行了两次重开。
- NSIS 安装包的安装、卸载、安装目录选择、桌面/开始菜单快捷方式。
- 代码签名、发布证书、安装包图标。
- 美术角色提出的三项非阻断视觉跟进：fabric luma-preserving khaki remap、rifle dark-tone separation、wood saturation。视觉方向本身已由美术角色于 2026-10-17 接受。
- 真实玩家鼠标灵敏度、后坐力手感与长时间游玩舒适度。

## 8. 复测说明

本报告对应 2026-10-17 的候选与上述环境。若生产代码、构建配置、共享契约或素材发生变化，受影响结果失效，需要重新执行集成、E2E、构建与打包核对；旧报告保留，不覆盖。

## 9. 重新打包与视觉结论补充（2026-10-17 晚些时候）

项目管理和美术完成最终视觉/契约修改后，重新执行了打包。本角色对重新生成的产物做了独立核对：

- `release/win-unpacked/DUSTLINE.exe`：2026-10-17 15:51:17，247 184 896 字节。
- `release/DUSTLINE Setup 1.0.0.exe`：2026-10-17 15:51:40，131 693 273 字节。
- `release/win-unpacked/resources/app/dist/assets/index-ClkC91v5.js` 与当前 `dist/assets/index-ClkC91v5.js` 的 SHA-256 均为 `ead333ba45f319d09d839acfb8af038a99ef0bf586f0a8fe37ee2b62e5702b4c`。
- 重新打包结果：两个产物均重新生成；未压缩应用内的渲染构建与本次 E2E 使用的 `dist` 哈希一致。

用 Playwright Electron 的 `executablePath` 重新启动 `release/win-unpacked/DUSTLINE.exe`：

- 窗口标题：`DUSTLINE · 尘埃战线`（符合预期）。
- 装载遮罩：已隐藏。
- 开始按钮：可见且可用。
- `window.__DUSTLINE_TEST__`：`undefined`（默认关闭）。
- Electron 版本：44.9.0。
- `app.getAppPath()`：`D:\work\creategame\shooter3d\release\win-unpacked\resources\app`。
- 关闭：正常退出。
- 截图已刷新：`test/独立测试/fixtures/screenshots/packaged-menu.png`。

视觉结论：美术角色于 2026-10-17 复核 `test/项目管理/screenshots/menu-04.png` 与 `gameplay-03.png`，接受写实军事方向（低饱和橄榄绿、卡其、混凝土灰、阴天、无霓虹）。保留三项非阻断跟进：fabric luma-preserving khaki remap、rifle dark-tone separation、wood saturation。视觉方向不再列为“待验收”，三项跟进仍为未验证改进项。

本补充没有修改测试断言或生产代码；集成、E2E、单元/契约与构建结果继续适用于同一构建哈希。

## 10. v3 人类士兵升级独立验证（2026-10-17）

本节是 v3 的独立验证结果。§1–§9 保留为 v2 历史证据，对应 v2 构建 `index-ClkC91v5.js`（SHA-256 `ead333ba…5702b4c`）和 15:51 的打包产物；本节结论只适用于下面记录的新构建。v3 重新打包后的产物另见 §11，不能把 §1–§9 的 v2 结论套用到新包上。

### 10.1 环境与候选

| 项目 | 实际值 |
| --- | --- |
| 操作系统 | Windows 11 Home China 10.0.26200 |
| Node.js | v24.11.1 |
| npm | 11.6.2 |
| Electron | 44.9.0 |
| 应用版本 | 1.0.0 |
| 测试驱动 | playwright-core 1.64.1 |
| 构建工具 | Vite 8.3.4；Three.js 0.186.1 |
| 日期 | 2026-10-17 |

候选构建（`npm run build` 生成，E2E 使用同名构建）：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `dist/assets/index-B44tpa5e.js` | 1,008,431 字节（1,008.43 kB） | `777f09e993fb41ca614bf9fef1d92ce85145104a0358129a4846582be29fb35e` |
| `dist/assets/index-Ba2VKdvd.css` | 18,596 字节（18.59 kB） | `6e9bfc00ebef6f90c1c606bbb72a6d445324a2ba4fd0a0c45797bcdf7b1b53c9` |
| `dist/index.html` | 11,836 字节（11.83 kB） | `106661a992bcaeb54208d006053becb361ac14c3dbaca2a722010cb56c7a3605` |

最终构建再次生成同名同大小的 `index-B44tpa5e.js`；E2E 在当日 18:20 构建的同一文件名上执行，构建结果一致。`release/` 在初次验证时仍是 v2 产物；项目管理层随后于 18:33/18:34 重新打包，本角色已复核新产物并启动，结果见 §11。

### 10.2 执行的命令与结果

#### 集成测试

```sh
node --test test/独立测试/integration/game-flow.test.js
```

结果：**12 pass / 0 fail / 0 skipped / 0 todo**，用时 252.9609 ms。

通过的用例：

1. 开始对局：真实 Pipeline 进入 playing、第一波开始并发布人类士兵 HUD
2. 身体命中 26、爆头 52（2 倍），击杀信息与计分使用人类兵种
3. 人类敌人死亡使用血雾而非机械爆炸
4. 真实敌人弹丸伤害经 Pipeline 扣血，并发布带方向的 `hud:damage`
5. 受伤方向换算：来源在右为 +π/2，在左为 -π/2，正后方为 ±π
6. 暂停冻结战斗、敌人与存活时间，恢复后继续推进
7. 单帧时间被限制为 0.05 秒
8. 清空第 1 波后等待 4.5 秒推进到第 2 波
9. 人类兵种波次组成与缩放：第 2 波重机枪手、第 3 波突击兵、生命随波次提升
10. 死亡进入结算，重开重置得分/波次/击杀/生命并回到 playing
11. 设置：默认/范围/夹紧、转发、`settings:changed`、快照、重开保留与性能仪表
12. 人类士兵装具世界尺度：头盔/面罩小于 0.5 米，不贴近原点或相机，敌人留在出生环带

#### Electron 端到端

```sh
node --test test/独立测试/e2e/electron-smoke.test.js
```

结果：**4 pass / 0 fail / 0 skipped**，用时 25 925.1654 ms。

- 冒烟：窗口标题、canvas、装载完成、开始按钮、O4 只读钩子、默认设置、性能仪表、菜单截图。
- 画面取证：开始对局后环视四个方向，取得人类士兵、HUD、波次横幅与武器画面。
- 完整流程：开始、HUD 100/30/波次 1、WASD、射击耗弹、R 换弹、右键 ADS、ESC 暂停、高/低画质性能采样、低画质截图、死亡结算、再次出击复位。
- 设置：菜单与暂停面板、灵敏度/FOV/音量/画质、低画质关闭后处理、localStorage、关闭 Electron 后重新启动验证 FOV=83 持久化、恢复默认。

指针锁定：本次自动化环境授予指针锁定，`document.pointerLockElement.id` 为 `game`；未出现指针锁定被拒绝的错误。若失败，测试会记录指针锁定元素并在断言信息中保留实际弹药数，不伪造通过。

#### 现有单元/契约测试

```sh
node --test test/项目管理/event-bus.test.js test/美术/asset-manifest.test.js \
  test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js \
  test/环境引擎/scene-systems.test.js \
  test/战斗服务/collision.test.js test/战斗服务/weapon.test.js \
  test/战斗服务/view-model.test.js \
  test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js \
  test/游戏管线/game-state.test.js \
  test/界面装配/settings.test.js test/界面装配/hud-format.test.js
```

结果：**209 pass / 0 fail / 0 skipped / 0 todo**，用时 259.8718 ms。包含事件总线、美术清单、环境 Provider/布局/场景系统、战斗碰撞/武器/视图模型、敌方波次/人类视觉、管线状态、界面设置/HUD。

#### 构建

```sh
npm run build
```

退出码 0，68 个模块转换完成，用时 196 ms，`resource/` 已复制到 `dist/resource/`。

```text
dist/index.html                    11.83 kB │ gzip:   3.50 kB
dist/assets/index-Ba2VKdvd.css     18.59 kB │ gzip:   4.72 kB
dist/assets/index-B44tpa5e.js   1,008.43 kB │ gzip: 294.05 kB
```

Vite 报告单个 chunk 超过 500 kB 的警告；构建成功，这是体积警告，不是流程失败。

### 10.3 覆盖结果

| 检查项 | 结果 | 实际证据 |
| --- | --- | --- |
| 人类敌人替换机械敌人 | PASS | 集成第 1 波 `types` 全部为 `rifleman`；E2E 状态只含 `rifleman/heavy/breacher`，`drone/brute/wraith` 不存在；渲染对象名为 `human-soldier-*` |
| 身体伤害 26 / 爆头 52 | PASS | 集成记录真实 `applyDamage` 参数：身体 `[26,26,26]` 击杀 70 生命步枪兵；爆头 `[52,52]` 击杀；爆头命中标记与击杀信息均带 `headshot=true`、`critical=true` |
| 人类死亡反馈 | PASS | `world:blood` ≥ 2、真实 `effects.blood` 被调用；`world:explosion` = 0、`effects.explosion` = 0 |
| 敌人伤害与方向 | PASS | 真实弹丸产生 `player:damage { amount, sourcePosition }` 与 `hud:damage { amount, direction }`；方向在 -π..π；右/左/正后方分别为 +π/2、-π/2、±π |
| 波次推进 | PASS | 清空 6 个步枪兵后 88–95 个 0.05 秒步长内进入第 2 波；`wave:cleared` 与第 2 波横幅正确 |
| 兵种组成与缩放 | PASS | 第 2 波 4 步枪兵 + 4 重机枪手；第 3 波 3/3/3；第 1 波 3 次身体命中击杀，第 10 波 6 次（70 → 133 生命） |
| 暂停/恢复/dt 上限 | PASS | 12 次 0.5 秒更新后位置、生命、弹药、存活时间、敌人状态不变；恢复后继续；`update(1.0)` 只推进 0.05 秒 |
| 死亡与重开 | PASS | 结算只发一次；重开回到 playing 且得分/波次/击杀/生命/弹药复位 |
| 设置面板与持久化 | PASS | 菜单与暂停均可打开；灵敏度/FOV/音量/画质写入 localStorage `dustline.settings.v3`；重新启动 Electron 后 FOV=83、画质=high 仍生效；恢复默认回 75/high |
| 低画质关闭后处理 | PASS | E2E `getPerformance().postProcessing === false`，`quality === 'low'`；高画质为 true |
| 性能仪表 | PASS | `getPerformance()` 包含 fps/frameCount/enemyCount/quality/postProcessing；快照含 settings/performance |
| 人类装具尺度 | PASS | 假 GLB 的 `CharacterArmature` 100 倍缩放下，装具世界缩放约 1.0；头盔/面罩包围盒 < 0.5 米；装具不贴近世界原点或相机；敌人根节点在 22–28 米环带 |
| 截图 | PASS | v3 菜单、人类士兵对局、武器/ADS、设置、暂停、结算、低画质截图均已保存（见 §10.5） |
| v3 打包产物启动 | PASS | `release/win-unpacked/DUSTLINE.exe`（18:33）标题、装载、开始按钮正常；默认模式无 O4 钩子；`DUSTLINE_TEST=1` 下开始/HUD/人类兵种正常（见 §11） |
| 死亡/重开真实窗口 | PASS | E2E 静止观察在 2 秒内由 playing 进入 over；结算界面显示得分 0、波次 1、击杀 0、存活 0:09；点击再次出击后复位 |

### 10.4 性能采样

采样方法：游戏暂停时渲染循环继续执行，场上保留 6 个第 1 波步枪兵；每 250 ms 读取一次 `getPerformance()`，采样 3 秒，并用 `frameCount` 增量 ÷ 墙钟时间计算实测帧率。暂停用于避免玩家在采样期间死亡，不代表高负载战斗场景的帧率。

| 项目 | 高画质 | 低画质 |
| --- | --- | --- |
| 客户区分辨率 | 1584 × 861（窗口 1600 × 900 扣除边框） | 1584 × 861 |
| devicePixelRatio | 1 | 1 |
| 场上敌人 | 6（全部步枪兵） | 6（全部步枪兵） |
| `quality` | high | low |
| `postProcessing` | true | false |
| frameCount 增量 / 墙钟秒 | 546 / 3.0328 s | 546 / 3.0313 s |
| 实测帧率（frameCount ÷ 墙钟） | 180.03 fps | 180.12 fps |
| `getPerformance().fps` 最终值 | 179.82 | 179.99 |
| 采样区间 | 179.75–180.29 | 179.73–180.28 |

两次采样都接近 180 fps，与当前显示器/rAF 节奏一致；在本次机器上高/低画质没有拉开可辨认的差异，因此这些数字不是 GPU 性能对比，也不能写成“60fps”。没有达到 30 个敌人：本轮没有修改生产代码来生成 30 敌人，实测敌人数量为 6；30 敌人高画质仍为未验证项。

### 10.5 截图

截图目录：`test/独立测试/fixtures/screenshots-v3/`（v2 截图保留在 `fixtures/screenshots/`）。

| 文件 | 内容 |
| --- | --- |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-menu.png` | 主菜单：DUSTLINE 标题、人类士兵作战简报、操作说明、开始/设置按钮 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-gameplay.png` | 从四方向取证中选出的对局画面：人类士兵、HUD、第 1 波横幅、第一人称步枪 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-gameplay-03.png` | 对局画面：两名人类士兵、一名正在开火，画面中可见敌方投射物/枪口效果 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-gameplay-04.png` | 对局画面：人类士兵靠近 HESCO/沙袋区域 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-weapon-ads.png` | 右键 ADS：红点镜居中、视野收窄、HUD 瞄准状态 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-settings.png` | 设置面板：灵敏度 1.40×、ADS 0.90×、FOV 83°、音量 55%、画质低 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-pause.png` | ESC 暂停界面：继续行动、设置、重新开始 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-gameover.png` | 结算界面：得分 0、波次 1、击杀 0、存活 0:09、再次出击 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-low-quality.png` | 低画质对局：后处理关闭后的场景与 HUD |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\e2e-gameplay-initial.png`、`e2e-gameplay-01.png`、`e2e-gameplay-02.png` | 同一轮取证的其他方向与初始画面 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\packaged-menu-v3.png` | v3 重新打包后的 `release/win-unpacked/DUSTLINE.exe` 启动菜单（18:33 产物） |

截图分辨率均为 1584 × 861 CSS 像素，是本环境 1600 × 900 窗口扣除边框后的客户区尺寸。截图只作为真实运行证据；写实军事视觉方向仍由美术角色验收。

### 10.6 缺陷与观察

未发现阻断核心流程的功能缺陷。以下为观察项，均未由本角色修改生产代码：

1. **打包产物（初次观察已解决）**
   - 初次验证时 `release/` 仍是 v2：`win-unpacked/DUSTLINE.exe` 15:51:17、247,184,896 字节；安装包 15:51:40、131,693,273 字节；打包内 `index-ClkC91v5.js` 755,346 字节，SHA-256 `ead333ba…5702b4c`。
   - 项目管理层随后于 18:33/18:34 重新打包：`release/win-unpacked/DUSTLINE.exe` 18:33:43、247,184,896 字节；`release/DUSTLINE Setup 1.0.0.exe` 18:34:16、132,635,856 字节；打包内 `index-B44tpa5e.js` 1,008,431 字节，SHA-256 `777f09e9…fb35e`，与当前 `dist/assets/index-B44tpa5e.js` 完全一致。
   - 结论：v3 未压缩应用已包含当前构建，并已实际启动复核（§11）。安装包的安装/卸载仍未验证。
2. **构建体积警告**
   - `dist/assets/index-B44tpa5e.js` 为 1,008.43 kB，Vite 警告超过 500 kB；构建成功。启动时间与内存影响本轮未测量。归属：界面装配（构建配置）。
3. **高/低画质性能采样没有拉开差异**
   - 本次机器上两种画质都稳定在约 180 fps，说明采样受 rAF/显示器节奏限制，不能据此判断后处理开销。没有写“60fps”，也没有把该数字当成性能验收。30 敌人高画质仍未验证。
4. **E2E 测试自身的时序修正（不是产品缺陷）**
   - 设置会跨 Electron 运行持久化，最初连续运行时会继承上一轮留下的低画质/FOV；测试改为每次先通过设置面板恢复默认值，再执行断言。
   - 环视截图时玩家可能被 6 名步枪兵打死，导致后续暂停断言失败；测试把画面取证拆成独立用例，并在指针锁定丢失导致暂停时点击继续。修正后 4/4 通过，生产代码未改。
5. **近距离敌方投射物/枪口效果**
   - `e2e-gameplay-03.png` 中玩家武器附近出现较大的暖橙色光团，与敌方投射物或枪口效果的 Bloom 观感一致；本轮没有把它判定为缺陷，建议美术/战斗在视觉验收时确认是否符合“可见曳光、给玩家躲避空间”的预期。

### 10.7 明确未验证

以下项目本轮没有实际执行或没有足够证据，不能视为通过：

- 人工完成至少 2 波的人类士兵游玩与手感评价；本轮 E2E 只在第 1 波停留，静止时约 9 秒被击杀。
- 人工听音：分层枪声、爆头提示、敌人枪声、换弹、弹壳、受伤、环境风声与远处交火。
- 30 个人类士兵同时存在时的帧率、输入延迟与稳定性；本轮性能采样为 6 个敌人。
- 连续开始/重开 5 次后的场景对象数量与内存增长；本轮 E2E 只执行了两次重开（暂停界面与结算界面各一次）。
- NSIS 安装包的安装、卸载、安装目录选择、桌面/开始菜单快捷方式；v3 未压缩应用已启动，但安装包本身未安装/卸载。
- 骨骼动画过渡、脚底贴地/滑步、装具逐帧穿模、持枪姿态、ADS/HIP 过渡的逐帧视觉验收。
- 真实玩家鼠标灵敏度、后坐力、FOV 冲击与长时间游玩舒适度。
- 真实指针锁定被拒绝的错误路径；本环境指针锁定成功。
- 后处理各 pass（SSAO/Bloom/分级/SMAA）的单独视觉对比；本轮只验证了开关状态与截图观感。

### 10.8 v2 与 v3 证据边界

§1–§9 是 v2 的历史结果，对应 `index-ClkC91v5.js`（`ead333ba…5702b4c`）和 15:51 的打包产物；其中的 7 个集成用例、2 个 E2E 用例和 132 个单元/契约结果不能作为 v3 证据。本节 12/12、4/4、209/209 与构建结果只对当前 `index-B44tpa5e.js`（`777f09e9…fb35e`）有效。若生产代码、共享契约、素材或构建配置继续变化，本节结果失效，需要重新执行集成、E2E、构建与打包核对；旧记录保留，不覆盖。

## 11. v3 重新打包复核（2026-10-17 18:33–18:34）

项目管理层完成 v3 最终打包后，本角色对新产物做了独立核对与启动验证。新增截图：`D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3\packaged-menu-v3.png`（不覆盖 v2 的 `fixtures/screenshots/packaged-menu.png`）。

### 11.1 产物核对

| 产物 | 实际结果 |
| --- | --- |
| `release/win-unpacked/DUSTLINE.exe` | 存在，247,184,896 字节，2026-10-17 18:33:43 |
| `release/DUSTLINE Setup 1.0.0.exe` | 存在，132,635,856 字节，2026-10-17 18:34:16 |
| `release/win-unpacked/resources/app/dist/assets/index-B44tpa5e.js` | 1,008,431 字节，SHA-256 `777f09e993fb41ca614bf9fef1d92ce85145104a0358129a4846582be29fb35e`，与当前 `dist/assets/index-B44tpa5e.js` 相同 |
| 打包内 `index-Ba2VKdvd.css` / `index.html` | 18,596 / 11,836 字节，与当前 `dist` 同名文件大小一致 |
| 打包内 `dist/resource/` | 存在，清单与授权文件为 v3 版本（2026-10-17 17:20） |

### 11.2 启动验证

用 Playwright Electron 的 `executablePath` 启动 `release/win-unpacked/DUSTLINE.exe`：

默认模式（不设置 `DUSTLINE_TEST`）：

- 窗口标题：`DUSTLINE · 尘埃战线`（PASS）
- Electron 44.9.0，应用版本 1.0.0，`app.getAppPath()` 为 `D:\work\creategame\shooter3d\release\win-unpacked\resources\app`
- 装载遮罩：已隐藏（PASS）
- 开始按钮：可见且启用（PASS）
- `window.__DUSTLINE_TEST__`：`undefined`（默认关闭，符合 O4 设计，PASS）
- 未捕获页面异常：0
- 截图：`packaged-menu-v3.png`（菜单、人类士兵作战简报、操作说明、开始/设置按钮）
- 关闭：正常退出

测试模式（`DUSTLINE_TEST=1`）：

- O4 只读钩子已暴露；装载遮罩隐藏；默认设置 `mouseSensitivity 1.0 / ads 0.8 / fov 75 / masterVolume 0.7 / quality high`
- 点击进入训练场后状态 `playing`；HUD `health 100 / ammo 30 / wave 1 / score 0 / kills 0`
- 等待生成后 `enemies.wave 1`、`alive 2`、`pendingSpawns 4`、`totalInWave 6`、`types { rifleman: 2, heavy: 0, breacher: 0 }`；没有 `drone/brute/wraith`
- `getPerformance()`：`fps 175.31`、`frameCount 112`、`enemyCount 2`、`quality high`、`postProcessing true`
- 未捕获页面异常：0；关闭正常

### 11.3 仍未验证

- `release/DUSTLINE Setup 1.0.0.exe` 的安装、卸载、安装目录选择、桌面/开始菜单快捷方式未执行。
- 代码签名、发布证书、安装包图标未验证。
- 30 敌人高画质性能、人工两波手感/听音、5 次重开内存、动画/穿模逐帧验收仍未验证（同 §10.7）。

本节只证明 18:33/18:34 的 v3 未压缩应用可以启动、进入对局并生成人类士兵；不替代安装/卸载、视觉与性能验收。v2 §9 的打包记录保留为历史，不覆盖。

## 12. V3-4 ADS 黑镜修复独立复测（2026-10-17）

本节是客户反馈“右键 ADS 时红点镜内是黑色实心块”后的独立复测。§1–§11 保留为 v2/v3 历史，不覆盖；本节结论只对下面记录的 `index-0WrKp_Kr.js` 构建有效。

### 12.1 根因（只读确认）与修复契约

根因与战斗服务 `docs/fix/2026-10-17_fix_ads-black-scope.md` 一致：`src/services/impl/combat/view-model.js` 的红点镜体原本是实心 `BoxGeometry(0.042, 0.045, 0.075)`，前脸不透明且位于镜片正后方；ADS 相机正对该实心前脸。镜片虽 `transparent: true`，但 `depthWrite` 默认开启，红点又是暗红色，进一步压黑。

冻结契约：镜体改为开放框体/开口环、中心完全中空、前后贯通；镜片低不透明度且 `depthWrite: false`；红点高亮、`toneMapped: false`、`depthWrite: false`、位于镜片中心；ADS 相机不进入镜体或贴近近裁剪面；HIP 外观不回归；独立测试在真实 Electron ADS 截图中采样中心亮度与红点。

### 12.2 候选构建

`npm run build` 于 2026-10-17 19:06 成功，68 个模块，用时 208 ms，退出码 0：

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `dist/assets/index-0WrKp_Kr.js` | 1,009,431 字节（1,009.43 kB） | `6b8491f903310287b9e00998eeed6b646726e5fcf068ce236a331eb0095b971d` |
| `dist/assets/index-Ba2VKdvd.css` | 18,596 字节（18.59 kB） | `6e9bfc00ebef6f90c1c606bbb72a6d445324a2ba4fd0a0c45797bcdf7b1b53c9` |
| `dist/index.html` | 11,836 字节（11.83 kB） | `80470fa7790482de0f494320168af8b41e86ee6942fc893020d1a0bca64be71d` |

唯一警告是单个 chunk 超过 500 kB（1,009.43 kB），构建成功。本轮未运行 `pack`/`dist`，由项目管理在本轮通过后重新打包；§11 的 18:33/18:34 打包产物不含本次修复，不能用本轮结果覆盖。

### 12.3 执行的命令与结果

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js
node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js
node --test test/独立测试/integration/game-flow.test.js
npm run build
node --test test/独立测试/e2e/electron-smoke.test.js
```

| 命令 | 结果 |
| --- | --- |
| 战斗结构（collision/weapon/view-model） | **65 pass / 0 fail**，170.1043 ms；含 view-model 的开放隧道/镜片/红点结构断言 |
| 敌方（waves/human-visual） | **38 pass / 0 fail**，166.1812 ms |
| 界面（settings/hud-format） | **27 pass / 0 fail**，93.9218 ms |
| 跨角色集成 | **12 pass / 0 fail**，294.627 ms |
| `npm run build` | 退出码 0，68 modules，208 ms；仅 >500 kB chunk 警告 |
| Electron E2E | **5 pass / 0 fail / 0 skipped**，31,702.4025 ms（最终运行） |

E2E 首次运行出现 **3 pass / 2 fail**：完整流程在“左键射击应消耗弹药”断言失败（实际 30，`document.pointerLockElement` 为 `null`），新增 ADS 用例等待 `aiming` 超时。控制台错误为：

```text
input: 请求指针锁定失败 WrongDocumentError: The root document of this element is not valid for pointer lock.
input: 指针锁定请求被浏览器拒绝 Event
```

诊断结论：Playwright 启动的 Electron 窗口在该桌面会话中没有自动获得焦点，Chromium 因此拒绝 pointer lock；显式 `BrowserWindow.show()/focus()` 后 `document.pointerLockElement.id === 'game'`，同一构建复跑 5/5 通过。这是测试环境/窗口焦点问题，不是 ADS 修复回归，也不修改生产代码。测试现已在启动时聚焦窗口，并在 ADS 用例中确认锁定；若仍无法锁定则标记 NOT RUN。

### 12.4 ADS 中心采样实际数值

运行条件：真实 Electron 44.9.0、应用 1.0.0、`DUSTLINE_TEST=1`、默认设置（FOV 75）、客户区 1584 × 861、dpr 1、真实右键 ADS、`hasFocus=true`、`pointerLockElement=game`。截图裁剪 160 × 160，位置 `x=712, y=351`（画面中心）。

| 指标 | 实际值 | 断言 |
| --- | --- | --- |
| 160×160 平均亮度 | **130.17 / 255** | > 40（PASS） |
| 镜片中心 40×40 平均亮度 | **113.57 / 255** | > 60（PASS） |
| 160×160 亮度方差 | 1647.41 | > 50（PASS） |
| 160×160 唯一颜色数 | 814 | > 32（PASS） |
| 中心区域最大红通道 maxR | **245** | >= 150（PASS） |
| 红点像素数（R>120 且 R>1.4G、R>1.4B） | **37** | >= 3（PASS） |
| 高亮红点像素数（R>180 且 R>1.8G、R>1.8B） | 24 | 记录 |
| 高亮红点质心 | **(80, 101)**，即画面中心下方 21 px | 距中心 ≤ 45 px（PASS，实际 21 px） |
| 中心 40×40 内红点像素 | 8，maxR 225 | 记录 |
| 红点质心 40×40 内红点像素 | 37，maxR 221 | 记录 |

修复前对照（战斗服务证据 `ads-before.png`，1440 × 900，仅作前后对照，不是本轮同条件运行）：中心 20×20 平均亮度 31.65、40×40 平均亮度 53.12、红点像素 0；修复后同口径 20×20 约 98.82、40×40 约 113.57（与本轮页面内 113.57 一致）、红点像素 8（中心 40×40 内）。这说明“中心 40×40 平均亮度 > 60”能区分修复前的黑色实心镜体；160×160 平均亮度单独使用会被周围明亮场景稀释，因此本回归同时保留镜片中心 40×40 断言。

HIP 回归：松开右键后 HUD `aiming === false`、武器快照 `weapon.aiming === false`，真实截图 `hip-after.png` 显示武器回到右下腰射区域，画面中心无武器遮挡。未设像素阈值。

### 12.5 截图路径

截图目录：`test/独立测试/fixtures/screenshots-v3-ads-fix/`（不覆盖 v2 的 `fixtures/screenshots/` 与 v3 的 `fixtures/screenshots-v3/`）。

| 文件 | 内容 |
| --- | --- |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\ads-before.png` | 修复前黑色实心镜体；只读复制自 `test/战斗服务/evidence/ads-fix/ads-before.png`（源文件未改动），1440 × 900 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\ads-after.png` | 真实 Electron 右键 ADS 全屏；可见开放的镜框、后方沙袋/天空与高亮红点，1584 × 861 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\ads-center-after.png` | 同一 ADS 画面的 160 × 160 中心裁剪，用于亮度/红点采样 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\hip-after.png` | 松开右键后的 HIP 画面，武器在右下、中心无遮挡，1584 × 861 |

### 12.6 观察与未验证

1. **红点中心偏移（观察，非阻断）**：在本轮 1584 × 861 画面中，高亮红点质心位于画面中心下方约 21 px（占画面高度约 2.4%）。结构测试允许镜框中心在 NDC ±0.3 内，本轮断言允许 ≤45 px，因此黑镜修复本身通过；若产品要求红点与屏幕几何中心严格重合，仍需战斗/美术确认。未据此修改生产代码。
2. **FOV 断言边界**：本用例断言了 `getHud().aiming`、`weapon.aiming`、`.crosshair.aiming` 与 `#ads-indicator`，并用截图确认视野收窄；O4 钩子没有直接暴露相机 FOV，因此没有对 75 × 0.72 = 54° 做数值断言。
3. **人工视觉验收**：红点亮度/尺寸、镜框厚度与 ADS 下目标可读性仍需人工/美术最终确认；战斗服务 `fix` 文档中的 `implemented-unverified` 状态应由项目管理据此更新。
4. **打包**：本轮未运行 `pack`/`dist`；§11 的 v3 打包产物是修复前构建，必须由项目管理重新打包后再复验。
5. **既有未验证项不变**：人工两波手感/听音、30 敌人高画质性能、连续重开内存、安装/卸载、动画/穿模逐帧验收仍见 §10.7 与 §11.3，不能由本节视为通过。
6. **E2E 性能采样**：完整流程本轮高画质采样末段出现一次约 90.6 fps 的瞬时下降（前段约 180 fps），低画质末值约 169 fps；采样受窗口焦点/后台负载影响，不是 ADS 修复结论，也不用于 GPU 性能判断。

### 12.7 本节结论

在真实 Electron、真实 pointer lock、真实右键 ADS 下，ADS 中心 160×160 平均亮度 130.17/255、镜片中心 40×40 平均亮度 113.57/255、红点像素 37 且 maxR 245，全部通过断言；松开右键后 HUD/武器回到 HIP 且武器不遮挡中心。**V3-4 黑镜修复的自动化中心采样回归 PASS。** 该结论不替代人工视觉验收、FOV 数值断言与重新打包后的复验。

## 13. v3 重新打包后的 ADS 复测（2026-10-17 19:12–19:13）

项目管理在 V3-4 修复后重新打包，本角色用 Playwright `executablePath` 启动打包后的未压缩应用，在真实 pointer lock 下复跑与 §12 相同的 ADS 中心亮度/红点采样与 HIP 回归。§12 的开发构建结果与本节打包结果互相独立，均保留。

### 13.1 产物核对

| 产物 | 实际结果 |
| --- | --- |
| `release/win-unpacked/DUSTLINE.exe` | 存在，247,184,896 字节，2026-10-17 19:12:40 |
| `release/DUSTLINE Setup 1.0.0.exe` | 存在，132,636,138 字节，2026-10-17 19:13:10 |
| `release/win-unpacked/resources/app/dist/assets/index-0WrKp_Kr.js` | 1,009,431 字节，2026-10-17 19:12:38，SHA-256 `6b8491f903310287b9e00998eeed6b646726e5fcf068ce236a331eb0095b971d` |
| 与当前 `dist/assets/index-0WrKp_Kr.js` 对比 | 同文件名、同大小、同 SHA-256，完全一致 |
| 打包内 CSS | `index-Ba2VKdvd.css` 18,596 字节，与当前 `dist` 一致 |

### 13.2 启动与 ADS 采样

用 Playwright Electron 启动 `release/win-unpacked/DUSTLINE.exe`（`DUSTLINE_TEST=1`），`app.getAppPath()` 为 `D:\work\creategame\shooter3d\release\win-unpacked\resources\app`；窗口标题 `DUSTLINE · 尘埃战线`，Electron 44.9.0，应用 1.0.0。通过真实菜单恢复默认设置后点击开始，进入 `playing`；右键 ADS 后 HUD/武器/准星/ADS 指示器均进入瞄准状态，`document.pointerLockElement.id === 'game'`、`document.hasFocus() === true`，客户区 1584 × 861、dpr 1。

首次打包运行捕获到一次瞬时的 HUD 方向受击红色三角（`damage-chevron`），使“全部高亮红像素”的质心被拉到画面右下；保留该次证据为 `packaged-ads-*-with-damage-chevron.png`，并用连通域分析把实际红点与 HUD 三角分开：红点簇 34 px、质心 (79.5, 101.6)、maxR 221；HUD 三角簇 256 px、质心 (132.9, 146.8)、maxR 187。第二次运行的命名证据无该 HUD 三角，数值如下（主记录）：

| 指标 | 打包应用实际值 | 断言 |
| --- | --- | --- |
| 160×160 平均亮度 | **142.79 / 255** | > 40（PASS） |
| 镜片中心 40×40 平均亮度 | **113.63 / 255** | > 60（PASS） |
| 160×160 亮度方差 | 2331.41 | > 50（PASS） |
| 160×160 唯一颜色数 | 648 | > 32（PASS） |
| 中心区域最大红通道 maxR | **220** | >= 150（PASS） |
| 红点像素数（R>120 且 R>1.4G、R>1.4B） | **36** | >= 3（PASS） |
| 高亮红点像素数（R>180 且 R>1.8G、R>1.8B） | 27 | 记录 |
| 高亮红点质心 | **(79, 103)**，即画面中心下方 23 px | 距中心 ≤ 45 px（PASS，实际 23 px） |
| 红点质心 40×40 内红点像素 | 36，maxR 217 | 记录 |
| HIP 回归 | HUD `aiming === false`、武器 `aiming === false` | PASS |

首次运行的对照数值（含 HUD 三角）：160×160 平均亮度 75.86、镜片中心 40×40 平均亮度 91.64、maxR 243、红点像素 290、高亮红点质心 (127,142)（被 HUD 三角拉偏）；连通域分析得到的实际红点簇为 34 px、质心 (79.5,101.6)、maxR 221。该次仍满足亮度与红点存在性，但说明“全部红素质心”会被 HUD 方向受击三角干扰；命名主证据采用无 HUD 三角的第二次运行，旧证据不覆盖。

页面异常：两次运行均为 0。控制台仍出现启动时 pointer lock 被拒绝的记录（`WrongDocumentError: The root document of this element is not valid for pointer lock.`），与 §12.3 的窗口焦点问题一致；测试显式聚焦并重试后取得 `game` 锁定，未影响采样。这是测试环境处理，不是 ADS 修复回归，也不修改生产代码。

### 13.3 截图与验证脚本

| 文件 | 内容 |
| --- | --- |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\packaged-ads-after.png` | 打包应用真实右键 ADS 全屏，1584 × 861 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\packaged-ads-center-after.png` | 同一画面的 160 × 160 中心裁剪（无 HUD 受击三角） |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\packaged-hip-after.png` | 松开右键后的 HIP 画面 |
| `D:\work\creategame\shooter3d\test\独立测试\fixtures\screenshots-v3-ads-fix\packaged-ads-after-with-damage-chevron.png`、`packaged-ads-center-with-damage-chevron.png` | 首次打包运行，含瞬时 HUD 方向受击红色三角的对照证据 |

复跑方式：`node test/独立测试/fixtures/ads-packaged-verify.mjs`（fixtures 下的手工验证脚本，不属于 `node --test` 套件，不被生产代码引用）。

### 13.4 结论与仍未验证

**打包后的 v3 应用 ADS 黑镜修复 PASS**：打包内 JS 与当前构建同哈希；真实 pointer lock 下 ADS 中心平均亮度 142.79/255、镜片中心 40×40 平均亮度 113.63/255、红点像素 36、maxR 220，HIP 恢复正确，页面异常 0。

仍未验证：NSIS 安装包的安装/卸载与快捷方式、代码签名/图标；人工对红点亮度/尺寸、镜框厚度与 ADS 下目标可读性的最终视觉验收；O4 钩子未暴露相机 FOV，未做 ADS FOV 数值断言；打包应用运行中偶发 HUD 方向受击三角会干扰“全部红素质心”指标，后续若要长期自动化，建议改为连通域/中心邻域选取红点（本轮按项目管理要求未改测试）。
