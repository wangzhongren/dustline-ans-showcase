# 变更日志：战斗服务

## 2026-10-17 — 修复 ADS 红点镜黑色实心块

- 原因：镜体是完整实心 `BoxGeometry(0.042, 0.045, 0.075)`，遮住镜片和红点；镜片 `depthWrite` 为默认 `true`，红点在实心盒内部。
- 修复：改为 `view-model-optic-frame` 四面薄壁开放隧道（壁厚 0.005，内宽 0.032、内高 0.035，前后贯通），保留前后金属环与底座；镜片 `view-model-optic-glass` 改浅中性 `#B0AEA6`、`opacity: 0.12`、`depthWrite: false`、`DoubleSide`；红点 `view-model-optic-red-dot` 改 `#FF2A1F`、`toneMapped: false`、`depthWrite: false`，放在镜片中心靠相机一侧。结构参数集中到导出的 `OPTIC_STRUCTURE`。
- 新增结构测试：四面墙为薄壁、中心无实心盒、镜片低不透明度且不写深度、红点高亮且靠近镜片中心、ADS 相机到镜框距离与居中。
- 验证：`node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js` → **65 pass / 0 fail**（Node v24.11.1，Windows 11）；`npm run build` 成功（68 modules）。
- 截图：`test/战斗服务/evidence/ads-fix/ads-before.png`（黑镜）、`ads-after.png`（透出场景 + 红点）、`hip-after.png`（腰射回归）。
- 文档：新增 `docs/fix/2026-10-17_fix_ads-black-scope.md`，并更新 `api-spec.md`、`docs/feature/player-combat.md`、变更记录与 `memo.md`。

## 2026-10-17 — v3 最终材质修正：移除蓝色/酒红贴图块

- 运行时确认 `Fabric084_1K-JPG_Color.jpg` 本身是亮蓝色，`Wood066_1K-JPG_Color.jpg` 偏红；此前把手套/袖口/木材直接套用颜色图，导致枪身出现亮蓝色块和酒红色块。
- 视图模型现在对织物（手套/袖口）和木材只应用法线/粗糙度贴图，保留材质基色：手套 `#2B2E2A`、袖口 `#8A8268`、木材 `#3A3028`。护木/弹匣/握把/枪托始终使用聚合物 `#262420`，不套用钢/木颜色图。
- 金属/钢仍使用偏暖色调颜色图；红点镜片改为中性暗灰 `#2A2C2C`、不透明度 0.4。
- 新增测试：确认织物/木材不应用颜色贴图（只加载法线/粗糙度），金属/钢仍使用颜色图。`load` 测试更新为 12 次贴图加载，其中仅 2 次颜色贴图。
- 实际运行：`node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js` → **64 pass / 0 fail**（Node v24.11.1，Windows 11）；`npm run build` 成功（68 modules）。
- 取景证据已刷新：`test/战斗服务/evidence/2026-10-17_view-model-hip-final.png`、`..._ads-final.png`；蓝色/酒红色块消失，袖口为卡其布、枪身为深灰/聚合物。

## 2026-10-17 — v3 实际画面复核：缩小武器占屏、压低蓝紫反射、屏幕空间测试

- 实机运行时把整个第一人称视图隐藏后，画面中的巨型暗色板块仍然存在；对照截图保存在 `test/战斗服务/evidence/2026-10-17_view-model-visible.png` 与 `..._view-model-hidden.png`，证明该板块属于环境几何，不是武器/双手。环境引擎已接手修复。
- 视图模型基础缩放仍来自 Model 的 0.85，视图层再乘 0.82，最终 **0.697**；腰射可见范围约画面右下 27% 宽、40% 高。
- 材质压低 `envMapIntensity`（金属 0.18–0.22，聚合物 0.03）并使用偏暖贴图色调 `VIEW_MODEL_TEXTURE_TINTS`，减少阴天蓝色 HDRI 造成的蓝紫反光；聚合物颜色调整为暖调 `#262420`，红点镜片改为暗棕、降低不透明度。
- 枪托整体前移，ADS 时托底不贴近相机近裁剪面；木材只保留握把两侧的小面积装饰，不再放在枪托顶部。
- 新增屏幕空间回归测试：用透视相机投影可见网格包围盒，验证腰射不越过画面中心、占屏宽度/高度，ADS 红点镜居中且宽度受限，腰射/ADS 均不穿过近裁剪面。
- 测试：`node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js` → **63 pass / 0 fail**（Node v24.11.1，Windows 11）。`npm run build` 成功（68 modules，无导入警告）。
- 证据：`test/战斗服务/evidence/2026-10-17_view-model-hip-final.png`、`..._ads-final.png`（ADS 图在暂停状态设置视图模型 ADS 状态并匹配 ADS FOV 后截取，因为自动化浏览器无法取得 pointer lock）。
- 更新 `api-spec.md`、`docs/feature/player-combat.md`、`docs/change/2026-10-17_change_initial-implementation.md`、`functional-description.md`、`memo.md`。

## 2026-10-17 — v3 高细节视图模型、射击手感、爆头与设置

