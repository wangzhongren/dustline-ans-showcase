---
id: player-combat-initial-implementation
type: change
title: 首次实现玩家移动、生命与步枪射击
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related: [player-combat]
events:
  - date: "2026-10-17"
    kind: created
    summary: 按已确认设计 §2.1 与冻结 Service 契约实现战斗服务并通过 41 项单元测试
  - date: "2026-10-17"
    kind: changed
    summary: v3 升级为高细节步枪/双手/视图动画、爆头、镜头反馈与设置；62 项测试通过，Electron 画面待验证
---

# 首次实现玩家移动、生命与步枪射击

## 改了什么

在战斗服务的白名单内新增完整实现，让 Pipeline 可以创建并驱动玩家：

| 路径 | 作用 |
| --- | --- |
| `src/services/abstract/combat.js` | 战斗服务契约、输入/输出类型与事件清单；只有 JSDoc，无运行时代码 |
| `src/services/public/combat.js` | 导出 `createCombat`，把玩家、武器、碰撞与渲染 Provider 公共入口组合成服务 |
| `src/services/impl/combat/collision.js` | 圆-AABB 推出/滑动、边界夹紧、射线-AABB、方向散布、向量工具 |
| `src/services/impl/combat/weapon.js` | 弹药、射击间隔、换弹、散布、后坐力、伤害与暴击的纯状态机 |
| `src/services/impl/combat/player.js` | 移动、跳跃、重力、冲刺、视角、生命/恢复、相机姿态、程序化第一人称步枪 |
| `test/战斗服务/collision.test.js` | 17 项碰撞与射线测试 |
| `test/战斗服务/weapon.test.js` | 24 项武器、玩家生命、`createCombat` 契约与武器显隐测试 |

改动前：`src/services/{abstract,public}/combat.js` 与 `src/services/impl/combat/` 不存在，Pipeline 无战斗服务可调用。

改动后：Pipeline 可以通过 `createCombat({ renderer, colliders, targetQuery, emit })` 获得玩家移动、射击与生命规则的完整服务。

## 行为变化

- **移动与碰撞**：WASD 相对 yaw 移动，Shift 冲刺，Space 仅在着地时跳跃；重力把玩家带回 y=0。玩家以半径 0.45 米的圆与竞技场 AABB 碰撞，分轴推进并在撞墙时保留另一轴，形成贴墙滑动；大位移会细分步进，避免一帧穿过薄墙。
- **视角**：鼠标增量按 0.0022 弧度/像素换算；yaw 规范到 [-π, π]，pitch 限制 ±1.55。相机位置为脚底 + 1.68 米眼高。
- **生命**：100 上限；受伤重置 5 秒恢复延迟，之后 8/秒恢复；治疗不超过上限；生命归零发一次 `player:died`，死亡后不再移动或射击。
- **武器**：0.095 秒/发、弹匣 30、换弹 1.5 秒、备弹无限；空仓提示一次并自动换弹；R 手动换弹；伤害 26，核心命中在调用 `applyDamage` 前乘 2（且只乘一次）。
- **散布/后坐力**：腰射 0.012 弧度，移动 +0.006；ADS 时散布 ×0.35、后坐力 ×0.55、视野 ×0.72。每发抬升 0.012 弧度，按 8 弧度/秒回正。
- **命中扫描**：从 `renderer.getWorldPosition(viewport.width / 2, viewport.height / 2)` 取屏幕中心射线，叠加随机散布后用 `renderer.raycast(origin, direction, 120, targets)` 检测敌人；同时用纯数学射线-AABB 检查墙体，取更近的命中。命中对象的 `userData.targetId` 存在时调用一次 `targetQuery.applyDamage(targetId, damage)`；`userData.part === 'core'` 时先乘暴击倍数。
- **第一人称武器**：程序化 AR 步枪通过 `renderer.attachToCamera` 挂在相机下，整体缩放 0.85；腰射位置 `(0.27, -0.28, -0.58)`，ADS 居中抬高到 `(0, -0.095, -0.42)`；开火时短暂显示暖色枪口闪光。`dispose()` 释放全部几何与材质。
- **菜单显隐**：`createCombat` 返回 `setViewVisible(visible)`，用于在主菜单隐藏第一人称武器（含枪口闪光）；默认可见，`reset()` 恢复可见，非布尔值抛 `TypeError`。
- **事件**：按 `EVENTS` 常量发出 `world:shot`、`world:impact`、`hud:hitmarker`、`enemy:killed`、`hud:damage`、`player:died`、`weapon:reload-start`、`weapon:reload-end`、`weapon:empty`。只有战斗服务发 `enemy:killed`。

