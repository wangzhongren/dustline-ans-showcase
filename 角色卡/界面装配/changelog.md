# 变更日志：界面装配

## 2026-10-17（v3 全量升级）

### v3 界面设置、爆头/方向受击 HUD 与启动接线（已实现，层内与真实 Electron 检查通过）

#### 设置与本地保存

- 新增 `src/interface/impl/settings.js`：
  - `createSettings({ storage, defaults, ranges })`：`load/save/merge/get/reset/validate/getDefaults/getRanges`。
  - 使用 Model `normalizeSettings` / `clampSetting`；字段为鼠标灵敏度、ADS 倍率、FOV、主音量、画质。
  - 本地存储键 `dustline.settings.v3`；`storage` 可注入内存实现。
  - JSON 损坏、字段非法、读取/写入失败都记录 `console.error` 并回退默认值或保留内存状态。
  - 导出 `SETTINGS_STORAGE_KEY`、`formatSettingValue`、`validateSetting`。
  - `createSettingsPanel({ settings, game, onVisibilityChange })`：滑杆/画质下拉/实时数值/恢复默认/关闭；变化实时 `game.applySettings()` 并 `settings.save()`。
- `index.html` 新增 `#settings` 面板；菜单与暂停层新增“设置”按钮。
- `src/style.css` 新增军用风格设置面板、滑杆、下拉与输出数值样式，无霓虹。
- `src/interface/public/index.js` 重新导出 `createSettings`，`createInterface` 校验 `game.applySettings/getSettings` 并接收 `settings`；创建设置面板并注入 HUD。
- `src/main.js` 创建本地设置存储，读取已保存设置并在 `createGame` 后调用 `game.applySettings(saved)`。

#### HUD（爆头 / 方向受击 / 人类敌人）

- 敌人名称改为 `rifleman=步枪兵`、`heavy=重机枪手`、`breacher=突击兵`；旧机械敌人名称移除。
- 命中标记读取 `headshot`：更大、偏红的专用标记与动画；击杀标记保留。
- 击杀信息读取 `headshot`（兼容 `critical`），显示“爆头”标签。
- `hud:damage.direction` 绘制准星周围的短箭头；0 为正前方、正值在右；红色受伤边缘与低血状态保留。
- 导出纯函数 `damageDirectionDegrees()` 供测试锁定方向约定。
- `getHud()` 增加 `settingsVisible`。
- 菜单简报/操作表/授权说明更新为人类士兵、爆头与设置；武器标签保持 `AR-15 · 制式步枪`。

#### 输入与设置面板隔离

- `input.js` 增加 `isBlocked` 与 `onBlockedEscape` 回调；面板打开时移动/射击/换弹/视角输入不进入游戏，ESC 关闭面板。
- 新增 `clearPending()`；界面在面板打开时清空待处理输入并释放指针锁定。
- 设置面板从暂停打开时对局保持 `paused`；若从对局中打开会先暂停。

#### main 装配

- `createEnemies` / `createCombat` 传入 `assets`。
- 创建后依次 `await enemies.load()`、`await combat.load()`；方法缺失或失败只记录并继续，服务使用程序化回退。
- 竞技场存在 `getDecals()` 时把结果传给 `createEffects({ renderer, decals })`，否则不传并记录警告。
- 启动装载提示更新为人类士兵模型、场景道具与后处理；移除无人机文案。
- O4 `window.__DUSTLINE_TEST__` 增加只读 `getSettings()`、`getPerformance()`。

#### 测试与验证

- 新增 `test/界面装配/settings.test.js`：13 项，覆盖默认值、键名、有效/损坏/非法存储、合并/夹紧、保存、恢复默认、画质允许值、跨实例往返、注入默认值、展示格式。
- 更新 `test/界面装配/hud-format.test.js`：人类敌人名称、旧名称回退、方向角度换算与非法输入。
- `test/界面装配/index.js` 同时加载两个测试文件。
- `node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js`：27 pass / 0 fail。
- `npm test`：27 pass / 0 fail。
- `npm run build`：成功；68 modules；`dist/index.html` 11.83 kB、CSS 18.59 kB、JS 1005.33 kB（gzip 292.79 kB）。
- `node scripts/smoke-electron.js`：全部 PASS；新增 getSettings/getPerformance、设置面板打开/关闭、低画质转发到渲染器并关闭后处理、localStorage 写入、恢复默认、HUD settingsVisible 检查。
- 两次真实 Electron 启动：FOV 83 在重启后保留，第二次打开面板时滑杆值为 `83`、显示 `83°`，随后恢复默认成功。
- 暂停设置流程：ESC → paused；打开设置仍 paused；ESC 关闭后暂停层仍在。

