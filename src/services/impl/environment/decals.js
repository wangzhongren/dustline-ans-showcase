/**
 * 弹孔、血迹、灼痕与地面污渍贴片系统。
 *
 * 每种贴片有固定上限；池满时复用最老的条目，避免长时间射击无限增加绘制对象。
 * 贴片使用小平面 + 程序化 CanvasTexture，沿表面法线偏移并启用 polygonOffset，
 * 防止与墙面/地面产生 z-fighting。没有 `document`（Node 测试）时退化为纯色平面，
 * 只输出一次警告，不抛错。
 *
 * 依赖边界：只导入 Provider 公共入口与共享 Model；不导入其他 Service 或 Provider impl。
 */

import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3
} from '../../../providers/public/three.js';

/** 每类贴片的池上限。 */
export const DECAL_LIMITS = Object.freeze({
  bulletHole: 48,
  blood: 24,
  scorch: 12,
  stain: 24
});

/** 贴片存活时间（秒）；0 表示一直保留到被复用。 */
export const DECAL_LIFETIMES = Object.freeze({
  bulletHole: 0,
  blood: 16,
  scorch: 26,
  stain: 34
});

const PLANE_NORMAL = new Vector3(0, 0, 1);
const DEFAULT_BLOOD_COLOR = 0x6e1414;
const BULLET_COLOR = 0x1b1713;
const SCORCH_COLOR = 0x1f1b17;
const STAIN_COLOR = 0x2a2620;

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
 * @param {unknown} value
 * @param {string} label
 * @returns {{x: number, y: number, z: number}}
 */
function readVector(value, label) {
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
 * @param {unknown} value
 * @returns {number}
 */
function readColor(value) {
  if (value === undefined || value === null) {
    return DEFAULT_BLOOD_COLOR;
  }
  if (!isFiniteNumber(value) || value < 0 || value > 0xffffff) {
    throw new RangeError('blood 的 color 必须是 0x000000 到 0xFFFFFF 的有限数字');
  }
  return Math.floor(value);
}

/**
 * 计算贴片淡出透明度：在 fadeStart 之前保持满不透明，之后线性降到 0。
 *
 * @param {number} age
 * @param {number} life 0 表示永久保留。
 * @param {number} fadeStart 0–1，开始淡出时占寿命的比例。
 * @returns {number}
 */
export function computeDecalOpacity(age, life, fadeStart) {
  if (!isFiniteNumber(age) || age < 0) {
    throw new RangeError('computeDecalOpacity 的 age 必须是大于等于 0 的有限数字');
  }
  if (!isFiniteNumber(life) || life < 0) {
    throw new RangeError('computeDecalOpacity 的 life 必须是大于等于 0 的有限数字');
  }
  if (!isFiniteNumber(fadeStart) || fadeStart < 0 || fadeStart > 1) {
    throw new RangeError('computeDecalOpacity 的 fadeStart 必须在 0 到 1 之间');
  }
  if (life === 0) {
    return 1;
  }
  if (age >= life) {
    return 0;
  }
  const hold = life * fadeStart;
  if (age <= hold) {
    return 1;
  }
  return 1 - (age - hold) / (life - hold);
}

/**
 * 选择可复用的贴片条目：优先未激活，否则复用年龄最大的。
 *
 * @param {ReadonlyArray<{active: boolean, age: number}>} entries
 * @returns {number}
 */
export function pickDecalIndex(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return -1;
  }
  let oldestIndex = 0;
  let oldestAge = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.active !== true) {
      return index;
    }
    if (entry.age > oldestAge) {
      oldestAge = entry.age;
      oldestIndex = index;
    }
  }
  return oldestIndex;
}

/**
 * @param {number} seed
 * @returns {() => number}
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} context
 * @param {'bulletHole'|'blood'|'scorch'|'stain'} kind
 * @returns {void}
 */
