# DUSTLINE 交付调度记录

- 任务 ID：`dustline-delivery`
- 设计：`docs/governance/2026-10-17_bootstrap-and-game-design.md` v2（已确认 2026-10-17，SHA-256 `424f800567a20f9b700ba04f7ac18b43ef2fed5b93c7aaab7c4f80c5e0a71bb5`）
- 配置：`.ans/project.json`（SHA-256 `b044762855afaddb9971ef4f9a29c19c293ea856fd5f4a4f92db3958055db5d4`，8 个角色均 `autoDispatch: true`）
- 协调角色：项目管理（本记录唯一写者）
- 计划维护：手工维护本文档（原因见下）

## 1. 为什么没有使用 task_ops CLI

已实际尝试初始化：

```sh
PYTHONUTF8=1 python C:/Users/MLoong/.claude/skills/ans-governed-construction/scripts/task_ops.py \
  --root . --task dustline-delivery init --request <init.json>
```

结果：`{"status": "rejected", "message": "Execution scope cannot include governance/state files"}`。

原因：已批准的 `.ans/project.json` 为每个角色配置的 `writeFiles` 包含 `角色卡/<角色>/...` 文档路径；`task_ops` v1 拒绝把 `角色卡/`、`role-cards/`、`.ans/`、`docs/scheduling/` 作为执行写范围。另有 Windows GBK 默认编码问题，需要 `PYTHONUTF8=1`。配置属于 Governance 权限，本角色不修改，因此按任务授权改用本手工调度记录，不阻塞交付。

## 2. 阶段、依赖与验收表

状态：`pending` / `ready` / `running` / `awaiting-verification` / `verified` / `failed` / `blocked`。只有项目管理检查实际文件与运行结果后才能写 `verified`。

| 阶段 ID | 角色 | 交付物 | 依赖 | 检查 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `shared-bus` | 项目管理 | `src/common/shared/event-bus.js`、`test/项目管理/event-bus.test.js` | 无 | `node --test`（当前需临时 loader，见 §6） | verified |
| `art-assets` | 美术 | `resource/` CC0 素材、`asset-manifest.json`、`ATTRIBUTIONS.md`、美术方向、manifest 测试 | 无 | `node --test test/美术/asset-manifest.test.js` | verified |
| `model-contracts` | 游戏管线 | `src/models/{game-config,events,contracts}.js` | 无 | 契约自检（Model 可被 Node 导入） | verified |
| `provider-core` | 环境引擎 | 渲染/素材/音频 Provider 与 Three.js 门面 | `model-contracts`、`art-assets`（素材缺失允许程序化回退） | `node --test test/环境引擎/arena-layout.test.js` + 导入冒烟 | verified |
| `combat-service` | 战斗服务 | 玩家、武器、碰撞 | `provider-core`、`model-contracts` | `node --test test/战斗服务/*.test.js` | verified |
| `enemy-service` | 敌方服务 | 波次、敌人、弹丸、拾取 | `provider-core`、`model-contracts` | `node --test test/敌方服务/waves.test.js` | verified |
| `environment-services` | 环境引擎 | 竞技场、效果、音频 Service | `provider-core`、`art-assets` | `node --test test/环境引擎/arena-layout.test.js` | verified |
| `pipeline-game` | 游戏管线 | 状态机、主循环、计分/波次、HUD 事件、O3/O4 状态支持 | `shared-bus`、`model-contracts`、三个 Service | `node --test test/游戏管线/game-state.test.js` | verified |
| `interface-shell` | 界面装配 | Electron 壳、Vite、构建、打包、HUD/菜单/输入完整实现 | `pipeline-game` | `npm run build` + 启动冒烟 | verified |
| `independent-test` | 独立测试 | 集成测试、Electron E2E、日期化报告、截图 | `interface-shell` | `node --test test/独立测试/...` + `npm run build/start/pack/dist` | verified |

## 3. 冻结的跨角色接口（本任务期间不得单方面改变）

变更以下契约必须回报项目管理，由项目管理评审并使旧证据失效。

### 3.1 Model（游戏管线唯一所有者）

- `src/models/events.js` 导出 `EVENTS` 常量对象（事件名使用字符串常量，禁止散落魔法字符串）：
  - 对局：`game:state`、`hud:update`、`hud:hitmarker`、`hud:killfeed`、`hud:damage`、`hud:banner`、`hud:gameover`。
  - 世界：`world:shot`、`world:impact`、`world:explosion`、`world:enemy-spawn`、`player:damage`、`player:died`、`enemy:killed`。
  - 武器：`weapon:reload-start`、`weapon:reload-end`、`weapon:empty`。
  - 波次/拾取：`wave:start`、`wave:cleared`、`pickup:spawn`、`pickup:collected`。
