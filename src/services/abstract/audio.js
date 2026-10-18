/**
 * 音频编排服务契约。
 *
 * 音频编排把游戏语义（射击、命中、击杀、爆炸、受伤、换弹、空仓、拾取、波次、
 * 游戏结束、脚步）映射成音频引擎的 `tone()` / `noise()` 参数。声音全部由
 * WebAudio 现场合成，不使用外部音频文件。
 *
 * 本文件只有 JSDoc 类型说明与导出的空对象，没有运行时代码：
 * 导入它不会创建 AudioContext 或任何音频节点。
 *
 * 所有权约定（唯一选择）：
 * - 音频引擎由装配层（`src/main.js`）创建并持有，本 Service 只借用。
 * - `dispose()` 不关闭共享引擎；装配层在销毁界面时调用 `engine.dispose()`。
 * - 用户点击“开始”后，装配层先调用 `audio.init()`。
 *
 * 未初始化时，所有音效方法是安全的：音频引擎输出一次警告并忽略本次播放，
 * 不抛错、不创建节点。
 */

/**
 * 音频引擎中本 Service 实际使用的能力子集。
 * 完整契约见 `src/providers/abstract/audio-engine.js`。
 *
 * @typedef {Object} AudioEngineLike
 * @property {() => Promise<string>} init 创建或恢复 AudioContext，返回状态字符串。
 * @property {(options: import('../../providers/abstract/audio-engine.js').ToneOptions) => void} tone
 *   播放带包络的振荡器音。
 * @property {(options: import('../../providers/abstract/audio-engine.js').NoiseOptions) => void} noise
 *   播放带包络与滤波的白噪声。
 * @property {(muted: boolean) => void} setMuted 静音或恢复主输出。
 * @property {(volume: number) => void} [setMasterVolume] 设置主音量；缺少时服务只保存数值并警告一次。
 */

/**
 * 音频编排服务公共接口。
 *
 * @typedef {Object} AudioService
 * @property {() => Promise<string>} init 在用户手势后初始化或恢复音频上下文。
 * @property {() => void} shoot 分层枪声：高频爆裂 + 低频枪身 + 尾部回声，每发随机微调。
 * @property {() => void} hit 短促高频命中提示。
 * @property {() => void} kill 两个音高的确认音。
 * @property {() => void} explosion 低通噪声爆发 + 低频重击。
 * @property {() => void} hurt 低失真的下降音。
 * @property {() => void} reload 三声机械咔哒（约 0、0.16、0.32 秒）。
 * @property {() => void} empty 干脆的空仓咔哒。
 * @property {() => void} pickup 上行两音。
 * @property {() => void} waveStart 低频号角式音序。
 * @property {() => void} gameOver 下降音。
 * @property {() => void} footstep 很轻的噪声脚步。
 * @property {(distance: number, enemyType?: string) => void} enemyShot
 *   敌人枪声；距离越远越轻、截止频率越低。`distance` 必须是大于等于 0 的有限数字。
 * @property {() => void} headshot 爆头专用强调音。
 * @property {() => void} shellDrop 弹壳落地轻响。
 * @property {() => void} wind 一次环境风声。
 * @property {() => void} distantFire 一次远处交火声。
 * @property {() => void} ambience 播放一次环境风声（装配层可自行节流）。
 * @property {() => void} startAmbience 启动持续风声与远处交火；重复调用幂等。
 * @property {() => void} stopAmbience 停止持续环境音；重复调用幂等。
 * @property {(volume: number) => void} setMasterVolume 设置并保存主音量（0–1）。
 * @property {() => number} getMasterVolume 返回当前主音量。
 * @property {(muted: boolean) => void} setMuted 静音或恢复；未初始化时由引擎记录状态。
 * @property {() => boolean} isMuted 返回最近一次设置的静音状态。
 * @property {() => void} dispose 停止环境音计时器并结束本 Service；不关闭装配层持有的音频引擎。
 */

/**
 * 音频编排服务工厂参数。
 *
 * @typedef {Object} CreateAudioOptions
 * @property {AudioEngineLike} engine 音频引擎公共入口返回值（必需）。
 */

/**
 * @callback CreateAudio
 * @param {CreateAudioOptions} options
 * @returns {AudioService}
 */

export {};
