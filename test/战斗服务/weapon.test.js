import assert from 'node:assert/strict';
import test from 'node:test';

import { createInputCommand } from '../../src/models/contracts.js';
import { EVENTS } from '../../src/models/events.js';
import { GAME_CONFIG } from '../../src/models/game-config.js';
import { createCombat } from '../../src/services/public/combat.js';
import {
  createPlayerState,
  damagePlayerState,
  getLookSensitivity,
  healPlayerState,
  resetPlayerState,
  updatePlayer,
  updatePlayerRegen
} from '../../src/services/impl/combat/player.js';
import {
  createWeaponState,
  getRecoilState,
  getShotDamage,
  getSpread,
  getWeaponViewState,
  resetWeaponState,
  startReload,
  updateWeapon
} from '../../src/services/impl/combat/weapon.js';
import { VIEW_MODEL_SCALE } from '../../src/services/impl/combat/view-model.js';

const CLOSE = 1e-6;
const WEAPON = GAME_CONFIG.weapon;
const RECOIL = WEAPON.recoil;
const HEADSHOT_MULTIPLIER = GAME_CONFIG.enemies.headshotMultiplier;

/**
 * 假渲染器：只实现战斗服务用到的公共方法，不创建 WebGL。
 */
function createFakeRenderer() {
  const poses = [];
  const attached = [];
  const detached = [];
  let nextHit = null;

  return {
    setCameraPose(pose) {
      poses.push(pose);
      return pose;
    },
    getWorldPosition() {
      return {
        origin: { x: 0, y: 1.68, z: 8 },
        direction: { x: 0, y: 0, z: -1 }
      };
    },
    raycast() {
      return nextHit;
    },
    attachToCamera(object) {
      attached.push(object);
    },
    detachFromCamera(object) {
      detached.push(object);
    },
    setNextHit(hit) {
      nextHit = hit;
    },
    getPoses() {
      return poses;
    },
    getAttached() {
      return attached;
    },
    getDetached() {
      return detached;
    }
  };
}

/**
 * 假事件发射器。
 */
function createEmitter() {
  const events = [];
  return {
    events,
    emit(name, payload) {
      events.push({ name, payload });
    }
  };
}

/**
 * 假目标查询：返回一个共享的敌人对象，并记录每次伤害。
 *
 * @param {{ part?: string, killed?: boolean }} [options]
 */
function createFakeTargetQuery(options) {
  let settings = {};
  if (options !== undefined) {
    settings = options;
  }
  let part = 'head';
  let killed = true;
  if (settings.part !== undefined) {
    part = settings.part;
  }
  if (settings.killed !== undefined) {
    killed = settings.killed;
  }
  let headshot = false;
  if (part === 'head') {
    headshot = true;
  }
  const object = { userData: { targetId: 'enemy-1', part } };
  const calls = [];

  return {
    object,
    calls,
    listHittable() {
      return [{ object, targetId: 'enemy-1' }];
    },
    applyDamage(targetId, damage) {
      calls.push({ targetId, damage });
      return {
        hit: true,
        killed,
        headshot,
        critical: headshot,
        position: { x: 0, y: 1, z: 0 },
        color: 0xff2a1f,
        score: 100,
        enemyType: 'rifleman'
      };
    }
  };
}

/**
 * 创建一个默认的战斗服务（无命中）。
 */
function createDefaultCombat() {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery();
  const emitter = createEmitter();
  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit
  });
  return { renderer, targetQuery, emitter, combat };
}

/**
 * 从事件列表里找第一个指定事件。
 */
function findEvent(emitter, name) {
  return emitter.events.find((entry) => entry.name === name);
}

test('新武器状态是满弹匣、未换弹、未瞄准、无后坐力', () => {
  const state = createWeaponState();
  const view = getWeaponViewState(state);

  assert.equal(view.ammo, WEAPON.magazineSize);
  assert.equal(view.magazineSize, WEAPON.magazineSize);
  assert.equal(view.reloading, false);
  assert.equal(view.reloadProgress, 0);
  assert.equal(view.aiming, false);
  assert.deepEqual(Object.keys(view).sort(), [
    'aiming',
    'ammo',
    'magazineSize',
    'reloadProgress',
    'reloading'
  ]);
  assert.equal(state.recoilPitch, 0);
  assert.equal(state.recoilYaw, 0);
  assert.equal(state.recoilRoll, 0);
  assert.equal(state.fovPunch, 0);
});

