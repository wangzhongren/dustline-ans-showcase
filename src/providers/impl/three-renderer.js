/**
 * Three.js 渲染 Provider 实现。
 *
 * 只把 Three.js 的场景、相机、射线与环境能力适配成 `abstract/renderer.js`
 * 里的稳定契约。业务规则（生命、命中判定、波次）不在这里。
 */

import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  MathUtils,
  Matrix3,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three';

import { GAME_CONFIG } from '../../models/game-config.js';
import { createVector3 } from '../../models/contracts.js';
import { createPostProcessing } from './post-processing.js';

/** 俯仰角上限（弧度），避免视线翻转。 */
const PITCH_LIMIT = 1.55;
const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 900;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 500;
const DEFAULT_PIXEL_RATIO = 1;
const MAX_PIXEL_RATIO = 2;
const DEFAULT_FOG_COLOR = 0xb9c2c8;
const DEFAULT_FOG_NEAR = 25;
const DEFAULT_FOG_FAR = 95;
const HIGH_QUALITY_SHADOW_SIZE = 2048;
const LOW_QUALITY_SHADOW_SIZE = 1024;

/** 允许的画质档位。 */
export const QUALITY_LEVELS = Object.freeze(['high', 'low']);

/**
 * 校验并归一化画质档位。
 *
 * @param {unknown} value
 * @returns {'high'|'low'}
 */
export function normalizeQuality(value) {
  if (value === 'high' || value === 'low') {
    return value;
  }
  throw new RangeError("画质只能是 'high' 或 'low'，收到: " + String(value));
}

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
 * @param {unknown} value
 * @param {string} label
 * @returns {Vector3}
 */
