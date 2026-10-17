---
title: "02 · EFMI 解剖：ini 配置体系、哈希狩猎与 Android 可移植性边界"
description: "EFML4A 研究文档 · 02-efmi-anatomy（Arknights: Endfield Mod Loader for Android）"
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


**核实基线**：本文 ini/HLSL 片段均由 `gh api` 从真实文件读出，非推测。样本：`SpectrumQT/EFMI-Package@main`（`EFMI/d3dx.ini` 1068 行 / 51 425 B、`EFMI/Core/EFMI/**`、`EFMI/Core/EFMI/Shaders/*.hlsl`）、`SpectrumQT/EFMI-Tools@main`（`efmi-tools/templates/mod.ini.j2` 732 行、`guides/modder_guide.md`、`guides/shape_keys_guide.md`）；对照组 `SilentNightSound/GI-Model-Importer@main` 的 `3dmigoto GIMI (for playing mods).zip` → `d3dx.ini`（1188 行，2023-04 打包）、`bo3b/3Dmigoto@master` 的 `DirectX11/DrawCallInfo.h` 与 `DirectX11/CommandList.cpp`。版本号取自 `main.ini`：`global $version = 1.48`，界面串为 `"EFMI 1.4.8 (PRESS F12 TO SHOW GUIDE)"`。

## 1. 3DMigoto 的注入原理
### 1.1 代理 DLL：DXGI/D3D11 是唯一拦截点
3DMigoto 是一个**假冒的 `d3d11.dll`**：放进游戏 exe 同目录后，Windows 加载器解析 `d3d11.dll` 时先命中它而非 `System32`，于是 `D3D11CreateDevice`、全部 `ID3D11Device/Context::*`、`IDXGISwapChain::Present` 都流经它，它在转发前后插入自己的逻辑（换 shader、改资源绑定、改 draw call）。EFMI 走 **XXMI Launcher 外部注入**路线，`d3dx.ini` 的 `[Loader]` 段就是这份注入合同：
```ini
; EFMI/d3dx.ini L4-35 摘录
[Loader]
; WARNING! This release is intended to be loaded by XXMI Launcher and is missing required 3dmigoto DLLs!
target = Endfield.exe
loader = XXMI Launcher.exe
module = d3d11.dll
require_admin = true
```
即 **EFMI 仓库不含 DLL**，它只是「3DMigoto 的一个游戏专用配置包」。`[System]` 段另兜底三件事：`load_library_redirect = 2`（把 `d3d11.dll`/`nvapi.dll` 的 `LoadLibrary` 强制拉回游戏目录，注释理由是 *"games and nvidia both break the loading chain by going directly to System32"*）；`skip_early_includes_load = 1` + `config_initialization_delay = 0`（把 Mods 的 ini 解析整个移出 DLL 初始化，因为配置大时初始化期加载不如 reload 路径健壮）；`settings_auto_save_interval = 60`（persist 变量写盘周期）。

### 1.2 d3dx.ini 的角色
| section | 作用 |
|---|---|
| `[Loader]` | 目标进程 `Endfield.exe`、注入模块 `d3d11.dll`、提权 |
| `[Include]` | `include = Core\EFMI\main.ini` + `include_recursive = Mods`（`exclude_recursive = DISABLED*`） |
| `[Hunting]` | 狩猎模式开关与全部狩猎热键 |
| `[Constants]` | `global` / `global persist` 命名变量 |
| `[System]`/`[Device]`/`[Rendering]` | 加载重定向、全屏、哈希算法、shader 目录、`ini_params = 120` |
| `[Present]`/`[Logging]` | 每帧钩子（EFMI 留空，GUI 改在 `main.ini`）；日志与崩溃检测 |

`ini_params = 120` 让 DLL 占用 `t120` 注入一张 `Texture1D<float4> IniParams`（写法 `Texture1D<float4> IniParams : register(t120);`），这是 **ini 变量与 shader 之间唯一的通道**：ini 里的 `x0` 就是 `IniParams[0].x`。通道只有 x0..w1 八个 float4，故 `Helpers.ini` 提供 `CommandListBackupIniParams0/1` 与 `...RestoreIniParams0/1` 成对命令列表：先备份、dispatch 完再还原，避免与其他 mod 抢槽（`ShapeKeys.ini` 与 `MergedSkeleton.ini` 的每个 `[CustomShader*]` 都这样用）。

