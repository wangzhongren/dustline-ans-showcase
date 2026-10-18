/**
 * 战斗服务：玩家状态、移动、生命与相机姿态。
 *
 * 本文件只做纯逻辑：移动、跳跃、重力、冲刺、视角、生命与恢复。
 * 第一人称武器视图已拆分到同目录的 `view-model.js`，因此这里不导入 Three.js，
 * 可以在 Node 中直接测试。
 */

import { GAME_CONFIG } from '../../../models/game-config.js';
import { createPlayerSnapshot, normalizeAngle } from '../../../models/contracts.js';
import { clamp, moveCircle } from './collision.js';

/** 默认鼠标视角灵敏度（弧度/像素），最终值再乘以设置中的鼠标灵敏度倍率。 */
const LOOK_SENSITIVITY = GAME_CONFIG.weapon.lookSensitivity;

/** 俯仰角上限（弧度），与渲染 Provider 的限制一致。 */
const PITCH_LIMIT = 1.55;

/** 默认出生点：竞技场中心偏南 8 米，面朝场地中央（-Z）。 */
const DEFAULT_SPAWN = Object.freeze({ x: 0, y: 0, z: 8 });

/** 竞技场边界，来自共享配置。 */
const ARENA_BOUNDS = Object.freeze({
  halfWidth: GAME_CONFIG.arena.halfWidth,
  halfDepth: GAME_CONFIG.arena.halfDepth
});

const PLAYER_CONFIG = GAME_CONFIG.player;

/**
 * 判断一个值是否是有限数字。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 读取可选的有限数字；缺失时返回默认值，非法值抛错。
 *
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function readFiniteField(source, key, fallback) {
  if (source[key] === undefined) {
    return fallback;
  }
  if (!isFiniteNumber(source[key])) {
    throw new TypeError('相机后坐力字段 ' + key + ' 必须是有限数字');
  }
  return /** @type {number} */ (source[key]);
}

/**
 * 读取出生点；未注入时使用默认位置。
 *
 * @param {{ x?: number, y?: number, z?: number } | undefined} spawn
 * @returns {{ x: number, y: number, z: number }}
 */
export function readSpawn(spawn) {
  if (spawn === undefined || spawn === null) {
    return { x: DEFAULT_SPAWN.x, y: DEFAULT_SPAWN.y, z: DEFAULT_SPAWN.z };
  }
  if (typeof spawn !== 'object') {
    throw new TypeError('spawn 必须是 { x, y, z } 对象');
  }
  let x = DEFAULT_SPAWN.x;
  let y = DEFAULT_SPAWN.y;
  let z = DEFAULT_SPAWN.z;
  if (spawn.x !== undefined) {
    x = spawn.x;
  }
  if (spawn.y !== undefined) {
    y = spawn.y;
  }
  if (spawn.z !== undefined) {
    z = spawn.z;
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    throw new TypeError('spawn 的 x/y/z 必须是有限数字');
  }
  return { x, y, z };
}

/**
 * 创建玩家状态。
 *
 * @param {{ x?: number, y?: number, z?: number }} [spawn]
 * @returns {{
 *   x: number, y: number, z: number,
 *   velocityX: number, velocityY: number, velocityZ: number,
 *   yaw: number, pitch: number,
 *   health: number, maxHealth: number, alive: boolean,
 *   grounded: boolean, regenTimer: number,
 *   eyeHeight: number, radius: number
 * }}
 */
export function createPlayerState(spawn) {
  const state = {
    x: DEFAULT_SPAWN.x,
    y: DEFAULT_SPAWN.y,
    z: DEFAULT_SPAWN.z,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    yaw: 0,
    pitch: 0,
    health: PLAYER_CONFIG.health,
    maxHealth: PLAYER_CONFIG.maxHealth,
    alive: true,
    grounded: true,
    regenTimer: 0,
    eyeHeight: PLAYER_CONFIG.eyeHeight,
    radius: PLAYER_CONFIG.radius
  };
  resetPlayerState(state, spawn);
  return state;
}

