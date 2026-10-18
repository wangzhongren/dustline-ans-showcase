/**
 * 竞技场布局、AABB 碰撞与出生点纯函数。
 *
 * 这个文件不导入 Three.js、不读取 DOM，也不发起任何资源请求，因此可以在 Node 里
 * 直接测试。`arena.js` 只负责把这里给出的尺寸、位置和材质分组变成可见网格。
 *
 * 坐标约定：
 * - 竞技场中心在原点，地面 y = 0。
 * - 所有障碍物的 `x` / `z` 是足迹中心，`width` / `depth` 是未旋转时的尺寸。
 * - `rotationY` 是绕竖直轴的弧度旋转；碰撞体取旋转后矩形的世界 AABB。
 * - `elevation` 是物体底面离地高度，用于叠放木箱；地面移动只关心 min.y = 0 的碰撞体。
 */

import { GAME_CONFIG } from '../../../models/game-config.js';

/** 出生点与障碍物边缘之间保留的水平距离（米）。 */
const SPAWN_COLLIDER_MARGIN = 0.9;
/** 默认随机尝试次数；超过后改用确定性环带扫描。 */
const DEFAULT_SPAWN_ATTEMPTS = 96;
/** 确定性环带扫描的角度数量。 */
const FALLBACK_ANGLE_STEPS = 64;
/** 出生点必须位于竞技场边界内，额外留出的余量（米）。 */
const ARENA_SPAWN_MARGIN = 0.5;

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
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * 读取并校验一个三维点。返回普通对象，不保留调用方引用。
 *
 * @param {unknown} value
 * @param {string} label
 * @returns {{x: number, y: number, z: number}}
 */
function readPoint(value, label) {
  if (!isObject(value)) {
    throw new TypeError(label + ' 必须是 { x, y, z } 对象');
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y) || !isFiniteNumber(source.z)) {
    throw new TypeError(label + ' 的 x/y/z 必须是有限数字');
  }
  return { x: source.x, y: source.y, z: source.z };
}

/**
 * 递归冻结布局数据，避免渲染层意外修改共享定义。
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

/**
 * @param {number} value
 * @returns {number}
 */
function roundMeters(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * 定义一块轴对齐（或绕 Y 轴旋转）的箱体障碍。
 *
 * @param {string} id
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} rotationY
 * @param {number} [elevation]
 * @returns {Readonly<Record<string, number|string>>}
 */
function box(id, x, z, width, height, depth, rotationY, elevation) {
  let base = 0;
  if (elevation !== undefined) {
    base = elevation;
  }
  return Object.freeze({
    id,
    x,
    z,
    width,
    height,
    depth,
    rotationY,
    elevation: base
  });
}

/**
 * 定义一只金属桶。碰撞足迹按外接正方形计算。
 *
 * @param {string} id
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @param {number} height
 * @param {string} tint
 * @returns {Readonly<Record<string, number|string>>}
 */
function barrel(id, x, z, radius, height, tint) {
  return Object.freeze({ id, x, z, radius, height, tint });
}

/**
 * 定义一块不参与碰撞的装饰碎片。
 *
 * @param {string} id
 * @param {'plank'|'box'|'rock'} shape
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} rotationY
 * @returns {Readonly<Record<string, number|string>>}
 */
function debris(id, shape, x, z, width, height, depth, rotationY) {
  return Object.freeze({ id, shape, x, z, width, height, depth, rotationY });
}

/**
 * 定义一段 HESCO 防爆墙。每个模块 1.5 × 1.0 × 1.0 米（宽 × 深 × 高），
 * 默认堆叠两层；`x` / `z` 是整段墙的中心。
 *
 * @param {string} id
 * @param {number} x
 * @param {number} z
 * @param {number} modules
 * @param {number} layers
 * @param {number} rotationY
 * @returns {Readonly<Record<string, number|string>>}
 */
function hesco(id, x, z, modules, layers, rotationY) {
  const moduleWidth = 1.5;
  const moduleDepth = 1.0;
  const moduleHeight = 1.0;
  return Object.freeze({
    id,
    x,
    z,
    modules,
    layers,
    moduleWidth,
    moduleDepth,
    moduleHeight,
    width: moduleWidth * modules,
    height: moduleHeight * layers,
    depth: moduleDepth,
    rotationY
  });
}