- `src/models/game-config.js` 导出 `GAME_CONFIG`（玩家、武器、敌人、波次、竞技场、计分、事件节奏）。数值严格对齐设计 §2.1。
- `src/models/contracts.js` 导出 JSDoc 类型与纯校验/构造辅助（如 `createInputCommand()`、`createPlayerSnapshot()`），不导入任何运行层。

### 3.2 共享事件总线（项目管理）

- `createEventBus({ onError? }) -> { on, once, off, emit, listenerCount, clear }`。
- 订阅返回退订函数；重复订阅独立触发；单个处理函数抛错不影响其余处理函数。

### 3.3 Provider（环境引擎）

- `src/providers/public/three.js`：显式命名导出（禁止 `export *`）。
- `createRenderer({ canvas, width, height, pixelRatio, shadows })` 返回：
  - `add(object)` / `remove(object)` / `attachToCamera(object)` / `detachFromCamera(object)`
  - `setCameraPose({ position: {x,y,z}, yaw, pitch, fov })` / `getCameraPose()`
  - `getWorldPosition(screenX, screenY) -> { origin:{x,y,z}, direction:{x,y,z} }`
  - `raycast(origin, direction, far, objects) -> { object, distance, point, normal } | null`
  - `setEnvironment({ hdriTexture, backgroundTexture, skyColor, fogColor, fogNear, fogFar, intensity })`
  - `resize(width, height)` / `render()` / `dispose()`
- `createAssetLoader({ baseUrl })` 返回 `loadManifest()`、`loadTexture(url, options)`、`loadHdr(url)`、`loadModel(url)`、`dispose()`。
- `createAudioEngine()` 返回 `init()`、`tone(...)`、`noise(...)`、`setMuted(...)`、`setMasterVolume(...)`、`dispose()`。

### 3.4 Service 公共入口

- 战斗：`createCombat({ renderer, colliders, targetQuery, emit }) -> { reset, update(dt, input), damagePlayer(amount), heal(amount), getSnapshot, getWeaponState, dispose }`。
- 敌方：`createEnemies({ renderer, colliders, getSpawnPoint, emit }) -> { reset, startWave(n), update(dt, playerSnapshot), getTargetQuery, getState, dispose }`。
- 竞技场：`createArena({ renderer, assets }) -> { load(), getColliders, getSpawnPoint({ playerPosition, minDistance }), getPlayerSpawn, update(dt), dispose }`。
- 效果：`createEffects({ renderer }) -> { tracer, impact, explosion, spawn, update(dt), clear, dispose }`。
- 音频：`createAudio({ engine }) -> { init, shoot, hit, kill, explosion, hurt, reload, empty, pickup, waveStart, gameOver, footstep, setMuted, dispose }`。

### 3.4.1 共享几何约定

- 碰撞体 `Collider = { min: { x, y, z }, max: { x, y, z } }`（世界坐标轴对齐盒）。竞技场返回该数组；战斗与敌方只读消费。
- 命中对象：敌方 `listHittable()` 返回 `[{ object, targetId }]` 条目（与 Model `HittableEntry` 一致）；`object` 的 `userData` 至少含 `{ targetId, part }`；`part === 'core'` 表示光学核心。战斗对 `entry.object` 做射线检测。
- 暴击只计算一次：战斗在调用 `applyDamage` 前按 `criticalMultiplier` 乘算；敌方返回 `critical` 仅用于反馈与计分展示。

### 3.4.2 事件接线

- 装配把 Service 的 `emit` 直接接到 `bus.emit`：Service 产生的结果事件（`enemy:killed`、`player:damage`、`pickup:collected`、`world:*`、`weapon:*`、`hud:hitmarker`、`hud:damage`、`player:died`）进入共享总线。
- Pipeline 订阅这些结果事件，负责：计分/击杀、`player:damage → combat.damagePlayer`、`pickup:collected → combat.heal`、效果与音频映射、死亡结算；然后发布自己的 HUD/对局事件。界面只订阅总线，不直接调用 Service。

### 3.5 Pipeline（游戏管线）

`createGame({ bus, renderer, arena, combat, enemies, effects, audio, options }) -> { start, pause, resume, restart, update(dt), setInput(command), toggleMute(), getState(), getSnapshot(), dispose() }`。

