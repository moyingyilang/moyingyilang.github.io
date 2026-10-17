---
title: "40. Unity 压缩 Mesh 格式（`.ab` 顶点数据的真相）"
description: "EFML4A 研究文档 · 40-unity-compressed-mesh（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 本文把 Unity `Mesh` 的**压缩顶点**格式写清楚，
> 对应 `docs/28` §28.35 的发现（游戏顶点是压缩的）。

## 40.1 字段对照：我们的 TypeTree vs Unity 标准

**条目 `e2cd202a…ab` 的 TypeTree 字段名（`docs/28` §28.29）：**
```
+2461   F\i)es            ← m_Faces
+2474   normalNtang       ← m_Normals / m_Tangents
+2520   channel           ← m_Channels
+2561   GfullWeights      ← m_FullWeights
+2577   indPose           ← m_BindPose
+2676   MinMax            ← ★
+2694   Variable          ← ★
+2720   #Compressio       ← m_Compression
+2744   m_KeepV           ← m_KeepVertices
+2789   Convex            ←
+2809   Buffer            ← m_VertexBuffer
+2843   streaz            ← m_StreamData
+2850   offset            ← m_Offset
+2861   dim3n             ← m_Dimension
+2870   KQSize            ← m_Size
+2889   PackedB…tVector   ← ★ m_PackedBitVector
+2897   tVector           ←
+2969   /FloatC           ← m_FloatColors
+2986   %Trian&les        ← m_Triangles
```

**⇒ `m_Compression` / `m_PackedBitVector` / `MinMax` / `m_KeepVertices` /
`m_FloatColors` / `m_Triangles` 全部对应 **Unity 的 `CompressedMesh`**。**

## 40.2 Unity 标准结构（来自 AssetStudio / UnityPy 的公开实现）

### `CompressedMesh`

```csharp
class CompressedMesh {
    PackedFloatVector m_Vertices;      // 顶点位置
    PackedFloatVector m_UV;            // UV
    PackedFloatVector m_Normals;       // 法线
    PackedFloatVector m_Tangents;      // 切线
    PackedIntVector   m_Weights;       // 骨骼权重
    PackedIntVector   m_NormalSigns;   // 法线符号
    PackedIntVector   m_TangentSigns;  // 切线符号
    PackedFloatVector m_FloatColors;   // 顶点色
    PackedIntVector   m_BoneIndices;   // 骨骼索引
    PackedIntVector   m_Triangles;     // 三角形索引
}
```

### `PackedFloatVector`（关键）

```csharp
class PackedFloatVector {
    uint  m_NumItems;   // 元素个数
    float m_Range;      // = 1.0 / (max - min)   量化范围
    float m_Start;      // = min                  量化起点
    int   m_DataSize;   // ★ Unity Array：u32 长度（不是 u8！）
    byte[] m_Data;      // 量化后的定长位流
}
```

**⚠️ 踩坑记录**：我最初把 `m_DataSize` 当成 `u8`，**搜不到任何东西**。
**实际是 `int`（Unity `Array` 的 `u32` 长度前缀）**，修正后立刻命中 269 处。

### `PackedIntVector`

```csharp
class PackedIntVector {
    uint  m_NumItems;
    int   m_DataSize;   // ★ 同样是 u32
    byte[] m_Data;      // 位流
}
```

## 40.3 ★ 量化原理（`PackedFloatVector`）

**存储时：**
```
quantized = round((value - m_Start) * m_Range)
```
**其中 `m_Range = 1.0 / (max - min)`，量化位数由 `m_DataSize` 与 `m_NumItems` 决定：**
```
bitsPerItem = (m_DataSize * 8) / m_NumItems        // 通常 8/16/32
```

**读取时：**
```
value = (quantized / ((1 << bitsPerItem) - 1)) / m_Range + m_Start
```

**⇒ 这就是「顶点不是 `float32`」的原因**：坐标被量化成了 8/16 位的整数位流。****

## 40.4 ★ 对我们的意义（修正重打包方案）

**当前错误做法：**
```
把 EFMI 的 VB0（3×float32 位置，未压缩）直接写进游戏的顶点区
⇒ 游戏按【量化的位流】解读 ⇒ 坐标完全错乱 ⇒ 模型扭曲
```

