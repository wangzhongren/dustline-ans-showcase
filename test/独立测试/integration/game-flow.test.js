/**
 * 独立测试：跨角色集成（真实模块 + 契约兼容替身），v3 人类士兵版本。
 *
 * 目的：用真实共享事件总线、真实 `createGame` Pipeline、真实战斗/敌方/效果/音频
 * 服务、真实 Model 与真实竞技场布局，验证从开始对局到波次推进、身体/爆头击杀、
 * 受伤方向、设置转发、性能仪表、人类装具尺度、死亡与重开的完整状态流；只把
 * 外部基础设施替换成契约兼容对象。
 *
 * 替身与理由：
 * - 渲染器：Node 中不创建 WebGLRenderer。替身实现 Provider 公共契约的
 *   add/remove/attachToCamera/detachFromCamera/setCameraPose/getCameraPose/
 *   getWorldPosition/raycast，并额外记录 setQuality/getQuality 与后处理状态。
 *   `raycast` 只返回当前目标查询里真实存在的命中盒，保证战斗服务仍走真实
 *   命中扫描与 applyDamage。
 * - 竞技场服务：不构建 Three.js 场景，但直接复用真实 `arena-layout.js` 的布局、
 *   碰撞体与出生点纯函数，因此碰撞和 22–28 米出生点规则是真实实现。
 * - 音频 Provider：不创建 AudioContext；用记录调用参数的假引擎驱动真实音频编排
 *   服务，验证事件到音效与主音量的接线。
 * - 人类模型素材：用 Three 公共门面构造带 `CharacterArmature` 100 倍缩放的
 *   假骨骼场景，交给真实敌方服务加载、克隆、挂装具，验证装具世界尺度。
 *
 * 运行（项目根目录）：
 *   node --test test/独立测试/integration/game-flow.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../../../src/common/shared/event-bus.js';
import { EVENTS, isKnownEvent } from '../../../src/models/events.js';
import {
  ENEMY_TYPES,
  GAME_CONFIG,
  getWaveEnemyCount
} from '../../../src/models/game-config.js';
import {
  createInputCommand,
  isPerformanceSnapshot
} from '../../../src/models/contracts.js';
import { createGame } from '../../../src/pipelines/public/game.js';
import { createCombat } from '../../../src/services/public/combat.js';
import { createEnemies } from '../../../src/services/public/enemies.js';
import { createEffects } from '../../../src/services/public/effects.js';
import { createAudio } from '../../../src/services/public/audio.js';
import {
  createLayout,
  createColliders,
  findSpawnPoint,
  getPlayerSpawn
} from '../../../src/services/impl/environment/arena-layout.js';
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3
} from '../../../src/providers/public/three.js';

/** 固定步长（秒），等于 Pipeline 的单帧上限。 */
const STEP = 0.05;

/** v2 机械敌人名称；v3 不应再出现在任何状态里。 */
const LEGACY_ENEMY_TYPES = ['drone', 'brute', 'wraith'];

/**
 * 创建满足渲染 Provider 公共契约的假渲染器。
 *
 * `raycast` 只返回测试显式指定的命中对象；该对象必须出现在 `targetQuery`
 * 返回的可命中列表里，避免伪造不存在的目标。
 *
 * @returns {Object}
 */
function createFakeRenderer() {
  const added = new Set();
  const removed = [];
  const attached = [];
  const detached = [];
  const poses = [];
  const qualityChanges = [];
  let quality = 'high';
  let postProcessing = true;
  let pose = {
    position: { x: 0, y: GAME_CONFIG.player.eyeHeight, z: 0 },
    yaw: 0,
    pitch: 0,
    fov: GAME_CONFIG.match.cameraFov
  };
  let nextHit = null;

  return {
    get addedCount() {
      return added.size;
    },
    get removedCount() {
      return removed.length;
    },
    get attachedCount() {
      return attached.length;
    },
    get detachedCount() {
      return detached.length;
    },
    get poses() {
      return poses.slice();
    },
    get qualityChanges() {
      return qualityChanges.slice();
    },
    get quality() {
      return quality;
    },
    addedObjects() {
      return Array.from(added);
    },
    add(object) {
      added.add(object);
    },
    remove(object) {
      if (added.delete(object)) {
        removed.push(object);
      }
    },
    attachToCamera(object) {
      attached.push(object);
    },
    detachFromCamera(object) {
      detached.push(object);
    },
    setCameraPose(nextPose) {
      pose = {
        position: {
          x: nextPose.position.x,
          y: nextPose.position.y,
          z: nextPose.position.z
        },
        yaw: nextPose.yaw,
        pitch: nextPose.pitch,
        fov: nextPose.fov
      };
      poses.push(pose);
    },
    getCameraPose() {
      return {
        position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
        yaw: pose.yaw,
        pitch: pose.pitch,
        fov: pose.fov
      };
    },
    getWorldPosition() {
      const cosPitch = Math.cos(pose.pitch);
      return {
        origin: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
        direction: {
          x: -Math.sin(pose.yaw) * cosPitch,
          y: Math.sin(pose.pitch),
          z: -Math.cos(pose.yaw) * cosPitch
        }
      };
    },
    raycast(origin, direction, far, objects) {
      if (nextHit === null) {
        return null;
      }
      if (!Array.isArray(objects) || objects.includes(nextHit.object) === false) {
        return null;
      }
      return {
        object: nextHit.object,
        distance: nextHit.distance,
        point: { x: nextHit.point.x, y: nextHit.point.y, z: nextHit.point.z },
        normal: {
          x: nextHit.normal.x,
          y: nextHit.normal.y,
          z: nextHit.normal.z
        },
        userData: nextHit.object.userData
      };
    },
    setNextHit(hit) {
      nextHit = hit;
    },
    clearNextHit() {
      nextHit = null;
    },
    setQuality(nextQuality) {
      if (nextQuality !== 'high' && nextQuality !== 'low') {
        throw new RangeError('渲染器 setQuality 只接受 high 或 low');
      }
      quality = nextQuality;
      postProcessing = nextQuality === 'high';
      qualityChanges.push(nextQuality);
    },
    getQuality() {
      return quality;
    },
    isPostProcessingEnabled() {
      return postProcessing;
    },
    getPostProcessingEnabled() {
      return postProcessing;
    },
    setEnvironment() {},
    resize() {},
    render() {},
    dispose() {}
  };
}