/**
 * 定义一座帐篷（实体，产生碰撞）。
 *
 * @param {string} id
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} depth
 * @param {number} height
 * @param {number} rotationY
 * @param {'khaki'|'olive'} tint
 * @returns {Readonly<Record<string, number|string>>}
 */
function tent(id, x, z, width, depth, height, rotationY, tint) {
  return Object.freeze({ id, x, z, width, depth, height, rotationY, tint });
}

/**
 * 定义一块不参与碰撞的地面装饰（草丛、碎石、纸屑）。
 *
 * @param {string} id
 * @param {'grass'|'rubble'|'paper'} kind
 * @param {number} x
 * @param {number} z
 * @param {number} count
 * @param {number} radius
 * @returns {Readonly<Record<string, number|string>>}
 */
function groundPatch(id, kind, x, z, count, radius) {
  return Object.freeze({ id, kind, x, z, count, radius });
}

/**
 * 创建竞技场布局。每次调用返回一份新的、深度冻结的数据。
 *
 * 类别：
 * - `ground`：60 × 60 米地面。
 * - `bunkers`：混凝土地堡，由多个箱体拼成 L / U 形。
 * - `walls`：分段混凝土隔离墙。
 * - `containers`：波纹钢集装箱。
 * - `crates`：木箱，含叠放。
 * - `barrels`：金属桶。
 * - `sandbags`：沙袋墙（实际网格由 arena.js 拆成小袋）。
 * - `tower`：警戒塔。
 * - `fences`：四周围栏，同时构成竞技场外边界。
 * - `debris`：不参与碰撞的木板、小箱与石块。
 *
 * @returns {Readonly<Record<string, unknown>>}
 */
