/**
 * 人类士兵可视化单元测试。
 *
 * 覆盖：
 * - 四个 GLB 的模型映射、步枪兵变体池、重机枪手 1.12 放大。
 * - CharacterArmature 与 HumanArmature 的动画名映射与缺失回退。
 * - 头/身命中盒的部位、位置与尺寸。
 * - 爆头结果（headshot / critical 同义）。
 * - 死亡立即移出可命中列表、4 秒后淡出可移除。
 * - 装具存在性与骨骼挂载；重甲与突击兵差异。
 * - 模型缓存加载、失败回退与具体 URL 日志。
 * - dispose 幂等；不存在 drone / brute / wraith 类型。
 *
 * 使用假渲染器、假素材加载器、假 AnimationMixer / cloneSkinned 与真实
 * asset-manifest.json；不创建 WebGL 上下文。执行命令：
 * node --test test/敌方服务/human-visual.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ENEMY_TYPES,
  GAME_CONFIG
} from '../../src/models/game-config.js';
import {
  Group,
  Object3D,
  Mesh,
  Box3,
  Vector3,
  BoxGeometry,
  MeshStandardMaterial
} from '../../src/providers/public/three.js';
import { createEnemies } from '../../src/services/public/enemies.js';
import {
  HUMAN_MODEL_DEFINITIONS,
  HUMAN_MODEL_IDS,
  HEAVY_SCALE_MULTIPLIER,
  CORPSE_LIFETIME,
  resolveAnimationClipMap,
  loadHumanModelCache,
  createHumanVisual,
  disposeHumanModelCache
} from '../../src/services/impl/enemies/human-visual.js';

const manifestPath = fileURLToPath(
  new URL('../../resource/asset-manifest.json', import.meta.url)
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/* ------------------------------- 临时替身 ------------------------------- */

class FakeAction {
  constructor(clip) {
    this.clip = clip;
    this.loop = null;
    this.repetitions = null;
    this.clampWhenFinished = false;
    this.enabled = false;
    this.weight = 0;
    this.played = false;
    this.fadedIn = 0;
    this.crossFades = [];
  }

  reset() {
    this.played = false;
    return this;
  }

  setLoop(mode, repetitions) {
    this.loop = mode;
    this.repetitions = repetitions;
    return this;
  }

  setEffectiveWeight(weight) {
    this.weight = weight;
    return this;
  }

  play() {
    this.played = true;
    return this;
  }

  fadeIn(duration) {
    this.fadedIn = duration;
    return this;
  }

  crossFadeTo(next, duration) {
    this.crossFades.push({ to: next.clip.name, duration });
    return this;
  }
}

class FakeMixer {
  constructor(root) {
    this.root = root;
    this.timeScale = 1;
    this.actions = new Map();
    this.updates = 0;
    this.stopped = false;
  }

  clipAction(clip) {
    if (!this.actions.has(clip.name)) {
      this.actions.set(clip.name, new FakeAction(clip));
    }
    return this.actions.get(clip.name);
  }

  update(dt) {
    this.updates += dt;
  }

  stopAllAction() {
    this.stopped = true;
    this.actions.clear();
  }
}

/**
 * 创建带骨骼名的假场景。`CharacterArmature` 故意使用 100 倍缩放，
 * 与真实 Quaternius GLB 一致，用于捕获装具继承 100 倍缩放的问题。
 *
 * @returns {Group}
 */