| 检查 | 命令 | 实际结果 |
| --- | --- | --- |
| 层内测试 | `node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js` | 27 pass / 0 fail |
| 角色测试 | `npm test` | 27 pass / 0 fail |
| 构建 | `npm run build` | 成功；68 modules |
| Electron 冒烟 | `node scripts/smoke-electron.js` | 全部 PASS |
| 跨重启设置 | 两次 Electron 启动 + O4 | FOV 83 保留，默认恢复成功 |

#### 未验证 / 依赖

- 正式 v3 视觉验收未执行。
- 真实战斗中的爆头标记、方向受击箭头观感未人工验收。
- 环境引擎 v3 公共方法在本轮期间落地：`arena.getDecals()`、效果 `blood/bulletHole/muzzleSmoke/shell/enemyShot`、音频 `setMasterVolume/headshot/shellDrop/enemyShot`、渲染器 `setQuality/getQuality`。main 已把贴片系统传给效果服务，构建与冒烟通过；实际弹孔/血雾/枪口烟/抛壳画面与音量听感仍需独立测试与视觉验收。
- `npm run pack` / `npm run dist` 本轮未执行（PM 统一最终打包）。
- 真人手感、音频听感、30 敌人性能与长时间内存未测量。

## 2026-10-17（初始实施）

### 初始实施：DUSTLINE 界面、输入与桌面壳（已实现，层内与真实窗口检查通过）

#### 页面与样式

- 完整替换 `index.html`：标题 `DUSTLINE · 尘埃战线`；主菜单、装载层、HUD、暂停层、结算层。
- 新增 `src/style.css`：军用橄榄绿/卡其/混凝土灰/锈迹/枪金属灰；面板 `rgba(20,24,22,0.72)`、边框 `rgba(190,196,188,0.35)`、正文 `#D8DCD4`、次要 `#9AA096`；Bahnschrift/Segoe UI/Segoe UI Mono；CSS 颗粒与暗角；无霓虹、无外部字体/图片。
- HUD：顶部罗盘、左上击杀信息、右上得分/波次/击杀、底部生命条、右下弹药/换弹条、准星/ADS、命中标记、受伤/低血红边、波次横幅、操作提示。
- 菜单：DUSTLINE 标题、尘埃战线副标题、作战简报、操作表、进入训练场、CC0 授权说明。
- 暂停：继续行动、重新开始、完整操作提醒。
- 结算：得分、波次、击杀、存活时间、再次出击。

#### 界面层

- 新增 `src/interface/public/index.js`：
  - `createInterface({ bus, game, canvas, testMode, onUserGesture })`。
  - 返回 `getHud/syncInput/requestPointerLock/releasePointerLock/setLoading/dispose`。
  - `game:state` 非 `playing` 时释放指针锁定。
  - 界面创建中途失败时释放已创建的输入/HUD。
- 新增 `src/interface/impl/hud.js`：
  - 订阅 `game:state`、`hud:update`、`hud:hitmarker`、`hud:killfeed`、`hud:damage`、`hud:banner`、`hud:gameover`。
  - 罗盘 3 个 360° 循环、72 格、45° 中文/英文方位、30° 度数；`yawToHeading` 约定 -Z 为北。
  - 击杀信息最多 5 条、约 4 秒淡出；`无人机/重装/幽影` + 分数 + `核心`。
  - 生命/低血、弹药 `30 / ∞`、换弹进度、ADS/移动准星、命中/击杀标记、受伤/低血红边、2200 毫秒横幅、结算成绩。
  - 导出纯函数 `yawToHeading/formatHeading/formatSurvivedTime/enemyTypeLabel/buildCompassTicks` 供层内测试。
- 新增 `src/interface/impl/input.js`：
  - WASD、Shift、Space、鼠标观察、左键、右键、R、M、F11、ESC。
  - 指针锁定请求/释放、锁定丢失暂停、失焦/隐藏暂停、右键菜单阻止。
  - 锁定后的前两次 `mousemove` 忽略，修复开始对局时视角被光标居中位移甩向天空的问题。
  - ESC 显式暂停兜底；所有监听在 `dispose()` 移除。

#### 装配与桌面壳

