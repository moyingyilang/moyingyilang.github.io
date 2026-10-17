---
title: "16 · 两个真实 EFMI mod 的对比剖析"
description: "EFML4A 研究文档 · 16-two-real-mods（Arknights: Endfield Mod Loader for Android）"
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


[13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) 剖析了第一个样本。本文加入**第二个样本**并做对比，
目的是把「EFMI mod 到底能表达什么」从单例推断升级为跨样本结论——这直接决定
[10-mod-format.md](/blog/efml4a-10-mod-format/) 的 IR 是否够用。

## 16.1 样本清单

| 项 | 样本 A | 样本 B |
| --- | --- | --- |
| 归档 | `mi_fu_swimsuit151.7z`（53 MB） | `nom_liino_secret_servicev141_max_.rar`（111 MB） |
| 解包后 | ~370 MB → 实际上 A 解出 78 条目 | **370 MB / 117 文件** |
| 顶层目录 | `Mi Fu Swimsuit1.5/` | `NoM_Liino_Secret ServiceV1.4.1(Max)/` |
| `mod.ini` | 27.5 KB | **59.2 KB / 1943 行** |
| 文件构成 | 41 buf + 8 dds + 1 png | **93 buf + 10 dds + 11 png + 1 hlsl + 2 ini** |

## 16.2 两份 `mod.ini` 的常量对比

| 常量 | 样本 A | 样本 B | 说明 |
| --- | --- | --- | --- |
| `required_efmi_version` | 1.45 | 1.43 | 样本 A 是合并骨骼架构升级版 |
| `object_guid` | 235107 | 282153 | 不同目标对象 |
| **`mesh_vertex_count`** | **0** | **335581** | 见 §16.4，**语义完全不同** |
| `component_count` | 11 | **18** | |
| `max_instance_count` | 10 | 8 | |
| **`bones_count`** | 422 | **696** | 均 > 256，因此都需运行时改写顶点格式（见 [13](/blog/efml4a-13-real-mod-analysis/) §13.5） |
| `persist` 变量数 | 4（部件开关） | **19+**（UI 状态 + 菜单值） | 见 §16.5 |

## 16.3 顶点/索引缓冲布局（两样本一致）

这是实现「换模型」最关键的参数，**两个独立样本完全一致**：

| 资源 | `format` | `stride` | 推断 |
| --- | --- | --- | --- |
| `ComponentN_VB0` | `DXGI_FORMAT_R32G32B32_FLOAT` | **16** | POSITION(12) + 4 字节未知（待实测确认） |
| `ComponentN_VB1` | `DXGI_FORMAT_R32G32_FLOAT` | **12** | UV/法线等，8 字节声明 + 4 字节未声明 |
| `ComponentN_VB2` | `DXGI_FORMAT_R16G16B16A16_UNORM` | **16** | 骨骼索引 + 权重 |
| `ComponentN_IB` | `DXGI_FORMAT_R16_UINT` | **6** | 每三角形 3 个 u16；**不是**每索引 6 字节 |

样本 A 的交叉验算（见 [13](/blog/efml4a-13-real-mod-analysis/) §13.5）：VB0 `406080/16 = 25380`、
VB1 `304560/12 = 25380`、VB2 `406080/16 = 25380` —— **三个流解出同一顶点数**，布局推断成立。

> ⚠️ **未核实的核心问题**：以上是 **PC（D3D11）** 的布局。Android 端走 Vulkan，
> Unity 在不同图形后端上**可能使用不同的顶点布局与压缩**。
> 因此**不能假定 Android 的游戏缓冲与此一致**——必须先做运行时侦察（见 §16.8）。

## 16.4 `mesh_vertex_count` 揭示两种截然不同的实现策略

| 样本 | 值 | 含义 |
| --- | --- | --- |
| A | `0` | **全量替换**：顶点缓冲完全由 mod 提供 |
| B | `335581` | **部分覆盖**：mod 知道游戏原来的顶点总数，只注入差分部分 |

样本 B 有 93 个 buf / 18 个组件，且 `mesh_vertex_count` 非零——这与「合并骨骼架构下
只覆盖被改动的顶点/骨骼段」的做法吻合。

**对 EFML4A 的影响**：我们的 IR 目前只有「整块替换」（`MeshReplace.source`），
**缺少「部分覆盖」语义**。这是继 [13](/blog/efml4a-13-real-mod-analysis/) §13.9 之后新发现的第 9 个设计缺口。

## 16.5 样本 B 的 `0/1.ini`：一套完整的游戏内 GUI 框架

`0/` 目录含 11 个 PNG、1 个 HLSL、1 个 ini，实现了一个**鼠标驱动的可拖拽分页 UI**：

