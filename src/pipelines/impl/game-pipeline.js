/**
 * 对局编排：状态机、主循环、服务协作、计分、波次与 HUD。
 *
 * 本文件属于 Pipeline 层，负责把注入的战斗、敌方、环境、效果和音频服务串成
 * 一次完整对局。它不创建也不释放这些服务——装配层（src/main.js）负责构造和
 * 释放；`dispose()` 只退订本文件注册的事件并清空波次计时。
 *
 * 服务事件接线约定（调度记录 §3.4.2）：各服务的 `emit` 直接接到共享事件总线，
 * 因此本文件订阅总线上的结果事件并作出反应，而不调用其他服务的内部实现。
 */

import {
  createInputCommand,
  createEnemyKilledPayload,
  createHudKillfeedPayload,
  createHudHitmarkerPayload,
  createHudDamagePayload,
  createPlayerDamagePayload,
  createPickupCollectedPayload,
  createPickupSpawnPayload,
  createWorldShotPayload,
  createWorldImpactPayload,
  createWorldExplosionPayload,
  createWorldEnemySpawnPayload,
  createWorldEnemyShotPayload,
  createWorldBloodPayload,
  createWeaponShellEjectPayload,
  createSettingsChangedPayload,
  createHudBannerPayload,
  createHudGameoverPayload,
  createHudUpdatePayload,
  createWaveStartPayload,
  createWaveClearedPayload
} from '../../models/contracts.js';
import { EVENTS } from '../../models/events.js';
import { GAME_CONFIG, normalizeSettings } from '../../models/game-config.js';
import {
  createGameStateMachine,
  createMatchAccounting,
  addKillScore,
  advanceSurvivalTime,
  advanceWaveNumber,
  createWaveBanner
} from './game-state.js';

/**
 * @param {unknown} value
 * @param {string} ownerName
 * @returns {Record<string, unknown>}
 */
function assertServiceObject(value, ownerName) {
  if (value === null || value === undefined) {
    throw new TypeError('createGame 缺少 ' + ownerName);
  }
  if (typeof value !== 'object') {
    throw new TypeError('createGame 的 ' + ownerName + ' 必须是对象');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * 校验服务实现了本文件实际调用的公共方法。
 *
 * @param {unknown} value
 * @param {string} ownerName
 * @param {string[]} methods
 * @returns {void}
 */
function assertMethods(value, ownerName, methods) {
  const service = assertServiceObject(value, ownerName);
  for (const method of methods) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(
        'createGame 的 ' + ownerName + ' 缺少方法 ' + method + '()'
      );
    }
  }
}

/**
 * 调用服务公共方法；失败时记录错误并继续，不让单次调用中断主循环。
 *
 * @param {Record<string, unknown>} service
 * @param {string} method
 * @param {unknown[]} args
 * @param {string} label
 * @returns {void}
 */
function invokeService(service, method, args, label) {
  try {
    service[method](...args);
  } catch (error) {
    console.error('[game] ' + label + '失败（' + method + '）', error);
  }
}

/**
 * 调用可选服务方法。其他角色可能尚未实现 v3 的 setter/效果方法，
 * 此时只警告一次并跳过；方法存在但抛错时仍由 `invokeService` 记录错误。
 *
 * @param {Record<string, unknown>} service
 * @param {string} method
 * @param {unknown[]} args
 * @param {string} serviceLabel
 * @param {string} actionLabel
 * @param {Set<string>} warned
 * @returns {boolean} 是否实际调用了方法。
 */
function invokeOptional(service, method, args, serviceLabel, actionLabel, warned) {
  if (typeof service[method] !== 'function') {
    const key = serviceLabel + '.' + method;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        '[game] ' + serviceLabel + ' 尚未提供 ' + method + '()，跳过' + actionLabel
      );
    }
    return false;
  }
  invokeService(service, method, args, actionLabel);
  return true;
}

