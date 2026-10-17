---
title: "42. VFS 完整性校验机制（第 3 阶段核心）"
description: "EFML4A 研究文档 · 42-vfs-integrity（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> **目的**：查明「mod 不生效 / 扭曲」的元凶。
> **结论**：`VirtualFileSystem.ValidChunkMD5()` 校验**每个 chunk 的内容 MD5**。

## 42.1 ★★★ 校验 API（`VirtualFileSystem`，来自 dump.cs）

```csharp
// Dll : Common.Beyond.dll   Namespace: (全局)
public class VirtualFileSystem {
    public static Boolean s_bUseRawDebugMode;        // ★ 原始模式调试开关
    public static Boolean s_bUseRawDebugModeLog;
    public static Boolean s_bUseFileNameInfo;
    public static Boolean s_enableMmapEnableTest;

    // RVA: 0xcb97484
    public static Boolean ValidChunkMD5(FVFBlockChunkInfo chunk, out UInt128 hash);
    // RVA: 0xcb96f38
    public static List ValidBlockChunk(VFBlockMainInfo block);
    // RVA: 0xcb972c8
    public static Boolean ValidChunkLength(FVFBlockChunkInfo chunk,
                                           out Boolean isFromStreaming, out Int64 length);
    // RVA: 0xcb967b0
    public BlockValidator CreateBlockValidatorByTypes(IList blockTypes);
    // RVA: 0xcb97990
    public static Span GetCommonChachaKeyBs(Span keyBuffer);
}
```

## 42.2 ★★ 校验的**粒度**（关键）

### `FVFBlockChunkInfo`（**chunk 级**）

```csharp
public struct FVFBlockChunkInfo {
    public UInt128 md5Name;       // 0x10
    public UInt128 contentMD5;    // 0x20   ★★ 整个 chunk 的内容校验和
    public Int64   length;        // 0x30
    public NativeArray files;     // 0x38
    public EVFSBlockType blockType;  // 0x48
    public EVFSFileTag   mainTag;    // 0x49

    public static FVFBlockChunkInfo ReadFromByteBuf(Int32 version, ref ByteBufStream cfg);
    public String GetContentMD5Str();
    public String GetRelativeChunkFilePath();
    public String GetChkMD5Name();
}
```

### `FVFBlockFileInfo`（**文件级**）

```csharp
public struct FVFBlockFileInfo {
    public Int64   fileNameHash;           // 0x10
    public Int32   fileChunkMD5NameIndex;  // 0x18
    public Int32   ivSeed;                 // 0x1c
    public UInt32  offset;                 // 0x20
    public UInt32  len;                    // 0x24
    private UInt32 m_packedFlags;          // 0x28  ★ 打包标志

    private const UInt32 FLAG_USE_ENCRYPT;          // bit0
    private const UInt32 FLAG_IS_DIRECT_FILE_NAME;  // bit1
    private const Int32  BLOCK_TYPE_SHIFT;
    private const Int32  LOADER_POS_TYPE_SHIFT;
    private const Int32  FILE_TAG_SHIFT;

    public Boolean bUseEncrypt { get; set; }
    public EVFSBlockType blockType { get; set; }
    public EFileLoaderPosType loaderPosType { get; set; }
    public EVFSFileTag fileTag { get; set; }
}
```

**⇒ 与我们从 `.blc` 解析出的布局**完全对应** ✓**

## 42.3 ★★★ 机制推导

```
校验粒度 = 【chunk】（不是 file）

我们改了 .chk 里某个 chunk 的内容
⇒ 该 chunk 的 contentMD5 失配
⇒ ValidChunkMD5() 返回 false
⇒ 后果（待确认）:
   ① 拒绝该 chunk
   ② 回退到 pblk（补丁块）
   ③ 触发重新下载
   ④ 或仍加载但状态不一致
```

**⇒ 这很可能就是「模型变了但扭曲」的元凶之一。**

## 42.4 ★★ `VFSFileReadStream`：XXE1 在**读取时**解密

```csharp
public class VFSFileReadStream : Stream {
    private FVFBlockFileInfo m_blockFileInfo;  // 0x28
    private Stream          m_baseStream;      // 0x48
    private XXE1            m_encryptor;       // 0x50   ★★★
    // RVA: 0xcba6060
    public override Int32 Read(Byte[] buffer, Int32 offset, Int32 count);
}
```

**⇒ `XXE1`（我们一直没解出的 `ENC=1` 加密）在**读取时**解密，**
**⇒ 不是预先解密到磁盘。**
**⇒ **必须复核** `FVFBlockFileInfo.bUseEncrypt` 的读取位置是否正确** ——
**若 InitialBundle 实际是 `bUseEncrypt=1`，那我们改的就是**密文**，游戏解密后得到乱码。**

## 42.5 完整的 `EVFSBlockType` 枚举

```
None=0   InitialAudio=1   InitialBundle=2   InitialExtendData=3
BundleManifest=4   IFixPatch=5   Bundle=11   Audio=12   Video=13
IV=14    Streaming=15     DynamicStreaming=16   Lua=17   Table=18
JsonData=19   ExtendData=20   HotfixAudio=21   Terrain=22
AudioChinese=101  AudioEnglish=102  AudioJapanese=103  AudioKorean=104
Raw=255
```

