/**
 * 对局状态机与计分账本的纯逻辑。
 *
 * 本文件不导入任何运行层，也不访问渲染、音频、DOM 或服务；它只回答两个问题：
 * 1. 当前对局状态允许进入哪个状态；
 * 2. 得分、击杀、波次和存活时间在每一次变化后应该是什么。
 *
 * Pipeline 的编排文件（game-pipeline.js）持有这里返回的状态，并把状态变化翻译成事件。
 */

import { EVENTS, isGameState } from '../../models/events.js';
import { GAME_CONFIG } from '../../models/game-config.js';

/** 波次横幅的显示时长（毫秒）；设计未单列，按 Pipeline 契约固定为 2200。 */
export const WAVE_BANNER_DURATION_MS = 2200;

/**
 * 允许的状态迁移。
 *
 * - `menu` 只能开始对局。
 * - `playing` 可以暂停或死亡结算。
 * - `paused` 只能继续（或由重开命令回到 playing）。
 * - `over` 只能重开。
 *
 * @type {Readonly<Record<'menu'|'playing'|'paused'|'over', ReadonlyArray<'menu'|'playing'|'paused'|'over'>>>}
 */
const GAME_STATE_TRANSITIONS = Object.freeze({
  menu: Object.freeze([EVENTS.GAME_STATES.PLAYING]),
  playing: Object.freeze([EVENTS.GAME_STATES.PAUSED, EVENTS.GAME_STATES.OVER]),
  paused: Object.freeze([EVENTS.GAME_STATES.PLAYING]),
  over: Object.freeze([EVENTS.GAME_STATES.PLAYING])
});

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
function assertNonNegativeNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(fieldName + ' 必须是大于等于 0 的有限数字');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
function assertNonNegativeInteger(value, fieldName) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(fieldName + ' 必须是大于等于 0 的整数');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
function assertPositiveInteger(value, fieldName) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(fieldName + ' 必须是大于等于 1 的整数');
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {Record<string, unknown>}
 */