/**
 * 创建对局编排对象。
 *
 * @param {{
 *   bus: { on: Function, off: Function, emit: Function },
 *   renderer: {
 *     setCameraPose: Function,
 *     setQuality?: Function,
 *     getQuality?: Function,
 *     setPostProcessingEnabled?: Function,
 *     isPostProcessingEnabled?: Function,
 *     getPostProcessingEnabled?: Function
 *   },
 *   arena: { update: Function },
 *   combat: {
 *     reset: Function,
 *     update: Function,
 *     damagePlayer: Function,
 *     heal: Function,
 *     getSnapshot: Function,
 *     getWeaponState: Function,
 *     setViewVisible?: Function,
 *     setSettings?: Function
 *   },
 *   enemies: {
 *     reset: Function,
 *     startWave: Function,
 *     update: Function,
 *     getState: Function
 *   },
 *   effects: {
 *     tracer: Function,
 *     impact: Function,
 *     explosion: Function,
 *     spawn: Function,
 *     update: Function,
 *     clear: Function,
 *     enemyShot?: Function,
 *     muzzleSmoke?: Function,
 *     blood?: Function,
 *     shell?: Function
 *   },
 *   audio: {
 *     shoot: Function,
 *     hit: Function,
 *     kill: Function,
 *     explosion: Function,
 *     hurt: Function,
 *     reload: Function,
 *     empty: Function,
 *     pickup: Function,
 *     waveStart: Function,
 *     gameOver: Function,
 *     setMuted: Function,
 *     isMuted?: Function,
 *     enemyShot?: Function,
 *     headshot?: Function,
 *     shellDrop?: Function,
 *     setMasterVolume?: Function
 *   },
 *   options?: Record<string, unknown>
 * }} options
 * @returns {{
 *   start: () => void,
 *   pause: () => void,
 *   resume: () => void,
 *   restart: () => void,
 *   update: (dt: number) => void,
 *   setInput: (command?: object) => void,
 *   toggleMute: () => void,
 *   applySettings: (partial?: object) => Object,
 *   getSettings: () => Object,
 *   getPerformance: () => Object,
 *   getState: () => 'menu'|'playing'|'paused'|'over',
 *   getSnapshot: () => Object,
 *   dispose: () => void
 * }}
 */
