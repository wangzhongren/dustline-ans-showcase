import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_CONFIG } from '../../src/models/game-config.js';
import {
  Box3,
  DoubleSide,
  PerspectiveCamera,
  Vector3
} from '../../src/providers/public/three.js';
import {
  MAX_SHELLS,
  MUZZLE_FLASH_DURATION,
  OPTIC_STRUCTURE,
  VIEW_MODEL_MATERIALS,
  VIEW_MODEL_SCALE,
  VIEW_MODEL_TEXTURE_TINTS,
  createViewState,
  createViewModel,
  getMuzzleLocalPosition,
  getReloadAnimation,
  getReloadPhase,
  getViewTransform,
  resetViewState,
  triggerViewFire,
  updateViewState
} from '../../src/services/impl/combat/view-model.js';

const CLOSE = 1e-6;
const VIEW = GAME_CONFIG.weapon.viewModel;
const SCREEN_ASPECT = 1600 / 900;

/**
 * 计算视图模型中所有可见网格的世界包围盒（相机局部坐标）。
 *
 * @param {{ root: Object }} viewModel
 * @returns {Box3}
 */
function getVisibleBounds(viewModel) {
  viewModel.root.updateMatrixWorld(true);
  const union = new Box3();
  let hasBounds = false;
  viewModel.root.traverse((object) => {
    if (!object.isMesh || !object.visible) {
      return;
    }
    if (!object.geometry.boundingBox) {
      object.geometry.computeBoundingBox();
    }
    const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    if (!hasBounds) {
      union.copy(box);
      hasBounds = true;
    } else {
      union.union(box);
    }
  });
  return union;
}

/**
 * 把包围盒 8 个角投影到 NDC，返回屏幕空间范围。
 *
 * @param {PerspectiveCamera} camera
 * @param {Box3} box
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}}
 */