export function createLayout() {
  const layout = {
    size: {
      width: GAME_CONFIG.arena.width,
      depth: GAME_CONFIG.arena.depth,
      halfWidth: GAME_CONFIG.arena.halfWidth,
      halfDepth: GAME_CONFIG.arena.halfDepth
    },
    playerSpawn: { x: 0, y: 0, z: 0 },
    safeRadius: 5,
    ground: {
      width: GAME_CONFIG.arena.width,
      depth: GAME_CONFIG.arena.depth,
      repeat: 15
    },
    bunkers: [
      box('bunker-west-main', -20, -6, 6, 2.4, 3, 0),
      box('bunker-west-wing', -23.2, -3.4, 3, 2.4, 2.4, 0),
      box('bunker-east-side', 20, 8, 3, 2.2, 6, 0),
      box('bunker-east-north', 23.2, 9.8, 6, 2.2, 2.6, 0),
      box('bunker-east-south', 23.2, 6.2, 6, 2.2, 2.6, 0),
      box('bunker-north-main', 4, -22, 5, 1.8, 3.2, 0),
      box('bunker-north-wing', 8.4, -21.4, 3.2, 1.8, 2.6, 0.35)
    ],
    walls: [
      box('wall-a', -12, -17, 8, 2.2, 0.6, 0),
      box('wall-b', 14, -11, 7, 2.0, 0.6, Math.PI / 2),
      box('wall-c', -18, 13, 7, 1.8, 0.6, 0),
      box('wall-d', 11, 17, 8, 2.1, 0.6, Math.PI / 2),
      box('wall-e', -4, -9, 5, 1.4, 0.6, 0)
    ],
    containers: [
      { ...box('container-olive', -16, 4, 6.1, 2.6, 2.44, 0), tint: 'olive' },
      { ...box('container-khaki', 18, -17, 6.1, 2.6, 2.44, Math.PI / 2), tint: 'khaki' },
      { ...box('container-rust', 22, 21, 6.1, 2.6, 2.44, 0), tint: 'rust' },
      { ...box('container-olive-north', -22, -22, 6.1, 2.6, 2.44, Math.PI / 2), tint: 'olive' }
    ],
    crates: [
      box('crate-a1', -12.8, 7.5, 1.2, 1.0, 1.2, 0),
      box('crate-a2', -12.6, 7.4, 0.9, 0.8, 0.9, 0.2, 1.0),
      box('crate-b1', 16.5, -12.5, 1.1, 1.0, 1.1, 0.1),
      box('crate-b2', 15.4, -12.9, 1.0, 0.9, 1.0, -0.18),
      box('crate-b3', 17.3, -13.5, 0.8, 0.7, 0.8, 0.3),
      box('crate-c1', -9.5, 20.5, 1.2, 1.1, 1.2, 0.05),
      box('crate-c2', -9.2, 20.6, 0.8, 0.7, 0.8, 0.4, 1.1),
      box('crate-d1', 8.5, -16.5, 1.1, 1.0, 1.1, -0.12),
      box('crate-d2', 9.8, -16.9, 0.9, 0.8, 0.9, 0.22),
      box('crate-e1', 24.5, 2.5, 1.0, 0.9, 1.0, 0.15)
    ],
    barrels: [
      barrel('barrel-a', -8.5, -13.5, 0.36, 1.05, 'gunmetal'),
      barrel('barrel-b', -7.6, -13.1, 0.36, 1.05, 'rust'),
      barrel('barrel-c', 13.5, 7.5, 0.36, 1.05, 'gunmetal'),
      barrel('barrel-d', 14.2, 8.1, 0.36, 1.05, 'rust'),
      barrel('barrel-e', 21, 14, 0.36, 1.05, 'gunmetal'),
      barrel('barrel-f', -23, 5, 0.36, 1.05, 'rust'),
      barrel('barrel-g', -2.5, 21, 0.36, 1.05, 'gunmetal'),
      barrel('barrel-h', 5.5, 22, 0.36, 1.05, 'rust'),
      barrel('barrel-i', -15, -19.5, 0.36, 1.05, 'gunmetal')
    ],
    sandbags: [
      box('sandbag-a', 0, -14, 6, 1.05, 0.7, 0),
      box('sandbag-b', -8, 10, 5, 1.05, 0.7, Math.PI / 2),
      box('sandbag-c', 12, 4, 5, 1.05, 0.7, 0),
      box('sandbag-d', 2, 20, 6, 1.05, 0.7, 0.15),
      box('sandbag-e', -20, 18, 4, 1.05, 0.7, Math.PI / 2)
    ],
    tower: {
      id: 'watchtower',
      x: 24,
      z: -24,
      width: 3.4,
      depth: 3.4,
      height: 5.8,
      deckHeight: 3.4,
      tint: 'gunmetal'
    },
    fences: [
      box('fence-north', 0, -29.4, 58.8, 1.9, 0.3, 0),
      box('fence-south', 0, 29.4, 58.8, 1.9, 0.3, 0),
      box('fence-west', -29.4, 0, 58.8, 1.9, 0.3, Math.PI / 2),
      box('fence-east', 29.4, 0, 58.8, 1.9, 0.3, Math.PI / 2)
    ],
    debris: [
      debris('debris-plank-a', 'plank', -6, 3, 1.7, 0.06, 0.24, 0.4),
      debris('debris-plank-b', 'plank', 7, 9, 1.5, 0.06, 0.22, -0.7),
      debris('debris-plank-c', 'plank', -17.5, -9, 1.8, 0.06, 0.25, 1.1),
      debris('debris-plank-d', 'plank', 10, -6, 1.4, 0.06, 0.2, -1.3),
      debris('debris-plank-e', 'plank', 20, 3, 1.6, 0.06, 0.22, 0.9),
      debris('debris-plank-f', 'plank', -3, 18, 1.5, 0.06, 0.2, -0.2),
      debris('debris-box-a', 'box', 3, 7, 0.45, 0.35, 0.4, 0.5),
      debris('debris-box-b', 'box', -4, -3.5, 0.5, 0.4, 0.45, -0.35),
      debris('debris-box-c', 'box', 13, 13, 0.4, 0.3, 0.4, 0.8),
      debris('debris-box-d', 'box', -13, 15, 0.45, 0.32, 0.42, -0.6),
      debris('debris-rock-a', 'rock', 2.5, -2, 0.4, 0.28, 0.35, 0.3),
      debris('debris-rock-b', 'rock', -2, 6, 0.34, 0.24, 0.3, 1.2),
      debris('debris-rock-c', 'rock', 9, 1.5, 0.44, 0.3, 0.38, -0.5),
      debris('debris-rock-d', 'rock', -7, -7, 0.36, 0.26, 0.32, 0.7),
      debris('debris-rock-e', 'rock', 19, -20, 0.42, 0.3, 0.36, -1.1)
    ],
    props: {
      hesco: [
        hesco('hesco-west', -7, 14, 3, 2, 0),
        hesco('hesco-east', 17, -3, 3, 2, Math.PI / 2),
        hesco('hesco-north', -14, -24, 2, 2, 0)
      ],
      jersey: [
        box('jersey-a', -8, 6, 2.4, 0.9, 0.62, 0.15),
        box('jersey-b', 8, 11, 2.0, 0.9, 0.62, -0.35),
        box('jersey-c', -15, -2, 2.2, 0.9, 0.62, Math.PI / 2),
        box('jersey-d', 5, -8, 2.0, 0.9, 0.62, 0.1)
      ],
      sandbagWalls: [
        box('sandbag-prop-a', 10, -6, 3.0, 1.2, 0.7, 0.15),
        box('sandbag-prop-b', -11, 2.5, 2.6, 1.2, 0.7, Math.PI / 2),
        box('sandbag-prop-c', -4, 17, 3.4, 1.2, 0.7, -0.2)
      ],
      tents: [
        tent('tent-a', -24, -12, 3.2, 2.4, 2.2, 0.2, 'khaki'),
        tent('tent-b', 24, 11.5, 3.0, 2.2, 2.0, -0.4, 'olive')
      ],
      pallets: [
        { id: 'pallet-a', x: -19, z: 2.8, rotationY: 0.1, stack: 1 },
        { id: 'pallet-b', x: 15, z: -14.5, rotationY: -0.2, stack: 2 },
        { id: 'pallet-c', x: 19.5, z: 19, rotationY: 0.5, stack: 1 },
        { id: 'pallet-d', x: -24, z: -19, rotationY: -0.3, stack: 1 }
      ],
      tires: [
        { id: 'tires-a', x: 12.5, z: 9.5, count: 3, rotationY: 0.4 },
        { id: 'tires-b', x: -18, z: 6, count: 2, rotationY: -0.2 },
        { id: 'tires-c', x: 20, z: 12, count: 4, rotationY: 0.8 },
        { id: 'tires-d', x: 2, z: -19, count: 2, rotationY: 0.1 }
      ],
      signs: [
        box('sign-a', -2, 8, 0.32, 2.0, 0.32, -0.3),
        box('sign-b', 16, -8, 0.32, 2.0, 0.32, 0.2),
        box('sign-c', -16, 16, 0.32, 2.0, 0.32, -0.5),
        box('sign-d', 8, 22, 0.32, 2.0, 0.32, 0.15)
      ],
      ammoCrates: [
        box('ammo-a', -10, 13, 0.8, 0.5, 0.5, 0.1),
        box('ammo-b', -9.2, 13.4, 0.7, 0.4, 0.45, -0.15),
        box('ammo-c', 15.5, -3.5, 0.9, 0.55, 0.5, 0.2),
        box('ammo-d', 16.3, -2.8, 0.7, 0.45, 0.45, -0.1),
        box('ammo-e', 21.5, 12, 0.8, 0.5, 0.5, 0.3)
      ],
      searchlights: [
        box('searchlight-a', -27, -8, 0.5, 3.2, 0.5, Math.PI / 2),
        box('searchlight-b', 25, 15, 0.5, 3.2, 0.5, -2.2)
      ],
      groundPatches: [
        groundPatch('grass-a', 'grass', -13, -14, 40, 3.2),
        groundPatch('grass-b', 'grass', 18, 6, 32, 2.8),
        groundPatch('grass-c', 'grass', -5, 22, 28, 2.6),
        groundPatch('grass-d', 'grass', 9, -22, 24, 2.4),
        groundPatch('rubble-a', 'rubble', 0, -5, 18, 2.0),
        groundPatch('rubble-b', 'rubble', 21, -10, 16, 1.8),
        groundPatch('paper-a', 'paper', -17, 8, 8, 1.6),
        groundPatch('paper-b', 'paper', 6, 16, 8, 1.5)
      ],
      stains: [
        { id: 'stain-a', x: 3, z: 12, radius: 1.2, rotationY: 0.2 },
        { id: 'stain-b', x: -14, z: -6, radius: 1.5, rotationY: -0.4 },
        { id: 'stain-c', x: 19, z: 4, radius: 1.0, rotationY: 0.7 },
        { id: 'stain-d', x: -7, z: 19, radius: 0.9, rotationY: -0.2 },
        { id: 'stain-e', x: 11, z: -15, radius: 1.3, rotationY: 0.5 }
      ]
    }
  };

  return /** @type {Readonly<Record<string, unknown>>} */ (deepFreeze(layout));
}

