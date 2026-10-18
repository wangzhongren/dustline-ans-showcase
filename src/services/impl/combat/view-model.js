/**
 * 战斗服务：第一人称高细节 AR-15 视图模型、戴手套的双手与视图动画。
 *
 * 结构分三层：
 * 1. 纯状态与纯函数（本文件上半部分）：待机呼吸、行走摆动、冲刺收枪、ADS 过渡、
 *    射击后坐、换弹阶段、抛壳与枪口烟雾。全部是普通对象运算，可在 Node 中测试。
 * 2. 程序化几何：上/下机匣、护木、枪管、导气块、准星、红点镜、拉机柄、抛壳口、
 *    弹匣、枪托、握把、扳机护圈、枪口制退器、导轨、背带环与磨损细节。
 * 3. 视图模型实例：把状态应用到 Three.js 门面对象，并挂到相机下。
 *
 * 材质遵循美术方向：金属机匣与聚合物护木/握把/枪托在颜色、粗糙度与金属度上分开，
 * 棱角有少量磨损高光；不使用霓虹色。贴图由注入的素材加载器提供，缺失时使用
 * 程序化材质。
 */

import { GAME_CONFIG } from '../../../models/game-config.js';
import {
  AdditiveBlending,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3
} from '../../../providers/public/three.js';

const VIEW_CONFIG = GAME_CONFIG.weapon.viewModel;
const SHELL_CONFIG = GAME_CONFIG.weapon.shellEject;
const ADS_CONFIG = GAME_CONFIG.weapon.ads;

/**
 * 视图模型整体缩放。
 *
 * 基础值来自 Model（0.85）；v3 实际画面复核发现枪身占屏偏大，因此在视图层再乘
 * 0.82，让腰射时的武器与双手落在画面右下约四分之一到三分之一的范围内。
 */
export const VIEW_MODEL_SCALE = VIEW_CONFIG.scale * 0.82;

/**
 * 贴图色调。金属/钢/木材/织物贴图统一偏暖、低饱和，避免阴天蓝色环境反射把
 * 机匣和护木染成蓝紫色。数值是实现默认值。
 */
export const VIEW_MODEL_TEXTURE_TINTS = Object.freeze({
  receiver: 0x9c948a,
  barrel: 0x8f877d,
  rail: 0xa29a90,
  wear: 0xb5aca0
});

/**
 * 材质分层常量。测试用它确认机匣（金属）与护木/握把/枪托（聚合物）不是同一种材质。
 * `envMapIntensity` 压低天空反射，避免蓝色 HDRI 主导武器颜色。
 */
export const VIEW_MODEL_MATERIALS = Object.freeze({
  receiver: Object.freeze({
    color: 0x3a3d3f,
    roughness: 0.55,
    metalness: 0.66,
    envMapIntensity: 0.22
  }),
  polymer: Object.freeze({
    color: 0x262420,
    roughness: 0.88,
    metalness: 0.02,
    envMapIntensity: 0.03
  }),
  barrel: Object.freeze({
    color: 0x2b2e30,
    roughness: 0.46,
    metalness: 0.72,
    envMapIntensity: 0.2
  }),
  rail: Object.freeze({
    color: 0x4a4d4a,
    roughness: 0.52,
    metalness: 0.6,
    envMapIntensity: 0.2
  }),
  wear: Object.freeze({
    color: 0x6a6e70,
    roughness: 0.6,
    metalness: 0.5,
    envMapIntensity: 0.18
  }),
  opticGlass: Object.freeze({
    color: 0xb0aea6,
    roughness: 0.05,
    metalness: 0,
    envMapIntensity: 0.08
  }),
  glove: Object.freeze({
    color: 0x2b2e2a,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.02
  }),
  sleeve: Object.freeze({
    color: 0x8a8268,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.02
  }),
  wood: Object.freeze({
    color: 0x3a3028,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.04
  })
});

/** 枪口闪光持续时间（秒）。 */
export const MUZZLE_FLASH_DURATION = 0.05;

/** 枪口烟雾存活时间（秒）。 */
export const SMOKE_LIFETIME = 0.35;

/** 同时存在的弹壳上限。 */
export const MAX_SHELLS = 8;

/**
 * 红点镜的开放框架结构。四面薄壁围成前后贯通的隧道，中心完全留空；
 * 前方只有一片低不透明度镜片和一个高亮红点，避免 ADS 时看到黑色实心块。
 */
export const OPTIC_STRUCTURE = Object.freeze({
  outerWidth: 0.042,
  outerHeight: 0.045,
  length: 0.075,
  wallThickness: 0.005,
  innerWidth: 0.032,
  innerHeight: 0.035,
  lensOpacity: 0.12,
  redDotColor: 0xff2a1f,
  redDotRadius: 0.0026
});

/** 视图后坐力参数（视觉层，与相机后坐力分开调）。 */
const VIEW_RECOIL = Object.freeze({
  kickBack: 0.038,
  kickUp: 0.007,
  pitch: 0.02,
  yaw: 0.004,
  roll: 0.006,
  recoveryRate: 12
});

/** 待机呼吸与行走摆动的幅度（米/弧度）。 */
const BREATH = Object.freeze({ x: 0.001, y: 0.0015, rate: 1.5 });
const BOB = Object.freeze({ x: 0.007, y: 0.005, roll: 0.012 });

/** 换弹阶段边界（0–1）。 */
const RELOAD_DROP_END = 0.28;
const RELOAD_INSERT_END = 0.55;
const RELOAD_CHARGE_END = 0.85;

/** 弹匣、拉机柄与双手的基准局部位置。 */
const MAGAZINE_BASE = Object.freeze({ x: 0, y: -0.085, z: 0.005 });
const CHARGING_BASE = Object.freeze({ x: 0, y: 0.062, z: 0.145 });
const RIGHT_HAND_BASE = Object.freeze({
  position: { x: 0, y: -0.12, z: 0.115 },
  rotation: { x: 0.15, y: 0, z: 0.05 }
});
const LEFT_HAND_BASE = Object.freeze({
  position: { x: 0.012, y: -0.045, z: -0.31 },
  rotation: { x: 0.15, y: 0.1, z: 0.15 }
});
const LEFT_HAND_MAGAZINE = Object.freeze({ x: 0.025, y: -0.17, z: 0.02 });
const LEFT_HAND_CHARGING = Object.freeze({ x: 0.02, y: 0.055, z: 0.145 });

/** 枪口与抛壳口的局部位置。 */
const MUZZLE_LOCAL = Object.freeze({ x: 0, y: 0.018, z: -0.865 });
const EJECT_LOCAL = Object.freeze({ x: 0.045, y: 0.038, z: 0.03 });

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
 * 把数值限制在闭区间内。
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * 把数值限制在 0–1。
 *
 * @param {number} value
 * @returns {number}
 */
function clamp01(value) {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return clamp(value, 0, 1);
}

/**
 * 线性插值。
 *
 * @param {number} from
 * @param {number} to
 * @param {number} amount
 * @returns {number}
 */
function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

/**
 * 三维点线性插值。
 *
 * @param {{x:number,y:number,z:number}} from
 * @param {{x:number,y:number,z:number}} to
 * @param {number} amount
 * @returns {{x:number,y:number,z:number}}
 */
function lerpPoint(from, to, amount) {
  return {
    x: lerp(from.x, to.x, amount),
    y: lerp(from.y, to.y, amount),
    z: lerp(from.z, to.z, amount)
  };
}

/**
 * 平滑插值（smoothstep）。
 *
 * @param {number} value
 * @returns {number}
 */
