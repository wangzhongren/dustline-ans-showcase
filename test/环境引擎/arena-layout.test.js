/**
 * 环境引擎 Service 单元测试。
 *
 * 覆盖内容：
 * - 竞技场布局分类、AABB 合法性、旋转足迹与叠放木箱。
 * - 玩家出生点与 22–28 米敌人出生点的合法性、确定性与失败信息。
 * - 效果池上限、淡出曲线与复用策略（不创建 WebGL）。
 * - 音频参数映射、未知名称与引擎所有权（不创建 AudioContext）。
 * - 公共入口 `createArena()` 的构造、加载幂等与释放路径（使用 Provider 替身）。
 *
 * 运行：
 *   node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/环境引擎/arena-layout.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLayout,
  createColliders,
  createPropColliders,
  isPointInsideCollider,
  isPointInsideArena,
  isSpawnPointValid,
  findSpawnPoint,
  getPlayerSpawn
} from '../../src/services/impl/environment/arena-layout.js';
import {
  EFFECT_POOL_LIMITS,
  computeFade,
  pickReuseIndex,
  createEffectsService
} from '../../src/services/impl/effects/effects.js';
import {
  SOUND_NAMES,
  getSoundPlan,
  getEnemyShotPlan,
  computeEnemyShotAttenuation,
  createAudioService
} from '../../src/services/impl/audio/audio-service.js';
import {
  computeRampFactor,
  computeRampColor
} from '../../src/services/impl/environment/arena.js';
import { createArena } from '../../src/services/public/environment.js';

/**
 * 可复现的 32 位伪随机数发生器（mulberry32）。
 *
 * @param {number} seed
 * @returns {() => number}
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value = value ^ (value + Math.imul(value ^ (value >>> 7), value | 61));
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 独立计算一个箱体或桶的旋转足迹，用于验证碰撞体覆盖。
 *
 * @param {Record<string, unknown>} entry
 * @param {'box'|'barrel'} shape
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}}
 */
function expectedFootprint(entry, shape) {
  let width = /** @type {number} */ (entry.width);
  let depth = /** @type {number} */ (entry.depth);
  if (shape === 'barrel') {
    const radius = /** @type {number} */ (entry.radius);
    width = radius * 2;
    depth = radius * 2;
  }
  let rotationY = 0;
  if (typeof entry.rotationY === 'number') {
    rotationY = entry.rotationY;
  }
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  const halfX = halfWidth * cos + halfDepth * sin;
  const halfZ = halfWidth * sin + halfDepth * cos;
  return {
    minX: /** @type {number} */ (entry.x) - halfX,
    maxX: /** @type {number} */ (entry.x) + halfX,
    minZ: /** @type {number} */ (entry.z) - halfZ,
    maxZ: /** @type {number} */ (entry.z) + halfZ
  };
}

/**
 * @param {ReadonlyArray<Record<string, unknown>>} colliders
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} expected
 * @returns {Record<string, unknown>|undefined}
 */
function findMatchingCollider(colliders, expected) {
  return colliders.find((collider) => {
    const min = /** @type {{x: number, z: number}} */ (collider.min);
    const max = /** @type {{x: number, z: number}} */ (collider.max);
    const closeMinX = Math.abs(min.x - expected.minX) < 0.01;
    const closeMaxX = Math.abs(max.x - expected.maxX) < 0.01;
    const closeMinZ = Math.abs(min.z - expected.minZ) < 0.01;
    const closeMaxZ = Math.abs(max.z - expected.maxZ) < 0.01;
    return closeMinX && closeMaxX && closeMinZ && closeMaxZ;
  });
}