/**
 * 计算矩形绕 Y 轴旋转后的世界 AABB（只算水平足迹）。
 *
 * @param {number} x
 * @param {number} z
 * @param {number} width
 * @param {number} depth
 * @param {number} rotationY
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}}
 */
function rotatedFootprint(x, z, width, depth, rotationY) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  const halfX = halfWidth * cos + halfDepth * sin;
  const halfZ = halfWidth * sin + halfDepth * cos;
  return {
    minX: roundMeters(x - halfX),
    maxX: roundMeters(x + halfX),
    minZ: roundMeters(z - halfZ),
    maxZ: roundMeters(z + halfZ)
  };
}

/**
 * 把一条布局记录转换成世界 AABB。
 *
 * @param {Record<string, unknown>} entry
 * @param {'box'|'barrel'} shape
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}}
 */
function createEntryCollider(entry, shape) {
  const x = /** @type {number} */ (entry.x);
  const z = /** @type {number} */ (entry.z);
  let width = /** @type {number} */ (entry.width);
  let depth = /** @type {number} */ (entry.depth);
  if (shape === 'barrel') {
    const radius = /** @type {number} */ (entry.radius);
    width = radius * 2;
    depth = radius * 2;
  }
  let rotationY = 0;
  if (isFiniteNumber(entry.rotationY)) {
    rotationY = /** @type {number} */ (entry.rotationY);
  }
  let elevation = 0;
  if (isFiniteNumber(entry.elevation)) {
    elevation = /** @type {number} */ (entry.elevation);
  }
  const height = /** @type {number} */ (entry.height);
  const footprint = rotatedFootprint(x, z, width, depth, rotationY);
  return Object.freeze({
    min: Object.freeze({ x: footprint.minX, y: roundMeters(elevation), z: footprint.minZ }),
    max: Object.freeze({
      x: footprint.maxX,
      y: roundMeters(elevation + height),
      z: footprint.maxZ
    })
  });
}