/**
 * 把玩家状态恢复到出生点、满生命、静止、无视角偏移。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {{ x?: number, y?: number, z?: number }} [spawn]
 * @returns {ReturnType<typeof createPlayerState>}
 */
export function resetPlayerState(state, spawn) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('resetPlayerState 需要玩家状态对象');
  }
  const point = readSpawn(spawn);
  state.x = point.x;
  state.y = point.y;
  state.z = point.z;
  state.velocityX = 0;
  state.velocityY = 0;
  state.velocityZ = 0;
  state.yaw = 0;
  state.pitch = 0;
  state.health = PLAYER_CONFIG.maxHealth;
  state.maxHealth = PLAYER_CONFIG.maxHealth;
  state.alive = true;
  state.grounded = true;
  state.regenTimer = 0;
  state.eyeHeight = PLAYER_CONFIG.eyeHeight;
  state.radius = PLAYER_CONFIG.radius;
  return state;
}

/**
 * 根据设置与瞄准状态计算本帧鼠标灵敏度（弧度/像素）。
 *
 * 公式：基础灵敏度 × 鼠标灵敏度 ×（ADS 时再乘 ADS 灵敏度倍率）。
 * 设置缺失时使用 Model 的默认值。
 *
 * @param {{ mouseSensitivity?: number, adsSensitivityMultiplier?: number } | undefined} settings
 * @param {boolean} aiming
 * @returns {number}
 */
export function getLookSensitivity(settings, aiming) {
  let mouseSensitivity = GAME_CONFIG.settings.defaults.mouseSensitivity;
  let adsMultiplier = GAME_CONFIG.settings.defaults.adsSensitivityMultiplier;
  if (settings !== undefined && settings !== null) {
    if (isFiniteNumber(settings.mouseSensitivity)) {
      mouseSensitivity = settings.mouseSensitivity;
    }
    if (isFiniteNumber(settings.adsSensitivityMultiplier)) {
      adsMultiplier = settings.adsSensitivityMultiplier;
    }
  }
  let sensitivity = LOOK_SENSITIVITY * mouseSensitivity;
  if (aiming === true) {
    sensitivity *= adsMultiplier;
  }
  return sensitivity;
}

/**
 * 应用鼠标视角增量。水平旋转不设限并规范到 [-π, π]，俯仰限制在 ±1.55。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number} lookDeltaX 水平像素增量。
 * @param {number} lookDeltaY 垂直像素增量。
 * @param {number} [sensitivity] 弧度/像素；省略时使用基础灵敏度。
 * @returns {void}
 */
export function applyLook(state, lookDeltaX, lookDeltaY, sensitivity) {
  if (!isFiniteNumber(lookDeltaX) || !isFiniteNumber(lookDeltaY)) {
    throw new TypeError('视角增量必须是有限数字');
  }
  let value = LOOK_SENSITIVITY;
  if (sensitivity !== undefined) {
    if (!isFiniteNumber(sensitivity) || sensitivity < 0) {
      throw new RangeError('lookSensitivity 必须是大于等于 0 的有限数字');
    }
    value = sensitivity;
  }
  state.yaw = normalizeAngle(state.yaw - lookDeltaX * value);
  state.pitch = clamp(
    state.pitch - lookDeltaY * value,
    -PITCH_LIMIT,
    PITCH_LIMIT
  );
}

/**
 * 推进玩家移动、跳跃、重力与生命恢复。
 *
 * 返回 `{ moving }` 供武器散布判断“是否移动中”。被墙挡住时对应轴速度清零，
 * 另一轴仍可移动，形成贴墙滑动。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number} deltaSeconds
 * @param {import('../../../models/contracts.js').InputCommand} input
 * @param {ReadonlyArray<import('../../abstract/combat.js').Collider>} colliders
 * @param {boolean} aiming 是否正在右键瞄准。
 * @param {{ mouseSensitivity?: number, adsSensitivityMultiplier?: number }} [settings]
 * @returns {{ moving: boolean }}
 */
