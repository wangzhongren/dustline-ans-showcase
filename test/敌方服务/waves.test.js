/**
 * 敌方服务单元测试（v3：人类士兵）。
 *
 * 覆盖：
 * - 波次数量、三类人类士兵的占比、缩放倍数与上限（纯函数）。
 * - 生成数量与 0.55 秒间隔。
 * - 头/身命中盒、爆头标记、击杀分值、未命中、生命不低于 0。
 * - 死亡立即移出可命中列表、播放死亡、尸体保留 4 秒后移除。
 * - 血雾事件替代机械爆炸。
 * - 掉落概率纯函数与拾取事件。
 * - 弹丸对玩家/障碍物的碰撞与寿命。
 * - 步枪兵点射与曳光事件、重机枪手三连发、突击兵近战冷却。
 * - reset / dispose 清理，且不残留尸体。
 *
 * 使用假渲染器与假生成点，不创建 WebGL 上下文；执行命令：
 * node --test test/敌方服务/waves.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_TYPES,
  GAME_CONFIG,
  getEnemyScaling,
  getEnemyTypeShares,
  getWaveEnemyCount
} from '../../src/models/game-config.js';
import { EVENTS } from '../../src/models/events.js';
import { createEnemies } from '../../src/services/public/enemies.js';
import {
  composeWave,
  createEnemyStats,
  createWavePlan,
  pickEnemyType,
  shouldDropPickup
} from '../../src/services/impl/enemies/waves.js';
import { createEnemy } from '../../src/services/impl/enemies/enemy.js';
import {
  createProjectile,
  ENEMY_TRACER_COLOR,
  PROJECTILE_STATUS
} from '../../src/services/impl/enemies/projectile.js';
import {
  createPickup,
  PICKUP_STATUS
} from '../../src/services/impl/enemies/pickup.js';

const PLAYER = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  eyeHeight: GAME_CONFIG.player.eyeHeight,
  yaw: 0,
  pitch: 0,
  velocityX: 0,
  velocityZ: 0,
  health: 100,
  maxHealth: 100,
  alive: true
});

/**
 * @param {number} actual
 * @param {number} expected
 * @param {string} [message]
 * @returns {void}
 */
function assertClose(actual, expected, message) {
  let text = '数值应接近 ' + expected;
  if (typeof message === 'string' && message.length > 0) {
    text = message;
  }
  assert.ok(Math.abs(actual - expected) < 1e-9, text + '，实际 ' + actual);
}

/**
 * @param {{
 *   spawnPoint?: { x:number, y:number, z:number },
 *   colliders?: Array<{ min:Object, max:Object }>,
 *   assets?: Object
 * }} [options]
 * @returns {{
 *   enemies: ReturnType<typeof createEnemies>,
 *   renderer: Object,
 *   added: Object[],
 *   removed: Object[],
 *   events: Array<{ name:string, payload:Object }>,
 *   spawnRequests: Object[]
 * }}
 */
function createHarness(options) {
  let settings = options;
  if (settings === undefined) {
    settings = {};
  }
  let spawnPoint = { x: 24, y: 0, z: 0 };
  if (settings.spawnPoint !== undefined) {
    spawnPoint = settings.spawnPoint;
  }
  let colliders = [];
  if (settings.colliders !== undefined) {
    colliders = settings.colliders;
  }

  const added = [];
  const removed = [];
  const events = [];
  const spawnRequests = [];
  const renderer = {
    add(object) {
      added.push(object);
    },
    remove(object) {
      removed.push(object);
    },
    attachToCamera() {},
    getCameraPose() {
      return { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, fov: 75 };
    }
  };
  const getSpawnPoint = function querySpawnPoint(request) {
    spawnRequests.push(request);
    return { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z };
  };
  const emit = function emitEvent(name, payload) {
    events.push({ name, payload });
  };
  const enemies = createEnemies({
    renderer,
    colliders,
    getSpawnPoint,
    emit,
    assets: settings.assets
  });

  return { enemies, renderer, added, removed, events, spawnRequests };
}

/**
 * 生成并击杀当前所有已生成敌人。
 *
 * @param {ReturnType<typeof createEnemies>} enemies
 * @returns {number} 击杀数量
 */