function projectBounds(camera, box) {
  const corners = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.max.y, box.max.z]
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const corner of corners) {
    minZ = Math.min(minZ, corner[2]);
    maxZ = Math.max(maxZ, corner[2]);
    const projected = new Vector3(corner[0], corner[1], corner[2]).project(camera);
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * 创建与渲染器一致的透视投影相机（位于原点，朝 -Z）。
 *
 * @returns {PerspectiveCamera}
 */
function createProjectionCamera() {
  const camera = new PerspectiveCamera(75, SCREEN_ASPECT, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * 假渲染器：只记录挂载/取下，不创建 WebGL。
 */
function createFakeRenderer() {
  const attached = [];
  const detached = [];
  return {
    attachToCamera(object) {
      attached.push(object);
    },
    detachFromCamera(object) {
      detached.push(object);
    },
    getAttached() {
      return attached;
    },
    getDetached() {
      return detached;
    }
  };
}

/**
 * 读取对象世界坐标。
 */
function getWorldPosition(object) {
  const vector = new Vector3();
  object.getWorldPosition(vector);
  return { x: vector.x, y: vector.y, z: vector.z };
}

test('机匣金属与聚合物护木在颜色、粗糙度、金属度上明确分开', () => {
  const receiver = VIEW_MODEL_MATERIALS.receiver;
  const polymer = VIEW_MODEL_MATERIALS.polymer;
  const wear = VIEW_MODEL_MATERIALS.wear;

  assert.notEqual(receiver.color, polymer.color);
  assert.ok(receiver.metalness > polymer.metalness + 0.4, '机匣应明显更金属');
  assert.ok(polymer.roughness > receiver.roughness, '聚合物应明显更粗糙');
  assert.ok(receiver.color > 0x202020, '机匣不是纯黑');
  assert.ok(polymer.color > 0x101010, '聚合物不是纯黑');
  assert.ok(wear.color > receiver.color, '磨损条比机匣更亮');
  assert.ok(
    receiver.envMapIntensity <= 0.35,
    '机匣压低天空反射，避免蓝色 HDRI 主导'
  );
  assert.ok(polymer.envMapIntensity <= 0.1, '聚合物几乎不反射天空');

  const glove = VIEW_MODEL_MATERIALS.glove;
  const sleeve = VIEW_MODEL_MATERIALS.sleeve;
  assert.notEqual(glove.color, sleeve.color, '手套与战术袖颜色不同');
  assert.ok(glove.roughness > 0.8);
  assert.ok(sleeve.roughness > 0.9);
  assert.equal(VIEW_MODEL_SCALE, VIEW.scale * 0.82);

  // 贴图色调必须偏暖（红 >= 蓝），避免蓝紫色反射叠加到武器上。
  for (const key of Object.keys(VIEW_MODEL_TEXTURE_TINTS)) {
    const tint = VIEW_MODEL_TEXTURE_TINTS[key];
    const red = (tint >> 16) & 0xff;
    const blue = tint & 0xff;
    assert.ok(red >= blue, key + ' 贴图色调不应偏蓝');
  }
});

test('织物与木材只使用法线/粗糙度贴图，不套用蓝色/偏红颜色贴图', async () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);
  const calls = [];
  const assets = {
    async loadManifest() {
      return {
        textures: {
          metal: {
            color: 'metal/color.jpg',
            normal: 'metal/normal.jpg',
            roughness: 'metal/rough.jpg',
            metalness: 'metal/metal.jpg'
          },
          steel: {
            color: 'steel/color.jpg',
            normal: 'steel/normal.jpg',
            roughness: 'steel/rough.jpg',
            metalness: 'steel/metal.jpg'
          },
          wood: {
            color: 'wood/color.jpg',
            normal: 'wood/normal.jpg',
            roughness: 'wood/rough.jpg'
          },
          fabric: {
            color: 'fabric/color.jpg',
            normal: 'fabric/normal.jpg',
            roughness: 'fabric/rough.jpg'
          }
        }
      };
    },
    async loadTexture(url, options) {
      const texture = { url, options };
      calls.push(texture);
      return texture;
    }
  };

  await viewModel.loadTextures(assets);

  const colorCalls = calls.filter((entry) => entry.url.includes('color'));
  assert.equal(colorCalls.length, 2, '只给金属/钢应用颜色贴图');
  assert.ok(calls.some((entry) => entry.url === 'fabric/normal.jpg'));
  assert.ok(calls.some((entry) => entry.url === 'wood/normal.jpg'));

  function findMaterialByColor(hex) {
    let found = null;
    viewModel.root.traverse((object) => {
      if (found !== null) {
        return;
      }
      if (!object.isMesh || !object.material || !object.material.color) {
        return;
      }
      if (object.material.color.getHex() === hex) {
        found = object.material;
      }
    });
    return found;
  }

  const glove = findMaterialByColor(0x2b2e2a);
  assert.notEqual(glove, null);
  assert.ok(!glove.map, '手套不应用蓝色 Fabric084 颜色贴图');
  assert.ok(glove.normalMap, '手套仍保留织物法线细节');
  assert.ok(glove.roughnessMap, '手套仍保留织物粗糙度细节');

  const sleeve = findMaterialByColor(0x8a8268);
  assert.notEqual(sleeve, null);
  assert.ok(!sleeve.map, '袖口不应用蓝色 Fabric084 颜色贴图');
  assert.ok(sleeve.normalMap);

  const wood = findMaterialByColor(0x3a3028);
  assert.notEqual(wood, null);
  assert.ok(!wood.map, '木材不应用偏红的 Wood066 颜色贴图');
  assert.ok(wood.normalMap, '木材仍保留法线细节');

  const receiver = findMaterialByColor(0x9c948a);
  assert.notEqual(receiver, null);
  assert.ok(receiver.map, '金属机匣仍使用金属颜色贴图');
  assert.ok(receiver.normalMap);

  viewModel.dispose();
});

test('待机时呼吸带来轻微位置变化', () => {
  const state = createViewState();
  const initial = getViewTransform(state);

  updateViewState(state, 0.05, {});

  const breathing = getViewTransform(state);
  assert.ok(state.time > 0);
  assert.ok(Math.abs(breathing.position.y - initial.position.y) > 0);
  assert.ok(Math.abs(breathing.position.y - initial.position.y) < 0.01);
});

test('ADS 过渡按配置速度插值，松开后回到腰射', () => {
  const state = createViewState();
  const hip = getViewTransform(state);

  updateViewState(state, 0.02, { aiming: true });
  assert.ok(state.aimAmount > 0);
  assert.ok(state.aimAmount < 1);
  const transitioning = getViewTransform(state);
  assert.ok(transitioning.position.x < hip.position.x, '应向画面中央靠拢');

  updateViewState(state, 0.2, { aiming: true });
  assert.ok(Math.abs(state.aimAmount - 1) < CLOSE);
  const ads = getViewTransform(state);
  assert.ok(Math.abs(ads.position.x - VIEW.adsPosition.x) < 0.001);
  assert.ok(Math.abs(ads.position.z - VIEW.adsPosition.z) < 0.001);

  updateViewState(state, 0.2, { aiming: false });
  assert.ok(Math.abs(state.aimAmount) < CLOSE);
});

test('行走产生摆动，冲刺收枪并倾斜', () => {
  const walker = createViewState();
  updateViewState(walker, 0.3, { moving: true });
  assert.ok(walker.moveAmount > 0);
  assert.ok(walker.bobPhase > 0);

  const idle = getViewTransform(createViewState());
  const walking = getViewTransform(walker);
  assert.ok(Math.abs(walking.position.y - idle.position.y) > 0.001, '行走应上下摆动');

  const sprinter = createViewState();
  updateViewState(sprinter, 0.2, { moving: true, sprinting: true });
  assert.ok(sprinter.sprintAmount > 0);
  const sprinting = getViewTransform(sprinter);
  assert.ok(sprinting.rotation.x < 0, '冲刺时枪口下压');
  assert.ok(sprinting.rotation.z > 0, '冲刺时枪身倾斜');

  updateViewState(sprinter, 0.2, { moving: true, sprinting: true, aiming: true });
  assert.ok(sprinter.sprintAmount < 0.5, 'ADS 应压过冲刺姿态');
});

test('开火后坐产生位移与旋转，并随帧衰减回零', () => {
  const state = createViewState();
  triggerViewFire(state);

  assert.ok(state.recoil.offsetZ > 0, '枪身后坐');
  assert.ok(state.recoil.rotationX > 0, '枪口上抬');
  assert.ok(Math.abs(state.recoil.rotationZ) > 0, '枪身滚转');
  assert.equal(state.flashTimer, MUZZLE_FLASH_DURATION);
  assert.equal(state.shells.length, 1);
  assert.ok(state.smoke.length > 0);

  const kick = state.recoil.offsetZ;
  updateViewState(state, 0.02, {});
  assert.ok(state.recoil.offsetZ < kick, '后坐力应开始回正');

  updateViewState(state, 2, {});
  assert.equal(state.recoil.offsetX, 0);
  assert.equal(state.recoil.offsetY, 0);
  assert.equal(state.recoil.offsetZ, 0);
  assert.equal(state.recoil.rotationX, 0);
  assert.equal(state.recoil.rotationY, 0);
  assert.equal(state.recoil.rotationZ, 0);
});

test('换弹阶段按进度推进：弹匣下落、插入、拉机柄、收尾', () => {
  assert.equal(getReloadPhase(0), 'idle');
  assert.equal(getReloadPhase(0.1), 'magazine-drop');
  assert.equal(getReloadPhase(0.4), 'magazine-insert');
  assert.equal(getReloadPhase(0.7), 'charging-handle');
  assert.equal(getReloadPhase(0.95), 'settle');
  assert.throws(() => getReloadPhase('fast'), TypeError);

  const state = createViewState();

  updateViewState(state, 0.016, { reloading: true, reloadProgress: 0.1 });
  let animation = getReloadAnimation(state);
  assert.equal(animation.phase, 'magazine-drop');
  assert.ok(animation.magazineOffsetY < 0);
  assert.equal(animation.magazineVisible, true);
  assert.equal(animation.leftHandBlend, 1);

  updateViewState(state, 0.016, { reloading: true, reloadProgress: 0.4 });
  animation = getReloadAnimation(state);
  assert.equal(animation.phase, 'magazine-insert');
  assert.ok(animation.magazineOffsetY < 0);
  assert.equal(animation.magazineVisible, true);

  updateViewState(state, 0.016, { reloading: true, reloadProgress: 0.7 });
  animation = getReloadAnimation(state);
  assert.equal(animation.phase, 'charging-handle');
  assert.ok(animation.chargingPull > 0.9, '拉机柄应被拉到行程末端');
  assert.ok(animation.leftHandBlend > 0);

  updateViewState(state, 0.016, { reloading: true, reloadProgress: 0.95 });
  animation = getReloadAnimation(state);
  assert.equal(animation.phase, 'settle');

  updateViewState(state, 0.016, { reloading: false });
  animation = getReloadAnimation(state);
  assert.equal(animation.phase, 'idle');
  assert.equal(animation.magazineOffsetY, 0);
  assert.equal(animation.chargingPull, 0);
  assert.equal(animation.magazineVisible, true);
});

test('弹壳受重力影响并在寿命结束后移除', () => {
  const state = createViewState();
  triggerViewFire(state);

  assert.equal(state.shells.length, 1);
  const shell = state.shells[0];
  const startY = shell.y;
  const startVelocityY = shell.vy;
  assert.ok(shell.x > 0, '弹壳从右侧抛出');

  updateViewState(state, 0.2, {});
  assert.equal(state.shells.length, 1);
  assert.ok(state.shells[0].vy < startVelocityY, '重力应降低垂直速度');
  assert.notEqual(state.shells[0].y, startY);
  assert.ok(state.shells[0].rotationX > 0, '弹壳应旋转');

  updateViewState(state, 1, {});
  assert.equal(state.shells.length, 0);

  for (let index = 0; index < MAX_SHELLS + 4; index += 1) {
    triggerViewFire(state);
  }
  assert.equal(state.shells.length, MAX_SHELLS, '弹壳池不超过上限');
});

test('resetViewState 清空弹壳、烟雾、后坐力与换弹状态', () => {
  const state = createViewState();
  triggerViewFire(state);
  updateViewState(state, 0.016, { reloading: true, reloadProgress: 0.4 });
  assert.ok(state.shells.length > 0);
  assert.ok(state.smoke.length > 0);

  resetViewState(state);

  assert.equal(state.time, 0);
  assert.equal(state.aimAmount, 0);
  assert.equal(state.sprintAmount, 0);
  assert.equal(state.moveAmount, 0);
  assert.equal(state.bobPhase, 0);
  assert.equal(state.flashTimer, 0);
  assert.equal(state.shells.length, 0);
  assert.equal(state.smoke.length, 0);
  assert.equal(state.reloading, false);
  assert.equal(state.reloadProgress, 0);
  assert.equal(state.recoil.offsetZ, 0);
});

test('视图模型包含枪口、双手、弹匣与拉机柄，枪口世界位置随 ADS 变化', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);

  assert.equal(renderer.getAttached().length, 1);

  assert.notEqual(viewModel.root.getObjectByName('view-model-rifle'), undefined);
  assert.notEqual(viewModel.root.getObjectByName('view-model-right-hand'), undefined);
  assert.notEqual(viewModel.root.getObjectByName('view-model-left-hand'), undefined);
  assert.notEqual(viewModel.root.getObjectByName('view-model-magazine'), undefined);
  assert.notEqual(
    viewModel.root.getObjectByName('view-model-charging-handle'),
    undefined
  );
  assert.notEqual(viewModel.root.getObjectByName('view-model-muzzle'), undefined);
  assert.notEqual(viewModel.root.getObjectByName('view-model-muzzle-flash'), undefined);

  const local = getMuzzleLocalPosition();
  assert.ok(local.z < -0.8, '枪口应在枪身前方');

  const hipMuzzle = viewModel.getMuzzleWorldPosition();
  assert.equal(typeof hipMuzzle.x, 'number');
  assert.equal(typeof hipMuzzle.y, 'number');
  assert.equal(typeof hipMuzzle.z, 'number');
  assert.ok(hipMuzzle.z < -1, '枪口在相机前方');

  viewModel.update(0.2, { aiming: true });
  const adsMuzzle = viewModel.getMuzzleWorldPosition();
  assert.ok(adsMuzzle.z > hipMuzzle.z, 'ADS 把枪拉近相机');

  viewModel.dispose();
});

