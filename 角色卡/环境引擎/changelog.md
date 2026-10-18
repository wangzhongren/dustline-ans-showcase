# 变更日志：环境引擎

## 2026-10-17 v3 环境升级：人类模型支持、场景道具、后处理、材质与音频

- `src/providers/public/three.js`：新增显式导出 `AnimationMixer`、`cloneSkinned`（SkeletonUtils `clone`）与 `Shape`；导出总数 64→67，仍无 `export *`。
- `src/providers/abstract/assets.js` / `src/providers/impl/three-assets.js`：新增 `loadGltf(url) -> { scene, animations }`，按 URL 缓存；`loadModel` 保持返回 scene；`dispose()` 同时释放模型场景与动画引用。
- `src/providers/abstract/renderer.js` / `src/providers/impl/three-renderer.js`：
  - `setCameraPose` 支持 `roll`（`camera.rotation.z`）与可选 `shakeX`/`shakeY`；`getCameraPose` 返回 roll；未提供 roll 时归零，pitch 仍限制 ±1.55。
  - 新增 `setQuality('high'|'low')`、`getQuality()`、`isPostProcessingEnabled()`、`getPostProcessingInfo()`；高画质走后处理，低画质直接渲染；低画质阴影 2048→1024。
  - 导出 `normalizeQuality` 与 `applyCameraPose` 供无 WebGL 单元测试使用。
- 新增 `src/providers/impl/post-processing.js`：RenderPass + SSAO + UnrealBloom + 色彩分级（低饱和、暖高光/冷暗部、暗角、颗粒）+ SMAA + OutputPass；单个 pass 失败跳过，整条失败降级为 RenderPass+OutputPass，最小管线失败退回直接渲染；尺寸/释放路径完整。
- 新增 `src/services/impl/environment/props.js`：HESCO、混凝土隔离墩、独立沙袋墙、集装箱门/锁杆、托盘、轮胎、帐篷、警示牌、弹药箱、探照灯、围栏铁丝、地面草丛/碎石/纸屑；重复小道具使用 InstancedMesh；所有实例组统一 `instanceMatrix.needsUpdate`、`computeBoundingSphere()` 并关闭视锥裁剪，避免单位几何体包围球误判或默认原点实例；返回 `{ group, colliders, update, dispose }`。
- 新增 `src/services/impl/environment/decals.js`：弹孔 48 / 血迹 24 / 灼痕 12 / 污渍 24 的对象池，程序化 CanvasTexture，法线偏移与 polygonOffset 防 z-fighting，寿命淡出与池满复用；无 DOM 时退化为纯色平面。
- `src/services/impl/environment/arena-layout.js`：新增 `props` 纯数据与 `createPropColliders()`；碰撞体 45→68；实体道具全部有匹配 AABB，托盘/轮胎/地面装饰/污渍不产生碰撞。
- `src/services/impl/environment/arena.js`：
  - Fabric084 载入真实 Color 贴图并做保亮度卡其重映射（`#C3B091`，0.75–1.25）；Wood066 重映射到 `#5E4A36`；无 document/读取失败时退回“真实贴图 × 色调”。新增 `computeRampFactor` / `computeRampColor` 纯函数。
  - 新增道具材质（橡胶、帆布 khaki/olive、警示牌、弹药箱、灯罩、镀锌、深色金属、草）。
  - 光照改为低角度阳光（约 25°）与长阴影；半球补光 0.55、阴影强度 0.82、环境强度 0.95，保留氛围但不让近处阴影面过黑；雾 18–80；HDRI 背景 0.8/0.22；尘土加载时 300（低画质 160）。
  - `load()` 构建 props 与 decals 并铺地面污渍；新增 `getDecals()`；`update(dt)` 推进尘土、探照灯与贴片；`dispose()` 释放 props/decals。
