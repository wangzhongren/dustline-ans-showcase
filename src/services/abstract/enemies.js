/**
 * 敌方服务契约（v3：人类士兵）。
 *
 * 敌方服务负责波次组成、人类士兵 AI、敌方弹丸、近战接触伤害、受击与死亡、
 * 生命拾取物，以及向 Pipeline 提供“可命中目标”查询。
 *
 * 本文件只有 JSDoc 类型说明与导出的空对象，没有运行时代码：
 * 导入它不会创建几何体、材质或任何 Three.js 对象。
 *
 * 边界约定：
 * - 只读消费共享 Model（`src/models/`）与 Provider 公共入口
 *   （`src/providers/public/three.js`、`src/providers/public/assets.js`）；
 *   不导入其他 Service、Pipeline、Interface，也不导入 `src/providers/impl/`
 *   或 `three` 包本身。
 * - 玩家位置、生命和存活状态由 Pipeline 以只读快照传入；敌方服务不修改玩家状态。
 * - 计分、击杀提示、音频与特写效果由 Pipeline 根据事件决定；敌方服务只发出
 *   `world:enemy-shot`、`world:blood`、`world:enemy-spawn`、`pickup:spawn`、
 *   `pickup:collected`、`player:damage` 事件，不发出得分或击杀事件。
 * - 场景中只有三类人类士兵：`rifleman`（步枪兵）、`heavy`（重机枪手）、
 *   `breacher`（突击兵）。不再有无人机、机械单位或机械爆炸。
 */

/**
 * 世界坐标三维向量（普通对象，不是 Three.js 的 `Vector3`）。
 *
 * @typedef {Object} Vec3
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * 轴对齐碰撞盒，世界坐标。由竞技场服务提供，敌方服务只读消费。
 *
 * @typedef {Object} Collider
 * @property {Vec3} min 最小角（含）。
 * @property {Vec3} max 最大角（含）。
 */

/**
 * 生成点参数。`playerPosition` 为玩家脚底位置，`minDistance` 为最小水平距离（米）。
 *
 * @typedef {Object} SpawnPointRequest
 * @property {Vec3} playerPosition
 * @property {number} minDistance
 */

/**
 * @callback GetSpawnPoint
 * @param {SpawnPointRequest} request
 * @returns {Vec3} 竞技场内、障碍物外、距玩家至少 `minDistance` 米的合法生成点。
 */

/**
 * 事件发送函数。事件名取自 `src/models/events.js` 的 `EVENTS`。
 *
 * @callback EmitEvent
 * @param {string} name 事件名。
 * @param {Object} payload 事件载荷。
 * @returns {void}
 */

/**
 * 渲染器契约。只使用加入/移出场景，不直接创建 WebGL 资源。
 *
 * @typedef {Object} RendererLike
 * @property {(object: unknown) => void} add
 * @property {(object: unknown) => void} remove
 */

/**
 * 素材加载器契约的子集。`loadGltf(url)` 返回 `{ scene, animations }`；
 * `loadManifest()` 可选，用于读取 `models.humans` 的模型池与逐模型缩放。
 *
 * @typedef {Object} AssetLoaderLike
 * @property {(url: string) => Promise<{ scene: unknown, animations: unknown[] }>} loadGltf
 * @property {() => Promise<Record<string, unknown>>} [loadManifest]
 */

/**
 * 玩家只读快照的子集。敌方服务只读取这些字段用于瞄准与接触判定。
 *
 * @typedef {Object} EnemyPlayerSnapshot
 * @property {number} x 脚底位置 X（米）。
 * @property {number} y 脚底位置 Y（米）。
 * @property {number} z 脚底位置 Z（米）。
 * @property {number} eyeHeight 眼睛相对脚底的高度（米）。
 * @property {boolean} alive 玩家是否存活。
 */

