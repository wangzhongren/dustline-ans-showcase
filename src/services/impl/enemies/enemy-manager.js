/**
 * 敌方服务编排：波次生成、人类士兵集合、命中目标登记、弹丸、尸体与拾取物。
 *
 * 调用方向：Pipeline → `src/services/public/enemies.js` → 本文件；
 * 本文件只使用共享 Model、Provider 公共入口（经由内部模块）与自身实现文件，
 * 不导入其他 Service、Pipeline、Interface。
 *
 * 事件约定：
 * - 生成敌人：`world:enemy-spawn { position, color }`
 * - 敌人开火：`world:enemy-shot { position, direction, color, enemyType }`
 * - 命中/死亡血雾：`world:blood { position, direction, color }`
 * - 掉落生命球：`pickup:spawn { position, amount }`
 * - 拾取生命球：`pickup:collected { position, amount }`
 * - 玩家受伤：`player:damage { amount, sourcePosition }`
 *
 * 得分与击杀提示（`hud:killfeed`、`enemy:killed`）由 Pipeline 根据
 * `applyDamage()` 的返回值决定，本服务不发出。
 */

import { EVENTS } from '../../../models/events.js';
import { ENEMY_TYPES, GAME_CONFIG } from '../../../models/game-config.js';
import { createEnemy } from './enemy.js';
import {
  createProjectile,
  PROJECTILE_STATUS
} from './projectile.js';
import { createPickup, PICKUP_STATUS } from './pickup.js';
import {
  disposeHumanModelCache,
  loadHumanModelCache
} from './human-visual.js';
import {
  createEnemyStats,
  createWavePlan,
  shouldDropPickup
} from './waves.js';

/** 血雾颜色（暗红，低饱和）。 */
const BLOOD_COLOR = 0x7a1f19;

/**
 * 未命中时返回的默认结果。`enemyType` 使用 Model 的默认值，避免调用方
 * 在未命中时读到空字符串。
 *
 * @returns {{
 *   hit:boolean, killed:boolean, headshot:boolean, critical:boolean,
 *   position:{x:number,y:number,z:number},
 *   color:number, score:number, enemyType:string
 * }}
 */
function createMissResult() {
  return {
    hit: false,
    killed: false,
    headshot: false,
    critical: false,
    position: { x: 0, y: 0, z: 0 },
    color: 0xffffff,
    score: 0,
    enemyType: ENEMY_TYPES.RIFLEMAN
  };
}

/**
 * 判断生成点是否是有效的普通三维点。
 *
 * @param {unknown} point
 * @returns {boolean}
 */
function isValidSpawnPoint(point) {
  if (point === null || typeof point !== 'object') {
    return false;
  }
  const source = /** @type {Record<string, unknown>} */ (point);
  return (
    typeof source.x === 'number' &&
    Number.isFinite(source.x) &&
    typeof source.y === 'number' &&
    Number.isFinite(source.y) &&
    typeof source.z === 'number' &&
    Number.isFinite(source.z)
  );
}

/**
 * 校验并归一化玩家快照。只保留敌方服务需要的字段。
 *
 * @param {unknown} snapshot
 * @returns {{ x:number, y:number, z:number, eyeHeight:number, alive:boolean }}
 */
function normalizePlayerSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') {
    throw new TypeError('敌方服务 update: playerSnapshot 必须是对象');
  }
  const source = /** @type {Record<string, unknown>} */ (snapshot);
  if (
    typeof source.x !== 'number' ||
    !Number.isFinite(source.x) ||
    typeof source.y !== 'number' ||
    !Number.isFinite(source.y) ||
    typeof source.z !== 'number' ||
    !Number.isFinite(source.z)
  ) {
    throw new TypeError('敌方服务 update: playerSnapshot 的 x/y/z 必须是有限数字');
  }

  let eyeHeight = GAME_CONFIG.player.eyeHeight;
  if (
    typeof source.eyeHeight === 'number' &&
    Number.isFinite(source.eyeHeight) &&
    source.eyeHeight > 0
  ) {
    eyeHeight = source.eyeHeight;
  }

  let alive = true;
  if (typeof source.alive === 'boolean') {
    alive = source.alive;
  }

  return {
    x: source.x,
    y: source.y,
    z: source.z,
    eyeHeight,
    alive
  };
}

