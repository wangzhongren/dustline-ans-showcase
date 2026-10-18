# 接口说明：环境引擎

这份文档写给要使用渲染、素材、音频、竞技场、效果和音频编排能力的其他角色。当前状态：**v3 环境升级已实现并通过 Node 单元测试与生产构建；还没有在 Electron 中做真实画面、阴影、后处理、HDRI 反射、听感与性能验收。**

## 怎样导入

项目源码按 ES 模块编写，根 `package.json` 是 `"type": "module"`，Node 可以直接运行测试，Vite/浏览器按正常 ES 模块导入。

```js
// 装配层 / Pipeline 使用 Service 公共入口
import { createArena } from './src/services/public/environment.js';
import { createEffects } from './src/services/public/effects.js';
import { createAudio } from './src/services/public/audio.js';

// Service 内部与装配层创建 Provider 时使用 Provider 公共入口
import { createRenderer } from './src/providers/public/renderer.js';
import { createAssetLoader } from './src/providers/public/assets.js';
import { createAudioEngine } from './src/providers/public/audio-engine.js';
import { Vector3, Mesh, MeshStandardMaterial } from './src/providers/public/three.js';
```

上层不得导入 `src/services/impl/`、`src/providers/impl/`，也不得直接导入 `three`。Three.js 符号统一从 `src/providers/public/three.js` 获取。

## 公共入口与实际导出

| 文件 | 实际导出 | 说明 |
| --- | --- | --- |
| `src/services/public/environment.js` | `createArena(options)` | 创建竞技场服务。 |
| `src/services/public/effects.js` | `createEffects(options)` | 创建视觉反馈服务。 |
| `src/services/public/audio.js` | `createAudio(options)` | 创建音频编排服务。 |
| `src/providers/public/renderer.js` | `createRenderer(options)` | 创建 WebGL 渲染器。 |
| `src/providers/public/assets.js` | `createAssetLoader(options?)` | 创建素材加载器；工厂本身不发起请求。 |
| `src/providers/public/audio-engine.js` | `createAudioEngine()` | 创建音频引擎；工厂本身不创建 AudioContext。 |
| `src/providers/public/three.js` | 67 个显式命名导出 | 没有 `export *`，不导出 `WebGLRenderer`；v3 增加 `AnimationMixer`、`cloneSkinned`、`Shape`。 |

## 渲染 Provider：`createRenderer(options)`

返回对象：

```js
{
  add(object), remove(object),
  attachToCamera(object), detachFromCamera(object),
  setCameraPose({ position, yaw, pitch, roll, shakeX, shakeY, fov }),
  getCameraPose(),                 // { position, yaw, pitch, roll, fov }
  getWorldPosition(screenX, screenY),
  raycast(origin, direction, far?, objects?),
  setEnvironment({ hdriTexture, backgroundTexture, skyColor, fogColor, fogNear, fogFar,
                   intensity, backgroundIntensity, backgroundBlurriness }),
  resize(width, height),
  setQuality('high'|'low'), getQuality(),
  isPostProcessingEnabled(),       // 高画质且后处理管线创建成功时为 true
  getPostProcessingInfo(),         // { enabled, passes, fallbacks, error }，调试/验收用
  render(), dispose()
}
```

### 相机姿态

- `pitch` 仍限制在约 ±1.55 弧度，防止视线翻转。
- v3 新增 `roll`（弧度，绕视线轴），写入 `camera.rotation.z`；**未提供 `roll` 时每帧归零**。
- 可选 `shakeX` / `shakeY`（米）直接加到相机世界位置的 x/y；战斗服务已把震动烘进 `position`，不会再传这两个字段，因此不会二次叠加。
- `getCameraPose()` 总是返回 `roll`。

### 画质与后处理

- 默认 `high`。`setQuality('high')` 建立后处理管线，`setQuality('low')` 释放并直接调用 `WebGLRenderer.render`。
- 切换立即生效；重复设置同一档位是幂等操作（但若高画质管线尚未建立，会当场建立，保证 `getPerformance().postProcessing` 与实际渲染路径一致）。
- 低画质同时把场景中阴影贴图从 2048 降到 1024；竞技场在低画质下也把尘土粒子从 300 降到 160。
- 固定保留：ACES 色调映射、曝光 0.9、`PCFShadowMap`、HDRLoader、sRGB 输出。

