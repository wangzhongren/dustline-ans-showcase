/**
 * 战斗服务：碰撞与射线数学。
 *
 * 这里只做纯计算，不创建 Three.js 对象、不访问渲染器、不读写业务状态。
 * 玩家是按 XZ 平面圆形处理、竖直方向用身体高度过滤障碍的简化体；
 * 障碍是共享 Model 约定的轴对齐盒 `Collider = { min:{x,y,z}, max:{x,y,z} }`。
 *
 * 所有位置与方向都是普通数字对象，单位与游戏世界一致（米、弧度）。
 */

const EPSILON = 1e-8;
const MAX_PUSH_ITERATIONS = 3;

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
export function clamp(value, min, max) {
  if (!isFiniteNumber(value) || !isFiniteNumber(min) || !isFiniteNumber(max)) {
    throw new TypeError('clamp 的参数必须是有限数字');
  }
  if (min > max) {
    throw new RangeError('clamp 的 min 不能大于 max');
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * 校验共享 Model 约定的碰撞体。
 *
 * 只读取字段，不修改传入对象。无效值返回 false，由调用方决定报告方式。
 *
 * @param {unknown} collider
 * @returns {boolean}
 */
export function isValidCollider(collider) {
  if (collider === null || typeof collider !== 'object') {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (collider);
  const min = source.min;
  const max = source.max;
  if (min === null || typeof min !== 'object' || max === null || typeof max !== 'object') {
    return false;
  }
  const minBox = /** @type {Record<string, unknown>} */ (min);
  const maxBox = /** @type {Record<string, unknown>} */ (max);
  const numbers = [minBox.x, minBox.y, minBox.z, maxBox.x, maxBox.y, maxBox.z];
  for (const value of numbers) {
    if (!isFiniteNumber(value)) {
      return false;
    }
  }
  const minX = /** @type {number} */ (minBox.x);
  const minY = /** @type {number} */ (minBox.y);
  const minZ = /** @type {number} */ (minBox.z);
  const maxX = /** @type {number} */ (maxBox.x);
  const maxY = /** @type {number} */ (maxBox.y);
  const maxZ = /** @type {number} */ (maxBox.z);
  return minX <= maxX && minY <= maxY && minZ <= maxZ;
}

/**
 * 校验位置参数。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @returns {void}
 */
function assertCircleInput(x, z, radius) {
  if (!isFiniteNumber(x) || !isFiniteNumber(z)) {
    throw new TypeError('圆心坐标必须是有限数字');
  }
  if (!isFiniteNumber(radius) || radius <= 0) {
    throw new RangeError('碰撞半径必须是大于 0 的有限数字');
  }
}

/**
 * 判断圆形与 AABB 在竖直方向上是否重叠。
 *
 * @param {import('../../abstract/combat.js').Collider} collider
 * @param {number} bodyMinY 身体最低点。
 * @param {number} bodyMaxY 身体最高点。
 * @returns {boolean}
 */
function overlapsVertical(collider, bodyMinY, bodyMaxY) {
  return bodyMaxY > collider.min.y && bodyMinY < collider.max.y;
}

/**
 * 把圆推出单个 AABB（XZ 平面）。
 *
 * 返回修正后的圆心与推出方向。圆心在盒内时，沿最短的一条边推出；
 * 在盒外时，沿“最近点指向圆心”的方向推出，因此斜向接触会得到斜向修正，
 * 玩家随后仍可沿未被阻挡的轴滑动。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {import('../../abstract/combat.js').Collider} collider
 * @returns {{ x: number, z: number, hit: boolean, normalX: number, normalZ: number, depth: number }}
 */
export function resolveCircleAabb(x, z, radius, collider) {
  assertCircleInput(x, z, radius);
  if (!isValidCollider(collider)) {
    throw new TypeError('resolveCircleAabb 需要合法的 Collider');
  }

  const minX = collider.min.x;
  const minZ = collider.min.z;
  const maxX = collider.max.x;
  const maxZ = collider.max.z;

  const nearestX = clamp(x, minX, maxX);
  const nearestZ = clamp(z, minZ, maxZ);
  const deltaX = x - nearestX;
  const deltaZ = z - nearestZ;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;

  if (distanceSquared >= radius * radius) {
    return { x, z, hit: false, normalX: 0, normalZ: 0, depth: 0 };
  }

  if (distanceSquared > EPSILON) {
    const distance = Math.sqrt(distanceSquared);
    const normalX = deltaX / distance;
    const normalZ = deltaZ / distance;
    const depth = radius - distance;
    return {
      x: x + normalX * depth,
      z: z + normalZ * depth,
      hit: true,
      normalX,
      normalZ,
      depth
    };
  }

  // 圆心已经落在盒内：比较到四条边的距离，选最短方向推出。
  const toMinX = x - minX;
  const toMaxX = maxX - x;
  const toMinZ = z - minZ;
  const toMaxZ = maxZ - z;

  let smallest = toMinX;
  let normalX = -1;
  let normalZ = 0;
  let depth = radius + toMinX;

  if (toMaxX < smallest) {
    smallest = toMaxX;
    normalX = 1;
    normalZ = 0;
    depth = radius + toMaxX;
  }
  if (toMinZ < smallest) {
    smallest = toMinZ;
    normalX = 0;
    normalZ = -1;
    depth = radius + toMinZ;
  }
  if (toMaxZ < smallest) {
    normalX = 0;
    normalZ = 1;
    depth = radius + toMaxZ;
  }

  return {
    x: x + normalX * depth,
    z: z + normalZ * depth,
    hit: true,
    normalX,
    normalZ,
    depth
  };
}

/**
 * 依次把圆推出所有 AABB。
 *
 * 多个障碍相邻时，单次推出可能把圆送进另一个障碍，因此最多迭代
 * `MAX_PUSH_ITERATIONS` 轮；正常场地布局下一到两轮即可稳定。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {ReadonlyArray<import('../../abstract/combat.js').Collider>} colliders
 * @param {number} [bodyMinY] 提供时只处理竖直重叠的障碍。
 * @param {number} [bodyMaxY] 提供时只处理竖直重叠的障碍。
 * @returns {{ x: number, z: number, hit: boolean, normalX: number, normalZ: number }}
 */
export function resolveCircleColliders(x, z, radius, colliders, bodyMinY, bodyMaxY) {
  assertCircleInput(x, z, radius);
  if (!Array.isArray(colliders)) {
    throw new TypeError('resolveCircleColliders 需要碰撞体数组');
  }

  const hasVerticalRange =
    isFiniteNumber(bodyMinY) && isFiniteNumber(bodyMaxY);
  let currentX = x;
  let currentZ = z;
  let hit = false;
  let normalX = 0;
  let normalZ = 0;

  for (let iteration = 0; iteration < MAX_PUSH_ITERATIONS; iteration += 1) {
    let changed = false;
    for (const collider of colliders) {
      if (!isValidCollider(collider)) {
        continue;
      }
      if (hasVerticalRange && !overlapsVertical(collider, bodyMinY, bodyMaxY)) {
        continue;
      }
      const resolved = resolveCircleAabb(currentX, currentZ, radius, collider);
      if (resolved.hit) {
        currentX = resolved.x;
        currentZ = resolved.z;
        normalX = resolved.normalX;
        normalZ = resolved.normalZ;
        hit = true;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return { x: currentX, z: currentZ, hit, normalX, normalZ };
}

/**
 * 把圆限制在竞技场矩形边界内。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {{ halfWidth: number, halfDepth: number }} bounds
 * @returns {{ x: number, z: number, clampedX: boolean, clampedZ: boolean }}
 */
export function clampCircleToBounds(x, z, radius, bounds) {
  assertCircleInput(x, z, radius);
  if (bounds === null || typeof bounds !== 'object') {
    throw new TypeError('clampCircleToBounds 需要 { halfWidth, halfDepth }');
  }
  if (
    !isFiniteNumber(bounds.halfWidth) ||
    !isFiniteNumber(bounds.halfDepth) ||
    bounds.halfWidth <= 0 ||
    bounds.halfDepth <= 0
  ) {
    throw new RangeError('bounds 的半宽与半深必须是大于 0 的有限数字');
  }

  const limitX = Math.max(0, bounds.halfWidth - radius);
  const limitZ = Math.max(0, bounds.halfDepth - radius);
  const nextX = clamp(x, -limitX, limitX);
  const nextZ = clamp(z, -limitZ, limitZ);
  return {
    x: nextX,
    z: nextZ,
    clampedX: Math.abs(nextX - x) > EPSILON,
    clampedZ: Math.abs(nextZ - z) > EPSILON
  };
}

/**
 * 分轴移动圆形并处理碰撞，实现“撞墙后沿墙滑动”。
 *
 * 先移动 X 再移动 Z：某个轴被挡住时另一个轴仍可继续，因此斜向撞墙会
 * 贴着墙面滑过去，而不是完全停住。最后把结果夹在竞技场边界内。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} deltaX
 * @param {number} deltaZ
 * @param {number} radius
 * @param {ReadonlyArray<import('../../abstract/combat.js').Collider>} colliders
 * @param {{ halfWidth: number, halfDepth: number }} bounds
 * @param {number} [bodyMinY]
 * @param {number} [bodyMaxY]
 * @returns {{ x: number, z: number, blockedX: boolean, blockedZ: boolean }}
 */
export function moveCircle(
  x,
  z,
  deltaX,
  deltaZ,
  radius,
  colliders,
  bounds,
  bodyMinY,
  bodyMaxY
) {
  assertCircleInput(x, z, radius);
  if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaZ)) {
    throw new TypeError('moveCircle 的位移必须是有限数字');
  }

  let currentX = x;
  let currentZ = z;
  let blockedX = false;
  let blockedZ = false;

  // 大位移分小步推进，避免一帧跨过薄墙后从另一侧被推出（隧穿）。
  // 正常主循环的位移远小于该步长，只有测试或异常 delta 才会细分。
  const distance = Math.hypot(deltaX, deltaZ);
  const maxStep = radius * 0.5;
  let steps = 1;
  if (distance > maxStep) {
    steps = Math.ceil(distance / maxStep);
  }
  const stepX = deltaX / steps;
  const stepZ = deltaZ / steps;

  for (let step = 0; step < steps; step += 1) {
    const targetX = currentX + stepX;
    const resolvedX = resolveCircleColliders(
      targetX,
      currentZ,
      radius,
      colliders,
      bodyMinY,
      bodyMaxY
    );
    if (Math.abs(resolvedX.x - targetX) > EPSILON) {
      blockedX = true;
    }
    currentX = resolvedX.x;
    currentZ = resolvedX.z;

    const targetZ = currentZ + stepZ;
    const resolvedZ = resolveCircleColliders(
      currentX,
      targetZ,
      radius,
      colliders,
      bodyMinY,
      bodyMaxY
    );
    if (Math.abs(resolvedZ.z - targetZ) > EPSILON) {
      blockedZ = true;
    }
    currentX = resolvedZ.x;
    currentZ = resolvedZ.z;
  }

  const clamped = clampCircleToBounds(currentX, currentZ, radius, bounds);
  if (clamped.clampedX) {
    blockedX = true;
  }
  if (clamped.clampedZ) {
    blockedZ = true;
  }

  return {
    x: clamped.x,
    z: clamped.z,
    blockedX,
    blockedZ
  };
}

/**
 * 归一化三维向量；零向量会抛出 RangeError。
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{ x: number, y: number, z: number }}
 */
export function normalizeVector(x, y, z) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    throw new TypeError('normalizeVector 的分量必须是有限数字');
  }
  const length = Math.hypot(x, y, z);
  if (length <= EPSILON) {
    throw new RangeError('normalizeVector 不能处理零向量');
  }
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * 三维向量叉乘。
 *
 * @param {number} ax
 * @param {number} ay
 * @param {number} az
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @returns {{ x: number, y: number, z: number }}
 */
export function crossVector(ax, ay, az, bx, by, bz) {
  if (
    !isFiniteNumber(ax) ||
    !isFiniteNumber(ay) ||
    !isFiniteNumber(az) ||
    !isFiniteNumber(bx) ||
    !isFiniteNumber(by) ||
    !isFiniteNumber(bz)
  ) {
    throw new TypeError('crossVector 的分量必须是有限数字');
  }
  return {
    x: ay * bz - az * by,
    y: az * bx - ax * bz,
    z: ax * by - ay * bx
  };
}

/**
 * 在以 `direction` 为轴的圆锥内偏移方向，用于腰射/瞄准散布。
 *
 * `randomA`、`randomB` 取 [0, 1)，由调用方提供（游戏里是 Math.random）。
 * 使用圆盘采样让落点在圆锥截面内均匀分布；`spread` 为弧度，0 表示不偏移。
 *
 * @param {{ x: number, y: number, z: number }} direction 已归一化或未归一化的方向。
 * @param {number} spread 最大偏移角（弧度）。
 * @param {number} randomA [0, 1)
 * @param {number} randomB [0, 1)
 * @returns {{ x: number, y: number, z: number }} 新的单位方向。
 */
export function applySpreadToDirection(direction, spread, randomA, randomB) {
  if (direction === null || typeof direction !== 'object') {
    throw new TypeError('applySpreadToDirection 需要方向对象');
  }
  if (!isFiniteNumber(spread) || spread < 0) {
    throw new RangeError('spread 必须是大于等于 0 的有限数字');
  }
  if (!isFiniteNumber(randomA) || !isFiniteNumber(randomB)) {
    throw new TypeError('散布随机数必须是有限数字');
  }

  const base = normalizeVector(direction.x, direction.y, direction.z);
  if (spread <= EPSILON) {
    return base;
  }

  let right = crossVector(base.x, base.y, base.z, 0, 1, 0);
  let rightLength = Math.hypot(right.x, right.y, right.z);
  if (rightLength <= EPSILON) {
    right = crossVector(base.x, base.y, base.z, 1, 0, 0);
    rightLength = Math.hypot(right.x, right.y, right.z);
  }
  const rightUnit = {
    x: right.x / rightLength,
    y: right.y / rightLength,
    z: right.z / rightLength
  };
  const up = crossVector(
    rightUnit.x,
    rightUnit.y,
    rightUnit.z,
    base.x,
    base.y,
    base.z
  );
  const upUnit = normalizeVector(up.x, up.y, up.z);

  const radius = spread * Math.sqrt(clamp(randomA, 0, 1));
  const angle = clamp(randomB, 0, 1) * Math.PI * 2;
  const offsetX = Math.cos(angle) * radius;
  const offsetY = Math.sin(angle) * radius;

  return normalizeVector(
    base.x + rightUnit.x * offsetX + upUnit.x * offsetY,
    base.y + rightUnit.y * offsetX + upUnit.y * offsetY,
    base.z + rightUnit.z * offsetX + upUnit.z * offsetY
  );
}

/**
 * 射线与 AABB 求交（slab 方法）。
 *
 * `direction` 应为归一化方向；返回的 `distance` 即为世界距离。
 * 起点在盒内时返回 0；射线完全错开或只向负方向延伸时返回 null。
 *
 * @param {{ x: number, y: number, z: number }} origin
 * @param {{ x: number, y: number, z: number }} direction
 * @param {import('../../abstract/combat.js').Collider} collider
 * @returns {{ distance: number, point: {x:number,y:number,z:number}, normal: {x:number,y:number,z:number} } | null}
 */
export function rayAabbIntersection(origin, direction, collider) {
  if (
    origin === null ||
    typeof origin !== 'object' ||
    direction === null ||
    typeof direction !== 'object'
  ) {
    throw new TypeError('rayAabbIntersection 需要 origin 与 direction 对象');
  }
  if (!isValidCollider(collider)) {
    throw new TypeError('rayAabbIntersection 需要合法的 Collider');
  }
  const components = [
    { origin: origin.x, direction: direction.x, min: collider.min.x, max: collider.max.x },
    { origin: origin.y, direction: direction.y, min: collider.min.y, max: collider.max.y },
    { origin: origin.z, direction: direction.z, min: collider.min.z, max: collider.max.z }
  ];
  for (const component of components) {
    if (
      !isFiniteNumber(component.origin) ||
      !isFiniteNumber(component.direction) ||
      !isFiniteNumber(component.min) ||
      !isFiniteNumber(component.max)
    ) {
      throw new TypeError('射线与碰撞体的分量必须是有限数字');
    }
  }

  let near = -Infinity;
  let far = Infinity;
  let axisIndex = -1;
  let axisSign = 1;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (Math.abs(component.direction) <= EPSILON) {
      if (component.origin < component.min || component.origin > component.max) {
        return null;
      }
      continue;
    }

    let nearT = (component.min - component.origin) / component.direction;
    let farT = (component.max - component.origin) / component.direction;
    let nearSign = -1;
    if (nearT > farT) {
      const swap = nearT;
      nearT = farT;
      farT = swap;
      nearSign = 1;
    }

    if (nearT > near) {
      near = nearT;
      axisIndex = index;
      axisSign = nearSign;
    }
    if (farT < far) {
      far = farT;
    }
    if (near > far) {
      return null;
    }
  }

  if (far < 0 || axisIndex === -1) {
    return null;
  }

  const distance = Math.max(0, near);
  const point = {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance
  };

  let normal = { x: 0, y: 1, z: 0 };
  if (axisIndex === 0) {
    normal = { x: axisSign, y: 0, z: 0 };
  } else if (axisIndex === 1) {
    normal = { x: 0, y: axisSign, z: 0 };
  } else if (axisIndex === 2) {
    normal = { x: 0, y: 0, z: axisSign };
  }

  return { distance, point, normal };
}

/**
 * 对所有碰撞体做射线检测，返回范围内最近的世界命中。
 *
 * 用于命中扫描的“非目标命中”分支：敌人目标由渲染 Provider 负责，
 * 墙体、箱子等纯 AABB 障碍由这里判定，避免子弹穿过掩体。
 *
 * @param {{ x: number, y: number, z: number }} origin
 * @param {{ x: number, y: number, z: number }} direction
 * @param {number} range 最大距离（米）。
 * @param {ReadonlyArray<import('../../abstract/combat.js').Collider>} colliders
 * @returns {{ distance: number, point: {x:number,y:number,z:number}, normal: {x:number,y:number,z:number}, collider: import('../../abstract/combat.js').Collider } | null}
 */
export function raycastColliders(origin, direction, range, colliders) {
  if (!isFiniteNumber(range) || range <= 0) {
    throw new RangeError('raycastColliders 的 range 必须是大于 0 的有限数字');
  }
  if (!Array.isArray(colliders)) {
    throw new TypeError('raycastColliders 需要碰撞体数组');
  }

  let nearest = null;
  for (const collider of colliders) {
    if (!isValidCollider(collider)) {
      continue;
    }
    const hit = rayAabbIntersection(origin, direction, collider);
    if (hit === null) {
      continue;
    }
    if (hit.distance <= EPSILON || hit.distance > range) {
      continue;
    }
    if (nearest === null || hit.distance < nearest.distance) {
      nearest = {
        distance: hit.distance,
        point: hit.point,
        normal: hit.normal,
        collider
      };
    }
  }
  return nearest;
}
