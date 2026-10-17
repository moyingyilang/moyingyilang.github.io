---
title: "28. EFMI mod 的 `.buf` 资产格式（已解出）"
description: "EFML4A 研究文档 · 28-efmi-buf-format（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 第 2 阶段目标：把 EFMI(DirectX) mod 的资产**重打包成 Unity AssetBundle `.ab`**，
> 从而复用已验证成立的 VFS 文件替换路径（`docs/26` §28）。
> 本文记录**第一步**：解析 EFMI 的网格缓冲格式。

## 28.1 素材

`edmin_maid.zip`（40 MB）解出后：
```
mod.ini                       EFMI 定义
Meshes/                       48 个 .buf
  ComponentN_IB.buf           索引缓冲（index buffer）
  ComponentN_VB0.buf          顶点流 0（含位置）
  ComponentN_VB1.buf          顶点流 1
  ComponentN_VB2.buf          顶点流 2
  ComponentN_VB2_LOD1_BlendRemap.buf
Textures/                     BC5/BC7 压缩 .dds
```
`mod.ini` 关键参数：
```ini
global $object_guid        = 185751
global $mesh_vertex_count  = 56270
global $component_count    = 11
global $bones_count        = 395
global $max_instance_count = 8
drawindexed = 27615, 0, 0     ; INDEX_COUNT, FIRST_INDEX, 0
drawindexed = 9000,  0, 0
…
```

## 28.2 ★ 格式解出（铁证：11/11 组件吻合）

### 索引缓冲 `ComponentN_IB.buf`

| 证据 | 说明 |
| --- | --- |
| `Component0_IB` = 55,230 B ÷ 2 = **27,615** | = `drawindexed[0].count`，**完全吻合** |
| `Component1_IB` = 18,000 B ÷ 2 = **9,000** | = `drawindexed[1].count` |
| `Component2_IB` = 9,048 B ÷ 2 = **4,524** | = `drawindexed[2].count` |
| 字节序内容 | `0,1,2,3,4,5,3,5,6,3,6,7,…` 严格从 0 递增 |

**⇒ `IB` = `uint16[]`（R16_UINT），标准**三角形列表**。**

### 顶点缓冲 `ComponentN_VB0.buf`

位置在偏移 **0 / 16 / 32 / 48** 严格重复：
```
off  0:  0.075846, 0.040656, 1.429514
off 16:  0.074328, 0.040393, 1.428679
off 32:  0.077971, 0.039264, 1.425845
off 48: -0.037208,-0.072133, 1.421486
```

**⇒ `VB0` = 16 字节/顶点 = 3×`float32` 位置 (x,y,z) + 4 字节打包数据（法线/切线？待定）**

### 交叉验证（11 个组件全部成立）

| comp | IB(B) | 索引数 | maxIdx | VB0(B) | VB0/16 | stride |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 55,230 | 27,615 | 7,910 | 126,576 | 7,911 | **16.00** ✓ |
| 1 | 18,000 | 9,000 | 1,806 | 28,912 | 1,807 | **16.00** ✓ |
| 2 | 9,048 | 4,524 | 1,547 | 24,768 | 1,548 | **16.00** ✓ |
| 3 | 30,894 | 15,447 | 5,824 | 93,200 | 5,825 | **16.00** ✓ |
| 4 | 3,276 | 1,638 | 507 | 8,128 | 508 | **16.00** ✓ |
| 5 | 52,650 | 26,325 | 5,308 | 84,944 | 5,309 | **16.00** ✓ |
| 6 | 234 | 117 | 40 | 656 | 41 | **16.00** ✓ |
| 7 | 2,772 | 1,386 | 275 | 4,416 | 276 | **16.00** ✓ |
| 8 | 180 | 90 | 33 | 544 | 34 | **16.00** ✓ |
| 9 | 349,368 | 174,684 | 38,835 | 621,376 | 38,836 | **16.00** ✓ |
| 10 | 4,572 | 2,286 | 469 | 7,520 | 470 | **16.00** ✓ |

**不变量：`VB0_size / 16 == max(IB) + 1`，且 stride 恒为 `16.00`。**

**⇒ 格式确认无疑。**

### 一处待解

```
Σ(maxIdx + 1) = 62,565
mod.ini 的 $mesh_vertex_count = 56,270      ← 差 6,295
```
**可能是 LOD 差异，或 `$mesh_vertex_count` 只统计基础 LOD。不影响格式结论。**

## 28.3 下一步（重打包成 Unity `.ab`）

1. **确定 VB0 后 4 字节的语义**（打包法线？UV？颜色？）
   —— 可用已知 Unity 顶点布局对照，或用 EFMI 的 `*.hlsl` shader 反推
2. **确定 VB1 / VB2 的用途**（UV / 骨骼索引权重 / 切线）
3. **找一个终末地原生的角色 `.ab`**，解析其 `Mesh` 对象的顶点布局
4. **按目标 `.ab` 的布局重新打包** mod 的顶点/索引 + 纹理
5. **等长替换部署**（若长度不同，则需退回研究 `.blc` 重写路径）

**参考**：EFMI 的 `Core/EFMI/Shaders/*.hlsl`
（`ShapeKeyDequantizer.hlsl` / `MergedSkeleton_*.hlsl`）里有顶点处理逻辑，
可用于反推字段语义。

---

## 28.4 顶点流全部解出（第 2 轮）

### VB1 = UV 坐标

```
Component0_VB1 f32: 0.1108 0.7431 0.0000 | 0.1155 0.7431 0.0000 | 0.1108 0.7385
                    └─── UV ───┘  常量0     └─── UV ───┘  常量0
```

| stride | 组件 | 含义 |
| --- | --- | --- |
| **12 B** | 0,1,2,3,5,6,9,10 | `3×float32 = (u, v, 0)` |
| **8 B** | 4,7 | `2×float32 = (u, v)` |

### VB2 = 骨骼蒙皮 / 材质 ID

**stride 16（组件 0, 9）= 4 骨骼蒙皮：**
```
Component9_VB2 v0: u16x8 = (43586, 20345, 1573, 31, | 245, 210, 267, 211)
Component9_VB2 v1: u16x8 = (38969, 25758,  808,  0, | 245, 210, 267,   0)
                      └──── 4×u16 权重 ────┘   └── 4×u16 骨骼索引 ──┘

★ 245, 210, 267, 211 全部 < 395
  正好等于 mod.ini 的 $bones_count = 395          ← 决定性佐证
```

**stride 8（组件 2, 6, 7）：**
```
Component2_VB2 全部顶点: u16x4 = (81, 0, 0, 0)
Component7_VB2 全部顶点: u16x4 = (187, 0, 0, 0)
```
**⇒ 每顶点恒定相同值 ⇒ 像**材质 / 子网格 ID**（这些组件无蒙皮）。**

### VB0 尾部 4 字节（仍未定）

```
Component0_VB0 v0: raw=f747ea49
  as fp16×2 : (+7.9648, +11.8281)   ← 值域不合理（|n| 应 ≈1）
  as 4×int8 : (-9, 71, -22, 73)
  as 4×uint8: (247, 71, 234, 73)    ← 像 RGBA8 顶点色？
```
**待定：可能是打包法线（如 `R10G10B10A2` 或自定义编码）
—— 需对照 EFMI 的 `Core/EFMI/Shaders/*.hlsl` 或终末地原生 `.ab` 确认。**

## 28.5 当前格式总表

| 流 | stride | 内容 | 置信度 |
| --- | --- | --- | --- |
| **IB** | 2 B / 索引 | `uint16[]` 三角形列表 | ✅ 铁证 |
| **VB0** | **16 B** | `3×float32 位置` + `4 B 打包` | ✅ 位置铁证 / 尾部待定 |
| **VB1** | **12 B**（部分 8 B） | `(u, v, 0)` UV | ✅ 高 |
| **VB2** | **16 B**（部分 8 B） | `4×u16 权重` + `4×u16 骨骼索引` | ✅ 高（骨骼数吻合） |

**全流不变量**：`流大小 / stride == max(IB) + 1`（每个组件的顶点数）
—— 已在 11/11 组件上对 VB0 验证成立。

## 28.6 下一步

1. **[1c]** 确定 VB0 尾部 4 字节 → 查 `Core/EFMI/Shaders/*.hlsl` 或原版 `.ab`
2. **[2]** 取一个终末地原生角色 `.ab`，解析其 `Mesh` / `SubMesh` / `VertexAttribute` 布局
   - Unity 的 `Mesh` 在 SerializedFile 里有明确的 `m_VertexData`（含 `m_Channels` 描述）
   - 拿到目标布局后才能正确重打包
3. **[3]** 重打包：顶点/索引 → Unity `Mesh`；`.dds`(BC5/BC7) → Unity `Texture2D`
4. **[4]** 等长替换部署验证

---

## 28.7 第 2 项：找原生角色 `.ab` —— 进展与阻碍

### 28.7.1 已查明的事实

| 事实 | 说明 |
| --- | --- |
| **Bundle 块的 `.ab` 全是哈希命名** | `Data/Bundles/Android/main/<24位hex>.ab`，共 **252,873** 个 —— **无法按名字识别角色模型** |
| **`StringPathHash.bin` 不可用于查名** | 158 MB，**无任何可读字符串**；头部为结构化二进制（`c0bb2401 7d320c00 …`）⇒ 是 **hash→hash 映射**，非「名字→hash」 |
| **`BundleManifest` 才是资源清单** | `1CDDBF1F` → `Data/Bundles/Android/manifest.hgmmap`，**49,562,407 B** |
| **★ 但它是加密的** | `.blc` 记录 **`useEncrypt = 1`**，**`ivSeed = 1039818536`**；实测熵 = **7.999 bits/byte** |

### 28.7.2 `ENC=1` 块的解密尝试（尚未成功）

**已试 14 种组合**（标准 ChaCha20 + `.blc` 密钥）：

```
nonce = 文件头 12 字节  × ctr0 ∈ {0, 1, 1039818536, 16247164, 259954634}
nonce = 全零            × 同上
nonce = ivSeed(小端4B)+0 × 同上
```
**结果：全部**未**产生 `UnityFS` 魔数。**

**⇒ `ENC=1`（XXE1）的真实方案仍需进一步逆向。**
**候选方向**：
1. 加密前可能有一个头部（如长度/校验），真正密文从某偏移开始
2. `ivSeed` 可能是 **keystream 起始索引**（类似 HGCipher 的 `seed + offset>>2`）而非 nonce/counter
3. 可能是**自定义 ChaCha 变体**（如轮数、布局不同）
4. 密钥可能对 ENC=1 块另有派生

### 28.7.3 这对第 2 项的影响

**「找一个终末地原生角色 `.ab` 作为重打包模板」这条路**目前**被 `manifest.hgmmap` 的加密挡住**：
- 不知道「角色模型」对应哪个哈希命名的 `.ab`
- 虽然可以**盲取**任意 `.ab`（只要解压成功就能看结构），
  但 **`.ab` 本身也是 `UnityFS`，可能同样在 `ENC=1` 之下**