### 1.3 为什么 mod 分发 ini + hlsl 而不是代码
3DMigoto = **ini 解释器 + HLSL 运行时编译器 + 资源/draw 代理**。ini 段（`[TextureOverride*]`、`[ShaderOverride*]`、`[Resource*]`、`[CommandList*]`、`[Key*]`、`[Present]`）是**声明式数据**，DLL 读入后建索引表；HLSL 由 DLL 用 `D3DCompile` 现场编译并替换游戏 shader（EFMI 的 shape key / merged skeleton 全是 `[CustomShader*]` + `dispatch` 的 compute shader）。所以「一个 mod」= 被 `include_recursive` 扫到的目录（ini + 二进制 buffer + dds + hlsl），可读、可 diff、可热重载（F10）；代价是**性能模型完全由 DLL 解释器决定**。

## 2. EFMI 的 ini 配置体系
### 2.1 加载拓扑（路径均已核实存在）
```
EFMI/d3dx.ini
├─ [Include] Core\EFMI\main.ini          namespace = EFMIv1
│  ├─ Helpers.ini 实例迭代+IniParams 备份  ├─ TextPrinter.ini F12 指南/报错渲染
│  ├─ SpatialIdentification.ini 空间识别   ├─ MergedSkeleton.ini 骨骼合并（双实现）
│  ├─ ShapeKeys.ini 形态键（4 个 CS）      ├─ API.ini 面向 mod 作者的稳定接口
│  └─ KeyBindings.ini 热键；Libraries\Includes.ini → Help.ini, Mouse.ini；Core\auto_update.xcmd
├─ include_recursive = Mods              每个 mod 目录的 mod.ini
```
`main.ini` 自身只做 GUI、版本校验与 mod 注册（`namespace = EFMIv1`、`global $version = 1.48`、`global $enable_mods = 1`、`global persist $first_run = 1`、`[Present] run = CommandListRenderGUI`），其余引擎全部靠 `[Include*]` 段拼装。

### 2.2 namespace 契约（移植时必须逐字复刻）
每个 EFMI ini 首行写 `namespace = EFMIv1`。3DMigoto 段名规则为「前缀 = 段类型，其余 = 名字」，跨命名空间引用写作 `类型\命名空间\名字`。这是 EFMI 与 mod 之间**唯一**的耦合面，可由 `mod.ini.j2` 的实际调用反推：
| EFMI 内声明 | mod 侧引用 | 语义 |
|---|---|---|
| `[ResourceModName]` | `Resource\EFMIv1\ModName` | 资源句柄 |
| `[CommandListRegisterMod]` | `CommandList\EFMIv1\RegisterMod` | 命令列表 |
| `[CustomShaderShapeKeySetter]` | `CustomShader\EFMIv1\ShapeKeySetter` | 自定义 compute shader |
| `[PoolInput_ObjectSpatialIdentity]` | `Pool\EFMIv1\Input_ObjectSpatialIdentity` | pool 句柄 |
| `global locked $cfg_spatial_base_radius` | `$\EFMIv1\cfg_spatial_base_radius`（只读） | 变量 |
| `global $object_guid = 0` | `$\EFMIv1\object_guid = ...`（可写） | 变量 |

`global locked` 让其他命名空间只读（EFMI 用它保护 `$cfg_sk_batch_size = 127` 一类编译期常量）；`global persist` 让值自动落到`d3dx_user.ini`——mod 开关状态全靠它存盘，这也是 F10「保存设置」的实质。

### 2.3 mod ↔ EFMI 握手
mod 不自行判断版本，而是把元数据交给 EFMI，由 EFMI 回写 `$mod_id`；`-1` 表示不兼容、必须自我禁用：
```ini
; EFMI/Core/EFMI/API.ini
[CommandListRegisterMod]
$mod_id = 1
if $version < $required_version
    ResourceErrorIncompatibleVersionRef = ref ResourceErrorOldVersionEFMI
    $mod_id = -1
endif
```
```ini
; efmi-tools/templates/mod.ini.j2 渲染后的对应段
[CommandListRegisterMod]
$\EFMIv1\required_version = $required_efmi_version
Resource\EFMIv1\ModName = ref ResourceModName
run = CommandList\EFMIv1\RegisterMod
$mod_id = $\EFMIv1\mod_id
if $mod_id >= 0
    $mod_enabled = 1
endif
```
`$mod_enabled` 是所有绘制路径的总闸门，不兼容 mod 退化为空操作而非崩游戏。报错与指南走 `CommandListPrintText`，文本资源直接指向 `.md` 文件（`type = buffer` / `format = R8_UINT` / `filename = Notifications/UserGuide.md`）——**这就是 F12 用户指南的真实实现**。

