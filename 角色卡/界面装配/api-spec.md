# 接口说明：界面装配（v3）

这份文档写给装配入口、独立测试角色，以及维护 HUD/输入/设置行为的后续开发者。当前状态：**v3 界面、设置持久化与面板、爆头/方向受击 HUD、main 装配已完成；层内测试 27 项通过，`npm run build` 与 Electron 冒烟通过。设置跨 Electron 重启的持久化已实测；正式 v3 视觉验收尚未执行。**

## 1. 怎样导入

装配入口 `src/main.js`：

```js
import { createInterface, createSettings } from './src/interface/public/index.js';
```

界面内部：

```js
import { EVENTS } from '../../models/events.js';
import { createInputCommand } from '../../models/contracts.js';
import { createHud } from '../impl/hud.js';
import { createInput } from '../impl/input.js';
import {
  SETTINGS_STORAGE_KEY,
  createSettings,
  createSettingsPanel,
  formatSettingValue
} from '../impl/settings.js';
```

- 界面层只导入 Model（`src/models/`）、共享事件总线（通过注入的 `bus`）和 Pipeline 公共入口（通过注入的 `game`）。
- 界面不导入 `src/pipelines/impl/`、`src/services/`、`src/providers/`，也不直接导入 `three`。
- `src/interface/public/index.js` 导入自己的 `../impl/` 属于界面层内部组合；它同时重新导出 `createSettings` 与 `SETTINGS_STORAGE_KEY`，让装配入口只依赖界面公共入口。

## 2. 公共入口：`createInterface(options)`

```js
createInterface({
  bus,            // { on, off, emit } 共享事件总线
  game,           // Pipeline 公共入口返回对象
  canvas,         // HTMLCanvasElement
  testMode,       // 可选 boolean，只做类型校验
  settings,       // 可选 createSettings() 返回值；缺省时使用 window.localStorage
  onUserGesture   // 可选 () => unknown；装配层注入的音频初始化
})
  -> {
       getHud(),
       syncInput(),
       requestPointerLock(),
       releasePointerLock(),
       setLoading(visible, message?),
       dispose()
     }
```

### 参数

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `bus` | 是 | 必须有 `on(name, handler) -> unsubscribe`。 |
| `game` | 是 | 必须有 `start`、`pause`、`resume`、`restart`、`setInput`、`toggleMute`、`getState`、`applySettings`、`getSettings`；缺少任一方法时抛带方法名的 `TypeError`。 |
| `canvas` | 是 | 指针锁定目标；`canvas#game`。 |
| `testMode` | 否 | 必须是布尔值。界面只校验，不读取；O4 钩子由 `src/main.js` 决定。 |
| `settings` | 否 | `createSettings()` 返回值，至少提供 `get/save/reset/getRanges`。缺省时界面用 `window.localStorage` 创建；没有 `localStorage` 时抛 `Error`。 |
| `onUserGesture` | 否 | 开始/继续/重开按钮点击时调用（音频初始化）；Promise 拒绝会被捕获并记录。 |

### 返回方法

| 方法 | 行为 |
| --- | --- |
| `getHud()` | 返回 HUD 展示状态，见 §6。 |
| `syncInput()` | 每帧读取并消费输入，更新准星 ADS/移动状态，把 `InputCommand` 写入 `game.setInput()`。设置面板打开时写入空命令。 |
| `requestPointerLock()` / `releasePointerLock()` | 请求/释放画布指针锁定；失败记录。 |
| `setLoading(visible, message?)` | 切换装载层并启用/禁用开始按钮。 |
| `dispose()` | 退订状态事件，释放设置面板、输入与 HUD 监听/定时器。可重复调用。 |

## 3. 设置（`src/interface/impl/settings.js`）

### 字段、默认值与范围

字段来自 Model `GAME_CONFIG.settings`，界面不复制第二份数值：

```js
{
  mouseSensitivity: 1.0,          // 0.25 .. 3.0
  adsSensitivityMultiplier: 0.8,  // 0.4 .. 1.5
  fov: 75,                        // 65 .. 95
  masterVolume: 0.7,              // 0 .. 1
  quality: 'high'                 // 'high' | 'low'
}
```

