# 模块说明：战斗服务

## 负责什么

战斗服务负责第一人称玩家在对局中的全部即时操作与生存规则：

- 玩家移动、冲刺、跳跃、重力、鼠标视角与相机姿态。
- 玩家与竞技场边界、箱子/墙体的圆-AABB 碰撞、推出与贴墙滑动。
- 生命值、受伤后的恢复延迟与恢复速度、治疗、死亡与复位。
- AR 步枪的射击间隔、弹药、自动/手动换弹、散布、后坐力、镜头震动、FOV 冲击与命中伤害。
- 命中扫描的射线方向、爆头判定、敌人目标结算调用、墙体命中判定。
- 第一人称高细节 AR-15 视图模型、戴手套的双手、ADS/冲刺/换弹/抛壳动画。
- 视图模型的占屏比例、材质冷暖与近裁剪面安全（缩放 0.697、偏暖低反射材质、屏幕空间回归测试）。
- 鼠标灵敏度、ADS 灵敏度倍率与视野设置的应用。

## 不负责什么

- 敌人存在、AI、弹丸、波次、掉落与拾取得分：敌方服务。
- 命中后的敌人生命扣除实现：敌方服务通过 `targetQuery.applyDamage` 提供。
- `hud:damage` 的发布与方向计算：Pipeline（它接收敌方服务的 `player:damage` 后统一发布）。
- 得分、波次推进、暂停、结算、重开流程：Pipeline。
- 弹道线、命中火花/血雾、爆炸、屏幕红边、音效：环境引擎的反馈/音频服务，通过事件消费。
- 场景几何、碰撞体生成、出生点合法性：环境引擎。
- HUD、菜单、输入采集与指针锁定：界面装配。
- 全局数值与事件名：游戏管线维护的 `src/models/`。

## 文件结构

```text
src/services/
  abstract/combat.js       契约、设置类型与事件说明（无运行时逻辑）
  public/combat.js         公共入口 createCombat（组合、事件翻译、设置与加载）
  impl/combat/
    collision.js           纯数学：圆-AABB、射线-AABB、散布、向量
    weapon.js              纯状态机：弹药、射击间隔、换弹、后坐力/震动/FOV、伤害
    player.js              玩家状态、生命、视角、相机姿态
    view-model.js          高细节步枪、双手、视图动画纯状态与 Three.js 几何
test/战斗服务/
  collision.test.js        碰撞与射线测试
  weapon.test.js           武器、玩家、设置、事件与 createCombat 契约测试
  view-model.test.js       视图动画纯状态、材质分层、枪口与释放测试
```

## 调用方向

```text
Pipeline
  -> src/services/public/combat.js (createCombat)
     -> src/services/impl/combat/player.js
        -> src/models/*
     -> src/services/impl/combat/weapon.js
        -> src/models/game-config.js
     -> src/services/impl/combat/collision.js
     -> src/services/impl/combat/view-model.js
        -> src/providers/public/three.js
     -> src/providers/abstract/renderer.js (仅 JSDoc 类型)
```

战斗服务不导入其他 Service、Pipeline、Interface、`src/providers/impl/` 或 `three` 包。Three.js 符号只从 `src/providers/public/three.js` 获取；渲染器由 Pipeline 注入。贴图通过可选的 `assets` 加载器（Provider 公共入口）读取清单，不直接访问 `resource/`。

## 状态归属

服务内部持有四组状态，全部通过方法读取或复位，不暴露可变引用：

| 状态 | 持有者 | 对外读取 |
| --- | --- | --- |
| 玩家位置、速度、yaw/pitch、生命、恢复计时 | `impl/combat/player.js` 中的普通对象 | `getSnapshot()` |
| 弹药、换弹计时、射击冷却、后坐力/震动/FOV、瞄准 | `impl/combat/weapon.js` 中的普通对象 | `getWeaponState()`（只暴露弹药/换弹/瞄准） |
| 第一人称视图动画状态（呼吸/摆动/ADS/后坐/换弹/弹壳/烟雾） | `impl/combat/view-model.js` 中的普通对象 | 内部使用；测试可用 `createViewState()` |
| 战斗设置（灵敏度、ADS 倍率、FOV） | `public/combat.js` 中的冻结对象 | `getSettings()` |

全局得分、击杀数、波次不在本服务内维护。`enemy:killed` 只报告单次击杀结果。

## 协作方式

1. Pipeline 创建 `createCombat({ renderer, colliders, targetQuery, emit, spawn?, viewport?, assets? })`。
2. 装配在开始对局前 `await combat.load()`，让视图模型预加载 PBR 贴图。
3. 每帧调用 `update(dt, input)`，输入来自 Model 的 `InputCommand`。
4. 敌人命中通过注入的 `targetQuery` 完成；战斗服务不导入敌方服务。命中 `userData.part === 'head'` 时先把伤害乘 2。
5. 事件通过注入的 `emit` 发出，Pipeline 决定广播、计分与音频映射。`hud:damage` 由 Pipeline 发布，不由本服务发布。
6. 玩家生命由敌方攻击经 Pipeline 调用 `damagePlayer(amount)` 扣除，拾取物调用 `heal(amount)`。
7. 设置变化时 Pipeline 调用 `setSettings({ mouseSensitivity, adsSensitivityMultiplier, fov })`。
8. 主菜单等非对局状态由 Pipeline 调用 `setViewVisible(false)` 隐藏第一人称视图；对局开始调用 `reset()` 或 `setViewVisible(true)` 恢复。
9. 重开时 Pipeline 调用 `reset()`；退出时调用 `dispose()`。

## 已知限制

- 渲染 Provider 没有画布尺寸读取方法，服务接受可选 `viewport`，缺省 1600 × 900。
- 玩家只在 y=0 地面落地，不支持站到箱子顶部。
- 一帧最多发射一发（delta 上限 0.05 秒小于 0.095 秒射击间隔）。
- 渲染 Provider 已应用相机姿态中的 `roll`；视图层同时提供震动偏移与 FOV 冲击。
- 当前主装配已传 `assets` 并 `await load()`；缺失时仍会退回程序化材质。
- 视觉取景已做运行时检查（见 `test/战斗服务/evidence/`），但手感数值仍来自设计/实现默认值，尚未完成真实对局调参。
