---
id: arena-feedback-initial-provider
type: change
title: 实现 Provider、环境 Service 与 v3 环境升级
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related: [arena-and-feedback]
events:
  - date: "2026-10-17"
    kind: created
    summary: 按冻结契约实现三个 Provider 与 Three.js 显式门面，Node 契约测试 6 项通过
  - date: "2026-10-17"
    kind: implemented
    summary: 同日实现竞技场、效果与音频编排 Service，13 项 Node 单元测试通过；Electron 验收未执行
  - date: "2026-10-17"
    kind: implemented
    summary: 修复 PCFSoftShadowMap 与 RGBELoader 兼容警告，完成开发期视觉调色；19 项测试与构建通过
  - date: "2026-10-17"
    kind: implemented
    summary: v3 环境升级：loadGltf/AnimationMixer/cloneSkinned、场景道具、贴片、低角度光照、后处理、Fabric/Wood 重映射、分层音频；27 项测试与构建通过
---

# 实现渲染、素材加载与 WebAudio Provider

## 改了什么

以前项目只有共享 Model 和事件总线，没有任何渲染、素材或音频基础设施。现在加入了 Environment Engine 的 Provider 阶段：

- 渲染器：用 Three.js 创建 WebGL 场景、相机、射线与环境。
- 素材加载器：读取美术提供的 `asset-manifest.json`，加载贴图、HDR 和 GLB。
- 音频引擎：用 WebAudio 现场合成音效，不依赖音频文件。
- Three.js 门面：项目只从 `src/providers/public/three.js` 取 Three.js 符号。

**Provider 阶段之后，同一天又完成了竞技场、效果与音频编排 Service；它们属于同一份初始实现，见下文“环境 Service 阶段”。**

## 用户能看到的变化

Provider 阶段本身没有可以直接打开查看的游戏画面变化。Service 完成后，`createArena()` 已经能在代码中搭建出完整的 60 × 60 米训练场，`createEffects()` 和 `createAudio()` 也已经有可调用的效果与声音；但还没有在 Electron 中实际查看画面或聆听声音，也没有接入 Pipeline，所以玩家现在还看不到这些内容。

## 新增与修改的文件

| 文件 | 作用 |
| --- | --- |
| `src/providers/abstract/renderer.js` | 渲染器 JSDoc 契约。 |
| `src/providers/abstract/assets.js` | 素材加载契约。 |
| `src/providers/abstract/audio-engine.js` | 音频引擎契约。 |
| `src/providers/public/three.js` | 64 个 Three.js 显式命名导出。 |
| `src/providers/public/renderer.js` | `createRenderer()` 公共入口。 |
| `src/providers/public/assets.js` | `createAssetLoader()` 公共入口。 |
| `src/providers/public/audio-engine.js` | `createAudioEngine()` 公共入口。 |
| `src/providers/impl/three-renderer.js` | WebGLRenderer、相机、射线、环境与雾。 |
| `src/providers/impl/three-assets.js` | 清单、贴图、HDR、GLB 加载与释放。 |
| `src/providers/impl/webaudio-engine.js` | 振荡器、噪声、包络、滤波与主音量。 |
| `test/环境引擎/provider-contract.test.js` | 6 项 Provider 契约测试。 |

## 关键行为

### 渲染器

- `createRenderer({ canvas, width, height, pixelRatio, shadows })`。
- 开启抗锯齿、sRGB 输出、ACES 色调映射和 PCFSoft 阴影。
- 相机旋转顺序 `YXZ`，俯仰限制 ±1.55 弧度。
- `getWorldPosition()` 与 `raycast()` 返回普通 `{ x, y, z }` 对象。
- 相机下的第一人称对象不参与世界射线检测。
- 导入模块不会创建 WebGL 上下文。

### 素材加载器

