/**
 * 生命拾取物：敌人死亡后按概率掉落的漂浮生命球。
 *
 * 拾取物只负责外观、漂浮、寿命和“玩家是否进入拾取范围”的判断；
 * 实际恢复玩家生命由 Pipeline 在收到 `pickup:collected` 事件后交给战斗服务处理。
 */

import {
  Group,
  Mesh,
  SphereGeometry,
  BoxGeometry,
  MeshStandardMaterial
} from '../../../providers/public/three.js';
import { GAME_CONFIG } from '../../../models/game-config.js';
import { disposeObject3D } from './human-visual.js';

/** 拾取物状态。 */
export const PICKUP_STATUS = Object.freeze({
  ACTIVE: 'active',
  COLLECTED: 'collected',
  EXPIRED: 'expired'
});

/** 表现参数：球体尺寸、离地高度、漂浮与旋转速度。 */
const PICKUP_VISUAL = Object.freeze({
  orbRadius: 0.26,
  hoverOffset: 0.55,
  bobAmplitude: 0.12,
  bobSpeed: 2.4,
  spinSpeed: 1.9,
  orbColor: 0x7d9a5e,
  orbEmissive: 0x4c6a34,
  orbEmissiveIntensity: 0.55,
  crossColor: 0xd8dcd4
});

/**
 * 创建生命拾取物。
 *
 * @param {{
 *   position: { x:number, y:number, z:number },
 *   amount: number
 * }} options `position` 为掉落位置（敌人死亡位置），拾取物会漂浮在其上方。
 * @returns {{
 *   group: Group,
 *   amount: number,
 *   getPosition: () => { x:number, y:number, z:number },
 *   getAge: () => number,
 *   update: (dt:number, playerSnapshot:Object) => string,
 *   dispose: () => void
 * }}
 */
export function createPickup(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('createPickup 需要 options 对象');
  }
  const { position, amount } = options;
  if (position === null || typeof position !== 'object') {
    throw new TypeError('createPickup: position 必须是对象');
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new RangeError('createPickup: amount 必须是大于 0 的有限数字');
  }

  const group = new Group();
  group.position.set(position.x, position.y + PICKUP_VISUAL.hoverOffset, position.z);

  const orbGeometry = new SphereGeometry(PICKUP_VISUAL.orbRadius, 14, 12);
  const orbMaterial = new MeshStandardMaterial({
    color: PICKUP_VISUAL.orbColor,
    emissive: PICKUP_VISUAL.orbEmissive,
    emissiveIntensity: PICKUP_VISUAL.orbEmissiveIntensity,
    roughness: 0.55,
    metalness: 0.15
  });
  const orb = new Mesh(orbGeometry, orbMaterial);
  orb.castShadow = true;
  group.add(orb);

  const crossMaterial = new MeshStandardMaterial({
    color: PICKUP_VISUAL.crossColor,
    roughness: 0.7,
    metalness: 0.1
  });
  const crossHorizontal = new Mesh(
    new BoxGeometry(0.32, 0.075, 0.075),
    crossMaterial
  );
  crossHorizontal.position.z = PICKUP_VISUAL.orbRadius + 0.03;
  const crossVertical = new Mesh(
    new BoxGeometry(0.075, 0.32, 0.075),
    crossMaterial
  );
  crossVertical.position.z = PICKUP_VISUAL.orbRadius + 0.03;
  group.add(crossHorizontal);
  group.add(crossVertical);

  const anchor = {
    x: position.x,
    y: position.y,
    z: position.z
  };
  let age = 0;
  let finished = false;

  /**
   * @param {number} dt
   * @param {{ x:number, y:number, z:number, eyeHeight:number, alive:boolean }} playerSnapshot
   * @returns {string}
   */
  function update(dt, playerSnapshot) {
    if (finished) {
      return PICKUP_STATUS.EXPIRED;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      return PICKUP_STATUS.ACTIVE;
    }

    age += dt;
    if (age >= GAME_CONFIG.arena.pickupLifetime) {
      finished = true;
      return PICKUP_STATUS.EXPIRED;
    }

    group.position.y =
      anchor.y +
      PICKUP_VISUAL.hoverOffset +
      Math.sin(age * PICKUP_VISUAL.bobSpeed) * PICKUP_VISUAL.bobAmplitude;
    group.rotation.y += dt * PICKUP_VISUAL.spinSpeed;

    if (!playerSnapshot.alive) {
      return PICKUP_STATUS.ACTIVE;
    }

    const horizontalDistance = Math.hypot(
      playerSnapshot.x - anchor.x,
      playerSnapshot.z - anchor.z
    );
    if (horizontalDistance > GAME_CONFIG.arena.pickupRadius) {
      return PICKUP_STATUS.ACTIVE;
    }
    const playerTop = playerSnapshot.y + playerSnapshot.eyeHeight;
    const orbBottom = group.position.y - 0.4;
    const orbTop = group.position.y + 0.4;
    const overlapsVertically = orbTop >= playerSnapshot.y && orbBottom <= playerTop;
    if (!overlapsVertically) {
      return PICKUP_STATUS.ACTIVE;
    }

    finished = true;
    return PICKUP_STATUS.COLLECTED;
  }

  return {
    group,
    amount,
    getPosition: function getPosition() {
      return { x: anchor.x, y: anchor.y, z: anchor.z };
    },
    getAge: function getAge() {
      return age;
    },
    update,
    dispose: function dispose() {
      disposeObject3D(group);
    }
  };
}