- 新增 `src/services/impl/combat/view-model.js`：程序化高细节 AR-15（上/下机匣、护木、枪管、导气块、准星、红点镜、拉机柄、抛壳口、弹匣、枪托、握把、扳机护圈、枪口制退器、导轨、背带环、磨损条），戴手套的双手与战术袖口；金属机匣与聚合物护木在颜色/粗糙度/金属度上分开。
- 视图动画由纯状态对象驱动：待机呼吸、行走摆动、冲刺下压/倾斜、ADS 平滑过渡、射击后坐、换弹三阶段（弹匣下落/插入、拉机柄）、抛壳重力与寿命、枪口闪光与烟雾。双手跟随武器变换。
- `weapon.js` 增加垂直抬升 + 水平漂移 + 镜头滚转、指数回正、镜头震动与 FOV 冲击；ADS 同时削弱后坐力、漂移、滚转与 FOV 冲击。
- `player.js` 支持设置驱动的鼠标灵敏度、ADS 灵敏度倍率、基础 FOV 与 ADS FOV；相机姿态新增 `roll`、`shakeX`、`shakeY` 与 `fovPunch`。
- `createCombat` 新增 `assets` 可选参数与 `setSettings`、`getSettings`、`load`；`load()` 幂等预加载 metal/steel/wood/fabric PBR 贴图，缺失时使用程序化材质并记录一次提示。
- 命中判定改为 `userData.part === 'head'` 爆头，伤害在 `applyDamage` 前乘以 `GAME_CONFIG.enemies.headshotMultiplier`（2），只乘一次；新增 `world:blood` 与 `weapon:shell-eject` 事件，`hud:hitmarker` / `enemy:killed` 增加 `headshot`。
- 按项目管理 v3 集成修正：`damagePlayer()` **不再发 `hud:damage`**；该事件由 Pipeline 统一发布带方向的版本。战斗服务只保留 `player:died` 与生命/恢复/死亡规则。
- `view-model.js` 只导入 `src/providers/public/three.js`；不访问 `providers/impl/`、`resource/` 或其他 Service。
- 测试：新增 `test/战斗服务/view-model.test.js`（13 项），更新 `weapon.test.js`（32 项）与 `collision.test.js`（17 项）；实际运行 `node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js` → **62 pass / 0 fail**（Node v24.11.1，Windows 11）。
- 公共入口导入冒烟退出码 0；`npm run build` 成功（47 modules）。构建中敌方服务 `human-visual.js` 的 `AnimationMixer`/`cloneSkinned` 导出警告不属于本角色。
- 未验证：Electron 实际画面与手感、真实 Pipeline/敌方联调、渲染 Provider 的 `roll` 应用、主装配传 `assets` 并 `await load()`。文档：更新 `api-spec.md`、`docs/feature/player-combat.md`、`docs/change/2026-10-17_change_initial-implementation.md`、`functional-description.md`、`feature-map.md`、`memo.md`。

## 2026-10-17 — 菜单武器显隐与画面占比调整

- `createCombat` 新增 `setViewVisible(visible)`：显示/隐藏第一人称武器组（含枪口闪光）；默认可见，`reset()` 恢复可见，非布尔值抛 `TypeError`。依据主菜单截图 `test/项目管理/screenshots/menu-02.png`，Pipeline 可在菜单状态隐藏武器，避免遮挡 O3 场景。
- 第一人称武器整体缩放 0.85；腰射位置调整为 `(0.27, -0.28, -0.58)`；ADS 位置 `(0, -0.095, -0.42)`，保持居中。
- `test/战斗服务/weapon.test.js` 新增 2 项显隐与视觉参数测试。
- 实际运行结果：`node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js` → 41 pass / 0 fail（Node v24.11.1，Windows 11）。
- 更新 `api-spec.md`、`docs/feature/player-combat.md` 与初始实现变更文档。菜单截图复验仍待 Pipeline 接线后执行。

## 2026-10-17 — 首次实现

- 新增 `src/services/abstract/combat.js`：战斗服务契约、`Collider`/`Options`/`CombatService`/`WeaponState` 类型与事件清单，无运行时代码。
- 新增 `src/services/public/combat.js`：`createCombat({ renderer, colliders, targetQuery, emit })`，可选 `spawn`、`viewport`。
- 新增 `src/services/impl/combat/collision.js`：圆-AABB 推出、分轴滑动、竞技场夹紧、射线-AABB、方向散布、向量工具。
- 新增 `src/services/impl/combat/weapon.js`：弹药、射击间隔、自动/手动换弹、散布、后坐力、伤害与暴击状态机。
- 新增 `src/services/impl/combat/player.js`：移动、跳跃、重力、冲刺、视角、生命/恢复/死亡、相机姿态、程序化 AR 步枪与枪口闪光。
- 新增 `test/战斗服务/collision.test.js`（17 项）与 `test/战斗服务/weapon.test.js`（22 项）。
- 实际运行结果：39 pass / 0 fail（Node v24.11.1，Windows 11，使用临时 ESM loader）。
- 文档：建立 `feature-map.md`、`docs/feature/player-combat.md`、`docs/change/2026-10-17_change_initial-implementation.md`、`functional-description.md`、`api-spec.md`。
- 未验证：Electron 实际画面、真实 Pipeline/敌方服务联调、窗口尺寸变化下的中心射线。