function killAllSpawned(enemies) {
  const query = enemies.getTargetQuery();
  let kills = 0;
  let guard = 0;
  while (query.listHittable().length > 0 && guard < 200) {
    const entry = query.listHittable()[0];
    const result = query.applyDamage(entry.targetId, 100000);
    if (result.killed) {
      kills += 1;
    }
    guard += 1;
  }
  return kills;
}

/**
 * @param {Array<{name:string, payload:Object}>} events
 * @param {string} name
 * @returns {Array<Object>}
 */
function eventsByName(events, name) {
  return events.filter(function match(event) {
    return event.name === name;
  });
}

/* ------------------------------- 波次纯函数 ------------------------------- */

test('波次数量按 min(4 + round(1.8n), 32) 计算', () => {
  assert.equal(getWaveEnemyCount(1), 6);
  assert.equal(getWaveEnemyCount(5), 13);
  assert.equal(getWaveEnemyCount(10), 22);
  assert.equal(getWaveEnemyCount(20), 32);
  assert.equal(getWaveEnemyCount(100), 32);

  assert.equal(createWavePlan(1, () => 0.5).count, 6);
  assert.equal(createWavePlan(1, () => 0.5).spawnInterval, 0.55);
});

test('第 1 波只有步枪兵，第 2 波出现重机枪手，第 3 波出现突击兵', () => {
  const waveOne = getEnemyTypeShares(1);
  assert.equal(waveOne.rifleman, 1);
  assert.equal(waveOne.heavy, 0);
  assert.equal(waveOne.breacher, 0);

  const waveTwo = getEnemyTypeShares(2);
  assert.equal(waveTwo.rifleman, 0.8);
  assert.equal(waveTwo.heavy, 0.2);
  assert.equal(waveTwo.breacher, 0);

  const waveThree = getEnemyTypeShares(3);
  assert.equal(waveThree.rifleman, 0.55);
  assert.equal(waveThree.heavy, 0.2);
  assert.equal(waveThree.breacher, 0.25);

  assert.equal(pickEnemyType(1, 0.999), ENEMY_TYPES.RIFLEMAN);
  assert.equal(pickEnemyType(2, 0.79), ENEMY_TYPES.RIFLEMAN);
  assert.equal(pickEnemyType(2, 0.8), ENEMY_TYPES.HEAVY);
  assert.equal(pickEnemyType(2, 0.999), ENEMY_TYPES.HEAVY);
  assert.equal(pickEnemyType(3, 0.549), ENEMY_TYPES.RIFLEMAN);
  assert.equal(pickEnemyType(3, 0.55), ENEMY_TYPES.HEAVY);
  assert.equal(pickEnemyType(3, 0.749), ENEMY_TYPES.HEAVY);
  assert.equal(pickEnemyType(3, 0.75), ENEMY_TYPES.BREACHER);
  assert.equal(pickEnemyType(10, 0.99), ENEMY_TYPES.BREACHER);
});

test('按波次组成的类型序列长度与波次数量一致', () => {
  const waveOne = composeWave(1, () => 0.42);
  assert.equal(waveOne.length, 6);
  for (const type of waveOne) {
    assert.equal(type, ENEMY_TYPES.RIFLEMAN);
  }

  const waveTwo = composeWave(2, () => 0.95);
  assert.equal(waveTwo.length, 8);
  for (const type of waveTwo) {
    assert.equal(type, ENEMY_TYPES.HEAVY);
  }

  const waveThree = composeWave(3, () => 0.9);
  assert.equal(waveThree.length, 9);
  for (const type of waveThree) {
    assert.equal(type, ENEMY_TYPES.BREACHER);
  }
});

test('缩放倍数与上限符合设计', () => {
  const waveOne = getEnemyScaling(1);
  assert.equal(waveOne.healthMultiplier, 1);
  assert.equal(waveOne.speedMultiplier, 1);
  assert.equal(waveOne.damageMultiplier, 1);

  const waveFive = getEnemyScaling(5);
  assertClose(waveFive.healthMultiplier, 1.4);
  assertClose(waveFive.speedMultiplier, 1.08);
  assertClose(waveFive.damageMultiplier, 1.2);

  const waveTen = getEnemyScaling(10);
  assertClose(waveTen.healthMultiplier, 1.9);
  assertClose(waveTen.speedMultiplier, 1.18);
  assertClose(waveTen.damageMultiplier, 1.45);

  const capped = getEnemyScaling(100);
  assert.equal(capped.healthMultiplier, 3);
  assert.equal(capped.speedMultiplier, 1.25);
  assert.equal(capped.damageMultiplier, 2);
});