test('射击间隔按 0.095 秒限制射速', () => {
  const state = createWeaponState();

  const first = updateWeapon(state, 0, { fire: true });
  assert.equal(first.fired, true);
  assert.equal(state.ammo, WEAPON.magazineSize - 1);

  const tooEarly = updateWeapon(state, 0.05, { fire: true });
  assert.equal(tooEarly.fired, false);
  assert.equal(state.ammo, WEAPON.magazineSize - 1);

  const ready = updateWeapon(state, 0.05, { fire: true });
  assert.equal(ready.fired, true);
  assert.equal(state.ammo, WEAPON.magazineSize - 2);
});

test('弹匣打空后提示空仓并自动开始换弹', () => {
  const state = createWeaponState();
  let emptyCount = 0;
  let reloadStarts = 0;

  for (let shot = 0; shot < WEAPON.magazineSize; shot += 1) {
    const result = updateWeapon(state, WEAPON.fireInterval, { fire: true });
    assert.equal(result.fired, true, '第 ' + (shot + 1) + ' 发应成功发射');
    if (result.emptyTriggered) {
      emptyCount += 1;
    }
    if (result.startedReload) {
      reloadStarts += 1;
    }
  }

  assert.equal(state.ammo, 0);
  assert.equal(emptyCount, 1, '空仓提示只应出现一次');
  assert.equal(reloadStarts, 1, '打空后只应开始一次自动换弹');
  assert.equal(state.reloading, true);
});

test('换弹持续 1.5 秒，进度从 0 到 1，完成后弹匣恢复满', () => {
  const state = createWeaponState();
  state.ammo = 10;

  assert.equal(startReload(state), true);
  assert.equal(getWeaponViewState(state).reloadProgress, 0);

  updateWeapon(state, 0.75, {});
  const halfway = getWeaponViewState(state);
  assert.equal(halfway.reloading, true);
  assert.ok(Math.abs(halfway.reloadProgress - 0.5) < CLOSE);

  const finished = updateWeapon(state, 0.75, {});
  assert.equal(finished.finishedReload, true);
  assert.equal(state.reloading, false);
  assert.equal(state.ammo, WEAPON.magazineSize);
  assert.equal(getWeaponViewState(state).reloadProgress, 0);
});

test('手动换弹在满弹匣或换弹中无效', () => {
  const full = createWeaponState();
  assert.equal(startReload(full), false);

  const state = createWeaponState();
  state.ammo = 12;
  const first = updateWeapon(state, 0.016, { reload: true });
  assert.equal(first.startedReload, true);
  assert.equal(state.reloading, true);

  const second = updateWeapon(state, 0.016, { reload: true });
  assert.equal(second.startedReload, false, '换弹过程中不应重复开始');
});

test('伤害为基础 26，爆头按 enemies.headshotMultiplier 严格 2 倍且只乘一次', () => {
  assert.equal(getShotDamage(false), 26);
  assert.equal(getShotDamage(true), 26 * HEADSHOT_MULTIPLIER);
  assert.equal(getShotDamage(true), 52);
});

test('移动增加散布，瞄准降低散布', () => {
  const state = createWeaponState();

  assert.ok(Math.abs(getSpread(state, false) - WEAPON.hipSpread) < CLOSE);
  assert.ok(
    Math.abs(
      getSpread(state, true) - (WEAPON.hipSpread + WEAPON.movingSpreadIncrease)
    ) < CLOSE
  );

  state.aiming = true;
  assert.ok(
    Math.abs(getSpread(state, false) - WEAPON.hipSpread * WEAPON.ads.spreadMultiplier) <
      CLOSE
  );
  assert.ok(
    Math.abs(
      getSpread(state, true) -
        (WEAPON.hipSpread + WEAPON.movingSpreadIncrease) *
          WEAPON.ads.spreadMultiplier
    ) < CLOSE
  );
});

