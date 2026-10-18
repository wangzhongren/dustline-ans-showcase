/**
 * 跨角色共享数据结构、构造函数与校验器。
 *
 * Model 不导入任何运行层（界面、Pipeline、Service、Provider），只依赖同一
 * 目录下的 `events.js` 与 `game-config.js`。所有导出都是纯函数，导入本文件
 * 不会产生副作用，也不会初始化外部资源。
 *
 * 构造函数接受一个可选的部分覆盖对象，返回字段完整的普通对象；
 * 校验器只返回布尔值，不抛错。非法覆盖会抛出 TypeError / RangeError。
 */

import { EVENTS, isGameState } from './events.js';
import { ENEMY_TYPES, GAME_CONFIG, normalizeSettings } from './game-config.js';

/* -------------------------------------------------------------------------- */
/* 类型定义                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} Vec3
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * 一帧输入命令。界面层产生，战斗服务消费后不保存该对象。
 *
 * @typedef {Object} InputCommand
 * @property {-1|0|1} moveForward 前后移动轴；-1 后退，1 前进。
 * @property {-1|0|1} moveRight 左右移动轴；-1 左移，1 右移。
 * @property {boolean} jump 本帧刚按下跳跃。
 * @property {boolean} sprint 是否按住冲刺。
 * @property {boolean} fire 是否按住开火。
 * @property {boolean} aim 是否按住右键瞄准（O1）。
 * @property {boolean} reload 本帧刚按下换弹。
 * @property {number} lookDeltaX 本帧鼠标水平位移（像素）。
 * @property {number} lookDeltaY 本帧鼠标垂直位移（像素）。
 */

/**
 * 玩家只读快照。Pipeline 从战斗服务读取后交给敌方服务。
 *
 * @typedef {Object} PlayerSnapshot
 * @property {number} x 脚底位置 X（米）。
 * @property {number} y 脚底位置 Y（米），0 为地面。
 * @property {number} z 脚底位置 Z（米）。
 * @property {number} eyeHeight 眼睛相对脚底的高度（米）。
 * @property {number} yaw 水平朝向（弧度）。
 * @property {number} pitch 俯仰角（弧度）。
 * @property {number} velocityX 水平速度 X（米/秒）。
 * @property {number} velocityZ 水平速度 Z（米/秒）。
 * @property {number} health 当前生命。
 * @property {number} maxHealth 生命上限。
 * @property {boolean} alive 是否存活。
 */

/**
 * 可被射线检测的目标条目。
 *
 * @typedef {Object} HittableEntry
 * @property {unknown} object 可射线检测的渲染对象。
 * @property {string} targetId 敌方服务内部目标标识。
 */

/**
 * 敌方服务提供给 Pipeline 的命中目标查询契约。
 *
 * @typedef {Object} HitTargetQuery
 * @property {() => HittableEntry[]} listHittable 返回当前可命中目标。
 * @property {(targetId: string, damage: number) => DamageResult} applyDamage
 *   对目标施加伤害，返回命中、击杀、暴击与视觉反馈所需数据。
 */

/**
 * 一次伤害结算结果。
 *
 * `headshot` 表示命中头部；`critical` 是 v2 的旧名称，v3 中两者语义相同，
 * 保留它是为了让尚未更新的调用方仍能读取。
 *
 * @typedef {Object} DamageResult
 * @property {boolean} hit 是否命中。
 * @property {boolean} killed 本次伤害是否造成击杀。
 * @property {boolean} headshot 是否命中头部（爆头）。
 * @property {boolean} critical 是否爆头（兼容旧名称，与 `headshot` 同义）。
 * @property {Vec3} position 命中或死亡位置。
 * @property {number} color 效果颜色（0xRRGGBB）。
 * @property {number} score 击杀得分；未击杀为 0。
 * @property {string} enemyType 敌人类型（rifleman / heavy / breacher）。
 */

/**
 * 玩家可在设置面板中调整的选项。
 *
 * @typedef {Object} Settings
 * @property {number} mouseSensitivity 鼠标灵敏度倍率，0.25–3.0。
 * @property {number} adsSensitivityMultiplier ADS 时的灵敏度倍率，0.4–1.5。
 * @property {number} fov 垂直视野（度），65–95。
 * @property {number} masterVolume 主音量，0–1。
 * @property {'high'|'low'} quality 画面质量；低画质关闭后处理。
 */

/**
 * Pipeline 运行时性能仪表的只读快照。
 *
 * 这是运行时采样值，不代表验收过的帧率承诺。
 *
 * @typedef {Object} PerformanceSnapshot
 * @property {number} fps 平滑后的近期帧率。
 * @property {number} frameCount 自创建以来 `update()` 的调用次数。
 * @property {number} enemyCount 当前存活敌人数。
 * @property {'high'|'low'} quality 当前生效的画面质量。
 * @property {boolean} postProcessing 当前后处理是否开启。
 */

/**
 * 渲染相机姿态。
 *
 * @typedef {Object} RendererPose
 * @property {Vec3} position 相机位置。
 * @property {number} yaw 水平朝向（弧度）。
 * @property {number} pitch 俯仰角（弧度）。
 * @property {number} fov 垂直视野（度）。
 */

