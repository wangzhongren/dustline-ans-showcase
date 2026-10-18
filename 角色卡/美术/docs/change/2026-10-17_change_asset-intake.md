---
id: asset-intake
type: change
title: 下载并入库写实军事 CC0 素材
created: "2026-10-17"
updated: "2026-10-17"
timezone: Asia/Shanghai
status: implemented-unverified
related: [art-assets]
events:
  - date: "2026-10-17"
    kind: created
    summary: 按设计 §2.4 下载 8 个 CC0 来源并入库 25 个文件
  - date: "2026-10-17"
    kind: implemented
    summary: 写入 asset-manifest.json、ATTRIBUTIONS.md 与 asset-manifest 测试；8 项测试通过
---

# 下载并入库写实军事 CC0 素材

## 改了什么

在这之前，`resource/` 只有空目录，没有任何贴图、天空或模型，也没有素材清单和授权记录。

现在 `resource/` 里有了设计文档 §2.4 指定的全部素材：

- 阴天天空 HDRI 1 个；
- ambientCG 的 6 组 PBR 贴图，只保留实际使用的通道；
- Quaternius 的步枪 GLB 1 个；
- 逐文件资产清单 `asset-manifest.json` 与授权说明 `ATTRIBUTIONS.md`。

同时新增了自动校验测试和美术方向文档。环境引擎与界面装配可以按清单和规范实现渲染，美术不修改任何 `src/` 代码。

## 下载结果

全部 8 个来源一次下载成功，HTTP 状态均为 200，没有重试，也没有失败项。

| 来源 | 下载文件 | 大小 |
| --- | --- | --- |
| Poly Haven · kloofendal_48d_partly_cloudy_puresky（1K HDR） | `kloofendal_48d_partly_cloudy_puresky_1k.hdr` | 1,435,119 字节 |
| ambientCG · Ground054（1K JPG） | `Ground054_1K-JPG.zip` | 8,674,949 字节 |
| ambientCG · Concrete034（1K JPG） | `Concrete034_1K-JPG.zip` | 3,657,575 字节 |
| ambientCG · Metal032（1K JPG） | `Metal032_1K-JPG.zip` | 3,650,556 字节 |
| ambientCG · Wood066（1K JPG） | `Wood066_1K-JPG.zip` | 6,056,967 字节 |
| ambientCG · CorrugatedSteel009（1K JPG） | `CorrugatedSteel009_1K-JPG.zip` | 3,912,365 字节 |
| ambientCG · Fabric084（1K JPG） | `Fabric084_1K-JPG.zip` | 9,333,044 字节 |
| Poly Pizza · Quaternius Rifle（GLB） | `quaternius-rifle.glb` | 63,964 字节 |

压缩包只在系统临时目录的独立空目录里解压，没有执行包内任何文件；归档、`.blend`、`.usdc`、`.mtlx`、`.tres`、`Displacement`、`NormalDX` 和预览 PNG 都没有进入 `resource/`。

## 入库文件

`resource/` 共 25 个素材文件（另有 `asset-manifest.json` 与 `ATTRIBUTIONS.md` 两个文档），素材约 18 MB。

| 材质组 | 保留通道 | 文件数 |
| --- | --- | --- |
| ground（Ground054） | Color、NormalGL、Roughness、AmbientOcclusion | 4 |
| concrete（Concrete034） | Color、NormalGL、Roughness | 3 |
| metal（Metal032） | Color、NormalGL、Roughness、Metalness | 4 |
| wood（Wood066） | Color、NormalGL、Roughness | 3 |
| steel（CorrugatedSteel009） | Color、NormalGL、Roughness、Metalness、AmbientOcclusion | 5 |
| fabric（Fabric084） | Color、NormalGL、Roughness、AmbientOcclusion | 4 |
| HDRI | 天空 | 1 |
| 模型 | 步枪 GLB | 1 |

所有需要的通道在源压缩包里都存在，因此没有启用“使用最近的真实通道”替代，也没有虚报任何文件。

素材尺寸：ground、metal、wood、fabric 为 1024×1024；concrete 与 steel 为源文件发布的 1024×512。同一材质内各通道尺寸一致，没有混用不同分辨率。

逐文件大小：

