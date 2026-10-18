/**
 * Three.js 素材加载 Provider 实现。
 *
 * 通过 `baseUrl` 找到 `asset-manifest.json`，再用清单里的相对路径加载贴图、
 * HDR 与 GLB。所有加载结果按“绝对 URL + 规范化选项”缓存；失败时先记录
 * 具体 URL 与原因，再抛出带 URL 的 Error，绝不静默返回空对象。
 *
 * 导入本模块不会访问 `document`、不会创建加载器、不会发起网络请求。
 */

import {
  ClampToEdgeWrapping,
  EquirectangularReflectionMapping,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * @param {string} action
 * @param {string} url
 * @param {unknown} cause
 * @returns {Error}
 */
function createLoadError(action, url, cause) {
  const error = new Error(action + '失败: ' + url + '（' + describeError(cause) + '）');
  error.cause = cause;
  return error;
}

/**
 * 保证基地址以 `/` 结尾，避免相对路径解析到父目录。
 *
 * @param {string} url
 * @returns {string}
 */
function ensureTrailingSlash(url) {
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname + '/';
  }
  return parsed.href;
}

/**
 * 读取浏览器页面基地址；Node 等没有 DOM 的环境会抛出明确错误。
 *
 * @returns {string}
 */
function readDocumentBaseUri() {
  if (
    typeof document !== 'undefined' &&
    typeof document.baseURI === 'string' &&
    document.baseURI.length > 0
  ) {
    return document.baseURI;
  }
  throw new Error(
    '无法确定素材根目录：当前环境没有 document。请调用 createAssetLoader({ baseUrl }) ' +
      '传入包含 asset-manifest.json 的绝对目录 URL。'
  );
}

/**
 * 按文件通道判断是否应使用线性色彩空间。颜色贴图仍由调用方或默认 sRGB 处理。
 *
 * @param {string} url
 * @returns {boolean}
 */
function isDataChannelUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('normal')) {
    return true;
  }
  if (lower.includes('roughness')) {
    return true;
  }
  if (lower.includes('metalness')) {
    return true;
  }
  if (lower.includes('ambientocclusion')) {
    return true;
  }
  if (lower.includes('_ao.') || lower.includes('_ao_')) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} rawOptions
 * @param {string} resolvedUrl
 * @returns {{ colorSpace: string, repeatX: number, repeatY: number, wrap: number, anisotropy: number }}
 */
function normalizeTextureOptions(rawOptions, resolvedUrl) {
  let options = {};
  if (rawOptions !== undefined) {
    if (!isObject(rawOptions)) {
      throw new TypeError('loadTexture 的 options 必须是对象');
    }
    options = rawOptions;
  }

  let colorSpace = SRGBColorSpace;
  if (options.colorSpace !== undefined) {
    if (options.colorSpace === 'srgb') {
      colorSpace = SRGBColorSpace;
    } else if (options.colorSpace === 'linear' || options.colorSpace === 'none') {
      colorSpace = NoColorSpace;
    } else {
      throw new TypeError(
        "loadTexture 的 colorSpace 只能是 'srgb'、'linear' 或 'none'"
      );
    }
  } else if (isDataChannelUrl(resolvedUrl)) {
    colorSpace = NoColorSpace;
  }

  let repeatX = 1;
  let repeatY = 1;
  if (options.repeat !== undefined) {
    if (typeof options.repeat === 'number') {
      if (!Number.isFinite(options.repeat) || options.repeat <= 0) {
        throw new RangeError('loadTexture 的 repeat 必须是大于 0 的有限数字');
      }
      repeatX = options.repeat;
      repeatY = options.repeat;
    } else if (isObject(options.repeat)) {
      if (options.repeat.x !== undefined) {
        if (!Number.isFinite(options.repeat.x) || options.repeat.x <= 0) {
          throw new RangeError('loadTexture 的 repeat.x 必须是大于 0 的有限数字');
        }
        repeatX = options.repeat.x;
      }
      if (options.repeat.y !== undefined) {
        if (!Number.isFinite(options.repeat.y) || options.repeat.y <= 0) {
          throw new RangeError('loadTexture 的 repeat.y 必须是大于 0 的有限数字');
        }
        repeatY = options.repeat.y;
      }
    } else {
      throw new TypeError('loadTexture 的 repeat 必须是数字或 { x, y } 对象');
    }
  }

  let wrap = RepeatWrapping;
  if (options.wrap !== undefined) {
    if (options.wrap === 'repeat') {
      wrap = RepeatWrapping;
    } else if (options.wrap === 'clamp') {
      wrap = ClampToEdgeWrapping;
    } else {
      throw new TypeError("loadTexture 的 wrap 只能是 'repeat' 或 'clamp'");
    }
  }

  let anisotropy = 1;
  if (options.anisotropy !== undefined) {
    if (!Number.isFinite(options.anisotropy) || options.anisotropy < 1) {
      throw new RangeError('loadTexture 的 anisotropy 必须是大于等于 1 的有限数字');
    }
    anisotropy = options.anisotropy;
  }

  return { colorSpace, repeatX, repeatY, wrap, anisotropy };
}