- `src/services/abstract/environment.js` / `effects.js` / `audio.js` 与三个公共入口：更新契约与文档；`createEffects({ renderer, decals? })` 支持可选贴片系统。
- `src/services/impl/effects/effects.js`：
  - 新增血雾 8、枪口烟雾 8、弹壳 12、枪口闪光 8、弹孔回退 24、血渍回退 12 的对象池。
  - 新增 `blood`、`bulletHole`、`muzzleSmoke`、`shell`、`enemyShot`；`enemyShot` = 闪光 + 烟雾 + 短曳光；人类死亡不再使用机械爆炸。
  - 保留原有 `tracer`/`impact`/`explosion`/`spawn` 行为与 `computeFade`/`pickReuseIndex` 导出。
- `src/services/impl/audio/audio-service.js`：
  - 分层枪声（爆裂 + 枪身 + 尾音）与随机音高/增益微调。
  - 新增 `enemyShot(distance, enemyType)`（距离衰减 + 截止频率 + 兵种增益）、`headshot()`、`shellDrop()`、`setMasterVolume()`/`getMasterVolume()`、`wind()`/`distantFire()`/`ambience()`/`startAmbience()`/`stopAmbience()`。
  - 声音数量 11→16；换弹改为三声机械声；环境音计时器在 `dispose()` 清除。
- 测试：
  - `test/环境引擎/provider-contract.test.js` 增加 `AnimationMixer`/`cloneSkinned`/`loadGltf`/roll/shake/画质校验。
  - `test/环境引擎/arena-layout.test.js` 更新 68 个碰撞体、v3 道具碰撞、重映射纯函数、新效果池与音频映射。
  - 新增 `test/环境引擎/scene-systems.test.js`：贴片池、池满复用、寿命淡出、效果服务对 decals 的委托。
- **验证**：`node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js` → 28 pass / 0 fail；`npm run build` 成功（68 modules，JS 1,008.07 kB / gzip 293.97 kB，只有 chunk 体积提示）。
- **平行排查（跨角色问题）**：v3 对局截图中的“巨型深色面片”不是环境道具。临时 raycast 诊断命中敌方装备网格 `userData.equipment = "face-mask"`：`CharacterArmature` 缩放为 100，命中距离从约 9 米缩到 0.12 米，而敌人组位置仍在 10–25 米环带。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡，并新增 `checkSpawnClearance()`（默认只报 2 米内环境网格，`envDebug=1` 时输出 10 米审计）；该装备挂点/缩放问题需敌方服务（`human-visual.js`）修复。
- **仍未验证**：Electron 后处理/长阴影/贴图观感/道具层次/音效听感/FPS；连续重开资源稳定性；Pipeline 对 `enemyShot`/`blood`/`shell`/`bulletHole`/`headshot`/`shellDrop`/环境音的接线；敌方装备面片问题的修复结果。

## 2026-10-17 视觉调优与 Three r186 兼容修复

- `src/providers/impl/three-renderer.js`：`PCFSoftShadowMap` 改为 `PCFShadowMap`，消除 Three r186 的“PCFSoft 已移除”警告；新增 `toneMappingExposure = 0.9`。
- `src/providers/impl/three-assets.js`：`RGBELoader` 改为 `HDRLoader`，消除弃用警告；HDR 仍设置 `EquirectangularReflectionMapping`。
- `src/providers/public/three.js`：阴影常量 `PCFSoftShadowMap` 改为显式导出 `PCFShadowMap`；显式导出数量仍为 64。
- `src/providers/abstract/renderer.js` 与 `three-renderer.js`：`setEnvironment()` 新增可选 `backgroundIntensity`、`backgroundBlurriness`，用于压暗/柔化 HDRI 背景。
- `src/services/impl/environment/arena.js`：
  - 色调锚点改为灰棕地面、中灰混凝土、深木色、橄榄/卡其/锈色金属、卡其帆布、灰岩石与灰褐尘土。
  - 地面贴图重复 18 次，法线强度 0.9，增加轻微顶点颜色明暗变化。
  - 金属度贴图整体乘数 0.45，避免阴天环境下金属发黑或呈镜面。
  - Fabric084 的饱和蓝色颜色贴图替换为中性程序化噪声贴图；法线/粗糙度/AO 继续来自素材。
  - 半球光 0.5、方向光 1.4、PCF 阴影半径 2；雾 18–80 米；环境强度 0.95；HDRI 背景亮度 0.85、模糊 0.3。
