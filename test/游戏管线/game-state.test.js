/**
 * 游戏管线单元测试：纯状态机、计分账本与真实 createGame 编排。
 *
 * 运行（项目根目录）：
 *   node --test test/游戏管线/game-state.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../../src/common/shared/event-bus.js';
import { EVENTS, isKnownEvent } from '../../src/models/events.js';
import {
  GAME_CONFIG,
  ENEMY_TYPES,
  normalizeSettings,
  clampSetting,
  getEnemyTypeShares
} from '../../src/models/game-config.js';
import {
  createSettings,
  isSettings,
  isPerformanceSnapshot,
  createHudDamagePayload,
  createHudHitmarkerPayload,
  createHudKillfeedPayload,
  createEnemyKilledPayload
} from '../../src/models/contracts.js';
import {
  createGameStateMachine,
  createMatchAccounting,
  addKillScore,
  advanceSurvivalTime,
  advanceWaveNumber,
  createWaveBanner,
  getAllowedTransitions,
  WAVE_BANNER_DURATION_MS
} from '../../src/pipelines/impl/game-state.js';
import { createGame } from '../../src/pipelines/public/game.js';

/**
 * @returns {{
 *   poses: Array<Object>,
 *   quality: 'high'|'low',
 *   setQualityCalls: string[],
 *   postProcessingCalls: boolean[],
 *   setCameraPose: (pose: Object) => void,
 *   setQuality: (quality: string) => void,
 *   getQuality: () => 'high'|'low',
 *   isPostProcessingEnabled: () => boolean
 * }}
 */
function createFakeRenderer() {
  return {
    poses: [],
    quality: 'high',
    setQualityCalls: [],
    postProcessingCalls: [],
    setCameraPose(pose) {
      this.poses.push(pose);
    },
    setQuality(quality) {
      this.setQualityCalls.push(quality);
      this.quality = quality;
      this.postProcessingCalls.push(quality === 'high');
    },
    getQuality() {
      return this.quality;
    },
    isPostProcessingEnabled() {
      return this.quality === 'high';
    }
  };
}

/**
 * @returns {Object}
 */
function createFakeCombat() {
  const snapshot = {
    x: 0,
    y: 0,
    z: 0,
    eyeHeight: 1.68,
    yaw: 0,
    pitch: 0,
    velocityX: 0,
    velocityZ: 0,
    health: 100,
    maxHealth: 100,
    alive: true
  };
  const weapon = {
    ammo: 30,
    magazineSize: 30,
    reloading: false,
    reloadProgress: 0,
    aiming: false
  };

  return {
    snapshot,
    weapon,
    resetCalls: 0,
    updateCalls: 0,
    updateDeltas: [],
    lastInput: null,
    damageCalls: [],
    healCalls: [],
    viewVisible: true,
    setViewVisibleCalls: [],
    setSettingsCalls: [],
    reset() {
      this.resetCalls += 1;
      snapshot.health = 100;
      snapshot.alive = true;
      weapon.ammo = 30;
      // 与真实战斗服务一致：reset 会恢复第一人称武器可见。
      this.viewVisible = true;
    },
    update(deltaSeconds, input) {
      this.updateCalls += 1;
      this.updateDeltas.push(deltaSeconds);
      this.lastInput = input;
    },
    damagePlayer(amount) {
      this.damageCalls.push(amount);
    },
    heal(amount) {
      this.healCalls.push(amount);
    },
    setViewVisible(visible) {
      this.viewVisible = visible;
      this.setViewVisibleCalls.push(visible);
    },
    setSettings(settings) {
      this.setSettingsCalls.push({ ...settings });
    },
    getSnapshot() {
      return { ...snapshot };
    },
    getWeaponState() {
      return { ...weapon };
    }
  };
}

/**
 * @returns {Object}
 */
function createFakeEnemies() {
  const state = {
    wave: 0,
    alive: 0,
    pendingSpawns: 0,
    totalInWave: 0,
    spawned: 0,
    waveComplete: false
  };

  return {
    state,
    resetCalls: 0,
    updateCalls: 0,
    updateDeltas: [],
    startWaveCalls: [],
    lastPlayerSnapshot: null,
    reset() {
      this.resetCalls += 1;
      state.wave = 0;
      state.alive = 0;
      state.waveComplete = false;
    },
    startWave(wave) {
      this.startWaveCalls.push(wave);
      state.wave = wave;
      state.waveComplete = false;
    },
    update(deltaSeconds, playerSnapshot) {
      this.updateCalls += 1;
      this.updateDeltas.push(deltaSeconds);
      this.lastPlayerSnapshot = playerSnapshot;
      state.alive = 1;
    },
    getState() {
      return { ...state };
    }
  };
}

/**
 * @returns {Object}
 */
function createFakeArena() {
  return {
    updateCalls: 0,
    update(deltaSeconds) {
      this.updateCalls += 1;
      this.lastDelta = deltaSeconds;
    }
  };
}

/**
 * @returns {Object}
 */