### 后处理管线（`src/providers/impl/post-processing.js`）

顺序：

1. `RenderPass`
2. `SSAOPass`（kernelSize 16、radius 1.0，轻量环境遮蔽）
3. `UnrealBloomPass`（strength 0.28、radius 0.35、threshold 0.85，只让枪口/探照灯/金属高光轻微溢出）
4. 色彩分级 `ShaderPass`（饱和度 0.86、暖高光/冷暗部、暗角 0.22、单色颗粒 0.03）
5. `SMAAPass`（在 OutputPass 之前，线性空间抗锯齿）
6. `OutputPass`（应用 ACES 与 sRGB）

降级路径：

- SMAA 创建失败 → 在 `OutputPass` 之后尝试 `FXAAPass`。
- 任一可选 pass（SSAO/Bloom/分级/AA）创建失败 → `console.error` 记录具体错误并跳过该 pass。
- 整条完整管线创建失败 → 释放已建 pass 与 render target，降级为 `RenderPass + OutputPass` 的最小高画质路径，并记录 `fallbacks`。
- 最小管线也失败 → `console.error` 记录，渲染器退回直接渲染；`isPostProcessingEnabled()` 返回 `false`。
- 运行时后处理渲染抛错 → 记录错误、释放后处理，本帧及后续直接渲染。

Three.js 0.186.1 已核对包含上述所有 addon 文件；当前构建成功，未触发降级。

## 素材 Provider：`createAssetLoader(options?)`

```js
{
  loadManifest(), getManifest(), resolveUrl(url),
  loadTexture(url, options?), loadHdr(url),
  loadGltf(url),   // Promise<{ scene, animations }>
  loadModel(url),  // Promise<scene>，v2 兼容
  dispose()
}
```

- `loadGltf` 按绝对 URL 缓存；同一 URL 的并发/后续调用返回同一个 Promise/结果。
- `loadModel` 内部调用 `loadGltf` 并只返回 `scene`，缓存仍按 URL 复用。
- GLTFLoader 的 `gltf.animations` 原样返回；没有动画时是空数组。
- 失败时先 `console.error` 记录 URL 与原因，再抛出带 URL 的 Error。
- `dispose()` 清理模型场景的几何/材质，并释放动画剪辑引用（AnimationClip 没有 GPU 资源；有 `dispose()` 时调用，没有时只丢弃引用），最后清空缓存。

## 竞技场：`createArena({ renderer, assets })`

```js
{
  load(),                       // Promise<{ colliders, playerSpawn, fallbacks }>
  getColliders(),               // Collider[]
  getDecals(),                  // DecalSink | null（load 完成后可用）
  getSpawnPoint({ playerPosition, minDistance }),
  getPlayerSpawn(),
  update(dt),
  dispose()
}
```

### v3 场景内容

- 原 v2 内容保留：60 × 60 米地面、混凝土地堡/隔离墙、波纹钢集装箱、木箱、金属桶、沙袋墙、警戒塔、围栏、木板/小箱/石块。
- 新增 `props.js`：
  - HESCO 防爆墙（3 段，1.5 × 1.0 × 1.0 米模块，两层，khaki 内衬 + 镀锌角柱/顶栏）。
  - 混凝土隔离墩 4 个（挤出截面 + InstancedMesh）。
  - 独立沙袋墙 3 面（3–4 层错缝，全部沙袋合并为一个 InstancedMesh）。
  - 4 个集装箱门 + 竖向锁杆 + 把手 + 铰链。
  - 托盘 4 组、轮胎 4 堆、帐篷 2 座（khaki/olive 帆布 + 拉绳）。
  - 警示牌 4 个、弹药箱 5 个、探照灯 2 座（暖色 SpotLight + 发光灯罩，Bloom 目标）。
  - 围栏顶部蛇腹铁丝（所有围栏合并为一个 LineSegments）。
  - 地面草丛/碎石/纸屑（全部实例化，不产生碰撞）。