本地存储键：`dustline.settings.v3`（导出常量 `SETTINGS_STORAGE_KEY`）。

### `createSettings({ storage, defaults?, ranges? })`

| 方法 | 行为 |
| --- | --- |
| `load()` | 读取并校验本地设置；缺失键使用默认值。JSON 损坏或字段非法时记录 `console.error` 并回退默认值，不写坏数据。 |
| `save(settings)` | 校验/夹紧完整设置，更新内部状态并写入 `dustline.settings.v3`；写入失败记录错误。 |
| `merge(partial)` | 与当前设置合并并校验/夹紧，不写存储；非法类型抛 `TypeError`，非法画质抛 `RangeError`。 |
| `get()` | 返回冻结副本。 |
| `reset()` | 恢复默认值并写回存储，返回冻结副本。 |
| `validate(settings)` | 通过 Model `normalizeSettings` 校验/夹紧并返回冻结对象。 |
| `getDefaults()` / `getRanges()` | 返回注入或 Model 的默认值/范围副本，供面板配置滑杆。 |

- `storage` 必须是 `getItem`/`setItem` 兼容对象；测试可传内存实现。
- 所有 `try/catch` 都记录错误；没有静默回退。
- 画质只接受 `high` 与 `low`。

### `createSettingsPanel({ settings, game, onVisibilityChange?, onClose? })`

返回 `{ open, close, isVisible, syncFromGame, dispose }`。

- 面板 DOM 在 `index.html` 的 `#settings`；菜单 `#menu-settings-btn` 与暂停 `#pause-settings-btn` 都能打开。
- 滑杆：鼠标灵敏度、ADS 灵敏度倍率、FOV、主音量；下拉：画质高/低。每项实时显示数值。
- 任一控件变化：读取全部控件 → `game.applySettings(partial)` → `settings.save(applied)` → 刷新显示。
- “恢复默认”调用 `settings.reset()` 与 `game.applySettings(defaults)`。
- “关闭”按钮或 ESC 关闭面板；从暂停打开时对局保持 `paused`。
- 对局中若通过其他途径打开，会先调用 `game.pause()`。
- 打开面板时界面清空待处理输入并释放指针锁定；`input.isBlocked` 回调让移动/射击/换弹等输入不进入游戏。

## 4. HUD（`src/interface/impl/hud.js`）

```js
createHud({ bus, callbacks, settingsPanel? })
  -> { getHud, setAimState, setMoving, setLoading, resetRoundUi, dispose }
```

`callbacks` 必须包含 `onStart`、`onResume`、`onRestart`。可选 `settingsPanel` 必须有 `open()` 与 `isVisible()`。

### 纯函数导出（层内测试使用）

```js
yawToHeading(yawRadians) -> 0..360
formatHeading(headingDegrees) -> '000°'
formatSurvivedTime(seconds) -> '分:秒'
damageDirectionDegrees(directionRadians) -> -180..180（CSS 顺时针角度）
enemyTypeLabel('rifleman'|'heavy'|'breacher') -> '步枪兵'|'重机枪手'|'突击兵'
buildCompassTicks() -> 72 个刻度对象
```

`drone/brute/wraith` 等旧类型回退为“未知目标”。

### HUD 订阅的事件

| 事件 | 用途 |
| --- | --- |
| `game:state` | 切换菜单/HUD/暂停/结算覆盖层。 |
| `hud:update` | 分数、波次、击杀、生命/上限、弹药、弹匣、换弹、yaw、静音。 |
| `hud:hitmarker` | `killed` 与 `headshot`；爆头使用更大、偏红的专用标记。 |
| `hud:killfeed` | 人类敌人中文名 + 分数 + `爆头` 标签，最多 5 条、约 4 秒淡出。 |
| `hud:damage` | 红色受伤边缘；有 `direction` 时在准星周围画方向箭头（0 前、正值右）。 |
| `hud:banner` | 波次横幅；使用 `durationMs`，缺省 2200 毫秒。 |
| `hud:gameover` | 填充结算成绩并显示结算层。 |

HUD 不计算任何游戏结果，只展示载荷。

