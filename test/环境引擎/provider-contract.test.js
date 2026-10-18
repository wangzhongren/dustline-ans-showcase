import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEngine } from '../../src/providers/public/audio-engine.js';
import { createAssetLoader } from '../../src/providers/public/assets.js';
import { createRenderer } from '../../src/providers/public/renderer.js';
import * as threeFacade from '../../src/providers/public/three.js';
import {
  applyCameraPose,
  normalizeQuality
} from '../../src/providers/impl/three-renderer.js';

test('三个公共入口都导出工厂函数', () => {
  assert.equal(typeof createRenderer, 'function');
  assert.equal(typeof createAssetLoader, 'function');
  assert.equal(typeof createAudioEngine, 'function');
});

test('Three.js 门面包含项目约定使用的显式导出', () => {
  const required = [
    'AnimationMixer',
    'cloneSkinned',
    'Vector2',
    'Vector3',
    'Vector4',
    'Quaternion',
    'Euler',
    'Matrix4',
    'Color',
    'Group',
    'Object3D',
    'Scene',
    'PerspectiveCamera',
    'Mesh',
    'InstancedMesh',
    'Sprite',
    'Line',
    'LineSegments',
    'Points',
    'BoxGeometry',
    'PlaneGeometry',
    'CylinderGeometry',
    'SphereGeometry',
    'ConeGeometry',
    'TorusGeometry',
    'RingGeometry',
    'CapsuleGeometry',
    'ShapeGeometry',
    'ExtrudeGeometry',
    'BufferGeometry',
    'BufferAttribute',
    'EdgesGeometry',
    'MeshStandardMaterial',
    'MeshPhysicalMaterial',
    'MeshBasicMaterial',
    'PointsMaterial',
    'SpriteMaterial',
    'LineBasicMaterial',
    'CanvasTexture',
    'DataTexture',
    'Texture',
    'AmbientLight',
    'HemisphereLight',
    'DirectionalLight',
    'PointLight',
    'SpotLight',
    'Fog',
    'FogExp2',
    'Raycaster',
    'Clock',
    'MathUtils',
    'Box3',
    'Sphere',
    'Plane',
    'FrontSide',
    'BackSide',
    'DoubleSide',
    'RepeatWrapping',
    'ClampToEdgeWrapping',
    'SRGBColorSpace',
    'NoColorSpace',
    'ACESFilmicToneMapping',
    'PCFShadowMap',
    'AdditiveBlending',
    'NormalBlending',
    'EquirectangularReflectionMapping'
  ];

  for (const name of required) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(threeFacade, name),
      true,
      'Three.js 门面缺少导出 ' + name
    );
  }

  assert.equal(typeof threeFacade.Vector3, 'function');
  assert.equal(typeof threeFacade.Mesh, 'function');
  assert.equal(typeof threeFacade.MeshStandardMaterial, 'function');
  assert.equal(typeof threeFacade.BoxGeometry, 'function');
  assert.equal(typeof threeFacade.DirectionalLight, 'function');
  assert.equal(typeof threeFacade.Fog, 'function');
  assert.equal(typeof threeFacade.AnimationMixer, 'function');
  assert.equal(typeof threeFacade.cloneSkinned, 'function');
  assert.equal(threeFacade.ACESFilmicToneMapping, 4);
});

test('在没有 DOM 的 Node 环境中导入 Three.js 门面不会创建渲染器', () => {
  // 能导入成功本身说明模块顶层没有访问 document/window；
  // 门面也不暴露 WebGLRenderer 或 createRenderer，渲染器只能走公共工厂。
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof threeFacade.WebGLRenderer, 'undefined');
  assert.equal(
    Object.prototype.hasOwnProperty.call(threeFacade, 'createRenderer'),
    false
  );
});

test('素材加载器按 baseUrl 解析清单相对路径，且结果稳定', async () => {
  const loader = createAssetLoader({ baseUrl: 'file:///tmp/dustline/' });

  assert.equal(
    loader.resolveUrl('textures/a.jpg'),
    'file:///tmp/dustline/textures/a.jpg'
  );
  assert.equal(
    loader.resolveUrl('textures/a.jpg'),
    loader.resolveUrl('textures/a.jpg')
  );
  assert.equal(
    loader.resolveUrl('hdri/sky.hdr'),
    'file:///tmp/dustline/hdri/sky.hdr'
  );
  assert.equal(loader.getManifest(), null);

  assert.equal(typeof loader.loadManifest, 'function');
  assert.equal(typeof loader.loadTexture, 'function');
  assert.equal(typeof loader.loadHdr, 'function');
  assert.equal(typeof loader.loadGltf, 'function');
  assert.equal(typeof loader.loadModel, 'function');
  assert.equal(typeof loader.dispose, 'function');

  await loader.dispose();
});

test('素材加载器拒绝空 URL，不发起网络请求', () => {
  const loader = createAssetLoader({ baseUrl: 'file:///tmp/dustline/' });
  assert.throws(() => loader.resolveUrl(''), TypeError);
});

test('渲染器姿态支持 roll、默认 roll 0、pitch 限制与可选震动偏移', () => {
  const camera = new threeFacade.PerspectiveCamera(75, 1, 0.1, 100);

  const pose = applyCameraPose(camera, {
    position: { x: 1, y: 2, z: 3 },
    yaw: 0.5,
    pitch: 2.4,
    roll: 0.3,
    fov: 80
  });
  assert.equal(pose.position.x, 1);
  assert.equal(pose.position.y, 2);
  assert.equal(pose.position.z, 3);
  assert.equal(pose.yaw, 0.5);
  assert.equal(pose.pitch, 1.55, 'pitch 必须被限制在 ±1.55');
  assert.equal(pose.roll, 0.3);
  assert.equal(pose.fov, 80);

  const resetPose = applyCameraPose(camera, { yaw: 0 });
  assert.equal(resetPose.roll, 0, '未提供 roll 时必须回到 0');

  const shaken = applyCameraPose(camera, {
    position: { x: 1, y: 2, z: 3 },
    shakeX: 0.1,
    shakeY: -0.05,
    roll: 0.1
  });
  assert.equal(shaken.position.x, 1.1);
  assert.equal(shaken.position.y, 1.95);
  assert.equal(shaken.position.z, 3);

  assert.throws(
    () => applyCameraPose(camera, { roll: Number.NaN }),
    /roll/
  );
  assert.throws(() => applyCameraPose(camera, { shakeX: 'x' }), /shakeX/);
});

test('画质档位只接受 high 与 low', () => {
  assert.equal(normalizeQuality('high'), 'high');
  assert.equal(normalizeQuality('low'), 'low');
  assert.throws(() => normalizeQuality('medium'), /high/);
  assert.throws(() => normalizeQuality(undefined), /high/);
});

test('音频引擎未初始化时是安全空操作，并且只警告一次', async () => {
  const engine = createAudioEngine();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };

  try {
    assert.doesNotThrow(() => {
      engine.tone({ type: 'sine', frequency: 440, duration: 0.05 });
    });
    assert.doesNotThrow(() => {
      engine.noise({ duration: 0.05, filterType: 'lowpass' });
    });
    assert.doesNotThrow(() => {
      engine.setMuted(true);
    });
    assert.doesNotThrow(() => {
      engine.setMasterVolume(0.5);
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /尚未初始化/);

  assert.equal(typeof engine.init, 'function');
  assert.equal(typeof engine.setMuted, 'function');
  assert.equal(typeof engine.setMasterVolume, 'function');
  assert.equal(typeof engine.dispose, 'function');

  await engine.dispose();
});
