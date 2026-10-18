/**
 * 音频编排 Service 实现。
 *
 * 把游戏语义（射击、命中、爆炸、换弹……）映射成音频引擎的 `tone()` / `noise()`
 * 参数。声音全部由 WebAudio 现场合成，不读取外部音频文件。
 *
 * v3 追加：
 * - 分层枪声：高频爆裂 + 低频枪身 + 尾部回声，每发随机微调。
 * - 敌人枪声按距离衰减并降低截止频率。
 * - 爆头提示、弹壳落地、风声与远处交火环境音。
 * - `setMasterVolume()` / `getMasterVolume()`。
 *
 * 所有权：
 * - AudioContext 和音频引擎由装配层（`src/main.js`）创建并持有。
 * - 本 Service **不**关闭共享引擎：`dispose()` 只停止环境音计时器并标记服务失效。
 * - 用户点击“开始”后，装配层调用 `audio.init()` 完成用户手势初始化。
 *
 * 未初始化时调用任一音效方法是安全的：音频引擎会输出一次警告并忽略本次播放。
 */

import { GAME_CONFIG } from '../../../models/game-config.js';

/** 整体混音系数：配置里的相对增益再乘这个值，避免叠层后削波。 */
const MIX_SCALE = 0.7;

/** 服务支持的声音名称。参数映射可通过 `getSoundPlan()` 在无 AudioContext 的环境中测试。 */
export const SOUND_NAMES = Object.freeze([
  'shoot',
  'hit',
  'kill',
  'explosion',
  'hurt',
  'reload',
  'empty',
  'pickup',
  'waveStart',
  'gameOver',
  'footstep',
  'enemyShot',
  'headshot',
  'shellDrop',
  'wind',
  'distantFire'
]);

/**
 * @param {'tone'|'noise'} kind
 * @param {Record<string, unknown>} options
 * @returns {{kind: 'tone'|'noise', options: Record<string, unknown>}}
 */
function step(kind, options) {
  return Object.freeze({ kind, options: Object.freeze(options) });
}

/**
 * 计算敌人枪声的距离衰减系数：越远越轻，最低保留 0.08。
 *
 * @param {number} distance 米。
 * @returns {number}
 */
export function computeEnemyShotAttenuation(distance) {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) {
    throw new RangeError('enemyShot 的 distance 必须是大于等于 0 的有限数字');
  }
  const raw = 1 / (1 + distance / 14);
  return Math.min(1, Math.max(0.08, raw));
}

/**
 * 生成敌人枪声的分层参数。距离越远，整体越轻、截止频率越低。
 *
 * @param {number} distance 米。
 * @param {string} [enemyType] rifleman / heavy / breacher。
 * @returns {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>}
 */
export function getEnemyShotPlan(distance, enemyType) {
  const attenuation = computeEnemyShotAttenuation(distance);
  let typeGain = 1;
  if (enemyType === 'heavy') {
    typeGain = 1.15;
  } else if (enemyType === 'breacher') {
    typeGain = 0.8;
  }
  const cutoff = Math.min(2600, Math.max(500, 2600 - distance * 70));
  const gain = attenuation * typeGain * MIX_SCALE;
  return [
    {
      kind: 'noise',
      options: {
        duration: 0.08,
        gain: 0.18 * gain,
        attack: 0.002,
        release: 0.07,
        filterType: 'bandpass',
        frequency: cutoff,
        q: 0.7
      }
    },
    {
      kind: 'tone',
      options: {
        type: 'triangle',
        frequency: 150,
        endFrequency: 55,
        duration: 0.18,
        gain: 0.12 * gain,
        attack: 0.004,
        release: 0.12
      }
    },
    {
      kind: 'tone',
      options: {
        type: 'sine',
        frequency: 80,
        endFrequency: 40,
        duration: 0.25,
        gain: 0.08 * gain,
        attack: 0.01,
        release: 0.2
      }
    }
  ];
}

/**
 * 分层枪声基参数。每发播放时再叠加随机微调，避免机械重复。
 *
 * @returns {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>}
 */
