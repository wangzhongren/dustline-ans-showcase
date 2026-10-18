/**
 * Pipeline 公共入口。
 *
 * 界面装配只从这里导入 `createGame`，不直接接触 `src/pipelines/impl/`。
 * 返回值契约见 `docs/scheduling/neon-strike-delivery.md` §3.5。
 */

import { createGamePipeline } from '../impl/game-pipeline.js';

/**
 * 创建一次对局的编排对象。
 *
 * @param {{
 *   bus: { on: Function, off: Function, emit: Function },
 *   renderer: Object,
 *   arena: Object,
 *   combat: Object,
 *   enemies: Object,
 *   effects: Object,
 *   audio: Object,
 *   options?: Object
 * }} options
 * @returns {{
 *   start: () => void,
 *   pause: () => void,
 *   resume: () => void,
 *   restart: () => void,
 *   update: (dt: number) => void,
 *   setInput: (command?: Object) => void,
 *   toggleMute: () => void,
 *   applySettings: (partial?: Object) => Object,
 *   getSettings: () => Object,
 *   getPerformance: () => Object,
 *   getState: () => 'menu'|'playing'|'paused'|'over',
 *   getSnapshot: () => Object,
 *   dispose: () => void
 * }}
 */
export function createGame(options) {
  return createGamePipeline(options);
}