**⇒ 下一步应先解决 `ENC=1` 解密，或从别处找一个**明文**的 Unity `.ab`：**
- `InitBundle` 块（`0CE8FA57`，1052 个）是 **`ENC=0` 明文**，且含
  `Data/Bundles/Android/initial/*.ab` ⇒ **这是最佳突破口**（无需解密！）

### 28.7.4 下一步（优先级）

1. **[2a] 从 `InitBundle`（`ENC=0` 明文）里取一个 `.ab`，解析 `UnityFS` 结构**
   —— 无需任何解密，是最短路径
2. **[2b] 若 `InitBundle` 里没有 `Mesh`，则回头攻 `ENC=1`**
3. **[1c] 顺带定 VB0 尾部 4 字节**（拿到 `.ab` 后可对照 `Mesh` 的 `VertexAttribute`）

---

## 28.8 第 2a 项：`InitBundle` 的 `.ab` 结构（重大进展）

### 28.8.1 不是标准 `UnityFS`

```
在 initbundle.chk（175,600,672 B）里搜 'UnityFS' → 【0 命中】
条目头 4 字节分布极散（a1f330e5×5 / f4b47add×4 / 242cadfa×4 …）
条目 0 头 16: 00 79 79 f4 d7 fa cd 99 dd 0c 7e e9 …
```
**⇒ `.ab` 不是以 `UnityFS` 开头的标准 AssetBundle。**

### 28.8.2 ★ 但**里面确实是 Unity 数据**（明文可读！）

以 `778ee78277bd18ee2ace12cc.ab`（3183 B）为例，
在条目内部找到**完整的 Unity 版本号与 `Texture2D` 字段名**：

```
+184 : 2021.3.3                       ← Unity 引擎版本（完整明文）
+762 : m_ForcedFallbackFormat
+769 : dFallbackFormat
+785 : m_DownscaleFallback
+800 : em_IsAlphaChannelOptional
+826 : m_WidtX
+834 : m_Heigh
+849 : leteImageSize
+865 : MipsStripped
+878 : m_lexture
+899 : h$Readable
+913 : reProcess
```

**⇒ 这些条目是 `Texture2D` 资源包。**
**（`2021.3.3` 完整出现 ⇒ 不是全量加密）**

### 28.8.3 存在的字节变换（关键待解）

**字符串出现明显的"错位/多字节"现象：**
```
m_WidtX     ← 应为 m_Width   （插入了 'X'）
em_IsAlphaChanne  ← 应为 m_IsAlphaChannelOptional （前面多了 'e'）
m_lexture   ← 应为 m_Texture （'T' 变成了 'l'）
h$Readable  ← 应为 m_IsReadable
```
**⇒ 说明存在某种**定长/变长字节插入或变换**，尚需确定。**

**同时发现固定的 4 字节序列：**
```
偏移 +8, +9   恒为  dd 0c
偏移 +18..21  恒为  84 5d 1e 05
（在多个不同条目上重复出现）
```
**⇒ 可能是块信息（block info）结构。**

### 28.8.4 熵分布（部分压缩，非全加密）

```
段0 [0,      795)  熵 = 6.088
段1 [795,   1590)  熵 = 6.332
段2 [1590,  2385)  熵 = 6.359
段3 [2385,  3183)  熵 = 6.694
```
**⇒ 熵在 6.0–6.7 之间（明文约 4–5，全加密约 8.0）
⇒ 是**压缩数据与明文混合**，而非整体加密。**

### 28.8.5 `CAB-` 说明

条目内（如 `+2234`）出现：
```
… 3e ff 3b 61 72 63 68 69 76 65 3a 2f 43 41 42 2d 32 33 17 …
          "a  r  c  h  i  v  e  :  /  C  A  B  -  2  3"
```
**`archive:/CAB-<hash>` 是 **Unity 内部路径**，证明内容确实是 Unity AssetBundle 体系的
（只是外层套了 Hypergryph 自己的容器）。**

### 28.8.6 另发现 gzip 头

```
在 initbundle.chk 里搜 1f 8b 08 → 命中 3,462,313 处
例如 @0x17afcd0 ∈ 68561f882c4f697a7d32d8a7.ab +264997
```
**⇒ 部分条目的内容含 gzip 流（可能是内嵌的压缩资源）。**

### 28.8.7 下一步

1. **[2c] 确定 `.ab` 外层的容器格式**：头 0–183 的结构、`dd0c`/`845d1e05` 常量的含义
2. **[2d] 确定字节变换规律**（用 `2021.3.3` 附近的已知字符串做对照，推出变换函数）
3. **[2e] 解出后解析 `Texture2D` 的 `m_TextureFormat`**
   —— **这直接决定 mod 的纹理要转成什么格式**
4. 若 `InitBundle` 只有纹理没有 `Mesh`，则以纹理替换作为**第一个可见 mod**
   （比模型替换容易得多！）

---

## 28.9 ★ 决定性突破：内层是标准 Unity `SerializedFile` + `TypeTree`

### 28.9.1 原始字节（`778ee78277bd18ee2ace12cc.ab` len=3183）

```
+176  00 10 41 c0 00 1a 33 07 | 32 30 32 31 2e 33 2e 33    ....3.2021.3.3
+192  89 66 35 00 0d 00 00 00 01 02 00 00 00 1c 00 1a
      └─3566h=13670─┘ └─0d=13─┘
```

**→ `"2021.3.3"` = **Unity 引擎版本号**，**完整无缺**。
**→ 紧随其后是 `u32` 字段（13670 / 13）⇒ 标准 `SerializedFile` 头部结构。**

### 28.9.2 TypeTree 紧凑格式（字符串间的控制字节）

```
+752  9d 04 05 00 8d 2c 00 20 73 13 | 6d 5f 46 6f 72 63      "m_Forc"
+768  0d | 64 46 61 6c 6c 62 61 63 6b 46 6f 72 6d 61 74      "dFallbackFormat"
+784  1a | 6d 5f 44 6f 77 6e 73 63 61 6c 65 | 00 | 1a 33 1a  "m_Downscale"
+816  83 | 4f 70 74 69 6f 6e 61 6c | 00 | 6d 5f 57 69 64 74  "Optional" / "m_Widt"
+832  58 | 00 | 6d 5f 48 65 69 67 68 | 00 | 3e 73 1b | 43 6f 6d
+848  f4 | 6c 65 74 65 49 6d 61 67 65 53 69 7a 65 | 00 | 6d
+880  6c 65 78 74 75 72 65 | 00 | 71 00 00 1f 15 | 43 6f 75  "lexture" / "Cou"
+912  06 | 72 65 50 72 6f 63 65 73 73 | 00 | 39 3c | 49 67 6e  "reProcess" / "Ign"
```

**⇒ **不是字符串被破坏**，而是**在错误偏移上对齐**了。**

**Unity `TypeTree` 紧凑格式每节点：**
```
u8  version | u8 level | u8 type | u8 nameLength | char name[] | u32 byteSize | i32 index | u32 metaFlag | u64 refTypeHash
```
**⇒ 夹在字符串之间的 `0d` / `1a` / `83` / `f4` / `00` / `06` 等，
是**相邻节点的控制字节 / 字符串终止符**，而非「被替换的字符」。**

**之前误判为「字节变换」的原因**：正则 `[\x20-\x7e]{6,}` 遇到控制字节就断开，
导致把完整字段名切成了 `m_Forc` + `dFallbackFormat` 这样的碎片。

### 28.9.3 结论

| 层 | 内容 | 状态 |
| --- | --- | --- |
| **外层** | Hypergryph 自有容器（`dd0c` / `845d1e05` 常量、头 0–183） | 待解 |
| **内层** | **标准 Unity `SerializedFile` + `TypeTree`（Unity 2021.3.3）** | ✅ **确认** |

**⇒ 内层是**完全标准的 Unity 资产**，这意味着：**
1. **重打包成 `.ab` 的技术路径是可行的**（Unity 侧格式已知）
2. **只要解开外层容器，就能用通用 Unity 工具处理**
3. **`Texture2D` 字段名齐全 ⇒ 这批 `InitBundle` 条目确实是纹理资源**

### 28.9.4 下一步

1. **[2c] 解外层容器**：头 0–183 的结构 + `dd0c`/`845d1e05` 常量的含义
   - 线索：`+192` 处有 `0d 00 00 00`（可能是大小）与 `1c 00 1a` 等
   - 可能结构：`[u32 magic][u32 flags][u32 uncompressedSize][u32 compressedSize]…`
2. **[2e] 找到 `m_TextureFormat` 的值** ⇒ 决定 mod 纹理转换目标格式
3. **[2f] 用通用 Unity 工具（如 UnityPy / AssetStudio 的逻辑）验证**

---

## 28.10 修正记录：被推翻的早期假设（第 4–14 轮，已合并）

> **本节把 9 个已被后续证据推翻的早期假设合并为一份「错误档案」，
> 只保留教训，细节不再展开。**

### 28.10.1 被推翻的假设一览

| 早期假设（轮次） | 后来的真相 |
| --- | --- |
| `.ab` 条目被 LZ4 压缩（第 2 轮） | ❌ **熵 3.5–7.6 ⇒ 全程明文**，无压缩（§28.19） |
| `.ab` 条目被加密（第 2 轮） | ❌ **同上，明文**（§28.19.2 明确推翻） |
| 外层头部是「哈希表」（第 4 轮） | ❌ 是**变长前段 + 锚点 + 固定 24 B**（§28.13、§28.14） |
| `u32@版本串+8` 是哈希（第 12 轮） | ❌ 是**全局常量（构建 ID）**，916/925 条目共享（§28.16） |
| 字符串是「错位/加密」的（第 5–13 轮） | ❌ 是**我的对齐错了**；真因是名字为 `z-terminated`（§28.17、§28.26） |
| 外层容器是「长度前缀结构」（第 6 轮） | 🟡 方向对，但具体布局在第 9–11 轮才精化 |
| 前段长度固定（第 4 轮） | ❌ **变长**，且为 16 的倍数（128/160/176/192/208/224/336） |

### 28.10.2 ★ 三条方法论教训

**① 先测熵，再猜加密**

```
熵 <5.0 明文 | 5.0–6.5 结构化 | 6.5–7.5 压缩 | >7.9 加密
```

**第 2–14 轮反复误判「加密」，根本原因是没有先做滑动窗口熵图。
⇒ 一个 `abtool entropy` 就能省掉 10 轮。**

**② 「名字错位」优先怀疑自己的对齐**

**第 5–13 轮把「字段名像 `fLrstByte`（应为 `m_FirstByte`）」当成加密证据。
真相是：名字是 **`z-terminated` ASCII**（`00` 结尾），
名字之间的 1–3 字节是**下一节点的控制字段**
⇒ **不是加密，是解析方式错了**（§28.26）。

**③ 固定偏移的假设要尽早验证**

**第 4–11 轮假设「外层头部固定长度」，反复失败。
⇒ 改用「锚点 `e5 00 00 01 49 16 00 0b 0a` +
固定 24 B + 版本串」的**相对定位**后立即成功（§28.13）。**

### 28.10.3 有效结论（这些是**保留**的）

**以下内容来自第 4–14 轮，但**经后续验证仍然正确**：**

