---
title: "10 · EFML4A Mod 包格式规范 v0"
description: "EFML4A 研究文档 · 10-mod-format（Arknights: Endfield Mod Loader for Android）"
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

> ⚠️ **部分结论已被 [13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) 的一手实测取代**（stride 语义、唯一识别键、依赖声明、色彩空间等，共 8 处）。两者冲突时**以 13 为准**。

| 项 | 值 |
| --- | --- |
| 规范名称 | EFML4A Mod Package Format |
| 规范版本 | `format_version = 0`（草案，可能发生破坏性变更） |
| IR ABI | `abi = "ir-0"` |
| 状态 | **Draft** — 仅用于本项目内部与私有期实验，尚未稳定 |
| 关联文档 | [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)、[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)、[06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)、[08-threat-model.md](/blog/efml4a-08-threat-model/) |
| 关键词 | MUST / MUST NOT / SHOULD / MAY 按 RFC 2119 惯例解释 |

---

## 1. 设计目标

### 1.1 与 EFMI mod 的关系

EFMI 的 mod 是**松散结构**：一个由 ini 文本 + HLSL 着色器 + `Buffer\` / `Texture\` 二进制目录组成的文件夹，由 3DMigoto 血统的解释器在运行时解析执行。它的优点是上手成本极低、可手工调试；缺点是 **没有 schema、不可静态校验、与某个具体解释器的运行时语义强绑定**。

> ⚠️ 未核实：EFMI mod 的具体目录名、ini 段落名与键名未在本次核查中读取到原文，本文档不引用任何具体键名。所有涉及 EFMI 的对应关系只做**概念级**描述，并在 §5 中逐条标注核实状态。

### 1.2 EFML4A 的目标

| 目标 | 含义 | 动机 |
| --- | --- | --- |
| **声明式** | mod 只描述"想要什么效果"，不描述"怎么注入" | 同一份描述要能在多条后端上执行 |
| **可校验** | 包结构、字段类型、文件哈希、版本范围全部可静态检查 | 见 [08-threat-model.md](/blog/efml4a-08-threat-model/) §5.2 供应链风险 |
| **跨路线** | IR 与后端解耦：`vulkan-layer` / `il2cpp-hook` / `assetbundle` 各自实现同一 IR | 见 [07-route-matrix.md](/blog/efml4a-07-route-matrix/) 的路线选型与回退需求 |
| **可识别、可回退** | 资源识别是**显式声明**的，且有多级回退链 | 游戏版本更新必然改变哈希与路径 |
| **失败可见** | 宁可拒绝加载，也不静默错渲 | 错渲比不渲染更难排查 |
| **纯数据优先** | 默认不执行包内代码 | 供应链与安全（见 [08-threat-model.md](/blog/efml4a-08-threat-model/) §5.2） |

### 1.3 明确非目标

- 不定义后端实现细节（层注册、hook 技术）——见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)。
- 不定义数值修改能力：本格式**没有**任何可用于修改玩法数值的字段（对应红线 R-01）；不定义网络/分发协议。

---

## 2. 包结构

### 2.1 目录布局

```text
<mod-id>/
├── mod.toml            # 必需：manifest（§3）+ 可选的 IR 内联（§4）
├── checksums.txt       # 必需：全文件 sha256 清单（§6.1）
├── mod.sig             # 可选：对 checksums.txt 的分离签名（§6.2）
├── mesh/               # 网格与骨骼二进制数据
├── texture/            # 贴图（ktx2 / dds / png）
├── shader/             # 可选：自定义着色器（默认不执行，需显式 opt-in）
├── config/             # 可选：后端相关提示与用户可调参数
├── ir/                 # 可选：当 IR 不内联在 mod.toml 时，按entry 指向的文件拆分
└── LICENSE             # 强烈建议：本 mod 自身的许可文本
```

| 路径 | 必需 | 允许的文件类型 | 说明 |
| --- | --- | --- | --- |
| `mod.toml` | ✅ | TOML (UTF-8) | 唯一的入口清单；也是默认的 IR 载体 |
| `checksums.txt` | ✅ | 文本 | 每行 `<sha256>  <相对路径>`，路径使用 `/` |
| `mod.sig` | ❌ | 二进制 | Ed25519 分离签名（§6.2） |
| `mesh/` | ❌ | `.efmesh`、`.bin` | 顶点流 / 索引流 / bindpose / morph delta |
| `texture/` | ❌ | `.ktx2`、`.dds`、`.png` | 推荐 ktx2（跨后端一致，含块压缩与 mip） |
| `shader/` | ❌ | `.hlsl`、`.glsl`、`.spv` | **默认禁止执行**，需 `config` 中显式允许且用户确认 |
| `config/` | ❌ | `.toml` | `vulkan-layer.toml`、`il2cpp-hook.toml` 等后端提示 |
| `ir/` | ❌ | `.toml` | 与 manifest 同语法，可被 `entry` 指向 |

### 2.2 包根与路径规则

1. 包根 MUST 只有一个 `mod.toml`；加载器 MUST NOT 递归搜索子目录中的其他 `mod.toml`。
2. 路径字段 MUST 为包根相对路径（`/` 分隔、不以 `/` 开头）；加载器 MUST 拒绝含 `..` 段、符号链接或指向包根之外的路径（见 [08-threat-model.md](/blog/efml4a-08-threat-model/) §5.2）。
3. 文件名 SHOULD 只用 `[a-z0-9._-]`，加载器 MUST NOT 依赖大小写；`mesh/`、`texture/` 内文件 MUST 出现在 `checksums.txt` 中（`mod.toml`、`checksums.txt`、`mod.sig` 自身除外）。

---

## 3. Manifest 规范（`mod.toml`）

### 3.1 顶层字段

所有 manifest 字段位于 `[mod]` 表内。**除 `id`、`name`、`version`、`license`、`entry`、 `format_version`、`abi`、`target` 外均为可选。**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `format_version` | integer | ✅ | 包格式版本。v0 固定为 `0`（§9） |
| `id` | string | ✅ | 全局唯一标识，`^[a-z0-9][a-z0-9._-]{2,63}$`，SHOULD 用反向域名风格 |
| `name` | string | ✅ | 人类可读名称（UTF-8，可含中文） |
| `version` | string | ✅ | mod 自身版本，SemVer 2.0.0 |
| `authors` | array&lt;string&gt; | ❌ | 作者署名列表 |
| `license` | string | ✅ | 本 mod 数据/代码的许可，SPDX 表达式优先（如 `CC-BY-4.0`、`AGPL-3.0-only`） |
| `description` | string | ❌ | 一句话描述 |
| `homepage` | string | ❌ | 项目页 URL |
| `target` | table | ✅ | 目标游戏与版本范围（§3.2） |
| `min_loader_version` | string | ❌ | 最低加载器版本（SemVer），语义见 §6.4 |
| `backends` | array&lt;string&gt; | ✅ | 允许的后端：`vulkan-layer` / `il2cpp-hook` / `assetbundle`；空数组表示"任意" |
| `abi` | string | ✅ | IR ABI 标识；v0 固定为 `"ir-0"` |
| `entry` | string | ✅ | IR 文档路径，通常是 `"mod.toml"` |
| `requires` | array&lt;string&gt; | ❌ | 硬性能力要求（§6.4）：后端不支持即拒绝加载 |
| `tags` | array&lt;string&gt; | ❌ | 分类标签，供 UI 使用 |

### 3.2 `target` 子表

```toml
[mod.target]
game = "arknights-endfield"      # 逻辑游戏标识，非商店 ID
version = ">=1.0.0, <2.0.0"      # 游戏客户端版本范围（SemVer 范围语法）
platform = ["android-arm64"]     # 允许的平台
unity = ">=2022.3"               # 可选：Unity 运行时版本范围
```

> ⚠️ 未核实：`game` 的规范取值、以及如何从客户端稳定读取"游戏版本"（包名版本 / 资源版本 / 内置版本号），需要在 [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/) 中确定； v0 允许加载器在无法判定版本时按"宽松模式"放行并记录警告。

## 4. 中间表示（IR）

IR 是**与路线无关**的描述：它只说明"哪个资源要被什么替换"，不含任何注入手段。所有后端 MUST 实现同一套 IR 语义，允许在能力不足时**拒绝加载**（配合 `requires`），但 MUST NOT 静默降级为错渲。

### 4.1 资源识别器 `identify`（全 IR 通用）

`identify` 是一个**有序数组**，元素为策略表；数组内元素之间是 **OR**（先匹配者胜），单个元素内的多个键是 **AND**。

| 策略 | 字段 | 匹配对象 | 稳定性 | 适用后端 |
| --- | --- | --- | --- | --- |
| `unity_path` | `value` | Unity 资源逻辑路径 / 对象名 | 低（版本更新易变，但可读性好） | il2cpp-hook、assetbundle |
| `asset_path` | `value` | AssetBundle 内的容器路径或文件名 | 中 | assetbundle、vulkan-layer |
| `pipeline_hash` | `value`（hex） | 图形管线状态哈希 | 中（驱动/版本敏感，但唯一性强） | vulkan-layer |
| `vertex_signature` | `value`（hex）、`count`? | 顶点流结构 + 顶点数/索引数指纹 | 中—高 | 全部 |

```toml
identify = [
  { strategy = "unity_path",      value = "Assets/Characters/Example/Body.mesh" },
  { strategy = "asset_path",      value = "characters/example/body_mesh.bundle" },
  { strategy = "pipeline_hash",   value = "9f3a1c7e5d2b04f8" },
  { strategy = "vertex_signature", value = "sha256:6b2f...", count = 8123 },
]
```

**回退链规则（MUST）**

1. 后端按数组顺序求值，遇到第一个可求值且匹配成功的策略即采用。
2. 若某策略在当前后端**不可求值**（例如 `pipeline_hash` 在 `il2cpp-hook` 后端无意义），后端 MUST 跳过该元素并继续求值下一个，同时发出 `identify:skip` 诊断事件。
3. 若数组全部元素都不可求值或都不匹配，后端 MUST 发出 `identify:miss` 事件并**放弃该条 IR**， MUST NOT 用"最相似"的资源兜底。
4. 后端 SHOULD 提供 `--identify-report` 输出（哪些 IR 命中、命中于哪条策略），用于 mod 作者定位。
5. `strict` 模式：`identify` 元素可加 `strict = true`，表示该元素不可跳过（用于防止版本漂移导致 误命中其他资源）。

> 设计动机：3DMigoto 系生态长期依赖"哈希猎取"这一经验流程，好处是精准、坏处是版本一更新就全废。我们把"多策略 + 显式回退 + 命中报告"内建进格式，让作者可以同时写下语义路径与哈希，由加载器择优。

### 4.2 网格替换 `[[mesh.replace]]`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 本包内唯一，供 `material.override` / `blendshape` 引用 |
| `identify` | array&lt;table&gt; | ✅ | §4.1 |
| `vertex_layout` | table | ✅ | `stride` + `attributes`（见下） |
| `buffers` | array&lt;table&gt; | ✅ | `role` / `source` / `sha256` / `stride`? |
| `submeshes` | array&lt;table&gt; | ✅ | `index_offset` / `index_count` / `topology` / `material` |
| `winding` | string | ❌ | `ccw`（默认）/ `cw`；用于坐标系差异 |
| `coordinate_system` | string | ❌ | `unity-lhs`（默认）/ `rhs`；用于导入 3D 工具坐标系 |
| `lod` | integer | ❌ | LOD 层级，默认 `0` |

```toml
[[mesh.replace]]
id      = "body_main"
lod     = 0
winding = "ccw"

