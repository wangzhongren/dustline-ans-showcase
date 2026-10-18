/**
 * 人类士兵可视化：GLB 骨骼模型、程序化战术装具、动画状态机与头/身命中盒。
 *
 * 视觉来源：
 * - 四个 Quaternius CC0 GLB（Adventurer、Woman Casual、Woman Formal、Man base），
 *   由美术角色登记在 `resource/asset-manifest.json` 的 `models.humans` 中。
 * - 敌方服务只通过素材 Provider 公共入口的 `loadGltf(url)` 加载，通过 Three
 *   公共门面的 `cloneSkinned` 复制骨骼实例、`AnimationMixer` 播放动画。
 * - 装具与步枪由程序化几何叠加，颜色限定在橄榄、卡其、装备黑范围内。
 *
 * 动画约定（美术验证结果，见 `角色卡/美术/api-spec.md`）：
 * - Adventurer / Woman：`CharacterArmature|Idle_Gun`、`Walk`、`Run`、
 *   `Run_Shoot`、`Gun_Shoot`、`HitRecieve`、`Death`。
 * - Man base：`HumanArmature|Man_Idle`、`Man_Standing`、`Man_Walk`、`Man_Run`、
 *   `Man_Punch`、`Man_Death`；没有 `Idle_Gun`、`Gun_Shoot`、`Run_Shoot`、
 *   `HitRecieve`、`Punch_Left/Right`。
 *
 * 缺失回退：
 * - 缺少动画片段时按状态选择最近的可用片段（例如 Man 的 idle 用 `Man_Idle`
 *   或 `Man_Standing`，受击只闪白，近战用 `Man_Punch`，死亡用 `Man_Death`）。
 * - 素材加载器、`cloneSkinned` 或 `AnimationMixer` 尚未由环境引擎提供时，
 *   记录明确错误并使用程序化人类士兵回退；比赛不会因此中断。
 *
 * 本模块只被 `enemy.js` 使用；不导入其他 Service、Pipeline、Interface、
 * `providers/impl/` 或 `three` 包本身。
 */

import * as providerThree from '../../../providers/public/three.js';
import { ENEMY_TYPES, GAME_CONFIG } from '../../../models/game-config.js';

const {
  Group,
  Mesh,
  Vector3,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AdditiveBlending
} = providerThree;

/** 四个 GLB 的固定标识，顺序与清单一致。 */
export const HUMAN_MODEL_IDS = Object.freeze([
  'adventurer',
  'woman-casual',
  'woman-formal',
  'man-base'
]);

/**
 * 模型定义。`variant` 决定动画命名家族（CharacterArmature / HumanArmature）；
 * `defaultScale` 是美术实测的归一化缩放，清单条目提供时以清单为准。
 */
export const HUMAN_MODEL_DEFINITIONS = Object.freeze({
  adventurer: Object.freeze({
    id: 'adventurer',
    variant: 'character',
    defaultScale: 0.985,
    pathKey: 'adventurer'
  }),
  'woman-casual': Object.freeze({
    id: 'woman-casual',
    variant: 'character',
    defaultScale: 0.995,
    pathKey: 'woman-casual'
  }),
  'woman-formal': Object.freeze({
    id: 'woman-formal',
    variant: 'character',
    defaultScale: 1,
    pathKey: 'woman-formal'
  }),
  'man-base': Object.freeze({
    id: 'man-base',
    variant: 'man',
    defaultScale: 0.373,
    pathKey: 'man-base'
  })
});

/** 重机枪手在模型归一化缩放之上再放大的倍数（设计 §12.2）。 */
export const HEAVY_SCALE_MULTIPLIER = 1.12;

/** 尸体保留时间与最后淡出时长（秒）。 */
export const CORPSE_LIFETIME = 4;
export const CORPSE_FADE_DURATION = 1;

/** 动画状态名。`attack` 是武装近战（步枪兵/重机枪手不常用），突击兵用左右拳。 */
const ANIMATION_STATES = Object.freeze([
  'idle',
  'walk',
  'run',
  'runShoot',
  'shoot',
  'hit',
  'attack',
  'attackLeft',
  'attackRight',
  'death'
]);

/** CharacterArmature 家族的缺失回退链（按优先级）。 */
const CHARACTER_FALLBACKS = Object.freeze({
  idle: Object.freeze(['Idle_Gun', 'Idle_Gun_Shoot', 'Idle', 'Idle_Neutral', 'Walk']),
  walk: Object.freeze(['Walk', 'Run']),
  run: Object.freeze(['Run', 'Walk']),
  runShoot: Object.freeze(['Run_Shoot', 'Idle_Gun_Shoot', 'Gun_Shoot', 'Run']),
  shoot: Object.freeze(['Gun_Shoot', 'Idle_Gun_Shoot', 'Run_Shoot', 'Idle_Gun']),
  hit: Object.freeze(['HitRecieve', 'HitRecieve_2']),
  attack: Object.freeze(['Punch_Right', 'Punch_Left', 'Kick_Right', 'Kick_Left']),
  attackLeft: Object.freeze(['Punch_Left', 'Punch_Right']),
  attackRight: Object.freeze(['Punch_Right', 'Punch_Left']),
  death: Object.freeze(['Death'])
});

/** HumanArmature（Man base）的缺失回退链。 */
const MAN_FALLBACKS = Object.freeze({
  idle: Object.freeze(['Man_Idle', 'Man_Standing']),
  walk: Object.freeze(['Man_Walk', 'Man_Idle', 'Man_Standing']),
  run: Object.freeze(['Man_Run', 'Man_Walk', 'Man_Idle']),
  runShoot: Object.freeze([]),
  shoot: Object.freeze([]),
  hit: Object.freeze([]),
  attack: Object.freeze(['Man_Punch', 'Man_SwordSlash']),
  attackLeft: Object.freeze(['Man_Punch']),
  attackRight: Object.freeze(['Man_Punch']),
  death: Object.freeze(['Man_Death'])
});

/**
 * Three.js 的动画循环常量是稳定数值；公开门面只导出了 AnimationMixer，
 * 没有导出这两个常量，因此在这里按 Three.js 的公开语义固定下来。
 */
const LOOP_ONCE = 2200;
const LOOP_REPEAT = 2201;

/** 动画表现参数。 */
const ANIMATION_BEHAVIOR = Object.freeze({
  defaultFade: 0.16,
  hitFade: 0.15,
  deathFade: 0.15,
  attackFade: 0.15,
  hitFallbackDuration: 0.35,
  attackFallbackDuration: 0.5,
  muzzleFlashDuration: 0.05,
  hitFlashDuration: 0.1,
  walkReferenceSpeed: 1.6,
  runReferenceSpeed: 4.8,
  minTimeScale: 0.75,
  maxTimeScale: 1.35,
  reloadTilt: 0.38,
  reloadHeadTilt: -0.12,
  reloadTiltRate: 10
});

/** 装具颜色锚点（美术方向 §8.2 / 配色表）。 */
const GEAR_PALETTE = Object.freeze({
  helmet: 0x3e4236,
  mask: 0x2b2e2a,
  vest: 0x5a5c4a,
  pouch: 0x4a4c3d,
  gearBlack: 0x2b2e2a,
  khaki: 0x8a8268,
  armor: 0x3c4036,
  rifleMetal: 0x3a3d3f,
  riflePolymer: 0x232623,
  fallbackUniform: 0x6f725c,
  fallbackSkin: 0xb08a68
});

/** 不同模型变体的装具色调差异（只改明度，不用高饱和队色）。 */
const VARIANT_GEAR_TINTS = Object.freeze({
  adventurer: Object.freeze({ vest: 0x5a5c4a, pouch: 0x4a4c3d, helmet: 0x3e4236 }),
  'woman-casual': Object.freeze({ vest: 0x62614d, pouch: 0x515242, helmet: 0x454a3c }),
  'woman-formal': Object.freeze({ vest: 0x525440, pouch: 0x444636, helmet: 0x383c31 }),
  'man-base': Object.freeze({ vest: 0x6b6650, pouch: 0x565243, helmet: 0x40443a })
});

