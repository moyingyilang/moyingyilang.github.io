---
title: "05 · 路线：IL2CPP 运行时 Hook（Unity 运行时层替换 Mesh）"
description: "EFML4A 研究文档 · 05-route-il2cpp-hook（Arknights: Endfield Mod Loader for Android）"
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


目标：**不改动游戏资源包**，用 native hook 干预 Unity 托管对象，实现 EFMI 式换模型。**结论速览**：hook `SkinnedMeshRenderer::set_sharedMesh` + 构造一份新 `Mesh` 是最短路径；骨骼合并 / shape key 混合仍需 GPU 层配合（§5）。交叉引用：[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)、[03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)、[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[07-route-matrix.md](/blog/efml4a-07-route-matrix/)、[08-threat-model.md](/blog/efml4a-08-threat-model/)。
## 1. IL2CPP 运行时结构

| 文件 | Android 位置 | 作用 |
|---|---|---|
| `libil2cpp.so` | `lib/<abi>/libil2cpp.so` | IL2CPP AOT 产物：虚拟机 + 所有托管方法的 native 代码 + 元数据注册表 |
| `global-metadata.dat` | `assets/bin/Data/Managed/Metadata/global-metadata.dat` | 类型/方法/字段/字符串定义（**不含 IL 代码**） |
| `*.assets` / `data.unity3d` | `assets/bin/Data/` | 序列化资源（Mesh / Texture 实际数据） |

`libil2cpp.so` 内同时存在三样东西：(1) **导出的 il2cpp C API**（`il2cpp_init`、`il2cpp_domain_get` …，签名见 §3）；(2) **每个托管方法编译出的独立函数**，命名如 `ClassName_MethodName_m<token>`，Release 包基本被 `strip`；(3) **注册表结构体** `Il2CppCodeRegistration`（方法索引 → 函数指针、invoker 指针、自定义属性生成器）与 `Il2CppMetadataRegistration`（types、methodSpecs、fieldOffsets、genericMethodTable、metadataUsagePairs）。
> ⚠️ 未核实：上述两个结构体的字段顺序与数量随 Unity 版本变化（Il2CppDumper 为不同版本写了不同分支），按固定偏移读注册表必须逐版本校准。

`il2cpp_init(const char* domain_name)` 由引擎启动时调用，是**最早可用的稳定时间点**：可在此拿到 domain、安装 hook、或重定向 metadata 目录（`il2cpp_set_data_dir` / `il2cpp_set_config_dir`）。
### 1.1 关键结构体

| 结构体 | 布局要点 | 稳定性 |
|---|---|---|
| `Il2CppObject` | `{ Il2CppClass* klass; void* monitor; }` | **跨版本稳定** |
| `Il2CppClass` | 以 `Il2CppObject` 头开始，后接 `image` / `gc_desc` / `name` / `namespaze` / `byval_arg` / `this_arg` / `element_class` / `castClass` / `declaringType` / `parent` / `generic_class` / `klass` / `fields` / `events` / `properties` / `methods` / `nestedTypes` / `implementedInterfaces` / `interfaceOffsets` / `static_fields` / `rgctx_data` / `typeHierarchy` / `unity_user_data` / `bitflags` / `instance_size` … | **顺序随版本变化**；新版以 `typeMetadataHandle` 取代旧版内联 `Il2CppType` |
| `MethodInfo` | `{ Il2CppMethodPointer methodPointer; InvokerMethod invoker_method; const char* name; Il2CppClass* klass; const Il2CppType* return_type; const Il2CppType** parameters; … }` | 字段顺序在 2019 / 2020 / 2021 之间调整过 |
| `Il2CppArray` | `{ Il2CppObject obj; Il2CppArrayBounds* bounds; il2cpp_array_size_t max_length; /* 元素数据内联紧跟其后 */ }` | 基本稳定；一维数组 `bounds` 通常为 null |

> ⚠️ 未核实：上表字段来自公开 IL2CPP 头文件族，**未对 Endfield 当前版本实测**。
**工程结论**：不要按偏移手写结构体，优先使用 §3 的访问器（`il2cpp_class_get_name` / `il2cpp_method_get_name` / `il2cpp_field_get_offset` / `il2cpp_method_get_param*`）。
### 1.2 符号被剥离后如何定位

Release 包的 `libil2cpp.so` 只保留 `.dynsym`：`il2cpp_*` API 通常仍导出（`libunity.so` 需要链接它），但每个托管方法对应的函数名在 `.symtab` 中已被 `strip`。三条路径：

1. **走 metadata**：Il2CppDumper / Zygisk-Il2CppDumper 产出 `dump.cs`（含方法 RVA）→ 运行时地址 = 模块 load bias + RVA。最可靠。
2. **走 API 表**：`il2cpp-api.cpp` 内有一张静态 API 函数指针表，工具常通过扫描「连续指向本 so 代码段的指针数组」定位。> ⚠️ 未核实：该静态表符号名（常被引用为 `s_Il2CppApiFunctions`）与所在节区随版本/混淆变化。
3. **pattern scan**：对代码段做特征字节匹配（ARM64 函数序言 + 特定常量 + 字符串引用）。版本敏感，但不需要 dump。
## 2. Hook 手段对比

| 手段 | 原理 | 稳定性 | 需 root？ | 对 ART/JIT 影响 | 对本路线适用性 |
|---|---|---|---|---|---|
| inline hook / **Dobby** | 覆写目标函数头部为跳板（ARM64 常为 `LDR x16,#8; BR x16; .quad tgt`），原指令搬到 trampoline | 中高；短函数、PC 相对常量、CFI 有坑 | 不必须（模块被注入进游戏进程即可） | 无（纯 native，绕过 ART） | **推荐**；BNM-Android 官方示例即用 Dobby |
| inline hook / **ShadowHook**（字节跳动） | 同上，提供 shared / multi / unique 三种模式；另有 `intercept` 指令级断点 | **高**（生产级；Android 4.1–17，armeabi-v7a / arm64-v8a） | 不必须 | 无 | **首选**。API：`shadowhook_hook_sym_name` / `shadowhook_hook_sym_addr` / `shadowhook_unhook` |
| inline hook / **And64InlineHook** | 极简 ARM64 inline hook | 中；**不支持 unhook** | 不必须 | 无 | 仅原型 |
| PLT/GOT hook / **xHook、ByteHook** | 改写调用方 ELF 的 `.rela.plt` / `.rela.dyn` | 高，开销极低 | 不必须 | 无 | **对 libil2cpp.so 内部方法无效**（同 so 内直接 `BL` 不过 PLT）；只适合拦 libc / `AAssetManager` → 服务 [06](/blog/efml4a-06-route-assetbundle/) |
| **frida-il2cpp-bridge** | Frida 之上的 TS 桥：解析 il2cpp API + metadata，提供类/方法/字段遍历与 `Method.implementation = ...` | 高（开发期）；性能与可见性差 | 通常需要 frida-server（root）或 frida-gadget（需重打包 / 注入） | **有**：Frida 需 hook ART 解释器 / JIT 入口以支持 Java hook | **调试首选，不适合发行**；验证思路极快 |
| **LSPosed / Xposed（Java 层）** | ART 方法级 hook | 对 Java API 高 | 需要（LSPosed 依赖 Magisk） | **有**：ART 方法 hook 会触发去优化 | **到不了 `Mesh` / `SkinnedMeshRenderer` 的原生实现**。Java 侧只能拿 `Context` / `Activity`、hook `android.content.res.AssetManager`、`System.loadLibrary`、做 UI 与存储 |

**推荐组合**：Zygisk 模块（进程注入）→ `libefml.so`（C++）→ ShadowHook 装 inline hook → il2cpp resolver 解析类/方法。Java 层只做配置读取与悬浮 UI。注入面细节见 [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)。
## 3. il2cpp API 调用链

签名取自公开的 `il2cpp-api-functions.h`（Unity 5.x 时代头文件；函数名在后续版本保持稳定）：

```c
// domain / 线程
Il2CppDomain*          il2cpp_domain_get(void);
const Il2CppAssembly** il2cpp_domain_get_assemblies(const Il2CppDomain*, size_t*);
Il2CppThread*          il2cpp_thread_attach(Il2CppDomain*);   // 非 VM 线程调托管代码前必须调
// image / class / field
const Il2CppImage*     il2cpp_assembly_get_image(const Il2CppAssembly*);
Il2CppClass*           il2cpp_class_from_name(const Il2CppImage*, const char* namespaze, const char* name);
FieldInfo*             il2cpp_class_get_field_from_name(Il2CppClass*, const char*);
size_t                 il2cpp_field_get_offset(FieldInfo*);
// method
const MethodInfo*      il2cpp_class_get_method_from_name(Il2CppClass*, const char*, int argsCount);
const MethodInfo*      il2cpp_class_get_methods(Il2CppClass*, void** iter);
uint32_t               il2cpp_method_get_param_count(const MethodInfo*);
const Il2CppType*      il2cpp_method_get_param(const MethodInfo*, uint32_t index);
Il2CppMethodPointer    il2cpp_resolve_icall(const char*);
// object / array / invoke / 重定向
Il2CppObject*          il2cpp_object_new(const Il2CppClass*);
Il2CppArray*           il2cpp_array_new(Il2CppClass*, il2cpp_array_size_t);
Il2CppObject*          il2cpp_runtime_invoke(const MethodInfo*, void*, void**, Il2CppException**);
void                   il2cpp_set_data_dir(const char*);
```

标准定位流程：

```c
Il2CppDomain* domain = api.domain_get();
size_t n = 0; const Il2CppAssembly** asms = api.domain_get_assemblies(domain, &n);
const Il2CppImage* core = NULL;
for (size_t i = 0; i < n; ++i) {
    const Il2CppImage* img = api.assembly_get_image(asms[i]);
    if (strcmp(api.image_get_name(img), "UnityEngine.CoreModule") == 0) { core = img; break; }
}   // Unity 2018.2 之前没有 CoreModule 拆分，assembly 名为 "UnityEngine"
Il2CppClass* meshKlass = api.class_from_name(core, "UnityEngine", "Mesh");
const MethodInfo* mi  = api.class_get_method_from_name(meshKlass, "set_vertices", 1);
void* fn = mi->methodPointer;   // 属性 setter 在 IL2CPP 中的名字就是 set_Xxx
```

| 目标类 | 命名空间 | Assembly（Unity 2018.2+） | 旧版本 |
|---|---|---|---|
| `Mesh` / `SkinnedMeshRenderer` / `Renderer` / `Material` / `Shader` / `Texture2D` | `UnityEngine` | `UnityEngine.CoreModule` | `UnityEngine` |
| `AssetBundle` | `UnityEngine` | `UnityEngine.AssetBundleModule` | `UnityEngine` |

> ⚠️ 未核实：Endfield 的 Unity 版本、assembly 拆分粒度、IL2CPP 裁剪（assembly stripping）后哪些成员仍存在——**必须先 dump 确认**。
> ⚠️ 未核实：现代 Unity 对多数 CoreModule 方法使用 direct native binding 而非 icall，`il2cpp_resolve_icall("UnityEngine.Mesh::SetVertices")` **不一定成功**；应优先使用 metadata 方法指针。
## 4. 目标 API 与替换策略
### 4.1 需要覆盖的函数

| 方法（C#） | il2cpp 用名 | 作用 | 风险 |
|---|---|---|---|
| `SkinnedMeshRenderer.sharedMesh` setter | `set_sharedMesh` | **首选入口**：整体替换 Mesh 引用 | renderer 的 `bones` 与 mesh 的 bindpose 必须匹配，否则模型塌成点 |
| `Mesh.vertices` setter / `Mesh.SetVertices(...)` | `set_vertices` / `SetVertices` | 写顶点 | 改长度即改 vertexCount，须同步 indices / boneWeights / bounds；重载需按类型消歧（§4.4） |
| `Mesh.SetVerticesNative` | — | 用户提到的内部实现名 | > ⚠️ 未核实：在公开 Unity C# 参考源码与检索中**未见此名**；内部 native thunk 的生成名随版本变化，须以实际 dump 为准，不要硬编码 |
| `Mesh.boneWeights` setter / `Mesh.SetBoneWeights(...)` | `set_boneWeights` / `SetBoneWeights` | 骨骼权重（`BoneWeight[]`，或 `NativeArray<byte>` + `NativeArray<BoneWeight1>`） | 元素数须等于顶点数；两种 API 互斥 |
| `Mesh.bindposes` setter / `Mesh.SetBindposes(...)` | `set_bindposes` / `SetBindposes` | 绑定姿态 | 元素数 = 骨骼数，与 renderer 的 `bones` 一一对应 |
| `Mesh.SetIndices(...)` | `SetIndices` | 重设三角形与 submesh 划分 | `subMeshCount` 须先设置；`indexFormat` 需匹配（UInt16 上限 65535 顶点） |
| `Mesh.RecalculateBounds()` | `RecalculateBounds` | 重算包围盒 | 不调 → 视锥剔除导致模型消失 / 闪烁 |
| `Mesh.blendShapeWeights` setter / `SetBlendShapeWeight(int,float)` | `set_blendShapeWeights` / `SetBlendShapeWeight` | blendShape 权重 | 每帧可能被动画覆盖 |
| `Renderer.materials` / `sharedMaterials` setter | `set_materials` / `set_sharedMaterials` | 换材质数组 | 长度必须 = `subMeshCount`，否则 material count mismatch |
| `Shader.Find(string)` | `Find`（静态，argsCount=1） | 拦截可强制返回自定义 / 内置 shader | 返回 null 时游戏可能崩，需准备 fallback |
| `Mesh.MarkDynamic()` / `Renderer.localBounds` setter | `MarkDynamic` / `set_localBounds` | 高频改写前置；蒙皮包围盒 | 仅在不改顶点数时安全；与 `updateWhenOffscreen` 联动 |
### 4.2 替换时机

EFMI 在**渲染层**（draw call 时）替换 buffer，无需关心 Mesh 何时被创建；IL2CPP 路线必须在**对象生命周期**上找时机：

1. **最小侵入**：只 hook `set_sharedMesh`。游戏把模型赋给 renderer 时判断是不是目标 → 是则换成 mod mesh。等价于 EFMI 的「整体替换模型」。
2. **改已有 mesh**：目标确定之后（例如 `set_sharedMesh` 返回后）对 mesh 调用 `SetVertices` 等。
3. **材质 / Shader**：hook `set_sharedMaterials` 或 `Shader.Find`，与 (1) 独立。

判定「是不是目标」的手段（按可靠性排序）：`Object.name`、`Transform` 层级路径、`GameObject` 组件组合、`sharedMesh.name`。这比 PC 上的 draw call hash 更语义化，但更容易被改名 / 本地化影响。
### 4.3 构造一份新 Mesh 数据

```c
int32_t vcount = invoke_get_int(origMesh, "get_vertexCount");   // 另需 get_subMeshCount / get_indexFormat（0=UInt16, 1=UInt32）
Il2CppClass* vec3 = api.class_from_name(core, "UnityEngine", "Vector3");
Il2CppArray* vertices  = api.array_new(vec3, vcount);
Il2CppArray* normals   = api.array_new(vec3, vcount);
Il2CppArray* tangents  = api.array_new(api.class_from_name(core, "UnityEngine", "Vector4"), vcount);
Il2CppArray* uv0       = api.array_new(api.class_from_name(core, "UnityEngine", "Vector2"), vcount);
Il2CppArray* colors    = api.array_new(api.class_from_name(core, "UnityEngine", "Color32"), vcount);
Il2CppArray* weights   = api.array_new(api.class_from_name(core, "UnityEngine", "BoneWeight"), vcount);
Il2CppArray* bindposes = api.array_new(api.class_from_name(core, "UnityEngine", "Matrix4x4"), boneCount);
Il2CppArray* triangles = api.array_new(api.class_from_name(core, "System", "Int32"), idxCount);
// 值类型元素内联在 Il2CppArray 头之后（§1.1）。⚠️ 未核实：直接按布局写内存属实现细节，建议封装 array_write<T>() 并加断言。
memcpy(array_data(vertices), modVerts, sizeof(Vector3) * vcount);
invoke_void(targetMesh, "SetVertices",   vertices);    invoke_void(targetMesh, "SetNormals",   normals);
invoke_void(targetMesh, "SetTangents",   tangents);    invoke_void(targetMesh, "SetUVs",       uv0);
invoke_void(targetMesh, "SetColors",     colors);      invoke_void(targetMesh, "SetBoneWeights", weights);
invoke_void(targetMesh, "SetBindposes",  bindposes);   invoke_void(targetMesh, "SetTriangles", triangles, 0);
invoke_void(targetMesh, "RecalculateBounds");
```

一份完整 Mesh 需要：**顶点、法线、切线、UV（至少 uv0）、顶点色、骨骼权重、bindpose、submesh 索引、blendShape（形状 + 权重）**。

| 实现路径 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| 改已有 Mesh | 对游戏自己的 mesh 调 `SetVertices` 等 | 不需创建对象，不处理 native 资源生命周期 | 可能被多个 renderer 共享（`sharedMesh`）→ 必须先用 `Object.Instantiate` 做 CoW |
| 新建 Mesh | `new Mesh()`（托管构造）→ 填数据 → `set_sharedMesh` | 隔离干净，热重载只需换引用 | `Mesh` 在 native 侧有资源（`Mesh::Internal_Create`），不能裸用 `il2cpp_object_new`；> ⚠️ 未核实：IL2CPP 下 `new Mesh()` 的 ctor 是否完整完成 native 侧创建 |
### 4.4 尺寸不一致时怎么办

| 情况 | 策略 |
|---|---|
| 顶点数不同、子网格结构相同 | 允许改顶点数，同步重设 `triangles` + `boneWeights` + `bindposes` + `localBounds`，再 `RecalculateBounds`；须保证 shader 期望的顶点属性集合不变 |
| 顶点数不同但要保留原拓扑 | **强制对齐**：把 mod 顶点重采样 / 补零到原 `vertexCount`，只改数值不改拓扑（最稳；EFMI 早期 mod 的做法） |
| 骨骼数不同 | **骨骼合并**：把 mod skeleton 的 bindpose 重映射到游戏 skeleton 的骨骼顺序，并重写 `boneWeights` 的 index。EFMI 用 `MergedSkeleton.ini` + `MergedSkeleton_BoneDataImporter_*.hlsl` 在 GPU 侧做；IL2CPP 侧只能在 CPU 做等价重映射 |
| 顶点属性布局不同（mod 有 uv1，游戏 shader 只要 uv0） | 丢弃多余属性；或同时换 shader（hook `Shader.Find` / `set_materials`）。引入新属性必须换 shader |
| 索引超过 65535 顶点 | `indexFormat` 设为 `UInt32`；需确认游戏 shader 与设备支持 |

**重载消歧**：`il2cpp_class_get_method_from_name(klass, name, argsCount)` **只按参数个数匹配**。遇到 `SetVertices(Vector3[])` 与 `SetVertices(List<Vector3>)` 这类同参数个数的重载，必须遍历 `il2cpp_class_get_methods` + `il2cpp_method_get_param` / `il2cpp_type_get_name` 逐一比对类型。
## 5. 与 Vulkan 层路线对比（核心分析）

| 维度 | IL2CPP Hook 路线 | Vulkan 隐式层路线（[04](/blog/efml4a-04-route-vulkan-layer/)） |
|---|---|---|
| 干预位置 | Unity 托管对象与 native 方法 | GPU 命令流（`vkCmdBindVertexBuffers` / descriptor / push constant） |
| 是否要自己管 GPU buffer | **否**，Unity 负责上传 | **是**，要拦截并替换 buffer，管内存类型 / coherent / 同步 |
| 能改游戏逻辑可见的状态 | **能**：`transform`、骨骼矩阵、材质属性、submesh 可见性、动画参数 | 不能，GPU 层看不到 `Transform` / 动画曲线 |
| 能改材质与 shader 选择 | **能**：`set_materials` / `Shader.Find` | 只能改绑定与常量，换 shader 要替换 pipeline |
| 实现直观程度 | 高（C# 语义：顶点数组、bindpose、权重） | 低（SPIR-V / 描述符 / 顶点格式解码，需为每条 pipeline 建模） |
| GPU 厂商依赖 | 无 | 强（Qualcomm / Mali / PowerVR 差异与驱动版本坑） |
| 版本适配成本 | 高（RVA 变化、类与方法可能被混淆或裁剪） | 中（draw call 特征略稳，但 pipeline 布局会变） |
| 完整性校验暴露面 | metadata 哈希 / CRC、代码段校验、注册表校验 | 层清单（`VK_LAYER_*`）、`vkCreateInstance` 调用链、驱动侧可探测 |
| 内存扫描可见性 | 高（inline hook 改代码段，有 `mprotect` 痕迹） | 中（只改数据流） |
| 覆盖游戏自造的 GPU 数据 | **不能**（动态合批、ComputeShader 蒙皮、`DrawMesh` 路径） | **能**（终点就是 GPU 侧数据） |
| 热重载 | 换引用即可，但要处理 GPU 侧残留（§7） | 只需下帧换绑定，天然热重载 |
| managed→native 边界开销 | 有（`il2cpp_runtime_invoke` 开销；大批顶点跨语言拷贝） | 无（全在 native 侧） |

**适用场景结论**：需要「按名字整体换模型 / 换材质 / 改骨骼权重 / 改 blendShape 权重 / 按逻辑隐藏 submesh」→ **IL2CPP 路线更短、更稳、更省事**；需要「顶点级注入、骨骼合并、shape key 混合、绕过 Unity 顶点格式限制」→ **必须在 GPU 层做**，这既是 EFMI 的强项，也是本路线的能力边界。因此 EFML4A 推荐**双路线协同**：IL2CPP 决定「换谁、换什么、什么时候换」，Vulkan 层决定「顶点长什么样」，两者共享同一份 mod 描述（见 [10-mod-format.md](/blog/efml4a-10-mod-format/)、[07-route-matrix.md](/blog/efml4a-07-route-matrix/)）。
## 6. 完整性与反作弊（研究性描述）

> 本节仅做技术可行性分析，用于评估路线风险与设计取舍；不针对在线竞技场景，也不提供规避手段的实现。

- **`global-metadata.dat` 校验**：头部含 magic（常见值 `0xFAB11BAF`）与 version 字段；保护做法包括整体加密、运行时在 `il2cpp_init` 之前解密到内存，或对文件算 CRC32 / SHA-256 与内置基线比对。> ⚠️ 未核实：Endfield 是否加密 metadata、magic 是否为标准值、是否做哈希校验。
- **`libil2cpp.so` 代码段校验**：读 `/proc/self/maps`（或 `dl_iterate_phdr`）拿到 `PT_LOAD` / `.text` 范围，算 CRC32 / SHA-256 与基线比对；inline hook 会直接让校验失败。
- **元数据加密 / 混淆**：自定义 `MetadataRegistration`（重排字段、加密指针）、字符串表异或、方法名混淆，以及混淆 il2cpp API 的导出名（让工具找不到 API 表）。
- **内存扫描**：检测页属性变成可写可执行（`mprotect` 痕迹）、检测函数头部的跳板字节、对比 file-backed `.text` 与磁盘副本。
- **低可见度做法（研究视角）**：优先改**数据**而非**代码**——把 `MethodInfo->methodPointer` 指向我们的实现（属篡改 `.data.rel.ro`），或只改实例字段（mesh 引用、材质属性），完全不触碰 `.text`；更保守的是「一次性 hook + 立即恢复原始字节」。**只要改动进程内存，就存在被自校验发现的可能**，威胁模型见 [08-threat-model.md](/blog/efml4a-08-threat-model/)。
## 7. 热重载语义

EFMI 的做法：装好 mod → **把 modded 角色移出屏幕（或切换到另一个角色）** → 按 **F10** 重载；另有 `F11` 切换 mods 显示、`F12` 用户指南、`Ctrl+Alt+F10` 重置设置并重载。要求移出屏幕的原因是 GPU 侧仍留着旧的顶点 / 索引缓冲与已绑定的资源，需要走一次「资源重建 + 重新提交」。

IL2CPP 侧的等价实现与难点：

- **推荐做法**：把目标 `SkinnedMeshRenderer.sharedMesh` 先指回原 mesh，**下一帧**再设为新的 mod mesh，迫使 Unity 重建 / 重绑 GPU 资源——语义上等价于「把角色移出屏幕」。
- **原地改**：`MarkDynamic()` + `SetVertices` 走 dynamic buffer 路径，代价低，但**顶点数不能变**。
- **难点**：`sharedMesh` 可能被多个 renderer 共享 → 必须 `Object.Instantiate` 做 CoW；游戏可能缓存了 `Bounds` / `localBounds` / `MeshCollider`，换 mesh 后物理与剔除不同步；只换 mesh 不换 `bones` → 骨骼不匹配；对象池 / Addressables 可能重建 renderer 引用覆盖我们的替换 → hook 层需保持幂等。
- **触发方式**：Android 上并没有 F10，需要把「重载」映射到悬浮按钮 / 音量键 / 通知，见 [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)。
## 8. Android 上定位 `libil2cpp.so` 的实操

```bash
unzip -l base.apk                    | grep -E 'libil2cpp|global-metadata'
unzip -l split_config.arm64_v8a.apk  | grep -E 'libil2cpp|global-metadata'
# 典型路径：lib/arm64-v8a/libil2cpp.so（ABI split 或 base）
#           assets/bin/Data/Managed/Metadata/global-metadata.dat（base 或 assets split）
```

- **split 结构**：`base.apk`（manifest / 代码 / 基础资源）+ `split_config.<abi>.apk`（native `.so`）+ `split_config.<density>.apk`（纹理等）+ `split_<feature>.apk`（动态 feature）。> ⚠️ 未核实：Endfield 的 split 组成、ABI 列表、`extractNativeLibs` 取值、是否有 OBB。
- **安装后路径**：`/data/app/~~<random>/<pkg>-<random>/`（Android 11+ 路径混淆）；`extractNativeLibs="false"` 时 `.so` 直接从 APK 内 mmap（`.../base.apk!/lib/arm64-v8a/libil2cpp.so`）。
- **符号剥离判断**：`readelf -sW libil2cpp.so | head` 只能看到 `.dynsym` 里的少量导出；`il2cpp_*` API 通常还在（除非被混淆）。
- **用 metadata 定位**：dump 出 `dump.cs`（含方法 RVA）→ 运行时地址 = **load bias + RVA**（RVA 基于 so 的 vaddr，不是文件偏移，需按 `PT_LOAD` 换算）。
- **dump 工具**：[moyingyilang/Zygisk-Il2CppDumper](https://github.com/moyingyilang/Zygisk-Il2CppDumper)（"Using Zygisk to dump il2cpp data at runtime"，作者声明可 bypass protection / encryption / obfuscation）：装 Magisk v24+ 并启用 Zygisk → 改 `game.h` 的 `GamePackageName` → 跑 `:module:assembleRelease` → 装入 Magisk → 启动游戏 → `dump.cs` 生成在 `/data/data/<GamePackageName>/files/`。另有 Perfare/Il2CppDumper（静态）、djkaty/Il2CppInspector 以及进程内 dump 的 Android 库方案。> ⚠️ 未核实：这些工具对 Endfield 当前版本的实际效果（取决于保护强度），README 的能力声明为作者自述。
- **无 adb 场景**：Termux 内 `su -c 'cat /proc/<pid>/maps'` 拿 load bias 与段范围（需 root）。
## 9. 代码骨架结构

```text
app/src/main/java/.../ModLoaderService.kt   # Kotlin 入口：读配置、加载 native、悬浮 UI（仅配置与装载，Mesh 逻辑全在 C++）
app/src/main/cpp/CMakeLists.txt
app/src/main/cpp/entry.cpp                  # JNI_OnLoad / 注入器入口 → Install()
app/src/main/cpp/il2cpp_resolver.{h,cpp}    # 定位 libil2cpp.so、API 表、类/方法与重载消歧
app/src/main/cpp/hook_engine.{h,cpp}        # ShadowHook 封装（hook_sym_addr / unhook / trampoline 管理）
app/src/main/cpp/hooks_mesh.{h,cpp}         # Mesh / SkinnedMeshRenderer / Renderer / Shader.Find hook
app/src/main/cpp/mod_registry.{h,cpp}       # mod 描述 → 目标 renderer 匹配与重载状态机
app/src/main/cpp/mesh_builder.{h,cpp}       # 构造 Mesh 数据（顶点/法线/UV/色/骨骼权重/bindpose/blendShape）
```

```cpp
namespace efml {
struct Il2CppApi {
  Il2CppDomain* (*domain_get)();                                  const Il2CppAssembly** (*domain_get_assemblies)(const Il2CppDomain*, size_t*);
  const Il2CppImage* (*assembly_get_image)(const Il2CppAssembly*); Il2CppClass* (*class_from_name)(const Il2CppImage*, const char*, const char*);
  const MethodInfo* (*class_get_method_from_name)(Il2CppClass*, const char*, int);
  const MethodInfo* (*class_get_methods)(Il2CppClass*, void**);
  uint32_t (*method_get_param_count)(const MethodInfo*);           const Il2CppType* (*method_get_param)(const MethodInfo*, uint32_t);
  Il2CppObject* (*object_new)(const Il2CppClass*);                 Il2CppArray* (*array_new)(Il2CppClass*, il2cpp_array_size_t);
  Il2CppObject* (*runtime_invoke)(const MethodInfo*, void*, void**, Il2CppException**);
  Il2CppThread* (*thread_attach)(Il2CppDomain*);                   Il2CppMethodPointer (*resolve_icall)(const char*);
};
extern Il2CppApi api;
bool  Resolve(const char* lib_name);        // 扫描 API 表并校验版本
void* FindMethod(const char* image, const char* ns, const char* klass, const char* method, int argc);
}
// IL2CPP 调用约定：实例方法首参是 this，末参是 const MethodInfo*；返回值为值类型时首参是 RetType* 隐藏返回缓冲。
typedef void (*set_shared_mesh_t)(void* self, void* mesh, const MethodInfo* mi);
void  InstallMeshHooks();
void* OnSetSharedMesh(void* self, void* mesh, const MethodInfo* mi);   // 命中则替换 mesh
```

```kotlin
class ModLoaderService : Service() {                       // 必须运行在游戏进程内（见 03 文档）
    external fun nativeInstall(configPath: String): Int    // 0 = OK
    override fun onCreate() { super.onCreate(); nativeInstall(filesDir.resolve("efml").absolutePath) }
    companion object { init { System.loadLibrary("efml") } }
}
```
## 10. 评分表

| 维度 | 评分（1–5） | 依据 |
|---|---|---|
| 可行性 | **4** | `set_sharedMesh` + 构造 Mesh 已被 PC 侧同类工程反复验证；BNM-Android 证明 il2cpp 层可稳定改托管对象 |
| 工程量 | **3** | 需要 resolver + hook 引擎 + Mesh 构造 + 重载状态机 + mod 描述解析；比 Vulkan 层少写「顶点格式解码」，但要写「骨骼重映射」 |
| 稳定性 | **3** | ShadowHook 本身是生产级；风险来自版本适配、共享 mesh 的 CoW、GPU 侧残留 |
| 性能开销 | **4** | hook 只在渲染器赋值 / 材质设置时命中；缺点是 `runtime_invoke` 边界与大批顶点跨语言拷贝（可用一次性构建 + 缓存规避） |
| 检测风险 | **3** | inline hook 改代码段，易被哈希 / 内存扫描发现；改用「数据式 hook」可显著降低 |
| 对游戏版本变化的鲁棒性 | **2** | 最弱项：metadata / 方法偏移 / 类结构每次更新都可能变；需要「自动重新解析 + 按名字匹配目标」降低成本 |

**综合约 3.2 / 5**：适合作为**主路线**承载「对象级替换 + 材质与骨骼数据」，但**不能单独完成 EFMI 的能力集**；与 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 组合后整体能力最接近 EFMI。
## 参考

- [EFMI-Package README（Endfield Model Importer；Mod Hot Load / F10）](https://github.com/SpectrumQT/EFMI-Package)
- [EFMI-Package KeyBindings.ini（F10 / F11 / Ctrl+Alt+F10 实际绑定）](https://cdn.jsdelivr.net/gh/SpectrumQT/EFMI-Package@main/EFMI/Core/EFMI/KeyBindings.ini)
- [EFMI-Package 文件树（MergedSkeleton.ini、ShapeKeys.ini、MergedSkeleton_*.hlsl）](https://api.github.com/repos/SpectrumQT/EFMI-Package/git/trees/main?recursive=1)
- [SpectrumQT/XXMI-Launcher（EFMI 的分发平台）](https://github.com/SpectrumQT/XXMI-Launcher)
- [il2cpp-api-functions.h（全部 il2cpp C API 签名）](https://cdn.jsdelivr.net/gh/4ch12dy/il2cpp@master/unity_5_x/libil2cpp/il2cpp-api-functions.h)
- [moyingyilang/Zygisk-Il2CppDumper README](https://raw.githubusercontent.com/moyingyilang/Zygisk-Il2CppDumper/master/README.md)
- [Perfare/Il2CppDumper](https://github.com/Perfare/Il2CppDumper)
- [ByNameModding/BNM-Android README（Unity 版本支持、hook 后端清单）](https://github.com/ByNameModding/BNM-Android)
- [bytedance/android-inline-hook（ShadowHook README：模式、API、支持版本）](https://github.com/bytedance/android-inline-hook)
- [jmpews/Dobby](https://github.com/jmpews/Dobby)、[iqiyi/xHook](https://github.com/iqiyi/xHook)、[Rprop/And64InlineHook](https://github.com/Rprop/And64InlineHook)
- [vfsfitvnm/frida-il2cpp-bridge](https://github.com/vfsfitvnm/frida-il2cpp-bridge)
- [UnityCsReference · Runtime/Export/Graphics/Mesh.cs](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Graphics/Mesh.cs)
- [Unity Docs · Mesh.SetBindposes](https://docs.unity.com/en-us/engine/6000.5/script-reference/unityengine/mesh/setbindposes)、[Mesh.SetVertices](https://docs.unity.com/en-us/engine/6000.6/script-reference/unityengine/mesh/setvertices)