test('人类士兵基础数值按波次缩放且应用上限', () => {
  const waveOneRifleman = createEnemyStats(ENEMY_TYPES.RIFLEMAN, 1);
  assert.equal(waveOneRifleman.health, 70);
  assert.equal(waveOneRifleman.speed, 5);
  assert.equal(waveOneRifleman.damage, 7);
  assert.equal(waveOneRifleman.score, 100);
  assert.equal(waveOneRifleman.color, GAME_CONFIG.enemies.rifleman.color);

  const waveTenRifleman = createEnemyStats(ENEMY_TYPES.RIFLEMAN, 10);
  assertClose(waveTenRifleman.health, 133);
  assertClose(waveTenRifleman.speed, 5.9);
  assertClose(waveTenRifleman.damage, 10.15);

  const waveTenHeavy = createEnemyStats(ENEMY_TYPES.HEAVY, 10);
  assertClose(waveTenHeavy.health, 380);
  assertClose(waveTenHeavy.speed, 3.304);
  assertClose(waveTenHeavy.damage, 15.95);
  assert.equal(waveTenHeavy.score, 300);

  const waveOneBreacher = createEnemyStats(ENEMY_TYPES.BREACHER, 1);
  assert.equal(waveOneBreacher.health, 85);
  assert.equal(waveOneBreacher.speed, 7.2);
  assert.equal(waveOneBreacher.damage, 14);
  assert.equal(waveOneBreacher.score, 150);

  const cappedBreacher = createEnemyStats(ENEMY_TYPES.BREACHER, 100);
  assertClose(cappedBreacher.health, 255);
  assertClose(cappedBreacher.speed, 9);
  assertClose(cappedBreacher.damage, 28);
});

test('掉落概率纯函数在固定随机值下的结果稳定', () => {
  assert.equal(shouldDropPickup(0, 0.18), true);
  assert.equal(shouldDropPickup(0.179, 0.18), true);
  assert.equal(shouldDropPickup(0.18, 0.18), false);
  assert.equal(shouldDropPickup(0.9, 0.18), false);
  assert.equal(shouldDropPickup(0.17), true);
  assert.equal(shouldDropPickup(0.5), false);
  assert.throws(() => shouldDropPickup(1, 0.18), RangeError);
  assert.throws(() => shouldDropPickup(-0.01, 0.18), RangeError);
  assert.throws(() => shouldDropPickup(0.5, 1.5), RangeError);
});

/* ------------------------------- 公共入口 ------------------------------- */

test('createEnemies 对缺失参数抛出明确 TypeError', () => {
  const renderer = { add() {}, remove() {} };
  assert.throws(() => createEnemies(), TypeError);
  assert.throws(
    () => createEnemies({ getSpawnPoint() {}, emit() {} }),
    TypeError
  );
  assert.throws(
    () => createEnemies({ renderer, emit() {} }),
    TypeError
  );
  assert.throws(
    () => createEnemies({ renderer, getSpawnPoint() {} }),
    TypeError
  );
  assert.throws(
    () =>
      createEnemies({
        renderer,
        getSpawnPoint() {},
        emit() {},
        colliders: {}
      }),
    TypeError
  );
  assert.throws(
    () =>
      createEnemies({
        renderer,
        getSpawnPoint() {},
        emit() {},
        assets: 42
      }),
    TypeError
  );
  assert.throws(
    () =>
      createEnemies({
        renderer,
        getSpawnPoint() {},
        emit() {},
        assets: { loadGltf: 42 }
      }),
    TypeError
  );
});