- `setInput(command)` 接收 Model 的 `InputCommand`；界面每帧写入当前输入，Pipeline 在 `update` 中消费。
- `toggleMute()` 切换音频静音并把 `muted` 放入 `hud:update`；界面 M 键调用它。

- 状态：`menu | playing | paused | over`。
- Pipeline 负责：波次推进、计分、HUD 事件、玩家伤害转发、死亡结算、暂停冻结、O3 菜单镜头、O4 只读状态。
- Pipeline 将事件的音频映射集中在一处（`world:shot → shoot` 等），Service 不直接调用音频。

### 3.6 Interface（界面装配）

- 只导入 `src/pipelines/public/game.js`、各 Provider 公共入口、Model 与共享事件总线；不得导入任何 `impl/`。
- `src/main.js` 负责构造 Provider、Service、Pipeline、界面并启动渲染循环。
- O4：URL 带 `?test=1` 时暴露 `window.__DUSTLINE_TEST__ = { getState, getSnapshot, getHud }`，默认不暴露。
- 指针锁定丢失必须调用 `game.pause()`。

## 4. 素材清单契约（美术 → 环境引擎）

`resource/asset-manifest.json` 至少包含：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-17",
  "baseUrl": "resource/",
  "textures": {
    "ground":   { "color": "textures/ground/...jpg", "normal": "...", "roughness": "...", "ao": "..." },
    "concrete": { "color": "...", "normal": "...", "roughness": "..." },
    "metal":    { "color": "...", "normal": "...", "roughness": "...", "metalness": "..." },
    "wood":     { "color": "...", "normal": "...", "roughness": "..." },
    "steel":    { "color": "...", "normal": "...", "roughness": "...", "metalness": "...", "ao": "..." },
    "fabric":   { "color": "...", "normal": "...", "roughness": "...", "ao": "..." }
  },
  "hdri": { "sky": "hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" },
  "models": { "rifle": "models/quaternius-rifle.glb" },
  "assets": [
    {
      "id": "hdri.sky",
      "file": "resource/hdri/...",
      "url": "hdri/...",
      "kind": "hdri",
      "source": "...",
      "author": "...",
      "license": "CC0",
      "downloadedAt": "2026-10-17"
    }
  ]
}
```

- `url` 相对于 `resource/` 根。
- 运行时由界面装配把 `resource/` 原样提供在 `./resource/`（开发服务器与构建产物一致）；`createAssetLoader({ baseUrl: new URL('./resource/', document.baseURI).href })` 读取 `resource/asset-manifest.json`，`resolveUrl` 以同一 `baseUrl` 解析相对 URL。美术方向文档与清单的 `baseUrl` 语义一致。
- 文件必须真实存在；测试必须校验路径、授权、必要通道与文件可读性。
- 仅 CC0；`ATTRIBUTIONS.md` 与清单一致。

## 5. 证据与状态历史

| 日期 | 阶段 | 事件 | 证据 |
| --- | --- | --- | --- |
| 2026-10-17 | 计划 | 初始化调度记录；CLI 因配置范围被拒，改手工记录 | 本条 §1 |
| 2026-10-17 | shared-bus | 实现并运行 9 项测试，全部通过 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/项目管理/event-bus.test.js` → 9 pass / 0 fail |
| 2026-10-17 | art-assets | 25 个 CC0 媒体文件入库，清单/授权/测试完成；独立复跑通过 | 同上 loader 命令 → 8 pass / 0 fail；`resource/` 17.53 MB；所有下载 HTTP 200 |
| 2026-10-17 | model-contracts | 三个 Model 文件完成；独立导入冒烟通过 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --input-type=module -e "Promise.all([...])"` → events 22 keys、damage 26、contracts 函数可用 |
| 2026-10-17 | provider-core | 三个 Provider 公共入口、64 个 Three.js 显式导出、契约测试完成；独立复跑通过 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/provider-contract.test.js` → 6 pass / 0 fail；四入口导入冒烟 exit 0 |
| 2026-10-17 | combat-service | 玩家/武器/碰撞实现完成；独立复跑通过；发现 viewport 需装配传入并在缩放时更新 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js` → 38 pass / 0 fail（角色报告后来为 39） |
| 2026-10-17 | enemy-service | 波次/敌人/弹丸/拾取实现完成；`listHittable` 形状缺陷已由所有者修复 | 修复后 `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/敌方服务/waves.test.js` → 23 pass / 0 fail |
| 2026-10-17 | combat+enemy 联调探针 | 真实模块 + 假渲染器验证命中目标形状与开火事件链 | 6 敌人生成、72 个命中条目、`entry.object.userData.targetId === entry.targetId`、击杀返回 score 100；开火产生 `world:shot` 与 `hud:hitmarker` |
| 2026-10-17 | environment-services | 竞技场/效果/音频 Service 完成；独立复跑通过 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js` → 19 pass / 0 fail；三入口导入 `createArena,createEffects,createAudio` |
| 2026-10-17 | pipeline-game | 状态机/主循环/事件路由/计分/波次/O3/O4 完成；独立复跑通过 | `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/游戏管线/game-state.test.js` → 19 pass / 0 fail；`createGame` 导入为 function |
| 2026-10-17 | interface-shell | 完整界面/输入/Electron/Vite/打包完成；独立核对 dist 与 release 产物存在 | 角色证据：`npm run build` PASS（46 modules，dist ~19 MB）、`node scripts/smoke-electron.js` 全部 PASS、`npm run pack` exit 0、`npm run dist` exit 0；release/win-unpacked/DUSTLINE.exe 与 release/DUSTLINE Setup 1.0.0.exe 存在 |
| 2026-10-17 | 视觉复核 1 | 菜单首屏截图发现武器出现在主菜单、场景过亮偏沙色 | `test/项目管理/screenshots/menu-02.png`、`gameplay-01.png`；派回战斗（隐藏视图）与环境（调色/光照/阴影/加载器） |
| 2026-10-17 | 视觉复核 2 | 武器已在菜单隐藏；场景改为灰蓝阴天/灰褐地面/军用低饱和；Three.js 警告消失 | `test/项目管理/screenshots/menu-03.png`、`gameplay-02.png`；环境测试 19/19、战斗 41/41、管线 20/20 |
| 2026-10-17 | 视觉复核 3 | 环境二次调色：沙袋改卡其、集装箱橄榄、地面灰褐、阴天灰蓝；`menu-04.png`、`gameplay-03.png` 为当前候选 | 环境 19/19、`npm run build` PASS（45 modules）；美术角色进行最终方向确认 |
| 2026-10-17 | 契约增量 | 战斗新增 `setViewVisible(boolean)`；管线在 menu/over 隐藏、playing/paused 显示；`createGame` 仍兼容旧服务 | 战斗 41 pass、管线 20 pass；界面已接线并重跑 120 pass |
| 2026-10-17 | 美术视觉验收 | 美术复核 `menu-04.png`、`gameplay-03.png`：YES，写实军事方向达标；三项非阻断后续（沙袋保留织纹的卡其重映射、步枪暗部分离、木箱降红） | `角色卡/美术/docs/feature/art-assets.md` 已更新；无代码改动 |
| 2026-10-17 | 独立测试 | 集成 7/7、Electron E2E 2/2、既有测试 132/132；完整流程（移动/射击/波次/暂停/死亡/重开）通过；打包应用可启动 | `test/独立测试/integration/game-flow.test.js`、`test/独立测试/e2e/electron-smoke.test.js`、`角色卡/独立测试/docs/reports/2026-10-17_report_initial-verification.md`；截图 5 张 |
| 2026-10-17 | 最终构建与打包 | 在最终源码上重新 `npm run build`、`npm run pack`、`npm run dist`；dist 与解包应用 JS SHA-256 一致；安装包重建 | dist JS `index-ClkC91v5.js`；`release/win-unpacked/DUSTLINE.exe`、`release/DUSTLINE Setup 1.0.0.exe` 时间 15:51 |
| 2026-10-17 | 最终回归 | 单元+集成 139/139；界面测试 12/12；Electron 冒烟全部 PASS（标题 `DUSTLINE · 尘埃战线`、开始、HUD） | `node --test ...` 139 pass；`npm test` 12 pass；`node scripts/smoke-electron.js` all PASS |
| 2026-10-17 | 最终启动/重打包复验 | `npm start` 打开真实窗口，标题 `DUSTLINE · 尘埃战线`；重新打包后由独立测试再次启动解包应用，标题/装载/开始/O4 默认关闭均通过 | Windows 窗口标题核对；`release/win-unpacked` 与 `dist` JS 哈希 `ead333ba...5702b4c` 一致；报告 §9 |