function createFakeCharacterScene() {
  const scene = new Group();
  scene.name = 'fake-character';

  const body = new Mesh(
    new BoxGeometry(0.4, 1.2, 0.25),
    new MeshStandardMaterial({ color: 0x7c7f6a, roughness: 0.9 })
  );
  body.name = 'Body';
  scene.add(body);

  const armature = new Group();
  armature.name = 'CharacterArmature';
  armature.scale.setScalar(100);
  scene.add(armature);

  const bonePositions = {
    Head: { x: 0, y: 0.017, z: 0 },
    Hips: { x: 0, y: 0.01, z: 0 },
    UpperArmL: { x: 0.003, y: 0.0145, z: 0 },
    UpperArmR: { x: -0.003, y: 0.0145, z: 0 },
    LowerArmL: { x: 0.0045, y: 0.011, z: 0 },
    LowerArmR: { x: -0.0045, y: 0.011, z: 0 },
    WristL: { x: 0.005, y: 0.008, z: 0 },
    WristR: { x: -0.005, y: 0.008, z: 0 },
    UpperLegL: { x: 0.0012, y: 0.009, z: 0 },
    UpperLegR: { x: -0.0012, y: 0.009, z: 0 },
    LowerLegL: { x: 0.0012, y: 0.005, z: 0 },
    LowerLegR: { x: -0.0012, y: 0.005, z: 0 },
    FootL: { x: 0.0012, y: 0.001, z: 0.001 },
    FootR: { x: -0.0012, y: 0.001, z: 0.001 }
  };

  for (const name of Object.keys(bonePositions)) {
    const bone = new Object3D();
    bone.name = name;
    bone.isBone = true;
    const position = bonePositions[name];
    bone.position.set(position.x, position.y, position.z);
    armature.add(bone);
  }

  return scene;
}

/**
 * @param {Group} source
 * @returns {Group}
 */
function cloneSkinnedStub(source) {
  const copy = source.clone(true);
  const boneNames = [];
  source.traverse(function collect(child) {
    if (child.isBone === true) {
      boneNames.push(child.name);
    }
  });
  copy.traverse(function retag(child) {
    if (boneNames.includes(child.name)) {
      child.isBone = true;
    }
  });
  return copy;
}

/**
 * 从真实清单里按 url 找人类条目。
 *
 * @param {string} url
 * @returns {Record<string, unknown>|undefined}
 */
function findManifestEntry(url) {
  const humans = manifest.models.humans;
  for (const role of Object.keys(humans)) {
    for (const entry of humans[role]) {
      if (entry.url === url) {
        return entry;
      }
    }
  }
  return undefined;
}

/**
 * @param {{ failUrl?: string }} [options]
 * @returns {Object}
 */
function createFakeAssets(options) {
  let settings = options;
  if (settings === undefined) {
    settings = {};
  }
  const calls = [];
  return {
    calls,
    async loadManifest() {
      return manifest;
    },
    async loadGltf(url) {
      calls.push(url);
      if (settings.failUrl === url) {
        throw new Error('fake load failure');
      }
      const entry = findManifestEntry(url);
      let animations = [];
      if (entry !== undefined) {
        animations = entry.animations.map(function toClip(name) {
          return { name, duration: 1 };
        });
      }
      return { scene: createFakeCharacterScene(), animations };
    }
  };
}

/**
 * @returns {{
 *   enemies: ReturnType<typeof createEnemies>,
 *   events: Array<{name:string,payload:Object}>
 * }}
 */
function createHarness() {
  const events = [];
  const enemies = createEnemies({
    renderer: {
      add() {},
      remove() {}
    },
    colliders: [],
    getSpawnPoint() {
      return { x: 14, y: 0, z: 0 };
    },
    emit(name, payload) {
      events.push({ name, payload });
    }
  });
  return { enemies, events };
}

/* ------------------------------- 模型映射 ------------------------------- */

test('四个人类 GLB 已映射，步枪兵有 3 个变体，重机枪手放大 1.12', () => {
  assert.deepEqual(HUMAN_MODEL_IDS.slice(), [
    'adventurer',
    'woman-casual',
    'woman-formal',
    'man-base'
  ]);
  assert.equal(Object.keys(HUMAN_MODEL_DEFINITIONS).length, 4);
  assert.equal(HEAVY_SCALE_MULTIPLIER, 1.12);

  assert.deepEqual(GAME_CONFIG.enemies.rifleman.modelPool.slice(), [
    'adventurer',
    'woman-casual',
    'woman-formal'
  ]);
  assert.deepEqual(GAME_CONFIG.enemies.heavy.modelPool.slice(), ['adventurer']);
  assert.deepEqual(GAME_CONFIG.enemies.breacher.modelPool.slice(), ['man-base']);

  const humans = manifest.models.humans;
  assert.equal(humans.rifleman.length, 3);
  assert.equal(humans.heavy[0].id, 'adventurer');
  assert.equal(humans.breacher[0].id, 'man-base');
  for (const role of Object.keys(humans)) {
    for (const entry of humans[role]) {
      assert.equal(entry.forwardAxis, '+Z');
      assert.equal(entry.rootMotion, false);
      assert.ok(entry.scale > 0);
    }
  }
  assert.equal(humans.rifleman[0].scale, 0.985);
  assert.equal(humans.rifleman[1].scale, 0.995);
  assert.equal(humans.rifleman[2].scale, 1);
  assert.equal(humans.breacher[0].scale, 0.373);
});