function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * 把当前值按速度推向目标值。
 *
 * @param {number} current
 * @param {number} target
 * @param {number} maxStep
 * @returns {number}
 */
function approach(current, target, maxStep) {
  if (current < target) {
    return Math.min(target, current + maxStep);
  }
  if (current > target) {
    return Math.max(target, current - maxStep);
  }
  return target;
}

/**
 * 创建一份视图动画状态。所有字段都是普通数字/数组，便于测试与复位。
 *
 * @returns {{
 *   time: number,
 *   shotCount: number,
 *   aimAmount: number,
 *   sprintAmount: number,
 *   moveAmount: number,
 *   bobPhase: number,
 *   recoil: {
 *     offsetX: number, offsetY: number, offsetZ: number,
 *     rotationX: number, rotationY: number, rotationZ: number
 *   },
 *   flashTimer: number,
 *   smoke: Array<Object>,
 *   shells: Array<Object>,
 *   reloading: boolean,
 *   reloadProgress: number,
 *   reloadDuration: number,
 *   reloadPhase: string
 * }}
 */
export function createViewState() {
  return {
    time: 0,
    shotCount: 0,
    aimAmount: 0,
    sprintAmount: 0,
    moveAmount: 0,
    bobPhase: 0,
    recoil: {
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0
    },
    flashTimer: 0,
    smoke: [],
    shells: [],
    reloading: false,
    reloadProgress: 0,
    reloadDuration: GAME_CONFIG.weapon.reloadDuration,
    reloadPhase: 'idle'
  };
}

/**
 * 把现有状态对象复位为初始值（保持对象引用不变）。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {ReturnType<typeof createViewState>}
 */
export function resetViewState(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('resetViewState 需要视图状态对象');
  }
  const fresh = createViewState();
  const keys = Object.keys(fresh);
  for (const key of keys) {
    state[key] = fresh[key];
  }
  return state;
}

/**
 * 根据换弹进度返回阶段名。
 *
 * @param {number} progress 0–1。
 * @returns {'idle'|'magazine-drop'|'magazine-insert'|'charging-handle'|'settle'}
 */
export function getReloadPhase(progress) {
  if (!isFiniteNumber(progress)) {
    throw new TypeError('getReloadPhase 的 progress 必须是有限数字');
  }
  const value = clamp(progress, 0, 1);
  if (value <= 0) {
    return 'idle';
  }
  if (value < RELOAD_DROP_END) {
    return 'magazine-drop';
  }
  if (value < RELOAD_INSERT_END) {
    return 'magazine-insert';
  }
  if (value < RELOAD_CHARGE_END) {
    return 'charging-handle';
  }
  return 'settle';
}

/**
 * 计算换弹动画参数：弹匣下落/插入、拉机柄行程与左手混合权重。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {{
 *   phase: string,
 *   progress: number,
 *   magazineOffsetY: number,
 *   magazineOffsetZ: number,
 *   magazineVisible: boolean,
 *   chargingPull: number,
 *   leftHandBlend: number
 * }}
 */
export function getReloadAnimation(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('getReloadAnimation 需要视图状态对象');
  }
  let phase = 'idle';
  let progress = 0;
  if (state.reloading) {
    progress = clamp01(state.reloadProgress);
    if (progress <= 0) {
      progress = 0.000001;
    }
    phase = getReloadPhase(progress);
  }

  let magazineOffsetY = 0;
  let magazineOffsetZ = 0;
  let magazineVisible = true;
  let chargingPull = 0;
  let leftHandBlend = 0;

  if (phase === 'magazine-drop') {
    const t = smoothstep(progress / RELOAD_DROP_END);
    magazineOffsetY = -0.18 * t;
    magazineOffsetZ = 0.02 * t;
    if (t > 0.985) {
      magazineVisible = false;
    }
    leftHandBlend = 1;
  } else if (phase === 'magazine-insert') {
    const t = smoothstep(
      (progress - RELOAD_DROP_END) / (RELOAD_INSERT_END - RELOAD_DROP_END)
    );
    magazineOffsetY = -0.18 * (1 - t);
    magazineVisible = true;
    leftHandBlend = 1;
  } else if (phase === 'charging-handle') {
    const t = (progress - RELOAD_INSERT_END) / (RELOAD_CHARGE_END - RELOAD_INSERT_END);
    chargingPull = Math.sin(clamp01(t) * Math.PI);
    leftHandBlend = 0.55;
  } else if (phase === 'settle') {
    const t = clamp01((progress - RELOAD_CHARGE_END) / (1 - RELOAD_CHARGE_END));
    chargingPull = Math.max(0, 1 - t * 2);
    leftHandBlend = Math.max(0, 1 - t * 2);
  }

  return {
    phase,
    progress,
    magazineOffsetY,
    magazineOffsetZ,
    magazineVisible,
    chargingPull,
    leftHandBlend
  };
}

/**
 * 推进视图动画状态一帧。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @param {number} deltaSeconds
 * @param {{
 *   aiming?: boolean,
 *   moving?: boolean,
 *   sprinting?: boolean,
 *   reloading?: boolean,
 *   reloadProgress?: number,
 *   reloadDuration?: number
 * }} [input]
 * @returns {ReturnType<typeof createViewState>}
 */
export function updateViewState(state, deltaSeconds, input) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('updateViewState 需要视图状态对象');
  }
  if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('updateViewState 的 deltaSeconds 必须是大于等于 0 的有限数字');
  }
  let source = {};
  if (input !== undefined && input !== null) {
    source = input;
  }

  state.time += deltaSeconds;

  const aiming = source.aiming === true;
  let aimTarget = 0;
  if (aiming) {
    aimTarget = 1;
  }
  state.aimAmount = approach(state.aimAmount, aimTarget, ADS_CONFIG.transitionRate * deltaSeconds);

  const sprinting = source.sprinting === true && !aiming;
  let sprintTarget = 0;
  if (sprinting) {
    sprintTarget = 1;
  }
  state.sprintAmount = approach(state.sprintAmount, sprintTarget, 6 * deltaSeconds);

  const moving = source.moving === true;
  let moveTarget = 0;
  if (moving) {
    moveTarget = 1;
  }
  state.moveAmount = approach(state.moveAmount, moveTarget, 10 * deltaSeconds);

  if (moving) {
    let bobSpeed = 1.4;
    if (sprinting) {
      bobSpeed = 2.4;
    }
    state.bobPhase += deltaSeconds * Math.PI * 2 * bobSpeed;
  }

  // 视觉后坐力指数回正。
  const decay = Math.exp(-VIEW_RECOIL.recoveryRate * deltaSeconds);
  state.recoil.offsetX *= decay;
  state.recoil.offsetY *= decay;
  state.recoil.offsetZ *= decay;
  state.recoil.rotationX *= decay;
  state.recoil.rotationY *= decay;
  state.recoil.rotationZ *= decay;
  if (Math.abs(state.recoil.offsetX) < 1e-6) {
    state.recoil.offsetX = 0;
  }
  if (Math.abs(state.recoil.offsetY) < 1e-6) {
    state.recoil.offsetY = 0;
  }
  if (Math.abs(state.recoil.offsetZ) < 1e-6) {
    state.recoil.offsetZ = 0;
  }
  if (Math.abs(state.recoil.rotationX) < 1e-6) {
    state.recoil.rotationX = 0;
  }
  if (Math.abs(state.recoil.rotationY) < 1e-6) {
    state.recoil.rotationY = 0;
  }
  if (Math.abs(state.recoil.rotationZ) < 1e-6) {
    state.recoil.rotationZ = 0;
  }

  state.flashTimer = Math.max(0, state.flashTimer - deltaSeconds);

  updateSmoke(state, deltaSeconds);
  updateShells(state, deltaSeconds);

  const reloading = source.reloading === true;
  if (reloading) {
    if (!state.reloading) {
      state.reloading = true;
      state.reloadProgress = 0;
    }
    if (isFiniteNumber(source.reloadProgress)) {
      state.reloadProgress = clamp01(source.reloadProgress);
    } else {
      let duration = state.reloadDuration;
      if (isFiniteNumber(source.reloadDuration) && source.reloadDuration > 0) {
        duration = source.reloadDuration;
      }
      state.reloadProgress += deltaSeconds / duration;
    }
    if (state.reloadProgress >= 1) {
      state.reloading = false;
      state.reloadProgress = 0;
    }
  } else if (state.reloading) {
    state.reloading = false;
    state.reloadProgress = 0;
  }

  state.reloadPhase = getReloadAnimation(state).phase;
  return state;
}