## 3. 哈希狩猎（Hunting）机制
### 3.1 从 IB 到 draw call 的链路
1. **哈希算法**：`shader_hash = 3dmigoto`（FNV-1）、`texture_hash = 0`（旧算法，更便宜），并开 Region Hashes —— `track_region_hashes = 1`
   只哈希本次 draw 实际用到的区间（注释理由：*"Some games pack multiple meshes into a single vertex or index buffer and bind different regions via offsets"*），`track_implicit_index_buffers = 1` 记住上次 `IASetIndexBuffer` 的 IB 并自动重绑，使 `CheckTextureOverride = ib` 对隐式绑定的   IB 也生效。
2. **入口匹配**：mod 的入口就是「以 IB 哈希为 `hash` 的 `[TextureOverride*]`」，且被强制要求带 `match_index_count`：
```ini
; efmi-tools/templates/mod.ini.j2（Jinja 占位符保留）
[TextureOverride_EntryPoint_Component{{ component_id }}{% if is_lod %}_LOD{{ lod_level }}{% endif %}]
hash = {{ hash }}
match_index_count = {{ index_count }}
if $mod_enabled && DRAW_TYPE == 4
    $\EFMIv1\component_id = {{ component_id }}
    CommandList\EFMIv1\Callback_Component_DrawCustom = ref CommandList_Draw_Component{{ component_id }}
    run = CommandList_Component_DrawInstances
endif
```
   `DRAW_TYPE == 4` 即 `DrawCall::DrawIndexedInstanced`（`bo3b/3Dmigoto` 的 `DirectX11/DrawCallInfo.h`：`Draw=1, DrawIndexed=2, DrawInstanced=3, DrawIndexedInstanced=4`），EFMI 只在「实例化 + 索引化」绘制上工作。
3. **谁触发 TextureOverride**：`[TextureOverride*]` 的命令列表并非无条件自动运行，需 shader 侧检查点触发；`checktextureoverride = <slot>`
   的实现是 `target.FindTextureOverrides(...)` 后运行命中段的 pre/post 列表（`CommandList.cpp:958` `CheckTextureOverrideCommand::run`，解析见 `:358`）。EFMI 把它做成受控的「全局检查」：
```ini
; EFMI/Core/EFMI/main.ini L76-83
; This is very inefficient hence is limited to the most common resources
[ShaderRegexEnableTextureOverrides]
shader_model = vs_4_0 vs_4_1 vs_5_0 vs_5_1
if $enable_mods
    if DRAW_TYPE % 2 == 0
        CheckTextureOverride = ib
    endif
endif
```
   `DRAW_TYPE % 2 == 0` 命中 DrawIndexed(2) 与 DrawIndexedInstanced(4)，即**只对索引化绘制检查 IB**。
4. **逐实例分解与替换**：`CommandListComponent_DrawInstances`（`API.ini`）→ `CommandListIterateInstances`（`Helpers.ini`，用递归 +
   `INSTANCE_COUNT` 模拟循环）→ 回调 `CommandListSpatialIdentity_IdentifyObject`；纹理侧由 `CommandListOverrideTextures` 对 `ps-t0`..`ps-t22` 逐个 `CheckTextureOverride`，mod 的 `[TextureOverride_TextureN]` 用 `hash = <纹理哈希>` + `if $object_detected: this = Resource_TextureN` 替换。

