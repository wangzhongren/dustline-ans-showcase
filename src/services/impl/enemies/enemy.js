/**
 * 单个敌人：人类士兵 AI、生命、受击与死亡。
 *
 * 视觉部分全部委托给 `human-visual.js`：GLB 骨骼模型、程序化战术装具、
 * AnimationMixer 动画与头/身命中盒。本文件只负责玩法：
 * - 步枪兵：保持 9–16 米，侧向移动，三发点射。
 * - 重机枪手：保持 6–10 米，缓慢逼近，三发点射，体量与护甲更大。
 * - 突击兵：快速贴近，近战拳击。
 *
 * 所有玩法数值来自 `GAME_CONFIG`；设计未给出数字的节奏（点射间隔、换弹时长、
 * 侧移切换、碰撞半径等）集中在 `ENEMY_BEHAVIOR`，便于后续调参。
 *
 * 本模块只被 `enemy-manager.js` 使用；不导入其他 Service、Pipeline、Interface，
 * 也不直接导入 `three`。弹丸由管理器通过回调注入。
 */

import { ENEMY_TYPES, GAME_CONFIG } from '../../../models/game-config.js';
import {
  createHumanVisual,
  disposeObject3D
} from './human-visual.js';
import { ENEMY_TRACER_COLOR } from './projectile.js';

export { disposeObject3D };

/** 表现与行为参数。 */
const ENEMY_BEHAVIOR = Object.freeze({
  // 开火距离 = 保持距离上限 + 4 米；设计未单列，作为实现默认值。
  fireRangeMargin: 4,
  strafeMinDuration: 1.4,
  strafeMaxDuration: 2.9,
  retreatFactor: 0.8,
  bandStrafeFactor: 0.55,
  heavyApproachFactor: 0.32,
  contactPadding: 0.15,
  // 点射结束后换弹：这段时间停止射击，视觉上压低枪口。
  riflemanReloadDuration: 1.2,
  heavyReloadDuration: 1.6,
  // 首次开火的准备时间（秒），以基础射击间隔的比例表示。
  firstShotDelayFactor: 0.6,
  // 不在射程内时的重新检查间隔（秒）。
  outOfRangeRetry: 0.4,
  // 点射伤害的提示方向使用敌人胸口高度。
  sourceHeight: 1.2,
  // 玩家快照缺失眼睛高度时的兜底。
  defaultEyeHeight: 1.68
});

/**
 * 各兵种的碰撞半径与高度（米）。设计未给出，作为实现默认值。
 */
const COLLISION = Object.freeze({
  rifleman: Object.freeze({ radius: 0.4, height: 1.85 }),
  heavy: Object.freeze({ radius: 0.5, height: 2.05 }),
  breacher: Object.freeze({ radius: 0.38, height: 1.8 })
});

/**
 * 判断水平位置是否与任一碰撞盒重叠（含垂直区间）。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {number} bottom
 * @param {number} top
 * @param {Array<{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }>} colliders
 * @returns {boolean}
 */
function collidesAt(x, z, radius, bottom, top, colliders) {
  for (const collider of colliders) {
    const overlapsHorizontally =
      x + radius > collider.min.x &&
      x - radius < collider.max.x &&
      z + radius > collider.min.z &&
      z - radius < collider.max.z;
    const overlapsVertically = collider.min.y < top && collider.max.y > bottom;
    if (overlapsHorizontally && overlapsVertically) {
      return true;
    }
  }
  return false;
}

/**
 * 轴分离滑动：先尝试 X，再尝试 Z。被挡住的轴取消位移，另一轴仍可移动。
 *
 * @param {Object} root
 * @param {number} deltaX
 * @param {number} deltaZ
 * @param {number} radius
 * @param {number} bottom
 * @param {number} top
 * @param {Array<{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }>} colliders
 * @returns {void}
 */
function moveWithSlide(root, deltaX, deltaZ, radius, bottom, top, colliders) {
  if (deltaX !== 0) {
    const candidateX = root.position.x + deltaX;
    if (!collidesAt(candidateX, root.position.z, radius, bottom, top, colliders)) {
      root.position.x = candidateX;
    }
  }
  if (deltaZ !== 0) {
    const candidateZ = root.position.z + deltaZ;
    if (!collidesAt(root.position.x, candidateZ, radius, bottom, top, colliders)) {
      root.position.z = candidateZ;
    }
  }
}