function createFakeEffects() {
  return {
    tracers: [],
    impacts: [],
    explosions: [],
    spawns: [],
    enemyShots: [],
    muzzleSmokes: [],
    bloods: [],
    shells: [],
    updateCalls: 0,
    clearCalls: 0,
    tracer(from, to, color) {
      this.tracers.push({ from, to, color });
    },
    impact(position, normal, color) {
      this.impacts.push({ position, normal, color });
    },
    explosion(position, color, scale) {
      this.explosions.push({ position, color, scale });
    },
    spawn(position, color) {
      this.spawns.push({ position, color });
    },
    enemyShot(position, direction, color) {
      this.enemyShots.push({ position, direction, color });
    },
    muzzleSmoke(position, direction) {
      this.muzzleSmokes.push({ position, direction });
    },
    blood(position, direction, color) {
      this.bloods.push({ position, direction, color });
    },
    shell(position, velocity) {
      this.shells.push({ position, velocity });
    },
    update(deltaSeconds) {
      this.updateCalls += 1;
      this.lastDelta = deltaSeconds;
    },
    clear() {
      this.clearCalls += 1;
    }
  };
}

/**
 * @returns {Object}
 */
function createFakeAudio() {
  const calls = {
    shoot: 0,
    hit: 0,
    headshot: 0,
    kill: 0,
    explosion: 0,
    hurt: 0,
    reload: 0,
    empty: 0,
    pickup: 0,
    waveStart: 0,
    gameOver: 0,
    enemyShot: 0,
    shellDrop: 0
  };

  return {
    calls,
    muted: false,
    setMutedCalls: [],
    masterVolumeCalls: [],
    enemyShotCalls: [],
    shoot() {
      calls.shoot += 1;
    },
    hit() {
      calls.hit += 1;
    },
    headshot() {
      calls.headshot += 1;
    },
    kill() {
      calls.kill += 1;
    },
    explosion() {
      calls.explosion += 1;
    },
    hurt() {
      calls.hurt += 1;
    },
    reload() {
      calls.reload += 1;
    },
    empty() {
      calls.empty += 1;
    },
    pickup() {
      calls.pickup += 1;
    },
    waveStart() {
      calls.waveStart += 1;
    },
    gameOver() {
      calls.gameOver += 1;
    },
    enemyShot(distance, enemyType) {
      calls.enemyShot += 1;
      this.enemyShotCalls.push({ distance, enemyType });
    },
    shellDrop() {
      calls.shellDrop += 1;
    },
    setMasterVolume(volume) {
      this.masterVolumeCalls.push(volume);
    },
    setMuted(nextMuted) {
      this.muted = nextMuted;
      this.setMutedCalls.push(nextMuted);
    },
    isMuted() {
      return this.muted;
    }
  };
}

/**
 * 创建一套真实总线 + 契约兼容的假服务。
 *
 * @returns {Object}
 */
function createRig() {
  const bus = createEventBus();
  const renderer = createFakeRenderer();
  const arena = createFakeArena();
  const combat = createFakeCombat();
  const enemies = createFakeEnemies();
  const effects = createFakeEffects();
  const audio = createFakeAudio();
  const game = createGame({ bus, renderer, arena, combat, enemies, effects, audio });

  const events = [];
  const tracked = [
    EVENTS.GAME_STATE,
    EVENTS.WAVE_START,
    EVENTS.WAVE_CLEARED,
    EVENTS.HUD_BANNER,
    EVENTS.HUD_UPDATE,
    EVENTS.HUD_KILLFEED,
    EVENTS.HUD_HITMARKER,
    EVENTS.HUD_DAMAGE,
    EVENTS.HUD_GAMEOVER,
    EVENTS.SETTINGS_CHANGED
  ];
  for (const eventName of tracked) {
    bus.on(eventName, function collect(payload) {
      events.push({ name: eventName, payload });
    });
  }

  function findAll(eventName) {
    return events.filter((entry) => entry.name === eventName);
  }

  function last(eventName) {
    const matches = findAll(eventName);
    if (matches.length === 0) {
      return null;
    }
    return matches[matches.length - 1].payload;
  }

  return {
    bus,
    renderer,
    arena,
    combat,
    enemies,
    effects,
    audio,
    game,
    events,
    findAll,
    last
  };
}

/**
 * 以固定步长推进对局。
 *
 * @param {Object} rig
 * @param {number} seconds
 * @param {number} [step]
 * @returns {number} 实际调用 update 的次数。
 */