## 6. 测试命令说明

根 `package.json` 已由界面装配切换为 `"type": "module"`。现在直接使用：

```sh
node --test test/项目管理/event-bus.test.js
```

`test/项目管理/esm-loader.mjs` 仅为 CommonJS 过渡期保留，已被普通 `node --test` 取代；历史证据见 §5。

---

# v3 全量升级调度（2026-10-17）

- 设计：同一份设计文档 §12（v3，客户已确认），SHA-256 `781b0373c5f8fcacdb369d4205133cb0b566df0a4c88db9826b0fef5c32245ff`。
- 配置：`.ans/project.json` SHA-256 `eb05c4e2e36cb3a286acb60549d414da450870253dc6dfbc77a5d56eb45a151f`。
- 核心反馈：敌人改为人类士兵；射击手感与美术显著提升。先改现有代码，不推倒重来。
- 手工调度继续；`task_ops` 的既有 config/角色卡路径限制不变，未修改配置。

## V3-1 阶段与依赖

| 阶段 ID | 角色 | 交付物 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| `v3-art-models` | 美术 | 4 个 CC0 人类 GLB、动画/比例/朝向验证、manifest/attribution/测试/美术方向 | 无 | verified |
| `v3-model-settings` | 游戏管线 | 人类敌人配置、设置默认值/范围、事件/契约、Pipeline `applySettings/getSettings` 骨架与测试 | 无 | verified |
| `v3-combat-viewmodel` | 战斗服务 | `view-model.js` 高细节步枪/双手/视图动画、后坐/镜头/FOV/爆头、设置 | `v3-model-settings`、`v3-art-models`（PBR 贴图） | verified |
| `v3-enemy-human` | 敌方服务 | `human-visual.js` GLB 加载/装备/动画/头身命中盒、三类人类 AI、死亡淡出 | `v3-model-settings`、`v3-art-models` | verified |
| `v3-environment-upgrade` | 环境引擎 | `props.js`/`decals.js`/`post-processing.js`、场景道具、低角度阳光/阴影/雾、SSAO/Bloom/分级/AA、沙袋织纹重映射、低画质回退 | `v3-model-settings`、`v3-art-models` | verified |
| `v3-interface-settings` | 界面装配 | `settings.js` 设置面板/本地保存、爆头/方向受击 HUD、main 装配、构建打包 | `v3-model-settings`、`v3-combat-viewmodel`、`v3-enemy-human`、`v3-environment-upgrade` | verified |
| `v3-pipeline-wire` | 游戏管线 | 设置转发、爆头/击杀/受伤方向、敌人枪声/血雾/弹孔/抛壳映射、性能统计、O4 设置 | 前四个实现阶段 | verified |
| `v3-independent-test` | 独立测试 | 更新集成与 E2E、人类敌人/爆头/设置/性能、`screenshots-v3/`、报告 | `v3-pipeline-wire`、`v3-interface-settings` | verified |
| `v3-visual-acceptance` | 项目管理 + 美术 | Electron 1600×900 菜单/对局截图、人类士兵/武器双手/后处理/道具、无无人机/霓虹 | 独立测试 | verified（静态；美术 YES） |
| `v3-fix-ads-scope` | 战斗服务 + 独立测试 | 红点镜体改开放框体、镜片真透光、红点亮、ADS 中心亮度回归 | `v3-visual-acceptance` | verified |

