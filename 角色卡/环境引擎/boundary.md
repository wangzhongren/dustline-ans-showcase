# 边界文档：环境引擎

## 第 1 节：可修改的文件与目录

| 类型 | 可操作路径 | 用途 |
| --- | --- | --- |
| 单文件 | `src/services/abstract/environment.js` | 竞技场服务契约 |
| 单文件 | `src/services/abstract/effects.js` | 视觉反馈服务契约 |
| 单文件 | `src/services/abstract/audio.js` | 音频编排服务契约 |
| 单文件 | `src/services/public/environment.js` | 竞技场公共入口 |
| 单文件 | `src/services/public/effects.js` | 视觉反馈公共入口 |
| 单文件 | `src/services/public/audio.js` | 音频编排公共入口 |
| 单文件 | `src/services/impl/environment/arena.js` | 场景、灯光、障碍物与氛围 |
| 单文件 | `src/services/impl/environment/arena-layout.js` | 布局、碰撞与出生点纯函数 |
| 单文件 | `src/services/impl/environment/props.js` | 军事场景道具与环境细节 |
| 单文件 | `src/services/impl/environment/decals.js` | 弹孔、污渍与地面贴片 |
| 单文件 | `src/services/impl/effects/effects.js` | 弹道线、粒子、爆炸与闪光池 |
| 单文件 | `src/services/impl/audio/audio-service.js` | 游戏事件到声音参数的映射 |
| 单文件 | `src/providers/abstract/renderer.js` | 渲染 Provider 契约 |
| 单文件 | `src/providers/abstract/assets.js` | 素材加载 Provider 契约 |
| 单文件 | `src/providers/abstract/audio-engine.js` | 音频引擎 Provider 契约 |
| 单文件 | `src/providers/public/renderer.js` | 渲染 Provider 公共入口 |
| 单文件 | `src/providers/public/assets.js` | 素材加载公共入口 |
| 单文件 | `src/providers/public/three.js` | Three.js 显式公开导出 |
| 单文件 | `src/providers/public/audio-engine.js` | 音频 Provider 公共入口 |
| 单文件 | `src/providers/impl/three-renderer.js` | Three.js 渲染实现 |
| 单文件 | `src/providers/impl/three-assets.js` | Three.js 贴图/HDRI/GLB 加载实现 |
| 单文件 | `src/providers/impl/post-processing.js` | SSAO、Bloom、色彩分级与抗锯齿 |
| 单文件 | `src/providers/impl/webaudio-engine.js` | WebAudio 合成实现 |
| 目录 | `test/环境引擎/` | 本角色单元测试与夹具 |
| 单文件 | `角色卡/环境引擎/feature-map.md` | 功能导航 |
| 单文件 | `角色卡/环境引擎/memo.md` | 本角色工作线索 |
| 单文件 | `角色卡/环境引擎/changelog.md` | 变更日志 |
| 单文件 | `角色卡/环境引擎/functional-description.md` | 模块说明 |
| 单文件 | `角色卡/环境引擎/api-spec.md` | 实际导出与测试证据 |
| 条件目录 | `角色卡/环境引擎/docs/design/` | 设计记录 |
| 条件目录 | `角色卡/环境引擎/docs/feature/` | 功能说明 |
| 条件目录 | `角色卡/环境引擎/docs/change/` | 变更记录 |
| 条件目录 | `角色卡/环境引擎/docs/fix/` | 修复记录 |

不在本表或本表目录范围内的文件默认只读。新增目录、转移所有权或删除单独列出的文件需要 ANS Governance 更新本节并重新验收。
