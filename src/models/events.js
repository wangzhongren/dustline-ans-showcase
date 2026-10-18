/**
 * 跨角色共享事件名与对局状态常量。
 *
 * 所有层（界面、Pipeline、Service、Provider）都必须从这里取事件名，
 * 不允许在各自代码里直接写 `'hud:update'` 之类的字符串。
 *
 * 事件由 Pipeline 通过共享事件总线发出；消费方（界面、效果、音频）只订阅，
 * 不反向修改 Pipeline 状态。事件载荷的类型见 `contracts.js`。
 */

/**
 * @typedef {'menu'|'playing'|'paused'|'over'} GameStateName
 */

/** @type {Readonly<Record<string, string | Readonly<Record<string, string>>>>} */
export const EVENTS = Object.freeze({
  // 对局与 HUD
  GAME_STATE: 'game:state',
  HUD_UPDATE: 'hud:update',
  HUD_HITMARKER: 'hud:hitmarker',
  HUD_KILLFEED: 'hud:killfeed',
  HUD_DAMAGE: 'hud:damage',
  HUD_BANNER: 'hud:banner',
  HUD_GAMEOVER: 'hud:gameover',

  // 世界与战斗结果
  WORLD_SHOT: 'world:shot',
  WORLD_IMPACT: 'world:impact',
  WORLD_EXPLOSION: 'world:explosion',
  WORLD_ENEMY_SPAWN: 'world:enemy-spawn',
  WORLD_ENEMY_SHOT: 'world:enemy-shot',
  WORLD_BLOOD: 'world:blood',
  PLAYER_DAMAGE: 'player:damage',
  PLAYER_DIED: 'player:died',
  ENEMY_KILLED: 'enemy:killed',

  // 武器
  WEAPON_RELOAD_START: 'weapon:reload-start',
  WEAPON_RELOAD_END: 'weapon:reload-end',
  WEAPON_EMPTY: 'weapon:empty',
  WEAPON_SHELL_EJECT: 'weapon:shell-eject',

  // 设置
  SETTINGS_CHANGED: 'settings:changed',

  // 波次与拾取
  WAVE_START: 'wave:start',
  WAVE_CLEARED: 'wave:cleared',
  PICKUP_SPAWN: 'pickup:spawn',
  PICKUP_COLLECTED: 'pickup:collected',

  // 对局状态值（用于 `game:state` 的 payload.state）
  GAME_STATES: Object.freeze({
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    OVER: 'over'
  })
});

/** 只包含事件名字符串的冻结列表，用于成员检查。 */
const EVENT_NAMES = Object.freeze(
  Object.keys(EVENTS)
    .filter((key) => typeof EVENTS[key] === 'string')
    .map((key) => EVENTS[key])
);

/** 对局状态值列表。 */
const GAME_STATE_NAMES = Object.freeze(Object.values(EVENTS.GAME_STATES));

/**
 * 判断一个字符串是否是项目已登记的事件名。
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isKnownEvent(name) {
  return EVENT_NAMES.includes(name);
}

/**
 * 判断一个值是否是对局状态值。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGameState(value) {
  return GAME_STATE_NAMES.includes(value);
}
