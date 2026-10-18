/**
 * DUSTLINE 共享游戏数值。
 *
 * 这里的数值是所有层共同遵守的唯一来源：战斗、敌方、环境、界面和 Pipeline
 * 都从这里读取，不允许各自复制一份。
 *
 * 标注“设计 §12.2”的数值来自已确认的 v3 设计文档（人类士兵）；设计未给出
 * 具体数字、但实现必须统一调参的项（弹丸速度、射击间隔、镜头/视图参数、
 * 性能采样等），在这里给出实现默认值，后续调整只改本文件。
 */

/**
 * 敌人类型标识。字符串本身不是事件名，集中在这里避免各层各写一份。
 *
 * HUD 中文名称（步枪兵 / 重机枪手 / 突击兵）由界面层映射，不放在配置里，
 * 避免同一份展示文案在两个角色中重复维护。
 */
export const ENEMY_TYPES = Object.freeze({
  RIFLEMAN: 'rifleman',
  HEAVY: 'heavy',
  BREACHER: 'breacher'
});

/** 设置项字段顺序与合法字段集合。 */
const SETTING_KEYS = Object.freeze([
  'mouseSensitivity',
  'adsSensitivityMultiplier',
  'fov',
  'masterVolume',
  'quality'
]);

// 对外同时保留 v2 的扁平后坐力字段和 v3 的分组字段；用同一组常量避免两处漂移。
const RECOIL_PITCH_KICK = 0.012;
const RECOIL_RECOVERY_RATE = 8;
const ADS_RECOIL_MULTIPLIER = 0.55;
const ADS_TRANSITION_RATE = 14;
// 基础垂直视野（度）；设置中的默认 FOV 与菜单/默认相机共用同一数值。
const DEFAULT_FOV = 75;