/**
 * `game:state` 事件载荷。
 *
 * @typedef {Object} GameStatePayload
 * @property {'menu'|'playing'|'paused'|'over'} state
 */

/**
 * `hud:update` 事件载荷。
 *
 * @typedef {Object} HudUpdatePayload
 * @property {number} score
 * @property {number} wave
 * @property {number} kills
 * @property {number} health
 * @property {number} maxHealth
 * @property {number} ammo
 * @property {number} magazineSize
 * @property {boolean} reloading
 * @property {number} reloadProgress 0 到 1。
 * @property {number} yaw 水平朝向（弧度），供罗盘显示。
 * @property {boolean} muted
 */

/**
 * `hud:hitmarker` 事件载荷。
 *
 * @typedef {Object} HudHitmarkerPayload
 * @property {boolean} killed 本次命中是否造成击杀。
 * @property {boolean} headshot 本次命中是否爆头。
 */

/**
 * `hud:killfeed` 事件载荷。
 *
 * @typedef {Object} HudKillfeedPayload
 * @property {string} enemyType
 * @property {number} score
 * @property {boolean} headshot 是否爆头击杀。
 * @property {boolean} critical 兼容旧名称，与 `headshot` 同义。
 */

/**
 * `hud:damage` 事件载荷。
 *
 * `direction` 是攻击来源相对玩家朝向的角度（弧度）：
 * 0 表示正前方，正值在右侧，负值在左侧，范围 -π..π。
 *
 * @typedef {Object} HudDamagePayload
 * @property {number} amount
 * @property {number} direction
 */

/**
 * `hud:banner` 事件载荷。
 *
 * @typedef {Object} HudBannerPayload
 * @property {string} title
 * @property {string} subtitle
 * @property {number} durationMs
 */

/**
 * `hud:gameover` 事件载荷。
 *
 * @typedef {Object} HudGameoverPayload
 * @property {number} score
 * @property {number} wave
 * @property {number} kills
 * @property {number} survivedSeconds
 */

/**
 * `world:shot` 事件载荷。
 *
 * @typedef {Object} WorldShotPayload
 * @property {Vec3} from 射线起点。
 * @property {Vec3} to 射线终点。
 * @property {Vec3} muzzlePosition 枪口位置。
 * @property {number} color 弹道颜色。
 */

/**
 * `world:impact` 事件载荷。
 *
 * @typedef {Object} WorldImpactPayload
 * @property {Vec3} position
 * @property {Vec3} normal
 * @property {number} color
 */

/**
 * `world:explosion` 事件载荷。
 *
 * @typedef {Object} WorldExplosionPayload
 * @property {Vec3} position
 * @property {number} color
 * @property {number} scale
 */

/**
 * `world:enemy-spawn` 事件载荷。
 *
 * @typedef {Object} WorldEnemySpawnPayload
 * @property {Vec3} position
 * @property {number} color
 */

/**
 * `world:enemy-shot` 事件载荷。敌方开火时的枪口位置与射击方向。
 *
 * @typedef {Object} WorldEnemyShotPayload
 * @property {Vec3} position 枪口位置。
 * @property {Vec3} direction 射击方向（归一化或不归一化均可，效果只取方向）。
 * @property {number} color 曳光/闪光颜色（0xRRGGBB）。
 * @property {string} enemyType 开火的敌人类型。
 */

/**
 * `world:blood` 事件载荷。命中敌人时在命中点生成的血雾。
 *
 * @typedef {Object} WorldBloodPayload
 * @property {Vec3} position 命中位置。
 * @property {Vec3} direction 血雾喷射方向。
 * @property {number} color 血雾颜色（0xRRGGBB）。
 */

/**
 * `player:damage` 事件载荷。
 *
 * `sourcePosition` 可选：敌方服务能提供攻击来源时填写，Pipeline 据此计算
 * `hud:damage.direction`；没有该字段时 HUD 只显示受伤闪烁。
 *
 * @typedef {Object} PlayerDamagePayload
 * @property {number} amount
 * @property {Vec3} [sourcePosition] 攻击来源的世界位置。
 */

/**
 * `player:died` 事件载荷。当前不需要额外字段。
 *
 * @typedef {Object} PlayerDiedPayload
 */

/**
 * `enemy:killed` 事件载荷。
 *
 * `headshot` 表示爆头击杀；`critical` 是 v2 的旧名称，v3 中两者同义。
 *
 * @typedef {Object} EnemyKilledPayload
 * @property {string} enemyType
 * @property {number} score
 * @property {boolean} headshot
 * @property {boolean} critical 兼容旧名称，与 `headshot` 同义。
 * @property {Vec3} position
 * @property {number} color
 */

/**
 * `wave:start` 与 `wave:cleared` 事件载荷。
 *
 * @typedef {Object} WavePayload
 * @property {number} wave
 */

/**
 * `pickup:spawn` 与 `pickup:collected` 事件载荷。
 *
 * @typedef {Object} PickupPayload
 * @property {Vec3} position
 * @property {number} amount 恢复的生命值。
 */