function paintDecal(canvas, context, kind) {
  const size = canvas.width;
  const half = size / 2;
  context.clearRect(0, 0, size, size);

  if (kind === 'bulletHole') {
    const gradient = context.createRadialGradient(half, half, 1, half, half, half * 0.9);
    gradient.addColorStop(0, 'rgba(8,7,6,0.98)');
    gradient.addColorStop(0.35, 'rgba(20,17,14,0.9)');
    gradient.addColorStop(0.6, 'rgba(45,38,30,0.55)');
    gradient.addColorStop(1, 'rgba(45,38,30,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const random = createRandom(0x51ed270b);
    context.strokeStyle = 'rgba(30,25,20,0.55)';
    context.lineWidth = 1.2;
    for (let crack = 0; crack < 7; crack += 1) {
      const angle = random() * Math.PI * 2;
      const start = half * 0.35;
      const end = half * (0.55 + random() * 0.4);
      context.beginPath();
      context.moveTo(half + Math.cos(angle) * start, half + Math.sin(angle) * start);
      context.lineTo(half + Math.cos(angle) * end, half + Math.sin(angle) * end);
      context.stroke();
    }
    return;
  }

  if (kind === 'blood') {
    const random = createRandom(0x9e3779b9);
    for (let blot = 0; blot < 26; blot += 1) {
      const angle = random() * Math.PI * 2;
      const distance = random() * half * 0.65;
      const radius = half * (0.08 + random() * 0.24);
      const alpha = 0.35 + random() * 0.5;
      context.fillStyle = 'rgba(96,14,14,' + alpha.toFixed(3) + ')';
      context.beginPath();
      context.ellipse(
        half + Math.cos(angle) * distance,
        half + Math.sin(angle) * distance,
        radius,
        radius * (0.55 + random() * 0.7),
        random() * Math.PI,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    return;
  }

  if (kind === 'scorch') {
    const gradient = context.createRadialGradient(half, half, 2, half, half, half * 0.95);
    gradient.addColorStop(0, 'rgba(10,9,8,0.92)');
    gradient.addColorStop(0.45, 'rgba(26,23,20,0.7)');
    gradient.addColorStop(0.75, 'rgba(40,36,31,0.3)');
    gradient.addColorStop(1, 'rgba(40,36,31,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const random = createRandom(0x85ebca6b);
    context.strokeStyle = 'rgba(18,16,14,0.4)';
    for (let streak = 0; streak < 18; streak += 1) {
      const angle = random() * Math.PI * 2;
      const start = half * 0.2;
      const end = half * (0.6 + random() * 0.38);
      context.lineWidth = 1 + random() * 3;
      context.beginPath();
      context.moveTo(half + Math.cos(angle) * start, half + Math.sin(angle) * start);
      context.lineTo(half + Math.cos(angle) * end, half + Math.sin(angle) * end);
      context.stroke();
    }
    return;
  }

  const random = createRandom(0xc2b2ae35);
  for (let blot = 0; blot < 16; blot += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * half * 0.55;
    const radius = half * (0.14 + random() * 0.3);
    context.fillStyle = 'rgba(38,34,28,' + (0.18 + random() * 0.28).toFixed(3) + ')';
    context.beginPath();
    context.ellipse(
      half + Math.cos(angle) * distance,
      half + Math.sin(angle) * distance,
      radius,
      radius * (0.5 + random() * 0.8),
      random() * Math.PI,
      0,
      0,
      Math.PI * 2
    );
    context.fill();
  }
}

/**
 * 创建贴片纹理。没有 DOM 时返回 null，并只警告一次。
 *
 * @param {'bulletHole'|'blood'|'scorch'|'stain'} kind
 * @param {number} size
 * @param {{warned: boolean}} state
 * @returns {CanvasTexture|null}
 */
function createDecalTexture(kind, size, state) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    if (!state.warned) {
      state.warned = true;
      console.warn('[decals] 当前环境没有 document，贴片使用纯色平面（不影响碰撞与生命周期）');
    }
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null) {
      if (!state.warned) {
        state.warned = true;
        console.error('[decals] 无法获得 2D 画布上下文，贴片使用纯色平面');
      }
      return null;
    }
    paintDecal(canvas, context, kind);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    console.error('[decals] 创建 ' + kind + ' 贴片纹理失败，使用纯色平面', error);
    return null;
  }
}

/**
 * 创建贴片系统。
 *
 * @param {{renderer: {add: Function, remove: Function}}} options
 * @returns {{
 *   addBulletHole: (position: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}) => void,
 *   addBlood: (position: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}, color?: number) => void,
 *   addScorch: (position: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}) => void,
 *   addStain: (position: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   dispose: () => void,
 *   getCounts: () => Record<string, {active: number, total: number}>,
 *   group: Group
 * }}
 */
export function createDecals(options) {
  if (!isObject(options)) {
    throw new TypeError('createDecals 需要 { renderer }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);
  const renderer = source.renderer;
  if (!isObject(renderer) || typeof renderer.add !== 'function' || typeof renderer.remove !== 'function') {
    throw new TypeError('createDecals 的 renderer 需要 add/remove');
  }

  const textureState = { warned: false };
  const textures = {
    bulletHole: createDecalTexture('bulletHole', 64, textureState),
    blood: createDecalTexture('blood', 64, textureState),
    scorch: createDecalTexture('scorch', 128, textureState),
    stain: createDecalTexture('stain', 96, textureState)
  };

  const group = new Group();
  group.name = 'dustline-decals';
  const sharedGeometry = new PlaneGeometry(1, 1);
  let disposed = false;

  /**
   * @param {string} kind
   * @returns {Array<Record<string, unknown>>}
   */
  function createPool(kind) {
    const limits = /** @type {Record<string, number>} */ (DECAL_LIMITS);
    const count = limits[kind];
    const pool = [];
    const texture = textures[/** @type {'bulletHole'|'blood'|'scorch'|'stain'} */ (kind)];
    for (let index = 0; index < count; index += 1) {
      const parameters = {
        color: STAIN_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      };
      if (texture !== null) {
        parameters.map = texture;
      }
      const material = new MeshBasicMaterial(
        /** @type {import('three').MeshBasicMaterialParameters} */ (parameters)
      );
      const mesh = new Mesh(sharedGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      mesh.userData = { decal: kind };
      group.add(mesh);
      pool.push({
        kind,
        mesh,
        material,
        active: false,
        age: 0,
        life: DECAL_LIFETIMES[/** @type {'bulletHole'|'blood'|'scorch'|'stain'} */ (kind)],
        fadeStart: 0.55,
        baseOpacity: 0.8
      });
    }
    return pool;
  }

  const pools = {
    bulletHole: createPool('bulletHole'),
    blood: createPool('blood'),
    scorch: createPool('scorch'),
    stain: createPool('stain')
  };

  renderer.add(group);

  /**
   * @param {string} kind
   * @param {{x: number, y: number, z: number}} position
   * @param {{x: number, y: number, z: number}} normal
   * @param {number} color
   * @param {number} scale
   * @param {number} opacity
   * @param {number} life
   * @param {number} fadeStart
   * @returns {void}
   */
  function place(kind, position, normal, color, scale, opacity, life, fadeStart) {
    if (disposed) {
      throw new Error('decals 已释放，不能继续添加贴片');
    }
    const point = readVector(position, kind + ' 的 position');
    const normalValue = readVector(normal, kind + ' 的 normal');
    const normalVector = new Vector3(normalValue.x, normalValue.y, normalValue.z);
    if (normalVector.lengthSq() === 0) {
      normalVector.set(0, 1, 0);
    }
    normalVector.normalize();

    const pool = pools[/** @type {'bulletHole'|'blood'|'scorch'|'stain'} */ (kind)];
    const index = pickDecalIndex(pool);
    if (index < 0) {
      throw new Error('decals 池为空，无法添加 ' + kind);
    }
    const entry = pool[index];
    const mesh = /** @type {Mesh} */ (entry.mesh);
    const material = /** @type {MeshBasicMaterial} */ (entry.material);

    const baseQuaternion = new Quaternion().setFromUnitVectors(PLANE_NORMAL, normalVector);
    const roll = (index * 0.7 + point.x * 0.3 + point.z * 0.2) % (Math.PI * 2);
    const rollQuaternion = new Quaternion().setFromAxisAngle(normalVector, roll);
    mesh.quaternion.copy(rollQuaternion).multiply(baseQuaternion);
    mesh.position.set(
      point.x + normalVector.x * 0.012,
      point.y + normalVector.y * 0.012,
      point.z + normalVector.z * 0.012
    );
    mesh.scale.set(scale, scale, 1);
    mesh.visible = true;
    material.color.setHex(color);
    material.opacity = opacity;
    entry.active = true;
    entry.age = 0;
    entry.life = life;
    entry.fadeStart = fadeStart;
    entry.baseOpacity = opacity;
  }

  /**
   * @returns {void}
   */
  function update(dt) {
    if (disposed) {
      throw new Error('decals 已释放，不能继续更新');
    }
    if (!isFiniteNumber(dt) || dt < 0) {
      throw new RangeError('decals.update 的 dt 必须是大于等于 0 的有限数字');
    }
    let step = dt;
    if (step > 0.2) {
      step = 0.2;
    }
    const allPools = [pools.bulletHole, pools.blood, pools.scorch, pools.stain];
    for (const pool of allPools) {
      for (const entry of pool) {
        if (entry.active !== true) {
          continue;
        }
        entry.age = /** @type {number} */ (entry.age) + step;
        const life = /** @type {number} */ (entry.life);
        if (life > 0 && entry.age >= life) {
          entry.active = false;
          entry.age = 0;
          /** @type {Mesh} */ (entry.mesh).visible = false;
          continue;
        }
        const fade = computeDecalOpacity(
          /** @type {number} */ (entry.age),
          life,
          /** @type {number} */ (entry.fadeStart)
        );
        /** @type {MeshBasicMaterial} */ (entry.material).opacity =
          /** @type {number} */ (entry.baseOpacity) * fade;
      }
    }
  }

  return {
    group,

    addBulletHole(position, normal) {
      place('bulletHole', position, normal, BULLET_COLOR, 0.18, 0.95, DECAL_LIFETIMES.bulletHole, 0.2);
    },

    addBlood(position, normal, color) {
      place(
        'blood',
        position,
        normal,
        readColor(color),
        0.55,
        0.85,
        DECAL_LIFETIMES.blood,
        0.55
      );
    },

    addScorch(position, normal) {
      place('scorch', position, normal, SCORCH_COLOR, 0.95, 0.8, DECAL_LIFETIMES.scorch, 0.6);
    },

    addStain(position, normal, scale) {
      let size = 1.25;
      if (scale !== undefined) {
        if (!isFiniteNumber(scale) || scale <= 0) {
          throw new RangeError('addStain 的 scale 必须是大于 0 的有限数字');
        }
        size = scale;
      }
      place('stain', position, normal, STAIN_COLOR, size, 0.45, DECAL_LIFETIMES.stain, 0.5);
    },

    update,

    clear() {
      if (disposed) {
        throw new Error('decals 已释放，不能继续清空');
      }
      const allPools = [pools.bulletHole, pools.blood, pools.scorch, pools.stain];
      for (const pool of allPools) {
        for (const entry of pool) {
          entry.active = false;
          entry.age = 0;
          /** @type {Mesh} */ (entry.mesh).visible = false;
        }
      }
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      renderer.remove(group);
      const allPools = [pools.bulletHole, pools.blood, pools.scorch, pools.stain];
      for (const pool of allPools) {
        for (const entry of pool) {
          /** @type {MeshBasicMaterial} */ (entry.material).dispose();
        }
        pool.length = 0;
      }
      sharedGeometry.dispose();
      const textureValues = [textures.bulletHole, textures.blood, textures.scorch, textures.stain];
      for (const texture of textureValues) {
        if (texture !== null) {
          texture.dispose();
        }
      }
      textures.bulletHole = null;
      textures.blood = null;
      textures.scorch = null;
      textures.stain = null;
      group.clear();
    },

    getCounts() {
      const result = {};
      const kinds = ['bulletHole', 'blood', 'scorch', 'stain'];
      for (const kind of kinds) {
        const pool = pools[/** @type {'bulletHole'|'blood'|'scorch'|'stain'} */ (kind)];
        let active = 0;
        for (const entry of pool) {
          if (entry.active === true) {
            active += 1;
          }
        }
        result[kind] = { active, total: pool.length };
      }
      return result;
    }
  };
}
