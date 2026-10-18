# 模块说明：界面装配

## 这个角色负责什么

界面装配负责玩家能看到和操作的整条外圈：Electron 桌面窗口、Vite 构建、打包、页面骨架、主菜单、HUD、设置面板与本地保存、暂停与结算、键鼠输入、指针锁定和全屏。它还负责装配入口：按依赖顺序创建渲染、素材、音频、服务、Pipeline 与界面，并驱动渲染循环。

界面不是游戏规则的实现者。状态机、计分、波次、伤害、换弹、爆头判定和死亡结果都在 Pipeline/Service；界面只把按钮和键鼠转成命令，把总线事件显示出来，把设置转成 `game.applySettings()` 调用。

当前状态：**v3 已实现。** 层内 27 项测试、`npm test`、`npm run build`、Electron 冒烟、设置面板、低画质关闭后处理、暂停设置、跨 Electron 重启的设置持久化均已实际通过；正式 v3 视觉验收和打包未执行。

## 当前已有内容

| 文件 | 内容 | 当前状态 |
| --- | --- | --- |
| `index.html` | DUSTLINE 标题、菜单、HUD、设置面板、暂停、结算、装载层结构 | v3 已更新 |
| `src/style.css` | 写实军事配色、面板、罗盘、准星、爆头标记、方向受击、设置面板、响应式 | v3 已更新 |
| `src/interface/public/index.js` | `createInterface()`，按钮/输入/设置/总线接线，重新导出 `createSettings` | v3 已更新 |
| `src/interface/impl/hud.js` | HUD、菜单、暂停、结算、罗盘、人类敌人名称、爆头/方向受击、纯格式化函数 | v3 已更新 |
| `src/interface/impl/input.js` | 键鼠、指针锁定、ESC/失焦暂停、F11、M、设置面板输入冻结 | v3 已更新 |
| `src/interface/impl/settings.js` | 设置校验/合并/持久化与设置面板 | 新增 |
| `src/main.js` | 装配入口、assets/load/decals、设置读取与应用、主循环、O4、释放 | v3 已更新 |
| `electron/main.js` | 窗口、安全、`app://`、开发/测试加载 | 未改动 |
| `vite.config.js` | 构建、`resource/` 复制、开发端口 | 未改动 |
| `package.json` | ESM、脚本、打包配置、依赖 | 未改动 |
| `scripts/smoke-electron.js` | 真实 Electron 启动冒烟（含设置/O4/低画质） | v3 已更新 |
| `test/界面装配/hud-format.test.js` | 罗盘/时间/敌人名/方向角度纯函数测试 | 已更新 |
| `test/界面装配/settings.test.js` | 设置存储与展示格式测试 | 新增 |

## 一次对局现在怎样运行

1. **启动**：Electron 主进程注册 `app://` 特权协议，创建 1600×900 窗口，加载 `app://dustline/index.html`。
2. **装配**：`src/main.js` 创建渲染器、素材加载器、音频引擎与音频服务；等待竞技场 `load()`；读取 `arena.getDecals()`（若存在）并创建效果服务；创建敌方服务（传 `assets`）、战斗服务（传 `assets`）并等待两者 `load()`；创建 Pipeline。
3. **恢复设置**：`createSettings({ storage: window.localStorage }).load()` 读取 `dustline.settings.v3`，随后 `game.applySettings(saved)`。设置面板创建时从 `game.getSettings()` 同步数值。
4. **菜单**：显示 DUSTLINE 菜单和“设置”按钮；竞技场在背后由 Pipeline 的 O3 环绕镜头呈现。装配入口隐藏第一人称武器，开始/继续后恢复。
5. **设置**：菜单或暂停点击“设置”打开面板；滑杆/下拉变化立即 `game.applySettings(partial)` 并写入 localStorage；低画质经 Pipeline 调用 `renderer.setQuality('low')` 关闭后处理。恢复默认按钮重置存储与运行时。
6. **开始**：点击按钮 → 请求指针锁定 → `audio.init()` → `game.start()`。Pipeline 进入 `playing`。
7. **每帧**：`interface.syncInput()` 读取输入（设置面板打开时返回空命令）→ `game.update(dt)` → `renderer.render()`。
8. **HUD**：订阅总线事件，更新罗盘、击杀信息、分数、生命、弹药、换弹、命中/爆头标记、方向受击、横幅与结算。
9. **暂停**：ESC/指针锁定丢失/失焦 → `game.pause()`；暂停层可继续、设置或重新开始。从暂停打开设置时对局保持暂停。
10. **死亡**：Pipeline 判定生命归零 → `over` + `hud:gameover`；界面显示成绩并允许重开。
11. **释放**：`beforeunload` 取消 RAF，依次释放界面（含设置面板）、Pipeline、战斗、敌方、效果、竞技场、音频服务、音频引擎、渲染器与素材加载器。