/**
 * `weapon:reload-start` 事件载荷。
 *
 * @typedef {Object} WeaponReloadStartPayload
 * @property {number} durationSeconds
 */

/**
 * `weapon:shell-eject` 事件载荷。弹壳从抛壳口飞出时的初始状态。
 *
 * @typedef {Object} WeaponShellEjectPayload
 * @property {Vec3} position 抛壳口世界位置。
 * @property {Vec3} velocity 弹壳初始速度（米/秒）。
 */

/**
 * `settings:changed` 事件载荷。始终携带完整的归一化设置。
 *
 * @typedef {Object} SettingsChangedPayload
 * @property {Settings} settings
 */

/* -------------------------------------------------------------------------- */
/* 内部校验工具                                                                */
/* -------------------------------------------------------------------------- */

const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
const UP_VECTOR = Object.freeze({ x: 0, y: 1, z: 0 });
const FORWARD_VECTOR = Object.freeze({ x: 0, y: 0, z: -1 });
const MOVE_AXIS_VALUES = Object.freeze([-1, 0, 1]);

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
 * @returns {boolean}
 */
function isVector3(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return (
    isFiniteNumber(source.x) &&
    isFiniteNumber(source.y) &&
    isFiniteNumber(source.z)
  );
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {Record<string, unknown>}
 */
function assertObject(value, fieldName) {
  if (!isObject(value)) {
    throw new TypeError(fieldName + ' 必须是对象');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
function assertFiniteNumber(value, fieldName) {
  if (!isFiniteNumber(value)) {
    throw new TypeError(fieldName + ' 必须是有限数字');
  }
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {boolean}
 */
function assertBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new TypeError(fieldName + ' 必须是布尔值');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 */
function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(fieldName + ' 必须是非空字符串');
  }
  return value;
}

/**
 * @param {unknown} overrides
 * @returns {Record<string, unknown>}
 */
function normalizeOverrides(overrides) {
  if (overrides === undefined || overrides === null) {
    return {};
  }
  return assertObject(overrides, 'overrides');
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readNumber(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return fallback;
  }
  return assertFiniteNumber(source[key], key);
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readInteger(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return fallback;
  }
  const value = source[key];
  if (!Number.isInteger(value)) {
    throw new TypeError(key + ' 必须是整数');
  }
  return /** @type {number} */ (value);
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveInteger(source, key, fallback) {
  const value = readInteger(source, key, fallback);
  if (value <= 0) {
    throw new RangeError(key + ' 必须是正整数');
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readNonNegativeInteger(source, key, fallback) {
  const value = readInteger(source, key, fallback);
  if (value < 0) {
    throw new RangeError(key + ' 不能小于 0');
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveNumber(source, key, fallback) {
  const value = readNumber(source, key, fallback);
  if (value <= 0) {
    throw new RangeError(key + ' 必须大于 0');
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readNonNegativeNumber(source, key, fallback) {
  const value = readNumber(source, key, fallback);
  if (value < 0) {
    throw new RangeError(key + ' 不能小于 0');
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return fallback;
  }
  return assertBoolean(source[key], key);
}

/**
 * 读取一对同义布尔字段：优先 `primaryKey`，缺失时使用 `aliasKey`。
 * 两者都缺失时返回 `fallback`；任一出现时按布尔值校验。
 *
 * @param {Record<string, unknown>} source
 * @param {string} primaryKey
 * @param {string} aliasKey
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readAliasedBoolean(source, primaryKey, aliasKey, fallback) {
  if (hasOwn(source, primaryKey)) {
    return assertBoolean(source[primaryKey], primaryKey);
  }
  if (hasOwn(source, aliasKey)) {
    return assertBoolean(source[aliasKey], aliasKey);
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function readNonEmptyString(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return fallback;
  }
  return assertNonEmptyString(source[key], key);
}

/**
 * 读取允许空字符串的文本字段。
 *
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function readText(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return fallback;
  }
  const value = source[key];
  if (typeof value !== 'string') {
    throw new TypeError(key + ' 必须是字符串');
  }
  return value;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {-1|0|1}
 */
function readMoveAxis(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return /** @type {-1|0|1} */ (fallback);
  }
  const value = source[key];
  if (!MOVE_AXIS_VALUES.includes(value)) {
    throw new TypeError(key + ' 必须是 -1、0 或 1');
  }
  return /** @type {-1|0|1} */ (value);
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {Readonly<Vec3>} fallback
 * @returns {Vec3}
 */
function readVector3(source, key, fallback) {
  if (!hasOwn(source, key)) {
    return { x: fallback.x, y: fallback.y, z: fallback.z };
  }
  return createVector3(source[key], key);
}

/**
 * 读取可选的向量字段：缺失时返回 `undefined`，存在时按 `createVector3` 校验。
 *
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @returns {Vec3|undefined}
 */
function readOptionalVector3(source, key) {
  if (!hasOwn(source, key)) {
    return undefined;
  }
  return createVector3(source[key], key);
}

/* -------------------------------------------------------------------------- */
/* 基础值对象                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 从 `{ x, y, z }` 创建新的三维向量；缺省分量按 0 处理。
 *
 * @param {unknown} value
 * @param {string} [fieldName]
 * @returns {Vec3}
 */
export function createVector3(value, fieldName) {
  let label = 'vector';
  if (typeof fieldName === 'string' && fieldName.length > 0) {
    label = fieldName;
  }
  const source = assertObject(value, label);
  return {
    x: readNumber(source, 'x', 0),
    y: readNumber(source, 'y', 0),
    z: readNumber(source, 'z', 0)
  };
}

/**
 * 把数字限制在 [min, max] 区间内。
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  assertFiniteNumber(value, 'value');
  assertFiniteNumber(min, 'min');
  assertFiniteNumber(max, 'max');
  if (min > max) {
    throw new RangeError('min 不能大于 max');
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * 把角度规范到 [-π, π] 区间，消除连续旋转产生的累计值。
 *
 * @param {number} angle 弧度。
 * @returns {number}
 */
export function normalizeAngle(angle) {
  assertFiniteNumber(angle, 'angle');
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/* -------------------------------------------------------------------------- */
/* InputCommand                                                                */
/* -------------------------------------------------------------------------- */

const INPUT_COMMAND_DEFAULTS = Object.freeze({
  moveForward: 0,
  moveRight: 0,
  jump: false,
  sprint: false,
  fire: false,
  aim: false,
  reload: false,
  lookDeltaX: 0,
  lookDeltaY: 0
});

/**
 * 创建完整的输入命令；未提供的字段使用“本帧无输入”的默认值。
 *
 * @param {Partial<InputCommand>} [overrides]
 * @returns {InputCommand}
 */
export function createInputCommand(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    moveForward: readMoveAxis(source, 'moveForward', INPUT_COMMAND_DEFAULTS.moveForward),
    moveRight: readMoveAxis(source, 'moveRight', INPUT_COMMAND_DEFAULTS.moveRight),
    jump: readBoolean(source, 'jump', INPUT_COMMAND_DEFAULTS.jump),
    sprint: readBoolean(source, 'sprint', INPUT_COMMAND_DEFAULTS.sprint),
    fire: readBoolean(source, 'fire', INPUT_COMMAND_DEFAULTS.fire),
    aim: readBoolean(source, 'aim', INPUT_COMMAND_DEFAULTS.aim),
    reload: readBoolean(source, 'reload', INPUT_COMMAND_DEFAULTS.reload),
    lookDeltaX: readNumber(source, 'lookDeltaX', INPUT_COMMAND_DEFAULTS.lookDeltaX),
    lookDeltaY: readNumber(source, 'lookDeltaY', INPUT_COMMAND_DEFAULTS.lookDeltaY)
  };
}

/**
 * 判断值是否符合 InputCommand 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isInputCommand(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const moveForwardOk = MOVE_AXIS_VALUES.includes(source.moveForward);
  const moveRightOk = MOVE_AXIS_VALUES.includes(source.moveRight);
  const booleansOk =
    typeof source.jump === 'boolean' &&
    typeof source.sprint === 'boolean' &&
    typeof source.fire === 'boolean' &&
    typeof source.aim === 'boolean' &&
    typeof source.reload === 'boolean';
  const lookOk =
    isFiniteNumber(source.lookDeltaX) &&
    isFiniteNumber(source.lookDeltaY);
  return moveForwardOk && moveRightOk && booleansOk && lookOk;
}

/* -------------------------------------------------------------------------- */
/* PlayerSnapshot                                                              */
/* -------------------------------------------------------------------------- */

const PLAYER_SNAPSHOT_DEFAULTS = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  eyeHeight: GAME_CONFIG.player.eyeHeight,
  yaw: 0,
  pitch: 0,
  velocityX: 0,
  velocityZ: 0,
  health: GAME_CONFIG.player.health,
  maxHealth: GAME_CONFIG.player.maxHealth,
  alive: true
});

/**
 * 创建完整的玩家快照；`alive` 未提供时按 `health > 0` 推导。
 *
 * @param {Partial<PlayerSnapshot>} [overrides]
 * @returns {PlayerSnapshot}
 */
export function createPlayerSnapshot(overrides) {
  const source = normalizeOverrides(overrides);
  const maxHealth = readPositiveNumber(
    source,
    'maxHealth',
    PLAYER_SNAPSHOT_DEFAULTS.maxHealth
  );
  const defaultHealth = Math.min(PLAYER_SNAPSHOT_DEFAULTS.health, maxHealth);
  const health = readNonNegativeNumber(source, 'health', defaultHealth);
  if (health > maxHealth) {
    throw new RangeError('health 不能大于 maxHealth');
  }
  const aliveFallback = health > 0;
  const alive = readBoolean(source, 'alive', aliveFallback);

  return {
    x: readNumber(source, 'x', PLAYER_SNAPSHOT_DEFAULTS.x),
    y: readNumber(source, 'y', PLAYER_SNAPSHOT_DEFAULTS.y),
    z: readNumber(source, 'z', PLAYER_SNAPSHOT_DEFAULTS.z),
    eyeHeight: readPositiveNumber(
      source,
      'eyeHeight',
      PLAYER_SNAPSHOT_DEFAULTS.eyeHeight
    ),
    yaw: readNumber(source, 'yaw', PLAYER_SNAPSHOT_DEFAULTS.yaw),
    pitch: readNumber(source, 'pitch', PLAYER_SNAPSHOT_DEFAULTS.pitch),
    velocityX: readNumber(source, 'velocityX', PLAYER_SNAPSHOT_DEFAULTS.velocityX),
    velocityZ: readNumber(source, 'velocityZ', PLAYER_SNAPSHOT_DEFAULTS.velocityZ),
    health,
    maxHealth,
    alive
  };
}

/**
 * 判断值是否符合 PlayerSnapshot 契约与生命值不变量。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlayerSnapshot(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const numbersOk =
    isFiniteNumber(source.x) &&
    isFiniteNumber(source.y) &&
    isFiniteNumber(source.z) &&
    isFiniteNumber(source.yaw) &&
    isFiniteNumber(source.pitch) &&
    isFiniteNumber(source.velocityX) &&
    isFiniteNumber(source.velocityZ);
  const healthOk =
    isFiniteNumber(source.health) &&
    isFiniteNumber(source.maxHealth) &&
    source.maxHealth > 0 &&
    source.health >= 0 &&
    source.health <= source.maxHealth;
  const eyeHeightOk = isFiniteNumber(source.eyeHeight) && source.eyeHeight > 0;
  return numbersOk && healthOk && eyeHeightOk && typeof source.alive === 'boolean';
}

/* -------------------------------------------------------------------------- */
/* HitTargetQuery / DamageResult                                               */
/* -------------------------------------------------------------------------- */

/**
 * 判断对象是否实现命中目标查询契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHitTargetQuery(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof source.listHittable === 'function' &&
    typeof source.applyDamage === 'function'
  );
}

const DAMAGE_RESULT_DEFAULTS = Object.freeze({
  hit: false,
  killed: false,
  headshot: false,
  critical: false,
  position: ZERO_VECTOR,
  color: 0xffffff,
  score: 0,
  enemyType: ENEMY_TYPES.RIFLEMAN
});

/**
 * 创建完整的伤害结算结果。
 *
 * `headshot` 与 `critical` 互为别名：只提供一个时，另一个取相同值；
 * 两个都提供时各自校验，不强制相等（方便旧调用方过渡）。
 *
 * @param {Partial<DamageResult>} [overrides]
 * @returns {DamageResult}
 */
export function createDamageResult(overrides) {
  const source = normalizeOverrides(overrides);
  const headshot = readAliasedBoolean(
    source,
    'headshot',
    'critical',
    DAMAGE_RESULT_DEFAULTS.headshot
  );
  const critical = readAliasedBoolean(
    source,
    'critical',
    'headshot',
    DAMAGE_RESULT_DEFAULTS.critical
  );
  return {
    hit: readBoolean(source, 'hit', DAMAGE_RESULT_DEFAULTS.hit),
    killed: readBoolean(source, 'killed', DAMAGE_RESULT_DEFAULTS.killed),
    headshot,
    critical,
    position: readVector3(source, 'position', DAMAGE_RESULT_DEFAULTS.position),
    color: readNumber(source, 'color', DAMAGE_RESULT_DEFAULTS.color),
    score: readNonNegativeInteger(source, 'score', DAMAGE_RESULT_DEFAULTS.score),
    enemyType: readNonEmptyString(
      source,
      'enemyType',
      DAMAGE_RESULT_DEFAULTS.enemyType
    )
  };
}

/**
 * 判断值是否符合 DamageResult 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDamageResult(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const booleansOk =
    typeof source.hit === 'boolean' &&
    typeof source.killed === 'boolean' &&
    typeof source.headshot === 'boolean' &&
    typeof source.critical === 'boolean';
  const position = source.position;
  const positionOk =
    isObject(position) &&
    isFiniteNumber(position.x) &&
    isFiniteNumber(position.y) &&
    isFiniteNumber(position.z);
  const scoreOk =
    typeof source.score === 'number' &&
    Number.isInteger(source.score) &&
    source.score >= 0;
  return (
    booleansOk &&
    positionOk &&
    isFiniteNumber(source.color) &&
    scoreOk &&
    typeof source.enemyType === 'string' &&
    source.enemyType.length > 0
  );
}

/* -------------------------------------------------------------------------- */
/* RendererPose                                                                */
/* -------------------------------------------------------------------------- */

const RENDERER_POSE_DEFAULTS = Object.freeze({
  position: ZERO_VECTOR,
  yaw: 0,
  pitch: 0,
  fov: GAME_CONFIG.match.cameraFov
});

/**
 * 创建完整的渲染相机姿态。
 *
 * @param {Partial<RendererPose>} [overrides]
 * @returns {RendererPose}
 */
export function createRendererPose(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', RENDERER_POSE_DEFAULTS.position),
    yaw: readNumber(source, 'yaw', RENDERER_POSE_DEFAULTS.yaw),
    pitch: readNumber(source, 'pitch', RENDERER_POSE_DEFAULTS.pitch),
    fov: readPositiveNumber(source, 'fov', RENDERER_POSE_DEFAULTS.fov)
  };
}

/* -------------------------------------------------------------------------- */
/* 对局与 HUD 载荷                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 创建 `game:state` 载荷；状态必须是 EVENTS.GAME_STATES 中的值。
 *
 * @param {{ state?: 'menu'|'playing'|'paused'|'over' }} [overrides]
 * @returns {GameStatePayload}
 */
export function createGameStatePayload(overrides) {
  const source = normalizeOverrides(overrides);
  const state = readNonEmptyString(
    source,
    'state',
    EVENTS.GAME_STATES.MENU
  );
  if (!isGameState(state)) {
    throw new TypeError('state 必须是 EVENTS.GAME_STATES 中的值');
  }
  return { state: /** @type {'menu'|'playing'|'paused'|'over'} */ (state) };
}

const HUD_UPDATE_DEFAULTS = Object.freeze({
  score: 0,
  wave: GAME_CONFIG.waves.firstWave,
  kills: 0,
  health: GAME_CONFIG.player.health,
  maxHealth: GAME_CONFIG.player.maxHealth,
  ammo: GAME_CONFIG.weapon.magazineSize,
  magazineSize: GAME_CONFIG.weapon.magazineSize,
  reloading: false,
  reloadProgress: 0,
  yaw: 0,
  muted: false
});

/**
 * 创建 `hud:update` 载荷。
 *
 * @param {Partial<HudUpdatePayload>} [overrides]
 * @returns {HudUpdatePayload}
 */
export function createHudUpdatePayload(overrides) {
  const source = normalizeOverrides(overrides);

  const wave = readPositiveInteger(source, 'wave', HUD_UPDATE_DEFAULTS.wave);
  const maxHealth = readPositiveNumber(
    source,
    'maxHealth',
    HUD_UPDATE_DEFAULTS.maxHealth
  );
  const defaultHealth = Math.min(HUD_UPDATE_DEFAULTS.health, maxHealth);
  const health = readNonNegativeNumber(source, 'health', defaultHealth);
  if (health > maxHealth) {
    throw new RangeError('health 不能大于 maxHealth');
  }

  const magazineSize = readPositiveInteger(
    source,
    'magazineSize',
    HUD_UPDATE_DEFAULTS.magazineSize
  );
  const defaultAmmo = Math.min(HUD_UPDATE_DEFAULTS.ammo, magazineSize);
  const ammo = readNonNegativeInteger(source, 'ammo', defaultAmmo);
  if (ammo > magazineSize) {
    throw new RangeError('ammo 不能大于 magazineSize');
  }

  const reloadProgress = readNumber(
    source,
    'reloadProgress',
    HUD_UPDATE_DEFAULTS.reloadProgress
  );
  if (reloadProgress < 0 || reloadProgress > 1) {
    throw new RangeError('reloadProgress 必须在 0 到 1 之间');
  }

  return {
    score: readNonNegativeInteger(source, 'score', HUD_UPDATE_DEFAULTS.score),
    wave,
    kills: readNonNegativeInteger(source, 'kills', HUD_UPDATE_DEFAULTS.kills),
    health,
    maxHealth,
    ammo,
    magazineSize,
    reloading: readBoolean(source, 'reloading', HUD_UPDATE_DEFAULTS.reloading),
    reloadProgress,
    yaw: readNumber(source, 'yaw', HUD_UPDATE_DEFAULTS.yaw),
    muted: readBoolean(source, 'muted', HUD_UPDATE_DEFAULTS.muted)
  };
}

/**
 * 创建 `hud:hitmarker` 载荷。
 *
 * @param {{ killed?: boolean, headshot?: boolean }} [overrides]
 * @returns {HudHitmarkerPayload}
 */
export function createHudHitmarkerPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    killed: readBoolean(source, 'killed', false),
    headshot: readBoolean(source, 'headshot', false)
  };
}

/**
 * 创建 `hud:killfeed` 载荷。`headshot` 与 `critical` 互为别名。
 *
 * @param {Partial<HudKillfeedPayload>} [overrides]
 * @returns {HudKillfeedPayload}
 */
export function createHudKillfeedPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    enemyType: readNonEmptyString(source, 'enemyType', ENEMY_TYPES.RIFLEMAN),
    score: readNonNegativeInteger(source, 'score', 0),
    headshot: readAliasedBoolean(source, 'headshot', 'critical', false),
    critical: readAliasedBoolean(source, 'critical', 'headshot', false)
  };
}

/**
 * 创建 `hud:damage` 载荷。
 *
 * `direction` 缺失时按 0（正前方）处理；提供时规范到 -π..π。
 *
 * @param {{ amount?: number, direction?: number }} [overrides]
 * @returns {HudDamagePayload}
 */
export function createHudDamagePayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    amount: readPositiveNumber(source, 'amount', 1),
    direction: normalizeAngle(readNumber(source, 'direction', 0))
  };
}