[mesh.replace.vertex_layout]
stride = 40
attributes = [
  { semantic = "POSITION",     format = "float32x3", offset =  0 },
  { semantic = "NORMAL",       format = "float32x3", offset = 12 },
  { semantic = "TANGENT",      format = "float32x4", offset = 24 },
  { semantic = "BLENDINDICES", format = "uint8x4",   offset = 28 },
  { semantic = "BLENDWEIGHT",  format = "unorm8x4",  offset = 32 },
  { semantic = "TEXCOORD0",    format = "float16x2", offset = 36 },
]

buffers = [
  { role = "vertex0", source = "mesh/body_main.vertex0.bin", sha256 = "<hex64>" },
  { role = "index0",  source = "mesh/body_main.index0.bin",  sha256 = "<hex64>" },
]

submeshes = [
  { index_offset = 0,    index_count = 30000, topology = "trianglelist", material = "mat_face" },
  { index_offset = 30000, index_count = 3244, topology = "trianglelist", material = "mat_eye" },
]
```

**规范约束**

- `attributes[].offset + size(format) <= stride` MUST 成立，加载器 MUST 在加载期静态校验。
- `format` MUST 取自固定枚举：`float32x{1..4}`、`float16x{1..4}`、`uint32`、`uint16`、`uint8x{2,4}`、`unorm8x4`、`snorm16x{2,4}`；未知 `format` 值 MUST 使该条 IR 加载失败（而非猜测）。
- `role` MUST 取自 `vertex0..vertex7`、`index0..index3`、`bindpose`、`morph0..morph7`；`vertex_signature` 由加载器按 `(stride, attributes, vertex_count, index_count)` 计算。

### 4.3 骨骼映射 `[[skeleton.map]]`

对应 EFMI 的 **MergedSkeleton** 概念（合并骨架）：把外来模型骨架重映射到游戏原有骨架。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 映射表名 |
| `identify` | array&lt;table&gt; | ✅ | 目标骨架的识别 |
| `bindpose` | string | ❌ | 可选：覆盖 bindpose 二进制路径 |
| `bones` | array&lt;table&gt; | ✅ | `source` → `target` 的成对映射 |
| `unmapped_policy` | string | ❌ | `keep`（默认）/ `drop`；未映射骨骼的处理 |

```toml
[[skeleton.map]]
id = "merged_skeleton"
bindpose = "mesh/bindpose.bin"
unmapped_policy = "drop"
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Armature" }]
bones = [
  { source = "Root",          target = "Root" },
  { source = "Bip001/Spine",  target = "Root/Spine_01" },
  { source = "Bip001/L Hand", target = "Root/Hand_L" },
]
```

**规范约束**：`target` MUST 存在于游戏侧骨架中；不存在的 `target` MUST 产生 `skeleton:missing_bone` 并使该条 IR 失败（`unmapped_policy` 只影响**未在表中出现**的骨骼）。

### 4.4 Shape key / BlendShape `[[blendshape]]`

对应 EFMI 的 **ShapeKeys** 概念（形变目标）。

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 形状名（同时作为游戏侧 blend shape 名称的候选匹配值） |
| `mesh` | string | ✅ | 引用某个 `[[mesh.replace]].id` |
| `deltas` | string | ✅ | morph delta 二进制（`float32x3` 数组，逐顶点） |
| `format` | string | ❌ | 默认 `float32x3`；允许 `snorm16x4`（含切线增量） |
| `vertex_count` | integer | ✅ | 必须与 `mesh` 的顶点数一致，否则加载失败 |
| `default_weight` | float | ❌ | 默认权重，`0.0` |
| `sparse` | table | ❌ | `{ indices = "mesh/x.idx.bin" }` 稀疏模式 |

```toml
[[blendshape]]
id             = "smile"
mesh           = "body_main"
deltas         = "mesh/body_main.smile.delta.bin"
vertex_count   = 8123
default_weight = 0.0
```

> 别名：`[[shapekey]]` 在 v0 中被接受并**等价于** `[[blendshape]]`，但加载器 MUST 输出弃用警告，该别名计划在 `format_version = 1` 中移除（§9.2）。

### 4.5 材质覆盖 `[[material.override]]`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 本包内唯一 |
| `identify` | array&lt;table&gt; | ✅ | 目标材质的识别 |
| `set` | table | ✅ | 属性名 → 值表（见下） |
| `inherit` | bool | ❌ | 默认 `true`：未列出的属性保持游戏原值 |

`set` 的每个值是**类型化**的，MUST 恰有且仅有一个类型键：

```toml
[[material.override]]
id = "mat_body"
inherit = true
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Body_Mat" }]