/**
 * 从 v3 场景道具生成实体碰撞体。
 *
 * HESCO、混凝土隔离墩、独立沙袋墙、帐篷、警示牌、弹药箱和探照灯是实体；
 * 托盘、轮胎、地面草丛/碎石/纸屑与污渍贴片只是装饰，不产生碰撞。
 *
 * @param {Readonly<Record<string, unknown>>} layout
 * @returns {ReadonlyArray<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>}
 */
export function createPropColliders(layout) {
  if (!isObject(layout)) {
    throw new TypeError('createPropColliders 需要 createLayout() 返回的布局对象');
  }
  const source = /** @type {Record<string, unknown>} */ (layout);
  const props = source.props;
  if (!isObject(props)) {
    throw new TypeError('布局缺少 props 分类');
  }
  const propSource = /** @type {Record<string, unknown>} */ (props);
  const groups = [
    'hesco',
    'jersey',
    'sandbagWalls',
    'tents',
    'signs',
    'ammoCrates',
    'searchlights'
  ];
  const colliders = [];
  for (const groupName of groups) {
    const group = propSource[groupName];
    if (!Array.isArray(group)) {
      throw new TypeError('布局 props 缺少数组分类: ' + groupName);
    }
    for (const entry of group) {
      colliders.push(createEntryCollider(entry, 'box'));
    }
  }
  return Object.freeze(colliders);
}