/**
 * 用真实竞技场布局纯函数实现假竞技场服务。
 *
 * @param {Readonly<Record<string, unknown>>} layout
 * @param {Array<Object>} colliders
 * @param {{x:number,y:number,z:number}|null} spawnPointOverride
 * @returns {Object}
 */
function createLayoutArena(layout, colliders, spawnPointOverride) {
  return {
    getColliders() {
      return colliders.map(function copy(collider) {
        return {
          min: { x: collider.min.x, y: collider.min.y, z: collider.min.z },
          max: { x: collider.max.x, y: collider.max.y, z: collider.max.z }
        };
      });
    },
    getSpawnPoint(request) {
      if (spawnPointOverride !== null) {
        return {
          x: spawnPointOverride.x,
          y: spawnPointOverride.y,
          z: spawnPointOverride.z
        };
      }
      let playerPosition = { x: 0, y: 0, z: 0 };
      let minDistance = GAME_CONFIG.arena.minPlayerDistance;
      if (request !== undefined && request !== null) {
        if (request.playerPosition !== undefined) {
          playerPosition = request.playerPosition;
        }
        if (typeof request.minDistance === 'number') {
          minDistance = request.minDistance;
        }
      }
      return findSpawnPoint({
        playerPosition,
        minDistance,
        colliders
      });
    },
    getPlayerSpawn() {
      return getPlayerSpawn(layout);
    },
    update() {},
    load() {
      return Promise.resolve({
        colliders: this.getColliders(),
        playerSpawn: this.getPlayerSpawn(),
        fallbacks: []
      });
    },
    dispose() {}
  };
}

/**
 * 记录调用参数的假音频引擎，不创建 AudioContext。
 *
 * @returns {Object}
 */
function createFakeAudioEngine() {
  const calls = {
    init: 0,
    tone: 0,
    noise: 0,
    setMuted: [],
    masterVolume: []
  };

  return {
    calls,
    init() {
      calls.init += 1;
      return Promise.resolve('running');
    },
    tone() {
      calls.tone += 1;
      return undefined;
    },
    noise() {
      calls.noise += 1;
      return undefined;
    },
    setMuted(muted) {
      calls.setMuted.push(muted);
    },
    setMasterVolume(volume) {
      calls.masterVolume.push(volume);
    },
    dispose() {}
  };
}

/**
 * 构造假人类 GLB：`CharacterArmature` 带 100 倍缩放，骨骼名与真实 Quaternius
 * 模型一致。敌方服务应测量骨骼世界缩放并用倒数抵消装具继承缩放。
 *
 * @returns {{scene: Object, animations: unknown[]}}
 */
function createFakeHumanGltf() {
  const scene = new Group();
  scene.name = 'fake-human-glb';

  const armature = new Group();
  armature.name = 'CharacterArmature';
  armature.scale.setScalar(100);
  scene.add(armature);

  /**
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {Object}
   */
  function addBone(name, x, y, z) {
    const bone = new Object3D();
    bone.name = name;
    bone.isBone = true;
    bone.position.set(x, y, z);
    armature.add(bone);
    return bone;
  }

  addBone('Hips', 0, 0.01, 0);
  addBone('Head', 0, 0.017, 0.001);
  addBone('WristL', -0.003, 0.013, 0);
  addBone('WristR', 0.003, 0.013, 0);
  addBone('LowerLegL', -0.001, 0.005, 0);
  addBone('LowerLegR', 0.001, 0.005, 0);
  addBone('FootL', -0.001, 0.001, 0);
  addBone('FootR', 0.001, 0.001, 0);
  addBone('UpperArmL', -0.004, 0.016, 0);
  addBone('UpperArmR', 0.004, 0.016, 0);
  addBone('UpperLegL', -0.001, 0.009, 0);
  addBone('UpperLegR', 0.001, 0.009, 0);

  const body = new Mesh(
    new BoxGeometry(0.02, 0.09, 0.014),
    new MeshStandardMaterial({ color: 0x6f725c, roughness: 0.9, metalness: 0.02 })
  );
  body.name = 'fake-body';
  armature.add(body);

  return { scene, animations: [] };
}

/**
 * 假素材 Provider：每次 loadGltf 返回一份新的假人类场景。
 *
 * @returns {{loadManifest: Function, loadGltf: Function}}
 */
function createFakeHumanAssets() {
  return {
    loadManifest() {
      return Promise.resolve(null);
    },
    loadGltf() {
      return Promise.resolve(createFakeHumanGltf());
    }
  };
}

/**
 * 组装一次真实集成测试所需的全部对象。
 *
 * @param {{
 *   spawnPointOverride?: {x:number,y:number,z:number},
 *   assets?: Object,
 *   recordDamage?: boolean
 * }} [options]
 * @returns {Object}
 */