| 机制 | 实证 |
| --- | --- |
| 自定义 2D 着色器 | `[CustomShaderElement]`：`vs/ps = draw_2d.hlsl`、`topology = triangle_strip`、`Draw = 4,0`、`o0 = set_viewport bb` |
| 四边形绘制 | `x87/y87/z87/w87 = <宽/高/x/y>` + `ps-t100 = <Resource>` + `run = CustomShaderElement` |
| 鼠标命中检测 | `[KeyClick]` + `key = no_ctrl no_shift alt VK_LBUTTON` + `cursor_x/cursor_y` 与按钮矩形比较 |
| 滑块 | `$value_C = (cursor_x - $barC_pos_x) / ($barC_size_w)`，含 `if <0.05 → 0` / `>0.95 → 1` 吸附 |
| 窗口拖拽 | `$value_x = $value_x + (cursor_x - $last_value_x)` |
| 分页/预设 | `$value_B` 在 `Low/High`、`NormalA/NormalB`、`UltA/UltB` 之间切换 |
| 跨命名空间握手 | `$\nm_LiinoMD1\LiinoMD1_val_1 = $LiinoMD1value_1`，把 UI 值写进 EFMI 命名空间供主 ini 读 |
| 模板化代码生成 | 文件头 `Note space + rename All` 及 `$LiinoMD1button -> $HKbutton` 重命名清单 |

### 但它**不被加载**

实测 `mod.ini` 中 `CustomShaderElement`、`cursor_x`、`VK_LBUTTON`、`draw_2d`、`1.ini`
**命中次数全部为 0**。且 `1.ini` 内出现了别的 mod 的变量名（`$MiFuMD1_value_B`）。

⇒ `0/` 是**作者保留的 UI 模板素材，不是生效代码**。

### 对 Android 的硬约束

这套 UI 完全依赖**鼠标**（`VK_LBUTTON`、`cursor_x/y`）。
手机没有鼠标，因此 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 里那张
「Android 交互映射」表**从优化项变成了加载器必须提供的基础能力**：
EFML4A 需要把 UI 的按钮/滑块翻译成触摸或悬浮窗控件，否则这类 mod 的功能无法使用。

## 16.6 新发现的段落类型（[13](/blog/efml4a-13-real-mod-analysis/) 未覆盖）

| 段落 | 样本 | 作用 |
| --- | --- | --- |
| `[CustomShaderElement]` | B | 声明一个用于 2D 绘制的自定义着色器元素 |
| `[KeyClick]` / `[KeyClick1]` / `[KeyClick2]` | B | 鼠标左/右键的按下与按住语义 |
| `[TextureOverridePosition]` / `[TextureOverridePosition2]` | B | 用 `hash` 检测、以 `time` 计时的**状态机**（`$check_count = time + 3.2`） |
| `[ResourceP]` / `[ResourceN]` | B | 命名约定（Positive/Negative？）—— ⚠️ 未核实 |

其中 `[TextureOverridePosition*]` 用 `time` 做延时状态机，是**时序相关**的拦截，
对 Vulkan 后端的含义是：需要能读到帧/时间并在多帧之间维持状态。

## 16.7 跨样本的一致结论：真实 mod 包里有大量未引用文件

| 样本 | 未引用内容 | 证据 |
| --- | --- | --- |
| A | `modG0/G1/G2.ini` + `MeshesG0/G1/G2/` | `mod.ini` 对 `MeshesG*` 引用次数为 0；G1 与 G2 二进制相同 |
| B | `0/`（11 PNG + 1 HLSL + 1 INI） | `mod.ini` 对所有 UI 原语引用次数为 0 |

⇒ **两个独立样本都出现同类现象**，这不是个例。
`efml validate` 应当报告「存在但未被 IR 引用的文件」——该特性从
[13](/blog/efml4a-13-real-mod-analysis/) 的建议升级为**有跨样本支撑的需求**。

## 16.8 对 EFML4A 的直接要求（汇总）

| # | 要求 | 来源 |
| --- | --- | --- |
| D-9 | IR 需支持**部分顶点覆盖**（不只整块替换） | §16.4 |
| D-10 | IR 需表达 **mod 自绘 UI**（控件、命中区、状态、分页） | §16.5 |
| D-11 | 加载器必须提供**触摸/悬浮窗**交互层替代鼠标 | §16.5 |
| D-12 | 需表达**多帧时序状态机**（`time` 驱动） | §16.6 |
| D-13 | `validate` 需报告未引用文件 | §16.7 |
| D-14 | **必须先做 Android 端运行时侦察**才能假定顶点布局 | §16.3 |

其中 **D-14 是当前唯一的关键路径**：PC 上的布局不能外推到 Android 的 Vulkan 后端。
取得 Android 端真实布局的唯一办法是在游戏进程内拦截并读取绑定状态——
这正是 Zygisk + Vulkan 接管方案要解决的事（见 [15](/blog/efml4a-15-ingame-layer-proof/) §15.7）。

## 16.9 参考

- 两个样本的 `mod.ini` / `0/1.ini` / `Meshes/` / `Textures/`（本地解包产物，**未入库**，见 [08](/blog/efml4a-08-threat-model/) 红线）
- [EFMI-Package](https://github.com/SpectrumQT/EFMI-Package) · [EFMI-Tools](https://github.com/SpectrumQT/EFMI-Tools)
- [13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) —— 第一个样本的详细剖析