function runUpdates(rig, seconds, step) {
  let delta = 0.05;
  if (typeof step === 'number') {
    delta = step;
  }
  const count = Math.round(seconds / delta);
  for (let index = 0; index < count; index += 1) {
    rig.game.update(delta);
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Model：人类敌人、设置与 v3 事件                                             */
/* -------------------------------------------------------------------------- */

test('敌人类型为步枪兵/重机枪手/突击兵，波次占比符合 v3', () => {
  assert.deepEqual(ENEMY_TYPES, {
    RIFLEMAN: 'rifleman',
    HEAVY: 'heavy',
    BREACHER: 'breacher'
  });

  assert.deepEqual(getEnemyTypeShares(1), {
    rifleman: 1,
    heavy: 0,
    breacher: 0
  });
  assert.deepEqual(getEnemyTypeShares(2), {
    rifleman: 0.8,
    heavy: 0.2,
    breacher: 0
  });
  assert.deepEqual(getEnemyTypeShares(3), {
    rifleman: 0.55,
    heavy: 0.2,
    breacher: 0.25
  });
  assert.deepEqual(getEnemyTypeShares(10), {
    rifleman: 0.55,
    heavy: 0.2,
    breacher: 0.25
  });

  assert.equal(GAME_CONFIG.enemies.rifleman.health, 70);
  assert.equal(GAME_CONFIG.enemies.rifleman.damage, 7);
  assert.equal(GAME_CONFIG.enemies.rifleman.burstShots, 3);
  assert.equal(GAME_CONFIG.enemies.heavy.health, 200);
  assert.equal(GAME_CONFIG.enemies.heavy.scale, 1.12);
  assert.equal(GAME_CONFIG.enemies.heavy.armored, true);
  assert.equal(GAME_CONFIG.enemies.breacher.contactDamage, 14);
  assert.equal(GAME_CONFIG.enemies.breacher.melee, true);
  assert.equal(GAME_CONFIG.enemies.headshotMultiplier, 2);
  assert.equal(GAME_CONFIG.enemies.rifleman.modelPool.length, 3);
  assert.equal(
    GAME_CONFIG.enemies.modelPaths['woman-casual'],
    'models/quaternius-woman-casual.glb'
  );
  assert.equal(GAME_CONFIG.enemies.animationNames.rifleman.runShoot, 'Run_Shoot');
  assert.equal(
    GAME_CONFIG.enemies.animationNames.breacher.attackLeft,
    'Punch_Left'
  );
  for (const type of Object.values(ENEMY_TYPES)) {
    const enemy = GAME_CONFIG.enemies[type];
    assert.ok(enemy.modelPool.length > 0);
    for (const model of enemy.modelPool) {
      assert.equal(typeof GAME_CONFIG.enemies.modelPaths[model], 'string');
      assert.ok(GAME_CONFIG.enemies.modelPaths[model].startsWith('models/quaternius-'));
      assert.ok(GAME_CONFIG.enemies.animationNames[type]);
    }
  }
});

test('设置默认值与范围正确，越界值夹紧，非法值抛错', () => {
  const defaults = normalizeSettings();
  assert.deepEqual(defaults, {
    mouseSensitivity: 1.0,
    adsSensitivityMultiplier: 0.8,
    fov: 75,
    masterVolume: 0.7,
    quality: 'high'
  });
  assert.equal(Object.isFrozen(defaults), true);
  assert.equal(isSettings(defaults), true);

  assert.equal(clampSetting('mouseSensitivity', 10), 3.0);
  assert.equal(clampSetting('mouseSensitivity', 0.01), 0.25);
  assert.equal(clampSetting('adsSensitivityMultiplier', 0.1), 0.4);
  assert.equal(clampSetting('fov', 100), 95);
  assert.equal(clampSetting('fov', 10), 65);
  assert.equal(clampSetting('masterVolume', -1), 0);
  assert.equal(clampSetting('masterVolume', 2), 1);
  assert.equal(clampSetting('quality', 'low'), 'low');

  const clamped = normalizeSettings({
    mouseSensitivity: 99,
    adsSensitivityMultiplier: 0.1,
    fov: 60,
    masterVolume: 5,
    quality: 'low'
  });
  assert.deepEqual(clamped, {
    mouseSensitivity: 3.0,
    adsSensitivityMultiplier: 0.4,
    fov: 65,
    masterVolume: 1,
    quality: 'low'
  });

  assert.throws(() => clampSetting('fov', Number.NaN), TypeError);
  assert.throws(() => clampSetting('fov', Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => clampSetting('quality', 'ultra'), RangeError);
  assert.throws(() => normalizeSettings({ quality: 'ultra' }), RangeError);
  assert.throws(() => normalizeSettings({ fov: '75' }), TypeError);

  const partial = normalizeSettings({ fov: 90 });
  assert.equal(partial.fov, 90);
  assert.equal(partial.mouseSensitivity, 1.0);
});

test('v3 载荷带爆头别名、受伤方向与设置/性能校验', () => {
  assert.equal(isKnownEvent(EVENTS.WORLD_ENEMY_SHOT), true);
  assert.equal(isKnownEvent(EVENTS.WORLD_BLOOD), true);
  assert.equal(isKnownEvent(EVENTS.WEAPON_SHELL_EJECT), true);
  assert.equal(isKnownEvent(EVENTS.SETTINGS_CHANGED), true);

  assert.deepEqual(createHudHitmarkerPayload({ headshot: true }), {
    killed: false,
    headshot: true
  });
  assert.deepEqual(createHudKillfeedPayload({ critical: true }), {
    enemyType: 'rifleman',
    score: 0,
    headshot: true,
    critical: true
  });
  const killed = createEnemyKilledPayload({ headshot: true });
  assert.equal(killed.headshot, true);
  assert.equal(killed.critical, true);

  const damage = createHudDamagePayload({ amount: 7, direction: Math.PI * 3 });
  assert.equal(damage.amount, 7);
  assert.ok(Math.abs(Math.abs(damage.direction) - Math.PI) < 1e-9);

  const settings = createSettings({ fov: 80 });
  assert.equal(settings.fov, 80);
  assert.equal(isSettings({ ...settings, quality: 'ultra' }), false);

  const performance = {
    fps: 59.5,
    frameCount: 120,
    enemyCount: 3,
    quality: 'high',
    postProcessing: true
  };
  assert.equal(isPerformanceSnapshot(performance), true);
  assert.equal(
    isPerformanceSnapshot({ ...performance, quality: 'ultra' }),
    false
  );
  assert.equal(
    isPerformanceSnapshot({ ...performance, enemyCount: -1 }),
    false
  );
});

/* -------------------------------------------------------------------------- */
/* 纯状态机与计分账本                                                          */
/* -------------------------------------------------------------------------- */

test('状态机允许 menu→playing→paused→playing→over→playing', () => {
  const machine = createGameStateMachine();
  assert.equal(machine.getState(), EVENTS.GAME_STATES.MENU);
  assert.deepEqual(getAllowedTransitions(EVENTS.GAME_STATES.MENU), [
    EVENTS.GAME_STATES.PLAYING
  ]);

  assert.equal(machine.transition(EVENTS.GAME_STATES.PLAYING), true);
  assert.equal(machine.transition(EVENTS.GAME_STATES.PAUSED), true);
  assert.equal(machine.transition(EVENTS.GAME_STATES.PLAYING), true);
  assert.equal(machine.transition(EVENTS.GAME_STATES.OVER), true);
  assert.equal(machine.transition(EVENTS.GAME_STATES.PLAYING), true);
  assert.equal(machine.getState(), EVENTS.GAME_STATES.PLAYING);
});

test('状态机拒绝非法迁移且保持原状态', () => {
  const machine = createGameStateMachine();
  assert.equal(machine.transition(EVENTS.GAME_STATES.PAUSED), false);
  assert.equal(machine.transition(EVENTS.GAME_STATES.OVER), false);
  assert.equal(machine.getState(), EVENTS.GAME_STATES.MENU);

  assert.equal(machine.transition(EVENTS.GAME_STATES.PLAYING), true);
  assert.equal(machine.transition(EVENTS.GAME_STATES.MENU), false);
  assert.equal(machine.canTransition(EVENTS.GAME_STATES.MENU), false);
  assert.equal(machine.getState(), EVENTS.GAME_STATES.PLAYING);

  assert.throws(() => machine.transition('not-a-state'), TypeError);
  assert.throws(() => getAllowedTransitions('not-a-state'), TypeError);
});

test('计分账本累加得分、击杀、存活时间与波次，重置后回到初始值', () => {
  let accounting = createMatchAccounting();
  assert.deepEqual(accounting, {
    score: 0,
    kills: 0,
    wave: GAME_CONFIG.match.initialWave,
    survivedSeconds: 0
  });

  accounting = addKillScore(accounting, 250);
  accounting = addKillScore(accounting, 100);
  accounting = advanceSurvivalTime(accounting, 1.25);
  accounting = advanceWaveNumber(accounting);
  assert.deepEqual(accounting, {
    score: 350,
    kills: 2,
    wave: 2,
    survivedSeconds: 1.25
  });

  const reset = createMatchAccounting();
  assert.equal(reset.score, 0);
  assert.equal(reset.kills, 0);
  assert.equal(reset.wave, 1);
  assert.equal(reset.survivedSeconds, 0);
});

test('波次横幅使用固定文案与 2200 毫秒时长', () => {
  const banner = createWaveBanner(3);
  assert.deepEqual(banner, {
    title: '第 3 波',
    subtitle: '敌人来袭',
    durationMs: WAVE_BANNER_DURATION_MS
  });
  assert.equal(WAVE_BANNER_DURATION_MS, 2200);
});

/* -------------------------------------------------------------------------- */
/* createGame 编排                                                             */
/* -------------------------------------------------------------------------- */

test('createGame 拒绝缺少必需服务或方法的调用', () => {
  assert.throws(() => createGame({}), TypeError);
  const bus = createEventBus();
  assert.throws(
    () =>
      createGame({
        bus,
        renderer: {},
        arena: { update() {} },
        combat: {},
        enemies: {},
        effects: {},
        audio: {}
      }),
    /setCameraPose/
  );
});

test('菜单中推进菜单环绕镜头，不推进业务更新', () => {
  const rig = createRig();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.MENU);

  rig.game.update(0.5);
  assert.equal(rig.renderer.poses.length, 1);
  const pose = rig.renderer.poses[0];
  assert.equal(pose.fov, GAME_CONFIG.match.cameraFov);
  assert.equal(typeof pose.position.x, 'number');
  assert.equal(typeof pose.position.y, 'number');
  assert.equal(typeof pose.position.z, 'number');
  assert.equal(typeof pose.yaw, 'number');
  assert.equal(typeof pose.pitch, 'number');
  assert.equal(rig.combat.updateCalls, 0);
  assert.equal(rig.enemies.updateCalls, 0);
  assert.equal(rig.effects.updateCalls, 0);
});

test('第一人称武器视图随状态显示或隐藏', () => {
  const rig = createRig();

  // 初始 menu：隐藏。
  assert.equal(rig.combat.viewVisible, false);
  assert.deepEqual(rig.combat.setViewVisibleCalls, [false]);

  // 开始：reset 恢复可见后，Pipeline 再显式显示。
  rig.game.start();
  assert.equal(rig.combat.viewVisible, true);
  assert.equal(
    rig.combat.setViewVisibleCalls[rig.combat.setViewVisibleCalls.length - 1],
    true
  );

  // 暂停仍可见，恢复后也可见。
  rig.game.pause();
  assert.equal(rig.combat.viewVisible, true);
  rig.game.resume();
  assert.equal(rig.combat.viewVisible, true);

  // 结算：隐藏。
  rig.combat.snapshot.alive = false;
  rig.game.update(0.05);
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);
  assert.equal(rig.combat.viewVisible, false);

  // 重开：重新显示。
  rig.game.restart();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  assert.equal(rig.combat.viewVisible, true);
});

test('start 进入 playing 并发状态、波次、横幅与 HUD', () => {
  const rig = createRig();
  rig.game.start();

  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  assert.deepEqual(rig.enemies.startWaveCalls, [1]);
  assert.equal(rig.combat.resetCalls, 1);
  assert.equal(rig.enemies.resetCalls, 1);
  assert.equal(rig.effects.clearCalls, 1);
  assert.equal(rig.audio.calls.waveStart, 1);

  assert.deepEqual(rig.last(EVENTS.GAME_STATE), { state: 'playing' });
  assert.deepEqual(rig.last(EVENTS.WAVE_START), { wave: 1 });
  assert.deepEqual(rig.last(EVENTS.HUD_BANNER), {
    title: '第 1 波',
    subtitle: '敌人来袭',
    durationMs: 2200
  });

  const hud = rig.last(EVENTS.HUD_UPDATE);
  assert.deepEqual(hud, {
    score: 0,
    wave: 1,
    kills: 0,
    health: 100,
    maxHealth: 100,
    ammo: 30,
    magazineSize: 30,
    reloading: false,
    reloadProgress: 0,
    yaw: 0,
    muted: false
  });
});

test('击杀事件累加得分与击杀，并发出带爆头标记的击杀信息与音效', () => {
  const rig = createRig();
  rig.game.start();

  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    headshot: true,
    position: { x: 1, y: 0, z: 2 },
    color: 0x8a927a
  });
  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'heavy',
    score: 300,
    critical: false,
    position: { x: 3, y: 0, z: 4 },
    color: 0x5f6650
  });

  const snapshot = rig.game.getSnapshot();
  assert.equal(snapshot.score, 400);
  assert.equal(snapshot.kills, 2);
  assert.equal(rig.audio.calls.kill, 2);

  const killfeed = rig.last(EVENTS.HUD_KILLFEED);
  assert.deepEqual(killfeed, {
    enemyType: 'heavy',
    score: 300,
    headshot: false,
    critical: false
  });
});