/** 缺少门面能力时只记录一次，避免按敌人刷屏。 */
const capabilityWarnings = {
  mixer: false,
  clone: false,
  assets: false
};

/**
 * 把动画片段或片段名读成字符串名称。
 *
 * @param {unknown} animation
 * @returns {string}
 */
function readAnimationName(animation) {
  if (typeof animation === 'string') {
    return animation;
  }
  if (
    animation !== null &&
    typeof animation === 'object' &&
    typeof animation.name === 'string'
  ) {
    return animation.name;
  }
  return '';
}

/**
 * 取模型定义；未知 id 回退到 Adventurer。
 *
 * @param {string} modelId
 * @returns {typeof HUMAN_MODEL_DEFINITIONS.adventurer}
 */
export function getModelDefinition(modelId) {
  if (typeof modelId === 'string' && HUMAN_MODEL_DEFINITIONS[modelId] !== undefined) {
    return HUMAN_MODEL_DEFINITIONS[modelId];
  }
  return HUMAN_MODEL_DEFINITIONS.adventurer;
}

/**
 * 按片段后缀建立“后缀 → 完整片段名”索引。
 *
 * @param {unknown[]} animations
 * @returns {Map<string, string>}
 */
function buildSuffixIndex(animations) {
  const index = new Map();
  for (const animation of animations) {
    const name = readAnimationName(animation);
    if (name.length === 0) {
      continue;
    }
    const separator = name.lastIndexOf('|');
    let suffix = name;
    if (separator >= 0) {
      suffix = name.slice(separator + 1);
    }
    if (!index.has(suffix)) {
      index.set(suffix, name);
    }
    if (!index.has(name)) {
      index.set(name, name);
    }
  }
  return index;
}

/**
 * 把设计动画名解析成模型里真实存在的片段名，并应用缺失回退。
 *
 * 返回值中的每个键都是状态名，值是完整片段名或 `null`（表示该状态没有片段，
 * 例如 Man 没有受击与射击片段）。
 *
 * @param {{
 *   modelId: string,
 *   type: string,
 *   animations: unknown[]
 * }} options
 * @returns {Readonly<Record<string, string|null>>}
 */
export function resolveAnimationClipMap(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('resolveAnimationClipMap 需要 options 对象');
  }
  const modelId = options.modelId;
  const type = options.type;
  let animations = options.animations;
  if (!Array.isArray(animations)) {
    animations = [];
  }

  const definition = getModelDefinition(modelId);
  let chains = MAN_FALLBACKS;
  if (definition.variant !== 'man') {
    chains = CHARACTER_FALLBACKS;
  }

  let designNames = null;
  if (
    GAME_CONFIG.enemies.animationNames !== undefined &&
    GAME_CONFIG.enemies.animationNames[type] !== undefined
  ) {
    designNames = GAME_CONFIG.enemies.animationNames[type];
  }

  const index = buildSuffixIndex(animations);
  const result = {};

  for (const state of ANIMATION_STATES) {
    const candidates = [];
    if (designNames !== null && typeof designNames[state] === 'string') {
      candidates.push(designNames[state]);
    }
    const chain = chains[state];
    for (const candidate of chain) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }

    let resolved = null;
    for (const candidate of candidates) {
      const fullName = index.get(candidate);
      if (fullName !== undefined) {
        resolved = fullName;
        break;
      }
    }
    result[state] = resolved;
  }

  return Object.freeze(result);
}

/**
 * 从素材清单里收集人类模型条目，按 id 去重。
 *
 * @param {unknown} manifest
 * @returns {Map<string, Record<string, unknown>>}
 */
function collectManifestEntries(manifest) {
  const entries = new Map();
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.models === undefined ||
    manifest.models === null ||
    typeof manifest.models !== 'object'
  ) {
    return entries;
  }
  const humans = manifest.models.humans;
  if (humans === null || typeof humans !== 'object') {
    return entries;
  }

  for (const role of Object.keys(humans)) {
    const list = humans[role];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        continue;
      }
      if (!entries.has(entry.id)) {
        entries.set(entry.id, entry);
      }
    }
  }
  return entries;
}

/**
 * 读取模型条目的默认路径（清单优先，缺失时用共享配置）。
 *
 * @param {Record<string, unknown>|undefined} entry
 * @param {string} modelId
 * @returns {string}
 */
function readModelUrl(entry, modelId) {
  if (entry !== undefined && typeof entry.url === 'string' && entry.url.length > 0) {
    return entry.url;
  }
  const paths = GAME_CONFIG.enemies.modelPaths;
  if (typeof paths[modelId] === 'string') {
    return paths[modelId];
  }
  return 'models/quaternius-adventurer.glb';
}

/**
 * 预加载四个人类 GLB。任何单个模型失败都记录具体 URL 与错误并继续。
 *
 * 返回的 Map 键是模型 id，值是 `{ id, url, scene, animations, scale }` 或
 * `null`（表示加载失败，实例应使用程序化回退）。重复调用由上层缓存。
 *
 * @param {{ assets?: { loadManifest?: Function, loadGltf?: Function } }} [options]
 * @returns {Promise<Map<string, Object|null>>}
 */
export async function loadHumanModelCache(options) {
  const cache = new Map();
  let assets = null;
  if (options !== null && options !== undefined && typeof options === 'object') {
    assets = options.assets;
  }

  if (
    assets === null ||
    assets === undefined ||
    typeof assets.loadGltf !== 'function'
  ) {
    console.error(
      '敌方服务：素材加载器缺少 loadGltf(url)，人类士兵使用程序化回退。'
    );
    return cache;
  }

  let manifest = null;
  if (typeof assets.loadManifest === 'function') {
    try {
      manifest = await assets.loadManifest();
    } catch (error) {
      console.error(
        '敌方服务：读取 asset-manifest.json 失败，改用 GAME_CONFIG.enemies.modelPaths。',
        error
      );
      manifest = null;
    }
  }

  const entries = collectManifestEntries(manifest);

  for (const modelId of HUMAN_MODEL_IDS) {
    const definition = HUMAN_MODEL_DEFINITIONS[modelId];
    const entry = entries.get(modelId);
    const url = readModelUrl(entry, modelId);

    try {
      const gltf = await assets.loadGltf(url);
      if (gltf === null || gltf === undefined || !gltf.scene) {
        throw new Error('loadGltf 返回内容缺少 scene');
      }
      let animations = gltf.animations;
      if (!Array.isArray(animations)) {
        animations = [];
      }
      let scale = definition.defaultScale;
      if (entry !== undefined && typeof entry.scale === 'number' && entry.scale > 0) {
        scale = entry.scale;
      }
      cache.set(
        modelId,
        Object.freeze({
          id: modelId,
          url,
          scene: gltf.scene,
          animations,
          scale,
          forwardAxis: '+Z',
          rootMotion: false
        })
      );
    } catch (error) {
      console.error('敌方服务：加载人类模型失败 url=' + url, error);
      cache.set(modelId, null);
    }
  }

  return cache;
}

/**
 * 释放模型缓存中的模板几何体、材质与贴图。实例克隆使用自己的材质，
 * 因此这里只处理模板。
 *
 * @param {Map<string, Object|null>|null} cache
 * @returns {void}
 */
