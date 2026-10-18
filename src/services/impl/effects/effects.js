/**
 * 视觉反馈 Service 实现：弹道线、命中火花、爆炸、生成闪光、血雾、枪口烟雾、
 * 弹壳、敌人枪口闪光与弹孔/血渍贴片。
 *
 * 所有对象在工厂创建时一次性建好并加入渲染器，之后循环复用，避免射击时反复
 * 创建/销毁几何体和材质。每个池都有上限；池满时复用年龄最大（最接近消失）的条目。
 *
 * 反馈风格遵循写实军事美术方向：弹道与火花是克制的暖白/暖橙色，不使用霓虹色。
 * 人类敌人死亡不使用机械爆炸；血雾与血渍使用深红，不发光。
 *
 * 本文件只导入 Provider 公共入口与 Model，不接触 WebGL 实现细节，也不导入其他 Service。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3
} from '../../../providers/public/three.js';

/** 每类效果的对象池上限。 */
export const EFFECT_POOL_LIMITS = Object.freeze({
  tracer: 24,
  impact: 32,
  explosion: 8,
  spawn: 8,
  blood: 8,
  muzzleSmoke: 8,
  shell: 12,
  flash: 8,
  bulletMark: 24,
  bloodMark: 12
});

/** 各类效果的存活时间（秒）。 */
export const EFFECT_LIFETIMES = Object.freeze({
  tracer: 0.2,
  impact: 0.3,
  explosion: 0.78,
  spawn: 0.55,
  blood: 0.45,
  muzzleSmoke: 0.5,
  shell: 0.9,
  flash: 0.07,
  bulletMark: 30,
  bloodMark: 14
});

/** 暖白色弹道与火花；不是霓虹色。 */
const TRACER_COLOR = 0xffd9a0;
const IMPACT_COLOR = 0xffd0a0;
const EXPLOSION_COLOR = 0xd9a05b;
const EXPLOSION_FLASH_COLOR = 0xffb066;
const SPAWN_COLOR = 0xffd9a0;
const BLOOD_COLOR = 0x7a1717;
const SMOKE_COLOR = 0x8c877c;
const SHELL_COLOR = 0xc9a25a;
const MUZZLE_FLASH_COLOR = 0xffcf8a;
const BULLET_MARK_COLOR = 0x1b1713;
const BLOOD_MARK_COLOR = 0x5d1212;

const IMPACT_SPARK_COUNT = 7;
const EXPLOSION_DEBRIS_COUNT = 24;
const EXPLOSION_GRAVITY = 9;
const BLOOD_PARTICLE_COUNT = 18;
const SMOKE_PARTICLE_COUNT = 10;
const BLOOD_GRAVITY = 5.5;
const SHELL_GRAVITY = 9.8;
const PLANE_NORMAL = new Vector3(0, 0, 1);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * 读取三维向量并返回普通对象副本。
 *
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
 * @param {number} fallback
 * @param {string} label
 * @returns {number}
 */
function readColor(value, fallback, label) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!isFiniteNumber(value) || value < 0 || value > 0xffffff) {
    throw new RangeError(label + ' 必须是 0x000000 到 0xFFFFFF 的有限数字');
  }
  return Math.floor(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function readScale(value) {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!isFiniteNumber(value) || value <= 0) {
    throw new RangeError('explosion 的 scale 必须是大于 0 的有限数字');
  }
  return value;
}

/**
 * 创建可复现的伪随机数发生器。
 *
 * @param {number} seed
 * @returns {() => number}
 */
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 计算淡出透明度：先保持满不透明，再线性降到 0。
 *
 * @param {number} age
 * @param {number} life
 * @param {number} holdFraction 0–1，保持阶段占整个寿命的比例。
 * @returns {number}
 */
export function computeFade(age, life, holdFraction) {
  if (!isFiniteNumber(age) || age < 0) {
    throw new RangeError('computeFade 的 age 必须是大于等于 0 的有限数字');
  }
  if (!isFiniteNumber(life) || life <= 0) {
    throw new RangeError('computeFade 的 life 必须是大于 0 的有限数字');
  }
  if (!isFiniteNumber(holdFraction) || holdFraction < 0 || holdFraction > 1) {
    throw new RangeError('computeFade 的 holdFraction 必须在 0 到 1 之间');
  }
  if (age >= life) {
    return 0;
  }
  const hold = life * holdFraction;
  if (age <= hold) {
    return 1;
  }
  return 1 - (age - hold) / (life - hold);
}

/**
 * 选择池中可复用的条目：优先找未激活的，否则复用年龄最大的（最接近消失的）。
 *
 * @param {ReadonlyArray<{active: boolean, age: number}>} entries
 * @returns {number} 条目下标；空池返回 -1。
 */