function readVector(value, label) {
  if (!isObject(value)) {
    throw new TypeError(label + ' 必须是 { x, y, z } 对象');
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  if (
    !isFiniteNumber(source.x) ||
    !isFiniteNumber(source.y) ||
    !isFiniteNumber(source.z)
  ) {
    throw new TypeError(label + ' 的 x/y/z 必须是有限数字');
  }
  return new Vector3(
    /** @type {number} */ (source.x),
    /** @type {number} */ (source.y),
    /** @type {number} */ (source.z)
  );
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function readPixelRatio(value, fallback) {
  if (value !== undefined) {
    if (!isFiniteNumber(value) || value <= 0) {
      throw new RangeError('pixelRatio 必须是大于 0 的有限数字');
    }
    return value;
  }
  if (
    typeof window !== 'undefined' &&
    isFiniteNumber(window.devicePixelRatio) &&
    window.devicePixelRatio > 0
  ) {
    return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
  }
  return fallback;
}

/**
 * 把部分相机姿态写到 Three.js 相机上。抽成独立函数便于在没有 WebGL 的
 * Node 测试里用 `PerspectiveCamera` 验证 roll、pitch 限制与震动偏移。
 *
 * @param {import('three').PerspectiveCamera} camera
 * @param {Partial<import('../abstract/renderer.js').RendererPose>} pose
 * @returns {import('../abstract/renderer.js').RendererPose}
 */
export function applyCameraPose(camera, pose) {
  if (camera === null || camera === undefined) {
    throw new TypeError('applyCameraPose 需要 PerspectiveCamera');
  }
  if (!isObject(pose)) {
    throw new TypeError('setCameraPose 需要 { position, yaw, pitch, roll, fov } 对象');
  }
  const source = /** @type {Record<string, unknown>} */ (pose);

  if (source.position !== undefined) {
    const position = createVector3(source.position, 'setCameraPose 的 position');
    camera.position.set(position.x, position.y, position.z);
  }
  if (source.yaw !== undefined) {
    if (!isFiniteNumber(source.yaw)) {
      throw new TypeError('setCameraPose 的 yaw 必须是有限数字');
    }
    camera.rotation.y = source.yaw;
  }
  if (source.pitch !== undefined) {
    if (!isFiniteNumber(source.pitch)) {
      throw new TypeError('setCameraPose 的 pitch 必须是有限数字');
    }
    camera.rotation.x = MathUtils.clamp(source.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  let roll = 0;
  if (source.roll !== undefined) {
    if (!isFiniteNumber(source.roll)) {
      throw new TypeError('setCameraPose 的 roll 必须是有限数字');
    }
    roll = source.roll;
  }
  camera.rotation.z = roll;

  let shakeX = 0;
  if (source.shakeX !== undefined) {
    if (!isFiniteNumber(source.shakeX)) {
      throw new TypeError('setCameraPose 的 shakeX 必须是有限数字');
    }
    shakeX = source.shakeX;
  }
  let shakeY = 0;
  if (source.shakeY !== undefined) {
    if (!isFiniteNumber(source.shakeY)) {
      throw new TypeError('setCameraPose 的 shakeY 必须是有限数字');
    }
    shakeY = source.shakeY;
  }
  if (shakeX !== 0) {
    camera.position.x = camera.position.x + shakeX;
  }
  if (shakeY !== 0) {
    camera.position.y = camera.position.y + shakeY;
  }

  if (source.fov !== undefined) {
    if (!isFiniteNumber(source.fov) || source.fov <= 0) {
      throw new RangeError('setCameraPose 的 fov 必须是大于 0 的有限数字');
    }
    camera.fov = source.fov;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld(true);
  return {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z
    },
    yaw: camera.rotation.y,
    pitch: camera.rotation.x,
    roll: camera.rotation.z,
    fov: camera.fov
  };
}

/**
 * 创建 Three.js 渲染器。
 *
 * @param {import('../abstract/renderer.js').CreateRendererOptions} options
 * @returns {import('../abstract/renderer.js').Renderer}
 */
export function createThreeRenderer(options) {
  if (!isObject(options)) {
    throw new TypeError('createRenderer 需要参数对象 { canvas, width, height }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);
  const canvas = source.canvas;
  if (canvas === null || canvas === undefined) {
    throw new TypeError('createRenderer 需要调用方提供 canvas（HTMLCanvasElement）');
  }

  let width = DEFAULT_WIDTH;
  if (isFiniteNumber(source.width)) {
    if (source.width <= 0) {
      throw new RangeError('width 必须是大于 0 的有限数字');
    }
    width = source.width;
  } else if (isFiniteNumber(canvas.width) && canvas.width > 0) {
    width = canvas.width;
  }

  let height = DEFAULT_HEIGHT;
  if (isFiniteNumber(source.height)) {
    if (source.height <= 0) {
      throw new RangeError('height 必须是大于 0 的有限数字');
    }
    height = source.height;
  } else if (isFiniteNumber(canvas.height) && canvas.height > 0) {
    height = canvas.height;
  }

  let shadows = true;
  if (source.shadows !== undefined) {
    if (typeof source.shadows !== 'boolean') {
      throw new TypeError('shadows 必须是布尔值');
    }
    shadows = source.shadows;
  }

  const pixelRatio = readPixelRatio(source.pixelRatio, DEFAULT_PIXEL_RATIO);

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(
    GAME_CONFIG.match.cameraFov,
    width / height,
    DEFAULT_NEAR,
    DEFAULT_FAR
  );
  camera.rotation.order = 'YXZ';
  camera.rotation.z = 0;
  scene.add(camera);

  const raycaster = new Raycaster();
  let renderWidth = width;
  let renderHeight = height;
  let disposed = false;
  let quality = 'high';
  /** @type {ReturnType<typeof createPostProcessing>|null} */
  let postProcessing = null;
  /** @type {string[]} */
  const postProcessingFallbacks = [];
  let postProcessingError = null;

  /**
   * 按当前画质调整场景中阴影贴图大小。低画质把 2048 降到 1024，高画质恢复。
   * 修改尺寸后丢弃旧的阴影贴图，避免 Three.js 继续使用旧尺寸。
   *
   * @returns {void}
   */
  function applyShadowQuality() {
    let targetSize = HIGH_QUALITY_SHADOW_SIZE;
    if (quality === 'low') {
      targetSize = LOW_QUALITY_SHADOW_SIZE;
    }
    scene.traverse((node) => {
      const light = /** @type {Record<string, unknown>} */ (node);
      if (light.isLight !== true || light.castShadow !== true) {
        return;
      }
      const shadow = light.shadow;
      if (shadow === null || shadow === undefined) {
        return;
      }
      const shadowValue = /** @type {Record<string, unknown>} */ (shadow);
      const mapSize = shadowValue.mapSize;
      if (mapSize === null || mapSize === undefined) {
        return;
      }
      const size = /** @type {{x: number, y: number, set: (x: number, y: number) => void}} */ (mapSize);
      if (size.x === targetSize && size.y === targetSize) {
        return;
      }
      size.set(targetSize, targetSize);
      const map = shadowValue.map;
      if (map !== null && map !== undefined) {
        const mapValue = /** @type {{dispose?: () => void}} */ (map);
        if (typeof mapValue.dispose === 'function') {
          mapValue.dispose();
        }
        shadowValue.map = null;
      }
    });
  }

  /**
   * 建立高画质后处理管线。失败时记录原因并保持直接渲染。
   *
   * @returns {void}
   */
  function ensurePostProcessing() {
    if (postProcessing !== null || quality !== 'high' || disposed) {
      return;
    }
    try {
      postProcessing = createPostProcessing({
        renderer,
        scene,
        camera,
        width: renderWidth,
        height: renderHeight
      });
      postProcessingError = null;
      const fallbacks = postProcessing.getFallbacks();
      for (const item of fallbacks) {
        postProcessingFallbacks.push(item);
      }
      if (postProcessing.isDegraded()) {
        console.warn(
          '[renderer] 高画质后处理已降级；可用 pass: ' +
            postProcessing.getPasses().join(',')
        );
      }
    } catch (error) {
      postProcessing = null;
      postProcessingError = error;
      console.error(
        '[renderer] 后处理创建失败，高画质退回直接渲染: ',
        error
      );
    }
  }

  /**
   * @returns {void}
   */
  function disposePostProcessing() {
    if (postProcessing === null) {
      return;
    }
    try {
      postProcessing.dispose();
    } catch (error) {
      console.error('[renderer] 释放后处理失败', error);
    }
    postProcessing = null;
  }

  /**
   * @param {unknown} object
   * @param {string} label
   * @returns {unknown}
   */
  function requireObject(object, label) {
    if (object === null || object === undefined) {
      throw new TypeError(label + ' 需要传入 Three.js 对象');
    }
    return object;
  }

  /**
   * @param {number} nextWidth
   * @param {number} nextHeight
   * @returns {void}
   */
  function resize(nextWidth, nextHeight) {
    if (!isFiniteNumber(nextWidth) || nextWidth <= 0) {
      throw new RangeError('resize 的 width 必须是大于 0 的有限数字');
    }
    if (!isFiniteNumber(nextHeight) || nextHeight <= 0) {
      throw new RangeError('resize 的 height 必须是大于 0 的有限数字');
    }
    renderWidth = nextWidth;
    renderHeight = nextHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    // 第三个参数 false：只更新绘制缓冲，画布的 CSS 尺寸由界面层控制。
    renderer.setSize(nextWidth, nextHeight, false);
    if (postProcessing !== null) {
      postProcessing.setSize(nextWidth, nextHeight);
    }
  }

  resize(width, height);

  /**
   * 判断对象是否挂在相机下（第一人称模型），这类对象不参与世界射线检测。
   *
   * @param {unknown} object
   * @returns {boolean}
   */
  function isCameraAttached(object) {
    let current = object;
    while (current !== null && current !== undefined) {
      if (current === camera) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * @param {import('three').Intersection} intersection
   * @returns {import('../abstract/renderer.js').RaycastHit}
   */
  function createHit(intersection) {
    let normal = { x: 0, y: 1, z: 0 };
    if (intersection.face !== null && intersection.face !== undefined) {
      const normalMatrix = new Matrix3().getNormalMatrix(
        intersection.object.matrixWorld
      );
      const worldNormal = intersection.face.normal
        .clone()
        .applyMatrix3(normalMatrix)
        .normalize();
      normal = { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
    }
    const point = intersection.point;
    return {
      object: intersection.object,
      distance: intersection.distance,
      point: { x: point.x, y: point.y, z: point.z },
      normal,
      userData: intersection.object.userData
    };
  }

  /**
   * @param {import('../abstract/renderer.js').Vec3} origin
   * @param {import('../abstract/renderer.js').Vec3} direction
   * @param {number} [far]
   * @param {unknown[]} [objects]
   * @returns {import('../abstract/renderer.js').RaycastHit|null}
   */
  function raycast(origin, direction, far, objects) {
    const originVector = readVector(origin, 'raycast 的 origin');
    const directionVector = readVector(direction, 'raycast 的 direction');
    if (directionVector.lengthSq() === 0) {
      throw new RangeError('raycast 的 direction 不能是零向量');
    }
    directionVector.normalize();

    let maxDistance = Number.POSITIVE_INFINITY;
    if (far !== undefined) {
      if (!isFiniteNumber(far) || far <= 0) {
        throw new RangeError('raycast 的 far 必须是大于 0 的有限数字');
      }
      maxDistance = far;
    }

    let targets = scene.children;
    if (objects !== undefined) {
      if (!Array.isArray(objects)) {
        throw new TypeError('raycast 的 objects 必须是 Three.js 对象数组');
      }
      targets = objects;
      for (const target of targets) {
        if (target !== null && target !== undefined) {
          target.updateMatrixWorld(true);
        }
      }
    } else {
      scene.updateMatrixWorld(true);
    }

    raycaster.near = 0;
    raycaster.far = maxDistance;
    raycaster.set(originVector, directionVector);

    const intersections = raycaster.intersectObjects(targets, true);
    for (const intersection of intersections) {
      if (isCameraAttached(intersection.object)) {
        continue;
      }
      return createHit(intersection);
    }
    return null;
  }

  /**
   * @param {Partial<import('../abstract/renderer.js').RendererPose>} pose
   * @returns {import('../abstract/renderer.js').RendererPose}
   */
  function setCameraPose(pose) {
    return applyCameraPose(camera, pose);
  }

  /**
   * @returns {import('../abstract/renderer.js').RendererPose}
   */
  function getCameraPose() {
    return {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      },
      yaw: camera.rotation.y,
      pitch: camera.rotation.x,
      roll: camera.rotation.z,
      fov: camera.fov
    };
  }

  /**
   * @param {number} screenX
   * @param {number} screenY
   * @returns {import('../abstract/renderer.js').WorldRay}
   */
  function getWorldPosition(screenX, screenY) {
    if (!isFiniteNumber(screenX) || !isFiniteNumber(screenY)) {
      throw new TypeError('getWorldPosition 的屏幕坐标必须是有限数字');
    }
    camera.updateMatrixWorld(true);
    const ndcX = (screenX / renderWidth) * 2 - 1;
    const ndcY = -(screenY / renderHeight) * 2 + 1;
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    return {
      origin: {
        x: raycaster.ray.origin.x,
        y: raycaster.ray.origin.y,
        z: raycaster.ray.origin.z
      },
      direction: {
        x: raycaster.ray.direction.x,
        y: raycaster.ray.direction.y,
        z: raycaster.ray.direction.z
      }
    };
  }

  /**
   * @param {import('../abstract/renderer.js').EnvironmentOptions} environment
   * @returns {void}
   */
  function setEnvironment(environment) {
    if (!isObject(environment)) {
      throw new TypeError('setEnvironment 需要环境参数对象');
    }
    const source = /** @type {Record<string, unknown>} */ (environment);

    if (source.hdriTexture !== undefined) {
      scene.environment = source.hdriTexture;
    }
    if (source.backgroundTexture !== undefined) {
      scene.background = source.backgroundTexture;
    } else if (source.skyColor !== undefined) {
      if (source.skyColor === null) {
        scene.background = null;
      } else {
        scene.background = new Color(source.skyColor);
      }
    }

    const hasFogColor = source.fogColor !== undefined;
    const hasFogNear = source.fogNear !== undefined;
    const hasFogFar = source.fogFar !== undefined;
    if (hasFogColor || hasFogNear || hasFogFar) {
      let fogColor = DEFAULT_FOG_COLOR;
      let fogNear = DEFAULT_FOG_NEAR;
      let fogFar = DEFAULT_FOG_FAR;
      if (scene.fog !== null) {
        fogColor = scene.fog.color.getHex();
        fogNear = scene.fog.near;
        fogFar = scene.fog.far;
      }
      if (hasFogColor) {
        fogColor = /** @type {number|string} */ (source.fogColor);
      }
      if (hasFogNear) {
        if (!isFiniteNumber(source.fogNear) || source.fogNear < 0) {
          throw new RangeError('fogNear 必须是大于等于 0 的有限数字');
        }
        fogNear = source.fogNear;
      }
      if (hasFogFar) {
        if (!isFiniteNumber(source.fogFar) || source.fogFar <= 0) {
          throw new RangeError('fogFar 必须是大于 0 的有限数字');
        }
        fogFar = source.fogFar;
      }
      if (fogFar <= fogNear) {
        throw new RangeError('fogFar 必须大于 fogNear');
      }
      scene.fog = new Fog(fogColor, fogNear, fogFar);
    }

    if (source.intensity !== undefined) {
      if (!isFiniteNumber(source.intensity) || source.intensity < 0) {
        throw new RangeError('intensity 必须是大于等于 0 的有限数字');
      }
      scene.environmentIntensity = source.intensity;
    }
    if (source.backgroundIntensity !== undefined) {
      if (!isFiniteNumber(source.backgroundIntensity) || source.backgroundIntensity < 0) {
        throw new RangeError('backgroundIntensity 必须是大于等于 0 的有限数字');
      }
      scene.backgroundIntensity = source.backgroundIntensity;
    }
    if (source.backgroundBlurriness !== undefined) {
      if (
        !isFiniteNumber(source.backgroundBlurriness) ||
        source.backgroundBlurriness < 0 ||
        source.backgroundBlurriness > 1
      ) {
        throw new RangeError('backgroundBlurriness 必须在 0 到 1 之间');
      }
      scene.backgroundBlurriness = source.backgroundBlurriness;
    }
  }

  /**
   * 切换画质。高画质建立后处理管线，低画质释放并直接渲染。
   * 相同档位重复调用是幂等空操作。
   *
   * @param {'high'|'low'} nextQuality
   * @returns {void}
   */
  function setQuality(nextQuality) {
    const normalized = normalizeQuality(nextQuality);
    if (normalized === quality) {
      // 幂等：重复设置为同一档位不重建资源；但如果高画质管线尚未建立
      // （例如启动后第一次应用设置），这里立即建立，保证 getPerformance()
      // 读到的 postProcessing 与实际渲染路径一致。
      if (quality === 'high') {
        ensurePostProcessing();
      }
      return;
    }
    quality = normalized;
    if (quality === 'low') {
      disposePostProcessing();
    } else {
      ensurePostProcessing();
    }
    applyShadowQuality();
  }

  /**
   * @returns {'high'|'low'}
   */
  function getQuality() {
    return quality;
  }

  /**
   * @returns {boolean}
   */
  function isPostProcessingEnabled() {
    return quality === 'high' && postProcessing !== null;
  }

  /**
   * 返回后处理使用的 pass、降级项与最近一次错误，供日志和验收记录。
   *
   * @returns {{enabled: boolean, passes: string[], fallbacks: string[], error: string|null}}
   */
  function getPostProcessingInfo() {
    let passes = [];
    if (postProcessing !== null) {
      passes = postProcessing.getPasses();
    }
    let errorMessage = null;
    if (postProcessingError !== null) {
      if (postProcessingError instanceof Error) {
        errorMessage = postProcessingError.message;
      } else {
        errorMessage = String(postProcessingError);
      }
    }
    return {
      enabled: isPostProcessingEnabled(),
      passes,
      fallbacks: postProcessingFallbacks.slice(),
      error: errorMessage
    };
  }

  /**
   * @returns {void}
   */
  function render() {    if (disposed) {
      return;
    }
    camera.updateMatrixWorld(true);
    if (quality === 'high') {
      ensurePostProcessing();
      if (postProcessing !== null) {
        try {
          postProcessing.render();
          return;
        } catch (error) {
          console.error(
            '[renderer] 后处理渲染失败，本帧及后续退回直接渲染: ',
            error
          );
          postProcessingError = error;
          postProcessingFallbacks.push('render-runtime');
          disposePostProcessing();
        }
      }
    }
    renderer.render(scene, camera);
  }

  /**
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    disposePostProcessing();
    camera.clear();
    scene.clear();
    renderer.dispose();
  }

  return {
    add(object) {
      scene.add(/** @type {import('three').Object3D} */ (requireObject(object, 'add')));
    },
    remove(object) {
      scene.remove(/** @type {import('three').Object3D} */ (requireObject(object, 'remove')));
    },
    attachToCamera(object) {
      camera.add(
        /** @type {import('three').Object3D} */ (requireObject(object, 'attachToCamera'))
      );
    },
    detachFromCamera(object) {
      camera.remove(
        /** @type {import('three').Object3D} */ (requireObject(object, 'detachFromCamera'))
      );
    },
    setCameraPose,
    getCameraPose,
    getWorldPosition,
    raycast,
    setEnvironment,
    resize,
    setQuality,
    getQuality,
    isPostProcessingEnabled,
    getPostProcessingInfo,
    render,
    dispose
  };
}
