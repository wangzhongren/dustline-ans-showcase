/**
 * 敌方能量弹丸：可见的暖红/橙色慢速弹丸，负责移动、生命周期与碰撞。
 *
 * 弹丸只做几何移动与碰撞判断，不直接修改玩家生命：命中玩家时返回状态，
 * 由 `enemy-manager.js` 统一发出 `player:damage` 事件。
 *
 * 碰撞对象：
 * - 竞技场地面（y ≤ 0）。
 * - 竞技场边界（`GAME_CONFIG.arena.halfWidth/halfDepth`）。
 * - 竞技场障碍物 AABB（`Collider` 数组，只读）。
 * - 玩家圆柱（水平半径 0.45、高度 1.68，来自共享配置与玩家快照）。
 */

import {
  Mesh,
  SphereGeometry,
  MeshStandardMaterial
} from '../../../providers/public/three.js';
import { GAME_CONFIG } from '../../../models/game-config.js';
import { disposeObject3D } from './human-visual.js';

/** 弹丸状态。 */
export const PROJECTILE_STATUS = Object.freeze({
  FLYING: 'flying',
  PLAYER: 'player',
  BLOCKED: 'blocked',
  EXPIRED: 'expired'
});

/** 敌方曳光弹的默认暖橙色，供 `world:enemy-shot` 事件使用。 */
export const ENEMY_TRACER_COLOR = 0xffb15a;

/** 表现参数：弹丸半径、寿命与暖橙色。 */
const PROJECTILE_CONFIG = Object.freeze({
  radius: 0.09,
  lifetime: 6,
  color: ENEMY_TRACER_COLOR,
  emissive: 0xff7a2a,
  emissiveIntensity: 1.05
});

/**
 * 判断弹丸球心是否进入某个碰撞盒。
 *
 * @param {{x:number,y:number,z:number}} position
 * @param {number} radius
 * @param {{min:{x:number,y:number,z:number},max:{x:number,y:number,z:number}}} collider
 * @returns {boolean}
 */
function isInsideCollider(position, radius, collider) {
  return (
    position.x + radius > collider.min.x &&
    position.x - radius < collider.max.x &&
    position.y + radius > collider.min.y &&
    position.y - radius < collider.max.y &&
    position.z + radius > collider.min.z &&
    position.z - radius < collider.max.z
  );
}

/**
 * 线段与膨胀后的 AABB 是否相交（slab 方法）。
 *
 * 弹丸速度较快（34 m/s），单帧位移可能超过目标厚度；只检查终点会穿透，
 * 因此对移动前/后的线段做扫掠检测。
 *
 * @param {{x:number,y:number,z:number}} start
 * @param {{x:number,y:number,z:number}} end
 * @param {number} radius
 * @param {{min:{x:number,y:number,z:number},max:{x:number,y:number,z:number}}} collider
 * @returns {boolean}
 */
function segmentHitsCollider(start, end, radius, collider) {
  let tMin = 0;
  let tMax = 1;
  const axes = ['x', 'y', 'z'];

  for (const axis of axes) {
    const origin = start[axis];
    const delta = end[axis] - origin;
    const min = collider.min[axis] - radius;
    const max = collider.max[axis] + radius;

    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) {
        return false;
      }
      continue;
    }

    let entry = (min - origin) / delta;
    let exit = (max - origin) / delta;
    if (entry > exit) {
      const swap = entry;
      entry = exit;
      exit = swap;
    }
    if (entry > tMin) {
      tMin = entry;
    }
    if (exit < tMax) {
      tMax = exit;
    }
    if (tMin > tMax) {
      return false;
    }
  }
  return true;
}

/**
 * 判断弹丸线段是否与玩家圆柱相交。
 *
 * @param {{x:number,y:number,z:number}} start
 * @param {{x:number,y:number,z:number}} end
 * @param {number} radius
 * @param {{x:number,y:number,z:number,eyeHeight:number}} player
 * @returns {boolean}
 */
function segmentHitsPlayer(start, end, radius, player) {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const offsetX = start.x - player.x;
  const offsetZ = start.z - player.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;

  let t = 0;
  if (lengthSquared > 1e-9) {
    t = -(offsetX * deltaX + offsetZ * deltaZ) / lengthSquared;
    if (t < 0) {
      t = 0;
    }
    if (t > 1) {
      t = 1;
    }
  }

  const closestX = start.x + deltaX * t;
  const closestZ = start.z + deltaZ * t;
  const horizontalDistance = Math.hypot(closestX - player.x, closestZ - player.z);
  const playerRadius = GAME_CONFIG.player.radius + radius;
  if (horizontalDistance > playerRadius) {
    return false;
  }

  const closestY = start.y + (end.y - start.y) * t;
  const bottom = player.y - radius;
  const top = player.y + player.eyeHeight + radius;
  return closestY >= bottom && closestY <= top;
}

