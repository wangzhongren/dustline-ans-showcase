/**
 * 战斗服务：武器状态机。
 *
 * 负责弹药、射击间隔、换弹计时、散布、后坐力、镜头震动、FOV 冲击与命中伤害计算。
 * 这里不创建渲染对象，也不发射射线；命中扫描由公共入口使用本状态机的结果执行。
 *
 * 所有玩法数值来自 `GAME_CONFIG.weapon`（设计 §2.1、§12.3），不在本文件重复写死。
 */

import { GAME_CONFIG } from '../../../models/game-config.js';

const WEAPON_CONFIG = GAME_CONFIG.weapon;
const RECOIL_CONFIG = WEAPON_CONFIG.recoil;
const SHAKE_CONFIG = WEAPON_CONFIG.cameraShake;
const FOV_PUNCH_CONFIG = WEAPON_CONFIG.fovPunch;

/**
 * 水平漂移模式：每隔几发左右轻微摆动，避免连射弹道完全垂直。
 * 数值是实现默认值，范围保持在 ±1。
 */
const RECOIL_YAW_PATTERN = Object.freeze([-1, 0.7, -0.45, 0.9, -0.65]);

/** 小于该值的后坐力直接归零，避免无限逼近。 */
const RECOIL_SNAP_EPSILON = 1e-5;

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
 * 后坐力按指数衰减；足够小时归零，便于测试和状态复位。
 *
 * @param {number} value
 * @returns {number}
 */
function snapRecoil(value) {
  if (Math.abs(value) < RECOIL_SNAP_EPSILON) {
    return 0;
  }
  return value;
}

/**
 * 创建一个满弹匣、未换弹、未瞄准、无后坐力的武器状态。
 *
 * @returns {{
 *   ammo: number,
 *   magazineSize: number,
 *   reloading: boolean,
 *   reloadTimer: number,
 *   fireCooldown: number,
 *   aiming: boolean,
 *   recoilPitch: number,
 *   recoilYaw: number,
 *   recoilRoll: number,
 *   shotIndex: number,
 *   shakeTimer: number,
 *   shakePhase: number,
 *   fovPunch: number,
 *   emptyLatched: boolean
 * }}
 */
export function createWeaponState() {
  return {
    ammo: WEAPON_CONFIG.magazineSize,
    magazineSize: WEAPON_CONFIG.magazineSize,
    reloading: false,
    reloadTimer: 0,
    fireCooldown: 0,
    aiming: false,
    recoilPitch: 0,
    recoilYaw: 0,
    recoilRoll: 0,
    shotIndex: 0,
    shakeTimer: 0,
    shakePhase: 0,
    fovPunch: 0,
    emptyLatched: false
  };
}

/**
 * 把武器状态恢复成刚开局的样子。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @returns {ReturnType<typeof createWeaponState>}
 */
export function resetWeaponState(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('resetWeaponState 需要武器状态对象');
  }
  state.ammo = WEAPON_CONFIG.magazineSize;
  state.magazineSize = WEAPON_CONFIG.magazineSize;
  state.reloading = false;
  state.reloadTimer = 0;
  state.fireCooldown = 0;
  state.aiming = false;
  state.recoilPitch = 0;
  state.recoilYaw = 0;
  state.recoilRoll = 0;
  state.shotIndex = 0;
  state.shakeTimer = 0;
  state.shakePhase = 0;
  state.fovPunch = 0;
  state.emptyLatched = false;
  return state;
}

/**
 * 当前换弹进度（0 到 1）。未换弹时为 0，HUD 据此隐藏换弹条。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @returns {number}
 */
export function getReloadProgress(state) {
  if (!state.reloading) {
    return 0;
  }
  const elapsed = WEAPON_CONFIG.reloadDuration - state.reloadTimer;
  return Math.min(1, Math.max(0, elapsed / WEAPON_CONFIG.reloadDuration));
}

/**
 * 公共入口 `getWeaponState()` 返回的只读视图。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @returns {{ ammo: number, magazineSize: number, reloading: boolean, reloadProgress: number, aiming: boolean }}
 */
export function getWeaponViewState(state) {
  return {
    ammo: state.ammo,
    magazineSize: state.magazineSize,
    reloading: state.reloading,
    reloadProgress: getReloadProgress(state),
    aiming: state.aiming
  };
}