/**
 * 把水平方向归一化；长度过小时返回零向量。
 *
 * @param {number} x
 * @param {number} z
 * @returns {{ x: number, z: number }}
 */
function normalizeHorizontal(x, z) {
  const length = Math.hypot(x, z);
  if (length < 1e-6) {
    return { x: 0, z: 0 };
  }
  return { x: x / length, z: z / length };
}

/**
 * 归一化三维方向。
 *
 * @param {{ x:number, y:number, z:number }} vector
 * @returns {{ x:number, y:number, z:number }}
 */
function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 1e-6) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/**
 * 在区间内取随机数。
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * 读取兵种的换弹（点射间隔）时长。
 *
 * @param {string} type
 * @returns {number}
 */
function getReloadDuration(type) {
  if (type === ENEMY_TYPES.HEAVY) {
    return ENEMY_BEHAVIOR.heavyReloadDuration;
  }
  if (type === ENEMY_TYPES.BREACHER) {
    return 0;
  }
  return ENEMY_BEHAVIOR.riflemanReloadDuration;
}

/**
 * 创建一个敌人。
 *
 * @param {{
 *   id: string,
 *   type: string,
 *   modelId?: string,
 *   model?: { scene: Object, animations: unknown[], scale: number }|null,
 *   stats: { health:number, speed:number, damage:number, score:number, color:number },
 *   position: { x:number, y:number, z:number },
 *   capabilities?: { AnimationMixer?: Function, cloneSkinned?: Function }
 * }} options
 * @returns {Object}
 */
