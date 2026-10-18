/**
 * 渲染 Provider 契约。
 *
 * 这一层只负责“把 Three.js 场景画到画布上”，不理解生命、得分、波次等业务。
 * 环境、效果、战斗、敌方和界面都只通过 `src/providers/public/renderer.js`
 * 拿到本契约返回的渲染器，不直接导入 `impl/` 或 Three.js 实现类。
 *
 * 本文件只有类型说明，没有运行时代码；导入它不会创建 WebGL 上下文。
 *
 * 坐标约定：
 * - 位置、方向、射线命中点与法线在 Provider 边界上都是普通 `{ x, y, z }` 对象，
 *   不是 Three.js 的 `Vector3` 实例，避免把实现细节泄漏给上层。
 * - `getWorldPosition` 的屏幕坐标以画布左上角为原点，单位与 `resize()` 传入的
 *   宽高一致（通常是 CSS 像素）。
 */

/**
 * @typedef {Object} Vec3
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * 相机姿态。`yaw` 绕竖直轴旋转，`pitch` 为俯仰角（弧度），`roll` 为镜头滚转
 * （弧度，绕视线轴）。`shakeX` / `shakeY` 是可选的相机局部震动偏移（米），
 * 由调用方在基础位置之外单独提供；省略时为 0。
 *
 * @typedef {Object} RendererPose
 * @property {Vec3} position 相机世界位置。
 * @property {number} yaw 水平朝向（弧度）。
 * @property {number} pitch 俯仰角（弧度），渲染器会限制在约 ±1.55 弧度。
 * @property {number} roll 镜头滚转（弧度），省略或未提供时为 0。
 * @property {number} fov 垂直视野（度）。
 * @property {number} [shakeX] 可选的相机局部 X 震动偏移（米）。
 * @property {number} [shakeY] 可选的相机局部 Y 震动偏移（米）。
 */

/**
 * 画质档位。`high` 使用后处理管线；`low` 直接调用 WebGLRenderer 渲染。
 *
 * @typedef {'high'|'low'} RendererQuality
 */

/**
 * 屏幕点对应的世界射线。
 *
 * @typedef {Object} WorldRay
 * @property {Vec3} origin 射线起点（相机世界位置）。
 * @property {Vec3} direction 归一化方向。
 */

/**
 * 射线命中结果。
 *
 * @typedef {Object} RaycastHit
 * @property {unknown} object 命中的 Three.js 对象（原样返回，供上层读取 userData）。
 * @property {number} distance 从射线起点到命中点的距离。
 * @property {Vec3} point 世界坐标命中点。
 * @property {Vec3} normal 世界坐标命中法线；没有面法线时退化为 `{ x: 0, y: 1, z: 0 }`。
 * @property {Record<string, unknown>} userData 命中对象自带的 `userData`。
 */

/**
 * 环境与氛围设置。所有字段都可选；只提交需要改变的字段。
 *
 * @typedef {Object} EnvironmentOptions
 * @property {unknown} [hdriTexture] 等距柱状投影的环境贴图，用于反射与环境光。
 * @property {unknown} [backgroundTexture] 背景贴图；提供时优先于 `skyColor`。
 * @property {number|string|unknown} [skyColor] 背景颜色，接受 Three.js `Color` 可解析的值。
 * @property {number|string|unknown} [fogColor] 雾颜色。
 * @property {number} [fogNear] 雾起点距离。
 * @property {number} [fogFar] 雾终点距离。
 * @property {number} [intensity] 环境贴图强度（`scene.environmentIntensity`）。
 * @property {number} [backgroundIntensity] 背景贴图亮度乘数（`scene.backgroundIntensity`），非负。
 * @property {number} [backgroundBlurriness] 背景模糊程度（`scene.backgroundBlurriness`），0–1。
 */

/**
 * 渲染器公共能力。
 *
 * @typedef {Object} Renderer
 * @property {(object: unknown) => void} add 把对象加入场景。
 * @property {(object: unknown) => void} remove 从场景移除对象。
 * @property {(object: unknown) => void} attachToCamera 把对象挂到相机下（第一人称模型）。
 * @property {(object: unknown) => void} detachFromCamera 从相机下移除对象。
 * @property {(pose: Partial<RendererPose>) => RendererPose} setCameraPose 设置相机位置、朝向与视野。
 * @property {() => RendererPose} getCameraPose 读取当前相机姿态。
 * @property {(screenX: number, screenY: number) => WorldRay} getWorldPosition 把画布屏幕点转成世界射线。
 * @property {(origin: Vec3, direction: Vec3, far?: number, objects?: unknown[]) => RaycastHit|null} raycast
 *   对给定对象（省略时为整个场景）做射线检测，返回最近命中；挂在相机下的第一人称对象会被忽略。
 * @property {(options: EnvironmentOptions) => void} setEnvironment 设置环境贴图、背景与雾。
 * @property {(quality: RendererQuality) => void} setQuality
 *   切换画质。`high` 启用后处理，`low` 直接渲染；切换立即生效且可重复调用。
 * @property {() => RendererQuality} getQuality 返回当前画质。
 * @property {() => boolean} [isPostProcessingEnabled]
 *   返回后处理当前是否真正生效（高画质且后处理管线创建成功）。
 * @property {(width: number, height: number) => void} resize 更新绘制缓冲与相机宽高比。
 * @property {() => void} render 绘制一帧：高画质走后处理，低画质直接渲染。
 * @property {() => void} dispose 释放 WebGL 渲染器与后处理资源；场景对象由各自的 Service 负责释放。
 */

/**
 * 渲染器工厂参数。
 *
 * @typedef {Object} CreateRendererOptions
 * @property {unknown} canvas 必须由调用方提供的 HTMLCanvasElement。
 * @property {number} [width] 初始宽度（CSS 像素）。
 * @property {number} [height] 初始高度（CSS 像素）。
 * @property {number} [pixelRatio] 设备像素比；省略时使用浏览器值并限制上限。
 * @property {boolean} [shadows] 是否启用阴影，默认 `true`。
 */

/**
 * @callback CreateRenderer
 * @param {CreateRendererOptions} options
 * @returns {Renderer}
 */

export {};