/**
 * 当前散布角（弧度）。
 *
 * 基础腰射散布 + 移动追加；瞄准时整体乘以 ADS 散布系数。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @param {boolean} moving 本帧玩家是否实际移动。
 * @returns {number}
 */
export function getSpread(state, moving) {
  let spread = WEAPON_CONFIG.hipSpread;
  if (moving === true) {
    spread += WEAPON_CONFIG.movingSpreadIncrease;
  }
  if (state.aiming) {
    spread *= WEAPON_CONFIG.ads.spreadMultiplier;
  }
  return spread;
}

/**
 * 单发伤害。命中头部（爆头）时先乘算倍数，且只乘一次。
 *
 * v3 使用 `GAME_CONFIG.enemies.headshotMultiplier`（2）作为爆头倍率，与敌方服务
 * 的头部命中语义共用同一个 Model 值。如果该字段在未来配置中缺失，才退回
 * `weapon.criticalMultiplier` 作为兼容。
 *
 * @param {boolean} headshot 是否命中头部。
 * @returns {number}
 */
export function getShotDamage(headshot) {
  if (headshot === true) {
    let multiplier = GAME_CONFIG.enemies.headshotMultiplier;
    if (!isFiniteNumber(multiplier) || multiplier <= 0) {
      multiplier = WEAPON_CONFIG.criticalMultiplier;
    }
    return WEAPON_CONFIG.damage * multiplier;
  }
  return WEAPON_CONFIG.damage;
}

/**
 * 开始换弹。弹匣已满或正在换弹时返回 false。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @returns {boolean} 是否真正开始换弹。
 */
export function startReload(state) {
  if (state.reloading) {
    return false;
  }
  if (state.ammo >= state.magazineSize) {
    return false;
  }
  state.reloading = true;
  state.reloadTimer = WEAPON_CONFIG.reloadDuration;
  state.emptyLatched = false;
  return true;
}

/**
 * 读取当前的相机后坐力、震动与 FOV 冲击。
 *
 * 镜头震动只在开火后的短时间窗口内有效；震动相位由状态机推进，
 * 因此这里是纯函数，公共入口每帧调用一次即可。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @returns {{
 *   pitch: number,
 *   yaw: number,
 *   roll: number,
 *   shakeX: number,
 *   shakeY: number,
 *   fovPunch: number
 * }}
 */
export function getRecoilState(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('getRecoilState 需要武器状态对象');
  }
  let shakeX = 0;
  let shakeY = 0;
  if (state.shakeTimer > 0) {
    const envelope = state.shakeTimer / SHAKE_CONFIG.duration;
    const angle = state.shakePhase * Math.PI * 2;
    shakeX = Math.sin(angle) * SHAKE_CONFIG.amplitude * envelope;
    shakeY = Math.cos(angle) * SHAKE_CONFIG.amplitude * 0.7 * envelope;
  }
  return {
    pitch: state.recoilPitch,
    yaw: state.recoilYaw,
    roll: state.recoilRoll,
    shakeX,
    shakeY,
    fovPunch: state.fovPunch
  };
}

/**
 * 推进武器状态一帧。
 *
 * 一帧最多发射一发：主循环的 delta 上限为 0.05 秒，小于 0.095 秒的射击间隔，
 * 因此不会漏掉连发节奏。返回的标记由公共入口转换成事件：
 * 换弹开始/结束、空仓、以及本帧是否发射。
 *
 * 后坐力包含垂直抬升、水平漂移和镜头滚转；ADS 同时降低三者与 FOV 冲击。
 *
 * @param {ReturnType<typeof createWeaponState>} state
 * @param {number} deltaSeconds 已由调用方限制上限的帧时间。
 * @param {{ fire?: boolean, reload?: boolean, aim?: boolean, moving?: boolean }} input
 * @returns {{
 *   fired: boolean,
 *   spread: number,
 *   damage: number,
 *   startedReload: boolean,
 *   finishedReload: boolean,
 *   emptyTriggered: boolean,
 *   recoil: { pitch: number, yaw: number, roll: number },
 *   fovPunch: number,
 *   shakeTimer: number
 * }}
 */