- 污渍贴片由 `decals.js` 在地面生成；不产生碰撞。
- 碰撞体从 45 个增加到 68 个：新增 3 HESCO、4 隔离墩、3 沙袋墙、2 帐篷、4 警示牌、5 弹药箱、2 探照灯。托盘、轮胎、草丛、碎石、纸屑、污渍不产生碰撞。
- 出生点仍满足 22–28 米、障碍外 0.9 米、距玩家至少 `minDistance`；玩家中心 5 米安全区保持不变。

### 光照与大气（v3）

- 太阳改为低角度：位置约 `(30, 17, 21)`，仰角约 25°，色温暖中性 `0xffe7c9`，强度 1.55。
- 阴影：高画质 2048、低画质 1024；阴影相机 ±36 米、远裁剪 120，半径 3，`normalBias` 0.025，形成更长的柔和阴影。
- 半球补光 0.55，保持阴天/晨昏军事基调；阴影强度 0.82，避免阴影面被压成纯黑。
- 雾 `#B9C2C8`、18–80 米；HDRI 背景亮度 0.8、模糊 0.22、环境强度 0.95。
- 尘土粒子在竞技场加载时按当前画质选择：高画质 300、低画质 160；之后切换画质主要影响后处理与阴影贴图。
- 探照灯在 `props.update(dt)` 中轻微闪烁/扫动。

### 材质修复（v3）

- **Fabric084**：加载真实 `Color` 贴图，逐像素计算感知亮度，把色相/饱和度重映射到卡其基准 `#C3B091`，亮度系数限制在 0.75–1.25，保留织纹与明暗；法线/粗糙度/AO 继续使用真实贴图。重映射通过 `CanvasTexture` 完成，材质颜色设为白色避免二次乘色。没有 `document` 或读取像素失败时记录日志并退回“真实颜色贴图 × 卡其色调”。
- **Wood066**：同样做亮度重映射，基准 `#5E4A36`，强度 0.25；木箱、木托盘、警戒塔木板共用同一材质，降低红色饱和度。
- 纯函数 `computeRampFactor(luminance, averageLuminance, strength, minFactor, maxFactor)` 与 `computeRampColor(...)` 从 `src/services/impl/environment/arena.js` 导出，供单元测试验证 0.75–1.25 范围。

## 贴片系统：`getDecals()` 返回的 `DecalSink`

```js
{
  addBulletHole(position, normal),
  addBlood(position, normal, color?),
  addScorch(position, normal),
  addStain(position, normal, scale?),
  update(dt), clear(), dispose(),
  getCounts(),   // { bulletHole: {active,total}, blood, scorch, stain }
  group          // 内部 Group，调用方不需要操作
}
```

- 池上限：弹孔 48、血迹 24、灼痕 12、污渍 24；池满复用最老条目。
- 程序化 CanvasTexture（无 `document` 时退化为纯色平面并只警告一次）。
- 贴片沿法线偏移 0.012 米，`polygonOffset` 防止 z-fighting；弹孔永久保留到被复用，血迹/灼痕/污渍按寿命淡出。
- 由竞技场创建和释放；效果服务只调用添加方法。

## 效果：`createEffects({ renderer, decals? })`

```js
{
  tracer(from, to, color?),
  impact(position, normal, color?),
  explosion(position, color?, scale?),
  spawn(position, color?),
  blood(position, direction, color?),
  bulletHole(position, normal),
  muzzleSmoke(position, direction),
  shell(position, velocity),
  enemyShot(position, direction, color?),
  update(dt), clear(), dispose()
}
```