test('Adventurer/Woman 的动画名按后缀映射到各状态', () => {
  const entry = manifest.models.humans.rifleman[0];
  const clips = resolveAnimationClipMap({
    modelId: 'adventurer',
    type: ENEMY_TYPES.RIFLEMAN,
    animations: entry.animations
  });

  assert.equal(clips.idle, 'CharacterArmature|Idle_Gun');
  assert.equal(clips.walk, 'CharacterArmature|Walk');
  assert.equal(clips.run, 'CharacterArmature|Run');
  assert.equal(clips.runShoot, 'CharacterArmature|Run_Shoot');
  assert.equal(clips.shoot, 'CharacterArmature|Gun_Shoot');
  assert.equal(clips.hit, 'CharacterArmature|HitRecieve');
  assert.equal(clips.death, 'CharacterArmature|Death');
});

test('Man base 使用 Man_* 片段；缺失状态回退为 null 或最近片段', () => {
  const entry = manifest.models.humans.breacher[0];
  const clips = resolveAnimationClipMap({
    modelId: 'man-base',
    type: ENEMY_TYPES.BREACHER,
    animations: entry.animations
  });

  assert.equal(clips.idle, 'HumanArmature|Man_Idle');
  assert.equal(clips.walk, 'HumanArmature|Man_Walk');
  assert.equal(clips.run, 'HumanArmature|Man_Run');
  assert.equal(clips.attack, 'HumanArmature|Man_Punch');
  assert.equal(clips.attackLeft, 'HumanArmature|Man_Punch');
  assert.equal(clips.attackRight, 'HumanArmature|Man_Punch');
  assert.equal(clips.death, 'HumanArmature|Man_Death');
  assert.equal(clips.hit, null);
  assert.equal(clips.shoot, null);
  assert.equal(clips.runShoot, null);

  const standingOnly = resolveAnimationClipMap({
    modelId: 'man-base',
    type: ENEMY_TYPES.BREACHER,
    animations: ['HumanArmature|Man_Standing', 'HumanArmature|Man_Death']
  });
  assert.equal(standingOnly.idle, 'HumanArmature|Man_Standing');
  assert.equal(standingOnly.walk, 'HumanArmature|Man_Standing');

  const missingRunShoot = resolveAnimationClipMap({
    modelId: 'adventurer',
    type: ENEMY_TYPES.RIFLEMAN,
    animations: [
      'CharacterArmature|Idle_Gun',
      'CharacterArmature|Gun_Shoot',
      'CharacterArmature|Death'
    ]
  });
  assert.equal(missingRunShoot.runShoot, 'CharacterArmature|Gun_Shoot');
  assert.equal(missingRunShoot.walk, null);
});

test('模型缓存加载四个 GLB，并使用清单里的逐模型缩放', async () => {
  const assets = createFakeAssets();
  const cache = await loadHumanModelCache({ assets });

  assert.equal(cache.size, 4);
  assert.equal(assets.calls.length, 4);
  assert.equal(cache.get('adventurer').scale, 0.985);
  assert.equal(cache.get('woman-casual').scale, 0.995);
  assert.equal(cache.get('woman-formal').scale, 1);
  assert.equal(cache.get('man-base').scale, 0.373);
  assert.equal(cache.get('adventurer').animations.length, 7);
  assert.equal(cache.get('man-base').animations.length, 6);
  assert.equal(cache.get('woman-casual').forwardAxis, '+Z');

  disposeHumanModelCache(cache);
  assert.equal(cache.size, 0);
});

