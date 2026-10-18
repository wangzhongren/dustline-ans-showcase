---
id: pm-initial-implementation-change
type: change
title: 项目管理初始实施与调度记录
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: verified
related: [shared-event-bus-design]
events:
  - date: "2026-10-17"
    kind: implementation
    summary: 建立共享事件总线、项目文档与交付调度
  - date: "2026-10-17"
    kind: verified
    summary: 独立测试与最终回归通过，共享总线已接入真实对局
---

# 项目管理初始实施与调度记录

## 用户能看到的变化

这一阶段没有直接进入游戏画面的变化。它建立的是后续所有角色共同使用的底座：统一的事件通道、架构说明、工程规则和交付顺序。该底座已被真实界面与 Pipeline 接入，事件驱动的 HUD、暂停、死亡与重开已在 Electron 中验证。

## 具体做了什么

1. 新增 `src/common/shared/event-bus.js`，提供订阅、退订、一次性订阅、异常隔离与批量清理。
2. 新增 `test/项目管理/event-bus.test.js`，9 项测试全部通过。
3. 新增 `docs/architecture.md`、`docs/architecture/shared-components.md`、`docs/project-rules.md`。
4. 新增 `docs/scheduling/neon-strike-delivery.md`，记录阶段、依赖、冻结契约和证据。
5. 记录 `task_ops` 不可用的原因：已批准配置把 `角色卡/...` 文档列入 `writeFiles`，CLI 视为治理文件并拒绝；配置不由本角色修改。
6. 协调 8 个角色完成交付，修复 `listHittable` 契约形状与菜单武器可见问题，完成两轮真实截图视觉复核。

## 没有做什么

- 没有修改其他角色代码、`.ans/project.json`、角色卡边界或治理文档。
- 没有进行真人 2 波手感/听音、30 敌人性能、安装包安装/卸载与签名/图标验证；这些在独立测试报告中列为未验证。

## 验证

- 命令：`node --test test/项目管理/event-bus.test.js`
- 结果：9 tests / 9 pass / 0 fail。
- 最终回归：单元+集成 139/139、界面 12/12、Electron 冒烟全部 PASS；独立测试集成 7/7、E2E 2/2。
- 最终构建与打包：`npm run build`、`npm run pack`、`npm run dist` 均成功；产物见调度记录 §5。
