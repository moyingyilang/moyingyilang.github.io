---
title: "13 · 真实 EFMI mod 剖析（一手证据）"
description: "EFML4A 研究文档 · 13-real-mod-analysis（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

> 本文档是 EFML4A 研究文档集的一部分，索引见 [docs/README.md](/cs/reverse/)。


本文是对**一个真实 EFMI mod 包**的实测剖析记录。它取代了 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)
与 [10-mod-format.md](/blog/efml4a-10-mod-format/) 中若干**基于推断**的结论——凡本文与那两篇冲突之处，
**以本文为准**。

## 13.0 样本来源与处理原则

| 项目 | 值 |
| --- | --- |
| 归档文件 | `mi_fu_swimsuit151.7z` |
| 大小 / 格式 | 53 239 121 字节；7z，`LZMA2:24`，`Solid=+`，3 个 block，78 个条目 |
| 提供者 | 本项目作者（用于研究） |
| 原作者 | 레번클로（RavenClaw）；Rebuild：Bakamai（见包内 `Credits.txt`） |
| 生成工具 | `EFMI Tools Blender addon v0.4.3`（见 ini 尾注） |
| 目标 | Arknights: Endfield（EFMI 生态 mod） |

> **数据处理红线**：本文**只记录结构、键名、格式与元数据**。
> 归档与解包产物一律存放在仓库之外（`~/.efml4a/scratch/`），
> **不进入版本库**，也不重新分发——这与 [08-threat-model.md](/blog/efml4a-08-threat-model/) §1.2 的红线一致。
> 下文的 ini 片段属于 mod 自身的**配置文本**，为研究与评论目的引用，已注明出处。

## 13.1 归档与目录结构（实测）

解包后只有一个顶层目录（mod 文件夹名即 mod 名）：

```
Mi Fu Swimsuit1.5/
├── mod.ini                     27 558 B   ← 唯一被加载的入口
├── modG0.ini / modG1.ini / modG2.ini   各 ~3.96 KB   ← 见 §13.4，疑似遗留
├── Credits.txt                    343 B
├── Preview.png              1 295 208 B
├── Meshes/                    41 个 .buf（被 mod.ini 引用）
├── MeshesG0/ MeshesG1/ MeshesG2/   各 5 个 .buf（**未被引用**）
└── Textures/                   8 个文件（其中 5 个被 mod.ini 引用）
```

实测得到的文件清单（节选，完整清单见解包产物）：

| 分类 | 条目 | 说明 |
| --- | --- | --- |
| 网格 | `Component{0,1,2,3,4,5,6,8}_IB.buf` | 索引缓冲，每组件一个 |
| 网格 | `ComponentN_VB0/VB1/VB2.buf` | 三个顶点流 |
| 网格 | `ComponentN_VB1_LOD1.buf` | LOD1 的 UV 流变体 |
| 网格 | `ComponentN_VB2_LOD1_BlendRemap.buf` | LOD1 的骨骼索引重映射表 |
| 贴图 | `Components-0-9 t=<hash> <格式>.dds` | 文件名内嵌纹理哈希与目标格式 |

**第一个可操作的结论**：EFMI mod 的目录约定是 **`mod.ini` + `Meshes/` + `Textures/`**，
而不是 `Buffer/` + `Texture/`。`ShaderFixes/` 属于 EFMI 本体，不属于单个 mod。
（早前文档中的目录名猜测已在此更正。）

## 13.2 `mod.ini` 结构（实测）

文件首行是**命名空间声明**，这是 EFMI 1.4x 引入的机制：

```ini
namespace = mifu_swimsuit

; EFMI ALPHA-7 INI
; Upgraded to EFMI 1.45 Merged Skeleton Architecture
```

段落类型统计（实测）：