test('玩家受伤与拾取事件转发给战斗服务', () => {
  const rig = createRig();
  rig.game.start();

  rig.bus.emit(EVENTS.PLAYER_DAMAGE, { amount: 12 });
  assert.deepEqual(rig.combat.damageCalls, [12]);

  rig.bus.emit(EVENTS.PICKUP_COLLECTED, {
    position: { x: 0, y: 0, z: 1 },
    amount: 30
  });
  assert.deepEqual(rig.combat.healCalls, [30]);
  assert.equal(rig.audio.calls.pickup, 1);

  rig.bus.emit(EVENTS.HUD_DAMAGE, { amount: 12 });
  assert.equal(rig.audio.calls.hurt, 1);
});

test('world:shot 转发弹道与射击音效', () => {
  const rig = createRig();
  rig.game.start();

  const from = { x: 0, y: 1.6, z: 0 };
  const to = { x: 0, y: 1.4, z: -20 };
  rig.bus.emit(EVENTS.WORLD_SHOT, {
    from,
    to,
    muzzlePosition: { x: 0.2, y: 1.4, z: -0.5 },
    color: 0xffd9a0
  });

  assert.equal(rig.effects.tracers.length, 1);
  assert.deepEqual(rig.effects.tracers[0], { from, to, color: 0xffd9a0 });
  assert.equal(rig.audio.calls.shoot, 1);
});