function assertAccountingObject(value, fieldName) {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(fieldName + ' 必须是计分账本对象');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * 返回某个状态允许进入的目标状态（新数组，调用方不能改内部表）。
 *
 * @param {'menu'|'playing'|'paused'|'over'} state
 * @returns {Array<'menu'|'playing'|'paused'|'over'>}
 */
export function getAllowedTransitions(state) {
  if (!isGameState(state)) {
    throw new TypeError('state 必须是 EVENTS.GAME_STATES 中的值');
  }
  return GAME_STATE_TRANSITIONS[state].slice();
}

/**
 * 创建纯状态机。状态只通过 `transition()` 改变；非法迁移返回 `false` 且保持原状态。
 *
 * @param {'menu'|'playing'|'paused'|'over'} [initialState] 缺省为 `menu`。
 * @returns {{
 *   getState: () => 'menu'|'playing'|'paused'|'over',
 *   canTransition: (next: 'menu'|'playing'|'paused'|'over') => boolean,
 *   transition: (next: 'menu'|'playing'|'paused'|'over') => boolean,
 *   getAllowedTransitions: () => Array<'menu'|'playing'|'paused'|'over'>
 * }}
 */
export function createGameStateMachine(initialState) {
  let current = EVENTS.GAME_STATES.MENU;
  if (initialState !== undefined) {
    if (!isGameState(initialState)) {
      throw new TypeError('初始 state 必须是 EVENTS.GAME_STATES 中的值');
    }
    current = /** @type {'menu'|'playing'|'paused'|'over'} */ (initialState);
  }

  /**
   * @param {unknown} next
   * @returns {boolean}
   */
  function canTransition(next) {
    if (!isGameState(next)) {
      return false;
    }
    return GAME_STATE_TRANSITIONS[current].includes(
      /** @type {'menu'|'playing'|'paused'|'over'} */ (next)
    );
  }

  /**
   * @param {unknown} next
   * @returns {boolean}
   */
  function transition(next) {
    if (!isGameState(next)) {
      throw new TypeError('目标 state 必须是 EVENTS.GAME_STATES 中的值');
    }
    if (!canTransition(next)) {
      return false;
    }
    current = /** @type {'menu'|'playing'|'paused'|'over'} */ (next);
    return true;
  }

  return Object.freeze({
    getState() {
      return current;
    },
    canTransition,
    transition,
    getAllowedTransitions() {
      return getAllowedTransitions(current);
    }
  });
}

/**
 * 创建一局开始时的计分账本。
 *
 * @param {Partial<{score:number, kills:number, wave:number, survivedSeconds:number}>} [overrides]
 * @returns {{score:number, kills:number, wave:number, survivedSeconds:number}}
 */
export function createMatchAccounting(overrides) {
  let source = {};
  if (overrides !== undefined && overrides !== null) {
    source = assertAccountingObject(overrides, 'overrides');
  }

  let score = GAME_CONFIG.match.initialScore;
  if (Object.prototype.hasOwnProperty.call(source, 'score')) {
    score = assertNonNegativeInteger(source.score, 'score');
  }

  let kills = GAME_CONFIG.match.initialKills;
  if (Object.prototype.hasOwnProperty.call(source, 'kills')) {
    kills = assertNonNegativeInteger(source.kills, 'kills');
  }

  let wave = GAME_CONFIG.match.initialWave;
  if (Object.prototype.hasOwnProperty.call(source, 'wave')) {
    wave = assertPositiveInteger(source.wave, 'wave');
  }

  let survivedSeconds = 0;
  if (Object.prototype.hasOwnProperty.call(source, 'survivedSeconds')) {
    survivedSeconds = assertNonNegativeNumber(source.survivedSeconds, 'survivedSeconds');
  }

  return { score, kills, wave, survivedSeconds };
}

/**
 * 记一次击杀：累加得分并让击杀数加一，返回新的账本。
 *
 * @param {{score:number, kills:number, wave:number, survivedSeconds:number}} accounting
 * @param {number} score
 * @returns {{score:number, kills:number, wave:number, survivedSeconds:number}}
 */
export function addKillScore(accounting, score) {
  const source = assertAccountingObject(accounting, 'accounting');
  const gained = assertNonNegativeInteger(score, 'score');
  return {
    score: assertNonNegativeInteger(source.score, 'accounting.score') + gained,
    kills: assertNonNegativeInteger(source.kills, 'accounting.kills') + 1,
    wave: assertPositiveInteger(source.wave, 'accounting.wave'),
    survivedSeconds: assertNonNegativeNumber(
      source.survivedSeconds,
      'accounting.survivedSeconds'
    )
  };
}

/**
 * 增加存活时间，返回新的账本。
 *
 * @param {{score:number, kills:number, wave:number, survivedSeconds:number}} accounting
 * @param {number} deltaSeconds
 * @returns {{score:number, kills:number, wave:number, survivedSeconds:number}}
 */
export function advanceSurvivalTime(accounting, deltaSeconds) {
  const source = assertAccountingObject(accounting, 'accounting');
  const delta = assertNonNegativeNumber(deltaSeconds, 'deltaSeconds');
  return {
    score: assertNonNegativeInteger(source.score, 'accounting.score'),
    kills: assertNonNegativeInteger(source.kills, 'accounting.kills'),
    wave: assertPositiveInteger(source.wave, 'accounting.wave'),
    survivedSeconds:
      assertNonNegativeNumber(source.survivedSeconds, 'accounting.survivedSeconds') + delta
  };
}

/**
 * 进入下一波，返回新的账本。
 *
 * @param {{score:number, kills:number, wave:number, survivedSeconds:number}} accounting
 * @returns {{score:number, kills:number, wave:number, survivedSeconds:number}}
 */
export function advanceWaveNumber(accounting) {
  const source = assertAccountingObject(accounting, 'accounting');
  return {
    score: assertNonNegativeInteger(source.score, 'accounting.score'),
    kills: assertNonNegativeInteger(source.kills, 'accounting.kills'),
    wave: assertPositiveInteger(source.wave, 'accounting.wave') + 1,
    survivedSeconds: assertNonNegativeNumber(
      source.survivedSeconds,
      'accounting.survivedSeconds'
    )
  };
}

/**
 * 生成波次开始的 HUD 横幅载荷。
 *
 * @param {number} wave
 * @returns {{title:string, subtitle:string, durationMs:number}}
 */
export function createWaveBanner(wave) {
  const value = assertPositiveInteger(wave, 'wave');
  return {
    title: '第 ' + value + ' 波',
    subtitle: '敌人来袭',
    durationMs: WAVE_BANNER_DURATION_MS
  };
}
