/**
 * 战斗服务契约。
 *
 * 本文件只有类型说明，没有运行时代码；导入它不会创建渲染对象、计时器或事件。
 * 上层（Pipeline）只能从 `src/services/public/combat.js` 获得服务实例。
 *
 * 职责边界：
 * - 战斗服务负责玩家移动/跳跃/冲刺/视角、碰撞、武器射击、弹药与换弹、
 *   后坐力/镜头反馈、生命与死亡规则，以及第一人称武器视图与双手动画。
 * - 命中判定通过 Pipeline 注入的目标查询契约完成，不导入敌方服务。
 * - 得分、波次、结算由 Pipeline 负责；本服务只报告击杀结果。
 * - 弹道线、命中火花/血雾、爆炸等视觉反馈由环境引擎的效果服务消费事件实现。
 * - `hud:damage` 由 Pipeline 统一发布（它结合攻击来源计算方向）；战斗服务只发
 *   `player:died`。
 * - 服务不直接调用音频；事件由 Pipeline 映射到音频服务。
 */

/**
 * 轴对齐碰撞盒（共享 Model 约定，只读）。
 *
 * @typedef {Object} Collider
 * @property {{ x: number, y: number, z: number }} min
 * @property {{ x: number, y: number, z: number }} max
 */

/**
 * 命中目标条目（敌方服务经 Pipeline 适配后注入）。
 *
 * @typedef {Object} HittableEntry
 * @property {unknown} object 可射线检测的渲染对象；其 `userData` 至少含 `targetId`、`part`。
 * @property {string} targetId 敌方服务内部目标标识。
 */

/**
 * 一次伤害结算结果（见 `src/models/contracts.js` 的 `DamageResult`）。
 *
 * v3 中 `headshot` 与 `critical` 同义；战斗服务用 `userData.part === 'head'`
 * 判定爆头，并在调用 `applyDamage` 前把伤害乘以 2。
 *
 * @typedef {Object} DamageResult
 * @property {boolean} hit
 * @property {boolean} killed
 * @property {boolean} [headshot]
 * @property {boolean} [critical]
 * @property {{ x: number, y: number, z: number }} position
 * @property {number} color
 * @property {number} score
 * @property {string} enemyType
 */

/**
 * 目标查询契约。由 Pipeline 注入，战斗服务只调用、不实现。
 *
 * @typedef {Object} HitTargetQuery
 * @property {() => HittableEntry[]} listHittable 返回当前可命中的渲染对象。
 * @property {(targetId: string, damage: number) => DamageResult} applyDamage
 *   施加伤害并返回击杀/爆头/位置/颜色/分值/类型。爆头伤害已在调用前乘算，
 *   实现方不得再次加倍。
 */

/**
 * 战斗相关设置。来自 Pipeline 转发的完整设置对象中的三个字段。
 *
 * @typedef {Object} CombatSettings
 * @property {number} mouseSensitivity 鼠标灵敏度倍率，0.25–3.0。
 * @property {number} adsSensitivityMultiplier ADS 时的灵敏度倍率，0.4–1.5。
 * @property {number} fov 基础垂直视野（度），65–95；ADS 时再乘配置倍率。
 */

/**
 * 素材加载器的最小契约（Provider 公共入口 `createAssetLoader()`）。
 *
 * @typedef {Object} AssetLoaderLike
 * @property {() => Promise<Record<string, unknown>>} loadManifest 读取素材清单。
 * @property {(url: string, options?: Object) => Promise<unknown>} loadTexture 加载并配置贴图。
 */

/**
 * 创建战斗服务的参数。
 *
 * 必填：`renderer`、`targetQuery`、`emit`。缺失时工厂抛出带字段名的 TypeError。
 *
 * @typedef {Object} CreateCombatOptions
 * @property {object} renderer
 *   渲染 Provider 公共入口返回的渲染器；用于相机姿态、第一人称武器、屏幕中心射线。
 *   需要提供 `setCameraPose`、`getWorldPosition`、`raycast`、`attachToCamera`、`detachFromCamera`。
 *   `setCameraPose` 应接受并应用 `roll`（镜头滚转）；未实现时该字段被忽略。
 * @property {ReadonlyArray<Collider>} [colliders] 竞技场障碍盒；只读消费。
 * @property {HitTargetQuery} targetQuery Pipeline 注入的命中目标查询。
 * @property {(eventName: string, payload: Object) => void} emit 事件发射函数（通常为共享事件总线）。
 * @property {{ x?: number, y?: number, z?: number }} [spawn] 可选出生点；缺省为 `{ x: 0, y: 0, z: 8 }`。
 * @property {{ width: number, height: number }} [viewport] 可选画布尺寸（CSS 像素）。
 *   用于把屏幕中心换算成世界射线；缺省 1600 × 900（设计窗口尺寸）。
 * @property {AssetLoaderLike} [assets]
 *   可选素材加载器。提供时 `load()` 会预加载金属/钢/木材/织物 PBR 贴图并套用
 *   到视图模型；缺失时使用程序化材质并记录一次提示。
 */