/**
 * 创建一枚敌方弹丸。
 *
 * @param {{
 *   position: { x:number, y:number, z:number },
 *   direction: { x:number, y:number, z:number },
 *   speed: number,
 *   damage: number,
 *   color?: number,
 *   enemyType?: string
 * }} options
 * @returns {{
 *   mesh: Mesh,
 *   damage: number,
 *   getPosition: () => { x:number, y:number, z:number },
 *   update: (dt:number, context:Object) => string,
 *   dispose: () => void
 * }}
 */
export function createProjectile(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createProjectile 需要 options 对象');
  }
  const { position, direction, speed, damage } = options;
  if (position === null || typeof position !== 'object') {
    throw new TypeError('createProjectile: position 必须是对象');
  }
  if (direction === null || typeof direction !== 'object') {
    throw new TypeError('createProjectile: direction 必须是对象');
  }
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    throw new RangeError('createProjectile: speed 必须是大于 0 的有限数字');
  }
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage < 0) {
    throw new RangeError('createProjectile: damage 必须是非负有限数字');
  }

  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-6) {
    throw new RangeError('createProjectile: direction 不能是零向量');
  }

  let color = PROJECTILE_CONFIG.color;
  if (typeof options.color === 'number' && Number.isFinite(options.color)) {
    color = options.color;
  }

  const geometry = new SphereGeometry(PROJECTILE_CONFIG.radius, 10, 8);
  const material = new MeshStandardMaterial({
    color,
    emissive: PROJECTILE_CONFIG.emissive,
    emissiveIntensity: PROJECTILE_CONFIG.emissiveIntensity,
    roughness: 0.42,
    metalness: 0.05
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(position.x, position.y, position.z);
  const sourcePosition = {
    x: position.x,
    y: position.y,
    z: position.z
  };

  const velocity = {
    x: (direction.x / length) * speed,
    y: (direction.y / length) * speed,
    z: (direction.z / length) * speed
  };
  let remainingLifetime = PROJECTILE_CONFIG.lifetime;

  /**
   * @param {number} dt
   * @param {{
   *   colliders: Array<{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }>,
   *   player: { x:number, y:number, z:number, eyeHeight:number, alive:boolean }
   * }} context
   * @returns {string}
   */
  function update(dt, context) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      return PROJECTILE_STATUS.FLYING;
    }

    remainingLifetime -= dt;
    if (remainingLifetime <= 0) {
      return PROJECTILE_STATUS.EXPIRED;
    }

    const previous = {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z
    };
    mesh.position.x += velocity.x * dt;
    mesh.position.y += velocity.y * dt;
    mesh.position.z += velocity.z * dt;

    if (mesh.position.y <= PROJECTILE_CONFIG.radius) {
      return PROJECTILE_STATUS.BLOCKED;
    }
    if (
      Math.abs(mesh.position.x) > GAME_CONFIG.arena.halfWidth ||
      Math.abs(mesh.position.z) > GAME_CONFIG.arena.halfDepth
    ) {
      return PROJECTILE_STATUS.BLOCKED;
    }

    for (const collider of context.colliders) {
      if (
        isInsideCollider(mesh.position, PROJECTILE_CONFIG.radius, collider) ||
        segmentHitsCollider(previous, mesh.position, PROJECTILE_CONFIG.radius, collider)
      ) {
        return PROJECTILE_STATUS.BLOCKED;
      }
    }

    if (
      context.player.alive &&
      segmentHitsPlayer(previous, mesh.position, PROJECTILE_CONFIG.radius, context.player)
    ) {
      return PROJECTILE_STATUS.PLAYER;
    }

    return PROJECTILE_STATUS.FLYING;
  }

  return {
    mesh,
    damage,
    getPosition: function getPosition() {
      return {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z
      };
    },
    getSourcePosition: function getSourcePosition() {
      return {
        x: sourcePosition.x,
        y: sourcePosition.y,
        z: sourcePosition.z
      };
    },
    update,
    dispose: function dispose() {
      disposeObject3D(mesh);
    }
  };
}