| 段落前缀 | 数量 | 作用 |
| --- | --- | --- |
| `[Resource*]` | 46 | 声明数据资源（Buffer / RWBuffer / 贴图 / 元信息） |
| `[TextureOverride*]` | 28 | 按纹理哈希或索引数拦截 draw，分「入口」与「贴图」两类 |
| `[CommandList*]` | 11 | 可复用的命令序列 |
| `[Pool*]` | 6 | EFMI 的池化变量容器 |
| `[KeyPart*]` | 4 | 用户热键绑定 |

### 13.2.1 常量与状态

```ini
[Constants]
global $required_efmi_version = 1.45
global $object_guid = 235107
global $mesh_vertex_count = 0
global $component_count = 11
global $bones_count = 422
global $max_instance_count = 10
global $mod_id = -1000
global $mod_enabled = 0
global $object_detected = 0
global $lod_level = 0
global $merged_skeleton_initialized = 0

global persist $part_d1d451ba = 0
global persist $part_d1d451ba_004 = 0
global persist $part_d1d451ba_005 = 0
global persist $part_d1d451ba_006 = 0
```

要点：

- `$mod_id` 初值 **`-1000`** 是一个哨兵值，表示「尚未在 EFMI 注册」。
- `$required_efmi_version`、`$object_guid`、`$component_count`、`$bones_count` 是 **mod 向加载器申报的元数据**。
- `persist` 前缀表示该变量跨 F10 重载与游戏重启保留——这正是 EFMI「F10 保存 mod 设置」的实现基础。
- `$part_d1d451ba*` 的后缀是**目标对象哈希**（与 §13.2.3 的 `hash = d1d451ba` 对应），
  即「部件开关」是按对象哈希分组的。

### 13.2.2 注册握手（mod ↔ 加载器的契约）

```ini
[CommandListRegisterMod]
$\EFMIv1\required_version = $required_efmi_version
$\EFMIv1\object_guid = $object_guid
$\EFMIv1\component_count = $component_count
$\EFMIv1\bones_count = $bones_count
Resource\EFMIv1\ModName = ref ResourceModName
Resource\EFMIv1\ModAuthor = ref ResourceModAuthor
Resource\EFMIv1\ModDesc = ref ResourceModDesc
Resource\EFMIv1\ModLink = ref ResourceModLink
Resource\EFMIv1\ModLogo = ref ResourceModLogo
run = CommandList\EFMIv1\RegisterMod
$mod_id = $\EFMIv1\mod_id
if $mod_id >= 0
    $mod_enabled = 1
endif
```

这就是 `02-efmi-anatomy.md` 所述 `类型\命名空间\名字` 契约的**实证**：
mod 把参数写入 `$\EFMIv1\<name>`，调用 EFMI 的 `CommandList\EFMIv1\RegisterMod`，
再把 EFMI 分配的结果 `$\EFMIv1\mod_id` 读回自己的 `$mod_id`。**这是双向握手，不是单向声明。**

触发时机由 `[Present]` 保证「每帧最多一次、且只在检测到目标对象后」：

```ini
[Present]
if $object_detected
    if $mod_enabled
        post $object_detected = 0
    else
        if $mod_id == -1000
            run = CommandListRegisterMod
        endif
    endif
endif
```

### 13.2.3 入口：按「哈希 + 索引数」定位 draw

```ini
[TextureOverride_EntryPoint_Component0]
hash = d1d451ba
match_first_index = 0
match_index_count = 74298
$object_detected = 1
if $mod_enabled && DRAW_TYPE == 4
    $\EFMIv1\component_id = 0
    $\EFMIv1\gpu_posed = 1
    $lod_level = 0
    CommandList\EFMIv1\Callback_Component_DrawCustom = ref CommandList_Draw_Component0
    run = CommandList_Component_DrawInstances
endif

[TextureOverride_EntryPoint_Component0_LOD1]
hash = 121b1ddd
match_first_index = 0
match_index_count = 34380
...
```

实测到的全部入口（哈希 / 索引数）：

| 组件 | LOD0 hash | LOD0 索引数 | LOD1 hash | LOD1 索引数 |
| --- | --- | --- | --- | --- |
| Component0 | `d1d451ba` | 74298 | `121b1ddd` | 34380 |
| Component1 | `53c66b38` | 36564 | `284eee3d` | 16446 |