/**
 * 武器只读状态，供 HUD 显示。
 *
 * @typedef {Object} WeaponState
 * @property {number} ammo 当前弹匣内子弹数。
 * @property {number} magazineSize 弹匣容量。
 * @property {boolean} reloading 是否正在换弹。
 * @property {number} reloadProgress 换弹进度 0–1；未换弹时为 0。
 * @property {boolean} aiming 是否正在右键瞄准（ADS）。
 */

/**
 * 战斗服务实例。
 *
 * @typedef {Object} CombatService
 * @property {() => void} reset
 *   复位玩家位置/生命/视角、武器弹药/换弹/后坐力、相机姿态与视图动画状态。
 *   可重复调用，不创建新对象；不会重复发事件。设置保持不变。
 * @property {(deltaSeconds: number, input: import('../../models/contracts.js').InputCommand) => void} update
 *   推进一帧。delta 会被限制在 `GAME_CONFIG.match.deltaClamp`。
 *   玩家死亡后不再移动或射击，但仍保持相机姿态与视图动画。
 * @property {(amount: number) => void} damagePlayer
 *   扣血并重置 5 秒恢复延迟；生命归零时发出 `player:died`（每次死亡一次）。
 *   不发出 `hud:damage`；该事件由 Pipeline 统一发布带方向的版本。
 * @property {(amount: number) => void} heal 恢复生命（拾取物使用），不超过上限。
 * @property {() => import('../../models/contracts.js').PlayerSnapshot} getSnapshot
 *   返回脚底坐标、眼高 1.68、速度、生命与存活状态的只读快照。
 * @property {() => WeaponState} getWeaponState 返回弹药/换弹/瞄准只读状态。
 * @property {(visible: boolean) => void} setViewVisible
 *   显示或隐藏第一人称视图模型（含双手、枪口闪光、烟雾与弹壳）。默认可见；
 *   `reset()` 会恢复可见。传入非布尔值抛 TypeError。
 * @property {(partial?: Partial<CombatSettings>) => Readonly<CombatSettings>} setSettings
 *   合并、校验并夹紧战斗相关设置；应用到鼠标视角、ADS 灵敏度、基础 FOV 与 ADS FOV。
 *   非法类型抛 TypeError；超范围数字夹到边界。
 * @property {() => Readonly<CombatSettings>} getSettings 返回战斗相关设置的冻结副本。
 * @property {() => Promise<void>} load
 *   异步预加载视图模型贴图；幂等，可重复调用。没有 `assets` 时立即 resolve。
 * @property {() => void} dispose 从相机取下并释放第一人称视图几何与材质。可重复调用。
 */

/**
 * 战斗服务发出的事件（全部通过注入的 `emit`）：
 *
 * - `EVENTS.WORLD_SHOT` `{ from, to, muzzlePosition, color }`：每次开火。
 * - `EVENTS.WORLD_IMPACT` `{ position, normal, color }`：子弹命中墙体/箱子等非敌人目标。
 * - `EVENTS.WORLD_BLOOD` `{ position, direction, color }`：子弹命中敌人（含击杀）。
 * - `EVENTS.WEAPON_SHELL_EJECT` `{ position, velocity }`：每次开火抛出一枚弹壳。
 * - `EVENTS.HUD_HITMARKER` `{ killed, headshot }`：命中敌人（无论是否击杀）。
 * - `EVENTS.ENEMY_KILLED` `{ enemyType, score, headshot, critical, position, color }`：
 *   击杀敌人。`critical` 是兼容旧名称，与 `headshot` 同义。只有战斗服务发此事件。
 * - `EVENTS.PLAYER_DIED` `{}`：玩家死亡，一次对局一次。
 * - `EVENTS.WEAPON_RELOAD_START` `{ durationSeconds }`：开始换弹（手动或空仓自动）。
 * - `EVENTS.WEAPON_RELOAD_END` `{}`：换弹完成，弹匣已满。
 * - `EVENTS.WEAPON_EMPTY` `{}`：弹匣打空。
 *
 * `hud:damage` 不由本服务发出；Pipeline 根据敌方服务的 `player:damage`
 * （含可选 `sourcePosition`）调用 `damagePlayer(amount)` 后统一发布。
 *
 * @typedef {Object} CombatEvents
 */

export {};
