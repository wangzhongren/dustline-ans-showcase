/**
 * v3 场景子系统单元测试：贴片池与效果服务对 decals 的委托。
 *
 * 不创建 WebGL、AudioContext 或 DOM；贴片纹理在没有 document 时退化为纯色平面，
 * 正好覆盖 Node 测试路径。
 *
 * 运行：
 *   node --test test/环境引擎/scene-systems.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECAL_LIMITS,
  DECAL_LIFETIMES,
  computeDecalOpacity,
  pickDecalIndex,
  createDecals
} from '../../src/services/impl/environment/decals.js';
import {
  EFFECT_POOL_LIMITS,
  createEffectsService
} from '../../src/services/impl/effects/effects.js';
import { createProps } from '../../src/services/impl/environment/props.js';
import {
  createLayout,
  isPointInsideCollider
} from '../../src/services/impl/environment/arena-layout.js';
import {
  Box3,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from '../../src/providers/public/three.js';

/**
 * @returns {{added: unknown[], removed: unknown[], renderer: {add: Function, remove: Function}}}
 */
function createFakeRenderer() {
  const added = [];
  const removed = [];
  return {
    added,
    removed,
    renderer: {
      add(object) {
        added.push(object);
      },
      remove(object) {
        removed.push(object);
      }
    }
  };
}

test('贴片上限、淡出曲线与复用策略', () => {
  assert.deepEqual(DECAL_LIMITS, {
    bulletHole: 48,
    blood: 24,
    scorch: 12,
    stain: 24
  });
  assert.deepEqual(DECAL_LIFETIMES, {
    bulletHole: 0,
    blood: 16,
    scorch: 26,
    stain: 34
  });

  assert.equal(computeDecalOpacity(0, 10, 0.5), 1);
  assert.equal(computeDecalOpacity(5, 10, 0.5), 1);
  assert.equal(computeDecalOpacity(10, 10, 0.5), 0);
  assert.equal(computeDecalOpacity(100, 0, 0.5), 1, 'life 0 表示永久保留');
  const mid = computeDecalOpacity(7.5, 10, 0.5);
  assert.ok(mid > 0 && mid < 1);
  assert.throws(() => computeDecalOpacity(-1, 10, 0.5), /age/);
  assert.throws(() => computeDecalOpacity(1, -1, 0.5), /life/);
  assert.throws(() => computeDecalOpacity(1, 10, 2), /fadeStart/);

  const entries = [
    { active: true, age: 0.1 },
    { active: false, age: 0.2 },
    { active: true, age: 0.4 }
  ];
  assert.equal(pickDecalIndex(entries), 1);
  const allActive = [
    { active: true, age: 0.1 },
    { active: true, age: 0.5 },
    { active: true, age: 0.3 }
  ];
  assert.equal(pickDecalIndex(allActive), 1);
  assert.equal(pickDecalIndex([]), -1);
});

