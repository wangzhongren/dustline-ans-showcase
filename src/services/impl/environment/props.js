/**
 * v3 军事场景道具。
 *
 * 负责把 `arena-layout.js` 中 `props` 分类的纯数据变成可见网格：HESCO 防爆墙、
 * 混凝土隔离墩、独立沙袋墙、集装箱门与锁杆、托盘、轮胎、帐篷、警示牌、
 * 弹药箱、探照灯、围栏铁丝网与地面草丛/碎石/纸屑。
 *
 * 依赖边界：
 * - 只导入 Provider 公共入口（`src/providers/public/three.js`）与同角色的纯布局
 *   模块 `arena-layout.js`；不导入其他 Service、Pipeline、Interface 或 Provider impl。
 *
 * 资源所有权：
 * - 共享材质（木材、帆布、混凝土、金属等）由 `arena.js` 创建和释放；本模块只借用。
 * - 本模块创建的几何体、实例缓冲和少量自有材质（铁丝网线条等）在 `dispose()` 释放。
 * - 托盘、轮胎、草丛、碎石、纸屑和污渍不产生碰撞；污渍由 decals 系统绘制。
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3
} from '../../../providers/public/three.js';
import { createPropColliders } from './arena-layout.js';

const BAG_WIDTH = 0.82;
const BAG_HEIGHT = 0.27;
const BAG_DEPTH = 0.62;
const HESCO_RAIL_HEIGHT = 0.06;
const Y_AXIS = new Vector3(0, 1, 0);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} field
 * @returns {number}
 */