- `createAssetLoader({ baseUrl })`；`baseUrl` 是运行时素材目录。
- 清单地址是 `new URL('asset-manifest.json', baseUrl)`；清单内 URL 相对 `baseUrl` 解析。
- 省略 `baseUrl` 时，首次调用方法使用 `new URL('./resource/', document.baseURI).href`；没有 `document` 时抛出明确错误。
- 颜色贴图 sRGB；法线/粗糙度/金属度/AO 线性；支持 repeat、wrap、anisotropy。
- 缓存键为绝对 URL 加规范化选项。
- 失败先记录 URL 与原因，再抛出带 URL 的 Error。
- `dispose()` 释放缓存贴图与模型几何/材质。

### 音频引擎

- AudioContext 只在 `init()` 中创建。
- 未初始化时 `tone()`/`noise()` 安全空操作，只警告一次。
- `tone` 支持波形、起止频率滑音、起音/释音包络。
- `noise` 支持白噪声缓冲、增益包络和 Biquad 低通/带通滤波。
- 节点播放结束后断开；`dispose()` 关闭上下文并记录关闭失败。

## 为什么这样做

Provider 先把外部基础设施稳定下来，后续 Service 只依赖公共入口，不接触 Three.js 和 WebAudio 细节。这样战斗、敌方、环境和界面可以并行开发，升级 Three.js 时也只需要核对一个门面和一组契约测试。

## 验证

命令：

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/provider-contract.test.js
```

实际结果（2026-10-17）：6 pass / 0 fail。覆盖：

1. 三个公共工厂都是函数。
2. Three.js 门面包含全部约定的显式导出。
3. 在无 DOM 的 Node 中导入门面不会创建渲染器。
4. `resolveUrl('textures/a.jpg')` 返回 `file:///tmp/dustline/textures/a.jpg` 且结果稳定。
5. 空 URL 被拒绝。
6. 音频未初始化时 `tone`/`noise` 不抛错，只产生一次警告。

导入冒烟：

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --input-type=module -e "Promise.all([import('./src/providers/public/renderer.js'),import('./src/providers/public/assets.js'),import('./src/providers/public/audio-engine.js'),import('./src/providers/public/three.js')]).then(m=>console.log(m.map(x=>Object.keys(x).join(',')))).catch(e=>{console.error(e);process.exit(1)})"
```

实际结果：退出码 0，输出 `createRenderer`、`createAssetLoader`、`createAudioEngine` 与 64 个 Three.js 导出名。

## 环境 Service 阶段

### 改了什么

- 新增三个服务契约与公共入口：
  - `src/services/abstract/environment.js` / `src/services/public/environment.js` → `createArena({ renderer, assets })`。
  - `src/services/abstract/effects.js` / `src/services/public/effects.js` → `createEffects({ renderer })`。
  - `src/services/abstract/audio.js` / `src/services/public/audio.js` → `createAudio({ engine })`。
- 新增 `src/services/impl/environment/arena-layout.js`：纯布局、AABB、玩家出生点、敌人出生点随机与确定性回退。可以在 Node 中无 WebGL 测试。
- 新增 `src/services/impl/environment/arena.js`：清单驱动的 PBR 材质、灯光、雾、HDRI、障碍物网格、尘土、加载幂等与释放。
- 新增 `src/services/impl/effects/effects.js`：四类对象池。
- 新增 `src/services/impl/audio/audio-service.js`：11 种声音的参数映射；引擎所有权在装配层。
- 新增 `test/环境引擎/arena-layout.test.js`：13 项测试。

### 竞技场布局与碰撞

- 60 × 60 米地面，中心为玩家出生点；中心 5 米内没有地面障碍。
- 45 个 AABB：7 段地堡、5 段隔离墙、4 个集装箱、10 个木箱、5 面沙袋墙、9 只桶、4 段围栏、1 座警戒塔。
- 旋转障碍按旋转后矩形的世界 AABB 计算；叠放木箱的上层碰撞体 `min.y > 0`，不挡地面。
- 装饰木板、小箱、石块不产生碰撞体。

### 材质与光照

- 只从 `asset-manifest.json` 取路径：Ground054、Concrete034、Metal032、Wood066、CorrugatedSteel009、Fabric084、`kloofendal_48d_partly_cloudy_puresky_1k.hdr`。
- 颜色 sRGB，数据通道线性；`aoMap` 使用 `uv1`，所有几何体复制第二套 UV。
- 重复尺度：地面 15、混凝土 3、波纹钢 2、木材 1.8、金属 1.6、帆布 1。
- 灯光：半球光 + 1.9 强度方向光，PCFSoft 2048 阴影，阴影相机 ±34 米；雾 20–90 米，灰色蓝 `#B9C2C8`。
- 260 个尘土粒子，`update(dt)` 中漂移并循环。