test('后坐力包含垂直抬升、水平漂移与滚转，并平滑回正', () => {
  const state = createWeaponState();
  const first = updateWeapon(state, 0, { fire: true });

  assert.equal(first.fired, true);
  assert.ok(Math.abs(first.recoil.pitch - RECOIL.pitchKick) < CLOSE);
  assert.ok(Math.abs(first.recoil.yaw) > 0, '应产生水平漂移');
  assert.ok(Math.abs(first.recoil.roll) > 0, '应产生镜头滚转');
  assert.ok(Math.abs(first.recoil.yaw) <= RECOIL.yawKick + CLOSE);
  assert.ok(Math.abs(first.recoil.roll) <= RECOIL.rollKick + CLOSE);
  assert.ok(first.fovPunch > 0, '每发应有 FOV 冲击');
  assert.ok(first.shakeTimer > 0, '每发应有镜头震动');

  const pitchAfterFirst = state.recoilPitch;
  updateWeapon(state, 0.01, {});
  assert.ok(state.recoilPitch < pitchAfterFirst, '后坐力应向 0 回正');

  updateWeapon(state, 2, {});
  assert.equal(state.recoilPitch, 0);
  assert.equal(state.recoilYaw, 0);
  assert.equal(state.recoilRoll, 0);
  assert.equal(state.fovPunch, 0);
});

test('ADS 同时降低后坐力、水平漂移、滚转与 FOV 冲击', () => {
  const hip = createWeaponState();
  const ads = createWeaponState();

  const hipResult = updateWeapon(hip, 0, { fire: true });
  const adsResult = updateWeapon(ads, 0, { fire: true, aim: true });

  assert.ok(
    Math.abs(
      adsResult.recoil.pitch - RECOIL.pitchKick * RECOIL.adsMultiplier
    ) < CLOSE
  );
  assert.ok(Math.abs(adsResult.recoil.yaw) < Math.abs(hipResult.recoil.yaw));
  assert.ok(Math.abs(adsResult.recoil.roll) < Math.abs(hipResult.recoil.roll));
  assert.ok(adsResult.fovPunch < hipResult.fovPunch);
});

test('连续射击时水平漂移按模式左右变化', () => {
  const state = createWeaponState();
  const first = updateWeapon(state, 0, { fire: true });
  state.fireCooldown = 0;
  const second = updateWeapon(state, 0, { fire: true });

  assert.ok(first.recoil.yaw < 0, '第一发向左漂移');
  assert.ok(second.recoil.yaw > first.recoil.yaw, '第二发方向应改变');
});

test('getRecoilState 输出相机震动偏移并在计时结束后归零', () => {
  const state = createWeaponState();
  updateWeapon(state, 0, { fire: true });
  const recoil = getRecoilState(state);

  assert.equal(typeof recoil.shakeX, 'number');
  assert.equal(typeof recoil.shakeY, 'number');
  assert.ok(Math.abs(recoil.shakeY) > 0);
  assert.ok(recoil.fovPunch > 0);

  updateWeapon(state, 0.2, {});
  const settled = getRecoilState(state);
  assert.equal(settled.shakeX, 0);
  assert.equal(settled.shakeY, 0);
});

test('玩家移动相对视角方向，冲刺提高速度', () => {
  const walker = createPlayerState();
  updatePlayer(walker, 0.1, createInputCommand({ moveForward: 1 }), [], false);
  assert.ok(Math.abs(walker.z - (8 - GAME_CONFIG.player.speed * 0.1)) < CLOSE);
  assert.ok(Math.abs(walker.x) < CLOSE);

  const sprinter = createPlayerState();
  updatePlayer(
    sprinter,
    0.1,
    createInputCommand({ moveForward: 1, sprint: true }),
    [],
    false
  );
  assert.ok(
    Math.abs(
      sprinter.z -
        (8 - GAME_CONFIG.player.speed * GAME_CONFIG.player.sprintMultiplier * 0.1)
    ) < CLOSE
  );
});

