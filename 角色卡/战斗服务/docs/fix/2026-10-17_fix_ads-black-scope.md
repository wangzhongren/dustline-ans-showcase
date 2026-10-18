---
id: ads-black-scope-fix
type: fix
title: ADS 红点镜不再显示黑色实心块
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: verified
related: [player-combat]
events:
  - date: "2026-10-17"
    kind: created
    summary: 红点镜改为开放隧道，镜片低不透明度且红点高亮；65 项测试通过，ADS 截图已复核
  - date: "2026-10-17"
    kind: verified
    summary: 独立测试在真实 Electron 右键 ADS 下完成亮度/红点采样回归，全部断言通过；见报告 §12
---

# ADS 红点镜不再显示黑色实心块

## 问题

玩家按住右键进入 ADS 时，红点镜里是一个黑色实心方块，看不到后面的场景和红点。Hip 视角下武器本身正常，问题只出现在透过镜片瞄准时。

## 原因

`view-model.js` 里的红点镜镜体是一个完整实心 `BoxGeometry(0.042, 0.045, 0.075)`，位于镜片正后方。即使镜片设置了 `transparent: true`，实心盒的前表面仍然是不透明聚合物，遮住了整个视野；镜片还保留了默认 `depthWrite: true`，红点又放在盒子内部/后方，所以红点也被挡住。

## 修复

红点镜不再使用实心盒，改为四面薄壁围成的开放隧道：

- `view-model-optic-frame`：镜框组，前后贯通，中心完全留空。
- 四面薄壁：`view-model-optic-wall-top/bottom/left/right`。外宽 0.042、外高 0.045、长 0.075，壁厚 0.005；内宽 0.032、内高 0.035。
- 前后金属环：`view-model-optic-front-ring` / `view-model-optic-rear-ring`。
- 镜片：`view-model-optic-glass`，透明、`opacity: 0.12`、`depthWrite: false`、`DoubleSide`、浅中性色 `#B0AEA6`；只保留很淡的玻璃感，不会把画面压黑。
- 红点：`view-model-optic-red-dot`，`MeshBasicMaterial` 颜色 `#FF2A1F`、`toneMapped: false`、`depthWrite: false`，放在镜片靠相机一侧的中心轴上。
- 结构参数集中在导出的 `OPTIC_STRUCTURE`，测试直接读取同一份尺寸。

Hip 视角仍能看到完整的镜框、镜片和红点；枪身聚合物/金属材质与缩放不变。

## 验证

命令（项目根目录，2026-10-17，Node v24.11.1，Windows 11）：

```sh
node --test test/战斗服务/collision.test.js test/战斗服务/weapon.test.js test/战斗服务/view-model.test.js
```

实际结果：

```text
tests 65
pass 65
fail 0
```

新增测试覆盖：

- 镜框四面墙都是薄壁（至少一个横向尺寸 ≤ 0.006），左右/上下墙位于中心轴之外。
- 镜框内没有任何接近整机尺寸（宽 > 0.035、高 > 0.035、深 > 0.07）的实心盒。
- 镜片 `transparent === true`、`depthWrite === false`、`opacity` 在 0.08–0.18、`side === DoubleSide`。
- 红点颜色红通道高、绿/蓝低，`toneMapped === false`、`depthWrite === false`，与镜片中心距离 < 0.01。
- ADS 时镜框到相机距离 > 0.2 米（不会进入镜框/近裁剪面），投影到屏幕后水平居中、接近画面中心。

构建：`npm run build` 成功（68 modules）。

## 截图

- 修复前：`test/战斗服务/evidence/ads-fix/ads-before.png`（镜片内黑色实心块）。
- 修复后：`test/战斗服务/evidence/ads-fix/ads-after.png`（能透过镜框看到沙袋/天空，中心有高亮红点）。
- Hip 回归：`test/战斗服务/evidence/ads-fix/hip-after.png`。

自动化浏览器无法取得 pointer lock；上述战斗侧截图是在暂停状态手动设置视图模型 ADS 状态并匹配 ADS FOV 后截取，与屏幕空间测试的取景一致。

## 独立测试证据（2026-10-17）

独立测试角色在真实 Electron、真实 pointer lock、真实右键 ADS 下复测，报告：
`角色卡/独立测试/docs/reports/2026-10-17_report_initial-verification.md` §12（V3-4 ADS 黑镜修复独立复测，2026-10-17）。

| 指标 | 实际值 | 断言 |
| --- | --- | --- |
| ADS 中心 160×160 平均亮度 | **130.17 / 255** | > 40（PASS） |
| 镜片中心 40×40 平均亮度 | **113.57 / 255** | > 60（PASS） |
| 中心 40×40 方差 | 1647 | 记录 |
| 红点像素（R>120 且 R>1.4G、R>1.4B） | **37** | ≥ 3（PASS） |
| 高亮红点像素（R>180 且 R>1.8G、R>1.8B） | 24 | 记录 |
| 高亮红点 `maxR` | 245 | 记录 |

前后同口径对照：中心 40×40 平均亮度 **53.12 → 112.69**，红点像素 **0 → 8**（中心 40×40 内），说明黑镜修复有效。E2E 5/5 通过（测试侧窗口聚焦修复后）；HIP 回归截图显示武器在右下、中心无遮挡。

独立测试截图：
- `test/独立测试/fixtures/screenshots-v3-ads-fix/ads-after.png`（真实 Electron 右键 ADS，1584 × 861）
- `test/独立测试/fixtures/screenshots-v3-ads-fix/ads-center-after.png`（160 × 160 中心裁剪）

## 剩余观察

- **红点质心偏移（非阻断）**：在上述 1584 × 861 ADS 画面中，高亮红点质心位于画面中心下方约 **21 px**（约占画面高度 2.4%）。结构测试允许镜框中心在 NDC ±0.3 内，独立测试允许 ≤45 px，因此黑镜修复通过；若产品要求红点与屏幕几何中心严格重合，需要战斗/美术另做一次对齐决策，不在本次修复范围内。
- 红点亮度/尺寸、镜框厚度与 ADS 下目标可读性仍建议由项目管理/美术做最终人工视觉确认；自动化中心采样不等于人工观感验收。