## V3-4 ADS 黑镜修复（客户 2026-10-17 要求）

根因（只读确认）：`src/services/impl/combat/view-model.js` 的红点镜 `opticBody` 是实心 `BoxGeometry(0.042, 0.045, 0.075)`，前脸不透明且位于镜片正后方；ADS 时相机正对实心前脸。镜片虽 `transparent:true` 但 `depthWrite` 默认开启、红点为暗红色，进一步压黑。

冻结修复契约：
- 镜体改为开放框体/开口环，中心完全中空，前后贯通；保留前后金属环与底座。
- 镜片 `transparent:true`、低 opacity、`depthWrite:false`；红点高亮红色/Basic、`toneMapped:false`、`depthWrite:false`，位于镜片中心。
- ADS 相机不得进入镜体或贴近近裁剪面；HIP 外观不回归。
- 战斗新增结构断言（无实心镜体、透明镜片 depthWrite 关闭、红点可见/居中）；独立测试在真实 Electron ADS 截图后采样中心区域平均亮度 > 阈值并检查红点，保留前后截图到 `test/独立测试/fixtures/screenshots-v3-ads-fix/`。
- 重新 build、跑战斗/敌方/界面/集成/E2E、pack/dist，生成新包；更新战斗 `docs/fix/` 与调度记录。

