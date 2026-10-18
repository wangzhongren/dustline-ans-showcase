/**
 * HUD、菜单、暂停与结算展示。
 *
 * 只订阅共享事件总线上的 `game:state` 与 `hud:*` 事件，并调用界面回调转发
 * 开始/继续/重开操作。这里不计算伤害、分数、波次或命中结果；所有数值都来自
 * Pipeline 发布的事件载荷。
 */

import { EVENTS } from '../../models/events.js';

/** 罗盘每格（15°）宽度（CSS 像素）。 */
const COMPASS_TICK_WIDTH = 56;
/** 一个完整 360° 循环包含的 15° 格数。 */
const COMPASS_CYCLE_TICKS = 24;
/** 罗盘绘制三个循环，并把中间循环对齐到可视窗口。 */
const COMPASS_TOTAL_TICKS = 72;
const COMPASS_CYCLE_OFFSET = COMPASS_CYCLE_TICKS;
const KILLFEED_LIMIT = 5;
const KILLFEED_LIFETIME_MS = 4000;
const KILLFEED_FADE_MS = 420;
const HITMARKER_MS = 240;
const DAMAGE_FLASH_MS = 340;
const DAMAGE_DIRECTION_MS = 900;
const BANNER_DEFAULT_MS = 2200;
const LOW_HEALTH_RATIO = 0.3;

/** 45° 方位的军用罗盘标签。 */
const COMPASS_POINTS = Object.freeze({
  0: Object.freeze({ cn: '北', en: 'N' }),
  45: Object.freeze({ cn: '东北', en: 'NE' }),
  90: Object.freeze({ cn: '东', en: 'E' }),
  135: Object.freeze({ cn: '东南', en: 'SE' }),
  180: Object.freeze({ cn: '南', en: 'S' }),
  225: Object.freeze({ cn: '西南', en: 'SW' }),
  270: Object.freeze({ cn: '西', en: 'W' }),
  315: Object.freeze({ cn: '西北', en: 'NW' })
});

/** 敌人类型的中文显示名（v3 人类士兵）。 */
const ENEMY_LABELS = Object.freeze({
  rifleman: '步枪兵',
  heavy: '重机枪手',
  breacher: '突击兵'
});

/**
 * 把一位/两位数字补成三位度数文本。
 *
 * @param {number} value
 * @returns {string}
 */
function padDegree(value) {
  let text = String(value);
  while (text.length < 3) {
    text = '0' + text;
  }
  return text;
}

/**
 * 把弧度偏航角转换成罗盘方位角。
 *
 * 约定：`yaw = 0` 朝向 -Z，定义为北 0°；鼠标右移使 yaw 减小、方位角增大。
 * 返回 [0, 360) 的角度。
 *
 * @param {number} yaw 弧度。
 * @returns {number}
 */
export function yawToHeading(yaw) {
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) {
    throw new TypeError('yawToHeading 需要有限数字');
  }
  const degrees = (-yaw * 180) / Math.PI;
  let heading = degrees % 360;
  if (heading < 0) {
    heading += 360;
  }
  if (heading >= 360) {
    heading -= 360;
  }
  if (heading === 0) {
    return 0;
  }
  return heading;
}

/**
 * 把方位角格式化为 `000°`。
 *
 * @param {number} heading
 * @returns {string}
 */
export function formatHeading(heading) {
  if (typeof heading !== 'number' || !Number.isFinite(heading)) {
    throw new TypeError('formatHeading 需要有限数字');
  }
  let normalized = Math.round(heading) % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return padDegree(normalized) + '°';
}

/**
 * 把 `hud:damage.direction`（相对玩家朝向的弧度）转换为面板旋转角度。
 *
 * 约定：0 为正前方（准星上方），正值在右侧，负值在左侧。CSS 正旋转为顺时针，
 * 因此返回值直接用于 `rotate()`。输入会规范到 (-180, 180] 度。
 *
 * @param {number} direction 弧度，0 为正前方，正值为右。
 * @returns {number} 角度。
 */