export function pickReuseIndex(entries) {
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
 * 创建效果服务。
 *
 * @param {{
 *   renderer: import('../../../providers/abstract/renderer.js').Renderer,
 *   decals?: import('../abstract/effects.js').DecalSink
 * }} options
 * @returns {import('../abstract/effects.js').EffectsService}
 */
export function createEffectsService(options) {
  const renderer = options.renderer;
  const decals = options.decals;
  let disposed = false;
  let warnedMissingDecal = false;

  /**
   * @returns {void}
   */
  function assertAlive() {
    if (disposed) {
      throw new Error('effects 已释放，不能继续使用');
    }
  }

  /**
   * @param {ReadonlyArray<{active: boolean, age: number}>} pool
   * @returns {number}
   */
  function acquireIndex(pool) {
    const index = pickReuseIndex(pool);
    if (index < 0) {
      throw new Error('效果池为空，无法获取条目');
    }
    return index;
  }

  /**
   * @returns {Array<Record<string, unknown>>}
   */
  function createTracerPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.tracer; index += 1) {
      const geometry = new BufferGeometry();
      const positions = new Float32Array(6);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new LineBasicMaterial({
        color: TRACER_COLOR,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      const line = new Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      renderer.add(line);
      pool.push({
        object: line,
        geometry,
        material,
        attributes: geometry.getAttribute('position'),
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.tracer
      });
    }
    return pool;
  }

  /**
   * @returns {Array<Record<string, unknown>>}
   */
  function createImpactPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.impact; index += 1) {
      const random = createSeededRandom(0x9e3779b9 + index * 2654435761);
      const geometry = new BufferGeometry();
      const positions = new Float32Array(IMPACT_SPARK_COUNT * 3);
      const basePositions = new Float32Array(IMPACT_SPARK_COUNT * 3);
      const velocities = new Float32Array(IMPACT_SPARK_COUNT * 3);
      for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark += 1) {
        const offset = spark * 3;
        const spread = 0.16;
        basePositions[offset] = (random() - 0.5) * spread;
        basePositions[offset + 1] = random() * spread * 0.8;
        basePositions[offset + 2] = (random() - 0.5) * spread;
        velocities[offset] = (random() - 0.5) * 2.4;
        velocities[offset + 1] = 0.8 + random() * 1.8;
        velocities[offset + 2] = (random() - 0.5) * 2.4;
      }
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color: IMPACT_COLOR,
        size: 0.07,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.visible = false;
      renderer.add(points);
      pool.push({
        object: points,
        geometry,
        material,
        attributes: geometry.getAttribute('position'),
        basePositions,
        baseVelocities: new Float32Array(velocities),
        velocities,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.impact
      });
    }
    return pool;
  }

  /**
   * @returns {Array<Record<string, unknown>>}
   */
  function createExplosionPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.explosion; index += 1) {
      const random = createSeededRandom(0x85ebca6b + index * 2246822519);
      const group = new Group();

      const pointsGeometry = new BufferGeometry();
      const positions = new Float32Array(EXPLOSION_DEBRIS_COUNT * 3);
      const velocities = new Float32Array(EXPLOSION_DEBRIS_COUNT * 3);
      const baseVelocities = new Float32Array(EXPLOSION_DEBRIS_COUNT * 3);
      for (let piece = 0; piece < EXPLOSION_DEBRIS_COUNT; piece += 1) {
        const offset = piece * 3;
        const theta = random() * Math.PI * 2;
        const vertical = random() * 2 - 1;
        const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const speed = 2.2 + random() * 3.6;
        baseVelocities[offset] = Math.cos(theta) * horizontal * speed;
        baseVelocities[offset + 1] = (vertical * 0.5 + 0.55) * speed;
        baseVelocities[offset + 2] = Math.sin(theta) * horizontal * speed;
      }
      pointsGeometry.setAttribute('position', new BufferAttribute(positions, 3));
      const pointsMaterial = new PointsMaterial({
        color: EXPLOSION_COLOR,
        size: 0.11,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new Points(pointsGeometry, pointsMaterial);
      points.frustumCulled = false;
      group.add(points);

      const flashGeometry = new SphereGeometry(0.5, 12, 8);
      const flashMaterial = new MeshBasicMaterial({
        color: EXPLOSION_FLASH_COLOR,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });
      const flash = new Mesh(flashGeometry, flashMaterial);
      flash.frustumCulled = false;
      group.add(flash);

      group.visible = false;
      renderer.add(group);
      pool.push({
        object: group,
        group,
        points,
        pointsGeometry,
        pointsMaterial,
        pointsAttributes: pointsGeometry.getAttribute('position'),
        flash,
        flashGeometry,
        flashMaterial,
        baseVelocities,
        velocities,
        scale: 1,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.explosion
      });
    }
    return pool;
  }

  /**
   * @returns {Array<Record<string, unknown>>}
   */
  function createSpawnPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.spawn; index += 1) {
      const geometry = new RingGeometry(0.34, 0.5, 24);
      geometry.rotateX(-Math.PI / 2);
      const material = new MeshBasicMaterial({
        color: SPAWN_COLOR,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      renderer.add(mesh);
      pool.push({
        object: mesh,
        geometry,
        material,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.spawn
      });
    }
    return pool;
  }

  /**
   * 血雾粒子池。
   *
   * @returns {Array<Record<string, unknown>>}
   */
  function createBloodPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.blood; index += 1) {
      const random = createSeededRandom(0x27d4eb2f + index * 3266489917);
      const geometry = new BufferGeometry();
      const positions = new Float32Array(BLOOD_PARTICLE_COUNT * 3);
      const velocities = new Float32Array(BLOOD_PARTICLE_COUNT * 3);
      const baseVelocities = new Float32Array(BLOOD_PARTICLE_COUNT * 3);
      for (let particle = 0; particle < BLOOD_PARTICLE_COUNT; particle += 1) {
        const offset = particle * 3;
        const theta = random() * Math.PI * 2;
        const vertical = random() * 2 - 1;
        const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const speed = 1.2 + random() * 2.8;
        baseVelocities[offset] = Math.cos(theta) * horizontal * speed;
        baseVelocities[offset + 1] = (vertical * 0.45 + 0.55) * speed;
        baseVelocities[offset + 2] = Math.sin(theta) * horizontal * speed;
      }
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color: BLOOD_COLOR,
        size: 0.055,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.visible = false;
      renderer.add(points);
      pool.push({
        object: points,
        geometry,
        material,
        attributes: geometry.getAttribute('position'),
        baseVelocities,
        velocities,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.blood
      });
    }
    return pool;
  }

  /**
   * 枪口烟雾粒子池。
   *
   * @returns {Array<Record<string, unknown>>}
   */
  function createSmokePool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.muzzleSmoke; index += 1) {
      const random = createSeededRandom(0x165667b1 + index * 374761393);
      const geometry = new BufferGeometry();
      const positions = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
      const velocities = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
      const baseVelocities = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
      for (let particle = 0; particle < SMOKE_PARTICLE_COUNT; particle += 1) {
        const offset = particle * 3;
        const theta = random() * Math.PI * 2;
        const vertical = random() * 2 - 1;
        const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const speed = 0.25 + random() * 0.55;
        baseVelocities[offset] = Math.cos(theta) * horizontal * speed;
        baseVelocities[offset + 1] = (vertical * 0.3 + 0.35) * speed;
        baseVelocities[offset + 2] = Math.sin(theta) * horizontal * speed;
      }
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color: SMOKE_COLOR,
        size: 0.18,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        sizeAttenuation: true
      });
      const points = new Points(geometry, material);
      points.frustumCulled = false;
      points.visible = false;
      renderer.add(points);
      pool.push({
        object: points,
        geometry,
        material,
        attributes: geometry.getAttribute('position'),
        baseVelocities,
        velocities,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.muzzleSmoke
      });
    }
    return pool;
  }

  const shellGeometry = new CylinderGeometry(0.006, 0.006, 0.03, 6);
  const shellMaterial = new MeshStandardMaterial({
    color: SHELL_COLOR,
    roughness: 0.42,
    metalness: 0.7
  });

  /**
   * 弹壳池。
   *
   * @returns {Array<Record<string, unknown>>}
   */
  function createShellPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.shell; index += 1) {
      const mesh = new Mesh(shellGeometry, shellMaterial);
      mesh.visible = false;
      mesh.frustumCulled = false;
      renderer.add(mesh);
      pool.push({
        object: mesh,
        velocity: new Vector3(0, 0, 0),
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.shell
      });
    }
    return pool;
  }

  const flashGeometry = new SphereGeometry(0.07, 6, 4);

  /**
   * 敌人枪口闪光池。
   *
   * @returns {Array<Record<string, unknown>>}
   */
  function createFlashPool() {
    const pool = [];
    for (let index = 0; index < EFFECT_POOL_LIMITS.flash; index += 1) {
      const material = new MeshBasicMaterial({
        color: MUZZLE_FLASH_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending
      });
      const mesh = new Mesh(flashGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      renderer.add(mesh);
      pool.push({
        object: mesh,
        material,
        active: false,
        age: 0,
        life: EFFECT_LIFETIMES.flash,
        scale: 1
      });
    }
    return pool;
  }

  const markGeometry = new RingGeometry(0, 0.5, 14);

  /**
   * 没有 decals 系统时的弹孔/血渍回退贴片池。
   *
   * @param {number} count
   * @param {number} color
   * @param {number} life
   * @returns {Array<Record<string, unknown>>}
   */
  function createMarkPool(count, color, life) {
    const pool = [];
    for (let index = 0; index < count; index += 1) {
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const mesh = new Mesh(markGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      renderer.add(mesh);
      pool.push({
        object: mesh,
        material,
        active: false,
        age: 0,
        life,
        fadeStart: 0.72,
        baseOpacity: 0.85
      });
    }
    return pool;
  }

  const tracerPool = createTracerPool();
  const impactPool = createImpactPool();
  const explosionPool = createExplosionPool();
  const spawnPool = createSpawnPool();
  const bloodPool = createBloodPool();
  const smokePool = createSmokePool();
  const shellPool = createShellPool();
  const flashPool = createFlashPool();
  const bulletMarkPool = createMarkPool(
    EFFECT_POOL_LIMITS.bulletMark,
    BULLET_MARK_COLOR,
    EFFECT_LIFETIMES.bulletMark
  );
  const bloodMarkPool = createMarkPool(
    EFFECT_POOL_LIMITS.bloodMark,
    BLOOD_MARK_COLOR,
    EFFECT_LIFETIMES.bloodMark
  );

  /**
   * @returns {boolean}
   */
  function hasDecals() {
    if (decals === null || decals === undefined) {
      return false;
    }
    return true;
  }

  /**
   * @param {string} method
   * @returns {boolean}
   */
  function canUseDecalMethod(method) {
    if (!hasDecals()) {
      return false;
    }
    const value = /** @type {Record<string, unknown>} */ (decals);
    if (typeof value[method] === 'function') {
      return true;
    }
    if (!warnedMissingDecal) {
      warnedMissingDecal = true;
      console.warn('[effects] decals 系统缺少 ' + method + '()，使用内置回退贴片');
    }
    return false;
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateTracers(step) {
    for (const entry of tracerPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      entry.material.opacity = 0.85 * computeFade(entry.age, entry.life, 0.2);
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateImpacts(step) {
    for (const entry of impactPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const positions = entry.attributes;
      const velocities = entry.velocities;
      for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark += 1) {
        const offset = spark * 3;
        const x = positions.getX(spark) + velocities[offset] * step;
        const y = positions.getY(spark) + velocities[offset + 1] * step;
        const z = positions.getZ(spark) + velocities[offset + 2] * step;
        velocities[offset + 1] = velocities[offset + 1] - 7 * step;
        positions.setXYZ(spark, x, y, z);
      }
      positions.needsUpdate = true;
      entry.material.opacity = computeFade(entry.age, entry.life, 0.15);
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateExplosions(step) {
    for (const entry of explosionPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.group.visible = false;
        continue;
      }
      const progress = entry.age / entry.life;
      const fade = computeFade(entry.age, entry.life, 0.08);
      entry.pointsMaterial.opacity = fade;
      entry.flashMaterial.opacity = 0.5 * fade;
      entry.flash.scale.setScalar(entry.scale * (0.5 + 2.0 * progress));

      const positions = entry.pointsAttributes;
      const velocities = entry.velocities;
      for (let piece = 0; piece < EXPLOSION_DEBRIS_COUNT; piece += 1) {
        const offset = piece * 3;
        const x = positions.getX(piece) + velocities[offset] * step;
        const y = positions.getY(piece) + velocities[offset + 1] * step;
        const z = positions.getZ(piece) + velocities[offset + 2] * step;
        velocities[offset + 1] = velocities[offset + 1] - EXPLOSION_GRAVITY * step;
        positions.setXYZ(piece, x, y, z);
      }
      positions.needsUpdate = true;
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateSpawns(step) {
    for (const entry of spawnPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const progress = entry.age / entry.life;
      const scale = 0.7 + 1.5 * progress;
      entry.object.scale.set(scale, 1, scale);
      entry.material.opacity = 0.45 * computeFade(entry.age, entry.life, 0.05);
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateBlood(step) {
    for (const entry of bloodPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const positions = entry.attributes;
      const velocities = entry.velocities;
      for (let particle = 0; particle < BLOOD_PARTICLE_COUNT; particle += 1) {
        const offset = particle * 3;
        const x = positions.getX(particle) + velocities[offset] * step;
        const y = positions.getY(particle) + velocities[offset + 1] * step;
        const z = positions.getZ(particle) + velocities[offset + 2] * step;
        velocities[offset + 1] = velocities[offset + 1] - BLOOD_GRAVITY * step;
        positions.setXYZ(particle, x, y, z);
      }
      positions.needsUpdate = true;
      entry.material.opacity = computeFade(entry.age, entry.life, 0.1);
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateSmoke(step) {
    for (const entry of smokePool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const positions = entry.attributes;
      const velocities = entry.velocities;
      for (let particle = 0; particle < SMOKE_PARTICLE_COUNT; particle += 1) {
        const offset = particle * 3;
        const x = positions.getX(particle) + velocities[offset] * step;
        const y = positions.getY(particle) + velocities[offset + 1] * step;
        const z = positions.getZ(particle) + velocities[offset + 2] * step;
        velocities[offset] = velocities[offset] * 0.98;
        velocities[offset + 1] = velocities[offset + 1] + 0.18 * step;
        velocities[offset + 2] = velocities[offset + 2] * 0.98;
        positions.setXYZ(particle, x, y, z);
      }
      positions.needsUpdate = true;
      entry.material.opacity = 0.35 * computeFade(entry.age, entry.life, 0.1);
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateShells(step) {
    for (const entry of shellPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const mesh = /** @type {Mesh} */ (entry.object);
      const velocity = /** @type {Vector3} */ (entry.velocity);
      velocity.y = velocity.y - SHELL_GRAVITY * step;
      mesh.position.x = mesh.position.x + velocity.x * step;
      mesh.position.y = mesh.position.y + velocity.y * step;
      mesh.position.z = mesh.position.z + velocity.z * step;
      if (mesh.position.y < 0.02) {
        mesh.position.y = 0.02;
        velocity.y = Math.abs(velocity.y) * 0.32;
        velocity.x = velocity.x * 0.55;
        velocity.z = velocity.z * 0.55;
      }
      mesh.rotation.x = mesh.rotation.x + velocity.z * step * 2.2;
      mesh.rotation.z = mesh.rotation.z + velocity.x * step * 2.2;
      mesh.visible = entry.age < entry.life;
    }
  }

  /**
   * @param {number} step
   * @returns {void}
   */
  function updateFlashes(step) {
    for (const entry of flashPool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const fade = computeFade(entry.age, entry.life, 0.1);
      entry.material.opacity = 0.9 * fade;
      entry.object.scale.setScalar(entry.scale * (0.8 + 1.6 * (entry.age / entry.life)));
    }
  }

  /**
   * @param {Array<Record<string, unknown>>} pool
   * @param {number} step
   * @returns {void}
   */
  function updateMarks(pool, step) {
    for (const entry of pool) {
      if (!entry.active) {
        continue;
      }
      entry.age = entry.age + step;
      if (entry.age >= entry.life) {
        entry.active = false;
        entry.object.visible = false;
        continue;
      }
      const fade = computeFade(entry.age, entry.life, entry.fadeStart);
      entry.material.opacity = entry.baseOpacity * fade;
    }
  }

  /**
   * 让一个贴片平面朝向法线。
   *
   * @param {Record<string, unknown>} entry
   * @param {{x: number, y: number, z: number}} position
   * @param {{x: number, y: number, z: number}} normal
   * @param {number} scale
   * @returns {void}
   */
  function placeMark(entry, position, normal, scale) {
    const normalValue = new Vector3(normal.x, normal.y, normal.z);
    if (normalValue.lengthSq() === 0) {
      normalValue.set(0, 1, 0);
    }
    normalValue.normalize();
    const mesh = /** @type {Mesh} */ (entry.object);
    mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, normalValue);
    mesh.position.set(
      position.x + normalValue.x * 0.012,
      position.y + normalValue.y * 0.012,
      position.z + normalValue.z * 0.012
    );
    mesh.scale.set(scale, scale, 1);
    mesh.visible = true;
    entry.material.opacity = entry.baseOpacity;
    entry.active = true;
    entry.age = 0;
  }

  /**
   * 激活一条弹道线；供 `tracer()` 与 `enemyShot()` 共用。
   *
   * @param {{x: number, y: number, z: number}} from
   * @param {{x: number, y: number, z: number}} to
   * @param {unknown} color
   * @returns {void}
   */
  function activateTracer(from, to, color) {
    const start = readVector(from, 'tracer 的 from');
    const end = readVector(to, 'tracer 的 to');
    const entry = tracerPool[acquireIndex(tracerPool)];
    entry.attributes.setXYZ(0, start.x, start.y, start.z);
    entry.attributes.setXYZ(1, end.x, end.y, end.z);
    entry.attributes.needsUpdate = true;
    entry.geometry.computeBoundingSphere();
    entry.material.color.setHex(readColor(color, TRACER_COLOR, 'tracer 的 color'));
    entry.material.opacity = 0.85;
    entry.object.visible = true;
    entry.active = true;
    entry.age = 0;
  }

  /**
   * 激活枪口烟雾；供 `muzzleSmoke()` 与 `enemyShot()` 共用。
   *
   * @param {{x: number, y: number, z: number}} position
   * @param {{x: number, y: number, z: number}} direction
   * @returns {void}
   */
  function activateMuzzleSmoke(position, direction) {
    const point = readVector(position, 'muzzleSmoke 的 position');
    const directionValue = readVector(direction, 'muzzleSmoke 的 direction');
    const length = Math.hypot(directionValue.x, directionValue.y, directionValue.z);
    let aimX = 0;
    let aimY = 0;
    let aimZ = 0;
    if (length > 0) {
      aimX = directionValue.x / length;
      aimY = directionValue.y / length;
      aimZ = directionValue.z / length;
    }
    const entry = smokePool[acquireIndex(smokePool)];
    const attributes = entry.attributes;
    const velocities = entry.velocities;
    const baseVelocities = entry.baseVelocities;
    for (let particle = 0; particle < SMOKE_PARTICLE_COUNT; particle += 1) {
      const offset = particle * 3;
      attributes.setXYZ(particle, aimX * 0.08, aimY * 0.08, aimZ * 0.08);
      velocities[offset] = baseVelocities[offset] + aimX * 0.55;
      velocities[offset + 1] = baseVelocities[offset + 1] + aimY * 0.3;
      velocities[offset + 2] = baseVelocities[offset + 2] + aimZ * 0.55;
    }
    attributes.needsUpdate = true;
    entry.object.position.set(point.x, point.y, point.z);
    entry.material.opacity = 0.35;
    entry.object.visible = true;
    entry.active = true;
    entry.age = 0;
  }

  return {
    /**
     * 画一条短暂的弹道线。
     *
     * @param {{x: number, y: number, z: number}} from
     * @param {{x: number, y: number, z: number}} to
     * @param {number} [color]
     * @returns {void}
     */
    tracer(from, to, color) {
      assertAlive();
      activateTracer(from, to, color);
    },

    /**
     * 在命中点播放一小簇火花，沿命中法线略微偏移。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} normal
     * @param {number} [color]
     * @returns {void}
     */
    impact(position, normal, color) {
      assertAlive();
      const point = readVector(position, 'impact 的 position');
      const normalValue = readVector(normal, 'impact 的 normal');
      const entry = impactPool[acquireIndex(impactPool)];
      const attributes = entry.attributes;
      const basePositions = entry.basePositions;
      const velocities = entry.velocities;
      const baseVelocities = entry.baseVelocities;
      for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark += 1) {
        const offset = spark * 3;
        attributes.setXYZ(
          spark,
          basePositions[offset] + normalValue.x * 0.05,
          basePositions[offset + 1] + normalValue.y * 0.05,
          basePositions[offset + 2] + normalValue.z * 0.05
        );
        velocities[offset] = baseVelocities[offset];
        velocities[offset + 1] = baseVelocities[offset + 1];
        velocities[offset + 2] = baseVelocities[offset + 2];
      }
      attributes.needsUpdate = true;
      entry.object.position.set(point.x, point.y, point.z);
      entry.material.color.setHex(readColor(color, IMPACT_COLOR, 'impact 的 color'));
      entry.material.opacity = 1;
      entry.object.visible = true;
      entry.active = true;
      entry.age = 0;
    },

    /**
     * 播放一次扩张、淡出的爆炸，碎片使用传入的颜色。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {number} [color]
     * @param {number} [scale]
     * @returns {void}
     */
    explosion(position, color, scale) {
      assertAlive();
      const point = readVector(position, 'explosion 的 position');
      const size = readScale(scale);
      const entry = explosionPool[acquireIndex(explosionPool)];
      entry.group.position.set(point.x, point.y, point.z);
      entry.group.visible = true;
      entry.scale = size;
      entry.pointsMaterial.color.setHex(
        readColor(color, EXPLOSION_COLOR, 'explosion 的 color')
      );
      entry.pointsMaterial.opacity = 1;
      entry.flashMaterial.opacity = 0.5;
      entry.flash.scale.setScalar(size * 0.5);

      const attributes = entry.pointsAttributes;
      const velocities = entry.velocities;
      const baseVelocities = entry.baseVelocities;
      for (let piece = 0; piece < EXPLOSION_DEBRIS_COUNT; piece += 1) {
        const offset = piece * 3;
        attributes.setXYZ(piece, 0, 0, 0);
        const boost = 0.75 + size * 0.35;
        velocities[offset] = baseVelocities[offset] * boost;
        velocities[offset + 1] = baseVelocities[offset + 1] * boost;
        velocities[offset + 2] = baseVelocities[offset + 2] * boost;
      }
      attributes.needsUpdate = true;
      entry.active = true;
      entry.age = 0;
    },

    /**
     * 在敌人生成位置播放一个贴地的微弱光环。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {number} [color]
     * @returns {void}
     */
    spawn(position, color) {
      assertAlive();
      const point = readVector(position, 'spawn 的 position');
      const entry = spawnPool[acquireIndex(spawnPool)];
      entry.object.position.set(point.x, point.y + 0.035, point.z);
      entry.object.scale.set(0.7, 1, 0.7);
      entry.material.color.setHex(readColor(color, SPAWN_COLOR, 'spawn 的 color'));
      entry.material.opacity = 0.45;
      entry.object.visible = true;
      entry.active = true;
      entry.age = 0;
    },

    /**
     * 播放血雾，并在 decals 系统上留下血渍；没有 decals 时使用内置回退贴片。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} direction
     * @param {number} [color]
     * @returns {void}
     */
    blood(position, direction, color) {
      assertAlive();
      const point = readVector(position, 'blood 的 position');
      const directionValue = readVector(direction, 'blood 的 direction');
      const bloodColor = readColor(color, BLOOD_COLOR, 'blood 的 color');
      const entry = bloodPool[acquireIndex(bloodPool)];
      const attributes = entry.attributes;
      const velocities = entry.velocities;
      const baseVelocities = entry.baseVelocities;
      const directionLength = Math.hypot(
        directionValue.x,
        directionValue.y,
        directionValue.z
      );
      let aimX = 0;
      let aimY = 0.6;
      let aimZ = 0;
      if (directionLength > 0) {
        aimX = directionValue.x / directionLength;
        aimY = directionValue.y / directionLength;
        aimZ = directionValue.z / directionLength;
      }
      for (let particle = 0; particle < BLOOD_PARTICLE_COUNT; particle += 1) {
        const offset = particle * 3;
        attributes.setXYZ(particle, 0, 0, 0);
        velocities[offset] = baseVelocities[offset] + aimX * 1.8;
        velocities[offset + 1] = baseVelocities[offset + 1] + aimY * 0.8;
        velocities[offset + 2] = baseVelocities[offset + 2] + aimZ * 1.8;
      }
      attributes.needsUpdate = true;
      entry.object.position.set(point.x, point.y, point.z);
      entry.material.color.setHex(bloodColor);
      entry.material.opacity = 1;
      entry.object.visible = true;
      entry.active = true;
      entry.age = 0;

      let normalX = -aimX;
      let normalY = -aimY;
      let normalZ = -aimZ;
      if (directionLength === 0) {
        normalX = 0;
        normalY = 1;
        normalZ = 0;
      }
      const normal = { x: normalX, y: normalY, z: normalZ };
      if (canUseDecalMethod('addBlood')) {
        decals.addBlood(point, normal, bloodColor);
        return;
      }
      const mark = bloodMarkPool[acquireIndex(bloodMarkPool)];
      placeMark(mark, point, normal, 0.55);
    },

    /**
     * 在世界表面留下弹孔。优先交给 decals；没有时使用内置回退贴片。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} normal
     * @returns {void}
     */
    bulletHole(position, normal) {
      assertAlive();
      const point = readVector(position, 'bulletHole 的 position');
      const normalValue = readVector(normal, 'bulletHole 的 normal');
      if (canUseDecalMethod('addBulletHole')) {
        decals.addBulletHole(point, normalValue);
        return;
      }
      const entry = bulletMarkPool[acquireIndex(bulletMarkPool)];
      placeMark(entry, point, normalValue, 0.18);
    },

    /**
     * 在枪口位置喷出一小团灰烟。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} direction
     * @returns {void}
     */
    muzzleSmoke(position, direction) {
      assertAlive();
      activateMuzzleSmoke(position, direction);
    },

    /**
     * 抛出一个短寿命弹壳。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} velocity
     * @returns {void}
     */
    shell(position, velocity) {
      assertAlive();
      const point = readVector(position, 'shell 的 position');
      const velocityValue = readVector(velocity, 'shell 的 velocity');
      const entry = shellPool[acquireIndex(shellPool)];
      const mesh = /** @type {Mesh} */ (entry.object);
      mesh.position.set(point.x, point.y, point.z);
      mesh.rotation.set(0.4, 0.8, 0.2);
      /** @type {Vector3} */ (entry.velocity).set(
        velocityValue.x,
        velocityValue.y,
        velocityValue.z
      );
      mesh.visible = true;
      entry.active = true;
      entry.age = 0;
    },

    /**
     * 敌人开火：枪口闪光 + 烟雾 + 一小段曳光。
     *
     * @param {{x: number, y: number, z: number}} position
     * @param {{x: number, y: number, z: number}} direction
     * @param {number} [color]
     * @returns {void}
     */
    enemyShot(position, direction, color) {
      assertAlive();
      const point = readVector(position, 'enemyShot 的 position');
      const directionValue = readVector(direction, 'enemyShot 的 direction');
      const shotColor = readColor(color, MUZZLE_FLASH_COLOR, 'enemyShot 的 color');
      const length = Math.hypot(directionValue.x, directionValue.y, directionValue.z);
      let aimX = 0;
      let aimY = 0;
      let aimZ = 1;
      if (length > 0) {
        aimX = directionValue.x / length;
        aimY = directionValue.y / length;
        aimZ = directionValue.z / length;
      }

      const flash = flashPool[acquireIndex(flashPool)];
      flash.object.position.set(
        point.x + aimX * 0.12,
        point.y + aimY * 0.12,
        point.z + aimZ * 0.12
      );
      flash.material.color.setHex(shotColor);
      flash.material.opacity = 0.9;
      flash.object.scale.setScalar(flash.scale);
      flash.object.visible = true;
      flash.active = true;
      flash.age = 0;

      activateMuzzleSmoke(point, directionValue);
      activateTracer(
        point,
        {
          x: point.x + aimX * 1.4,
          y: point.y + aimY * 1.4,
          z: point.z + aimZ * 1.4
        },
        shotColor
      );
    },

    /**
     * 推进所有效果的生命周期。暂停时调用方可以跳过本方法。
     *
     * @param {number} dt
     * @returns {void}
     */
    update(dt) {
      assertAlive();
      if (!isFiniteNumber(dt) || dt < 0) {
        throw new RangeError('effects.update 的 dt 必须是大于等于 0 的有限数字');
      }
      let step = dt;
      if (step > 0.2) {
        step = 0.2;
      }
      updateTracers(step);
      updateImpacts(step);
      updateExplosions(step);
      updateSpawns(step);
      updateBlood(step);
      updateSmoke(step);
      updateShells(step);
      updateFlashes(step);
      updateMarks(bulletMarkPool, step);
      updateMarks(bloodMarkPool, step);
    },

    /**
     * 让所有效果立即消失，但保留池对象供下一局复用。
     *
     * @returns {void}
     */
    clear() {
      assertAlive();
      const pools = [
        tracerPool,
        impactPool,
        explosionPool,
        spawnPool,
        bloodPool,
        smokePool,
        shellPool,
        flashPool,
        bulletMarkPool,
        bloodMarkPool
      ];
      for (const pool of pools) {
        for (const entry of pool) {
          entry.active = false;
          entry.age = 0;
          entry.object.visible = false;
        }
      }
    },

    /**
     * 移除所有池对象并释放几何体与材质。释放后继续调用会抛错。
     *
     * @returns {void}
     */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;

      for (const entry of tracerPool) {
        renderer.remove(entry.object);
        entry.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of impactPool) {
        renderer.remove(entry.object);
        entry.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of explosionPool) {
        renderer.remove(entry.group);
        entry.pointsGeometry.dispose();
        entry.pointsMaterial.dispose();
        entry.flashGeometry.dispose();
        entry.flashMaterial.dispose();
      }
      for (const entry of spawnPool) {
        renderer.remove(entry.object);
        entry.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of bloodPool) {
        renderer.remove(entry.object);
        entry.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of smokePool) {
        renderer.remove(entry.object);
        entry.geometry.dispose();
        entry.material.dispose();
      }
      for (const entry of shellPool) {
        renderer.remove(entry.object);
      }
      shellGeometry.dispose();
      shellMaterial.dispose();
      for (const entry of flashPool) {
        renderer.remove(entry.object);
        entry.material.dispose();
      }
      flashGeometry.dispose();
      for (const entry of bulletMarkPool) {
        renderer.remove(entry.object);
        entry.material.dispose();
      }
      for (const entry of bloodMarkPool) {
        renderer.remove(entry.object);
        entry.material.dispose();
      }
      markGeometry.dispose();

      tracerPool.length = 0;
      impactPool.length = 0;
      explosionPool.length = 0;
      spawnPool.length = 0;
      bloodPool.length = 0;
      smokePool.length = 0;
      shellPool.length = 0;
      flashPool.length = 0;
      bulletMarkPool.length = 0;
      bloodMarkPool.length = 0;
    }
  };
}
