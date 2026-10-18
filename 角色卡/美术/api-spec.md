# 素材清单接口与消费说明：美术

本文件说明 `resource/asset-manifest.json` 的结构、每个字段的含义、环境引擎和界面装配怎样使用它，以及当前的测试证据。契约来自调度记录 `docs/scheduling/neon-strike-delivery.md` §4（本任务期间冻结）。

## 1. 实际文件

| 路径 | 作用 |
| --- | --- |
| `resource/asset-manifest.json` | 素材清单（唯一消费入口） |
| `resource/ATTRIBUTIONS.md` | 逐文件授权与来源 |
| `resource/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | 天空与环境反射 |
| `resource/models/quaternius-rifle.glb` | 第一人称步枪 |
| `resource/models/quaternius-adventurer.glb` | 步枪兵/重机枪手基础模型（62 关节，24 段动画） |
| `resource/models/quaternius-woman-casual.glb` | 步枪兵变体（62 关节，24 段动画） |
| `resource/models/quaternius-woman-formal.glb` | 步枪兵变体（62 关节，24 段动画） |
| `resource/models/quaternius-man-base.glb` | 突击兵基础模型（31 关节，11 段动画） |
| `resource/textures/ground/Ground054_1K-JPG_{Color,NormalGL,Roughness,AmbientOcclusion}.jpg` | 地面 / 碎石 |
| `resource/textures/concrete/Concrete034_1K-JPG_{Color,NormalGL,Roughness}.jpg` | 混凝土 |
| `resource/textures/metal/Metal032_1K-JPG_{Color,NormalGL,Roughness,Metalness}.jpg` | 金属 |
| `resource/textures/wood/Wood066_1K-JPG_{Color,NormalGL,Roughness}.jpg` | 木材 |
| `resource/textures/steel/CorrugatedSteel009_1K-JPG_{Color,NormalGL,Roughness,Metalness,AmbientOcclusion}.jpg` | 波纹钢 |
| `resource/textures/fabric/Fabric084_1K-JPG_{Color,NormalGL,Roughness,AmbientOcclusion}.jpg` | 沙袋 / 帆布 |

共 29 个素材文件：1 HDRI + 5 GLB + 23 JPG。没有压缩包、源工程文件或预览图。另有两个元数据文档（清单与授权）。

## 2. 清单结构

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-17",
  "baseUrl": "resource/",
  "textures": {
    "ground":   { "color": "...", "normal": "...", "roughness": "...", "ao": "..." },
    "concrete": { "color": "...", "normal": "...", "roughness": "..." },
    "metal":    { "color": "...", "normal": "...", "roughness": "...", "metalness": "..." },
    "wood":     { "color": "...", "normal": "...", "roughness": "..." },
    "steel":    { "color": "...", "normal": "...", "roughness": "...", "metalness": "...", "ao": "..." },
    "fabric":   { "color": "...", "normal": "...", "roughness": "...", "ao": "..." }
  },
  "hdri": { "sky": "hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr" },
  "models": {
    "rifle": "models/quaternius-rifle.glb",
    "humans": {
      "rifleman": [
        {
          "id": "adventurer",
          "file": "resource/models/quaternius-adventurer.glb",
          "url": "models/quaternius-adventurer.glb",
          "animations": ["CharacterArmature|Idle_Gun", "CharacterArmature|Walk", "..."],
          "scale": 0.985,
          "forwardAxis": "+Z",
          "rootMotion": false
        }
      ],
      "heavy": [ { "id": "adventurer", "scale": 0.985, "...": "..." } ],
      "breacher": [ { "id": "man-base", "scale": 0.373, "...": "..." } ]
    }
  },
  "assets": [
    {
      "id": "hdri.sky",
      "file": "resource/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
      "url": "hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
      "kind": "hdri",
      "source": "https://dl.polyhaven.org/...",
      "author": "Greg Zaal (Poly Haven; sky edits by Jarod Guest)",
      "license": "CC0",
      "downloadedAt": "2026-10-17"
    }
  ]
}
```

