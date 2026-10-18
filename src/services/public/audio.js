/**
 * 音频编排服务公共入口。
 *
 * Pipeline 只能从这里获得音频服务：`createAudio({ engine })` 校验引擎能力后返回
 * `{ init, shoot, hit, kill, explosion, hurt, reload, empty, pickup, waveStart,
 * gameOver, footstep, setMuted, isMuted, dispose }`。
 * 不要导入 `src/services/impl/audio/` 下的实现文件。
 */

import { createAudioService } from '../impl/audio/audio-service.js';

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function requireObject(value, field) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('createAudio: ' + field + ' 必须是对象');
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
    throw new TypeError('createAudio: ' + field + ' 必须是函数');
  }
  return value;
}

/**
 * 创建音频编排服务。
 *
 * @param {import('../abstract/audio.js').CreateAudioOptions} options
 * @returns {import('../abstract/audio.js').AudioService}
 */
export function createAudio(options) {
  const source = requireObject(options, 'options');

  const engine = requireObject(source.engine, 'engine');
  requireFunction(engine.init, 'engine.init');
  requireFunction(engine.tone, 'engine.tone');
  requireFunction(engine.noise, 'engine.noise');
  requireFunction(engine.setMuted, 'engine.setMuted');

  return createAudioService({
    engine: /** @type {import('../abstract/audio.js').AudioEngineLike} */ (engine)
  });
}