test('腰射时武器落在右下约四分之一到三分之一，ADS 时红点居中且不遮挡左侧', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);
  const camera = createProjectionCamera();

  viewModel.update(0.001, {});
  const hip = projectBounds(camera, getVisibleBounds(viewModel));
  const hipWidth = (hip.maxX - hip.minX) / 2;
  const clampedHipMinY = Math.max(hip.minY, -1);
  const clampedHipMaxY = Math.min(hip.maxY, 1);
  const hipHeight = (clampedHipMaxY - clampedHipMinY) / 2;

  assert.ok(hip.minX >= 0.05, '腰射不应覆盖画面中心偏左');
  assert.ok(hip.maxY <= 0, '腰射武器应完全位于屏幕中线以下');
  assert.ok(hipWidth >= 0.2 && hipWidth <= 0.35, '腰射占屏宽度应在 20%–35%');
  assert.ok(hipHeight >= 0.3 && hipHeight <= 0.45, '腰射占屏高度应在 30%–45%');
  assert.ok(hip.maxZ <= -0.15, '腰射时没有任何部件贴近/穿过近裁剪面');

  viewModel.update(0.3, { aiming: true });
  const ads = projectBounds(camera, getVisibleBounds(viewModel));
  const adsWidth = (ads.maxX - ads.minX) / 2;

  assert.ok(ads.minX >= -0.3, 'ADS 不应覆盖左侧瞄准区域');
  assert.ok(ads.maxX <= 0.3, 'ADS 不应向右伸出过远');
  assert.ok(ads.maxY <= 0.2, 'ADS 不应遮挡画面上方');
  assert.ok(adsWidth <= 0.2, 'ADS 占屏宽度应明显小于腰射');
  assert.ok(ads.maxZ <= -0.15, 'ADS 时没有任何部件贴近/穿过近裁剪面');

  const optic = viewModel.root.getObjectByName('view-model-optic-frame');
  assert.notEqual(optic, undefined);
  const opticPosition = new Vector3();
  optic.getWorldPosition(opticPosition);
  opticPosition.project(camera);
  assert.ok(Math.abs(opticPosition.x) < 0.05, '红点镜应水平居中');
  assert.ok(opticPosition.y > -0.3 && opticPosition.y < 0.3, '红点镜应接近画面中心');

  viewModel.dispose();
});

