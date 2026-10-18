/**
 * 战斗服务公共入口。
 *
 * Pipeline 只能从这里创建战斗服务。服务组合了四个内部模块：
 * - `collision.js`：圆-AABB 推移/滑动、射线-AABB、方向散布等纯数学。
 * - `weapon.js`：弹药、射击间隔、换弹、散布、后坐力/震动/FOV 冲击与伤害的纯状态机。
 * - `player.js`：移动、跳跃、重力、视角、生命与相机姿态。
 * - `view-model.js`：高细节第一人称步枪、戴手套的双手与视图动画。
 *
 * 本文件负责把这些纯逻辑接到渲染 Provider 的公共契约上，并把结果翻译成
 * `src/models/events.js` 中登记的事件。它不直接访问 `providers/impl/`，
 * 也不导入其他 Service、Pipeline 或 Interface。
 *
 * 伤害方向事件 `hud:damage` 由 Pipeline 统一发布（它知道攻击来源），
 * 战斗服务只负责生命值、恢复、死亡与 `player:died`。
 */

import { createInputCommand } from '../../models/contracts.js';
import { EVENTS } from '../../models/events.js';
import { GAME_CONFIG, normalizeSettings } from '../../models/game-config.js';

import {
  applySpreadToDirection,
  isValidCollider,
  raycastColliders
} from '../impl/combat/collision.js';
import {
  createPlayerState,
  damagePlayerState,
  getCameraPose,
  getPlayerSnapshot,
  healPlayerState,
  readSpawn,
  resetPlayerState,
  updatePlayer
} from '../impl/combat/player.js';
import {
  createWeaponState,
  getRecoilState,
  getReloadProgress,
  getShotDamage,
  getWeaponViewState,
  resetWeaponState,
  updateWeapon
} from '../impl/combat/weapon.js';
import { createViewModel } from '../impl/combat/view-model.js';

/** 默认画布尺寸（CSS 像素），与设计窗口一致。 */
const DEFAULT_VIEWPORT_WIDTH = 1600;
const DEFAULT_VIEWPORT_HEIGHT = 900;

/** 弹道线与命中火花的克制暖色（美术方向：不使用霓虹色）。 */
const TRACER_COLOR = 0xffd9a0;
const IMPACT_COLOR = 0xcfc0a4;
const BLOOD_COLOR = 0x7a1f18;

/** 同一进程内“没有素材加载器，使用程序化材质”只提示一次。 */
let proceduralFallbackLogged = false;

/**
 * 判断一个值是否是有限数字。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断对象是否拥有某个自有字段。
 *
 * @param {object} source
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * 校验渲染器实现了战斗服务需要的公共方法。
 *
 * @param {unknown} renderer
 * @returns {void}
 */
function assertRenderer(renderer) {
  if (renderer === null || renderer === undefined) {
    throw new TypeError(
      'createCombat 缺少 renderer：请传入 src/providers/public/renderer.js 创建的渲染器'
    );
  }
  if (typeof renderer !== 'object') {
    throw new TypeError('createCombat 的 renderer 必须是渲染 Provider 返回的对象');
  }
  const requiredMethods = [
    'setCameraPose',
    'getWorldPosition',
    'raycast',
    'attachToCamera',
    'detachFromCamera'
  ];
  for (const method of requiredMethods) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError('createCombat 的 renderer 缺少方法 ' + method);
    }
  }
}

/**
 * 校验目标查询契约。
 *
 * @param {unknown} targetQuery
 * @returns {void}
 */
function assertTargetQuery(targetQuery) {
  if (targetQuery === null || targetQuery === undefined) {
    throw new TypeError(
      'createCombat 缺少 targetQuery：需要 { listHittable, applyDamage }'
    );
  }
  if (typeof targetQuery !== 'object') {
    throw new TypeError('createCombat 的 targetQuery 必须是对象');
  }
  if (typeof targetQuery.listHittable !== 'function') {
    throw new TypeError('createCombat 的 targetQuery 缺少 listHittable()');
  }
  if (typeof targetQuery.applyDamage !== 'function') {
    throw new TypeError('createCombat 的 targetQuery 缺少 applyDamage()');
  }
}