function createRig(options) {
  let spawnPointOverride = null;
  let assets = undefined;
  let recordDamage = false;
  if (options !== undefined && options !== null) {
    if (options.spawnPointOverride !== undefined) {
      spawnPointOverride = options.spawnPointOverride;
    }
    if (options.assets !== undefined) {
      assets = options.assets;
    }
    if (options.recordDamage === true) {
      recordDamage = true;
    }
  }

  const bus = createEventBus();
  const renderer = createFakeRenderer();
  const layout = createLayout();
  const colliders = createColliders(layout);
  const arena = createLayoutArena(layout, colliders, spawnPointOverride);

  const realEffects = createEffects({ renderer });
  const effectsCalls = { blood: 0, explosion: 0 };
  const effects = {
    ...realEffects,
    blood(position, direction, color) {
      effectsCalls.blood += 1;
      return realEffects.blood(position, direction, color);
    },
    explosion(position, color, scale) {
      effectsCalls.explosion += 1;
      return realEffects.explosion(position, color, scale);
    }
  };

  const audioEngine = createFakeAudioEngine();
  const audio = createAudio({ engine: audioEngine });

  /**
   * 服务结果事件直接进入共享总线，与 `src/main.js` 的接线方式一致。
   *
   * @param {string} name
   * @param {unknown} payload
   * @returns {void}
   */
  const emit = (name, payload) => {
    bus.emit(name, payload);
  };

  const enemies = createEnemies({
    renderer,
    colliders: arena.getColliders(),
    getSpawnPoint: (request) => arena.getSpawnPoint(request),
    emit,
    assets
  });

  const realTargetQuery = enemies.getTargetQuery();
  const damageRecords = [];
  let targetQuery = realTargetQuery;
  if (recordDamage) {
    targetQuery = {
      listHittable() {
        return realTargetQuery.listHittable();
      },
      applyDamage(targetId, damage) {
        damageRecords.push({ targetId, damage });
        return realTargetQuery.applyDamage(targetId, damage);
      }
    };
  }

  const combat = createCombat({
    renderer,
    colliders: arena.getColliders(),
    targetQuery,
    emit,
    spawn: arena.getPlayerSpawn(),
    viewport: { width: 1600, height: 900 }
  });

  const game = createGame({
    bus,
    renderer,
    arena,
    combat,
    enemies,
    effects,
    audio
  });

  const events = [];
  const eventNames = Object.keys(EVENTS)
    .filter((key) => typeof EVENTS[key] === 'string')
    .map((key) => EVENTS[key]);
  for (const name of eventNames) {
    assert.equal(isKnownEvent(name), true);
    bus.on(name, function collect(payload) {
      events.push({ name, payload });
    });
  }

  /**
   * @param {string} name
   * @returns {Array<{name:string, payload:unknown}>}
   */
  function findAll(name) {
    return events.filter((entry) => entry.name === name);
  }

  /**
   * @param {string} name
   * @returns {unknown}
   */
  function findLast(name) {
    const matches = findAll(name);
    if (matches.length === 0) {
      return null;
    }
    return matches[matches.length - 1].payload;
  }

  /**
   * 以固定步长推进对局。
   *
   * @param {number} seconds
   * @param {number} [delta]
   * @returns {number}
   */
  function runUpdates(seconds, delta) {
    let step = STEP;
    if (typeof delta === 'number') {
      step = delta;
    }
    const count = Math.round(seconds / step);
    for (let index = 0; index < count; index += 1) {
      game.update(step);
    }
    return count;
  }

  /**
   * 推进敌方服务本身（用于不经过 Pipeline 的波次/装具测试）。
   *
   * @param {number} seconds
   * @returns {void}
   */
  function runEnemyUpdates(seconds) {
    const count = Math.round(seconds / STEP);
    for (let index = 0; index < count; index += 1) {
      enemies.update(STEP, { x: 0, y: 0, z: 0, eyeHeight: 1.68, alive: true });
    }
  }

  /**
   * 释放本次装配创建的对象（不 commit、不触碰生产资源）。
   *
   * @returns {void}
   */
  function cleanup() {
    game.dispose();
    combat.dispose();
    enemies.dispose();
    realEffects.dispose();
    audio.dispose();
  }

  return {
    bus,
    renderer,
    layout,
    colliders,
    arena,
    effects,
    effectsCalls,
    audioEngine,
    audio,
    enemies,
    combat,
    game,
    events,
    damageRecords,
    findAll,
    findLast,
    runUpdates,
    runEnemyUpdates,
    cleanup
  };
}

/**
 * 让假渲染器的射线命中一个真实敌人的指定部位。
 *
 * @param {Object} rig
 * @param {'body'|'head'} part
 * @returns {Object|null} 命中的对象；没有可命中敌人时返回 null。
 */
function pointRaycastAtEnemyPart(rig, part) {
  const entries = rig.enemies.getTargetQuery().listHittable();
  if (entries.length === 0) {
    rig.renderer.clearNextHit();
    return null;
  }
  let chosen = null;
  for (const entry of entries) {
    if (entry.object.userData.part === part) {
      chosen = entry;
      break;
    }
  }
  if (chosen === null) {
    rig.renderer.clearNextHit();
    return null;
  }
  rig.renderer.setNextHit({
    object: chosen.object,
    distance: 1,
    point: { x: 0, y: 1.4, z: 0 },
    normal: { x: 0, y: 0, z: 1 }
  });
  return chosen.object;
}

/**
 * 通过真实战斗服务连续射击直到击杀至少一名敌人或达到上限。
 *
 * @param {Object} rig
 * @param {number} maxUpdates
 * @param {'body'|'head'} [part]
 * @returns {boolean}
 */
function killOneEnemy(rig, maxUpdates, part) {
  const targetPart = part === undefined ? 'body' : part;
  for (let index = 0; index < maxUpdates; index += 1) {
    if (rig.game.getSnapshot().kills > 0) {
      return true;
    }
    if (pointRaycastAtEnemyPart(rig, targetPart) !== null) {
      rig.game.setInput(createInputCommand({ fire: true }));
    } else {
      rig.game.setInput(createInputCommand());
    }
    rig.game.update(STEP);
  }
  return rig.game.getSnapshot().kills > 0;
}

/**
 * 在临时替换 `Math.random` 的情况下执行回调。
 *
 * @param {number[]} values
 * @param {() => void} callback
 * @returns {void}
 */
function withRandomSequence(values, callback) {
  const original = Math.random;
  let index = 0;
  Math.random = function controlledRandom() {
    if (index < values.length) {
      const value = values[index];
      index += 1;
      return value;
    }
    return 0;
  };
  try {
    callback();
  } finally {
    Math.random = original;
  }
}

/**
 * 收集敌人根节点上的全部装具网格信息。
 *
 * @param {Object} root
 * @returns {Array<{name:string, scale:{x:number,y:number,z:number}, size:{x:number,y:number,z:number}, position:{x:number,y:number,z:number}}>}
 */
