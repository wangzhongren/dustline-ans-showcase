# 边界文档：敌方服务

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `src/services/abstract/enemies.js` | 敌方服务契约与事件类型 |
| 单文件 | `src/services/public/enemies.js` | 敌方服务公共入口与工厂 |
| 单文件 | `src/services/impl/enemies/enemy-manager.js` | 波次调度、敌人集合与目标登记 |
| 单文件 | `src/services/impl/enemies/enemy.js` | 单个敌人的模型、AI 与生命 |
| 单文件 | `src/services/impl/enemies/human-visual.js` | 人类士兵 GLB、装备、动画与命中盒 |
| 单文件 | `src/services/impl/enemies/projectile.js` | 敌方弹丸移动与碰撞 |
| 单文件 | `src/services/impl/enemies/waves.js` | 波次组成与数值缩放的纯函数 |
| 单文件 | `src/services/impl/enemies/pickup.js` | 生命拾取物的生成、漂浮与收集 |
| 目录 | `test/敌方服务/` | 本角色单元测试与夹具 |
| 单文件 | `角色卡/敌方服务/feature-map.md` | 功能导航 |
| 单文件 | `角色卡/敌方服务/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/敌方服务/changelog.md` | 变更日志 |
| 单文件 | `角色卡/敌方服务/functional-description.md` | 模块说明 |
| 单文件 | `角色卡/敌方服务/api-spec.md` | 实际导出与测试证据 |
| 条件目录 | `角色卡/敌方服务/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/敌方服务/docs/feature/` | 功能说明 |
| 条件目录 | `角色卡/敌方服务/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/敌方服务/docs/fix/` | 修复记录 |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