export function damageDirectionDegrees(direction) {
  if (typeof direction !== 'number' || !Number.isFinite(direction)) {
    throw new TypeError('damageDirectionDegrees 需要有限数字');
  }
  const normalized = Math.atan2(Math.sin(direction), Math.cos(direction));
  return (normalized * 180) / Math.PI;
}

/**
 * 把存活秒数格式化为 `分:秒`。
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatSurvivedTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new TypeError('formatSurvivedTime 需要大于等于 0 的有限数字');
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  let restText = String(rest);
  if (restText.length < 2) {
    restText = '0' + restText;
  }
  return minutes + ':' + restText;
}

/**
 * 敌人类型显示名；未知类型回退为“未知目标”。
 *
 * @param {string} enemyType
 * @returns {string}
 */
export function enemyTypeLabel(enemyType) {
  if (typeof enemyType !== 'string') {
    return '未知目标';
  }
  const label = ENEMY_LABELS[enemyType];
  if (typeof label === 'string') {
    return label;
  }
  return '未知目标';
}

/**
 * 生成三个完整循环的罗盘刻度（每 15° 一格，共 72 格）。
 *
 * @returns {Array<{degree: number, normalized: number, cn: string, en: string, degreeLabel: string, major: boolean}>}
 */
export function buildCompassTicks() {
  const ticks = [];
  for (let index = 0; index < COMPASS_TOTAL_TICKS; index += 1) {
    const degree = index * 15;
    const normalized = degree % 360;
    const point = COMPASS_POINTS[normalized];
    let cn = '';
    let en = '';
    if (point !== undefined) {
      cn = point.cn;
      en = point.en;
    }
    let degreeLabel = '';
    if (normalized % 45 === 0) {
      degreeLabel = padDegree(normalized);
    } else if (normalized % 30 === 0) {
      degreeLabel = padDegree(normalized);
    }
    ticks.push({
      degree,
      normalized,
      cn,
      en,
      degreeLabel,
      major: normalized % 45 === 0
    });
  }
  return ticks;
}

/**
 * 读取有限数字，非法时返回回退值。
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function readFiniteNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/**
 * 读取布尔值，非法时返回回退值。
 *
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

/**
 * 创建 HUD 与覆盖层控制器。
 *
 * @param {{
 *   bus: { on: (name: string, handler: Function) => Function },
 *   callbacks: {
 *     onStart: () => void,
 *     onResume: () => void,
 *     onRestart: () => void
 *   },
 *   settingsPanel?: {
 *     open: () => void,
 *     close?: () => void,
 *     isVisible: () => boolean
 *   }
 * }} options
 * @returns {{
 *   getHud: () => Object,
 *   setAimState: (aiming: boolean) => void,
 *   setMoving: (moving: boolean) => void,
 *   setLoading: (visible: boolean, message?: string) => void,
 *   resetRoundUi: () => void,
 *   dispose: () => void
 * }}
 */