test('单个 GLB 加载失败时记录具体 URL 并回退到 null', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = function captureError(...args) {
    logged.push(args);
  };

  try {
    const assets = createFakeAssets({
      failUrl: 'models/quaternius-adventurer.glb'
    });
    const cache = await loadHumanModelCache({ assets });
    assert.equal(cache.get('adventurer'), null);
    assert.ok(cache.get('woman-casual'));
    assert.ok(
      logged.some(function hasAdventurer(args) {
        return String(args[0]).includes('models/quaternius-adventurer.glb');
      })
    );
    disposeHumanModelCache(cache);
  } finally {
    console.error = originalError;
  }
});

/* ------------------------------- 视觉与装具 ------------------------------- */

test('GLB 实例克隆骨骼、播放动画并挂载装具', () => {
  const entry = manifest.models.humans.rifleman[0];
  const visual = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'enemy-visual',
    model: {
      scene: createFakeCharacterScene(),
      animations: entry.animations.map(function toClip(name) {
        return { name, duration: 1 };
      }),
      scale: entry.scale
    },
    capabilities: {
      cloneSkinned: cloneSkinnedStub,
      AnimationMixer: FakeMixer
    }
  });

  assert.equal(visual.isFallback(), false);
  assert.equal(visual.visualScale, 0.985);
  assert.equal(visual.clips.idle, 'CharacterArmature|Idle_Gun');
  assert.ok(visual.mixer instanceof FakeMixer);

  visual.setLocomotion({ speed: 5, moving: true, firing: false });
  assert.equal(visual.getCurrentState(), 'run');
  assert.equal(visual.getCurrentClip(), 'CharacterArmature|Run');

  visual.setLocomotion({ speed: 0, moving: false, firing: true });
  assert.equal(visual.getCurrentState(), 'shoot');
  assert.equal(visual.getCurrentClip(), 'CharacterArmature|Gun_Shoot');

  visual.setLocomotion({ speed: 5, moving: true, firing: true });
  assert.equal(visual.getCurrentState(), 'runShoot');
  assert.equal(visual.getCurrentClip(), 'CharacterArmature|Run_Shoot');

  const previous = visual.mixer.actions.get('CharacterArmature|Run_Shoot');
  visual.setLocomotion({ speed: 0, moving: false, firing: false });
  assert.equal(visual.getCurrentState(), 'idle');
  assert.equal(previous.crossFades.length, 1);
  assert.ok(previous.crossFades[0].duration >= 0.15);
  assert.ok(previous.crossFades[0].duration <= 0.2);

  const equipment = visual.getEquipmentNames();
  assert.ok(equipment.includes('helmet'));
  assert.ok(equipment.includes('face-mask'));
  assert.ok(equipment.includes('vest'));
  assert.ok(equipment.includes('mag-pouches'));
  assert.ok(equipment.includes('knee-pad-left'));
  assert.ok(equipment.includes('glove-right'));
  assert.ok(equipment.includes('rifle'));

  const helmet = visual.root.getObjectByName('hitbox-head');
  assert.ok(helmet);
  const clone = visual.root.children.find(function isModel(child) {
    return child.name === 'fake-character';
  });
  assert.ok(clone);
  let helmetAttachedToHead = false;
  clone.traverse(function findHelmet(child) {
    if (child.userData.equipment === 'helmet' && child.parent.name === 'Head') {
      helmetAttachedToHead = true;
    }
  });
  assert.equal(helmetAttachedToHead, true);

  visual.showMuzzleFlash();
  assert.equal(visual.isMuzzleFlashVisible(), true);
  visual.update(0.1);
  assert.equal(visual.isMuzzleFlashVisible(), false);

  visual.setReloading(true);
  visual.update(0.25);
  const weaponMount = visual.root.getObjectByName('weapon-mount');
  assert.ok(weaponMount.rotation.x > 0.1);
  visual.setReloading(false);

  visual.playHit();
  assert.equal(visual.getCurrentState(), 'hit');
  assert.equal(visual.getCurrentClip(), 'CharacterArmature|HitRecieve');

  visual.dispose();
});

