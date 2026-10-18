/**
 * 设置持久化与设置面板装配。
 *
 * `createSettings()` 是纯逻辑部分：校验、夹紧、合并设置，并把结果写入注入的
 * localStorage 兼容对象（默认测试可直接传内存实现）。`createSettingsPanel()`
 * 负责 DOM 面板：拖动滑杆、切换画质、恢复默认、关闭，并把变化实时交给
 * Pipeline 的 `game.applySettings()`。
 *
 * 设置字段、默认值与范围全部来自 Model 的 `GAME_CONFIG.settings`；
 * 本文件不复制第二份业务数值，也不计算游戏结果。
 */

import {
  GAME_CONFIG,
  clampSetting,
  normalizeSettings
} from '../../models/game-config.js';

/** 本地设置存储键。v2 的设置不迁移，避免把旧字段带进 v3。 */
export const SETTINGS_STORAGE_KEY = 'dustline.settings.v3';

/** 合法设置字段顺序。 */
const SETTING_KEYS = Object.freeze([
  'mouseSensitivity',
  'adsSensitivityMultiplier',
  'fov',
  'masterVolume',
  'quality'
]);

/** 面板数值展示。 */
const QUALITY_LABELS = Object.freeze({
  high: '高',
  low: '低'
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 校验注入的存储对象。
 *
 * @param {unknown} storage
 * @returns {{ getItem: (key: string) => (string | null), setItem: (key: string, value: string) => void }}
 */
function requireStorage(storage) {
  if (!isRecord(storage)) {
    throw new TypeError('createSettings 需要 storage（localStorage 兼容对象）');
  }
  const source = /** @type {Record<string, unknown>} */ (storage);
  if (typeof source.getItem !== 'function') {
    throw new TypeError('createSettings 的 storage 缺少 getItem()');
  }
  if (typeof source.setItem !== 'function') {
    throw new TypeError('createSettings 的 storage 缺少 setItem()');
  }
  return /** @type {{ getItem: Function, setItem: Function }} */ (source);
}

/**
 * 校验注入的默认值与范围对象，缺失字段回退到 Model 配置。
 *
 * @param {unknown} defaults
 * @param {unknown} ranges
 * @returns {{ defaults: Record<string, unknown>, ranges: Record<string, any> }}
 */
function readDefaultsAndRanges(defaults, ranges) {
  let resolvedDefaults = GAME_CONFIG.settings.defaults;
  if (defaults !== undefined && defaults !== null) {
    if (!isRecord(defaults)) {
      throw new TypeError('createSettings 的 defaults 必须是对象');
    }
    resolvedDefaults = /** @type {Record<string, unknown>} */ (defaults);
  }

  let resolvedRanges = GAME_CONFIG.settings.ranges;
  if (ranges !== undefined && ranges !== null) {
    if (!isRecord(ranges)) {
      throw new TypeError('createSettings 的 ranges 必须是对象');
    }
    resolvedRanges = /** @type {Record<string, any>} */ (ranges);
  }

  return { defaults: resolvedDefaults, ranges: resolvedRanges };
}

/**
 * 读取设置值用于展示。未知字段回退为字符串。
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
export function formatSettingValue(key, value) {
  if (key === 'quality') {
    const label = QUALITY_LABELS[value];
    if (typeof label === 'string') {
      return label;
    }
    return '未知';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  if (key === 'mouseSensitivity' || key === 'adsSensitivityMultiplier') {
    return value.toFixed(2) + '×';
  }
  if (key === 'fov') {
    return String(Math.round(value)) + '°';
  }
  if (key === 'masterVolume') {
    return String(Math.round(value * 100)) + '%';
  }
  return String(value);
}

/**
 * 创建设置存储。
 *
 * @param {{
 *   storage: { getItem: Function, setItem: Function },
 *   defaults?: Record<string, unknown>,
 *   ranges?: Record<string, any>
 * }} options
 * @returns {{
 *   load: () => Readonly<Record<string, unknown>>,
 *   save: (settings: unknown) => Readonly<Record<string, unknown>>,
 *   merge: (partial: unknown) => Readonly<Record<string, unknown>>,
 *   get: () => Readonly<Record<string, unknown>>,
 *   reset: () => Readonly<Record<string, unknown>>,
 *   validate: (settings: unknown) => Readonly<Record<string, unknown>>,
 *   getDefaults: () => Readonly<Record<string, unknown>>,
 *   getRanges: () => Readonly<Record<string, any>>
 * }}
 */
export function createSettings(options) {
  if (!isRecord(options)) {
    throw new TypeError('createSettings 需要参数对象 { storage, defaults, ranges }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);
  const storage = requireStorage(source.storage);
  const resolved = readDefaultsAndRanges(source.defaults, source.ranges);

  /**
   * 用注入的默认值补齐字段，再交给 Model 校验/夹紧。
   *
   * @param {unknown} partial
   * @returns {Readonly<Record<string, unknown>>}
   */
  function normalize(partial) {
    const merged = {};
    for (const key of SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(resolved.defaults, key)) {
        merged[key] = resolved.defaults[key];
      } else {
        merged[key] = GAME_CONFIG.settings.defaults[key];
      }
    }

    if (partial !== undefined && partial !== null) {
      if (!isRecord(partial)) {
        throw new TypeError('设置必须是对象');
      }
      const patch = /** @type {Record<string, unknown>} */ (partial);
      for (const key of SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          merged[key] = patch[key];
        }
      }
    }

    return normalizeSettings(merged);
  }

  let current = normalize(undefined);

  /**
   * 返回冻结副本，调用方修改不会影响内部状态。
   *
   * @returns {Readonly<Record<string, unknown>>}
   */
  function get() {
    return Object.freeze({ ...current });
  }

  /**
   * @param {unknown} settings
   * @returns {Readonly<Record<string, unknown>>}
   */
  function validate(settings) {
    return normalize(settings);
  }

  /**
   * 读取本地设置。缺失、损坏或非法时记录原因并回退默认值。
   *
   * @returns {Readonly<Record<string, unknown>>}
   */
  function load() {
    let raw = null;
    try {
      raw = storage.getItem(SETTINGS_STORAGE_KEY);
    } catch (error) {
      console.error('settings: 读取本地设置失败，使用默认值', error);
      current = normalize(undefined);
      return get();
    }

    if (raw === null || raw === undefined || raw === '') {
      current = normalize(undefined);
      return get();
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('settings: 本地设置不是有效 JSON，使用默认值', error);
      current = normalize(undefined);
      return get();
    }

    try {
      current = validate(parsed);
    } catch (error) {
      console.error('settings: 本地设置包含非法值，使用默认值', error);
      current = normalize(undefined);
    }
    return get();
  }

  /**
   * 校验并保存完整设置。
   *
   * @param {unknown} settings
   * @returns {Readonly<Record<string, unknown>>}
   */
  function save(settings) {
    const next = validate(settings);
    current = next;
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error('settings: 写入本地设置失败', error);
    }
    return get();
  }

  /**
   * 合并部分设置并校验/夹紧，不写存储。面板随后调用 `save()`。
   *
   * @param {unknown} partial
   * @returns {Readonly<Record<string, unknown>>}
   */
  function merge(partial) {
    const merged = { ...current };
    if (partial !== undefined && partial !== null) {
      if (!isRecord(partial)) {
        throw new TypeError('merge 的参数必须是对象');
      }
      const patch = /** @type {Record<string, unknown>} */ (partial);
      for (const key of SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          merged[key] = patch[key];
        }
      }
    }
    current = validate(merged);
    return get();
  }

  /**
   * 恢复默认值并写入存储。
   *
   * @returns {Readonly<Record<string, unknown>>}
   */
  function reset() {
    current = normalize(undefined);
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
    } catch (error) {
      console.error('settings: 写入默认设置失败', error);
    }
    return get();
  }

  /**
   * @returns {Readonly<Record<string, unknown>>}
   */
  function getDefaults() {
    return Object.freeze({ ...normalize(undefined) });
  }

  /**
   * @returns {Readonly<Record<string, any>>}
   */
  function getRanges() {
    return Object.freeze({ ...resolved.ranges });
  }

  return {
    load,
    save,
    merge,
    get,
    reset,
    validate,
    getDefaults,
    getRanges
  };
}

