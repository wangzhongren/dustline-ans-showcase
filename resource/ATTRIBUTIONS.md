# 素材授权说明（ATTRIBUTIONS）

本项目只使用 **CC0（公共领域）** 素材。以下文件全部于 2026-10-17 下载、校验并保存到 `resource/`。没有使用 CC-BY、商业或其他受限素材。

## 天空与环境光

| 文件 | 资产 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | Poly Haven · kloofendal_48d_partly_cloudy_puresky（1K HDR） | Greg Zaal（Poly Haven；天空编辑 Jarod Guest） | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr | CC0 | 2026-10-17 |

## 模型

| 文件 | 资产 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/models/quaternius-rifle.glb` | Quaternius · Rifle（GLB，约 1534 三角面） | Quaternius（Poly Pizza） | https://static.poly.pizza/da83f4f9-7a4e-4739-9033-79d688aa3b5e.glb | CC0 | 2026-10-17 |
| `resource/models/quaternius-adventurer.glb` | Quaternius · Adventurer（带骨骼与动画的 GLB） | Quaternius（Poly Pizza） | 下载 https://static.poly.pizza/bbe369ee-a686-42c7-adad-14356f5f2f15.glb ；来源页 https://poly.pizza/m/5EGWBMpuXq | CC0 1.0 | 2026-10-17 |
| `resource/models/quaternius-woman-casual.glb` | Quaternius · Animated Woman（Casual，带骨骼与动画的 GLB） | Quaternius（Poly Pizza） | 下载 https://static.poly.pizza/ba7a1955-ea51-4cb9-a561-188bdef0a6c7.glb ；来源页 https://poly.pizza/m/qJ2gsTUBHL | CC0 1.0 | 2026-10-17 |
| `resource/models/quaternius-woman-formal.glb` | Quaternius · Animated Woman（Formal，带骨骼与动画的 GLB） | Quaternius（Poly Pizza） | 下载 https://static.poly.pizza/46d6db5a-3c9f-4238-8cdf-8eb7194498dc.glb ；来源页 https://poly.pizza/m/nIItLV9nxS | CC0 1.0 | 2026-10-17 |
| `resource/models/quaternius-man-base.glb` | Quaternius · Man（基础人类，带骨骼与动画的 GLB） | Quaternius（Poly Pizza） | 下载 https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb ；来源页 https://poly.pizza/m/HMnuH5geEG | CC0 1.0 | 2026-10-17 |

### 人类模型动画验证（2026-10-17）

- 四个文件均为 glTF 2.0 二进制，文件头 `glTF`、声明的总长度与实际字节数一致、JSON chunk 可解析，未修改内容。
- Adventurer / Woman Casual / Woman Formal：每个 24 个动画片段，名称前缀为 `CharacterArmature|`。设计期望的 `Idle_Gun`、`Walk`、`Run`、`Run_Shoot`、`Gun_Shoot`、`HitRecieve`、`Death` 全部存在（实际名如 `CharacterArmature|Idle_Gun`）。另有 `HitRecieve_2`、`Idle_Gun_Shoot`、`Punch_Left/Right`、`Kick_Left/Right`、`Roll`、`Run_Back/Left/Right` 等。骨架 62 个关节，5/4/4 个蒙皮、10,198/6,424/6,108 三角面；实测身高约 1.827 / 1.810 / 1.800 米，朝向 +Z，无根运动。
- Man 基础模型：11 个动画片段，前缀 `HumanArmature|`。存在 `Man_Walk`、`Man_Run`、`Man_Death`、`Man_Idle`、`Man_Standing`；只有单个 `Man_Punch`，没有 `Punch_Left/Right`，也没有 `Idle_Gun`、`Gun_Shoot`、`Run_Shoot`、`HitRecieve`。骨架 31 个关节，1,852 三角面；实测身高约 4.827 米，需要约 0.373 倍缩放才能作为 1.8 米士兵使用；朝向 +Z，无根运动。
- 四个模型都没有内嵌纹理（`textures: 0`），材质为低多边形纯色/顶点色；头盔、面罩、背心、弹匣袋、护膝、手套与步枪需要由敌方服务用程序化几何挂接。
- 根运动检查：根节点与 Hips 的平移轨道没有超过 2 厘米的水平位移；Man 的 `Man_Run` / `Man_Walk` 只有约 2–3 厘米的脚部 IK 平移，不构成根运动。

## 贴图：地面 / 碎石（Ground054）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/ground/Ground054_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=Ground054_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/ground/Ground054_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/ground/Ground054_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/ground/Ground054_1K-JPG_AmbientOcclusion.jpg` | AmbientOcclusion | ambientCG | 同上 | CC0 | 2026-10-17 |

## 贴图：混凝土（Concrete034）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/concrete/Concrete034_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/concrete/Concrete034_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/concrete/Concrete034_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |

## 贴图：金属（Metal032）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/metal/Metal032_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=Metal032_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/metal/Metal032_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/metal/Metal032_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/metal/Metal032_1K-JPG_Metalness.jpg` | Metalness | ambientCG | 同上 | CC0 | 2026-10-17 |

## 贴图：木材（Wood066）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/wood/Wood066_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=Wood066_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/wood/Wood066_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/wood/Wood066_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |

## 贴图：波纹钢（CorrugatedSteel009）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=CorrugatedSteel009_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_Metalness.jpg` | Metalness | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_AmbientOcclusion.jpg` | AmbientOcclusion | ambientCG | 同上 | CC0 | 2026-10-17 |

## 贴图：沙袋 / 帆布（Fabric084）

| 文件 | 通道 | 作者 | 来源 | 授权 | 下载日期 |
| --- | --- | --- | --- | --- | --- |
| `resource/textures/fabric/Fabric084_1K-JPG_Color.jpg` | Color | ambientCG | https://ambientcg.com/get?file=Fabric084_1K-JPG.zip | CC0 | 2026-10-17 |
| `resource/textures/fabric/Fabric084_1K-JPG_NormalGL.jpg` | NormalGL | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/fabric/Fabric084_1K-JPG_Roughness.jpg` | Roughness | ambientCG | 同上 | CC0 | 2026-10-17 |
| `resource/textures/fabric/Fabric084_1K-JPG_AmbientOcclusion.jpg` | AmbientOcclusion | ambientCG | 同上 | CC0 | 2026-10-17 |

## 说明

- 只保留实际使用的通道：Color、NormalGL、Roughness、Metalness（源文件有时）、AmbientOcclusion（源文件有时）。
- 下载的压缩包只在系统临时目录的独立空目录中解压，没有执行包内任何文件；`.blend`、`.usdc`、`.mtlx`、`.tres`、`Displacement`、`NormalDX` 与预览 PNG 均未放入 `resource/`，压缩包也没有保留。
- 所有文件都通过魔数校验：JPEG 以 `FF D8 FF` 开头、以 `FF D9` 结尾；HDR 以 `#?RADIANCE` 开头；GLB 以 `glTF` 开头。
- 四个 Quaternius 人类模型的来源页于 2026-10-17 实际打开核对：Adventurer、Animated Woman（两个变体）与 Man 均标注 Creator 为 Quaternius、License 为 Public Domain (CC0)。
- ambientCG 的资产页面以站点名义发布（CC0，无需署名）；上表按其公开署名写入 `ambientCG`。Poly Haven 页面将 Greg Zaal 列为原始作者、Jarod Guest 列为天空编辑。
- 文件与授权的事实来源也记录在 `resource/asset-manifest.json` 的 `assets` 数组中，两份记录保持一致。