| 文件 | 字节 |
| --- | --- |
| `hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | 1,435,119 |
| `models/quaternius-rifle.glb` | 63,964 |
| `textures/ground/Ground054_1K-JPG_Color.jpg` | 1,551,439 |
| `textures/ground/Ground054_1K-JPG_NormalGL.jpg` | 2,010,904 |
| `textures/ground/Ground054_1K-JPG_Roughness.jpg` | 666,018 |
| `textures/ground/Ground054_1K-JPG_AmbientOcclusion.jpg` | 525,627 |
| `textures/concrete/Concrete034_1K-JPG_Color.jpg` | 269,501 |
| `textures/concrete/Concrete034_1K-JPG_NormalGL.jpg` | 821,681 |
| `textures/concrete/Concrete034_1K-JPG_Roughness.jpg` | 217,708 |
| `textures/metal/Metal032_1K-JPG_Color.jpg` | 701,900 |
| `textures/metal/Metal032_1K-JPG_NormalGL.jpg` | 341,948 |
| `textures/metal/Metal032_1K-JPG_Roughness.jpg` | 404,875 |
| `textures/metal/Metal032_1K-JPG_Metalness.jpg` | 4,257 |
| `textures/wood/Wood066_1K-JPG_Color.jpg` | 1,741,706 |
| `textures/wood/Wood066_1K-JPG_NormalGL.jpg` | 892,864 |
| `textures/wood/Wood066_1K-JPG_Roughness.jpg` | 407,657 |
| `textures/steel/CorrugatedSteel009_1K-JPG_Color.jpg` | 511,931 |
| `textures/steel/CorrugatedSteel009_1K-JPG_NormalGL.jpg` | 486,696 |
| `textures/steel/CorrugatedSteel009_1K-JPG_Roughness.jpg` | 293,320 |
| `textures/steel/CorrugatedSteel009_1K-JPG_Metalness.jpg` | 180,665 |
| `textures/steel/CorrugatedSteel009_1K-JPG_AmbientOcclusion.jpg` | 149,584 |
| `textures/fabric/Fabric084_1K-JPG_Color.jpg` | 897,654 |
| `textures/fabric/Fabric084_1K-JPG_NormalGL.jpg` | 2,180,705 |
| `textures/fabric/Fabric084_1K-JPG_Roughness.jpg` | 745,352 |
| `textures/fabric/Fabric084_1K-JPG_AmbientOcclusion.jpg` | 879,364 |

## 前后对比

| 项目 | 之前 | 之后 |
| --- | --- | --- |
| `resource/` | 空目录 | 25 个校验过的素材文件，约 18 MB |
| 素材清单 | 无 | `resource/asset-manifest.json`，符合调度记录 §4 冻结结构 |
| 授权记录 | 无 | `resource/ATTRIBUTIONS.md`，逐文件记录 CC0 与来源 |
| 自动校验 | 无 | `test/美术/asset-manifest.test.js`，8 项检查 |
| 视觉规范 | 只有设计文档中的方向描述 | 独立的色彩、光照、材质映射与消费说明 |

## 验证

在项目根目录执行：

```sh
node --experimental-loader ./test/项目管理/esm-loader.mjs --test test/美术/asset-manifest.test.js
```

实际结果（2026-10-17，Node v24.11.1，Windows 11）：

```text
✔ manifest parses and declares the frozen schema
✔ every texture group exposes color, normal and roughness
✔ texture, HDRI and model references exist inside resource and are non-empty
✔ every listed asset is CC0, exists, is non-empty and stays inside resource
✔ assets array covers every referenced file exactly once
✔ HDRI sky and rifle model exist with valid magic bytes
✔ ATTRIBUTIONS covers every asset and each source family
✔ resource has no archives or source-editor leftovers
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

静态度量：`resource/` 总计约 18 MB；没有 `.zip`、`.blend`、`.usdc`、`.mtlx`、`.tres` 或预览 `.png` 残留。

## 尚未完成

- **没有做 Electron 视觉验收。** 当前没有可运行的渲染与环境实现，无法截图。等环境引擎完成后，按美术方向文档第 7 节检查 HDRI、贴图可辨认度、低饱和色调和无霓虹元素。
- **步枪 GLB 观感未评估。** 需要在第一人称画面中检查轮廓和比例；不达标时按设计 §2.1 改用程序化步枪并复用 PBR 材质。

## 变更文件

- `resource/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr`
- `resource/models/quaternius-rifle.glb`
- `resource/textures/{ground,concrete,metal,wood,steel,fabric}/...`（23 张 JPG）
- `resource/asset-manifest.json`
- `resource/ATTRIBUTIONS.md`
- `test/美术/asset-manifest.test.js`
- `角色卡/美术/docs/design/2026-10-17_design_art-direction.md`
- `角色卡/美术/docs/feature/art-assets.md`
- `角色卡/美术/docs/change/2026-10-17_change_asset-intake.md`
- `角色卡/美术/feature-map.md`、`memo.md`、`changelog.md`、`functional-description.md`、`api-spec.md`