- 新增 `src/main.js`：
  - 创建渲染器、素材加载器、音频引擎/服务；显示装载提示；等待 `arena.load()`。
  - 创建效果、共享总线、敌方服务、战斗服务、Pipeline、界面。
  - 共享可变 `viewport`，窗口缩放时调用 `renderer.resize()` 并更新。
  - `createCombatRenderer()` 包装 `getWorldPosition`，始终取当前窗口中心；其余方法转发。
  - 每帧 `syncInput → game.update(dt) → renderer.render()`，`dt` 上限 0.05 秒。
  - `?test=1` 时暴露只读 `window.__DUSTLINE_TEST__`。
  - 订阅 `game:state` 调用战斗服务 `setViewVisible()`：菜单/结算隐藏第一人称武器，对局/暂停显示，菜单只展示竞技场。
  - `beforeunload` 取消 RAF 并按界面 → Pipeline → 服务 → 渲染器 → 音频引擎 → 素材顺序释放。
- 新增 `electron/main.js`：
  - 1600×900、最小 1280×720、标题、深色背景、隐藏菜单栏、`show: false` + `ready-to-show`。
  - `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
  - `app://` 特权协议；`protocol.handle` + `net.fetch(file://)`；拒绝 `..`/越界 403、缺失 404。
  - 开发服务器 `VITE_DEV_SERVER_URL`；测试模式 `DUSTLINE_TEST=1` 追加 `?test=1`。
  - 拒绝新窗口、阻止外部导航、Windows 关闭最后窗口退出；不在主进程处理 F11。
- 新增 `vite.config.js`：
  - `base: './'`、`publicDir: false`、`outDir: dist`、`emptyOutDir: true`、开发端口 5173 `strictPort`。
  - 构建插件 `fs.cpSync(resource, dist/resource, { recursive: true })`。
- 更新 `package.json` / `package-lock.json`：
  - `type: module`、`main: electron/main.js`、`private: true`、作者。
  - 脚本：`dev/build/start/pack/dist/test`。
  - 保留 `three`；Electron/electron-builder/Vite；新增 `playwright-core`。
  - electron-builder：`appId com.dustline.game`、`productName DUSTLINE`、输出 `release`、Windows x64 NSIS、非一键安装、可改目录、桌面/开始菜单快捷方式。
  - `asar: false`、`electronDist: node_modules/electron/dist`（解决首次 pack 的 EPERM 重命名失败）。
- 新增 `scripts/smoke-electron.js`：真实 `_electron.launch({ args: ['.'] })`，检查标题/canvas/装载/开始按钮/O4/playing/HUD/快照。

#### 测试

- 新增 `test/界面装配/hud-format.test.js`：12 项，覆盖 yaw→方位角、0–360 环绕、三位度数、存活时间、敌人中文名、罗盘 72 格/45°/30° 标签。
- 新增 `test/界面装配/index.js`：目录入口，使 `node --test test/界面装配/` 在 Node v24.11.1 中也能加载真实测试文件。
- `npm test`：12 pass / 0 fail。
- 既有共享/角色测试在切为 ESM 后直接运行：120 pass / 0 fail（战斗服务新增 3 项测试后复跑）。
- 真实 Electron 检查：
  - 启动冒烟全部 PASS。
  - 指针锁定丢失/ESC → 暂停；继续 → playing。
  - 死亡 → 结算层正确显示本局成绩（两次复跑分别观察到 200 分/1 波/2 击杀/0:06 与 0 分/1 波/0 击杀/0:05）；再次出击 → 100 生命 / 1 波 / 0 分。
  - 暂停层“重新开始” → playing，暂停层隐藏，HUD 复位为 100 生命 / 1 波 / 0 分。
  - M 静音开关、F11 全屏进出、左键弹药 30→26、右键 ADS 开关、R 换弹回 30。
  - 窗口缩放后射击正常，无页面异常。
  - 罗盘方向受控 ±100 像素检查通过。
  - 打包后 `DUSTLINE.exe` 启动、开始与 ESC 暂停通过。

#### 构建与打包

- `npm run build`：成功；46 模块；`dist/` 约 19 MB（`resource/` 约 18 MB）；JS 754.54 kB（gzip 199.22 kB）。
- `npm run pack`：退出码 0；`release/win-unpacked/DUSTLINE.exe`；目录约 400 MB。
- `npm run dist`：退出码 0；`release/DUSTLINE Setup 1.0.0.exe` 约 126 MB；`.blockmap` 约 135 KB。
- `npm run dev`：`/`、`/src/main.js`、`/resource/asset-manifest.json`、HDR 均 HTTP 200。

#### 未验证

- 正式视觉验收、真人完整两波、音频听感。
- 安装/卸载、快捷方式、代码签名证书、应用图标。
- 30 敌人/长时间/连续重开 5 次的性能与内存。
- 战斗服务新增 `setViewVisible()` 的增量契约需项目管理知悉并安排受影响方复测（界面侧菜单隐藏/对局显示已验证）。
