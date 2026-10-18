/**
 * 项目对 Three.js 的唯一公开入口。
 *
 * 这里只显式列出项目实际使用、并且允许 Service 层直接构造的符号。
 * 不使用 `export *`，也不导出 `WebGLRenderer` 等基础设施类：渲染器只能由
 * `src/providers/public/renderer.js` 的 `createRenderer()` 创建。
 *
 * 升级 Three.js 时需逐个核对下列名称仍然存在，并运行
 * `test/环境引擎/provider-contract.test.js`。
 *
 * v3 追加 `AnimationMixer` 与 `cloneSkinned`：敌方服务已经按冻结契约从本门面
 * 读取这两个符号播放骨骼动画和复制蒙皮模型。
 */

import { AnimationMixer } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export { AnimationMixer, cloneSkinned };

export {
  Vector2,
  Vector3,
  Vector4,
  Quaternion,
  Euler,
  Matrix4,
  Color,
  Group,
  Object3D,
  Scene,
  PerspectiveCamera,
  Mesh,
  InstancedMesh,
  Sprite,
  Line,
  LineSegments,
  Points,
  BoxGeometry,
  PlaneGeometry,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  TorusGeometry,
  RingGeometry,
  CapsuleGeometry,
  ShapeGeometry,
  Shape,
  ExtrudeGeometry,
  BufferGeometry,
  BufferAttribute,
  EdgesGeometry,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  PointsMaterial,
  SpriteMaterial,
  LineBasicMaterial,
  CanvasTexture,
  DataTexture,
  Texture,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  PointLight,
  SpotLight,
  Fog,
  FogExp2,
  Raycaster,
  Clock,
  MathUtils,
  Box3,
  Sphere,
  Plane,
  FrontSide,
  BackSide,
  DoubleSide,
  RepeatWrapping,
  ClampToEdgeWrapping,
  SRGBColorSpace,
  NoColorSpace,
  ACESFilmicToneMapping,
  PCFShadowMap,
  AdditiveBlending,
  NormalBlending,
  EquirectangularReflectionMapping
} from 'three';
