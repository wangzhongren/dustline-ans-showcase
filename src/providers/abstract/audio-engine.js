/**
 * 音频引擎 Provider 契约。
 *
 * 只负责 WebAudio 合成与主音量，不理解“射击”“受伤”等游戏语义。
 * 音频编排（事件到参数）属于 Service 层。
 *
 * 浏览器要求音频上下文在用户手势后创建，因此 `init()` 必须在“开始”按钮
 * 点击后调用。未初始化时 `tone()`、`noise()` 是安全空操作，并只输出一次警告；
 * `setMuted()`、`setMasterVolume()` 只记录状态，不会抛错。
 *
 * 本文件只有类型说明，没有运行时代码；导入它不会创建 AudioContext。
 */

/**
 * 单个合成音的参数。
 *
 * @typedef {Object} ToneOptions
 * @property {OscillatorType} [type] 振荡器波形，默认 `sine`。
 * @property {number} [frequency] 起始频率（Hz）。
 * @property {number} [endFrequency] 结束频率（Hz）；提供时在持续时间内滑音。
 * @property {number} [duration] 发声时长（秒），默认约 0.18。
 * @property {number} [gain] 峰值音量（0–1），默认约 0.2。
 * @property {number} [attack] 起音时间（秒）。
 * @property {number} [release] 释音时间（秒）。
 */

/**
 * 噪声效果的参数。
 *
 * @typedef {Object} NoiseOptions
 * @property {number} [duration] 发声时长（秒）。
 * @property {number} [gain] 峰值音量（0–1）。
 * @property {number} [attack] 起音时间（秒）。
 * @property {number} [release] 释音时间（秒）。
 * @property {BiquadFilterType} [filterType] 默认 `lowpass`。
 * @property {number} [frequency] 滤波器截止/中心频率（Hz）。
 * @property {number} [q] 滤波器 Q 值。
 */

/**
 * @typedef {Object} AudioEngine
 * @property {() => Promise<string>} init
 *   创建或恢复 AudioContext，返回当前上下文状态；不支持 WebAudio 时抛出明确错误。
 * @property {(options: ToneOptions) => void} tone 播放一个带包络的振荡器音。
 * @property {(options: NoiseOptions) => void} noise 播放一段带包络与滤波的白噪声。
 * @property {(muted: boolean) => void} setMuted 静音或恢复主输出。
 * @property {(volume: number) => void} setMasterVolume 设置主音量（限制在 0–1）。
 * @property {() => Promise<void>} dispose 关闭 AudioContext 并清理主增益节点。
 */

/**
 * @callback CreateAudioEngine
 * @returns {AudioEngine}
 */

export {};
