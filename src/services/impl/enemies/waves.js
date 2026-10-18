/**
 * 波次组成、类型选择与数值缩放的纯函数。
 *
 * 本模块不创建 Three.js 对象、不读取随机数以外的外部状态，也不访问渲染器，
 * 因此可以在 Node 中直接测试。波次数量、生成间隔、类型占比与缩放上限全部来自
 * `GAME_CONFIG`，这里不复制任何数值。
 */

import {
  ENEMY_TYPES,
  GAME_CONFIG,
  getEnemyScaling,
  getEnemyTypeShares,
  getWaveEnemyCount
} from '../../../models/game-config.js';

const ENEMY_TYPE_VALUES = Object.freeze(Object.values(ENEMY_TYPES));

/**
 * 校验一个 `[0, 1)` 区间的随机值。
 *
 * @param {number} value
 * @param {string} [label]
 * @returns {number}
 */
function assertRandomValue(value, label) {
  let name = 'randomValue';
  if (typeof label === 'string' && label.length > 0) {
    name = label;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(name + ' 必须是有限数字');
  }
  if (value < 0 || value >= 1) {
    throw new RangeError(name + ' 必须在 [0, 1) 区间内');
  }
  return value;
}

/**
 * 校验敌人类型。
 *
 * @param {string} type
 * @returns {string}
 */
function assertEnemyType(type) {
  if (!ENEMY_TYPE_VALUES.includes(type)) {
    throw new RangeError('未知敌人类型：' + String(type));
  }
  return type;
}

/**
 * 校验波次参数并确认缩放可用。
 *
 * @param {number} wave
 * @returns {number}
 */
function assertWave(wave) {
  if (!Number.isInteger(wave) || wave < GAME_CONFIG.waves.firstWave) {
    throw new TypeError(
      'wave 必须是大于等于 ' + GAME_CONFIG.waves.firstWave + ' 的整数'
    );
  }
  return wave;
}

/**
 * 按第 n 波类型占比，把一个 `[0, 1)` 随机值映射为敌人类型。
 *
 * 第 1 波只有步枪兵；第 2 波步枪兵 0.8 / 重机枪手 0.2；第 3 波起
 * 步枪兵 0.55 / 重机枪手 0.2 / 突击兵 0.25。边界值按“小于”判断，
 * 因此 `0.8` 在第 2 波属于重机枪手。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @param {number} randomValue `[0, 1)` 区间的随机值。
 * @returns {string} `rifleman` / `heavy` / `breacher`
 */
export function pickEnemyType(wave, randomValue) {
  assertWave(wave);
  const value = assertRandomValue(randomValue);
  const shares = getEnemyTypeShares(wave);
  const heavyThreshold = shares.rifleman + shares.heavy;

  if (value < shares.rifleman) {
    return ENEMY_TYPES.RIFLEMAN;
  }
  if (value < heavyThreshold) {
    return ENEMY_TYPES.HEAVY;
  }
  return ENEMY_TYPES.BREACHER;
}

/**
 * 为一个波次生成敌人类型序列。每个敌人都独立抽取一次类型。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @param {() => number} [random] 返回 `[0, 1)` 的随机函数；默认 `Math.random`。
 * @returns {string[]} 敌人类型数组，长度等于 `getWaveEnemyCount(wave)`。
 */
export function composeWave(wave, random) {
  assertWave(wave);
  let randomFn = Math.random;
  if (random !== undefined) {
    if (typeof random !== 'function') {
      throw new TypeError('random 必须是函数');
    }
    randomFn = random;
  }

  const count = getWaveEnemyCount(wave);
  const types = [];
  for (let index = 0; index < count; index += 1) {
    types.push(pickEnemyType(wave, randomFn()));
  }
  return types;
}

/**
 * 生成一个波次的完整计划：类型序列、总数、生成间隔与缩放。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @param {() => number} [random] 返回 `[0, 1)` 的随机函数。
 * @returns {Readonly<{
 *   wave: number,
 *   count: number,
 *   types: string[],
 *   spawnInterval: number,
 *   scaling: Readonly<{ wave:number, healthMultiplier:number, speedMultiplier:number, damageMultiplier:number }>
 * }>}
 */
export function createWavePlan(wave, random) {
  const types = composeWave(wave, random);
  return Object.freeze({
    wave,
    count: types.length,
    types,
    spawnInterval: GAME_CONFIG.waves.spawnInterval,
    scaling: getEnemyScaling(wave)
  });
}

/**
 * 把一个敌人类型的基础数值按波次缩放，返回生成敌人所需的数据。
 *
 * 生命、速度、伤害分别乘以 `getEnemyScaling(wave)` 的乘数（已含上限）；
 * 突击兵的伤害取 `contactDamage`。分值不随波次缩放。
 *
 * @param {string} type 敌人类型。
 * @param {number} wave 从 1 开始的波次编号。
 * @returns {Readonly<{
 *   type: string,
 *   health: number,
 *   speed: number,
 *   damage: number,
 *   score: number,
 *   color: number,
 *   scaling: Readonly<{ wave:number, healthMultiplier:number, speedMultiplier:number, damageMultiplier:number }>
 * }>}
 */
export function createEnemyStats(type, wave) {
  assertEnemyType(type);
  assertWave(wave);

  const base = GAME_CONFIG.enemies[type];
  const scaling = getEnemyScaling(wave);
  let baseDamage = base.damage;
  if (type === ENEMY_TYPES.BREACHER) {
    baseDamage = base.contactDamage;
  }

  return Object.freeze({
    type,
    health: base.health * scaling.healthMultiplier,
    speed: base.speed * scaling.speedMultiplier,
    damage: baseDamage * scaling.damageMultiplier,
    score: base.score,
    color: base.color,
    scaling
  });
}

/**
 * 判断一次死亡是否掉落生命球。概率取自 `GAME_CONFIG.arena.pickupDropChance`。
 *
 * @param {number} randomValue `[0, 1)` 区间的随机值。
 * @param {number} [chance] 掉落概率；省略时读取共享配置。
 * @returns {boolean}
 */
export function shouldDropPickup(randomValue, chance) {
  const value = assertRandomValue(randomValue);
  let dropChance = GAME_CONFIG.arena.pickupDropChance;
  if (chance !== undefined) {
    if (typeof chance !== 'number' || !Number.isFinite(chance)) {
      throw new TypeError('chance 必须是有限数字');
    }
    if (chance < 0 || chance > 1) {
      throw new RangeError('chance 必须在 [0, 1] 区间内');
    }
    dropChance = chance;
  }
  return value < dropChance;
}