function readNumber(entry, field) {
  const value = entry[field];
  if (!isFiniteNumber(value)) {
    throw new TypeError('道具记录缺少有限数字字段 ' + field);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} field
 * @returns {string}
 */
function readString(entry, field) {
  const value = entry[field];
  if (typeof value !== 'string') {
    throw new TypeError('道具记录缺少字符串字段 ' + field);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} materials
 * @param {string} key
 * @returns {import('three').Material}
 */
function requireMaterial(materials, key) {
  const material = materials[key];
  if (material === null || material === undefined) {
    throw new TypeError('道具材质缺少 materials.' + key);
  }
  return /** @type {import('three').Material} */ (material);
}

/**
 * 为需要 aoMap 的几何体补一套 uv1。
 *
 * @param {unknown} geometry
 * @returns {void}
 */
function ensureUv1(geometry) {
  if (!isObject(geometry)) {
    return;
  }
  const value = /** @type {Record<string, unknown>} */ (geometry);
  if (typeof value.getAttribute !== 'function') {
    return;
  }
  const uv = value.getAttribute('uv');
  if (uv === undefined || uv === null) {
    return;
  }
  const existing = value.getAttribute('uv1');
  if (existing !== undefined && existing !== null) {
    return;
  }
  const uvAttribute = /** @type {{array: ArrayLike<number>, itemSize: number}} */ (uv);
  const copy = new Float32Array(uvAttribute.array.length);
  copy.set(uvAttribute.array);
  value.setAttribute('uv1', new BufferAttribute(copy, uvAttribute.itemSize));
}

/**
 * 把字符串散列成稳定种子，保证草丛/碎石每次生成相同的布局。
 *
 * @param {string} text
 * @returns {number}
 */
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = hash ^ text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * @param {number} seed
 * @returns {() => number}
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * @param {number} rotationY
 * @returns {Quaternion}
 */
function createYaw(rotationY) {
  const quaternion = new Quaternion();
  quaternion.setFromAxisAngle(Y_AXIS, rotationY);
  return quaternion;
}

/**
 * @param {import('three').InstancedMesh} mesh
 * @param {number} index
 * @param {Vector3} position
 * @param {number} rotationY
 * @param {Vector3} scale
 * @returns {void}
 */
function setInstance(mesh, index, position, rotationY, scale) {
  const matrix = new Matrix4();
  matrix.compose(position, createYaw(rotationY), scale);
  mesh.setMatrixAt(index, matrix);
}

/**
 * 实例矩阵写完后统一提交，并按实例范围计算包围球；同时关闭视锥裁剪，
 * 避免 Three.js 用单位几何体的包围球误判整组实例不可见。
 *
 * @param {import('three').InstancedMesh} mesh
 * @returns {void}
 */
function finalizeInstances(mesh) {
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  if (typeof mesh.computeBoundingSphere === 'function') {
    mesh.computeBoundingSphere();
  }
}

/**
 * @param {unknown} object
 * @param {boolean} cast
 * @param {boolean} receive
 * @returns {void}
 */
function setShadows(object, cast, receive) {
  const value = /** @type {Record<string, unknown>} */ (object);
  value.castShadow = cast;
  value.receiveShadow = receive;
}

/**
 * 创建 v3 场景道具。
 *
 * @param {{
 *   layout: Readonly<Record<string, unknown>>,
 *   materials: Record<string, unknown>
 * }} options
 * @returns {{
 *   group: Group,
 *   colliders: ReadonlyArray<{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}}>,
 *   update: (dt: number) => void,
 *   dispose: () => void
 * }}
 */
export function createProps(options) {
  if (!isObject(options)) {
    throw new TypeError('createProps 需要 { layout, materials }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);
  if (!isObject(source.layout)) {
    throw new TypeError('createProps 的 layout 必须是布局对象');
  }
  if (!isObject(source.materials)) {
    throw new TypeError('createProps 的 materials 必须是材质表');
  }
  const layout = /** @type {Readonly<Record<string, unknown>>} */ (source.layout);
  const materials = /** @type {Record<string, unknown>} */ (source.materials);
  const props = layout.props;
  if (!isObject(props)) {
    throw new TypeError('布局缺少 props 分类');
  }
  const propLayout = /** @type {Record<string, unknown>} */ (props);

  const group = new Group();
  group.name = 'dustline-props';

  /** @type {Set<{dispose: () => void}>} */
  const ownedGeometries = new Set();
  /** @type {Set<{dispose: () => void}>} */
  const ownedMaterials = new Set();
  /** @type {Array<{light: SpotLight, baseIntensity: number, phase: number}>} */
  const searchlights = [];
  let disposed = false;
  let elapsed = 0;

  /**
   * @param {unknown} geometry
   * @returns {unknown}
   */
  function trackGeometry(geometry) {
    if (isObject(geometry)) {
      ownedGeometries.add(/** @type {{dispose: () => void}} */ (geometry));
    }
    return geometry;
  }

  /**
   * @param {string} key
   * @returns {Record<string, unknown>}
   */
  function readArray(key) {
    const value = propLayout[key];
    if (!Array.isArray(value)) {
      throw new TypeError('布局 props 缺少数组分类: ' + key);
    }
    return value;
  }

  /**
   * HESCO：khaki 内衬 + 镀锌角柱/顶栏。三个 InstancedMesh 承载全部模块。
   *
   * @returns {void}
   */
  function buildHesco() {
    const entries = readArray('hesco');
    if (entries.length === 0) {
      return;
    }
    let moduleCount = 0;
    for (const entry of entries) {
      moduleCount += readNumber(entry, 'modules') * readNumber(entry, 'layers');
    }
    const linerGeometry = trackGeometry(new BoxGeometry(1, 1, 1));
    ensureUv1(linerGeometry);
    const liner = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (linerGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'fabric')),
      moduleCount
    );
    const postGeometry = trackGeometry(new BoxGeometry(0.06, 1, 0.06));
    const posts = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (postGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'galvanized')),
      moduleCount * 4
    );
    const railGeometry = trackGeometry(new BoxGeometry(1, HESCO_RAIL_HEIGHT, 0.06));
    const rails = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (railGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'galvanized')),
      moduleCount * 2
    );
    // 镀锌网面：用 wireframe 外壳近似 HESCO 的网格表面，只增加一个 draw call。
    const meshMaterial = requireMaterial(materials, 'galvanized').clone();
    meshMaterial.wireframe = true;
    ownedMaterials.add(meshMaterial);
    const meshGeometry = trackGeometry(new BoxGeometry(1, 1, 1));
    const meshShell = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (meshGeometry),
      /** @type {import('three').Material} */ (meshMaterial),
      moduleCount
    );

    let linerIndex = 0;
    let postIndex = 0;
    let railIndex = 0;
    let meshIndex = 0;
    for (const entry of entries) {
      const entryX = readNumber(entry, 'x');
      const entryZ = readNumber(entry, 'z');
      const rotationY = readNumber(entry, 'rotationY');
      const modules = readNumber(entry, 'modules');
      const layers = readNumber(entry, 'layers');
      const moduleWidth = readNumber(entry, 'moduleWidth');
      const moduleDepth = readNumber(entry, 'moduleDepth');
      const moduleHeight = readNumber(entry, 'moduleHeight');
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      for (let layer = 0; layer < layers; layer += 1) {
        for (let moduleIndex = 0; moduleIndex < modules; moduleIndex += 1) {
          const localX = -moduleWidth * modules / 2 + moduleWidth / 2 + moduleIndex * moduleWidth;
          const localZ = 0;
          const worldX = entryX + localX * cos + localZ * sin;
          const worldZ = entryZ - localX * sin + localZ * cos;
          const bottom = layer * moduleHeight;
          setInstance(
            liner,
            linerIndex,
            new Vector3(worldX, bottom + moduleHeight / 2, worldZ),
            rotationY,
            new Vector3(moduleWidth * 0.96, moduleHeight * 0.94, moduleDepth * 0.94)
          );
          linerIndex += 1;
          setInstance(
            meshShell,
            meshIndex,
            new Vector3(worldX, bottom + moduleHeight / 2, worldZ),
            rotationY,
            new Vector3(moduleWidth * 0.985, moduleHeight * 0.965, moduleDepth * 0.985)
          );
          meshIndex += 1;

          const halfWidth = moduleWidth / 2 - 0.05;
          const halfDepth = moduleDepth / 2 - 0.05;
          const corners = [
            { x: -halfWidth, z: -halfDepth },
            { x: halfWidth, z: -halfDepth },
            { x: -halfWidth, z: halfDepth },
            { x: halfWidth, z: halfDepth }
          ];
          for (const corner of corners) {
            const postWorldX = entryX + (localX + corner.x) * cos + corner.z * sin;
            const postWorldZ = entryZ - (localX + corner.x) * sin + corner.z * cos;
            setInstance(
              posts,
              postIndex,
              new Vector3(postWorldX, bottom + moduleHeight / 2, postWorldZ),
              rotationY,
              new Vector3(1, moduleHeight, 1)
            );
            postIndex += 1;
          }

          const railZ = moduleDepth / 2 - 0.03;
          const railOffsets = [-railZ, railZ];
          for (const offsetZ of railOffsets) {
            const railWorldX = entryX + localX * cos + offsetZ * sin;
            const railWorldZ = entryZ - localX * sin + offsetZ * cos;
            setInstance(
              rails,
              railIndex,
              new Vector3(railWorldX, bottom + moduleHeight, railWorldZ),
              rotationY,
              new Vector3(moduleWidth, 1, 1)
            );
            railIndex += 1;
          }
        }
      }
    }

    finalizeInstances(liner);
    finalizeInstances(posts);
    finalizeInstances(rails);
    finalizeInstances(meshShell);
    setShadows(liner, true, true);
    setShadows(posts, true, true);
    setShadows(rails, true, true);
    setShadows(meshShell, false, false);
    group.add(liner, posts, rails, meshShell);
  }

  /**
   * 混凝土隔离墩：挤出截面 + InstancedMesh。
   *
   * @returns {void}
   */
  function buildJerseyBarriers() {
    const entries = readArray('jersey');
    if (entries.length === 0) {
      return;
    }
    const profile = new Shape();
    profile.moveTo(-0.31, 0);
    profile.lineTo(0.31, 0);
    profile.lineTo(0.19, 0.22);
    profile.lineTo(0.12, 0.9);
    profile.lineTo(-0.12, 0.9);
    profile.lineTo(-0.19, 0.22);
    profile.closePath();
    const geometry = trackGeometry(
      new ExtrudeGeometry(profile, {
        depth: 1,
        bevelEnabled: false,
        steps: 1
      })
    );
    geometry.rotateY(Math.PI / 2);
    geometry.translate(-0.5, 0, 0);
    ensureUv1(geometry);
    const mesh = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (geometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'concrete')),
      entries.length
    );
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      setInstance(
        mesh,
        index,
        new Vector3(readNumber(entry, 'x'), 0, readNumber(entry, 'z')),
        readNumber(entry, 'rotationY'),
        new Vector3(
          readNumber(entry, 'width'),
          readNumber(entry, 'height') / 0.9,
          readNumber(entry, 'depth') / 0.62
        )
      );
    }
    finalizeInstances(mesh);
    setShadows(mesh, true, true);
    group.add(mesh);
  }

  /**
   * 独立沙袋墙：3–4 层错缝。全部沙袋合并为一个 InstancedMesh。
   *
   * @returns {void}
   */
  function buildSandbagWalls() {
    const entries = readArray('sandbagWalls');
    if (entries.length === 0) {
      return;
    }
    let bagCount = 0;
    for (const entry of entries) {
      const rows = Math.max(3, Math.round(readNumber(entry, 'height') / BAG_HEIGHT));
      const perRow = Math.max(1, Math.round(readNumber(entry, 'width') / BAG_WIDTH));
      bagCount += rows * perRow;
    }
    const geometry = trackGeometry(new BoxGeometry(1, 1, 1));
    ensureUv1(geometry);
    const mesh = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (geometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'fabric')),
      bagCount
    );
    let bagIndex = 0;
    for (const entry of entries) {
      const entryX = readNumber(entry, 'x');
      const entryZ = readNumber(entry, 'z');
      const rotationY = readNumber(entry, 'rotationY');
      const width = readNumber(entry, 'width');
      const depth = readNumber(entry, 'depth');
      const height = readNumber(entry, 'height');
      const rows = Math.max(3, Math.round(height / BAG_HEIGHT));
      const perRow = Math.max(1, Math.round(width / BAG_WIDTH));
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      for (let row = 0; row < rows; row += 1) {
        let offset = 0;
        if (row % 2 === 1) {
          offset = BAG_WIDTH * 0.5;
        }
        for (let column = 0; column < perRow; column += 1) {
          const localX = -width / 2 + BAG_WIDTH / 2 + column * BAG_WIDTH + offset;
          if (localX > width / 2 - BAG_WIDTH * 0.25) {
            continue;
          }
          const localZ = Math.sin((row * 7 + column) * 1.3) * 0.02;
          const worldX = entryX + localX * cos + localZ * sin;
          const worldZ = entryZ - localX * sin + localZ * cos;
          setInstance(
            mesh,
            bagIndex,
            new Vector3(worldX, BAG_HEIGHT / 2 + row * BAG_HEIGHT, worldZ),
            rotationY,
            new Vector3(BAG_WIDTH * 0.96, BAG_HEIGHT * 0.9, depth * 0.92)
          );
          bagIndex += 1;
        }
      }
    }
    mesh.count = bagIndex;
    finalizeInstances(mesh);
    setShadows(mesh, true, true);
    group.add(mesh);
  }

  /**
   * 集装箱门、竖向锁杆、把手与铰链。
   *
   * @returns {void}
   */
  function buildContainerDoors() {
    const containers = layout.containers;
    if (!Array.isArray(containers)) {
      throw new TypeError('布局缺少 containers 分类');
    }
    for (const container of containers) {
      const width = readNumber(container, 'width');
      const height = readNumber(container, 'height');
      const depth = readNumber(container, 'depth');
      const x = readNumber(container, 'x');
      const z = readNumber(container, 'z');
      const rotationY = readNumber(container, 'rotationY');
      const tint = readString(container, 'tint');
      let panelMaterial = requireMaterial(materials, 'steelOlive');
      if (tint === 'khaki') {
        panelMaterial = requireMaterial(materials, 'steelKhaki');
      } else if (tint === 'rust') {
        panelMaterial = requireMaterial(materials, 'steelRust');
      }
      const doorGroup = new Group();
      doorGroup.position.set(x, 0, z);
      doorGroup.rotation.y = rotationY;

      const panelGeometry = trackGeometry(new BoxGeometry(0.08, height * 0.88, depth * 0.9));
      ensureUv1(panelGeometry);
      const panel = new Mesh(
        /** @type {import('three').BufferGeometry} */ (panelGeometry),
        /** @type {import('three').Material} */ (panelMaterial)
      );
      panel.position.set(width / 2 + 0.02, height * 0.46, 0);
      setShadows(panel, true, true);
      doorGroup.add(panel);

      const barGeometry = trackGeometry(new CylinderGeometry(0.025, 0.025, height * 0.78, 6));
      const barMaterial = requireMaterial(materials, 'metalRust');
      const barZ = [-depth * 0.24, depth * 0.24];
      for (const offsetZ of barZ) {
        const bar = new Mesh(
          /** @type {import('three').BufferGeometry} */ (barGeometry),
          /** @type {import('three').Material} */ (barMaterial)
        );
        bar.position.set(width / 2 + 0.08, height * 0.48, offsetZ);
        setShadows(bar, true, false);
        doorGroup.add(bar);

        const handleGeometry = trackGeometry(new BoxGeometry(0.06, 0.22, 0.05));
        const handle = new Mesh(
          /** @type {import('three').BufferGeometry} */ (handleGeometry),
          /** @type {import('three').Material} */ (requireMaterial(materials, 'metal'))
        );
        handle.position.set(width / 2 + 0.11, height * 0.56, offsetZ);
        setShadows(handle, false, false);
        doorGroup.add(handle);
      }

      const hingeGeometry = trackGeometry(new BoxGeometry(0.1, 0.12, 0.08));
      const hingeMaterial = requireMaterial(materials, 'metalRust');
      const hingeY = [height * 0.2, height * 0.48, height * 0.76];
      for (const offsetY of hingeY) {
        const hinge = new Mesh(
          /** @type {import('three').BufferGeometry} */ (hingeGeometry),
          /** @type {import('three').Material} */ (hingeMaterial)
        );
        hinge.position.set(width / 2 + 0.05, offsetY, depth / 2 - 0.1);
        setShadows(hinge, false, false);
        doorGroup.add(hinge);
      }

      group.add(doorGroup);
    }
  }

  /**
   * 托盘：每个托盘 5 块面板 + 3 根底梁，全部合并进一个 InstancedMesh。
   *
   * @returns {void}
   */
  function buildPallets() {
    const entries = readArray('pallets');
    if (entries.length === 0) {
      return;
    }
    let slatCount = 0;
    for (const entry of entries) {
      slatCount += readNumber(entry, 'stack') * 8;
    }
    const geometry = trackGeometry(new BoxGeometry(1, 1, 1));
    ensureUv1(geometry);
    const mesh = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (geometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'wood')),
      slatCount
    );
    let index = 0;
    for (const entry of entries) {
      const x = readNumber(entry, 'x');
      const z = readNumber(entry, 'z');
      const rotationY = readNumber(entry, 'rotationY');
      const stack = readNumber(entry, 'stack');
      for (let layer = 0; layer < stack; layer += 1) {
        const baseY = layer * 0.16;
        for (let slat = 0; slat < 5; slat += 1) {
          const offsetZ = -0.38 + slat * 0.19;
          const cos = Math.cos(rotationY);
          const sin = Math.sin(rotationY);
          setInstance(
            mesh,
            index,
            new Vector3(x + offsetZ * sin, baseY + 0.14, z + offsetZ * cos),
            rotationY,
            new Vector3(1.1, 0.035, 0.15)
          );
          index += 1;
        }
        for (let runner = 0; runner < 3; runner += 1) {
          const offsetX = -0.42 + runner * 0.42;
          const cos = Math.cos(rotationY);
          const sin = Math.sin(rotationY);
          setInstance(
            mesh,
            index,
            new Vector3(x + offsetX * cos, baseY + 0.05, z - offsetX * sin),
            rotationY,
            new Vector3(0.12, 0.09, 1.0)
          );
          index += 1;
        }
      }
    }
    mesh.count = index;
    finalizeInstances(mesh);
    setShadows(mesh, true, true);
    group.add(mesh);
  }

  /**
   * 轮胎堆：TorusGeometry 平放，实例化。
   *
   * @returns {void}
   */
  function buildTires() {
    const entries = readArray('tires');
    if (entries.length === 0) {
      return;
    }
    let tireCount = 0;
    for (const entry of entries) {
      tireCount += readNumber(entry, 'count');
    }
    const geometry = trackGeometry(new TorusGeometry(0.36, 0.13, 8, 16));
    geometry.rotateX(Math.PI / 2);
    const mesh = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (geometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'rubber')),
      tireCount
    );
    let index = 0;
    for (const entry of entries) {
      const x = readNumber(entry, 'x');
      const z = readNumber(entry, 'z');
      const rotationY = readNumber(entry, 'rotationY');
      const count = readNumber(entry, 'count');
      for (let tire = 0; tire < count; tire += 1) {
        setInstance(
          mesh,
          index,
          new Vector3(x + (tire % 2) * 0.08, 0.13 + tire * 0.22, z),
          rotationY + tire * 0.37,
          new Vector3(1, 1, 1)
        );
        index += 1;
      }
    }
    finalizeInstances(mesh);
    setShadows(mesh, true, true);
    group.add(mesh);
  }

  /**
   * 帐篷：帆布主体 + 脊顶 + 四角立柱 + 拉绳。
   *
   * @returns {void}
   */
  function buildTents() {
    const entries = readArray('tents');
    for (const entry of entries) {
      const width = readNumber(entry, 'width');
      const depth = readNumber(entry, 'depth');
      const height = readNumber(entry, 'height');
      const rotationY = readNumber(entry, 'rotationY');
      const tint = readString(entry, 'tint');
      let canvasMaterial = requireMaterial(materials, 'canvasKhaki');
      if (tint === 'olive') {
        canvasMaterial = requireMaterial(materials, 'canvasOlive');
      }
      const tentGroup = new Group();
      tentGroup.position.set(readNumber(entry, 'x'), 0, readNumber(entry, 'z'));
      tentGroup.rotation.y = rotationY;

      const bodyGeometry = trackGeometry(new BoxGeometry(width, height * 0.72, depth));
      ensureUv1(bodyGeometry);
      const body = new Mesh(
        /** @type {import('three').BufferGeometry} */ (bodyGeometry),
        /** @type {import('three').Material} */ (canvasMaterial)
      );
      body.position.y = height * 0.36;
      setShadows(body, true, true);
      tentGroup.add(body);

      const ridgeGeometry = trackGeometry(new BoxGeometry(width * 1.08, 0.08, depth * 0.42));
      const ridge = new Mesh(
        /** @type {import('three').BufferGeometry} */ (ridgeGeometry),
        /** @type {import('three').Material} */ (canvasMaterial)
      );
      ridge.position.y = height * 0.78;
      setShadows(ridge, true, false);
      tentGroup.add(ridge);

      const poleGeometry = trackGeometry(new BoxGeometry(0.06, height * 0.78, 0.06));
      const poleMaterial = requireMaterial(materials, 'metal');
      const corners = [
        { x: -width / 2 + 0.12, z: -depth / 2 + 0.12 },
        { x: width / 2 - 0.12, z: -depth / 2 + 0.12 },
        { x: -width / 2 + 0.12, z: depth / 2 - 0.12 },
        { x: width / 2 - 0.12, z: depth / 2 - 0.12 }
      ];
      for (const corner of corners) {
        const pole = new Mesh(
          /** @type {import('three').BufferGeometry} */ (poleGeometry),
          /** @type {import('three').Material} */ (poleMaterial)
        );
        pole.position.set(corner.x, height * 0.39, corner.z);
        setShadows(pole, true, false);
        tentGroup.add(pole);
      }

      const linePositions = [];
      for (const corner of corners) {
        linePositions.push(corner.x, height * 0.74, corner.z);
        linePositions.push(corner.x * 1.35, 0.02, corner.z * 1.35);
      }
      const lineGeometry = trackGeometry(new BufferGeometry());
      lineGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(linePositions), 3)
      );
      const lineMaterial = new LineBasicMaterial({ color: 0x6d6a5e });
      ownedMaterials.add(lineMaterial);
      tentGroup.add(new LineSegments(lineGeometry, lineMaterial));

      group.add(tentGroup);
    }
  }

  /**
   * 警示牌：立柱 + 旧金属牌面。实例化以减少 draw call。
   *
   * @returns {void}
   */
  function buildSigns() {
    const entries = readArray('signs');
    if (entries.length === 0) {
      return;
    }
    const poleGeometry = trackGeometry(new BoxGeometry(0.06, 1.8, 0.06));
    const poles = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (poleGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'metal')),
      entries.length
    );
    const plateGeometry = trackGeometry(new BoxGeometry(0.72, 0.46, 0.04));
    const plates = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (plateGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'sign')),
      entries.length
    );
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const x = readNumber(entry, 'x');
      const z = readNumber(entry, 'z');
      const rotationY = readNumber(entry, 'rotationY');
      setInstance(poles, index, new Vector3(x, 0.9, z), rotationY, new Vector3(1, 1, 1));
      setInstance(plates, index, new Vector3(x, 1.55, z), rotationY, new Vector3(1, 1, 1));
    }
    finalizeInstances(poles);
    finalizeInstances(plates);
    setShadows(poles, true, false);
    setShadows(plates, true, false);
    group.add(poles, plates);
  }

  /**
   * 弹药箱：实例化箱体 + 两道卡扣。
   *
   * @returns {void}
   */
  function buildAmmoCrates() {
    const entries = readArray('ammoCrates');
    if (entries.length === 0) {
      return;
    }
    const crateGeometry = trackGeometry(new BoxGeometry(1, 1, 1));
    const crates = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (crateGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'ammo')),
      entries.length
    );
    const latchGeometry = trackGeometry(new BoxGeometry(1, 1, 1));
    const latches = new InstancedMesh(
      /** @type {import('three').BufferGeometry} */ (latchGeometry),
      /** @type {import('three').Material} */ (requireMaterial(materials, 'metal')),
      entries.length * 2
    );
    let latchIndex = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const x = readNumber(entry, 'x');
      const z = readNumber(entry, 'z');
      const width = readNumber(entry, 'width');
      const height = readNumber(entry, 'height');
      const depth = readNumber(entry, 'depth');
      const rotationY = readNumber(entry, 'rotationY');
      setInstance(
        crates,
        index,
        new Vector3(x, height / 2, z),
        rotationY,
        new Vector3(width, height, depth)
      );
      const offsets = [-depth * 0.3, depth * 0.3];
      for (const offsetZ of offsets) {
        const cos = Math.cos(rotationY);
        const sin = Math.sin(rotationY);
        setInstance(
          latches,
          latchIndex,
          new Vector3(x + offsetZ * sin, height + 0.018, z + offsetZ * cos),
          rotationY,
          new Vector3(width * 0.12, 0.035, 0.08)
        );
        latchIndex += 1;
      }
    }
    finalizeInstances(crates);
    finalizeInstances(latches);
    setShadows(crates, true, true);
    setShadows(latches, false, false);
    group.add(crates, latches);
  }

  /**
   * 探照灯：灯杆 + 灯壳 + 发光灯罩 + 暖色 SpotLight。
   * 灯光数量固定为 2，Bloom 只会让灯罩和枪口轻微溢出。
   *
   * @returns {void}
   */
  function buildSearchlights() {
    const entries = readArray('searchlights');
    for (const entry of entries) {
      const x = readNumber(entry, 'x');
      const z = readNumber(entry, 'z');
      const height = readNumber(entry, 'height');
      const rotationY = readNumber(entry, 'rotationY');
      const lightGroup = new Group();
      lightGroup.position.set(x, 0, z);
      lightGroup.rotation.y = rotationY;

      const poleGeometry = trackGeometry(new CylinderGeometry(0.07, 0.1, height, 8));
      const pole = new Mesh(
        /** @type {import('three').BufferGeometry} */ (poleGeometry),
        /** @type {import('three').Material} */ (requireMaterial(materials, 'darkMetal'))
      );
      pole.position.y = height / 2;
      setShadows(pole, true, false);
      lightGroup.add(pole);

      const housingGeometry = trackGeometry(new BoxGeometry(0.5, 0.34, 0.34));
      const housing = new Mesh(
        /** @type {import('three').BufferGeometry} */ (housingGeometry),
        /** @type {import('three').Material} */ (requireMaterial(materials, 'darkMetal'))
      );
      housing.position.y = height + 0.1;
      setShadows(housing, true, false);
      lightGroup.add(housing);

      const lampGeometry = trackGeometry(new SphereGeometry(0.13, 10, 8));
      const lamp = new Mesh(
        /** @type {import('three').BufferGeometry} */ (lampGeometry),
        /** @type {import('three').Material} */ (requireMaterial(materials, 'lamp'))
      );
      lamp.position.set(0, height + 0.08, 0.22);
      lightGroup.add(lamp);

      const light = new SpotLight(0xffd8a0, 22, 22, 0.42, 0.6, 1.4);
      light.position.set(0, height + 0.08, 0.24);
      light.target.position.set(0, 0, 7);
      light.castShadow = false;
      lightGroup.add(light);
      lightGroup.add(light.target);

      searchlights.push({
        light,
        baseIntensity: 22,
        phase: searchlights.length * 1.7
      });
      group.add(lightGroup);
    }
  }

  /**
   * 围栏顶部蛇腹铁丝：所有围栏合并成一个 LineSegments。
   *
   * @returns {void}
   */
  function buildFenceWire() {
    const fences = layout.fences;
    if (!Array.isArray(fences)) {
      throw new TypeError('布局缺少 fences 分类');
    }
    const positions = [];
    for (const fence of fences) {
      const x = readNumber(fence, 'x');
      const z = readNumber(fence, 'z');
      const width = readNumber(fence, 'width');
      const height = readNumber(fence, 'height');
      const rotationY = readNumber(fence, 'rotationY');
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      const steps = Math.max(4, Math.round(width / 0.6));
      for (let step = 0; step < steps; step += 1) {
        const localX = -width / 2 + (step / steps) * width;
        const nextLocalX = -width / 2 + ((step + 1) / steps) * width;
        const y = height + 0.12;
        const nextY = height + 0.34;
        positions.push(
          x + localX * cos,
          y,
          z - localX * sin,
          x + nextLocalX * cos,
          nextY,
          z - nextLocalX * sin
        );
      }
    }
    if (positions.length === 0) {
      return;
    }
    const geometry = trackGeometry(new BufferGeometry());
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3)
    );
    const material = new LineBasicMaterial({ color: 0x777b74 });
    ownedMaterials.add(material);
    group.add(new LineSegments(geometry, material));
  }

  /**
   * 地面草丛、碎石与纸屑。全部实例化，不产生碰撞。
   *
   * @returns {void}
   */
  function buildGroundPatches() {
    const entries = readArray('groundPatches');
    let grassCount = 0;
    let rubbleCount = 0;
    let paperCount = 0;
    for (const entry of entries) {
      const kind = readString(entry, 'kind');
      const count = readNumber(entry, 'count');
      if (kind === 'grass') {
        grassCount += count;
      } else if (kind === 'rubble') {
        rubbleCount += count;
      } else if (kind === 'paper') {
        paperCount += count;
      }
    }

    if (grassCount > 0) {
      const geometry = trackGeometry(new ConeGeometry(0.06, 0.32, 4));
      const mesh = new InstancedMesh(
        /** @type {import('three').BufferGeometry} */ (geometry),
        /** @type {import('three').Material} */ (requireMaterial(materials, 'grass')),
        grassCount
      );
      let index = 0;
      for (const entry of entries) {
        if (readString(entry, 'kind') !== 'grass') {
          continue;
        }
        const random = createRandom(hashSeed(readString(entry, 'id')));
        index = placePatchInstances(mesh, index, entry, random, 0.03, 0.05);
      }
      mesh.count = index;
      finalizeInstances(mesh);
      setShadows(mesh, false, true);
      group.add(mesh);
    }

    if (rubbleCount > 0) {
      const geometry = trackGeometry(new SphereGeometry(0.09, 4, 3));
      const mesh = new InstancedMesh(
        /** @type {import('three').BufferGeometry} */ (geometry),
        /** @type {import('three').Material} */ (requireMaterial(materials, 'rock')),
        rubbleCount
      );
      let index = 0;
      for (const entry of entries) {
        if (readString(entry, 'kind') !== 'rubble') {
          continue;
        }
        const random = createRandom(hashSeed(readString(entry, 'id')));
        index = placePatchInstances(mesh, index, entry, random, 0.01, 0.03);
      }
      mesh.count = index;
      finalizeInstances(mesh);
      setShadows(mesh, true, true);
      group.add(mesh);
    }

    if (paperCount > 0) {
      const geometry = trackGeometry(new PlaneGeometry(0.18, 0.26));
      geometry.rotateX(-Math.PI / 2);
      const material = new MeshStandardMaterial({
        color: 0xb9b4a6,
        roughness: 0.95,
        metalness: 0,
        side: DoubleSide
      });
      ownedMaterials.add(material);
      const mesh = new InstancedMesh(
        /** @type {import('three').BufferGeometry} */ (geometry),
        /** @type {import('three').Material} */ (material),
        paperCount
      );
      let index = 0;
      for (const entry of entries) {
        if (readString(entry, 'kind') !== 'paper') {
          continue;
        }
        const random = createRandom(hashSeed(readString(entry, 'id')));
        index = placePatchInstances(mesh, index, entry, random, 0.012, 0.008);
      }
      mesh.count = index;
      finalizeInstances(mesh);
      setShadows(mesh, false, true);
      group.add(mesh);
    }
  }

  /**
   * 在一个地面装饰区域内放置实例。
   *
   * @param {import('three').InstancedMesh} mesh
   * @param {number} startIndex
   * @param {Record<string, unknown>} entry
   * @param {() => number} random
   * @param {number} baseY
   * @param {number} yJitter
   * @returns {number}
   */
  function placePatchInstances(mesh, startIndex, entry, random, baseY, yJitter) {
    const x = readNumber(entry, 'x');
    const z = readNumber(entry, 'z');
    const count = readNumber(entry, 'count');
    const radius = readNumber(entry, 'radius');
    let index = startIndex;
    for (let item = 0; item < count; item += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      const scale = 0.65 + random() * 0.9;
      setInstance(
        mesh,
        index,
        new Vector3(
          x + Math.cos(angle) * distance,
          baseY + random() * yJitter,
          z + Math.sin(angle) * distance
        ),
        random() * Math.PI * 2,
        new Vector3(scale, 0.7 + random() * 0.8, scale)
      );
      index += 1;
    }
    return index;
  }

  /**
   * 释放本模块创建的几何体、实例缓冲与自有材质。共享材质不在这里释放。
   *
   * @returns {void}
   */
  function disposeOwned() {
    if (disposed) {
      return;
    }
    disposed = true;
    searchlights.length = 0;
    group.traverse((node) => {
      const value = /** @type {Record<string, unknown>} */ (node);
      if (typeof value.dispose === 'function') {
        try {
          value.dispose();
        } catch (error) {
          console.error('[props] 释放实例缓冲失败', error);
        }
      }
    });
    group.clear();
    for (const geometry of ownedGeometries) {
      geometry.dispose();
    }
    ownedGeometries.clear();
    for (const material of ownedMaterials) {
      material.dispose();
    }
    ownedMaterials.clear();
  }

  try {
    buildHesco();
    buildJerseyBarriers();
    buildSandbagWalls();
    buildContainerDoors();
    buildPallets();
    buildTires();
    buildTents();
    buildSigns();
    buildAmmoCrates();
    buildSearchlights();
    buildFenceWire();
    buildGroundPatches();
  } catch (error) {
    console.error('[props] 创建场景道具失败，清理已创建资源', error);
    disposeOwned();
    throw error;
  }

  return {
    group,
    colliders: createPropColliders(layout),

    /**
     * 探照灯轻微闪烁与扫动，让静态场景有一点“空气在动”的感觉。
     *
     * @param {number} dt
     * @returns {void}
     */
    update(dt) {
      if (disposed) {
        throw new Error('props 已释放，不能继续更新');
      }
      if (!isFiniteNumber(dt) || dt < 0) {
        throw new RangeError('props.update 的 dt 必须是大于等于 0 的有限数字');
      }
      let step = dt;
      if (step > 0.1) {
        step = 0.1;
      }
      elapsed += step;
      for (const entry of searchlights) {
        const wave = Math.sin(elapsed * 1.7 + entry.phase);
        entry.light.intensity = entry.baseIntensity * (0.9 + wave * 0.1);
        entry.light.target.position.x = Math.sin(elapsed * 0.23 + entry.phase) * 2.2;
      }
    },

    /**
     * 释放本模块创建的几何体、实例缓冲与自有材质。共享材质不在这里释放。
     *
     * @returns {void}
     */
    dispose() {
      disposeOwned();
    }
  };
}
