/**
 * 音频引擎 Provider 公共入口。
 *
 * 上层通过 `createAudioEngine()` 获得合成能力；工厂本身不创建 AudioContext，
 * 必须在用户手势后调用返回对象的 `init()`。
 */

import { createWebAudioEngine } from '../impl/webaudio-engine.js';

/**
 * 创建 WebAudio 合成引擎。
 *
 * @returns {import('../abstract/audio-engine.js').AudioEngine}
 */
export function createAudioEngine() {
  return createWebAudioEngine();
}