/**
 * 创建 `hud:banner` 载荷。
 *
 * @param {Partial<HudBannerPayload>} [overrides]
 * @returns {HudBannerPayload}
 */
export function createHudBannerPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    title: readNonEmptyString(source, 'title', 'DUSTLINE'),
    subtitle: readText(source, 'subtitle', ''),
    durationMs: readPositiveInteger(source, 'durationMs', 2000)
  };
}

/**
 * 创建 `hud:gameover` 载荷。
 *
 * @param {Partial<HudGameoverPayload>} [overrides]
 * @returns {HudGameoverPayload}
 */
export function createHudGameoverPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    score: readNonNegativeInteger(source, 'score', 0),
    wave: readPositiveInteger(source, 'wave', GAME_CONFIG.waves.firstWave),
    kills: readNonNegativeInteger(source, 'kills', 0),
    survivedSeconds: readNonNegativeNumber(source, 'survivedSeconds', 0)
  };
}

/* -------------------------------------------------------------------------- */
/* 世界与战斗事件载荷                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 创建 `world:shot` 载荷。
 *
 * @param {Partial<WorldShotPayload>} [overrides]
 * @returns {WorldShotPayload}
 */
export function createWorldShotPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    from: readVector3(source, 'from', ZERO_VECTOR),
    to: readVector3(source, 'to', ZERO_VECTOR),
    muzzlePosition: readVector3(source, 'muzzlePosition', ZERO_VECTOR),
    color: readNumber(source, 'color', 0xffffff)
  };
}