- 池上限：弹道线 24、命中火花 32、爆炸 8、生成闪光 8、血雾 8、枪口烟雾 8、弹壳 12、枪口闪光 8；没有 decals 时另有弹孔回退贴片 24、血渍回退贴片 12。池满复用年龄最大的条目。
- `blood` 播放深红血雾；提供 `decals` 时同时写入血渍，没有时使用内置回退贴片。
- `bulletHole` 优先写入 `decals`，没有时使用内置回退贴片。
- `enemyShot` = 枪口闪光 + 枪口烟雾 + 约 1.4 米短曳光。
- `shell` 受重力、落地反弹并旋转，寿命约 0.9 秒。
- 人类敌人死亡不应调用 `explosion`；血雾/血渍已单独提供。
- `dispose()` 释放全部池对象；之后继续调用抛错。

## 音频：`createAudio({ engine })`

```js
{
  init(),
  shoot(), hit(), kill(), explosion(), hurt(), reload(), empty(),
  pickup(), waveStart(), gameOver(), footstep(),
  enemyShot(distance, enemyType?),
  headshot(), shellDrop(),
  wind(), distantFire(), ambience(),
  startAmbience(), stopAmbience(),
  setMasterVolume(volume), getMasterVolume(),
  setMuted(muted), isMuted(),
  dispose()
}
```

### 合成方式（v3）

| 方法 | 合成方式 |
| --- | --- |
| `shoot()` | 三层：2200 Hz 高通噪声爆裂 + 220→70 Hz 三角波枪身 + 90→45 Hz 正弦尾音；每发按配置的 6% 音高/5% 增益随机微调。 |
| `hit()` | 1700 Hz 方波短 tick。 |
| `kill()` | 880 Hz 与 1320 Hz 两音确认。 |
| `explosion()` | 380 Hz 低通噪声爆发 + 95→38 Hz 正弦重击。 |
| `hurt()` | 190→95 Hz 锯齿波 + 低通噪声。 |
| `reload()` | 三声高通/带通机械咔哒，约 0、0.16、0.32 秒。 |
| `empty()` | 2600 Hz 高通干脆咔哒。 |
| `pickup()` | 520→780 Hz 与 780→1040 Hz 上行两音。 |
| `waveStart()` | 110→120 Hz 锯齿波与 55 Hz 三角波的低频号角。 |
| `gameOver()` | 330→90 Hz 下降音 + 低通噪声。 |
| `footstep()` | 420 Hz 低通轻噪声。 |
| `enemyShot(distance, type)` | 距离衰减 `1/(1+distance/14)`（下限 0.08），截止频率 2600→500 Hz；重机枪手 ×1.15，突击兵 ×0.8。 |
| `headshot()` | 1600 Hz 正弦 + 2400 Hz 三角短强调音。 |
| `shellDrop()` | 1800 Hz 高通轻响 + 600→300 Hz 短音。 |
| `wind()` / `distantFire()` | 低通风声 / 远处低频交火。 |

- 所有音量保持低强度，无外部音频文件。
- `startAmbience()` 每 4 秒一阵风、每 7 秒有 45% 概率播放远处交火；`stopAmbience()` 与 `dispose()` 清除计时器。
- 主音量默认取 `GAME_CONFIG.settings.defaults.masterVolume`（0.7），创建服务时同步给引擎；`setMasterVolume` 夹紧到 0–1。
- 音频引擎由装配层持有；服务的 `dispose()` **不关闭**共享 AudioContext。
- 未初始化时任一播放方法安全空操作，引擎只警告一次。

## Pipeline 应如何消费事件

效果服务不订阅事件总线；Pipeline 在收到事件后调用对应方法。建议映射：