**这是本项目最重要的实证之一**，它直接印证了两件事：

1. **识别键是「索引缓冲哈希 + 索引数量」**，而不是顶点数据哈希。
   与 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 中 EFMI 相对 GIMI 把检查槽从 8 个砍到只剩 `ib` 的结论一致。
2. **`DRAW_TYPE == 4` 是硬门**。`4` 即 `DrawIndexedInstanced`，
   与从 bo3b/3Dmigoto 源码确认的枚举值一致——即 EFMI 只接管索引化绘制。
   > ⚠️ 未核实：`match_first_index = 0` 恒为零是 EFMI Tools 的生成约定，还是本 mod 的特例。

### 13.2.4 重发绘制

`CommandList_Draw_Component0` 用自建 buffer 重发原对象的全部子绘制：

```ini
[CommandList_Draw_Component0]
run = CommandList\EFMIv1\OverrideTextures
ib = ref Resource_Component0_IB
vb0 = ref Resource_Component0_VB0
vb3 = ref Resource_Component0_VB0      ; ← vb3 镜像 vb0
if $lod_level == 0
    vb1 = ref Resource_Component0_VB1
elif $lod_level == 1
    vb1 = ref Resource_Component0_VB1_LOD1
else
    vb1 = ref Resource_Component0_VB1
endif
vb2 = ref Resource_Component0_VB2
Resource\RabbitFx\Diffuse = ref Resource_Texture1
Resource\RabbitFx\NormalMap = ref Resource_Texture0
Resource\RabbitFx\Lightmap = ref Resource_Texture2
run = CommandList\RabbitFx\SetTextures
; Draw Component 0 d1d451ba
if $part_d1d451ba == 0 || $part_d1d451ba == 1
    drawindexed = 2892, 0, 0
endif
...
; Draw Component 0 d1d451ba.008
drawindexed = 54, 81996, 0
```

**可交叉验算的证据**：把该 CommandList 中 9 次 `drawindexed` 的索引数相加：

```
2892 + 4842 + 2253 + 35409 + 11604 + 1656 + 7623 + 15717 + 54 = 82050
```

而 `Component0_IB.buf` 为 164100 字节 ÷ 2 = **82050** 个 `u16` 索引。
**两者精确相等**——这证明索引缓冲是**无头的裸索引数组**，且 `stride = 6` 的含义是
「每个三角形 3 个 `u16`」，而非「每个索引 6 字节」。

其余可操作结论：

- 原对象被拆成 **9 段子绘制**，每段可独立开关（对应 §13.2.1 的 4 个 `$part_*` 变量）。
- `vb3` 被显式设为与 `vb0` 相同的资源——说明目标 shader 同时从 `vb0` 与 `vb3` 取位置。
- 贴图不是绑到 `ps-t0`，而是绑到 **`ps-t16` / `ps-t17` / `ps-t18`**：

  ```ini
  ps-t16 = Resource_Texture1
  ps-t17 = Resource_Texture2
  ps-t18 = Resource_Texture0
  ```

  这与 GIMI 时代的 `ps-t0..t3` 约定完全不同，是本游戏 shader 布局决定的。
- 材质参数通过**第三方框架** `RabbitFx` 转交（`Resource\RabbitFx\Diffuse` 等）。

## 13.3 EFMI 自带的「IR」：`Components.buf`（实为 JSON）

`MeshesG*/Components.buf`（1114 字节）并非二进制缓冲，而是一份 **JSON 语义清单**：