- 更新 `test/环境引擎/provider-contract.test.js` 的阴影常量期望。
- **验证**：`node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js` → 19 pass / 0 fail；`npm run build` 成功；本地 Vite 画面检查显示地面、混凝土、沙袋、集装箱与天空明显更接近写实军事方向。最终 Electron 视觉验收仍待项目管理和美术重新截图评审。

## 2026-10-17 环境 Service：竞技场、效果与音频编排

- 新增 `src/services/abstract/environment.js`、`effects.js`、`audio.js` 三份 JSDoc 服务契约。
- 新增 `src/services/public/environment.js`、`effects.js`、`audio.js`：分别导出 `createArena()`、`createEffects()`、`createAudio()`，并校验必需能力。
- 新增 `src/services/impl/environment/arena-layout.js`：60 × 60 米布局、45 个 AABB 碰撞体、旋转足迹、玩家出生点、22–28 米敌人出生点随机与确定性回退。
- 新增 `src/services/impl/environment/arena.js`：清单驱动的地面/混凝土/金属/木材/波纹钢/帆布 PBR 材质、HDRI 天空与雾、半球光与 PCFSoft 方向光、地堡、隔离墙、集装箱、木箱、金属桶、沙袋墙、警戒塔、围栏、装饰碎片、260 个漂浮尘土、加载幂等与完整释放。
- 新增程序化回退：清单、单个贴图通道或 HDR 失败时记录 URL/原因，使用 Canvas 噪声贴图乘色调锚点或灰蓝天空，不出现纯白/纯黑场景。
- 新增 `src/services/impl/effects/effects.js`：弹道线 24、命中火花 32、爆炸 8、生成闪光 8 的对象池，上限复用与淡出/粒子运动。
- 新增 `src/services/impl/audio/audio-service.js`：11 种游戏声音到 `tone()`/`noise()` 的参数映射；音频引擎由装配层持有，服务不关闭共享引擎。
- 新增 `test/环境引擎/arena-layout.test.js`：13 项测试覆盖布局、碰撞、出生点、效果池、音频映射与 `createArena()` 生命周期。
- 更新 `api-spec.md`、`feature-map.md`、`memo.md`、`functional-description.md`、功能文档与初始变更记录。
- **实际结果**：13 pass / 0 fail；Provider 契约回归 6 pass / 0 fail；三个 Service 公共入口导入冒烟退出码 0。
- **仍未验证**：Electron 真实画面、阴影、HDRI 反射、粒子观感、音效听感、帧率、连续重开资源释放；Pipeline 接线。

## 2026-10-17 Provider 基础设施首次实现

- 新增 `src/providers/abstract/renderer.js`、`assets.js`、`audio-engine.js` 三份 JSDoc 契约。
- 新增 `src/providers/public/three.js`：64 个 Three.js 显式命名导出，不使用 `export *`，不导出 `WebGLRenderer`。
- 新增 `src/providers/public/renderer.js`、`assets.js`、`audio-engine.js` 三个公共工厂入口。
- 新增 `src/providers/impl/three-renderer.js`：WebGLRenderer、sRGB/ACES 输出、PCFSoft 阴影、`YXZ` 相机、屏幕射线、世界射线检测、环境/雾设置。
- 新增 `src/providers/impl/three-assets.js`：清单读取、贴图/HDR/GLB 加载与缓存、色彩空间与重复参数、失败记录与释放。
- 新增 `src/providers/impl/webaudio-engine.js`：用户手势后创建 AudioContext、主增益、振荡器滑音与包络、滤波白噪声、静音与释放。
- 新增 `test/环境引擎/provider-contract.test.js`：6 项契约测试全部通过。
- 新增本角色功能导航、功能文档、接口说明、模块说明与本次变更记录。
