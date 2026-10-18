---
id: shared-event-bus-design
type: design
title: 共享事件总线设计
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related: []
events:
  - date: "2026-10-17"
    kind: implementation
    summary: 按已确认设计实现事件总线并运行单元测试
---

# 共享事件总线设计

## 要解决的问题

DUSTLINE 的 HUD 需要每帧接收得分、波次、生命、弹药、罗盘角度等信息；效果和音频也需要知道射击、命中、爆炸、受伤等事件。如果界面直接调用 Pipeline 内部对象，就会破坏 `Interface → Pipeline` 的单向依赖，并让 HUD 难以独立测试。

## 采用的方案

项目管理提供一个纯内存事件总线 `src/common/shared/event-bus.js`：

- Pipeline 通过 `emit` 发布 Model 中约定的事件。
- 界面、效果、音频通过 `on` 订阅。
- 订阅返回退订函数，界面销毁时调用，避免重复订阅和内存泄漏。
- 单个处理函数抛错时，总线记录错误并继续派发，避免一个 HUD 问题阻断整个对局。
- `once` 用于一次性事件；`clear` 用于重开/销毁时的批量清理。

## 为什么不是别的方案

- 界面直接持有 Pipeline：耦合更紧，HUD 单元测试必须构造整个对局。
- 全局 DOM 事件：浏览器事件不携带类型化载荷，也把界面与浏览器绑定，不便 Node 测试。
- 第三方事件库：当前需求简单，额外依赖不值得；共享组件必须可审计，几十行实现更易维护。

## 关键行为

| 行为 | 决定 |
| --- | --- |
| 重复订阅 | 保留为独立登记，触发多次；退订函数只移除自己那条。 |
| 派发期间退订 | 使用订阅快照；本次仍按快照执行，新增订阅下一次生效。 |
| 处理器异常 | 捕获后报告到 `onError` 或 `console.error`，继续执行其余处理器。 |
| `once` 异常 | 先移除登记再调用，抛错也不会再次触发。 |
| 空事件名/非函数 | 订阅时立即抛 `TypeError`。 |

## 验证

`test/项目管理/event-bus.test.js` 9 项测试全部通过。消费方接入后的集成行为尚未验证，由独立测试角色在对局流程中检查。