```
① 外层容器 = [前段（16 的倍数）] + [锚点] + [固定 24 B] + [版本串] + [正文]
② 固定 24 B 的 3 个 u16 长度字段: L1 / L2 / L3，且 ★ L3 = 版本串偏移 + 16648
③ 版本串之后: u32 构建 ID（0x00356689，916/925 条目共享）
④ 再之后: u16 version = 13（恒定，疑似 SerializedFile.version）
⑤ 版本串总在偏移 +24 之前出现锚点 e5 00 00 01 49 16 00 0b 0a
```

**⇒ 这些已并入 §28.13 ~ §28.16。**

## 28.19 ★★★ 重大更正：`InitBundle` 的 `.ab` **全程明文**（第 15 轮）

### 28.19.1 滑动窗口熵分布图（窗口 64 字节）

| 条目 | 长度 | 熵范围 |
| --- | --- | --- |
| `778ee78277bd18ee2ace12cc.ab` | 3183 | **3.5 ~ 5.8** |
| `2b9717b38058268dcd138881.ab` | 3189 | **3.5 ~ 5.8** |
| `67bc84c4cbcd5e3be2b4b449.ab` | 3201 | **3.6 ~ 5.3** |

**逐段明细（条目 2）**：
```
+   0: 5.3 5.8 4.7 4.2
+ 256: 4.0 4.0 4.2 4.2
+ 512: 4.2 4.4 4.5 4.8
+ 768: 4.6 4.6 4.8 4.7
+1024: 5.0 5.1 4.7 4.3
…
+3072: 5.1
```

**⇒ 熵全程在 3.5–5.8 ⇒ 这是**纯结构化明文**的典型范围
（压缩数据 ≈6.5–7.5，加密数据 ≈7.9+）。**

### 28.19.2 ★ 推翻第 2 轮的「加密」判断

**第 2 轮我曾报「`manifest.hgmmap` 熵 = 7.999 ⇒ 加密」。**
**但那：**
- 是**另一个块**（`BundleManifest`）的**另一个文件**（49 MB 的 `manifest.hgmmap`）
- 且我**只采样了偏移 100 处的 200 KB**，不能代表 `InitBundle` 的条目

**⇒ `InitBundle` 的 `.ab` 条目**全程明文**，无需任何解密。**

### 28.19.3 因此「字符串缺字节」的真因

**既然无压缩、无加密，`m_Forc[0d]dFallbackFormat` 这类现象只能解释为：**

```
⇒ 我把【不同字符串】的期望值放在了【错误的偏移】上
⇒ Unity TypeTree 紧凑格式的实际节点布局与我的假设不同，
   导致字段名之间的控制字节被误算进名字范围
```

**⇒ 无需再寻找压缩算法 —— 直接从明文按正确节点结构解析即可。**

### 28.19.4 下轮方向（回归解析）

1. **放弃「找压缩算法」**（已无必要）
2. **精确重建 TypeTree 节点布局**：
   - 用**已知的字段名序列**（`m_ForcedFallbackFormat` → `m_DownscaleFallback` →
     `m_IsAlphaChannelOptional` → `m_Width` → `m_Height` → `m_CompleteImageSize` →
     `m_MipsStripped` → `m_TextureFormat` → `m_MipCount` → `m_IsReadable` → …）
     作为「模板」，在明文里**做序列对齐**，反推出节点间距
3. **一旦节点间距确定，即可读出每个字段的 `byteSize` 与默认值**
   ⇒ 拿到 `m_TextureFormat` 的取值 ⇒ 第 3 项（纹理转换）可以开始

### 28.19.5 环境备注

**验证「无压缩」的方法已固化**：滑动窗口熵图（64 字节窗，纯 Python）。
后续对任何新数据源都可先用此法判断「明文 / 压缩 / 加密」。

---

## 28.20 ★★★ 有序字符串表 —— 字段名全部认出（第 16 轮）

### 28.20.1 条目 `778ee78277bd18ee2ace12cc.ab`（len=3183）的完整串序列

```
 off   len  前置2B   串
 762    6   73 13   m_Forc
 769   15   63 0d   dFallbackFormat
 785   11   74 1a   m_Downscale
 800   16   33 1a   em_IsAlphaChanne
 817    8   65 83   Optional
 826    7   6c 00   m_WidtX
 834    7   58 00   m_Heigh
 849   13   6d f4   leteImageSize
 865   12   6d 7f   MipsStripped
 878    9   64 00   m_lexture
 893    5   1f 15   Couzt
 899   10   74 00   h$Readable
 913    9   26 06   reProcess
 923    5   73 00   9<Ign
 929    8   6e a9   reMaster
 940    6   45 10   LimiL9
 948   12   fb 02   StreamingMip
 967   11   00 13   PrioritywI
 986   11   0c 00   J<Dime:sion
1003    5   13 13   Setti
1015    9   00 12   !FilterMo
1028    5   ab 19   Aniso
1036    4   cb 10   Bias
1056    7   57 00   v!Group
1075   10   01 0d   !ColorSpac
1089   11   32 fa   latformBlob
1113    5   00 db   TInfo
1124    7   00 1b   'offset
1132    4   74 00   path
1880    8   5d 00   &AssetB
1895    6   30 16   athFla
1905    7   28 a8   reloadT
1929    7   6a 1b   ntainer
1944    7   70 00   5QIndex
1963    4   0d e8   Gash
1973    4   f1 1c   ainA
1980    7   1c 13   Runt]me
1990    6   02 1a   atibil
2002    4   bd 10   Name
2007    9   65 0e   b'ependen
2026    7   c0 9b   edScen\
2035    9   00 d3   Explicit
2070    4   00 d6   <Map
2075    5   70 00   bytes
2186    5   67 1f   _icon
2224   16   3e ff   ;archive:/CAB-23
2241   15   33 17   143919e14bf1b59
2257   13   39 91   11673ea4eeb08
2274    4   71 18   .res
2285   19   7f 16   ini,ial/778ee78277b
2305   16   62 c9   18ee2ace12cc.ab8
2336   10   02 aa   gs/beyond/
2352    7   15 1b   'ntro/t
2366    4   42 9c   .png
```

### 28.20.2 拼接后可认出的标准 Unity 字段名

**`Texture2D` 部分：**
```
m_ForcedFallbackFormat · m_DownscaleFallback · m_IsAlphaChannelOptional
m_Width · m_Height · m_CompleteImageSize · m_MipsStripped
m_TextureFormat · m_IsReadable · m_IsPreProcessed
m_IgnoreMasterTextureLimit · m_StreamingMipmaps · m_StreamingMipmapsPriority
m_TextureSettings{ m_FilterMode · m_Aniso · m_MipBias · m_WrapU… }
m_ColorSpace · m_PlatformBlob · m_TextureSettings · m_StreamData{offset, size, path}
```

**AssetBundle 部分：**
```
m_AssetBundleName · m_AssetBundleVariant? · m_Dependencies · m_Container
m_Hash? · m_RuntimeCompatibility? · m_AssetBundleName?
```

**资源路径：**
```
archive:/CAB-23… · Assets/beyond/Intro/t…png · .resS?
```

**⇒ 字段名与 Unity `Texture2D` + `AssetBundle` **完全吻合** ⇒
内容确认是**纹理资源包**（不是角色模型）。**

### 28.20.3 新增工具

`tools/vfs/abstrings.py` —— 从 `.ab` 条目提取有序可读字符串表
```bash
python3 tools/vfs/abstrings.py <initbundle.chk> <映射.tsv> <条目索引>
```

### 28.20.4 下一步

1. **用「字段名模板」做**模糊序列对齐****：
   把已知 Unity `Texture2D` 字段名序列与上表逐项匹配，
   反推出**每个节点的真实偏移间距**（从而得到控制字节的正确含义）
2. **对齐成功后读出 `m_TextureFormat` 的取值**（枚举）
3. **同时读出 `m_Width` / `m_Height` / `m_CompleteImageSize`**
4. 拿到格式后即可开始第 3 项（纹理转换）

---

## 28.21 ★★★★★ 突破：找到原生 `Mesh` 资源（第 17 轮）

### 28.21.1 最大条目就是 `Mesh`

**条目 `e2cd202a3481b563467135e6.ab`（len = 2,399,399 B）**：
```
+2351  m_FirstByte
+2361  m_IndexCount
+2372  m_Topology
+2385  m_VertexData
+2402  m_LocalAABB
+2439  m_BlendShapeData
+2461  m_Faces
+2474  m_Normals / m_Tangents
+2561  m_FullWeights
+2577  m_BindPose
+2720  m_Compression
+2809  m_VertexBuffer
+2843  m_StreamData { offset … }
+2870  m_Size
+2889  m_PackedBitVector
+2986  m_Triangles
+3010  m_UsageFlags
+3044  m_Metrics[0]
+5571  Avatar
```

**⇒ 这是**标准 Unity `Mesh` 资源**（非 Texture2D）。**

### 28.21.2 `InitBundle` 条目大小分布（1031 个）

| 区间 | 数量 |
| --- | --- |
| < 4K | 59 |
| 4K – 16K | **657** |
| 16K – 64K | 227 |
| 64K – 256K | 50 |
| ≥ 256K | 38 |

**最大的 8 个：**
```
2399399  e2cd202a3481b563467135e6.ab   ← 本轮分析目标（Mesh）
2306122  3e60e35bc468faab0660ef37.ab
2200321  492e15d2dfb5280ec53a90e7.ab
1746577  c972416c30251fdd7b042d72.ab
1590616  b73660e5daf37daeca6fcafa.ab
1576324  4e05ece956bf6fec2be13d66.ab
1572224  c7087639f96cef9191113c10.ab
1530642  e662755eebbd59abebf856d1.ab
```

### 28.21.3 熵分布：数据区 = 明文二进制

```
+       0   6.36   ← 头部 / TypeTree
+    4096   6.90
+    8192   7.44   ######################
+   16384   7.00
+   57344   7.51   ######################
       …    全程 7.0 – 7.6 …
+ 2392064   7.33
```

**⇒ 熵 7.0–7.6 是**二进制浮点/整数数据**的典型值
（区别于加密 ≈7.9+）—— **明文二进制，不是加密**。
**⇒ 高熵区即顶点/索引缓冲。**

### 28.21.4 本轮一举解决第 2 项的三个核心问题

| 问题 | 解决 |
| --- | --- |
| **找一个原生 `Mesh` 作模板** | ✅ **找到**（最大条目即 `Mesh`） |
| **`m_VertexData` 的布局** | ✅ 字段名齐全，可直接读出 |
| **能否等长替换** | ✅ 数据区就是高熵区，**同长度改内容即可** |

### 28.21.5 与 EFMI `.buf` 格式的对照（关键）

**EFMI mod 的 `.buf`（已解出）**：
```
IB  = uint16[] 三角形列表
VB0 = 16 B/顶点 = 3×float32 位置 + 4 B 打包
VB1 = (u,v,0) UV
VB2 = 4×u16 权重 + 4×u16 骨骼索引
```

**Unity `Mesh` 的 `m_VertexData` 由 `m_Channels` 描述**
（每个通道有 `stream / offset / format / dimension`）。