## 契约补充

冻结签名 `createCombat({ renderer, colliders, targetQuery, emit })` 保持不变；额外接受两个可选字段：

- `spawn`：出生点，缺省 `{ x: 0, y: 0, z: 8 }`。
- `viewport`：画布 CSS 像素尺寸，缺省 1600 × 900。

`viewport` 出现的原因是渲染 Provider 公共契约没有读取画布宽高的方法，而 `getWorldPosition` 需要像素坐标。装配层若窗口不是 1600 × 900，应传入实际尺寸；这是当前唯一未解决的跨角色契约缺口，需要项目管理协调是否给渲染 Provider 增加只读尺寸方法。

## 验证

命令（项目根目录，2026-10-17，Node v24.11.1，Windows 11）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js
```

实际结果：

```text
tests 41
pass 41
fail 0
cancelled 0
skipped 0
```

导入冒烟：

```sh
node --input-type=module -e "Promise.all([import('./src/services/abstract/combat.js'),import('./src/services/public/combat.js'),import('./src/services/impl/combat/collision.js'),import('./src/services/impl/combat/weapon.js'),import('./src/services/impl/combat/player.js')]).then(m=>console.log(m.map(x=>Object.keys(x).join(',')).join('\n'))).catch(e=>{console.error(e);process.exit(1)})"
```

实际结果：退出码 0，五个模块均可导入，`createCombat` 与各纯函数导出可见。

静态检查：生产代码与测试无三元运算符；战斗服务只导入 Model、`providers/public/three.js` 与同目录实现，不导入其他 Service、Pipeline、Interface、`providers/impl/` 或 `three` 包。

## 同日后续调整：菜单武器显隐与画面占比

根据主菜单实际截图 `test/项目管理/screenshots/menu-02.png`，第一人称步枪在尚未进入对局时仍然可见，遮挡了 O3 菜单场景。调整如下：

- `createCombat` 增加 `setViewVisible(visible)`：显示/隐藏整个第一人称武器组（枪口闪光随组隐藏）；默认可见，`reset()` 恢复可见；非布尔值抛 `TypeError`。Pipeline 可在菜单状态调用 `false`。
- 武器整体缩放 0.85，腰射位置从 `(0.28, -0.26, -0.55)` 调整为 `(0.27, -0.28, -0.58)`；ADS 位置为 `(0, -0.095, -0.42)`，仍保持居中。
- 新增 2 项测试，总数从 39 变为 41；使用普通 `node --test` 运行（根 `package.json` 已切换为 ESM）。

## 未验证

- **Electron 实际画面未检查**：武器模型比例与材质、枪口闪光、ADS 居中、后坐力观感、帧率都没有真实截图证据。
- **真实 Pipeline 与敌方服务联调未执行**：测试使用假渲染器与假目标查询。
- **窗口尺寸变化**：若装配层不传 `viewport`，缩放窗口后中心射线可能偏离准星。
- 所有手感数值仍是设计值与实现默认值，未经过真实对局调参。

## v3 升级：高细节视图模型、射击手感、爆头与设置

### 改了什么

在保持移动/生命/跳跃/换弹/命中扫描行为不变的前提下，按设计 §12.3 升级第一人称表现与手感：

| 路径 | 作用 |
| --- | --- |
| `src/services/impl/combat/view-model.js` | 新增：高细节 AR-15、戴手套双手、视图动画纯状态、抛壳/闪光/烟雾、PBR 贴图应用与释放 |
| `src/services/impl/combat/player.js` | 移除旧武器视图；视角灵敏度与 FOV 改为设置驱动；相机姿态增加滚转/震动/FOV 冲击 |
| `src/services/impl/combat/weapon.js` | 后坐力加入水平漂移与滚转，指数回正；镜头震动与每发 FOV 冲击；爆头倍率改用 `GAME_CONFIG.enemies.headshotMultiplier` |
| `src/services/public/combat.js` | 组合 `view-model.js`；新增 `setSettings` / `getSettings` / `load`；`assets` 可选；爆头判定与 `world:blood`、`weapon:shell-eject` 事件 |
| `src/services/abstract/combat.js` | 更新契约、设置类型、视图模型/素材说明与事件清单 |
| `test/战斗服务/view-model.test.js` | 新增 13 项视图动画、材质、枪口、双手、reset 与 dispose 测试 |
| `test/战斗服务/weapon.test.js` | 更新并扩展到 32 项：爆头、ADS、后坐/滚转/震动/FOV、设置、贴图加载、事件 |

### 行为变化

- **武器视图**：程序化 AR-15 包含上/下机匣、护木、枪管、导气块、前准星、红点镜、拉机柄、抛壳口、弹匣、枪托、握把、扳机护圈、枪口制退器、导轨、背带环与磨损条。深灰金属机匣与深色聚合物护木/握把/枪托在颜色、粗糙度、金属度上分开，棱角有磨损高光，不再是“黑色板砖”。
- **双手**：右手握把、左手护木，手套为深灰织物，袖口与袖筒为卡其战术布；手部由手掌、四指、拇指与袖口组成，随武器后坐、ADS、冲刺与换弹移动。
- **视图动画**：待机呼吸、行走摆动、冲刺下压/倾斜、ADS 平滑过渡、射击后坐、换弹三阶段（弹匣下落/插入、拉机柄）、弹壳重力与寿命、枪口闪光与烟雾。全部由纯状态对象驱动，Node 可测。
- **后坐与镜头**：每发有垂直抬升、按模式左右漂移与镜头滚转，指数回正；每发有 FOV 冲击、镜头震动。ADS 同时降低抬升、漂移、滚转与 FOV 冲击。相机姿态传入 `roll`、`shakeX`、`shakeY`、`fovPunch`。
- **设置**：`setSettings` 使用 Model 的 `normalizeSettings` 校验/夹紧，应用鼠标灵敏度、ADS 灵敏度倍率、基础 FOV 与 ADS FOV；`getSettings` 返回冻结副本。
- **爆头**：命中对象 `userData.part === 'head'` 时，在调用一次 `applyDamage` 前把伤害乘以 `GAME_CONFIG.enemies.headshotMultiplier`（2）。`hud:hitmarker` 与 `enemy:killed` 带 `headshot`；`critical` 作为兼容同义字段保留。
- **新事件**：`world:blood { position, direction, color }` 命中敌人时发出；`weapon:shell-eject { position, velocity }` 每次开火发出。
- **项目管理集成修正**：`damagePlayer()` 不再发 `hud:damage`。敌方服务发 `player:damage`，Pipeline 调用 `damagePlayer` 后统一发布一次带方向的 `hud:damage`，避免重复闪烁。战斗服务仍负责生命、恢复、死亡与 `player:died`。
- **素材与回退**：`load()` 在提供 `assets` 时读取清单的 metal/steel/wood/fabric 组并预加载颜色/法线/粗糙度/金属度贴图；缺失或失败时保留程序化材质，并 `console.error` 记录具体错误。`load()` 幂等。

### 验证

命令（项目根目录，2026-10-17，Node v24.11.1，Windows 11）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
```