### 程序化回退

- 清单失败：全部材质使用 Canvas 灰阶噪声贴图乘色调锚点；背景用灰蓝色。
- 单通道失败：记录 URL/原因，该通道缺失；颜色通道失败才用程序化贴图。
- HDR 失败：`setEnvironment({ skyColor, fogColor, fogNear, fogFar })`，灯光继续工作。
- 没有 `document`：纯色材质；测试会捕获这些日志。
- 所有回退写入 `load()` 返回的 `fallbacks` 数组。

### 效果与音频

- 效果池上限：弹道线 24、命中火花 32、爆炸 8、生成闪光 8。池满复用年龄最大条目；`clear()` 保留池对象，`dispose()` 才释放。
- 11 种声音：shoot、hit、kill、explosion、hurt、reload、empty、pickup、waveStart、gameOver、footstep。
- 换弹用两次不同 `attack` 的噪声形成两声机械咔哒；不依赖延时 API。
- 音频引擎由装配层持有；`createAudio().dispose()` 不关闭共享 AudioContext。

### 验证

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/arena-layout.test.js
```

实际结果（2026-10-17）：**13 pass / 0 fail**。

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/provider-contract.test.js
```

实际结果：**6 pass / 0 fail**（Provider 回归）。

三个 Service 公共入口导入冒烟：

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --input-type=module -e "Promise.all([import('./src/services/public/environment.js'),import('./src/services/public/effects.js'),import('./src/services/public/audio.js')]).then(m=>console.log(m.map(x=>Object.keys(x).join(',')))).catch(e=>{console.error(e);process.exit(1)})"
```

实际结果：退出码 0，输出 `['createArena','createEffects','createAudio']`。

## 视觉调优与 Three r186 兼容修复

### 改了什么

- `src/providers/impl/three-renderer.js`：`PCFSoftShadowMap` 改为 `PCFShadowMap`（Three r186 已移除 PCFSoft 的实际行为）；保持 ACES，新增 `toneMappingExposure = 0.9`。
- `src/providers/impl/three-assets.js`：`RGBELoader` 改为 `HDRLoader`；HDR 仍设置为等距柱状投影。
- `src/providers/public/three.js`：显式导出 `PCFShadowMap` 代替 `PCFSoftShadowMap`，导出数量仍为 64。
- `src/providers/abstract/renderer.js` 与 `three-renderer.js`：`setEnvironment()` 新增可选 `backgroundIntensity`、`backgroundBlurriness`。
- `src/services/impl/environment/arena.js`：重新设置色调锚点、地面重复 18 次与法线强度 0.9、轻量顶点颜色明暗、金属度贴图乘数 0.45、Fabric084 中性颜色贴图、半球光 0.5、方向光 1.4、PCF 阴影半径 2、雾 18–80 米、环境强度 0.95、HDRI 背景亮度 0.85/模糊 0.3。
- `test/环境引擎/provider-contract.test.js`：阴影常量期望改为 `PCFShadowMap`。

### 为什么这样改

- 实际截图显示：地面像浅色沙滩、混凝土接近纯白、沙袋和集装箱偏蓝/青、天空像正午晴天、金属在阴天环境下发黑或发镜面。
- Fabric084 的颜色贴图本身是饱和蓝色，单纯乘卡其色调仍会偏青，因此改用中性噪声颜色贴图，保留法线/粗糙度/AO 的织物细节。
- 金属度贴图整体乘 0.45，既保留贴图驱动，又让金属有足够的漫反射颜色，不会在低环境光下变成黑块。
- HDRI 背景通过亮度 0.85 + 模糊 0.3 压暗和柔化，保留反射与云层细节，同时读起来是阴天而不是正午。

### 验证

```sh
node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js
```

实际结果：**19 pass / 0 fail**。

```sh
npm run build
```

实际结果：成功；45 个模块，`dist/assets/index-*.js` 约 754 kB（gzip 约 199 kB），只有 chunk 大于 500 kB 的提示。

本地 Vite 开发服务器画面检查：地面为灰棕尘土、混凝土中灰、沙袋卡其、集装箱橄榄/卡其/锈色、天空灰蓝阴天；控制台不再出现 PCFSoft 或 RGBELoader 警告（只剩 Playwright 环境的指针锁定错误）。这是开发期调色检查，最终 Electron 视觉验收仍待项目管理/美术重新截图评审。

## v3 环境升级（人类模型支持、场景道具、后处理、材质与音频）

### 改了什么

v3 不推倒现有实现，而是在 v2 的 Provider/Service 上增量升级：

- **Provider 门面**：`src/providers/public/three.js` 新增 `AnimationMixer`、`cloneSkinned`（SkeletonUtils `clone`）与 `Shape`；显式导出 64→67，仍无 `export *`。敌方服务已经按冻结契约读取前两个符号。
- **素材加载**：新增 `loadGltf(url) -> Promise<{ scene, animations }>`，按 URL 缓存；`loadModel(url)` 保持返回 scene；`dispose()` 释放模型场景几何/材质并清理动画引用。
- **渲染器**：`setCameraPose` 支持 `roll`、`shakeX`、`shakeY`；`getCameraPose` 返回 roll；新增 `setQuality('high'|'low')`、`getQuality()`、`isPostProcessingEnabled()`、`getPostProcessingInfo()`。高画质走后处理，低画质直接渲染；低画质阴影 2048→1024。
- **新 `post-processing.js`**：RenderPass → SSAO → UnrealBloom → 色彩分级（低饱和、暖高光/冷暗部、暗角、颗粒）→ SMAA → OutputPass；单 pass 失败跳过，整条失败降级为 RenderPass+OutputPass，最小管线失败退回直接渲染。
- **新 `props.js`**：HESCO、混凝土隔离墩、独立沙袋墙、集装箱门/锁杆、托盘、轮胎、帐篷、警示牌、弹药箱、探照灯、围栏铁丝、地面草丛/碎石/纸屑；重复小道具用 InstancedMesh。
- **新 `decals.js`**：弹孔 48 / 血迹 24 / 灼痕 12 / 污渍 24 的对象池，程序化 CanvasTexture，法线偏移与 polygonOffset 防 z-fighting，寿命淡出与池满复用。
- **布局**：`arena-layout.js` 新增 `props` 纯数据与 `createPropColliders()`；碰撞体 45→68；实体道具有 AABB，托盘/轮胎/地面装饰/污渍不挡路。
- **竞技场**：
  - Fabric084 使用真实 Color 贴图做保亮度卡其重映射（`#C3B091`，0.75–1.25），保留织纹；Wood066 重映射到 `#5E4A36`；无 document/读取失败时退回“真实贴图 × 色调”。
  - 低角度阳光（约 25°）、长阴影；雾 18–80；HDRI 背景 0.8/0.22；尘土 300（低画质 160）。
  - `load()` 构建 props 与 decals 并铺地面污渍；`getDecals()` 暴露贴片系统；`update(dt)` 推进尘土、探照灯与贴片；`dispose()` 全部释放。