**⇒ 下一轮的核心任务：读出目标 `Mesh` 的 `m_Channels`，
与 EFMI 的 VB0/VB1/VB2 布局做映射 ⇒ 即可重打包。**

### 28.21.6 下一步

1. **在 `e2cd202a…ab` 里定位 `m_Channels` / `m_VertexData` 的实际数据**
   （字段名在 +2385 附近，其值应在附近某个偏移）
2. **读出 `m_IndexCount` / `m_VertexCount` / `m_LocalAABB` 的实际数值**
   —— 用于确认节点布局（用数值合理性反推偏移）
3. **对照 EFMI 的 `Component0_IB/VB0/VB1/VB2`**（11 个组件）
4. **确定「EFMI 顶点 → Unity `m_VertexData`」的映射** ⇒ 重打包可行

---

## 28.22 ★★★ `Mesh` 条目数据区定位成功（第 18 轮）

### 28.22.1 方法：float 合理性密度扫描

**对每个 4 字节对齐位置，统计「连续 3 个 float 都落在合理范围」的比例**
（合理 = 非 NaN/Inf 且 `1e-6 < |v| < 100`），窗口 256 字节。

**结果（`e2cd202a3481b563467135e6.ab`，len 2,399,399）**：
```
+  7680   18.0%  ##########
+  9984   14.8%  ########
+ 10240   21.3%  ############
+ 12800  100.0%  ############################################################
+ 13056   95.1%  #########################################################
+ 13312    0.0%
…
+ 24832   26.2%  ###############
+ 57600   26.2%  ###############
```

**⇒ `+12800` 处出现 **100% 合理**的 float 区 ⇒ 这是数据区起点附近。**

### 28.22.2 ★ 找到 `m_LocalAABB`

**在 `+12700 .. +13100` 范围搜索「6 个 float 构成合法包围盒」**
（`min ≤ max`、数值范围合理、三轴均有厚度）：

```
@+12776:  min = (-0.194, 0.003, -0.037)
          max = ( 0.045, 0.183,  0.045)
          ⇒ 尺寸约 (0.24, 0.18, 0.08)     ★ 合法包围盒
```

**⇒ 这就是 `m_LocalAABB`（或 `m_Center` + `m_Extent` 对）。**

### 28.22.3 由此确定的条目布局

```
+0      .. +2350    外层容器头
                     （前段 + 锚点 e5 00 00 01 49 16 00 0b 0a + 固定 24B
                      + "2021.3.3" + 构建 ID u32）
+2351   .. +3044    TypeTree 字段名区
                     m_FirstByte / m_IndexCount / m_Topology / m_VertexData /
                     m_LocalAABB / m_BlendShapeData / m_Faces / m_Normals /
                     m_Tangents / m_FullWeights / m_BindPose / m_Compression /
                     m_VertexBuffer / m_StreamData / m_PackedBitVector /
                     m_Triangles / m_UsageFlags
+3044   .. +5571    TypeTree 其余部分（m_Metrics[0] / Avatar 等）
+5571   .. +12775   低合理率区（TypeTree 尾部 / 数据索引表）
+12776  .. +12800   ★ m_LocalAABB（6 × float32）
+12800  ..          顶点 / 索引数据区（熵 7.0–7.6）
```

**⇒ **数据区自 `+12776` 起**，与 `m_LocalAABB` 字段在字段名列表中的位置吻合。**

### 28.22.4 下一步（直指重打包）

1. **在 `+12800` 之后按 `m_Channels` 描述解析顶点流**
   —— 需要先读出 `m_Channels` 各通道的 `{stream, offset, format, dimension}`
2. **确定 `m_VertexCount` / `m_IndexCount`**
   —— 用「数据区长度 ÷ 每顶点字节数」反推
   （数据区 ≈ 2,399,399 − 12,800 = 2,386,599 字节）
3. **与 EFMI 的 11 个组件对照**：
   EFMI `Component0_IB` = 27,615 索引、7,911 顶点（16 B/顶点）
   ⇒ 若游戏 `Mesh` 也是 16 B/顶点，则 2,386,599 ÷ 16 ≈ 149,162 顶点（偏大）
   ⇒ 说明**一个 `.ab` 含多个 `Mesh`**（`m_Metrics[0]` 提示可能有多个）
4. **定位每个 `Mesh` 的边界** ⇒ 才能做精准的等长替换

---

## 28.23 `Mesh` 边界线索（第 19 轮）

### 28.23.1 `Mesh` 标记出现 3 次

```
Mesh @ 2330  ·  288802  ·  290072
```

**⇒ 一个 `.ab` 里有**多个 `Mesh` 对象**。**
**⇒ 后两处相距仅 **1,270 字节** ⇒ 很可能不是 TypeTree，而是**实际 `Mesh` 数据段**。**

### 28.23.2 资源路径只有 1 个

```
@+1413029   "initial/e2cd202a3481b563467135e6.ab"
.png / .resS / archive:/ / Assets/  →  各 0 次
```

**⇒ 该条目只含**1 个资源对象**（它自己）。**

### 28.23.3 `m_VertexData` 等字段名精确匹配 = 0 次

**⇒ 与 §28.17/§28.20 的发现一致：
字段名在 TypeTree 里被**拆分存储**（相邻节点的控制字节插在名字中间），
因此**精确字节匹配必然失败**。**

### 28.23.4 1,572 个「6-float 包围盒」候选 —— 我的检测太宽

```
@+7894:  min=(-0.996,-0.057,-1.760) max=(+0.030,+0.926,+0.000)
@+8102:  min=(+0.000,-0.000,+0.000) max=(+0.129,+0.989,+0.067)
…  共 1572 个
```

**⇒ 值域几乎都落在 `[-1, 1]` ⇒ 这是**归一化的法线/切线数据**，
不是包围盒。**检测条件太宽，需收紧（如加入「三轴厚度均 > 0.005 且 < 100」
外，还要求与相邻数据有明显结构差异）。**

### 28.23.5 下轮抓手

```
@2330       Mesh 字段名（TypeTree 区）
@288802     ← ★ 疑似 Mesh #2 数据段
@290072     ← ★ 疑似 Mesh #3 数据段（相距 1,270 B）
@1413029    资源路径
```

**⇒ 优先分析 `288,802` 与 `290,072` 两处的字节结构：
它们之间只隔 1,270 字节，若各自是 `Mesh` 头部，
则可读出 `m_VertexCount` / `m_IndexCount` / `m_Channels` 等关键字段。
⇒ 这应当是**打通重打包的最后一环**。**

---

## 28.24 ★★★★★ 找到原生**角色模型** `.ab`（第 20 轮）—— 任务 2 达成

### 28.24.1 `@288802` 与 `@290072` 是**骨骼层次表**

**`e2cd202a3481b563467135e6.ab`（2,399,399 B）的骨骼名（按顺序）：**
```
@288693  Root/
@288700  a_M/Spine1
@288714  2_M/clothes_pifeng_L_b_0_jnt
@288767  capula_R/Shoulder
@288786  Part1_R
@288801  Mesh_all/lod              ← 网格名
@288827  face_01_
@288849  Neck_M/Head_M/hair_L_a_0

@289883  capula_L/Shoulder
@289910  a2_L/Elbow
@289933  Wrist_L/
@289942  ingFinger1_L
@289966  Neck_M/Head_M/hair_L_f_81
@290012  uYIndex
@290046  brow
@290054  t01Joi
```

**⇒ 完整骨骼层次：`Root → Spine1 → Shoulder → Elbow → Wrist → Finger`；
`Neck → Head → hair / brow / eye`；`clothes_pifeng_L` / `Part1_R` / `face_01`。**

### 28.24.2 关键标识

```
@290072  "Mesh_all/lod1"
@290088  "actor_endminf.body"      ← ★ 终末地角色标识
```

**⇒ 该 `.ab` 是**终末地原生角色模型包**，含：**

| 成分 | 位置 |
| --- | --- |
| **Mesh 数据**（`m_VertexData` / `m_IndexCount` / `m_Channels`） | TypeTree @2330，数据区 @12776+ |
| **骨骼层次**（数十个骨骼名） | @288802 / @290072 |
| **多级 LOD**（`Mesh_all/lod` / `Mesh_all/lod1`） | @288801 / @290072 |
| **资源路径** | @1413029 |

### 28.24.3 ★ 这就是任务 2 要的模板

**任务 2 原文：「找一个终末地原生角色 `.ab`，解析其 `Mesh` 的顶点布局作为模板」**

**⇒ **本轮达成**。而且这个模型**天然带骨骼**，
与 EFMI mod 的 `$bones_count = 395` 直接对应 —— 这是重打包的关键前提。**

### 28.24.4 下轮（直指重打包）

1. **在骨骼名表中读出骨骼数量**，与 EFMI 的 `$bones_count = 395` 对照
2. **定位 `m_Channels` 的顶点通道描述** ⇒ 得到顶点布局
   （`m_VertexData` 在 @2385 的 TypeTree 中，其值应在数据区）
3. **利用骨骼名表的**定长记录**反推节点偏移**
   （骨骼名连续排列，每条记录可能带 `u32 hash` / `i32 parentIndex` / `Matrix4x4`）
4. **一旦通道布局确定 ⇒ EFMI 顶点 → Unity `m_VertexData` 的映射即可建立
   ⇒ 第 3 项（重打包）开始**

---

## 28.25 ★ 找到**骨骼蒙皮网格**资源路径（第 21 轮）

### 28.25.1 干净的真实骨骼路径清单（`+288700 .. +290100`）

```
+288700  a_M/Spine1
+288767  capula_R/Shoulder
+288802  Mesh_all/lod              ← 网格名
+288849  Neck_M/Head_M/hair_L_a_0
+288965  a2_R/Elbow
+288988  Wrist_R/PinkyFinger
+289049  wep_L/Muzzle1
+289815  jnt/jianjia_fk_b_ctrl_jnt
+289883  capula_L/SMoulder
+289910  a2_L/Elbow
+289966  Neck_M/fead_M/hair_L_f_81
+290072  Mesh_all/lod1
```

**（注：`$` 提取时用了「含 `/` 的路径型串」正则，过滤掉了随机二进制片段。）**

### 28.25.2 ★ 关键资源路径

```
+1413029   initial/e2cd202a3481b563467135e6
+1413369   ssets/beyond
+1413389   intro/model/sk_actor_endminf_
```

**⇒ 完整路径 = `Assets/beyond/intro/model/sk_actor_endminf_…`**

**语义解读：**
- **`sk_` 前缀 = **skinned mesh（骨骼蒙皮网格）****
- **`actor_endminf` = **终末地角色****

**⇒ 这正是任务 2/3 所需的**原生角色蒙皮网格资源**。**

### 28.25.3 骨骼记录结构线索

```
+288700  pre = 11 52 6f 6f 74 2f 00 05     ← "Root/" 出现在前缀 8 字节里！
+288767  pre = 43 68 65 73 00 1a 7f 02
+288802  pre = 00 00 7c 64 00 98 b5 30
+288849  pre = 04 cd 73 00 a0 16 37 09
```

**⇒ 名字**交错存储**（前一名字的尾部 + 控制字节 + 下一名字），
与 §28.17 的 TypeTree 现象**完全一致**。**