## 5. 输入（`src/interface/impl/input.js`）

```js
createInput({ canvas, game, callbacks? })
  -> { readCommand, requestPointerLock, releasePointerLock, isPointerLocked, clearPending, dispose }
```

`game` 必须有 `getState()`、`pause()`、`toggleMute()`。`callbacks` 可选：`onPause`、`onMute`、`onFullscreen`、`onBlockedEscape`、`isBlocked`。

- `isBlocked()` 返回 true 时，键盘（ESC 转交 `onBlockedEscape`）、鼠标按键与 `readCommand()` 都不产生游戏输入；`readCommand()` 返回空 `InputCommand`。
- `clearPending()` 清空待处理按键/鼠标与视角增量。
- 指针锁定丢失、窗口失焦或页面隐藏时，如果 `getState() === 'playing'` 则暂停。
- 获取指针锁定后的前两次 `mousemove` 被忽略，避免光标居中造成视角跳变。

`InputCommand` 字段不变：`moveForward`、`moveRight`、`jump`、`sprint`、`fire`、`aim`、`reload`、`lookDeltaX`、`lookDeltaY`。

## 6. `getHud()` 返回对象

```js
{
  state, score, wave, kills, health, maxHealth, ammo, magazineSize,
  reloading, aiming, moving, muted,
  menuVisible, pausedVisible, gameoverVisible, settingsVisible
}
```

可见性来自 DOM；数值来自最近一次 `hud:update`。`settingsVisible` 来自设置面板控制器。

## 7. 回调与设置接线

### 界面 → Pipeline

| 触发 | 实际调用顺序 |
| --- | --- |
| 进入训练场 | `input.requestPointerLock()` → `onUserGesture()` → `game.start()` |
| 继续行动 | `input.requestPointerLock()` → `onUserGesture()` → `game.resume()` |
| 重新开始 / 再次出击 | `input.requestPointerLock()` → `onUserGesture()` → `game.restart()` |
| 菜单/暂停“设置” | `settingsPanel.open()`；从暂停打开时保持 `paused` |
| 滑杆/画质变化 | `game.applySettings(partial)` → `settings.save(applied)` |
| 恢复默认 | `settings.reset()` → `game.applySettings(defaults)` |
| 键盘 M | `game.toggleMute()` |
| 指针锁定丢失 / ESC / 失焦 | `game.pause()` |
| 每帧 | `input.readCommand()` → `hud.setAimState()` / `hud.setMoving()` → `game.setInput(command)` |

## 8. 装配入口 `src/main.js` 的 v3 接线

```js
const settingsStore = createSettings({ storage: window.localStorage });
const savedSettings = settingsStore.load();
game.applySettings(savedSettings);

const enemies = createEnemies({ renderer, colliders, getSpawnPoint, emit, assets });
const combat = createCombat({
  renderer: combatRenderer,
  colliders,
  targetQuery: enemies.getTargetQuery(),
  emit,
  spawn,
  viewport,
  assets
});

await loadOptionalService('敌方服务', enemies, 'load');
await loadOptionalService('战斗服务', combat, 'load');

const decals = arena.getDecals();            // 方法存在时
const effects = createEffects({ renderer, decals });

const interfaceApi = createInterface({
  bus, game, canvas, testMode,
  settings: settingsStore,
  onUserGesture: () => audio.init()
});
```

- 启动顺序：渲染器/素材/音频 → 竞技场 `load()` → 弹孔系统（若有 `getDecals()`）→ 效果/总线 → 敌方 → 战斗 → `enemies.load()` / `combat.load()` → Pipeline → 本地设置 → 界面。
- `load()` 缺失或失败只记录并继续，服务使用程序化回退。
- 竞技场没有 `getDecals()` 时记录一次警告，并调用 `createEffects({ renderer })`。
- 每帧：`interfaceApi.syncInput()` → `game.update(dt)` → `renderer.render()`；`dt` 上限 0.05 秒。
- 菜单/结算隐藏第一人称武器，对局/暂停显示（保留原有 `setViewVisible` 总线接线；Pipeline 也会处理可见性）。

