# 功能导航：环境引擎

本角色负责一个系统功能。下面这份导航说明当前做到哪一步，详细流程见功能文档。

| 功能 ID | 名称 | 当前状态 | 文档 |
| --- | --- | --- | --- |
| `arena-and-feedback` | 竞技场、视觉反馈与音效 | v3 场景/道具/贴片/后处理/音频升级已实现，27 项 Node 测试与生产构建通过；Electron 画面、听感与性能验收未完成 | [docs/feature/arena-and-feedback.md](docs/feature/arena-and-feedback.md) |

## 当前阶段说明

- **已完成（Provider）**：Three.js 渲染器、素材加载器（含 `loadGltf`）与 WebAudio 合成引擎的公共入口和实现；Three 门面 67 个显式导出，包含 `AnimationMixer`/`cloneSkinned`。
- **已完成（Provider v3）**：`setQuality('high'|'low')`、`roll`/`shakeX`/`shakeY` 相机姿态、`post-processing.js`（SSAO + Bloom + 分级/暗角/颗粒 + SMAA + OutputPass，失败降级）。
- **已完成（Service）**：`createArena()` 的 68 个 AABB、HESCO/隔离墩/沙袋墙/门锁杆/托盘/轮胎/帐篷/警示牌/弹药箱/探照灯/铁丝网/地面细节、Fabric084/Wood066 真实贴图重映射、低角度阳光、贴片系统；`createEffects()` 的血雾/弹孔/烟雾/弹壳/敌人枪口效果；`createAudio()` 的分层枪声、距离衰减、爆头/弹壳/环境音与主音量。
- **Node 验证**：`node --test test/环境引擎/provider-contract.test.js test/环境引擎/arena-layout.test.js test/环境引擎/scene-systems.test.js` → 28 pass / 0 fail；`npm run build` 成功（68 modules，只有 chunk 体积提示）。
- **未验证**：真实 Electron 窗口中的后处理、低角度阴影、贴图观感、道具层次、音效听感、帧率与连续重开资源释放；Pipeline 对新增反馈/音频接口的接线。

## 相关历史

- 变更记录：[docs/change/2026-10-17_change_initial-implementation.md](docs/change/2026-10-17_change_initial-implementation.md)
- 接口与测试证据：[api-spec.md](api-spec.md)