```json
{
    "Component0_IB": {
        "semantics": [
            { "name": "INDEX", "index": 0, "format": "R16_UINT", "stride": 6 }
        ]
    },
    "Component0_VB0": {
        "semantics": [
            { "name": "POSITION", "index": 0, "format": "R32G32B32_FLOAT", "stride": 12 },
            { "name": "NORMAL",   "index": 0, "format": "R32G32B32_FLOAT", "stride": 12 }
        ]
    },
    "Component0_VB1": {
        "semantics": [
            { "name": "TEXCOORD", "index": 0, "format": "R32G32_FLOAT", "stride": 8 }
        ]
    },
    "Component0_VB2": {
        "semantics": [
            { "name": "BLENDINDICES", "index": 0, "format": "R32_UINT", "stride": 4 }
        ]
    }
}
```

**这对 EFML4A 的格式设计有直接影响**：EFMI Tools 已经在导出**语义元数据**——
这正是 [10-mod-format.md](/blog/efml4a-10-mod-format/) 中 `vertex_layout` 字段要表达的东西。
换句话说，本项目 IR 的这部分设计**不是发明，而是把 EFMI Tools 已有的隐式约定显式化、规范化**。

同时它解开了 `stride` 的语义：**ini 中 `Resource` 的 `stride` 是该 buffer 内所有语义 stride 之和**。
例如 VB0 的 `stride = 16`（现代版）对应 POSITION + 另一项各若干字节。

## 13.4 遗留文件：`modG*.ini` 与 `MeshesG*` 实为死文件

这是本次剖析**最有实用价值的发现**。

| 判据 | 实测结果 |
| --- | --- |
| `mod.ini` 引用的目录 | 只有 `Meshes/`（41 处）与 `Textures/`（5 处） |
| `mod.ini` 对 `MeshesG*` 的引用次数 | **0** |
| `modG*.ini` 是否有 `namespace` 声明 | **都没有**（`mod.ini` 有） |
| `modG*.ini` 的元信息 | 仍是占位符 `"Unnamed Mod"` / `"Unknown Author"` |
| `modG*.ini` 的目标哈希 | `75a94fda` + `match_index_count = 19884`，与 `mod.ini` 的入口哈希完全不同 |
| `modG*.ini` 的 `$required_efmi_version` | `1.23`（`mod.ini` 是 `1.45`） |
| `modG*.ini` 的绘制调用 | `drawindexedinstanced = 0, INSTANCE_COUNT, 0, 0, FIRST_INSTANCE`（首参 index_count 为 **0**） |

结论：这些是 **Merged Skeleton 架构升级前的旧构建产物**（`Credits.txt` 的 Upgrade List 第 1 条正是
"Merged skeleton architecture"），保留在包内但**已不被加载**。
G1 与 G2 的网格二进制完全相同（md5 一致），仅 G0 不同——进一步说明它们是历史分档残留。

> ⚠️ 未核实：`drawindexedinstanced` 首参为 0 是否表示「由 EFMI 在运行时填入实际索引数」。
> 若否，则 `modG*.ini` 本身也是坏的——这会更强化「死文件」的判断。

**对 EFML4A 的直接要求**：`efml validate` 应当**报告未被 IR 引用的文件**，
让作者知道包内有无用堆积。当前 `ModPackage::validate` 已检查「引用的文件是否存在」，
但尚未反向检查「存在的文件是否被引用」——这是本次剖析新暴露的**功能缺口**。

## 13.5 缓冲布局（实测验算）

以 Component0 为例（现代 merged-skeleton 版本，`Meshes/`）：

| 资源 | ini 声明 stride | 文件大小 | 验算 | 结论 |
| --- | --- | --- | --- | --- |
| `_IB` | `format=R16_UINT`, `stride=6` | 164100 B | 164100 ÷ 2 = 82050 | 82050 个 `u16` 索引 |
| `_VB0` | `stride=16` | 406080 B | 406080 ÷ 16 = 25380 | 25380 个顶点 |
| `_VB1` | `stride=12` | 304560 B | 304560 ÷ 12 = 25380 | 25380 个顶点（LOD0） |
| `_VB1_LOD1` | `stride=8` | 203040 B | 203040 ÷ 8 = 25380 | 同顶点数，UV 精简 |
| `_VB2` | `stride=16` | 406080 B | 406080 ÷ 16 = 25380 | 骨骼索引/权重 |