/**
 * 创建 `world:impact` 载荷。
 *
 * @param {Partial<WorldImpactPayload>} [overrides]
 * @returns {WorldImpactPayload}
 */
export function createWorldImpactPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    normal: readVector3(source, 'normal', UP_VECTOR),
    color: readNumber(source, 'color', 0xffffff)
  };
}

/**
 * 创建 `world:explosion` 载荷。
 *
 * @param {Partial<WorldExplosionPayload>} [overrides]
 * @returns {WorldExplosionPayload}
 */
export function createWorldExplosionPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    color: readNumber(source, 'color', 0xffa040),
    scale: readPositiveNumber(source, 'scale', 1)
  };
}

/**
 * 创建 `world:enemy-spawn` 载荷。
 *
 * @param {Partial<WorldEnemySpawnPayload>} [overrides]
 * @returns {WorldEnemySpawnPayload}
 */
export function createWorldEnemySpawnPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    color: readNumber(source, 'color', GAME_CONFIG.enemies.rifleman.color)
  };
}

/**
 * 创建 `world:enemy-shot` 载荷。
 *
 * @param {Partial<WorldEnemyShotPayload>} [overrides]
 * @returns {WorldEnemyShotPayload}
 */
export function createWorldEnemyShotPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    direction: readVector3(source, 'direction', FORWARD_VECTOR),
    color: readNumber(source, 'color', GAME_CONFIG.enemies.rifleman.color),
    enemyType: readNonEmptyString(
      source,
      'enemyType',
      ENEMY_TYPES.RIFLEMAN
    )
  };
}

