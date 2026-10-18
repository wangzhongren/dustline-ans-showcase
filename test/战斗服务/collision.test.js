import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySpreadToDirection,
  clamp,
  clampCircleToBounds,
  isValidCollider,
  moveCircle,
  normalizeVector,
  rayAabbIntersection,
  raycastColliders,
  resolveCircleAabb,
  resolveCircleColliders
} from '../../src/services/impl/combat/collision.js';

const CLOSE = 1e-6;
const BOUNDS = { halfWidth: 30, halfDepth: 30 };

/**
 * @param {{x:number,y:number,z:number}} min
 * @param {{x:number,y:number,z:number}} max
 */
function box(min, max) {
  return { min, max };
}

test('圆形从 -X 侧面接触时沿 X 轴推出，且不再穿透', () => {
  const collider = box({ x: 2, y: 0, z: -1 }, { x: 3, y: 1, z: 1 });
  const result = resolveCircleAabb(1.8, 0, 0.45, collider);

  assert.equal(result.hit, true);
  assert.ok(Math.abs(result.x - 1.55) < CLOSE, '应被推到 x = 2 - 0.45');
  assert.ok(Math.abs(result.z - 0) < CLOSE);
  assert.ok(Math.abs(result.normalX + 1) < CLOSE);
  assert.ok(Math.abs(result.normalZ) < CLOSE);
});

test('圆形从 +X 侧面接触时沿 X 轴推出', () => {
  const collider = box({ x: 2, y: 0, z: -1 }, { x: 3, y: 1, z: 1 });
  const result = resolveCircleAabb(3.2, 0, 0.45, collider);

  assert.equal(result.hit, true);
  assert.ok(Math.abs(result.x - 3.45) < CLOSE, '应被推到 x = 3 + 0.45');
  assert.ok(Math.abs(result.normalX - 1) < CLOSE);
});

test('圆形从 -Z 与 +Z 侧面接触时沿 Z 轴推出', () => {
  const collider = box({ x: -1, y: 0, z: 2 }, { x: 1, y: 1, z: 3 });
  const front = resolveCircleAabb(0, 1.8, 0.45, collider);
  assert.equal(front.hit, true);
  assert.ok(Math.abs(front.z - 1.55) < CLOSE);
  assert.ok(Math.abs(front.normalZ + 1) < CLOSE);

  const back = resolveCircleAabb(0, 3.2, 0.45, collider);
  assert.equal(back.hit, true);
  assert.ok(Math.abs(back.z - 3.45) < CLOSE);
  assert.ok(Math.abs(back.normalZ - 1) < CLOSE);
});

test('斜向接触盒角时沿对角线推出，推出后与盒子的距离等于半径', () => {
  const collider = box({ x: 2, y: 0, z: 2 }, { x: 3, y: 1, z: 3 });
  const result = resolveCircleAabb(1.75, 1.75, 0.45, collider);

  assert.equal(result.hit, true);
  assert.ok(Math.abs(result.x - result.z) < CLOSE, '对角线推出应保持对称');

  const nearestX = clamp(result.x, 2, 3);
  const nearestZ = clamp(result.z, 2, 3);
  const distance = Math.hypot(result.x - nearestX, result.z - nearestZ);
  assert.ok(Math.abs(distance - 0.45) < CLOSE, '推出后应恰好相切');
  assert.ok(result.x < 2 && result.z < 2, '应被推到盒外');
});

test('圆心落在盒内时沿最短边推出', () => {
  const collider = box({ x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 });
  const result = resolveCircleAabb(0.9, 0, 0.45, collider);

  assert.equal(result.hit, true);
  assert.ok(Math.abs(result.x - 1.45) < CLOSE, '更靠近 +X 边，应向 +X 推出');
  assert.ok(Math.abs(result.z - 0) < CLOSE);
  assert.ok(Math.abs(result.normalX - 1) < CLOSE);
});

test('圆心在盒外足够远时不做推移', () => {
  const collider = box({ x: 2, y: 0, z: -1 }, { x: 3, y: 1, z: 1 });
  const result = resolveCircleAabb(0, 0, 0.45, collider);
  assert.equal(result.hit, false);
  assert.equal(result.x, 0);
  assert.equal(result.z, 0);
});

test('多个相邻障碍迭代推移后不残留穿透', () => {
  const colliders = [
    box({ x: 1, y: 0, z: -2 }, { x: 2, y: 1, z: 2 }),
    box({ x: 2, y: 0, z: -2 }, { x: 3, y: 1, z: 2 })
  ];
  const result = resolveCircleColliders(1.5, 0, 0.45, colliders);

  assert.equal(result.hit, true);
  for (const collider of colliders) {
    const nearestX = clamp(result.x, collider.min.x, collider.max.x);
    const nearestZ = clamp(result.z, collider.min.z, collider.max.z);
    const distance = Math.hypot(result.x - nearestX, result.z - nearestZ);
    assert.ok(distance >= 0.45 - 1e-4, '推移后圆不应与任何障碍重叠');
  }
});