test('跳跃只在着地时发生，重力把玩家带回地面', () => {
  const state = createPlayerState();
  updatePlayer(state, 0.05, createInputCommand({ jump: true }), [], false);
  assert.ok(state.y > 0, '起跳后应离开地面');
  assert.equal(state.grounded, false);

  const stateWhileAirborne = state.y;
  updatePlayer(state, 0.05, createInputCommand({ jump: true }), [], false);
  assert.ok(state.y > 0);
  assert.ok(state.y !== stateWhileAirborne || state.velocityY < 0);

  for (let step = 0; step < 100; step += 1) {
    updatePlayer(state, 0.05, createInputCommand(), [], false);
  }
  assert.equal(state.y, 0);
  assert.equal(state.grounded, true);
});

test('鼠标灵敏度受设置影响，ADS 再乘 ADS 倍率', () => {
  const state = createPlayerState();
  const settings = { mouseSensitivity: 2, adsSensitivityMultiplier: 0.5 };

  updatePlayer(state, 0.016, createInputCommand({ lookDeltaX: 10 }), [], false, settings);
  assert.ok(Math.abs(state.yaw + 10 * getLookSensitivity(settings, false)) < CLOSE);

  const yawAfterHip = state.yaw;
  updatePlayer(state, 0.016, createInputCommand({ lookDeltaX: 10 }), [], true, settings);
  assert.ok(
    Math.abs(
      state.yaw -
        (yawAfterHip - 10 * getLookSensitivity(settings, true))
    ) < CLOSE
  );
  assert.ok(Math.abs(getLookSensitivity(settings, true) - 0.0022) < CLOSE);
});

test('玩家受伤后 5 秒内不恢复，之后以 8/秒恢复并受上限约束', () => {
  const state = createPlayerState();
  const damage = damagePlayerState(state, 30);

  assert.equal(damage.applied, 30);
  assert.equal(damage.died, false);
  assert.equal(state.health, 70);

  const duringDelay = updatePlayerRegen(state, 5);
  assert.equal(duringDelay, 0, '恢复延迟期间不应恢复');
  assert.equal(state.health, 70);

  const afterDelay = updatePlayerRegen(state, 1);
  assert.ok(Math.abs(afterDelay - 8) < CLOSE);
  assert.equal(state.health, 78);

  const healed = healPlayerState(state, 50);
  assert.equal(healed, 22, '治疗不应超过生命上限');
  assert.equal(state.health, 100);
});

test('生命归零时死亡，死亡后不再受伤或治疗，复位后恢复', () => {
  const state = createPlayerState();
  const fatal = damagePlayerState(state, 150);

  assert.equal(fatal.applied, 100);
  assert.equal(fatal.died, true);
  assert.equal(state.alive, false);
  assert.equal(state.health, 0);

  const afterDeath = damagePlayerState(state, 10);
  assert.equal(afterDeath.applied, 0);
  assert.equal(afterDeath.died, false);
  assert.equal(healPlayerState(state, 30), 0);

  resetPlayerState(state);
  assert.equal(state.alive, true);
  assert.equal(state.health, 100);
  assert.equal(state.x, 0);
  assert.equal(state.y, 0);
  assert.equal(state.z, 8);
});

test('createCombat 缺少必填依赖或素材加载器不完整时抛出明确 TypeError', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery();
  const emit = createEmitter().emit;

  assert.throws(
    () => createCombat({ targetQuery, emit }),
    (error) => error instanceof TypeError && /renderer/.test(error.message)
  );
  assert.throws(
    () => createCombat({ renderer, emit }),
    (error) => error instanceof TypeError && /targetQuery/.test(error.message)
  );
  assert.throws(
    () => createCombat({ renderer, targetQuery }),
    (error) => error instanceof TypeError && /emit/.test(error.message)
  );
  assert.throws(
    () => createCombat({ renderer, targetQuery, emit, assets: {} }),
    (error) => error instanceof TypeError && /loadTexture/.test(error.message)
  );
});

test('getSnapshot 返回 Model 约定的完整玩家快照', () => {
  const { combat } = createDefaultCombat();

  const snapshot = combat.getSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'alive',
    'eyeHeight',
    'health',
    'maxHealth',
    'pitch',
    'velocityX',
    'velocityZ',
    'x',
    'y',
    'yaw',
    'z'
  ]);
  assert.equal(snapshot.x, 0);
  assert.equal(snapshot.y, 0);
  assert.equal(snapshot.z, 8);
  assert.equal(snapshot.eyeHeight, 1.68);
  assert.equal(snapshot.health, 100);
  assert.equal(snapshot.maxHealth, 100);
  assert.equal(snapshot.alive, true);

  combat.dispose();
});