function collectEquipment(root) {
  root.updateMatrixWorld(true);
  const result = [];
  root.traverse(function visit(child) {
    if (
      child.userData === undefined ||
      typeof child.userData.equipment !== 'string'
    ) {
      return;
    }
    const scale = new Vector3();
    child.getWorldScale(scale);
    const box = new Box3().setFromObject(child);
    const size = new Vector3();
    box.getSize(size);
    const position = new Vector3();
    child.getWorldPosition(position);
    result.push({
      name: child.userData.equipment,
      scale: { x: scale.x, y: scale.y, z: scale.z },
      size: { x: size.x, y: size.y, z: size.z },
      position: { x: position.x, y: position.y, z: position.z }
    });
  });
  return result;
}

/**
 * 在真实敌方服务里生成指定兵种的首个敌人并返回其根节点。
 *
 * @param {Object} rig
 * @param {number} wave
 * @param {number} randomValue
 * @returns {{root: Object, spawn: Object}}
 */
function spawnFirstEnemyOfType(rig, wave, randomValue) {
  rig.enemies.reset();
  withRandomSequence(new Array(getWaveEnemyCount(wave)).fill(randomValue), () => {
    rig.enemies.startWave(wave);
  });
  const spawnCount = rig.findAll(EVENTS.WORLD_ENEMY_SPAWN).length;
  rig.renderer.setNextHit(null);
  rig.enemies.update(STEP, { x: 0, y: 0, z: 0, eyeHeight: 1.68, alive: true });
  const spawns = rig.findAll(EVENTS.WORLD_ENEMY_SPAWN);
  const roots = rig.renderer
    .addedObjects()
    .filter((object) => typeof object.name === 'string' && object.name.startsWith('human-soldier-'));
  assert.equal(spawns.length, spawnCount + 1, '应生成一个新敌人');
  assert.equal(roots.length, 1, '渲染器应收到一个敌人根节点');
  return { root: roots[0], spawn: spawns[spawns.length - 1].payload };
}

test('开始对局：真实 Pipeline 进入 playing、第一波开始并发布人类士兵 HUD', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.MENU);
  assert.equal(rig.colliders.length >= 40, true, '真实竞技场碰撞体应至少 40 个');

  rig.game.update(STEP);
  assert.equal(rig.renderer.poses.length, 1, '菜单中应推进环绕镜头');
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.MENU);

  rig.game.start();

  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  assert.deepEqual(rig.findLast(EVENTS.GAME_STATE), { state: 'playing' });
  assert.deepEqual(rig.findLast(EVENTS.WAVE_START), { wave: 1 });
  assert.equal(rig.enemies.getState().wave, 1);
  assert.equal(rig.enemies.getState().totalInWave, getWaveEnemyCount(1));

  const hud = rig.findLast(EVENTS.HUD_UPDATE);
  assert.equal(hud.wave, 1);
  assert.equal(hud.health, GAME_CONFIG.player.health);
  assert.equal(hud.maxHealth, GAME_CONFIG.player.maxHealth);
  assert.equal(hud.ammo, GAME_CONFIG.weapon.magazineSize);
  assert.equal(hud.magazineSize, GAME_CONFIG.weapon.magazineSize);
  assert.equal(hud.score, 0);
  assert.equal(hud.kills, 0);

  const banner = rig.findLast(EVENTS.HUD_BANNER);
  assert.equal(banner.title, '第 1 波');
  assert.equal(banner.subtitle, '敌人来袭');

  assert.equal(rig.renderer.attachedCount, 1, '第一人称武器应挂到相机一次');

  rig.runUpdates(3.5);
  const enemyState = rig.enemies.getState();
  assert.equal(enemyState.totalInWave, getWaveEnemyCount(1));
  assert.equal(enemyState.spawned, getWaveEnemyCount(1));
  assert.equal(enemyState.types.rifleman, getWaveEnemyCount(1), '第 1 波应全部为步枪兵');
  assert.equal(enemyState.types.heavy, 0);
  assert.equal(enemyState.types.breacher, 0);

  const typeKeys = Object.keys(enemyState.types);
  assert.deepEqual(typeKeys.sort(), Object.values(ENEMY_TYPES).sort());
  for (const legacy of LEGACY_ENEMY_TYPES) {
    assert.equal(typeKeys.includes(legacy), false, '不应再出现 ' + legacy);
  }

  const roots = rig.renderer
    .addedObjects()
    .filter((object) => typeof object.name === 'string' && object.name.startsWith('human-soldier-'));
  assert.equal(roots.length, enemyState.spawned);
  assert.equal(
    roots.every((root) => root.name === 'human-soldier-rifleman'),
    true,
    '第 1 波渲染对象应全部是步枪兵'
  );

  for (const entry of rig.findAll(EVENTS.WORLD_ENEMY_SPAWN)) {
    const radius = Math.hypot(entry.payload.position.x, entry.payload.position.z);
    assert.equal(radius >= GAME_CONFIG.arena.spawnMinRadius - 1e-6, true);
    assert.equal(radius <= GAME_CONFIG.arena.spawnMaxRadius + 1e-6, true);
  }
});