**正确做法（两条路）：**

### 路 A：按游戏参数量化 EFMI 顶点（推荐）

```
1. 读出游戏的 m_Vertices 的 { m_NumItems, m_Range, m_Start, m_DataSize }
2. 把 EFMI 的顶点位置按同一公式量化:
     q = round((v - m_Start) * m_Range)
   再按 bitsPerItem 打包成位流
3. 用打包后的位流替换 m_Data
   ⇒ 数据长度不变（等长替换仍然成立！）
```

### 路 B：改 `m_Compression` 为 None（不推荐）

```
把 m_Compression 置 0 并写未压缩顶点
⚠ 会改变 m_DataSize / 数据长度 ⇒ 破坏等长替换前提
```

## 40.5 ★ 下一步（可执行）

| 步骤 | 做法 |
| --- | --- |
| **1** | **在条目里定位 `m_Vertices` 的 `PackedFloatVector` 头**（4 个字段：`u32 numItems` + `f32 range` + `f32 start` + `u8 dataSize`） |
| **2** | **验证**：`numItems` 应是顶点数；`range` 与 `start` 应能推出合理的坐标范围 |
| **3** | **解码位流** ⇒ 得到真实顶点坐标 ⇒ 与 `m_Center/m_Extent` 对比验证 |
| **4** | **用同一参数量化 EFMI 顶点** ⇒ 等长替换 |

**判据（第 1 步的搜索）**：
```
numItems ∈ [1000, 200000]
range    ∈ (0, 1e6]      （= 1/(max-min)，通常几百到几千）
start    ∈ [-100, 100]
dataSize = ceil(numItems * bitsPerItem / 8)，bits ∈ {8,16,32}
         ⇒ dataSize / numItems ≈ 1 / 2 / 4
```

## 40.6 工具

**见 `tools/vfs/meshdec.c`** —— 扫描条目、定位 `PackedFloatVector`、解码并导出顶点。


---

## 40.7 实测：条目内搜 `PackedFloatVector`（第 52 轮）

**判据：**
```
numItems ∈ [100, 2e6]
range    ∈ (1e-5, 1e8)
start    ∈ (-10000, 10000)
dataSize = u32，且 (dataSize*8/numItems) ∈ (0.9, 33)
dataSize ≤ 条目剩余长度
```

**结果：命中 269 处。其中 `range` 与我们网格尺度吻合的候选：**

| 偏移 | `numItems` | `range` | `start` | `dataSize` | bits/item | 判读 |
| --- | --- | --- | --- | --- | --- | --- |
| **+111264** | 81,266 | **1.002262** | 0 | 265,473 | 26.13 | 跨度 0.998 |
| **+229958** | 16,384 | **2.000004** | 0 | 10,240 | 5.00 | **跨度 0.5** |
| **+236583** | 4,096 | **2.054699** | 0 | 4,096 | 8.00 | **跨度 0.487** |
| **+233647** | 1,048,704 | 4.224609 | 0 | 1,048,704 | 8.00 | 跨度 0.237 |

**我们的网格 `m_Extent = (0.0455, 0.1829, 0.0445)`：**
```
最大跨度 = 2 × 0.1829 = 0.366   ⇒  range ≈ 1/0.366 = 2.73
⇒ 【range = 2.000004（跨度 0.5）与 2.054699（跨度 0.487）尺度吻合】
```

**⇒ 候选指向 `+229958` / `+236583` 附近。**

### ⚠️ 但仍需收紧判据

**269 处命中里大量是**假阳性**（例如 `range=133632` / `start=0` / `dataSize==numItems`
⇒ 跨度 7.5e-6，不可能是顶点坐标）。**

**⇒ 需要更强的验证：**
```
① numItems 应与 m_IndexCount/m_VertexCount 相关
② range × (max-min) = 1，且 max-min 应与 m_Extent 一致
③ 解码位流后，坐标包围盒应≈ m_Center ± m_Extent
```

**⇒ 这三条的 ③ 是最强判据：**解码后必须能重现 `m_LocalAABB`**。**