/**
 * 判断值是否符合 `world:enemy-shot` 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWorldEnemyShotPayload(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return (
    isVector3(source.position) &&
    isVector3(source.direction) &&
    isFiniteNumber(source.color) &&
    typeof source.enemyType === 'string' &&
    source.enemyType.length > 0
  );
}

/**
 * 创建 `world:blood` 载荷。
 *
 * @param {Partial<WorldBloodPayload>} [overrides]
 * @returns {WorldBloodPayload}
 */
export function createWorldBloodPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    direction: readVector3(source, 'direction', FORWARD_VECTOR),
    color: readNumber(source, 'color', 0x7a1f18)
  };
}

/**
 * 判断值是否符合 `world:blood` 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWorldBloodPayload(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return (
    isVector3(source.position) &&
    isVector3(source.direction) &&
    isFiniteNumber(source.color)
  );
}

/**
 * 创建 `player:damage` 载荷。
 *
 * `sourcePosition` 只在提供时出现；缺失时载荷保持 v2 的 `{ amount }` 形态。
 *
 * @param {Partial<PlayerDamagePayload>} [overrides]
 * @returns {PlayerDamagePayload}
 */
export function createPlayerDamagePayload(overrides) {
  const source = normalizeOverrides(overrides);
  const result = { amount: readPositiveNumber(source, 'amount', 1) };
  const sourcePosition = readOptionalVector3(source, 'sourcePosition');
  if (sourcePosition !== undefined) {
    result.sourcePosition = sourcePosition;
  }
  return result;
}