### 3.2 EFMI 相对 GIMI 的优化
README 原话：它不走「old GIMI approach」那种「mindlessly calculate 50000 unneeded hashes per frame」，「not applicable to modern games without huge performance impact (of up to 50% FPS)」。对照 2023-04 版 GIMI `d3dx.ini`：
| 项 | GIMI (2023-04) | EFMI | 效果 |
|---|---|---|---|
| 全局检查范围 | `checktextureoverride = ps-t0..t3, vb0, vb1, vb2, ib`（8 槽、无条件） | 只留 `ib`，加 `$enable_mods` + `DRAW_TYPE % 2 == 0` 双重门 | 每 draw 匹配量从 O(8×TextureOverride 段数) 降到 1 且有门控 |
| IB 匹配粒度 | 仅 IB 哈希 | IB 哈希 + **强制 `match_index_count`** | EFMI `Notifications/VersionUpdateEFMI.md`：该变更「prevents overly broad hash matching to reduce CPU usage peaks by up to 100 times」 |
| 区域哈希 | 无 `track_region_hashes` / `track_implicit_index_buffers` | 两者均为 `1` | 多 mesh 打包进同一 VB/IB 时哈希才唯一 |
| 狩猎标记动作 | `marking_actions = hlsl asm clipboard regex stereo_snapshot snapshot_if_pink` | `marking_actions = clipboard` | 默认不再反编译/落盘 shader（HuntingModeGuide 亦称 dumping disabled by default） |
| 加载时机 | 无这两个键 | `skip_early_includes_load = 1` / `config_initialization_delay = 0` | Mods 的 ini 解析移出 DLL 初始化 |
| 不兼容 mod | 无约定 | `CommandListRegisterMod` + `$mod_enabled` 总闸门 | 不兼容 mod 零开销空转 |

> ⚠️ 未核实：`hunting = 2`（soft disabled）在 GIMI 与 EFMI 中**相同**，故不是 EFMI 的优化点；上表「GIMI 列为空」的项目，依据是 2023-04 版
> `d3dx.ini` 中 grep 不到该键，**不能推断更晚版本的 GIMI/XXMI DLL 也没有**。
> ⚠️ 未核实：README 的「up to 50% FPS」是作者自述，未给出游戏版本/硬件/复现方法，本文不背书该数字。

## 4. SpatialIdentification.ini：用几何特征认人
EFMI 不依赖「哪个 draw call 是角色」这种脆弱判断，而是用**实例的空间位置**给每个 draw 实例发稳定 Spatial ID。实例配置是每实例 16 个 CB 常量，EFMI 取第 12/13/14 号作为世界坐标，交给 DLL 内置算子 `SpatialHash` 量化成格子下标：
```ini
; EFMI/Core/EFMI/SpatialIdentification.ini L152-159
[CommandListSpatialIdentity_IdentifyObject]
; ->SpatialHash expects offsets in `value` units. Instance config consists of 16 CB "constant" units of 4 `value` units each.
local $instance_offset = $draw_call_instance_id * 64
$spatial_hash = ResourceOriginal_VS_CB->SpatialHash($instance_offset + 12, $instance_offset + 13, $instance_offset + 14, $cfg_spatial_cell_size)
$object_status_bitmask = $PoolInput_ObjectSpatialIdentity[$spatial_hash]
```
格子边长 `$cfg_spatial_cell_size = 0.125`；记录存在空间 pool 中（`pool_index_type = spatial` + `pool_spatial_radius` / `pool_expiration_*`，参数由 mod 的 `[Pool_ObjectSpatialIdentity]` 提供，`pool_size = $max_instance_count * $\EFMIv1\cfg_spatial_instance_load_ratio` 且 `$cfg_spatial_instance_load_ratio = 4`），同一格子的实例共享一条记录。整条识别过程被**压进一个 float 位掩码** `$object_status_bitmask`：高 8 位不可用（浮点精度）、中 8 位是首次遇到该对象的帧号快照（`FRAME_NUMBER & 0xFF`）、低 16 位是「各 component 是否已出现」的位图（component id 按 16 回绕）。判定规则（同文件 L191-250 注释与实现）：出现过的 component 数 `countbits($object_status_bitmask & 0xFFFF) >= $identification_min_components`（默认 `4`，由 mod 的 `spatial_identification_threshold` 传入）**且**至少过了 1 帧 → 「自定义对象」；`$identification_timeout_frames = 255` 帧仍不满足 → 「非目标」。首次出现的空间身份被**刻意延迟 1 帧绘制**，注释写明这是给「per-component skeleton 1 帧余量完成识别 / merged skeleton 用这 1 帧抓齐全部 component 骨骼」；同一 draw call 若有多个 mod 声明，只有 `$identifier_call_number == 0` 的 mod 负责画未识别实例，其余 mod 对该实例 `skip`，避免重复绘制。

