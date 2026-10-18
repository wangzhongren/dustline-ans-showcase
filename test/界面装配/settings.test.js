/**
 * 界面装配层内测试：设置存储（纯 Node，无 DOM）。
 *
 * 覆盖默认值、有效/损坏/非法本地数据、合并与夹紧、保存键名、恢复默认、
 * 画质允许值以及跨实例读写往返。设置模块的面板函数只在浏览器中调用，
 * 这里不构造 DOM。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG } from '../../src/models/game-config.js';
import {
  SETTINGS_STORAGE_KEY,
  createSettings,
  formatSettingValue
} from '../../src/interface/impl/settings.js';

const DEFAULTS = GAME_CONFIG.settings.defaults;

/**
 * localStorage 兼容的内存实现。
 *
 * @param {Record<string, string>} [initial]
 * @returns {{
 *   getItem: (key: string) => (string | null),
 *   setItem: (key: string, value: string) => void,
 *   read: (key: string) => (string | null),
 *   dump: () => Record<string, string>
 * }}
 */
function createMemoryStorage(initial) {
  const map = new Map();
  if (initial !== undefined) {
    for (const key of Object.keys(initial)) {
      map.set(key, initial[key]);
    }
  }
  return {
    getItem(key) {
      if (map.has(key)) {
        return map.get(key);
      }
      return null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    read(key) {
      if (map.has(key)) {
        return map.get(key);
      }
      return null;
    },
    dump() {
      const result = {};
      for (const entry of map.entries()) {
        result[entry[0]] = entry[1];
      }
      return result;
    }
  };
}

/**
 * 在记录 console.error 的前提下执行回调，确认错误没有被静默吞掉。
 *
 * @param {() => unknown} run
 * @returns {{ result: unknown, errors: unknown[][] }}
 */
function withCapturedErrors(run) {
  const original = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args);
  };
  try {
    const result = run();
    return { result, errors };
  } finally {
    console.error = original;
  }
}

test('默认设置来自 Model 配置并返回冻结副本', () => {
  const store = createSettings({ storage: createMemoryStorage() });
  const value = store.get();
  assert.equal(value.mouseSensitivity, DEFAULTS.mouseSensitivity);
  assert.equal(value.adsSensitivityMultiplier, DEFAULTS.adsSensitivityMultiplier);
  assert.equal(value.fov, DEFAULTS.fov);
  assert.equal(value.masterVolume, DEFAULTS.masterVolume);
  assert.equal(value.quality, DEFAULTS.quality);
  assert.equal(Object.isFrozen(value), true);
});

test('本地存储键名为 dustline.settings.v3', () => {
  assert.equal(SETTINGS_STORAGE_KEY, 'dustline.settings.v3');
});

test('load 读取有效本地设置', () => {
  const storage = createMemoryStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      mouseSensitivity: 2.2,
      adsSensitivityMultiplier: 1.1,
      fov: 88,
      masterVolume: 0.35,
      quality: 'low'
    })
  });
  const store = createSettings({ storage });
  const value = store.load();
  assert.equal(value.mouseSensitivity, 2.2);
  assert.equal(value.adsSensitivityMultiplier, 1.1);
  assert.equal(value.fov, 88);
  assert.equal(value.masterVolume, 0.35);
  assert.equal(value.quality, 'low');
});

test('损坏的 JSON 回退默认值并记录错误', () => {
  const storage = createMemoryStorage({
    [SETTINGS_STORAGE_KEY]: '{ this is not json'
  });
  const store = createSettings({ storage });
  const captured = withCapturedErrors(() => store.load());
  const value = /** @type {Record<string, unknown>} */ (captured.result);
  assert.equal(value.fov, DEFAULTS.fov);
  assert.equal(value.quality, DEFAULTS.quality);
  assert.ok(captured.errors.length >= 1);
});

test('非法字段值回退默认值并记录错误', () => {
  const storage = createMemoryStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      mouseSensitivity: 1.4,
      quality: 'ultra'
    })
  });
  const store = createSettings({ storage });
  const captured = withCapturedErrors(() => store.load());
  const value = /** @type {Record<string, unknown>} */ (captured.result);
  assert.equal(value.mouseSensitivity, DEFAULTS.mouseSensitivity);
  assert.equal(value.quality, DEFAULTS.quality);
  assert.ok(captured.errors.length >= 1);
});

