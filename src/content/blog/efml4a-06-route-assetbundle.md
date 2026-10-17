---
title: "06 · 路线：资源层替换（AssetBundle 磁盘替换与运行时注入）"
description: "EFML4A 研究文档 · 06-route-assetbundle（Arknights: Endfield Mod Loader for Android）"
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


目标：**直接替换或重定向 Unity 资源文件**，而不是在渲染层 / 运行时干预。**结论速览**：该路线在「无加密 + 无完整性校验」时完全可行，但**每次游戏更新都要重新定位资源**，且**无法完成 EFMI 的骨骼合并 / shape key 注入**。建议定位为离线准备与静态换装，而非主路线。交叉引用：[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)、[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)、[07-route-matrix.md](/blog/efml4a-07-route-matrix/)、[10-mod-format.md](/blog/efml4a-10-mod-format/)。

## 1. Unity 资源体系

### 1.1 AssetBundle / Addressables / Resources

| 体系 | 打包产物 | 运行时加载 | 可替换性 |
|---|---|---|---|
| **AssetBundle** | `UnityFS` 容器（内含一个或多个 CAB）+ 依赖清单 | `AssetBundle.LoadFromFile` / `LoadFromMemory` / `LoadFromStream` | **高**：磁盘替换或路径重定向即可 |
| **Addressables** | 构建在 AssetBundle 之上的寻址层；产物 = bundle + catalog（`catalog.json` / `.hash` / `.bin`） | `Addressables.LoadAssetAsync<T>(address)`，由 catalog 把逻辑地址解析到具体 bundle | **中**：受 catalog 与 hash 约束，需同时改 catalog 或做路径重定向 |
| **Resources** | 打进 `resources.assets` / `level0`，随包发布 | `Resources.Load(path)`，路径即资源名 | **低**：位于 APK 的 assets 内，必须重打包并重新签名 |
| **StreamingAssets** | 原样放入 APK 的 `assets/` | 以 `jar:file://` 或 `UnityWebRequest` 读取原始字节 | 低（只读，需重打包） |

Addressables 的远程内容默认缓存到设备：官方文档写明「cached on the client device at the path defined by `Application.dataPath`」，并可用 `Caching` API 控制；清理用 `Caching.ClearCache` 或 `Addressables.CleanBundleCache`（可在 catalog 更新后自动调用）。
> ⚠️ 未核实：Android 上 Addressables 缓存的实际落盘目录（`UnityWebRequest` 缓存行为与 `Caching` 配置相关），以及 Endfield 是否使用 Addressables。

### 1.2 UnityFS 容器格式