test('暂停冻结业务时间，恢复后继续推进', () => {
  const rig = createRig();
  rig.game.start();
  rig.game.update(0.05);

  const survivedBeforePause = rig.game.getSnapshot().survivedSeconds;
  const combatCalls = rig.combat.updateCalls;
  const enemyCalls = rig.enemies.updateCalls;
  const effectsCalls = rig.effects.updateCalls;
  const arenaCalls = rig.arena.updateCalls;

  rig.game.pause();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PAUSED);
  assert.deepEqual(rig.last(EVENTS.GAME_STATE), { state: 'paused' });

  rig.game.update(0.5);
  assert.equal(rig.combat.updateCalls, combatCalls);
  assert.equal(rig.enemies.updateCalls, enemyCalls);
  assert.equal(rig.effects.updateCalls, effectsCalls);
  assert.equal(rig.arena.updateCalls, arenaCalls);
  assert.equal(rig.game.getSnapshot().survivedSeconds, survivedBeforePause);

  rig.game.resume();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, combatCalls + 1);
  assert.equal(rig.enemies.updateCalls, enemyCalls + 1);
  assert.ok(rig.game.getSnapshot().survivedSeconds > survivedBeforePause);
});

test('update 将单帧时间限制为 0.05 秒', () => {
  const rig = createRig();
  rig.game.start();
  rig.game.update(1.0);

  assert.equal(rig.combat.updateDeltas[0], GAME_CONFIG.match.deltaClamp);
  assert.equal(rig.enemies.updateDeltas[0], GAME_CONFIG.match.deltaClamp);
  assert.ok(rig.game.getSnapshot().survivedSeconds <= GAME_CONFIG.match.deltaClamp);
});