test('布局包含地面与所有障碍分类，碰撞体数量匹配', () => {
  const layout = createLayout();
  assert.equal(layout.ground.width, 60);
  assert.equal(layout.ground.depth, 60);
  assert.equal(layout.ground.repeat, 15);

  const categories = [
    'bunkers',
    'walls',
    'containers',
    'crates',
    'barrels',
    'sandbags',
    'fences',
    'debris'
  ];
  for (const category of categories) {
    assert.ok(Array.isArray(layout[category]), category + ' 必须是数组');
    assert.ok(layout[category].length > 0, category + ' 不能为空');
  }
  assert.ok(layout.tower !== null && typeof layout.tower === 'object');
  assert.equal(layout.tower.id, 'watchtower');

  const propCategories = [
    'hesco',
    'jersey',
    'sandbagWalls',
    'tents',
    'pallets',
    'tires',
    'signs',
    'ammoCrates',
    'searchlights',
    'groundPatches',
    'stains'
  ];
  for (const category of propCategories) {
    assert.ok(Array.isArray(layout.props[category]), 'props.' + category + ' 必须是数组');
    assert.ok(layout.props[category].length > 0, 'props.' + category + ' 不能为空');
  }

  const propColliderCount =
    layout.props.hesco.length +
    layout.props.jersey.length +
    layout.props.sandbagWalls.length +
    layout.props.tents.length +
    layout.props.signs.length +
    layout.props.ammoCrates.length +
    layout.props.searchlights.length;

  const colliders = createColliders(layout);
  const expectedCount =
    layout.bunkers.length +
    layout.walls.length +
    layout.containers.length +
    layout.crates.length +
    layout.sandbags.length +
    layout.barrels.length +
    layout.fences.length +
    1 +
    propColliderCount;
  assert.equal(colliders.length, expectedCount);
  assert.ok(colliders.length >= 60);
  assert.equal(createPropColliders(layout).length, propColliderCount);
});

test('碰撞体都是有效 AABB，且不覆盖整个竞技场地面', () => {
  const colliders = createColliders(createLayout());
  for (const collider of colliders) {
    assert.ok(collider.min.x < collider.max.x, 'min.x 必须小于 max.x');
    assert.ok(collider.min.y < collider.max.y, 'min.y 必须小于 max.y');
    assert.ok(collider.min.z < collider.max.z, 'min.z 必须小于 max.z');
    const width = collider.max.x - collider.min.x;
    const depth = collider.max.z - collider.min.z;
    const isWholeArena = width > 50 && depth > 50;
    assert.equal(isWholeArena, false, '地面不应生成阻挡整个竞技场的碰撞体');
  }
});

test('碰撞体按旋转足迹覆盖各类障碍物', () => {
  const layout = createLayout();
  const colliders = createColliders(layout);

  const boxGroups = ['bunkers', 'walls', 'containers', 'crates', 'sandbags', 'fences'];
  for (const groupName of boxGroups) {
    for (const entry of layout[groupName]) {
      const expected = expectedFootprint(entry, 'box');
      const match = findMatchingCollider(colliders, expected);
      assert.ok(match !== undefined, groupName + '/' + entry.id + ' 缺少匹配碰撞体');
    }
  }
  for (const entry of layout.barrels) {
    const expected = expectedFootprint(entry, 'barrel');
    const match = findMatchingCollider(colliders, expected);
    assert.ok(match !== undefined, 'barrels/' + entry.id + ' 缺少匹配碰撞体');
  }
  const towerExpected = expectedFootprint(layout.tower, 'box');
  assert.ok(
    findMatchingCollider(colliders, towerExpected) !== undefined,
    '警戒塔缺少匹配碰撞体'
  );

  // 装饰碎片不产生碰撞体。
  const debrisIds = new Set(layout.debris.map((piece) => piece.id));
  assert.ok(debrisIds.size > 0);
  for (const collider of colliders) {
    const width = collider.max.x - collider.min.x;
    const depth = collider.max.z - collider.min.z;
    assert.ok(width > 0.2 || depth > 0.2, '碰撞体尺寸异常');
  }
});

test('v3 实体道具生成匹配碰撞体，装饰道具不产生碰撞', () => {
  const layout = createLayout();
  const colliders = createColliders(layout);
  const solidGroups = [
    'hesco',
    'jersey',
    'sandbagWalls',
    'tents',
    'signs',
    'ammoCrates',
    'searchlights'
  ];
  for (const groupName of solidGroups) {
    for (const entry of layout.props[groupName]) {
      const expected = expectedFootprint(entry, 'box');
      const match = findMatchingCollider(colliders, expected);
      assert.ok(
        match !== undefined,
        'props.' + groupName + '/' + entry.id + ' 缺少匹配碰撞体'
      );
    }
  }

  const decorativeIds = new Set();
  for (const entry of layout.props.pallets) {
    decorativeIds.add(entry.id);
  }
  for (const entry of layout.props.tires) {
    decorativeIds.add(entry.id);
  }
  for (const entry of layout.props.groundPatches) {
    decorativeIds.add(entry.id);
  }
  for (const entry of layout.props.stains) {
    decorativeIds.add(entry.id);
  }
  assert.ok(decorativeIds.size > 0);
  assert.equal(
    colliders.length,
    createPropColliders(layout).length +
      layout.bunkers.length +
      layout.walls.length +
      layout.containers.length +
      layout.crates.length +
      layout.sandbags.length +
      layout.barrels.length +
      layout.fences.length +
      1
  );
});

