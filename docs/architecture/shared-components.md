# 共享组件清单

本文件由项目管理维护，记录 `src/common/shared/` 中跨角色复用的组件。每个组件只在这里描述一次；消费方在自己的功能文档中链接本页。

## 事件总线 `createEventBus`

| 项目 | 内容 |
| --- | --- |
| 名称与用途 | 跨角色内存事件总线。Pipeline 用它发布 HUD/世界事件，界面、效果和音频消费，从而避免界面直接依赖 Pipeline 内部实现。 |
| 代码与公共入口 | `src/common/shared/event-bus.js`，命名导出 `createEventBus(options)`。 |
| 维护者 | 项目管理。 |
| 当前消费方 | 游戏管线（订阅 Service 结果事件并计分/转发）、界面装配（订阅 HUD 与对局状态）、装配入口（创建总线并把 Service 的 `emit` 接到 `bus.emit`）。环境/效果/音频 Service 通过注入的 `emit` 发布结果事件。 |
| 契约 | `createEventBus({ onError? }) -> { on, once, off, emit, listenerCount, clear }`。`on/once` 返回退订函数；`off` 返回是否移除；`emit` 返回调用次数。重复订阅独立触发；单个处理器抛错不阻断其余处理器，错误交给 `onError` 或 `console.error`。 |
| 示例 | `const bus = createEventBus(); const off = bus.on('hud:update', render); bus.emit('hud:update', payload); off();` |
| 测试与影响 | `test/项目管理/event-bus.test.js`，9 项测试覆盖订阅/退订、重复订阅、once、异常隔离、派发期间变更、clear 与非法参数。共享行为变化会使消费方证据失效，需要复测。 |
| 集成证据 | 2026-10-17：Pipeline 20 项测试、界面 12 项测试、全套 120+ 项角色测试通过；Electron 冒烟验证事件驱动的菜单/开始/HUD/暂停/死亡/重开。 |
| 兼容性 | 纯 JavaScript、无 DOM/Node 依赖；ESM 命名导出。没有默认导出。 |

### 设计理由

HUD 更新频率高、消费者多（界面、效果、音频）。如果界面直接调用 Pipeline 或 Service，会破坏 `Interface → Pipeline` 的单一依赖方向。事件总线把“发布者”和“订阅者”解耦，同时保持载荷由 Model 中的事件契约约束。

### 当前状态

- 已实现并测试：2026-10-17，`node --test test/项目管理/event-bus.test.js` → 9 pass / 0 fail。
- 已接入真实 Pipeline/界面：独立测试的 Electron E2E 与集成测试通过；事件驱动的 HUD/暂停/死亡/重开已验证。
- v3：新增 `world:enemy-shot`、`world:blood`、`weapon:shell-eject`、`settings:changed` 等事件仍通过同一总线；Pipeline 订阅并映射到效果/音频，界面订阅 HUD/设置。
- 尚未验证：30 敌人与长时间对局下的事件频率/性能。
