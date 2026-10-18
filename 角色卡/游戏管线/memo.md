# 工作线索：游戏管线

- 2026-10-17：角色建立（ANS 引导）。
- 本角色唯一负责 `src/models/`；模型改动会影响界面、战斗、敌人和环境，必须通知项目管理并复测消费方。
- 对局状态：menu → playing → paused / over → playing（重开）。暂停时停止业务更新，继续渲染。
- 2026-10-17：完成 Model 阶段（`src/models/{events,game-config,contracts}.js`）。导入冒烟输出 `22 26 function`；纯函数冒烟 `behavior smoke OK`。项目管理已在调度记录中标记 `model-contracts: verified`。
- 设计未给数字的调参项（玩家速度/跳跃/重力、弹丸速度、射击间隔、命中盒、HUD 刷新间隔、菜单镜头参数等）集中在 `game-config.js`，代码注释标为“实现默认值”。
- 2026-10-17：完成 Pipeline 阶段：
  - `src/pipelines/impl/game-state.js`：纯状态机与计分账本；合法迁移 `menu→playing→paused→playing→over→playing`。
  - `src/pipelines/impl/game-pipeline.js`：服务编排、总线结果事件订阅、主循环、波次、计分、HUD、死亡、静音、武器视图可见性、O3 菜单镜头、O4 快照。
  - `src/pipelines/public/game.js`：唯一公共入口 `createGame`。
  - `test/游戏管线/game-state.test.js`：20 项测试，实际 20 pass / 0 fail。
- 实现决定：波次清空时额外发 `wave:cleared`（Model 已登记、设计流程图使用）；`pickup:spawn` 只传位置，颜色用效果服务默认值；`options` 目前只做类型校验，没有可调字段。
- 武器视图：调用可选的 `combat.setViewVisible()`；`menu`/`over` 隐藏，`playing`/`paused` 显示。开始/重开必须在 `combat.reset()` 之后调用，因为 reset 会把武器恢复可见。
- 根 `package.json` 已由界面装配切换为 `"type": "module"`；Pipeline 测试现在可直接运行 `node --test test/游戏管线/game-state.test.js`。
- `dispose()` 只退订本对局的总线处理并清空波次计时，**不**释放注入服务；装配层负责服务生命周期。
- 契约冻结：`docs/scheduling/neon-strike-delivery.md` §3.5。任何导出或载荷变化先回报项目管理。
- 下一步（不属于本角色写范围）：界面装配把真实服务接到 `bus.emit`、在渲染循环调用 `update(dt)`，并处理指针锁定丢失→`pause()`；独立测试角色验证完整流程与 Electron 画面。当前没有 Electron 视觉或完整流程证据。

## v3（2026-10-17）：人类士兵、设置与反馈契约

- **当前阶段**：v3 Model + Pipeline 设置/契约骨架已完成；对应调度的 `v3-model-settings` 阶段。服务 v3 setter（战斗 `setSettings`、渲染 `setQuality`、音频 `setMasterVolume` 等）仍由其他角色实现。
- **敌人**：`ENEMY_TYPES` 改为 `rifleman / heavy / breacher`；配置按设计 §12.2 写入生命/速度/距离/伤害/分值/弹丸速度/点射参数/命中盒/模型池/动画名。旧 `drone/brute/wraith` 与机械 `palette` 已从 Model 移除，其他角色旧实现/旧测试会暂时失败，等其所有者更新。
- **模型路径**：`enemies.modelPaths` 使用 `models/quaternius-*.glb` 相对 URL；美术的 `asset-manifest.json` v3 需要登记同名文件与键。动画名按设计写入，若美术验证出不同剪辑名由敌方服务做映射/回退。
- **设置**：`GAME_CONFIG.settings = { defaults, ranges }`；`normalizeSettings(partial)` 补默认值并夹紧，`clampSetting(key, value)` 对非有限数抛 `TypeError`、非法画质抛 `RangeError`。Pipeline `applySettings(partial)` 合并当前值而不是重置为默认值。
- **设置转发**：战斗 `setSettings({mouseSensitivity, adsSensitivityMultiplier, fov})`；渲染优先 `setQuality(quality)`，否则 `setPostProcessingEnabled(quality === 'high')`；音频 `setMasterVolume(masterVolume)`。方法缺失时每个方法只警告一次并跳过；方法抛错由 `invokeService` 记录。
- **性能**：`update(dt)` 每帧累加 `frameCount`，用原始 dt 做指数平滑 FPS；`getPerformance()` 返回 `{ fps, frameCount, enemyCount, quality, postProcessing }`。敌人数量取 `enemies.getState().alive`；画质优先问渲染器 `getQuality()`。文档不写“60fps”，这只是仪表。
- **爆头/方向**：`enemy:killed` 的 `headshot` 与 `critical` 互为别名；`hud:hitmarker.headshot` 额外调用可选 `audio.headshot()`；`player:damage.sourcePosition` 按玩家 yaw 换算为 `hud:damage.direction`（0 正前、正值在右，-π..π）。
- **已知契约隐患**：真实战斗服务的 `damagePlayer()` 目前也会发一次不含方向的 `hud:damage`，Pipeline 在带来源的受伤流程中会再发一次带方向的同类事件。Pipeline 已用 `pendingDamageAudio` 保证受伤音效只响一次，但界面会收到两次 `hud:damage`。建议战斗角色在 v3 中停止由 `damagePlayer` 发 `hud:damage`（改由 Pipeline 统一发），或接受重复闪烁；需回报项目管理。
- **击杀顿帧**：`GAME_CONFIG.match.killHitstop = 0.05`；收到 `enemy:killed` 后冻结下一帧业务更新，暂停时计时冻结，`restart()` 清除。已有测试覆盖。
- **测试**：`node --test test/游戏管线/game-state.test.js` → 32 pass / 0 fail（2026-10-17，Node v24，Windows 11）。导入冒烟：events 26 键、contracts 40 个导出、`createGame` 为 function。
- **下一步**：等待战斗/敌方/环境/界面实现 v3 setter 与效果/音频方法，然后由 `v3-pipeline-wire` 复测真实服务联调；本角色当前不做 Electron 视觉验收。