以下读取顺序以 [AssetStudio 的 `BundleFile.cs`](https://raw.githubusercontent.com/Perfare/AssetStudio/master/AssetStudio/BundleFile.cs) 为准（小端）：

```text
Header
  char[]  signature                  "UnityFS" | "UnityWeb" | "UnityRaw" | "UnityArchive"
  u32     version
  char[]  unityVersion               e.g. "2021.3.30f1"
  char[]  unityRevision
  i64     size                       // 整个 bundle 文件大小
  u32     compressedBlocksInfoSize
  u32     uncompressedBlocksInfoSize
  u32     flags
          低 6 位 = 压缩类型：0=None  1=Lzma  2=Lz4  3=Lz4HC  4=Lzham
          0x40  BlocksAndDirectoryInfoCombined
          0x80  BlocksInfoAtTheEnd
          0x100 OldWebPluginCompatibility
          0x200 BlockInfoNeedPaddingAtStart
  if version >= 7: 对齐到 16 字节

BlocksInfo（自身可能被压缩；若 flags 含 0x80，则位于文件末尾 compressedBlocksInfoSize 处）
  16 bytes  uncompressedDataHash
  i32       blocksInfoCount
  Block[]   { u32 uncompressedSize; u32 compressedSize; u16 flags /* 低6位压缩类型; 0x40 = Streamed */ }
  i32       nodesCount
  Node[]    { i64 offset; i64 size; u32 flags; cstring path }
  if flags 含 0x200: 对齐到 16 字节

Blocks
  每个 Block 按自身 flags 解压后，顺序拼接为一个连续流
  Node.offset / Node.size 即在该流中切出每个 CAB 文件
```

- `UnityWeb` / `UnityRaw` 走**另一条分支**，header 不同（含 hash / crc / minimumStreamedBytes / levelCount 等字段），且 `UnityWeb` 的 block 使用 7z/LZMA 解压。
- LZMA 用的是 Unity 变体（AssetStudio 用 `SevenZipHelper.StreamDecompress`），**不是**标准 `.lzma` 文件头。
- `flags` 的低 6 位只覆盖 0–4；游戏自定义压缩通常改的就是这里。
  > ⚠️ 未核实：version ≥ 7 的 16 字节对齐、以及各版本 flags 语义细节，需按实际文件实测。

### 1.3 CAB 与 SerializedFile

- 解压后每个 `Node` 就是一个 **CAB** 文件，内容是一个 **SerializedFile**：header `{ metadataSize, fileSize, version(SerializedFileFormatVersion), dataOffset, endianness }`，随后是类型表（TypeTree 或类型引用）、对象表、`m_ScriptTypes`（MonoScript）与 **externals**（依赖的其他 CAB 名）。
- CAB 名形如 `CAB-<32 位 hex>`；对象以 `(pathId: int64)` 标识。
- 一个 bundle 里通常有一个 `AssetBundle` 对象，提供 `m_Container`（资源路径 → pathId）与 `m_AssetBundleName`。
- 依赖关系：AssetBundle 走 `AssetBundleManifest`（`GetAllDependencies`）；Addressables 走 catalog。依赖缺失会加载出空对象 / 粉色材质。
  > ⚠️ 未核实：SerializedFile 头的字段名与版本分支（如 version ≥ 22）随 Unity 版本变化，应以 UnityPy / AssetsTools.NET 的版本分支为准。

### 1.4 清单、依赖与 TypeTree

- **TypeTree** 描述每个对象的字段名 / 类型 / 对齐。打包时可选择是否写入；新版 Unity 默认剥离以节省体积。
- 若 TypeTree 缺失，需要外部类型库：TypeTreeDumps / Tpk，或从游戏自己的 assembly 生成。UnityPy 提供 `TypeTreeGenerator`，支持 `load_local_game(root_dir)` / `load_dll_folder(dll_dir)` / `load_dll(bytes)` / `load_il2cpp(il2cpp, metadata)`——即从 il2cpp dump 出的 dummy dll 或 `libil2cpp.so` + `global-metadata.dat` 重建 MonoBehaviour 的类型树。
- 对 EFML4A 的意义：TypeTree 是「等长字节替换」的前提——不先解出对象结构，就无法定位要改的字节偏移。

## 2. Android 上资源实际存放位置

| 位置 | 路径 | 无 root 可写性 |
|---|---|---|
| APK 内（base / split） | `/data/app/~~<random>/<pkg>-<random>/base.apk`、`split_config.*.apk`；内部 `assets/bin/Data/…` | 只读；修改会破坏 APK 签名 |
| OBB 扩展文件 | `/sdcard/Android/obb/<pkg>/main.<version>.<pkg>.obb` | 游戏进程自己可读写；第三方 App 不可见 |
| 首包后下载 / `persistentDataPath` | `/storage/emulated/<userid>/Android/data/<pkg>/files`（经 `Context.getExternalFilesDir` 解析） | 游戏进程自己可读写 |
| 临时缓存 | `Application.temporaryCachePath`；`Caching` 管理的目录 | 同上 |
| StreamingAssets | APK 内 `assets/`，经 `jar:file://` 或 UnityWebRequest 读 | 只读 |
| 外部共享存储 | `/sdcard/…` | Android 10+ 受 scoped storage 限制 |

- `Application.persistentDataPath` 在 Android 上指向 `/storage/emulated/<userid>/Android/data/<packagename>/files`（Unity 官方文档明确说明，路径由 `android.content.Context.getExternalFilesDir` 解析），且随 Bundle Identifier 稳定不变。
- **scoped storage（Android 10/11+）**：`/sdcard/Android/data/<pkg>/` 对第三方 App 不可见，普通 App 只能写自己的 `getExternalFilesDir()`。
- **关键点（对 EFML4A 有利）**：Zygisk 模块 / 注入库运行在**游戏进程内、以游戏自己的 uid 运行**，因此**无需额外 root** 就能写该游戏自己的 `/data/data/<pkg>/` 与 `/sdcard/Android/data/<pkg>/`。只有要写**别的** App 的目录才需要 root。见 [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)。
- **APK 内资源不可就地替换**：Android 7+ 的 APK Signature Scheme v2/v3 签名覆盖整个 APK 字节，改一个字节即签名失效，只能重新签名并**卸载重装**（丢失登录态与用户数据，且对游戏服务器而言是「另一个 App」）。
  > ⚠️ 未核实：Android 12+ 是否对目标机的该 APK 启用 fs-verity，以及 Endfield 是否有 APK/资源自校验。
- `/data/app/…` 目录名带随机前缀（Android 11+），**不可硬编码**，需运行时从 `/proc/self/maps` 或 `ApplicationInfo.sourceDir` 获取。
- split APK（AAB 分发）结构：`base.apk`（manifest / 代码 / 基础资源）+ `split_config.<abi>.apk`（native `.so`）+ `split_config.<density>.apk`（纹理等）+ `split_<feature>.apk`（动态 feature）。> ⚠️ 未核实：Endfield 的 split 组成、是否使用 OBB、`extractNativeLibs` 取值。

## 3. 加密与保护

- **自定义 magic / header**：把 `UnityFS` 换成别的字符串。此时标准解析器直接失败；游戏侧通常是先自行解密再把字节交给 `AssetBundle.LoadFromStream` / `LoadFromMemory`。
- **加密的 CAB**：两种粒度——BlocksInfo 被加密（连 block 表都读不出来，必须知道算法）或只有 Blocks 数据被加密（header 可读，解压会失败）。
- **自定义压缩 / 二次加密**：把 block 的压缩 flag 改成自定义值（甚至复用 LZHAM 编号占位），或在标准 LZ4 之外再做一层异或 / AES。UnityPy 提供了替换点：`CompressionHelper.COMPRESSION_MAP[flag]` / `DECOMPRESSION_MAP[flag]`。
- **Unity 官方 CN 加密**：`AssetBundle.SetAssetBundleDecryptKey(key)` 是 Unity 内置能力；UnityPy 对应 `UnityPy.set_assetbundle_decrypt_key(key)`。key 一般能在 `libil2cpp.so` 的字符串或 `AssetBundle.LoadFromFile` 附近的调用点找到。
  > ⚠️ 未核实：Endfield 是否使用该机制（Unity CN 加密）；若是国际版 Unity 则通常没有。
- **资源签名 / 校验**：可能对 bundle 整体做 CRC / SHA，或把期望 hash 写进 Addressables catalog（`catalog.hash`）；也可能校验 CAB 名 / pathId 是否在白名单内。
- **不解密能否做替换？** 可以，但只能做「**同形替换**」——替换后的字节必须能在**同一套解密 + 解压流程**下被正确处理，并满足全部校验（长度、hash、对象表一致性）。
  > **必须明说**：如果 bundle 被加密且**密钥 / 算法无法从二进制中恢复**，纯文件替换**不可行**。此时只剩三条路：(a) 回到 [05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/) 改加载逻辑或校验；(b) 走 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 完全不碰资源；(c) 放弃该资源。

## 4. 替换策略对比

| 策略 | 前提条件 | 稳定性 | 能否热重载 | 覆盖范围 |
|---|---|---|---|---|
| 直接解包 → 修改 → 重打包（离线） | 能解包（无加密或拿到密钥）；通常还要重新签名 / 重新分发 | 高（改动最少，不引入 hook） | **否** | 整包资源；联机 + 自校验场景基本不可行 |
| **磁盘重定向 hook** | hook libc 的 `open` / `openat` / `fopen` / `stat`，或 NDK 的 `AAssetManager_open` + `AAsset_read` | 中高（需在目标库加载前安装；注意 `jar:` 路径与 mmap 路径） | **是**（换文件后触发游戏重新加载） | 只覆盖走文件 API 的加载；对 `LoadFromMemory` / 内存解密无效 |
| **内存内解密后注入** | hook `AssetBundle.LoadFromFile` / `LoadFromMemory` / `LoadFromStream`，替换 path 或替换返回的 `AssetBundle` 对象 | 中（依赖 Unity 版本 API 与签名） | **是** | 最强，可绕过磁盘；但插入点必须在解密之后、Unity 解析之前 |
| **AssetBundle 运行时 patch** | hook `AssetBundle.LoadAsset(string)` / `LoadAsset<T>`，按名字返回我们的对象 | 中高 | **是** | 只改「已加载对象」，不解决 mesh 顶点数据来源问题 |
| **改游戏逻辑加载额外 bundle** | hook 到分配资源的调用点，插入一次 `AssetBundle.LoadFromFile(<我们的 bundle>)` 并替换引用 | 中 | **是** | 最贴近 EFML4A 的 mod 语义（额外 bundle + 引用替换）；本质上已属于 IL2CPP 路线 |

补充说明：

- 磁盘重定向是**唯一不需要解密**的通用手段，前提是「游戏把资源当普通文件读」；若游戏自己解密后再 `LoadFromMemory`，重定向只能替换**加密后的密文**。
- `AAssetManager_open` / `AAsset_read` 是 NDK 侧的 APK 资源读取 API。> ⚠️ 未核实：Unity 在 Endfield 的 Android 构建上是否全部走 `AAssetManager`（也可能存在 `AAsset_openFileDescriptor` + mmap 的路径），以及 libcurl（UnityWebRequest）下载路径是否需要一并 hook。
- 「运行时 patch」与「额外 bundle」两条策略一旦采用，就**回到 §5 讨论的能力边界**：它们能换掉对象引用，但改不了需要 GPU 侧参与的数据。

## 5. 与 EFMI 对标

### 5.1 EFMI 为什么**不做**资源替换

- EFMI 是**纯运行时渲染层干预**：通过 DXGI 代理注入 D3D11，用 ini + HLSL 在 draw call 层替换顶点 / 索引缓冲、注入骨骼与 shape key，**完全不碰游戏资源包**。
- **对游戏版本更鲁棒**：mod 描述的是 draw call 特征、shader 绑定与 buffer 布局；而资源包的内部结构、加密方案、路径命名会随版本变化。
- **不需要重新分发游戏资源**：EFMI 的 mod 只包含自定义模型 / 贴图，因此**不涉及游戏原始资源的版权问题**。
- **不修改游戏安装目录**：不触发安装完整性 / 签名校验（PC 上 EFMI 只往游戏目录放代理 DLL 与 ini）。
- 生态证据：EFMI-Package 的 README 把 [XXMI Launcher](https://github.com/SpectrumQT/XXMI-Launcher) 作为安装与分发入口，mod 的安装方式就是「解压到 `Mods` 目录」，全程不要求用户改游戏资源。

### 5.2 资源替换路线在 EFMI 的能力面前缺什么

| EFMI 能力 | 资源替换能否做到 | 原因 |
|---|---|---|
| 运行时动态改（每帧骨骼矩阵、shape key 权重） | **不能** | 磁盘上的 bundle 是静态数据；动态量由游戏动画系统每帧计算 |
| 骨骼合并（多套 VG 列表统一到合并骨架） | **不能**（只能预烘焙） | 需要在 GPU 侧把 mod 骨骼数据与游戏骨骼数据合并；换进去的 mesh 必须自带与游戏 skeleton 匹配的 bindpose / boneWeights，而 `SkinnedMeshRenderer.bones` 来自游戏侧 |
| shape key（形态键）混合 | **只能静态** | 可以随 mesh 一起打包 shape 数据，但**无法在运行时按游戏状态驱动权重**（除非同时 hook，见 [05](/blog/efml4a-05-route-il2cpp-hook/)） |
| 顶点格式自由（自定义顶点布局） | **受限** | 顶点属性集合与顺序必须与游戏 shader 期望一致；Unity 版本的顶点格式（`VertexAttributeDescriptor`）不匹配即渲染错乱 |
| 纹理格式自由 | **受限** | 必须匹配游戏使用的压缩格式（ASTC / ETC2 / 未压缩）与 mip 链 |
| 跨版本鲁棒 | **最差** | SerializedFile / TypeTree / 加密方案随版本变化 |
| 不触碰游戏设备数据 | **更好** | 磁盘替换可以完全不改内存（若只做离线重打包） |

**结论**：资源替换是「**换装 / 换贴图 / 换 UI 图**」的合适手段，不是 EFMI 式「模型重导入」的替代品。EFML4A 若采用它，应定位为**补充路线**：离线准备 mod 资源、静态换装、以及为 [05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/) 提供「额外 bundle 加载 + 引用替换」的落地方式。

## 6. 工具链

| 工具 | 运行环境 | 能做什么 | 在 Termux / Android 上能否运行 |
|---|---|---|---|
| [UABEA](https://github.com/nesrak1/UABEA) | C# / Avalonia GUI（.NET） | 浏览 / 编辑 SerializedFile 与 AssetBundle 的现代 GUI | **不能**：需要 .NET 桌面运行时 |
| [UABEANext](https://github.com/nesrak1/UABEANext) | C# / .NET | 「A research and modding tool for SerializedFiles and Asset Bundles」（UABEA 的后继方向） | 不能（同上） |
| [AssetsTools.NET](https://github.com/nesrak1/AssetsTools.NET) | C# 类库 | 读写 SerializedFile / bundle 的底层库，UABEA 系列的基础 | 不能（同上，但在 PC 上做自动化脚本很方便） |
| [AssetStudio](https://github.com/Perfare/AssetStudio) | .NET Framework 4.7.2 / .NET 5 / .NET 6 桌面 | 支持 Unity 3.4–2022.1；导出 Texture2D→png、Mesh→obj、AudioClip、Font、Animator→FBX、MonoBehaviour→json | **不能**：桌面运行时；可用性依赖 Windows / Linux 桌面 |
| [UnityPy](https://pypi.org/project/UnityPy/) | Python ≥ 3.8，MIT | 解析 **并编辑** UnityFS / SerializedFile；`UnityPy.load()` 可直接吃 apk；`Mesh.export()`→obj；Texture2D→PIL Image；MonoBehaviour→dict/class；`set_assetbundle_decrypt_key`；自定义块压缩映射表；基于 fsspec 的自定义文件系统（可做路径间接寻址 / 按需加载 / 解密） | **部分可行**。纯 Python 部分能在 Termux 跑；但依赖 `lz4` / `brotli` / `Pillow` / `texture2ddecoder` / `etcpak` / `astc-encoder-py` / `fmod_toolkit` / `tpk_ar`，其中多个是 C/C++/Rust 扩展，PyPI 只提供 manylinux / Windows / macOS 轮子，**Termux（bionic / aarch64）无轮子**，需从源码编译 |
| **自研轻量解析器（推荐）** | Python + `lz4` | 只读 UnityFS header / BlocksInfo、LZ4 解压、在 SerializedFile 内做「等长字节替换」（不改变对象长度） | **可行**：依赖极少，逻辑可控，最容易在 Termux 上跑通 |

Termux 实操建议：

1. `pkg install python`；仅依赖 `lz4` 时编译成本可接受，先做「只读解析 + 等长替换」，不要一上来做「重打包」。
2. 重型解包 / 导出（AssetStudio、UABEA、UnityPy 的纹理与 Mesh 导出）放到 PC 做，Android 侧只消费**结果**（例如已生成的差异包）。
3. `pip install UnityPy` 在 Termux 上大概率会在 `texture2ddecoder` / `etcpak` / `astc-encoder-py` 处失败。
   > ⚠️ 未核实：Termux 仓库中这些依赖是否有可用预编译包、以及 UnityPy 的纯 Python 回退路径能覆盖多少功能（`TypeTreeHelper.read_typetree_boost = False` 可关闭 C 实现，但其它 C 依赖仍在）。

```python
# 轻量只读解析器骨架（只依赖标准库）—— 在 Termux 上先确认「是不是标准 UnityFS」
import struct
with open(path, "rb") as f:
    sig = b""
    while True:
        c = f.read(1); sig += c
        if c == b"\x00": break
    assert sig == b"UnityFS\x00", f"非标准 magic: {sig!r}"   # 自定义 magic 会在此处失败
    version = struct.unpack("<I", f.read(4))[0]
    def cstr():
        b = b""
        while True:
            c = f.read(1); b += c
            if c == b"\x00": return b[:-1].decode()
    unity_version, unity_revision = cstr(), cstr()
    size, cbi, ubi = struct.unpack("<qII", f.read(16))   # size / compressedBlocksInfoSize / uncompressedBlocksInfoSize
    flags = struct.unpack("<I", f.read(4))[0]
    print(version, unity_version, size, cbi, ubi, hex(flags))
    # 低 6 位 = 压缩类型（0=None 1=Lzma 2=Lz4 3=Lz4HC 4=Lzham）；0x80 = BlocksInfoAtTheEnd
```

上面的片段只读 header（不做解压）。它能一次性回答三个关键问题：**是不是标准 UnityFS**、**Unity 版本**、**用的是哪种块压缩**。若 magic 断言失败，说明 §3 的加密/自定义 header 场景成立，纯文件替换路线需要先拿到算法。

## 7. 版权与法律红线

- **绝不分发游戏原始资源**：本仓库不提供、不镜像、不内置任何游戏贴图 / 模型 / 音频 / 数据表 / 反编译产物。
- **mod 包只分发差异部分**：只包含新增的顶点 / 贴图 / 材质定义，外加一份「patch 描述」（目标 bundle 名、CAB 名、pathId、替换规则与校验和）。**不含任何游戏原始字节**。
- **游戏资源提取的法律风险**：受游戏 EULA 与著作权法约束；不同法域对「互操作性反向工程」的态度不同。**提取物再分发的风险最高**，仅本地自用分析风险较低但并非为零。
- **本项目立场**：EFML4A 的定位是「**运行时 mod 加载器**」，不是「资源提取 / 分发工具」。文档 06 的内容定位为研究性与兼容性分析；若资源替换路线被采纳，交付物必须是**自包含差异包**，并建议在构建脚本里加一道校验：拒绝把任何未标记为 mod-origin 的二进制打进发布包。
- 不做、不协助任何绕过 DRM / 反作弊的商业化服务；不为联机竞技场景提供优势性修改。

## 8. 评分表

| 维度 | 评分（1–5） | 依据 |
|---|---|---|
| 可行性 | **3** | 无加密无校验时完全可行且实现简单；有加密时受「密钥是否可得」这一硬约束，可能直接归零 |
| 工程量 | **3** | 「等长替换 + 磁盘重定向」工程量小；「完整解包 / 重打包 / 处理校验」工程量与风险都显著上升 |
| 稳定性 | **2** | 每次游戏更新都要重新定位 bundle 与对象；一旦触发校验会导致启动失败或资源加载异常 |
| 性能开销 | **5** | 纯磁盘 / 文件系统层，几乎没有额外运行时开销（对比 §4 的内存 hook 也极低） |
| 检测风险 | **2** | 若改动 APK 或游戏资源文件，完整性 / 签名校验极易命中；单纯重定向文件路径相对隐蔽但仍会留下文件系统痕迹 |
| 对游戏版本变化的鲁棒性 | **1** | 最差项：资源布局、加密方案、catalog hash 都可能随版本变化 |

**综合约 2.7 / 5**：**不作为主路线**。定位为「离线准备 / 静态换装 / 为 IL2CPP 路线提供额外 bundle 与引用替换的落地机制」。与 [07-route-matrix.md](/blog/efml4a-07-route-matrix/) 中的整体排序一致。

## 参考

- [AssetStudio · BundleFile.cs（UnityFS header / BlocksInfo / Node 读取顺序）](https://raw.githubusercontent.com/Perfare/AssetStudio/master/AssetStudio/BundleFile.cs)
- [Perfare/AssetStudio README（支持版本、导出类型、桌面运行时要求）](https://github.com/Perfare/AssetStudio)
- [UnityPy · PyPI（版本、依赖列表、TypeTreeGenerator、解密与自定义压缩接口）](https://pypi.org/project/UnityPy/)
- [nesrak1/UABEA](https://github.com/nesrak1/UABEA)、[nesrak1/UABEANext](https://github.com/nesrak1/UABEANext)、[nesrak1/AssetsTools.NET](https://github.com/nesrak1/AssetsTools.NET)
- [Unity Docs · Application.persistentDataPath（Android 路径与 getExternalFilesDir）](https://docs.unity3d.com/ScriptReference/Application-persistentDataPath.html)
- [Addressables 2.7 · Remote content AssetBundle caching（缓存位置与清理 API）](https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/remote-content-assetbundle-cache.html)
- [Unity Manual · AssetBundle compression formats](https://docs.unity.com/en-us/engine/6000.7/manual/assets-and-media/assets-managing-runtime/assetbundles-section/creating/compression-format)
- [Unity Manual · AssetBundle caching](https://docs.unity3d.com/Manual/AssetBundles-Cache.html)
- [SpectrumQT/EFMI-Package README（EFMI 的安装与 mod 分发方式）](https://github.com/SpectrumQT/EFMI-Package)
- [SpectrumQT/XXMI-Launcher](https://github.com/SpectrumQT/XXMI-Launcher)