**移植 Android 的可行性**：机制**与图形 API 无关**，只依赖 (a) 读到每个实例的世界坐标常量、(b) 「空间量化 → 稳定槽位」的池子、(c) 按帧推进的状态位掩码，三者都能在 Vulkan 层或 IL2CPP hook 之后以 CPU/GPU 等价实现，是 EFMI 里**最值得照搬**的部分。难点在 (a)：Android 侧没有 `vs-cbN->Region(...)` 这种「常量缓冲区间视图」，需自行实现按实例偏移的窗口读写（EFMI 用 `CommandListComponent_SetInstanceConfig_VS/PS`）。

## 5. ShapeKeys.ini / ShapeKey*.hlsl：表情与形态键
Endfield 本身**不向 GPU 暴露形态键**（`guides/modder_guide.md`：*"Endfield itself does not expose shape keys to its GPU pipeline and everything is weighted"*），故 EFMI 自己在 GPU 上算形变：
| shader | 文件 | 职责 |
|---|---|---|
| Setter | `Shaders/SkapeKeySetter.hlsl`（EFMI 内文件名确为 `SkapeKey`，拼写如此） | 把某个 shape key 的值写进 GPU 值缓冲 |
| Loader | `Shaders/ShapeKeyLoader.hlsl` | 按 batch 累加「加权顶点位移」为 INT32 |
| Dequantizer | `Shaders/ShapeKeyDequantizer.hlsl` | INT32 反量化回 float，与原始顶点位置相加 |
| PositionCopier | `Shaders/ShapeKeyedPositionCopier.hlsl` | 在不同 stride 的顶点位置缓冲间搬运 float3 |

核心是**量化 + 原子累加**（`ShapeKeyLoader.hlsl` 头注释即 *"Accumulates per-vertex weighted deltas of all shape keys of current batch in INT32 storage"*）：
```hlsl
; EFMI/Core/EFMI/Shaders/ShapeKeyLoader.hlsl（尾部摘录）
float weighted_delta = delta * shapekey_value;
float quantization_scale = asfloat(ShapeKeyBatchConfigs[0][axis]);
InterlockedAdd(VertexPositionOffsetsRW[mesh_vertex_index * 3 + axis], (int)round(weighted_delta * quantization_scale));
```
键按 **batch = 127** 分组（`global locked $cfg_sk_batch_size = 127`、`$cfg_sk_max_batch_count = 100`），batch 内用 128 槽 groupshared 数组二分定位「本 thread 属于哪个 shape key」，值为 0 的键直接 `return`。官方说明：*"processing a full batch costs almost the same as processing a batch containing only a single active shape key"*，且同一 component 一帧内多次 `CommandListSetShapeKey` 只调度一次几何更新——**批量 + 惰性**是省算力的两个手段。EFMI 还用 `$PoolInput_ShapeKeys_LodLevel_LastUpdateId` 做跨 LOD 复用：同一 component 的多个 LOD 只算一次，其余用 `ShapeKeyedPositionCopier` 拷贝。

## 6. MergedSkeleton.ini / MergedSkeleton_*.hlsl：骨骼合并
Endfield 每个 component 只暴露自己那部分骨骼（vertex group 分裂），mod 作者无法自由新增骨架。EFMI 把各 component 的骨骼矩阵**拷进一张全局 merged skeleton buffer**，再改写 component 的 instance config 使骨骼偏移指向新位置。第一步是探测游戏实际用哪种投递方式：
```ini
; EFMI/Core/EFMI/MergedSkeleton.ini L135-148（注释为原文）
[CommandListMergedSkeleton_DetectBoneDataSource]
if vs->srv_stride(0) == 16 && $instance_config_vs_cb_slot != -1
    ; The most common skeleton delivery path. Bone data offsets are supplied via vs-cb1/2/3, bone data entries via vs-t0.
    $bones_data_source = $enum_bones_source_vs_t0
elif vs->cb_size(4) == 4096
    $bones_data_source = $enum_bones_source_cb4        ; Sometimes used for FX shaders
elif vs->cb_size(3) == 4096
    $bones_data_source = $enum_bones_source_cb3        ; Sometimes used for FX shaders
else
    $bones_data_source = 0   ; Mesh uses unknown posing method. We should avoid messing with it.
endif
```
| | ConstantBuffer 版（`cb3`/`cb4`） | RollingBuffer 版（`vs_t0`，主流） |
|---|---|---|
| 骨骼来源 | `cbuffer cb0 : register(b0) { float4 InstanceConfigWithBonesCB[1024]; }` | `StructuredBuffer<float4> ComponentBoneMatrices : register(t0)` |
| 写回方式 | `vs-cb3 = copy ResourceConfigWithBones` / `vs-cb4 = copy ...`，每次要拷 `$bones_count * 3 * 16 + 64` 字节 CB 窗口 | `vs-cb2/1/3 = copy Resource_Component_Instance_ConfigRW`（只回写 16 个 uint4）+ `vs-t0 = ref ResourceOutput_MergedSkeleton` |
| 取舍 | 为「偏移与骨骼都在 CB 里」的少数派（FX shader）准备的兼容分支 | 便宜得多（只改第 5 个 entry 的两个偏移），是 Endfield 主流路径 |