### 字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schemaVersion` | number | 固定为 `1`；结构不兼容变化时递增 |
| `generatedAt` | `YYYY-MM-DD` | 清单生成日期 |
| `baseUrl` | string | 固定为 `"resource/"`；加载器的根 |
| `textures.<material>` | object | 材质组；至少包含 `color`、`normal`、`roughness` |
| `textures.<material>.metalness` | string | 仅当源文件有金属度贴图时出现 |
| `textures.<material>.ao` | string | 仅当源文件有 AO 贴图时出现 |
| `hdri.sky` | string | 天空 HDR 的相对 URL |
| `models.rifle` | string | 步枪 GLB 的相对 URL |
| `models.humans` | object | 人类士兵模型池：`rifleman`、`heavy`、`breacher`，每个都是非空数组 |
| `models.humans.<role>[].id` | string | 模型标识，如 `adventurer`、`man-base` |
| `models.humans.<role>[].file` | string | 项目根相对路径，等于 `"resource/" + url` |
| `models.humans.<role>[].url` | string | `resource/` 根相对路径 |
| `models.humans.<role>[].animations` | string[] | 实际存在的动画片段完整名（含 `CharacterArmature\|` 或 `HumanArmature\|` 前缀） |
| `models.humans.<role>[].scale` | number | 归一化到约 1.8 m 的建议缩放；每个模型不同 |
| `models.humans.<role>[].forwardAxis` | string | 朝向轴，当前四个模型都是 `"+Z"` |
| `models.humans.<role>[].rootMotion` | boolean | 是否有根运动；当前四个都是 `false` |
| `assets[].id` | string | 稳定标识，如 `texture.ground.color` |
| `assets[].file` | string | 项目根相对路径，以 `resource/` 开头，供测试与工具使用 |
| `assets[].url` | string | `resource/` 根相对路径，等于 `file` 去掉 `resource/` 前缀 |
| `assets[].kind` | string | `hdri`、`model` 或 `texture` |
| `assets[].source` | string | 实际下载 URL（https） |
| `assets[].author` | string | 作者或发布方 |
| `assets[].license` | string | 固定为 `"CC0"` |
| `assets[].downloadedAt` | `YYYY-MM-DD` | 下载日期 |

### 不变量

- `textures` 中每个材质组都有 `color`、`normal`、`roughness`。
- `assets[].url` 集合与 `textures`、`hdri.sky`、`models.rifle`、`models.humans.*[].url` 中出现的 URL 集合完全一致，每个文件恰好一条记录。
- `models.humans.rifleman` 至少有两个变体；`heavy`、`breacher` 各至少一个；每个条目的 `animations` 非空，且所有名字都能在对应 GLB 中真实找到。
- 四个 GLB 在 `assets` 中各出现一次，`kind` 为 `model`、`license` 为 `CC0`、作者为 Quaternius（Poly Pizza）。
- 每个 `assets[].file` 真实存在、非空，并位于 `resource/` 内。
- 每项授权都是 CC0；`ATTRIBUTIONS.md` 与清单逐文件一致。
- `resource/` 中不存在 `.zip`、`.blend`、`.usdc`、`.mtlx`、`.tres` 或预览 `.png`。

## 3. 消费方式（环境引擎）

调度记录 §3.3 冻结的接口：

```text
createAssetLoader({ baseUrl }) -> {
  loadManifest(), loadTexture(url, options), loadHdr(url), loadModel(url), dispose()
}
```

建议流程：

```js
const loader = createAssetLoader({ baseUrl: 'resource/' });
const manifest = await loader.loadManifest();

const groundColor = await loader.loadTexture(manifest.textures.ground.color, {
  colorSpace: 'srgb',
  repeat: { x: 15, y: 15 }
});
const groundNormal = await loader.loadTexture(manifest.textures.ground.normal, {
  colorSpace: 'linear',
  repeat: { x: 15, y: 15 }
});
const sky = await loader.loadHdr(manifest.hdri.sky);
const rifle = await loader.loadModel(manifest.models.rifle);
```

### 贴图约定

| 通道 | 色彩空间 | Three.js 用途 |
| --- | --- | --- |
| `color` | sRGB | `map` |
| `normal` | 线性 / NoColorSpace | `normalMap`（OpenGL 约定，直接可用） |
| `roughness` | 线性 / NoColorSpace | `roughnessMap`（绿色通道） |
| `metalness` | 线性 / NoColorSpace | `metalnessMap`（蓝色通道） |
| `ao` | 线性 / NoColorSpace | `aoMap`（需要第二套 UV；只有一套 UV 时由 Provider 复制 UV 或记录限制） |