test('身体命中 26、爆头 52（2 倍），击杀信息与计分使用人类兵种', (t) => {
  const bodyRig = createRig({ recordDamage: true });
  t.after(() => bodyRig.cleanup());

  bodyRig.game.start();
  bodyRig.runUpdates(0.2);
  const bodyTarget = pointRaycastAtEnemyPart(bodyRig, 'body');
  assert.notEqual(bodyTarget, null, '应存在步枪兵身体命中盒');

  const bodyKilled = killOneEnemy(bodyRig, 24, 'body');
  assert.equal(bodyKilled, true, '三次身体命中（26 × 3）应击杀 70 生命步枪兵');
  assert.equal(bodyRig.damageRecords.length, 3, '身体击杀应恰好结算 3 次伤害');
  assert.deepEqual(
    bodyRig.damageRecords.map((entry) => entry.damage),
    [26, 26, 26],
    '身体命中伤害应为 26'
  );
  assert.equal(bodyRig.game.getSnapshot().kills, 1);
  assert.equal(bodyRig.game.getSnapshot().score, GAME_CONFIG.enemies.rifleman.score);

  const bodyKillfeed = bodyRig.findLast(EVENTS.HUD_KILLFEED);
  assert.deepEqual(bodyKillfeed, {
    enemyType: 'rifleman',
    score: GAME_CONFIG.enemies.rifleman.score,
    headshot: false,
    critical: false
  });
  const bodyKilledEvent = bodyRig.findLast(EVENTS.ENEMY_KILLED);
  assert.equal(bodyKilledEvent.enemyType, 'rifleman');
  assert.equal(bodyKilledEvent.headshot, false);
  assert.equal(bodyKilledEvent.critical, false);

  const headRig = createRig({ recordDamage: true });
  t.after(() => headRig.cleanup());

  headRig.game.start();
  headRig.runUpdates(0.2);
  const headTarget = pointRaycastAtEnemyPart(headRig, 'head');
  assert.notEqual(headTarget, null, '应存在步枪兵头部命中盒');

  const headKilled = killOneEnemy(headRig, 24, 'head');
  assert.equal(headKilled, true, '两次爆头（52 × 2）应击杀 70 生命步枪兵');
  assert.equal(headRig.damageRecords.length, 2, '爆头击杀应恰好结算 2 次伤害');
  assert.deepEqual(
    headRig.damageRecords.map((entry) => entry.damage),
    [52, 52],
    '爆头伤害应为 26 × 2 = 52'
  );
  assert.equal(headRig.game.getSnapshot().kills, 1);
  assert.equal(headRig.game.getSnapshot().score, GAME_CONFIG.enemies.rifleman.score);

  const hitmarkers = headRig.findAll(EVENTS.HUD_HITMARKER);
  assert.equal(
    hitmarkers.every((entry) => entry.payload.headshot === true),
    true,
    '爆头命中标记应带 headshot=true'
  );
  assert.equal(hitmarkers[hitmarkers.length - 1].payload.killed, true);

  const headKillfeed = headRig.findLast(EVENTS.HUD_KILLFEED);
  assert.deepEqual(headKillfeed, {
    enemyType: 'rifleman',
    score: GAME_CONFIG.enemies.rifleman.score,
    headshot: true,
    critical: true
  });
  const headKilledEvent = headRig.findLast(EVENTS.ENEMY_KILLED);
  assert.equal(headKilledEvent.headshot, true);
  assert.equal(headKilledEvent.critical, true);
});

test('人类敌人死亡使用血雾而非机械爆炸', (t) => {
  const rig = createRig({ recordDamage: true });
  t.after(() => rig.cleanup());

  rig.game.start();
  rig.runUpdates(0.2);
  assert.equal(killOneEnemy(rig, 24, 'body'), true);

  assert.equal(rig.findAll(EVENTS.WORLD_EXPLOSION).length, 0, '人类士兵死亡不应发 world:explosion');
  assert.equal(rig.effectsCalls.explosion, 0, '不应调用 effects.explosion');
  assert.equal(rig.findAll(EVENTS.WORLD_BLOOD).length >= 2, true, '命中与死亡都应发 world:blood');
  assert.equal(rig.effectsCalls.blood >= 2, true, '应调用真实 effects.blood');
  assert.equal(rig.audioEngine.calls.tone > 0, true, '射击应驱动真实音频编排');
  assert.equal(rig.audioEngine.calls.noise > 0, true);
});

test('真实敌人弹丸伤害经 Pipeline 扣血，并发布带方向的 hud:damage', (t) => {
  // 出生点固定在玩家身后 5 米（玩家朝 -Z），缩短步枪兵进入射程的时间；
  // 敌人 AI、弹丸与伤害转发仍全部使用真实实现。
  const rig = createRig({ spawnPointOverride: { x: 0, y: 0, z: 5 } });
  t.after(() => rig.cleanup());

  rig.game.start();
  const initialHealth = rig.combat.getSnapshot().health;
  assert.equal(initialHealth, GAME_CONFIG.player.health);

  let updates = 0;
  const limit = 600;
  while (rig.combat.getSnapshot().health === initialHealth && updates < limit) {
    rig.game.update(STEP);
    updates += 1;
  }

  const snapshot = rig.game.getSnapshot();
  assert.equal(
    snapshot.player.health < initialHealth,
    true,
    '敌人弹丸应在 ' + limit + ' 步内造成伤害，实际生命 ' + snapshot.player.health
  );
  const damageEvents = rig.findAll(EVENTS.PLAYER_DAMAGE);
  assert.equal(damageEvents.length >= 1, true);
  for (const entry of damageEvents) {
    assert.equal(Number.isFinite(entry.payload.amount), true);
    assert.equal(entry.payload.amount > 0, true);
    assert.equal(typeof entry.payload.sourcePosition, 'object');
    assert.equal(Number.isFinite(entry.payload.sourcePosition.x), true);
  }

  const hudDamage = rig.findLast(EVENTS.HUD_DAMAGE);
  assert.notEqual(hudDamage, null, 'Pipeline 应发布带方向的 hud:damage');
  assert.equal(Number.isFinite(hudDamage.direction), true);
  assert.equal(hudDamage.direction >= -Math.PI - 1e-9, true);
  assert.equal(hudDamage.direction <= Math.PI + 1e-9, true);
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
});

test('受伤方向换算：来源在右为 +π/2，在左为 -π/2，正后方为 ±π', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  rig.game.start();
  const before = rig.combat.getSnapshot().health;

  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 5,
    sourcePosition: { x: 5, y: 1, z: 0 }
  });
  let hudDamage = rig.findLast(EVENTS.HUD_DAMAGE);
  assert.equal(Math.abs(hudDamage.direction - Math.PI / 2) < 1e-6, true, '右侧来源方向应为 +π/2');
  assert.equal(rig.combat.getSnapshot().health, before - 5);

  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 5,
    sourcePosition: { x: -5, y: 1, z: 0 }
  });
  hudDamage = rig.findLast(EVENTS.HUD_DAMAGE);
  assert.equal(Math.abs(hudDamage.direction + Math.PI / 2) < 1e-6, true, '左侧来源方向应为 -π/2');

  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 5,
    sourcePosition: { x: 0, y: 1, z: 5 }
  });
  hudDamage = rig.findLast(EVENTS.HUD_DAMAGE);
  assert.equal(Math.abs(Math.abs(hudDamage.direction) - Math.PI) < 1e-6, true, '正后方应为 ±π');
});