实际结果：

```text
tests 62
pass 62
fail 0
cancelled 0
skipped 0
todo 0
```

其中 `collision.test.js` 17 项、`weapon.test.js` 32 项、`view-model.test.js` 13 项。

公共入口导入冒烟（六个模块）：退出码 0，`createCombat`、`createViewModel` 与各纯函数导出可见。

构建：`npm run build` 成功（68 modules，无导入警告；构建时其他角色仍在升级，模块数随其变化）。

静态检查：生产代码与测试无三元运算符；每个 `try/catch` 都 `console.error`；战斗服务只导入 Model、`providers/public/three.js` 与同目录实现，不导入其他 Service、Pipeline、Interface、`providers/impl/` 或 `three` 包。

### 依赖与未验证

- **Electron 实际画面尚未最终验收**：已在运行时检查武器显示/隐藏、腰射与 ADS 取景；武器比例、材质、后坐/滚转/FOV、换弹手势、抛壳与烟雾仍需项目管理/美术在真实对局中确认。
- **真实 Pipeline 与敌方服务联调尚未全部执行**：单元测试使用假渲染器与假目标查询；运行时已确认菜单/对局与武器显隐。
- **主装配**：当前 `src/main.js` 已把 `assets` 传给 `createCombat` 并 `await combat.load()`。
- **渲染 Provider 的 roll**：当前 `three-renderer.js` 已应用 `roll`。
- **窗口尺寸变化**：若装配层不传 `viewport`，缩放窗口后中心射线可能偏离准星。
- 所有手感数值仍是设计值与实现默认值，未经过真实对局调参。

