/**
 * 跨角色共享事件总线。
 *
 * 使用方约定：
 * - Pipeline 通过 `emit` 发布 HUD/世界事件，界面、效果、音频通过 `on` 订阅。
 * - 订阅返回退订函数；重复订阅同一处理函数会得到两条独立登记，事件会触发两次。
 * - 单个处理函数抛错不会中断其余处理函数；错误交给 `onError`，未配置时输出到控制台。
 * - 项目代码禁止静默 catch，因此这里显式报告每个处理函数错误，并继续派发。
 *
 * @typedef {(payload: unknown) => void} EventHandler
 * @typedef {(error: unknown, eventName: string, payload: unknown) => void} ErrorHandler
 */

/**
 * 创建一个独立的事件总线实例。
 *
 * @param {{ onError?: ErrorHandler }} [options]
 * @returns {{
 *   on: (eventName: string, handler: EventHandler) => () => void,
 *   once: (eventName: string, handler: EventHandler) => () => void,
 *   off: (eventName: string, handler: EventHandler) => boolean,
 *   emit: (eventName: string, payload?: unknown) => number,
 *   listenerCount: (eventName: string) => number,
 *   clear: (eventName?: string) => void
 * }}
 */
export function createEventBus(options) {
  const settings = options || {};
  const errorHandler = settings.onError;
  /**
   * @type {Map<string, Array<{ handler: EventHandler, once: boolean }>>}
   */
  const listeners = new Map();

  /**
   * 订阅事件，返回退订函数。同一处理函数可重复订阅，每次都独立触发。
   *
   * @param {string} eventName
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  function on(eventName, handler) {
    if (typeof eventName !== 'string' || eventName.length === 0) {
      throw new TypeError('eventName 必须是非空字符串');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler 必须是函数');
    }

    const registrations = listeners.get(eventName);
    const registration = { handler, once: false };
    if (registrations === undefined) {
      listeners.set(eventName, [registration]);
    } else {
      registrations.push(registration);
    }

    let active = true;
    return function unsubscribe() {
      if (active === false) {
        return;
      }
      active = false;
      off(eventName, handler);
    };
  }

  /**
   * 只触发一次的订阅。
   *
   * @param {string} eventName
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  function once(eventName, handler) {
    if (typeof eventName !== 'string' || eventName.length === 0) {
      throw new TypeError('eventName 必须是非空字符串');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler 必须是函数');
    }

    const registrations = listeners.get(eventName);
    const registration = { handler, once: true };
    if (registrations === undefined) {
      listeners.set(eventName, [registration]);
    } else {
      registrations.push(registration);
    }

    let active = true;
    return function unsubscribe() {
      if (active === false) {
        return;
      }
      active = false;
      off(eventName, handler);
    };
  }

  /**
   * 移除一条匹配的订阅登记。返回是否确实移除了登记。
   *
   * @param {string} eventName
   * @param {EventHandler} handler
   * @returns {boolean}
   */
  function off(eventName, handler) {
    const registrations = listeners.get(eventName);
    if (registrations === undefined) {
      return false;
    }
    const index = registrations.findIndex((registration) => registration.handler === handler);
    if (index === -1) {
      return false;
    }
    registrations.splice(index, 1);
    if (registrations.length === 0) {
      listeners.delete(eventName);
    }
    return true;
  }

  /**
   * 派发事件，返回实际调用的处理函数数量（不含抛错而失败的数量）。
   *
   * @param {string} eventName
   * @param {unknown} [payload]
   * @returns {number}
   */
  function emit(eventName, payload) {
    const registrations = listeners.get(eventName);
    if (registrations === undefined) {
      return 0;
    }

    // 派发期间允许处理函数退订或新增订阅，因此遍历快照。
    const snapshot = registrations.slice();
    let invoked = 0;

    for (const registration of snapshot) {
      if (registration.once === true) {
        off(eventName, registration.handler);
      }
      invoked += 1;
      try {
        registration.handler(payload);
      } catch (error) {
        reportHandlerError(error, eventName, payload);
      }
    }

    return invoked;
  }

  /**
   * @param {unknown} error
   * @param {string} eventName
   * @param {unknown} payload
   */
  function reportHandlerError(error, eventName, payload) {
    if (typeof errorHandler === 'function') {
      try {
        errorHandler(error, eventName, payload);
      } catch (secondaryError) {
        console.error('[event-bus] onError 处理函数自身抛错', secondaryError);
      }
      return;
    }
    console.error('[event-bus] 事件处理函数抛错: ' + eventName, error);
  }

  /**
   * @param {string} eventName
   * @returns {number}
   */
  function listenerCount(eventName) {
    const registrations = listeners.get(eventName);
    if (registrations === undefined) {
      return 0;
    }
    return registrations.length;
  }

  /**
   * 清空单个事件或全部事件的订阅。
   *
   * @param {string} [eventName]
   * @returns {void}
   */
  function clear(eventName) {
    if (eventName === undefined) {
      listeners.clear();
      return;
    }
    listeners.delete(eventName);
  }

  return { on, once, off, emit, listenerCount, clear };
}
