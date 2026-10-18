---
id: arena-and-feedback
type: feature
title: 竞技场、视觉反馈与音效
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related: [arena-feedback-v2, arena-feedback-v3]
events:
  - date: "2026-10-17"
    kind: created
    summary: 建立功能文档；Provider 基础设施已实现，竞技场/效果/音频 Service 尚未实现
  - date: "2026-10-17"
    kind: implemented
    summary: 三个 Service 实现并通过 13 项 Node 单元测试；Electron 画面与听感验收尚未执行
  - date: "2026-10-17"
    kind: implemented
    summary: 修复 PCFSoft/RGBELoader 兼容警告并完成开发期视觉调色；19 项测试与构建通过
  - date: "2026-10-17"
    kind: implemented
    summary: v3 升级：人类模型 Provider 支持、HESCO/帐篷等场景道具、弹孔/血渍贴片、低角度阳光、SSAO/Bloom/分级/AA、Fabric/Wood 重映射、分层枪声与距离衰减；27 项测试与构建通过，Electron 验收仍未执行
---

# 竞技场、视觉反馈与音效

玩家进入游戏后，应该看到一个阴天/晨昏的写实军事训练场：低角度阳光拉出长阴影，地面有尘土、草丛、碎石和污渍，场上有 HESCO、隔离墩、沙袋墙、集装箱门锁杆、托盘、轮胎、帐篷、探照灯和铁丝网；射击时有弹道线、枪口烟雾、弹壳、命中火花和弹孔，命中人类敌人有血雾/血渍；枪声分层，远处敌人枪声随距离变轻，环境里有风声和远处交火。这个功能负责把这些画面和声音真正做出来。

**当前状态：Provider 与三个 Service 已实现 v3 升级，并通过 Node 单元测试与生产构建；还没有在 Electron 中实际查看画面、聆听声音，也还没有接入 Pipeline 的新增反馈接口。** 因此现在可以说“代码路径已打通、纯逻辑已验证”，但不能说“画面、听感或性能已经验收”。

## 当前能做什么

装配层或 Pipeline 现在可以：

1. 用 `createArena({ renderer, assets })` 加载素材并搭建 60 × 60 米训练场；读取 68 个 AABB 碰撞体；查询玩家出生点和 22–28 米敌人出生点；用 `getDecals()` 取得贴片系统。
2. 用 `createEffects({ renderer, decals? })` 播放弹道线、命中火花、爆炸、生成闪光、血雾、枪口烟雾、弹壳、敌人枪口效果，并留下弹孔/血渍。
3. 用 `createAudio({ engine })` 在用户手势后初始化音频，播放 16 种合成音效、敌人枪声距离衰减、爆头/弹壳与持续环境音。
4. 用 `createRenderer()`、`createAssetLoader()`、`createAudioEngine()` 创建底层能力；渲染器用 `setQuality('high'|'low')` 控制后处理。

## 当前流程