test('骨骼装具不继承 CharacterArmature 的 100 倍缩放，保持人体尺度并跟随骨骼', () => {
  const entry = manifest.models.humans.rifleman[0];
  const visual = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'enemy-scale-audit',
    model: {
      scene: createFakeCharacterScene(),
      animations: entry.animations.map(function toClip(name) {
        return { name, duration: 1 };
      }),
      scale: entry.scale
    },
    capabilities: {
      cloneSkinned: cloneSkinnedStub,
      AnimationMixer: FakeMixer
    }
  });

  visual.root.position.set(24, 0, 0);
  visual.root.updateMatrixWorld(true);

  const equipmentMeshes = [];
  visual.root.traverse(function collect(child) {
    if (child.isMesh && typeof child.userData.equipment === 'string') {
      equipmentMeshes.push(child);
    }
  });
  assert.ok(equipmentMeshes.length >= 10);

  const limits = {
    helmet: 0.5,
    'helmet-brim': 0.5,
    'face-mask': 0.5,
    vest: 1.2,
    'mag-pouches': 0.8,
    'side-pouch': 0.6,
    'knee-pad-left': 0.6,
    'knee-pad-right': 0.6,
    'glove-left': 0.5,
    'glove-right': 0.5,
    'boot-left': 0.6,
    'boot-right': 0.6,
    'forearm-guard-left': 0.5,
    'forearm-guard-right': 0.5,
    'chest-plate': 1,
    'shoulder-armor-left': 0.6,
    'shoulder-armor-right': 0.6,
    'leg-plate-left': 0.6,
    'leg-plate-right': 0.6,
    rifle: 1.5
  };

  for (const mesh of equipmentMeshes) {
    const name = mesh.userData.equipment;
    const worldScale = mesh.getWorldScale(new Vector3());
    assert.ok(Number.isFinite(worldScale.x));
    assert.ok(Number.isFinite(worldScale.y));
    assert.ok(Number.isFinite(worldScale.z));
    assert.ok(worldScale.x < 5, name + ' world scale x = ' + worldScale.x);
    assert.ok(worldScale.y < 5, name + ' world scale y = ' + worldScale.y);
    assert.ok(worldScale.z < 5, name + ' world scale z = ' + worldScale.z);

    let limit = 1.5;
    if (limits[name] !== undefined) {
      limit = limits[name];
    }
    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    let largest = size.x;
    if (size.y > largest) {
      largest = size.y;
    }
    if (size.z > largest) {
      largest = size.z;
    }
    assert.ok(largest < limit, name + ' 世界尺寸应小于 ' + limit + '，实际 ' + largest);

    const worldPosition = mesh.getWorldPosition(new Vector3());
    const distanceToOrigin = Math.hypot(
      worldPosition.x,
      worldPosition.y,
      worldPosition.z
    );
    assert.ok(
      distanceToOrigin > 2,
      name + ' 不应脱离敌人跑到世界原点附近，实际距离 ' + distanceToOrigin
    );

    const toRoot = Math.hypot(
      worldPosition.x - visual.root.position.x,
      worldPosition.y - visual.root.position.y,
      worldPosition.z - visual.root.position.z
    );
    assert.ok(toRoot < 3, name + ' 应跟随敌人，实际距根节点 ' + toRoot);
  }

  let headBone = null;
  let wristRight = null;
  visual.root.traverse(function findBones(child) {
    if (child.isBone !== true) {
      return;
    }
    if (child.name === 'Head') {
      headBone = child;
    }
    if (child.name === 'WristR') {
      wristRight = child;
    }
  });
  assert.ok(headBone);
  assert.ok(wristRight);

  let helmet = null;
  let faceMask = null;
  let leftKneePad = null;
  let leftGlove = null;
  for (const mesh of equipmentMeshes) {
    if (mesh.userData.equipment === 'helmet') {
      helmet = mesh;
    }
    if (mesh.userData.equipment === 'face-mask') {
      faceMask = mesh;
    }
    if (mesh.userData.equipment === 'knee-pad-left') {
      leftKneePad = mesh;
    }
    if (mesh.userData.equipment === 'glove-left') {
      leftGlove = mesh;
    }
  }
  assert.ok(helmet);
  assert.ok(faceMask);
  assert.ok(leftKneePad);
  assert.ok(leftGlove);
  assert.equal(helmet.parent.name, 'Head');
  assert.equal(faceMask.parent.name, 'Head');
  assert.equal(leftKneePad.parent.name, 'LowerLegL');
  assert.equal(leftGlove.parent.name, 'WristL');

  const before = helmet.getWorldPosition(new Vector3());
  headBone.position.x += 0.005;
  visual.root.updateMatrixWorld(true);
  const after = helmet.getWorldPosition(new Vector3());
  assert.ok(after.distanceTo(before) > 0.1, '头盔应跟随 Head 骨骼移动');
  assert.equal(visual.root.position.x, 24);

  // 步枪挂点每帧移动到右手；枪口随之更新，仍保持人体尺度。
  visual.update(0.016);
  visual.root.updateMatrixWorld(true);
  const weaponMount = visual.root.getObjectByName('weapon-mount');
  assert.ok(weaponMount);
  const mountWorld = weaponMount.getWorldPosition(new Vector3());
  const wristWorld = wristRight.getWorldPosition(new Vector3());
  assert.ok(
    mountWorld.distanceTo(wristWorld) < 0.5,
    '步枪挂点应跟随右手，实际距离 ' + mountWorld.distanceTo(wristWorld)
  );

  visual.dispose();
});