- **效果**：`createEffects({ renderer, decals? })` 新增 `blood`、`bulletHole`、`muzzleSmoke`、`shell`、`enemyShot`；人类死亡不再使用机械爆炸；没有 decals 时使用内置回退贴片。
- **音频**：分层枪声（爆裂 + 枪身 + 尾音）与随机微调；`enemyShot(distance, enemyType)` 距离衰减；`headshot`、`shellDrop`、`setMasterVolume/getMasterVolume`、`wind/distantFire/ambience/startAmbience/stopAmbience`；声音 11→16。

### 用户能看到/听到的变化（代码层面）

- 场景不再只有大块掩体：HESCO、隔离墩、帐篷、探照灯、门锁杆、托盘、轮胎、警示牌、弹药箱、铁丝网和地面细节让训练场更像真实驻地。
- 沙袋保留 Fabric084 的织纹而不是塑料噪声；木箱/托盘/塔踏板统一为灰棕木色。
- 低角度阳光带来更长的阴影；高画质有 SSAO、Bloom、低饱和分级、SMAA、暗角和颗粒。
- 射击有分层枪声、枪口烟雾、弹壳、弹孔；命中人类有血雾/血渍；敌人枪声随距离变轻。
- 画质设置能立即关闭后处理；低画质仍保留 ACES、雾、基础阴影和可辨认轮廓。