test('玩家死亡只结算一次并发布成绩', () => {
  const rig = createRig();
  rig.game.start();
  rig.game.update(0.05);

  rig.combat.snapshot.alive = false;
  rig.combat.snapshot.health = 0;
  rig.game.update(0.05);

  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);
  assert.deepEqual(rig.last(EVENTS.GAME_STATE), { state: 'over' });
  const gameover = rig.last(EVENTS.HUD_GAMEOVER);
  assert.equal(gameover.score, 0);
  assert.equal(gameover.wave, 1);
  assert.equal(gameover.kills, 0);
  assert.ok(gameover.survivedSeconds > 0);
  assert.equal(rig.audio.calls.gameOver, 1);

  rig.bus.emit(EVENTS.PLAYER_DIED, {});
  rig.game.update(0.05);
  assert.equal(rig.findAll(EVENTS.HUD_GAMEOVER).length, 1);
  assert.equal(rig.audio.calls.gameOver, 1);
});

test('player:died 事件在快照死亡时触发结算', () => {
  const rig = createRig();
  rig.game.start();
  rig.combat.snapshot.alive = false;
  rig.combat.snapshot.health = 0;

  rig.bus.emit(EVENTS.PLAYER_DIED, {});
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);
  assert.equal(rig.findAll(EVENTS.HUD_GAMEOVER).length, 1);
  assert.equal(rig.audio.calls.gameOver, 1);
});

test('restart 重置得分、波次、击杀并保留已应用的设置', () => {
  const rig = createRig();
  rig.game.start();
  rig.game.applySettings({ mouseSensitivity: 1.5, quality: 'low' });
  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'breacher',
    score: 150,
    critical: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x9a6b4f
  });
  rig.combat.snapshot.alive = false;

  // 第一次 update 只消耗击杀顿帧；第二次才检测到死亡。
  rig.game.update(0.05);
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  rig.game.update(0.05);
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.OVER);

  rig.game.restart();
  assert.equal(rig.game.getState(), EVENTS.GAME_STATES.PLAYING);
  assert.deepEqual(rig.last(EVENTS.GAME_STATE), { state: 'playing' });
  const snapshot = rig.game.getSnapshot();
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.kills, 0);
  assert.equal(snapshot.wave, 1);
  assert.equal(snapshot.survivedSeconds, 0);
  assert.equal(snapshot.settings.mouseSensitivity, 1.5);
  assert.equal(snapshot.settings.quality, 'low');
  assert.deepEqual(rig.enemies.startWaveCalls, [1, 1]);
  assert.equal(rig.combat.resetCalls, 2);
  assert.equal(rig.last(EVENTS.HUD_UPDATE).score, 0);
});

test('一波清空后等待约 4.5 秒再开始下一波', () => {
  const rig = createRig();
  rig.game.start();
  rig.enemies.state.waveComplete = true;

  let updates = 0;
  while (rig.game.getSnapshot().wave === 1 && updates < 200) {
    rig.game.update(0.05);
    updates += 1;
  }

  assert.ok(updates >= 89 && updates <= 92, '实际等待帧数 ' + updates);
  assert.equal(rig.game.getSnapshot().wave, 2);
  assert.deepEqual(rig.enemies.startWaveCalls, [1, 2]);
  assert.deepEqual(rig.last(EVENTS.WAVE_START), { wave: 2 });
  assert.deepEqual(rig.last(EVENTS.HUD_BANNER), {
    title: '第 2 波',
    subtitle: '敌人来袭',
    durationMs: 2200
  });
  assert.equal(rig.audio.calls.waveStart, 2);
  assert.equal(rig.findAll(EVENTS.WAVE_CLEARED).length, 1);
});

test('toggleMute 调用音频服务并让 HUD 带上静音状态', () => {
  const rig = createRig();
  rig.game.start();

  rig.game.toggleMute();
  assert.deepEqual(rig.audio.setMutedCalls, [true]);
  assert.equal(rig.game.getSnapshot().muted, true);
  assert.equal(rig.last(EVENTS.HUD_UPDATE).muted, true);

  rig.game.toggleMute();
  assert.deepEqual(rig.audio.setMutedCalls, [true, false]);
  assert.equal(rig.last(EVENTS.HUD_UPDATE).muted, false);
});