/**
 * 读取并校验一个 DOM 元素。
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
function requireElement(id) {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error('设置面板缺少 DOM 元素 #' + id);
  }
  return element;
}

/**
 * 读取设置项对应的输入控件。
 *
 * @param {string} id
 * @returns {HTMLInputElement | HTMLSelectElement}
 */
function requireControl(id) {
  const element = requireElement(id);
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
    throw new Error('设置控件 #' + id + ' 必须是 input 或 select');
  }
  return /** @type {HTMLInputElement | HTMLSelectElement} */ (element);
}

/**
 * 创建设置面板控制器。
 *
 * @param {{
 *   settings: ReturnType<typeof createSettings>,
 *   game: {
 *     applySettings: (partial?: Object) => Object,
 *     getSettings: () => Object,
 *     getState?: () => string,
 *     pause?: () => void
 *   },
 *   onVisibilityChange?: (visible: boolean) => void,
 *   onClose?: () => void
 * }} options
 * @returns {{
 *   open: () => void,
 *   close: () => void,
 *   isVisible: () => boolean,
 *   syncFromGame: () => void,
 *   dispose: () => void
 * }}
 */
export function createSettingsPanel(options) {
  if (!isRecord(options)) {
    throw new TypeError('createSettingsPanel 需要参数对象 { settings, game }');
  }
  const source = /** @type {Record<string, unknown>} */ (options);

  const settings = source.settings;
  if (!isRecord(settings)) {
    throw new TypeError('createSettingsPanel 缺少设置存储 settings');
  }
  const settingsStore = /** @type {Record<string, Function>} */ (settings);
  const requiredStoreMethods = ['get', 'save', 'reset', 'getRanges'];
  for (const method of requiredStoreMethods) {
    if (typeof settingsStore[method] !== 'function') {
      throw new TypeError('设置存储缺少方法 ' + method + '()');
    }
  }

  const game = source.game;
  if (!isRecord(game)) {
    throw new TypeError('createSettingsPanel 缺少 game（Pipeline 公共入口）');
  }
  const gameSource = /** @type {Record<string, unknown>} */ (game);
  if (typeof gameSource.applySettings !== 'function') {
    throw new TypeError('createSettingsPanel 的 game 缺少 applySettings()');
  }
  if (typeof gameSource.getSettings !== 'function') {
    throw new TypeError('createSettingsPanel 的 game 缺少 getSettings()');
  }

  let onVisibilityChange = undefined;
  if (source.onVisibilityChange !== undefined && source.onVisibilityChange !== null) {
    if (typeof source.onVisibilityChange !== 'function') {
      throw new TypeError('createSettingsPanel 的 onVisibilityChange 必须是函数');
    }
    onVisibilityChange = /** @type {(visible: boolean) => void} */ (source.onVisibilityChange);
  }
  let onClose = undefined;
  if (source.onClose !== undefined && source.onClose !== null) {
    if (typeof source.onClose !== 'function') {
      throw new TypeError('createSettingsPanel 的 onClose 必须是函数');
    }
    onClose = /** @type {() => void} */ (source.onClose);
  }

  const overlay = requireElement('settings');
  const closeButton = requireElement('settings-close');
  const resetButton = requireElement('settings-reset');

  /** @type {Array<{ key: string, kind: 'number' | 'quality', input: HTMLInputElement | HTMLSelectElement, output: HTMLElement }>} */
  const controls = [
    {
      key: 'mouseSensitivity',
      kind: 'number',
      input: requireControl('setting-mouse-sensitivity'),
      output: requireElement('setting-mouse-sensitivity-value')
    },
    {
      key: 'adsSensitivityMultiplier',
      kind: 'number',
      input: requireControl('setting-ads-sensitivity'),
      output: requireElement('setting-ads-sensitivity-value')
    },
    {
      key: 'fov',
      kind: 'number',
      input: requireControl('setting-fov'),
      output: requireElement('setting-fov-value')
    },
    {
      key: 'masterVolume',
      kind: 'number',
      input: requireControl('setting-master-volume'),
      output: requireElement('setting-master-volume-value')
    },
    {
      key: 'quality',
      kind: 'quality',
      input: requireControl('setting-quality'),
      output: requireElement('setting-quality-value')
    }
  ];

  const ranges = settingsStore.getRanges();
  for (const control of controls) {
    if (control.kind !== 'number') {
      continue;
    }
    const range = ranges[control.key];
    if (range !== undefined && range !== null) {
      if (typeof range.min === 'number' && control.input instanceof HTMLInputElement) {
        control.input.min = String(range.min);
      }
      if (typeof range.max === 'number' && control.input instanceof HTMLInputElement) {
        control.input.max = String(range.max);
      }
    }
  }

  let visible = false;
  let disposed = false;

  /**
   * @param {boolean} nextVisible
   * @returns {void}
   */
  function notifyVisibility(nextVisible) {
    if (typeof onVisibilityChange !== 'function') {
      return;
    }
    try {
      onVisibilityChange(nextVisible);
    } catch (error) {
      console.error('settings: 设置面板可见性回调失败', error);
    }
  }

  /**
   * @param {unknown} value
   * @returns {void}
   */
  function syncControls(value) {
    if (!isRecord(value)) {
      console.error('settings: 无法同步设置控件，数据不是对象');
      return;
    }
    const settingsValue = /** @type {Record<string, unknown>} */ (value);
    for (const control of controls) {
      const controlValue = settingsValue[control.key];
      if (control.kind === 'quality') {
        if (typeof controlValue === 'string') {
          control.input.value = controlValue;
        }
      } else if (typeof controlValue === 'number' && Number.isFinite(controlValue)) {
        control.input.value = String(controlValue);
      }
      control.output.textContent = formatSettingValue(control.key, controlValue);
    }
  }

  /**
   * 从 Pipeline 读取当前设置并刷新控件。
   *
   * @returns {void}
   */
  function syncFromGame() {
    let current = null;
    try {
      current = gameSource.getSettings();
    } catch (error) {
      console.error('settings: 读取当前设置失败，使用本地存储值', error);
      current = settingsStore.get();
    }
    syncControls(current);
  }

  /**
   * 读取全部控件，构成完整设置补丁。
   *
   * @returns {Record<string, number | string>}
   */
  function readControls() {
    const partial = {};
    for (const control of controls) {
      if (control.kind === 'quality') {
        partial[control.key] = control.input.value;
        continue;
      }
      const value = Number(control.input.value);
      if (Number.isFinite(value)) {
        partial[control.key] = value;
      }
    }
    return partial;
  }

  /**
   * 把部分设置实时应用到 Pipeline 并保存。
   *
   * @param {Record<string, number | string>} partial
   * @returns {void}
   */
  function applyAndSave(partial) {
    let applied = null;
    try {
      applied = gameSource.applySettings(partial);
    } catch (error) {
      console.error('settings: 应用设置失败，保留原设置', error);
      syncFromGame();
      return;
    }

    try {
      settingsStore.save(applied);
    } catch (error) {
      console.error('settings: 保存设置失败', error);
    }
    syncControls(applied);
  }

  /**
   * @returns {void}
   */
  function handleControlChange() {
    if (disposed) {
      return;
    }
    applyAndSave(readControls());
  }

  /**
   * @returns {void}
   */
  function handleResetClick() {
    if (disposed) {
      return;
    }
    let defaults = null;
    try {
      defaults = settingsStore.reset();
    } catch (error) {
      console.error('settings: 重置设置失败', error);
      return;
    }

    let applied = null;
    try {
      applied = gameSource.applySettings(defaults);
    } catch (error) {
      console.error('settings: 应用默认设置失败', error);
      syncFromGame();
      return;
    }
    syncControls(applied);
  }

  /**
   * @returns {void}
   */
  function handleCloseClick() {
    close();
    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch (error) {
        console.error('settings: 关闭回调失败', error);
      }
    }
  }

  /**
   * 打开设置面板。对局中打开时先暂停，避免设置期间继续受伤。
   *
   * @returns {void}
   */
  function open() {
    if (disposed || visible) {
      return;
    }
    if (typeof gameSource.getState === 'function' && typeof gameSource.pause === 'function') {
      try {
        if (gameSource.getState() === 'playing') {
          gameSource.pause();
        }
      } catch (error) {
        console.error('settings: 打开设置时暂停对局失败', error);
      }
    }
    syncFromGame();
    overlay.classList.remove('hidden');
    visible = true;
    notifyVisibility(true);
  }

  /**
   * @returns {void}
   */
  function close() {
    if (disposed || !visible) {
      return;
    }
    overlay.classList.add('hidden');
    visible = false;
    notifyVisibility(false);
  }

  /**
   * @returns {boolean}
   */
  function isVisible() {
    return visible;
  }

  for (const control of controls) {
    if (control.kind === 'quality') {
      control.input.addEventListener('change', handleControlChange);
    } else {
      control.input.addEventListener('input', handleControlChange);
    }
  }
  resetButton.addEventListener('click', handleResetClick);
  closeButton.addEventListener('click', handleCloseClick);

  // 启动时 Pipeline 已经应用了本地保存的设置；面板创建后立即同步一次，
  // 保证第一次打开前控件值就与运行时一致。
  syncFromGame();

  return {
    open,
    close,
    isVisible,
    syncFromGame,

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      visible = false;
      overlay.classList.add('hidden');

      for (const control of controls) {
        if (control.kind === 'quality') {
          control.input.removeEventListener('change', handleControlChange);
        } else {
          control.input.removeEventListener('input', handleControlChange);
        }
      }
      resetButton.removeEventListener('click', handleResetClick);
      closeButton.removeEventListener('click', handleCloseClick);
    }
  };
}

/**
 * 确认某个设置键在当前 Model 范围内有效；供面板/测试做显式检查。
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {number | string}
 */
export function validateSetting(key, value) {
  return clampSetting(key, value);
}