test('load 是幂等的 Promise，没有素材加载器时记录错误并回退', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = function captureError(...args) {
    logged.push(args);
  };

  try {
    const harness = createHarness();
    const { enemies } = harness;
    const first = enemies.load();
    const second = enemies.load();
    assert.equal(first, second);
    assert.equal(typeof first.then, 'function');
    await first;
    assert.ok(
      logged.some(function hasMessage(args) {
        return String(args[0]).includes('loadGltf');
      })
    );
  } finally {
    console.error = originalError;
  }
});

test('生成点查询失败时记录错误、暂停本帧生成并保留队列', () => {
  const originalError = console.error;
  const logged = [];
  console.error = function captureError(...args) {
    logged.push(args);
  };

  try {
    const events = [];
    const renderer = { add() {}, remove() {} };
    const enemies = createEnemies({
      renderer,
      colliders: [],
      getSpawnPoint() {
        throw new Error('test spawn failure');
      },
      emit(name, payload) {
        events.push({ name, payload });
      }
    });

    enemies.startWave(1);
    enemies.update(0.01, PLAYER);

    const state = enemies.getState();
    assert.equal(state.spawned, 0);
    assert.equal(state.alive, 0);
    assert.equal(state.pendingSpawns, 6);
    assert.ok(logged.length >= 1);
    assert.equal(events.length, 0);
  } finally {
    console.error = originalError;
  }
});

test('startWave 生成排队、按 0.55 秒间隔逐个生成', () => {
  const harness = createHarness();
  const { enemies, events, spawnRequests } = harness;

  enemies.startWave(1);
  const initial = enemies.getState();
  assert.equal(initial.wave, 1);
  assert.equal(initial.alive, 0);
  assert.equal(initial.pendingSpawns, 6);
  assert.equal(initial.totalInWave, 6);
  assert.equal(initial.spawned, 0);
  assert.equal(initial.waveComplete, false);
  assert.deepEqual(initial.types, { rifleman: 0, heavy: 0, breacher: 0 });

  enemies.update(0.01, PLAYER);
  assert.equal(enemies.getState().spawned, 1);
  assert.equal(enemies.getState().alive, 1);
  assert.equal(enemies.getState().pendingSpawns, 5);

  enemies.update(0.5, PLAYER);
  assert.equal(enemies.getState().spawned, 1);

  enemies.update(0.05, PLAYER);
  assert.equal(enemies.getState().spawned, 2);

  const spawnEvents = eventsByName(events, EVENTS.WORLD_ENEMY_SPAWN);
  assert.equal(spawnEvents.length, 2);
  assert.equal(spawnEvents[0].payload.color, GAME_CONFIG.enemies.rifleman.color);
  assert.equal(spawnRequests[0].minDistance, GAME_CONFIG.arena.minPlayerDistance);
  assert.deepEqual(spawnRequests[0].playerPosition, { x: 0, y: 0, z: 0 });
});

test('一波全部生成并消灭后 waveComplete 为 true', () => {
  const harness = createHarness();
  const { enemies } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);
  for (let index = 0; index < 5; index += 1) {
    enemies.update(0.55, PLAYER);
  }

  const spawnedState = enemies.getState();
  assert.equal(spawnedState.spawned, 6);
  assert.equal(spawnedState.pendingSpawns, 0);
  assert.equal(spawnedState.alive, 6);
  assert.equal(spawnedState.waveComplete, false);

  const kills = killAllSpawned(enemies);
  assert.equal(kills, 6);

  const finalState = enemies.getState();
  assert.equal(finalState.alive, 0);
  assert.equal(finalState.pendingSpawns, 0);
  assert.equal(finalState.waveComplete, true);
});

test('startWave 替换待生成队列但保留已有敌人', () => {
  const harness = createHarness();
  const { enemies } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);
  assert.equal(enemies.getState().alive, 1);
  assert.equal(enemies.getState().pendingSpawns, 5);

  enemies.startWave(2);
  const state = enemies.getState();
  assert.equal(state.wave, 2);
  assert.equal(state.alive, 1);
  assert.equal(state.totalInWave, 8);
  assert.equal(state.spawned, 0);
  assert.equal(state.pendingSpawns, 8);
});

/* ------------------------------- 命中结算 ------------------------------- */

