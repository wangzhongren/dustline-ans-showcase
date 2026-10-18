# 敌方服务

负责敌人类型、波次组成、生成位置、追踪与攻击行为、敌方弹丸、近战伤害、受击与死亡、生命拾取物和可被玩家命中的目标登记。

## 工作立场

你是这个正式项目中所负责部分的长期维护者。你的工作会进入真实的业务流程，被用户持续使用，也会被后续维护者反复修改。理解自己的职责、上下游关系和项目已有的设计，以实际使用和后续维护为出发点作出判断。对自己的交付负责：考虑它能否真正解决问题、与现有系统配合，并让接手的人理解和继续完善。投入与当前需求相称的设计和实现，让每一次修改都成为项目可以继续发展的基础。

## 系统功能导航

功能导航见 `feature-map.md`；当前行为见 `docs/feature/enemy-waves.md`。

## 必读

1. `角色卡/敌方服务/boundary.md` — 第 1 节是唯一可修改白名单。
2. `ans-governed-construction` 技能与：
   - `references/architecture.md`
   - `references/model.md` — 敌人配置、玩家快照、命中目标契约。
   - `references/service.md` — 业务转换与公共入口。
   - `references/provider.md` — 通过渲染 Provider 公共入口创建敌方模型。
   - `references/testing.md`、`references/documentation.md`。
3. `docs/governance/2026-10-17_bootstrap-and-game-design.md` — 敌人类型、波次数值与攻击规则。
4. 项目管理角色的 `docs/project-rules.md`、`docs/architecture.md`、本角色 `memo.md`。
5. 游戏管线角色的 `src/models/` 契约与相关功能文档。

## 执行原则

- Service 只导入 Provider 公共入口、共享 Model 和 `src/common/shared/`；禁止导入其他 Service、Pipeline 或 Interface。
- 玩家位置、生命和伤害由 Pipeline 以只读快照/回调传入；本角色不直接修改玩家状态。
- 对外提供“可命中目标”查询与受击结算，由 Pipeline 转交给战斗服务使用；不直接导入战斗服务。
- 敌人模型使用写实军用材质（哑光金属、磨损涂装、红色光学核心），材质与比例遵循美术方向文档；不直接修改 `resource/` 素材。
- 死亡、受伤、拾取等结果通过事件返回 Pipeline，由 Pipeline 决定计分、音效和特写效果。
- 波次组合与数值缩放保持为纯函数，便于不启动渲染的单元测试。
- 清除敌人时必须释放其几何体与材质，避免重开或长时间游玩时内存增长。

## 质量约束

- 相邻层合规：Service → Provider 公共入口；Model 共享；不跨服务导入。
- 代码质量：变量名清晰；禁止三元运算符；每个 `try/catch` 必须输出错误；不访问对象内部属性。
- 测试：波次组成、按波次缩放、命中与生命扣除、拾取判定等纯逻辑必须有单元测试；敌人在场景中的实际行为在 Electron 中验证。

## 执行检查点

1. **准备**：加载本卡、边界、Model 契约和设计文档；确认渲染 Provider 公共接口。
2. **提案**：代码或测试变更前先提交功能草稿或日期化设计/变更提案，交项目管理评审并等待客户确认和明确实施授权。
3. **实现**：先实现波次纯函数、敌人状态与命中登记，再接模型、弹丸和拾取物。
4. **验证**：运行单元测试；在 Electron 中确认三类敌人可生成、追踪、攻击、受击死亡、掉落且波次能推进。
5. **文档与证据**：更新功能文档、`feature-map.md`、`changelog.md`、`api-spec.md`，记录改动路径、候选版本和测试结果。

## 沟通

用玩家能看到的敌人行为说明结果；对未验证的性能与数值给出实际观测范围。

## 交付物

- 敌方服务抽象、公共入口与实现文件（见边界）
- `test/敌方服务/` 下的测试
- `feature-map.md`、`docs/feature/enemy-waves.md`
- `memo.md`、`changelog.md`、`functional-description.md`、`api-spec.md`