test('暂停冻结战斗、敌人与存活时间，恢复后继续推进', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  rig.game.start();
  rig.game.setInput(createInputCommand({ moveForward: 1, fire: true }));
  rig.game.update(STEP);
  rig.game.setInput(createInputCommand({ moveForward: 1 }));
  rig.game.update(STEP);

  const before = rig.game.getSnapshot();
  rig.game.setInput(createInputCommand({ moveForward: 1, fire: true }));

  rig.game.pause();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PAUSED);
  assert.deepEqual(rig.findLast(EVENTS.GAME_STATE), { state: 'paused' });

  for (let index = 0; index < 12; index += 1) {
    rig.game.update(0.5);
  }

  const frozen = rig.game.getSnapshot();
  assert.equal(frozen.survivedSeconds, before.survivedSeconds);
  assert.equal(frozen.player.x, before.player.x);
  assert.equal(frozen.player.z, before.player.z);
  assert.equal(frozen.player.health, before.player.health);
  assert.equal(frozen.weapon.ammo, before.weapon.ammo);
  assert.deepEqual(frozen.enemies, before.enemies);

  rig.game.resume();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  rig.game.update(STEP);

  const resumed = rig.game.getSnapshot();
  assert.equal(resumed.survivedSeconds > before.survivedSeconds, true);
  assert.equal(resumed.player.z < before.player.z, true, '恢复后输入应继续驱动移动');
});

test('单帧时间被限制为 0.05 秒', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  rig.game.start();
  const before = rig.combat.getSnapshot();
  rig.game.setInput(createInputCommand({ moveForward: 1 }));
  rig.game.update(1.0);

  const after = rig.combat.getSnapshot();
  const distance = Math.abs(after.z - before.z);
  const maxDistance = GAME_CONFIG.player.speed * GAME_CONFIG.match.deltaClamp;
  assert.equal(distance <= maxDistance + 1e-6, true, '位移 ' + distance);
  assert.equal(distance > 0, true);

  const snapshot = rig.game.getSnapshot();
  assert.equal(
    snapshot.survivedSeconds <= GAME_CONFIG.match.deltaClamp + 1e-9,
    true
  );
  assert.equal(snapshot.survivedSeconds > 0.04, true);
});

test('清空第 1 波后等待 4.5 秒推进到第 2 波', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  rig.game.start();

  let updates = 0;
  const killLimit = 800;
  while (updates < killLimit) {
    const state = rig.enemies.getState();
    if (state.waveComplete === true) {
      break;
    }
    if (pointRaycastAtEnemyPart(rig, 'body') !== null) {
      rig.game.setInput(createInputCommand({ fire: true }));
    } else {
      rig.game.setInput(createInputCommand());
    }
    rig.game.update(STEP);
    updates += 1;
  }

  const cleared = rig.enemies.getState();
  assert.equal(cleared.waveComplete, true, '必须清空整波敌人');
  assert.equal(cleared.alive, 0);
  assert.equal(cleared.pendingSpawns, 0);
  assert.equal(cleared.spawned, getWaveEnemyCount(1));
  assert.equal(rig.findAll(EVENTS.WAVE_CLEARED).length, 1);
  assert.deepEqual(rig.findLast(EVENTS.WAVE_CLEARED), { wave: 1 });

  const accounting = rig.game.getSnapshot();
  assert.equal(accounting.kills, getWaveEnemyCount(1));
  assert.equal(
    accounting.score,
    GAME_CONFIG.enemies.rifleman.score * getWaveEnemyCount(1)
  );

  rig.renderer.clearNextHit();
  rig.game.setInput(createInputCommand());
  let waits = 0;
  const waitLimit = 200;
  while (rig.game.getSnapshot().wave === 1 && waits < waitLimit) {
    rig.game.update(STEP);
    waits += 1;
  }

  assert.equal(rig.game.getSnapshot().wave, 2);
  assert.equal(waits >= 88 && waits <= 95, true, '实际等待帧数 ' + waits);
  assert.deepEqual(rig.findLast(EVENTS.WAVE_START), { wave: 2 });
  assert.deepEqual(rig.findLast(EVENTS.HUD_BANNER), {
    title: '第 2 波',
    subtitle: '敌人来袭',
    durationMs: 2200
  });
  assert.equal(rig.enemies.getState().wave, 2);
  assert.equal(
    rig.enemies.getState().totalInWave,
    getWaveEnemyCount(2)
  );
});

