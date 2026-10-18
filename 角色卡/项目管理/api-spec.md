# 接口说明：项目管理

## 共享事件总线

- 文件：`src/common/shared/event-bus.js`
- 导出：命名导出 `createEventBus(options)`；无默认导出。
- 模块格式：ESM。
- 依赖：无（纯 JavaScript，不访问 DOM/Node/Three.js）。

### `createEventBus(options)`

`options` 可选：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `onError` | `(error, eventName, payload) => void` | 处理函数抛错时的报告回调；未提供时使用 `console.error`。 |

返回对象：

| 方法 | 签名 | 行为 |
| --- | --- | --- |
| `on` | `(eventName, handler) => unsubscribe` | 订阅；同一处理函数可重复订阅，独立触发。 |
| `once` | `(eventName, handler) => unsubscribe` | 只触发一次；处理器抛错也会先移除登记。 |
| `off` | `(eventName, handler) => boolean` | 移除一条匹配登记；返回是否移除。 |
| `emit` | `(eventName, payload?) => number` | 按订阅快照派发；返回调用次数。 |
| `listenerCount` | `(eventName) => number` | 当前登记数。 |
| `clear` | `(eventName?) => void` | 清空指定事件或全部事件。 |

错误语义：处理器抛错不会中断其余处理器；`onError` 自身抛错会再次输出到 `console.error`。非法 `eventName`/`handler` 在订阅时抛 `TypeError`。

## 测试证据

- 文件：`test/项目管理/event-bus.test.js`
- 命令（根 package.json 现为 ESM）：
  `node --test test/项目管理/event-bus.test.js`
- 实际结果 2026-10-17：9 tests / 9 pass / 0 fail。
- 覆盖：订阅与退订、重复订阅、once、异常隔离、未配置 onError、派发期间变更、off/clear、非法参数、无订阅者 emit。
- `test/项目管理/esm-loader.mjs` 仅为 CommonJS 过渡期保留；当前 ESM 环境不再需要。

## 消费方

- 游戏管线：创建总线并发布事件；界面装配：订阅 HUD/对局事件。消费方接入后的集成行为由独立测试角色验证。