/**
 * 从布局生成所有阻挡移动的 AABB 碰撞体。
 *
 * 地面、装饰碎片和塔顶遮棚不产生碰撞体：地面就是 y = 0，碎片刻意不挡路。
 * 塔按整个塔基足迹生成一个碰撞体，避免玩家从塔腿之间穿过。
 *
 * @param {Readonly<Record<string, unknown>>} layout
 * @returns {ReadonlyArray<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>}
 */
export function createColliders(layout) {
  if (!isObject(layout)) {
    throw new TypeError('createColliders 需要 createLayout() 返回的布局对象');
  }
  const source = /** @type {Record<string, unknown>} */ (layout);
  const colliders = [];
  const boxGroups = ['bunkers', 'walls', 'containers', 'crates', 'sandbags', 'fences'];
  for (const groupName of boxGroups) {
    const group = source[groupName];
    if (!Array.isArray(group)) {
      throw new TypeError('布局缺少数组分类: ' + groupName);
    }
    for (const entry of group) {
      colliders.push(createEntryCollider(entry, 'box'));
    }
  }
  const barrels = source.barrels;
  if (!Array.isArray(barrels)) {
    throw new TypeError('布局缺少数组分类: barrels');
  }
  for (const entry of barrels) {
    colliders.push(createEntryCollider(entry, 'barrel'));
  }
  const tower = source.tower;
  if (!isObject(tower)) {
    throw new TypeError('布局缺少 tower 记录');
  }
  const towerEntry = /** @type {Record<string, unknown>} */ (tower);
  colliders.push(createEntryCollider(towerEntry, 'box'));

  const propColliders = createPropColliders(layout);
  for (const collider of propColliders) {
    colliders.push(collider);
  }

  return Object.freeze(colliders);
}

/**
 * 判断一个点是否落在 AABB 内（含边界），可向外扩展 margin。
 *
 * 用于出生点判定时同时检查三个轴：地面出生点 y = 0，叠放木箱的碰撞体
 * min.y > 0，因此不会错误地挡住地面。
 *
 * @param {{x: number, y: number, z: number}} point
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}} collider
 * @param {number} [margin]
 * @returns {boolean}
 */
export function isPointInsideCollider(point, collider, margin) {
  const pointValue = readPoint(point, 'isPointInsideCollider 的 point');
  let padding = 0;
  if (margin !== undefined) {
    if (!isFiniteNumber(margin) || margin < 0) {
      throw new RangeError('isPointInsideCollider 的 margin 必须是大于等于 0 的有限数字');
    }
    padding = margin;
  }
  if (!isObject(collider)) {
    throw new TypeError('isPointInsideCollider 的 collider 必须是 AABB 对象');
  }
  const bounds = /** @type {Record<string, unknown>} */ (collider);
  if (!isObject(bounds.min) || !isObject(bounds.max)) {
    throw new TypeError('collider 必须包含 min 与 max');
  }
  const min = /** @type {Record<string, unknown>} */ (bounds.min);
  const max = /** @type {Record<string, unknown>} */ (bounds.max);
  const insideX =
    pointValue.x >= /** @type {number} */ (min.x) - padding &&
    pointValue.x <= /** @type {number} */ (max.x) + padding;
  const insideY =
    pointValue.y >= /** @type {number} */ (min.y) - padding &&
    pointValue.y <= /** @type {number} */ (max.y) + padding;
  const insideZ =
    pointValue.z >= /** @type {number} */ (min.z) - padding &&
    pointValue.z <= /** @type {number} */ (max.z) + padding;
  return insideX && insideY && insideZ;
}

/**
 * 判断点是否在竞技场地面范围内。
 *
 * @param {{x: number, y: number, z: number}} point
 * @param {Readonly<Record<string, unknown>>} layout
 * @param {number} [margin]
 * @returns {boolean}
 */
export function isPointInsideArena(point, layout, margin) {
  const pointValue = readPoint(point, 'isPointInsideArena 的 point');
  if (!isObject(layout)) {
    throw new TypeError('isPointInsideArena 需要布局对象');
  }
  const size = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (layout).size
  );
  if (!isObject(size)) {
    throw new TypeError('布局缺少 size');
  }
  const halfWidth = /** @type {number} */ (size.halfWidth);
  const halfDepth = /** @type {number} */ (size.halfDepth);
  let padding = 0;
  if (margin !== undefined) {
    if (!isFiniteNumber(margin) || margin < 0) {
      throw new RangeError('isPointInsideArena 的 margin 必须是大于等于 0 的有限数字');
    }
    padding = margin;
  }
  const insideX = Math.abs(pointValue.x) <= halfWidth - padding;
  const insideZ = Math.abs(pointValue.z) <= halfDepth - padding;
  return insideX && insideZ;
}

