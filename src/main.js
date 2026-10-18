/**
 * DUSTLINE 装配入口。
 *
 * 只做接线：创建 Provider、Service、Pipeline 与界面，驱动渲染循环，并在退出时
 * 按安全顺序释放资源。菜单/对局/暂停/结算的规则全部在 Pipeline 与各 Service 中。
 *
 * 依赖方向：本文件位于入口/装配层，可以构造各层公共入口；界面只拿到 Pipeline
 * 的公共对象和共享总线，不接触 Service/Provider 实现。
 */

import { createEventBus } from './common/shared/event-bus.js';
import { EVENTS } from './models/events.js';
import { createRenderer } from './providers/public/renderer.js';
import { createAssetLoader } from './providers/public/assets.js';
import { createAudioEngine } from './providers/public/audio-engine.js';
import { createArena } from './services/public/environment.js';
import { createEffects } from './services/public/effects.js';
import { createAudio } from './services/public/audio.js';
import { createCombat } from './services/public/combat.js';
import { createEnemies } from './services/public/enemies.js';
import { createGame } from './pipelines/public/game.js';
import { createInterface, createSettings } from './interface/public/index.js';

/** 主循环 delta 上限（秒），与 Pipeline 的钳制保持一致。 */
const MAX_DELTA_SECONDS = 0.05;

/** 装配期创建的资源；释放时按依赖顺序使用。 */
const resources = {
  renderer: null,
  assets: null,
  audioEngine: null,
  audio: null,
  arena: null,
  effects: null,
  bus: null,
  enemies: null,
  combat: null,
  game: null,
  interfaceApi: null,
  settingsStore: null,
  unsubscribeWeaponVisibility: null,
  viewport: { width: 1600, height: 900 }
};

let rafId = 0;
let loopRunning = false;
let lastFrameTime = 0;
let cleanupDone = false;

/**
 * 读取测试模式开关：只有 URL 明确带 `?test=1` 时才暴露 O4 钩子。
 *
 * @returns {boolean}
 */
function readTestMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('test') === '1';
}

/**
 * 更新装载提示；元素缺失时记录，不阻断启动。
 *
 * @param {string} message
 * @returns {void}
 */
function setLoadingMessage(message) {
  const element = document.getElementById('loading-text');
  if (element === null) {
    console.error('装配: 缺少 #loading-text，无法显示装载提示');
    return;
  }
  element.textContent = message;
}

/**
 * 读取当前窗口尺寸；启动早期取不到有效值时退回设计尺寸。
 *
 * @returns {{width: number, height: number}}
 */
function readViewportSize() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  if (!Number.isFinite(width) || width <= 0) {
    width = 1600;
  }
  if (!Number.isFinite(height) || height <= 0) {
    height = 900;
  }
  return { width, height };
}

/**
 * 为战斗服务包装渲染器。
 *
 * 战斗服务在创建时复制并冻结 `viewport`，窗口缩放后不会自动更新屏幕中心射线。
 * 这里保留共享 viewport 供装配层更新，同时让战斗服务拿到的 `getWorldPosition`
 * 始终按当前窗口中心取样；其余渲染方法原样转发。
 *
 * @param {Object} renderer
 * @param {{width: number, height: number}} viewport
 * @returns {Object}
 */
function createCombatRenderer(renderer, viewport) {
  return {
    setCameraPose(pose) {
      return renderer.setCameraPose(pose);
    },
    getWorldPosition() {
      return renderer.getWorldPosition(viewport.width / 2, viewport.height / 2);
    },
    raycast(origin, direction, far, objects) {
      return renderer.raycast(origin, direction, far, objects);
    },
    attachToCamera(object) {
      return renderer.attachToCamera(object);
    },
    detachFromCamera(object) {
      return renderer.detachFromCamera(object);
    }
  };
}

/**
 * 安全释放一个资源；失败时记录，不阻断后续释放。
 *
 * @param {string} label
 * @param {(() => void) | null | undefined} action
 * @returns {void}
 */
function safeDispose(label, action) {
  if (typeof action !== 'function') {
    return;
  }
  try {
    action();
  } catch (error) {
    console.error('装配: 释放 ' + label + ' 失败', error);
  }
}

/**
 * 调用服务可选的异步加载方法。方法缺失或加载失败只记录，
 * 让对局继续使用各服务自己的程序化回退。
 *
 * @param {string} label
 * @param {Object | null} service
 * @param {string} method
 * @returns {Promise<void>}
 */
async function loadOptionalService(label, service, method) {
  if (service === null || service === undefined) {
    return;
  }
  if (typeof service[method] !== 'function') {
    console.warn('装配: ' + label + ' 没有 ' + method + '()，跳过预加载');
    return;
  }
  try {
    await service[method]();
  } catch (error) {
    console.error('装配: ' + label + ' 预加载失败，继续使用回退资源', error);
  }
}

/**
 * 切换第一人称武器可见性。战斗服务新增的 `setViewVisible()` 由装配层消费：
 * 主菜单隐藏武器，对局/暂停时显示。缺少该方法时安全跳过。
 *
 * @param {boolean} visible
 * @returns {void}
 */