export function updatePlayer(state, deltaSeconds, input, colliders, aiming, settings) {
  if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('updatePlayer 的 deltaSeconds 必须是大于等于 0 的有限数字');
  }

  const sensitivity = getLookSensitivity(settings, aiming === true);
  applyLook(state, input.lookDeltaX, input.lookDeltaY, sensitivity);

  if (input.jump === true && state.grounded && state.y <= 0) {
    state.velocityY = PLAYER_CONFIG.jumpVelocity;
    state.grounded = false;
  }

  const moveForward = input.moveForward;
  const moveRight = input.moveRight;
  const axisLength = Math.hypot(moveForward, moveRight);
  let desiredX = 0;
  let desiredZ = 0;

  if (axisLength > 0) {
    const forwardX = -Math.sin(state.yaw);
    const forwardZ = -Math.cos(state.yaw);
    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);
    const inverseLength = 1 / axisLength;

    let speed = PLAYER_CONFIG.speed;
    if (input.sprint === true) {
      speed *= PLAYER_CONFIG.sprintMultiplier;
    }
    if (aiming === true) {
      speed *= GAME_CONFIG.weapon.ads.moveSpeedMultiplier;
    }

    desiredX =
      (forwardX * moveForward + rightX * moveRight) * inverseLength * speed;
    desiredZ =
      (forwardZ * moveForward + rightZ * moveRight) * inverseLength * speed;
  }

  state.velocityX = desiredX;
  state.velocityZ = desiredZ;

  const startX = state.x;
  const startZ = state.z;
  const moved = moveCircle(
    state.x,
    state.z,
    state.velocityX * deltaSeconds,
    state.velocityZ * deltaSeconds,
    state.radius,
    colliders,
    ARENA_BOUNDS,
    state.y,
    state.y + state.eyeHeight
  );
  state.x = moved.x;
  state.z = moved.z;
  if (moved.blockedX) {
    state.velocityX = 0;
  }
  if (moved.blockedZ) {
    state.velocityZ = 0;
  }

  state.velocityY -= PLAYER_CONFIG.gravity * deltaSeconds;
  state.y += state.velocityY * deltaSeconds;
  if (state.y < 0) {
    state.y = 0;
    state.velocityY = 0;
    state.grounded = true;
  } else if (state.y === 0 && state.velocityY <= 0) {
    state.velocityY = 0;
    state.grounded = true;
  } else {
    state.grounded = false;
  }

  updatePlayerRegen(state, deltaSeconds);

  const distance = Math.hypot(state.x - startX, state.z - startZ);
  return { moving: distance > 0.0001 };
}

/**
 * 生命恢复：受伤后 5 秒内不恢复，之后以 8/秒恢复到上限。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number} deltaSeconds
 * @returns {number} 本帧恢复的生命值。
 */
export function updatePlayerRegen(state, deltaSeconds) {
  if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('updatePlayerRegen 的 deltaSeconds 必须是大于等于 0 的有限数字');
  }
  if (!state.alive || state.health >= state.maxHealth) {
    return 0;
  }
  if (state.regenTimer > 0) {
    state.regenTimer = Math.max(0, state.regenTimer - deltaSeconds);
    return 0;
  }
  const amount = Math.min(
    state.maxHealth - state.health,
    PLAYER_CONFIG.regenRate * deltaSeconds
  );
  state.health += amount;
  return amount;
}

/**
 * 对玩家造成伤害。受伤会重置 5 秒恢复延迟；生命归零时标记死亡。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number} amount 伤害值，必须大于 0。
 * @returns {{ applied: number, died: boolean }}
 */
export function damagePlayerState(state, amount) {
  if (!isFiniteNumber(amount) || amount <= 0) {
    throw new RangeError('damagePlayer 的伤害必须是大于 0 的有限数字');
  }
  if (!state.alive) {
    return { applied: 0, died: false };
  }
  const applied = Math.min(state.health, amount);
  state.health = Math.max(0, state.health - amount);
  state.regenTimer = PLAYER_CONFIG.regenDelay;
  if (state.health <= 0) {
    state.health = 0;
    state.alive = false;
    return { applied, died: true };
  }
  return { applied, died: false };
}

