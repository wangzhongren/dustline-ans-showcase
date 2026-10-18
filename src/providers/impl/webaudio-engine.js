/**
 * WebAudio 合成 Provider 实现。
 *
 * 不读取任何音频文件，只创建振荡器、噪声缓冲、滤波器与增益包络。
 * AudioContext 只在 `init()` 中创建，避免导入模块或页面加载时触发自动播放限制。
 */

const DEFAULT_MASTER_VOLUME = 0.8;
const DEFAULT_TONE_DURATION = 0.18;
const DEFAULT_NOISE_DURATION = 0.25;
const DEFAULT_TONE_GAIN = 0.2;
const DEFAULT_NOISE_GAIN = 0.2;
const DEFAULT_ATTACK = 0.01;
const DEFAULT_RELEASE = 0.08;
const DEFAULT_TONE_FREQUENCY = 440;
const DEFAULT_FILTER_FREQUENCY = 1200;
const DEFAULT_FILTER_Q = 0.7;

const OSCILLATOR_TYPES = Object.freeze([
  'sine',
  'square',
  'sawtooth',
  'triangle',
  'custom'
]);

const BIQUAD_TYPES = Object.freeze([
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass'
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object';
}

/**
 * @param {string} action
 * @param {unknown} cause
 * @returns {Error}
 */
function createAudioError(action, cause) {
  let reason = String(cause);
  if (cause instanceof Error) {
    reason = cause.message;
  }
  const error = new Error(action + '失败：' + reason);
  error.cause = cause;
  return error;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function readOptions(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isObject(value)) {
    throw new TypeError(label + ' 的参数必须是对象');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {string} label
 * @returns {string}
 */
function readStringOption(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(label + ' 必须是非空字符串');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {string} label
 * @returns {number}
 */
function readPositiveOption(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(label + ' 必须是大于 0 的有限数字');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {string} label
 * @returns {number}
 */
function readNonNegativeOption(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(label + ' 必须是大于等于 0 的有限数字');
  }
  return value;
}

/**
 * @returns {typeof AudioContext|null}
 */
function getAudioContextClass() {
  if (typeof window === 'undefined') {
    return null;
  }
  if (typeof window.AudioContext === 'function') {
    return window.AudioContext;
  }
  if (typeof window.webkitAudioContext === 'function') {
    return window.webkitAudioContext;
  }
  return null;
}

/**
 * 安排“起音 → 保持 → 释音”的线性包络。
 *
 * @param {AudioParam} param
 * @param {number} now
 * @param {number} peak
 * @param {number} attack
 * @param {number} duration
 * @param {number} release
 * @returns {void}
 */
function scheduleEnvelope(param, now, peak, attack, duration, release) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(0, now);
  if (attack > 0) {
    param.linearRampToValueAtTime(peak, now + attack);
  } else {
    param.setValueAtTime(peak, now);
  }

  let holdEnd = now + duration;
  const attackEnd = now + attack;
  if (holdEnd < attackEnd) {
    holdEnd = attackEnd;
  }
  param.setValueAtTime(peak, holdEnd);

  if (release > 0) {
    param.linearRampToValueAtTime(0, holdEnd + release);
  } else {
    param.setValueAtTime(0, holdEnd);
  }
}

/**
 * 创建 WebAudio 合成引擎。
 *
 * @returns {import('../abstract/audio-engine.js').AudioEngine}
 */
export function createWebAudioEngine() {
  let context = null;
  let masterGain = null;
  let muted = false;
  let masterVolume = DEFAULT_MASTER_VOLUME;
  let warningIssued = false;

  /**
   * @returns {boolean}
   */
  function isReady() {
    return context !== null && masterGain !== null;
  }

  /**
   * 未初始化时只警告一次，避免每帧调用声音方法刷满控制台。
   *
   * @returns {void}
   */
  function warnBeforeInit() {
    if (warningIssued) {
      return;
    }
    warningIssued = true;
    console.warn(
      '[audio] 音频引擎尚未初始化：请在用户点击“开始”后先调用 init()，再播放声音。'
    );
  }

  /**
   * @returns {void}
   */
  function applyMasterGain() {
    if (context === null || masterGain === null) {
      return;
    }
    let target = masterVolume;
    if (muted) {
      target = 0;
    }
    masterGain.gain.setTargetAtTime(target, context.currentTime, 0.01);
  }

  /**
   * 创建或恢复 AudioContext。必须在用户手势后调用。
   *
   * @returns {Promise<string>}
   */
  async function init() {
    const AudioContextClass = getAudioContextClass();
    if (AudioContextClass === null) {
      const error = new Error(
        '当前环境不支持 WebAudio：window.AudioContext 不存在'
      );
      console.error('[audio] 初始化失败', error);
      throw error;
    }

    if (context === null) {
      let pendingContext = null;
      try {
        pendingContext = new AudioContextClass();
        const nextGain = pendingContext.createGain();
        let initialGain = masterVolume;
        if (muted) {
          initialGain = 0;
        }
        nextGain.gain.setValueAtTime(initialGain, pendingContext.currentTime);
        nextGain.connect(pendingContext.destination);
        context = pendingContext;
        masterGain = nextGain;
      } catch (error) {
        if (pendingContext !== null) {
          pendingContext.close().catch((closeError) => {
            console.error('[audio] 初始化失败后关闭 AudioContext 失败', closeError);
          });
        }
        console.error('[audio] 创建 AudioContext 失败', error);
        throw createAudioError('创建 AudioContext', error);
      }
    }

    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        console.error('[audio] 恢复 AudioContext 失败', error);
        throw createAudioError('恢复 AudioContext', error);
      }
    }

    warningIssued = false;
    return context.state;
  }

  /**
   * @param {import('../abstract/audio-engine.js').ToneOptions} [toneOptions]
   * @returns {void}
   */
  function tone(toneOptions) {
    if (!isReady()) {
      warnBeforeInit();
      return;
    }
    const options = readOptions(toneOptions, 'tone');
    const type = readStringOption(options.type, 'sine', 'tone.type');
    if (!OSCILLATOR_TYPES.includes(type)) {
      throw new TypeError(
        'tone.type 必须是 ' + OSCILLATOR_TYPES.join('、') + ' 之一'
      );
    }
    const frequency = readPositiveOption(
      options.frequency,
      DEFAULT_TONE_FREQUENCY,
      'tone.frequency'
    );
    let endFrequency = null;
    if (options.endFrequency !== undefined) {
      endFrequency = readPositiveOption(
        options.endFrequency,
        0,
        'tone.endFrequency'
      );
    }
    const duration = readPositiveOption(
      options.duration,
      DEFAULT_TONE_DURATION,
      'tone.duration'
    );
    const peakGain = readNonNegativeOption(
      options.gain,
      DEFAULT_TONE_GAIN,
      'tone.gain'
    );
    const attack = readNonNegativeOption(
      options.attack,
      DEFAULT_ATTACK,
      'tone.attack'
    );
    const release = readNonNegativeOption(
      options.release,
      DEFAULT_RELEASE,
      'tone.release'
    );

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        now + duration
      );
    }
    scheduleEnvelope(envelope.gain, now, peakGain, attack, duration, release);

    oscillator.connect(envelope);
    envelope.connect(masterGain);
    const stopTime = now + duration + release + 0.02;
    oscillator.start(now);
    oscillator.stop(stopTime);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
  }

  /**
   * @param {import('../abstract/audio-engine.js').NoiseOptions} [noiseOptions]
   * @returns {void}
   */
  function noise(noiseOptions) {
    if (!isReady()) {
      warnBeforeInit();
      return;
    }
    const options = readOptions(noiseOptions, 'noise');
    const duration = readPositiveOption(
      options.duration,
      DEFAULT_NOISE_DURATION,
      'noise.duration'
    );
    const peakGain = readNonNegativeOption(
      options.gain,
      DEFAULT_NOISE_GAIN,
      'noise.gain'
    );
    const attack = readNonNegativeOption(
      options.attack,
      DEFAULT_ATTACK,
      'noise.attack'
    );
    const release = readNonNegativeOption(
      options.release,
      DEFAULT_RELEASE,
      'noise.release'
    );
    const filterType = readStringOption(
      options.filterType,
      'lowpass',
      'noise.filterType'
    );
    if (!BIQUAD_TYPES.includes(filterType)) {
      throw new TypeError(
        'noise.filterType 必须是 ' + BIQUAD_TYPES.join('、') + ' 之一'
      );
    }
    const filterFrequency = readPositiveOption(
      options.frequency,
      DEFAULT_FILTER_FREQUENCY,
      'noise.frequency'
    );
    const q = readNonNegativeOption(options.q, DEFAULT_FILTER_Q, 'noise.q');

    const now = context.currentTime;
    const totalDuration = duration + release + 0.02;
    const frameCount = Math.max(
      1,
      Math.floor(context.sampleRate * totalDuration)
    );
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.Q.setValueAtTime(q, now);
    const envelope = context.createGain();
    scheduleEnvelope(envelope.gain, now, peakGain, attack, duration, release);

    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(masterGain);
    source.start(now);
    source.stop(now + totalDuration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    };
  }

  /**
   * @param {boolean} nextMuted
   * @returns {void}
   */
  function setMuted(nextMuted) {
    if (typeof nextMuted !== 'boolean') {
      throw new TypeError('setMuted 需要布尔值');
    }
    muted = nextMuted;
    applyMasterGain();
  }

  /**
   * @param {number} volume
   * @returns {void}
   */
  function setMasterVolume(volume) {
    if (!Number.isFinite(volume)) {
      throw new TypeError('setMasterVolume 需要有限数字');
    }
    let nextVolume = volume;
    if (nextVolume < 0) {
      nextVolume = 0;
    }
    if (nextVolume > 1) {
      nextVolume = 1;
    }
    masterVolume = nextVolume;
    applyMasterGain();
  }

  /**
   * 关闭 AudioContext；清理失败只记录，不影响调用方继续卸载。
   *
   * @returns {Promise<void>}
   */
  async function dispose() {
    const oldContext = context;
    context = null;
    masterGain = null;
    warningIssued = false;
    if (oldContext === null) {
      return;
    }
    try {
      await oldContext.close();
    } catch (error) {
      console.error('[audio] 关闭 AudioContext 失败', error);
    }
  }

  return {
    init,
    tone,
    noise,
    setMuted,
    setMasterVolume,
    dispose
  };
}