/**
 * 递归冻结对象与数组，确保共享配置不会被任何一层意外修改。
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

/** @type {Readonly<Record<string, unknown>>} */
export const GAME_CONFIG = deepFreeze({
  player: {
    // 设计 §2.1：生命 100，受伤 5 秒后以 8/秒恢复；眼高 1.68。
    // 移动、跳跃、重力和碰撞半径是设计未给出数字的实现默认值。
    speed: 5.6,
    sprintMultiplier: 1.55,
    jumpVelocity: 6.2,
    gravity: 20,
    eyeHeight: 1.68,
    radius: 0.45,
    health: 100,
    maxHealth: 100,
    regenDelay: 5,
    regenRate: 8
  },

  weapon: {
    // 设计 §2.1：0.095 秒/发，弹匣 30，换弹 1.5 秒，伤害 26，
    // 腰射散布 0.012 弧度，移动时略微增大，后坐力有抬升并自动回正。
    fireInterval: 0.095,
    magazineSize: 30,
    reloadDuration: 1.5,
    damage: 26,
    // 设计 §12.2：头部命中 2 倍伤害。敌方服务从 `enemies.headshotMultiplier`
    // 读取同一语义；这里保留 `criticalMultiplier` 作为旧名称，数值必须一致。
    criticalMultiplier: 2,
    hipSpread: 0.012,
    // 移动时在腰射散布上追加的弧度；设计只要求“略微增大”，数值为实现默认。
    movingSpreadIncrease: 0.006,
    // 每发抬升的俯仰角（弧度）与每秒回正速度（弧度/秒），为实现默认值。
    recoilPitchKick: RECOIL_PITCH_KICK,
    recoilRecoveryRate: RECOIL_RECOVERY_RATE,
    // 命中扫描最大距离（米），为实现默认值。
    range: 120,

    // 设置项在战斗侧的基础值：最终视角灵敏度 =
    // lookSensitivity × settings.mouseSensitivity ×（ADS 时 adsSensitivityMultiplier）。
    lookSensitivity: 0.0022,

    // O1 右键瞄准：对基础视野、散布、后坐力和移动速度的乘数。
    ads: {
      fovMultiplier: 0.72,
      spreadMultiplier: 0.35,
      recoilMultiplier: ADS_RECOIL_MULTIPLIER,
      moveSpeedMultiplier: 0.6,
      // ADS 姿态过渡速度（1/秒），为实现默认值。
      transitionRate: ADS_TRANSITION_RATE
    },

    // 设计 §12.3：垂直抬升 + 轻微水平漂移 + 镜头滚转，松手后平滑回正。
    // 角度的单位是弧度；这些是实现默认值，集中在这里供战斗/渲染消费。
    recoil: {
      pitchKick: RECOIL_PITCH_KICK,
      yawKick: 0.004,
      rollKick: 0.006,
      recoveryRate: RECOIL_RECOVERY_RATE,
      maxPitch: 0.16,
      adsMultiplier: ADS_RECOIL_MULTIPLIER
    },

    // 每发的镜头震动与 FOV 冲击（设计 §12.3）。
    cameraShake: {
      amplitude: 0.0025,
      frequencyHz: 24,
      duration: 0.07
    },
    fovPunch: {
      kickDegrees: 1.2,
      recoveryRate: 16,
      adsMultiplier: 0.6
    },

    // 第一人称视图模型的缩放与姿态（相机局部坐标）。数值与 v2 实现一致。
    viewModel: {
      scale: 0.85,
      hipPosition: { x: 0.27, y: -0.28, z: -0.58 },
      adsPosition: { x: 0, y: -0.095, z: -0.42 },
      sprintPosition: { x: 0.34, y: -0.34, z: -0.5 },
      muzzlePosition: { x: 0.02, y: 0.02, z: -0.72 },
      shellEjectOffset: { x: 0.12, y: 0.02, z: -0.16 }
    },

    // 抛壳：位置由视图模型提供，初速度与重力用于短寿命动画。
    shellEject: {
      lifetime: 0.9,
      size: 0.012,
      sideSpeed: 1.8,
      upSpeed: 1.2,
      gravity: 9.8
    },

    // 分层枪声参数（设计 §12.3）：高频爆裂、低频枪身、尾部回声；
    // 音频服务负责解释这些数值并合成，不在音频实现中另写一份。
    audio: {
      shot: {
        crack: { frequency: 2200, gain: 0.35, duration: 0.05 },
        body: { frequency: 220, gain: 0.5, duration: 0.12 },
        tail: { frequency: 90, gain: 0.3, duration: 0.25 },
        pitchJitter: 0.06,
        gainJitter: 0.05
      },
      shellDrop: { frequency: 1800, gain: 0.12, duration: 0.04 },
      headshot: { frequency: 1600, gain: 0.3, duration: 0.08 }
    }
  },

  enemies: {
    // 设计 §12.2：头部命中 2 倍伤害；头/身独立命中盒，不对骨骼网格逐三角检测。
    headshotMultiplier: 2,

    // GLB 相对 URL，相对于 `resource/` 根；不要写绝对路径。
    // 美术角色的 `resource/asset-manifest.json` v3 应登记同样的键与文件。
    modelPaths: {
      adventurer: 'models/quaternius-adventurer.glb',
      'woman-casual': 'models/quaternius-woman-casual.glb',
      'woman-formal': 'models/quaternius-woman-formal.glb',
      'man-base': 'models/quaternius-man-base.glb'
    },

    // 期望动画剪辑名。实际剪辑名以美术验证结果为准；敌方服务负责映射与
    // 缺失回退（例如缺少 `Run_Shoot` 时退回 `Run` + `Gun_Shoot`）。
    animationNames: {
      rifleman: {
        idle: 'Idle_Gun',
        walk: 'Walk',
        run: 'Run',
        runShoot: 'Run_Shoot',
        shoot: 'Gun_Shoot',
        hit: 'HitRecieve',
        death: 'Death'
      },
      heavy: {
        idle: 'Idle_Gun',
        walk: 'Walk',
        run: 'Run',
        runShoot: 'Run_Shoot',
        shoot: 'Gun_Shoot',
        hit: 'HitRecieve',
        death: 'Death'
      },
      breacher: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        attackLeft: 'Punch_Left',
        attackRight: 'Punch_Right',
        hit: 'HitRecieve',
        death: 'Death'
      }
    },

    rifleman: {
      // 设计 §12.2：生命 70，速度 5.0，保持 9–16 米，点射 7 伤害，100 分。
      health: 70,
      speed: 5.0,
      keepDistanceMin: 9,
      keepDistanceMax: 16,
      damage: 7,
      score: 100,
      color: 0x8a927a,
      projectileSpeed: 34,
      burstShots: 3,
      // 同一轮点射内相邻两发间隔（秒），为实现默认值。
      burstInterval: 0.12,
      fireInterval: 1.8,
      modelPool: ['adventurer', 'woman-casual', 'woman-formal'],
      melee: false,
      armored: false,
      // 命中盒尺寸相对敌人脚底原点；服务按 1 倍使用。
      hitbox: {
        head: { width: 0.28, height: 0.28, depth: 0.28, offsetY: 1.62 },
        body: { width: 0.62, height: 1.12, depth: 0.38, offsetY: 0.98 }
      }
    },

    heavy: {
      // 设计 §12.2：生命 200，速度 2.8，保持 6–10 米，三连发每发 11 伤害，
      // 300 分；Adventurer 放大 1.12 并加装重甲。
      health: 200,
      speed: 2.8,
      keepDistanceMin: 6,
      keepDistanceMax: 10,
      damage: 11,
      score: 300,
      color: 0x5f6650,
      projectileSpeed: 30,
      burstShots: 3,
      burstInterval: 0.14,
      fireInterval: 2.6,
      modelPool: ['adventurer'],
      scale: 1.12,
      melee: false,
      armored: true,
      // 基础命中盒与步枪兵相同；敌方服务按 `scale` 一并放大。
      hitbox: {
        head: { width: 0.28, height: 0.28, depth: 0.28, offsetY: 1.62 },
        body: { width: 0.62, height: 1.12, depth: 0.38, offsetY: 0.98 }
      }
    },

    breacher: {
      // 设计 §12.2：生命 85，速度 7.2，近战 14 伤害，1.2 秒冷却，150 分；
      // Man 基础模型，不持长枪。
      health: 85,
      speed: 7.2,
      contactDamage: 14,
      contactCooldown: 1.2,
      score: 150,
      color: 0x9a6b4f,
      modelPool: ['man-base'],
      melee: true,
      armored: false,
      hitbox: {
        head: { width: 0.28, height: 0.28, depth: 0.28, offsetY: 1.62 },
        body: { width: 0.62, height: 1.12, depth: 0.38, offsetY: 0.98 }
      }
    }
  },

  waves: {
    // 设计 §2.1：第 n 波数量 min(4 + round(1.8n), 32)；
    // 生成间隔 0.55 秒；波次间隔 4.5 秒。v3 沿用数量与间隔。
    firstWave: 1,
    countBase: 4,
    countGrowth: 1.8,
    maxCount: 32,
    spawnInterval: 0.55,
    waveInterval: 4.5,
    // 设计 §12.2 的 v3 占比：第 1 波仅步枪兵；第 2 波 0.8/0.2；
    // 第 3 波起 0.55/0.2/0.25。maxWave 为 null 表示延续到更高波次。
    typeShares: [
      { minWave: 1, maxWave: 1, rifleman: 1, heavy: 0, breacher: 0 },
      { minWave: 2, maxWave: 2, rifleman: 0.8, heavy: 0.2, breacher: 0 },
      { minWave: 3, maxWave: null, rifleman: 0.55, heavy: 0.2, breacher: 0.25 }
    ],
    // 每波生命 +10%、伤害 +5%、速度 +2%；生命最多 3 倍、速度最多 +25%、伤害最多 2 倍。
    scaling: {
      healthPerWave: 0.1,
      damagePerWave: 0.05,
      speedPerWave: 0.02,
      maxHealthMultiplier: 3,
      maxSpeedMultiplier: 1.25,
      maxDamageMultiplier: 2
    }
  },

  arena: {
    // 设计 §2.1：60 × 60 米；边缘 22–28 米生成；距玩家至少 10 米。
    width: 60,
    depth: 60,
    halfWidth: 30,
    halfDepth: 30,
    spawnMinRadius: 22,
    spawnMaxRadius: 28,
    minPlayerDistance: 10,
    // 设计 §2.1：18% 掉落生命球，恢复 30 生命，25 秒后消失。
    pickupDropChance: 0.18,
    pickupHealAmount: 30,
    pickupLifetime: 25,
    pickupRadius: 0.8
  },

  match: {
    // 设计 §4.8：delta 上限 0.05 秒。
    deltaClamp: 0.05,
    // HUD 刷新间隔（秒），实现默认值。
    hudUpdateInterval: 0.05,
    // 基础垂直视野（度）。v3 中玩家可在设置里调整 FOV；
    // 这里保留默认值，运行时以 `settings.fov` 为准。
    cameraFov: DEFAULT_FOV,
    initialScore: 0,
    initialKills: 0,
    initialWave: 1,
    // 击杀顿帧上限（秒）。设计 §12.3 要求“短暂顿帧”，实现为 0.05 秒。
    killHitstop: 0.05,
    // FPS 平滑系数（0–1）：越大越跟手，越小越平稳；这是运行时仪表，不是性能承诺。
    performance: {
      fpsSmoothing: 0.1
    },
    // O3 菜单环绕镜头，参数为实现默认值。
    menuCamera: {
      center: { x: 0, y: 0, z: 0 },
      radius: 26,
      height: 12,
      orbitSpeed: 0.12,
      lookAtHeight: 2
    }
  },

  // 设计 §12.3 设置项与 v3 调度记录 §V3-2 的冻结契约。
  settings: {
    defaults: {
      mouseSensitivity: 1.0,
      adsSensitivityMultiplier: 0.8,
      fov: DEFAULT_FOV,
      masterVolume: 0.7,
      quality: 'high'
    },
    ranges: {
      mouseSensitivity: { min: 0.25, max: 3.0 },
      adsSensitivityMultiplier: { min: 0.4, max: 1.5 },
      fov: { min: 65, max: 95 },
      masterVolume: { min: 0, max: 1 },
      quality: { allowed: ['high', 'low'] }
    }
  }
});

