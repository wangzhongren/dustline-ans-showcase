/**
 * 键鼠输入适配。
 *
 * 负责把浏览器键盘/鼠标事件转换成 Model 中的 `InputCommand`，并处理指针锁定、
 * ESC 释放导致暂停、窗口失焦暂停、F11 全屏与 M 静音回调。这里不实现任何游戏规则；
 * 战斗服务只消费每帧由界面读取的输入命令。
 */

import { createInputCommand } from '../../models/contracts.js';

/**
 * 两个方向键同时按下时相互抵消，否则返回 -1 / 0 / 1。
 *
 * @param {boolean} positive
 * @param {boolean} negative
 * @returns {-1|0|1}
 */
function readAxis(positive, negative) {
  if (positive && !negative) {
    return 1;
  }
  if (negative && !positive) {
    return -1;
  }
  return 0;
}

/**
 * 创建输入适配器。
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   game: {
 *     getState: () => string,
 *     pause: () => void,
 *     toggleMute: () => void
 *   },
 *   callbacks?: {
 *     onPause?: () => void,
 *     onMute?: () => void,
 *     onFullscreen?: () => void,
 *     onBlockedEscape?: () => void,
 *     isBlocked?: () => boolean
 *   }
 * }} options
 * @returns {{
 *   readCommand: () => import('../../models/contracts.js').InputCommand,
 *   requestPointerLock: () => void,
 *   releasePointerLock: () => void,
 *   isPointerLocked: () => boolean,
 *   clearPending: () => void,
 *   dispose: () => void
 * }}
 */