test('Fabric084 / Wood066 亮度重映射保持 0.75–1.25 系数范围', () => {
  assert.equal(computeRampFactor(128, 128, 0.35, 0.75, 1.25), 1);
  assert.equal(computeRampFactor(0, 128, 0.35, 0.75, 1.25), 0.75);
  assert.equal(computeRampFactor(255, 128, 0.35, 0.75, 1.25), 1.25);
  const darker = computeRampFactor(90, 128, 0.35, 0.75, 1.25);
  const brighter = computeRampFactor(180, 128, 0.35, 0.75, 1.25);
  assert.ok(darker < 1 && brighter > 1);
  assert.throws(() => computeRampFactor(-1, 128, 0.35, 0.75, 1.25), /luminance/);
  assert.throws(() => computeRampFactor(128, 0, 0.35, 0.75, 1.25), /averageLuminance/);

  const khaki = computeRampColor(180, 128, { r: 0xc3, g: 0xb0, b: 0x91 }, 0.35, 0.75, 1.25);
  assert.ok(khaki.r > 0xc3, '亮部应比基准卡其更亮');
  assert.ok(khaki.g > 0xb0);
  assert.ok(khaki.b > 0x91);
  const wood = computeRampColor(60, 128, { r: 0x5e, g: 0x4a, b: 0x36 }, 0.25, 0.75, 1.25);
  assert.ok(wood.r < 0x5e, '暗部应比基准木色更暗');
  assert.ok(wood.g < 0x4a);
  assert.ok(wood.b < 0x36);
});

test('玩家出生点在竞技场内、障碍物外，中心区域保持通畅', () => {
  const layout = createLayout();
  const colliders = createColliders(layout);
  const spawn = getPlayerSpawn(layout);

  assert.equal(spawn.y, 0);
  assert.ok(isPointInsideArena(spawn, layout, 0.5), '玩家出生点必须在竞技场内');
  for (const collider of colliders) {
    assert.equal(
      isPointInsideCollider(spawn, collider, 0),
      false,
      '玩家出生点不能落在障碍物内'
    );
  }

  // 中心 5 米安全区内的地面碰撞体应为空。
  for (const collider of colliders) {
    const min = /** @type {{x: number, y: number, z: number}} */ (collider.min);
    if (min.y > 0) {
      continue;
    }
    const center = { x: 0, y: 0, z: 0 };
    if (!isPointInsideCollider(center, collider, 5)) {
      continue;
    }
    assert.fail('中心 5 米安全区内不应有地面障碍物');
  }
});

test('敌人出生点满足 22–28 米、障碍物外、距玩家至少 10 米', () => {
  const layout = createLayout();
  const colliders = createColliders(layout);
  const player = { x: 0, y: 0, z: 0 };
  const random = createRandom(20261017);

  for (let sample = 0; sample < 24; sample += 1) {
    const point = findSpawnPoint({
      playerPosition: player,
      minDistance: 10,
      random
    });
    const radius = Math.hypot(point.x, point.z);
    assert.ok(radius >= 22 - 1e-6, '出生点半径不能小于 22 米');
    assert.ok(radius <= 28 + 1e-6, '出生点半径不能大于 28 米');
    assert.equal(point.y, 0);
    assert.ok(isPointInsideArena(point, layout, 0.5), '出生点必须在竞技场内');
    for (const collider of colliders) {
      assert.equal(
        isPointInsideCollider(point, collider, 0.9),
        false,
        '出生点必须离障碍物至少 0.9 米'
      );
    }
    assert.ok(Math.hypot(point.x - player.x, point.z - player.z) >= 10 - 1e-6);
    assert.equal(
      isSpawnPointValid(point, colliders, player, 10),
      true,
      '出生点必须通过统一校验'
    );
  }
});

test('相同种子的出生点序列可复现', () => {
  const firstRandom = createRandom(4242);
  const secondRandom = createRandom(4242);
  const first = [];
  const second = [];
  for (let index = 0; index < 5; index += 1) {
    first.push(findSpawnPoint({ random: firstRandom }));
    second.push(findSpawnPoint({ random: secondRandom }));
  }
  assert.deepEqual(first, second);
});