test('贴片系统固定对象数、池满复用、更新/清空/释放正确', () => {
  const fake = createFakeRenderer();
  const decals = createDecals({ renderer: fake.renderer });

  assert.equal(fake.added.length, 1, '贴片系统应只加入一个 Group');
  assert.equal(
    decals.group.children.length,
    DECAL_LIMITS.bulletHole +
      DECAL_LIMITS.blood +
      DECAL_LIMITS.scorch +
      DECAL_LIMITS.stain
  );

  const counts = decals.getCounts();
  assert.equal(counts.bulletHole.total, 48);
  assert.equal(counts.blood.total, 24);
  assert.equal(counts.scorch.total, 12);
  assert.equal(counts.stain.total, 24);

  for (let index = 0; index < 80; index += 1) {
    decals.addBulletHole(
      { x: index * 0.1, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 }
    );
  }
  assert.equal(decals.group.children.length, 108, '池满后不应新增对象');
  assert.equal(decals.getCounts().bulletHole.active, 48);

  const firstMesh = decals.group.children[0];
  decals.addBulletHole({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 });
  assert.equal(firstMesh.visible, true);
  assert.ok(Math.abs(firstMesh.position.x - 1) < 1e-9);
  assert.ok(Math.abs(firstMesh.position.y - 2) < 1e-9);
  assert.ok(firstMesh.position.z > 3, '贴片必须沿法线偏移以避免 z-fighting');

  decals.addBlood({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 0x7a1717);
  decals.addScorch({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  decals.addStain({ x: 2, y: 0.01, z: 2 }, { x: 0, y: 1, z: 0 }, 1.6);
  assert.equal(decals.getCounts().blood.active, 1);
  assert.equal(decals.getCounts().scorch.active, 1);
  assert.equal(decals.getCounts().stain.active, 1);

  decals.update(0.1);
  for (let step = 0; step < 220; step += 1) {
    decals.update(0.2);
  }
  assert.equal(decals.getCounts().blood.active, 0, '血迹应在寿命结束后隐藏');
  assert.equal(decals.getCounts().scorch.active, 0, '灼痕应在寿命结束后隐藏');
  assert.equal(decals.getCounts().stain.active, 0, '污渍应在寿命结束后隐藏');
  assert.equal(decals.getCounts().bulletHole.active, 48, '弹孔保留到被复用');

  decals.clear();
  assert.equal(decals.getCounts().bulletHole.active, 0);

  decals.dispose();
  assert.equal(fake.removed.length, 1);
  assert.throws(
    () => decals.addBulletHole({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
    /已释放/
  );
});

test('效果服务把弹孔与血迹委托给 decals，并保留自身粒子池', () => {
  const fake = createFakeRenderer();
  const decalCalls = [];
  const fakeDecals = {
    addBulletHole(position, normal) {
      decalCalls.push({ kind: 'bulletHole', position, normal });
    },
    addBlood(position, normal, color) {
      decalCalls.push({ kind: 'blood', position, normal, color });
    },
    addScorch() {
      decalCalls.push({ kind: 'scorch' });
    },
    addStain() {
      decalCalls.push({ kind: 'stain' });
    },
    update() {},
    clear() {},
    dispose() {}
  };

  const effects = createEffectsService({
    renderer: fake.renderer,
    decals: fakeDecals
  });

  let totalPoolSize = 0;
  for (const limit of Object.values(EFFECT_POOL_LIMITS)) {
    totalPoolSize += limit;
  }
  assert.equal(fake.added.length, totalPoolSize);

  effects.bulletHole({ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 1 });
  effects.blood({ x: 2, y: 1, z: 2 }, { x: 0, y: 0, z: -1 }, 0x7a1717);
  assert.deepEqual(
    decalCalls.map((call) => call.kind),
    ['bulletHole', 'blood']
  );
  assert.equal(decalCalls[1].color, 0x7a1717);

  effects.enemyShot({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, 0xffcf8a);
  effects.shell({ x: 0, y: 1.3, z: 0 }, { x: 0.4, y: 1.2, z: 0 });
  effects.muzzleSmoke({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 });
  effects.update(0.05);
  effects.clear();
  effects.dispose();
  assert.equal(fake.removed.length, totalPoolSize);
  assert.equal(decalCalls.length, 2, '效果服务不应自己重复写贴片');
});

test('场景道具实例矩阵完整、无原点默认实例、无巨型实例，且不侵入出生区', () => {
  const layout = createLayout();
  const materialKeys = [
    'fabric',
    'galvanized',
    'concrete',
    'wood',
    'rubber',
    'metal',
    'metalRust',
    'steelOlive',
    'steelKhaki',
    'steelRust',
    'ammo',
    'sign',
    'lamp',
    'grass',
    'darkMetal',
    'rock',
    'canvasKhaki',
    'canvasOlive'
  ];
  const materials = {};
  for (const key of materialKeys) {
    materials[key] = new MeshStandardMaterial();
  }
  const props = createProps({ layout, materials });

  const instancedMeshes = [];
  props.group.traverse((node) => {
    if (node.isInstancedMesh === true) {
      instancedMeshes.push(node);
    }
  });
  assert.ok(instancedMeshes.length >= 8, '应有多组实例化道具');

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  for (const mesh of instancedMeshes) {
    assert.ok(mesh.count > 0, '实例组不能为空');
    assert.ok(
      mesh.count <= mesh.instanceMatrix.count,
      '绘制实例数不能超过已分配矩阵数'
    );
    assert.equal(mesh.frustumCulled, false, '实例组必须关闭视锥裁剪');
    for (let index = 0; index < mesh.count; index += 1) {
      mesh.getMatrixAt(index, matrix);
      for (const element of matrix.elements) {
        assert.ok(Number.isFinite(element), '实例矩阵不能包含 NaN/Infinity');
      }
      matrix.decompose(position, quaternion, scale);
      const atOrigin =
        Math.abs(position.x) < 1e-9 &&
        Math.abs(position.y) < 1e-9 &&
        Math.abs(position.z) < 1e-9;
      const unitScale =
        Math.abs(scale.x - 1) < 1e-9 &&
        Math.abs(scale.y - 1) < 1e-9 &&
        Math.abs(scale.z - 1) < 1e-9;
      assert.equal(
        atOrigin && unitScale,
        false,
        '不能留下未写入的原点默认实例'
      );
      assert.ok(
        Math.abs(scale.x) <= 6 &&
          Math.abs(scale.y) <= 6 &&
          Math.abs(scale.z) <= 6,
        '实例缩放不应达到巨型道具的量级'
      );
      assert.ok(
        Math.hypot(position.x, position.z) >= 2,
        '实例中心不能落在出生点 2 米内'
      );
    }
  }

  const spawn = { x: 0, y: 0, z: 0 };
  for (const collider of props.colliders) {
    assert.equal(
      isPointInsideCollider(spawn, collider, 5),
      false,
      '实体道具不能侵入玩家出生点 5 米安全区'
    );
    assert.ok(
      collider.min.x >= -30 &&
        collider.max.x <= 30 &&
        collider.min.z >= -30 &&
        collider.max.z <= 30,
      '实体道具不能越出 60 × 60 米竞技场'
    );
  }

  // 网格级检查：出生点眼睛高度周围不能有道具网格，且单个道具不能达到巨型尺寸。
  props.group.updateMatrixWorld(true);
  const eye = new Vector3(0, 1.68, 0);
  const bounds = new Box3();
  props.group.traverse((node) => {
    if (node.isMesh !== true) {
      return;
    }
    if (node.isInstancedMesh === true) {
      // 实例组已经逐条检查矩阵与缩放；整组包围盒会横跨整个竞技场，不能用于尺寸判断。
      return;
    }
    bounds.setFromObject(node);
    const size = new Vector3();
    bounds.getSize(size);
    assert.ok(
      size.x <= 8 && size.y <= 8 && size.z <= 8,
      '道具网格尺寸异常（可能是错误的缩放或实例）'
    );
    assert.ok(
      bounds.distanceToPoint(eye) >= 2,
      '出生点 2 米内不能有道具网格'
    );
  });

  props.update(0.016);
  props.dispose();
  for (const key of materialKeys) {
    materials[key].dispose();
  }
});