## 42.6 ★ `BlockValidator`（只收集**缺失** chunk）

```csharp
public class BlockValidator {
    private List   m_tasks;       // 0x10
    private Single m_progress;    // 0x18
    private Boolean m_isChecking; // 0x1c
    private Dictionary m_results; // 0x20

    public Single  GetProgress();
    public Void    .ctor(IList blockTypes, VirtualFileSystem vfs);
    public Boolean TryGetResult(EVFSBlockType blockType,
                                out FLoadBlockInfo loadBlockInfo,
                                out List missedChunks);
    public Void    CollectAllMissedChunks(List missedChunks);
    public Void    ThreadSafeDoCheck(Action onProgressChanged);
}
```

**⇒ `CollectAllMissedChunks` 只收集**缺失**的 chunk（与 `docs/27` 判断一致）**
**⇒ 但 `ValidChunkMD5` 的存在说明**内容校验在某处被调用**（需找调用者）**

## 42.7 ⏭️ 下一步（明确）

| 优先 | 任务 |
| --- | --- |
| **1** | **找 `ValidChunkMD5` 的调用者** ⇒ 确认是否在**加载路径**上 |
| **2** | **复核 `bUseEncrypt`** ⇒ InitialBundle 的 chunk 是否实际加密 |
| **3** | **反汇编 RVA `0xcb97484`** ⇒ 确认校验逻辑（是否比对 `contentMD5`） |
| **4** | 找 `s_bUseRawDebugMode` 的赋值/读取点 ⇒ 判断能否绕过 |
| **5** | 若校验在加载路径上 ⇒ 路 A（同时更新 `contentMD5` + 重算 `.blc` CRC32）或路 B（hook 恒返回 true） |

---

## 42.8 ★★★ 决定性实验：校验**没有**阻止 mod（第 26 轮）

### 42.8.1 实验设计（零风险）

**反证法：若 `ValidChunkMD5` 触发重下/恢复，那我们改过的 `.chk` 早该被游戏还原。**

### 42.8.2 结果

```
mod .chk md5 : f93846d47543c7a8057c26fa87530640   ← ★★★ mod 仍在
文件 mtime   : 2026-10-15 23:12:58                  ← 我们写入的时间，未被触碰
原版 md5     : 91e6e5e0201b29ba81689cdf134a50c5

index_main.json  : 2026-10-16 22:15（游戏更新过）
pref_main.json   : 2026-10-16 22:16（游戏更新过）
⇒ 游戏运行了启动流程，但【没有恢复/重下】我们的 .chk
```

### 42.8.3 ★★★ 结论

```
若 ValidChunkMD5 在加载路径上并触发重下:
  ⇒ 10-15 23:12 写的文件，在 10-16 22:15 启动后必被恢复
  ⇒ 但 md5 仍 = mod 版、mtime 仍 = 写入时刻
⇒ 【校验没有阻止，也没有恢复】
⇒ 「模型扭曲」【不是校验造成的】
```

### 42.8.4 与 `optionalValidator` 的发现吻合

```csharp
public Void InitMountFromLocalFile(BlockValidator optionalValidator) { }
public Void AppendMountFromLocalFile(Dictionary preferredResType, BlockValidator optionalValidator) { }
```

**⇒ 参数名为 `optionalValidator` ⇒ **正常挂载不校验****
**⇒ 校验只在「资源检查/修复」流程（`_CheckIfLocalInitialAssetsValid` /
`_ThreadSafeCheckLocalFiles`）里使用。**

### 42.8.5 ★ 修正后的因果链

| 假设 | 状态 |
| --- | --- |
| ~~校验失败 ⇒ 游戏拒绝 mod~~ | ❌ **被本实验推翻** |
| **顶点数据多 stream 布局 ⇒ 写错偏移** | ✅ **仍是主因** |
| `contentMD5` 校验存在但**不在加载路径** | ✅ 与 `optionalValidator` 一致 |

### 42.8.6 附带发现：`findbl` 工具（bl 调用图）

**新增 `tools/vfs/findbl.c`：扫 ARM64 `bl` 指令找调用者。**

**⚠️ 但对 il2cpp 托管方法**无效**：**
```
il2cpp 托管方法由【托管代码】调用 ⇒ 走方法表/thunk/runtime_invoke
⇒ 通常是间接跳转（blr），不是直接 bl
⇒ 「扫 bl」找不到托管调用者
验证：bl 编码计算正确（0x1a51115c → 0x14b32f20 与 objdump 吻合），
      但对 Mesh.get_bindposes 等返回 0 调用者
```

**⇒ 调用图分析对 il2cpp 需要换方法（如 ILFix wrapper 表 / 元数据）。**

### 42.8.7 对 hook 路线的意义（正面）

```
dump.cs 的 RVA 对【Mesh 系列函数】全部有效:
  0x1a51114c HGMeshRendererData.GetMeshes  ✓
  0x1a4aa498 Mesh.GetVertexAttribute        ✓
  0x1a4ab220 Mesh.get_bindposes             ✓
  0x1a4aa2ec Mesh.GetPtrUnchecked           ✓
⇒ 【hook 路线不受影响】
（仅 0xcb97484 反汇编异常，可能 dump.cs 对该函数记录有误）
```