/**
 * 判断出生点是否合法：位于 22–28 米环带、竞技场内、障碍物外，且离玩家足够远。
 *
 * @param {{x: number, y: number, z: number}} point
 * @param {ReadonlyArray<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>} colliders
 * @param {{x: number, y: number, z: number}} playerPosition
 * @param {number} minDistance
 * @param {{
 *   minRadius?: number,
 *   maxRadius?: number,
 *   halfWidth?: number,
 *   halfDepth?: number,
 *   colliderMargin?: number
 * }} [options]
 * @returns {boolean}
 */
export function isSpawnPointValid(point, colliders, playerPosition, minDistance, options) {
  const pointValue = readPoint(point, 'isSpawnPointValid 的 point');
  if (!Array.isArray(colliders)) {
    throw new TypeError('isSpawnPointValid 的 colliders 必须是数组');
  }
  const player = readPoint(playerPosition, 'isSpawnPointValid 的 playerPosition');
  if (!isFiniteNumber(minDistance) || minDistance < 0) {
    throw new RangeError('isSpawnPointValid 的 minDistance 必须是大于等于 0 的有限数字');
  }

  let minRadius = GAME_CONFIG.arena.spawnMinRadius;
  let maxRadius = GAME_CONFIG.arena.spawnMaxRadius;
  let halfWidth = GAME_CONFIG.arena.halfWidth;
  let halfDepth = GAME_CONFIG.arena.halfDepth;
  let colliderMargin = SPAWN_COLLIDER_MARGIN;
  if (options !== undefined) {
    if (!isObject(options)) {
      throw new TypeError('isSpawnPointValid 的 options 必须是对象');
    }
    const source = /** @type {Record<string, unknown>} */ (options);
    if (source.minRadius !== undefined) {
      minRadius = /** @type {number} */ (source.minRadius);
    }
    if (source.maxRadius !== undefined) {
      maxRadius = /** @type {number} */ (source.maxRadius);
    }
    if (source.halfWidth !== undefined) {
      halfWidth = /** @type {number} */ (source.halfWidth);
    }
    if (source.halfDepth !== undefined) {
      halfDepth = /** @type {number} */ (source.halfDepth);
    }
    if (source.colliderMargin !== undefined) {
      colliderMargin = /** @type {number} */ (source.colliderMargin);
    }
  }

  const radius = Math.hypot(pointValue.x, pointValue.z);
  if (radius < minRadius || radius > maxRadius) {
    return false;
  }
  const insideX = Math.abs(pointValue.x) <= halfWidth - ARENA_SPAWN_MARGIN;
  const insideZ = Math.abs(pointValue.z) <= halfDepth - ARENA_SPAWN_MARGIN;
  if (!insideX || !insideZ) {
    return false;
  }

  for (const collider of colliders) {
    if (isPointInsideCollider(pointValue, collider, colliderMargin)) {
      return false;
    }
  }

  const playerDistance = Math.hypot(
    pointValue.x - player.x,
    pointValue.z - player.z
  );
  if (playerDistance < minDistance) {
    return false;
  }

  return true;
}

/**
 * 把随机函数的一次输出限制在 [0, 1]。
 *
 * @param {() => number} random
 * @returns {number}
 */
