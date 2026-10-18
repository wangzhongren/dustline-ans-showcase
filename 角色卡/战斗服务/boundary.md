# 边界文档：战斗服务

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `src/services/abstract/combat.js` | 战斗服务契约与输入/输出类型 |
| 单文件 | `src/services/public/combat.js` | 战斗服务公共入口与工厂 |
| 单文件 | `src/services/impl/combat/player.js` | 玩家移动、生命与视角状态 |
| 单文件 | `src/services/impl/combat/weapon.js` | 武器、射击、后坐力、弹药与换弹 |
| 单文件 | `src/services/impl/combat/view-model.js` | 第一人称高细节步枪、双手与视图动画 |
| 单文件 | `src/services/impl/combat/collision.js` | 圆与 AABB 碰撞、射线数学等纯函数 |
| 目录 | `test/战斗服务/` | 本角色单元测试与夹具 |
| 单文件 | `角色卡/战斗服务/feature-map.md` | 功能导航 |
| 单文件 | `角色卡/战斗服务/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/战斗服务/changelog.md` | 变更日志 |
| 单文件 | `角色卡/战斗服务/functional-description.md` | 模块说明 |
| 单文件 | `角色卡/战斗服务/api-spec.md` | 实际导出与测试证据 |
| 条件目录 | `角色卡/战斗服务/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/战斗服务/docs/feature/` | 功能说明 |
| 条件目录 | `角色卡/战斗服务/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/战斗服务/docs/fix/` | 修复记录 |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