export function disposeHumanModelCache(cache) {
  if (cache === null || cache === undefined) {
    return;
  }
  for (const entry of cache.values()) {
    if (entry === null || entry === undefined || !entry.scene) {
      continue;
    }
    const geometries = new Set();
    const materials = new Set();
    entry.scene.traverse(function traverse(child) {
      if (child.isMesh && child.geometry) {
        geometries.add(child.geometry);
      }
      if (child.material) {
        let list = child.material;
        if (!Array.isArray(list)) {
          list = [list];
        }
        for (const material of list) {
          materials.add(material);
        }
      }
    });
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const material of materials) {
      if (material.map && typeof material.map.dispose === 'function') {
        material.map.dispose();
      }
      material.dispose();
    }
  }
  cache.clear();
}

/**
 * 释放对象树中的几何体与材质。作为敌方服务内部的通用辅助，
 * `enemy.js` 转导出它给弹丸与拾取物使用。
 *
 * @param {Object} root Three.js 对象树根节点。
 * @returns {void}
 */
export function disposeObject3D(root) {
  const geometries = new Set();
  const materials = new Set();

  root.traverse(function traverse(child) {
    if (child.isMesh && child.geometry) {
      geometries.add(child.geometry);
    }
    if (child.material) {
      let list = child.material;
      if (!Array.isArray(list)) {
        list = [list];
      }
      for (const material of list) {
        materials.add(material);
      }
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}

/**
 * 解析 Three 公共门面的能力，允许测试注入替身。
 *
 * @param {{ AnimationMixer?: Function, cloneSkinned?: Function }|undefined} overrides
 * @returns {{ AnimationMixer: Function|null, cloneSkinned: Function|null }}
 */
function resolveCapabilities(overrides) {
  let AnimationMixer = null;
  let cloneSkinned = null;

  if (overrides !== null && overrides !== undefined && typeof overrides === 'object') {
    if (typeof overrides.AnimationMixer === 'function') {
      AnimationMixer = overrides.AnimationMixer;
    }
    if (typeof overrides.cloneSkinned === 'function') {
      cloneSkinned = overrides.cloneSkinned;
    }
  }

  if (AnimationMixer === null && typeof providerThree.AnimationMixer === 'function') {
    AnimationMixer = providerThree.AnimationMixer;
  }
  if (cloneSkinned === null && typeof providerThree.cloneSkinned === 'function') {
    cloneSkinned = providerThree.cloneSkinned;
  }

  return { AnimationMixer, cloneSkinned };
}

/**
 * 创建一套装具材质。每个实例独立持有，便于受击/淡出与释放。
 *
 * @param {string} modelId
 * @returns {Record<string, Object>}
 */
function createGearMaterials(modelId) {
  let tint = VARIANT_GEAR_TINTS.adventurer;
  if (VARIANT_GEAR_TINTS[modelId] !== undefined) {
    tint = VARIANT_GEAR_TINTS[modelId];
  }

  return {
    helmet: new MeshStandardMaterial({
      color: tint.helmet,
      roughness: 0.72,
      metalness: 0.28
    }),
    mask: new MeshStandardMaterial({
      color: GEAR_PALETTE.mask,
      roughness: 0.86,
      metalness: 0.05
    }),
    vest: new MeshStandardMaterial({
      color: tint.vest,
      roughness: 0.88,
      metalness: 0.04
    }),
    pouch: new MeshStandardMaterial({
      color: tint.pouch,
      roughness: 0.9,
      metalness: 0.03
    }),
    gearBlack: new MeshStandardMaterial({
      color: GEAR_PALETTE.gearBlack,
      roughness: 0.82,
      metalness: 0.08
    }),
    khaki: new MeshStandardMaterial({
      color: GEAR_PALETTE.khaki,
      roughness: 0.9,
      metalness: 0.02
    }),
    armor: new MeshStandardMaterial({
      color: GEAR_PALETTE.armor,
      roughness: 0.66,
      metalness: 0.32
    }),
    rifleMetal: new MeshStandardMaterial({
      color: GEAR_PALETTE.rifleMetal,
      roughness: 0.5,
      metalness: 0.72
    }),
    riflePolymer: new MeshStandardMaterial({
      color: GEAR_PALETTE.riflePolymer,
      roughness: 0.8,
      metalness: 0.04
    })
  };
}

/**
 * 在对象树里按骨骼名查找第一个骨骼。
 *
 * @param {Object} rootObject
 * @param {string[]} names
 * @returns {Object|null}
 */
function findBone(rootObject, names) {
  if (rootObject === null || rootObject === undefined) {
    return null;
  }
  // 按候选名优先级查找：先找 WristL，再退回 MiddleHand.L / LowerArm.L。
  for (const name of names) {
    let found = null;
    rootObject.traverse(function traverse(child) {
      if (found !== null) {
        return;
      }
      if (child.isBone === true && child.name === name) {
        found = child;
      }
    });
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * 读取骨骼的世界缩放。
 *
 * Quaternius 模型的 `CharacterArmature` 自带 100 倍缩放（模型在 0.01 量级的
 * 局部坐标里建模）。装具如果直接挂到骨骼上，会继承这 100 倍缩放，变成覆盖
 * 屏幕的巨大面板。挂骨骼前必须先测量骨骼的真实世界缩放，再用它的倒数抵消。
 *
 * @param {Object} bone
 * @returns {Vector3}
 */
function readWorldScale(bone) {
  const scale = new Vector3(1, 1, 1);
  if (bone === null || bone === undefined) {
    return scale;
  }
  if (typeof bone.getWorldScale === 'function') {
    bone.getWorldScale(scale);
  }
  if (!Number.isFinite(scale.x) || scale.x <= 0) {
    scale.x = 1;
  }
  if (!Number.isFinite(scale.y) || scale.y <= 0) {
    scale.y = 1;
  }
  if (!Number.isFinite(scale.z) || scale.z <= 0) {
    scale.z = 1;
  }
  return scale;
}

/**
 * 构建程序化人类替身：橄榄军服、卡其装具、装备黑护具。用于 GLB 不可用时。
 *
 * @param {Object} parent
 * @param {number} heavyScale
 * @returns {{ group: Object, limbs: Object, meshes: Object[], materials: Object }}
 */
function buildFallbackBody(parent, heavyScale) {
  const uniform = new MeshStandardMaterial({
    color: GEAR_PALETTE.fallbackUniform,
    roughness: 0.88,
    metalness: 0.04
  });
  const skin = new MeshStandardMaterial({
    color: GEAR_PALETTE.fallbackSkin,
    roughness: 0.82,
    metalness: 0.02
  });
  const gear = new MeshStandardMaterial({
    color: GEAR_PALETTE.gearBlack,
    roughness: 0.84,
    metalness: 0.06
  });

  const group = new Group();
  group.name = 'fallback-human';
  group.scale.setScalar(heavyScale);

  const meshes = [];
  const materials = [uniform, skin, gear];

  /**
   * @param {Object} geometry
   * @param {Object} material
   * @param {{x:number,y:number,z:number}} position
   * @param {Object} [owner]
   * @returns {Object}
   */
  function addBodyMesh(geometry, material, position, owner) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = true;
    if (owner !== undefined) {
      owner.add(mesh);
    } else {
      group.add(mesh);
    }
    meshes.push(mesh);
    return mesh;
  }

  addBodyMesh(
    new BoxGeometry(0.44, 0.6, 0.26),
    uniform,
    { x: 0, y: 1.24, z: 0 }
  );
  addBodyMesh(
    new BoxGeometry(0.36, 0.2, 0.24),
    gear,
    { x: 0, y: 0.96, z: 0 }
  );
  addBodyMesh(
    new SphereGeometry(0.12, 12, 10),
    skin,
    { x: 0, y: 1.62, z: 0.01 }
  );
  addBodyMesh(
    new BoxGeometry(0.2, 0.1, 0.12),
    skin,
    { x: 0, y: 1.52, z: 0 }
  );

  const leftLeg = new Group();
  leftLeg.position.set(0.12, 0.9, 0);
  group.add(leftLeg);
  addBodyMesh(
    new BoxGeometry(0.16, 0.86, 0.18),
    uniform,
    { x: 0, y: -0.43, z: 0 },
    leftLeg
  );
  addBodyMesh(
    new BoxGeometry(0.15, 0.13, 0.26),
    gear,
    { x: 0, y: -0.83, z: 0.05 },
    leftLeg
  );

  const rightLeg = new Group();
  rightLeg.position.set(-0.12, 0.9, 0);
  group.add(rightLeg);
  addBodyMesh(
    new BoxGeometry(0.16, 0.86, 0.18),
    uniform,
    { x: 0, y: -0.43, z: 0 },
    rightLeg
  );
  addBodyMesh(
    new BoxGeometry(0.15, 0.13, 0.26),
    gear,
    { x: 0, y: -0.83, z: 0.05 },
    rightLeg
  );

  const leftArm = new Group();
  leftArm.position.set(0.29, 1.46, 0);
  group.add(leftArm);
  addBodyMesh(
    new BoxGeometry(0.11, 0.6, 0.12),
    uniform,
    { x: 0, y: -0.3, z: 0 },
    leftArm
  );
  addBodyMesh(
    new BoxGeometry(0.1, 0.1, 0.12),
    gear,
    { x: 0, y: -0.6, z: 0 },
    leftArm
  );

  const rightArm = new Group();
  rightArm.position.set(-0.29, 1.46, 0);
  group.add(rightArm);
  addBodyMesh(
    new BoxGeometry(0.11, 0.6, 0.12),
    uniform,
    { x: 0, y: -0.3, z: 0 },
    rightArm
  );
  addBodyMesh(
    new BoxGeometry(0.1, 0.1, 0.12),
    gear,
    { x: 0, y: -0.6, z: 0 },
    rightArm
  );

  parent.add(group);

  return {
    group,
    limbs: { leftLeg, rightLeg, leftArm, rightArm },
    meshes,
    materials
  };
}

/**
 * 把网格挂到骨骼或根节点。挂骨骼时用骨骼世界缩放的倒数抵消继承缩放，
 * 使装具尺寸与偏移按米计算；根节点缩放为 1，直接使用米。
 *
 * @param {Object} parent
 * @param {Object} geometry
 * @param {Object} material
 * @param {{x:number,y:number,z:number}} positionMeters
 * @param {Vector3|null} parentWorldScale 挂骨骼时的世界缩放；根节点传 null。
 * @param {string} name
 * @param {Object[]} ownedMeshes
 * @returns {Object}
 */
function addGearMesh(
  parent,
  geometry,
  material,
  positionMeters,
  parentWorldScale,
  name,
  ownedMeshes
) {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.equipment = name;
  if (parentWorldScale === null) {
    mesh.position.set(positionMeters.x, positionMeters.y, positionMeters.z);
  } else {
    mesh.scale.set(
      1 / parentWorldScale.x,
      1 / parentWorldScale.y,
      1 / parentWorldScale.z
    );
    mesh.position.set(
      positionMeters.x / parentWorldScale.x,
      positionMeters.y / parentWorldScale.y,
      positionMeters.z / parentWorldScale.z
    );
  }
  parent.add(mesh);
  ownedMeshes.push(mesh);
  return mesh;
}

/**
 * 构建头盔、面罩、背心、弹匣袋、护膝、手套、靴子、重甲与步枪。
 *
 * @param {{
 *   root: Object,
 *   modelRoot: Object|null,
 *   type: string,
 *   modelId: string,
 *   materials: Record<string, Object>,
 *   ownedMeshes: Object[],
 *   equipmentNames: string[],
 *   isFallback: boolean
 * }} options
 * @returns {{ weaponMount: Object|null, muzzleFlash: Object|null, headBone: Object|null, rightHand: Object|null }}
 */
function buildEquipment(options) {
  const root = options.root;
  const modelRoot = options.modelRoot;
  const type = options.type;
  const materials = options.materials;
  const ownedMeshes = options.ownedMeshes;
  const equipmentNames = options.equipmentNames;
  const isFallback = options.isFallback;
  const heavy = type === ENEMY_TYPES.HEAVY;
  const breacher = type === ENEMY_TYPES.BREACHER;

  // 骨骼世界缩放（含 CharacterArmature 的 100 倍）必须先完成矩阵更新再测量。
  if (modelRoot !== null) {
    root.updateMatrixWorld(true);
  }

  let headBone = null;
  let hipsBone = null;
  let leftHand = null;
  let rightHand = null;
  let leftLowerLeg = null;
  let rightLowerLeg = null;
  let leftFoot = null;
  let rightFoot = null;
  let leftUpperArm = null;
  let rightUpperArm = null;
  let leftUpperLeg = null;
  let rightUpperLeg = null;

  if (!isFallback && modelRoot !== null) {
    headBone = findBone(modelRoot, ['Head']);
    hipsBone = findBone(modelRoot, ['Hips', 'Pelvis']);
    leftHand = findBone(modelRoot, ['WristL', 'MiddleHand.L', 'LowerArm.L', 'Hand.L', 'LowerArmL', 'HandL']);
    rightHand = findBone(modelRoot, ['WristR', 'MiddleHand.R', 'LowerArm.R', 'Hand.R', 'LowerArmR', 'HandR']);
    leftLowerLeg = findBone(modelRoot, ['LowerLegL', 'LowerLeg.L']);
    rightLowerLeg = findBone(modelRoot, ['LowerLegR', 'LowerLeg.R']);
    leftFoot = findBone(modelRoot, ['FootL', 'Foot.L']);
    rightFoot = findBone(modelRoot, ['FootR', 'Foot.R']);
    leftUpperArm = findBone(modelRoot, ['UpperArmL', 'UpperArm.L']);
    rightUpperArm = findBone(modelRoot, ['UpperArmR', 'UpperArm.R']);
    leftUpperLeg = findBone(modelRoot, ['UpperLegL', 'UpperLeg.L']);
    rightUpperLeg = findBone(modelRoot, ['UpperLegR', 'UpperLeg.R']);
  }

  /**
   * 骨骼存在时挂骨骼并用骨骼世界缩放抵消继承缩放，否则退回根节点固定位置。
   */
  function attach(piece, bone, bonePosition, rootPosition) {
    if (bone !== null) {
      const boneWorldScale = readWorldScale(bone);
      addGearMesh(
        bone,
        piece.geometry,
        piece.material,
        bonePosition,
        boneWorldScale,
        piece.name,
        ownedMeshes
      );
      equipmentNames.push(piece.name);
      return;
    }
    addGearMesh(
      root,
      piece.geometry,
      piece.material,
      rootPosition,
      null,
      piece.name,
      ownedMeshes
    );
    equipmentNames.push(piece.name);
  }

  attach(
    {
      name: 'helmet',
      geometry: new SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      material: materials.helmet
    },
    headBone,
    { x: 0, y: 0.1, z: -0.01 },
    { x: 0, y: 1.7, z: -0.01 }
  );
  attach(
    {
      name: 'helmet-brim',
      geometry: new BoxGeometry(0.22, 0.025, 0.1),
      material: materials.helmet
    },
    headBone,
    { x: 0, y: 0.09, z: 0.11 },
    { x: 0, y: 1.68, z: 0.11 }
  );
  attach(
    {
      name: 'face-mask',
      geometry: new BoxGeometry(0.17, 0.1, 0.1),
      material: materials.mask
    },
    headBone,
    { x: 0, y: 0.01, z: 0.11 },
    { x: 0, y: 1.58, z: 0.11 }
  );
  attach(
    {
      name: 'vest',
      geometry: new BoxGeometry(0.46, 0.42, 0.33),
      material: materials.vest
    },
    hipsBone,
    { x: 0, y: 0.34, z: 0 },
    { x: 0, y: 1.3, z: 0 }
  );

  if (!breacher) {
    attach(
      {
        name: 'mag-pouches',
        geometry: new BoxGeometry(0.3, 0.11, 0.1),
        material: materials.pouch
      },
      hipsBone,
      { x: 0, y: 0.3, z: 0.17 },
      { x: 0, y: 1.27, z: 0.17 }
    );
    attach(
      {
        name: 'side-pouch',
        geometry: new BoxGeometry(0.09, 0.12, 0.14),
        material: materials.pouch
      },
      hipsBone,
      { x: 0.22, y: 0.26, z: 0.02 },
      { x: 0.22, y: 1.24, z: 0.02 }
    );
  }

  attach(
    {
      name: 'knee-pad-left',
      geometry: new BoxGeometry(0.14, 0.14, 0.1),
      material: materials.gearBlack
    },
    leftLowerLeg,
    { x: 0, y: 0.06, z: 0.1 },
    { x: 0.12, y: 0.52, z: 0.1 }
  );
  attach(
    {
      name: 'knee-pad-right',
      geometry: new BoxGeometry(0.14, 0.14, 0.1),
      material: materials.gearBlack
    },
    rightLowerLeg,
    { x: 0, y: 0.06, z: 0.1 },
    { x: -0.12, y: 0.52, z: 0.1 }
  );
  attach(
    {
      name: 'glove-left',
      geometry: new BoxGeometry(0.1, 0.13, 0.11),
      material: materials.gearBlack
    },
    leftHand,
    { x: 0, y: -0.05, z: 0.02 },
    { x: 0.29, y: 1.0, z: 0.03 }
  );
  attach(
    {
      name: 'glove-right',
      geometry: new BoxGeometry(0.1, 0.13, 0.11),
      material: materials.gearBlack
    },
    rightHand,
    { x: 0, y: -0.05, z: 0.02 },
    { x: -0.29, y: 1.0, z: 0.03 }
  );
  attach(
    {
      name: 'boot-left',
      geometry: new BoxGeometry(0.16, 0.13, 0.27),
      material: materials.gearBlack
    },
    leftFoot,
    { x: 0, y: 0.02, z: 0.06 },
    { x: 0.12, y: 0.08, z: 0.06 }
  );
  attach(
    {
      name: 'boot-right',
      geometry: new BoxGeometry(0.16, 0.13, 0.27),
      material: materials.gearBlack
    },
    rightFoot,
    { x: 0, y: 0.02, z: 0.06 },
    { x: -0.12, y: 0.08, z: 0.06 }
  );

  if (breacher) {
    attach(
      {
        name: 'forearm-guard-left',
        geometry: new BoxGeometry(0.12, 0.16, 0.13),
        material: materials.khaki
      },
      leftHand,
      { x: 0, y: 0.08, z: 0.02 },
      { x: 0.29, y: 1.12, z: 0.03 }
    );
    attach(
      {
        name: 'forearm-guard-right',
        geometry: new BoxGeometry(0.12, 0.16, 0.13),
        material: materials.khaki
      },
      rightHand,
      { x: 0, y: 0.08, z: 0.02 },
      { x: -0.29, y: 1.12, z: 0.03 }
    );
  }

  if (heavy) {
    attach(
      {
        name: 'chest-plate',
        geometry: new BoxGeometry(0.4, 0.32, 0.07),
        material: materials.armor
      },
      hipsBone,
      { x: 0, y: 0.36, z: 0.18 },
      { x: 0, y: 1.32, z: 0.18 }
    );
    attach(
      {
        name: 'shoulder-armor-left',
        geometry: new BoxGeometry(0.18, 0.1, 0.26),
        material: materials.armor
      },
      leftUpperArm,
      { x: 0.04, y: 0.05, z: 0 },
      { x: 0.34, y: 1.48, z: 0 }
    );
    attach(
      {
        name: 'shoulder-armor-right',
        geometry: new BoxGeometry(0.18, 0.1, 0.26),
        material: materials.armor
      },
      rightUpperArm,
      { x: -0.04, y: 0.05, z: 0 },
      { x: -0.34, y: 1.48, z: 0 }
    );
    attach(
      {
        name: 'leg-plate-left',
        geometry: new BoxGeometry(0.15, 0.26, 0.09),
        material: materials.armor
      },
      leftUpperLeg,
      { x: 0, y: -0.1, z: 0.09 },
      { x: 0.12, y: 0.66, z: 0.09 }
    );
    attach(
      {
        name: 'leg-plate-right',
        geometry: new BoxGeometry(0.15, 0.26, 0.09),
        material: materials.armor
      },
      rightUpperLeg,
      { x: 0, y: -0.1, z: 0.09 },
      { x: -0.12, y: 0.66, z: 0.09 }
    );
  }

  if (breacher) {
    return { weaponMount: null, muzzleFlash: null, headBone, rightHand: null };
  }

  let heavyScale = 1;
  if (heavy) {
    heavyScale = HEAVY_SCALE_MULTIPLIER;
  }
  const weaponMount = new Group();
  weaponMount.name = 'weapon-mount';
  weaponMount.position.set(0.18 * heavyScale, 1.28 * heavyScale, 0.18 * heavyScale);
  weaponMount.scale.setScalar(heavyScale);
  root.add(weaponMount);

  const rifle = new Group();
  rifle.name = 'rifle';
  rifle.userData.equipment = 'rifle';
  weaponMount.add(rifle);

  /**
   * @param {Object} geometry
   * @param {Object} material
   * @param {{x:number,y:number,z:number}} position
   * @param {{rx?:number}} [rotation]
   * @returns {Object}
   */
  function addRiflePart(geometry, material, position, rotation) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    if (rotation !== undefined && rotation.rx !== undefined) {
      mesh.rotation.x = rotation.rx;
    }
    mesh.castShadow = true;
    mesh.userData.equipment = 'rifle';
    rifle.add(mesh);
    ownedMeshes.push(mesh);
    return mesh;
  }

  addRiflePart(
    new BoxGeometry(0.06, 0.09, 0.44),
    materials.rifleMetal,
    { x: 0, y: 0, z: 0.08 }
  );
  addRiflePart(
    new CylinderGeometry(0.018, 0.018, 0.4, 8),
    materials.rifleMetal,
    { x: 0, y: 0.01, z: 0.45 },
    { rx: Math.PI / 2 }
  );
  addRiflePart(
    new BoxGeometry(0.055, 0.09, 0.18),
    materials.riflePolymer,
    { x: 0, y: -0.01, z: -0.2 }
  );
  addRiflePart(
    new BoxGeometry(0.045, 0.15, 0.09),
    materials.riflePolymer,
    { x: 0, y: -0.11, z: 0.08 }
  );
  addRiflePart(
    new BoxGeometry(0.045, 0.05, 0.16),
    materials.rifleMetal,
    { x: 0, y: 0.07, z: 0.03 }
  );
  equipmentNames.push('rifle');

  const muzzleFlash = new Mesh(
    new ConeGeometry(0.055, 0.16, 6),
    new MeshBasicMaterial({
      color: 0xffcf7a,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  muzzleFlash.name = 'muzzle-flash';
  muzzleFlash.rotation.x = Math.PI / 2;
  muzzleFlash.position.set(0, 0.01, 0.7);
  muzzleFlash.visible = false;
  weaponMount.add(muzzleFlash);
  ownedMeshes.push(muzzleFlash);

  return { weaponMount, muzzleFlash, headBone, rightHand };
}

/**
 * 创建一个人类士兵可视化实例。
 *
 * @param {{
 *   type: string,
 *   modelId: string,
 *   targetId: string,
 *   model?: { scene: Object, animations: unknown[], scale: number }|null,
 *   capabilities?: { AnimationMixer?: Function, cloneSkinned?: Function }
 * }} options
 * @returns {Object}
 */
export function createHumanVisual(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createHumanVisual 需要 options 对象');
  }
  const type = options.type;
  if (
    type !== ENEMY_TYPES.RIFLEMAN &&
    type !== ENEMY_TYPES.HEAVY &&
    type !== ENEMY_TYPES.BREACHER
  ) {
    throw new RangeError('createHumanVisual: 未知敌人类型 ' + String(type));
  }
  if (typeof options.targetId !== 'string' || options.targetId.length === 0) {
    throw new TypeError('createHumanVisual: targetId 必须是非空字符串');
  }

  const modelId = options.modelId;
  const definition = getModelDefinition(modelId);
  const heavy = type === ENEMY_TYPES.HEAVY;
  const capabilities = resolveCapabilities(options.capabilities);

  let model = options.model;
  if (model === undefined) {
    model = null;
  }

  let baseScale = definition.defaultScale;
  if (model !== null && typeof model.scale === 'number' && model.scale > 0) {
    baseScale = model.scale;
  }
  let visualScale = baseScale;
  if (heavy) {
    visualScale = baseScale * HEAVY_SCALE_MULTIPLIER;
  }
  let hitboxScale = 1;
  if (heavy) {
    hitboxScale = HEAVY_SCALE_MULTIPLIER;
  }

  const root = new Group();
  root.name = 'human-soldier-' + type;

  const ownedMeshes = [];
  const equipmentNames = [];
  const clonedMaterials = [];
  const allMaterials = new Set();
  const flashMaterialBases = [];

  let isFallback = false;
  let modelRoot = null;
  let mixer = null;
  let animations = [];
  let clips = null;
  let clipLookup = new Map();
  let actionCache = new Map();
  let currentAction = null;
  let currentClipName = null;
  let currentState = 'idle';
  let oneShot = null;
  let reloading = false;
  let walkingSpeed = 0;
  let moving = false;
  let muzzleFlashTimer = 0;
  let hitFlashTimer = 0;
  let dead = false;
  let disposed = false;
  let corpseAge = 0;
  let manualPhase = 0;
  let deathTiltAge = 0;
  let fallbackBody = null;
  let headBone = null;
  let rightHand = null;
  const handScratch = new Vector3();

  const canClone =
    model !== null &&
    model.scene !== null &&
    model.scene !== undefined &&
    capabilities.cloneSkinned !== null;

  if (canClone) {
    try {
      modelRoot = capabilities.cloneSkinned(model.scene);
    } catch (error) {
      console.error('敌方服务：克隆人类模型失败，使用程序化回退。', error);
      modelRoot = null;
    }
  }

  if (modelRoot !== null) {
    modelRoot.scale.setScalar(visualScale);
    root.add(modelRoot);

    modelRoot.traverse(function traverse(child) {
      if (!child.isMesh || !child.material) {
        return;
      }
      let materials = child.material;
      if (!Array.isArray(materials)) {
        materials = [materials];
      }
      const cloned = [];
      for (const material of materials) {
        let color = 0x8a8f7f;
        let roughness = 0.85;
        let metalness = 0.05;
        if (material.color && typeof material.color.getHex === 'function') {
          color = material.color.getHex();
        }
        if (typeof material.roughness === 'number') {
          roughness = material.roughness;
        }
        if (typeof material.metalness === 'number') {
          metalness = material.metalness;
        }
        const copy = new MeshStandardMaterial({
          color,
          roughness,
          metalness
        });
        clonedMaterials.push(copy);
        allMaterials.add(copy);
        cloned.push(copy);
      }
      if (cloned.length === 1) {
        child.material = cloned[0];
      } else {
        child.material = cloned;
      }
    });

    animations = model.animations;
    if (!Array.isArray(animations)) {
      animations = [];
    }
    clips = resolveAnimationClipMap({ modelId, type, animations });

    if (capabilities.AnimationMixer !== null) {
      try {
        mixer = new capabilities.AnimationMixer(modelRoot);
      } catch (error) {
        console.error(
          '敌方服务：创建 AnimationMixer 失败，人类士兵保持静态姿势。',
          error
        );
        mixer = null;
      }
    } else if (!capabilityWarnings.mixer) {
      capabilityWarnings.mixer = true;
      console.error(
        '敌方服务：Three 公开门面缺少 AnimationMixer，人类士兵将保持静态姿势。'
      );
    }
  } else {
    isFallback = true;
    if (model !== null && model.scene && capabilities.cloneSkinned === null) {
      if (!capabilityWarnings.clone) {
        capabilityWarnings.clone = true;
        console.error(
          '敌方服务：Three 公开门面缺少 cloneSkinned，人类士兵使用程序化回退。'
        );
      }
    }
    let fallbackScale = 1;
    if (heavy) {
      fallbackScale = HEAVY_SCALE_MULTIPLIER;
    }
    fallbackBody = buildFallbackBody(root, fallbackScale);
    for (const mesh of fallbackBody.meshes) {
      ownedMeshes.push(mesh);
    }
    for (const material of fallbackBody.materials) {
      allMaterials.add(material);
    }
    clips = resolveAnimationClipMap({ modelId, type, animations: [] });
  }

  if (clips !== null) {
    for (const name of Object.keys(clips)) {
      if (clips[name] !== null) {
        for (const animation of animations) {
          const animationName = readAnimationName(animation);
          if (animationName === clips[name]) {
            clipLookup.set(animationName, animation);
            break;
          }
        }
      }
    }
  }

  const gearMaterials = createGearMaterials(modelId);
  for (const key of Object.keys(gearMaterials)) {
    allMaterials.add(gearMaterials[key]);
  }

  const equipment = buildEquipment({
    root,
    modelRoot,
    type,
    modelId,
    materials: gearMaterials,
    ownedMeshes,
    equipmentNames,
    isFallback
  });
  headBone = equipment.headBone;
  rightHand = equipment.rightHand;

  // 受击闪白只作用于身体材质（模型或程序化身体），不照亮装具。
  const bodyMaterials = [];
  if (isFallback && fallbackBody !== null) {
    for (const material of fallbackBody.materials) {
      bodyMaterials.push(material);
    }
  } else {
    for (const material of clonedMaterials) {
      bodyMaterials.push(material);
    }
  }
  for (const material of bodyMaterials) {
    if (material.emissive && typeof material.emissive.getHex === 'function') {
      flashMaterialBases.push({
        material,
        emissiveHex: material.emissive.getHex(),
        emissiveIntensity: material.emissiveIntensity
      });
    }
  }

  const hitboxConfig = GAME_CONFIG.enemies[type].hitbox;
  const hitboxMaterial = new MeshBasicMaterial({ visible: false });
  const headGeometry = new BoxGeometry(
    hitboxConfig.head.width * hitboxScale,
    hitboxConfig.head.height * hitboxScale,
    hitboxConfig.head.depth * hitboxScale
  );
  const bodyGeometry = new BoxGeometry(
    hitboxConfig.body.width * hitboxScale,
    hitboxConfig.body.height * hitboxScale,
    hitboxConfig.body.depth * hitboxScale
  );

  const headHitbox = new Mesh(headGeometry, hitboxMaterial);
  headHitbox.name = 'hitbox-head';
  headHitbox.position.set(0, hitboxConfig.head.offsetY * hitboxScale, 0);
  headHitbox.userData.targetId = options.targetId + ':head';
  headHitbox.userData.part = 'head';
  headHitbox.visible = false;
  root.add(headHitbox);
  ownedMeshes.push(headHitbox);

  const bodyHitbox = new Mesh(bodyGeometry, hitboxMaterial);
  bodyHitbox.name = 'hitbox-body';
  bodyHitbox.position.set(0, hitboxConfig.body.offsetY * hitboxScale, 0);
  bodyHitbox.userData.targetId = options.targetId + ':body';
  bodyHitbox.userData.part = 'body';
  bodyHitbox.visible = false;
  root.add(bodyHitbox);
  ownedMeshes.push(bodyHitbox);

  /**
   * @param {string} name
   * @returns {number}
   */
  function getClipDuration(name) {
    const clip = clipLookup.get(name);
    if (clip !== null && clip !== undefined) {
      if (typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0) {
        return clip.duration;
      }
    }
    if (name === clips.hit) {
      return ANIMATION_BEHAVIOR.hitFallbackDuration;
    }
    if (name === clips.attack || name === clips.attackLeft || name === clips.attackRight) {
      return ANIMATION_BEHAVIOR.attackFallbackDuration;
    }
    return ANIMATION_BEHAVIOR.attackFallbackDuration;
  }

  /**
   * 播放一个片段；相同片段不会重复重置。
   *
   * @param {string} name
   * @param {boolean} loopOnce
   * @param {number} fade
   * @returns {string|null}
   */
  function playAction(name, loopOnce, fade) {
    if (mixer === null || name === null || name === undefined) {
      return null;
    }
    const clip = clipLookup.get(name);
    if (clip === undefined) {
      return null;
    }
    let action = actionCache.get(name);
    if (action === undefined) {
      action = mixer.clipAction(clip);
      actionCache.set(name, action);
    }
    if (action === currentAction) {
      return name;
    }
    action.reset();
    if (loopOnce) {
      action.setLoop(LOOP_ONCE, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(LOOP_REPEAT, Number.POSITIVE_INFINITY);
      action.clampWhenFinished = false;
    }
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    if (currentAction !== null) {
      currentAction.crossFadeTo(action, fade, false);
    } else {
      action.fadeIn(fade);
    }
    currentAction = action;
    currentClipName = name;
    return name;
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  function setFlash(active) {
    for (const entry of flashMaterialBases) {
      if (active) {
        entry.material.emissive.setHex(0xffffff);
        entry.material.emissiveIntensity = 0.85;
      } else {
        entry.material.emissive.setHex(entry.emissiveHex);
        entry.material.emissiveIntensity = entry.emissiveIntensity;
      }
    }
  }

  /**
   * 切换动画状态。缺失片段时保持原状态（受击只闪白）。
   *
   * @param {string} state
   * @param {number} fade
   * @returns {string|null}
   */
  function setState(state, fade) {
    if (dead && state !== 'death') {
      return null;
    }

    let clipName = null;
    if (clips !== null) {
      clipName = clips[state];
    }
    if (clipName === null || clipName === undefined) {
      if (state === 'hit') {
        flashHit();
        return null;
      }
      if (state === 'attack' || state === 'attackLeft' || state === 'attackRight') {
        flashHit();
        return null;
      }
      if (state === 'runShoot') {
        return setState('run', fade);
      }
      if (state === 'shoot') {
        return setState('idle', fade);
      }
      if (state === 'run') {
        return setState('walk', fade);
      }
      if (state === 'walk') {
        return setState('idle', fade);
      }
      return null;
    }

    if (state === 'hit' || state === 'attack' || state === 'attackLeft' || state === 'attackRight') {
      let returnState = currentState;
      if (
        returnState === 'hit' ||
        returnState === 'attack' ||
        returnState === 'attackLeft' ||
        returnState === 'attackRight' ||
        returnState === 'death'
      ) {
        returnState = 'idle';
      }
      if (oneShot === null || oneShot.state !== state) {
        oneShot = {
          state,
          remaining: getClipDuration(clipName),
          returnState
        };
      }
      playAction(clipName, true, fade);
      currentState = state;
      return clipName;
    }

    oneShot = null;
    playAction(clipName, false, fade);
    currentState = state;
    return clipName;
  }

  /**
   * 受击反馈：闪白；有 HitRecieve 时播放一次受击动作。
   *
   * @returns {void}
   */
  function flashHit() {
    hitFlashTimer = ANIMATION_BEHAVIOR.hitFlashDuration;
    setFlash(true);
  }

  /**
   * 切换移动/射击动画。速度决定 Run/Walk；开火时优先射击动作。
   *
   * @param {{ speed: number, moving: boolean, firing: boolean }} motion
   * @returns {void}
   */
  function setLocomotion(motion) {
    if (dead) {
      return;
    }
    walkingSpeed = motion.speed;
    moving = motion.moving;
    if (oneShot !== null) {
      return;
    }
    if (type === ENEMY_TYPES.BREACHER) {
      if (motion.moving) {
        if (motion.speed > 2.2) {
          setState('run', ANIMATION_BEHAVIOR.defaultFade);
        } else {
          setState('walk', ANIMATION_BEHAVIOR.defaultFade);
        }
        return;
      }
      setState('idle', ANIMATION_BEHAVIOR.defaultFade);
      return;
    }

    if (motion.firing) {
      if (motion.moving) {
        setState('runShoot', ANIMATION_BEHAVIOR.defaultFade);
      } else {
        setState('shoot', ANIMATION_BEHAVIOR.defaultFade);
      }
      return;
    }
    if (motion.moving) {
      if (motion.speed > 2.2) {
        setState('run', ANIMATION_BEHAVIOR.defaultFade);
      } else {
        setState('walk', ANIMATION_BEHAVIOR.defaultFade);
      }
      return;
    }
    setState('idle', ANIMATION_BEHAVIOR.defaultFade);
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  function setReloading(active) {
    reloading = active;
  }

  /**
   * 播一次近战攻击。
   *
   * @returns {string|null}
   */
  function playAttack() {
    if (dead) {
      return null;
    }
    return setState('attack', ANIMATION_BEHAVIOR.attackFade);
  }

  /**
   * 开始死亡：立即隐藏命中盒，播放 Death；没有 Death 片段时保持最后姿势。
   *
   * @returns {void}
   */
  function startDeath() {
    if (dead) {
      return;
    }
    dead = true;
    oneShot = null;
    headHitbox.visible = false;
    bodyHitbox.visible = false;
    if (clips !== null && clips.death !== null && clips.death !== undefined) {
      playAction(clips.death, true, ANIMATION_BEHAVIOR.deathFade);
      currentState = 'death';
    } else {
      currentState = 'death';
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    if (disposed) {
      return;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      return;
    }

    if (hitFlashTimer > 0) {
      hitFlashTimer -= dt;
      if (hitFlashTimer <= 0) {
        hitFlashTimer = 0;
        setFlash(false);
      }
    }

    if (muzzleFlashTimer > 0) {
      muzzleFlashTimer -= dt;
      if (muzzleFlashTimer <= 0) {
        muzzleFlashTimer = 0;
        if (equipment.muzzleFlash !== null) {
          equipment.muzzleFlash.visible = false;
        }
      }
    }

    if (equipment.weaponMount !== null) {
      let targetTilt = 0;
      if (reloading) {
        targetTilt = ANIMATION_BEHAVIOR.reloadTilt;
      }
      const factor = Math.min(1, dt * ANIMATION_BEHAVIOR.reloadTiltRate);
      equipment.weaponMount.rotation.x +=
        (targetTilt - equipment.weaponMount.rotation.x) * factor;
    }
    if (headBone !== null && reloading) {
      const factor = Math.min(1, dt * ANIMATION_BEHAVIOR.reloadTiltRate);
      headBone.rotation.x +=
        (ANIMATION_BEHAVIOR.reloadHeadTilt - headBone.rotation.x) * factor;
    }

    if (mixer !== null) {
      let scale = 1;
      if (!dead && oneShot === null && moving) {
        let reference = ANIMATION_BEHAVIOR.walkReferenceSpeed;
        if (currentState === 'run' || currentState === 'runShoot') {
          reference = ANIMATION_BEHAVIOR.runReferenceSpeed;
        }
        scale = walkingSpeed / reference;
        if (scale < ANIMATION_BEHAVIOR.minTimeScale) {
          scale = ANIMATION_BEHAVIOR.minTimeScale;
        }
        if (scale > ANIMATION_BEHAVIOR.maxTimeScale) {
          scale = ANIMATION_BEHAVIOR.maxTimeScale;
        }
      }
      mixer.timeScale = scale;
      mixer.update(dt);
    }

    // 步枪挂在敌人根节点（不继承骨骼的 100 倍缩放），但每帧把挂点移到
    // 右手的骨骼世界位置，让枪跟随手臂动画、始终保持在手边。
    if (rightHand !== null && equipment.weaponMount !== null) {
      rightHand.getWorldPosition(handScratch);
      root.worldToLocal(handScratch);
      const gripScale = equipment.weaponMount.scale.x;
      equipment.weaponMount.position.set(
        handScratch.x,
        handScratch.y + 0.02 * gripScale,
        handScratch.z + 0.03 * gripScale
      );
    }

    if (oneShot !== null) {
      oneShot.remaining -= dt;
      if (oneShot.remaining <= 0) {
        const returnState = oneShot.returnState;
        oneShot = null;
        if (!dead) {
          setState(returnState, ANIMATION_BEHAVIOR.defaultFade);
        }
      }
    }

    if (isFallback && fallbackBody !== null) {
      const limbs = fallbackBody.limbs;
      if (dead) {
        deathTiltAge += dt;
        let tilt = deathTiltAge / 0.6;
        if (tilt > 1) {
          tilt = 1;
        }
        fallbackBody.group.rotation.z = -tilt * (Math.PI / 2);
        fallbackBody.group.position.y = -tilt * 0.35;
      } else {
        let swing = 0;
        if (moving) {
          swing = walkingSpeed / 4.5;
          if (swing > 1) {
            swing = 1;
          }
          if (swing < 0.2) {
            swing = 0.2;
          }
          manualPhase += dt * (1.6 + walkingSpeed) * 2;
        } else {
          manualPhase += dt * 1.4;
        }
        const legSwing = Math.sin(manualPhase) * 0.55 * swing;
        const armSwing = Math.sin(manualPhase) * 0.35 * swing;
        limbs.leftLeg.rotation.x = legSwing;
        limbs.rightLeg.rotation.x = -legSwing;
        limbs.leftArm.rotation.x = -armSwing;
        limbs.rightArm.rotation.x = armSwing;
      }
    }
  }

  /**
   * 推进尸体计时；最后 1 秒降低不透明度。
   *
   * @param {number} dt
   * @returns {boolean} 是否已经可以移除。
   */
  function updateCorpse(dt) {
    if (disposed) {
      return true;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      return false;
    }
    corpseAge += dt;
    if (corpseAge >= CORPSE_LIFETIME) {
      return true;
    }
    const fadeStart = CORPSE_LIFETIME - CORPSE_FADE_DURATION;
    if (corpseAge > fadeStart) {
      let opacity = (CORPSE_LIFETIME - corpseAge) / CORPSE_FADE_DURATION;
      if (opacity < 0) {
        opacity = 0;
      }
      setOpacity(opacity);
    }
    return false;
  }

  /**
   * @param {number} value
   * @returns {void}
   */
  function setOpacity(value) {
    for (const material of allMaterials) {
      material.transparent = true;
      material.opacity = value;
    }
  }

  /**
   * 显示枪口闪光约 0.05 秒。
   *
   * @returns {void}
   */
  function showMuzzleFlash() {
    if (equipment.muzzleFlash === null) {
      return;
    }
    equipment.muzzleFlash.visible = true;
    muzzleFlashTimer = ANIMATION_BEHAVIOR.muzzleFlashDuration;
  }

  /**
   * 枪口相对脚底原点的局部偏移（米），已按兵种缩放。
   *
   * @returns {{ x:number, y:number, z:number }}
   */
  function getMuzzleOffset() {
    if (equipment.weaponMount === null) {
      return { x: 0, y: 1.35, z: 0.35 };
    }
    const mount = equipment.weaponMount;
    return {
      x: mount.position.x,
      y: mount.position.y + 0.02 * mount.scale.x,
      z: mount.position.z + 0.7 * mount.scale.x
    };
  }

  /**
   * 命中位置（相对脚底）：头部约 1.62 m，身体约 0.98 m；重机枪手按 1.12 放大。
   *
   * @param {'head'|'body'} part
   * @returns {{ x:number, y:number, z:number }}
   */
  function getHitPosition(part) {
    let offsetY = hitboxConfig.body.offsetY * hitboxScale;
    if (part === 'head') {
      offsetY = hitboxConfig.head.offsetY * hitboxScale;
    }
    return {
      x: root.position.x,
      y: root.position.y + offsetY,
      z: root.position.z
    };
  }

  /**
   * 血液喷射方向：从敌人身后（远离玩家的一侧）向外。
   *
   * @returns {{ x:number, y:number, z:number }}
   */
  function getSprayDirection() {
    const yaw = root.rotation.y;
    return { x: -Math.sin(yaw), y: 0.25, z: -Math.cos(yaw) };
  }

  /**
   * @returns {Object[]}
   */
  function listHitboxes() {
    if (dead) {
      return [];
    }
    return [headHitbox, bodyHitbox];
  }

  /**
   * @returns {string[]}
   */
  function getEquipmentNames() {
    const unique = [];
    for (const name of equipmentNames) {
      if (!unique.includes(name)) {
        unique.push(name);
      }
    }
    return unique;
  }

  /**
   * 释放实例资源。模型几何体与模板材质由上层模型缓存统一释放；这里释放
   * 实例自己的材质、装具/命中盒几何体与混合器。
   *
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;

    if (mixer !== null && typeof mixer.stopAllAction === 'function') {
      mixer.stopAllAction();
    }
    actionCache.clear();
    clipLookup.clear();

    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    for (const mesh of ownedMeshes) {
      if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        let materials = mesh.material;
        if (!Array.isArray(materials)) {
          materials = [materials];
        }
        for (const material of materials) {
          if (!disposedMaterials.has(material)) {
            disposedMaterials.add(material);
            material.dispose();
          }
        }
      }
    }
    for (const material of clonedMaterials) {
      if (!disposedMaterials.has(material)) {
        disposedMaterials.add(material);
        material.dispose();
      }
    }
    for (const key of Object.keys(gearMaterials)) {
      const material = gearMaterials[key];
      if (!disposedMaterials.has(material)) {
        disposedMaterials.add(material);
        material.dispose();
      }
    }

    if (root.parent !== null && root.parent !== undefined) {
      root.parent.remove(root);
    }
  }

  return {
    root,
    type,
    modelId,
    visualScale,
    hitboxScale,
    clips,
    mixer,
    listHitboxes,
    getHitPosition,
    getSprayDirection,
    getMuzzleOffset,
    setLocomotion,
    setReloading,
    playHit: function playHit() {
      flashHit();
      setState('hit', ANIMATION_BEHAVIOR.hitFade);
    },
    playAttack,
    startDeath,
    update,
    updateCorpse,
    showMuzzleFlash,
    isMuzzleFlashVisible: function isMuzzleFlashVisible() {
      if (equipment.muzzleFlash === null) {
        return false;
      }
      return equipment.muzzleFlash.visible;
    },
    getCurrentState: function getCurrentState() {
      return currentState;
    },
    getCurrentClip: function getCurrentClip() {
      return currentClipName;
    },
    getEquipmentNames,
    isFallback: function isFallbackVisual() {
      return isFallback;
    },
    isDead: function isDead() {
      return dead;
    },
    isDisposed: function isDisposed() {
      return disposed;
    },
    dispose
  };
}