test('头/身命中盒的部位、位置与尺寸正确，重机枪手按 1.12 放大', () => {
  const rifleman = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'enemy-headboxes',
    model: null
  });
  assert.equal(rifleman.isFallback(), true);

  const parts = rifleman.listHitboxes();
  assert.equal(parts.length, 2);
  const head = parts.find(function findHead(mesh) {
    return mesh.userData.part === 'head';
  });
  const body = parts.find(function findBody(mesh) {
    return mesh.userData.part === 'body';
  });
  assert.ok(head);
  assert.ok(body);
  assert.equal(head.userData.targetId, 'enemy-headboxes:head');
  assert.equal(body.userData.targetId, 'enemy-headboxes:body');
  assert.equal(head.position.y, 1.62);
  assert.equal(body.position.y, 0.98);
  assert.equal(head.geometry.parameters.width, 0.28);
  assert.equal(body.geometry.parameters.width, 0.62);
  assert.equal(head.visible, false);

  const heavy = createHumanVisual({
    type: ENEMY_TYPES.HEAVY,
    modelId: 'adventurer',
    targetId: 'enemy-heavy-boxes',
    model: null
  });
  assert.equal(heavy.hitboxScale, 1.12);
  const heavyHead = heavy.listHitboxes().find(function findHead(mesh) {
    return mesh.userData.part === 'head';
  });
  const heavyBody = heavy.listHitboxes().find(function findBody(mesh) {
    return mesh.userData.part === 'body';
  });
  assert.ok(Math.abs(heavyHead.position.y - 1.62 * 1.12) < 1e-9);
  assert.ok(Math.abs(heavyBody.position.y - 0.98 * 1.12) < 1e-9);
  assert.ok(Math.abs(heavyBody.geometry.parameters.width - 0.62 * 1.12) < 1e-9);

  const heavyModel = createHumanVisual({
    type: ENEMY_TYPES.HEAVY,
    modelId: 'adventurer',
    targetId: 'enemy-heavy-model',
    model: {
      scene: createFakeCharacterScene(),
      animations: [],
      scale: 0.985
    },
    capabilities: {
      cloneSkinned: cloneSkinnedStub,
      AnimationMixer: FakeMixer
    }
  });
  assert.ok(
    Math.abs(heavyModel.visualScale - 0.985 * HEAVY_SCALE_MULTIPLIER) < 1e-9
  );

  rifleman.dispose();
  heavy.dispose();
  heavyModel.dispose();
});