/**
 * 把 Group.position 读成普通对象，避免把 Three.js 实例交给上层。
 *
 * @param {{ x:number, y:number, z:number }} position
 * @returns {{ x:number, y:number, z:number }}
 */
function toPlainPosition(position) {
  return { x: position.x, y: position.y, z: position.z };
}

/**
 * 创建敌方服务实例。工厂参数由公共入口校验。
 *
 * @param {{
 *   renderer: { add: (object:unknown) => void, remove: (object:unknown) => void },
 *   colliders: Array<{ min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number} }>,
 *   getSpawnPoint: (request:{ playerPosition:{x:number,y:number,z:number}, minDistance:number }) => { x:number,y:number,z:number },
 *   emit: (name:string, payload:Object) => void,
 *   assets?: { loadManifest?: Function, loadGltf?: Function }
 * }} options
 * @returns {import('../../abstract/enemies.js').EnemiesService}
 */
export function createEnemiesManager(options) {
  const renderer = options.renderer;
  const colliders = options.colliders;
  const getSpawnPoint = options.getSpawnPoint;
  const emit = options.emit;
  const assets = options.assets;

  /** @type {Map<string, ReturnType<typeof createEnemy>>} 存活敌人。 */
  const enemies = new Map();
  /** @type {ReturnType<typeof createEnemy>[]} 死亡后仍在场景中的尸体。 */
  const corpses = [];
  /** @type {Map<string, { enemy: ReturnType<typeof createEnemy>, part: string }>} */
  const targets = new Map();
  /** @type {Array<ReturnType<typeof createProjectile>>} */
  const projectiles = [];
  /** @type {Array<ReturnType<typeof createPickup>>} */
  const pickups = [];

  /** @type {Map<string, Object|null>} 人类模型模板缓存。 */
  let modelCache = new Map();
  /** @type {Promise<void>|null} */
  let loadPromise = null;

  let disposed = false;
  let modelsDisposed = false;
  let wave = 0;
  let pendingTypes = [];
  let totalInWave = 0;
  let spawned = 0;
  let spawnCooldown = 0;
  let waveComplete = false;
  let nextEnemyId = 1;

  /**
   * 预加载四个人类 GLB。幂等：重复调用返回同一个 Promise。
   * 任何加载失败都由 `loadHumanModelCache` 记录并回退，不会中断对局。
   *
   * @returns {Promise<void>}
   */
  function load() {
    if (loadPromise === null) {
      loadPromise = (async function loadModels() {
        let cache = null;
        try {
          cache = await loadHumanModelCache({ assets });
        } catch (error) {
          console.error('敌方服务：人类模型预加载失败，使用程序化回退。', error);
          cache = new Map();
        }
        if (disposed) {
          disposeHumanModelCache(cache);
          return;
        }
        modelCache = cache;
      })();
    }
    return loadPromise;
  }

  /**
   * 记录一个敌人的全部可命中网格。
   *
   * @param {ReturnType<typeof createEnemy>} enemy
   * @returns {void}
   */
  function registerTargets(enemy) {
    for (const mesh of enemy.listHittable()) {
      targets.set(mesh.userData.targetId, {
        enemy,
        part: mesh.userData.part
      });
    }
  }

  /**
   * 移除一个敌人的全部可命中登记。
   *
   * @param {ReturnType<typeof createEnemy>} enemy
   * @param {Object[]} [meshes] 已知网格；省略时读取当前列表。
   * @returns {void}
   */
  function unregisterTargets(enemy, meshes) {
    let list = meshes;
    if (list === undefined) {
      list = enemy.listHittable();
    }
    for (const mesh of list) {
      targets.delete(mesh.userData.targetId);
    }
  }

  /**
   * 当前波次是否已经结束（全部生成且全部消灭）。尸体不计入存活。
   *
   * @returns {void}
   */
  function refreshWaveComplete() {
    if (wave > 0 && pendingTypes.length === 0 && enemies.size === 0) {
      waveComplete = true;
    }
  }

  /**
   * 为一个新敌人选择模型 id。步枪兵在三个变体间随机，其他兵种固定。
   *
   * @param {string} type
   * @returns {string}
   */
  function pickModelId(type) {
    const pool = GAME_CONFIG.enemies[type].modelPool;
    let modelId = pool[0];
    if (pool.length > 1) {
      const index = Math.floor(Math.random() * pool.length);
      if (index >= 0 && index < pool.length) {
        modelId = pool[index];
      }
    }
    return modelId;
  }

  /**
   * 生成一个敌人。生成点无效或查询抛错时记录错误并返回 false，
   * 待生成队列保持不变，等下一次 update 重试。
   *
   * @param {{ x:number, y:number, z:number, eyeHeight:number, alive:boolean }} player
   * @returns {boolean}
   */
  function spawnNextEnemy(player) {
    const type = pendingTypes[0];
    let spawnPoint;
    try {
      spawnPoint = getSpawnPoint({
        playerPosition: { x: player.x, y: player.y, z: player.z },
        minDistance: GAME_CONFIG.arena.minPlayerDistance
      });
    } catch (error) {
      console.error('敌方服务：生成点查询失败，本帧暂停生成。', error);
      return false;
    }
    if (!isValidSpawnPoint(spawnPoint)) {
      console.error('敌方服务：生成点不是有效三维坐标，本帧暂停生成。', spawnPoint);
      return false;
    }

    const stats = createEnemyStats(type, wave);
    const modelId = pickModelId(type);
    let model = null;
    if (modelCache.has(modelId)) {
      model = modelCache.get(modelId);
    }
    const enemy = createEnemy({
      id: 'enemy-' + nextEnemyId,
      type,
      modelId,
      model,
      stats,
      position: toPlainPosition(spawnPoint)
    });
    nextEnemyId += 1;

    pendingTypes.shift();
    spawned += 1;
    enemies.set(enemy.id, enemy);
    registerTargets(enemy);
    renderer.add(enemy.root);
    emit(EVENTS.WORLD_ENEMY_SPAWN, {
      position: toPlainPosition(enemy.root.position),
      color: enemy.color
    });
    return true;
  }

  /**
   * 发出玩家受伤事件。敌方服务不直接修改玩家生命。
   *
   * @param {number} amount
   * @param {{ x:number, y:number, z:number }} sourcePosition
   * @returns {void}
   */
  function damagePlayer(amount, sourcePosition) {
    const payload = { amount };
    if (sourcePosition !== null && sourcePosition !== undefined) {
      payload.sourcePosition = toPlainPosition(sourcePosition);
    }
    emit(EVENTS.PLAYER_DAMAGE, payload);
  }

  /**
   * 创建一枚敌方弹丸、加入场景并发出曳光事件。
   *
   * @param {{
   *   position:{x:number,y:number,z:number},
   *   direction:{x:number,y:number,z:number},
   *   speed:number,
   *   damage:number,
   *   color?:number,
   *   enemyType?:string
   * }} shot
   * @returns {void}
   */
  function spawnProjectile(shot) {
    const projectile = createProjectile(shot);
    renderer.add(projectile.mesh);
    projectiles.push(projectile);
    emit(EVENTS.WORLD_ENEMY_SHOT, {
      position: toPlainPosition(shot.position),
      direction: toPlainPosition(shot.direction),
      color: shot.color,
      enemyType: shot.enemyType
    });
  }

  /**
   * 发出血雾事件。
   *
   * @param {{x:number,y:number,z:number}} position
   * @param {{x:number,y:number,z:number}} direction
   * @returns {void}
   */
  function emitBlood(position, direction) {
    emit(EVENTS.WORLD_BLOOD, {
      position: toPlainPosition(position),
      direction: toPlainPosition(direction),
      color: BLOOD_COLOR
    });
  }

  /**
   * 在死亡位置按概率生成生命球，并发出 `pickup:spawn`。
   * 生命球沿竖直方向落到竞技场地面（y = 0），保留死亡的 X/Z。
   *
   * @param {{ x:number,y:number,z:number }} position
   * @returns {void}
   */
  function spawnPickupAt(position) {
    const dropPosition = {
      x: position.x,
      y: 0,
      z: position.z
    };
    const pickup = createPickup({
      position: dropPosition,
      amount: GAME_CONFIG.arena.pickupHealAmount
    });
    renderer.add(pickup.group);
    pickups.push(pickup);
    emit(EVENTS.PICKUP_SPAWN, {
      position: pickup.getPosition(),
      amount: pickup.amount
    });
  }

  /**
   * 命中目标查询。`listHittable()` 返回 `[{ object, targetId }]` 条目：
   * `object` 是命中盒网格本身，网格的 `userData` 带有 `{ targetId, part }`。
   * 头/身使用不同 `targetId`，`applyDamage` 通过查表得到命中部位。
   *
   * @returns {import('../../abstract/enemies.js').HitTargetQuery}
   */
  function getTargetQuery() {
    return targetQuery;
  }

  /**
   * @param {string} targetId
   * @param {number} damage
   * @returns {import('../../abstract/enemies.js').DamageResult}
   */
  function applyDamage(targetId, damage) {
    if (typeof targetId !== 'string' || targetId.length === 0) {
      throw new TypeError('敌方服务 applyDamage: targetId 必须是非空字符串');
    }
    if (typeof damage !== 'number' || !Number.isFinite(damage)) {
      throw new TypeError('敌方服务 applyDamage: damage 必须是有限数字');
    }

    const entry = targets.get(targetId);
    if (entry === undefined) {
      return createMissResult();
    }
    const enemy = entry.enemy;
    if (!enemies.has(enemy.id)) {
      targets.delete(targetId);
      return createMissResult();
    }

    const headshot = entry.part === 'head';
    const position = toPlainPosition(enemy.root.position);
    const hitPosition = enemy.getHitPosition(entry.part);
    const hittableBefore = enemy.listHittable();
    const outcome = enemy.applyDamage(damage);

    emitBlood(hitPosition, enemy.getSprayDirection());

    if (!outcome.killed) {
      return {
        hit: true,
        killed: false,
        headshot,
        critical: headshot,
        position,
        color: enemy.color,
        score: 0,
        enemyType: enemy.type
      };
    }

    unregisterTargets(enemy, hittableBefore);
    enemies.delete(enemy.id);
    corpses.push(enemy);

    emitBlood(
      {
        x: position.x,
        y: position.y + 1.0,
        z: position.z
      },
      enemy.getSprayDirection()
    );

    if (shouldDropPickup(Math.random())) {
      spawnPickupAt(position);
    }

    refreshWaveComplete();

    return {
      hit: true,
      killed: true,
      headshot,
      critical: headshot,
      position,
      color: enemy.color,
      score: enemy.score,
      enemyType: enemy.type
    };
  }

  const targetQuery = Object.freeze({
    listHittable: function listHittable() {
      const entries = [];
      for (const enemy of enemies.values()) {
        const parts = enemy.listHittable();
        for (const mesh of parts) {
          entries.push({
            object: mesh,
            targetId: mesh.userData.targetId
          });
        }
      }
      return entries;
    },
    applyDamage
  });

  /**
   * 开始一个波次。替换待生成队列，不清理当前存活敌人。
   *
   * @param {number} nextWave
   * @returns {void}
   */
  function startWave(nextWave) {
    if (disposed) {
      return;
    }
    if (!Number.isInteger(nextWave) || nextWave < GAME_CONFIG.waves.firstWave) {
      throw new TypeError(
        'startWave: wave 必须是大于等于 ' + GAME_CONFIG.waves.firstWave + ' 的整数'
      );
    }
    const plan = createWavePlan(nextWave);
    pendingTypes = plan.types.slice();
    totalInWave = plan.count;
    spawned = 0;
    spawnCooldown = 0;
    wave = nextWave;
    waveComplete = false;
  }

  /**
   * 推进生成、敌人 AI、弹丸、尸体、拾取物。
   *
   * @param {number} dt
   * @param {unknown} playerSnapshot
   * @returns {void}
   */
  function update(dt, playerSnapshot) {
    if (disposed) {
      return;
    }
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
      throw new TypeError('敌方服务 update: dt 必须是非负有限数字');
    }
    if (dt === 0) {
      return;
    }
    const player = normalizePlayerSnapshot(playerSnapshot);

    if (pendingTypes.length > 0) {
      spawnCooldown -= dt;
      while (spawnCooldown <= 0 && pendingTypes.length > 0) {
        const didSpawn = spawnNextEnemy(player);
        if (!didSpawn) {
          spawnCooldown = GAME_CONFIG.waves.spawnInterval;
          break;
        }
        spawnCooldown += GAME_CONFIG.waves.spawnInterval;
      }
    }

    const enemyContext = {
      player,
      colliders,
      spawnProjectile,
      damagePlayer
    };
    for (const enemy of enemies.values()) {
      enemy.update(dt, enemyContext);
    }

    for (let index = corpses.length - 1; index >= 0; index -= 1) {
      const corpse = corpses[index];
      const finished = corpse.updateCorpse(dt);
      if (finished) {
        renderer.remove(corpse.root);
        corpse.dispose();
        corpses.splice(index, 1);
      }
    }

    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index];
      const status = projectile.update(dt, { colliders, player });
      if (status === PROJECTILE_STATUS.FLYING) {
        continue;
      }
      if (status === PROJECTILE_STATUS.PLAYER) {
        emit(EVENTS.PLAYER_DAMAGE, {
          amount: projectile.damage,
          sourcePosition: projectile.getSourcePosition()
        });
      }
      renderer.remove(projectile.mesh);
      projectile.dispose();
      projectiles.splice(index, 1);
    }

    for (let index = pickups.length - 1; index >= 0; index -= 1) {
      const pickup = pickups[index];
      const status = pickup.update(dt, player);
      if (status === PICKUP_STATUS.ACTIVE) {
        continue;
      }
      if (status === PICKUP_STATUS.COLLECTED) {
        emit(EVENTS.PICKUP_COLLECTED, {
          position: pickup.getPosition(),
          amount: pickup.amount
        });
      }
      renderer.remove(pickup.group);
      pickup.dispose();
      pickups.splice(index, 1);
    }

    refreshWaveComplete();
  }

  /**
   * 清空全部敌人、尸体、弹丸、拾取物、计时器与波次状态。可重复调用。
   *
   * @returns {void}
   */
  function reset() {
    for (const projectile of projectiles) {
      renderer.remove(projectile.mesh);
      projectile.dispose();
    }
    projectiles.length = 0;

    for (const pickup of pickups) {
      renderer.remove(pickup.group);
      pickup.dispose();
    }
    pickups.length = 0;

    for (const enemy of enemies.values()) {
      renderer.remove(enemy.root);
      enemy.dispose();
    }
    enemies.clear();

    for (const corpse of corpses) {
      renderer.remove(corpse.root);
      corpse.dispose();
    }
    corpses.length = 0;

    targets.clear();

    pendingTypes = [];
    wave = 0;
    totalInWave = 0;
    spawned = 0;
    spawnCooldown = 0;
    waveComplete = false;
    nextEnemyId = 1;
  }

  /**
   * @returns {import('../../abstract/enemies.js').EnemiesState}
   */
  function getState() {
    const types = {};
    for (const type of Object.values(ENEMY_TYPES)) {
      types[type] = 0;
    }
    for (const enemy of enemies.values()) {
      if (types[enemy.type] !== undefined) {
        types[enemy.type] += 1;
      }
    }
    return {
      wave,
      alive: enemies.size,
      pendingSpawns: pendingTypes.length,
      totalInWave,
      spawned,
      waveComplete,
      types
    };
  }

  return {
    load,
    reset,
    startWave,
    update,
    getTargetQuery,
    getState,
    dispose: function dispose() {
      reset();
      disposed = true;
      if (!modelsDisposed) {
        modelsDisposed = true;
        disposeHumanModelCache(modelCache);
        modelCache = new Map();
      }
    }
  };
}
