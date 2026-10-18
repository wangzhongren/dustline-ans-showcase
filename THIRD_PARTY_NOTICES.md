# 第三方软件与素材说明

本仓库的原创代码使用 MIT，原创文档使用 CC BY 4.0。以下第三方内容保持其原始授权；本仓库不改变这些授权。

## 运行时与构建依赖

| 组件 | 授权 | 来源 |
| --- | --- | --- |
| Three.js | MIT | <https://github.com/mrdoob/three.js> |
| Electron | MIT | <https://github.com/electron/electron> |
| Vite | MIT | <https://github.com/vitejs/vite> |
| electron-builder | MIT | <https://github.com/electron-userland/electron-builder> |
| playwright-core | Apache-2.0 | <https://github.com/microsoft/playwright> |

依赖的具体版本见 `package-lock.json`。各依赖的完整许可文本以其发布包为准。

## 美术素材（均为 CC0）

| 素材 | 授权 | 来源 |
| --- | --- | --- |
| 天空 HDRI：`kloofendal_48d_partly_cloudy_puresky` | CC0 | Poly Haven |
| 地面/混凝土/金属/木材/波纹钢/帆布 PBR 贴图 | CC0 | ambientCG |
| 人类模型：Adventurer、Animated Woman、Man | CC0 | Quaternius / Poly Pizza |
| 步枪模型：Rifle | CC0 | Quaternius / Poly Pizza |

每项素材的作者、来源 URL、下载日期与实际文件路径记录在：

- [resource/ATTRIBUTIONS.md](resource/ATTRIBUTIONS.md)
- [resource/asset-manifest.json](resource/asset-manifest.json)

CC0 素材可以自由使用；本仓库仍保留来源说明，便于追溯和再分发。

## 开发方法

本项目的工程流程参考 [ANS Skill](https://github.com/wangzhongren/ans-skill)（`ans-governed-construction`）。ANS Skill 本身不在本仓库中，遵循其自身仓库的授权。