function createShotPlan() {
  const shot = GAME_CONFIG.weapon.audio.shot;
  return [
    step('noise', {
      duration: shot.crack.duration,
      gain: shot.crack.gain * MIX_SCALE,
      attack: 0.001,
      release: 0.04,
      filterType: 'highpass',
      frequency: shot.crack.frequency,
      q: 0.8
    }),
    step('tone', {
      type: 'triangle',
      frequency: shot.body.frequency,
      endFrequency: 70,
      duration: shot.body.duration,
      gain: shot.body.gain * MIX_SCALE,
      attack: 0.002,
      release: 0.08
    }),
    step('tone', {
      type: 'sine',
      frequency: shot.tail.frequency,
      endFrequency: 45,
      duration: shot.tail.duration,
      gain: shot.tail.gain * MIX_SCALE,
      attack: 0.012,
      release: 0.2
    })
  ];
}

/**
 * 事件到声音参数的映射。所有音量保持较低，持续时间短，避免疲劳和削波。
 *
 * - `kind: 'tone'` 调用 `engine.tone(options)`。
 * - `kind: 'noise'` 调用 `engine.noise(options)`。
 * - `attack` 同时用于给“第二声机械点击”制造延迟。
 */
const SOUND_PLANS = Object.freeze({
  shoot: Object.freeze(createShotPlan()),

  hit: Object.freeze([
    step('tone', {
      type: 'square',
      frequency: 1700,
      duration: 0.028,
      gain: 0.05,
      attack: 0.001,
      release: 0.03
    })
  ]),

  kill: Object.freeze([
    step('tone', {
      type: 'sine',
      frequency: 880,
      duration: 0.09,
      gain: 0.07,
      attack: 0.004,
      release: 0.08
    }),
    step('tone', {
      type: 'sine',
      frequency: 1320,
      duration: 0.12,
      gain: 0.05,
      attack: 0.004,
      release: 0.1
    })
  ]),

  explosion: Object.freeze([
    step('noise', {
      duration: 0.5,
      gain: 0.2,
      attack: 0.005,
      release: 0.5,
      filterType: 'lowpass',
      frequency: 380,
      q: 0.7
    }),
    step('tone', {
      type: 'sine',
      frequency: 95,
      endFrequency: 38,
      duration: 0.45,
      gain: 0.18,
      attack: 0.004,
      release: 0.4
    })
  ]),

  hurt: Object.freeze([
    step('tone', {
      type: 'sawtooth',
      frequency: 190,
      endFrequency: 95,
      duration: 0.2,
      gain: 0.1,
      attack: 0.004,
      release: 0.16
    }),
    step('noise', {
      duration: 0.12,
      gain: 0.06,
      attack: 0.004,
      release: 0.14,
      filterType: 'lowpass',
      frequency: 500,
      q: 0.8
    })
  ]),

  reload: Object.freeze([
    step('noise', {
      duration: 0.02,
      gain: 0.07,
      attack: 0.002,
      release: 0.03,
      filterType: 'highpass',
      frequency: 1800,
      q: 0.7
    }),
    step('noise', {
      duration: 0.02,
      gain: 0.06,
      // 较慢的起音把第二声机械点击推迟约 0.16 秒。
      attack: 0.16,
      release: 0.03,
      filterType: 'highpass',
      frequency: 1400,
      q: 0.7
    }),
    step('noise', {
      duration: 0.024,
      gain: 0.05,
      // 第三声（拉机柄/弹匣到位）推迟约 0.32 秒。
      attack: 0.32,
      release: 0.04,
      filterType: 'bandpass',
      frequency: 1100,
      q: 0.9
    })
  ]),

  empty: Object.freeze([
    step('noise', {
      duration: 0.025,
      gain: 0.06,
      attack: 0.001,
      release: 0.02,
      filterType: 'highpass',
      frequency: 2600,
      q: 0.6
    })
  ]),

  pickup: Object.freeze([
    step('tone', {
      type: 'sine',
      frequency: 520,
      endFrequency: 780,
      duration: 0.18,
      gain: 0.08,
      attack: 0.005,
      release: 0.12
    }),
    step('tone', {
      type: 'sine',
      frequency: 780,
      endFrequency: 1040,
      // 延迟起音形成“上行两音”，不是同时响的和弦。
      attack: 0.08,
      duration: 0.12,
      gain: 0.05,
      release: 0.1
    })
  ]),

  waveStart: Object.freeze([
    step('tone', {
      type: 'sawtooth',
      frequency: 110,
      endFrequency: 120,
      duration: 0.55,
      gain: 0.1,
      attack: 0.02,
      release: 0.35
    }),
    step('tone', {
      type: 'triangle',
      frequency: 55,
      duration: 0.5,
      gain: 0.09,
      attack: 0.15,
      release: 0.35
    })
  ]),

  gameOver: Object.freeze([
    step('tone', {
      type: 'sine',
      frequency: 330,
      endFrequency: 90,
      duration: 0.9,
      gain: 0.13,
      attack: 0.01,
      release: 0.5
    }),
    step('noise', {
      duration: 0.5,
      gain: 0.05,
      attack: 0.2,
      release: 0.6,
      filterType: 'lowpass',
      frequency: 300,
      q: 0.6
    })
  ]),

  footstep: Object.freeze([
    step('noise', {
      duration: 0.05,
      gain: 0.035,
      attack: 0.005,
      release: 0.06,
      filterType: 'lowpass',
      frequency: 420,
      q: 0.8
    })
  ]),

  enemyShot: Object.freeze(getEnemyShotPlan(8, 'rifleman')),

  headshot: Object.freeze([
    step('tone', {
      type: 'sine',
      frequency: GAME_CONFIG.weapon.audio.headshot.frequency,
      duration: GAME_CONFIG.weapon.audio.headshot.duration,
      gain: GAME_CONFIG.weapon.audio.headshot.gain * MIX_SCALE,
      attack: 0.002,
      release: 0.06
    }),
    step('tone', {
      type: 'triangle',
      frequency: 2400,
      duration: 0.05,
      gain: 0.12,
      attack: 0.001,
      release: 0.04
    })
  ]),

  shellDrop: Object.freeze([
    step('noise', {
      duration: GAME_CONFIG.weapon.audio.shellDrop.duration,
      gain: GAME_CONFIG.weapon.audio.shellDrop.gain * MIX_SCALE,
      attack: 0.001,
      release: 0.03,
      filterType: 'highpass',
      frequency: GAME_CONFIG.weapon.audio.shellDrop.frequency,
      q: 0.7
    }),
    step('tone', {
      type: 'sine',
      frequency: 600,
      endFrequency: 300,
      duration: 0.06,
      gain: 0.05,
      attack: 0.001,
      release: 0.05
    })
  ]),

  wind: Object.freeze([
    step('noise', {
      duration: 1.2,
      gain: 0.02,
      attack: 0.3,
      release: 0.8,
      filterType: 'lowpass',
      frequency: 300,
      q: 0.5
    })
  ]),

  distantFire: Object.freeze([
    step('noise', {
      duration: 0.4,
      gain: 0.04,
      attack: 0.05,
      release: 0.4,
      filterType: 'lowpass',
      frequency: 220,
      q: 0.6
    }),
    step('tone', {
      type: 'sine',
      frequency: 70,
      duration: 0.3,
      gain: 0.03,
      attack: 0.02,
      release: 0.28
    })
  ])
});