[material.override.set]
_MainTex      = { texture = "body_basecolor" }   # 引用 [[texture.replace]].id
_NormalTex    = { texture = "body_normal" }
_OutlineWidth = { float = 0.0 }
_RimColor     = { color = [0.2, 0.6, 1.0, 1.0] }
_TwoSided     = { bool = true }
_Keyword      = { keyword = "USE_CUSTOM_RIM" }   # 着色器关键字开关
```

> ⚠️ 未核实：游戏实际材质属性名（如 `_MainTex` 之类）未在本次核查中验证，**上述属性名仅作语法示例**。真实属性名应来自 mod 作者对目标游戏的实测，并建议在 `config/` 中记录来源。

**限制（MUST）**：`set` MUST NOT 接受任何脚本表达式、条件分支或算术运算。v0 只允许**常量赋值** 与**纹理引用**。这是刻意设计：表达式求值会把包变成可执行代码，违背"纯数据优先"目标，也与 [08-threat-model.md](/blog/efml4a-08-threat-model/) §5.2 的供应链缓解冲突。

### 4.6 贴图替换 `[[texture.replace]]`

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 供 `material.override` 引用 |
| `identify` | array&lt;table&gt; | ✅ | 目标贴图槽 / 资源 |
| `source` | string | ✅ | 包内路径 |
| `format` | string | ❌ | `ktx2-bc7` / `ktx2-astc4x4` / `dds-bc7` / `png-rgba8` 等 |
| `srgb` | bool | ❌ | 默认 `true`；法线/掩码贴图应显式设 `false` |
| `mips` | string | ❌ | `from-file`（默认）/ `generate` / `none` |
| `size` | array&lt;int&gt; | ❌ | `[w, h]` 期望值，用于加载期一致性校验 |

```toml
[[texture.replace]]
id = "body_basecolor"
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Body_BaseColor" }]
source = "texture/body_basecolor.ktx2"
format = "ktx2-astc4x4"
srgb = true
mips = "from-file"
size = [2048, 2048]
```

### 4.7 IR 顺序与依赖

1. IR 段之间无隐式顺序：加载器 MUST 先解析全部段，再做引用完整性检查（`mesh`/`texture` 的 `id` 必须存在），最后才应用。
2. 引用不存在的 `id` MUST 导致加载失败（`ir:unresolved_ref`）；同一 `identify` 命中多条同类 IR 时 MUST 报错（`ir:ambiguous_target`）而非任选一条。

---

## 5. 与 EFMI 的概念映射

本节是"对标 EFMI"的核心交付物。**由于本次核查未读取到 EFMI 的 ini 语法原文，本节只做概念级映射，所有具体键名一律标注核实状态；请勿把本表当作 EFMI 的键名参考。**

| # | EFMI / 3DMigoto 血统中的概念 | EFML4A 对应字段 | 映射说明 | 核实状态 |
| --- | --- | --- | --- | --- |
| M-01 | mod 以 ini 段落声明"对某个 draw call / 资源生效" | `[[mesh.replace]]`、`[[texture.replace]]`、`[[material.override]]` 的 `identify` | 从"段落名 + 哈希"改为"结构化识别器数组" | > ⚠️ 未核实：EFMI 的 ini 段落命名规则与 `hash` 键名 |
| M-02 | 用哈希（shader / texture hash）命中目标 | `identify[].strategy = "pipeline_hash"` | 概念一致；v0 额外允许语义路径与顶点指纹 | > ⚠️ 未核实：哈希所用算法与键名 |
| M-03 | 顶点缓冲 / 索引缓冲的覆盖（`ib` / `vb0` 一类键） | `[[mesh.replace]].buffers[]`（`role` + `source`） | 从"内联覆盖指令"改为"命名缓冲资源 + 显式 layout" | > ⚠️ 未核实：`ib` / `vb0` 等具体键名与其语义 |
| M-04 | 顶点布局由 ini 中的顶点定义段落描述 | `[mesh.replace.vertex_layout]`（`stride` + `attributes`） | 显式化 + 强类型 + 可静态校验（offset/stride 自洽） | > ⚠️ 未核实：EFMI 的顶点定义语法形式 |
| M-05 | 贴图覆盖（`Resource\...` 目录下放图 + ini 绑定） | `[[texture.replace]]` + `material.override.set.<attr>.texture` | 资源与绑定解耦：文件按 `id` 命名，由材质段引用 | > ⚠️ 未核实：资源目录约定与绑定键名 |
| M-06 | 材质/着色器常量覆盖（INI 参数覆盖） | `[[material.override]].set` | 限制为常量赋值与纹理引用，**不允许表达式** | > ⚠️ 未核实：参数覆盖的键名与作用域 |
| M-07 | MergedSkeleton（合并骨架 / 骨骼重映射表） | `[[skeleton.map]]`（`bones[]` + `bindpose` + `unmapped_policy`） | 概念一一对应；增加"未映射骨骼策略"与目标存在性校验 | > ⚠️ 未核实：EFMI 侧具体字段名与文件格式 |
| M-08 | ShapeKeys（形变 / morph target 注入） | `[[blendshape]]`（`deltas` + `vertex_count`） | 概念一一对应；增加顶点数一致性硬校验与稀疏模式 | > ⚠️ 未核实：EFMI 侧的具体键名与 delta 编码 |
| M-09 | HLSL 着色器替换与自定义渲染逻辑 | `shader/` + `[[material.override]].set._Keyword` | **v0 默认不执行包内着色器**：改为关键字开关 + 后端内建材质变体 | > ⚠️ 未核实：EFMI 的 HLSL 注入点与 patch 语法 |
| M-10 | 通过解释器运行时命令序列驱动（CommandList 一类机制） | **无对应**：v0 无过程式命令 | 刻意不支持：过程式命令使包等价于可执行代码 | > ⚠️ 未核实：EFMI 是否暴露此类机制及其语法 |
| M-11 | 每个 mod 一个文件夹（ini + 资源目录）；由启动器统一安装切换 | `mod.toml` + `mesh/` + `texture/` + `config/` + `checksums.txt` | 结构类似，但增加清单、哈希清单与签名位；安装协议留给加载器与 [09-architecture.md](/blog/efml4a-09-architecture/) | — |

> **迁移路径**：EFMI mod → EFML4A mod 的转换器只做**结构转换**（解析 ini 段落、抽取资源、重写为 IR），不复制 EFMI 的代码。转换器自身若基于 EFMI 代码实现，则必须整体以 AGPL-3.0 分发（见 [08-threat-model.md](/blog/efml4a-08-threat-model/) §4.3）。

---

## 6. 校验、签名与版本协商

### 6.1 `checksums.txt`

```text
# 格式：<sha256-hex>  <相对路径>     （两个空格分隔；# 起始行为注释）
<hex64>  mesh/body_main.vertex0.bin
<hex64>  mesh/body_main.index0.bin
<hex64>  texture/body_basecolor.ktx2
```

| 规则 | 级别 |
| --- | --- |
| 每行 MUST 为 `<64位小写hex>` + 两个空格 + 包根相对路径 | MUST |
| 覆盖全部 `mesh/`、`texture/`、`shader/`、`ir/` 文件与 `mod.toml` 之外的资源 | MUST |
| 加载器 MUST 在加载前校验全部条目；任一不匹配即拒绝加载 | MUST |
| `checksums.txt` 中未列出的文件 MUST 被忽略（不加载、不报错） | MUST |
| 加载器 SHOULD 提供 `--no-verify`（仅开发模式，且 MUST 打印显著警告） | SHOULD |

### 6.2 可选签名 `mod.sig`

- 算法：Ed25519（v0 唯一允许的算法）。
- 签名对象：`checksums.txt` 的**原始字节**（不规范化换行）。
- 格式：`mod.sig` = 4 字节魔数 `EFS1` + 32 字节公钥 + 64 字节签名。
- 信任模型：加载器维护"受信任指纹列表"；`mod.sig` 的公钥不在列表内时，加载器 MUST 提示用户并 要求显式确认（TOFU 语义），MUST NOT 静默接受。
- 未签名包 MUST 被允许（否则生态无法启动），但加载器 SHOULD 在 UI 中标注"未签名"。

### 6.3 加载决策流程（MUST）

```text
1 mod.toml 存在且可解析  2 format_version 检查(§6.5)  3 abi 精确匹配  4 min_loader_version(§6.4)
5 target 版本范围(无法判定 → 宽松放行+警告)  6 backends 与当前后端求交(空 → backend:unsupported)
7 requires 能力检查(§6.4)  8 checksums.txt 全量校验  9 mod.sig 校验(存在时)
10 IR 解析与静态校验(offset/stride、枚举值、引用完整性、顶点数一致性)  11 应用
任一 MUST 级步骤失败 → 整包拒绝加载，不部分应用。
```

### 6.4 `min_loader_version` 与 `requires` 语义

| 字段 | 语义 | 失败行为 |
| --- | --- | --- |
| `min_loader_version` | 语义化版本比较：加载器版本 < 该值即不满足 | 默认拒绝加载；`--force-version` 仅开发模式可用且 MUST 警告 |
| `requires` | 硬性**能力**要求，取值来自固定词汇表：`blendshape`、`skeleton.map`、`vertex_layout.custom`、`backends.multi` 等 | 当前后端不支持任一能力 → 拒绝加载（`capability:missing`） |

> 设计动机：`min_loader_version` 解决"新字段被旧加载器误解"的问题，`requires` 解决"旧加载器不认新字段于是照常加载导致错渲"的问题。两者互补，缺一不可。

### 6.5 版本协商与兼容策略

| 情况 | 处理 |
| --- | --- |
| `format_version > loader.max_supported` | **拒绝**，提示升级加载器 |
| `format_version == loader.supported` | 正常加载 |
| `format_version < loader.supported` 且存在兼容层 | 加载 + 弃用警告 |
| `format_version < loader.supported` 且无兼容层 | 拒绝 |
| `abi` 不在加载器支持列表 | **拒绝**（ABI 不做模糊匹配） |

### 6.6 未知字段与未知值

- 加载器 MUST **忽略** `mod.toml` 中任何未识别的**键**，MUST NOT 因此报错或拒绝加载。 理由：向前兼容——旧加载器必须能读新包（新包通过 `requires` 声明它不能降级运行的部分）。
- 加载器 MUST NOT 忽略枚举型字段的**未知值**（如 `format`、`role`、`strategy`）：遇到未知值 MUST 使对应 IR 条目加载失败。 理由：枚举值决定字节的解释方式，猜错会错渲。
- 未来的 breaking 字段 SHOULD 放在新的表名下（如 `[mod.v1]`），而不是改变既有字段语义。

---

## 7. 热重载语义

### 7.1 可热重载 / 需重启

| 改动 | 是否可热重载 | 说明 |
| --- | --- | --- |
| `texture/*` 内容（同尺寸同格式） | ✅ 立即 | 后端重建图像视图并替换描述符 |
| `material.override.set.<attr>.float/color/bool/keyword` | ✅ 立即 | 仅更新常量缓冲 / 关键字变体 |
| `blendshape` 的权重 | ✅ 立即 | 仅更新权重，不重建网格 |
| `blendshape` 的 `deltas` 文件内容 | ✅ 需重载网格数据 | 顶点数必须不变，否则拒绝 |
| `mesh.replace` 的 `buffers` 内容（同 layout 同计数） | ✅ 后端相关 | Vulkan 层通常可换；IL2CPP hook 需场景重载 |
| `mesh.replace` 的 `vertex_layout`、`identify`、`submeshes` | ❌ 需重启或重新进入场景 | 影响识别与管线状态 |
| `skeleton.map` | ❌ 需重启 | 影响骨骼绑定与蒙皮 |
| `shader/*` | ❌ 需重启 | 管线/着色器变体需重建 |
| 新增 / 移除 mod | ❌ 需重启（`il2cpp-hook` 后端强制） | `vulkan-layer` MAY 支持运行时挂载 |
| `mod.toml` 的 manifest 字段（`backends`、`abi`、`requires`） | ❌ 需重启 | 属于加载决策输入 |

### 7.2 事件与生命周期钩子

| 事件 | 触发时机 | 载荷 |
| --- | --- | --- |
| `mod:load_begin` / `mod:load_end` | 加载前后 | `mod.id`、耗时、结果 |
| `identify:skip` / `identify:miss` / `ir:applied` / `ir:failed` | 识别器跳过或全部未命中 / 单条 IR 成功或失败 | IR 条目、尝试过的策略、命中策略、错误码 |
| `hotreload:begin` / `hotreload:end` / `mod:unload` | 热重载前后 / 卸载 | 变更文件列表、释放的资源列表 |

- **钩子只用于加载器与 UI 的事件通知，v0 MUST NOT 允许 mod 注册回调代码。**
- `config/<backend>.toml` MAY 声明 `hot_reload = false` 以禁用该后端的热重载（稳定性优先）。
- 热重载失败 MUST 回滚到上一个可用状态，MUST NOT 留下半应用状态。

---

## 8. 工作示例：`mods/example-mod/`

### 8.1 目录树

```text
mods/example-mod/
├── mod.toml
├── checksums.txt
├── LICENSE                     # CC-BY-4.0 文本
├── mesh/
│   ├── body_main.vertex0.bin   # 8123 顶点 × 40 字节
│   ├── body_main.index0.bin    # 33244 个 uint16 索引
│   ├── body_main.smile.delta.bin
│   └── bindpose.bin
├── texture/
│   ├── body_basecolor.ktx2
│   └── body_normal.ktx2
└── config/
    └── vulkan-layer.toml
```

### 8.2 `mod.toml` 全文

```toml
[mod]
id = "dev.example.face-recolor"
name = "示例：脸部配色与微笑形变"
version = "0.1.0"
authors = ["example"]
license = "CC-BY-4.0"
description = "演示 mesh / texture / material / blendshape / skeleton 五类 IR。"
format_version     = 0
abi                = "ir-0"
backends           = ["vulkan-layer", "il2cpp-hook"]
requires           = ["blendshape"]
min_loader_version = "0.1.0"
entry              = "mod.toml"

[mod.target]
game     = "arknights-endfield"
version  = ">=1.0.0, <2.0.0"
platform = ["android-arm64"]

[[mesh.replace]]
id      = "body_main"
winding = "ccw"
identify = [
  { strategy = "unity_path", value = "Assets/Characters/Example/Body.mesh" },
  { strategy = "vertex_signature", value = "sha256:6b2f0d1a...", count = 8123 },
]

[mesh.replace.vertex_layout]
stride = 40
attributes = [
  { semantic = "POSITION",     format = "float32x3", offset =  0 },
  { semantic = "NORMAL",       format = "float32x3", offset = 12 },
  { semantic = "TANGENT",      format = "float32x4", offset = 24 },
  { semantic = "BLENDINDICES", format = "uint8x4",   offset = 28 },
  { semantic = "BLENDWEIGHT",  format = "unorm8x4",  offset = 32 },
  { semantic = "TEXCOORD0",    format = "float16x2", offset = 36 },
]

buffers = [
  { role = "vertex0", source = "mesh/body_main.vertex0.bin", sha256 = "<hex64>" },
  { role = "index0",  source = "mesh/body_main.index0.bin",  sha256 = "<hex64>" },
]

submeshes = [
  { index_offset = 0,     index_count = 30000, topology = "trianglelist", material = "mat_face" },
  { index_offset = 30000, index_count = 3244,  topology = "trianglelist", material = "mat_eye" },
]

[[skeleton.map]]
id = "merged_skeleton"
bindpose = "mesh/bindpose.bin"
unmapped_policy = "drop"
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Armature" }]
bones = [
  { source = "Root",         target = "Root" },
  { source = "Bip001/Spine", target = "Root/Spine_01" },
  { source = "Bip001/Head",  target = "Root/Head" },
]

[[blendshape]]
id = "smile"
mesh = "body_main"
deltas = "mesh/body_main.smile.delta.bin"
vertex_count = 8123
default_weight = 0.0

[[texture.replace]]
id = "body_basecolor"
source = "texture/body_basecolor.ktx2"
format = "ktx2-astc4x4"
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Body_BaseColor" }]

[[texture.replace]]
id = "body_normal"
source = "texture/body_normal.ktx2"
format = "ktx2-astc4x4"
srgb = false
identify = [{ strategy = "asset_path", value = "characters/example/body_normal" }]

[[material.override]]
id = "mat_face"
inherit = true
identify = [{ strategy = "unity_path", value = "Assets/Characters/Example/Face_Mat" }]

[material.override.set]
_MainTex   = { texture = "body_basecolor" }
_NormalTex = { texture = "body_normal" }
```

### 8.3 配套文件说明

| 文件 | 内容 | 约束 |
| --- | --- | --- |
| `mesh/body_main.vertex0.bin` | 8123 顶点 × 40 字节，属性布局如上 | 文件大小 MUST 等于 `8123 × 40` |
| `mesh/body_main.index0.bin` | 33244 个 `uint16` 索引（两段 submesh 之和） | 索引值 MUST 全部 < 8123 |
| `mesh/body_main.smile.delta.bin` | 8123 × `float32x3` 位移 | 大小 MUST 等于 `8123 × 12` |
| `mesh/bindpose.bin` | 每骨骼 16 个 `float32` 的逆绑定矩阵 | 骨骼数 MUST 与 `bones` 的目标骨架一致 |
| `texture/*.ktx2` | ASTC 4×4 块压缩 + 完整 mip 链 | 尺寸 MUST 与 `size` 一致 |
| `config/vulkan-layer.toml` | 后端提示（如 `hot_reload = true`、`prefer_pipeline_hash = true`） | 未知键 MUST 被忽略 |

---

## 9. 版本演进

### 9.1 `format_version` 规则

| 变更类型 | 是否需要提升 `format_version` | 例子 |
| --- | --- | --- |
| 新增**可选**字段 / 新 IR 段 | 否（SHOULD 记入 `requires` 声明能力） | 新增 `[[material.override]].optional_tag` |
| 新增**必需**字段 / 改变既有语义 / 删除字段 | 是（破坏性） | 强制 `stride`；`stride` 由字节改为属性计数；移除 `[[shapekey]]` |
| 新增枚举取值 | 否（但旧加载器会让该条 IR 失败，符合预期） | 新增 `format = "ktx2-bc6h"` |
| 仅修正文档措辞 | 否 | — |

### 9.2 废弃（deprecation）流程

1. **标记**：本文档标注 `Deprecated since format_version = N` 并给出替代写法。
2. **宽限**：加载器至少跨 **2 个次要版本**继续接受旧写法，但 MUST 输出弃用警告（日志 + UI 提示）。
3. **移除**：仅在下一个**主**版本移除，并在 CHANGELOG 与"迁移指南"中列出。
4. **已登记的第一个废弃项**：`[[shapekey]]` → `[[blendshape]]`（v0 接受 + 警告；计划在 `format_version = 1` 移除）。

### 9.3 向后兼容承诺（v0 特别声明）

> v0 是**草案**，不提供任何兼容承诺：`format_version` 可能在正式版发布前直接提升而不走 §9.2 的宽限流程。第三方实现者 SHOULD 以本文档的 git 历史为准，并优先实现 §4 的 IR 与 §6 的校验链路。

---

## 10. 交叉引用

- 设计输入：[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)、[07-route-matrix.md](/blog/efml4a-07-route-matrix/)
- 安全与合规：[08-threat-model.md](/blog/efml4a-08-threat-model/)（§4.2 许可、§5.2 供应链、§6 发布清单）
- 实现：[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)、[06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)、[09-architecture.md](/blog/efml4a-09-architecture/)
- 外部参考：[12-references.md](/blog/efml4a-12-references/)