/**
 * 判断值是否符合 `player:damage` 契约；`sourcePosition` 可选。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlayerDamagePayload(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  if (!isFiniteNumber(source.amount) || source.amount <= 0) {
    return false;
  }
  if (!hasOwn(source, 'sourcePosition')) {
    return true;
  }
  return isVector3(source.sourcePosition);
}

/**
 * 创建 `enemy:killed` 载荷。`headshot` 与 `critical` 互为别名。
 *
 * @param {Partial<EnemyKilledPayload>} [overrides]
 * @returns {EnemyKilledPayload}
 */
export function createEnemyKilledPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    enemyType: readNonEmptyString(source, 'enemyType', ENEMY_TYPES.RIFLEMAN),
    score: readNonNegativeInteger(source, 'score', 0),
    headshot: readAliasedBoolean(source, 'headshot', 'critical', false),
    critical: readAliasedBoolean(source, 'critical', 'headshot', false),
    position: readVector3(source, 'position', ZERO_VECTOR),
    color: readNumber(source, 'color', 0xffffff)
  };
}

/* -------------------------------------------------------------------------- */
/* 波次、拾取与武器载荷                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 创建 `wave:start` 载荷。
 *
 * @param {{ wave?: number }} [overrides]
 * @returns {WavePayload}
 */