## V3-2 冻结契约（本任务期间不得单方面改变）

### 设置对象

```js
{
  mouseSensitivity: 1.0,          // 0.25 .. 3.0
  adsSensitivityMultiplier: 0.8,  // 0.4 .. 1.5
  fov: 75,                        // 65 .. 95
  masterVolume: 0.7,              // 0 .. 1
  quality: 'high'                 // 'high' | 'low'
}
```

- `GAME_CONFIG.settings = { defaults, ranges }`。
- Pipeline：`applySettings(partial)` 合并、校验/夹紧、转发并发出 `settings:changed`；`getSettings()` 返回冻结副本；`getSnapshot()` 含 `settings` 与 `performance`。
- 界面：`src/interface/impl/settings.js` 负责 localStorage（键 `dustline.settings.v3`）与面板；启动时读取并调用 `game.applySettings(saved)`；O4 `window.__DUSTLINE_TEST__.getSettings()` 只读。
- 转发：`combat.setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })`；`renderer.setQuality(quality)`（或 `setPostProcessingEnabled(quality === 'high')`）；`audio.setMasterVolume(masterVolume)`。

### 敌人配置

- `ENEMY_TYPES = { RIFLEMAN:'rifleman', HEAVY:'heavy', BREACHER:'breacher' }`；HUD 名称：步枪兵 / 重机枪手 / 突击兵。
- 数值：步枪兵 70 生命 / 5.0 速度 / 9–16 米 / 7 伤害 / 100 分；重机枪手 200 / 2.8 / 6–10 米 / 三连发每发 11 / 300 分，放大 1.12 并重甲；突击兵 85 / 7.2 / 近战 14 / 1.2 秒冷却 / 150 分。
- 步枪兵模型池：Adventurer、Woman Casual、Woman Formal；重机枪手：Adventurer（放大）；突击兵：Man 基础模型。GLB 路径以 manifest 为准。
- 动画映射：`Idle_Gun`、`Walk`、`Run`、`Run_Shoot`、`Gun_Shoot`、`HitRecieve`、`Death`；突击兵 `Punch_Left/Right`、`Run`、`Walk`、`Death`。实际剪辑名以美术验证结果为准，敌方服务做映射与缺失回退。
- 头/身独立命中盒，`userData.part = 'head' | 'body'`；爆头 2 倍；死亡立即移出可命中列表，播放 Death，4 秒后尸体淡出。
- 波次占比：第 1 波仅步枪兵；第 2 波步枪兵 0.8/重机枪手 0.2；第 3 波起步枪兵 0.55/重机枪手 0.2/突击兵 0.25。数量/缩放/间隔沿用现有波次公式与上限。
- 场景与 HUD 不再出现 drone/brute/wraith/drone 名称与机械视觉。

### 事件增量

- `world:enemy-shot` `{ position, direction, color, enemyType }`。
- `world:blood` `{ position, direction, color }`。
- `weapon:shell-eject` `{ position, velocity }`。
- `settings:changed` `{ settings }`。
- `hud:hitmarker` 增加 `headshot: boolean`；`hud:killfeed` 增加 `headshot: boolean`；`enemy:killed` 增加 `headshot: boolean`（保留 `critical` 作为兼容同义）。
- `player:damage` 增加可选 `sourcePosition`；`hud:damage` 增加 `direction`（相对玩家朝向的弧度，-PI..PI）。
- `DamageResult` 增加 `headshot`。

### 公共入口增量

- 战斗：`createCombat({ renderer, colliders, targetQuery, emit, spawn?, viewport?, assets? }) -> { reset, update, damagePlayer, heal, getSnapshot, getWeaponState, setViewVisible, setSettings, getSettings, load, dispose }`。
- 敌方：`createEnemies({ renderer, colliders, getSpawnPoint, emit, assets? }) -> { load, reset, startWave, update, getTargetQuery, getState, dispose }`。
- 竞技场：`createArena({ renderer, assets })` 增加 `getDecals()`；`load()` 构建道具/污渍系统。
- 效果：`createEffects({ renderer, decals? })` 增加 `blood(position, direction, color)`、`bulletHole(position, normal)`、`muzzleSmoke(position, direction)`、`shell(position, velocity)`。
- 音频：增加 `enemyShot(distance, enemyType)`、`headshot()`、`shellDrop()`、`setMasterVolume(volume)`、`getMasterVolume()`。
- 渲染 Provider：`setCameraPose` 支持 `roll`；增加 `setQuality('high'|'low')`、`getQuality()`；`render()` 在高画质走后处理、低画质直接渲染。
- 素材 Provider：增加 `loadGltf(url) -> { scene, animations }`；`loadModel(url)` 保持返回 scene。Three 门面显式导出 `AnimationMixer`、`cloneSkinned`（SkeletonUtils clone）。
- Pipeline：增加 `applySettings(partial)`、`getSettings()`、`getPerformance() -> { fps, frameCount, enemyCount, quality, postProcessing }`；`getSnapshot()` 含 `settings`/`performance`。