**三个顶点流解出同一个顶点数 25380**，这是布局推断正确的强证据。

另有骨骼相关资源：

| 资源 | 类型 | 说明 |
| --- | --- | --- |
| `ResourceMergedSkeletonDataRW` | `RWBuffer`，`R32G32B32A32_FLOAT` | 合并骨骼数据的 GPU 侧结构化缓冲 |
| `_VB2_LOD1_BlendRemap` | `Buffer`，`R16_UINT`，`stride=2` | LOD1 的骨骼槽重映射表 |
| `vb2->ElementFormat(BLENDINDICES, 0)` | — | 强制改写为 `R16G16B16A16_UINT` |

ini 中对最后一处的注释解释了原因，是一条重要约束：

```ini
; Force 16-bit VG IDs (since Merged Skeleton usually has more than 256 bones)
vb2->ElementFormat(BLENDINDICES, 0) = R16G16B16A16_UINT
```

本 mod 申报 `$bones_count = 422` —— 远超 `u8` 的 256 上限，
所以必须在**运行时改写顶点属性格式**。这是合并骨骼方案在 Vulkan 后端上的对应难点：
Vulkan 的顶点格式在 `VkPipeline` 创建时固化，**不能像 3DMigoto 那样事后改写**，
必须改为拦截 pipeline 创建或改用 storage buffer 读取骨骼索引。
这一条已回填到 [09-architecture.md](/blog/efml4a-09-architecture/) 的 §9.4 后端 ABI 表。

## 13.6 贴图约定

文件名同时编码了**目标纹理哈希**与**目标压缩格式**：

```
Textures/Components-0-9 t=0c7bdc90 BC5-Linear.dds
Textures/Components-0-9 t=3156b9c5 BC7-sRGB.dds
Textures/Components-0-9 t=8619dce2 BC7-Linear.dds
```

对应的拦截段落用 `hash` 匹配、`this = ref` 替换：

```ini
[Resource_Texture0]
filename = Textures/Components-0-9 t=0c7bdc90 BC5-Linear.dds

[TextureOverride_Texture0]
hash = 0c7bdc90
match_priority = 0
if $object_detected
    this = Resource_Texture0
endif
```

实测到的纹理哈希集合（可作为识别策略真实分布的例子）：
`0c7bdc90`、`3156b9c5`、`8619dce2`、`5ed40e9a`、`33ce73c5`、`3c72768b`、`5d8c9f2a`、`b0d3c92e`。

注意最后两个哈希（`3c72768b`、`5d8c9f2a`）在 `Textures/` 中**没有对应文件**，
而是复用已有的 `Resource_Texture0/1/2`：即**一个资源可以服务多个哈希**。
这一点对 EFML4A 的 `texture.replace` 设计有影响：一个 `source` 应允许被多个 `identify` 命中。

**格式维度**：EFMI 用 `BC5-Linear` / `BC7-sRGB` / `BC7-Linear` 区分
「线性空间 vs sRGB 空间」，而**这个选择由目标贴图在游戏里的用途决定，不能自行猜测**。
EFML4A 的 `texture.replace` 目前只有 `format: Option<String>`，
需要补充**色彩空间**字段（`srgb` / `linear`）。

## 13.7 依赖与生态（重要）

`Credits.txt` 明确列出了**运行时依赖**：

```
Dependencies
1 RabbitFX  v26  required .
2 EFMI version must be higher than 1.4.5 .
```

以及用户热键：

```
Toggles
Horn~Headpiece  -  [
Tail  -  ]
Top  -  ;
Skirt  -  '
```

两个结论：

1. **EFMI mod 可以有跨包依赖**（本例强制依赖 `RabbitFx v26`）。
   [10-mod-format.md](/blog/efml4a-10-mod-format/) 的 manifest **没有依赖声明字段**——这是设计缺口。
   需要新增 `[[dependency]]`（id + 版本要求 + 是否必需），并在 `efml validate` 中做依赖检查。