test('applyDamage 区分头部与身体，击杀返回分值并立即移除目标', () => {
  const harness = createHarness();
  const { enemies, events } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);

  const query = enemies.getTargetQuery();
  const entries = query.listHittable();
  assert.equal(entries.length, 2);

  let bodyEntry = null;
  let headEntry = null;
  for (const entry of entries) {
    assert.equal(typeof entry.targetId, 'string');
    assert.ok(entry.object);
    assert.equal(entry.object.userData.targetId, entry.targetId);
    const part = entry.object.userData.part;
    assert.ok(part === 'head' || part === 'body');
    if (part === 'body') {
      bodyEntry = entry;
    }
    if (part === 'head') {
      headEntry = entry;
    }
  }
  assert.ok(bodyEntry);
  assert.ok(headEntry);

  const headHit = query.applyDamage(headEntry.targetId, 10);
  assert.equal(headHit.hit, true);
  assert.equal(headHit.killed, false);
  assert.equal(headHit.headshot, true);
  assert.equal(headHit.critical, true);
  assert.equal(headHit.score, 0);
  assert.equal(headHit.enemyType, ENEMY_TYPES.RIFLEMAN);
  assert.equal(headHit.color, GAME_CONFIG.enemies.rifleman.color);

  const bodyHit = query.applyDamage(bodyEntry.targetId, 10);
  assert.equal(bodyHit.hit, true);
  assert.equal(bodyHit.killed, false);
  assert.equal(bodyHit.headshot, false);
  assert.equal(bodyHit.critical, false);

  const blood = eventsByName(events, EVENTS.WORLD_BLOOD);
  assert.ok(blood.length >= 2);
  assert.equal(typeof blood[0].payload.position.y, 'number');
  assert.equal(typeof blood[0].payload.direction.x, 'number');

  const killHit = query.applyDamage(headEntry.targetId, 1000);
  assert.equal(killHit.hit, true);
  assert.equal(killHit.killed, true);
  assert.equal(killHit.headshot, true);
  assert.equal(killHit.score, 100);
  assert.equal(enemies.getState().alive, 0);
  assert.equal(query.listHittable().length, 0);

  const afterDeath = query.applyDamage(headEntry.targetId, 10);
  assert.equal(afterDeath.hit, false);
  assert.equal(afterDeath.killed, false);
  assert.equal(afterDeath.headshot, false);

  const explosions = eventsByName(events, EVENTS.WORLD_EXPLOSION);
  assert.equal(explosions.length, 0);
});

test('敌人生命扣到 0 后不会变成负数', () => {
  const enemy = createEnemy({
    id: 'enemy-clamp',
    type: ENEMY_TYPES.RIFLEMAN,
    modelId: 'adventurer',
    stats: createEnemyStats(ENEMY_TYPES.RIFLEMAN, 1),
    position: { x: 0, y: 0, z: 0 }
  });

  const first = enemy.applyDamage(9999);
  assert.equal(first.killed, true);
  assert.equal(first.health, 0);
  assert.equal(enemy.getHealth(), 0);
  assert.equal(enemy.listHittable().length, 0);

  const second = enemy.applyDamage(50);
  assert.equal(second.killed, false);
  assert.equal(second.health, 0);

  enemy.dispose();
});

test('死亡后尸体保留 4 秒再淡出移除，期间不再可命中', () => {
  const harness = createHarness();
  const { enemies, added, removed } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);

  const query = enemies.getTargetQuery();
  const entry = query.listHittable()[0];
  const enemyRoot = added[0];
  const kill = query.applyDamage(entry.targetId, 100000);
  assert.equal(kill.killed, true);
  assert.equal(query.listHittable().length, 0);
  assert.equal(enemies.getState().alive, 0);

  enemies.update(0.5, PLAYER);
  assert.equal(removed.includes(enemyRoot), false);

  enemies.update(3.6, PLAYER);
  assert.equal(removed.includes(enemyRoot), true);
});

/* ------------------------------- 掉落与拾取 ------------------------------- */