/**
 * 命中结算结果，与 `src/models/contracts.js` 的 `DamageResult` 保持一致。
 *
 * 爆头伤害倍数由战斗服务在调用 `applyDamage` 之前乘算一次；敌方服务不再加倍，
 * 只通过 `headshot`（以及兼容旧名称 `critical`）报告命中部位。
 *
 * @typedef {Object} DamageResult
 * @property {boolean} hit 是否命中有效目标。
 * @property {boolean} killed 本次伤害是否造成击杀。
 * @property {boolean} headshot 是否命中头部（爆头）。
 * @property {boolean} critical 兼容旧名称，与 `headshot` 同义。
 * @property {Vec3} position 敌人脚底世界位置。
 * @property {number} color 敌人效果颜色（0xRRGGBB）。
 * @property {number} score 击杀得分；未击杀为 0。
 * @property {string} enemyType `rifleman` / `heavy` / `breacher`。
 */

/**
 * 可被射线检测的命中盒网格。`userData` 至少包含 `targetId` 与 `part`。
 * 头部与身体使用不同的 `targetId`（形如 `enemy-1:head`、`enemy-1:body`），
 * 因此 `applyDamage(targetId, damage)` 能判断是否爆头。
 *
 * 命中盒是不可见的盒状网格，固定挂在敌人根节点；不对骨骼网格做逐三角检测。
 *
 * @typedef {Object} HittableMesh
 * @property {Record<string, unknown>} userData
 * @property {string} userData.targetId
 * @property {'head'|'body'} userData.part
 */

/**
 * 命中目标条目。`object` 是可射线检测的网格，`targetId` 与
 * `object.userData.targetId` 相同，供战斗服务直接读取与回传。
 *
 * @typedef {Object} HittableEntry
 * @property {HittableMesh} object
 * @property {string} targetId
 */

/**
 * 敌方服务提供给 Pipeline 的命中目标查询契约。
 *
 * @typedef {Object} HitTargetQuery
 * @property {() => HittableEntry[]} listHittable 返回当前存活敌人的命中盒条目数组。
 *   敌人死亡后立即从列表消失。
 * @property {(targetId: string, damage: number) => DamageResult} applyDamage 结算伤害。
 */

/**
 * 波次状态快照。
 *
 * @typedef {Object} EnemiesState
 * @property {number} wave 当前波次；未开始为 0。
 * @property {number} alive 当前存活敌人数（不含尸体）。
 * @property {number} pendingSpawns 尚未生成的敌人数。
 * @property {number} totalInWave 当前波次敌人数。
 * @property {number} spawned 当前波次已生成数。
 * @property {boolean} waveComplete 当前波次是否已全部生成且全部被消灭。
 * @property {Record<string, number>} [types] 按兵种统计的存活数量。
 */

/**
 * 敌方服务工厂参数。
 *
 * @typedef {Object} CreateEnemiesOptions
 * @property {RendererLike} renderer 渲染器公共入口返回值（必需）。
 * @property {Collider[]} [colliders] 竞技场障碍物 AABB 数组；省略时按空数组处理。
 * @property {GetSpawnPoint} getSpawnPoint 边缘生成点查询函数（必需）。
 * @property {EmitEvent} emit 事件发送函数（必需）。
 * @property {AssetLoaderLike} [assets] 素材加载器公共入口；提供时预加载四个
 *   人类 GLB。缺失或加载失败时记录明确错误并使用程序化人类士兵回退。
 */

/**
 * 敌方服务公共接口。
 *
 * @typedef {Object} EnemiesService
 * @property {() => Promise<void>} load 异步预加载四个人类 GLB；幂等，可由
 *   Pipeline 在对局开始前 await。加载失败不会抛错，也不会中断对局。
 * @property {() => void} reset 清空敌人、尸体、弹丸、拾取物、计时器与波次状态；
 *   可重复调用。
 * @property {(wave: number) => void} startWave 开始第 n 波；替换待生成队列，
 *   不移除已有敌人。
 * @property {(dt: number, playerSnapshot: EnemyPlayerSnapshot) => void} update
 *   推进生成、AI、弹丸、尸体淡出与拾取物。
 * @property {() => HitTargetQuery} getTargetQuery 返回命中目标查询对象。
 * @property {() => EnemiesState} getState 返回波次状态快照。
 * @property {() => void} dispose 清空所有内容并标记服务已释放；之后 `update`
 *   不再工作。
 */

/**
 * @callback CreateEnemies
 * @param {CreateEnemiesOptions} options
 * @returns {EnemiesService}
 */

export {};