test('爆头时只调用一次 applyDamage，伤害为 52，并发出命中、血雾、弹壳与击杀事件', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery({ part: 'head', killed: true });
  const emitter = createEmitter();
  renderer.setNextHit({
    object: targetQuery.object,
    distance: 10,
    point: { x: 0, y: 1.68, z: 2 },
    normal: { x: 0, y: 0, z: 1 },
    userData: targetQuery.object.userData
  });

  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit
  });

  combat.update(0.016, createInputCommand({ fire: true }));

  assert.equal(targetQuery.calls.length, 1, '每发子弹只结算一次伤害');
  assert.deepEqual(targetQuery.calls[0], {
    targetId: 'enemy-1',
    damage: 26 * HEADSHOT_MULTIPLIER
  });

  const names = emitter.events.map((entry) => entry.name);
  assert.ok(names.includes(EVENTS.WORLD_SHOT));
  assert.ok(names.includes(EVENTS.HUD_HITMARKER));
  assert.ok(names.includes(EVENTS.ENEMY_KILLED));
  assert.ok(names.includes(EVENTS.WORLD_BLOOD));
  assert.ok(names.includes(EVENTS.WEAPON_SHELL_EJECT));

  const hitmarker = findEvent(emitter, EVENTS.HUD_HITMARKER);
  assert.equal(hitmarker.payload.killed, true);
  assert.equal(hitmarker.payload.headshot, true);

  const killedEvent = findEvent(emitter, EVENTS.ENEMY_KILLED);
  assert.equal(killedEvent.payload.enemyType, 'rifleman');
  assert.equal(killedEvent.payload.score, 100);
  assert.equal(killedEvent.payload.headshot, true);
  assert.equal(killedEvent.payload.critical, true);

  const blood = findEvent(emitter, EVENTS.WORLD_BLOOD);
  assert.deepEqual(blood.payload.position, { x: 0, y: 1.68, z: 2 });
  assert.equal(typeof blood.payload.direction.x, 'number');
  assert.equal(blood.payload.color, 0xff2a1f);

  const shell = findEvent(emitter, EVENTS.WEAPON_SHELL_EJECT);
  assert.equal(typeof shell.payload.position.x, 'number');
  assert.equal(typeof shell.payload.velocity.x, 'number');

  combat.dispose();
});

test('命中身体时伤害为 26，命中标记 headshot 为 false', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery({
    part: 'body',
    killed: false
  });
  const emitter = createEmitter();
  renderer.setNextHit({
    object: targetQuery.object,
    distance: 10,
    point: { x: 0, y: 1.2, z: 2 },
    normal: { x: 0, y: 0, z: 1 },
    userData: targetQuery.object.userData
  });

  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit
  });

  combat.update(0.016, createInputCommand({ fire: true }));

  assert.deepEqual(targetQuery.calls[0], { targetId: 'enemy-1', damage: 26 });
  const names = emitter.events.map((entry) => entry.name);
  assert.ok(names.includes(EVENTS.HUD_HITMARKER));
  assert.ok(names.includes(EVENTS.WORLD_BLOOD));
  assert.equal(names.includes(EVENTS.ENEMY_KILLED), false);

  const hitmarker = findEvent(emitter, EVENTS.HUD_HITMARKER);
  assert.equal(hitmarker.payload.killed, false);
  assert.equal(hitmarker.payload.headshot, false);

  combat.dispose();
});

test('命中墙体等非目标对象时发出世界命中事件，不结算伤害', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery();
  const emitter = createEmitter();
  renderer.setNextHit({
    object: { userData: {} },
    distance: 6,
    point: { x: 0, y: 1.68, z: 2 },
    normal: { x: 0, y: 0, z: 1 },
    userData: {}
  });

  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit
  });

  combat.update(0.016, createInputCommand({ fire: true }));

  assert.equal(targetQuery.calls.length, 0);
  const names = emitter.events.map((entry) => entry.name);
  assert.ok(names.includes(EVENTS.WORLD_SHOT));
  assert.ok(names.includes(EVENTS.WORLD_IMPACT));
  assert.equal(names.includes(EVENTS.WORLD_BLOOD), false);

  const impact = findEvent(emitter, EVENTS.WORLD_IMPACT);
  assert.deepEqual(impact.payload.position, { x: 0, y: 1.68, z: 2 });

  combat.dispose();
});