```mermaid
flowchart TD
  A[装配层创建 Renderer / AssetLoader / AudioEngine] --> B[createArena]
  A --> C[createEffects]
  A --> D[createAudio]

  B --> B1[load: 读取 asset-manifest.json]
  B1 --> B2{清单可用?}
  B2 -->|否| B3[console.error 并记录 fallback<br>全部程序化材质与灰蓝天空]
  B2 -->|是| B4[加载颜色/NormalGL/粗糙度/金属度/AO]
  B4 --> B5{Fabric / Wood 颜色贴图?}
  B5 -->|是| B6[逐像素亮度重映射<br>卡其 #C3B091 / 木色 #5E4A36<br>保留织纹与明暗]
  B5 -->|否| B7[使用真实贴图 × 色调锚点<br>或程序化噪声回退]
  B6 --> B8[加载 HDRI 天空]
  B7 --> B8
  B8 --> B9{HDR 成功?}
  B9 -->|否| B10[记录 fallback，用 skyColor + 雾]
  B9 -->|是| B11[HDRI 作为 environment 与 background]
  B10 --> B12[搭建地面/掩体/集装箱/木箱/桶/沙袋/塔/围栏]
  B11 --> B12
  B12 --> B13[createProps: HESCO/隔离墩/沙袋墙/门锁杆/托盘/轮胎/帐篷/警示牌/弹药箱/探照灯/铁丝网/地面细节]
  B13 --> B14[createDecals + 铺地面污渍]
  B14 --> B15[低角度阳光 + 半球光 + 长阴影 + 尘土]
  B15 --> B16[renderer.add 根节点 + setEnvironment]
  B16 --> B17[返回 colliders / playerSpawn / fallbacks]

  B --> S1[getColliders: 68 个 AABB 副本]
  B --> S2[getPlayerSpawn: 中心，5 米安全区]
  B --> S3[getSpawnPoint: 22–28 米环带]
  S3 --> S4{随机 96 次有效?}
  S4 -->|是| S5[返回点]
  S4 -->|否| S6[64 角度 × 3 半径确定性扫描]
  S6 --> S7{找到?}
  S7 -->|是| S5
  S7 -->|否| S8[抛出带约束说明的 Error]

  R[renderer.render] --> R1{quality}
  R1 -->|high| R2[RenderPass → SSAO → Bloom → 分级/暗角/颗粒 → SMAA → OutputPass]
  R1 -->|low| R3[WebGLRenderer.render 直接渲染]
  R2 --> R4{pass 创建成功?}
  R4 -->|单个失败| R5[记录错误并跳过该 pass]
  R4 -->|整条失败| R6[降级 RenderPass + OutputPass]
  R6 --> R7{最小管线成功?}
  R7 -->|否| R3

  C --> C1[tracer / impact / explosion / spawn / blood / muzzleSmoke / shell / enemyShot]
  C1 --> C2{池中有空闲条目?}
  C2 -->|是| C3[复用空闲条目]
  C2 -->|否| C4[复用年龄最大的条目]
  C3 --> C5[重置位置/颜色/年龄并显示]
  C4 --> C5
  C5 --> C6[update(dt) 推进淡出、粒子与弹壳运动]
  C6 --> C7{重开?}
  C7 -->|是| C8[clear: 立即隐藏，保留池对象]
  C7 -->|否| C9[dispose: 移除并释放几何体/材质]
  C1 --> C10{有 decals?}
  C10 -->|有| C11[bulletHole/blood 写入世界贴片池]
  C10 -->|无| C12[使用内置回退贴片]

  D --> D1[init: engine.init 在用户手势后创建/恢复 AudioContext]
  D --> D2[shoot/hit/kill/enemyShot/headshot/shellDrop/...]
  D2 --> D3[getSoundPlan / getEnemyShotPlan 取 tone/noise 参数]
  D3 --> D4{引擎已初始化?}
  D4 -->|否| D5[引擎输出一次警告并忽略，安全空操作]
  D4 -->|是| D6[创建振荡器/噪声、包络、滤波并播放]
  D --> D7[setMasterVolume / setMuted]
  D --> D8[startAmbience: 每 4 秒风声、每 7 秒远处交火]
  D --> D9[dispose: 清除环境音计时器，不关闭共享 AudioContext]
```

## 分步说明

### 1. 竞技场加载

- `load()` 是幂等的：并发调用返回同一个 Promise，成功后重复调用返回同一个结果。
- 素材路径只来自 `asset-manifest.json`，代码里不写死贴图路径。
- 颜色贴图 sRGB，法线/粗糙度/金属度/AO 线性；`aoMap` 需要 `uv1`，所有几何体统一复制第二套 UV。
- 地面重复 18 次；混凝土 3 次；波纹钢 2 次；木材 1.8 次；金属 1.6 次；帆布 1 次。
- Fabric084：真实 Color 贴图逐像素计算亮度，用 `#C3B091` × 0.75–1.25 系数重映射，保留织纹；Wood066 同样重映射到 `#5E4A36`。
- 如果加载失败，会先清理已创建的对象并允许稍后重试。