export function createInput(options) {
  if (options === null || options === undefined || typeof options !== 'object') {
    throw new TypeError('createInput 需要参数对象 { canvas, game, callbacks }');
  }

  const canvas = options.canvas;
  if (canvas === null || canvas === undefined) {
    throw new TypeError('createInput 缺少 canvas');
  }

  const game = options.game;
  if (game === null || game === undefined || typeof game !== 'object') {
    throw new TypeError('createInput 缺少 game（Pipeline 公共入口）');
  }
  if (typeof game.getState !== 'function') {
    throw new TypeError('createInput 的 game 缺少 getState()');
  }
  if (typeof game.pause !== 'function') {
    throw new TypeError('createInput 的 game 缺少 pause()');
  }
  if (typeof game.toggleMute !== 'function') {
    throw new TypeError('createInput 的 game 缺少 toggleMute()');
  }

  let callbacks = {};
  if (options.callbacks !== undefined && options.callbacks !== null) {
    if (typeof options.callbacks !== 'object') {
      throw new TypeError('createInput 的 callbacks 必须是对象');
    }
    callbacks = options.callbacks;
  }

  let disposed = false;
  let forward = false;
  let backward = false;
  let left = false;
  let right = false;
  let sprint = false;
  let fire = false;
  let aim = false;
  let jumpQueued = false;
  let reloadQueued = false;
  let lookDeltaX = 0;
  let lookDeltaY = 0;
  let mouseMovesToSkip = 0;

  /**
   * 调用可选界面回调；失败时记录，不影响输入状态。
   *
   * @param {'onPause'|'onMute'|'onFullscreen'|'onBlockedEscape'} name
   * @returns {void}
   */
  function invokeCallback(name) {
    const callback = callbacks[name];
    if (typeof callback !== 'function') {
      return;
    }
    try {
      callback();
    } catch (error) {
      console.error('input: 回调 ' + name + ' 执行失败', error);
    }
  }

  /**
   * 设置面板等覆盖层打开时，输入层应冻结游戏输入。
   * 回调缺失时视为不冻结。
   *
   * @returns {boolean}
   */
  function isBlocked() {
    const callback = callbacks.isBlocked;
    if (typeof callback !== 'function') {
      return false;
    }
    try {
      return callback() === true;
    } catch (error) {
      console.error('input: 读取输入冻结状态失败', error);
      return false;
    }
  }

  /**
   * 清空所有按键与鼠标状态，避免指针锁定丢失后角色持续移动或射击。
   *
   * @returns {void}
   */
  function resetInputState() {
    forward = false;
    backward = false;
    left = false;
    right = false;
    sprint = false;
    fire = false;
    aim = false;
    jumpQueued = false;
    reloadQueued = false;
    lookDeltaX = 0;
    lookDeltaY = 0;
    mouseMovesToSkip = 0;
  }

  /**
   * @returns {boolean}
   */
  function isPointerLocked() {
    return document.pointerLockElement === canvas;
  }

  /**
   * 读取对局状态；失败时记录并按 menu 处理。
   *
   * @returns {string}
   */
  function readGameState() {
    try {
      const state = game.getState();
      if (typeof state === 'string') {
        return state;
      }
      console.error('input: game.getState() 返回了非字符串');
      return 'menu';
    } catch (error) {
      console.error('input: 读取对局状态失败', error);
      return 'menu';
    }
  }

  /**
   * 请求指针锁定。必须由用户手势触发；失败只记录，不抛到事件处理之外。
   *
   * @returns {void}
   */
  function requestPointerLock() {
    if (disposed || isPointerLocked()) {
      return;
    }
    try {
      const result = canvas.requestPointerLock();
      if (result !== null && result !== undefined && typeof result.catch === 'function') {
        result.catch((error) => {
          console.error('input: 请求指针锁定失败', error);
        });
      }
    } catch (error) {
      console.error('input: 请求指针锁定失败', error);
    }
  }

  /**
   * 主动释放指针锁定。暂停、结算与释放时使用。
   *
   * @returns {void}
   */
  function releasePointerLock() {
    if (document.pointerLockElement !== canvas) {
      return;
    }
    try {
      const result = document.exitPointerLock();
      if (result !== null && result !== undefined && typeof result.catch === 'function') {
        result.catch((error) => {
          console.error('input: 释放指针锁定失败', error);
        });
      }
    } catch (error) {
      console.error('input: 释放指针锁定失败', error);
    }
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function handleKeyDown(event) {
    if (disposed) {
      return;
    }

    if (isBlocked()) {
      // 设置面板打开时，Escape 关闭面板；其余按键交给表单控件本身
      // （滑杆方向键等），但不进入游戏输入状态。
      if (event.code === 'Escape') {
        event.preventDefault();
        invokeCallback('onBlockedEscape');
      }
      return;
    }

    if (event.code === 'F11') {
      event.preventDefault();
      if (event.repeat === false) {
        invokeCallback('onFullscreen');
      }
      return;
    }

    if (event.code === 'KeyM') {
      event.preventDefault();
      if (event.repeat === false) {
        invokeCallback('onMute');
      }
      return;
    }

    if (event.code === 'Escape') {
      // 浏览器通常会用 ESC 退出指针锁定；这里再提供一次显式暂停，
      // 以便指针锁定请求失败或自动化环境未派发 pointerlockchange 时仍能暂停。
      if (readGameState() === 'playing') {
        invokeCallback('onPause');
      }
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      if (event.repeat === false) {
        jumpQueued = true;
      }
      return;
    }

    if (event.code === 'KeyR') {
      if (event.repeat === false) {
        reloadQueued = true;
      }
      return;
    }

    if (event.code === 'KeyW') {
      forward = true;
      return;
    }
    if (event.code === 'KeyS') {
      backward = true;
      return;
    }
    if (event.code === 'KeyA') {
      left = true;
      return;
    }
    if (event.code === 'KeyD') {
      right = true;
      return;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      sprint = true;
    }
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function handleKeyUp(event) {
    if (event.code === 'KeyW') {
      forward = false;
      return;
    }
    if (event.code === 'KeyS') {
      backward = false;
      return;
    }
    if (event.code === 'KeyA') {
      left = false;
      return;
    }
    if (event.code === 'KeyD') {
      right = false;
      return;
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      sprint = false;
    }
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleMouseDown(event) {
    if (disposed || isBlocked()) {
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      if (readGameState() === 'playing' && isPointerLocked()) {
        aim = true;
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (readGameState() !== 'playing') {
      return;
    }
    if (!isPointerLocked()) {
      requestPointerLock();
      return;
    }
    fire = true;
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleMouseUp(event) {
    if (event.button === 0) {
      fire = false;
      return;
    }
    if (event.button === 2) {
      aim = false;
    }
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleMouseMove(event) {
    if (disposed || !isPointerLocked()) {
      return;
    }
    if (mouseMovesToSkip > 0) {
      // 指针锁定会把光标移动到画面中心；浏览器可能先报告一次巨大的
      // movement 增量。跳过最初的事件，避免开始对局时视角突然甩向天空。
      mouseMovesToSkip -= 1;
      return;
    }
    lookDeltaX += event.movementX;
    lookDeltaY += event.movementY;
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleContextMenu(event) {
    event.preventDefault();
  }

  /**
   * @returns {void}
   */
  function handlePointerLockChange() {
    if (disposed) {
      return;
    }
    if (isBlocked()) {
      resetInputState();
      return;
    }
    if (isPointerLocked()) {
      mouseMovesToSkip = 2;
      lookDeltaX = 0;
      lookDeltaY = 0;
      return;
    }

    resetInputState();
    const state = readGameState();
    if (state === 'playing') {
      invokeCallback('onPause');
    }
  }

  /**
   * @param {Event} event
   * @returns {void}
   */
  function handlePointerLockError(event) {
    console.error('input: 指针锁定请求被浏览器拒绝', event);
  }

  /**
   * 窗口失焦或页面隐藏时暂停，避免继续受伤。
   *
   * @returns {void}
   */
  function handleWindowBlur() {
    if (disposed) {
      return;
    }
    resetInputState();
    const state = readGameState();
    if (state === 'playing') {
      invokeCallback('onPause');
    }
  }

  /**
   * @returns {void}
   */
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      handleWindowBlur();
    }
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function handleCanvasClick(event) {
    if (disposed || readGameState() !== 'playing') {
      return;
    }
    if (!isPointerLocked()) {
      event.preventDefault();
      requestPointerLock();
    }
  }

  /**
   * 读取并消费本帧输入。视角增量与瞬态按键在读取后清零。
   *
   * @returns {import('../../models/contracts.js').InputCommand}
   */
  function readCommand() {
    if (isBlocked()) {
      resetInputState();
      return createInputCommand();
    }

    const command = createInputCommand({
      moveForward: readAxis(forward, backward),
      moveRight: readAxis(right, left),
      jump: jumpQueued,
      sprint,
      fire,
      aim,
      reload: reloadQueued,
      lookDeltaX,
      lookDeltaY
    });

    jumpQueued = false;
    reloadQueued = false;
    lookDeltaX = 0;
    lookDeltaY = 0;

    return command;
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('blur', handleWindowBlur);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('pointerlockchange', handlePointerLockChange);
  document.addEventListener('pointerlockerror', handlePointerLockError);
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('contextmenu', handleContextMenu);

  return {
    readCommand,

    requestPointerLock,

    releasePointerLock,

    isPointerLocked,

    /**
     * 清空所有待处理输入。设置面板打开时由界面公共入口调用。
     *
     * @returns {void}
     */
    clearPending() {
      resetInputState();
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resetInputState();

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);

      releasePointerLock();
    }
  };
}
