/**
 * 竞技场服务公共入口。
 *
 * Pipeline 只能从这里获得竞技场：`createArena({ renderer, assets })` 校验必需
 * 能力后返回 `{ load, getColliders, getSpawnPoint, getPlayerSpawn, update, dispose }`。
 * 不要导入 `src/services/impl/environment/` 下的实现文件。
 */

import { createArenaService } from '../impl/environment/arena.js';

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function requireObject(value, field) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('createArena: ' + field + ' 必须是对象');
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
    throw new TypeError('createArena: ' + field + ' 必须是函数');
  }
  return value;
}

/**
 * 创建竞技场服务。
 *
 * @param {import('../abstract/environment.js').CreateArenaOptions} options
 * @returns {import('../abstract/environment.js').ArenaService}
 */
export function createArena(options) {
  const source = requireObject(options, 'options');

  const renderer = requireObject(source.renderer, 'renderer');
  requireFunction(renderer.add, 'renderer.add');
  requireFunction(renderer.remove, 'renderer.remove');
  requireFunction(renderer.setEnvironment, 'renderer.setEnvironment');

  const assets = requireObject(source.assets, 'assets');
  requireFunction(assets.loadManifest, 'assets.loadManifest');
  requireFunction(assets.loadTexture, 'assets.loadTexture');
  requireFunction(assets.loadHdr, 'assets.loadHdr');

  return createArenaService({
    renderer: /** @type {import('../../providers/abstract/renderer.js').Renderer} */ (renderer),
    assets: /** @type {import('../../providers/abstract/assets.js').AssetLoader} */ (assets)
  });
}