export function createHud(options) {
  if (options === null || options === undefined || typeof options !== 'object') {
    throw new TypeError('createHud 需要参数对象 { bus, game, callbacks }');
  }

  const bus = options.bus;
  if (bus === null || bus === undefined || typeof bus.on !== 'function') {
    throw new TypeError('createHud 缺少共享事件总线 bus.on');
  }

  const callbacks = options.callbacks;
  if (callbacks === null || callbacks === undefined || typeof callbacks !== 'object') {
    throw new TypeError('createHud 缺少 callbacks');
  }
  if (typeof callbacks.onStart !== 'function') {
    throw new TypeError('createHud 的 callbacks 缺少 onStart()');
  }
  if (typeof callbacks.onResume !== 'function') {
    throw new TypeError('createHud 的 callbacks 缺少 onResume()');
  }
  if (typeof callbacks.onRestart !== 'function') {
    throw new TypeError('createHud 的 callbacks 缺少 onRestart()');
  }

  let settingsPanel = null;
  if (options.settingsPanel !== undefined && options.settingsPanel !== null) {
    if (typeof options.settingsPanel !== 'object') {
      throw new TypeError('createHud 的 settingsPanel 必须是对象');
    }
    if (typeof options.settingsPanel.open !== 'function') {
      throw new TypeError('createHud 的 settingsPanel 缺少 open()');
    }
    if (typeof options.settingsPanel.isVisible !== 'function') {
      throw new TypeError('createHud 的 settingsPanel 缺少 isVisible()');
    }
    settingsPanel = options.settingsPanel;
  }

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function requireElement(id) {
    const element = document.getElementById(id);
    if (element === null) {
      throw new Error('HUD 缺少 DOM 元素 #' + id);
    }
    return element;
  }

  const hudEl = requireElement('hud');
  const menuEl = requireElement('menu');
  const loadingEl = requireElement('loading');
  const loadingText = requireElement('loading-text');
  const pauseEl = requireElement('pause');
  const gameoverEl = requireElement('gameover');
  const startBtn = requireElement('start-btn');
  const resumeBtn = requireElement('resume-btn');
  const restartPauseBtn = requireElement('restart-pause-btn');
  const restartBtn = requireElement('restart-btn');
  const menuSettingsBtn = requireElement('menu-settings-btn');
  const pauseSettingsBtn = requireElement('pause-settings-btn');
  const scoreEl = requireElement('score');
  const waveEl = requireElement('wave');
  const killsEl = requireElement('kills');
  const muteEl = requireElement('mute-indicator');
  const compassEl = requireElement('compass');
  const compassStrip = requireElement('compass-strip');
  const compassHeading = requireElement('compass-heading');
  const killfeedEl = requireElement('killfeed');
  const crosshairEl = requireElement('crosshair');
  const adsEl = requireElement('ads-indicator');
  const hitmarkerEl = requireElement('hitmarker');
  const damageDirectionEl = requireElement('damage-direction');
  const healthPanel = requireElement('hud-health');
  const hpValueEl = requireElement('hp-value');
  const hpMaxEl = requireElement('hp-max');
  const hpFillEl = requireElement('hp-fill');
  const ammoEl = requireElement('ammo');
  const reloadBar = requireElement('reload-bar');
  const reloadFill = requireElement('reload-fill');
  const reloadLabel = requireElement('reload-label');
  const bannerEl = requireElement('wave-banner');
  const bannerTitle = requireElement('banner-title');
  const bannerSubtitle = requireElement('banner-subtitle');
  const goScore = requireElement('go-score');
  const goWave = requireElement('go-wave');
  const goKills = requireElement('go-kills');
  const goTime = requireElement('go-time');
  const damageEl = requireElement('damage-flash');
  const lowHealthEl = requireElement('low-health');

  const compassWindow = compassEl.querySelector('.compass-window');
  if (compassWindow === null) {
    throw new Error('HUD 缺少 .compass-window');
  }

  const unsubscribers = [];
  /** @type {Array<{element: HTMLElement, timer: number}>} */
  const killEntries = [];
  let state = 'menu';
  let aiming = false;
  let moving = false;
  let compassWindowWidth = 0;
  let bannerTimer = 0;
  let hitmarkerTimer = 0;
  let damageTimer = 0;
  let damageDirectionTimer = 0;
  let disposed = false;

  const current = {
    score: 0,
    wave: 1,
    kills: 0,
    health: 100,
    maxHealth: 100,
    ammo: 30,
    magazineSize: 30,
    reloading: false,
    reloadProgress: 0,
    yaw: 0,
    muted: false
  };

  /**
   * 调用 UI 操作回调；失败时记录，避免卡住界面。
   *
   * @param {'onStart'|'onResume'|'onRestart'} name
   * @returns {void}
   */
  function invokeCallback(name) {
    try {
      callbacks[name]();
    } catch (error) {
      console.error('hud: 回调 ' + name + ' 执行失败', error);
    }
  }

  /**
   * @param {HTMLElement} element
   * @param {boolean} hidden
   * @returns {void}
   */
  function toggleHidden(element, hidden) {
    element.classList.toggle('hidden', hidden);
  }

  /**
   * 构建罗盘刻度 DOM。只在创建时执行一次。
   *
   * @returns {void}
   */
  function buildCompass() {
    const ticks = buildCompassTicks();
    compassStrip.replaceChildren();
    for (const tick of ticks) {
      const tickElement = document.createElement('span');
      tickElement.className = 'compass-tick';
      if (tick.major) {
        tickElement.classList.add('major');
      }
      if (tick.cn.length > 0) {
        const cn = document.createElement('span');
        cn.className = 'tick-cn';
        cn.textContent = tick.cn;
        tickElement.appendChild(cn);
      }
      if (tick.en.length > 0) {
        const en = document.createElement('span');
        en.className = 'tick-en';
        en.textContent = tick.en;
        tickElement.appendChild(en);
      }
      if (tick.degreeLabel.length > 0) {
        const degree = document.createElement('span');
        degree.className = 'tick-degree';
        degree.textContent = tick.degreeLabel;
        tickElement.appendChild(degree);
      }
      compassStrip.appendChild(tickElement);
    }
  }

  /**
   * @returns {void}
   */
  function measureCompass() {
    compassWindowWidth = compassWindow.clientWidth;
  }

  /**
   * 根据 yaw 移动罗盘条。
   *
   * @param {number} yaw
   * @returns {void}
   */
  function updateCompass(yaw) {
    if (compassWindowWidth <= 0) {
      measureCompass();
    }
    if (compassWindowWidth <= 0) {
      return;
    }

    const heading = yawToHeading(yaw);
    const tickIndex = heading / 15;
    const centerX =
      (COMPASS_CYCLE_OFFSET + tickIndex) * COMPASS_TICK_WIDTH +
      COMPASS_TICK_WIDTH / 2;
    const offset = centerX - compassWindowWidth / 2;
    compassStrip.style.transform = 'translateX(' + (-offset).toFixed(2) + 'px)';
    compassHeading.textContent = formatHeading(heading);
  }

  /**
   * @returns {void}
   */
  function clearBannerTimer() {
    if (bannerTimer !== 0) {
      window.clearTimeout(bannerTimer);
      bannerTimer = 0;
    }
  }

  /**
   * @returns {void}
   */
  function hideBanner() {
    clearBannerTimer();
    toggleHidden(bannerEl, true);
  }

  /**
   * @param {{title?: unknown, subtitle?: unknown, durationMs?: unknown}} payload
   * @returns {void}
   */
  function showBanner(payload) {
    const title = payload.title;
    const subtitle = payload.subtitle;
    let duration = BANNER_DEFAULT_MS;
    const requested = readFiniteNumber(payload.durationMs, BANNER_DEFAULT_MS);
    if (requested > 0) {
      duration = requested;
    }

    if (typeof title === 'string' && title.length > 0) {
      bannerTitle.textContent = title;
    }
    if (typeof subtitle === 'string') {
      bannerSubtitle.textContent = subtitle;
    }

    toggleHidden(bannerEl, false);
    clearBannerTimer();
    bannerTimer = window.setTimeout(() => {
      bannerTimer = 0;
      toggleHidden(bannerEl, true);
    }, duration);
  }

  /**
   * 移除一条击杀信息并清理定时器。
   *
   * @param {{element: HTMLElement, timer: number}} entry
   * @returns {void}
   */
  function removeKillEntry(entry) {
    if (entry.timer !== 0) {
      window.clearTimeout(entry.timer);
      entry.timer = 0;
    }
    entry.element.remove();
    const index = killEntries.indexOf(entry);
    if (index >= 0) {
      killEntries.splice(index, 1);
    }
  }

  /**
   * @returns {void}
   */
  function clearKillfeed() {
    for (const entry of killEntries.slice()) {
      removeKillEntry(entry);
    }
  }

  /**
   * @param {{enemyType?: unknown, score?: unknown, headshot?: unknown, critical?: unknown}} payload
   * @returns {void}
   */
  function addKillEntry(payload) {
    while (killEntries.length >= KILLFEED_LIMIT) {
      removeKillEntry(killEntries[0]);
    }

    const enemyType = payload.enemyType;
    const typeText = enemyTypeLabel(enemyType);
    const scoreValue = readFiniteNumber(payload.score, 0);
    let headshot = readBoolean(payload.headshot, false);
    if (headshot === false) {
      headshot = readBoolean(payload.critical, false);
    }

    const entryElement = document.createElement('li');
    entryElement.className = 'kill-entry';

    const typeElement = document.createElement('span');
    typeElement.className = 'kill-type';
    typeElement.textContent = typeText;
    entryElement.appendChild(typeElement);

    const scoreElement = document.createElement('span');
    scoreElement.className = 'kill-score';
    scoreElement.textContent = '+' + String(Math.round(scoreValue));
    entryElement.appendChild(scoreElement);

    if (headshot) {
      const headshotElement = document.createElement('span');
      headshotElement.className = 'kill-headshot';
      headshotElement.textContent = '爆头';
      entryElement.appendChild(headshotElement);
    }

    const entry = { element: entryElement, timer: 0 };
    killEntries.push(entry);
    killfeedEl.appendChild(entryElement);

    entry.timer = window.setTimeout(() => {
      entryElement.classList.add('leaving');
      entry.timer = window.setTimeout(() => {
        removeKillEntry(entry);
      }, KILLFEED_FADE_MS);
    }, KILLFEED_LIFETIME_MS);
  }

  /**
   * @returns {void}
   */
  function flashDamage() {
    if (damageTimer !== 0) {
      window.clearTimeout(damageTimer);
    }
    damageEl.classList.remove('active');
    void damageEl.offsetWidth;
    damageEl.classList.add('active');
    damageTimer = window.setTimeout(() => {
      damageTimer = 0;
      damageEl.classList.remove('active');
    }, DAMAGE_FLASH_MS);
  }

  /**
   * 在准星周围画出攻击来源方向。`direction` 为相对玩家朝向的弧度：
   * 0 在正前方（画面上方），正值在右侧。
   *
   * @param {number} direction
   * @returns {void}
   */
  function showDamageDirection(direction) {
    const degrees = damageDirectionDegrees(direction);
    damageDirectionEl.style.setProperty('--damage-angle', degrees.toFixed(2) + 'deg');

    if (damageDirectionTimer !== 0) {
      window.clearTimeout(damageDirectionTimer);
    }
    damageDirectionEl.classList.remove('active');
    void damageDirectionEl.offsetWidth;
    damageDirectionEl.classList.add('active');
    damageDirectionTimer = window.setTimeout(() => {
      damageDirectionTimer = 0;
      damageDirectionEl.classList.remove('active');
    }, DAMAGE_DIRECTION_MS);
  }

  /**
   * @returns {void}
   */
  function clearDamageDirection() {
    if (damageDirectionTimer !== 0) {
      window.clearTimeout(damageDirectionTimer);
      damageDirectionTimer = 0;
    }
    damageDirectionEl.classList.remove('active');
  }

  /**
   * @param {boolean} killed
   * @param {boolean} headshot
   * @returns {void}
   */
  function showHitmarker(killed, headshot) {
    if (hitmarkerTimer !== 0) {
      window.clearTimeout(hitmarkerTimer);
    }
    hitmarkerEl.classList.remove('active');
    hitmarkerEl.classList.remove('kill');
    hitmarkerEl.classList.remove('headshot');
    if (killed) {
      hitmarkerEl.classList.add('kill');
    }
    if (headshot) {
      hitmarkerEl.classList.add('headshot');
    }
    void hitmarkerEl.offsetWidth;
    hitmarkerEl.classList.add('active');
    hitmarkerTimer = window.setTimeout(() => {
      hitmarkerTimer = 0;
      hitmarkerEl.classList.remove('active');
      hitmarkerEl.classList.remove('kill');
      hitmarkerEl.classList.remove('headshot');
    }, HITMARKER_MS);
  }

  /**
   * 应用 `hud:update` 载荷。
   *
   * @param {Record<string, unknown>} payload
   * @returns {void}
   */
  function applyHudUpdate(payload) {
    current.score = readFiniteNumber(payload.score, current.score);
    current.wave = readFiniteNumber(payload.wave, current.wave);
    current.kills = readFiniteNumber(payload.kills, current.kills);
    current.health = readFiniteNumber(payload.health, current.health);
    current.maxHealth = readFiniteNumber(payload.maxHealth, current.maxHealth);
    current.ammo = readFiniteNumber(payload.ammo, current.ammo);
    current.magazineSize = readFiniteNumber(
      payload.magazineSize,
      current.magazineSize
    );
    current.reloading = readBoolean(payload.reloading, current.reloading);
    current.reloadProgress = readFiniteNumber(
      payload.reloadProgress,
      current.reloadProgress
    );
    current.yaw = readFiniteNumber(payload.yaw, current.yaw);
    current.muted = readBoolean(payload.muted, current.muted);

    scoreEl.textContent = String(Math.round(current.score));
    waveEl.textContent = String(Math.round(current.wave));
    killsEl.textContent = String(Math.round(current.kills));

    const shownHealth = Math.max(0, Math.round(current.health));
    const maxHealth = Math.max(1, current.maxHealth);
    hpValueEl.textContent = String(shownHealth);
    hpMaxEl.textContent = String(Math.round(maxHealth));

    let healthRatio = current.health / maxHealth;
    if (healthRatio < 0) {
      healthRatio = 0;
    }
    if (healthRatio > 1) {
      healthRatio = 1;
    }
    hpFillEl.style.width = (healthRatio * 100).toFixed(1) + '%';

    const lowHealth = healthRatio <= LOW_HEALTH_RATIO;
    healthPanel.classList.toggle('low', lowHealth);
    lowHealthEl.classList.toggle('active', lowHealth);

    ammoEl.textContent = String(Math.max(0, Math.round(current.ammo)));

    let reloadProgress = current.reloadProgress;
    if (reloadProgress < 0) {
      reloadProgress = 0;
    }
    if (reloadProgress > 1) {
      reloadProgress = 1;
    }
    reloadFill.style.width = (reloadProgress * 100).toFixed(1) + '%';
    reloadBar.classList.toggle('active', current.reloading);
    toggleHidden(reloadLabel, current.reloading === false);

    toggleHidden(muteEl, current.muted === false);
    updateCompass(current.yaw);
  }

  /**
   * 应用对局状态，切换菜单、HUD、暂停与结算覆盖层。
   *
   * @param {string} nextState
   * @returns {void}
   */
  function applyState(nextState) {
    if (
      nextState !== 'menu' &&
      nextState !== 'playing' &&
      nextState !== 'paused' &&
      nextState !== 'over'
    ) {
      console.error('hud: 忽略未知对局状态 ' + String(nextState));
      return;
    }

    state = nextState;
    toggleHidden(menuEl, nextState !== 'menu');
    toggleHidden(hudEl, nextState === 'menu');
    toggleHidden(pauseEl, nextState !== 'paused');
    toggleHidden(gameoverEl, nextState !== 'over');
    toggleHidden(crosshairEl, nextState !== 'playing');
    toggleHidden(adsEl, nextState !== 'playing' || aiming === false);

    if (nextState === 'playing') {
      measureCompass();
      updateCompass(current.yaw);
    }
    if (nextState === 'menu') {
      clearKillfeed();
      hideBanner();
    }
    if (nextState === 'over') {
      hideBanner();
    }
  }

  /**
   * 清空本局临时展示，供开始/重开按钮调用。
   *
   * @returns {void}
   */
  function resetRoundUi() {
    clearKillfeed();
    hideBanner();
    if (hitmarkerTimer !== 0) {
      window.clearTimeout(hitmarkerTimer);
      hitmarkerTimer = 0;
    }
    hitmarkerEl.classList.remove('active');
    hitmarkerEl.classList.remove('kill');
    hitmarkerEl.classList.remove('headshot');
    if (damageTimer !== 0) {
      window.clearTimeout(damageTimer);
      damageTimer = 0;
    }
    damageEl.classList.remove('active');
    clearDamageDirection();
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleGameState(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: game:state 载荷无效');
      return;
    }
    const source = /** @type {Record<string, unknown>} */ (payload);
    const nextState = source.state;
    if (typeof nextState !== 'string') {
      console.error('hud: game:state 缺少字符串 state');
      return;
    }
    applyState(nextState);
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleHudUpdate(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: hud:update 载荷无效');
      return;
    }
    applyHudUpdate(/** @type {Record<string, unknown>} */ (payload));
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleHitmarker(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      showHitmarker(false, false);
      return;
    }
    const source = /** @type {Record<string, unknown>} */ (payload);
    showHitmarker(source.killed === true, source.headshot === true);
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleKillfeed(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: hud:killfeed 载荷无效');
      return;
    }
    addKillEntry(/** @type {Record<string, unknown>} */ (payload));
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleDamage(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: hud:damage 载荷无效');
      return;
    }
    const source = /** @type {Record<string, unknown>} */ (payload);
    flashDamage();
    const direction = source.direction;
    if (typeof direction === 'number' && Number.isFinite(direction)) {
      showDamageDirection(direction);
    }
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleBanner(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: hud:banner 载荷无效');
      return;
    }
    showBanner(/** @type {Record<string, unknown>} */ (payload));
  }

  /**
   * @param {unknown} payload
   * @returns {void}
   */
  function handleGameover(payload) {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      console.error('hud: hud:gameover 载荷无效');
      return;
    }
    const source = /** @type {Record<string, unknown>} */ (payload);
    goScore.textContent = String(
      Math.round(readFiniteNumber(source.score, current.score))
    );
    goWave.textContent = String(
      Math.round(readFiniteNumber(source.wave, current.wave))
    );
    goKills.textContent = String(
      Math.round(readFiniteNumber(source.kills, current.kills))
    );
    goTime.textContent = formatSurvivedTime(
      readFiniteNumber(source.survivedSeconds, 0)
    );
    if (state !== 'over') {
      applyState('over');
    }
  }

  /**
   * @returns {void}
   */
  function handleStartClick() {
    if (startBtn.disabled) {
      return;
    }
    resetRoundUi();
    invokeCallback('onStart');
  }

  /**
   * @returns {void}
   */
  function handleResumeClick() {
    invokeCallback('onResume');
  }

  /**
   * @returns {void}
   */
  function handleRestartClick() {
    resetRoundUi();
    invokeCallback('onRestart');
  }

  /**
   * 打开菜单/暂停中的设置面板。面板由界面公共入口创建并注入。
   *
   * @returns {void}
   */
  function handleSettingsClick() {
    if (settingsPanel === null) {
      console.error('hud: 未注入设置面板，无法打开设置');
      return;
    }
    try {
      settingsPanel.open();
    } catch (error) {
      console.error('hud: 打开设置面板失败', error);
    }
  }

  /**
   * @returns {void}
   */
  function handleWindowResize() {
    measureCompass();
    updateCompass(current.yaw);
  }

  /**
   * 设置装载状态。装载完成后启用开始按钮。
   *
   * @param {boolean} visible
   * @param {string} [message]
   * @returns {void}
   */
  function setLoading(visible, message) {
    if (typeof message === 'string' && message.length > 0) {
      loadingText.textContent = message;
    }
    toggleHidden(loadingEl, visible === false);
    startBtn.disabled = visible !== false;
  }

  /**
   * @param {boolean} nextAiming
   * @returns {void}
   */
  function setAimState(nextAiming) {
    aiming = nextAiming;
    crosshairEl.classList.toggle('aiming', nextAiming);
    toggleHidden(adsEl, nextAiming === false);
  }

  /**
   * @param {boolean} nextMoving
   * @returns {void}
   */
  function setMoving(nextMoving) {
    moving = nextMoving;
    crosshairEl.classList.toggle('moving', nextMoving);
  }

  /**
   * 读取 HUD 当前显示状态，供 O4 测试钩子使用。
   *
   * @returns {Object}
   */
  function getHud() {
    let settingsVisible = false;
    if (settingsPanel !== null) {
      try {
        settingsVisible = settingsPanel.isVisible() === true;
      } catch (error) {
        console.error('hud: 读取设置面板可见性失败', error);
      }
    }
    return {
      state,
      score: current.score,
      wave: current.wave,
      kills: current.kills,
      health: current.health,
      maxHealth: current.maxHealth,
      ammo: current.ammo,
      magazineSize: current.magazineSize,
      reloading: current.reloading,
      aiming,
      moving,
      muted: current.muted,
      menuVisible: menuEl.classList.contains('hidden') === false,
      pausedVisible: pauseEl.classList.contains('hidden') === false,
      gameoverVisible: gameoverEl.classList.contains('hidden') === false,
      settingsVisible
    };
  }

  buildCompass();
  measureCompass();
  applyState('menu');
  setLoading(false);
  startBtn.addEventListener('click', handleStartClick);
  resumeBtn.addEventListener('click', handleResumeClick);
  restartPauseBtn.addEventListener('click', handleRestartClick);
  restartBtn.addEventListener('click', handleRestartClick);
  menuSettingsBtn.addEventListener('click', handleSettingsClick);
  pauseSettingsBtn.addEventListener('click', handleSettingsClick);
  window.addEventListener('resize', handleWindowResize);

  unsubscribers.push(bus.on(EVENTS.GAME_STATE, handleGameState));
  unsubscribers.push(bus.on(EVENTS.HUD_UPDATE, handleHudUpdate));
  unsubscribers.push(bus.on(EVENTS.HUD_HITMARKER, handleHitmarker));
  unsubscribers.push(bus.on(EVENTS.HUD_KILLFEED, handleKillfeed));
  unsubscribers.push(bus.on(EVENTS.HUD_DAMAGE, handleDamage));
  unsubscribers.push(bus.on(EVENTS.HUD_BANNER, handleBanner));
  unsubscribers.push(bus.on(EVENTS.HUD_GAMEOVER, handleGameover));

  return {
    getHud,

    setAimState,

    setMoving,

    setLoading,

    resetRoundUi,

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;

      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('hud: 退订事件失败', error);
        }
      }
      unsubscribers.length = 0;

      startBtn.removeEventListener('click', handleStartClick);
      resumeBtn.removeEventListener('click', handleResumeClick);
      restartPauseBtn.removeEventListener('click', handleRestartClick);
      restartBtn.removeEventListener('click', handleRestartClick);
      menuSettingsBtn.removeEventListener('click', handleSettingsClick);
      pauseSettingsBtn.removeEventListener('click', handleSettingsClick);
      window.removeEventListener('resize', handleWindowResize);

      clearKillfeed();
      hideBanner();

      if (hitmarkerTimer !== 0) {
        window.clearTimeout(hitmarkerTimer);
        hitmarkerTimer = 0;
      }
      if (damageTimer !== 0) {
        window.clearTimeout(damageTimer);
        damageTimer = 0;
      }
      clearDamageDirection();
    }
  };
}