## 9. O4 测试钩子

仅 `?test=1` 时暴露：

```js
window.__DUSTLINE_TEST__ = Object.freeze({
  getState: () => game.getState(),
  getSnapshot: () => game.getSnapshot(),
  getHud: () => interfaceApi.getHud(),
  getSettings: () => game.getSettings(),        // 只读冻结副本
  getPerformance: () => game.getPerformance()   // 运行时仪表
});
```

`getPerformance()` 返回 `{ fps, frameCount, enemyCount, quality, postProcessing }`。这是运行时采样，不是帧率验收承诺。

## 10. 错误处理

- `createInterface` 缺少 `bus`/`game`/`canvas`、`game` 缺方法、`settings` 缺方法、`testMode` 非布尔、`onUserGesture` 非函数：抛 `TypeError`。
- 界面中途创建失败：释放已创建的面板/输入/HUD 后重新抛出。
- DOM 元素缺失：`createHud` / `createSettingsPanel` 抛带 id 的 `Error`。
- 设置存储读取失败、JSON 损坏、字段非法、写入失败：记录 `console.error` 并回退默认值或保留内存状态。
- 指针锁定/全屏失败、服务预加载失败：记录后继续。
- 每个 `try/catch` 都输出错误；没有静默 catch，没有三元运算符。

## 11. 验证命令与实际结果

项目根目录（Node v24，Windows 11，2026-10-17）：

```sh
node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js
# tests 27 / pass 27 / fail 0

npm test
# tests 27 / pass 27 / fail 0（目录入口加载两个测试文件）

npm run build
# 成功；68 modules；dist/index.html 11.83 kB、CSS 18.59 kB、JS 1005.33 kB（gzip 292.79 kB）

node scripts/smoke-electron.js
# 全部 PASS（含 getSettings/getPerformance、设置面板、低画质关后处理、
# localStorage 写入、恢复默认、关闭面板；开始后 playing/HUD/快照）
```

设置跨重启检查（两次真实 Electron 启动，同一用户数据目录）：

```text
第一次：设置 FOV=83 → localStorage {"fov":83,...}
第二次：getSettings().fov === 83，localStorage 仍为 83；打开面板时滑杆值 `83`、显示 `83°`
恢复默认：FOV 回到 75
PASS: settings survived Electron relaunch
PASS: panel values reflect persisted settings on boot/open
```

暂停设置流程：

```text
开始 → ESC → paused；点击暂停层“设置” → settingsVisible=true，state 仍为 paused；
ESC 关闭 → settingsVisible=false，pausedVisible=true，state 仍为 paused。
```

## 12. 尚未验证 / 依赖

- **正式 v3 视觉验收未执行**：菜单/HUD/设置面板只做了布局与可见性检查，美术/项目管理尚未逐项签字。
- **爆头与方向受击的真实画面反馈未人工验收**：单元测试锁定了方向换算与标签；HUD 需要在实际战斗中观察爆头标记、`爆头` 击杀信息与方向箭头。
- **环境引擎 v3 方法已在本轮期间落地**：竞技场公共入口提供 `getDecals()`，效果服务提供 `blood/bulletHole/muzzleSmoke/shell/enemyShot` 并可注入贴片系统，音频服务提供 `setMasterVolume/headshot/shellDrop/enemyShot`，渲染器提供 `setQuality/getQuality`。main 已把 `getDecals()` 的结果传给 `createEffects`，构建与冒烟通过；但弹孔/血雾/枪口烟/抛壳的实际画面与音量听感仍需独立测试与视觉验收。
- **构建后服务文件可能继续变化**：其他角色仍在升级。本轮最后一次构建为 68 modules、JS 1005.33 kB；若服务侧继续修改，需要重新运行构建与冒烟。
- **未运行 `npm run pack` / `npm run dist`**：任务要求 PM 在全部阶段完成后统一打包；本轮只验证构建产物与 Electron 冒烟。
- 真人手感、音频听感、30 敌人性能与长时间内存未测量。
- 主菜单/暂停设置面板打开时键盘焦点未单独做可用性测试（滑杆与下拉可用，未做完整键盘遍历验收）。