- 同一材质的颜色贴图与数据贴图必须使用相同的 `repeat` 与 `offset`，统一 `RepeatWrapping`。
- 贴图尺寸：ground、metal、wood、fabric 为 1024×1024；concrete 与 steel 为源文件发布的 1024×512（同一材质内各通道尺寸一致）。加载器不要假设所有贴图都是正方形，重复次数按物体表面的长宽比设置。
- 没有金属度贴图的材质（ground、concrete、wood、fabric）把 `metalness` 设为 `0`，不要凭空给金属反光。
- 材质外观与重复尺度见 `docs/design/2026-10-17_design_art-direction.md` 第 4 节。

### HDRI

- 用 `loadHdr(manifest.hdri.sky)` 加载，再通过 `setEnvironment({ hdriTexture, ... })` 提供天光与反射。
- 背景与反射可共用同一张 HDR；阴天基调不要改成高对比晴天。

### 步枪

- 用 `loadModel(manifest.models.rifle)` 加载 GLB，按第一人称比例放置。
- 若实际画面中低多边形观感明显不足，按设计 §2.1 改用程序化高细节步枪并复用 PBR 材质；判断需要截图证据，由美术记录。

### 人类士兵（v3）

- 模型池从 `manifest.models.humans` 读取：`rifleman`（3 个变体）、`heavy`（Adventurer）、`breacher`（Man base）。路径以条目 `url` 为准，不要硬编码。
- 用 `loadGltf(entry.url)` 取得 `{ scene, animations }`；`loadModel(url)` 仍可只用 scene，但播放动画必须用 `loadGltf`。
- 缩放必须逐模型应用：

| 模型 | 实测身高 | `scale` |
| --- | --- | --- |
| `quaternius-adventurer.glb` | 1.827 m | 0.985 |
| `quaternius-woman-casual.glb` | 1.810 m | 0.995 |
| `quaternius-woman-formal.glb` | 1.800 m | 1.000 |
| `quaternius-man-base.glb` | 4.827 m | 0.373 |

- 四个模型 `forwardAxis` 都是 `"+Z"`；用移动方向设置 yaw，不要再转 180°。`rootMotion` 都是 `false`，位移完全由 AI 控制。
- 动画按完整名播放。设计名到实际名的映射：

| 设计名 | Adventurer / Woman 实际名 | Man 实际名 |
| --- | --- | --- |
| `Idle_Gun` | `CharacterArmature\|Idle_Gun` | 缺失（用 `HumanArmature\|Man_Idle` 或 `Man_Standing`） |
| `Walk` | `CharacterArmature\|Walk` | `HumanArmature\|Man_Walk` |
| `Run` | `CharacterArmature\|Run` | `HumanArmature\|Man_Run` |
| `Run_Shoot` | `CharacterArmature\|Run_Shoot` | 缺失 |
| `Gun_Shoot` | `CharacterArmature\|Gun_Shoot` | 缺失 |
| `HitRecieve` | `CharacterArmature\|HitRecieve` | 缺失（用受击闪白/音效代替） |
| `Death` | `CharacterArmature\|Death` | `HumanArmature\|Man_Death` |
| `Punch_Left/Right` | `CharacterArmature\|Punch_Left/Right` | 缺失；只有 `HumanArmature\|Man_Punch` |

- 步枪兵/重机枪手还有 `HitRecieve_2`、`Idle_Gun_Shoot`、`Idle_Gun_Pointing`、`Punch_Left/Right`、`Kick_Left/Right`、`Roll`、`Run_Back/Left/Right` 可用；Man 另有 `Man_Jump`、`Man_RunningJump`、`Man_Clapping`、`Man_Sitting`、`Man_SwordSlash`。
- 复制多个实例使用 Provider 导出的 `cloneSkinned`（SkeletonUtils），不要直接 `Object3D.clone()`。
- 模型没有内嵌纹理，材质是纯色；头盔、面罩、背心、弹匣袋、护膝、手套、步枪由敌方服务程序化叠加，视觉规范见美术方向文档第 8 节。
- 重机枪手：在基础 `scale` 之上再乘 1.12（约 1.103，身高约 2.0 m），或只加装具体量。
- 无根运动不等于没有滑步：Walk/Run 片段时长分别为 1.333/0.792 s（Adventurer）和 1.042/0.875 s（Man）；若 AI 速度与步频差太多，用 `mixer.timeScale` 调整。

### 失败与回退

