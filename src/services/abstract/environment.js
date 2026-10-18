/**
 * 竞技场服务契约。
 *
 * 竞技场负责 60 × 60 米写实军事训练场的场景内容、灯光、雾与漂浮尘土，并提供
 * 阻挡移动的 AABB 碰撞数据和合法出生点。它不决定敌人波次、伤害或得分。
 *
 * 本文件只有 JSDoc 类型说明与导出的空对象，没有运行时代码：
 * 导入它不会创建 Three.js 对象、不会读取素材、也不会发起请求。
 *
 * 依赖边界：
 * - 只导入 Model 与 Provider 公共入口（`src/providers/public/*`）。
 * - 不导入其他 Service、Pipeline、Interface，也不导入 `src/providers/impl/`。
 *
 * 资源所有权：
 * - 贴图与 HDR 由素材加载器缓存并释放；竞技场只借用。
 * - 竞技场自己创建的程序化回退贴图、几何体和材质在 `dispose()` 时释放。
 */

/**
 * 世界坐标三维向量。Provider 与 Service 边界上使用普通对象，
 * 不是 Three.js 的 `Vector3`。
 *
 * @typedef {Object} Vec3
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * 世界坐标轴对齐碰撞盒。`min` 的每个分量都小于等于 `max`。
 *
 * @typedef {Object} Collider
 * @property {Vec3} min 最小角（含）。
 * @property {Vec3} max 最大角（含）。
 */

/**
 * 出生点查询参数。
 *
 * @typedef {Object} SpawnPointRequest
 * @property {Vec3} [playerPosition] 玩家脚底位置；省略时按竞技场中心处理。
 * @property {number} [minDistance] 与玩家的最小水平距离（米）；省略时使用 `GAME_CONFIG.arena.minPlayerDistance`（10 米）。
 */

/**
 * `load()` 成功后的摘要。
 *
 * @typedef {Object} ArenaLoadResult
 * @property {Collider[]} colliders 障碍物 AABB 的副本。
 * @property {Vec3} playerSpawn 玩家安全出生点。
 * @property {Array<{asset: string, url?: string, reason: string}>} fallbacks
 *   本次加载启用的程序化回退记录；没有回退时为空数组。
 */

/**
 * 竞技场服务公共接口。
 *
 * @typedef {Object} ArenaService
 * @property {() => Promise<ArenaLoadResult>} load
 *   异步加载素材并搭建场景。并发调用返回同一个 Promise；成功后重复调用返回同一结果。
 *   失败时清理已创建的对象并允许稍后重试。
 * @property {() => Collider[]} getColliders
 *   返回所有阻挡移动的 AABB 副本。加载前后都可以调用，每次返回新数组。
 * @property {() => import('./effects.js').DecalSink|null} getDecals
 *   返回弹孔/血迹/灼痕/污渍贴片系统；`load()` 完成前或释放后为 `null`。
 *   效果服务把它作为 `createEffects({ renderer, decals })` 的可选参数。
 * @property {(request?: SpawnPointRequest) => Vec3} getSpawnPoint
 *   在距竞技场中心 22–28 米、障碍物外、距玩家至少 `minDistance` 米的位置返回出生点。
 *   有界重试；找不到时抛出带约束说明的 Error。
 * @property {() => Vec3} getPlayerSpawn 返回中心附近的安全玩家出生点（y = 0）。
 * @property {(dt: number) => void} update 推进尘土漂移动画；未加载时是安全空操作。
 * @property {() => void} dispose
 *   移除场景对象并释放竞技场创建的几何体、材质与程序化贴图。
 *   素材加载器拥有的贴图/HDR 不在释放范围内。
 */

/**
 * 竞技场工厂参数。
 *
 * @typedef {Object} CreateArenaOptions
 * @property {import('../../providers/abstract/renderer.js').Renderer} renderer
 *   渲染器公共入口返回值（必需）。
 * @property {import('../../providers/abstract/assets.js').AssetLoader} assets
 *   素材加载器公共入口返回值（必需）；素材路径只来自 `asset-manifest.json`。
 */

/**
 * @callback CreateArena
 * @param {CreateArenaOptions} options
 * @returns {ArenaService}
 */

export {};