### 2. 场景与氛围

- 原 v2 障碍物与 v3 道具都有对应 AABB；实体道具有碰撞，托盘、轮胎、地面草丛/碎石/纸屑和污渍不挡路。
- 灯光：低角度阳光（约 25°）产生长阴影，半球光补天光；高画质 2048 阴影、低画质 1024。
- 雾 18–80 米，颜色 `#B9C2C8`；HDRI 同时作为反射环境和背景，背景亮度 0.8、模糊 0.22，环境强度 0.95；半球补光 0.55，阴影强度 0.82，避免近处阴影面过黑。
- 尘土粒子在加载时按当前画质选择：高画质 300、低画质 160；探照灯在 `props.update(dt)` 中轻微闪烁/扫动。

### 3. 出生点

- 玩家出生在中心 `{0,0,0}`，布局保证中心 5 米内没有地面障碍。
- 敌人出生点必须位于距中心 22–28 米的环带内、竞技场内、离每个 AABB 至少 0.9 米、离玩家至少 `minDistance`（默认 10 米）。
- 先随机尝试 96 次；失败后按固定角度和半径扫描；仍失败则抛出明确错误。

### 4. 贴片与视觉反馈

- 贴片：弹孔 48、血迹 24、灼痕 12、污渍 24；池满复用最老条目；贴片沿法线偏移并用 polygonOffset 防 z-fighting。
- 效果：弹道线 24、命中火花 32、爆炸 8、生成闪光 8、血雾 8、枪口烟雾 8、弹壳 12、枪口闪光 8；没有 decals 时另有弹孔回退 24、血渍回退 12。
- `blood` 播放深红血雾并写血渍；`bulletHole` 优先写 decals；`enemyShot` = 闪光 + 烟雾 + 短曳光；`shell` 受重力、落地反弹。
- 人类敌人死亡不使用机械爆炸。
- `clear()` 用于重开时立即清场；`dispose()` 才真正释放几何体和材质。

### 5. 声音

- 16 种声音全部由 WebAudio 合成，没有音频文件。
- 射击三层：高频爆裂 + 低频枪身 + 尾部回声，每发随机音高/增益微调。
- 敌人枪声按距离衰减并降低截止频率；重机枪手更响、突击兵更轻。
- 换弹三声机械咔哒；爆头有专用强调音；弹壳落地轻响；风声与远处交火可单次播放或持续播放。
- 用户点击“开始”后先调用 `audio.init()`。
- 音频引擎由装配层持有；音频服务的 `dispose()` 不关闭共享引擎，只清除环境音计时器。

### 6. 画质

- Pipeline 调用 `renderer.setQuality(settings.quality)`。
- 高画质：后处理开启；低画质：后处理关闭、阴影贴图降到 1024、尘土降到 160。
- 切换立即生效；重复设置同一档位不会重复创建资源。

## 失败时会怎样

| 情况 | 结果 |
| --- | --- |
| 素材清单请求失败 | `console.error` 记录 URL/错误；全部材质使用程序化回退；结果里的 `fallbacks` 有记录。 |
| 单个贴图通道失败 | 记录具体 URL/错误；该通道缺失；颜色通道失败时用 Canvas 灰阶噪声乘色调锚点。 |
| Fabric/Wood Canvas 重映射失败 | 记录错误与原因；退回“真实颜色贴图 × 色调锚点”，仍使用真实贴图。 |
| HDR 失败 | 记录 URL/错误；背景与雾使用灰蓝色，灯光与材质继续工作。 |
| 没有 `document`（Node 测试） | 记录日志；材质退化为纯色，尘土粒子无贴图，贴片退化为纯色平面。 |
| 出生点被障碍物或玩家距离限制完全阻塞 | 抛出带 22–28 米环带与 `minDistance` 的 `Error`。 |
| 效果/贴片池满 | 复用年龄最大的条目，不新增对象、不抛错。 |
| 后处理单个 pass 失败 | 记录 pass 名称与错误，跳过该 pass，其余效果继续。 |
| 后处理整条管线失败 | 降级为 RenderPass+OutputPass；最小管线也失败时直接渲染并记录错误。 |
| 音频未初始化就播放 | 引擎输出一次警告并忽略；不抛错、不创建节点。 |
| 释放后继续调用 Service | 抛出明确的“已释放”错误（`dispose()` 本身可重复调用）。 |