test('人类兵种波次组成与缩放：第 2 波重机枪手、第 3 波突击兵、生命随波次提升', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  // 第 2 波：8 个敌人，占比 0.8 / 0.2，用固定随机值交替得到 4 步枪兵 + 4 重机枪手。
  const wave2Values = [];
  for (let index = 0; index < getWaveEnemyCount(2); index += 1) {
    wave2Values.push(index % 2 === 0 ? 0.1 : 0.9);
  }
  withRandomSequence(wave2Values, () => {
    rig.enemies.startWave(2);
  });
  rig.runEnemyUpdates(5.5);
  const wave2 = rig.enemies.getState();
  assert.equal(wave2.spawned, getWaveEnemyCount(2));
  assert.equal(wave2.types.rifleman, 4, '第 2 波应有 4 个步枪兵');
  assert.equal(wave2.types.heavy, 4, '第 2 波应有 4 个重机枪手');
  assert.equal(wave2.types.breacher, 0);
  assert.deepEqual(Object.keys(wave2.types).sort(), Object.values(ENEMY_TYPES).sort());

  // 第 3 波：9 个敌人，占比 0.55 / 0.2 / 0.25，固定循环得到 3/3/3。
  const wave3Values = [];
  const pattern = [0.1, 0.7, 0.9];
  for (let index = 0; index < getWaveEnemyCount(3); index += 1) {
    wave3Values.push(pattern[index % pattern.length]);
  }
  rig.enemies.reset();
  withRandomSequence(wave3Values, () => {
    rig.enemies.startWave(3);
  });
  rig.runEnemyUpdates(6);
  const wave3 = rig.enemies.getState();
  assert.equal(wave3.spawned, getWaveEnemyCount(3));
  assert.equal(wave3.types.rifleman, 3);
  assert.equal(wave3.types.heavy, 3);
  assert.equal(wave3.types.breacher, 3);
  assert.deepEqual(Object.keys(wave3.types).sort(), Object.values(ENEMY_TYPES).sort());

  // 缩放观察：用真实的命中盒与 applyDamage 数出击杀所需 26 伤害次数。
  // 第 1 波步枪兵 70 生命 → 3 次；第 10 波 70 × 1.9 = 133 → 6 次。
  const healthRig = createRig();
  t.after(() => healthRig.cleanup());

  /**
   * @param {number} wave
   * @returns {number}
   */
  function bodyHitsToKill(wave) {
    healthRig.enemies.reset();
    withRandomSequence(new Array(getWaveEnemyCount(wave)).fill(0), () => {
      healthRig.enemies.startWave(wave);
    });
    healthRig.enemies.update(STEP, { x: 0, y: 0, z: 0, eyeHeight: 1.68, alive: true });
    const entries = healthRig.enemies.getTargetQuery().listHittable();
    const body = entries.find((entry) => entry.object.userData.part === 'body');
    assert.notEqual(body, undefined);
    let hits = 0;
    let result = null;
    while (hits < 40) {
      hits += 1;
      result = healthRig.enemies.getTargetQuery().applyDamage(
        body.object.userData.targetId,
        26
      );
      if (result.killed === true) {
        return hits;
      }
    }
    return hits;
  }

  const wave1Hits = bodyHitsToKill(1);
  const wave10Hits = bodyHitsToKill(10);
  assert.equal(wave1Hits, 3, '第 1 波 70 生命步枪兵应 3 次身体命中击杀');
  assert.equal(wave10Hits, 6, '第 10 波 133 生命步枪兵应 6 次身体命中击杀');
  assert.equal(
    wave10Hits > wave1Hits,
    true,
    '生命缩放应使高波次需要更多命中'
  );
});

test('死亡进入结算，重开重置得分/波次/击杀/生命并回到 playing', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  rig.game.start();
  assert.equal(killOneEnemy(rig, 24, 'body'), true);
  rig.game.setInput(createInputCommand());

  const beforeDeath = rig.game.getSnapshot();
  assert.equal(beforeDeath.kills, 1);
  assert.equal(beforeDeath.score, GAME_CONFIG.enemies.rifleman.score);

  rig.combat.damagePlayer(1000);

  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);
  assert.deepEqual(rig.findLast(EVENTS.GAME_STATE), { state: 'over' });
  const gameover = rig.findLast(EVENTS.HUD_GAMEOVER);
  assert.equal(gameover.score, beforeDeath.score);
  assert.equal(gameover.wave, beforeDeath.wave);
  assert.equal(gameover.kills, beforeDeath.kills);
  assert.equal(gameover.survivedSeconds >= 0, true);

  rig.game.update(STEP);
  rig.game.update(STEP);
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);
  assert.equal(rig.findAll(EVENTS.HUD_GAMEOVER).length, 1);

  rig.game.restart();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  assert.deepEqual(rig.findLast(EVENTS.GAME_STATE), { state: 'playing' });

  const reset = rig.game.getSnapshot();
  assert.equal(reset.score, 0);
  assert.equal(reset.kills, 0);
  assert.equal(reset.wave, 1);
  assert.equal(reset.survivedSeconds, 0);
  assert.equal(reset.player.health, GAME_CONFIG.player.health);
  assert.equal(reset.player.alive, true);
  assert.equal(reset.weapon.ammo, GAME_CONFIG.weapon.magazineSize);
  assert.equal(reset.enemies.wave, 1);
  assert.equal(reset.enemies.alive, 0);
  assert.deepEqual(rig.enemies.getTargetQuery().listHittable(), []);
  assert.equal(rig.findLast(EVENTS.HUD_UPDATE).score, 0);
});