test('装具按兵种区分：突击兵不持枪，重机枪手有肩甲/胸板', () => {
  const rifleman = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'gear-rifleman',
    model: null
  });
  const rifleEquipment = rifleman.getEquipmentNames();
  assert.ok(rifleEquipment.includes('rifle'));
  assert.ok(rifleEquipment.includes('mag-pouches'));
  assert.equal(rifleEquipment.includes('shoulder-armor-left'), false);

  const breacher = createHumanVisual({
    type: ENEMY_TYPES.BREACHER,
    modelId: 'man-base',
    targetId: 'gear-breacher',
    model: null
  });
  const breacherEquipment = breacher.getEquipmentNames();
  assert.equal(breacherEquipment.includes('rifle'), false);
  assert.equal(breacherEquipment.includes('mag-pouches'), false);
  assert.ok(breacherEquipment.includes('forearm-guard-left'));
  assert.ok(breacherEquipment.includes('face-mask'));

  const heavy = createHumanVisual({
    type: ENEMY_TYPES.HEAVY,
    modelId: 'adventurer',
    targetId: 'gear-heavy',
    model: null
  });
  const heavyEquipment = heavy.getEquipmentNames();
  assert.ok(heavyEquipment.includes('shoulder-armor-left'));
  assert.ok(heavyEquipment.includes('shoulder-armor-right'));
  assert.ok(heavyEquipment.includes('chest-plate'));
  assert.ok(heavyEquipment.includes('leg-plate-left'));
  assert.ok(heavyEquipment.includes('rifle'));

  rifleman.dispose();
  breacher.dispose();
  heavy.dispose();
});

test('爆头结果返回 headshot 与 critical，伤害不再被敌方服务加倍', () => {
  const harness = createHarness();
  const { enemies } = harness;

  enemies.startWave(1);
  enemies.update(0.01, {
    x: 0,
    y: 0,
    z: 0,
    eyeHeight: GAME_CONFIG.player.eyeHeight,
    alive: true
  });

  const query = enemies.getTargetQuery();
  const headEntry = query.listHittable().find(function findHead(entry) {
    return entry.object.userData.part === 'head';
  });
  const bodyEntry = query.listHittable().find(function findBody(entry) {
    return entry.object.userData.part === 'body';
  });

  const headResult = query.applyDamage(headEntry.targetId, 10);
  assert.equal(headResult.headshot, true);
  assert.equal(headResult.critical, true);

  const bodyResult = query.applyDamage(bodyEntry.targetId, 10);
  assert.equal(bodyResult.headshot, false);
  assert.equal(bodyResult.critical, false);

  const killResult = query.applyDamage(headEntry.targetId, 50);
  assert.equal(killResult.hit, true);
  assert.equal(killResult.headshot, true);
  assert.equal(enemies.getState().alive, 0);
  assert.equal(query.listHittable().length, 0);

  enemies.dispose();
});

test('死亡立即移除命中盒，尸体 4 秒后淡出可移除', () => {
  const visual = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'death-visual',
    model: null
  });

  assert.equal(visual.listHitboxes().length, 2);
  visual.startDeath();
  assert.equal(visual.isDead(), true);
  assert.equal(visual.listHitboxes().length, 0);

  const beforeFade = visual.updateCorpse(CORPSE_LIFETIME - 0.6);
  assert.equal(beforeFade, false);

  let faded = false;
  visual.root.traverse(function checkOpacity(child) {
    if (!child.isMesh || !child.material) {
      return;
    }
    let materials = child.material;
    if (!Array.isArray(materials)) {
      materials = [materials];
    }
    for (const material of materials) {
      if (material.transparent === true && material.opacity < 1) {
        faded = true;
      }
    }
  });
  assert.equal(faded, true);

  const finished = visual.updateCorpse(0.7);
  assert.equal(finished, true);
  visual.dispose();
});

test('dispose 幂等且释放实例资源', () => {
  const visual = createHumanVisual({
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    targetId: 'dispose-visual',
    model: null
  });
  visual.dispose();
  assert.equal(visual.isDisposed(), true);
  assert.equal(visual.root.parent, null);
  visual.dispose();
  assert.equal(visual.isDisposed(), true);
});

test('敌方服务不再包含 drone / brute / wraith 类型', () => {
  assert.deepEqual(Object.values(ENEMY_TYPES), ['rifleman', 'heavy', 'breacher']);
  assert.equal(GAME_CONFIG.enemies.drone, undefined);
  assert.equal(GAME_CONFIG.enemies.brute, undefined);
  assert.equal(GAME_CONFIG.enemies.wraith, undefined);
  assert.equal(GAME_CONFIG.enemies.rifleman.health, 70);
  assert.equal(GAME_CONFIG.enemies.heavy.health, 200);
  assert.equal(GAME_CONFIG.enemies.breacher.health, 85);
});