/**
 * 校验事件发射函数。
 *
 * @param {unknown} emit
 * @returns {void}
 */
function assertEmit(emit) {
  if (typeof emit !== 'function') {
    throw new TypeError(
      'createCombat 缺少 emit 函数：需要 emit(eventName, payload)'
    );
  }
}

/**
 * 校验可选的素材加载器。提供时必须是 Provider 公共入口的加载器。
 *
 * @param {unknown} assets
 * @returns {void}
 */
function assertAssets(assets) {
  if (assets === undefined || assets === null) {
    return;
  }
  if (typeof assets !== 'object') {
    throw new TypeError('createCombat 的 assets 必须是素材加载器对象');
  }
  if (typeof assets.loadTexture !== 'function') {
    throw new TypeError('createCombat 的 assets 缺少 loadTexture()');
  }
  if (typeof assets.loadManifest !== 'function') {
    throw new TypeError('createCombat 的 assets 缺少 loadManifest()');
  }
}

/**
 * 读取可选的画布尺寸。
 *
 * 渲染 Provider 契约目前没有暴露画布宽高；服务需要它把屏幕中心换算成世界射线。
 * 因此这里接受可选的 `viewport`，缺省使用设计窗口 1600 × 900。
 *
 * @param {unknown} viewport
 * @returns {{ width: number, height: number }}
 */
function readViewport(viewport) {
  const result = {
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT
  };
  if (viewport === undefined || viewport === null) {
    return Object.freeze(result);
  }
  if (typeof viewport !== 'object') {
    throw new TypeError('createCombat 的 viewport 必须是 { width, height } 对象');
  }
  const source = /** @type {Record<string, unknown>} */ (viewport);
  if (
    !isFiniteNumber(source.width) ||
    source.width <= 0 ||
    !isFiniteNumber(source.height) ||
    source.height <= 0
  ) {
    throw new RangeError('createCombat 的 viewport 宽高必须是大于 0 的有限数字');
  }
  result.width = /** @type {number} */ (source.width);
  result.height = /** @type {number} */ (source.height);
  return Object.freeze(result);
}

/**
 * 复制并冻结竞技场碰撞体，过滤无效项并报告。
 *
 * 服务只读消费碰撞体，不复用外部可变对象，避免帧间被意外修改。
 *
 * @param {unknown} colliders
 * @returns {ReadonlyArray<import('../abstract/combat.js').Collider>}
 */
function normalizeColliders(colliders) {
  if (colliders === undefined || colliders === null) {
    return Object.freeze([]);
  }
  if (!Array.isArray(colliders)) {
    throw new TypeError('createCombat 的 colliders 必须是碰撞体数组');
  }
  const result = [];
  for (const collider of colliders) {
    if (!isValidCollider(collider)) {
      console.error('combat: 忽略无效碰撞体（缺少有限 min/max 或 min 大于 max）', collider);
      continue;
    }
    result.push(
      Object.freeze({
        min: Object.freeze({
          x: collider.min.x,
          y: collider.min.y,
          z: collider.min.z
        }),
        max: Object.freeze({
          x: collider.max.x,
          y: collider.max.y,
          z: collider.max.z
        })
      })
    );
  }
  return Object.freeze(result);
}

/**
 * 只保留战斗相关设置字段并冻结。
 *
 * @param {Readonly<import('../../models/contracts.js').Settings>} source
 * @returns {Readonly<{ mouseSensitivity: number, adsSensitivityMultiplier: number, fov: number }>}
 */
function toCombatSettings(source) {
  return Object.freeze({
    mouseSensitivity: source.mouseSensitivity,
    adsSensitivityMultiplier: source.adsSensitivityMultiplier,
    fov: source.fov
  });
}

/**
 * 沿方向延长一段距离，返回终点坐标。
 *
 * @param {{ x: number, y: number, z: number }} origin
 * @param {{ x: number, y: number, z: number }} direction
 * @param {number} distance
 * @returns {{ x: number, y: number, z: number }}
 */
function extendRay(origin, direction, distance) {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance
  };
}

