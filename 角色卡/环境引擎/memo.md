# 工作线索：环境引擎

- 2026-10-17：角色建立（ANS 引导）。
- 美术方向：写实军事训练场、自然日光与 HDRI、低饱和军用色调；PBR 素材由美术角色维护在 `resource/`。
- 音频全部由 WebAudio 合成，无外部音频文件；必须在开始按钮点击后初始化。
- 场景包含沙袋、集装箱、混凝土掩体、木箱、金属桶等障碍物，并提供碰撞 AABB 和出生点查询。
- Provider 负责素材加载（贴图/HDRI/GLB）与环境反射；不直接修改 `resource/`。

## 2026-10-17 Provider 阶段

- 公共入口：`createRenderer`、`createAssetLoader`、`createAudioEngine`；Three.js 门面位于 `src/providers/public/three.js`（64 个显式命名导出，无 `export *`）。
- 渲染器：WebGLRenderer + ACES + sRGB + PCFSoftShadow；相机 `YXZ`，pitch 限制 ±1.55；射线检测会忽略挂在相机下的第一人称对象。
- 素材加载：`baseUrl` 是运行时素材目录；清单按 `new URL('asset-manifest.json', baseUrl)` 读取；贴图按文件名推断 sRGB/线性；失败记录 URL 后抛错。
- 音频：AudioContext 只在 `init()` 创建；未初始化时 `tone`/`noise` 安全空操作且只警告一次；`setMuted`/`setMasterVolume` 只记录状态。
- 测试：`node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/provider-contract.test.js` → 6 pass / 0 fail；四个公共入口导入冒烟退出码 0。

## 2026-10-17 环境 Service 阶段

- 三个公共入口：`createArena({ renderer, assets })`、`createEffects({ renderer })`、`createAudio({ engine })`。
- 布局：`arena-layout.js` 是纯数据 + 纯函数，Node 可直接测试。当前 45 个 AABB：7 地堡、5 隔离墙、4 集装箱、10 木箱、5 沙袋墙、9 桶、4 围栏、1 警戒塔。装饰碎片不参与碰撞。
- 出生点：玩家在中心；敌人出生点先随机 96 次，再按 64 角度 × 3 半径确定性扫描，仍失败则抛错。与障碍物边缘保留 0.9 米，距玩家默认至少 10 米。
- 材质：只从 `manifest.textures.*` 取路径。颜色 sRGB，NormalGL/Roughness/Metalness/AO 线性；`aoMap` 需要 `uv1`，所有几何体统一复制 UV。地面重复 15 次，混凝土 3，波纹钢 2，木材 1.8，金属 1.6，帆布 1。
- 光照/大气：HDRI 环境与背景、半球光、1.9 强度方向光、PCFSoft 2048 阴影、±34 米阴影相机、灰蓝雾 20–90 米。
- 回退：清单失败 → 全部程序化；单通道失败 → 该通道缺失；颜色失败 → Canvas 灰阶噪声乘色调；HDR 失败 → 灰蓝天空；无 `document` → 纯色材质。所有回退写入 `load()` 的 `fallbacks` 并 `console.error`。
- 效果池：弹道线 24、火花 32、爆炸 8、生成闪光 8；池满复用年龄最大条目；`clear()` 保留对象，`dispose()` 才释放。
- 音频：11 种声音；`getSoundPlan(name)` 是纯映射，可在无 AudioContext 的 Node 中测试。音频引擎归装配层所有，音频服务 `dispose()` 不关闭它。
- 测试：`node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/arena-layout.test.js` → 13 pass / 0 fail；Provider 回归 6 pass / 0 fail；三个 Service 入口导入冒烟输出 `createArena,createEffects,createAudio`，退出码 0。

## 2026-10-17 视觉调优与 Three r186 兼容