test('出生点校验拒绝环带内、障碍内和距玩家过近的点', () => {
  const layout = createLayout();
  const colliders = createColliders(layout);
  const player = { x: 0, y: 0, z: 0 };

  assert.equal(
    isSpawnPointValid({ x: 0, y: 0, z: 0 }, colliders, player, 10),
    false,
    '中心点不在 22–28 米环带内'
  );
  assert.equal(
    isSpawnPointValid({ x: 18, y: 0, z: -17 }, colliders, player, 10),
    false,
    '集装箱内部不能作为出生点'
  );
  assert.equal(
    isSpawnPointValid(
      { x: 28, y: 0, z: 0 },
      colliders,
      { x: 27, y: 0, z: 0 },
      10
    ),
    false,
    '距玩家不足 minDistance 时不能出生'
  );
  assert.equal(
    isSpawnPointValid({ x: 28, y: 0, z: 0 }, colliders, player, 10),
    true,
    '空闲环带点应通过校验'
  );
});

test('无法找到出生点时抛出带约束说明的错误', () => {
  const blockingCollider = {
    min: { x: -31, y: 0, z: -31 },
    max: { x: 31, y: 10, z: 31 }
  };
  assert.throws(
    () =>
      findSpawnPoint({
        colliders: [blockingCollider],
        playerPosition: { x: 0, y: 0, z: 0 },
        minDistance: 10,
        attempts: 4,
        random: createRandom(7)
      }),
    /无法在竞技场 22–28 米环带找到合法出生点/
  );
});

