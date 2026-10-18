# 边界文档：项目管理

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `src/common/shared/event-bus.js` | 跨角色共享的事件总线 |
| 目录 | `test/项目管理/` | 本角色负责的共享组件测试与夹具 |
| 单文件 | `docs/architecture.md` | 项目总体架构与角色协作 |
| 单文件 | `docs/architecture/shared-components.md` | 共享组件清单及消费方 |
| 单文件 | `docs/project-rules.md` | 项目工程规则 |
| 条件目录 | `docs/scheduling/` | 任务计划、步骤表与事件记录 |
| 条件目录 | `docs/meetings/` | 客户要求的会议记录 |
| 单文件 | `角色卡/项目管理/feature-map.md` | 功能导航（无直接业务功能） |
| 单文件 | `角色卡/项目管理/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/项目管理/changelog.md` | 本角色变更日志 |
| 单文件 | `角色卡/项目管理/functional-description.md` | 本角色模块说明 |
| 单文件 | `角色卡/项目管理/api-spec.md` | 共享组件实际导出与测试证据 |
| 条件目录 | `角色卡/项目管理/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/项目管理/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/项目管理/docs/fix/` | 修复记录 |
| 条件目录 | `角色卡/项目管理/docs/feature/` | 功能说明（如以后出现直接业务功能） |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
