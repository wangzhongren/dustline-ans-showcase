/**
 * 视觉反馈服务契约。
 *
 * 效果服务负责弹道线、命中火花、爆炸、生成闪光、血雾、枪口烟雾、弹壳、
 * 敌人枪口闪光与弹孔/血渍贴片。它只消费渲染器的 `add()` / `remove()` 和
 * 可选的 decals 系统，不决定伤害、击杀、得分或波次。
 *
 * 本文件只有 JSDoc 类型说明与导出的空对象，没有运行时代码：
 * 导入它不会创建几何体、材质或粒子系统。
 *
 * 生命周期：
 * - 工厂创建时一次性建好有上限的对象池并加入场景。
 * - 所有播放方法只激活并重置池条目。
 * - `update(dt)` 推进年龄、淡出与粒子运动；暂停时调用方可以跳过。
 * - `clear()` 让所有效果立刻消失但保留池对象；`dispose()` 才释放几何体与材质。
 *
 * 池上限（池满时复用年龄最大的条目）：
 * - 弹道线 24、命中火花 32、爆炸 8、生成闪光 8、血雾 8、枪口烟雾 8、
 *   弹壳 12、枪口闪光 8；没有 decals 时另有弹孔回退贴片 24、血渍回退贴片 12。
 */

/**
 * @typedef {Object} Vec3
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * 贴片系统的最小契约。竞技场 `getDecals()` 返回它；效果服务用它留下
 * 世界弹孔、血迹、灼痕与污渍。实现必须自行管理上限与释放。
 *
 * @typedef {Object} DecalSink
 * @property {(position: Vec3, normal: Vec3) => void} addBulletHole
 * @property {(position: Vec3, normal: Vec3, color?: number) => void} addBlood
 * @property {(position: Vec3, normal: Vec3) => void} addScorch
 * @property {(position: Vec3, normal: Vec3, scale?: number) => void} addStain
 * @property {(dt: number) => void} update
 * @property {() => void} clear
 * @property {() => void} dispose
 */

/**
 * 视觉反馈服务公共接口。
 *
 * @typedef {Object} EffectsService
 * @property {(from: Vec3, to: Vec3, color?: number) => void} tracer
 *   画一条约 0.2 秒的暖色弹道线。`color` 为 0xRRGGBB，省略时用暖白 `0xffd9a0`。
 * @property {(position: Vec3, normal: Vec3, color?: number) => void} impact
 *   在命中点播放约 0.3 秒的火花簇；`normal` 用来让火花从表面向外偏移。
 * @property {(position: Vec3, color?: number, scale?: number) => void} explosion
 *   播放约 0.8 秒的膨胀闪光与碎片粒子。`scale` 必须大于 0，省略为 1。
 *   碎片使用 `color`，闪光保持暖橙色。人类敌人死亡不使用该方法。
 * @property {(position: Vec3, color?: number) => void} spawn
 *   在敌人出现位置播放约 0.55 秒的贴地微弱光环。
 * @property {(position: Vec3, direction: Vec3, color?: number) => void} blood
 *   播放约 0.45 秒的深红血雾，并在 decals 系统留下血渍；没有 decals 时使用内置贴片。
 * @property {(position: Vec3, normal: Vec3) => void} bulletHole
 *   在表面留下弹孔；优先使用 decals，没有时使用内置回退贴片。
 * @property {(position: Vec3, direction: Vec3) => void} muzzleSmoke
 *   在枪口喷出约 0.5 秒的灰烟，沿射击方向轻微扩散。
 * @property {(position: Vec3, velocity: Vec3) => void} shell
 *   抛出约 0.9 秒的黄铜弹壳，受重力并在落地时反弹。
 * @property {(position: Vec3, direction: Vec3, color?: number) => void} enemyShot
 *   敌人开火：枪口闪光 + 烟雾 + 约 1.4 米的短曳光。
 * @property {(dt: number) => void} update 推进所有效果的生命周期；`dt` 需为大于等于 0 的有限数字。
 * @property {() => void} clear 让所有效果立即消失，保留池对象供下一局复用。
 * @property {() => void} dispose 从渲染器移除所有池对象并释放几何体/材质；之后继续调用会抛错。
 */

/**
 * 效果服务工厂参数。
 *
 * @typedef {Object} CreateEffectsOptions
 * @property {import('../../providers/abstract/renderer.js').Renderer} renderer
 *   渲染器公共入口返回值（必需）。
 * @property {DecalSink} [decals]
 *   竞技场 `getDecals()` 返回的贴片系统（可选）；提供时弹孔与血迹写入世界贴片池。
 */

/**
 * @callback CreateEffects
 * @param {CreateEffectsOptions} options
 * @returns {EffectsService}
 */

export {};
