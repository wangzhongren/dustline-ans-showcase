/**
 * 素材加载 Provider 契约。
 *
 * 负责从 `baseUrl` 指向的目录读取 `asset-manifest.json`，并按清单里的相对路径
 * 加载贴图、HDR 环境图和 GLB 模型。素材来源与授权由美术角色维护，本层只负责
 * 加载与基础配置（色彩空间、重复方式、过滤）。
 *
 * 本文件只有类型说明，没有运行时代码；导入它不会读取文件、创建图片或发起请求。
 */

/**
 * 贴图加载选项。
 *
 * `colorSpace` 省略时按文件名推断：`Color` 使用 sRGB；`NormalGL`、`Roughness`、
 * `Metalness`、`AmbientOcclusion` 使用线性（NoColorSpace）。
 *
 * @typedef {Object} TextureOptions
 * @property {'srgb'|'linear'|'none'} [colorSpace] 显式指定色彩空间，优先于文件名推断。
 * @property {number|{x: number, y: number}} [repeat] 重复次数，数字表示横纵相同。
 * @property {'repeat'|'clamp'} [wrap] 环绕方式，默认 `repeat`。
 * @property {number} [anisotropy] 各向异性过滤级别，默认 1。
 */

/**
 * 贴图、HDR 与模型的缓存键都是“绝对 URL + 规范化选项”，
 * 因此相同输入会返回同一个已加载对象。
 *
 * @typedef {Object} GltfResult
 * @property {unknown} scene GLB 的场景根对象。
 * @property {unknown[]} animations GLB 自带的动画剪辑；没有动画时为空数组。
 *
 * @typedef {Object} AssetLoader
 * @property {() => Promise<Record<string, unknown>>} loadManifest
 *   读取并缓存 `asset-manifest.json`，失败时抛出带 URL 的 Error。
 * @property {() => Record<string, unknown>|null} getManifest 返回已加载的清单，未加载时为 `null`。
 * @property {(url: string) => string} resolveUrl 把清单里的相对路径解析成绝对 URL。
 * @property {(url: string, options?: TextureOptions) => Promise<unknown>} loadTexture 加载并配置贴图。
 * @property {(url: string) => Promise<unknown>} loadHdr 加载 HDR 环境图并设为等距柱状投影。
 * @property {(url: string) => Promise<GltfResult>} loadGltf
 *   加载 GLB 并返回 `{ scene, animations }`；同一 URL 返回同一个已加载对象。
 * @property {(url: string) => Promise<unknown>} loadModel
 *   加载 GLB 并返回场景根对象（`gltf.scene`），保留 v2 兼容行为。
 * @property {() => Promise<void>} dispose
 *   释放已缓存的贴图与模型几何/材质/动画引用，并清空缓存。
 */

/**
 * @typedef {Object} CreateAssetLoaderOptions
 * @property {string} [baseUrl]
 *   素材根目录（应包含 `asset-manifest.json`）。省略时在首次调用方法时使用
 *   `new URL('./resource/', document.baseURI).href`；没有 `document` 时抛出明确错误。
 */

/**
 * @callback CreateAssetLoader
 * @param {CreateAssetLoaderOptions} [options]
 * @returns {AssetLoader}
 */

export {};