| 事件（`src/models/events.js`） | 效果调用 | 音频调用 |
| --- | --- | --- |
| `world:shot` | `effects.tracer(from, to, color)` | `audio.shoot()` |
| `world:impact` | `effects.impact(position, normal, color)` | 命中敌人时 `audio.hit()` |
| `world:explosion` | `effects.explosion(position, color, scale)` | `audio.explosion()` |
| `world:enemy-spawn` | `effects.spawn(position, color)` | 无 |
| `world:enemy-shot` | `effects.enemyShot(position, direction, color)` | `audio.enemyShot(distance, enemyType)` |
| `world:blood` | `effects.blood(position, direction, color)` | 无 |
| `weapon:shell-eject` | `effects.shell(position, velocity)` | `audio.shellDrop()` |
| `hud:hitmarker`（headshot） | 无 | `audio.hit()` + `audio.headshot()`（Pipeline 已有逻辑） |
| `enemy:killed` | 人类的死亡不使用 `explosion` | `audio.kill()` |
| `player:damage` | 无 | `audio.hurt()` |
| `player:died` | 无 | `audio.gameOver()` |
| `weapon:reload-start` | 无 | `audio.reload()` |
| `weapon:empty` | 无 | `audio.empty()` |
| `pickup:collected` | 无 | `audio.pickup()` |
| `wave:start` | 无 | `audio.waveStart()` |
| `game:state` → `over` | 无 | `audio.gameOver()` |

弹孔由 Pipeline 在 `world:impact` 时按需调用 `effects.bulletHole(position, normal)`；当前 Pipeline 事件表尚未接线，属于 `v3-pipeline-wire` 阶段。

## 验证命令与实际结果

在项目根目录运行：

```sh
node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js
```

实际结果（2026-10-17 v3 环境升级）：**28 pass / 0 fail**。

覆盖：

- 布局分类、68 个 AABB、旋转足迹、v3 实体道具碰撞、装饰道具不碰撞。
- Fabric084/Wood066 亮度重映射纯函数与 0.75–1.25 系数范围。
- 玩家出生点、中心 5 米安全区、敌人出生点 24 次采样、确定性与失败信息。
- Provider 契约：67 个 Three.js 显式导出、`AnimationMixer`/`cloneSkinned`、`loadGltf`、roll/pitch/shake、画质校验、无 DOM 导入。
- 效果池上限、复用、血雾/烟雾/弹壳/闪光、decals 委托与释放。
- 贴片池 108 个固定对象、池满复用、寿命淡出、清空与释放。
- 音频 16 种声音映射、分层枪声、换弹三声、敌人枪声距离衰减、主音量/静音/环境音计时器。
- `createArena()` 加载幂等、回退记录、`getDecals()` 与释放。

生产构建：

```sh
npm run build
```

实际结果（2026-10-17）：成功；68 modules transformed；`dist/assets/index-DzZcc8zr.js` 1,008.07 kB（gzip 293.97 kB），CSS 18.59 kB，`resource/` 已复制。只有 chunk 大于 500 kB 的提示，没有构建错误。

## 未验证项与跨角色问题

- **跨角色问题（已定位，未在本角色修复）**：v3 对局截图中占据半个屏幕的深色面片是敌方装备网格 `userData.equipment = "face-mask"`，不是环境道具。临时 raycast 显示其 `CharacterArmature` 缩放为 100，命中距离从约 9 米缩到 0.12 米，而敌人组仍在 10–25 米环带。需要敌方服务检查装备挂点与缩放。环境侧已排除 HESCO/沙袋/帐篷/集装箱/实例化道具与出生点遮挡。
- 环境侧新增 `checkSpawnClearance()`：默认只检查出生点眼睛高度 2 米内的环境网格并报错；URL 带 `?envDebug=1` 时额外在控制台输出 10 米内候选物、巨型物体与网格数量，并写入 `window.__DUSTLINE_SPAWN_AUDIT__`。该诊断只覆盖加载期环境几何体，不覆盖之后生成的敌人/拾取物。
- Electron 真实画面：低角度阳光、长阴影、HESCO/帐篷/探照灯、后处理（SSAO/Bloom/分级/AA）、Fabric084 织纹与 Wood066 木色、雾与尘土。
- 真实音频听感：分层枪声、距离衰减、风声/远处交火、主音量与静音。
- 性能：1600 × 900 高画质下的实际 FPS、draw call、阴影与后处理开销；**没有测过，不写“60 fps”**。
- 连续重开 5 次的对象数量与内存稳定性。
- Pipeline 尚未调用新增的 `enemyShot`/`blood`/`shell`/`bulletHole`/`headshot`/`shellDrop`/环境音接口；`main.js` 还没有把 `arena.getDecals()` 传给 `createEffects()`。