test('红点镜是开放隧道：四面薄壁、中心留空、低不透明度镜片与高亮红点', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);

  const frame = viewModel.root.getObjectByName('view-model-optic-frame');
  assert.notEqual(frame, undefined);
  const top = frame.getObjectByName('view-model-optic-wall-top');
  const bottom = frame.getObjectByName('view-model-optic-wall-bottom');
  const left = frame.getObjectByName('view-model-optic-wall-left');
  const right = frame.getObjectByName('view-model-optic-wall-right');
  assert.notEqual(top, undefined);
  assert.notEqual(bottom, undefined);
  assert.notEqual(left, undefined);
  assert.notEqual(right, undefined);

  assert.equal(top.geometry.parameters.width, OPTIC_STRUCTURE.outerWidth);
  assert.equal(top.geometry.parameters.height, OPTIC_STRUCTURE.wallThickness);
  assert.equal(top.geometry.parameters.depth, OPTIC_STRUCTURE.length);
  assert.ok(top.position.y > 0.015, '顶壁在隧道上方');
  assert.ok(bottom.position.y < -0.015, '底壁在隧道下方');
  assert.ok(left.position.x < -0.015, '左壁在隧道左侧');
  assert.ok(right.position.x > 0.015, '右壁在隧道右侧');

  // 中心不能有任何接近整机尺寸的实心盒；每面墙至少有一个横向尺寸是薄壁。
  let hasSolidBox = false;
  frame.traverse((object) => {
    if (!object.isMesh || object.geometry.type !== 'BoxGeometry') {
      return;
    }
    const parameters = object.geometry.parameters;
    if (
      parameters.width > 0.035 &&
      parameters.height > 0.035 &&
      parameters.depth > 0.07
    ) {
      hasSolidBox = true;
    }
    const isThin =
      parameters.width <= 0.006 || parameters.height <= 0.006;
    assert.ok(isThin, '镜框墙必须是薄壁');
  });
  assert.equal(hasSolidBox, false, '镜框中心不应有实心盒');

  const lens = frame.getObjectByName('view-model-optic-glass');
  assert.notEqual(lens, undefined);
  assert.equal(lens.material.transparent, true);
  assert.equal(lens.material.depthWrite, false);
  assert.equal(lens.material.side, DoubleSide);
  assert.ok(lens.material.opacity >= 0.08 && lens.material.opacity <= 0.18);

  const redDot = frame.getObjectByName('view-model-optic-red-dot');
  assert.notEqual(redDot, undefined);
  assert.equal(redDot.material.depthWrite, false);
  assert.equal(redDot.material.toneMapped, false);
  assert.ok(redDot.material.color.r > 0.8, '红点应高亮');
  assert.ok(redDot.material.color.g < 0.2);
  assert.ok(redDot.material.color.b < 0.2);

  const lensPosition = new Vector3();
  const dotPosition = new Vector3();
  lens.getWorldPosition(lensPosition);
  redDot.getWorldPosition(dotPosition);
  assert.ok(dotPosition.distanceTo(lensPosition) < 0.01, '红点应靠近镜片中心');

  viewModel.update(0.3, { aiming: true });
  const framePosition = new Vector3();
  frame.getWorldPosition(framePosition);
  assert.ok(framePosition.length() > 0.2, 'ADS 时相机不应进入镜框或贴近近裁剪面');

  const camera = createProjectionCamera();
  const projected = framePosition.clone().project(camera);
  assert.ok(Math.abs(projected.x) < 0.05, 'ADS 镜框中心应水平居中');
  assert.ok(projected.y > -0.3 && projected.y < 0.3, 'ADS 镜框中心应接近画面中心');

  viewModel.dispose();
});