export function createGamePipeline(options) {
  if (options === null || options === undefined || typeof options !== 'object') {
    throw new TypeError(
      'createGame 需要参数对象 { bus, renderer, arena, combat, enemies, effects, audio }'
    );
  }
  const source = /** @type {Record<string, unknown>} */ (options);

  const bus = assertServiceObject(source.bus, 'bus');
  assertMethods(source.bus, 'bus', ['on', 'off', 'emit']);
  assertMethods(source.renderer, 'renderer', ['setCameraPose']);
  assertMethods(source.arena, 'arena', ['update']);
  assertMethods(source.combat, 'combat', [
    'reset',
    'update',
    'damagePlayer',
    'heal',
    'getSnapshot',
    'getWeaponState'
  ]);
  assertMethods(source.enemies, 'enemies', [
    'reset',
    'startWave',
    'update',
    'getState'
  ]);
  assertMethods(source.effects, 'effects', [
    'tracer',
    'impact',
    'explosion',
    'spawn',
    'update',
    'clear'
  ]);
  assertMethods(source.audio, 'audio', [
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
    'setMuted'
  ]);

  if (source.options !== undefined && source.options !== null) {
    if (typeof source.options !== 'object') {
      throw new TypeError('createGame 的 options 必须是对象');
    }
  }

  const renderer = /** @type {Record<string, unknown>} */ (source.renderer);
  const arena = /** @type {Record<string, unknown>} */ (source.arena);
  const combat = /** @type {Record<string, unknown>} */ (source.combat);
  const enemies = /** @type {Record<string, unknown>} */ (source.enemies);
  const effects = /** @type {Record<string, unknown>} */ (source.effects);
  const audio = /** @type {Record<string, unknown>} */ (source.audio);

  const stateMachine = createGameStateMachine();
  let accounting = createMatchAccounting();
  let input = createInputCommand();
  let muted = false;
  let wavePending = false;
  let waveTimer = 0;
  let hudAccumulator = 0;
  let gameOverEmitted = false;
  let menuOrbitAngle = 0;
  let disposed = false;

  // v3：设置、性能仪表与击杀顿帧。
  let settings = normalizeSettings();
  let frameCount = 0;
  let smoothedFps = 0;
  let hitstopRemaining = 0;
  // 转发 player:damage 时，战斗服务会同步发出一次不含方向的 hud:damage；
  // 该标志让这次事件只作为数据来源，不重复播放受伤音效。
  let pendingDamageAudio = false;

  /** @type {Array<() => void>} */
  const unsubscribers = [];
  /** @type {Set<string>} 已警告过的缺失可选方法，避免每个事件刷屏。 */
  const warnedMissingMethods = new Set();

  if (typeof audio.isMuted === 'function') {
    try {
      muted = audio.isMuted() === true;
    } catch (error) {
      console.error('[game] 读取音频静音状态失败', error);
    }
  }

  /**
   * 通过共享总线发事件；总线自身的监听器错误由总线隔离，这里只兜底总线调用失败。
   *
   * @param {string} eventName
   * @param {unknown} payload
   * @returns {void}
   */
  function emitEvent(eventName, payload) {
    try {
      bus.emit(eventName, payload);
    } catch (error) {
      console.error('[game] 发送事件失败 ' + eventName, error);
    }
  }

  /**
   * @returns {'menu'|'playing'|'paused'|'over'}
   */
  function getState() {
    return stateMachine.getState();
  }

  /**
   * 返回冻结的设置副本；调用方修改它不会影响 Pipeline 内部状态。
   *
   * @returns {Readonly<import('../../models/contracts.js').Settings>}
   */
  function getSettings() {
    return Object.freeze({ ...settings });
  }

  /**
   * 把 applySettings 的输入限制为普通对象。
   *
   * @param {unknown} partial
   * @returns {Record<string, unknown>}
   */
  function readSettingsPatch(partial) {
    if (partial === undefined || partial === null) {
      return {};
    }
    if (typeof partial !== 'object' || Array.isArray(partial)) {
      throw new TypeError('applySettings 的参数必须是对象');
    }
    return /** @type {Record<string, unknown>} */ (partial);
  }

  /**
   * 把设置转发给已实现 v3 setter 的服务。其他角色尚未完成时只警告一次，
   * 不影响设置本身保存与事件发布。
   *
   * @param {Readonly<import('../../models/contracts.js').Settings>} next
   * @returns {void}
   */
  function forwardSettings(next) {
    invokeOptional(
      combat,
      'setSettings',
      [
        {
          mouseSensitivity: next.mouseSensitivity,
          adsSensitivityMultiplier: next.adsSensitivityMultiplier,
          fov: next.fov
        }
      ],
      '战斗服务',
      '应用战斗设置',
      warnedMissingMethods
    );

    if (typeof renderer.setQuality === 'function') {
      invokeService(renderer, 'setQuality', [next.quality], '应用画质');
    } else if (typeof renderer.setPostProcessingEnabled === 'function') {
      let enabled = false;
      if (next.quality === 'high') {
        enabled = true;
      }
      invokeService(
        renderer,
        'setPostProcessingEnabled',
        [enabled],
        '应用后处理开关'
      );
    } else {
      invokeOptional(
        renderer,
        'setQuality',
        [next.quality],
        '渲染器',
        '应用画质',
        warnedMissingMethods
      );
    }

    invokeOptional(
      audio,
      'setMasterVolume',
      [next.masterVolume],
      '音频服务',
      '应用主音量',
      warnedMissingMethods
    );
  }

  /**
   * 读取渲染器当前画质；渲染器尚未实现时使用设置中的值。
   *
   * @returns {'high'|'low'}
   */
  function readCurrentQuality() {
    if (typeof renderer.getQuality === 'function') {
      try {
        const value = renderer.getQuality();
        if (value === 'high' || value === 'low') {
          return value;
        }
      } catch (error) {
        console.error('[game] 读取渲染器画质失败', error);
      }
    }
    return settings.quality;
  }

  /**
   * 判断后处理是否开启；优先询问渲染器，否则按画质推导。
   *
   * @param {'high'|'low'} quality
   * @returns {boolean}
   */
  function readPostProcessing(quality) {
    if (typeof renderer.isPostProcessingEnabled === 'function') {
      try {
        return renderer.isPostProcessingEnabled() === true;
      } catch (error) {
        console.error('[game] 读取后处理状态失败', error);
      }
    }
    if (typeof renderer.getPostProcessingEnabled === 'function') {
      try {
        return renderer.getPostProcessingEnabled() === true;
      } catch (error) {
        console.error('[game] 读取后处理状态失败', error);
      }
    }
    return quality === 'high';
  }

  /**
   * 记录一帧用于性能仪表。`deltaSeconds` 使用调用方传入的原始帧时间，
   * 不受业务步长上限影响。
   *
   * @param {number} deltaSeconds
   * @returns {void}
   */
  function recordFrame(deltaSeconds) {
    frameCount += 1;
    if (deltaSeconds <= 0) {
      return;
    }
    const instantFps = 1 / deltaSeconds;
    if (smoothedFps === 0) {
      smoothedFps = instantFps;
      return;
    }
    const alpha = GAME_CONFIG.match.performance.fpsSmoothing;
    smoothedFps += (instantFps - smoothedFps) * alpha;
  }

  /**
   * 返回运行时性能快照。这是仪表数据，不代表经过验收的帧率承诺。
   *
   * @returns {Readonly<import('../../models/contracts.js').PerformanceSnapshot>}
   */
  function getPerformance() {
    const enemyState = readEnemyState();
    let enemyCount = 0;
    if (
      enemyState !== null &&
      typeof enemyState.alive === 'number' &&
      Number.isInteger(enemyState.alive) &&
      enemyState.alive >= 0
    ) {
      enemyCount = enemyState.alive;
    }

    const quality = readCurrentQuality();
    const fps = Math.round(smoothedFps * 100) / 100;
    return Object.freeze({
      fps,
      frameCount,
      enemyCount,
      quality,
      postProcessing: readPostProcessing(quality)
    });
  }

  /**
   * 计算攻击来源相对玩家朝向的角度：0 为正前方，正值在右，负值在左。
   *
   * @param {{ x: number, y: number, z: number }} sourcePosition
   * @param {import('../../models/contracts.js').PlayerSnapshot} player
   * @returns {number} 弧度，范围 -π..π。
   */
  function computeDamageDirection(sourcePosition, player) {
    const dx = sourcePosition.x - player.x;
    const dz = sourcePosition.z - player.z;
    // 与战斗服务的相机约定一致：yaw=0 时朝向 -Z，右手方向为 +X。
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const forwardComponent = dx * forwardX + dz * forwardZ;
    const rightComponent = dx * rightX + dz * rightZ;
    return Math.atan2(rightComponent, forwardComponent);
  }

  /**
   * 计算两点间三维距离（米）。
   *
   * @param {{ x: number, y: number, z: number }} a
   * @param {{ x: number, y: number, z: number }} b
   * @returns {number}
   */
  function computeDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * @returns {import('../../models/contracts.js').PlayerSnapshot | null}
   */
  function readPlayerSnapshot() {
    try {
      return combat.getSnapshot();
    } catch (error) {
      console.error('[game] 读取战斗快照失败', error);
      return null;
    }
  }

  /**
   * @returns {Record<string, unknown> | null}
   */
  function readWeaponState() {
    try {
      return /** @type {Record<string, unknown>} */ (combat.getWeaponState());
    } catch (error) {
      console.error('[game] 读取武器状态失败', error);
      return null;
    }
  }

  /**
   * @returns {Record<string, unknown> | null}
   */
  function readEnemyState() {
    try {
      return /** @type {Record<string, unknown>} */ (enemies.getState());
    } catch (error) {
      console.error('[game] 读取敌方状态失败', error);
      return null;
    }
  }

  function emitGameState() {
    emitEvent(EVENTS.GAME_STATE, { state: getState() });
  }

  /**
   * 发送 HUD 更新。`force` 为真时忽略刷新间隔（状态变化、静音、下一波）。
   *
   * @param {boolean} force
   * @returns {void}
   */
  function emitHudUpdate(force) {
    if (disposed) {
      return;
    }
    const interval = GAME_CONFIG.match.hudUpdateInterval;
    if (force !== true && hudAccumulator < interval) {
      return;
    }
    hudAccumulator = 0;

    const player = readPlayerSnapshot();
    const weapon = readWeaponState();
    if (player === null || weapon === null) {
      return;
    }

    let payload = null;
    try {
      payload = createHudUpdatePayload({
        score: accounting.score,
        wave: accounting.wave,
        kills: accounting.kills,
        health: player.health,
        maxHealth: player.maxHealth,
        ammo: weapon.ammo,
        magazineSize: weapon.magazineSize,
        reloading: weapon.reloading,
        reloadProgress: weapon.reloadProgress,
        yaw: player.yaw,
        muted
      });
    } catch (error) {
      console.error('[game] HUD 载荷无效，跳过本次更新', error);
      return;
    }
    emitEvent(EVENTS.HUD_UPDATE, payload);
  }

  /**
   * 订阅一个总线事件；处理函数抛错时记录，不让它逃出事件派发。
   *
   * @param {string} eventName
   * @param {(payload: unknown) => void} handler
   * @returns {void}
   */
  function subscribe(eventName, handler) {
    const unsubscribe = bus.on(eventName, function handleBusEvent(payload) {
      try {
        handler(payload);
      } catch (error) {
        console.error('[game] 处理事件失败 ' + eventName, error);
      }
    });
    unsubscribers.push(unsubscribe);
  }

  /**
   * 按当前状态切换第一人称武器可见性。
   *
   * - `playing` / `paused`：显示武器。
   * - `menu` / `over`：隐藏武器，避免菜单展示和结算画面被枪模遮挡。
   *
   * 旧版战斗服务没有 `setViewVisible()` 时安全跳过；调用失败会记录错误。
   *
   * @returns {void}
   */
  function applyViewVisibility() {
    if (typeof combat.setViewVisible !== 'function') {
      return;
    }
    const state = getState();
    let visible = false;
    if (
      state === EVENTS.GAME_STATES.PLAYING ||
      state === EVENTS.GAME_STATES.PAUSED
    ) {
      visible = true;
    }
    invokeService(combat, 'setViewVisible', [visible], '切换武器视图可见性');
  }

  /**
   * 玩家死亡结算：只发一次，且只在对局中触发。
   *
   * @returns {void}
   */
  function triggerGameOver() {
    if (disposed || gameOverEmitted) {
      return;
    }
    if (getState() !== EVENTS.GAME_STATES.PLAYING) {
      return;
    }

    gameOverEmitted = true;
    const changed = stateMachine.transition(EVENTS.GAME_STATES.OVER);
    if (changed === false) {
      console.error('[game] 无法从 playing 进入 over 状态');
      return;
    }
    applyViewVisibility();
    emitGameState();

    let payload = null;
    try {
      payload = createHudGameoverPayload({
        score: accounting.score,
        wave: accounting.wave,
        kills: accounting.kills,
        survivedSeconds: accounting.survivedSeconds
      });
    } catch (error) {
      console.error('[game] 结算载荷无效', error);
    }
    if (payload !== null) {
      emitEvent(EVENTS.HUD_GAMEOVER, payload);
    }
    invokeService(audio, 'gameOver', [], '游戏结束音效');
    emitHudUpdate(true);
  }

  /**
   * 重置一局内的全部账本与服务状态。
   *
   * @returns {void}
   */
  function resetMatch() {
    accounting = createMatchAccounting();
    input = createInputCommand();
    wavePending = false;
    waveTimer = 0;
    hudAccumulator = 0;
    gameOverEmitted = false;
    hitstopRemaining = 0;
    pendingDamageAudio = false;
    invokeService(combat, 'reset', [], '重置战斗');
    invokeService(enemies, 'reset', [], '重置敌人');
    invokeService(effects, 'clear', [], '清理效果');
  }

  /**
   * 从任意状态开始或重开一局。
   *
   * @returns {void}
   */
  function beginMatch() {
    if (disposed) {
      return;
    }
    const current = getState();
    if (current !== EVENTS.GAME_STATES.PLAYING) {
      const changed = stateMachine.transition(EVENTS.GAME_STATES.PLAYING);
      if (changed === false) {
        console.error('[game] 无法从 ' + current + ' 进入 playing 状态');
        return;
      }
    }

    resetMatch();
    // reset() 会让武器恢复可见；进入对局后必须再按状态显式显示一次。
    applyViewVisibility();
    invokeService(enemies, 'startWave', [accounting.wave], '开始第一波');
    emitGameState();
    emitEvent(
      EVENTS.WAVE_START,
      createWaveStartPayload({ wave: accounting.wave })
    );
    emitEvent(
      EVENTS.HUD_BANNER,
      createHudBannerPayload(createWaveBanner(accounting.wave))
    );
    invokeService(audio, 'waveStart', [], '波次开始音效');
    emitHudUpdate(true);
  }

  /**
   * 菜单环绕镜头（O3）。只写相机姿态，不推进任何业务状态。
   *
   * @param {number} deltaSeconds
   * @returns {void}
   */
  function updateMenuCamera(deltaSeconds) {
    const camera = GAME_CONFIG.match.menuCamera;
    menuOrbitAngle += camera.orbitSpeed * deltaSeconds;
    const position = {
      x: camera.center.x + Math.cos(menuOrbitAngle) * camera.radius,
      y: camera.center.y + camera.height,
      z: camera.center.z + Math.sin(menuOrbitAngle) * camera.radius
    };
    const toCenterX = camera.center.x - position.x;
    const toCenterZ = camera.center.z - position.z;
    const horizontalDistance = Math.sqrt(
      toCenterX * toCenterX + toCenterZ * toCenterZ
    );
    const yaw = Math.atan2(-toCenterX, -toCenterZ);
    const targetY = camera.center.y + camera.lookAtHeight;
    const pitch = Math.atan2(targetY - position.y, horizontalDistance);

    invokeService(
      renderer,
      'setCameraPose',
      [
        {
          position,
          yaw,
          pitch,
          fov: GAME_CONFIG.match.cameraFov
        }
      ],
      '菜单镜头'
    );
  }

  /**
   * 波次协调：等场上敌人清空后计时 4.5 秒，再开始下一波。
   *
   * @param {number} deltaSeconds
   * @returns {void}
   */
  function coordinateWave(deltaSeconds) {
    const enemyState = readEnemyState();
    if (enemyState === null) {
      return;
    }

    if (wavePending === false && enemyState.waveComplete === true) {
      wavePending = true;
      waveTimer = GAME_CONFIG.waves.waveInterval;
      emitEvent(
        EVENTS.WAVE_CLEARED,
        createWaveClearedPayload({ wave: accounting.wave })
      );
    }

    if (wavePending === false) {
      return;
    }

    waveTimer -= deltaSeconds;
    if (waveTimer > 0) {
      return;
    }

    wavePending = false;
    waveTimer = 0;
    accounting = advanceWaveNumber(accounting);
    invokeService(enemies, 'startWave', [accounting.wave], '开始下一波');
    emitEvent(
      EVENTS.WAVE_START,
      createWaveStartPayload({ wave: accounting.wave })
    );
    emitEvent(
      EVENTS.HUD_BANNER,
      createHudBannerPayload(createWaveBanner(accounting.wave))
    );
    invokeService(audio, 'waveStart', [], '波次开始音效');
    emitHudUpdate(true);
  }

  /**
   * 读取战斗快照并处理死亡。
   *
   * @returns {void}
   */
  function checkDeath() {
    const snapshot = readPlayerSnapshot();
    if (snapshot === null) {
      return;
    }
    if (snapshot.alive === false) {
      triggerGameOver();
    }
  }

  /* ------------------------------------------------------------------------ */
  /* 总线事件处理                                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleEnemyKilled(payload) {
    if (getState() !== EVENTS.GAME_STATES.PLAYING) {
      return;
    }
    const killed = createEnemyKilledPayload(payload);
    accounting = addKillScore(accounting, killed.score);
    emitEvent(
      EVENTS.HUD_KILLFEED,
      createHudKillfeedPayload({
        enemyType: killed.enemyType,
        score: killed.score,
        headshot: killed.headshot,
        critical: killed.critical
      })
    );
    invokeService(audio, 'kill', [], '击杀音效');
    hitstopRemaining = GAME_CONFIG.match.killHitstop;
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handlePlayerDamage(payload) {
    if (getState() !== EVENTS.GAME_STATES.PLAYING) {
      return;
    }
    const damage = createPlayerDamagePayload(payload);
    if (damage.sourcePosition === undefined) {
      invokeService(combat, 'damagePlayer', [damage.amount], '玩家受伤');
      return;
    }

    const player = readPlayerSnapshot();
    if (player === null) {
      invokeService(combat, 'damagePlayer', [damage.amount], '玩家受伤');
      return;
    }

    const direction = computeDamageDirection(damage.sourcePosition, player);
    // 战斗服务在 damagePlayer 内会同步发出一次 hud:damage；
    // 那次事件只用于确认伤害已生效，受伤音效由下面的带方向事件统一播放。
    pendingDamageAudio = true;
    invokeService(combat, 'damagePlayer', [damage.amount], '玩家受伤');
    pendingDamageAudio = false;

    emitEvent(
      EVENTS.HUD_DAMAGE,
      createHudDamagePayload({ amount: damage.amount, direction })
    );
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handlePickupCollected(payload) {
    if (getState() !== EVENTS.GAME_STATES.PLAYING) {
      return;
    }
    const pickup = createPickupCollectedPayload(payload);
    invokeService(combat, 'heal', [pickup.amount], '治疗玩家');
    invokeService(audio, 'pickup', [], '拾取音效');
  }

  /**
   * `hud:damage` 可能来自战斗服务（已应用伤害）或由 Pipeline 在
   * `player:damage` 带来源位置时补充方向。带方向的转发流程用
   * `pendingDamageAudio` 避免同一次受伤播放两次音效。
   *
   * @returns {void}
   */
  function handleHudDamage() {
    if (pendingDamageAudio) {
      return;
    }
    invokeService(audio, 'hurt', [], '受伤音效');
  }

  /**
   * 命中标记：普通命中播放命中音；爆头额外播放专门的强调音。
   *
   * @param {unknown} payload
   * @returns {void}
   */
  function handleHudHitmarker(payload) {
    const hitmarker = createHudHitmarkerPayload(payload);
    invokeService(audio, 'hit', [], '命中音效');
    if (hitmarker.headshot) {
      invokeOptional(
        audio,
        'headshot',
        [],
        '音频服务',
        '爆头音效',
        warnedMissingMethods
      );
    }
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldShot(payload) {
    const shot = createWorldShotPayload(payload);
    invokeService(effects, 'tracer', [shot.from, shot.to, shot.color], '弹道效果');
    invokeService(audio, 'shoot', [], '射击音效');
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldImpact(payload) {
    const impact = createWorldImpactPayload(payload);
    invokeService(
      effects,
      'impact',
      [impact.position, impact.normal, impact.color],
      '命中效果'
    );
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldExplosion(payload) {
    const explosion = createWorldExplosionPayload(payload);
    invokeService(
      effects,
      'explosion',
      [explosion.position, explosion.color, explosion.scale],
      '爆炸效果'
    );
    invokeService(audio, 'explosion', [], '爆炸音效');
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldEnemySpawn(payload) {
    const spawn = createWorldEnemySpawnPayload(payload);
    invokeService(effects, 'spawn', [spawn.position, spawn.color], '敌人生成效果');
  }

  /**
   * 敌方开火：优先使用专用的 `effects.enemyShot`，否则退回 `muzzleSmoke`；
   * 音频侧按敌人与玩家的距离播放 `audio.enemyShot(distance, enemyType)`。
   *
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldEnemyShot(payload) {
    const shot = createWorldEnemyShotPayload(payload);
    const effectsHandled = invokeOptional(
      effects,
      'enemyShot',
      [shot.position, shot.direction, shot.color],
      '效果服务',
      '敌人枪口效果',
      warnedMissingMethods
    );
    if (!effectsHandled) {
      invokeOptional(
        effects,
        'muzzleSmoke',
        [shot.position, shot.direction],
        '效果服务',
        '敌人枪口烟雾',
        warnedMissingMethods
      );
    }

    const player = readPlayerSnapshot();
    let distance = 0;
    if (player !== null) {
      distance = computeDistance(player, shot.position);
    }
    invokeOptional(
      audio,
      'enemyShot',
      [distance, shot.enemyType],
      '音频服务',
      '敌人枪声',
      warnedMissingMethods
    );
  }

  /**
   * 命中敌人产生的血雾。
   *
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWorldBlood(payload) {
    const blood = createWorldBloodPayload(payload);
    invokeOptional(
      effects,
      'blood',
      [blood.position, blood.direction, blood.color],
      '效果服务',
      '血雾效果',
      warnedMissingMethods
    );
  }

  /**
   * 弹壳抛出：效果与落地音效各自可选。
   *
   * @param {unknown} payload
   * @returns {void}
   */
  function handleWeaponShellEject(payload) {
    const shell = createWeaponShellEjectPayload(payload);
    invokeOptional(
      effects,
      'shell',
      [shell.position, shell.velocity],
      '效果服务',
      '抛壳效果',
      warnedMissingMethods
    );
    invokeOptional(
      audio,
      'shellDrop',
      [],
      '音频服务',
      '弹壳落地音效',
      warnedMissingMethods
    );
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handlePickupSpawn(payload) {
    const spawn = createPickupSpawnPayload(payload);
    invokeService(effects, 'spawn', [spawn.position], '拾取物生成效果');
  }

  /**
   * @returns {void}
   */
  function handleReloadStart() {
    invokeService(audio, 'reload', [], '换弹音效');
  }

  /**
   * @returns {void}
   */
  function handleWeaponEmpty() {
    invokeService(audio, 'empty', [], '空仓音效');
  }

  /**
   * @returns {void}
   */
  function handlePlayerDied() {
    const snapshot = readPlayerSnapshot();
    if (snapshot === null) {
      triggerGameOver();
      return;
    }
    if (snapshot.alive === false) {
      triggerGameOver();
    }
  }

  subscribe(EVENTS.ENEMY_KILLED, handleEnemyKilled);
  subscribe(EVENTS.PLAYER_DAMAGE, handlePlayerDamage);
  subscribe(EVENTS.PICKUP_COLLECTED, handlePickupCollected);
  subscribe(EVENTS.HUD_DAMAGE, handleHudDamage);
  subscribe(EVENTS.HUD_HITMARKER, handleHudHitmarker);
  subscribe(EVENTS.WORLD_SHOT, handleWorldShot);
  subscribe(EVENTS.WORLD_IMPACT, handleWorldImpact);
  subscribe(EVENTS.WORLD_EXPLOSION, handleWorldExplosion);
  subscribe(EVENTS.WORLD_ENEMY_SPAWN, handleWorldEnemySpawn);
  subscribe(EVENTS.WORLD_ENEMY_SHOT, handleWorldEnemyShot);
  subscribe(EVENTS.WORLD_BLOOD, handleWorldBlood);
  subscribe(EVENTS.PICKUP_SPAWN, handlePickupSpawn);
  subscribe(EVENTS.WEAPON_RELOAD_START, handleReloadStart);
  subscribe(EVENTS.WEAPON_EMPTY, handleWeaponEmpty);
  subscribe(EVENTS.WEAPON_SHELL_EJECT, handleWeaponShellEject);
  subscribe(EVENTS.PLAYER_DIED, handlePlayerDied);

  // 初始状态是 menu：先隐藏第一人称武器，避免它在菜单场景里出现。
  applyViewVisibility();

  /* ------------------------------------------------------------------------ */
  /* 公共方法                                                                  */
  /* ------------------------------------------------------------------------ */

  /**
   * 从菜单开始一局；其他状态调用无效。
   *
   * @returns {void}
   */
  function start() {
    if (disposed) {
      return;
    }
    if (getState() !== EVENTS.GAME_STATES.MENU) {
      return;
    }
    beginMatch();
  }

  /**
   * 暂停：只允许从 playing 进入。
   *
   * @returns {void}
   */
  function pause() {
    if (disposed || getState() !== EVENTS.GAME_STATES.PLAYING) {
      return;
    }
    const changed = stateMachine.transition(EVENTS.GAME_STATES.PAUSED);
    if (changed === false) {
      console.error('[game] 无法从 playing 进入 paused 状态');
      return;
    }
    applyViewVisibility();
    emitGameState();
    emitHudUpdate(true);
  }

  /**
   * 继续：只允许从 paused 进入。
   *
   * @returns {void}
   */
  function resume() {
    if (disposed || getState() !== EVENTS.GAME_STATES.PAUSED) {
      return;
    }
    const changed = stateMachine.transition(EVENTS.GAME_STATES.PLAYING);
    if (changed === false) {
      console.error('[game] 无法从 paused 进入 playing 状态');
      return;
    }
    applyViewVisibility();
    emitGameState();
    emitHudUpdate(true);
  }

  /**
   * 重开：从 paused/over 或 playing 完全重置；从 menu 等同开始。
   *
   * @returns {void}
   */
  function restart() {
    if (disposed) {
      return;
    }
    beginMatch();
  }

  /**
   * 推进对局。菜单中只更新环绕镜头；暂停与结算中不推进业务时间。
   *
   * @param {number} deltaSeconds
   * @returns {void}
   */
  function update(deltaSeconds) {
    if (disposed) {
      return;
    }
    if (
      typeof deltaSeconds !== 'number' ||
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds < 0
    ) {
      throw new RangeError('game.update 的 deltaSeconds 必须是大于等于 0 的有限数字');
    }
    recordFrame(deltaSeconds);
    const step = Math.min(deltaSeconds, GAME_CONFIG.match.deltaClamp);
    const state = getState();

    if (state === EVENTS.GAME_STATES.MENU) {
      updateMenuCamera(step);
      return;
    }

    if (state === EVENTS.GAME_STATES.PLAYING) {
      // 击杀顿帧：短暂冻结业务推进，但保留渲染与仪表采样。
      // 暂停时不会进入此分支，因此顿帧计时也会冻结。
      if (hitstopRemaining > 0) {
        hitstopRemaining -= step;
        if (hitstopRemaining < 0) {
          hitstopRemaining = 0;
        }
        return;
      }

      accounting = advanceSurvivalTime(accounting, step);
      hudAccumulator += step;

      invokeService(combat, 'update', [step, input], '战斗更新');

      // combat.update 可能同步发出 player:died，使状态已经变为 over。
      if (getState() !== EVENTS.GAME_STATES.PLAYING) {
        return;
      }

      const playerSnapshot = readPlayerSnapshot();
      if (playerSnapshot !== null) {
        invokeService(enemies, 'update', [step, playerSnapshot], '敌人更新');
      }
      invokeService(effects, 'update', [step], '效果更新');
      invokeService(arena, 'update', [step], '竞技场更新');
      coordinateWave(step);
      checkDeath();
      emitHudUpdate(false);
      return;
    }

    if (state === EVENTS.GAME_STATES.PAUSED || state === EVENTS.GAME_STATES.OVER) {
      hudAccumulator += step;
      emitHudUpdate(false);
    }
  }

  /**
   * 写入当前帧输入；缺省字段按 Model 的安全默认值补齐。
   *
   * @param {Partial<import('../../models/contracts.js').InputCommand>} [command]
   * @returns {void}
   */
  function setInput(command) {
    if (disposed) {
      return;
    }
    input = createInputCommand(command);
  }

  /**
   * 切换静音并立即刷新 HUD。
   *
   * @returns {void}
   */
  function toggleMute() {
    if (disposed) {
      return;
    }
    muted = muted === false;
    invokeService(audio, 'setMuted', [muted], '设置静音');
    emitHudUpdate(true);
  }

  /**
   * 合并应用部分设置：校验/夹紧、保存、转发给服务并发出
   * `settings:changed`。返回应用后的冻结设置副本。
   *
   * @param {Partial<import('../../models/contracts.js').Settings>} [partial]
   * @returns {Readonly<import('../../models/contracts.js').Settings>}
   */
  function applySettings(partial) {
    if (disposed) {
      return getSettings();
    }
    const patch = readSettingsPatch(partial);
    settings = normalizeSettings(Object.assign({}, settings, patch));
    forwardSettings(settings);
    emitEvent(
      EVENTS.SETTINGS_CHANGED,
      createSettingsChangedPayload({ settings })
    );
    return getSettings();
  }

  /**
   * 返回只读对局快照（O4 自动化测试钩子使用）。
   *
   * @returns {{
   *   state: 'menu'|'playing'|'paused'|'over',
   *   player: import('../../models/contracts.js').PlayerSnapshot,
   *   weapon: Object,
   *   score: number,
   *   wave: number,
   *   kills: number,
   *   survivedSeconds: number,
   *   enemies: Object,
   *   muted: boolean,
   *   settings: import('../../models/contracts.js').Settings,
   *   performance: import('../../models/contracts.js').PerformanceSnapshot
   * }}
   */
  function getSnapshot() {
    return Object.freeze({
      state: getState(),
      player: combat.getSnapshot(),
      weapon: combat.getWeaponState(),
      score: accounting.score,
      wave: accounting.wave,
      kills: accounting.kills,
      survivedSeconds: accounting.survivedSeconds,
      enemies: enemies.getState(),
      muted,
      settings: getSettings(),
      performance: getPerformance()
    });
  }

  /**
   * 退订所有总线处理函数并清空波次计时。不释放注入的服务。
   *
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch (error) {
        console.error('[game] 退订事件失败', error);
      }
    }
    unsubscribers.length = 0;
    wavePending = false;
    waveTimer = 0;
  }

  return {
    start,
    pause,
    resume,
    restart,
    update,
    setInput,
    toggleMute,
    applySettings,
    getSettings,
    getPerformance,
    getState,
    getSnapshot,
    dispose
  };
}
