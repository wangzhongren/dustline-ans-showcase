# 模块说明：环境引擎

## 这个模块解决什么问题

游戏需要在桌面窗口里画出写实军事训练场，并让射击、爆炸、受伤等动作有声音。环境引擎负责六件事：

1. 用 Three.js 把 60 × 60 米训练场画到画布上，并提供相机、射线检测、环境光、雾与画质切换。
2. 把地堡、集装箱、木箱、沙袋、警戒塔、HESCO、帐篷、探照灯等变成可见网格与 AABB 碰撞数据，并给出合法的玩家/敌人生成点。
3. 用对象池播放弹道线、命中火花、血雾、枪口烟雾、弹壳、爆炸和生成闪光，并维护弹孔/血迹/灼痕/污渍贴片。
4. 用 WebAudio 现场合成 16 种音效，不依赖音频文件。
5. 加载美术提供的 PBR 贴图、HDRI 与人类 GLB，并支持 `loadGltf()` 返回动画。
6. 提供高画质后处理管线（SSAO、Bloom、色彩分级、AA、暗角、颗粒）与低画质回退。

## 现在能做什么

### 渲染 Provider（`createRenderer`）

- WebGLRenderer、sRGB 输出、ACES 色调映射（曝光 0.9）、`PCFShadowMap`、`YXZ` 相机。
- `setCameraPose` 支持 `yaw`/`pitch`/`roll`/`fov` 与可选 `shakeX`/`shakeY`；pitch 限制 ±1.55，roll 默认 0。
- `setQuality('high'|'low')` / `getQuality()`：高画质走后处理，低画质直接渲染；切换立即生效且幂等。低画质阴影 2048→1024。
- `getPostProcessingInfo()` 返回 pass 列表、降级项与错误，便于验收记录。
- 后处理顺序：RenderPass → SSAO（轻）→ UnrealBloom（低强度/高阈值）→ 色彩分级（低饱和、暖高光/冷暗部、暗角、颗粒）→ SMAA → OutputPass。FXAA 作为 SMAA 失败时的替代；完整管线失败时降级为 RenderPass+OutputPass，最小管线失败时直接渲染。
- 环境：HDRI 环境/背景、灰蓝雾、背景亮度/模糊、环境强度。

### 素材 Provider（`createAssetLoader`）

- 读取 `asset-manifest.json`，加载贴图/HDR/GLB，按 URL 与选项缓存。
- `loadGltf(url)` 返回 `{ scene, animations }`；`loadModel(url)` 保持返回 scene；失败记录 URL 并抛错；`dispose()` 释放模型几何/材质与动画引用。
- Three.js 门面 67 个显式导出，包含 `AnimationMixer`、`cloneSkinned`，供敌方服务播放骨骼动画。

### 竞技场（`createArena`）

- 从 `asset-manifest.json` 加载 Ground054、Concrete034、Metal032、Wood066、CorrugatedSteel009、Fabric084 贴图与 HDR 天空。
- 颜色贴图 sRGB、法线/粗糙度/金属度/AO 线性；`aoMap` 使用 `uv1`；地面纹理重复 18 次、法线强度 0.9。
- v3 材质修复：
  - Fabric084 使用真实 Color 贴图做保亮度卡其重映射（基准 `#C3B091`，亮度系数 0.75–1.25），保留织纹；法线/粗糙度/AO 不变。
  - Wood066 重映射到 `#5E4A36`，木箱、托盘、塔踏板共用同一木色。
- 场景内容：原 v2 的地堡、隔离墙、集装箱、木箱、金属桶、沙袋墙、警戒塔、围栏、装饰碎片；v3 新增 HESCO、混凝土隔离墩、独立沙袋墙、集装箱门/锁杆、托盘、轮胎、帐篷、警示牌、弹药箱、探照灯、围栏铁丝网、草丛/碎石/纸屑。
- 碰撞体 68 个：实体道具全部有 AABB；托盘、轮胎、地面装饰与污渍不挡路。出生点仍满足 22–28 米、障碍外 0.9 米、距玩家至少 10 米；中心 5 米安全区不变。
- 光照与大气：低角度阳光（约 25°）与长阴影、半球补光、雾 18–80 米、HDRI 背景 0.8/0.22、尘土 300（低画质在加载时降到 160）、探照灯轻微闪烁。
- `getDecals()` 返回贴片系统；`update(dt)` 推进尘土、探照灯与贴片；`dispose()` 释放全部本模块创建的资源。
- 素材失败时使用程序化回退并记录具体 URL/原因，场景不会变成纯白或纯黑。

### 贴片系统（`decals.js`）

- 弹孔 48、血迹 24、灼痕 12、污渍 24；池满复用最老条目。
- 程序化 CanvasTexture；无 `document` 时退化为纯色平面并只警告一次。
- 沿法线偏移 + `polygonOffset` 防 z-fighting；血迹/灼痕/污渍按寿命淡出，弹孔保留到被复用。

### 视觉反馈（`createEffects`）

- 原有：弹道线 24、命中火花 32、爆炸 8、生成闪光 8。
- v3：血雾 8、枪口烟雾 8、弹壳 12、枪口闪光 8；没有 decals 时另有弹孔回退 24、血渍回退 12。
- 新增 `blood`、`bulletHole`、`muzzleSmoke`、`shell`、`enemyShot`；人类敌人死亡不使用机械爆炸。
- 提供 `decals` 时，弹孔与血迹写入世界贴片池；没有时使用内置回退贴片。
- `update(dt)` 推进生命周期；`clear()` 立即清场；`dispose()` 释放几何体和材质。