test('效果池上限、淡出曲线与复用策略正确', () => {
  assert.deepEqual(EFFECT_POOL_LIMITS, {
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

  assert.equal(computeFade(0, 1, 0.2), 1);
  assert.equal(computeFade(0.2, 1, 0.2), 1);
  assert.equal(computeFade(1, 1, 0.2), 0);
  const mid = computeFade(0.6, 1, 0.2);
  assert.ok(mid > 0 && mid < 1);
  assert.throws(() => computeFade(-1, 1, 0.2), /age/);
  assert.throws(() => computeFade(0, 0, 0.2), /life/);

  const entries = [
    { active: true, age: 0.1 },
    { active: false, age: 0.2 },
    { active: true, age: 0.4 }
  ];
  assert.equal(pickReuseIndex(entries), 1, '优先复用未激活条目');

  const allActive = [
    { active: true, age: 0.1 },
    { active: true, age: 0.5 },
    { active: true, age: 0.3 }
  ];
  assert.equal(pickReuseIndex(allActive), 1, '池满时复用年龄最大的条目');
  assert.equal(pickReuseIndex([]), -1);
});

test('效果服务创建有上限的对象池，复用不新增对象，释放后移除全部对象', () => {
  const added = [];
  const removed = [];
  const fakeRenderer = {
    add(object) {
      added.push(object);
    },
    remove(object) {
      removed.push(object);
    }
  };

  const effects = createEffectsService({ renderer: fakeRenderer });
  let totalPoolSize = 0;
  for (const limit of Object.values(EFFECT_POOL_LIMITS)) {
    totalPoolSize += limit;
  }
  assert.equal(added.length, totalPoolSize);

  for (let index = 0; index < 40; index += 1) {
    effects.tracer({ x: 0, y: 1, z: 0 }, { x: index, y: 1, z: index });
    effects.impact(
      { x: index, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      0xffd0a0
    );
    effects.explosion({ x: index, y: 0.5, z: 0 }, 0xd9a05b, 1.2);
    effects.spawn({ x: index, y: 0, z: 0 }, 0xffd9a0);
    effects.blood(
      { x: index, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      0x7a1717
    );
    effects.muzzleSmoke({ x: index, y: 1.4, z: 0 }, { x: 0, y: 0, z: -1 });
    effects.shell({ x: index, y: 1.3, z: 0 }, { x: 0.3, y: 1.2, z: 0 });
    effects.enemyShot({ x: 0, y: 1.5, z: 5 }, { x: 0, y: 0, z: -1 }, 0xffcf8a);
    effects.bulletHole({ x: index, y: 1, z: -2 }, { x: 0, y: 0, z: 1 });
  }
  assert.equal(added.length, totalPoolSize, '复用池不应继续创建对象');

  effects.update(0.05);
  effects.update(0.1);
  effects.clear();
  effects.update(0.1);

  effects.dispose();
  assert.equal(removed.length, totalPoolSize);
  assert.throws(
    () => effects.tracer({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }),
    /已释放/
  );
});

test('音频映射覆盖全部声音，音量和时长保持在低强度范围', () => {
  assert.equal(SOUND_NAMES.length, 16);
  for (const name of SOUND_NAMES) {
    const plan = getSoundPlan(name);
    assert.ok(Array.isArray(plan) && plan.length > 0, name + ' 必须有播放步骤');
    for (const step of plan) {
      assert.ok(step.kind === 'tone' || step.kind === 'noise');
      const options = step.options;
      assert.ok(options.gain > 0, name + ' 的 gain 必须大于 0');
      assert.ok(options.gain <= 0.5, name + ' 的 gain 必须保持低音量');
      assert.ok(options.duration > 0, name + ' 的 duration 必须大于 0');
      assert.ok(options.duration <= 1.2, name + ' 的 duration 必须短');
    }
  }

  const shootKinds = getSoundPlan('shoot').map((step) => step.kind);
  assert.ok(shootKinds.includes('noise'));
  assert.ok(shootKinds.includes('tone'));
  const shootSteps = getSoundPlan('shoot');
  assert.equal(shootSteps.length, 3, '枪声必须是爆裂 + 枪身 + 尾音三层');

  const reloadAttacks = getSoundPlan('reload').map((step) => step.options.attack);
  assert.ok(reloadAttacks.length >= 2);
  for (let index = 1; index < reloadAttacks.length; index += 1) {
    assert.ok(
      reloadAttacks[index] > reloadAttacks[index - 1],
      '换弹的机械声必须依次推迟'
    );
  }

  assert.throws(() => getSoundPlan('laser'), /未知声音名称/);
  assert.throws(() => getSoundPlan(''), /非空声音名称/);

  const copy = getSoundPlan('hit');
  copy[0].options.gain = 999;
  assert.notEqual(getSoundPlan('hit')[0].options.gain, 999, '每次返回独立副本');
});

test('敌人枪声随距离衰减、降低截止频率，并按兵种调整', () => {
  assert.equal(computeEnemyShotAttenuation(0), 1);
  const near = computeEnemyShotAttenuation(5);
  const far = computeEnemyShotAttenuation(30);
  assert.ok(near > far, '远处必须更轻');
  assert.ok(far >= 0.08, '衰减必须保留下限');
  assert.throws(() => computeEnemyShotAttenuation(-1), /distance/);
  assert.throws(() => computeEnemyShotAttenuation(Number.NaN), /distance/);

  const nearPlan = getEnemyShotPlan(2, 'rifleman');
  const farPlan = getEnemyShotPlan(40, 'rifleman');
  assert.ok(nearPlan[0].options.gain > farPlan[0].options.gain);
  assert.ok(nearPlan[0].options.frequency > farPlan[0].options.frequency);

  const heavyPlan = getEnemyShotPlan(10, 'heavy');
  const riflePlan = getEnemyShotPlan(10, 'rifleman');
  assert.ok(heavyPlan[0].options.gain > riflePlan[0].options.gain);
});

test('音频服务调用引擎、保存音量与静音状态，且不关闭共享引擎', () => {
  const calls = [];
  const engine = {
    init: async () => {
      calls.push({ kind: 'init' });
      return 'running';
    },
    tone: (options) => {
      calls.push({ kind: 'tone', options });
    },
    noise: (options) => {
      calls.push({ kind: 'noise', options });
    },
    setMuted: (muted) => {
      calls.push({ kind: 'setMuted', muted });
    },
    setMasterVolume: (volume) => {
      calls.push({ kind: 'setMasterVolume', volume });
    },
    dispose: () => {
      calls.push({ kind: 'engine-dispose' });
    }
  };

  const audio = createAudioService({ engine });
  assert.equal(audio.getMasterVolume(), 0.7);
  calls.length = 0;
  audio.shoot();
  assert.ok(calls.some((call) => call.kind === 'noise'));
  assert.ok(calls.some((call) => call.kind === 'tone'));

  calls.length = 0;
  audio.enemyShot(24, 'heavy');
  assert.ok(calls.some((call) => call.kind === 'noise'));
  assert.ok(calls.some((call) => call.kind === 'tone'));

  calls.length = 0;
  audio.headshot();
  audio.shellDrop();
  assert.ok(calls.length >= 2);

  audio.setMasterVolume(0.4);
  assert.equal(audio.getMasterVolume(), 0.4);
  assert.ok(
    calls.some(
      (call) => call.kind === 'setMasterVolume' && call.volume === 0.4
    )
  );

  audio.setMuted(true);
  assert.equal(audio.isMuted(), true);
  assert.ok(calls.some((call) => call.kind === 'setMuted' && call.muted === true));

  audio.startAmbience();
  audio.startAmbience();
  audio.stopAmbience();
  audio.stopAmbience();

  audio.dispose();
  const engineDisposed = calls.some((call) => call.kind === 'engine-dispose');
  assert.equal(engineDisposed, false, '音频服务不拥有共享引擎');
  assert.throws(() => audio.shoot(), /已释放/);
});

test('公共入口 createArena 可构造、加载幂等、释放后拒绝再次加载', async () => {
  const added = [];
  const removed = [];
  const environments = [];
  const fakeRenderer = {
    add(object) {
      added.push(object);
    },
    remove(object) {
      removed.push(object);
    },
    setEnvironment(options) {
      environments.push(options);
    }
  };
  const fakeAssets = {
    loadManifest: async () => ({ textures: {}, hdri: {} }),
    loadTexture: async () => {
      throw new Error('测试替身不应加载贴图');
    },
    loadHdr: async () => {
      throw new Error('测试替身不应加载 HDR');
    }
  };

  const arena = createArena({ renderer: fakeRenderer, assets: fakeAssets });
  assert.equal(typeof arena.load, 'function');
  assert.equal(typeof arena.getColliders, 'function');
  assert.equal(typeof arena.getSpawnPoint, 'function');
  assert.equal(typeof arena.getPlayerSpawn, 'function');
  assert.equal(typeof arena.getDecals, 'function');
  assert.equal(typeof arena.update, 'function');
  assert.equal(typeof arena.dispose, 'function');
  assert.equal(arena.getDecals(), null, 'load 前没有贴片系统');

  const colliders = arena.getColliders();
  assert.ok(colliders.length > 0);
  const playerSpawn = arena.getPlayerSpawn();
  assert.deepEqual(playerSpawn, { x: 0, y: 0, z: 0 });
  const spawn = arena.getSpawnPoint({ playerPosition: playerSpawn, minDistance: 10 });
  assert.ok(Math.hypot(spawn.x, spawn.z) >= 22);
  assert.ok(Math.hypot(spawn.x, spawn.z) <= 28);

  const originalError = console.error;
  const originalWarn = console.warn;
  const messages = [];
  console.error = (...args) => {
    messages.push(args.map(String).join(' '));
  };
  console.warn = (...args) => {
    messages.push(args.map(String).join(' '));
  };
  try {
    const firstPromise = arena.load();
    const secondPromise = arena.load();
    assert.equal(firstPromise, secondPromise, '并发 load() 必须返回同一个 Promise');
    const summary = await firstPromise;
    assert.equal(arena.load(), firstPromise, '成功后重复 load() 返回同一结果');
    assert.equal(summary.colliders.length, colliders.length);
    assert.deepEqual(summary.playerSpawn, playerSpawn);
    assert.ok(summary.fallbacks.length > 0, '缺少素材时应记录程序化回退');
    assert.ok(added.length >= 1, '场景根节点应加入渲染器');
    assert.ok(environments.length >= 1, '应设置环境与雾');
    const decals = arena.getDecals();
    assert.ok(decals !== null, 'load 后应提供贴片系统');
    assert.equal(typeof decals.addBulletHole, 'function');
    assert.equal(typeof decals.addBlood, 'function');
    assert.equal(typeof decals.addStain, 'function');

    arena.update(0.016);
    arena.dispose();
    assert.ok(removed.length >= 1, '释放时应移除场景根节点');
    assert.throws(() => arena.load(), /已释放/);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert.ok(messages.length > 0, '回退路径必须输出可追踪的日志');
  const obstructionMessages = messages.filter((message) =>
    message.includes('出生点视野被场景物体遮挡')
  );
  assert.equal(
    obstructionMessages.length,
    0,
    '出生点视野不能被场景道具/障碍遮挡'
  );
});