/**
 * @param {string} resolvedUrl
 * @param {{ colorSpace: string, repeatX: number, repeatY: number, wrap: number, anisotropy: number }} options
 * @returns {string}
 */
function createTextureCacheKey(resolvedUrl, options) {
  return (
    resolvedUrl +
    '|colorSpace=' +
    options.colorSpace +
    '|repeat=' +
    options.repeatX +
    'x' +
    options.repeatY +
    '|wrap=' +
    options.wrap +
    '|anisotropy=' +
    options.anisotropy
  );
}

/**
 * @param {unknown} material
 * @param {Set<unknown>} disposedTextures
 * @returns {void}
 */
function disposeMaterial(material, disposedTextures) {
  if (!isObject(material)) {
    return;
  }
  const keys = Object.keys(material);
  for (const key of keys) {
    const value = material[key];
    if (value !== null && value !== undefined && value.isTexture === true) {
      if (!disposedTextures.has(value)) {
        disposedTextures.add(value);
        value.dispose();
      }
    }
  }
  if (typeof material.dispose === 'function') {
    material.dispose();
  }
}

/**
 * @param {unknown} root
 * @param {Set<unknown>} disposedTextures
 * @returns {void}
 */
function disposeModel(root, disposedTextures) {
  if (!isObject(root) || typeof root.traverse !== 'function') {
    return;
  }
  root.traverse((node) => {
    if (node.geometry !== null && node.geometry !== undefined) {
      if (typeof node.geometry.dispose === 'function') {
        node.geometry.dispose();
      }
    }
    const material = node.material;
    if (material === null || material === undefined) {
      return;
    }
    if (Array.isArray(material)) {
      for (const entry of material) {
        disposeMaterial(entry, disposedTextures);
      }
      return;
    }
    disposeMaterial(material, disposedTextures);
  });
}

/**
 * 释放动画剪辑。Three.js 的 AnimationClip 没有 GPU 资源，也不一定实现
 * `dispose()`；有该方法时调用，没有时只丢弃引用并记录在缓存清理流程里。
 *
 * @param {unknown} animations
 * @returns {void}
 */
function disposeAnimationClips(animations) {
  if (!Array.isArray(animations)) {
    return;
  }
  for (const clip of animations) {
    if (clip !== null && clip !== undefined && typeof clip.dispose === 'function') {
      clip.dispose();
    }
  }
}

/**
 * 创建 Three.js 素材加载器。
 *
 * @param {import('../abstract/assets.js').CreateAssetLoaderOptions} [options]
 * @returns {import('../abstract/assets.js').AssetLoader}
 */
