/**
 * 敌方服务公共入口。
 *
 * Pipeline 只能从这里获得敌方服务：`createEnemies(options)` 校验必需参数后
 * 返回 `{ load, reset, startWave, update, getTargetQuery, getState, dispose }`。
 * 不要导入 `src/services/impl/` 下的实现文件。
 *
 * `assets` 是可选的素材 Provider 公共入口（需要 `loadGltf(url)` 与可选的
 * `loadManifest()`）。Pipeline 应 `await enemies.load()` 再开始对局；没有
 * 素材加载器或加载失败时，敌方服务记录错误并使用程序化人类士兵回退。
 */

import { createEnemiesManager } from '../impl/enemies/enemy-manager.js';

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function requireObject(value, field) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('createEnemies: ' + field + ' 必须是对象');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Function}
 */
function requireFunction(value, field) {
  if (typeof value !== 'function') {
    throw new TypeError('createEnemies: ' + field + ' 必须是函数');
  }
  return value;
}

/**
 * 创建敌方服务。
 *
 * @param {import('../abstract/enemies.js').CreateEnemiesOptions} options
 * @returns {import('../abstract/enemies.js').EnemiesService}
 */
export function createEnemies(options) {
  const source = requireObject(options, 'options');

  const renderer = requireObject(source.renderer, 'renderer');
  requireFunction(renderer.add, 'renderer.add');
  requireFunction(renderer.remove, 'renderer.remove');

  const getSpawnPoint = requireFunction(source.getSpawnPoint, 'getSpawnPoint');
  const emit = requireFunction(source.emit, 'emit');

  let colliders = source.colliders;
  if (colliders === undefined) {
    colliders = [];
  }
  if (!Array.isArray(colliders)) {
    throw new TypeError('createEnemies: colliders 必须是数组');
  }

  let assets = source.assets;
  if (assets !== undefined && assets !== null) {
    requireObject(assets, 'assets');
    if (assets.loadGltf !== undefined) {
      requireFunction(assets.loadGltf, 'assets.loadGltf');
    }
    if (assets.loadManifest !== undefined) {
      requireFunction(assets.loadManifest, 'assets.loadManifest');
    }
  } else {
    assets = undefined;
  }

  return createEnemiesManager({
    renderer,
    colliders,
    getSpawnPoint,
    emit,
    assets
  });
}