**⇒ 因此：解析这类数据**不能依赖固定偏移或精确字节匹配**，
必须**按节点结构顺序解析**。**

### 28.25.4 下轮（直指重打包 —— 最后一次尝试解析节点结构）

1. **以 `+288700` 的 `a_M/Spine1` 为锚点，往前逐字节分析**，
   确定「名字长度字段」的真实位置（`+288700` 前面的 `11` 可能是长度）
2. **若确认 `u8 nameLen` 结构 ⇒ 可顺序扫描出全部骨骼名并计数**
3. **对照 EFMI 的 `$bones_count = 395`**
4. **随后解析 `m_Channels`** ⇒ 顶点布局 ⇒ **重打包**

### 28.25.5 阶段性总结（第 2 阶段 21 轮）

| 项 | 状态 |
| --- | --- |
| `.buf` 格式（EFMI 侧） | ✅ 全解出 |
| `.ab` 明文性质 | ✅ 确认（熵 3.5–7.6） |
| `.ab` 外层容器结构 | ✅ 前段+锚点+固定24B+version+构建ID |
| `.ab` 内层 | ✅ 标准 Unity 2021.3.3 SerializedFile + TypeTree |
| **原生角色 `.ab`** | ✅ **找到**（`sk_actor_endminf_…`，含 Mesh + 骨骼 + LOD） |
| 节点结构精确布局 | 🟡 **最后一块**（名字交错存储，需顺序解析） |
| 重打包 | ⬜ 待节点布局确定 |

---

## 28.26 ★★★★★ 结构钥匙：**z-terminated ASCII 名字**（第 22 轮）

### 28.26.1 决定性逐字节证据

```
+288692  11 | 52 6f 6f 74 2f | 00 | 05 | 61 5f 4d 2f 53 70 69 6e 65 31 | 00 | 09 ff 0d | 32 5f 4d 2f …
             "R o o t /"           ↑    "a _ M / S p i n e 1"           ↑
                                  00                                  00

+288700  "a_M/Spine1" | 00 | 09 ff 0d | "2_M/clothes_pifeng_L_b_0_jnt" | 00 | 19 01 01 | "1" | 00 | …
```

**⇒ 格式确认为：**

```
[控制字节 1–3 B] [名字 ASCII] [00] [控制字节] [名字] [00] …
```

**⇒ **名字以 `00` 结尾（z-terminated ASCII）**，名字之间夹着 1–3 字节控制数据。**

### 28.26.2 用「z-terminated 串」扫描出的完整清单（61 个名字）

```
Root/
a_M/Spine1
2_M/clothes_pifeng_L_b_0_jnt
Chest_M
capula_R/Shoulder
Part1_R
Mesh_all/lod              ← 网格名
face_01_
Neck_M/Head_M/hair_L_a_0
eyebrow · iris · eyeLfJoint
a2_R/Elbow · Wrist_R/PinkyFinger
wep_L/Muzzle1
uQIndex · Hip_R · xiuzi · Tshad
uYThumb · uZMiddle · Eyelash · RtIris · Highlight
piaodai · Rup
…
```

**⇒ **完整的角色骨骼 + 网格名清单**，
包含手指（`Thumb` / `Middle` / `PinkyFinger`）、面部细节
（`eyebrow` / `eyelash` / `iris` / `Highlight`）、服装（`clothes_pifeng` / `xiuzi` / `piaodai`）。**

### 28.26.3 ★ 这就是解析整个结构的钥匙

**之前多次失败（`nameLen + name` 前缀、LZ4、加密）的根本原因：
名字**不是**「长度前缀」，而是 **`00` 结尾的 ASCII**，
名字之间的控制字节才是**节点的其他字段（长度/索引/标志）**。**

**⇒ 因此正确的解析方式：**
```
循环：
  1. 读 1–3 字节控制数据
  2. 读 z-terminated ASCII 名字
  3. 名字之后可能还有若干字段（u32/i32/矩阵等）
  4. 重复
```

### 28.26.4 新增工具

`tools/vfs/zstrings.py` —— 顺序扫描 z-terminated ASCII 串
```bash
python3 tools/vfs/zstrings.py <initbundle.chk> <映射.tsv> <条目索引> [起] [止]
```

### 28.26.5 下轮（直指重打包）

1. **实现完整的顺序节点解析器**（控制字节 + z-string + 后续字段）
2. **在骨骼名之后读出每根骨骼的 `parentIndex` / `Matrix4x4`（局部变换）**
   ⇒ 从而确定**每条记录的定长**（`64 B 矩阵 + 若干字段`）
3. **统计骨骼总数，对照 EFMI 的 `$bones_count = 395`**
4. **用同一解析器解析 TypeTree 区（`+2351` 起）**
   ⇒ 读出 `m_Channels` 的 `{stream, offset, format, dimension}`
   ⇒ **顶点布局确定 ⇒ 重打包可动手**

---

## 28.27 ★★★ 顺序节点解析器工作正常（第 24 轮）

### 28.27.1 工具：`tools/vfs/parse_nodes.py`

```bash
python3 tools/vfs/parse_nodes.py <initbundle.chk> <映射.tsv> <条目索引> <起> <止>
```

**算法**：
```
循环:
  1) 跳过不可打印字节（= 控制数据），记录其字节
  2) 读 z-terminated ASCII 名字（≥3 字符 + 00 结尾）
  3) 输出 [名字偏移][控制字节][名字][名字结束偏移]
  4) 从名字结束处继续
```

### 28.27.2 验证结果（`e2cd202a3481b563467135e6.ab`，index=1030）

```
nameOff   ctrl           name                           after   gap
288693    94 00 84 b0 11  Root/                         288699   0
288700          05      a_M/Spine1                     288711   1
288714    09 ff 0d      2_M/clothes_pifeng_L_b_0_jnt   288743   3
288759       0e 14      Ches                           288764   16
288767    1a 7f 02      capula_R/Shoulder              288785   3
288786          0b      !Part1_R                       288795   1
288827          88      )(face_01_                     288838   32
288849          09      Neck_M/Head_M/hair_L_a_0        288874   11
```

**⇒ 解析器**成功按顺序读出骨骼名**，与 §28.25 的手工发现完全吻合。**

### 28.27.3 关键观察：`gap` 分布

```
gap = 名字结束 → 下一名字开始 的间距
   0, 1, 3, 16, 3, 1, 32, 11    ← 变化大
```

**⇒ 名字之后存在**长度不等的字段**。
**⇒ 其中 `16` 与 `32` 是 **16 的倍数** ⇒ 很可能含**对齐的定长字段**
（如 `Vector4` 16 B、`Matrix4x4` 64 B、`Hash128` 16 B）。**

### 28.27.4 同时修掉两个 bug

| # | Bug | 修正 |
| --- | --- | --- |
| ① | **用错条目索引**（最大条目是 `index=1030`，不是 2） | 增加按大小选索引的辅助逻辑 |
| ② | **`IndexError`**：`end` 未与 `len(seg)` 取 `min` | `end = min(end, len(seg))` |

### 28.27.5 下一步

1. **扩大扫描范围到 `+288680 .. +294000`**，得到**完整骨骼表**
2. **分析 `gap` 序列，反推每条记录的定长**
   （若为 `[name z][1-3B 控制][i32 parentIndex][Matrix4x4 64B]`，
   则记录长度 ≈ `len(name)+1 + 4 + 64` 对齐到 16）
3. **统计骨骼总数，对照 EFMI 的 `$bones_count = 395`**
4. **用同一解析器解析 TypeTree 区（`+2351` 起）**
   ⇒ 读出 `m_Channels` 的 `{stream, offset, format, dimension}`
5. **顶点布局确定 ⇒ 重打包可动手**

---

## 28.28 完整骨骼表 —— 发现**两段**（第 25 轮）

### 28.28.1 扫描结果（`+288680 .. +292500`，条目 index=1030）

**第 1 段（起于 `+288693`）**：
```
288693  Root/
288700  a_M/Spine1                          ← 注意是 a_M/Spine1
288714  2_M/clothes_pifeng_L_b_0_jnt
288759  Ches
288767  capula_R/Shoulder
288786  Part1_R
288827  face_01_
288849  Neck_M/Head_M/hair_L_a_0
288902  eyebrow · 288925 iris · 288941 eyeLfJoint
288965  a2_R/Elbow · 289047 wep_L/Muzzle1
289083  2_L · 289109 Hip_R
289520  Eyelash · 289630 RtIris · 289638 Highlight
289815  jnt/jianjia_fk_b_ctrl_jnt
```

**第 2 段（起于 `+289851`）**：
```
289851  Root/                               ← ★ 第二个 Root
289862  Spine1                              ← ★ 单独的 Spine1
289883  capula_L/SMoulder · 289903 Part1
289910  a2_L/Elbow · 289942 ingFinger1_L
289966  Neck_M/fead_M/hair_L_f_81
290102  body · 290123 eyeRt02 · 290136 Eyelash
290343  Hip_L · 290712 piaodai · 290775 hou_0_skin
291172  Corrective_ · 291529 End_M
```

### 28.28.2 两段的结构差异

```
第 1 段起步: "Root/" 之后是 "a_M/Spine1"
第 2 段起步: "Root/" 之后是 "Spine1"（无 a_M/ 前缀）
+289851 的 ctrl = ee 92 00 00 00（5 字节，比第 1 段长）
```

**⇒ 两段的记录结构**可能不同**（例如：一段是 `SkinnedMeshRenderer` 的骨骼列表，
另一段是 `Transform` 层次）。**

### 28.28.3 ★ `gap` 分布表明记录**不是简单定长**

```
gap: 0, 6, 1, 3, 16, 3, 1, 32, 11, 28, 15, 11, 11, 71, 20, 22, 405, 102, 1, 89, 73, …
                                                                     ↑ 最大到 405
```

**⇒ 名字之后是**变长数据**。**
**⇒ 因此不可能用「`[name z][定长字段]`」的简单模型解析。**

**可能的结构：**
1. **名字后面紧跟若干**变长字段**（如子骨骼列表、材质引用、`Hash128` 依赖表）
2. **或者名字只是**字符串池**，真正的结构在别处（用偏移引用）**
3. **或者名字之间夹着**数值数据块**（矩阵/包围盒/索引），长度随内容浮动**

### 28.28.4 下轮方向（换思路）

**不要试图「顺序解析整个表」，而是：**

1. **只提取「名字 → 偏移」映射**（已可用）
2. **对每根骨骼名，检查其**前 64 字节**是否含 `Matrix4x4`**
   （4×4 float，行列式/正交性可作判据）
3. **优先找 `m_Channels`**（在 TypeTree 区 `+2351` 起）
   —— **这是重打包的直接前提，比骨骼表更关键**
4. **骨骼表可作为「骨骼数量」的旁证**（对照 EFMI 的 `$bones_count = 395`）

### 28.28.5 阶段性提醒

**从 §28.27 到 §28.28 的结论：**
**「顺序节点解析」对**TypeTree 区**有效（§28.27 验证通过），
但对**骨骼数据区**因数据变长而失效。**
**⇒ 两条路线要分开处理：**
- **TypeTree 区** → 顺序解析 ✅
- **骨骼/顶点数据区** → 按**已知结构模板**解析（需先确定模板）