## v3 实机复核修正：占屏、材质与近裁剪面

实际运行时用视图模型显隐对照确认：画面中的巨型暗色板块在隐藏武器后仍然存在，属于环境几何，不是武器/双手；本角色不再处理该板块，环境引擎接手修复。对照截图：

- `test/战斗服务/evidence/2026-10-17_view-model-visible.png`
- `test/战斗服务/evidence/2026-10-17_view-model-hidden.png`

战斗侧调整：

- 视图层缩放从 Model 的 0.85 再乘 0.82，最终 **0.697**；腰射可见包围盒约占画面右下 27% 宽、40% 高，不越过画面中心。
- 材质压低天空反射：金属 `envMapIntensity` 0.18–0.22、聚合物 0.03；贴图色调通过 `VIEW_MODEL_TEXTURE_TINTS` 偏暖；聚合物改为暖调 `#262420`；红点镜片改为浅中性、低不透明度（后续 ADS 黑镜修复中改为开放隧道）。
- 枪托整体前移 0.04，ADS 时托底与近裁剪面保持约 0.18 米距离；木材从枪托顶部移到握把两侧的小面积装饰。
- 新增屏幕空间回归测试：用 `PerspectiveCamera` 投影可见网格包围盒，验证腰射不越过中心、占屏宽度 20%–35%、高度 30%–45%；ADS 红点镜水平居中、整体宽度不超过 20%；腰射/ADS 都没有部件贴近/穿过近裁剪面。

验证（2026-10-17，Node v24.11.1，Windows 11）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
```

```text
tests 65
pass 65
fail 0
```

`npm run build` 成功（68 modules，无导入警告）。取景证据：`test/战斗服务/evidence/2026-10-17_view-model-hip-final.png`、`..._ads-final.png`。自动化浏览器无法取得 pointer lock，ADS 图是在暂停状态手动设置视图模型 ADS 状态并匹配 ADS FOV 后截取；同样的取景由屏幕空间测试覆盖。

最终材质修正：`Fabric084_1K-JPG_Color.jpg` 本身是蓝色、`Wood066_1K-JPG_Color.jpg` 偏红。视图模型对织物（手套/袖口）和木材只应用法线/粗糙度贴图，保留基色（手套 `#2B2E2A`、袖口 `#8A8268`、木材 `#3A3028`）；护木/弹匣/握把/枪托使用聚合物 `#262420`，不套用钢/木颜色图。新增测试确认织物/木材不应用颜色贴图，刷新后的取景截图中蓝色/酒红色块消失。红点镜随后改为开放隧道，详见 [ADS 黑镜修复](../fix/2026-10-17_fix_ads-black-scope.md)。