export function updateWeapon(state, deltaSeconds, input) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('updateWeapon 需要武器状态对象');
  }
  if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('updateWeapon 的 deltaSeconds 必须是大于等于 0 的有限数字');
  }

  let source = {};
  if (input !== undefined && input !== null) {
    source = input;
  }
  const wantsFire = source.fire === true;
  const wantsReload = source.reload === true;
  const wantsAim = source.aim === true;
  const moving = source.moving === true;

  const result = {
    fired: false,
    spread: 0,
    damage: 0,
    startedReload: false,
    finishedReload: false,
    emptyTriggered: false,
    recoil: { pitch: 0, yaw: 0, roll: 0 },
    fovPunch: 0,
    shakeTimer: 0
  };

  state.aiming = wantsAim;

  // 后坐力平滑回正：指数衰减，足够小时归零。
  const decay = Math.exp(-RECOIL_CONFIG.recoveryRate * deltaSeconds);
  state.recoilPitch = snapRecoil(state.recoilPitch * decay);
  state.recoilYaw = snapRecoil(state.recoilYaw * decay);
  state.recoilRoll = snapRecoil(state.recoilRoll * decay);

  // FOV 冲击按线性速度回收，避免视野长时间偏大。
  state.fovPunch = Math.max(
    0,
    state.fovPunch - FOV_PUNCH_CONFIG.recoveryRate * deltaSeconds
  );
  if (state.fovPunch < RECOIL_SNAP_EPSILON) {
    state.fovPunch = 0;
  }

  // 镜头震动相位。
  if (state.shakeTimer > 0) {
    state.shakePhase += SHAKE_CONFIG.frequencyHz * deltaSeconds;
    state.shakeTimer = Math.max(0, state.shakeTimer - deltaSeconds);
    if (state.shakeTimer === 0) {
      state.shakePhase = 0;
    }
  }

  // 射击冷却。
  state.fireCooldown = Math.max(0, state.fireCooldown - deltaSeconds);

  // 换弹计时。
  if (state.reloading) {
    state.reloadTimer -= deltaSeconds;
    if (state.reloadTimer <= 0) {
      state.reloading = false;
      state.reloadTimer = 0;
      state.ammo = state.magazineSize;
      state.emptyLatched = false;
      result.finishedReload = true;
    }
  }

  // 手动换弹优先于本帧开火。
  if (wantsReload && !state.reloading) {
    if (startReload(state)) {
      result.startedReload = true;
    }
  }

  if (wantsFire && !state.reloading) {
    if (state.ammo > 0) {
      if (state.fireCooldown <= 0) {
        state.ammo -= 1;
        state.fireCooldown = WEAPON_CONFIG.fireInterval;

        let recoilMultiplier = 1;
        if (state.aiming) {
          recoilMultiplier = RECOIL_CONFIG.adsMultiplier;
        }
        const patternIndex = state.shotIndex % RECOIL_YAW_PATTERN.length;
        const yawDirection = RECOIL_YAW_PATTERN[patternIndex];
        state.shotIndex += 1;

        state.recoilPitch = Math.min(
          RECOIL_CONFIG.maxPitch,
          state.recoilPitch + RECOIL_CONFIG.pitchKick * recoilMultiplier
        );
        state.recoilYaw += RECOIL_CONFIG.yawKick * yawDirection * recoilMultiplier;
        state.recoilRoll += RECOIL_CONFIG.rollKick * yawDirection * recoilMultiplier;

        state.shakeTimer = SHAKE_CONFIG.duration;
        state.shakePhase = 0;

        let fovMultiplier = 1;
        if (state.aiming) {
          fovMultiplier = FOV_PUNCH_CONFIG.adsMultiplier;
        }
        state.fovPunch += FOV_PUNCH_CONFIG.kickDegrees * fovMultiplier;

        result.fired = true;
        result.spread = getSpread(state, moving);
        result.damage = WEAPON_CONFIG.damage;

        if (state.ammo === 0) {
          // 最后一发打完：给出空仓提示并自动换弹。
          result.emptyTriggered = true;
          if (startReload(state)) {
            result.startedReload = true;
          }
        }
      }
    } else {
      // 弹匣空且不在换弹：只提示一次空仓，并开始自动换弹。
      if (!state.emptyLatched) {
        state.emptyLatched = true;
        result.emptyTriggered = true;
      }
      if (startReload(state)) {
        result.startedReload = true;
      }
    }
  }

  result.recoil.pitch = state.recoilPitch;
  result.recoil.yaw = state.recoilYaw;
  result.recoil.roll = state.recoilRoll;
  result.fovPunch = state.fovPunch;
  result.shakeTimer = state.shakeTimer;
  return result;
}