test('玩家死亡只发一次 player:died，不直接发 hud:damage，死亡后不能射击', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery();
  const emitter = createEmitter();
  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit
  });

  combat.damagePlayer(30);
  assert.equal(combat.getSnapshot().health, 70);
  assert.equal(
    emitter.events.filter((entry) => entry.name === EVENTS.HUD_DAMAGE).length,
    0,
    'hud:damage 由 Pipeline 统一发布'
  );

  combat.damagePlayer(70);
  assert.equal(combat.getSnapshot().alive, false);

  const deathsAfterFirst = emitter.events.filter(
    (entry) => entry.name === EVENTS.PLAYER_DIED
  );
  assert.equal(deathsAfterFirst.length, 1);

  combat.damagePlayer(10);
  combat.update(0.016, createInputCommand({ fire: true }));
  assert.equal(
    emitter.events.filter((entry) => entry.name === EVENTS.PLAYER_DIED).length,
    1
  );
  assert.equal(targetQuery.calls.length, 0, '死亡状态下不应射击');

  combat.reset();
  assert.equal(combat.getSnapshot().alive, true);
  assert.equal(combat.getSnapshot().health, 100);
  assert.equal(combat.getWeaponState().ammo, WEAPON.magazineSize);

  combat.damagePlayer(100);
  assert.equal(
    emitter.events.filter((entry) => entry.name === EVENTS.PLAYER_DIED).length,
    2
  );

  combat.dispose();
});

test('reset 可重复调用，不重复挂载视图模型或叠加状态', () => {
  const { renderer, combat } = createDefaultCombat();

  assert.equal(renderer.getAttached().length, 1, '第一人称视图模型只应挂载一次');

  combat.update(0.016, createInputCommand({ fire: true }));
  assert.equal(combat.getWeaponState().ammo, WEAPON.magazineSize - 1);

  combat.reset();
  combat.reset();
  combat.reset();

  assert.equal(renderer.getAttached().length, 1, 'reset 不应重复挂载视图模型');
  assert.equal(combat.getWeaponState().ammo, WEAPON.magazineSize);
  assert.equal(combat.getSnapshot().z, 8);
  assert.ok(renderer.getPoses().length >= 3, 'reset 应更新相机姿态');

  combat.dispose();
  combat.dispose();
  assert.equal(renderer.getDetached().length, 1, 'dispose 应只取下视图模型一次');
});

test('开火事件包含弹道起点、终点、枪口位置与颜色', () => {
  const { emitter, combat } = createDefaultCombat();

  combat.update(0.016, createInputCommand({ fire: true }));

  const shot = findEvent(emitter, EVENTS.WORLD_SHOT);
  assert.notEqual(shot, undefined);
  assert.deepEqual(shot.payload.from, { x: 0, y: 1.68, z: 8 });
  assert.equal(typeof shot.payload.to.x, 'number');
  assert.equal(typeof shot.payload.to.y, 'number');
  assert.equal(typeof shot.payload.to.z, 'number');
  assert.equal(typeof shot.payload.muzzlePosition.x, 'number');
  assert.equal(typeof shot.payload.muzzlePosition.y, 'number');
  assert.equal(typeof shot.payload.muzzlePosition.z, 'number');
  assert.equal(typeof shot.payload.color, 'number');

  combat.dispose();
});