test('击杀按固定随机值掉落生命球，玩家靠近时收集并发出事件', () => {
  const originalRandom = Math.random;
  Math.random = function fixedRandom() {
    return 0.05;
  };

  try {
    const harness = createHarness({ spawnPoint: { x: 0.5, y: 0, z: 0 } });
    const { enemies, events } = harness;

    enemies.startWave(1);
    enemies.update(0.01, PLAYER);

    const query = enemies.getTargetQuery();
    const entry = query.listHittable()[0];
    const deathX = entry.object.parent.position.x;
    const deathZ = entry.object.parent.position.z;
    const kill = query.applyDamage(entry.targetId, 100000);
    assert.equal(kill.killed, true);

    const spawnEvent = events.find(
      (event) => event.name === EVENTS.PICKUP_SPAWN
    );
    assert.ok(spawnEvent);
    assert.equal(spawnEvent.payload.amount, GAME_CONFIG.arena.pickupHealAmount);
    assert.deepEqual(spawnEvent.payload.position, { x: deathX, y: 0, z: deathZ });

    enemies.update(0.01, PLAYER);
    const collectedEvent = events.find(
      (event) => event.name === EVENTS.PICKUP_COLLECTED
    );
    assert.ok(collectedEvent);
    assert.equal(
      collectedEvent.payload.amount,
      GAME_CONFIG.arena.pickupHealAmount
    );
    assert.deepEqual(collectedEvent.payload.position, { x: deathX, y: 0, z: deathZ });
  } finally {
    Math.random = originalRandom;
  }
});

test('拾取物 25 秒后过期，未靠近时不收集', () => {
  const pickup = createPickup({
    position: { x: 10, y: 0, z: 10 },
    amount: GAME_CONFIG.arena.pickupHealAmount
  });

  const farStatus = pickup.update(0.01, PLAYER);
  assert.equal(farStatus, PICKUP_STATUS.ACTIVE);
  assert.equal(pickup.getAge(), 0.01);

  const expiredStatus = pickup.update(GAME_CONFIG.arena.pickupLifetime, PLAYER);
  assert.equal(expiredStatus, PICKUP_STATUS.EXPIRED);

  pickup.dispose();
});

/* ------------------------------- 弹丸 ------------------------------- */

test('弹丸命中玩家返回 player 状态', () => {
  const projectile = createProjectile({
    position: { x: 0, y: 1, z: -1 },
    direction: { x: 0, y: 0, z: 1 },
    speed: 10,
    damage: 7
  });

  const status = projectile.update(0.12, { colliders: [], player: PLAYER });
  assert.equal(status, PROJECTILE_STATUS.PLAYER);

  projectile.dispose();
});

test('弹丸撞到障碍物与地面时返回 blocked', () => {
  const collider = {
    min: { x: -0.5, y: 0, z: -1.5 },
    max: { x: 0.5, y: 2, z: -0.5 }
  };
  const blockedByObstacle = createProjectile({
    position: { x: 0, y: 1, z: -0.6 },
    direction: { x: 0, y: 0, z: 1 },
    speed: 10,
    damage: 7
  });
  const obstacleStatus = blockedByObstacle.update(0.01, {
    colliders: [collider],
    player: PLAYER
  });
  assert.equal(obstacleStatus, PROJECTILE_STATUS.BLOCKED);
  blockedByObstacle.dispose();

  const blockedByGround = createProjectile({
    position: { x: 5, y: 0.2, z: 5 },
    direction: { x: 0, y: -1, z: 0 },
    speed: 10,
    damage: 7
  });
  const groundStatus = blockedByGround.update(0.05, {
    colliders: [],
    player: PLAYER
  });
  assert.equal(groundStatus, PROJECTILE_STATUS.BLOCKED);
  blockedByGround.dispose();
});