### 音频编排（`createAudio`）

- 16 种声音：射击、命中、击杀、爆炸、受伤、换弹、空仓、拾取、波次开始、游戏结束、脚步、敌人枪声、爆头、弹壳落地、风声、远处交火。
- 射击三层：高频爆裂 + 低频枪身 + 尾部回声，每发随机音高/增益微调。
- 敌人枪声按距离衰减并降低截止频率；重机枪手更响、突击兵更轻。
- `setMasterVolume`/`getMasterVolume`；`startAmbience`/`stopAmbience` 管理风声与远处交火计时器。
- 全部由振荡器和噪声合成，音量低、时长短；没有外部音频文件。
- 必须在用户点击“开始”后调用 `init()`；未初始化时调用音效是安全空操作。
- 音频引擎由装配层持有，音频服务的 `dispose()` 不关闭共享引擎，只清除环境音计时器。

### 音频 Provider（`createAudioEngine`）

- 用户手势后创建 AudioContext、主增益、振荡器滑音与包络、滤波白噪声、静音/主音量与释放。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/services/abstract/environment.js` | 竞技场服务契约（含 `getDecals()`）。 |
| `src/services/abstract/effects.js` | 视觉反馈服务契约（含 `DecalSink` 与新效果）。 |
| `src/services/abstract/audio.js` | 音频编排服务契约（含 v3 方法）。 |
| `src/services/public/environment.js` | `createArena()` 公共入口。 |
| `src/services/public/effects.js` | `createEffects()` 公共入口（可选 decals）。 |
| `src/services/public/audio.js` | `createAudio()` 公共入口。 |
| `src/services/impl/environment/arena-layout.js` | 布局、v3 道具数据、AABB、出生点纯函数。 |
| `src/services/impl/environment/arena.js` | 场景、材质重映射、灯光、大气、加载与释放。 |
| `src/services/impl/environment/props.js` | HESCO、隔离墩、沙袋墙、门锁杆、托盘、轮胎、帐篷、警示牌、弹药箱、探照灯、铁丝网、地面细节。 |
| `src/services/impl/environment/decals.js` | 弹孔/血迹/灼痕/污渍贴片池。 |
| `src/services/impl/effects/effects.js` | 全部视觉反馈对象池。 |
| `src/services/impl/audio/audio-service.js` | 声音名称到 tone/noise 参数的映射与动态枪声。 |
| `src/providers/abstract/renderer.js` | 渲染器契约。 |
| `src/providers/abstract/assets.js` | 素材加载契约（含 `loadGltf`）。 |
| `src/providers/abstract/audio-engine.js` | 音频引擎契约。 |
| `src/providers/public/three.js` | 项目唯一的 Three.js 显式导出入口（67 个）。 |
| `src/providers/public/renderer.js` | `createRenderer()` 公共入口。 |
| `src/providers/public/assets.js` | `createAssetLoader()` 公共入口。 |
| `src/providers/public/audio-engine.js` | `createAudioEngine()` 公共入口。 |
| `src/providers/impl/three-renderer.js` | Three.js 渲染、相机姿态、画质与后处理切换。 |
| `src/providers/impl/three-assets.js` | 贴图/HDR/GLB 加载与释放实现。 |
| `src/providers/impl/post-processing.js` | SSAO、Bloom、色彩分级、AA、暗角/颗粒与降级。 |
| `src/providers/impl/webaudio-engine.js` | WebAudio 合成实现。 |

## 明确的边界

- Service、Pipeline、界面只能导入 `src/services/public/*` 与 `src/providers/public/*`；不导入任何 `impl/`，也不直接导入 `three`。
- `providers/impl/*` 可以导入 Three addon；Service 不导入 addon。
- 效果与音频服务不订阅事件总线，也不互相导入；Pipeline 根据事件统一调用。
- 素材来源、授权和路径由美术角色维护；本模块不修改 `resource/`，也不决定使用哪张素材。
- 战斗与敌方只读消费 `Collider[]`；环境引擎不决定伤害、得分或波次。
- 音频引擎由装配层持有；环境引擎不关闭别人的 AudioContext。

## 当前没有做或没有验证的事

- 没有在 Electron 中实际查看画面：低角度阳光、长阴影、HESCO/帐篷/探照灯层次、Fabric084 织纹、Wood066 木色、SSAO/Bloom/分级/AA、雾、尘土与帧率都未验收。
- 没有在 Electron 中实际聆听分层枪声、距离衰减、音效听感与自动播放限制。
- 没有连续重开 5 次测量对象数量和内存。
- Pipeline 还没有把 `world:enemy-shot`/`world:blood`/`weapon:shell-eject` 接到新效果与音频；`main.js` 还没有把 `arena.getDecals()` 传给 `createEffects()`。
- Node 测试中的 `createArena()` 使用 Provider 替身和程序化回退路径，没有真正下载贴图、HDR 或 GLB；Fabric/Wood Canvas 重映射的浏览器路径未在测试中执行。
- **跨角色问题**：v3 对局截图中的巨型深色面片已定位为敌方装备网格 `face-mask`（`CharacterArmature` 缩放 100，命中距离从 9 米缩到 0.12 米），不是环境道具；需敌方服务修复装备挂点/缩放。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡。

## 当前验证

- `node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js`：**28 pass / 0 fail**（2026-10-17）。
- `npm run build`：成功；68 modules transformed；JS 1,008.07 kB（gzip 293.97 kB）；只有 chunk 大于 500 kB 的提示，没有构建错误。