- 加载失败时必须记录具体 URL 与错误信息，不允许静默 catch。
- 使用美术方向文档第 2 节的颜色锚点做程序化回退；不要退化成纯白或纯黑。
- 素材缺失或映射与清单不符时，由项目管理协调美术更新清单；环境引擎不私自改资源路径。

## 4. 消费方式（界面装配）

- 界面不读取 `resource/` 文件；配色、面板、字体与授权文案取自美术方向文档。
- 主菜单的素材授权说明以 `resource/ATTRIBUTIONS.md` 为事实来源，至少说明“仅使用 CC0 素材”和来源站点。
- 红色只用于受伤、低血量和危险提示，不作为普通装饰。

## 5. 测试证据

测试文件：`test/美术/asset-manifest.test.js`（仅使用 Node 内置模块 `node:test`、`node:assert/strict`、`node:fs`、`node:path`、`node:url`）。

执行命令（项目根目录）：

```sh
node --test test/美术/asset-manifest.test.js
```

实际结果（2026-10-17，Node v24.11.1，Windows 11）：

```text
tests 11
pass 11
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 89.805
```

覆盖内容：

1. 清单可解析，`schemaVersion` 为 1，`baseUrl` 为 `resource/`，顶层字段类型正确。
2. 六个材质组都有 color、normal、roughness；可选的 metalness/ao 若存在则为字符串。
3. 所有贴图、HDRI、步枪与人类模型引用都在 `resource/` 内、存在且非空。
4. 每个资产都是 CC0，字段完整，`file === "resource/" + url`，魔数正确。
5. `assets` 与所有引用一一对应，无重复 id 或文件。
6. HDRI 与步枪存在且魔数正确。
7. `models.humans` 声明 `rifleman`、`heavy`、`breacher`；`rifleman` 至少两个变体；每个条目字段完整、引用的文件存在。
8. 每个 GLB 是 glTF 2.0，声明长度等于文件大小，JSON chunk 可解析；包含 mesh、skin、joints 与动画；清单声明的片段名真实存在；步枪兵/重机枪手包含 7 个关键片段，突击兵包含 `Man_Walk`、`Man_Run`、`Man_Punch`、`Man_Death`。
9. 四个 GLB 在 `assets` 中各出现一次，`kind` 为 `model`、CC0、作者含 Quaternius、来源为 `static.poly.pizza`。
10. `ATTRIBUTIONS.md` 覆盖每个文件、全部来源家族（Poly Haven、ambientCG、Poly Pizza、Quaternius）和四个模型文件名。
11. `resource/` 无 `.zip`、`.blend`、`.usdc`、`.mtlx`、`.tres` 或预览 `.png` 残留。

## 6. 验证状态

- 清单测试：`node --test test/美术/asset-manifest.test.js` → 11 pass / 0 fail（2026-10-17，Node v24，Windows 11）。
- v2 首轮视觉验收通过（menu-04 / gameplay-03）。
- v3 视觉复核已于 2026-10-17 完成（`screenshots-v3/menu-02.png`、`gameplay-08.png`、敌方 spawn-1…4、战斗服务 HIP/ADS 截图）：人类士兵、场景道具、低角度光照、后处理、低饱和、无无人机/霓虹通过。
- **v3 静态视觉验收通过**（材质复核后）：更新截图 `gameplay-09.png`、`2026-10-17_view-model-hip-final.png`、`..._ads-final.png` 显示护木/弹匣/枪托为深色聚合物（约 `#262420`），无蓝/酒红；机匣/枪管深枪金属灰。
- 仍需录屏或实际游玩确认：动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡、30 敌人性能与低画质回退。
- v3 四个人类 GLB 已完成结构、动画、尺寸、朝向与根运动验证：Adventurer 1.827 m / 0.985、Woman Casual 1.810 m / 0.995、Woman Formal 1.800 m / 1.000、Man base 4.827 m / 0.373；朝向全部 +Z，均无根运动。
- 静态截图未验证：动画过渡、脚底贴地/滑步、装具逐帧穿模、ADS/HIP 过渡、30 敌人性能与低画质回退。
- Man 突击兵缺少 `Punch_Left/Right`、`Idle_Gun`、`Gun_Shoot`、`Run_Shoot`、`HitRecieve`；敌方服务只能使用 `Man_Punch` 与 `Man_Death`，并用闪白/音效补受击反馈。
- 清单测试通过只证明文件、路径、授权与结构正确；最终视觉结论以复核截图为准。