function setCombatViewVisible(visible) {
  if (resources.combat === null) {
    return;
  }
  if (typeof resources.combat.setViewVisible !== 'function') {
    console.warn('装配: 战斗服务没有 setViewVisible()，跳过武器可见性切换');
    return;
  }
  try {
    resources.combat.setViewVisible(visible);
  } catch (error) {
    console.error('装配: 切换武器可见性失败', error);
  }
}

/**
 * 跟随对局状态切换武器：菜单与结算隐藏，对局与暂停显示。
 *
 * @param {unknown} payload
 * @returns {void}
 */
function handleWeaponVisibilityState(payload) {
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    console.error('装配: game:state 载荷无效，隐藏武器视图');
    setCombatViewVisible(false);
    return;
  }
  const source = /** @type {Record<string, unknown>} */ (payload);
  const state = source.state;
  let visible = false;
  if (state === 'playing' || state === 'paused') {
    visible = true;
  }
  setCombatViewVisible(visible);
}

/**
 * 释放共享音频引擎（其 dispose 返回 Promise）。
 *
 * @returns {void}
 */
function disposeAudioEngine() {
  if (resources.audioEngine === null) {
    return;
  }
  try {
    const result = resources.audioEngine.dispose();
    if (result !== null && result !== undefined && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error('装配: 释放音频引擎失败', error);
      });
    }
  } catch (error) {
    console.error('装配: 释放音频引擎失败', error);
  }
}

/**
 * 处理窗口缩放：更新渲染器与共享 viewport。
 *
 * @returns {void}
 */
function handleResize() {
  const size = readViewportSize();
  resources.viewport.width = size.width;
  resources.viewport.height = size.height;

  if (resources.renderer === null) {
    return;
  }
  try {
    resources.renderer.resize(size.width, size.height);
  } catch (error) {
    console.error('装配: 渲染器缩放失败', error);
  }
}

/**
 * 暴露 O4 只读测试钩子。默认关闭，只有 `?test=1` 时存在。
 *
 * @returns {void}
 */
function exposeTestHook() {
  if (resources.game === null || resources.interfaceApi === null) {
    console.error('装配: 测试钩子创建前缺少 game 或 interface');
    return;
  }
  window.__DUSTLINE_TEST__ = Object.freeze({
    getState: () => resources.game.getState(),
    getSnapshot: () => resources.game.getSnapshot(),
    getHud: () => resources.interfaceApi.getHud(),
    getSettings: () => resources.game.getSettings(),
    getPerformance: () => resources.game.getPerformance()
  });
}

/**
 * 主循环：读取输入、推进 Pipeline、渲染。
 *
 * @param {number} now
 * @returns {void}
 */
function frame(now) {
  if (!loopRunning) {
    return;
  }
  rafId = window.requestAnimationFrame(frame);

  let delta = (now - lastFrameTime) / 1000;
  if (!Number.isFinite(delta) || delta < 0) {
    delta = 0;
  }
  const dt = Math.min(delta, MAX_DELTA_SECONDS);
  lastFrameTime = now;

  try {
    resources.interfaceApi.syncInput();
    resources.game.update(dt);
    resources.renderer.render();
  } catch (error) {
    console.error('装配: 主循环帧执行失败', error);
  }
}

/**
 * 启动渲染循环。
 *
 * @returns {void}
 */
function startLoop() {
  if (loopRunning) {
    return;
  }
  loopRunning = true;
  lastFrameTime = performance.now();
  rafId = window.requestAnimationFrame(frame);
}

/**
 * 释放全部资源。顺序：界面 → Pipeline → Service → 渲染器 → 音频引擎 → 素材。
 *
 * @returns {void}
 */
function cleanup() {
  if (cleanupDone) {
    return;
  }
  cleanupDone = true;
  loopRunning = false;

  if (rafId !== 0) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  window.removeEventListener('resize', handleResize);
  window.removeEventListener('beforeunload', cleanup);

  if (readTestMode() && window.__DUSTLINE_TEST__ !== undefined) {
    try {
      delete window.__DUSTLINE_TEST__;
    } catch (error) {
      console.error('装配: 移除测试钩子失败', error);
    }
  }

  if (resources.unsubscribeWeaponVisibility !== null) {
    const unsubscribe = resources.unsubscribeWeaponVisibility;
    resources.unsubscribeWeaponVisibility = null;
    try {
      unsubscribe();
    } catch (error) {
      console.error('装配: 退订武器可见性失败', error);
    }
  }

  if (resources.interfaceApi !== null) {
    safeDispose('界面', () => {
      resources.interfaceApi.dispose();
    });
  }
  if (resources.game !== null) {
    safeDispose('对局', () => {
      resources.game.dispose();
    });
  }
  if (resources.combat !== null) {
    safeDispose('战斗服务', () => {
      resources.combat.dispose();
    });
  }
  if (resources.enemies !== null) {
    safeDispose('敌方服务', () => {
      resources.enemies.dispose();
    });
  }
  if (resources.effects !== null) {
    safeDispose('效果服务', () => {
      resources.effects.dispose();
    });
  }
  if (resources.arena !== null) {
    safeDispose('竞技场', () => {
      resources.arena.dispose();
    });
  }
  if (resources.audio !== null) {
    safeDispose('音频服务', () => {
      resources.audio.dispose();
    });
  }
  disposeAudioEngine();
  if (resources.renderer !== null) {
    safeDispose('渲染器', () => {
      resources.renderer.dispose();
    });
  }
  if (resources.assets !== null) {
    safeDispose('素材加载器', () => {
      resources.assets.dispose();
    });
  }
}