/**
 * 判断目标查询返回的标识是否可用。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isUsableTargetId(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 读取射线命中对象的 `userData`。
 *
 * @param {{
 *   object?: { userData?: Record<string, unknown> },
 *   userData?: Record<string, unknown>,
 *   point: { x: number, y: number, z: number },
 *   normal: { x: number, y: number, z: number },
 *   distance: number
 * }} hit
 * @returns {Record<string, unknown>}
 */
function readUserData(hit) {
  if (hit.userData !== null && typeof hit.userData === 'object') {
    return hit.userData;
  }
  const object = hit.object;
  if (
    object !== null &&
    object !== undefined &&
    typeof object === 'object' &&
    object.userData !== null &&
    typeof object.userData === 'object'
  ) {
    return object.userData;
  }
  return {};
}

/**
 * 创建战斗服务。
 *
 * @param {import('../abstract/combat.js').CreateCombatOptions} options
 * @returns {import('../abstract/combat.js').CombatService}
 */
export function createCombat(options) {
  if (options === null || options === undefined || typeof options !== 'object') {
    throw new TypeError(
      'createCombat 需要参数对象 { renderer, colliders, targetQuery, emit }'
    );
  }

  const renderer = options.renderer;
  const targetQuery = options.targetQuery;
  const emit = options.emit;
  const assets = options.assets;

  assertRenderer(renderer);
  assertTargetQuery(targetQuery);
  assertEmit(emit);
  assertAssets(assets);

  const spawn = readSpawn(options.spawn);
  const colliders = normalizeColliders(options.colliders);
  const viewport = readViewport(options.viewport);

  const player = createPlayerState(spawn);
  const weapon = createWeaponState();
  const weaponView = createViewModel(renderer);

  let settings = toCombatSettings(normalizeSettings());
  let disposed = false;
  let deathEmitted = false;
  let loadPromise = null;
  let loadFinished = false;

  /**
   * 发出事件；单个监听器抛错不能中断战斗逻辑，但必须记录。
   *
   * @param {string} eventName
   * @param {Object} payload
   * @returns {void}
   */
  function safeEmit(eventName, payload) {
    try {
      emit(eventName, payload);
    } catch (error) {
      console.error('combat: 事件处理失败 ' + eventName, error);
    }
  }

  /**
   * 把当前玩家与武器状态写入相机。
   *
   * @param {boolean} [aimingOverride] 本帧的瞄准状态；省略时使用武器状态。
   * @returns {void}
   */
  function applyCameraPose(aimingOverride) {
    let aiming = weapon.aiming;
    if (typeof aimingOverride === 'boolean') {
      aiming = aimingOverride;
    }
    const recoil = getRecoilState(weapon);
    const pose = getCameraPose(player, recoil, aiming, settings);
    try {
      renderer.setCameraPose(pose);
    } catch (error) {
      console.error('combat: 设置相机姿态失败', error);
    }
  }

  /**
   * 读取可射线检测的敌人对象。
   *
   * @returns {unknown[]}
   */
  function listTargetObjects() {
    let entries = null;
    try {
      entries = targetQuery.listHittable();
    } catch (error) {
      console.error('combat: 目标查询 listHittable() 失败', error);
      return [];
    }
    if (!Array.isArray(entries)) {
      console.error('combat: 目标查询 listHittable() 必须返回数组');
      return [];
    }
    const objects = [];
    for (const entry of entries) {
      if (entry !== null && typeof entry === 'object' && entry.object) {
        objects.push(entry.object);
      }
    }
    return objects;
  }

  /**
   * 对目标施加一次伤害，并发出命中/击杀反馈。
   *
   * 爆头伤害在调用前乘算且只乘一次；`applyDamage` 返回的 `headshot`/`critical`
   * 只用于反馈与计分展示，不再参与伤害计算。
   *
   * @param {string} targetId
   * @param {boolean} headshot
   * @returns {Object|null} 目标查询返回的伤害结果。
   */
  function applyDamageToTarget(targetId, headshot) {
    const damage = getShotDamage(headshot);
    let result = null;
    try {
      result = targetQuery.applyDamage(targetId, damage);
    } catch (error) {
      console.error('combat: 目标伤害结算失败 targetId=' + targetId, error);
    }

    let killed = false;
    if (result !== null && result !== undefined && result.killed === true) {
      killed = true;
    }

    safeEmit(EVENTS.HUD_HITMARKER, { killed, headshot });

    if (!killed) {
      return result;
    }

    safeEmit(EVENTS.ENEMY_KILLED, {
      enemyType: result.enemyType,
      score: result.score,
      headshot,
      critical: headshot,
      position: result.position,
      color: result.color
    });
    return result;
  }

  /**
   * 执行一次命中扫描，并发出弹道、命中、血雾与击杀事件。
   *
   * @param {number} spread 当前散布角（弧度）。
   * @returns {void}
   */
  function fireShot(spread) {
    let ray = null;
    try {
      ray = renderer.getWorldPosition(viewport.width / 2, viewport.height / 2);
    } catch (error) {
      console.error('combat: 渲染器 getWorldPosition() 失败，跳过本发子弹', error);
      return;
    }

    const origin = ray.origin;
    const direction = applySpreadToDirection(
      ray.direction,
      spread,
      Math.random(),
      Math.random()
    );
    const range = GAME_CONFIG.weapon.range;

    const targets = listTargetObjects();
    let rendererHit = null;
    try {
      rendererHit = renderer.raycast(origin, direction, range, targets);
    } catch (error) {
      console.error('combat: 渲染器 raycast() 失败，本发只做世界碰撞', error);
      rendererHit = null;
    }

    let targetId = null;
    let targetHeadshot = false;
    let worldImpact = null;

    if (rendererHit !== null && rendererHit !== undefined) {
      const userData = readUserData(rendererHit);
      if (isUsableTargetId(userData.targetId)) {
        targetId = userData.targetId;
        if (userData.part === 'head') {
          targetHeadshot = true;
        }
      } else {
        worldImpact = {
          distance: rendererHit.distance,
          point: rendererHit.point,
          normal: rendererHit.normal
        };
      }
    }

    const colliderHit = raycastColliders(origin, direction, range, colliders);
    if (colliderHit !== null) {
      if (worldImpact === null || colliderHit.distance < worldImpact.distance) {
        worldImpact = {
          distance: colliderHit.distance,
          point: colliderHit.point,
          normal: colliderHit.normal
        };
      }
    }

    let targetIsClosest = false;
    if (targetId !== null) {
      if (worldImpact === null) {
        targetIsClosest = true;
      } else if (rendererHit.distance <= worldImpact.distance) {
        targetIsClosest = true;
      }
    }

    let endPoint = extendRay(origin, direction, range);
    if (targetIsClosest) {
      endPoint = rendererHit.point;
    } else if (worldImpact !== null) {
      endPoint = worldImpact.point;
    }

    safeEmit(EVENTS.WORLD_SHOT, {
      from: { x: origin.x, y: origin.y, z: origin.z },
      to: endPoint,
      muzzlePosition: weaponView.getMuzzleWorldPosition(),
      color: TRACER_COLOR
    });

    if (targetIsClosest) {
      const result = applyDamageToTarget(targetId, targetHeadshot);
      let bloodColor = BLOOD_COLOR;
      if (
        result !== null &&
        result !== undefined &&
        isFiniteNumber(result.color)
      ) {
        bloodColor = result.color;
      }
      safeEmit(EVENTS.WORLD_BLOOD, {
        position: endPoint,
        direction: { x: direction.x, y: direction.y, z: direction.z },
        color: bloodColor
      });
      return;
    }

    if (worldImpact !== null) {
      safeEmit(EVENTS.WORLD_IMPACT, {
        position: worldImpact.point,
        normal: worldImpact.normal,
        color: IMPACT_COLOR
      });
    }
  }

  /**
   * 推进第一人称视图动画。
   *
   * @param {number} step 已限制上限的帧时间。
   * @param {import('../../models/contracts.js').InputCommand} command 输入。
   * @param {boolean} moving 玩家本帧是否实际移动。
   * @returns {void}
   */
  function updateWeaponView(step, command, moving) {
    weaponView.update(step, {
      aiming: command.aim === true,
      moving,
      sprinting: command.sprint === true,
      reloading: weapon.reloading,
      reloadProgress: getReloadProgress(weapon),
      reloadDuration: GAME_CONFIG.weapon.reloadDuration
    });
  }

  /**
   * 复位整局战斗状态。
   *
   * @returns {void}
   */
  function reset() {
    if (disposed) {
      return;
    }
    resetPlayerState(player, spawn);
    resetWeaponState(weapon);
    weaponView.reset();
    deathEmitted = false;
    applyCameraPose(false);
  }

  /**
   * 推进一帧。
   *
   * @param {number} deltaSeconds
   * @param {import('../../models/contracts.js').InputCommand} input
   * @returns {void}
   */
  function update(deltaSeconds, input) {
    if (disposed) {
      return;
    }
    if (!isFiniteNumber(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('combat.update 的 deltaSeconds 必须是大于等于 0 的有限数字');
    }

    const step = Math.min(deltaSeconds, GAME_CONFIG.match.deltaClamp);
    const command = createInputCommand(input);

    if (!player.alive) {
      applyCameraPose(command.aim);
      updateWeaponView(step, command, false);
      return;
    }

    const motion = updatePlayer(
      player,
      step,
      command,
      colliders,
      command.aim,
      settings
    );

    // 先写入不含本帧后坐力的姿态，保证本发子弹使用当前准星方向。
    applyCameraPose(command.aim);

    const weaponResult = updateWeapon(weapon, step, {
      fire: command.fire,
      reload: command.reload,
      aim: command.aim,
      moving: motion.moving
    });

    if (weaponResult.startedReload) {
      safeEmit(EVENTS.WEAPON_RELOAD_START, {
        durationSeconds: GAME_CONFIG.weapon.reloadDuration
      });
    }
    if (weaponResult.finishedReload) {
      safeEmit(EVENTS.WEAPON_RELOAD_END, {});
    }
    if (weaponResult.emptyTriggered) {
      safeEmit(EVENTS.WEAPON_EMPTY, {});
    }
    if (weaponResult.fired) {
      const eject = weaponView.triggerFire();
      if (eject !== null) {
        safeEmit(EVENTS.WEAPON_SHELL_EJECT, eject);
      }
      fireShot(weaponResult.spread);
    }

    updateWeaponView(step, command, motion.moving);

    // 开火后带上后坐力抬升、滚转、震动与 FOV 冲击。
    applyCameraPose(weapon.aiming);
  }

  /**
   * 对玩家造成伤害。
   *
   * `hud:damage` 由 Pipeline 统一发布（它负责结合攻击来源计算方向）；
   * 战斗服务只扣血、重置恢复延迟，并在生命归零时发出一次 `player:died`。
   *
   * @param {number} amount
   * @returns {void}
   */
  function damagePlayer(amount) {
    if (disposed) {
      return;
    }
    const result = damagePlayerState(player, amount);
    if (result.applied <= 0) {
      return;
    }
    if (result.died && !deathEmitted) {
      deathEmitted = true;
      weaponView.setVisible(false);
      safeEmit(EVENTS.PLAYER_DIED, {});
    }
  }

  /**
   * 恢复玩家生命（拾取物使用）。
   *
   * @param {number} amount
   * @returns {void}
   */
  function heal(amount) {
    if (disposed) {
      return;
    }
    healPlayerState(player, amount);
  }

  /**
   * 返回 Model 约定的玩家只读快照。
   *
   * @returns {import('../../models/contracts.js').PlayerSnapshot}
   */
  function getSnapshot() {
    return getPlayerSnapshot(player);
  }

  /**
   * 返回武器只读状态。
   *
   * @returns {import('../abstract/combat.js').WeaponState}
   */
  function getWeaponState() {
    return getWeaponViewState(weapon);
  }

  /**
   * 显示或隐藏第一人称视图模型（含双手、枪口闪光、烟雾与弹壳）。
   *
   * 主菜单等非对局状态可以由 Pipeline 隐藏武器，避免遮挡菜单场景展示。
   * 默认可见；`reset()` 会把武器恢复为可见，调用方若仍需隐藏应在 reset 后重新调用。
   *
   * @param {boolean} visible
   * @returns {void}
   */
  function setViewVisible(visible) {
    if (typeof visible !== 'boolean') {
      throw new TypeError('combat.setViewVisible 的 visible 必须是布尔值');
    }
    if (disposed) {
      return;
    }
    weaponView.setVisible(visible);
  }

  /**
   * 应用战斗相关设置（鼠标灵敏度、ADS 灵敏度倍率、视野）。
   *
   * 使用 Model 的 `normalizeSettings` 校验和夹紧：数字超范围夹到边界，
   * 非数字抛 `TypeError`。未提供的字段保持当前值。
   *
   * @param {Partial<{ mouseSensitivity: number, adsSensitivityMultiplier: number, fov: number }>} [partial]
   * @returns {Readonly<{ mouseSensitivity: number, adsSensitivityMultiplier: number, fov: number }>}
   */
  function setSettings(partial) {
    if (disposed) {
      return getSettings();
    }
    if (partial === undefined || partial === null) {
      return getSettings();
    }
    if (typeof partial !== 'object' || Array.isArray(partial)) {
      throw new TypeError('combat.setSettings 的参数必须是对象');
    }
    const source = /** @type {Record<string, unknown>} */ (partial);
    const patch = {
      mouseSensitivity: settings.mouseSensitivity,
      adsSensitivityMultiplier: settings.adsSensitivityMultiplier,
      fov: settings.fov
    };
    if (hasOwn(source, 'mouseSensitivity')) {
      patch.mouseSensitivity = source.mouseSensitivity;
    }
    if (hasOwn(source, 'adsSensitivityMultiplier')) {
      patch.adsSensitivityMultiplier = source.adsSensitivityMultiplier;
    }
    if (hasOwn(source, 'fov')) {
      patch.fov = source.fov;
    }
    settings = toCombatSettings(normalizeSettings(patch));
    return getSettings();
  }

  /**
   * 返回战斗相关设置的冻结副本。
   *
   * @returns {Readonly<{ mouseSensitivity: number, adsSensitivityMultiplier: number, fov: number }>}
   */
  function getSettings() {
    return Object.freeze({
      mouseSensitivity: settings.mouseSensitivity,
      adsSensitivityMultiplier: settings.adsSensitivityMultiplier,
      fov: settings.fov
    });
  }

  /**
   * 异步预加载第一人称视图模型的 PBR 贴图。
   *
   * - 幂等：重复调用返回同一个 Promise，加载完成后立即 resolve。
   * - 没有 `assets` 时使用程序化材质，并只记录一次提示。
   * - 加载失败时记录具体错误并继续使用程序化材质，不阻断对局。
   * - 贴图来自素材加载器缓存，视图模型不负责释放共享贴图。
   *
   * @returns {Promise<void>}
   */
  function load() {
    if (loadFinished) {
      return Promise.resolve();
    }
    if (loadPromise !== null) {
      return loadPromise;
    }
    loadPromise = runLoad();
    return loadPromise;
  }

  /**
   * @returns {Promise<void>}
   */
  async function runLoad() {
    if (disposed) {
      loadFinished = true;
      return;
    }
    if (assets === undefined || assets === null) {
      if (!proceduralFallbackLogged) {
        proceduralFallbackLogged = true;
        console.info(
          'combat: 未提供 assets 素材加载器，第一人称视图模型使用程序化材质'
        );
      }
      loadFinished = true;
      return;
    }
    try {
      await weaponView.loadTextures(assets);
    } catch (error) {
      console.error(
        'combat: 第一人称视图模型贴图加载失败，继续使用程序化材质',
        error
      );
    }
    loadFinished = true;
  }

  /**
   * 释放第一人称视图模型。
   *
   * @returns {void}
   */
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    weaponView.dispose();
  }

  return {
    reset,
    update,
    damagePlayer,
    heal,
    getSnapshot,
    getWeaponState,
    setViewVisible,
    setSettings,
    getSettings,
    load,
    dispose
  };
}