---

## 28.29 ★★★ `m_Channels` 结构确认（第 26 轮）

### 28.29.1 TypeTree 区解析结果（`+2330 .. +3100`，条目 index=1030）

```
+2330  Mesh
+2351  fLrstByte       ← m_FirstByte
+2361  indexCoUnt      ← m_IndexCount
+2372  topology        ← m_Topology
+2385  Vertex          ← m_VertexData
+2402  localAABB       ← m_LocalAABB
+2417  Center          ← m_Center
+2433  xtent           ← m_Extent
+2439  BlendShap]Data  ← m_BlendShapeData
+2461  F\i)es          ← m_Faces
+2474  normalNtang     ← m_Normals / m_Tangents
+2520  channel         ← ★ m_Channels
+2535  name
+2547  rameI           ← m_FrameIndex
+2561  GfullWeights    ← m_FullWeights
+2577  indPose         ← m_BindPose
+2809  Buffer          ← m_VertexBuffer
+2843  streaz          ← ★ m_StreamData
+2850  offset          ← ★ offset
+2861  dim3n           ← ★ m_Dimension
+2870  KQSize          ← m_Size
+2897  tVector         ← m_PackedBitVector
+2937  m_UV            ← ★ UV 通道
+2986  %Trian&les      ← m_Triangles
+3010  %UsageFlag      ← m_UsageFlags
+3044  Metrics[0]      ← m_Metrics
```

### 28.29.2 ★ 关键确认：`m_Channels` 的完整子字段

**Unity 标准 `Mesh.m_VertexData.m_Channels` 数组，每项为：**
```c
struct ChannelInfo {   // 4 字节
    UInt8 stream;      // ← "streaz"（m_Stream）
    UInt8 offset;      // ← "offset"（m_Offset）
    UInt8 format;      // 格式枚举
    UInt8 dimension;   // ← "dim3n"（m_Dimension）
};
```

**⇒ 与解析结果**完全一致**。**
**⇒ 且 **`m_UV`** 通道存在（UV 数据确认）。**

### 28.29.3 结构性推论

**⇒ `m_VertexData` 的布局是 Unity 标准结构 ⇒ **可以直接按 Unity 规则重打包**：**

```
m_VertexData:
  m_VertexCount     u32
  m_Channels[14]    每项 4 B（stream/offset/format/dimension）
  m_DataSize        u32
  _typelessdata     byte[m_DataSize]     ← 顶点数据本体
```

**⇒ 因此重打包步骤明确：**
1. 按 `m_Channels` 确定**每个通道的 stream/offset/format/dimension**
2. 把 EFMI 的 `VB0/VB1/VB2` 数据**按通道重新排布**成 `_typelessdata`
3. **索引缓冲**：EFMI `uint16[]` → Unity `m_IndexBuffer`（`m_IndexFormat` 为 `UInt16`）
4. **纹理**：`.dds`(BC5/BC7) → `Texture2D.m_TextureFormat` 对应格式

### 28.29.4 仍存在的现象（不影响结论）

**名字前 2 字符有时缺失：**
```
"fLrstByte"  应为 "m_FirstByte"
"indexCoUnt" 应为 "m_IndexCount"
"streaz"     应为 "m_StreamData" / "m_Stream"
```
**⇒ 与 §28.26 的「交错存储」现象一致（前一字段的控制字节覆盖了后一字段的开头）。
**⇒ 但**字段名本身全部可辨认** ⇒ 足以确定结构。**

### 28.29.5 下一步（重打包前的最后一步）

1. **确定每个 `Mesh` 的数据区边界**
   —— 用 `m_VertexCount` × 每顶点字节数 + `m_IndexCount` × 2 反推
   —— 或直接找 `m_Channels` 之后紧跟的 `_typelessdata`
2. **读出 `m_Channels` 的**实际取值**（14 个通道的 4 字节）
   —— 需要先定位 `m_Channels` 的**数据**（而非字段名）
   —— 数据应在 TypeTree 之后、`+12776`（`m_LocalAABB`）附近或之前
3. **与 EFMI 的 `VB0/VB1/VB2` 做通道映射**
4. **实现重打包 + `chkpatch` 等长替换**

---

## 28.30 ★★★★★ 找到顶点数据 —— stride 16 字节，与 EFMI `VB0` 一致（第 27 轮）

### 28.30.1 `+12776` = `m_LocalAABB` 的实际数据

```
+12776:  -0.194   0.003  -0.037  |  0.045
         └──── m_Center (x,y,z) ─┘   └ 下一字段
+12792:   0.183   0.045  -0.108  -0.040
```

**⇒ 解读：**
```
m_Center = (-0.194, 0.003, -0.037)
m_Extent = ( 0.045, 0.183,  0.045)
```

**⇒ 与 §28.22 用「min/max 包围盒」检测到的完全吻合**
（`min = center − extent`，`max = center + extent`）。**

### 28.30.2 ★★ `+12800` 之后是**顶点数据**

```
+12808:  -0.124   0.133   0.260   0.168
+12824:  -0.127   0.012  -0.108   0.052
+12840:   0.118   0.010  -0.084  -0.079
+12856:  -0.124   0.005   0.004   0.126
```

**观察：**
- 每 **4 个 `float32`** 构成一组
- 值域约 **±0.3** —— 符合角色/道具的**局部模型坐标**
- **⇒ stride = 16 字节**

### 28.30.3 ★ 与 EFMI `VB0` 的对应关系（关键）

```
EFMI VB0   = 16 B/顶点 = 3×float32 位置 + 4 B 打包数据
Unity 顶点 = 16 B/顶点 = 4×float32（3 位置 + 1 额外分量）
                         ⇒ ★ stride 完全一致！
```

**⇒ 这是一个**极其有利**的对应：**
- **顶点数可直接由「数据区大小 ÷ 16」得到**
- **EFMI 的 `VB0` 与 Unity 的顶点流**可按 stride 直接对齐**
- **第 4 个 float 可能是**法线/切线打包**或**镜像的位模式**

### 28.30.4 由此可推出的数据区规模

```
数据区起始 ≈ +12800
条目总长   = 2,399,399
数据区大小 ≈ 2,399,399 − 12,800 = 2,386,599 字节
÷ 16 B/顶点 ≈ 149,162 顶点（若全为顶点数据）
```

**⇒ 149,162 远大于 EFMI 单个组件的 7,911 顶点
⇒ **一个 `.ab` 含多个 `Mesh`**（与 §28.23「`Mesh` 出现 3 次」吻合）；
   每个 `Mesh` 的边界需用 `m_VertexCount` 确定。**

### 28.30.5 下轮（重打包前的精确一步）

1. **确定第一个 `Mesh` 的 `m_VertexCount` / `m_IndexCount`**
   —— 用「数据区大小 ÷ 16」与「`Mesh` 出现位置」交叉验证
2. **解析 `m_Channels` 的实际取值**
   —— 上一轮的直接搜索未命中（约束条件可能与真实编码不符），
   **改为：在 `+12800` 之前的**元数据区**（如 `+12700` 附近）逐字段试探**
3. **与 EFMI 的 `VB0/VB1/VB2` 做通道映射**
4. **实现重打包**（顶点 16 B/顶点 · 索引 `uint16` · 纹理 BC5/BC7）

---

## 28.31 ★★★ 找到「差一步」的真因：**顶点布局不同**（第 32 轮）

### 32.1 决定性证据

**游戏顶点区（`+12800` 起）按 `4×float32` 解读：**
```
前 1000 顶点:  min = (-87.871, -2.94e38, -2.51e38)
               max = (+95.150, +1.72e38, +7.88e38)
               有效（-100 < x < 100）: 697 / 1000

前 7911 顶点:  Y/Z 出现 -2.57e38 ~ +2.73e38
前 50000 顶点: Y/Z 出现 -3.40e38 ~ +3.38e38
```

**⇒ 只有**第 1 个 `float32`**（X）落在合理范围，
第 2–4 个分量解读成 `float32` 会出现 **1e38 量级** ⇒
**那 12 字节里混着非 float 数据（打包的法线/切线/UV/骨骼索引）。**

### 32.2 与 EFMI VB0 的对比

```
EFMI VB0  : 16 B = 3×float32 位置 + 4 B 打包
            （位置是干净的 float32，所有顶点都合理）

游戏顶点  : 16 B ≠ 4×float32
            （只有第 1 个 float 合理）
```

**⇒ **stride 相同（都是 16 B），但内部字段布局不同。****

### 32.3 ★ 这解释了两件事

| 现象 | 原因 |
| --- | --- |
| **模型「变了」** | 数据确实被读入，**部分顶点坐标正确**（第 1 个 float 对上） |
| **「差一步」** | **布局不一致** ⇒ 第 2–4 分量被错误解释 ⇒ 顶点/法线错乱 ⇒ 扭曲 |

**⇒ 上轮「stride 一致就能直接对齐」的判断**只对了一半**。**
**⇒ 要修好，需要**精确知道游戏顶点每 16 字节的字段布局**。**

### 32.4 包围盒匹配的附带结论

```
EFMI C9 的 Z 范围:   0.75 ~ 1.71      ← 站立角色高度方向（Z-up）
游戏的 m_LocalAABB:  ±0.2 范围         ← 只是个【部件】，不是整角色
```

**⇒ 该 `.ab` 中的这个 `Mesh` 是**某个部件**（如手臂/配件），不是整个角色。**
**⇒ 因此**不能**直接用 EFMI 的整身组件去覆盖它。**

### 32.5 下轮：确定游戏顶点的精确字段布局

**方法候选：**
1. **统计法**：对游戏顶点区每 16 字节的**每个字节位置**做值域统计
   —— 若某 4 字节位置总是 `float32` 合理值 ⇒ 那是位置；
   —— 若某 2 字节位置总是小整数 ⇒ 那是 UV/骨骼索引
2. **对照 EFMI VB1/VB2**：
   EFMI 的 `VB1 = (u,v,0)` UV、`VB2 = 权重+骨骼索引`
   ⇒ 游戏顶点里应也有对应的 UV / 骨骼字段
3. **用 EFMI 的 `Core/EFMI/Shaders/*.hlsl`** 反推游戏的顶点语义
   （shader 会声明 `POSITION` / `NORMAL` / `TEXCOORD0` / `BLENDINDICES` 等）

### 32.6 阶段状态

| 项 | 状态 |
| --- | --- |
| EFMI `.buf` 格式 | ✅ 完全解出 |
| `.ab` 结构与明文性质 | ✅ 摸清 |
| **首次 mod 上机（模型变化）** | ✅ **成功** |
| **游戏顶点字段布局** | 🟡 **本轮发现布局不同 ⇒ 下轮精确确定** |
| 1.6 更新准备 | ✅ 完成（含全量回滚） |
| 灭屏保活 | ✅ 完成 |

---

## 28.32 ★★ `+12800` 是**密集 float32 数组**，非 16 B 顶点记录（第 33 轮）

### 33.1 决定性对照