test('设置：默认/范围/夹紧、转发、settings:changed、快照、重开保留与性能仪表', (t) => {
  const rig = createRig();
  t.after(() => rig.cleanup());

  const defaults = GAME_CONFIG.settings.defaults;
  assert.deepEqual(rig.game.getSettings(), defaults);
  assert.equal(Object.isFrozen(rig.game.getSettings()), true);

  // 非法输入不写入状态。
  assert.throws(() => rig.game.applySettings('nope'), TypeError);
  assert.throws(() => rig.game.applySettings({ fov: Number.NaN }), TypeError);
  assert.throws(() => rig.game.applySettings({ quality: 'ultra' }), RangeError);
  assert.deepEqual(rig.game.getSettings(), defaults, '非法输入后设置应保持不变');

  // 夹紧到范围边界，并转发给真实战斗服务、假渲染器与假音频引擎。
  const applied = rig.game.applySettings({
    mouseSensitivity: 99,
    adsSensitivityMultiplier: 0.01,
    fov: 999,
    masterVolume: 5,
    quality: 'low'
  });
  assert.equal(applied.mouseSensitivity, GAME_CONFIG.settings.ranges.mouseSensitivity.max);
  assert.equal(applied.adsSensitivityMultiplier, GAME_CONFIG.settings.ranges.adsSensitivityMultiplier.min);
  assert.equal(applied.fov, GAME_CONFIG.settings.ranges.fov.max);
  assert.equal(applied.masterVolume, GAME_CONFIG.settings.ranges.masterVolume.max);
  assert.equal(applied.quality, 'low');

  assert.deepEqual(rig.combat.getSettings(), {
    mouseSensitivity: applied.mouseSensitivity,
    adsSensitivityMultiplier: applied.adsSensitivityMultiplier,
    fov: applied.fov
  });
  assert.equal(rig.renderer.qualityChanges.includes('low'), true, '应调用 renderer.setQuality(low)');
  assert.equal(rig.renderer.getQuality(), 'low');
  assert.equal(
    rig.audioEngine.calls.masterVolume.includes(1),
    true,
    '应把主音量转发给音频引擎'
  );

  const changed = rig.findLast(EVENTS.SETTINGS_CHANGED);
  assert.deepEqual(changed.settings, applied);
  assert.equal(rig.game.getSnapshot().settings.quality, 'low');

  const performanceLow = rig.game.getPerformance();
  assert.equal(isPerformanceSnapshot(performanceLow), true);
  assert.equal(performanceLow.quality, 'low');
  assert.equal(performanceLow.postProcessing, false, '低画质应关闭后处理');
  assert.equal(performanceLow.enemyCount, 0);

  // 返回的是冻结副本，修改它不影响 Pipeline。
  const copy = rig.game.getSettings();
  try {
    copy.fov = 1;
  } catch (error) {
    assert.equal(error instanceof TypeError, true);
  }
  assert.equal(rig.game.getSettings().fov, applied.fov);

  // 恢复高画质并确认后处理状态。
  rig.game.applySettings({ quality: 'high', fov: 83, masterVolume: 0.35 });
  assert.equal(rig.renderer.qualityChanges.includes('high'), true);
  assert.equal(rig.game.getPerformance().postProcessing, true, '高画质应开启后处理');
  assert.equal(rig.renderer.qualityChanges[rig.renderer.qualityChanges.length - 1], 'high');

  // 性能仪表在运行时更新；敌人数量与敌方服务一致。
  rig.game.start();
  rig.runUpdates(0.6);
  const framesBefore = rig.game.getPerformance().frameCount;
  rig.game.update(0.02);
  rig.game.update(0.02);
  const performance = rig.game.getPerformance();
  assert.equal(performance.frameCount >= framesBefore + 2, true);
  assert.equal(performance.fps > 0, true, '有帧采样后 fps 应大于 0');
  assert.equal(performance.enemyCount, rig.enemies.getState().alive);
  assert.equal(performance.quality, 'high');
  assert.equal(performance.postProcessing, true);
  assert.equal(isPerformanceSnapshot(performance), true);

  // 设置跨重开保留，计分/波次仍复位。
  rig.game.applySettings({ fov: 88, mouseSensitivity: 1.7 });
  const beforeRestart = rig.game.getSettings();
  rig.game.restart();
  assert.deepEqual(rig.game.getSettings(), beforeRestart);
  assert.equal(rig.game.getSnapshot().score, 0);
  assert.equal(rig.game.getSnapshot().wave, 1);
  assert.equal(rig.game.getSnapshot().settings.fov, 88);
});

test('人类士兵装具世界尺度：头盔/面罩小于 0.5 米，不贴近原点或相机，敌人留在出生环带', async (t) => {
  const fakeAssets = createFakeHumanAssets();

  /**
   * @param {number} wave
   * @param {number} randomValue
   * @param {string} expectedRootName
   * @returns {Promise<Object>}
   */
  async function inspectType(wave, randomValue, expectedRootName) {
    const rig = createRig({ assets: fakeAssets });
    try {
      await rig.enemies.load();
      const spawned = spawnFirstEnemyOfType(rig, wave, randomValue);
      const root = spawned.root;
      assert.equal(root.name, expectedRootName);

      const spawnRadius = Math.hypot(
        spawned.spawn.position.x,
        spawned.spawn.position.z
      );
      assert.equal(spawnRadius >= GAME_CONFIG.arena.spawnMinRadius - 1e-6, true);
      assert.equal(spawnRadius <= GAME_CONFIG.arena.spawnMaxRadius + 1e-6, true);
      assert.equal(
        Math.hypot(root.position.x, root.position.z) >= GAME_CONFIG.arena.spawnMinRadius - 0.6,
        true,
        '首个敌人的根节点应仍在出生环带附近'
      );
      assert.equal(
        Math.hypot(root.position.x, root.position.z) >= GAME_CONFIG.arena.minPlayerDistance,
        true,
        '敌人与玩家距离应不小于 10 米'
      );

      const equipment = collectEquipment(root);
      assert.equal(equipment.length > 0, true, '应生成人类装具');
      const names = equipment.map((item) => item.name);
      assert.equal(names.includes('helmet'), true);
      assert.equal(names.includes('face-mask'), true);
      assert.equal(names.includes('vest'), true);

      for (const item of equipment) {
        const maxScale = Math.max(item.scale.x, item.scale.y, item.scale.z);
        const minScale = Math.min(item.scale.x, item.scale.y, item.scale.z);
        assert.equal(
          minScale >= 0.9 && maxScale <= 1.3,
          true,
          item.name + ' 世界缩放应接近人体尺度，实际 ' + JSON.stringify(item.scale)
        );

        const originDistance = Math.hypot(
          item.position.x,
          item.position.y,
          item.position.z
        );
        assert.equal(
          originDistance >= 10,
          true,
          item.name + ' 不应贴近世界原点，实际距离 ' + originDistance
        );
        const cameraDistance = Math.hypot(
          item.position.x,
          item.position.y - GAME_CONFIG.player.eyeHeight,
          item.position.z
        );
        assert.equal(
          cameraDistance >= 10,
          true,
          item.name + ' 不应贴近相机，实际距离 ' + cameraDistance
        );
        assert.equal(
          Math.hypot(
            item.position.x - root.position.x,
            item.position.z - root.position.z
          ) <= 2.5,
          true,
          item.name + ' 应挂在敌人身上'
        );
      }

      for (const name of ['helmet', 'face-mask']) {
        const helmetOrMask = equipment.filter((item) => item.name === name);
        assert.equal(helmetOrMask.length > 0, true);
        for (const item of helmetOrMask) {
          const maxSize = Math.max(item.size.x, item.size.y, item.size.z);
          assert.equal(
            maxSize < 0.5,
            true,
            name + ' 包围盒应小于 0.5 米，实际 ' + maxSize
          );
        }
      }

      return { equipment, root, spawn: spawned.spawn };
    } finally {
      rig.cleanup();
    }
  }

  const rifleman = await inspectType(1, 0, 'human-soldier-rifleman');
  assert.equal(
    rifleman.equipment.some((item) => item.name === 'rifle'),
    true,
    '步枪兵应持步枪'
  );

  await inspectType(2, 0.99, 'human-soldier-heavy');
  await inspectType(3, 0.99, 'human-soldier-breacher');
});