## 当前验证

命令：

```sh
node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js
```

2026-10-17 实际结果：**28 pass / 0 fail**。覆盖：

1. 布局分类、68 个碰撞体数量、AABB 合法性。
2. 旋转足迹覆盖原有障碍与 v3 实体道具；装饰道具不产生碰撞。
3. Fabric084/Wood066 亮度重映射纯函数与 0.75–1.25 系数范围。
4. 玩家出生点、中心 5 米安全区、敌人出生点 24 次采样、确定性与失败信息。
5. Provider 契约：67 个 Three.js 显式导出、`AnimationMixer`/`cloneSkinned`、`loadGltf`、roll/pitch/shake、画质校验、无 DOM 导入。
6. 效果池上限、复用、血雾/烟雾/弹壳/闪光、decals 委托与释放。
7. 贴片池 108 个固定对象、池满复用、寿命淡出、清空与释放。
8. 音频 16 种声音映射、分层枪声、换弹三声、敌人枪声距离衰减、主音量/静音/环境音计时器。
9. `createArena()` 加载幂等、回退记录、`getDecals()` 与释放。

`npm run build`：成功；68 modules transformed；JS 1,008.07 kB（gzip 293.97 kB）；只有 chunk 大于 500 kB 的提示。

开发期浏览器冒烟（Vite + Playwright，127.0.0.1:5175）：页面加载后场景成功建立，控制台只有浏览器环境的指针锁定错误，没有 arena/props/decals/post-processing 报错；截图可见低角度天空、HESCO/隔离墩/沙袋/警戒塔、地面细节与人类敌人。该检查只证明代码路径可运行，不能替代 Electron 视觉/听感/性能验收。

**尚未验证**：Electron 中的最终画面（低角度阳光、长阴影、后处理、HDRI 反射、贴图观感、道具层次、雾、尘土、帧率）、真实音效听感与自动播放限制、连续重开 5 次后的资源稳定性、Pipeline 对新增反馈/音频接口的接线。

**跨角色问题（已定位）**：v3 对局截图中占据半个屏幕的深色面片是敌方装备网格 `userData.equipment = "face-mask"`，不是环境道具。临时 raycast 显示其 `CharacterArmature` 缩放为 100，命中距离从约 9 米缩到 0.12 米，而敌人组仍在 10–25 米环带；需要敌方服务检查装备挂点/缩放。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡。

## 历史记录

| 日期 | 类型 | 状态 | 变化 | 文档 |
| --- | --- | --- | --- | --- |
| 2026-10-17 | 变更 | 已实现，未做 Electron 验收 | 建立渲染、素材加载与音频合成 Provider，并加入契约测试 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
| 2026-10-17 | 变更 | 已实现，未做 Electron 验收 | 新增竞技场、效果与音频编排 Service、45 个碰撞体、出生点与 13 项单元测试 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
| 2026-10-17 | 变更 | 已实现，未做 Electron 验收 | 修复 PCFSoft/RGBELoader 兼容警告；调暗并中性化地面、混凝土、沙袋、集装箱与天空；19 项测试与构建通过 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
| 2026-10-17 | 变更 | 已实现，未做 Electron 验收 | v3：人类模型 Provider、场景道具、贴片、低角度光照、后处理、材质重映射、分层音频；27 项测试与构建通过 | [变更记录](../change/2026-10-17_change_initial-implementation.md) |