RollingBuffer 的关键判定是「静态隐式变换」与「真实骨骼」的分界 `STATIC_TRANSFORMS_ENTRY_COUNT = 2 * 256 * 3`，只有真实骨骼才改写：
```hlsl
; EFMI/Core/EFMI/Shaders/MergedSkeleton_InstanceConfigOverrider_RollingBuffer.hlsl（压缩为单行分支）
if (bone_offsets_entry.x >= STATIC_TRANSFORMS_ENTRY_COUNT) bone_offsets_entry.x = MergedSkeletonOffset;
if (bone_offsets_entry.y >= STATIC_TRANSFORMS_ENTRY_COUNT) bone_offsets_entry.y = MergedSkeletonEntriesCount + MergedSkeletonOffset;
InstanceConfigRW[OutputInstanceConfigOffset + 5] = bone_offsets_entry;
```
merged buffer 开头 `$cfg_ms_implicit_bones_count = 512` 条由 `MergedSkeleton_BoneDataInitializer.hlsl` 写入单位矩阵模式（`1 0 0 0 / 0 1 0 0 / 0 0 1 0`，每条骨骼占 `$cfg_ms_bone_entry_size = 3` 个 float4），每实例区间起点为 `($cfg_ms_implicit_bones_count + $cfg_ms_skeletons_count * $bones_count * $instance_id) * 3`。为容纳 >256 根骨，mod 还会拉宽权重格式：`vb2->ElementFormat(BLENDINDICES, 0) = R16G16B16A16_UINT`。已知缺陷见工具 README 与 modder guide：某些角色/某些 LOD 会 glitch（*"EFMI needs better LODs handling architecture"*）。

## 7. 一个 EFMI mod 解压后长什么样
目录与文件名由 `efmi-tools/blender_export/blender_export.py` 决定。**注意不是 `Buffer/` 与 `Texture/`，而是 `Meshes/` 与 `Textures/`**；`ShaderFixes/` 是 3DMigoto 的 shader 覆盖目录（`override_directory = ShaderFixes`），属 EFMI 本体而非单个 mod：
```
Mods/<ModName>/
├─ mod.ini        # 唯一入口，由 templates/mod.ini.j2 渲染
├─ Meshes/        # Component0_VB0.buf / _VB1.buf(UV+顶点色) / _VB2.buf(权重) / _IB.buf(索引)
│                 # + 各 LOD 变体 _LOD1.buf、_VB2_LOD1_BlendRemap.buf、Component0_ShapeKey*.buf
│                 # + Components.buf —— 不是二进制！是所有 buffer layout 的 JSON dump（open(..., 'w')）
└─ Textures/*.dds + Logo.dds     # [Resource_TextureN] filename = Textures/...
```
资源声明与替换的核心就两段（`mod.ini.j2` 尾部，Jinja 占位符保留）：
```ini
[Resource_{{ buffer_name }}]              ; 缓冲
type = Buffer
stride = {{ buffer.layout.stride }}
filename = Meshes/{{ buffer_name }}.buf
[TextureOverride_Texture{{ loop.index0 }}]
hash = {{ texture.hash }}
if $object_detected
    this = Resource_Texture{{ loop.index0 }}
endif
```
**`vb0` / `ib` 这类「全局触发器」是什么**：它们是 3DMigoto 的**资源槽名**，不是 EFMI 私有变量。mod 在附着于某个 draw call 的命令列表里直接对槽赋值（`ib = ref Resource_Component0_IB`、`vb0 = ref ...`、`vb3 = ref ...`），把自定义缓冲塞进该槽；EFMI 的 `[ShaderRegexEnableTextureOverrides]` + `CheckTextureOverride = ib` 负责让这些以 IB 为触发键的 `[TextureOverride*]` 段在正确的 shader/draw 上下文里被求值。README 说 F11 切换的是「ones depending on EFMI's `vb0` or `ib` global triggers」，指的就是这类入口。
> ⚠️ 未核实：以上「global trigger」解读基于 ini 语义反推，README 未对该词给出定义。