function drawRandom(random) {
  const value = random();
  if (!isFiniteNumber(value)) {
    throw new TypeError('random 必须返回有限数字');
  }
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 在竞技场边缘 22–28 米环带内寻找合法出生点。
 *
 * 先做有限次随机尝试；若都失败，再按固定角度扫描环带，选择离玩家最远的合法点。
 * 仍找不到时抛出带具体约束的 Error，而不是返回一个可能卡在障碍物里的点。
 *
 * @param {{
 *   playerPosition?: {x: number, y: number, z: number},
 *   minDistance?: number,
 *   random?: () => number,
 *   attempts?: number
 * }} [request]
 * @returns {{x: number, y: number, z: number}}
 */
export function findSpawnPoint(request) {
  let playerPosition = { x: 0, y: 0, z: 0 };
  let minDistance = GAME_CONFIG.arena.minPlayerDistance;
  let random = Math.random;
  let attempts = DEFAULT_SPAWN_ATTEMPTS;
  let colliders = null;
  let layout = null;

  if (request !== undefined) {
    if (!isObject(request)) {
      throw new TypeError('findSpawnPoint 的 request 必须是对象');
    }
    const source = /** @type {Record<string, unknown>} */ (request);
    if (source.playerPosition !== undefined) {
      playerPosition = readPoint(source.playerPosition, 'findSpawnPoint 的 playerPosition');
    }
    if (source.minDistance !== undefined) {
      if (!isFiniteNumber(source.minDistance) || source.minDistance < 0) {
        throw new RangeError('findSpawnPoint 的 minDistance 必须是大于等于 0 的有限数字');
      }
      minDistance = source.minDistance;
    }
    if (source.random !== undefined) {
      if (typeof source.random !== 'function') {
        throw new TypeError('findSpawnPoint 的 random 必须是函数');
      }
      random = source.random;
    }
    if (source.attempts !== undefined) {
      if (!Number.isInteger(source.attempts) || source.attempts <= 0) {
        throw new RangeError('findSpawnPoint 的 attempts 必须是正整数');
      }
      attempts = Math.min(source.attempts, 512);
    }
    if (source.colliders !== undefined) {
      if (!Array.isArray(source.colliders)) {
        throw new TypeError('findSpawnPoint 的 colliders 必须是数组');
      }
      colliders = source.colliders;
    }
    if (source.layout !== undefined) {
      layout = source.layout;
    }
  }

  if (colliders === null) {
    if (layout === null) {
      layout = createLayout();
    }
    colliders = createColliders(layout);
  }

  const minRadius = GAME_CONFIG.arena.spawnMinRadius;
  const maxRadius = GAME_CONFIG.arena.spawnMaxRadius;

  for (let index = 0; index < attempts; index += 1) {
    const angle = drawRandom(random) * Math.PI * 2;
    const radius = minRadius + drawRandom(random) * (maxRadius - minRadius);
    const candidate = {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius
    };
    if (isSpawnPointValid(candidate, colliders, playerPosition, minDistance)) {
      return candidate;
    }
  }

  let best = null;
  let bestDistance = -1;
  const radii = [minRadius, (minRadius + maxRadius) / 2, maxRadius];
  for (let step = 0; step < FALLBACK_ANGLE_STEPS; step += 1) {
    const angle = (step / FALLBACK_ANGLE_STEPS) * Math.PI * 2;
    for (const radius of radii) {
      const candidate = {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius
      };
      if (!isSpawnPointValid(candidate, colliders, playerPosition, minDistance)) {
        continue;
      }
      const distance = Math.hypot(
        candidate.x - playerPosition.x,
        candidate.z - playerPosition.z
      );
      if (distance > bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }

  if (best !== null) {
    return best;
  }

  throw new Error(
    '无法在竞技场 ' +
      minRadius +
      '–' +
      maxRadius +
      ' 米环带找到合法出生点：候选点要么落在障碍物内，要么距玩家不足 ' +
      minDistance +
      ' 米。'
  );
}

/**
 * 返回安全的玩家出生点。当前布局把它放在竞技场中心，并要求中心 5 米内无障碍。
 *
 * @param {Readonly<Record<string, unknown>>} [layout]
 * @returns {{x: number, y: number, z: number}}
 */
export function getPlayerSpawn(layout) {
  let source = layout;
  if (source === undefined) {
    source = createLayout();
  }
  if (!isObject(source)) {
    throw new TypeError('getPlayerSpawn 需要布局对象');
  }
  const spawn = /** @type {Record<string, unknown>} */ (source).playerSpawn;
  if (!isObject(spawn)) {
    throw new TypeError('布局缺少 playerSpawn');
  }
  return readPoint(spawn, '布局的 playerSpawn');
}
