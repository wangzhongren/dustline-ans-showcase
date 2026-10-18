# 变更日志：美术

## 2026-10-17

- 下载设计 §2.4 指定的 8 个 CC0 来源（Poly Haven HDRI、6 组 ambientCG 贴图、Poly Pizza 步枪 GLB），全部 HTTP 200，无失败、无重试。
- 在系统临时目录的独立空目录解压，只提取实际使用的通道；`resource/` 保留 25 个素材文件，约 18 MB，无 `.zip`/`.blend`/`.usdc`/`.mtlx`/`.tres`/预览 PNG 残留。
- 新增 `resource/asset-manifest.json`（符合调度记录 §4 冻结结构）与 `resource/ATTRIBUTIONS.md`（逐文件 CC0 记录）。
- 新增 `test/美术/asset-manifest.test.js`；执行 `node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/美术/asset-manifest.test.js`，结果 8 pass / 0 fail。
- 新增美术方向文档 `docs/design/2026-10-17_design_art-direction.md`、功能文档 `docs/feature/art-assets.md`、变更记录 `docs/change/2026-10-17_change_asset-intake.md`。
- 新增 `feature-map.md`、`functional-description.md`、`api-spec.md`；更新 `memo.md`。
- 未完成：Electron 视觉验收与步枪 GLB 观感评估，等待环境实现。

## 2026-10-17（视觉验收）

- 检查管理角色捕获的 `test/项目管理/screenshots/menu-04.png` 与 `gameplay-03.png`。
- 结论：首轮视觉验收**通过**。阴天/部分多云天空、灰蓝雾、低饱和军用色、柔和阴影成立；地面、混凝土、木材、波纹钢表面可辨认；没有霓虹元素。
- 步枪 GLB：轮廓可辨，但画面偏暗，机匣与护木材质区分不足；判定为非阻塞打磨项，不触发程序化替换。
- 沙袋/帆布：环境引擎用“中性程序化噪声 × 卡其色”替换了偏蓝的 Fabric084 颜色通道。本轮可接受，因为法线/粗糙度/AO 仍保留且堆叠读作卡其；但要求后续改为“真实颜色贴图的保亮度色相重映射”，以恢复织纹细节。
- 非阻塞打磨项（按优先级）：
  1. 帆布/沙袋：用真实颜色贴图做保亮度卡其重映射，替换程序化噪声颜色。
  2. 步枪：提高暗部亮度或降低暗部金属度，让机匣与护木分开。
  3. 木箱：偏红的木色略降饱和，向中性棕色靠拢。
- 功能文档状态更新为 `verified`（带上述 3 项已知打磨项）；`memo.md`、`functional-description.md`、`api-spec.md` 的验证状态同步更新。

## 2026-10-17（v3 人类模型）

- 按设计 §12.5 下载四个 CC0 Quaternius GLB 到系统临时目录的独立空目录，全部 HTTP 200、`content_type=gltf-binary`；未执行包内任何内容。
  - Adventurer：1,944,116 B，SHA-256 `4a8639cd...99f66db`
  - Woman Casual：1,530,616 B，SHA-256 `a2212729...f74dca8`
  - Woman Formal：1,491,780 B，SHA-256 `a6522fe5...a9bb2d17`
  - Man base：493,196 B，SHA-256 `dad8fa3c...4a37fc58`
- 复制到 `resource/models/quaternius-{adventurer,woman-casual,woman-formal,man-base}.glb`；文件头 `glTF`、声明长度等于文件大小、JSON chunk 可解析，内容未修改。
- 用 Node 内置模块解析 accessor、skin/IBM 与动画轨道，得到：
  - Adventurer 10,198 三角面 / 62 关节 / 5 蒙皮 / 24 段动画 / 1.827 m；
  - Woman Casual 6,424 / 62 / 4 / 24 / 1.810 m；
  - Woman Formal 6,108 / 62 / 4 / 24 / 1.800 m；
  - Man base 1,852 / 31 / 1 / 11 / 4.827 m。
  - 四个模型均为 +Z 朝向、无根运动；建议 1.8 m 缩放分别为 0.985 / 0.995 / 1.000 / 0.373。
- 实际动画名带前缀：步枪兵/重机枪手为 `CharacterArmature|...`（`Idle_Gun`、`Walk`、`Run`、`Run_Shoot`、`Gun_Shoot`、`HitRecieve`、`Death` 全部存在）；突击兵为 `HumanArmature|...`，只有 `Man_Punch`（没有 `Punch_Left/Right`），且没有持枪/受击片段。
- `resource/asset-manifest.json` 增加 `models.humans`（rifleman / heavy / breacher）与四个 `assets` 条目；`resource/ATTRIBUTIONS.md` 增加四个模型、来源页、CC0 与验证结论。
- `test/美术/asset-manifest.test.js` 扩展为 11 项；`node --test test/美术/asset-manifest.test.js` 结果 11 pass / 0 fail。
- 美术方向文档增加第 8–11 节：人类士兵装具分层、v3 三项遗留修复、场景道具/后处理目标、模型验证结果与限制。
- 未完成：v3 人类模型、三项材质修复与场景/后处理的 Electron 实际画面检查；等环境/敌方实现后补截图。

## 2026-10-17（v3 视觉复核）

- 检查 `test/项目管理/screenshots-v3/menu-02.png`、`gameplay-08.png`，`test/敌方服务/evidence/spawn-1.png`…`spawn-4.png`，`test/战斗服务/evidence/2026-10-17_view-model-hip-final.png`、`..._ads-final.png`。
- 结论：**v3 方向通过，但视觉验收暂缓**。人类士兵、道具、低角度光照、后处理、低饱和、无无人机/霓虹均成立；巨型面罩与面板已消失。
- 唯一阻塞项：第一人称步枪护木与弹匣明显偏蓝，枪托偏酒红，与美术方向 §9.2 的深灰金属/`#232623` 哑光聚合物不符，读作玩具塑料。等战斗服务材质复核后的新截图。
- 非阻塞打磨：
  1. 敌军制服绿色略饱和、部分单位红色贝雷帽；向橄榄/卡其靠拢，红色只保留小面积识别或改暗色。
  2. HESCO/沙袋墙在游戏距离偏平滑，织纹不明显；近距离应有 Fabric084 织纹与模块缝隙阴影。
  3. 太阳 Bloom 略强，可略降强度/阈值，保持阴天晨昏感。
- 静态截图未验证：动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡、30 敌人性能、低画质回退。
- 功能文档状态保持 `implemented-unverified`（v3 视觉验收被 1 个阻塞项暂缓）；`memo.md`、`functional-description.md`、`api-spec.md` 同步。

## 2026-10-17（v3 材质复核）

- 检查更新后的 `gameplay-09.png`、`2026-10-17_view-model-hip-final.png` 与 `..._ads-final.png`。
- 武器阻塞项已解决：护木、弹匣、枪托使用深色聚合物（约 `#262420`），无蓝色/酒红；机匣/枪管为深枪金属灰；木色仅保留在小型握把贴片。HIP 位于画面右下约 26.6% 宽度，ADS 光学镜居中，无近裁剪面穿插。
- 结论：**v3 静态视觉验收通过**；武器不再读作玩具塑料，整体符合低饱和写实军事方向。功能文档状态改为 `verified`。
- 非阻塞项维持：敌军制服绿色略饱和/红色贝雷帽、HESCO 远距织纹、太阳 Bloom 略强。
- 仍需录屏或实际游玩确认：动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡、30 敌人性能、低画质回退。
- `memo.md`、`functional-description.md`、`api-spec.md` 状态同步。