- 渲染器：`PCFSoftShadowMap` → `PCFShadowMap`（r186 已移除 PCFSoft 实际行为）；`toneMappingExposure = 0.9`；门面显式导出改为 `PCFShadowMap`，仍为 64 个。
- 素材：`RGBELoader` → `HDRLoader`，弃用警告消失；HDR 仍设置 `EquirectangularReflectionMapping`。
- `setEnvironment()` 新增可选 `backgroundIntensity`、`backgroundBlurriness`；竞技场用 0.85 亮度、0.3 模糊压暗并柔化 HDRI 背景。
- 色调锚点：地面 `0x938b7e`、混凝土 `0x8c8c86`、木材 `0x95744c`、橄榄钢 `0x8a9068`、卡其钢 `0xb3a585`、锈 `0x8f5a38`、金属 `0x7a7d72`、帆布 `0xa69a7e`、岩石 `0x77776f`、尘土 `0xb8b2a6`。
- 地面重复 18 次、法线 0.9、轻量顶点颜色明暗；金属度贴图乘 0.45，阴天金属不再发黑/发镜面。
- Fabric084 颜色贴图是饱和蓝色，单靠色调乘法仍是青色；改为中性程序化噪声颜色贴图 + 卡其色调，保留法线/粗糙度/AO。
- 光照：半球光 0.5、方向光 1.4、PCF 阴影半径 2；雾 18–80 米；环境强度 0.95。
- 本地 Vite 画面检查：地面变为灰棕尘土、混凝土中灰、沙袋卡其、集装箱橄榄/卡其、天空灰蓝阴天；不再有 PCFSoft/RGBELoader 控制台警告（只剩 Playwright 环境的指针锁定错误）。
- 测试/构建：`node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js` → 19 pass / 0 fail；`npm run build` 成功（754 kB JS，gzip 199 kB；仅 chunk 体积提示）。

## 2026-10-17 v3 环境升级

- Provider：
  - `providers/public/three.js` 67 个显式导出，新增 `AnimationMixer`、`cloneSkinned`（SkeletonUtils clone）、`Shape`；无 `export *`。
  - `loadGltf(url) -> { scene, animations }`，按 URL 缓存；`loadModel` 继续返回 scene；`dispose()` 释放场景几何/材质与动画引用。
  - 渲染器 `setCameraPose` 支持 `roll`、`shakeX`、`shakeY`；`getCameraPose` 返回 roll；未提供 roll 时归零。
  - `setQuality('high'|'low')` / `getQuality()` / `isPostProcessingEnabled()`：高画质走 `post-processing.js`，低画质直接 `WebGLRenderer.render`；低画质阴影 2048→1024。
- 新 `providers/impl/post-processing.js`：RenderPass → SSAO → UnrealBloom → 色彩分级(含暗角/颗粒) → SMAA → OutputPass；单个 pass 失败跳过，整条失败降级为 RenderPass+OutputPass，最小管线失败退回直接渲染。Three 0.186.1 已核对所有 addon 存在，当前构建未触发降级。
- 新 `services/impl/environment/props.js`：HESCO、隔离墩、独立沙袋墙、集装箱门/锁杆、托盘、轮胎、帐篷、警示牌、弹药箱、探照灯、围栏铁丝、草丛/碎石/纸屑；重复小道具用 InstancedMesh。所有实例组写完后统一 `computeBoundingSphere()` 并关闭视锥裁剪，避免单位几何体包围球误判或默认原点实例；测试会检查每条实例矩阵、缩放上限、出生区与竞技场边界。
- `services/impl/environment/arena.js`：半球补光 0.55、`sun.shadow.intensity = 0.82`、环境强度 0.95，近处阴影面不再压成纯黑。
- 新 `services/impl/environment/decals.js`：弹孔 48 / 血迹 24 / 灼痕 12 / 污渍 24，程序化 CanvasTexture，polygonOffset 防 z-fighting，池满复用最老条目。
- `arena-layout.js` 新增 `props` 纯数据与 `createPropColliders()`；碰撞体 45→68。实体道具全部有 AABB，托盘/轮胎/地面装饰/污渍不挡路。
- `arena.js`：
  - Fabric084 用真实 Color 贴图做保亮度卡其重映射（`#C3B091`，系数 0.75–1.25）；Wood066 重映射到 `#5E4A36`。无 document 时退回“真实贴图 × 色调”。
  - 低角度阳光 `(30,17,21)`、1.55 强度、长阴影；雾 18–80；HDRI 背景 0.8/0.22；尘土加载时 300（低画质 160）。
  - `load()` 构建 props + decals 并铺地面污渍；`getDecals()` 暴露贴片系统；`update(dt)` 推进尘土、探照灯与贴片；`dispose()` 全部释放。
