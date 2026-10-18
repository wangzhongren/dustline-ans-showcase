/**
 * 竞技场场景 Service 实现。
 *
 * 负责把 `arena-layout.js` 的纯布局变成 Three.js 场景：地面、掩体、集装箱、
 * 木箱、金属桶、沙袋、警戒塔、围栏、装饰碎片、灯光、雾和漂浮尘土。
 *
 * 依赖边界：
 * - 只导入 Model（`src/models/`）与 Provider 公共入口（`src/providers/public/three.js`）。
 * - 不导入其他 Service、Pipeline、Interface，也不导入 `src/providers/impl/`。
 * - 贴图、HDR 与清单的真实路径只来自 `asset-manifest.json`，本文件不硬编码素材路径。
 *
 * 资源所有权：
 * - 贴图与 HDR 由素材加载器缓存并释放；本 Service 只借用，不调用它们的 `dispose()`。
 * - 程序化回退贴图（CanvasTexture）由本 Service 创建，释放时一并 `dispose()`。
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3
} from '../../../providers/public/three.js';
import { GAME_CONFIG } from '../../../models/game-config.js';
import {
  createColliders,
  createLayout,
  findSpawnPoint,
  getPlayerSpawn
} from './arena-layout.js';
import { createProps } from './props.js';
import { createDecals } from './decals.js';

/** 雾与天空的灰蓝色锚点（美术方向 §2）。 */
const FOG_COLOR = 0xb9c2c8;
const FOG_NEAR = 18;
const FOG_FAR = 80;
const ENVIRONMENT_INTENSITY = 0.95;

/** 材质色调锚点。锈迹只作为小面积强调色。 */
const TINTS = Object.freeze({
  ground: 0x8f877a,
  concrete: 0x8c8c86,
  wood: 0x5e4a36,
  steelOlive: 0x8a9068,
  steelKhaki: 0xb3a585,
  steelRust: 0x8f5a38,
  metal: 0x7a7d72,
  metalRust: 0x8f5a38,
  fabric: 0xc3b091,
  rock: 0x77776f,
  dust: 0xb8b2a6
});

/** 贴图重映射的基准色（美术方向 §9.1 与 §9.3）。 */
export const FABRIC_RAMP = Object.freeze({ r: 0xc3, g: 0xb0, b: 0x91 });
export const WOOD_RAMP = Object.freeze({ r: 0x5e, g: 0x4a, b: 0x36 });

/** 每种材质组一份贴图重复尺度（美术方向 §4.1）。 */
const TEXTURE_REPEAT = Object.freeze({
  ground: 18,
  concrete: 3,
  metal: 1.6,
  wood: 1.8,
  steel: 2,
  fabric: 1
});

const TEXTURE_ANISOTROPY = 4;
const HIGH_DUST_COUNT = 300;
const LOW_DUST_COUNT = 160;
/** 金属度贴图的整体乘数：保留贴图驱动，但让金属在阴天环境下不发黑、不发镜面。 */
const METALNESS_MAP_SCALE = 0.45;

/**
 * 计算贴图重映射的亮度系数：贴图平均亮度对应 1.0，暗部最低 0.75、亮部最高 1.25。
 *
 * @param {number} luminance 0–255 的感知亮度。
 * @param {number} averageLuminance 整张贴图的平均亮度（0–255）。
 * @param {number} strength 偏差放大系数，建议 0.2–0.4。
 * @param {number} minFactor 最低系数，例如 0.75。
 * @param {number} maxFactor 最高系数，例如 1.25。
 * @returns {number}
 */
export function computeRampFactor(luminance, averageLuminance, strength, minFactor, maxFactor) {
  if (!isFiniteNumber(luminance) || luminance < 0 || luminance > 255) {
    throw new RangeError('computeRampFactor 的 luminance 必须在 0–255 之间');
  }
  if (!isFiniteNumber(averageLuminance) || averageLuminance <= 0 || averageLuminance > 255) {
    throw new RangeError('computeRampFactor 的 averageLuminance 必须在 (0, 255] 之间');
  }
  if (!isFiniteNumber(strength) || strength < 0) {
    throw new RangeError('computeRampFactor 的 strength 必须是非负有限数字');
  }
  if (!isFiniteNumber(minFactor) || !isFiniteNumber(maxFactor) || minFactor > maxFactor) {
    throw new RangeError('computeRampFactor 的系数范围无效');
  }
  const ratio = luminance / averageLuminance;
  const raw = 1 + (ratio - 1) * strength;
  return Math.min(maxFactor, Math.max(minFactor, raw));
}

/**
 * 按基准色与亮度系数计算重映射后的 RGB。
 *
 * @param {number} luminance
 * @param {number} averageLuminance
 * @param {{r: number, g: number, b: number}} base
 * @param {number} strength
 * @param {number} minFactor
 * @param {number} maxFactor
 * @returns {{r: number, g: number, b: number}}
 */