/**
 * 校验波次编号。
 *
 * @param {number} wave
 * @returns {number}
 */
function assertWave(wave) {
  if (!Number.isInteger(wave) || wave < GAME_CONFIG.waves.firstWave) {
    throw new TypeError('wave 必须是大于等于 ' + GAME_CONFIG.waves.firstWave + ' 的整数');
  }
  return wave;
}

/**
 * 计算第 n 波敌人数：`min(4 + round(1.8n), 32)`。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @returns {number}
 */
export function getWaveEnemyCount(wave) {
  assertWave(wave);
  const waves = GAME_CONFIG.waves;
  const rawCount = waves.countBase + Math.round(waves.countGrowth * wave);
  return Math.min(rawCount, waves.maxCount);
}

/**
 * 计算第 n 波的敌人缩放乘数。
 *
 * 第 1 波为 1 倍；之后每波生命 +10%、伤害 +5%、速度 +2%，
 * 并分别受 3 倍、2 倍、+25% 的上限约束。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @returns {Readonly<{
 *   wave: number,
 *   healthMultiplier: number,
 *   speedMultiplier: number,
 *   damageMultiplier: number
 * }>}
 */
export function getEnemyScaling(wave) {
  assertWave(wave);
  const scaling = GAME_CONFIG.waves.scaling;
  const steps = wave - GAME_CONFIG.waves.firstWave;

  const healthMultiplier = Math.min(
    1 + scaling.healthPerWave * steps,
    scaling.maxHealthMultiplier
  );
  const speedMultiplier = Math.min(
    1 + scaling.speedPerWave * steps,
    scaling.maxSpeedMultiplier
  );
  const damageMultiplier = Math.min(
    1 + scaling.damagePerWave * steps,
    scaling.maxDamageMultiplier
  );

  return Object.freeze({ wave, healthMultiplier, speedMultiplier, damageMultiplier });
}

