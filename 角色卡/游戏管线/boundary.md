# 边界文档：游戏管线

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `src/models/game-config.js` | 竞技场、玩家、敌人与波次共享配置 |
| 单文件 | `src/models/events.js` | HUD/对局事件名称与载荷约定 |
| 单文件 | `src/models/contracts.js` | 跨角色共享数据结构与不变量 |
| 单文件 | `src/pipelines/public/game.js` | Pipeline 公共入口 |
| 单文件 | `src/pipelines/impl/game-state.js` | 对局状态机（纯逻辑） |
| 单文件 | `src/pipelines/impl/game-pipeline.js` | 服务编排与主循环 |
| 目录 | `test/游戏管线/` | 本角色单元测试与夹具 |
| 单文件 | `角色卡/游戏管线/feature-map.md` | 功能导航 |
| 单文件 | `角色卡/游戏管线/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/游戏管线/changelog.md` | 变更日志 |
| 单文件 | `角色卡/游戏管线/functional-description.md` | 模块说明 |
| 单文件 | `角色卡/游戏管线/api-spec.md` | 实际导出与测试证据 |
| 条件目录 | `角色卡/游戏管线/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/游戏管线/docs/feature/` | 功能说明 |
| 条件目录 | `角色卡/游戏管线/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/游戏管线/docs/fix/` | 修复记录 |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