test('applySettings 合并、转发、发事件，并进入快照', () => {
  const rig = createRig();
  assert.deepEqual(rig.game.getSettings(), GAME_CONFIG.settings.defaults);

  const applied = rig.game.applySettings({
    mouseSensitivity: 1.5,
    adsSensitivityMultiplier: 0.6,
    fov: 90,
    masterVolume: 0.4,
    quality: 'low'
  });
  assert.deepEqual(applied, {
    mouseSensitivity: 1.5,
    adsSensitivityMultiplier: 0.6,
    fov: 90,
    masterVolume: 0.4,
    quality: 'low'
  });
  assert.equal(Object.isFrozen(applied), true);

  assert.deepEqual(rig.combat.setSettingsCalls[rig.combat.setSettingsCalls.length - 1], {
    mouseSensitivity: 1.5,
    adsSensitivityMultiplier: 0.6,
    fov: 90
  });
  assert.deepEqual(rig.renderer.setQualityCalls, ['low']);
  assert.deepEqual(rig.audio.masterVolumeCalls, [0.4]);

  const changed = rig.last(EVENTS.SETTINGS_CHANGED);
  assert.deepEqual(changed, { settings: applied });

  const snapshot = rig.game.getSnapshot();
  assert.deepEqual(snapshot.settings, applied);
  assert.equal(Object.isFrozen(snapshot.settings), true);
  assert.equal(snapshot.performance.quality, 'low');
  assert.equal(snapshot.performance.postProcessing, false);
});

test('applySettings 在渲染器只有后处理开关时使用回退', () => {
  const bus = createEventBus();
  const renderer = {
    postProcessingCalls: [],
    setCameraPose() {},
    setPostProcessingEnabled(enabled) {
      this.postProcessingCalls.push(enabled);
    }
  };
  const game = createGame({
    bus,
    renderer,
    arena: createFakeArena(),
    combat: createFakeCombat(),
    enemies: createFakeEnemies(),
    effects: createFakeEffects(),
    audio: createFakeAudio()
  });

  game.applySettings({ quality: 'low' });
  assert.deepEqual(renderer.postProcessingCalls, [false]);
  game.applySettings({ quality: 'high' });
  assert.deepEqual(renderer.postProcessingCalls, [false, true]);
});

test('applySettings 在服务缺少 setter 时仍保存设置且不抛错', () => {
  const rig = createRig();
  rig.combat.setSettings = undefined;
  rig.renderer.setQuality = undefined;
  rig.renderer.setPostProcessingEnabled = undefined;
  rig.audio.setMasterVolume = undefined;

  const applied = rig.game.applySettings({ fov: 82 });
  assert.equal(applied.fov, 82);
  assert.equal(rig.game.getSettings().fov, 82);
  assert.deepEqual(rig.last(EVENTS.SETTINGS_CHANGED), { settings: applied });
});

test('爆头命中标记播放专用音效，击杀信息带 headshot', () => {
  const rig = createRig();
  rig.game.start();

  rig.bus.emit(EVENTS.HUD_HITMARKER, { killed: false, headshot: true });
  assert.equal(rig.audio.calls.hit, 1);
  assert.equal(rig.audio.calls.headshot, 1);

  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    headshot: true,
    position: { x: 1, y: 0, z: 2 },
    color: 0x8a927a
  });
  const killfeed = rig.last(EVENTS.HUD_KILLFEED);
  assert.deepEqual(killfeed, {
    enemyType: 'rifleman',
    score: 100,
    headshot: true,
    critical: true
  });
});

test('player:damage 的 sourcePosition 换算为相对玩家朝向的方向', () => {
  const rig = createRig();
  rig.game.start();

  // yaw = 0 时玩家朝向 -Z，+X 在右侧。
  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 10,
    sourcePosition: { x: 10, y: 0, z: 0 }
  });
  assert.deepEqual(rig.combat.damageCalls, [10]);
  const right = rig.last(EVENTS.HUD_DAMAGE);
  assert.equal(right.amount, 10);
  assert.ok(Math.abs(right.direction - Math.PI / 2) < 1e-9, 'direction ' + right.direction);
  assert.equal(rig.audio.calls.hurt, 1);

  // 正后方的攻击方向约为 ±π。
  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 7,
    sourcePosition: { x: 0, y: 0, z: 10 }
  });
  const behind = rig.last(EVENTS.HUD_DAMAGE);
  assert.ok(Math.abs(Math.abs(behind.direction) - Math.PI) < 1e-9, 'direction ' + behind.direction);
  assert.equal(rig.audio.calls.hurt, 2);

  // 没有来源位置时只转发伤害，不额外发 hud:damage。
  const damageBefore = rig.findAll(EVENTS.HUD_DAMAGE).length;
  rig.bus.emit(EVENTS.PLAYER_DAMAGE, { amount: 5 });
  assert.equal(rig.findAll(EVENTS.HUD_DAMAGE).length, damageBefore);
  assert.deepEqual(rig.combat.damageCalls, [10, 7, 5]);
});

test('战斗服务同步发出 hud:damage 时受伤音效只播放一次', () => {
  const rig = createRig();
  rig.game.start();

  // 模拟真实战斗服务：damagePlayer 内部同步发出不含方向的 hud:damage。
  rig.combat.damagePlayer = function damagePlayer(amount) {
    rig.combat.damageCalls.push(amount);
    rig.bus.emit(EVENTS.HUD_DAMAGE, { amount });
  };

  rig.bus.emit(EVENTS.PLAYER_DAMAGE, {
    amount: 9,
    sourcePosition: { x: 5, y: 0, z: 0 }
  });

  assert.deepEqual(rig.combat.damageCalls, [9]);
  assert.equal(rig.audio.calls.hurt, 1);
  const enriched = rig.last(EVENTS.HUD_DAMAGE);
  assert.equal(enriched.amount, 9);
  assert.ok(Math.abs(enriched.direction - Math.PI / 2) < 1e-9);
});