/**
 * 返回第 n 波的敌人类型占比。占比之和为 1。
 *
 * @param {number} wave 从 1 开始的波次编号。
 * @returns {Readonly<Record<'rifleman'|'heavy'|'breacher', number>>}
 */
export function getEnemyTypeShares(wave) {
  assertWave(wave);
  const bands = GAME_CONFIG.waves.typeShares;

  for (const band of bands) {
    const aboveMinimum = wave >= band.minWave;
    const belowMaximum = band.maxWave === null || wave <= band.maxWave;
    if (aboveMinimum && belowMaximum) {
      const shares = {};
      for (const type of Object.values(ENEMY_TYPES)) {
        shares[type] = band[type];
      }
      return Object.freeze(shares);
    }
  }

  throw new RangeError('找不到第 ' + wave + ' 波的敌人类型分布');
}

/**
 * 校验并夹紧单个设置项。
 *
 * - 有限数字超出范围时夹到最近的边界；
 * - 非数字、`NaN`、`Infinity` 抛出 `TypeError`；
 * - `quality` 只接受配置里列出的值，其他值抛出 `RangeError`。
 *
 * @param {string} key 设置项名称。
 * @param {unknown} value 待校验的值。
 * @returns {number|string}
 */
export function clampSetting(key, value) {
  if (typeof key !== 'string' || !SETTING_KEYS.includes(key)) {
    throw new TypeError('未知设置项：' + String(key));
  }

  if (key === 'quality') {
    const allowed = GAME_CONFIG.settings.ranges.quality.allowed;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new RangeError('quality 必须是 ' + allowed.join(' 或 '));
    }
    return value;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(key + ' 必须是有限数字');
  }

  const range = GAME_CONFIG.settings.ranges[key];
  if (value < range.min) {
    return range.min;
  }
  if (value > range.max) {
    return range.max;
  }
  return value;
}

/**
 * 把部分设置归一化为完整、冻结的设置对象。
 *
 * 未提供的字段使用 `GAME_CONFIG.settings.defaults`；未知字段忽略。
 * 非法类型抛错而不是静默回退，避免把坏值写进运行时状态。
 *
 * @param {Partial<{
 *   mouseSensitivity: number,
 *   adsSensitivityMultiplier: number,
 *   fov: number,
 *   masterVolume: number,
 *   quality: 'high'|'low'
 * }>} [partial]
 * @returns {Readonly<{
 *   mouseSensitivity: number,
 *   adsSensitivityMultiplier: number,
 *   fov: number,
 *   masterVolume: number,
 *   quality: 'high'|'low'
 * }>}
 */
export function normalizeSettings(partial) {
  let source = {};
  if (partial !== undefined && partial !== null) {
    if (typeof partial !== 'object' || Array.isArray(partial)) {
      throw new TypeError('settings 必须是对象');
    }
    source = /** @type {Record<string, unknown>} */ (partial);
  }

  const defaults = GAME_CONFIG.settings.defaults;
  const result = {};
  for (const key of SETTING_KEYS) {
    let value = defaults[key];
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      value = clampSetting(key, source[key]);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