test('merge 合并并夹紧数值', () => {
  const store = createSettings({ storage: createMemoryStorage() });
  const value = store.merge({
    mouseSensitivity: 0.1,
    adsSensitivityMultiplier: 4,
    fov: 200,
    masterVolume: -1,
    quality: 'low'
  });
  assert.equal(value.mouseSensitivity, 0.25);
  assert.equal(value.adsSensitivityMultiplier, 1.5);
  assert.equal(value.fov, 95);
  assert.equal(value.masterVolume, 0);
  assert.equal(value.quality, 'low');
});

test('merge 拒绝非对象与非数字值', () => {
  const store = createSettings({ storage: createMemoryStorage() });
  const unchanged = store.merge(null);
  assert.equal(unchanged.fov, DEFAULTS.fov);
  assert.throws(() => store.merge('bad'), TypeError);
  assert.throws(() => store.merge({ fov: '75' }), TypeError);
  assert.throws(() => store.merge({ fov: Number.NaN }), TypeError);
  assert.throws(() => store.merge({ quality: 'ultra' }), RangeError);
});

test('save 写入本地存储与当前值', () => {
  const storage = createMemoryStorage();
  const store = createSettings({ storage });
  const saved = store.save({
    mouseSensitivity: 1.75,
    adsSensitivityMultiplier: 0.6,
    fov: 82,
    masterVolume: 0.4,
    quality: 'low'
  });
  assert.equal(saved.fov, 82);
  assert.equal(store.get().quality, 'low');

  const raw = storage.read(SETTINGS_STORAGE_KEY);
  assert.equal(typeof raw, 'string');
  const parsed = JSON.parse(/** @type {string} */ (raw));
  assert.equal(parsed.mouseSensitivity, 1.75);
  assert.equal(parsed.fov, 82);
  assert.equal(parsed.quality, 'low');
});

test('reset 恢复默认值并写回存储', () => {
  const storage = createMemoryStorage();
  const store = createSettings({ storage });
  store.save({ fov: 90, quality: 'low' });
  const value = store.reset();
  assert.equal(value.fov, DEFAULTS.fov);
  assert.equal(value.quality, DEFAULTS.quality);

  const parsed = JSON.parse(/** @type {string} */ (storage.read(SETTINGS_STORAGE_KEY)));
  assert.equal(parsed.fov, DEFAULTS.fov);
  assert.equal(parsed.quality, DEFAULTS.quality);
});

test('画质只接受 high 与 low', () => {
  const store = createSettings({ storage: createMemoryStorage() });
  assert.equal(store.validate({ quality: 'high' }).quality, 'high');
  assert.equal(store.validate({ quality: 'low' }).quality, 'low');
  assert.throws(() => store.validate({ quality: 'medium' }), RangeError);
  assert.throws(() => store.validate({ quality: 1 }), RangeError);
});

test('跨实例读写往返保持设置', () => {
  const storage = createMemoryStorage();
  const first = createSettings({ storage });
  first.save({
    mouseSensitivity: 2.5,
    adsSensitivityMultiplier: 1.2,
    fov: 91,
    masterVolume: 0.15,
    quality: 'high'
  });

  const second = createSettings({ storage });
  const loaded = second.load();
  assert.equal(loaded.mouseSensitivity, 2.5);
  assert.equal(loaded.adsSensitivityMultiplier, 1.2);
  assert.equal(loaded.fov, 91);
  assert.equal(loaded.masterVolume, 0.15);
  assert.equal(loaded.quality, 'high');
});

test('注入的默认值会被采用，未知字段忽略', () => {
  const customDefaults = {
    mouseSensitivity: 1.3,
    adsSensitivityMultiplier: 0.8,
    fov: 80,
    masterVolume: 0.7,
    quality: 'high'
  };
  const store = createSettings({
    storage: createMemoryStorage(),
    defaults: customDefaults
  });
  assert.equal(store.get().fov, 80);
  const merged = store.merge({ unknownField: 123 });
  assert.equal(merged.fov, 80);
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'unknownField'), false);
});

test('展示值格式正确', () => {
  assert.equal(formatSettingValue('mouseSensitivity', 1), '1.00×');
  assert.equal(formatSettingValue('adsSensitivityMultiplier', 0.8), '0.80×');
  assert.equal(formatSettingValue('fov', 75), '75°');
  assert.equal(formatSettingValue('masterVolume', 0.7), '70%');
  assert.equal(formatSettingValue('quality', 'high'), '高');
  assert.equal(formatSettingValue('quality', 'low'), '低');
});