test('斜向撞墙时保留未受阻轴，形成贴墙滑动', () => {
  const wall = box({ x: 2, y: 0, z: -5 }, { x: 3, y: 2, z: 5 });
  const result = moveCircle(1, 0, 2, 2, 0.45, [wall], BOUNDS, 0, 1.68);

  assert.ok(Math.abs(result.x - 1.55) < CLOSE, 'X 轴应被墙挡住');
  assert.ok(Math.abs(result.z - 2) < CLOSE, 'Z 轴应继续滑动');
  assert.equal(result.blockedX, true);
  assert.equal(result.blockedZ, false);
});

test('竞技场边界按玩家半径夹紧', () => {
  const result = moveCircle(29.9, -29.9, 5, -5, 0.45, [], BOUNDS, 0, 1.68);

  assert.ok(Math.abs(result.x - 29.55) < CLOSE);
  assert.ok(Math.abs(result.z + 29.55) < CLOSE);
  assert.equal(result.blockedX, true);
  assert.equal(result.blockedZ, true);

  const clamped = clampCircleToBounds(100, -100, 0.45, BOUNDS);
  assert.ok(Math.abs(clamped.x - 29.55) < CLOSE);
  assert.ok(Math.abs(clamped.z + 29.55) < CLOSE);
  assert.equal(clamped.clampedX, true);
  assert.equal(clamped.clampedZ, true);
});

test('竖直方向不重叠的障碍不阻挡玩家（身体高于障碍时）', () => {
  const lowWall = box({ x: 2, y: 0, z: -5 }, { x: 3, y: 1, z: 5 });
  const blocked = moveCircle(1, 0, 2, 0, 0.45, [lowWall], BOUNDS, 0, 1.68);
  assert.ok(Math.abs(blocked.x - 1.55) < CLOSE);
  assert.equal(blocked.blockedX, true);

  const above = moveCircle(1, 0, 1, 0, 0.45, [lowWall], BOUNDS, 1.2, 2.88);
  assert.ok(Math.abs(above.x - 2) < CLOSE, '身体完全高于障碍时应通过');
  assert.equal(above.blockedX, false);
});

test('碰撞体校验拒绝缺失字段与反向边界', () => {
  assert.equal(
    isValidCollider(box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })),
    true
  );
  assert.equal(isValidCollider(null), false);
  assert.equal(isValidCollider({ min: { x: 0 } }), false);
  assert.equal(
    isValidCollider(box({ x: 2, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })),
    false
  );
});

test('射线与 AABB 正面相交时返回距离、命中点与法线', () => {
  const collider = box({ x: -1, y: -1, z: 2 }, { x: 1, y: 1, z: 4 });
  const hit = rayAabbIntersection(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    collider
  );

  assert.notEqual(hit, null);
  assert.ok(Math.abs(hit.distance - 2) < CLOSE);
  assert.ok(Math.abs(hit.point.z - 2) < CLOSE);
  assert.deepEqual(hit.normal, { x: 0, y: 0, z: -1 });
});

test('射线完全错开时返回 null', () => {
  const collider = box({ x: -1, y: -1, z: 2 }, { x: 1, y: 1, z: 4 });
  const hit = rayAabbIntersection(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    collider
  );
  assert.equal(hit, null);
});

test('raycastColliders 返回范围内最近的世界命中', () => {
  const nearBox = box({ x: -1, y: -1, z: 2 }, { x: 1, y: 1, z: 3 });
  const farBox = box({ x: -1, y: -1, z: 5 }, { x: 1, y: 1, z: 6 });
  const hit = raycastColliders(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    100,
    [farBox, nearBox]
  );

  assert.notEqual(hit, null);
  assert.ok(Math.abs(hit.distance - 2) < CLOSE);
  assert.equal(hit.collider, nearBox);
});

test('raycastColliders 忽略超出射程的障碍', () => {
  const collider = box({ x: -1, y: -1, z: 5 }, { x: 1, y: 1, z: 6 });
  const hit = raycastColliders(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    3,
    [collider]
  );
  assert.equal(hit, null);
});

test('散布为 0 时方向不变，散布为正时偏移不超过给定角', () => {
  const forward = { x: 0, y: 0, z: -1 };
  const unchanged = applySpreadToDirection(forward, 0, 0.5, 0.5);
  assert.ok(Math.abs(unchanged.x) < CLOSE);
  assert.ok(Math.abs(unchanged.y) < CLOSE);
  assert.ok(Math.abs(unchanged.z + 1) < CLOSE);

  const spread = 0.012;
  const offset = applySpreadToDirection(forward, spread, 0.75, 0.25);
  const length = Math.hypot(offset.x, offset.y, offset.z);
  assert.ok(Math.abs(length - 1) < CLOSE, '结果应保持单位长度');

  const dot = offset.z * forward.z;
  const maxCos = Math.cos(spread * 1.001);
  assert.ok(dot >= maxCos, '偏移角不应超过散布角');
  assert.ok(dot < 1 - 1e-9, '非零散布应产生实际偏移');
});

test('归一化拒绝零向量', () => {
  assert.throws(() => normalizeVector(0, 0, 0), RangeError);
  const unit = normalizeVector(3, 0, 4);
  assert.ok(Math.abs(unit.x - 0.6) < CLOSE);
  assert.ok(Math.abs(unit.z - 0.8) < CLOSE);
});