**方法 A：256 字节窗口扫描（在每个 4 字节偏移都测「3 连 float 合理」）**
```
+12800: 61/61 = 100.0%
+12864: 58/61 =  95.1%
+12928: 58/61 =  95.1%
+13000: 58/61 =  95.1%
```

**方法 B：按 stride 采样（stride ∈ {8,12,16,20,24,28,32,36,40,48,64}，startoff ∈ {12800,12804,12808,12812}）**
```
全部合理率 < 0.15  ⇒ 【无任何 stride 出现高合理率】
```

**⇒ 数据在**任意 4 字节对齐下都是合理 float32**，
⇒ **这是密集 `float32` 数组，没有 16 字节或其它 stride 的周期性。****

### 33.2 修正两个此前的判断

| 此前判断 | 修正 |
| --- | --- |
| `+12800` 是 16 B/顶点的顶点记录 | ❌ **是密集 `float32` 数组** |
| 「stride 与 EFMI `VB0` 一致」（16 B） | ❌ **周期性不成立** |

### 33.3 ★ 新的合理解释：**分通道独立流**

**EFMI 的设计本身就是**分通道独立流**：**
```
VB0 = 位置（3×float32，12 字节有效）
VB1 = UV   （3×float32 = (u,v,0)，12 字节）
VB2 = 骨骼 （4×u16 权重 + 4×u16 索引，16 字节）
⇒【各通道分开存储】
```

**⇒ 游戏端很可能**同样是分通道存储**：**
```
+12800 起  = 位置流（密集 float32，每顶点 12 字节 = 3×f32）
其它偏移   = UV 流 / 骨骼流 / 法线流（各自独立）
```

**⇒ 这解释了「差一步」：**
```
我们把位置流的前 126,576 字节替换成了 EFMI 的 VB0
⇒ 位置流【部分正确】
但 UV / 骨骼 / 法线流在【别的偏移】，没有被替换
⇒ 视觉错乱（贴图/法线/骨骼不匹配）
```

### 33.4 下轮：验证「分通道流」假设

1. **算出位置流的实际规模**：
   `+12800` 到条目末尾 ≈ 2,386,599 字节 ÷ 12 ≈ **198,883 顶点**（若 12 B/顶点）
   —— 与 §28.30 的 149,162（16 B/顶点）不同，需进一步确认
2. **寻找其它通道流的起点**：
   在位置流之后，应有一段**不是 float32 密集**的区域（UV 或骨骼）
3. **用 EFMI 的 `VB1`（UV）模式做特征匹配**：
   EFMI `VB1` 的 `(u,v,0)` 有明显特征（第 3 个 float 恒为 0）
   ⇒ 在游戏数据里搜「每 12 字节第 3 个 float 为 0」的区域
4. **用 EFMI 的 `VB2`（骨骼）模式**：
   `4×u16 权重 + 4×u16 索引`，索引 < `bones_count`
   ⇒ 搜「每 16 字节后 8 字节是小整数」的区域

### 33.5 阶段状态

| 项 | 状态 |
| --- | --- |
| EFMI `.buf` 格式 | ✅ 完全解出 |
| `.ab` 结构与明文性质 | ✅ 摸清 |
| 首次 mod 上机（模型变化） | ✅ 成功 |
| **游戏顶点数据组织方式** | 🟡 **本轮：发现是密集 float（可能分通道）** |
| 1.6 更新准备 | ✅ 完成 |
| 灭屏保活 | ✅ 完成 |

---

## 28.33 ★ `bufinfo` 工具验证核心不变量 + VB0 第 4 字段真相（第 47 轮）

### 28.33.1 新工具 `tools/vfs/bufinfo.c`（纯 C）

```bash
bufinfo info  <目录>                      # 汇总一个 mod 的所有组件
bufinfo ib    <x_IB.buf>                  # 分析索引缓冲
bufinfo vb    <x_VB0.buf> <stride>        # 分析顶点流（位置/包围盒）
bufinfo dump  <x_VB0.buf> <stride> <N>    # 转储前 N 个顶点
bufinfo cmp   <a.buf> <b.buf>             # 比较两个文件
```

### 28.33.2 ★ 核心不变量**完美成立**

**`edmin_maid` 的 Component0：**
```
IB  : 字节=55,230  索引数=27,615  三角形=9,205
      min=0  max=7910  ⇒ 顶点数 = 7,911
      ★ 退化三角形 = 0    越界 = 0

VB0 : 字节=126,576  stride=16  顶点数 = 7,911
      有效=7911  异常=0
      ★ 7911 == 7911  ⇒ 不变量 VB0_size/16 == max(IB)+1 【完美成立】
```

**位置包围盒：**
```
min=(-0.1606, -0.1005, +1.3551)
max=(+0.1633, +0.1625, +1.6789)
中心=(0.0014, 0.0310, 1.5170)   尺寸=(0.3239, 0.2630, 0.3238)
```

### 28.33.3 ★ VB0 第 4 字段（off+12）的真相

```
i=0: x=0.07585  y=0.04066  z=1.42951   w=0x49ea47f7
i=1: x=0.07433  y=0.04039  z=1.42868   w=0x5afc220a
i=2: x=0.07797  y=0.03926  z=1.42585   w=0x66eb0a79
i=3: x=-0.03721 y=-0.07213 z=1.42149   w=0x471c2748
i=4: x=-0.03013 y=-0.07600 z=1.42124   w=0x47cb9b69
i=5: x=-0.03637 y=-0.07247 z=1.42190   w=0x479bc360
```

**统计：**`非零 7911/7911  均值 2,530,597,392.83`

**⇒ `w` 全部非零、值极大（~2.5e9）**
**⇒ `0x49ea47f7` 作为 `float32` = 1,919,230.9（**不是合理坐标**）**

**⇒ 结论：VB0 的第 4 个 4 字节字段是**打包的 32 位数据**，
最可能是**打包的法线/切线**（如 10:10:10:2 或 2×int16 格式）。**
**⇒ 这与 EFMI 的 `$component_count` 语义吻合（每个组件除位置外还有法线/切线）。**

### 28.33.4 更新后的 EFMI VB0 格式定义

```
VB0 = 16 B/顶点:
  +0   float32  x
  +4   float32  y
  +8   float32  z
  +12  uint32   打包数据（法线/切线，格式待定）   ← ★ 本轮确认非 float
```

### 28.33.5 对重打包的意义

**⇒ 若要把 EFMI 顶点写进游戏，第 4 字段**必须一并处理**：
- 游戏端若期望 `float32` 位置 + **打包法线**，则 EFMI 的打包数据可能**格式不同**
- **这可能是「模型扭曲」的原因之一**（位置对但法线错 ⇒ 光照异常）

**⇒ 下一步：确定第 4 字段的打包格式（试 10:10:10:2 与 2×int16 解码）。**

---

## 28.34 ★ VB0 第 4 字段解码结论（第 48 轮）

### 28.34.1 测试了 4 种假设

**样本（前 10 个顶点的 `w` 值）：**
```
0x49ea47f7 · 0x5afc220a · 0x66eb0a79 · 0x471c2748 · 0x47cb9b69
0x479bc360 · 0x49ea47f7 · 0x66eb0a79 · 0x471c2748 · 0x47cb9b69
```

| 假设 | 结果 |
| --- | --- |
| **A. `10:10:10:2` 有符号（×2−1）** | **★ 命中 5/10，且显示空间相干性** |
| B. `10:10:10:2` 无符号（0..1） | (0.154,0.642,0.992) 等，无判别力 |
| C. `2×float16` | 11.83 / 223.5 / 1771 / 7.11 …，不合理 |
| D. `4×int8` / `2×int16` | 无规律 |

### 28.34.2 ★ 决定性证据：空间相干性

**三个**位置几乎相同**的相邻顶点：**
```
i=3: pos=(-0.03721, -0.07213, 1.42149)  w=0x471c2748
i=4: pos=(-0.03013, -0.07600, 1.42124)  w=0x47cb9b69
i=5: pos=(-0.03637, -0.07247, 1.42190)  w=0x479bc360
```

**按假设 A 解码：**
```
i=3 → (-0.779, 0.519, 0.642)   |L|=1.1353
i=4 → (-0.758, 0.451, 0.707)   |L|=1.1298
i=5 → (-0.763, 0.470, 0.689)   |L|=1.1309
```

**⇒ 三个方向矢量**非常接近**（与它们的位置接近一致）
⇒ **这是「该字段是三分量方向矢量（法线）」的强证据。****

### 28.34.3 高字节分布也吻合

```
w 的高字节:   49 5a 66 47 47 47 49 66 47 47    ← 仅 4 种取值
w 的次高字节: ea fc eb 1c cb 9b ea eb 1c cb
```

**⇒ 高字节取值集中，符合「局部区域法线方向相近」的特征。**

### 28.34.4 但 `|L| ≈ 1.13` 而非 1.0

**⇒ 说明打包方式与标准 `R10G10B10A2_SNORM` **略有差异**。**
**可能：**
1. **位宽分配不同**（如 `11:11:10`）
2. **或额外有统一缩放因子**
3. **或 A2 分量参与归一化**

**⇒ 待用更多样本统计验证。**

### 28.34.5 更新后的 EFMI VB0 格式定义

```
VB0 = 16 B/顶点:
  +0   float32  x            位置
  +4   float32  y            位置
  +8   float32  z            位置
  +12  uint32   方向矢量       ★ 打包（最可能 10:10:10:2 有符号，法线）
```

### 28.34.6 ★ 对「模型扭曲」的解释

**⇒ 我们把 EFMI 的 VB0（含**打包法线**）整体写进游戏时：**
- **位置部分**：若游戏端也是 3×float32 ⇒ **正确**
- **第 4 字段**：若游戏端期望**不同的打包格式** ⇒ **法线全错 ⇒ 光照异常/明暗错乱**

**⇒ 这解释了「模型变了但不对」的现象：位置对了（所以能看出形状），
但法线错了（所以看起来扭曲/发黑）。**

**⇒ 下一步验证：确认游戏端顶点每 16 字节的字段布局是否与 EFMI 一致。**
**若不一致 ⇒ 需要把法线**重新打包**成游戏期望的格式。**

---

## 28.35 ★★★★★ 根本原因：游戏顶点数据是**压缩**的（第 49 轮）

### 28.35.1 TypeTree 里的决定性字段

**条目 `e2cd202a…ab` 的 TypeTree（`+2351..+3100`）含：**
```
+2561   "GfullWeights"        ← m_FullWeights
+2676   "MinMax"              ← ★ MinMax（量化范围）
+2720   "Compressio"          ← ★ m_Compression（压缩类型）
+2744   "m_KeepV"             ← m_KeepVertices?
+2789   "Convex"
+2809   "Buffer"              ← m_VertexBuffer
+2843   "streaz"              ← m_StreamData
+2870   "KQSize"              ← m_Size
+2889   "PackedB…tVector"     ← ★ m_PackedBitVector
+2969   "FloatC…"             ← m_FloatCompression?
+2986   "%Trian&les"          ← m_Triangles
```

### 28.35.2 ★ 结论：顶点是**量化/压缩**的