/**
 * 恢复生命，不超过上限。已死亡时忽略。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number} amount 恢复值，必须大于 0。
 * @returns {number} 实际恢复的生命值。
 */
export function healPlayerState(state, amount) {
  if (!isFiniteNumber(amount) || amount <= 0) {
    throw new RangeError('heal 的恢复量必须是大于 0 的有限数字');
  }
  if (!state.alive) {
    return 0;
  }
  const applied = Math.min(state.maxHealth - state.health, amount);
  state.health += applied;
  return applied;
}

/**
 * 生成 Model 约定的玩家只读快照（脚底坐标，y=0 为地面）。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @returns {import('../../../models/contracts.js').PlayerSnapshot}
 */
export function getPlayerSnapshot(state) {
  return createPlayerSnapshot({
    x: state.x,
    y: state.y,
    z: state.z,
    eyeHeight: state.eyeHeight,
    yaw: state.yaw,
    pitch: state.pitch,
    velocityX: state.velocityX,
    velocityZ: state.velocityZ,
    health: state.health,
    maxHealth: state.maxHealth,
    alive: state.alive
  });
}

/**
 * 只读相机后坐力状态。
 *
 * @typedef {Object} CameraRecoil
 * @property {number} [pitch] 俯仰抬升（弧度）。
 * @property {number} [yaw] 水平漂移（弧度）。
 * @property {number} [roll] 镜头滚转（弧度）。
 * @property {number} [shakeX] 镜头震动 X 偏移（米）。
 * @property {number} [shakeY] 镜头震动 Y 偏移（米）。
 * @property {number} [fovPunch] 每发 FOV 冲击（度）。
 */

/**
 * 计算相机姿态。
 *
 * 基础视野来自设置（`settings.fov`），瞄准时乘以配置的 ADS 视野倍率；
 * 后坐力叠加到俯仰/水平朝向/滚转上，镜头震动叠加到位置，FOV 冲击叠加到视野。
 * 第二个参数既可以是数字（旧的单轴俯仰值），也可以是完整的后坐力对象。
 *
 * @param {ReturnType<typeof createPlayerState>} state
 * @param {number | CameraRecoil} recoilPitch 后坐力俯仰或完整后坐力对象。
 * @param {boolean} aiming 是否正在瞄准。
 * @param {{ fov?: number } | undefined} [settings]
 * @returns {import('../../../models/contracts.js').RendererPose}
 */
export function getCameraPose(state, recoilPitch, aiming, settings) {
  let pitchKick = 0;
  let yawKick = 0;
  let roll = 0;
  let shakeX = 0;
  let shakeY = 0;
  let fovPunch = 0;

  if (recoilPitch !== null && typeof recoilPitch === 'object') {
    const source = /** @type {Record<string, unknown>} */ (recoilPitch);
    pitchKick = readFiniteField(source, 'pitch', 0);
    yawKick = readFiniteField(source, 'yaw', 0);
    roll = readFiniteField(source, 'roll', 0);
    shakeX = readFiniteField(source, 'shakeX', 0);
    shakeY = readFiniteField(source, 'shakeY', 0);
    fovPunch = readFiniteField(source, 'fovPunch', 0);
  } else {
    if (!isFiniteNumber(recoilPitch)) {
      throw new TypeError('recoilPitch 必须是有限数字或后坐力对象');
    }
    pitchKick = recoilPitch;
  }

  let baseFov = GAME_CONFIG.settings.defaults.fov;
  if (
    settings !== undefined &&
    settings !== null &&
    isFiniteNumber(settings.fov) &&
    settings.fov > 0
  ) {
    baseFov = settings.fov;
  }

  let fov = baseFov;
  if (aiming === true) {
    fov *= GAME_CONFIG.weapon.ads.fovMultiplier;
  }
  fov += fovPunch;

  return {
    position: {
      x: state.x + shakeX,
      y: state.y + state.eyeHeight + shakeY,
      z: state.z
    },
    yaw: normalizeAngle(state.yaw + yawKick),
    pitch: clamp(state.pitch + pitchKick, -PITCH_LIMIT, PITCH_LIMIT),
    roll,
    fov
  };
}