## 8. 热键语义与 Android 交互映射
EFMI 的用户级按键在 `EFMI/Core/EFMI/KeyBindings.ini`，开发者级在 `d3dx.ini [Hunting]`（键名均为 3DMigoto 原生 `VK_*`）：
| 键 | 语义 | Android 映射建议 |
|---|---|---|
| `VK_F10` | `reload_fixes` + `reload_config`：重载全部 ini/HLSL 并保存 persist 设置 | 悬浮窗「重载」按钮；无 root 只能重启进程（真热重载需自研 ini 解析器） |
| `VK_F11` | `KeyToggleMods` → `CommandListToggleMods`，切换 `$enable_mods` | 通知栏常驻开关 + 悬浮窗总闸门 |
| `VK_F12` | `KeyToggleUserGuide`（`type = cycle`，`$show_user_guide = 0,1`） | 悬浮窗「帮助」页，直接渲染同一份 `.md` 资源 |
| `Ctrl+Alt+F10` | `wipe_user_config`：删 `d3dx_user.ini` 并重载 | 悬浮窗「重置」按钮长按 2 秒 |
| `Numpad 0` | `toggle_hunting` 狩猎开关（游戏内绿色文字提示） | 开发者模式：音量上+下同时长按 3 秒 |
| `Numpad 7/8/9` | IB 上一个 / 下一个 / 复制哈希 | 狩猎面板左右滑动切换 + 「复制哈希」 |
| `Numpad / * -`；`Enter`+`/ *` | VB 循环；切 VB slot（-1..31） | 狩猎面板的 slot 下拉选择器 |
| `Numpad 1/2/3`、`4/5/6`、`+` | PS / VS 循环与标记；`done_hunting` 重置列表 | 狩猎面板 Tab（PS/VS/IB/VB）+「清除」 |
| `Shift+F11` | `analyse_frame` 生成 Frame Dump | 悬浮窗按钮；输出到 `/sdcard/Android/data/<pkg>/files/FrameAnalysis-*` |
| `Ctrl+F10/F11/F12` | 性能监视器 / 按住禁用自定义 shader / 狩猎指南 | 性能 HUD / 按住做 A/B 对比 / 指南页 |

Android 侧没有 `VK_*` 体系也没有 3DMigoto 那样的全局键盘钩子；音量键会被系统与游戏消费，悬浮窗需 `SYSTEM_ALERT_WINDOW` 授权，注入按键/触摸需要 root、Shizuku 或无障碍服务。
> ⚠️ 未核实：`Ctrl+Shift+F10`（`freeze_performance_monitor`）只存在于 `d3dx.ini`，EFMI 用户文档未列出该键。