export function computeRampColor(luminance, averageLuminance, base, strength, minFactor, maxFactor) {
  if (!isObject(base)) {
    throw new TypeError('computeRampColor 的 base 必须是 { r, g, b }');
  }
  const factor = computeRampFactor(luminance, averageLuminance, strength, minFactor, maxFactor);
  return {
    r: clampChannel(base.r * factor),
    g: clampChannel(base.g * factor),
    b: clampChannel(base.b * factor)
  };
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * 渲染器画质；没有该方法时按高画质处理。
 *
 * @param {unknown} renderer
 * @returns {'high'|'low'}
 */
function readRendererQuality(renderer) {
  const value = /** @type {Record<string, unknown>} */ (renderer);
  if (typeof value.getQuality === 'function') {
    const quality = /** @type {() => unknown} */ (value.getQuality)();
    if (quality === 'low') {
      return 'low';
    }
  }
  return 'high';
}

/**
 * @param {unknown} renderer
 * @returns {number}
 */
function readDustCount(renderer) {
  if (readRendererQuality(renderer) === 'low') {
    return LOW_DUST_COUNT;
  }
  return HIGH_DUST_COUNT;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
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
 * 读取一个普通三维点，返回副本。
 *
 * @param {unknown} value
 * @param {string} label
 * @returns {{x: number, y: number, z: number}}
 */
function readPoint(value, label) {
  if (!isObject(value)) {
    throw new TypeError(label + ' 必须是 { x, y, z } 对象');
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y) || !isFiniteNumber(source.z)) {
    throw new TypeError(label + ' 的 x/y/z 必须是有限数字');
  }
  return { x: source.x, y: source.y, z: source.z };
}

/**
 * 把字符串散列成一个稳定的 32 位种子，用于程序化贴图的确定性噪声。
 *
 * @param {string} text
 * @returns {number}
 */
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = hash ^ text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 为几何体准备第二套 UV。Three.js 的 `aoMap` 读取 `uv1`。
 *
 * @param {unknown} geometry
 * @returns {void}
 */
function ensureUv1(geometry) {
  if (!isObject(geometry)) {
    return;
  }
  const value = /** @type {Record<string, unknown>} */ (geometry);
  if (typeof value.getAttribute !== 'function') {
    return;
  }
  const uv = value.getAttribute('uv');
  if (uv === undefined || uv === null) {
    return;
  }
  const existing = value.getAttribute('uv1');
  if (existing !== undefined && existing !== null) {
    return;
  }
  const uvAttribute = /** @type {{array: ArrayLike<number>, itemSize: number}} */ (uv);
  const copy = new Float32Array(uvAttribute.array.length);
  copy.set(uvAttribute.array);
  value.setAttribute('uv1', new BufferAttribute(copy, uvAttribute.itemSize));
}

/**
 * 创建竞技场服务。
 *
 * @param {{renderer: import('../../../providers/abstract/renderer.js').Renderer, assets: import('../../../providers/abstract/assets.js').AssetLoader}} options
 * @returns {import('../abstract/environment.js').ArenaService}
 */
export function createArenaService(options) {
  const renderer = options.renderer;
  const assets = options.assets;

  const layout = createLayout();
  const colliders = createColliders(layout);
  /** @type {Set<unknown>} */
  const ownedTextures = new Set();
  /** @type {Set<{dispose: () => void}>} */
  const materials = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const fallbacks = [];
  /** @type {Set<string>} */
  const fallbackKeys = new Set();

  /**
   * 记录一次回退；同一素材路径只保留第一条，避免一个缺失材质组重复 5 次。
   *
   * @param {{asset: string, url?: string, reason: string}} record
   * @returns {void}
   */
  function recordFallback(record) {
    let key = record.asset;
    if (record.url !== undefined) {
      key = key + '|' + record.url;
    }
    if (fallbackKeys.has(key)) {
      return;
    }
    fallbackKeys.add(key);
    fallbacks.push(record);
  }

  let loadPromise = null;
  let loaded = false;
  let disposed = false;
  let root = null;
  let dust = null;
  let props = null;
  let decals = null;

  /**
   * 用 Canvas 生成程序化的灰阶噪声贴图。既用于贴图加载失败回退，也用于
   * 需要中性颜色贴图的材质（例如饱和蓝色的 Fabric084 颜色图）。
   * 返回 null 表示当前环境没有 DOM，此时材质退化为纯色。
   *
   * @param {number} repeat
   * @param {string} seedText
   * @returns {unknown}
   */
  function createFallbackTexture(repeat, seedText) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      console.error('[arena] 当前环境没有 document，无法创建程序化贴图回退，改用纯色材质');
      return null;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context === null) {
        console.error('[arena] 无法获得 2D 画布上下文，改用纯色材质');
        return null;
      }
      let state = hashSeed(seedText);
      const nextRandom = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      context.fillStyle = '#b4b4ac';
      context.fillRect(0, 0, 64, 64);
      for (let index = 0; index < 1100; index += 1) {
        const gray = 138 + Math.floor(nextRandom() * 86);
        const alpha = 0.12 + nextRandom() * 0.28;
        context.fillStyle = 'rgba(' + gray + ',' + gray + ',' + gray + ',' + alpha + ')';
        const size = 1 + Math.floor(nextRandom() * 2);
        context.fillRect(
          Math.floor(nextRandom() * 64),
          Math.floor(nextRandom() * 64),
          size,
          size
        );
      }
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.needsUpdate = true;
      ownedTextures.add(texture);
      return texture;
    } catch (error) {
      console.error('[arena] 创建程序化贴图回退失败，改用纯色材质', error);
      return null;
    }
  }

  /**
   * 把真实颜色贴图重映射到低饱和军用色：保留原贴图的亮度起伏与织纹，
   * 只替换色相/饱和度。Fabric084 用卡其基准，Wood066 用灰棕基准。
   *
   * 无 `document`、画布上下文不可用或读取像素失败时返回 null；调用方会退回
   * “真实颜色贴图 × 色调锚点”，仍然使用真实贴图，只是颜色不够准确。
   *
   * @param {unknown} sourceTexture
   * @param {{r: number, g: number, b: number}} base
   * @param {number} repeat
   * @param {number} strength
   * @param {string} label
   * @returns {unknown}
   */
  function createRampMappedTexture(sourceTexture, base, repeat, strength, label) {
    if (sourceTexture === null || sourceTexture === undefined) {
      return null;
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      console.error(
        '[arena] 当前环境没有 document，无法重映射 ' + label + ' 颜色贴图；使用真实颜色贴图乘色调锚点'
      );
      recordFallback({
        asset: 'textures.' + label + '.color.remap',
        reason: '当前环境没有 document，无法进行 Canvas 重映射'
      });
      return null;
    }

    const source = /** @type {Record<string, unknown>} */ (sourceTexture);
    const image = source.image;
    if (image === null || image === undefined) {
      console.error('[arena] ' + label + ' 颜色贴图没有 image，无法重映射');
      recordFallback({
        asset: 'textures.' + label + '.color.remap',
        reason: '贴图对象没有 image'
      });
      return null;
    }

    try {
      const imageValue = /** @type {{width?: number, naturalWidth?: number, height?: number, naturalHeight?: number}} */ (image);
      const width = imageValue.width;
      const height = imageValue.height;
      if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
        throw new Error('颜色贴图尺寸无效');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('无法获得 2D 画布上下文');
      }
      context.drawImage(/** @type {CanvasImageSource} */ (image), 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      const data = pixels.data;
      const pixelCount = width * height;
      let luminanceSum = 0;
      for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4;
        luminanceSum +=
          data[offset] * 0.2126 +
          data[offset + 1] * 0.7152 +
          data[offset + 2] * 0.0722;
      }
      let averageLuminance = luminanceSum / pixelCount;
      if (averageLuminance <= 0) {
        averageLuminance = 1;
      }
      for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4;
        const luminance =
          data[offset] * 0.2126 +
          data[offset + 1] * 0.7152 +
          data[offset + 2] * 0.0722;
        const mapped = computeRampColor(
          luminance,
          averageLuminance,
          base,
          strength,
          0.75,
          1.25
        );
        data[offset] = mapped.r;
        data[offset + 1] = mapped.g;
        data[offset + 2] = mapped.b;
      }
      context.putImageData(pixels, 0, 0);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = TEXTURE_ANISOTROPY;
      texture.needsUpdate = true;
      ownedTextures.add(texture);
      return texture;
    } catch (error) {
      console.error(
        '[arena] 重映射 ' + label + ' 颜色贴图失败，使用真实颜色贴图乘色调锚点',
        error
      );
      recordFallback({
        asset: 'textures.' + label + '.color.remap',
        reason: describeError(error)
      });
      return null;
    }
  }

  /**
   * 读取清单中的一个贴图通道。通道不存在是正常情况（例如混凝土没有 AO），
   * 只有“清单声明了该通道但加载失败”才记录回退。
   *
   * @param {Record<string, unknown>|null} manifest
   * @param {string} materialKey
   * @param {string} channel
   * @param {number} repeat
   * @returns {Promise<unknown>}
   */
  async function loadChannel(manifest, materialKey, channel, repeat) {
    if (manifest === null) {
      return null;
    }
    const textures = manifest.textures;
    if (!isObject(textures)) {
      console.error('[arena] 素材清单缺少 textures 字段，材质使用程序化回退');
      return null;
    }
    const group = /** @type {Record<string, unknown>} */ (textures)[materialKey];
    if (!isObject(group)) {
      console.error('[arena] 素材清单缺少材质组 textures.' + materialKey + '，材质使用程序化回退');
      recordFallback({
        asset: 'textures.' + materialKey,
        reason: '清单缺少该材质组'
      });
      return null;
    }
    const url = /** @type {Record<string, unknown>} */ (group)[channel];
    if (typeof url !== 'string' || url.length === 0) {
      // 该通道没有在清单中声明，属于正常缺失，不记录为回退。
      return null;
    }
    let colorSpace = 'linear';
    if (channel === 'color') {
      colorSpace = 'srgb';
    }
    try {
      return await assets.loadTexture(url, {
        colorSpace,
        repeat,
        wrap: 'repeat',
        anisotropy: TEXTURE_ANISOTROPY
      });
    } catch (error) {
      console.error('[arena] 贴图加载失败，使用程序化回退: ' + url, error);
      recordFallback({
        asset: 'textures.' + materialKey + '.' + channel,
        url,
        reason: describeError(error)
      });
      return null;
    }
  }

  /**
   * 组装一组 PBR 材质。颜色缺失时用程序化灰阶贴图乘上色调锚点。
   *
   * @param {Record<string, unknown>|null} manifest
   * @param {{
   *   key: string,
   *   repeat: number,
   *   tint: number,
   *   roughness: number,
   *   flatShading?: boolean,
   *   ramp?: {base: {r: number, g: number, b: number}, strength: number},
   *   label: string
   * }} config
   * @returns {Promise<MeshStandardMaterial>}
   */
  async function createMaterialGroup(manifest, config) {
    const [color, normal, roughnessMap, metalnessMap, aoMap] = await Promise.all([
      loadChannel(manifest, config.key, 'color', config.repeat),
      loadChannel(manifest, config.key, 'normal', config.repeat),
      loadChannel(manifest, config.key, 'roughness', config.repeat),
      loadChannel(manifest, config.key, 'metalness', config.repeat),
      loadChannel(manifest, config.key, 'ao', config.repeat)
    ]);

    let map = color;
    let tint = config.tint;
    if (color !== null && config.ramp !== undefined) {
      const remapped = createRampMappedTexture(
        color,
        config.ramp.base,
        config.repeat,
        config.ramp.strength,
        config.label
      );
      if (remapped !== null) {
        map = remapped;
        // 重映射贴图已经包含基准色，材质颜色保持白色，避免二次乘色。
        tint = 0xffffff;
      }
    }
    if (map === null) {
      map = createFallbackTexture(config.repeat, config.label);
    }

    /** @type {Record<string, unknown>} */
    const parameters = {
      color: tint,
      roughness: config.roughness,
      metalness: 0
    };
    if (map !== null) {
      parameters.map = map;
    }
    if (normal !== null) {
      parameters.normalMap = normal;
    }
    if (roughnessMap !== null) {
      parameters.roughnessMap = roughnessMap;
      parameters.roughness = 1;
    }
    if (metalnessMap !== null) {
      parameters.metalnessMap = metalnessMap;
      parameters.metalness = METALNESS_MAP_SCALE;
    }
    if (aoMap !== null) {
      parameters.aoMap = aoMap;
      parameters.aoMapIntensity = 0.85;
    }
    if (config.flatShading === true) {
      parameters.flatShading = true;
    }

    const material = new MeshStandardMaterial(
      /** @type {import('three').MeshStandardMaterialParameters} */ (parameters)
    );
    materials.add(material);
    return material;
  }

  /**
   * 创建全部材质组。同一贴图 URL + 选项由素材加载器缓存共享。
   *
   * @param {Record<string, unknown>|null} manifest
   * @returns {Promise<Record<string, MeshStandardMaterial>>}
   */
  async function createMaterials(manifest) {
    const ground = await createMaterialGroup(manifest, {
      key: 'ground',
      repeat: TEXTURE_REPEAT.ground,
      tint: TINTS.ground,
      roughness: 0.95,
      label: 'ground'
    });
    const concrete = await createMaterialGroup(manifest, {
      key: 'concrete',
      repeat: TEXTURE_REPEAT.concrete,
      tint: TINTS.concrete,
      roughness: 0.9,
      label: 'concrete'
    });
    const wood = await createMaterialGroup(manifest, {
      key: 'wood',
      repeat: TEXTURE_REPEAT.wood,
      tint: TINTS.wood,
      roughness: 0.85,
      ramp: { base: WOOD_RAMP, strength: 0.25 },
      label: 'wood'
    });
    const steelOlive = await createMaterialGroup(manifest, {
      key: 'steel',
      repeat: TEXTURE_REPEAT.steel,
      tint: TINTS.steelOlive,
      roughness: 0.7,
      label: 'steel-olive'
    });
    const steelKhaki = await createMaterialGroup(manifest, {
      key: 'steel',
      repeat: TEXTURE_REPEAT.steel,
      tint: TINTS.steelKhaki,
      roughness: 0.7,
      label: 'steel-khaki'
    });
    const steelRust = await createMaterialGroup(manifest, {
      key: 'steel',
      repeat: TEXTURE_REPEAT.steel,
      tint: TINTS.steelRust,
      roughness: 0.75,
      label: 'steel-rust'
    });
    const metal = await createMaterialGroup(manifest, {
      key: 'metal',
      repeat: TEXTURE_REPEAT.metal,
      tint: TINTS.metal,
      roughness: 0.65,
      label: 'metal'
    });
    const metalRust = await createMaterialGroup(manifest, {
      key: 'metal',
      repeat: TEXTURE_REPEAT.metal,
      tint: TINTS.metalRust,
      roughness: 0.7,
      label: 'metal-rust'
    });
    const fabric = await createMaterialGroup(manifest, {
      key: 'fabric',
      repeat: TEXTURE_REPEAT.fabric,
      tint: TINTS.fabric,
      roughness: 0.95,
      ramp: { base: FABRIC_RAMP, strength: 0.35 },
      label: 'fabric'
    });
    const rock = await createMaterialGroup(manifest, {
      key: 'concrete',
      repeat: TEXTURE_REPEAT.concrete,
      tint: TINTS.rock,
      roughness: 0.95,
      flatShading: true,
      label: 'rock'
    });

    /** @type {MeshStandardMaterial[]} */
    const simpleMaterials = [];
    const rubber = new MeshStandardMaterial({
      color: 0x2f3130,
      roughness: 0.92,
      metalness: 0.05
    });
    simpleMaterials.push(rubber);
    const sign = new MeshStandardMaterial({
      color: 0xb3a06a,
      roughness: 0.82,
      metalness: 0.18
    });
    simpleMaterials.push(sign);
    const ammo = new MeshStandardMaterial({
      color: 0x5c6242,
      roughness: 0.7,
      metalness: 0.32
    });
    simpleMaterials.push(ammo);
    const lamp = new MeshStandardMaterial({
      color: 0xfff1d6,
      emissive: 0xffd18a,
      emissiveIntensity: 2.2,
      roughness: 0.4,
      metalness: 0.1
    });
    simpleMaterials.push(lamp);
    const grass = new MeshStandardMaterial({
      color: 0x6c7049,
      roughness: 0.95,
      metalness: 0,
      side: DoubleSide
    });
    simpleMaterials.push(grass);
    for (const material of simpleMaterials) {
      materials.add(material);
    }

    const galvanized = metal.clone();
    galvanized.color.setHex(0xa0a6a4);
    galvanized.roughness = 0.55;
    galvanized.metalness = 0.55;
    materials.add(galvanized);
    const darkMetal = metal.clone();
    darkMetal.color.setHex(0x3c403e);
    darkMetal.roughness = 0.52;
    darkMetal.metalness = 0.68;
    materials.add(darkMetal);
    const canvasKhaki = fabric.clone();
    canvasKhaki.color.setHex(0xe4d6b8);
    materials.add(canvasKhaki);
    const canvasOlive = fabric.clone();
    canvasOlive.color.setHex(0x8f9678);
    materials.add(canvasOlive);

    return {
      ground,
      concrete,
      wood,
      steelOlive,
      steelKhaki,
      steelRust,
      metal,
      metalRust,
      fabric,
      rock,
      rubber,
      sign,
      ammo,
      lamp,
      grass,
      galvanized,
      darkMetal,
      canvasKhaki,
      canvasOlive
    };
  }

  /**
   * @param {Record<string, unknown>} entry
   * @returns {string}
   */
  function readStringField(entry, field) {
    const value = entry[field];
    if (typeof value === 'string') {
      return value;
    }
    return '';
  }

  /**
   * @param {Record<string, unknown>} entry
   * @returns {number}
   */
  function readNumberField(entry, field) {
    const value = entry[field];
    if (isFiniteNumber(value)) {
      return value;
    }
    return 0;
  }

  /**
   * 给网格打上竞技场用途标记，方便射线反馈或调试，不影响碰撞。
   *
   * @param {Mesh} mesh
   * @param {string} kind
   * @param {string} id
   * @returns {Mesh}
   */
  function tagMesh(mesh, kind, id) {
    mesh.userData = { arena: kind, id };
    return mesh;
  }

  /**
   * 向根节点添加一个箱体网格。
   *
   * @param {Record<string, unknown>} entry
   * @param {MeshStandardMaterial} material
   * @param {string} kind
   * @param {number} [extraHeight]
   * @returns {Mesh}
   */
  function addBoxEntry(entry, material, kind, extraHeight) {
    const width = readNumberField(entry, 'width');
    const height = readNumberField(entry, 'height');
    const depth = readNumberField(entry, 'depth');
    const elevation = readNumberField(entry, 'elevation');
    let actualHeight = height;
    if (extraHeight !== undefined) {
      actualHeight = height + extraHeight;
    }
    const geometry = new BoxGeometry(width, actualHeight, depth);
    ensureUv1(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(
      readNumberField(entry, 'x'),
      elevation + actualHeight / 2,
      readNumberField(entry, 'z')
    );
    mesh.rotation.y = readNumberField(entry, 'rotationY');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(tagMesh(mesh, kind, readStringField(entry, 'id')));
    return mesh;
  }

  /**
   * @param {MeshStandardMaterial} material
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {{x: number, y: number, z: number}} position
   * @param {{x?: number, y?: number, z?: number}} [rotation]
   * @returns {Mesh}
   */
  function buildLooseBox(material, width, height, depth, position, rotation) {
    const geometry = new BoxGeometry(width, height, depth);
    ensureUv1(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    if (rotation !== undefined) {
      if (rotation.x !== undefined) {
        mesh.rotation.x = rotation.x;
      }
      if (rotation.y !== undefined) {
        mesh.rotation.y = rotation.y;
      }
      if (rotation.z !== undefined) {
        mesh.rotation.z = rotation.z;
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildGround(materialSet) {
    const segments = 24;
    const geometry = new PlaneGeometry(
      readNumberField(layout.ground, 'width'),
      readNumberField(layout.ground, 'depth'),
      segments,
      segments
    );
    geometry.rotateX(-Math.PI / 2);
    ensureUv1(geometry);

    // 用顶点颜色叠一层很轻的干土/碎石明暗变化，避免整块地面均匀发亮。
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      const wave =
        Math.sin(x * 0.34) * 0.06 +
        Math.cos(z * 0.29) * 0.06 +
        Math.sin((x - z) * 0.72) * 0.035;
      const shade = 0.88 + wave;
      colors[index * 3] = shade * 1.02;
      colors[index * 3 + 1] = shade;
      colors[index * 3 + 2] = shade * 0.94;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));

    materialSet.ground.vertexColors = true;
    materialSet.ground.normalScale.set(0.9, 0.9);
    materialSet.ground.needsUpdate = true;

    const mesh = new Mesh(geometry, materialSet.ground);
    mesh.position.y = 0;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    root.add(tagMesh(mesh, 'ground', 'ground'));
  }

  /**
   * @param {Record<string, unknown>} container
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildContainer(container, materialSet) {
    const tint = readStringField(container, 'tint');
    let material = materialSet.steelOlive;
    if (tint === 'khaki') {
      material = materialSet.steelKhaki;
    } else if (tint === 'rust') {
      material = materialSet.steelRust;
    }
    addBoxEntry(container, material, 'container');

    // 顶部与底部的锈色边框只做很小的强调，不扩大碰撞体。
    const width = readNumberField(container, 'width');
    const depth = readNumberField(container, 'depth');
    const height = readNumberField(container, 'height');
    const x = readNumberField(container, 'x');
    const z = readNumberField(container, 'z');
    const rotationY = readNumberField(container, 'rotationY');
    const geometry = new BoxGeometry(width + 0.04, 0.07, depth + 0.04);
    ensureUv1(geometry);
    const rim = new Mesh(geometry, materialSet.metalRust);
    rim.position.set(x, height - 0.06, z);
    rim.rotation.y = rotationY;
    rim.castShadow = false;
    rim.receiveShadow = true;
    root.add(tagMesh(rim, 'container-trim', readStringField(container, 'id') + '-rim'));
  }

  /**
   * @param {Record<string, unknown>} barrelEntry
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildBarrel(barrelEntry, materialSet) {
    const radius = readNumberField(barrelEntry, 'radius');
    const height = readNumberField(barrelEntry, 'height');
    const tint = readStringField(barrelEntry, 'tint');
    let material = materialSet.metal;
    if (tint === 'rust') {
      material = materialSet.metalRust;
    }
    const geometry = new CylinderGeometry(radius, radius * 0.98, height, 14, 1, false);
    ensureUv1(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(
      readNumberField(barrelEntry, 'x'),
      height / 2,
      readNumberField(barrelEntry, 'z')
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(tagMesh(mesh, 'barrel', readStringField(barrelEntry, 'id')));
  }

  /**
   * 把一面沙袋墙拆成三排交错的小袋。整面墙共用布局里的一个 AABB。
   *
   * @param {Record<string, unknown>} wall
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildSandbagWall(wall, materialSet) {
    const group = new Group();
    group.position.set(readNumberField(wall, 'x'), 0, readNumberField(wall, 'z'));
    group.rotation.y = readNumberField(wall, 'rotationY');

    const wallWidth = readNumberField(wall, 'width');
    const wallHeight = readNumberField(wall, 'height');
    const wallDepth = readNumberField(wall, 'depth');
    const bagWidth = 0.86;
    const bagHeight = 0.34;
    const bagDepth = wallDepth;
    const rows = Math.max(1, Math.round(wallHeight / bagHeight));
    const perRow = Math.max(1, Math.round(wallWidth / bagWidth));

    for (let row = 0; row < rows; row += 1) {
      let offset = 0;
      if (row % 2 === 1) {
        offset = bagWidth * 0.5;
      }
      for (let column = 0; column < perRow; column += 1) {
        const localX =
          -wallWidth / 2 + bagWidth / 2 + column * bagWidth + offset;
        if (localX > wallWidth / 2 - bagWidth * 0.3) {
          continue;
        }
        const geometry = new BoxGeometry(bagWidth * 0.97, bagHeight * 0.92, bagDepth);
        ensureUv1(geometry);
        const bag = new Mesh(geometry, materialSet.fabric);
        const sag = Math.sin((row * 7 + column) * 1.3) * 0.018;
        bag.position.set(
          localX,
          bagHeight / 2 + row * bagHeight,
          sag
        );
        bag.castShadow = true;
        bag.receiveShadow = true;
        group.add(bag);
      }
    }

    root.add(group);
  }

  /**
   * @param {Record<string, unknown>} tower
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildTower(tower, materialSet) {
    const width = readNumberField(tower, 'width');
    const depth = readNumberField(tower, 'depth');
    const deckHeight = readNumberField(tower, 'deckHeight');
    const totalHeight = readNumberField(tower, 'height');

    const group = new Group();
    group.position.set(readNumberField(tower, 'x'), 0, readNumberField(tower, 'z'));

    const halfWidth = width / 2 - 0.22;
    const halfDepth = depth / 2 - 0.22;
    const legSize = 0.17;
    const corners = [
      { x: -halfWidth, z: -halfDepth },
      { x: halfWidth, z: -halfDepth },
      { x: -halfWidth, z: halfDepth },
      { x: halfWidth, z: halfDepth }
    ];
    for (const corner of corners) {
      const leg = buildLooseBox(
        materialSet.metal,
        legSize,
        deckHeight,
        legSize,
        { x: corner.x, y: deckHeight / 2, z: corner.z }
      );
      group.add(leg);
    }

    const braceHeights = [1.15, 2.3];
    for (const braceHeight of braceHeights) {
      const braceX = buildLooseBox(
        materialSet.metal,
        width - 0.3,
        0.08,
        0.08,
        { x: 0, y: braceHeight, z: -halfDepth }
      );
      group.add(braceX);
      const braceX2 = buildLooseBox(
        materialSet.metal,
        width - 0.3,
        0.08,
        0.08,
        { x: 0, y: braceHeight, z: halfDepth }
      );
      group.add(braceX2);
      const braceZ = buildLooseBox(
        materialSet.metal,
        0.08,
        0.08,
        depth - 0.3,
        { x: -halfWidth, y: braceHeight, z: 0 }
      );
      group.add(braceZ);
      const braceZ2 = buildLooseBox(
        materialSet.metal,
        0.08,
        0.08,
        depth - 0.3,
        { x: halfWidth, y: braceHeight, z: 0 }
      );
      group.add(braceZ2);
    }

    const deck = buildLooseBox(
      materialSet.wood,
      width + 0.45,
      0.18,
      depth + 0.45,
      { x: 0, y: deckHeight, z: 0 }
    );
    group.add(deck);

    const roofHeight = totalHeight - 0.12;
    const roof = buildLooseBox(
      materialSet.steelKhaki,
      width + 0.75,
      0.12,
      depth + 0.75,
      { x: 0, y: roofHeight, z: 0 }
    );
    group.add(roof);

    const roofPostHeight = roofHeight - deckHeight;
    const roofPostY = deckHeight + roofPostHeight / 2;
    for (const corner of corners) {
      const post = buildLooseBox(
        materialSet.metal,
        0.09,
        roofPostHeight,
        0.09,
        { x: corner.x, y: roofPostY, z: corner.z }
      );
      group.add(post);
    }

    const railY = deckHeight + 0.52;
    const rails = [
      buildLooseBox(materialSet.wood, width, 0.07, 0.07, {
        x: 0,
        y: railY,
        z: -depth / 2 + 0.08
      }),
      buildLooseBox(materialSet.wood, width, 0.07, 0.07, {
        x: 0,
        y: railY,
        z: depth / 2 - 0.08
      }),
      buildLooseBox(materialSet.wood, 0.07, 0.07, depth, {
        x: -width / 2 + 0.08,
        y: railY,
        z: 0
      }),
      buildLooseBox(materialSet.wood, 0.07, 0.07, depth, {
        x: width / 2 - 0.08,
        y: railY,
        z: 0
      })
    ];
    for (const rail of rails) {
      group.add(rail);
    }

    // 简易爬梯：六根横档贴在正面。
    for (let rung = 0; rung < 6; rung += 1) {
      const rungMesh = buildLooseBox(
        materialSet.metal,
        0.55,
        0.05,
        0.05,
        { x: 0, y: 0.55 + rung * 0.5, z: depth / 2 + 0.06 }
      );
      group.add(rungMesh);
    }

    root.add(group);
  }

  /**
   * @param {Record<string, unknown>} fence
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildFenceSegment(fence, materialSet) {
    const length = readNumberField(fence, 'width');
    const height = readNumberField(fence, 'height');
    const group = new Group();
    group.position.set(readNumberField(fence, 'x'), 0, readNumberField(fence, 'z'));
    group.rotation.y = readNumberField(fence, 'rotationY');

    const postCount = Math.max(2, Math.round(length / 4) + 1);
    for (let index = 0; index < postCount; index += 1) {
      const ratio = index / (postCount - 1);
      const postX = -length / 2 + ratio * length;
      const post = buildLooseBox(
        materialSet.metal,
        0.09,
        height,
        0.09,
        { x: postX, y: height / 2, z: 0 }
      );
      group.add(post);
    }

    const railHeights = [0.55, 1.05, 1.55];
    for (const railHeight of railHeights) {
      const rail = buildLooseBox(
        materialSet.metal,
        length,
        0.035,
        0.035,
        { x: 0, y: railHeight, z: 0 }
      );
      group.add(rail);
    }

    root.add(group);
  }

  /**
   * @param {Record<string, unknown>} piece
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildDebris(piece, materialSet) {
    const shape = readStringField(piece, 'shape');
    const width = readNumberField(piece, 'width');
    const height = readNumberField(piece, 'height');
    const depth = readNumberField(piece, 'depth');
    const x = readNumberField(piece, 'x');
    const z = readNumberField(piece, 'z');
    const rotationY = readNumberField(piece, 'rotationY');

    if (shape === 'rock') {
      const radius = 0.5;
      const geometry = new SphereGeometry(radius, 6, 4);
      ensureUv1(geometry);
      const mesh = new Mesh(geometry, materialSet.rock);
      mesh.position.set(x, height / 2, z);
      mesh.rotation.y = rotationY;
      mesh.scale.set(width / (radius * 2), height / (radius * 2), depth / (radius * 2));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(tagMesh(mesh, 'debris-rock', readStringField(piece, 'id')));
      return;
    }

    const geometry = new BoxGeometry(width, height, depth);
    ensureUv1(geometry);
    const mesh = new Mesh(geometry, materialSet.wood);
    mesh.position.set(x, height / 2, z);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(tagMesh(mesh, 'debris-' + shape, readStringField(piece, 'id')));
  }

  /**
   * 创建 32 × 32 的柔和圆点贴图给尘土粒子。
   *
   * @returns {unknown}
   */
  function createDustTexture() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      console.error('[arena] 当前环境没有 document，尘土粒子使用无贴图圆点');
      return null;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d');
      if (context === null) {
        console.error('[arena] 无法获得 2D 画布上下文，尘土粒子使用无贴图圆点');
        return null;
      }
      const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 15);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 32, 32);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      ownedTextures.add(texture);
      return texture;
    } catch (error) {
      console.error('[arena] 创建尘土贴图失败，粒子使用无贴图圆点', error);
      return null;
    }
  }

  /**
   * 创建低成本的漂浮尘土。位置在 `update(dt)` 中缓慢漂移并循环。
   *
   * @returns {void}
   */
  function buildDust() {
    const dustCount = readDustCount(renderer);
    const positions = new Float32Array(dustCount * 3);
    const velocities = new Float32Array(dustCount * 3);
    for (let index = 0; index < dustCount; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 58;
      positions[index * 3 + 1] = 0.35 + Math.random() * 7;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 58;
      velocities[index * 3] = (Math.random() - 0.5) * 0.28;
      velocities[index * 3 + 1] = (Math.random() - 0.5) * 0.06;
      velocities[index * 3 + 2] = (Math.random() - 0.5) * 0.28;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const map = createDustTexture();
    /** @type {Record<string, unknown>} */
    const parameters = {
      color: TINTS.dust,
      size: 0.09,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      sizeAttenuation: true
    };
    if (map !== null) {
      parameters.map = map;
    }
    const material = new PointsMaterial(
      /** @type {import('three').PointsMaterialParameters} */ (parameters)
    );
    materials.add(material);
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    root.add(points);
    dust = {
      points,
      geometry,
      attributes: geometry.getAttribute('position'),
      positions,
      velocities,
      count: dustCount
    };
  }

  /**
   * 用 decals 系统铺一层地面污渍。污渍不产生碰撞，也不阻挡出生点。
   *
   * @returns {void}
   */
  function seedDecals() {
    if (decals === null) {
      return;
    }
    const propLayout = layout.props;
    if (!isObject(propLayout)) {
      return;
    }
    const stains = /** @type {Record<string, unknown>} */ (propLayout).stains;
    if (!Array.isArray(stains)) {
      return;
    }
    for (const stain of stains) {
      const radius = readNumberField(stain, 'radius');
      let scale = radius * 1.1;
      if (scale < 0.6) {
        scale = 0.6;
      }
      decals.addStain(
        { x: readNumberField(stain, 'x'), y: 0.01, z: readNumberField(stain, 'z') },
        { x: 0, y: 1, z: 0 },
        scale
      );
    }
  }

  /**
   * 出生点视野自检：正常情况下只检查出生点眼睛高度 2 米内是否有环境网格，
   * 有则输出错误。URL 带 `envDebug=1` 时额外输出 10 米内候选物、巨型物体与
   * 网格数量，供跨角色排查使用。
   *
   * 注意：本检查只覆盖加载期已有的环境几何体，不覆盖之后生成的敌人/拾取物。
   *
   * @returns {Array<Record<string, unknown>>}
   */
  function checkSpawnClearance() {
    const spawn = getPlayerSpawn(layout);
    const eye = new Vector3(
      spawn.x,
      spawn.y + GAME_CONFIG.player.eyeHeight,
      spawn.z
    );
    const debugMode =
      typeof window !== 'undefined' &&
      typeof window.location !== 'undefined' &&
      typeof window.location.search === 'string' &&
      window.location.search.includes('envDebug=1');
    const bounds = new Box3();
    const instanceBounds = new Box3();
    const instanceMatrix = new Matrix4();
    const size = new Vector3();
    const obstructions = [];
    const candidates = [];
    const hugeObjects = [];
    let meshCount = 0;
    if (root === null) {
      return obstructions;
    }
    root.updateMatrixWorld(true);

    /**
     * @param {Box3} box
     * @param {Record<string, unknown>} node
     * @param {string} label
     * @returns {void}
     */
    function record(box, node, label) {
      if (box.isEmpty()) {
        return;
      }
      meshCount += 1;
      box.getSize(size);
      const footprint = size.x * size.z;
      const worldPosition = node.getWorldPosition(new Vector3());
      const closestX = Math.min(Math.max(eye.x, box.min.x), box.max.x);
      const closestZ = Math.min(Math.max(eye.z, box.min.z), box.max.z);
      const horizontalDistance = Math.hypot(eye.x - closestX, eye.z - closestZ);
      const verticalOverlap =
        box.max.y >= eye.y - 0.4 && box.min.y <= eye.y + 0.4;
      let arenaKind = undefined;
      let entryId = undefined;
      if (node.userData) {
        arenaKind = node.userData.arena;
        entryId = node.userData.id;
      }
      let parentName = '';
      if (node.parent) {
        parentName = node.parent.name;
      }
      const information = {
        label,
        type: node.type,
        name: node.name,
        arena: arenaKind,
        id: entryId,
        parentName,
        position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
        size: { x: size.x, y: size.y, z: size.z },
        footprint,
        horizontalDistance,
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z }
      };
      if (horizontalDistance < 2 && verticalOverlap) {
        obstructions.push(information);
      }
      if (debugMode && horizontalDistance < 10 && verticalOverlap) {
        candidates.push(information);
      }
      if (debugMode && footprint > 50) {
        hugeObjects.push(information);
      }
    }

    root.traverse((node) => {
      if (node.isMesh !== true) {
        return;
      }
      if (node.userData.arena === 'ground') {
        return;
      }
      const nodeRecord = /** @type {Record<string, unknown>} */ (node);
      if (node.isInstancedMesh === true) {
        if (node.geometry === undefined || node.geometry === null) {
          return;
        }
        if (node.geometry.boundingBox === null) {
          node.geometry.computeBoundingBox();
        }
        const geometryBox = node.geometry.boundingBox;
        if (geometryBox === null) {
          return;
        }
        for (let index = 0; index < node.count; index += 1) {
          node.getMatrixAt(index, instanceMatrix);
          instanceBounds
            .copy(geometryBox)
            .applyMatrix4(instanceMatrix)
            .applyMatrix4(node.matrixWorld);
          record(instanceBounds, nodeRecord, node.name + '#' + index);
        }
        return;
      }
      bounds.setFromObject(node);
      record(bounds, nodeRecord, node.name);
    });

    if (obstructions.length > 0) {
      console.error(
        '[arena] 出生点 2 米内出现与环境眼睛高度重叠的网格',
        obstructions
      );
    }
    if (debugMode) {
      console.warn(
        '[arena][spawn-audit] 出生点 10 米内与眼睛高度重叠的场景物体',
        candidates
      );
      console.warn(
        '[arena][spawn-audit] 足迹大于 50 平方米的物体',
        hugeObjects
      );
      console.warn('[arena][spawn-audit] 检查的网格/实例数量', meshCount);
      if (typeof window !== 'undefined') {
        window.__DUSTLINE_SPAWN_AUDIT__ = {
          candidates,
          hugeObjects,
          meshCount
        };
      }
    }
    return obstructions;
  }

  /**
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @returns {void}
   */
  function buildSceneObjects(materialSet) {
    buildGround(materialSet);

    for (const bunker of layout.bunkers) {
      addBoxEntry(bunker, materialSet.concrete, 'bunker');
    }
    for (const wall of layout.walls) {
      addBoxEntry(wall, materialSet.concrete, 'wall');
    }
    for (const container of layout.containers) {
      buildContainer(container, materialSet);
    }
    for (const crate of layout.crates) {
      addBoxEntry(crate, materialSet.wood, 'crate');
    }
    for (const barrelEntry of layout.barrels) {
      buildBarrel(barrelEntry, materialSet);
    }
    for (const wall of layout.sandbags) {
      buildSandbagWall(wall, materialSet);
    }
    buildTower(layout.tower, materialSet);
    for (const fence of layout.fences) {
      buildFenceSegment(fence, materialSet);
    }
    for (const piece of layout.debris) {
      buildDebris(piece, materialSet);
    }
    props = createProps({ layout, materials: materialSet });
    root.add(props.group);
    decals = createDecals({ renderer });
    seedDecals();
    buildDust();
  }

  /**
   * 灯光：低角度晨昏阳光 + 半球补光。太阳仰角约 25°，阴影拉长；
   * 低画质把阴影贴图从 2048 降到 1024，保留基础阴影与可辨认轮廓。
   *
   * @returns {void}
   */
  function buildLights() {
    const hemisphere = new HemisphereLight(0xdfe8ee, 0x5a5548, 0.55);
    hemisphere.position.set(0, 24, 0);
    root.add(hemisphere);

    // 仰角约 25°、方位约 35°：x/z 分量长，y 分量短，形成明显的长阴影。
    const sun = new DirectionalLight(0xffe7c9, 1.55);
    sun.position.set(30, 17, 21);
    sun.castShadow = true;
    let shadowSize = 2048;
    if (readRendererQuality(renderer) === 'low') {
      shadowSize = 1024;
    }
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -36;
    sun.shadow.camera.right = 36;
    sun.shadow.camera.top = 36;
    sun.shadow.camera.bottom = -36;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    // 低角度长阴影保留方向感，但不把阴影面压成纯黑。
    sun.shadow.intensity = 0.82;
    sun.target.position.set(0, 0, 0);
    root.add(sun);
    root.add(sun.target);
  }

  /**
   * @param {unknown} hdriTexture
   * @returns {void}
   */
  function applyEnvironment(hdriTexture) {
    if (hdriTexture !== null && hdriTexture !== undefined) {
      renderer.setEnvironment({
        hdriTexture,
        backgroundTexture: hdriTexture,
        // v3：让多云的 HDRI 天空更清楚一点（模糊 0.22、亮度 0.8），
        // 同时压低环境强度，保持晨昏军事基调而不是正午晴天。
        backgroundIntensity: 0.8,
        backgroundBlurriness: 0.22,
        fogColor: FOG_COLOR,
        fogNear: FOG_NEAR,
        fogFar: FOG_FAR,
        intensity: ENVIRONMENT_INTENSITY
      });
      return;
    }
    renderer.setEnvironment({
      skyColor: FOG_COLOR,
      fogColor: FOG_COLOR,
      fogNear: FOG_NEAR,
      fogFar: FOG_FAR
    });
  }

  /**
   * 释放根节点下的几何体和本 Service 创建的材质。素材加载器的贴图不在这里释放。
   *
   * @returns {void}
   */
  function disposeSceneObjects() {
    if (props !== null) {
      props.dispose();
      props = null;
    }
    if (decals !== null) {
      decals.dispose();
      decals = null;
    }
    if (root !== null) {
      renderer.remove(root);
      root.traverse((node) => {
        const meshNode = /** @type {Record<string, unknown>} */ (node);
        const geometry = meshNode.geometry;
        if (geometry !== null && geometry !== undefined) {
          const geometryValue = /** @type {{dispose?: () => void}} */ (geometry);
          if (typeof geometryValue.dispose === 'function') {
            geometryValue.dispose();
          }
        }
      });
      root = null;
    }
    dust = null;
    for (const material of materials) {
      material.dispose();
    }
    materials.clear();
    for (const texture of ownedTextures) {
      const textureValue = /** @type {{dispose?: () => void}} */ (texture);
      if (typeof textureValue.dispose === 'function') {
        textureValue.dispose();
      }
    }
    ownedTextures.clear();
  }

  /**
   * @param {Record<string, unknown>|null} manifest
   * @param {Record<string, MeshStandardMaterial>} materialSet
   * @param {unknown} hdriTexture
   * @returns {void}
   */
  function buildScene(manifest, materialSet, hdriTexture) {
    root = new Group();
    root.name = 'dustline-arena';
    buildLights();
    buildSceneObjects(materialSet);
    checkSpawnClearance();
    renderer.add(root);
    applyEnvironment(hdriTexture);

    // manifest 参数保留在签名里，便于以后按清单扩展模型或装饰；当前几何全部程序化。
    if (manifest === null) {
      console.warn('[arena] 没有可用的素材清单：场景使用程序化材质与颜色天空。');
    }
  }

  /**
   * @returns {Promise<{colliders: Array<Record<string, unknown>>, playerSpawn: {x: number, y: number, z: number}, fallbacks: Array<Record<string, unknown>>}>}
   */
  async function performLoad() {
    fallbacks.length = 0;
    fallbackKeys.clear();
    let manifest = null;
    try {
      manifest = await assets.loadManifest();
    } catch (error) {
      console.error('[arena] 素材清单加载失败，全部材质使用程序化回退', error);
      recordFallback({
        asset: 'manifest',
        reason: describeError(error)
      });
      manifest = null;
    }

    if (disposed) {
      disposeSceneObjects();
      throw new Error('arena 已释放，加载中止');
    }

    let materialSet = null;
    try {
      materialSet = await createMaterials(manifest);
    } catch (error) {
      console.error('[arena] 创建材质失败，已清理部分对象', error);
      disposeSceneObjects();
      throw error;
    }

    if (disposed) {
      disposeSceneObjects();
      throw new Error('arena 已释放，加载中止');
    }

    let hdriTexture = null;
    if (manifest !== null && isObject(manifest.hdri)) {
      const sky = /** @type {Record<string, unknown>} */ (manifest.hdri).sky;
      if (typeof sky === 'string' && sky.length > 0) {
        try {
          hdriTexture = await assets.loadHdr(sky);
        } catch (error) {
          console.error('[arena] HDR 加载失败，使用灰蓝天空与雾回退: ' + sky, error);
          recordFallback({
            asset: 'hdri.sky',
            url: sky,
            reason: describeError(error)
          });
          hdriTexture = null;
        }
      } else {
        console.error('[arena] 素材清单缺少 hdri.sky，使用灰蓝天空与雾回退');
        recordFallback({ asset: 'hdri.sky', reason: '清单缺少 hdri.sky' });
      }
    } else if (manifest !== null) {
      console.error('[arena] 素材清单缺少 hdri 字段，使用灰蓝天空与雾回退');
      recordFallback({ asset: 'hdri.sky', reason: '清单缺少 hdri 字段' });
    }

    if (disposed) {
      disposeSceneObjects();
      throw new Error('arena 已释放，加载中止');
    }

    try {
      buildScene(manifest, materialSet, hdriTexture);
    } catch (error) {
      console.error('[arena] 搭建场景失败，已清理部分对象', error);
      disposeSceneObjects();
      throw error;
    }

    loaded = true;
    return {
      colliders: copyColliders(),
      playerSpawn: getPlayerSpawn(layout),
      fallbacks: fallbacks.slice()
    };
  }

  /**
   * @returns {Array<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>}
   */
  function copyColliders() {
    const copy = [];
    for (const collider of colliders) {
      copy.push({
        min: { x: collider.min.x, y: collider.min.y, z: collider.min.z },
        max: { x: collider.max.x, y: collider.max.y, z: collider.max.z }
      });
    }
    return copy;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateDust(dt) {
    if (dust === null) {
      return;
    }
    const positions = dust.positions;
    const velocities = dust.velocities;
    const count = dust.count;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      positions[offset] = positions[offset] + velocities[offset] * dt;
      positions[offset + 1] = positions[offset + 1] + velocities[offset + 1] * dt;
      positions[offset + 2] = positions[offset + 2] + velocities[offset + 2] * dt;

      if (positions[offset] > 29) {
        positions[offset] = -29;
      } else if (positions[offset] < -29) {
        positions[offset] = 29;
      }
      if (positions[offset + 2] > 29) {
        positions[offset + 2] = -29;
      } else if (positions[offset + 2] < -29) {
        positions[offset + 2] = 29;
      }
      if (positions[offset + 1] > 7.6) {
        positions[offset + 1] = 0.3;
      } else if (positions[offset + 1] < 0.15) {
        positions[offset + 1] = 0.15;
      }
    }
    dust.attributes.needsUpdate = true;
  }

  return {
    /**
     * 加载素材并搭建场景。并发调用返回同一个 Promise；成功后重复调用返回同一结果。
     * 失败时会清理已经创建的对象，并允许稍后重试。
     *
     * @returns {Promise<{colliders: Array<Record<string, unknown>>, playerSpawn: {x: number, y: number, z: number}, fallbacks: Array<Record<string, unknown>>}>}
     */
    load() {
      if (disposed) {
        throw new Error('arena 已释放，不能再次加载');
      }
      if (loadPromise !== null) {
        return loadPromise;
      }
      const promise = performLoad();
      loadPromise = promise;
      promise.then(null, () => {
        if (loadPromise === promise) {
          loadPromise = null;
        }
      });
      return promise;
    },

    /**
     * 返回所有阻挡移动的 AABB 副本。加载前后都可调用。
     *
     * @returns {Array<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>}
     */
    getColliders() {
      return copyColliders();
    },

    /**
     * 返回弹孔/血迹/灼痕/污渍贴片系统；`load()` 完成前返回 null。
     * 效果服务通过它留下世界弹孔与血渍，不需要自己管理贴片池。
     *
     * @returns {ReturnType<typeof createDecals>|null}
     */
    getDecals() {
      return decals;
    },

    /**
     * 在 22–28 米环带内寻找合法出生点。
     *
     * @param {{playerPosition?: {x: number, y: number, z: number}, minDistance?: number}} [request]
     * @returns {{x: number, y: number, z: number}}
     */
    getSpawnPoint(request) {
      if (disposed) {
        throw new Error('arena 已释放，不能查询出生点');
      }
      let playerPosition = { x: 0, y: 0, z: 0 };
      let minDistance = GAME_CONFIG.arena.minPlayerDistance;
      if (request !== undefined) {
        if (!isObject(request)) {
          throw new TypeError('getSpawnPoint 需要 { playerPosition, minDistance } 对象');
        }
        const source = /** @type {Record<string, unknown>} */ (request);
        if (source.playerPosition !== undefined) {
          playerPosition = readPoint(source.playerPosition, 'getSpawnPoint 的 playerPosition');
        }
        if (source.minDistance !== undefined) {
          if (!isFiniteNumber(source.minDistance) || source.minDistance < 0) {
            throw new RangeError('getSpawnPoint 的 minDistance 必须是大于等于 0 的有限数字');
          }
          minDistance = source.minDistance;
        }
      }
      return findSpawnPoint({
        playerPosition,
        minDistance,
        colliders
      });
    },

    /**
     * 返回玩家安全出生点（竞技场中心）。
     *
     * @returns {{x: number, y: number, z: number}}
     */
    getPlayerSpawn() {
      if (disposed) {
        throw new Error('arena 已释放，不能查询玩家出生点');
      }
      return getPlayerSpawn(layout);
    },

    /**
     * 推进尘土漂移动画。未加载时是安全空操作。
     *
     * @param {number} dt
     * @returns {void}
     */
    update(dt) {
      if (disposed) {
        throw new Error('arena 已释放，不能继续更新');
      }
      if (!isFiniteNumber(dt) || dt < 0) {
        throw new RangeError('arena.update 的 dt 必须是大于等于 0 的有限数字');
      }
      if (!loaded) {
        return;
      }
      let step = dt;
      if (step > 0.1) {
        step = 0.1;
      }
      updateDust(step);
      if (props !== null) {
        props.update(step);
      }
      if (decals !== null) {
        decals.update(step);
      }
    },

    /**
     * 移除所有场景对象、释放几何体与本 Service 创建的材质/贴图。
     * 素材加载器拥有的贴图与 HDR 不在这里释放。
     *
     * @returns {void}
     */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeSceneObjects();
      loaded = false;
    }
  };
}