## 这个模块怎样和别的角色配合

- **游戏管线**：界面调用 `start/pause/resume/restart/setInput/toggleMute/getState/applySettings/getSettings`，订阅 `game:state` 与 `hud:*`；不导入 Pipeline 实现。
- **战斗/敌方/环境/音频服务**：界面不直接调用。装配入口创建并把事件接到共享总线；Pipeline 负责业务协作。设置转发由 Pipeline 完成。
- **项目管理**：共享事件总线由项目管理维护；界面只消费。
- **美术**：界面使用美术方向中的军用色、面板/边框/文字锚点、CC0 授权说明；v3 视觉验收由美术/项目管理执行。
- **独立测试**：O4 只读钩子（`?test=1`）提供状态、快照、HUD、设置与性能；本角色不替代独立测试。

## 设置持久化行为

- 键：`dustline.settings.v3`。
- 首次启动无存储：使用 Model 默认值（灵敏度 1.0、ADS 0.8、FOV 75、音量 0.7、画质 high）。
- 有效存储：加载后立即应用；非法数值由 Model `clampSetting` 夹紧；非法类型/画质抛错，界面记录并回退默认值。
- 保存时机：任一控件变化、恢复默认。保存完整归一化对象。
- 重启/重开：Electron 的 localStorage 持久化；`restart()` 不重置设置。
- 存储异常：读取/写入失败记录 `console.error`，游戏仍可启动。

## 写范围

只有 `角色卡/界面装配/boundary.md` 第 1 节列出的文件可以修改。本轮实际写入：

- `index.html`、`src/style.css`、`src/main.js`
- `src/interface/public/index.js`、`src/interface/impl/hud.js`、`src/interface/impl/input.js`、`src/interface/impl/settings.js`
- `scripts/smoke-electron.js`
- `test/界面装配/hud-format.test.js`、`test/界面装配/settings.test.js`、`test/界面装配/index.js`
- 本角色 `feature-map.md`、`memo.md`、`changelog.md`、`functional-description.md`、`api-spec.md`
- `角色卡/界面装配/docs/feature/match-interface.md`、`docs/feature/desktop-shell.md`、`docs/change/2026-10-17_change_initial-implementation.md`

未修改 `electron/main.js`、`vite.config.js`、`package.json`：v3 不需要改动。

## 不做什么

- 不修改 Model、共享事件总线、Pipeline、任何 Service 或 Provider 源码。
- 不在界面里计算伤害、分数、波次、命中或死亡。
- 不读取 Service 内部状态；HUD 只消费事件载荷。
- 不在 Electron 主进程实现游戏逻辑。
- 不把未执行的视觉/打包/性能检查写成已通过。

## 当前验证

| 检查 | 命令 | 实际结果 |
| --- | --- | --- |
| 层内测试 | `node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js` | 27 pass / 0 fail |
| 角色测试 | `npm test` | 27 pass / 0 fail |
| 构建 | `npm run build` | 成功；68 modules；JS 1005.33 kB |
| Electron 冒烟 | `node scripts/smoke-electron.js` | 全部 PASS（含设置/O4/低画质） |
| 跨重启设置 | 两次 Electron 启动 | FOV 83 保留，面板数值同步，恢复默认成功 |
| 暂停设置 | 真实窗口 ESC + 暂停层设置按钮 | state 保持 paused，ESC 关闭面板 |

## 尚未验证

- 正式 v3 视觉验收（项目管理/美术截图签字）。
- 真实战斗中的爆头标记、`爆头` 击杀信息与方向受击箭头观感。
- 环境引擎 v3 方法已落地：`arena.getDecals()`、效果 `blood/bulletHole/muzzleSmoke/shell/enemyShot`、音频 `setMasterVolume/headshot/shellDrop/enemyShot`、渲染器 `setQuality/getQuality`。装配已把贴片系统传给效果服务；实际画面与音量听感未验收。
- `npm run pack` / `npm run dist`（PM 最终打包）。
- 真人完整游玩、音频听感、30 敌人性能、长时间内存、安装/卸载。