/**
 * 触发一次开火：后坐踢、枪口闪光、烟雾与一枚弹壳。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {{ x: number, y: number, z: number }} 本次弹壳的局部初速度。
 */
export function triggerViewFire(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('triggerViewFire 需要视图状态对象');
  }

  let direction = 1;
  const pattern = state.shotCount % 2;
  if (pattern === 1) {
    direction = -1;
  }
  state.shotCount += 1;

  state.flashTimer = MUZZLE_FLASH_DURATION;
  state.recoil.offsetX += VIEW_RECOIL.kickUp * 0.3 * direction;
  state.recoil.offsetY += VIEW_RECOIL.kickUp;
  state.recoil.offsetZ += VIEW_RECOIL.kickBack;
  state.recoil.rotationX += VIEW_RECOIL.pitch;
  state.recoil.rotationY += VIEW_RECOIL.yaw * direction;
  state.recoil.rotationZ += VIEW_RECOIL.roll * direction;

  spawnSmoke(state);
  spawnShell(state);

  return {
    x: SHELL_CONFIG.sideSpeed,
    y: SHELL_CONFIG.upSpeed,
    z: 0.22
  };
}

/**
 * 生成枪口烟雾粒子（纯状态）。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {void}
 */
function spawnSmoke(state) {
  for (let index = 0; index < 3; index += 1) {
    if (state.smoke.length >= 12) {
      break;
    }
    state.smoke.push({
      age: 0,
      lifetime: SMOKE_LIFETIME + index * 0.04,
      x: (index - 1) * 0.012,
      y: index * 0.006,
      z: index * 0.02,
      driftX: (index - 1) * 0.03
    });
  }
}

/**
 * 生成一枚弹壳（纯状态）。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {void}
 */
function spawnShell(state) {
  if (state.shells.length >= MAX_SHELLS) {
    state.shells.shift();
  }
  state.shells.push({
    x: EJECT_LOCAL.x,
    y: EJECT_LOCAL.y,
    z: EJECT_LOCAL.z,
    vx: SHELL_CONFIG.sideSpeed,
    vy: SHELL_CONFIG.upSpeed,
    vz: 0.22,
    age: 0,
    lifetime: SHELL_CONFIG.lifetime,
    rotationX: 0,
    rotationZ: 0,
    spinX: 9,
    spinZ: 14
  });
}

/**
 * 推进烟雾粒子。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @param {number} deltaSeconds
 * @returns {void}
 */
function updateSmoke(state, deltaSeconds) {
  const alive = [];
  for (const puff of state.smoke) {
    puff.age += deltaSeconds;
    puff.x += puff.driftX * deltaSeconds;
    puff.y += 0.05 * deltaSeconds;
    if (puff.age < puff.lifetime) {
      alive.push(puff);
    }
  }
  state.smoke = alive;
}

/**
 * 推进弹壳：重力、位移、旋转与寿命。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @param {number} deltaSeconds
 * @returns {void}
 */
function updateShells(state, deltaSeconds) {
  const alive = [];
  for (const shell of state.shells) {
    shell.vy -= SHELL_CONFIG.gravity * deltaSeconds;
    shell.x += shell.vx * deltaSeconds;
    shell.y += shell.vy * deltaSeconds;
    shell.z += shell.vz * deltaSeconds;
    shell.rotationX += shell.spinX * deltaSeconds;
    shell.rotationZ += shell.spinZ * deltaSeconds;
    shell.age += deltaSeconds;
    if (shell.age < shell.lifetime && shell.y > -0.6) {
      alive.push(shell);
    }
  }
  state.shells = alive;
}

/**
 * 计算视图模型根节点的位置与旋转（相机局部坐标）。
 *
 * @param {ReturnType<typeof createViewState>} state
 * @returns {{
 *   position: { x: number, y: number, z: number },
 *   rotation: { x: number, y: number, z: number },
 *   scale: number
 * }}
 */
export function getViewTransform(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('getViewTransform 需要视图状态对象');
  }

  const aim = clamp01(state.aimAmount);
  const sprint = clamp01(state.sprintAmount) * (1 - aim * 0.85);
  const move = clamp01(state.moveAmount);

  const hip = VIEW_CONFIG.hipPosition;
  const ads = VIEW_CONFIG.adsPosition;
  const sprintPosition = VIEW_CONFIG.sprintPosition;

  let baseX = lerp(hip.x, ads.x, aim);
  let baseY = lerp(hip.y, ads.y, aim);
  let baseZ = lerp(hip.z, ads.z, aim);
  baseX = lerp(baseX, sprintPosition.x, sprint);
  baseY = lerp(baseY, sprintPosition.y, sprint);
  baseZ = lerp(baseZ, sprintPosition.z, sprint);

  // 待机呼吸在 ADS 时减弱，避免准星抖动。
  const breathWeight = 1 - aim * 0.6;
  const breathX = Math.cos(state.time * BREATH.rate * 0.72) * BREATH.x * breathWeight;
  const breathY = Math.sin(state.time * BREATH.rate) * BREATH.y * breathWeight;

  // 行走摆动：水平画 8 字，垂直小幅下沉。
  const bobX = Math.sin(state.bobPhase) * BOB.x * move;
  const bobY = -Math.abs(Math.cos(state.bobPhase)) * BOB.y * move;
  const bobRoll = Math.sin(state.bobPhase) * BOB.roll * move;

  let rotationX = -0.32 * sprint;
  let rotationY = -0.22 * sprint;
  let rotationZ = 0.42 * sprint + 0.015 * (1 - aim) + bobRoll;

  rotationX += state.recoil.rotationX;
  rotationY += state.recoil.rotationY;
  rotationZ += state.recoil.rotationZ;

  return {
    position: {
      x: baseX + breathX + bobX + state.recoil.offsetX,
      y: baseY + breathY + bobY + state.recoil.offsetY,
      z: baseZ + state.recoil.offsetZ
    },
    rotation: {
      x: rotationX,
      y: rotationY,
      z: rotationZ
    },
    scale: VIEW_MODEL_SCALE
  };
}

/**
 * 枪口的局部位置（视图模型根节点坐标系）。
 *
 * @returns {{ x: number, y: number, z: number }}
 */
export function getMuzzleLocalPosition() {
  return { x: MUZZLE_LOCAL.x, y: MUZZLE_LOCAL.y, z: MUZZLE_LOCAL.z };
}