### 为什么这样做

- 客户反馈 v2 的敌人、手感和画面“太 low”。环境侧最直接的提升是：真实织物/木材质感、场景道具层次、低角度光照与后处理。
- 人类模型由敌方服务通过 `loadGltf` + `AnimationMixer` + `cloneSkinned` 使用；环境引擎只负责把这三个能力稳定地暴露在 Provider 公共入口。
- 后处理全部放在 Provider impl，Service 只调用 `renderer.setQuality`，避免上层依赖 Three addon。
- 所有效果/贴片/音频仍由对象池和纯参数映射驱动，不引入外部音频或不可控资源。

### 验证

```sh
node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js
```

实际结果（2026-10-17）：**28 pass / 0 fail**。

```sh
npm run build
```

实际结果：成功；68 modules transformed；`dist/assets/index-DzZcc8zr.js` 1,008.07 kB（gzip 293.97 kB）；只有 chunk 大于 500 kB 的提示。

### 未验证

- Electron 中低角度阳光、长阴影、HESCO/帐篷/探照灯层次、Fabric/Wood 重映射、SSAO/Bloom/分级/AA、暗角/颗粒的实际画面。
- 分层枪声、距离衰减、风声/远处交火、主音量/静音的实际听感。
- 1600 × 900 高画质 FPS、draw call、阴影与后处理开销；没有测过，不写“60fps”。
- 连续重开 5 次的对象/内存稳定性。
- Pipeline 对 `world:enemy-shot`/`world:blood`/`weapon:shell-eject` 与新增音频方法的接线；`main.js` 尚未把 `arena.getDecals()` 传给 `createEffects()`。

### 跨角色排查：巨型深色面片

v3 对局截图中占据半个屏幕的深色面片不是环境道具。临时 raycast 诊断（已移除渲染器全局钩子）命中敌方装备网格 `userData.equipment = "face-mask"`：其 `CharacterArmature` 缩放为 100，命中距离从约 9 米缩到 0.12 米，而敌人组位置仍在 10–25 米环带。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡，并新增 `checkSpawnClearance()`（默认只报 2 米内环境网格，`?envDebug=1` 时输出 10 米审计）。该问题需要敌方服务检查装备挂点/缩放，环境引擎不修改 `human-visual.js`。

## 没有验证的部分

- WebGLRenderer 在 Electron 中的实际创建、画面、阴影、HDRI 反射和帧率。
- 贴图/HDR/GLB 的真实加载（Node 测试没有发起网络请求，Service 测试走的是程序化回退路径）。
- AudioContext 的真实创建、声音听感和自动播放限制。
- 竞技场、效果与音频 Service 在 Electron 中的画面与听感：地面/混凝土/波纹钢/木材/帆布贴图、阴影覆盖、雾、尘土、弹道线、火花、爆炸、生成光环、11 种声音与静音。
- 连续开始/重开 5 次后的对象数量、效果池和内存稳定性。
- Pipeline 对 `world:*` 事件与音频方法的实际接线。

## 已知限制

- `loadModel()` 仍只返回 `gltf.scene`；需要动画时使用 v3 的 `loadGltf()`。
- `dispose()` 不会强制丢失 WebGL 上下文；它释放渲染器与后处理资源并清空场景引用，具体对象由 Service 释放。
- 素材加载依赖 `fetch` 能访问 `baseUrl`；Electron 下 `file://` 的访问方式由装配层负责，Provider 不内置协议回退。

## 相关功能

- [竞技场、视觉反馈与音效](../feature/arena-and-feedback.md)