- 效果：`createEffects({ renderer, decals? })` 新增 `blood`、`bulletHole`、`muzzleSmoke`、`shell`、`enemyShot`；池上限与回退贴片；人类死亡不用机械爆炸。
- 音频：`enemyShot(distance, type)`、`headshot()`、`shellDrop()`、`setMasterVolume/getMasterVolume`、`wind/distantFire/ambience/startAmbience/stopAmbience`；分层枪声 + 随机微调；16 种声音。
- 测试：`node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js` → 28 pass / 0 fail。
- 平行排查结论：v3 对局截图的巨型深色面片不是环境道具。raycast 命中敌方装备 `userData.equipment='face-mask'`，`CharacterArmature` 缩放 100，命中距离从 9m 缩到 0.12m，而敌人组仍在环带；需敌方服务修复装备挂点/缩放。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡；`checkSpawnClearance()` 默认只报 2 米内环境网格，`?envDebug=1` 时输出 10 米审计。
- 构建：`npm run build` → 成功，68 modules，JS 1,008.07 kB（gzip 293.97 kB），只有 chunk >500 kB 提示。
- 本地 Vite + Playwright 冒烟（127.0.0.1:5175）：场景加载成功，控制台只有浏览器环境的指针锁定错误，没有 arena/props/decals/post-processing 报错；画面可见低角度天空、HESCO/隔离墩/沙袋/警戒塔、地面细节与人类敌人。该检查不能替代 Electron 视觉/听感/性能验收。
- 未验证：Electron 后处理/长阴影/贴图观感/道具层次/音效听感/FPS；重开资源稳定性；Pipeline 接线。

## 下一步

1. **Electron 视觉验收**：确认低角度阳光与长阴影、HESCO/帐篷/探照灯/门锁杆层次、Fabric084 织纹与 Wood066 木色、SSAO/Bloom/分级/AA、暗角与颗粒；确认低画质切换立即关闭后处理。
2. **Electron 音频验收**：分层枪声、敌人枪声距离衰减、爆头/弹壳、风声/远处交火、主音量与静音。
3. **连续重开 5 次**：确认场景对象数、效果池、贴片池、AudioContext 与内存不持续增长。
4. **Pipeline / 装配接线**：把 `arena.getDecals()` 传给 `createEffects()`；按事件调用 `enemyShot`/`blood`/`shell`/`bulletHole`/`headshot`/`shellDrop`；`audio.init()` 必须发生在开始按钮的用户手势内。
5. **性能实测**：1600 × 900、高/低画质、不同敌人数，记录设备、FPS 采样方法与数值；未测不得写“60fps”。

## 注意事项

- Service 只能导入 `src/providers/public/*` 与共享 Model，不得导入 `impl/` 或其他 Service。
- `src/providers/public/three.js` 没有导出 `BufferGeometryUtils`、`DodecahedronGeometry` 等；新增几何类型前先扩展门面并补契约测试。
- 升级 Three.js 后必须重跑 Provider 契约测试，核对 64 个显式导出。
- 资源路径以 `resource/asset-manifest.json` 为准，不在代码中硬编码贴图路径。
- 效果与音频服务不订阅事件总线；由 Pipeline 统一映射，避免 Service 之间互相导入。