/**
 * 判断对象是否提供了贴图加载方法。
 *
 * @param {unknown} loader
 * @returns {boolean}
 */
function isAssetLoader(loader) {
  if (loader === null || typeof loader !== 'object') {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (loader);
  return (
    typeof source.loadManifest === 'function' &&
    typeof source.loadTexture === 'function'
  );
}

/**
 * 读取贴图组中的一个相对 URL；缺失或类型不对时返回 null。
 *
 * @param {Record<string, unknown>} group
 * @param {string} key
 * @returns {string|null}
 */
function readTextureUrl(group, key) {
  const value = group[key];
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * 创建第一人称视图模型并挂到相机下。
 *
 * @param {{
 *   attachToCamera: (object: unknown) => void,
 *   detachFromCamera: (object: unknown) => void
 * }} renderer 渲染 Provider 公共入口返回的渲染器。
 * @returns {{
 *   root: Group,
 *   update: (deltaSeconds: number, input?: Object) => void,
 *   triggerFire: () => ({ position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number} } | null),
 *   getMuzzleWorldPosition: () => { x: number, y: number, z: number },
 *   loadTextures: (loader: Object) => Promise<void>,
 *   setVisible: (visible: boolean) => void,
 *   reset: () => void,
 *   dispose: () => void,
 *   getState: () => ReturnType<typeof createViewState>
 * }}
 */
export function createViewModel(renderer) {
  if (renderer === null || typeof renderer !== 'object') {
    throw new TypeError('createViewModel 需要渲染器');
  }
  if (typeof renderer.attachToCamera !== 'function') {
    throw new TypeError('createViewModel 的渲染器缺少 attachToCamera()');
  }
  if (typeof renderer.detachFromCamera !== 'function') {
    throw new TypeError('createViewModel 的渲染器缺少 detachFromCamera()');
  }

  const geometries = [];
  const materials = [];
  const root = new Group();
  root.name = 'combat-view-model';
  const rifle = new Group();
  rifle.name = 'view-model-rifle';
  root.add(rifle);

  const state = createViewState();
  let disposed = false;
  let texturesLoaded = false;

  /**
   * @param {Object} options
   * @returns {MeshStandardMaterial}
   */
  function createStandardMaterial(options) {
    const material = new MeshStandardMaterial(options);
    materials.push(material);
    return material;
  }

  /**
   * @param {Object} options
   * @returns {MeshBasicMaterial}
   */
  function createBasicMaterial(options) {
    const material = new MeshBasicMaterial(options);
    materials.push(material);
    return material;
  }

  const receiverMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.receiver);
  const polymerMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.polymer);
  const barrelMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.barrel);
  const railMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.rail);
  const wearMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.wear);
  const gloveMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.glove);
  const sleeveMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.sleeve);
  const woodMaterial = createStandardMaterial(VIEW_MODEL_MATERIALS.wood);
  const opticGlassMaterial = createStandardMaterial({
    color: VIEW_MODEL_MATERIALS.opticGlass.color,
    roughness: VIEW_MODEL_MATERIALS.opticGlass.roughness,
    metalness: VIEW_MODEL_MATERIALS.opticGlass.metalness,
    envMapIntensity: VIEW_MODEL_MATERIALS.opticGlass.envMapIntensity,
    transparent: true,
    opacity: OPTIC_STRUCTURE.lensOpacity,
    depthWrite: false,
    side: DoubleSide
  });
  const redDotMaterial = createBasicMaterial({
    color: OPTIC_STRUCTURE.redDotColor,
    toneMapped: false,
    depthWrite: false
  });
  const shellMaterial = createStandardMaterial({
    color: 0x8a6b3a,
    roughness: 0.35,
    metalness: 0.8,
    envMapIntensity: 0.25
  });
  const flashMaterial = createBasicMaterial({
    color: 0xffc27a,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: AdditiveBlending
  });

  /**
   * 添加网格并登记几何体。
   *
   * @param {Group} parent
   * @param {import('three').BufferGeometry} geometry
   * @param {MeshStandardMaterial|MeshBasicMaterial} material
   * @param {{position?: Object, rotation?: Object, scale?: Object}} [options]
   * @returns {Mesh}
   */
  function addMesh(parent, geometry, material, options) {
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    if (options !== undefined && options !== null) {
      if (options.position !== undefined) {
        mesh.position.set(options.position.x, options.position.y, options.position.z);
      }
      if (options.rotation !== undefined) {
        mesh.rotation.set(options.rotation.x, options.rotation.y, options.rotation.z);
      }
      if (options.scale !== undefined) {
        mesh.scale.set(options.scale.x, options.scale.y, options.scale.z);
      }
    }
    parent.add(mesh);
    return mesh;
  }

  /* ---------------------------------------------------------------------- */
  /* 步枪几何                                                                */
  /* ---------------------------------------------------------------------- */

  // 上/下机匣：哑光深灰金属。
  addMesh(
    rifle,
    new BoxGeometry(0.078, 0.055, 0.28),
    receiverMaterial,
    { position: { x: 0, y: 0.035, z: 0.01 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.072, 0.055, 0.22),
    receiverMaterial,
    { position: { x: 0, y: -0.018, z: 0.055 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.058, 0.055, 0.075),
    receiverMaterial,
    { position: { x: 0, y: -0.063, z: 0.01 }, rotation: { x: 0.08, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.06, 0.05, 0.06),
    receiverMaterial,
    { position: { x: 0, y: 0.0, z: 0.16 } }
  );

  // 机匣顶部导轨与齿。
  addMesh(
    rifle,
    new BoxGeometry(0.04, 0.012, 0.46),
    railMaterial,
    { position: { x: 0, y: 0.075, z: -0.04 } }
  );
  for (let index = 0; index < 13; index += 1) {
    const z = 0.16 - index * 0.033;
    addMesh(
      rifle,
      new BoxGeometry(0.042, 0.008, 0.012),
      railMaterial,
      { position: { x: 0, y: 0.083, z } }
    );
  }

  // 抛壳口、抛壳偏转器、拉机柄、快慢机与机匣销。
  addMesh(
    rifle,
    new BoxGeometry(0.006, 0.032, 0.085),
    barrelMaterial,
    { position: { x: 0.04, y: 0.034, z: 0.02 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.012, 0.02, 0.02),
    wearMaterial,
    { position: { x: 0.047, y: 0.052, z: 0.072 } }
  );

  const chargingHandle = new Group();
  chargingHandle.name = 'view-model-charging-handle';
  chargingHandle.position.set(CHARGING_BASE.x, CHARGING_BASE.y, CHARGING_BASE.z);
  rifle.add(chargingHandle);
  addMesh(
    chargingHandle,
    new BoxGeometry(0.03, 0.01, 0.035),
    railMaterial,
    { position: { x: 0, y: 0, z: 0 } }
  );
  addMesh(
    chargingHandle,
    new BoxGeometry(0.022, 0.014, 0.012),
    wearMaterial,
    { position: { x: 0.024, y: 0, z: 0 } }
  );

  addMesh(
    rifle,
    new BoxGeometry(0.004, 0.012, 0.022),
    railMaterial,
    { position: { x: -0.04, y: 0.0, z: 0.09 } }
  );
  addMesh(
    rifle,
    new CylinderGeometry(0.005, 0.005, 0.008, 8),
    wearMaterial,
    { position: { x: -0.039, y: 0.005, z: 0.1 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } }
  );
  addMesh(
    rifle,
    new CylinderGeometry(0.005, 0.005, 0.008, 8),
    wearMaterial,
    { position: { x: 0.039, y: -0.005, z: 0.11 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } }
  );

  // 聚合物护木：与机匣在颜色、粗糙度和金属度上分开。
  addMesh(
    rifle,
    new BoxGeometry(0.062, 0.062, 0.3),
    polymerMaterial,
    { position: { x: 0, y: 0.02, z: -0.33 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.038, 0.012, 0.28),
    railMaterial,
    { position: { x: 0, y: 0.058, z: -0.33 } }
  );
  for (let index = 0; index < 8; index += 1) {
    const z = -0.21 - index * 0.033;
    addMesh(
      rifle,
      new BoxGeometry(0.04, 0.007, 0.011),
      railMaterial,
      { position: { x: 0, y: 0.065, z } }
    );
  }
  addMesh(
    rifle,
    new BoxGeometry(0.03, 0.01, 0.18),
    railMaterial,
    { position: { x: 0, y: -0.014, z: -0.33 } }
  );
  for (let index = 0; index < 3; index += 1) {
    const z = -0.25 - index * 0.08;
    addMesh(
      rifle,
      new BoxGeometry(0.004, 0.018, 0.045),
      barrelMaterial,
      { position: { x: 0.033, y: 0.006, z } }
    );
    addMesh(
      rifle,
      new BoxGeometry(0.004, 0.018, 0.045),
      barrelMaterial,
      { position: { x: -0.033, y: 0.006, z } }
    );
  }
  addMesh(
    rifle,
    new BoxGeometry(0.064, 0.003, 0.28),
    wearMaterial,
    { position: { x: 0, y: 0.052, z: -0.33 } }
  );

  // 枪管、枪管螺母、导气块、导气管、前准星。
  addMesh(
    rifle,
    new CylinderGeometry(0.0105, 0.0105, 0.34, 12),
    barrelMaterial,
    { position: { x: 0, y: 0.018, z: -0.62 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new CylinderGeometry(0.016, 0.016, 0.03, 12),
    railMaterial,
    { position: { x: 0, y: 0.018, z: -0.46 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.026, 0.032, 0.045),
    railMaterial,
    { position: { x: 0, y: 0.052, z: -0.52 } }
  );
  addMesh(
    rifle,
    new CylinderGeometry(0.004, 0.004, 0.2, 8),
    railMaterial,
    { position: { x: 0, y: 0.058, z: -0.42 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.026, 0.008, 0.028),
    railMaterial,
    { position: { x: 0, y: 0.062, z: -0.545 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.008, 0.04, 0.008),
    railMaterial,
    { position: { x: 0, y: 0.085, z: -0.545 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.004, 0.014, 0.004),
    wearMaterial,
    { position: { x: 0, y: 0.106, z: -0.545 } }
  );

  // 枪口制退器与切口。
  addMesh(
    rifle,
    new CylinderGeometry(0.017, 0.016, 0.06, 12),
    barrelMaterial,
    { position: { x: 0, y: 0.018, z: -0.82 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.036, 0.006, 0.008),
    wearMaterial,
    { position: { x: 0, y: 0.018, z: -0.81 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.036, 0.006, 0.008),
    wearMaterial,
    { position: { x: 0, y: 0.018, z: -0.83 } }
  );
  addMesh(
    rifle,
    new TorusGeometry(0.018, 0.0025, 6, 16),
    wearMaterial,
    { position: { x: 0, y: 0.018, z: -0.795 } }
  );

  // 红点镜：底座 + 四面薄壁围成的开放隧道（前后贯通，中心无实体）。
  // 这样 ADS 时相机可以透过镜框看到场景，而不是盯着一个实心黑盒。
  addMesh(
    rifle,
    new BoxGeometry(0.03, 0.018, 0.05),
    railMaterial,
    { position: { x: 0, y: 0.09, z: -0.03 } }
  );

  const opticFrame = new Group();
  opticFrame.name = 'view-model-optic-frame';
  opticFrame.position.set(0, 0.118, -0.03);
  rifle.add(opticFrame);

  const wallY = OPTIC_STRUCTURE.outerHeight / 2 - OPTIC_STRUCTURE.wallThickness / 2;
  const wallX = OPTIC_STRUCTURE.outerWidth / 2 - OPTIC_STRUCTURE.wallThickness / 2;

  const opticWallTop = addMesh(
    opticFrame,
    new BoxGeometry(
      OPTIC_STRUCTURE.outerWidth,
      OPTIC_STRUCTURE.wallThickness,
      OPTIC_STRUCTURE.length
    ),
    polymerMaterial,
    { position: { x: 0, y: wallY, z: 0 } }
  );
  opticWallTop.name = 'view-model-optic-wall-top';
  const opticWallBottom = addMesh(
    opticFrame,
    new BoxGeometry(
      OPTIC_STRUCTURE.outerWidth,
      OPTIC_STRUCTURE.wallThickness,
      OPTIC_STRUCTURE.length
    ),
    polymerMaterial,
    { position: { x: 0, y: -wallY, z: 0 } }
  );
  opticWallBottom.name = 'view-model-optic-wall-bottom';
  const opticWallLeft = addMesh(
    opticFrame,
    new BoxGeometry(
      OPTIC_STRUCTURE.wallThickness,
      OPTIC_STRUCTURE.innerHeight,
      OPTIC_STRUCTURE.length
    ),
    polymerMaterial,
    { position: { x: -wallX, y: 0, z: 0 } }
  );
  opticWallLeft.name = 'view-model-optic-wall-left';
  const opticWallRight = addMesh(
    opticFrame,
    new BoxGeometry(
      OPTIC_STRUCTURE.wallThickness,
      OPTIC_STRUCTURE.innerHeight,
      OPTIC_STRUCTURE.length
    ),
    polymerMaterial,
    { position: { x: wallX, y: 0, z: 0 } }
  );
  opticWallRight.name = 'view-model-optic-wall-right';

  const opticFrontRing = addMesh(
    opticFrame,
    new TorusGeometry(0.026, 0.005, 8, 20),
    railMaterial,
    { position: { x: 0, y: 0, z: -OPTIC_STRUCTURE.length / 2 - 0.0015 } }
  );
  opticFrontRing.name = 'view-model-optic-front-ring';
  const opticRearRing = addMesh(
    opticFrame,
    new TorusGeometry(0.024, 0.004, 8, 20),
    railMaterial,
    { position: { x: 0, y: 0, z: OPTIC_STRUCTURE.length / 2 + 0.0015 } }
  );
  opticRearRing.name = 'view-model-optic-rear-ring';

  // 镜片很薄、低不透明度、双面且不写深度，不会把 ADS 画面压黑。
  const opticLens = addMesh(
    opticFrame,
    new CylinderGeometry(0.022, 0.022, 0.003, 18),
    opticGlassMaterial,
    { position: { x: 0, y: 0, z: -OPTIC_STRUCTURE.length / 2 + 0.0025 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  opticLens.name = 'view-model-optic-glass';

  // 高亮红点放在镜片靠相机一侧，中心轴上没有任何不透明面遮挡。
  const redDot = addMesh(
    opticFrame,
    new SphereGeometry(OPTIC_STRUCTURE.redDotRadius, 8, 6),
    redDotMaterial,
    { position: { x: 0, y: 0, z: -OPTIC_STRUCTURE.length / 2 + 0.0045 } }
  );
  redDot.name = 'view-model-optic-red-dot';

  addMesh(
    opticFrame,
    new CylinderGeometry(0.008, 0.008, 0.014, 8),
    railMaterial,
    { position: { x: 0.026, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } }
  );

  // 弹匣（独立组，换弹时下落/插入）。
  const magazine = new Group();
  magazine.name = 'view-model-magazine';
  magazine.position.set(MAGAZINE_BASE.x, MAGAZINE_BASE.y, MAGAZINE_BASE.z);
  rifle.add(magazine);
  addMesh(
    magazine,
    new BoxGeometry(0.05, 0.15, 0.085),
    polymerMaterial,
    { position: { x: 0, y: -0.075, z: 0.0 }, rotation: { x: 0.12, y: 0, z: 0 } }
  );
  addMesh(
    magazine,
    new BoxGeometry(0.052, 0.02, 0.087),
    polymerMaterial,
    { position: { x: 0, y: -0.152, z: 0.012 } }
  );
  for (let index = 0; index < 3; index += 1) {
    addMesh(
      magazine,
      new BoxGeometry(0.053, 0.006, 0.06),
      barrelMaterial,
      { position: { x: 0, y: -0.045 - index * 0.04, z: 0.0 } }
    );
  }
  addMesh(
    magazine,
    new BoxGeometry(0.054, 0.004, 0.088),
    wearMaterial,
    { position: { x: 0, y: -0.163, z: 0.012 } }
  );

  // 枪托、缓冲管、托腮板、橡胶托底与背带环。
  // 枪托整体前移，避免 ADS 时托底贴近相机近裁剪面。
  addMesh(
    rifle,
    new CylinderGeometry(0.018, 0.018, 0.17, 10),
    railMaterial,
    { position: { x: 0, y: 0.028, z: 0.2 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new CylinderGeometry(0.022, 0.022, 0.02, 10),
    wearMaterial,
    { position: { x: 0, y: 0.028, z: 0.12 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.05, 0.08, 0.15),
    polymerMaterial,
    { position: { x: 0, y: 0.005, z: 0.26 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.045, 0.02, 0.12),
    polymerMaterial,
    { position: { x: 0, y: 0.055, z: 0.26 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.056, 0.09, 0.018),
    polymerMaterial,
    { position: { x: 0, y: 0.005, z: 0.338 } }
  );
  addMesh(
    rifle,
    new TorusGeometry(0.011, 0.0025, 6, 14),
    wearMaterial,
    { position: { x: 0.026, y: -0.02, z: 0.3 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } }
  );
  addMesh(
    rifle,
    new TorusGeometry(0.009, 0.002, 6, 14),
    wearMaterial,
    { position: { x: -0.035, y: -0.005, z: -0.45 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } }
  );

  // 握把、扳机护圈与扳机。
  addMesh(
    rifle,
    new BoxGeometry(0.043, 0.12, 0.055),
    polymerMaterial,
    { position: { x: 0, y: -0.095, z: 0.105 }, rotation: { x: -0.33, y: 0, z: 0 } }
  );
  // 木材只作为握把侧面的小面积装饰，不放在画面中心的枪托顶部。
  addMesh(
    rifle,
    new BoxGeometry(0.004, 0.075, 0.032),
    woodMaterial,
    { position: { x: 0.023, y: -0.095, z: 0.105 }, rotation: { x: -0.33, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.004, 0.075, 0.032),
    woodMaterial,
    { position: { x: -0.023, y: -0.095, z: 0.105 }, rotation: { x: -0.33, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.045, 0.012, 0.06),
    polymerMaterial,
    { position: { x: 0, y: -0.155, z: 0.13 }, rotation: { x: -0.33, y: 0, z: 0 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.006, 0.03, 0.006),
    railMaterial,
    { position: { x: 0, y: -0.08, z: -0.01 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.006, 0.006, 0.07),
    railMaterial,
    { position: { x: 0, y: -0.095, z: 0.025 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.006, 0.03, 0.006),
    railMaterial,
    { position: { x: 0, y: -0.08, z: 0.06 } }
  );
  addMesh(
    rifle,
    new BoxGeometry(0.006, 0.02, 0.01),
    wearMaterial,
    { position: { x: 0, y: -0.065, z: 0.02 }, rotation: { x: 0.2, y: 0, z: 0 } }
  );

  // 机匣棱角磨损条。
  addMesh(
    rifle,
    new BoxGeometry(0.08, 0.003, 0.26),
    wearMaterial,
    { position: { x: 0, y: 0.064, z: 0.01 } }
  );

  // 枪口锚点、闪光与烟雾。
  const muzzleAnchor = new Group();
  muzzleAnchor.name = 'view-model-muzzle';
  muzzleAnchor.position.set(MUZZLE_LOCAL.x, MUZZLE_LOCAL.y, MUZZLE_LOCAL.z);
  rifle.add(muzzleAnchor);

  const flash = new Mesh(
    new SphereGeometry(0.05, 8, 6),
    flashMaterial
  );
  geometries.push(flash.geometry);
  flash.name = 'view-model-muzzle-flash';
  flash.scale.set(1, 1, 2.2);
  flash.visible = false;
  muzzleAnchor.add(flash);

  const flashCone = new Mesh(
    new ConeGeometry(0.032, 0.11, 8),
    flashMaterial
  );
  geometries.push(flashCone.geometry);
  flashCone.name = 'view-model-muzzle-flash-cone';
  flashCone.rotation.x = -Math.PI / 2;
  flashCone.position.z = -0.05;
  flashCone.visible = false;
  muzzleAnchor.add(flashCone);

  const smokeMeshes = [];
  for (let index = 0; index < 12; index += 1) {
    const smokeMaterial = createBasicMaterial({
      color: 0x9a948a,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const smokeMesh = new Mesh(
      new SphereGeometry(0.018, 6, 4),
      smokeMaterial
    );
    geometries.push(smokeMesh.geometry);
    smokeMesh.visible = false;
    muzzleAnchor.add(smokeMesh);
    smokeMeshes.push(smokeMesh);
  }

  const ejectAnchor = new Group();
  ejectAnchor.name = 'view-model-ejection-port';
  ejectAnchor.position.set(EJECT_LOCAL.x, EJECT_LOCAL.y, EJECT_LOCAL.z);
  rifle.add(ejectAnchor);

  const shellMeshes = [];
  for (let index = 0; index < MAX_SHELLS; index += 1) {
    const shellMesh = new Mesh(
      new CylinderGeometry(0.006, 0.006, 0.02, 6),
      shellMaterial
    );
    geometries.push(shellMesh.geometry);
    shellMesh.visible = false;
    root.add(shellMesh);
    shellMeshes.push(shellMesh);
  }

  /* ---------------------------------------------------------------------- */
  /* 戴手套的双手与战术袖口                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {string} name
   * @param {number} side 1 右手，-1 左手。
   * @returns {{ group: Group, fingers: Group }}
   */
  function createHand(name, side) {
    const hand = new Group();
    hand.name = name;

    addMesh(
      hand,
      new BoxGeometry(0.05, 0.065, 0.032),
      gloveMaterial,
      { position: { x: 0, y: 0, z: 0 } }
    );
    addMesh(
      hand,
      new BoxGeometry(0.044, 0.018, 0.03),
      wearMaterial,
      { position: { x: 0, y: 0.026, z: 0.004 } }
    );

    const fingers = new Group();
    fingers.name = name + '-fingers';
    hand.add(fingers);
    for (let index = 0; index < 4; index += 1) {
      const x = -0.018 + index * 0.012;
      addMesh(
        fingers,
        new BoxGeometry(0.01, 0.038, 0.012),
        gloveMaterial,
        {
          position: { x, y: 0.004, z: -0.026 },
          rotation: { x: 0.75, y: 0, z: 0 }
        }
      );
    }
    addMesh(
      hand,
      new BoxGeometry(0.012, 0.034, 0.014),
      gloveMaterial,
      {
        position: { x: side * 0.026, y: -0.012, z: 0.006 },
        rotation: { x: 0.2, y: 0, z: side * 0.65 }
      }
    );

    // 袖口与战术袖。
    addMesh(
      hand,
      new CylinderGeometry(0.032, 0.034, 0.025, 10),
      sleeveMaterial,
      { position: { x: side * 0.008, y: -0.012, z: 0.04 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
    );
    addMesh(
      hand,
      new BoxGeometry(0.07, 0.075, 0.12),
      sleeveMaterial,
      {
        position: { x: side * 0.012, y: -0.03, z: 0.1 },
        rotation: { x: 0.18, y: side * 0.12, z: side * 0.08 }
      }
    );
    addMesh(
      hand,
      new BoxGeometry(0.072, 0.012, 0.03),
      gloveMaterial,
      { position: { x: side * 0.012, y: -0.065, z: 0.075 }, rotation: { x: 0.18, y: side * 0.12, z: side * 0.08 } }
    );

    return { group: hand, fingers };
  }

  const rightHand = createHand('view-model-right-hand', 1);
  rightHand.group.position.set(
    RIGHT_HAND_BASE.position.x,
    RIGHT_HAND_BASE.position.y,
    RIGHT_HAND_BASE.position.z
  );
  rightHand.group.rotation.set(
    RIGHT_HAND_BASE.rotation.x,
    RIGHT_HAND_BASE.rotation.y,
    RIGHT_HAND_BASE.rotation.z
  );
  root.add(rightHand.group);

  const leftHand = createHand('view-model-left-hand', -1);
  leftHand.group.position.set(
    LEFT_HAND_BASE.position.x,
    LEFT_HAND_BASE.position.y,
    LEFT_HAND_BASE.position.z
  );
  leftHand.group.rotation.set(
    LEFT_HAND_BASE.rotation.x,
    LEFT_HAND_BASE.rotation.y,
    LEFT_HAND_BASE.rotation.z
  );
  root.add(leftHand.group);

  /* ---------------------------------------------------------------------- */
  /* 状态到场景                                                              */
  /* ---------------------------------------------------------------------- */

  const worldVector = new Vector3();
  const worldQuaternion = new Quaternion();
  const velocityVector = new Vector3();

  /**
   * 把最新状态写入 Three.js 对象。
   *
   * @returns {void}
   */
  function applySceneState() {
    const transform = getViewTransform(state);
    root.position.set(
      transform.position.x,
      transform.position.y,
      transform.position.z
    );
    root.rotation.set(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z
    );

    const reload = getReloadAnimation(state);
    magazine.position.set(
      MAGAZINE_BASE.x,
      MAGAZINE_BASE.y + reload.magazineOffsetY,
      MAGAZINE_BASE.z + reload.magazineOffsetZ
    );
    magazine.visible = reload.magazineVisible;

    chargingHandle.position.set(
      CHARGING_BASE.x,
      CHARGING_BASE.y,
      CHARGING_BASE.z + reload.chargingPull * 0.05
    );

    let leftPosition = lerpPoint(
      LEFT_HAND_BASE.position,
      LEFT_HAND_MAGAZINE,
      reload.leftHandBlend
    );
    leftPosition = lerpPoint(leftPosition, LEFT_HAND_CHARGING, reload.chargingPull);
    leftHand.group.position.set(leftPosition.x, leftPosition.y, leftPosition.z);
    leftHand.group.rotation.set(
      LEFT_HAND_BASE.rotation.x + reload.leftHandBlend * 0.3 - reload.chargingPull * 0.4,
      LEFT_HAND_BASE.rotation.y,
      LEFT_HAND_BASE.rotation.z
    );
    leftHand.fingers.rotation.x = reload.leftHandBlend * 0.5;

    // 枪口闪光。
    let flashVisible = false;
    if (state.flashTimer > 0) {
      flashVisible = true;
    }
    flash.visible = flashVisible;
    flashCone.visible = flashVisible;
    if (flashVisible) {
      const pulse = 0.75 + (MUZZLE_FLASH_DURATION - state.flashTimer) * 10;
      flash.scale.set(pulse, pulse, pulse * 2.2);
      flash.rotation.z = state.time * 40;
      flashCone.scale.set(pulse, pulse, pulse);
    }

    // 枪口烟雾。
    for (let index = 0; index < smokeMeshes.length; index += 1) {
      const smokeMesh = smokeMeshes[index];
      let active = false;
      if (index < state.smoke.length) {
        active = true;
      }
      smokeMesh.visible = active;
      if (active) {
        const puff = state.smoke[index];
        const growth = 1 + puff.age * 4;
        smokeMesh.position.set(puff.x, puff.y, puff.z - puff.age * 0.25);
        smokeMesh.scale.set(growth, growth, growth);
        smokeMesh.material.opacity = (1 - puff.age / puff.lifetime) * 0.32;
      }
    }

    // 弹壳。
    for (let index = 0; index < shellMeshes.length; index += 1) {
      const shellMesh = shellMeshes[index];
      let active = false;
      if (index < state.shells.length) {
        active = true;
      }
      shellMesh.visible = active;
      if (active) {
        const shell = state.shells[index];
        shellMesh.position.set(shell.x, shell.y, shell.z);
        shellMesh.rotation.set(shell.rotationX, 0, shell.rotationZ);
      }
    }
  }

  /**
   * 计算抛壳口的世界位置与初速度。
   *
   * @returns {{ position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number} }}
   */
  function getShellEjectPayload() {
    root.updateMatrixWorld(true);
    ejectAnchor.getWorldPosition(worldVector);
    root.getWorldQuaternion(worldQuaternion);
    velocityVector.set(SHELL_CONFIG.sideSpeed, SHELL_CONFIG.upSpeed, 0.22);
    velocityVector.applyQuaternion(worldQuaternion);
    return {
      position: { x: worldVector.x, y: worldVector.y, z: worldVector.z },
      velocity: { x: velocityVector.x, y: velocityVector.y, z: velocityVector.z }
    };
  }

  /* ---------------------------------------------------------------------- */
  /* 贴图加载                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * 读取一个材质组的颜色/法线/粗糙度/金属度贴图，并应用到目标材质。
   *
   * `useColorMap` 为 false 时只使用法线/粗糙度等数据贴图，保留材质自身的
   * 暖中性基色。Fabric084 的颜色贴图本身是蓝色，Wood066 偏红；视图模型不把
   * 这两种颜色图直接贴到聚合物/手套/袖口上，避免蓝紫或酒红反光。
   *
   * @param {Object} loader
   * @param {unknown} group
   * @param {Array<{ material: MeshStandardMaterial, tint?: number }>} targets
   * @param {boolean} useMetalness
   * @param {boolean} [useColorMap]
   * @returns {Promise<void>}
   */
  async function applyMaterialGroup(loader, group, targets, useMetalness, useColorMap) {
    if (group === null || typeof group !== 'object') {
      console.warn('combat: 视图模型材质组缺失，保留程序化材质');
      return;
    }
    let allowColorMap = true;
    if (useColorMap === false) {
      allowColorMap = false;
    }
    const source = /** @type {Record<string, unknown>} */ (group);
    const colorUrl = readTextureUrl(source, 'color');
    const normalUrl = readTextureUrl(source, 'normal');
    const roughnessUrl = readTextureUrl(source, 'roughness');
    let metalnessUrl = null;
    if (useMetalness) {
      metalnessUrl = readTextureUrl(source, 'metalness');
    }

    let colorTexture = null;
    let normalTexture = null;
    let roughnessTexture = null;
    let metalnessTexture = null;

    if (allowColorMap && colorUrl !== null) {
      try {
        colorTexture = await loader.loadTexture(colorUrl, {
          colorSpace: 'srgb',
          repeat: { x: 1, y: 1 }
        });
      } catch (error) {
        console.error('combat: 视图模型颜色贴图加载失败 ' + colorUrl, error);
      }
    }
    if (normalUrl !== null) {
      try {
        normalTexture = await loader.loadTexture(normalUrl, {
          colorSpace: 'linear',
          repeat: { x: 1, y: 1 }
        });
      } catch (error) {
        console.error('combat: 视图模型法线贴图加载失败 ' + normalUrl, error);
      }
    }
    if (roughnessUrl !== null) {
      try {
        roughnessTexture = await loader.loadTexture(roughnessUrl, {
          colorSpace: 'linear',
          repeat: { x: 1, y: 1 }
        });
      } catch (error) {
        console.error('combat: 视图模型粗糙度贴图加载失败 ' + roughnessUrl, error);
      }
    }
    if (metalnessUrl !== null) {
      try {
        metalnessTexture = await loader.loadTexture(metalnessUrl, {
          colorSpace: 'linear',
          repeat: { x: 1, y: 1 }
        });
      } catch (error) {
        console.error('combat: 视图模型金属度贴图加载失败 ' + metalnessUrl, error);
      }
    }

    for (const target of targets) {
      if (colorTexture !== null) {
        target.material.map = colorTexture;
        target.material.color.setHex(target.tint);
      }
      if (normalTexture !== null) {
        target.material.normalMap = normalTexture;
      }
      if (roughnessTexture !== null) {
        target.material.roughnessMap = roughnessTexture;
      }
      if (metalnessTexture !== null) {
        target.material.metalnessMap = metalnessTexture;
      }
      target.material.needsUpdate = true;
    }
  }

  /**
   * 预加载并应用视图模型 PBR 贴图。可重复调用，第二次直接返回。
   *
   * 贴图由注入的素材加载器缓存和释放，视图模型只引用；释放时不去 dispose
   * 这些共享贴图，避免影响环境等其他消费方。
   *
   * @param {unknown} loader
   * @returns {Promise<void>}
   */
  async function loadTextures(loader) {
    if (disposed) {
      return;
    }
    if (texturesLoaded) {
      return;
    }
    if (!isAssetLoader(loader)) {
      throw new TypeError(
        'view-model.loadTextures 需要提供 loadManifest() 与 loadTexture() 的素材加载器'
      );
    }
    const manifest = await loader.loadManifest();
    if (manifest === null || typeof manifest !== 'object') {
      throw new TypeError('素材清单必须是对象');
    }
    const textures = /** @type {Record<string, unknown>} */ (manifest).textures;
    if (textures === null || typeof textures !== 'object') {
      throw new TypeError('素材清单缺少 textures 字段');
    }
    const groups = /** @type {Record<string, unknown>} */ (textures);

    await applyMaterialGroup(
      loader,
      groups.metal,
      [
        { material: receiverMaterial, tint: VIEW_MODEL_TEXTURE_TINTS.receiver },
        { material: barrelMaterial, tint: VIEW_MODEL_TEXTURE_TINTS.barrel }
      ],
      true
    );
    await applyMaterialGroup(
      loader,
      groups.steel,
      [
        { material: railMaterial, tint: VIEW_MODEL_TEXTURE_TINTS.rail },
        { material: wearMaterial, tint: VIEW_MODEL_TEXTURE_TINTS.wear }
      ],
      true
    );
    await applyMaterialGroup(
      loader,
      groups.wood,
      [{ material: woodMaterial }],
      false,
      false
    );
    await applyMaterialGroup(
      loader,
      groups.fabric,
      [{ material: gloveMaterial }, { material: sleeveMaterial }],
      false,
      false
    );

    texturesLoaded = true;
  }

  /* ---------------------------------------------------------------------- */
  /* 实例 API                                                                */
  /* ---------------------------------------------------------------------- */

  root.position.set(
    VIEW_CONFIG.hipPosition.x,
    VIEW_CONFIG.hipPosition.y,
    VIEW_CONFIG.hipPosition.z
  );
  root.rotation.set(0, 0, 0);
  root.scale.set(VIEW_MODEL_SCALE, VIEW_MODEL_SCALE, VIEW_MODEL_SCALE);

  /**
   * @param {number} deltaSeconds
   * @param {Object} [input]
   * @returns {void}
   */
  function update(deltaSeconds, input) {
    if (disposed) {
      return;
    }
    updateViewState(state, deltaSeconds, input);
    applySceneState();
  }

  /**
   * @returns {{ position: {x:number,y:number,z:number}, velocity: {x:number,y:number,z:number} } | null}
   */
  function triggerFire() {
    if (disposed) {
      return null;
    }
    triggerViewFire(state);
    applySceneState();
    return getShellEjectPayload();
  }

  /**
   * @returns {{ x: number, y: number, z: number }}
   */
  function getMuzzleWorldPosition() {
    root.updateMatrixWorld(true);
    muzzleAnchor.getWorldPosition(worldVector);
    return { x: worldVector.x, y: worldVector.y, z: worldVector.z };
  }

  /**
   * @param {boolean} visible
   * @returns {void}
   */
  function setVisible(visible) {
    root.visible = visible === true;
  }

  /**
   * @returns {void}
   */
  function reset() {
    if (disposed) {
      return;
    }
    resetViewState(state);
    root.position.set(
      VIEW_CONFIG.hipPosition.x,
      VIEW_CONFIG.hipPosition.y,
      VIEW_CONFIG.hipPosition.z
    );
    root.rotation.set(0, 0, 0);
    root.visible = true;
    for (const smokeMesh of smokeMeshes) {
      smokeMesh.visible = false;
      smokeMesh.material.opacity = 0;
    }
    for (const shellMesh of shellMeshes) {
      shellMesh.visible = false;
    }
    flash.visible = false;
    flashCone.visible = false;
    leftHand.group.position.set(
      LEFT_HAND_BASE.position.x,
      LEFT_HAND_BASE.position.y,
      LEFT_HAND_BASE.position.z
    );
    leftHand.group.rotation.set(
      LEFT_HAND_BASE.rotation.x,
      LEFT_HAND_BASE.rotation.y,
      LEFT_HAND_BASE.rotation.z
    );
    leftHand.fingers.rotation.x = 0;
    magazine.position.set(MAGAZINE_BASE.x, MAGAZINE_BASE.y, MAGAZINE_BASE.z);
    magazine.visible = true;
    chargingHandle.position.set(CHARGING_BASE.x, CHARGING_BASE.y, CHARGING_BASE.z);
  }

  /**
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    try {
      renderer.detachFromCamera(root);
    } catch (error) {
      console.error('combat: 从相机取下第一人称视图模型失败', error);
    }
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const material of materials) {
      material.dispose();
    }
    geometries.length = 0;
    materials.length = 0;
    root.clear();
  }

  renderer.attachToCamera(root);

  return {
    root,
    update,
    triggerFire,
    getMuzzleWorldPosition,
    loadTextures,
    setVisible,
    reset,
    dispose,
    getState() {
      return state;
    }
  };
}
