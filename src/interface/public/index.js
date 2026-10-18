/**
 * 界面层公共入口。
 *
 * 装配入口只从这里创建界面。界面只调用 Pipeline 公共入口（通过注入的 `game`），
 * 订阅共享事件总线，并读取 Model；不导入任何 Service、Provider 或其他层的 impl。
 *
 * 返回的界面句柄负责：
 * - 每帧把输入命令写入 Pipeline（`syncInput()`）；
 * - 菜单/暂停/结算按钮操作；
 * - 指针锁定与 F11 全屏；
 * - `getHud()` 只读展示状态，供 O4 测试钩子使用。
 */

import { EVENTS } from '../../models/events.js';

import { createHud } from '../impl/hud.js';
import { createInput } from '../impl/input.js';
import { createSettings, createSettingsPanel } from '../impl/settings.js';

export { createSettings, SETTINGS_STORAGE_KEY } from '../impl/settings.js';

/**
 * 调用装配层注入的用户手势回调（音频初始化）。
 *
 * @param {(() => unknown) | undefined} onUserGesture
 * @returns {void}
 */
function notifyUserGesture(onUserGesture) {
  if (typeof onUserGesture !== 'function') {
    return;
  }
  try {
    const result = onUserGesture();
    if (result !== null && result !== undefined && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error('interface: 用户手势回调失败', error);
      });
    }
  } catch (error) {
    console.error('interface: 用户手势回调失败', error);
  }
}

/**
 * 切换浏览器全屏。F11 由界面输入调用，Electron 主进程不重复处理。
 *
 * @returns {void}
 */
function toggleFullscreen() {
  try {
    if (document.fullscreenElement !== null) {
      const result = document.exitFullscreen();
      if (result !== null && result !== undefined && typeof result.catch === 'function') {
        result.catch((error) => {
          console.error('interface: 退出全屏失败', error);
        });
      }
      return;
    }

    const result = document.documentElement.requestFullscreen();
    if (result !== null && result !== undefined && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error('interface: 进入全屏失败', error);
      });
    }
  } catch (error) {
    console.error('interface: 切换全屏失败', error);
  }
}

/**
 * 创建界面。
 *
 * @param {{
 *   bus: { on: Function, off: Function, emit: Function },
 *   game: {
 *     start: () => void,
 *     pause: () => void,
 *     resume: () => void,
 *     restart: () => void,
 *     setInput: (command?: Object) => void,
 *     toggleMute: () => void,
 *     getState: () => string,
 *     applySettings: (partial?: Object) => Object,
 *     getSettings: () => Object
 *   },
 *   canvas: HTMLCanvasElement,
 *   testMode?: boolean,
 *   settings?: ReturnType<typeof createSettings>,
 *   onUserGesture?: () => unknown
 * }} options
 * @returns {{
 *   getHud: () => Object,
 *   syncInput: () => void,
 *   requestPointerLock: () => void,
 *   releasePointerLock: () => void,
 *   setLoading: (visible: boolean, message?: string) => void,
 *   dispose: () => void
 * }}
 */
