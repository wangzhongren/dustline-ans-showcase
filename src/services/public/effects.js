/**
 * 视觉反馈服务公共入口。
 *
 * Pipeline 只能从这里获得效果服务：`createEffects({ renderer, decals? })` 校验
 * 渲染器与可选贴片系统后返回 `{ tracer, impact, explosion, spawn, blood,
 * bulletHole, muzzleSmoke, shell, enemyShot, update, clear, dispose }`。
 * 不要导入 `src/services/impl/effects/` 下的实现文件。
 */

import { createEffectsService } from '../impl/effects/effects.js';

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function requireObject(value, field) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('createEffects: ' + field + ' 必须是对象');
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
    throw new TypeError('createEffects: ' + field + ' 必须是函数');
  }
  return value;
}

/**
 * 创建视觉反馈服务。
 *
 * @param {import('../abstract/effects.js').CreateEffectsOptions} options
 * @returns {import('../abstract/effects.js').EffectsService}
 */
export function createEffects(options) {
  const source = requireObject(options, 'options');

  const renderer = requireObject(source.renderer, 'renderer');
  requireFunction(renderer.add, 'renderer.add');
  requireFunction(renderer.remove, 'renderer.remove');

  let decals = undefined;
  if (source.decals !== undefined && source.decals !== null) {
    decals = requireObject(source.decals, 'decals');
    requireFunction(decals.addBulletHole, 'decals.addBulletHole');
    requireFunction(decals.addBlood, 'decals.addBlood');
    requireFunction(decals.addScorch, 'decals.addScorch');
    requireFunction(decals.addStain, 'decals.addStain');
  }

  return createEffectsService({
    renderer: /** @type {import('../../providers/abstract/renderer.js').Renderer} */ (renderer),
    decals: /** @type {import('../abstract/effects.js').DecalSink|undefined} */ (decals)
  });
}