2. **热键是 mod 自选的任意按键**（`[`、`]`、`;`、`'`），且按部件分组。
   在 Android 上没有键盘，所以 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 给出的
   「Android 交互映射」不是可选优化，而是**必须由加载器提供的能力**——
   加载器需要把每个 mod 的 `KeyPart` 自动转成悬浮窗按钮或通知栏开关。

## 13.8 完整性校验：EFMI 已有约定

ini 文件末尾带有一行校验和注释：

```
; SHA256 CHECKSUM: 232e42b10ba10bcb2484461532251a2bd62c14c48ab0f7e23cd226509d9673cd
```

这印证了 [10-mod-format.md](/blog/efml4a-10-mod-format/) 引入 `checksums.txt` 的方向是对的，
但 EFMI 的做法是**把校验和写在被校验文件自己的尾部注释里**。
EFML4A 采用独立 `checksums.txt` 更好：它不必修改被校验文件的内容，
因而不会因为「写校验和」而改变文件本身的哈希（EFMI 那种做法的自指问题需要额外规则绕开）。

## 13.9 对已有文档的更正汇总

| 编号 | 原表述 | 实测更正 | 影响文档 |
| --- | --- | --- | --- |
| C-1 | mod 目录含 `Buffer/`、`Texture/` | 实为 `Meshes/`、`Textures/` | 02、10 |
| C-2 | 识别依赖顶点/索引哈希 | 入口只匹配 **`ib` 哈希 + 索引数**，并受 `DRAW_TYPE == 4` 门控 | 02、04、10 |
| C-3 | `stride` 是顶点步长 | 对 `R16_UINT` 索引缓冲，`stride` = 每图元 3×2 字节；对 VB 是各语义 stride 之和 | 10 |
| C-4 | EFMI 无自带语义元数据 | `Components.buf` 是 JSON 语义清单（等价于本项目的 `vertex_layout`） | 10、09 |
| C-5 | mod 格式无依赖概念 | 存在强制跨包依赖（`RabbitFx v26`） | 10 |
| C-6 | 贴图替换只需 source + format | 还需**色彩空间**（sRGB / Linear），且一个 source 可服务多个哈希 | 10 |
| C-7 | — | 顶点格式需**运行时改写**（骨骼数 > 256），Vulkan 下必须另寻路径 | 09、04 |
| C-8 | — | 真实 mod 包普遍含**未被引用的遗留文件**，校验器应报告 | 10、09 |

## 13.10 本次剖析新产生的待验证问题

| # | 问题 | 影响 |
| --- | --- | --- |
| N-1 | `match_first_index = 0` 恒为零是生成约定还是特例 | 决定识别器是否需要该维度 |
| N-2 | `drawindexedinstanced` 首参为 0 的确切语义 | 决定遗留文件是否只是坏文件 |
| N-3 | `RabbitFx` 提供什么能力（贴图设置？shader 补丁？） | 决定 EFML4A 是否需要「框架级 mod」概念 |
| N-4 | `MeshesG0/G1/G2` 对应的游戏档位（画质？平台？） | 决定 IR 是否需要「变体」维度 |
| N-5 | 25 380 个顶点 / 422 骨骼的实际数据能否被正确解析 | M1 的首要验证目标 |
| N-6 | `vb3` 镜像 `vb0` 是游戏 shader 的普遍需求还是本 mod 特例 | 影响顶点流绑定表设计 |

## 13.11 参考

- 样本 mod 包内 `mod.ini`、`modG0.ini`、`Credits.txt`、`MeshesG0/Components.buf`（本地解包产物，未入库）
- [EFMI-Package](https://github.com/SpectrumQT/EFMI-Package) —— EFMI 本体（GPL-3.0）
- [EFMI-Tools](https://github.com/SpectrumQT/EFMI-Tools) —— 生成该 ini 的 Blender 插件（GPL-3.0）
- [GameBanana · Endfield mods](https://gamebanana.com/games/21842) —— mod 分发平台