test('开火时双手跟随枪身后坐，抛壳口给出世界位置与速度', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);
  const rightHand = viewModel.root.getObjectByName('view-model-right-hand');
  const leftHand = viewModel.root.getObjectByName('view-model-left-hand');

  viewModel.root.updateMatrixWorld(true);
  const beforeRight = getWorldPosition(rightHand);
  const beforeLeft = getWorldPosition(leftHand);

  const eject = viewModel.triggerFire();
  assert.notEqual(eject, null);
  assert.equal(typeof eject.position.x, 'number');
  assert.equal(typeof eject.velocity.y, 'number');
  assert.ok(eject.velocity.x > 0, '弹壳向右侧飞出');

  viewModel.root.updateMatrixWorld(true);
  const afterRight = getWorldPosition(rightHand);
  const afterLeft = getWorldPosition(leftHand);
  assert.notDeepEqual(afterRight, beforeRight, '右手应跟随武器后坐');
  assert.notDeepEqual(afterLeft, beforeLeft, '左手应跟随武器后坐');

  viewModel.dispose();
});

test('视图模型 reset 清理弹壳/烟雾并恢复腰射位置与可见性', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);

  viewModel.triggerFire();
  viewModel.update(0.016, { reloading: true, reloadProgress: 0.4 });
  viewModel.setVisible(false);

  viewModel.reset();
  const state = viewModel.getState();
  assert.equal(viewModel.root.visible, true);
  assert.equal(state.shells.length, 0);
  assert.equal(state.smoke.length, 0);
  assert.equal(state.flashTimer, 0);
  assert.ok(Math.abs(viewModel.root.position.x - VIEW.hipPosition.x) < CLOSE);
  assert.ok(Math.abs(viewModel.root.position.y - VIEW.hipPosition.y) < CLOSE);
  assert.ok(Math.abs(viewModel.root.position.z - VIEW.hipPosition.z) < CLOSE);
  assert.equal(
    viewModel.root.getObjectByName('view-model-magazine').visible,
    true
  );

  viewModel.dispose();
});

test('视图模型 dispose 幂等，取下并清空几何与材质', () => {
  const renderer = createFakeRenderer();
  const viewModel = createViewModel(renderer);

  viewModel.dispose();
  viewModel.dispose();

  assert.equal(renderer.getDetached().length, 1, '只应从相机取下一次');
  assert.equal(viewModel.root.children.length, 0, '应清空所有子对象');

  viewModel.update(0.016, {});
  viewModel.triggerFire();
  viewModel.reset();
  assert.equal(viewModel.triggerFire(), null);
});

test('createViewModel 校验渲染器挂载能力', () => {
  assert.throws(
    () => createViewModel(null),
    (error) => error instanceof TypeError
  );
  assert.throws(
    () => createViewModel({}),
    (error) => error instanceof TypeError && /attachToCamera/.test(error.message)
  );
  assert.throws(
    () => createViewModel({ attachToCamera() {} }),
    (error) => error instanceof TypeError && /detachFromCamera/.test(error.message)
  );
});