export function createEnemy(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createEnemy 需要 options 对象');
  }
  const { id, type, stats, position } = options;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('createEnemy: id 必须是非空字符串');
  }
  if (
    type !== ENEMY_TYPES.RIFLEMAN &&
    type !== ENEMY_TYPES.HEAVY &&
    type !== ENEMY_TYPES.BREACHER
  ) {
    throw new RangeError('createEnemy: 未知敌人类型 ' + String(type));
  }
  if (position === null || typeof position !== 'object') {
    throw new TypeError('createEnemy: position 必须是对象');
  }

  const base = GAME_CONFIG.enemies[type];
  const collision = COLLISION[type];

  let model = options.model;
  if (model === undefined) {
    model = null;
  }
  let modelId = options.modelId;
  if (typeof modelId !== 'string') {
    modelId = base.modelPool[0];
  }

  const visual = createHumanVisual({
    type,
    modelId,
    targetId: id,
    model,
    capabilities: options.capabilities
  });
  const root = visual.root;
  root.position.set(position.x, position.y, position.z);

  const hittableMeshes = visual.listHitboxes();

  let health = stats.health;
  const maxHealth = stats.health;
  let alive = true;
  let strafeTimer = randomBetween(
    ENEMY_BEHAVIOR.strafeMinDuration,
    ENEMY_BEHAVIOR.strafeMaxDuration
  );
  let strafeDirection = 1;
  let burstLeft = 0;
  let shotTimer = base.fireInterval * ENEMY_BEHAVIOR.firstShotDelayFactor;
  let reloading = false;
  let reloadTimer = 0;
  let contactTimer = 0;
  let lastMotion = { speed: 0, moving: false, firing: false };
  const reloadDuration = getReloadDuration(type);

  /**
   * 扣除生命。伤害已由战斗服务按爆头倍数乘算，本方法不再加倍。
   *
   * @param {number} damage
   * @returns {{ killed: boolean, health: number }}
   */
  function applyDamage(damage) {
    if (!alive) {
      return { killed: false, health: health };
    }
    if (typeof damage !== 'number' || !Number.isFinite(damage)) {
      throw new TypeError('敌人受击伤害必须是有限数字');
    }
    let amount = damage;
    if (amount < 0) {
      amount = 0;
    }
    health = Math.max(0, health - amount);
    visual.playHit();
    if (health === 0) {
      alive = false;
      visual.startDeath();
      return { killed: true, health: health };
    }
    return { killed: false, health: health };
  }

  /**
   * 当前枪口世界坐标。突击兵没有步枪，返回胸口位置（只用于近战反馈）。
   *
   * @returns {{ x:number, y:number, z:number }}
   */
  function getMuzzlePosition() {
    const offset = visual.getMuzzleOffset();
    const yaw = root.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return {
      x: root.position.x + offset.x * cos + offset.z * sin,
      y: root.position.y + offset.y,
      z: root.position.z - offset.x * sin + offset.z * cos
    };
  }

  /**
   * 发射一发点射弹丸。
   *
   * @param {{ x:number, y:number, z:number }} player
   * @param {Object} context
   * @returns {void}
   */
  function fireOneShot(player, context) {
    const muzzle = getMuzzlePosition();
    const target = {
      x: player.x,
      y: player.y + player.eyeHeight * 0.6,
      z: player.z
    };
    const direction = normalizeVector({
      x: target.x - muzzle.x,
      y: target.y - muzzle.y,
      z: target.z - muzzle.z
    });
    context.spawnProjectile({
      position: {
        x: muzzle.x + direction.x * 0.35,
        y: muzzle.y + direction.y * 0.35,
        z: muzzle.z + direction.z * 0.35
      },
      direction,
      speed: base.projectileSpeed,
      damage: stats.damage,
      enemyType: type,
      color: ENEMY_TRACER_COLOR
    });
    visual.showMuzzleFlash();
  }

  /**
   * 推进点射、换弹与近战冷却。
   *
   * @param {number} dt
   * @param {{ x:number, y:number, z:number, eyeHeight:number, alive:boolean }} player
   * @param {number} distance
   * @param {Object} context
   * @returns {void}
   */
  function updateAttack(dt, player, distance, context) {
    if (!player.alive) {
      return;
    }

    if (type === ENEMY_TYPES.BREACHER) {
      contactTimer -= dt;
      if (contactTimer < 0) {
        contactTimer = 0;
      }
      const contactRadius =
        GAME_CONFIG.player.radius + collision.radius + ENEMY_BEHAVIOR.contactPadding;
      if (distance <= contactRadius && contactTimer <= 0) {
        context.damagePlayer(stats.damage, {
          x: root.position.x,
          y: root.position.y + ENEMY_BEHAVIOR.sourceHeight,
          z: root.position.z
        });
        contactTimer = base.contactCooldown;
        visual.playAttack();
      }
      return;
    }

    if (reloading) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloading = false;
        reloadTimer = 0;
        shotTimer = base.fireInterval;
      }
      return;
    }

    if (burstLeft > 0) {
      shotTimer -= dt;
      if (shotTimer <= 0) {
        fireOneShot(player, context);
        burstLeft -= 1;
        if (burstLeft > 0) {
          shotTimer = base.burstInterval;
        } else {
          reloading = true;
          reloadTimer = reloadDuration;
        }
      }
      return;
    }

    shotTimer -= dt;
    if (shotTimer > 0) {
      return;
    }
    const fireRange = base.keepDistanceMax + ENEMY_BEHAVIOR.fireRangeMargin;
    if (distance > fireRange) {
      shotTimer = ENEMY_BEHAVIOR.outOfRangeRetry;
      return;
    }
    burstLeft = base.burstShots;
    shotTimer = 0;
  }

  /**
   * 每帧 AI：移动、朝向、射击/近战、动画状态。
   *
   * @param {number} dt
   * @param {{
   *   player: { x:number, y:number, z:number, eyeHeight:number, alive:boolean },
   *   colliders: Array<{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }>,
   *   spawnProjectile: (shot:Object) => void,
   *   damagePlayer: (amount:number, sourcePosition:{x:number,y:number,z:number}) => void
   * }} context
   * @returns {void}
   */
  function update(dt, context) {
    if (!alive) {
      return;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      return;
    }

    const player = context.player;
    const colliders = context.colliders;
    const toPlayerX = player.x - root.position.x;
    const toPlayerZ = player.z - root.position.z;
    const horizontalDistance = Math.hypot(toPlayerX, toPlayerZ);
    const toPlayer = normalizeHorizontal(toPlayerX, toPlayerZ);

    strafeTimer -= dt;
    if (strafeTimer <= 0) {
      strafeDirection = -strafeDirection;
      strafeTimer = randomBetween(
        ENEMY_BEHAVIOR.strafeMinDuration,
        ENEMY_BEHAVIOR.strafeMaxDuration
      );
    }

    let moveX = 0;
    let moveZ = 0;

    if (type === ENEMY_TYPES.BREACHER) {
      moveX = toPlayer.x * stats.speed;
      moveZ = toPlayer.z * stats.speed;
    } else if (horizontalDistance > base.keepDistanceMax) {
      moveX = toPlayer.x * stats.speed;
      moveZ = toPlayer.z * stats.speed;
    } else if (horizontalDistance < base.keepDistanceMin) {
      moveX = -toPlayer.x * stats.speed * ENEMY_BEHAVIOR.retreatFactor;
      moveZ = -toPlayer.z * stats.speed * ENEMY_BEHAVIOR.retreatFactor;
    } else if (type === ENEMY_TYPES.HEAVY) {
      moveX =
        toPlayer.x * stats.speed * ENEMY_BEHAVIOR.heavyApproachFactor +
        -toPlayer.z * stats.speed * ENEMY_BEHAVIOR.bandStrafeFactor * strafeDirection;
      moveZ =
        toPlayer.z * stats.speed * ENEMY_BEHAVIOR.heavyApproachFactor +
        toPlayer.x * stats.speed * ENEMY_BEHAVIOR.bandStrafeFactor * strafeDirection;
    } else {
      moveX = -toPlayer.z * stats.speed * ENEMY_BEHAVIOR.bandStrafeFactor * strafeDirection;
      moveZ = toPlayer.x * stats.speed * ENEMY_BEHAVIOR.bandStrafeFactor * strafeDirection;
    }

    const collisionTop = root.position.y + collision.height;
    const motionSpeed = Math.hypot(moveX, moveZ);

    moveWithSlide(
      root,
      moveX * dt,
      moveZ * dt,
      collision.radius,
      root.position.y,
      collisionTop,
      colliders
    );

    const limitX = GAME_CONFIG.arena.halfWidth - collision.radius;
    const limitZ = GAME_CONFIG.arena.halfDepth - collision.radius;
    root.position.x = Math.min(Math.max(root.position.x, -limitX), limitX);
    root.position.z = Math.min(Math.max(root.position.z, -limitZ), limitZ);

    root.rotation.y = Math.atan2(toPlayerX, toPlayerZ);

    const currentDistance = Math.hypot(
      player.x - root.position.x,
      player.z - root.position.z
    );

    updateAttack(dt, player, currentDistance, context);

    const firing = burstLeft > 0 && !reloading;
    visual.setReloading(reloading);
    visual.setLocomotion({
      speed: motionSpeed,
      moving: motionSpeed > 0.1,
      firing
    });
    lastMotion = {
      speed: motionSpeed,
      moving: motionSpeed > 0.1,
      firing
    };
    visual.update(dt);
  }

  /**
   * 推进尸体动画与淡出。
   *
   * @param {number} dt
   * @returns {boolean} 是否已经可以移除。
   */
  function updateCorpse(dt) {
    if (disposedVisual()) {
      return true;
    }
    visual.update(dt);
    return visual.updateCorpse(dt);
  }

  /**
   * @returns {boolean}
   */
  function disposedVisual() {
    return visual.isDisposed();
  }

  /**
   * 测试与调试用的只读视觉信息。
   *
   * @returns {Object}
   */
  function getVisualInfo() {
    return {
      modelId,
      modelScale: visual.visualScale,
      hitboxScale: visual.hitboxScale,
      fallback: visual.isFallback(),
      clips: visual.clips,
      equipment: visual.getEquipmentNames(),
      currentState: visual.getCurrentState(),
      currentClip: visual.getCurrentClip()
    };
  }

  return {
    id,
    type,
    root,
    color: stats.color,
    score: stats.score,
    damage: stats.damage,
    visual,
    get maxHealth() {
      return maxHealth;
    },
    listHittable: function listHittable() {
      if (!alive) {
        return [];
      }
      return hittableMeshes.slice();
    },
    getHealth: function getHealth() {
      return health;
    },
    getHitPosition: function getHitPosition(part) {
      return visual.getHitPosition(part);
    },
    getSprayDirection: function getSprayDirection() {
      return visual.getSprayDirection();
    },
    getMuzzlePosition,
    getVisualInfo,
    applyDamage,
    update,
    updateCorpse,
    isDead: function isDead() {
      return !alive;
    },
    getLastMotion: function getLastMotion() {
      return {
        speed: lastMotion.speed,
        moving: lastMotion.moving,
        firing: lastMotion.firing
      };
    },
    dispose: function dispose() {
      visual.dispose();
    }
  };
}