export function createThreeAssetLoader(options) {
  let baseUrlOption = null;
  if (options !== undefined) {
    if (!isObject(options)) {
      throw new TypeError('createAssetLoader 需要 { baseUrl } 参数对象');
    }
    if (options.baseUrl !== undefined) {
      if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
        throw new TypeError('createAssetLoader 的 baseUrl 必须是非空字符串');
      }
      baseUrlOption = options.baseUrl;
    }
  }

  /** @type {Map<string, Promise<unknown>>} */
  const textureCache = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const hdrCache = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const modelCache = new Map();
  let manifest = null;
  let manifestPromise = null;

  /**
   * 解析并缓存基目录；没有显式 baseUrl 时使用页面下的 `./resource/`。
   *
   * @returns {string}
   */
  function getBaseHref() {
    if (baseUrlOption !== null) {
      if (ABSOLUTE_URL_PATTERN.test(baseUrlOption)) {
        return ensureTrailingSlash(baseUrlOption);
      }
      return ensureTrailingSlash(
        new URL(baseUrlOption, readDocumentBaseUri()).href
      );
    }
    return ensureTrailingSlash(
      new URL('./resource/', readDocumentBaseUri()).href
    );
  }

  /**
   * @param {string} url
   * @returns {string}
   */
  function resolveUrl(url) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('resolveUrl 需要非空字符串 URL');
    }
    return new URL(url, getBaseHref()).href;
  }

  /**
   * @returns {Promise<Record<string, unknown>>}
   */
  async function loadManifest() {
    if (manifest !== null) {
      return manifest;
    }
    if (manifestPromise !== null) {
      return manifestPromise;
    }

    const manifestUrl = resolveUrl('asset-manifest.json');
    manifestPromise = (async () => {
      try {
        if (typeof fetch !== 'function') {
          throw new Error('当前环境没有 fetch，无法读取素材清单');
        }
        const response = await fetch(manifestUrl);
        if (!response.ok) {
          throw new Error(
            'HTTP ' + response.status + ' ' + response.statusText
          );
        }
        const data = await response.json();
        manifest = data;
        return data;
      } catch (error) {
        console.error('[assets] 读取素材清单失败: ' + manifestUrl, error);
        throw createLoadError('读取素材清单', manifestUrl, error);
      } finally {
        manifestPromise = null;
      }
    })();

    return manifestPromise;
  }

  /**
   * @returns {Record<string, unknown>|null}
   */
  function getManifest() {
    return manifest;
  }

  /**
   * @param {string} url
   * @param {import('../abstract/assets.js').TextureOptions} [textureOptions]
   * @returns {Promise<unknown>}
   */
  function loadTexture(url, textureOptions) {
    const resolvedUrl = resolveUrl(url);
    const normalized = normalizeTextureOptions(textureOptions, resolvedUrl);
    const cacheKey = createTextureCacheKey(resolvedUrl, normalized);

    const cached = textureCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const loadPromise = (async () => {
      try {
        const loader = new TextureLoader();
        const texture = await loader.loadAsync(resolvedUrl);
        texture.colorSpace = normalized.colorSpace;
        texture.wrapS = normalized.wrap;
        texture.wrapT = normalized.wrap;
        texture.repeat.set(normalized.repeatX, normalized.repeatY);
        texture.anisotropy = normalized.anisotropy;
        texture.needsUpdate = true;
        return texture;
      } catch (error) {
        console.error('[assets] 加载贴图失败: ' + resolvedUrl, error);
        throw createLoadError('加载贴图', resolvedUrl, error);
      }
    })();

    textureCache.set(cacheKey, loadPromise);
    loadPromise.then(null, () => {
      textureCache.delete(cacheKey);
    });
    return loadPromise;
  }

  /**
   * @param {string} url
   * @returns {Promise<unknown>}
   */
  function loadHdr(url) {
    const resolvedUrl = resolveUrl(url);
    const cached = hdrCache.get(resolvedUrl);
    if (cached !== undefined) {
      return cached;
    }

    const loadPromise = (async () => {
      try {
        const loader = new HDRLoader();
        const texture = await loader.loadAsync(resolvedUrl);
        texture.mapping = EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        return texture;
      } catch (error) {
        console.error('[assets] 加载 HDR 失败: ' + resolvedUrl, error);
        throw createLoadError('加载 HDR', resolvedUrl, error);
      }
    })();

    hdrCache.set(resolvedUrl, loadPromise);
    loadPromise.then(null, () => {
      hdrCache.delete(resolvedUrl);
    });
    return loadPromise;
  }

  /**
   * 加载 GLB，返回 `{ scene, animations }`。同一 URL 的并发调用和后续调用
   * 都复用同一个 Promise/结果，避免为同一个模型重复下载。
   *
   * @param {string} url
   * @returns {Promise<{scene: unknown, animations: unknown[]}>}
   */
  function loadGltf(url) {
    const resolvedUrl = resolveUrl(url);
    const cached = modelCache.get(resolvedUrl);
    if (cached !== undefined) {
      return cached;
    }

    const loadPromise = (async () => {
      try {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(resolvedUrl);
        if (gltf === null || gltf === undefined || !gltf.scene) {
          throw new Error('GLB 内容中没有 scene');
        }
        let animations = [];
        if (Array.isArray(gltf.animations)) {
          animations = gltf.animations;
        }
        return { scene: gltf.scene, animations };
      } catch (error) {
        console.error('[assets] 加载模型失败: ' + resolvedUrl, error);
        throw createLoadError('加载模型', resolvedUrl, error);
      }
    })();

    modelCache.set(resolvedUrl, loadPromise);
    loadPromise.then(null, () => {
      modelCache.delete(resolvedUrl);
    });
    return loadPromise;
  }

  /**
   * 加载 GLB 并只返回场景根对象，保留 v2 兼容行为。
   *
   * @param {string} url
   * @returns {Promise<unknown>}
   */
  function loadModel(url) {
    return loadGltf(url).then((gltf) => gltf.scene);
  }

  /**
   * 释放所有已缓存贴图、模型几何/材质，并清空缓存。
   *
   * @returns {Promise<void>}
   */
  async function dispose() {
    const pending = [];
    for (const promise of textureCache.values()) {
      pending.push(promise);
    }
    for (const promise of hdrCache.values()) {
      pending.push(promise);
    }
    for (const promise of modelCache.values()) {
      pending.push(promise);
    }
    if (manifestPromise !== null) {
      pending.push(manifestPromise);
    }

    const settled = await Promise.allSettled(pending);
    const disposedTextures = new Set();
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        // 加载失败时已记录并抛给调用方；这里只为释放其余成功项。
        continue;
      }
      const value = result.value;
      if (value === null || value === undefined) {
        continue;
      }
      if (value.isTexture === true) {
        if (!disposedTextures.has(value)) {
          disposedTextures.add(value);
          value.dispose();
        }
      } else if (value.isObject3D === true) {
        disposeModel(value, disposedTextures);
      } else if (isObject(value) && isObject(value.scene)) {
        // GLTF 缓存项：同时释放场景几何/材质与动画剪辑引用。
        disposeModel(value.scene, disposedTextures);
        disposeAnimationClips(value.animations);
      }
    }

    textureCache.clear();
    hdrCache.clear();
    modelCache.clear();
    manifest = null;
    manifestPromise = null;
  }

  return {
    loadManifest,
    getManifest,
    resolveUrl,
    loadTexture,
    loadHdr,
    loadGltf,
    loadModel,
    dispose
  };
}