export function createInterface(options) {
  if (options === null || options === undefined || typeof options !== 'object') {
    throw new TypeError('createInterface 需要参数对象 { bus, game, canvas }');
  }

  const bus = options.bus;
  if (bus === null || bus === undefined || typeof bus.on !== 'function') {
    throw new TypeError('createInterface 缺少共享事件总线 bus.on');
  }

  const game = options.game;
  if (game === null || game === undefined || typeof game !== 'object') {
    throw new TypeError('createInterface 缺少 game（Pipeline 公共入口）');
  }
  const requiredMethods = [
    'start',
    'pause',
    'resume',
    'restart',
    'setInput',
    'toggleMute',
    'getState',
    'applySettings',
    'getSettings'
  ];
  for (const method of requiredMethods) {
    if (typeof game[method] !== 'function') {
      throw new TypeError('createInterface 的 game 缺少方法 ' + method + '()');
    }
  }

  const canvas = options.canvas;
  if (canvas === null || canvas === undefined) {
    throw new TypeError('createInterface 缺少 canvas');
  }

  if (options.testMode !== undefined) {
    if (typeof options.testMode !== 'boolean') {
      throw new TypeError('createInterface 的 testMode 必须是布尔值');
    }
  }
  // testMode 只决定装配入口是否暴露只读测试钩子；界面本身不读取它。

  let onUserGesture = undefined;
  if (options.onUserGesture !== undefined) {
    if (typeof options.onUserGesture !== 'function') {
      throw new TypeError('createInterface 的 onUserGesture 必须是函数');
    }
    onUserGesture = options.onUserGesture;
  }

  let settingsStore = options.settings;
  if (settingsStore === undefined || settingsStore === null) {
    if (typeof window === 'undefined' || window.localStorage === undefined) {
      throw new Error('createInterface 缺少 settings，且当前环境没有 localStorage');
    }
    settingsStore = createSettings({ storage: window.localStorage });
  }
  if (typeof settingsStore !== 'object') {
    throw new TypeError('createInterface 的 settings 必须是 createSettings() 返回值');
  }
  const settingsMethods = ['get', 'save', 'reset', 'getRanges'];
  for (const method of settingsMethods) {
    if (typeof settingsStore[method] !== 'function') {
      throw new TypeError('createInterface 的 settings 缺少方法 ' + method + '()');
    }
  }

  /** @type {ReturnType<typeof createInput> | null} */
  let input = null;
  /** @type {ReturnType<typeof createHud> | null} */
  let hud = null;
  /** @type {ReturnType<typeof createSettingsPanel> | null} */
  let settingsPanel = null;

  try {
    input = createInput({
      canvas,
      game,
      callbacks: {
        onPause() {
          game.pause();
        },
        onMute() {
          game.toggleMute();
        },
        onFullscreen() {
          toggleFullscreen();
        },
        onBlockedEscape() {
          if (settingsPanel !== null) {
            settingsPanel.close();
          }
        },
        isBlocked() {
          if (settingsPanel === null) {
            return false;
          }
          return settingsPanel.isVisible();
        }
      }
    });

    settingsPanel = createSettingsPanel({
      settings: settingsStore,
      game,
      onVisibilityChange(visible) {
        if (visible === false) {
          return;
        }
        input.clearPending();
        input.releasePointerLock();
      }
    });

    hud = createHud({
      bus,
      settingsPanel,
      callbacks: {
        onStart() {
          input.requestPointerLock();
          notifyUserGesture(onUserGesture);
          game.start();
        },
        onResume() {
          input.requestPointerLock();
          notifyUserGesture(onUserGesture);
          game.resume();
        },
        onRestart() {
          input.requestPointerLock();
          notifyUserGesture(onUserGesture);
          game.restart();
        }
      }
    });
  } catch (error) {
    console.error('interface: 创建界面失败', error);
    if (settingsPanel !== null) {
      settingsPanel.dispose();
    }
    if (input !== null) {
      input.dispose();
    }
    if (hud !== null) {
      hud.dispose();
    }
    throw error;
  }

  /**
   * 非对局状态主动释放指针锁定，让玩家能点击暂停/结算按钮。
   *
   * @param {unknown} payload
   * @returns {void}
   */
  function handleGameState(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('interface: game:state 载荷无效');
      return;
    }
    const source = /** @type {Record<string, unknown>} */ (payload);
    const state = source.state;
    if (typeof state !== 'string') {
      console.error('interface: game:state 缺少字符串 state');
      return;
    }
    if (state !== 'playing') {
      input.releasePointerLock();
    }
  }

  const unsubscribeState = bus.on(EVENTS.GAME_STATE, handleGameState);

  return {
    getHud() {
      return hud.getHud();
    },

    /**
     * 每帧调用：读取并消费输入，同时更新准星展示状态。
     *
     * @returns {void}
     */
    syncInput() {
      const command = input.readCommand();
      const isMoving =
        command.moveForward !== 0 || command.moveRight !== 0;
      hud.setAimState(command.aim);
      hud.setMoving(isMoving);
      game.setInput(command);
    },

    requestPointerLock() {
      input.requestPointerLock();
    },

    releasePointerLock() {
      input.releasePointerLock();
    },

    setLoading(visible, message) {
      hud.setLoading(visible, message);
    },

    dispose() {
      try {
        unsubscribeState();
      } catch (error) {
        console.error('interface: 退订 game:state 失败', error);
      }
      if (settingsPanel !== null) {
        settingsPanel.dispose();
      }
      input.dispose();
      hud.dispose();
    }
  };
}