test('弹丸超过寿命后返回 expired', () => {
  const projectile = createProjectile({
    position: { x: 5, y: 2, z: 5 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 1,
    damage: 7
  });
  const status = projectile.update(7, { colliders: [], player: PLAYER });
  assert.equal(status, PROJECTILE_STATUS.EXPIRED);
  projectile.dispose();
});

/* ------------------------------- 行为与重置 ------------------------------- */

test('步枪兵保持距离、三发点射并发出 shot 与 player:damage 事件', () => {
  const harness = createHarness({ spawnPoint: { x: 14, y: 0, z: 0 } });
  const { enemies, events } = harness;

  enemies.startWave(1);
  for (let index = 0; index < 160; index += 1) {
    enemies.update(0.05, PLAYER);
  }

  const shotEvents = eventsByName(events, EVENTS.WORLD_ENEMY_SHOT);
  assert.ok(shotEvents.length >= 3);
  assert.equal(shotEvents[0].payload.enemyType, ENEMY_TYPES.RIFLEMAN);
  assert.equal(shotEvents[0].payload.color, ENEMY_TRACER_COLOR);
  assert.equal(typeof shotEvents[0].payload.direction.x, 'number');

  const damageEvents = eventsByName(events, EVENTS.PLAYER_DAMAGE);
  assert.ok(damageEvents.length > 0);
  assert.equal(damageEvents[0].payload.amount, GAME_CONFIG.enemies.rifleman.damage);
  assert.equal(typeof damageEvents[0].payload.sourcePosition.x, 'number');
});

test('重机枪手以三连发开火，伤害按波次缩放', () => {
  const originalRandom = Math.random;
  Math.random = function fixedRandom() {
    return 0.95;
  };

  try {
    const harness = createHarness({ spawnPoint: { x: 8, y: 0, z: 0 } });
    const { enemies, events } = harness;

    enemies.startWave(2);
    for (let index = 0; index < 160; index += 1) {
      enemies.update(0.05, PLAYER);
    }

    const shots = eventsByName(events, EVENTS.WORLD_ENEMY_SHOT);
    assert.ok(shots.length >= 3);
    assert.equal(shots[0].payload.enemyType, ENEMY_TYPES.HEAVY);

    const damageEvents = eventsByName(events, EVENTS.PLAYER_DAMAGE);
    assert.ok(damageEvents.length > 0);
    assertClose(
      damageEvents[0].payload.amount,
      GAME_CONFIG.enemies.heavy.damage * getEnemyScaling(2).damageMultiplier
    );
  } finally {
    Math.random = originalRandom;
  }
});

test('突击兵接触玩家时按 1.2 秒冷却发出近战伤害', () => {
  const originalRandom = Math.random;
  Math.random = function fixedRandom() {
    return 0.9;
  };

  try {
    const harness = createHarness({ spawnPoint: { x: 2, y: 0, z: 0 } });
    const { enemies, events } = harness;

    enemies.startWave(3);
    enemies.update(0.01, PLAYER);
    enemies.update(0.2, PLAYER);

    const damageEvents = eventsByName(events, EVENTS.PLAYER_DAMAGE);
    assert.equal(damageEvents.length, 1);
    assertClose(
      damageEvents[0].payload.amount,
      GAME_CONFIG.enemies.breacher.contactDamage *
        getEnemyScaling(3).damageMultiplier
    );
    assert.equal(typeof damageEvents[0].payload.sourcePosition.y, 'number');

    enemies.update(0.2, PLAYER);
    const stillOne = eventsByName(events, EVENTS.PLAYER_DAMAGE);
    assert.equal(stillOne.length, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('reset 清空全部内容（含尸体）且可重复调用', () => {
  const harness = createHarness();
  const { enemies, added, removed } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);
  for (let index = 0; index < 4; index += 1) {
    enemies.update(0.55, PLAYER);
  }
  assert.ok(enemies.getState().alive > 0);

  const query = enemies.getTargetQuery();
  query.applyDamage(query.listHittable()[0].targetId, 100000);

  enemies.reset();
  const state = enemies.getState();
  assert.deepEqual(state, {
    wave: 0,
    alive: 0,
    pendingSpawns: 0,
    totalInWave: 0,
    spawned: 0,
    waveComplete: false,
    types: { rifleman: 0, heavy: 0, breacher: 0 }
  });
  assert.equal(added.length, removed.length);

  enemies.reset();
  const secondState = enemies.getState();
  assert.deepEqual(secondState, state);
  assert.equal(added.length, removed.length);
});

test('dispose 后 update 安全返回，不再生成敌人', () => {
  const harness = createHarness();
  const { enemies } = harness;

  enemies.startWave(1);
  enemies.update(0.01, PLAYER);
  enemies.dispose();
  enemies.update(0.55, PLAYER);

  const state = enemies.getState();
  assert.equal(state.alive, 0);
  assert.equal(state.pendingSpawns, 0);
  assert.equal(state.wave, 0);
});