test('敌人枪声、血雾与抛壳事件映射到效果和音频', () => {
  const rig = createRig();
  rig.game.start();

  rig.bus.emit(EVENTS.WORLD_ENEMY_SHOT, {
    position: { x: 10, y: 1, z: 0 },
    direction: { x: -1, y: 0, z: 0 },
    color: 0x8a927a,
    enemyType: 'rifleman'
  });
  assert.equal(rig.effects.enemyShots.length, 1);
  assert.equal(rig.audio.calls.enemyShot, 1);
  assert.equal(rig.audio.enemyShotCalls[0].enemyType, 'rifleman');
  assert.ok(rig.audio.enemyShotCalls[0].distance > 9);

  rig.bus.emit(EVENTS.WORLD_BLOOD, {
    position: { x: 2, y: 1.3, z: -3 },
    direction: { x: 0, y: 0.2, z: 1 },
    color: 0x7a1f18
  });
  assert.equal(rig.effects.bloods.length, 1);

  rig.bus.emit(EVENTS.WEAPON_SHELL_EJECT, {
    position: { x: 0.2, y: 1.3, z: -0.3 },
    velocity: { x: 2, y: 1.5, z: 0 }
  });
  assert.equal(rig.effects.shells.length, 1);
  assert.equal(rig.audio.calls.shellDrop, 1);
});

test('getPerformance 返回帧数、敌人数量、画质与后处理状态', () => {
  const rig = createRig();
  rig.game.start();
  rig.game.update(0.02);
  rig.game.update(0.02);

  const performance = rig.game.getPerformance();
  assert.equal(Object.isFrozen(performance), true);
  assert.ok(performance.fps > 0);
  assert.equal(performance.frameCount, 2);
  assert.equal(performance.enemyCount, 1);
  assert.equal(performance.quality, 'high');
  assert.equal(performance.postProcessing, true);
  assert.equal(isPerformanceSnapshot(performance), true);
  assert.deepEqual(rig.game.getSnapshot().performance, performance);

  rig.game.applySettings({ quality: 'low' });
  const low = rig.game.getPerformance();
  assert.equal(low.quality, 'low');
  assert.equal(low.postProcessing, false);
});

test('击杀顿帧冻结一帧，暂停不会卡住，重开会清除', () => {
  const rig = createRig();
  rig.game.start();
  const baseCalls = rig.combat.updateCalls;

  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    headshot: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x8a927a
  });
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, baseCalls);
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, baseCalls + 1);

  // 暂停期间顿帧计时冻结；恢复后仍需消费一帧。
  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    headshot: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x8a927a
  });
  rig.game.pause();
  const pausedCalls = rig.combat.updateCalls;
  rig.game.update(0.5);
  assert.equal(rig.combat.updateCalls, pausedCalls);
  rig.game.resume();
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, pausedCalls);
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, pausedCalls + 1);

  // 重开清除顿帧，重开后第一帧就推进战斗。
  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    headshot: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x8a927a
  });
  rig.game.restart();
  const restartCalls = rig.combat.updateCalls;
  rig.game.update(0.05);
  assert.equal(rig.combat.updateCalls, restartCalls + 1);
});

test('getSnapshot 返回可序列化的只读状态（O4）', () => {
  const rig = createRig();
  rig.game.start();

  const snapshot = rig.game.getSnapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.state, 'playing');
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.wave, 1);
  assert.equal(snapshot.kills, 0);
  assert.equal(snapshot.muted, false);
  assert.equal(snapshot.player.health, 100);
  assert.equal(snapshot.weapon.ammo, 30);
  assert.equal(snapshot.enemies.wave, 1);
  assert.deepEqual(snapshot.settings, GAME_CONFIG.settings.defaults);
  assert.equal(snapshot.performance.quality, 'high');
  assert.equal(snapshot.performance.enemyCount, 0);

  const parsed = JSON.parse(JSON.stringify(snapshot));
  assert.equal(parsed.state, 'playing');
  assert.equal(parsed.player.alive, true);
  assert.equal(parsed.settings.fov, GAME_CONFIG.settings.defaults.fov);
  assert.equal(typeof parsed.performance.frameCount, 'number');
});

test('dispose 退订总线并停止主循环，且不释放注入服务', () => {
  const rig = createRig();
  rig.game.start();
  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    critical: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x8a927a
  });
  assert.equal(rig.game.getSnapshot().score, 100);

  const combatCalls = rig.combat.updateCalls;
  const killCalls = rig.audio.calls.kill;
  rig.game.dispose();
  rig.game.dispose();

  rig.bus.emit(EVENTS.ENEMY_KILLED, {
    enemyType: 'rifleman',
    score: 100,
    critical: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0x8a927a
  });
  rig.game.update(0.05);

  assert.equal(rig.game.getSnapshot().score, 100);
  assert.equal(rig.audio.calls.kill, killCalls);
  assert.equal(rig.combat.updateCalls, combatCalls);
  assert.equal(rig.combat.resetCalls, 1);
  assert.equal(rig.enemies.resetCalls, 1);
});