/**
 * 返回某个声音的播放计划副本。测试可据此验证参数映射，不需要 AudioContext。
 *
 * @param {string} name
 * @returns {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>}
 */
export function getSoundPlan(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('getSoundPlan 需要非空声音名称');
  }
  if (!Object.prototype.hasOwnProperty.call(SOUND_PLANS, name)) {
    throw new RangeError(
      '未知声音名称: ' + name + '；可用名称: ' + SOUND_NAMES.join('、')
    );
  }
  const plan = SOUND_PLANS[name];
  const copy = [];
  for (const entry of plan) {
    copy.push({
      kind: entry.kind,
      options: Object.assign({}, entry.options)
    });
  }
  return copy;
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampVolume(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * 创建音频编排服务。
 *
 * @param {{engine: import('../../../providers/abstract/audio-engine.js').AudioEngine}} options
 * @returns {import('../abstract/audio.js').AudioService}
 */
export function createAudioService(options) {
  const engine = options.engine;
  let disposed = false;
  let muted = false;
  let masterVolume = GAME_CONFIG.settings.defaults.masterVolume;
  let warnedMissingVolumeSet = false;
  let windTimer = null;
  let fireTimer = null;
  let ambienceRunning = false;

  /**
   * @returns {void}
   */
  function assertAlive() {
    if (disposed) {
      throw new Error('audio 已释放，不能继续使用');
    }
  }

  /**
   * @param {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>} plan
   * @returns {void}
   */
  function playPlan(plan) {
    for (const entry of plan) {
      if (entry.kind === 'tone') {
        engine.tone(entry.options);
      } else if (entry.kind === 'noise') {
        engine.noise(entry.options);
      } else {
        throw new Error('未知声音步骤类型: ' + entry.kind);
      }
    }
  }

  /**
   * @param {string} name
   * @returns {void}
   */
  function play(name) {
    assertAlive();
    playPlan(getSoundPlan(name));
  }

  /**
   * 给分层枪声叠加随机微调，避免每发完全一样。
   *
   * @param {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>} plan
   * @param {number} pitchJitter
   * @param {number} gainJitter
   * @returns {Array<{kind: 'tone'|'noise', options: Record<string, unknown>}>}
   */
  function jitterPlan(plan, pitchJitter, gainJitter) {
    const result = [];
    for (const entry of plan) {
      const options = Object.assign({}, entry.options);
      if (typeof options.frequency === 'number') {
        const pitchFactor = 1 + (Math.random() * 2 - 1) * pitchJitter;
        options.frequency = Math.max(20, options.frequency * pitchFactor);
      }
      if (typeof options.endFrequency === 'number') {
        const pitchFactor = 1 + (Math.random() * 2 - 1) * pitchJitter;
        options.endFrequency = Math.max(20, options.endFrequency * pitchFactor);
      }
      if (typeof options.gain === 'number') {
        const gainFactor = 1 + (Math.random() * 2 - 1) * gainJitter;
        options.gain = Math.min(0.5, Math.max(0.001, options.gain * gainFactor));
      }
      result.push({ kind: entry.kind, options });
    }
    return result;
  }

  /**
   * 把主音量同步给引擎。引擎未提供该方法时只警告一次。
   *
   * @param {number} volume
   * @returns {void}
   */
  function pushMasterVolume(volume) {
    const value = /** @type {Record<string, unknown>} */ (engine);
    if (typeof value.setMasterVolume === 'function') {
      value.setMasterVolume(volume);
      return;
    }
    if (!warnedMissingVolumeSet) {
      warnedMissingVolumeSet = true;
      console.warn('[audio] 音频引擎没有 setMasterVolume()，主音量只保存在编排服务中');
    }
  }

  /**
   * 停止环境音计时器。
   *
   * @returns {void}
   */
  function stopAmbienceTimers() {
    if (windTimer !== null) {
      clearInterval(windTimer);
      windTimer = null;
    }
    if (fireTimer !== null) {
      clearInterval(fireTimer);
      fireTimer = null;
    }
    ambienceRunning = false;
  }

  pushMasterVolume(masterVolume);

  return {
    /**
     * 在用户手势后初始化或恢复 AudioContext。返回引擎给出的上下文状态。
     *
     * @returns {Promise<string>}
     */
    init() {
      assertAlive();
      return engine.init();
    },

    /** @returns {void} */
    shoot() {
      assertAlive();
      const shot = GAME_CONFIG.weapon.audio.shot;
      playPlan(
        jitterPlan(getSoundPlan('shoot'), shot.pitchJitter, shot.gainJitter)
      );
    },

    /** @returns {void} */
    hit() {
      play('hit');
    },

    /** @returns {void} */
    kill() {
      play('kill');
    },

    /** @returns {void} */
    explosion() {
      play('explosion');
    },

    /** @returns {void} */
    hurt() {
      play('hurt');
    },

    /** @returns {void} */
    reload() {
      play('reload');
    },

    /** @returns {void} */
    empty() {
      play('empty');
    },

    /** @returns {void} */
    pickup() {
      play('pickup');
    },

    /** @returns {void} */
    waveStart() {
      play('waveStart');
    },

    /** @returns {void} */
    gameOver() {
      play('gameOver');
    },

    /** @returns {void} */
    footstep() {
      play('footstep');
    },

    /**
     * 敌人枪声：按距离衰减，重机枪手更响、突击兵更轻。
     *
     * @param {number} distance 米。
     * @param {string} [enemyType]
     * @returns {void}
     */
    enemyShot(distance, enemyType) {
      assertAlive();
      let type = 'rifleman';
      if (typeof enemyType === 'string' && enemyType.length > 0) {
        type = enemyType;
      }
      playPlan(
        jitterPlan(getEnemyShotPlan(distance, type), 0.04, 0.04)
      );
    },

    /** @returns {void} */
    headshot() {
      play('headshot');
    },

    /** @returns {void} */
    shellDrop() {
      play('shellDrop');
    },

    /** @returns {void} */
    wind() {
      play('wind');
    },

    /** @returns {void} */
    distantFire() {
      play('distantFire');
    },

    /**
     * 播放一次环境风声；用于装配层自行节流调用。
     *
     * @returns {void}
     */
    ambience() {
      play('wind');
    },

    /**
     * 启动持续环境音：每 4 秒一阵风，每 7 秒有一定概率出现远处交火。
     * 重复调用是幂等空操作；必须先 init() 才有声音。
     *
     * @returns {void}
     */
    startAmbience() {
      assertAlive();
      if (ambienceRunning) {
        return;
      }
      ambienceRunning = true;
      windTimer = setInterval(() => {
        if (!disposed) {
          play('wind');
        }
      }, 4000);
      fireTimer = setInterval(() => {
        if (!disposed && Math.random() < 0.45) {
          play('distantFire');
        }
      }, 7000);
    },

    /**
     * 停止持续环境音。重复调用是幂等空操作。
     *
     * @returns {void}
     */
    stopAmbience() {
      stopAmbienceTimers();
    },

    /**
     * 设置主音量（0–1）。状态同时保存在服务和引擎里；未初始化时引擎只记录状态。
     *
     * @param {number} volume
     * @returns {void}
     */
    setMasterVolume(volume) {
      assertAlive();
      if (typeof volume !== 'number' || !Number.isFinite(volume)) {
        throw new TypeError('setMasterVolume 需要有限数字');
      }
      masterVolume = clampVolume(volume);
      pushMasterVolume(masterVolume);
    },

    /**
     * @returns {number}
     */
    getMasterVolume() {
      return masterVolume;
    },

    /**
     * 静音或恢复主输出。状态保存在引擎里；未初始化时引擎只记录状态。
     *
     * @param {boolean} nextMuted
     * @returns {void}
     */
    setMuted(nextMuted) {
      assertAlive();
      if (typeof nextMuted !== 'boolean') {
        throw new TypeError('setMuted 需要布尔值');
      }
      muted = nextMuted;
      engine.setMuted(nextMuted);
    },

    /**
     * @returns {boolean}
     */
    isMuted() {
      return muted;
    },

    /**
     * 结束音频服务：停止环境音计时器，但不关闭共享 AudioContext。
     *
     * @returns {void}
     */
    dispose() {
      if (disposed) {
        return;
      }
      stopAmbienceTimers();
      disposed = true;
    }
  };
}