### 后处理与性能

- 高画质：SSAO + Bloom + 色彩分级（低饱和、暖高光/冷暗部）+ FXAA/SMAA + 暗角/颗粒。
- 低画质：关闭后处理，保留基础 ACES/雾/阴影；设置切换立即生效。
- 性能实测必须记录设备、分辨率、敌人数量、画质、FPS 采样方法与实际数值；未测不得写“60fps”。

## V3-3 v3 证据表（随阶段更新）

| 日期 | 阶段 | 事件 | 证据 |
| --- | --- | --- | --- |
| 2026-10-17 | v3 计划 | 读取设计 §12 与更新 config，确认哈希 | 设计 `781b...45ff`、config `eb05...151f`；本记录 V3 节 |
| 2026-10-17 | v3-art-models | 4 个 Quaternius GLB 下载/结构/动画/尺寸/朝向验证；manifest/attribution/测试/美术方向更新 | `node --test test/美术/asset-manifest.test.js` → 11 pass / 0 fail；Adventurer 1.827m/scale .985、Woman 1.810/1.800/scale .995/1.000、Man 4.827/scale .373；全部 +Z、无根运动；Man 缺 HitRecieve/Gun_Shoot/Run_Shoot/Punch_Left/Right |
| 2026-10-17 | v3-model-settings | 人类敌人配置、设置契约、事件/载荷、Pipeline applySettings/getSettings/getPerformance/爆头/受伤方向/顿帧 | `node --test test/游戏管线/game-state.test.js` → 32 pass / 0 fail；Model import smoke 通过 |
| 2026-10-17 | v3-combat-viewmodel | 高细节程序化 AR-15 + 手套双手、视图动画、后坐/滚转/FOV 冲击、爆头 2 倍、设置、`loadGLTF` 依赖；修复重复 `hud:damage` | `node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js` → 62 pass / 0 fail；`npm run build` 47 modules；仅提示敌方尚未接入的 AnimationMixer/cloneSkinned |
| 2026-10-17 | v3-enemy-human | 三类人类士兵 GLB/动画/装具/头身命中盒/爆头/死亡淡出/枪口与弹丸；无无人机 | `node --test test/敌方服务/waves.test.js test/敌方服务/human-visual.test.js` → 37 pass / 0 fail；Man 缺失剪辑回退、+Z/无根运动、scale 已处理 |
| 2026-10-17 | v3 视觉阻塞 | 真实中心射线命中 `face-mask` 装备；CharacterArmature 100× 导致装备 17m 覆盖相机；环境审计排除道具，战斗隔离排除武器 | 环境 10m spawn audit 仅 wall-e/sign；敌方将装备世界缩放补偿为 1.00，face-mask 0.17×0.11×0.11m；敌方 38/38 |
| 2026-10-17 | v3-environment-upgrade | Provider loadGltf/cloneSkinned/AnimationMixer/roll/setQuality、props/decals/post-processing、Fabric084 保亮度卡其、Wood 降红、低角度光/阴影/雾 | `node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js` → 28 pass / 0 fail；build 1,008.07 kB |
| 2026-10-17 | v3-interface-settings | settings.js/localStorage/菜单+暂停面板/爆头 HUD/方向受击/main 装配/O4 getSettings/getPerformance | `node --test test/界面装配/settings.test.js test/界面装配/hud-format.test.js` → 27 pass / 0 fail；Electron smoke 与 FOV 持久化通过 |
| 2026-10-17 | v3-combat final | 修复 Fabric084 蓝色手套/袖口与 Wood066 红色木件的错误颜色贴图；武器改为深色聚合物/枪金属；HIP 27% 宽、ADS 居中 | 战斗 64/64；`npm run build` 68 modules；证据 `test/战斗服务/evidence/2026-10-17_view-model-hip-final.png` / `_ads-final.png` |
| 2026-10-17 | v3 视觉验收 | 美术复核 `gameplay-09.png` + 新 HIP/ADS：YES；武器材质阻塞解决；静态方向达标；三项非阻断 | `角色卡/美术/docs/feature/art-assets.md` 已更新；`menu-02.png`、`gameplay-08.png`、`gameplay-09.png` |
| 2026-10-17 | v3 当前候选 | 独立测试 v3：集成 12/12、E2E 4/4、角色套件 209/209、build 68 modules；设置持久化/低画质/爆头/人类敌人通过 | 报告 §10；截图 `test/独立测试/fixtures/screenshots-v3/` |
| 2026-10-17 | v3 最终打包 | 在 v3 源码上重新 `npm run pack`、`npm run dist`；解包应用 JS 与 dist 哈希一致；独立测试再次启动验证标题/开始/HUD/人类敌人 | `release/win-unpacked/DUSTLINE.exe` 18:33、`release/DUSTLINE Setup 1.0.0.exe` 18:34；JS `index-B44tpa5e.js` SHA-256 `777f09e9…fb35e`；报告 §11 |
| 2026-10-17 | v3 最终启动 | `npm start` 打开真实窗口，标题 `DUSTLINE · 尘埃战线`；随后关闭 | Windows 窗口标题核对 |
| 2026-10-17 | v3 性能实测 | 6 个步枪兵、1584×861、高/低画质各 3 秒采样约 180 fps（rAF 限制）；30 敌人未测 | 报告 §10.4；未写“60fps” |
| 2026-10-17 | v3 未验证项 | 真人 2 波手感/听音、30 敌人高画质、连续重开 5 次内存、安装包安装/卸载/快捷方式/签名/图标、动画过渡/脚滑/装具穿插逐帧观感、后处理逐 pass 对比 | 报告 §10.7；保留为未验证 |
| 2026-10-17 | v3-fix-ads-scope 根因 | 红点镜 `opticBody` 实心盒前脸不透明，镜片 depthWrite 默认开启，红点暗红且被遮挡；ADS 正对实心前脸 | 战斗 `view-model.js` 1110–1155；修复记录 `角色卡/战斗服务/docs/fix/2026-10-17_fix_ads-black-scope.md` |
| 2026-10-17 | v3-fix-ads-scope 修复 | 四面 0.005m 薄壁开放隧道（内 0.032×0.035）、镜片 opacity 0.12/depthWrite false/DoubleSide、红点 #FF2A1F/toneMapped false/depthWrite false；结构测试 16 项 | 战斗 65/65；`npm run build` 68 modules，`index-0WrKp_Kr.js` SHA-256 `6b8491f9…b971d`；`ads-before.png`/`ads-after.png`/`hip-after.png` |
| 2026-10-17 | v3-fix-ads-scope 独立回归 | 真实 Electron pointer lock ADS：中心 160×160 平均亮度 130.17/255、镜片中心 40×40 113.57/255、红点 37 像素（maxR 245）、方差 1647；前后对照 53.12→112.69、红点 0→8；HIP 正常；E2E 5/5 | 独立测试报告 §12；截图 `test/独立测试/fixtures/screenshots-v3-ads-fix/`；红点质心低于屏幕中心约 21px（2.4%，非阻断观察） |
| 2026-10-17 | v3-fix-ads-scope 打包 | 在 ADS 修复源码上重新 pack/dist；解包应用 JS 与 dist 哈希一致 | `release/win-unpacked/DUSTLINE.exe` 19:12、`release/DUSTLINE Setup 1.0.0.exe` 19:13；JS `index-0WrKp_Kr.js` |
| 2026-10-17 | v3-fix-ads-scope 打包复验 | 打包应用真实 pointer lock ADS：中心 160×160 142.79/255、镜片中心 40×40 113.63/255、红点 36 像素（maxR 220）、HIP 正常、0 页面错误 | 独立测试报告 §13；`packaged-ads-after.png`、`packaged-ads-center-after.png`、`packaged-hip-after.png`；HUD 伤害箭头干扰另存并已用连通域分离 |
| 2026-10-17 | v3-fix-ads-scope 结论 | 黑镜缺陷所有者为战斗服务；代码/结构/真实 Electron/打包回归全部通过；非阻断观察：红点质心约低于屏幕中心 21–23px（≤45px 容差），严格几何居中需另行确认 | 战斗 fix 文档 `status: verified`；独立报告 §12/§13 |