export function createWaveStartPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    wave: readPositiveInteger(source, 'wave', GAME_CONFIG.waves.firstWave)
  };
}

/**
 * 创建 `wave:cleared` 载荷。
 *
 * @param {{ wave?: number }} [overrides]
 * @returns {WavePayload}
 */
export function createWaveClearedPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    wave: readPositiveInteger(source, 'wave', GAME_CONFIG.waves.firstWave)
  };
}

/**
 * 创建 `pickup:spawn` 载荷。
 *
 * @param {Partial<PickupPayload>} [overrides]
 * @returns {PickupPayload}
 */
export function createPickupSpawnPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    amount: readPositiveNumber(
      source,
      'amount',
      GAME_CONFIG.arena.pickupHealAmount
    )
  };
}

/**
 * 创建 `pickup:collected` 载荷。
 *
 * @param {Partial<PickupPayload>} [overrides]
 * @returns {PickupPayload}
 */
export function createPickupCollectedPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    amount: readPositiveNumber(
      source,
      'amount',
      GAME_CONFIG.arena.pickupHealAmount
    )
  };
}

/**
 * 创建 `weapon:reload-start` 载荷。
 *
 * @param {{ durationSeconds?: number }} [overrides]
 * @returns {WeaponReloadStartPayload}
 */
export function createWeaponReloadStartPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    durationSeconds: readPositiveNumber(
      source,
      'durationSeconds',
      GAME_CONFIG.weapon.reloadDuration
    )
  };
}

/**
 * 创建 `weapon:shell-eject` 载荷。
 *
 * @param {Partial<WeaponShellEjectPayload>} [overrides]
 * @returns {WeaponShellEjectPayload}
 */
export function createWeaponShellEjectPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return {
    position: readVector3(source, 'position', ZERO_VECTOR),
    velocity: readVector3(source, 'velocity', { x: 1, y: 1, z: 0 })
  };
}

/**
 * 判断值是否符合 `weapon:shell-eject` 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWeaponShellEjectPayload(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  return isVector3(source.position) && isVector3(source.velocity);
}

/* -------------------------------------------------------------------------- */
/* 设置与性能                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 创建完整的设置对象。未提供的字段使用配置默认值，数值夹紧到合法范围。
 *
 * @param {Partial<Settings>} [overrides]
 * @returns {Readonly<Settings>}
 */
export function createSettings(overrides) {
  return normalizeSettings(overrides);
}

/**
 * 判断值是否符合完整 Settings 契约（字段齐全、类型正确、数值在范围内）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSettings(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const ranges = GAME_CONFIG.settings.ranges;

  const sensitivity = source.mouseSensitivity;
  const sensitivityOk =
    isFiniteNumber(sensitivity) &&
    sensitivity >= ranges.mouseSensitivity.min &&
    sensitivity <= ranges.mouseSensitivity.max;

  const adsSensitivity = source.adsSensitivityMultiplier;
  const adsOk =
    isFiniteNumber(adsSensitivity) &&
    adsSensitivity >= ranges.adsSensitivityMultiplier.min &&
    adsSensitivity <= ranges.adsSensitivityMultiplier.max;

  const fov = source.fov;
  const fovOk =
    isFiniteNumber(fov) &&
    fov >= ranges.fov.min &&
    fov <= ranges.fov.max;

  const volume = source.masterVolume;
  const volumeOk =
    isFiniteNumber(volume) &&
    volume >= ranges.masterVolume.min &&
    volume <= ranges.masterVolume.max;

  const qualityOk =
    source.quality === 'high' || source.quality === 'low';

  return sensitivityOk && adsOk && fovOk && volumeOk && qualityOk;
}

/**
 * 创建 `settings:changed` 载荷；载荷中的设置始终是完整、冻结的设置对象。
 *
 * @param {{ settings?: Partial<Settings> }} [overrides]
 * @returns {SettingsChangedPayload}
 */
export function createSettingsChangedPayload(overrides) {
  const source = normalizeOverrides(overrides);
  return { settings: createSettings(source.settings) };
}

/**
 * 判断值是否符合 PerformanceSnapshot 契约。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPerformanceSnapshot(value) {
  if (!isObject(value)) {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  const fpsOk = isFiniteNumber(source.fps) && source.fps >= 0;
  const frameCountOk =
    typeof source.frameCount === 'number' &&
    Number.isInteger(source.frameCount) &&
    source.frameCount >= 0;
  const enemyCountOk =
    typeof source.enemyCount === 'number' &&
    Number.isInteger(source.enemyCount) &&
    source.enemyCount >= 0;
  const qualityOk = source.quality === 'high' || source.quality === 'low';
  return (
    fpsOk &&
    frameCountOk &&
    enemyCountOk &&
    qualityOk &&
    typeof source.postProcessing === 'boolean'
  );
}