## 9. 可移植性评估
| EFMI 组件 | Android 判定 | 原因 |
|---|---|---|
| DXGI / D3D11 代理 DLL 注入 | **不可用** | Android 无 DXGI/D3D11，Windows 的 `LoadLibrary` 搜索顺序机制不存在，3DMigoto 的注入前提整体消失 |
| `d3dx.ini` ini 解释器（命令列表/pool/表达式/递归） | **需重写** | 语义为 3DMigoto 私有（`checktextureoverride`、`SpatialHash`、`->Region(...)`、`countbits`、递归命令列表），必须自研等价 VM |
| `[TextureOverride*]` / `[ShaderOverride*]` 哈希匹配 | **需重写** | 换成 Vulkan 管线/描述符绑定层的哈希匹配，或 IL2CPP hook 后的 DrawCall 拦截 |
| Region Hashes（`track_region_hashes` 等） | **需重写** | 思路通用（按 draw 实际区间哈希、维护隐式 IB），但要在 Vulkan 参数层重建 |
| `IniParams` @ `t120` | **需重写** | D3D11 专属的「常量通道劫持」；Vulkan 等价物是 push constant / UBO / SSBO，需自定槽位约定 |
| `Resource` + `->Region(...)` 区间视图 | **需重写** | D3D11 的 subresource/区间语义；Vulkan 需用 `VkBuffer` + offset/size 自行封装 |
| HLSL 运行时编译替换游戏 shader | **需重写** | Vulkan 侧要交给 SPIR-V；需 HLSL→DXBC→SPIR-V 或直接写 GLSL/SPIR-V，并在管线创建处替换 |
| Hunting 覆盖层 / FrameAnalysis dump | **需重写** | 覆盖层可用 swapchain 后处理或 SurfaceControl；dump 需自建资源快照 |
| `SpatialIdentification.ini` 状态机 | **可直接移植（逻辑层）** | 与图形 API 无关，纯算术 + 状态机；只需替换「读实例世界坐标」与「pool 存储」两个后端 |
| `ShapeKeys.ini` + 4 个 CS | **可直接移植（shader 层）** | 通用 compute（`InterlockedAdd` + 量化），改写为 GLSL/SPIR-V compute 即可，需自建绑定约定 |
| `MergedSkeleton` 双实现 | **可直接移植（shader 层）** | 同上；难点是「改写 instance config 骨骼偏移」需要等价的常量缓冲窗口写回能力 |
| `TextPrinter` / 指南与通知渲染 | **需重写** | 依赖 `StructuredBuffer` 参数表与形状渲染；Android 侧用原生 UI / ImGui 更划算 |
| `d3dx_user.ini` persist 变量 | **可直接移植（概念）** | 本质是「把命名变量序列化到文件」，实现方式自定 |
| Mods 目录递归 include + `DISABLED*` | **可直接移植（概念）** | 纯文件系统约定，与图形无关 |
| 热键体系（F10/F11/F12/Numpad） | **不可用** | Android 无对应按键与全局键盘钩子，必须换成悬浮窗/通知/手势（见 §8） |

Android 侧只有两条正路：**(a) Vulkan 隐式层**——Khronos 加载器文档明确 *"On Android, the loader looks for layers to enumerate in the `/data/local/debug/vulkan` folder. An application enabled for debug has the ability to enumerate and enable any layers in that location"*，而系统级层目录需写 system/vendor 分区（root/Magisk 模块），故无 root 设备上不可行；**(b) IL2CPP hook**——Endfield 是 Unity IL2CPP 游戏（社区已有专为它写的 IL2CPP dumper），从 `libil2cpp.so` 侧挂钩 `Graphics.DrawMesh` / `CommandBuffer` 一类入口，可绕开图形 API 差异直接替换网格与材质，代价是必须跟随游戏版本更新。
> ⚠️ 未核实：Endfield **移动版**的具体图形后端（Vulkan 还是 GLES）与是否使用自定义渲染管线，本文未取得一手证据；“Unity IL2CPP”的证据来自面向
> Windows x64 的社区工具自述（*"Originally written for Arknights: Endfield"*）与媒体对其 Unity 改版的报道。
> ⚠️ 未核实：Android Vulkan 隐式层的系统搜索路径清单未从 AOSP 源码逐条确认，仅确认了 `/data/local/debug/vulkan` 与「系统目录需 root」两点。

## 参考
- https://github.com/SpectrumQT/EFMI-Package — `EFMI/d3dx.ini`、`EFMI/Core/EFMI/{main,API,SpatialIdentification,ShapeKeys,MergedSkeleton,KeyBindings,Helpers,TextPrinter}.ini`、`EFMI/Core/EFMI/Shaders/*.hlsl`、`Notifications/{UserGuide,HuntingModeGuide,VersionUpdateEFMI}.md`
- https://github.com/SpectrumQT/EFMI-Tools — `efmi-tools/templates/mod.ini.j2`、`guides/modder_guide.md`、`guides/shape_keys_guide.md`、`efmi-tools/blender_export/{blender_export,ini_maker,texture_collector}.py`
- https://github.com/SpectrumQT/XXMI-Launcher
- https://github.com/SilentNightSound/GI-Model-Importer — `3dmigoto GIMI (for playing mods).zip` 内的 `d3dx.ini`
- https://github.com/bo3b/3Dmigoto — `DirectX11/DrawCallInfo.h`、`DirectX11/CommandList.cpp`、`DirectX11/CommandList.h`
- https://github.com/KhronosGroup/Vulkan-Loader/blob/main/docs/LoaderLayerInterface.md
- https://github.com/DeftSolutions-dev/IL2CPP-Dumper
- https://github.com/MiraTokTok/AnimeCorsilMihoyoHonkai3rd-Model-Importer-PVT-Assets（`Guides to Learn about 3DMIGOTO/CheckTextureOverride.md`）