test('更近的墙体阻挡子弹时只发世界命中，不结算敌人伤害', () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery({ part: 'head', killed: true });
  const emitter = createEmitter();
  renderer.setNextHit({
    object: targetQuery.object,
    distance: 10,
    point: { x: 0, y: 1.2, z: -2 },
    normal: { x: 0, y: 0, z: 1 },
    userData: targetQuery.object.userData
  });

  const combat = createCombat({
    renderer,
    colliders: [
      {
        min: { x: -1, y: 0, z: 4 },
        max: { x: 1, y: 3, z: 5 }
      }
    ],
    targetQuery,
    emit: emitter.emit
  });

  combat.update(0.016, createInputCommand({ fire: true }));

  assert.equal(targetQuery.calls.length, 0, '墙后的敌人不应受伤');
  const names = emitter.events.map((entry) => entry.name);
  assert.ok(names.includes(EVENTS.WORLD_IMPACT));
  assert.equal(names.includes(EVENTS.ENEMY_KILLED), false);
  assert.equal(names.includes(EVENTS.WORLD_BLOOD), false);

  const impact = findEvent(emitter, EVENTS.WORLD_IMPACT);
  assert.ok(Math.abs(impact.payload.position.z - 5) < CLOSE);
  assert.deepEqual(impact.payload.normal, { x: 0, y: 0, z: 1 });

  combat.dispose();
});

test('setViewVisible 控制视图模型显隐，非法输入抛错，reset 恢复可见', () => {
  const { renderer, combat } = createDefaultCombat();

  const viewRoot = renderer.getAttached()[0];
  assert.notEqual(viewRoot, undefined);
  assert.equal(viewRoot.visible, true, '默认应可见');

  combat.setViewVisible(false);
  assert.equal(viewRoot.visible, false, '传入 false 应隐藏视图模型');

  combat.setViewVisible(true);
  assert.equal(viewRoot.visible, true, '传入 true 应重新显示');

  combat.setViewVisible(false);
  combat.reset();
  assert.equal(viewRoot.visible, true, 'reset 应恢复默认可见');

  assert.throws(
    () => combat.setViewVisible('hidden'),
    (error) => error instanceof TypeError && /布尔值/.test(error.message)
  );
  assert.equal(viewRoot.visible, true, '非法输入不应改变可见性');

  combat.dispose();
});

test('第一人称视图模型使用调优后的缩放与腰射基准位置', () => {
  const { renderer, combat } = createDefaultCombat();

  const viewRoot = renderer.getAttached()[0];
  assert.ok(Math.abs(viewRoot.scale.x - VIEW_MODEL_SCALE) < CLOSE);
  assert.ok(Math.abs(viewRoot.scale.y - VIEW_MODEL_SCALE) < CLOSE);
  assert.ok(Math.abs(viewRoot.scale.z - VIEW_MODEL_SCALE) < CLOSE);
  assert.ok(VIEW_MODEL_SCALE < 0.85, '实机复核后武器占屏应缩小');
  assert.ok(Math.abs(viewRoot.position.x - 0.27) < CLOSE);
  assert.ok(Math.abs(viewRoot.position.y + 0.28) < CLOSE);
  assert.ok(Math.abs(viewRoot.position.z + 0.58) < CLOSE);

  combat.dispose();
});

test('setSettings 夹紧范围、影响鼠标视角与 ADS FOV，并返回冻结副本', () => {
  const { renderer, combat } = createDefaultCombat();

  const applied = combat.setSettings({
    mouseSensitivity: 99,
    adsSensitivityMultiplier: 0.5,
    fov: 50
  });
  const ranges = GAME_CONFIG.settings.ranges;
  assert.equal(applied.mouseSensitivity, ranges.mouseSensitivity.max);
  assert.equal(applied.adsSensitivityMultiplier, 0.5);
  assert.equal(applied.fov, ranges.fov.min);
  assert.equal(Object.isFrozen(applied), true);

  const hipSensitivity = WEAPON.lookSensitivity * ranges.mouseSensitivity.max;
  combat.update(0.016, createInputCommand({ lookDeltaX: 10 }));
  assert.ok(Math.abs(combat.getSnapshot().yaw + 10 * hipSensitivity) < CLOSE);

  const yawAfterHip = combat.getSnapshot().yaw;
  combat.update(0.016, createInputCommand({ aim: true, lookDeltaX: 10 }));
  const adsSensitivity = hipSensitivity * 0.5;
  assert.ok(
    Math.abs(combat.getSnapshot().yaw - (yawAfterHip - 10 * adsSensitivity)) < CLOSE
  );

  const poses = renderer.getPoses();
  const lastPose = poses[poses.length - 1];
  assert.ok(
    Math.abs(lastPose.fov - ranges.fov.min * WEAPON.ads.fovMultiplier) < CLOSE
  );

  assert.throws(
    () => combat.setSettings('fast'),
    (error) => error instanceof TypeError
  );
  assert.throws(
    () => combat.setSettings({ fov: 'wide' }),
    (error) => error instanceof TypeError
  );

  combat.dispose();
});