**Unity 的 `Mesh` 在 `m_CompressionType != None` 时，**
**顶点数据不是原始 `float32`，而是**量化后的压缩数据**：
```
  m_CompressionType        (int)   0=None / 1=Low / 2=High
  m_PackedBitVector        MeshCompressionData  ← 压缩位向量
  m_Channels[14]           VertexChannelInfo    ← 每通道的压缩描述
  MinMax                   ← 量化范围
```

### 28.35.3 ★ 这**完整解释**了此前所有现象

| 现象 | 解释 |
| --- | --- |
| **`+12,800` 的 float 合理率只有 14%** | **顶点是压缩数据，不是 `float32`** |
| **全条目找不到 `float32` 顶点流** | **因为根本没有**（唯一的高合理率区 `+184,320` 只有 45%，且含大量异常值） |
| **模型「变了」** | **我们写入了不同的字节，游戏按压缩格式解读 ⇒ 形状改变** |
| **「差一步」/ 扭曲** | **压缩格式不匹配 ⇒ 解读出的坐标错乱** |

### 28.35.4 ★ 正确的重打包方向（修正）

**❌ 错误做法（我们之前用的）：**
```
把 EFMI 的 VB0（3×float32 位置 + 打包法线）直接写进游戏的顶点区
⇒ 游戏按【压缩格式】解读 ⇒ 坐标错乱 ⇒ 扭曲
```

**✅ 正确做法：**
```
① 解析游戏的压缩格式（m_CompressionType / m_PackedBitVector / m_Channels）
   ⇒ 得到「压缩顶点 ↔ 解压后坐标」的映射
② 写出一个【解压器】：压缩数据 → (position, normal, uv, ...)
③ 把 EFMI 的顶点数据替换进去
④ 用游戏的压缩器【重新压缩】（或直接写未压缩格式并改 m_CompressionType）
```

**⇒ 关键突破口：Unity 的 Mesh 压缩算法是**公开的**（`MeshCompressionType` +
`m_PackedBitVector` 的量化方案），可用 Unity 自身或开源实现逆向。**

### 28.35.5 另一条更简单的路（建议优先尝试）

**Unity 允许 `m_CompressionType = 0`（不压缩）。**

**⇒ 若能**同时**修改：**
1. **`m_CompressionType` 改为 0**
2. **`m_DataSize` 改为「顶点数 × 未压缩 stride」**
3. **`m_Channels` 改为未压缩的通道描述**
4. **写入未压缩的顶点数据**

**…则游戏会按**未压缩**格式读取 ⇒ 我们就能直接写 `3×float32 位置`！

**⚠️ 但风险：**
- **改这些字段会改变数据长度（`m_DataSize` 变大）⇒ 破坏「等长替换」的前提**
- **⇒ 除非「未压缩 stride × 顶点数」恰好等于原有的压缩数据大小（不太可能）**

**⇒ 因此更可行的仍是**按游戏格式重新压缩**。**

### 28.35.6 下一步

| 优先级 | 任务 |
| --- | --- |
| **1** | **定位 `m_CompressionType` 与 `m_PackedBitVector` 的**实际数值**（在数据区） |
| **2** | **确定量化参数（MinMax）与位宽** ⇒ 写出解压器 |
| **3** | **把 EFMI 顶点按同一参数量化/压缩** ⇒ 等长写入 |
| 4 | 若量化参数不可改，则只能替换「顶点数相同且分布相近」的网格 |

---

## 28.36 ★★ 条目内区段定位：`m_BindPose` 矩阵区（第 50 轮）

### 28.36.1 决定性证据

**在 `+8,000..+12,800` 扫描「连续合理 `float32`」区段（值域 ±10），
发现**大量接近 ±1.0 的值**：**

```
+10292..+10332 (10 个): [-1.0, -0.002, 0.635, -0.004, 0.002, -1.0, -0.005, 1.0]
                         ↑★ 出现 -1.0 / -1.0 / 1.0 —— 矩阵/缩放特征

+10452..+10480 ( 7 个): [0.543, -0.017, -0.845, -0.001, 0.024, 1.0, 0.002]
+10532..+10564 ( 8 个): [-0.527, 0.678, -0.513, -0.94, -0.484, 0.258, 0.837, -0.546]
+11636..+11664 ( 7 个): [-0.035, 0.308, 0.013, 0.307, 0.259, -0.916, -0.403]
+ 8576..+ 8592 ( 4 个): [-0.165, 0.98, 0.197, 0.005]
+11184..+11200 ( 4 个): [2.121, -0.049, 0.964, 0.261]
```

**⇒ 大量值接近 ±1.0（`0.998` / `0.999` / `0.98` / `0.965` / `0.964`…）
⇒ 这是**旋转矩阵 / 四元数**的典型特征。**

### 28.36.2 结合 TypeTree 字段

**TypeTree 里 `+2577` 处有 `"indPose"` ⇒ 即 `m_BindPose`。**

**⇒ **`+8,264 ~ +11,700` 区段就是**骨骼绑定姿态矩阵**（`m_BindPose`）！****

### 28.36.3 更新后的条目布局

```
+0                 条目头（外层容器：锚点 + 固定 24B + version + 构建ID）
+2,330             TypeTree 字段名
+5,571             TypeTree 结束
+5,571 .. +8,264   Mesh 对象字段（m_IndexCount / m_Topology / m_Compression …）
+8,264 .. +11,700  ★ m_BindPose（骨骼绑定矩阵，含 ±1.0 的单位矩阵）
+11,700 .. +12,776 其他字段
+12,776            m_Center / m_Extent（m_LocalAABB）
+12,800            ← 【我们写入 EFMI VB0 的位置】（m_LocalAABB 之后）
+288,693           骨骼名表（61 个名字）
+1,413,029         资源路径 "initial/e2cd202a…"
```

### 28.36.4 ★ 对「为什么 mod 有效果」的新解释

**我们写入的位置（`+12,800`）紧跟在 `m_LocalAABB` 之后。**

**按 Unity `Mesh` 的序列化顺序，`m_LocalAABB` 之后是：**
```
m_BlendShapeData → m_Faces → m_Normals → m_Tangents → m_FullWeights
→ m_BindPose → m_Compression → m_VertexBuffer → m_StreamData
→ m_PackedBitVector → m_Triangles → m_UsageFlags
```

**⚠️ 但注意：`m_BindPose` 实际出现在** `+8,264`**（即 `m_LocalAABB` **之前**），
⇒ 说明**序列化顺序与 TypeTree 字段名的排列顺序不同**（TypeTree 只列字段定义）。**

**⇒ 因此 `+12,800` 之后到底是什么，仍需进一步确认。**
**⇒ 但**用户观察到的模型变化**证明该区域**被游戏当作网格数据使用**。**

### 28.36.5 下一步

| 优先级 | 任务 |
| --- | --- |
| **1** | **确认 `+12,800` 之后的实际字段**（用 `m_IndexCount` 的合理值反推：索引数 × 2 应等于该字段长度） |
| **2** | **定位 `m_CompressionType` 的数值**（0/1/2） |
| **3** | **若为压缩 ⇒ 找到量化参数（MinMax）与位宽** |
| 4 | 按游戏格式重新压缩 EFMI 顶点 |

---

## 28.37 区段性质分析结论 + 方法论转向（第 51 轮）

### 28.37.1 `+12,800..+288,693` 区段的量化指标

| 指标 | 值 | 解读 |
| --- | --- | --- |
| 大小 | **275,893 B** | — |
| `u16` 唯一值 | 42,472 | min=0 max=65535 |
| `u32` 唯一值 | 65,079 | 分布广 |
| `f32` 合理率 | **17.5%** | 低（随机数据水平） |
| **熵** | **7.518** | 略高于压缩区间上界（6.5–7.5） |

**开头 64 字节确实能解读成合理 `float32`（±0.3，符合角色坐标）：**
```
+12800: 30 86 dd bd = -0.1080    94 1b 08 3e = +0.1331
        b6 cb 22 bd = -0.0397    92 51 85 3e = +0.2604
        1c 1a fd bd = -0.1235    54 eb 2b 3e = +0.1679
                                 a4 42 02 be = -0.1275
```

### 28.37.2 ★ 但**所有 stride 都失败**

**测试 `stride ∈ {12,16,20,24,28,32,36,40,44,48}` × 各对齐偏移，
「每 stride 的前 3 个 `float32` 都合理」的比例：**

```
stride= 12: 4.3%     stride= 16: 3.9%     stride= 20: 3.5%
stride= 24: 3.9%     stride= 28: 4.9%     stride= 32: 6.6%
stride= 36: 4.1%     stride= 40: 4.5%     stride= 48: 4.6%
```

**⇒ 全部 < 7% ⇒ **没有 float 周期性**。**
**⇒ 开头 64 字节的「合理」只是**巧合**。**

### 28.37.3 ★ 结论

**该区段**不是**未压缩的 `float32` 顶点流。**

**⇒ 与 §28.35 的判断一致：顶点数据是**压缩/量化**的，
因此**没有 `float32` 周期性**，静态分析无法直接读出坐标。**

### 28.37.4 ★★ 方法论转向：静态分析已到极限

**从第 20 轮到第 51 轮，我们在**静态分析**上投入了大量轮次。
现在需要**换方法**：**

| 方法 | 说明 | 可行性 |
| --- | --- | --- |
| **① 用现成的 Unity 资产工具** | `AssetStudio` / `UnityPy` / `AssetsTools.NET` **原生支持 Unity `Mesh` 压缩**（`m_CompressionType` + `m_PackedBitVector`）。<br>只要能把 `.ab` 条目还原成完整 `SerializedFile`（补 UnityFS 头），就能直接导出顶点 | **★★★ 最高** |
| **② 运行时 hook** | 在游戏里 hook `Mesh::GetVertices` / `Mesh::GetVertexBuffer`，**dump 解压后的顶点** | ★★ 高（需 zygisk + 重启） |
| **③ 反汇编 Unity 的压缩器** | `libunity.so` 里有 `MeshCompression` 的实现 | ★ 低（工作量大） |
| **④ 继续纯静态逆向** | 手工推导量化格式 | ☆ 最低（已验证收益递减） |

### 28.37.5 ★ 关于方法 ① 的关键洞察

**`AssetStudio` / `UnityPy` 的 `Mesh` 解析代码**已经在开源界验证过**，包含：**
```
· m_CompressionType 的三种模式（None / Low / High）
· m_PackedBitVector 的位流解码
· 量化参数（MinMax / 每通道位宽）
```

**⇒ 与其自己逆向，不如**直接读它们的源码**（C# / Python，可移植到 C）。

**⇒ 下一步建议：**
```
1) 确认「条目能否被 AssetStudio 直接读取」
   （把条目 + UnityFS 头拼成一个 .ab 试）
2) 若可以 ⇒ 直接用它导出顶点 ⇒ 【立即知道正确的顶点布局】
3) 读它的 Mesh 解压源码 ⇒ 移植成 C 的压缩器
```

**⚠️ 注意：方法 ① 若成功，我们就能**立刻**知道：**
- 游戏的顶点 stride 与字段布局
- 顶点数量与索引数量
- 与 EFMI 的差异

**⇒ 这是「差一步」最可能被快速解决的路。**