/**
 * 创建全部对象并启动。失败时显示错误、释放已创建资源并记录。
 *
 * @returns {Promise<void>}
 */
async function boot() {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('装配: 未找到 canvas#game');
  }

  const size = readViewportSize();
  resources.viewport.width = size.width;
  resources.viewport.height = size.height;

  setLoadingMessage('正在初始化渲染器、音频引擎与后处理...');
  resources.renderer = createRenderer({
    canvas,
    width: size.width,
    height: size.height,
    pixelRatio: window.devicePixelRatio
  });
  resources.assets = createAssetLoader({
    baseUrl: new URL('./resource/', document.baseURI).href
  });
  resources.audioEngine = createAudioEngine();
  resources.audio = createAudio({ engine: resources.audioEngine });

  setLoadingMessage('正在装载训练场、场景道具与天光...');
  resources.arena = createArena({
    renderer: resources.renderer,
    assets: resources.assets
  });
  await resources.arena.load();

  let decals = null;
  if (typeof resources.arena.getDecals === 'function') {
    try {
      decals = resources.arena.getDecals();
    } catch (error) {
      console.error('装配: 读取竞技场弹孔/污渍系统失败，效果服务不接贴片', error);
    }
  } else {
    console.warn('装配: 竞技场没有 getDecals()，效果服务不接弹孔贴片');
  }

  if (decals !== null && decals !== undefined) {
    resources.effects = createEffects({ renderer: resources.renderer, decals });
  } else {
    resources.effects = createEffects({ renderer: resources.renderer });
  }
  resources.bus = createEventBus();

  /**
   * 服务事件统一进入共享总线；Pipeline 订阅结果事件完成协作。
   *
   * @param {string} name
   * @param {unknown} payload
   * @returns {void}
   */
  const emit = (name, payload) => {
    resources.bus.emit(name, payload);
  };

  // 战斗服务需要敌方服务提供的 targetQuery，因此先创建敌方服务再创建战斗。
  resources.enemies = createEnemies({
    renderer: resources.renderer,
    colliders: resources.arena.getColliders(),
    getSpawnPoint: (args) => resources.arena.getSpawnPoint(args),
    emit,
    assets: resources.assets
  });

  const combatRenderer = createCombatRenderer(
    resources.renderer,
    resources.viewport
  );
  resources.combat = createCombat({
    renderer: combatRenderer,
    colliders: resources.arena.getColliders(),
    targetQuery: resources.enemies.getTargetQuery(),
    emit,
    spawn: resources.arena.getPlayerSpawn(),
    viewport: resources.viewport,
    assets: resources.assets
  });

  setLoadingMessage('正在加载人类士兵模型、武器贴图与后处理...');
  await loadOptionalService('敌方服务', resources.enemies, 'load');
  await loadOptionalService('战斗服务', resources.combat, 'load');

  resources.game = createGame({
    bus: resources.bus,
    renderer: resources.renderer,
    arena: resources.arena,
    combat: resources.combat,
    enemies: resources.enemies,
    effects: resources.effects,
    audio: resources.audio
  });

  // 启动时读取本地设置并应用到 Pipeline，再创建界面同步面板数值。
  resources.settingsStore = createSettings({ storage: window.localStorage });
  const savedSettings = resources.settingsStore.load();
  try {
    resources.game.applySettings(savedSettings);
  } catch (error) {
    console.error('装配: 应用已保存设置失败，使用 Pipeline 默认值', error);
  }

  // 菜单只展示竞技场：初始隐藏第一人称武器；开始/继续后按对局状态显示。
  setCombatViewVisible(false);
  resources.unsubscribeWeaponVisibility = resources.bus.on(
    EVENTS.GAME_STATE,
    handleWeaponVisibilityState
  );

  const testMode = readTestMode();
  resources.interfaceApi = createInterface({
    bus: resources.bus,
    game: resources.game,
    canvas,
    testMode,
    settings: resources.settingsStore,
    onUserGesture: () => resources.audio.init()
  });

  if (testMode) {
    exposeTestHook();
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('beforeunload', cleanup);

  handleResize();
  resources.game.update(0);
  resources.renderer.render();
  startLoop();
}

boot().catch((error) => {
  console.error('装配: 启动失败', error);
  let message = '启动失败，请查看控制台日志。';
  if (error !== null && error !== undefined && typeof error.message === 'string' && error.message.length > 0) {
    message = '启动失败：' + error.message;
  }
  setLoadingMessage(message);
  cleanup();
});