test('开火后相机姿态包含俯仰抬升、滚转、FOV 冲击与震动偏移', () => {
  const { renderer, combat } = createDefaultCombat();

  combat.update(0.016, createInputCommand({ fire: true }));

  const poses = renderer.getPoses();
  const pose = poses[poses.length - 1];
  assert.ok(pose.pitch > 0, '应有垂直抬升');
  assert.equal(typeof pose.roll, 'number');
  assert.ok(Math.abs(pose.roll) > 0, '应有镜头滚转');
  assert.ok(pose.fov > GAME_CONFIG.settings.defaults.fov, '应有 FOV 冲击');
  assert.notEqual(pose.position.y, 1.68, '应有轻微镜头震动');

  combat.dispose();
});

test('load 在没有素材加载器时幂等完成', async () => {
  const { combat } = createDefaultCombat();

  await combat.load();
  await combat.load();

  combat.dispose();
});

test('load 使用素材加载器预加载贴图且重复调用只执行一次', async () => {
  const renderer = createFakeRenderer();
  const targetQuery = createFakeTargetQuery();
  const emitter = createEmitter();
  let manifestCalls = 0;
  const textureCalls = [];
  const assets = {
    async loadManifest() {
      manifestCalls += 1;
      return {
        textures: {
          metal: {
            color: 'metal/color.jpg',
            normal: 'metal/normal.jpg',
            roughness: 'metal/rough.jpg',
            metalness: 'metal/metal.jpg'
          },
          steel: {
            color: 'steel/color.jpg',
            normal: 'steel/normal.jpg',
            roughness: 'steel/rough.jpg',
            metalness: 'steel/metal.jpg'
          },
          wood: {
            color: 'wood/color.jpg',
            normal: 'wood/normal.jpg',
            roughness: 'wood/rough.jpg'
          },
          fabric: {
            color: 'fabric/color.jpg',
            normal: 'fabric/normal.jpg',
            roughness: 'fabric/rough.jpg'
          }
        }
      };
    },
    async loadTexture(url, options) {
      textureCalls.push({ url, options });
      return { url };
    }
  };

  const combat = createCombat({
    renderer,
    colliders: [],
    targetQuery,
    emit: emitter.emit,
    assets
  });

  await combat.load();
  await combat.load();

  assert.equal(manifestCalls, 1, '素材清单只应加载一次');
  assert.equal(
    textureCalls.length,
    12,
    '金属/钢各 4 通道，木材/织物只用法线与粗糙度'
  );
  const colorCalls = textureCalls.filter((entry) => entry.url.includes('color'));
  assert.equal(colorCalls.length, 2, '只给金属/钢使用颜色贴图');
  assert.equal(colorCalls[0].options.colorSpace, 'srgb');
  assert.ok(
    textureCalls.some((entry) => entry.url === 'fabric/normal.jpg'),
    '织物法线贴图仍应加载'
  );

  combat.dispose();
});

test('resetWeaponState 恢复满弹匣、零后坐力与零震动', () => {
  const state = createWeaponState();
  state.ammo = 3;
  state.reloading = true;
  state.reloadTimer = 1;
  state.recoilPitch = 0.4;
  state.recoilYaw = 0.1;
  state.recoilRoll = 0.2;
  state.fovPunch = 1;
  state.shakeTimer = 0.05;
  state.shakePhase = 3;
  state.aiming = true;

  resetWeaponState(state);
  assert.equal(state.ammo, WEAPON.magazineSize);
  assert.equal(state.reloading, false);
  assert.equal(state.reloadTimer, 0);
  assert.equal(state.recoilPitch, 0);
  assert.equal(state.recoilYaw, 0);
  assert.equal(state.recoilRoll, 0);
  assert.equal(state.fovPunch, 0);
  assert.equal(state.shakeTimer, 0);
  assert.equal(state.shakePhase, 0);
  assert.equal(state.aiming, false);
});
