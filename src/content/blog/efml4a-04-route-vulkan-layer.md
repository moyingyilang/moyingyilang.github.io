---
title: "04 · 路线 A 深挖：Vulkan 隐式层"
description: "EFML4A 研究文档 · 04-route-vulkan-layer（Arknights: Endfield Mod Loader for Android）"
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

> ✅ **本路线已有真机实测结果**：准入条件、环境变量失效、SELinux 标签坑与成功加载证据见 [14-ondevice-layer-proof.md](/blog/efml4a-14-ondevice-layer-proof/)。两者冲突时**以 14 为准**。

> 🎯 **更强的一步**：层已成功进入**真实游戏进程**并稳定运行，见 [15-ingame-layer-proof.md](/blog/efml4a-15-ingame-layer-proof/)。


**定位**：Android 上与 PC 3DMigoto **类比强度最高**的一条路线——同为「图形 API 层拦截 + 顶点/索引资源替换 + shader/顶点签名指纹」，但注入、内存与同步模型完全不同。方法论对照见 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)，路线横向对比见 [07-route-matrix.md](/blog/efml4a-07-route-matrix/)，注入面与准入见 [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)。

**核心事实**（Promon 2026Q3 + Khronos Loader 文档交叉确认）：Android 上 layer 是由系统组件加载进目标进程的 native 共享库；进入后即任意 native 代码，能力**不限于图形**。准则是进程/构建属性（可调试 / userdebug+root / Android 11+ manifest opt-in），不是密码学证明；donor app 自身反而无任何此类要求。

## 1. 层机制
### 1.1 implicit vs explicit
| 类型 | 谁决定启用 | 应用可见性 | Android 情况 |
| --- | --- | --- | --- |
| Explicit layer | 应用在 `vkCreateInstance` 的 `ppEnabledLayerNames` 中请求 | 完全知情 | 应用可控；成品游戏不会请求未知层 |
| Implicit layer | 系统配置/环境决定 | 通常不知情 | 平台 loader 走「属性 + 全局设置 + donor app」自有通道 |

- Khronos 上游 Loader 文档明确写 **Android 上不支持 implicit layer**；Vulkan 指南的 Android 章节描述的是 Android P 起的平台机制（`ro.debuggable=1` 时 loader 扫描 `/data/local/debug/vulkan`，以及 ADB 向 debug 构建推送层）。二者不矛盾：**Android 的 `libvulkan` 是平台分支实现**，引用层加载规则时必须说明是哪一套。implicit 层在桌面还多一条硬约束：**必须提供 `disable_environment`**，使用户能确定性关闭。

### 1.2 loader 如何发现层（三套机制并存）
| 平台 | 发现机制 |
| --- | --- |
| Windows / Linux / macOS | JSON manifest + 搜索路径（`VK_LAYER_PATH`、`VK_ADD_LAYER_PATH`、`VK_IMPLICIT_LAYER_PATH`、`VK_ADD_IMPLICIT_LAYER_PATH`；提权进程下这些变量被忽略） |
| Android | **不使用 manifest**：loader 用一组 "introspection" 函数查询层属性；层枚举位置是 `/data/local/debug/vulkan`，只有被启用调试的应用才能枚举并启用该目录下的层（⚠️ 未核实：introspection 函数的精确符号名） |
| 全平台 | 过滤变量 `VK_LOADER_LAYERS_ENABLE` / `VK_LOADER_LAYERS_DISABLE`（逗号分隔 glob 匹配层名；支持 `~all~`、`~implicit~`、`~explicit~`） |

### 1.3 JSON manifest 字段（桌面开发与打包用）
```json
{ "file_format_version": "1.2.1",
  "layer": { "name": "VK_LAYER_EFML4A_modloader", "type": "GLOBAL",
    "library_path": "./libefml4a_layer.so", "api_version": "1.3.0",
    "implementation_version": "1", "description": "EFML4A research layer",
    "functions": { "vkGetInstanceProcAddr": "efml4a_GetInstanceProcAddr",
                   "vkGetDeviceProcAddr": "efml4a_GetDeviceProcAddr",
                   "vkCreateInstance": "efml4a_CreateInstance",
                   "vkCreateDevice": "efml4a_CreateDevice" },
    "disable_environment": { "EFML4A_DISABLE": "1" } } }
```

| 字段 | 必需性 | 说明 |
| --- | --- | --- |
| `file_format_version` / `layer.name` / `layer.type` | 必需 | 目前最新 `1.2.1`；`type` 为 `INSTANCE`/`GLOBAL`（`DEVICE` 已随 device layer 弃用）；名字须与 `vkCreateInstance` 请求及过滤变量匹配 |
| `layer.library_path` / `api_version` / `implementation_version` / `description` | 必需（桌面） | `.so` 路径与版本元信息；Android 平台 loader 不走 `library_path` |
| `layer.functions` | 必需 | 导出拦截入口（`vkGetInstanceProcAddr`、`vkGetDeviceProcAddr`、`vkCreateInstance`、`vkCreateDevice` 等） |
| `layer.instance_extensions` / `device_extensions`；`enable_environment` / `disable_environment` | 扩展可选；implicit 层 `disable_environment` 必需 | 层自实现扩展会被 loader 聚合进枚举结果；环境变量提供确定性开关 |
| `pre_instance_functions` | 可选（1.1.2+） | 仅 **implicit** 层生效，可拦 `vkEnumerateInstanceExtensionProperties`、`vkEnumerateInstanceLayerProperties`、`vkEnumerateInstanceVersion` |
| `component_layers` / `override_paths` / `blacklisted_layers` / `app_keys` | meta-layer 专用 | 组层与覆盖机制；⚠️ 未核实是否存在 `library_arch` 一类 ABI 区分子段 |

### 1.4 接口协商与 dispatch table
```cpp
extern "C" VK_LAYER_EXPORT VkResult VKAPI_CALL
vkNegotiateLoaderLayerInterfaceVersion(VkNegotiateLayerInterface *pVersionStruct);
```
- `vkNegotiateLayerInterface`（定义于 `vk_layer.h`）携带接口版本号与 `pfnGetInstanceProcAddr` / `pfnGetDeviceProcAddr` /（可选）`pfnGetPhysicalDeviceProcAddr`。⚠️ 未核实：成员确切命名与顺序，以随 SDK 分发的 `vk_layer.h` 为准。
- 两张 dispatch 表：`VkLayerInstanceDispatchTable`（instance / physical device 级）与 `VkLayerDeviceDispatchTable`（device / command buffer / queue 级，由生成代码按 vk.xml 得到）。
- **初始化时机**：instance 表在层的 `vkCreateInstance` 内、device 表在层的 `vkCreateDevice` 内初始化；二者从 loader 塞进创建结构 `pNext` 链的 `VkLayerInstanceCreateInfo` / `VkLayerDeviceCreateInfo`（`function = VK_LAYER_LINK_INFO`）取「下一家」的 `pfnNextGetInstanceProcAddr` / `pfnNextGetDeviceProcAddr`。标准流程：取 chain info → 用下一家 proc-addr 拿真实 `vkCreateInstance` → **先前进 `chain_info->u.pLayerInfo` 一位**（否则下一层拿到本层的链信息）→ 调下家 → 逐个填充本地表（device 侧用 `pfnNextGetInstanceProcAddr(instance, "vkCreateDevice")`）。
- 若层自建 dispatchable 对象（包装或自造），必须用 loader 经 `pNext` 提供的 `vkSetInstanceLoaderData` / `vkSetDeviceLoaderData` 回调（`function = VK_LOADER_DATA_CALLBACK`）初始化其 dispatch 指针；否则对象首字段指向错误位置。合规红线：`vkEnumerateInstanceLayerProperties` 只枚举自己；`vkEnumerateInstanceExtensionProperties` 在 `pLayerName` 为自己时返回自身扩展、否则必须返回 `VK_ERROR_LAYER_NOT_PRESENT`；`vkEnumerateDeviceLayerProperties` 已弃用可省略；`vkGet*ProcAddr` 对被禁用函数必须返回 `NULL`；实现 device 转发时必须拦 `vkGetDeviceProcAddr` 与 `vkCreateDevice`。

### 1.5 chain 转发与对象包装
**转发**：每个拦截函数完成自身逻辑后必须用本层 dispatch 表保存的下家指针调用下去；**不可**直接调用同名 `vk*` 符号（会绕回 trampoline，造成递归或重复链）。**对象关联数据**：*包装*（返回自己的 handle）的风险是遇到未支持的新扩展时下层收到陌生 handle 而崩溃；*哈希表*更安全，但不可用 `VkDevice`/`VkInstance` 作键（同一对象有多个 dispatchable handle），官方建议**用 dispatch 表指针作键**。本项目决策：**一律哈希表，绝不包装对象**——我们只需观察与改写参数。

## 2. 需要拦截的 `vk*` 函数清单（核心）
函数名均取自 Vulkan 核心 API；「组」即层内模块划分。

| 组 | 函数 | 用途 |
| --- | --- | --- |
| A 创建/dispatch | `vkCreateInstance` / `vkDestroyInstance` / `vkGetInstanceProcAddr` / `vkGetDeviceProcAddr` | 初始化与回收 dispatch 表；读 `pApplicationInfo`、`ppEnabledLayerNames`、扩展列表；层导出主入口决定游戏是否绕 loader 直取驱动 |
| A | `vkCreateDevice` / `vkDestroyDevice` | 初始化 device dispatch 表；识别启用扩展（`VK_KHR_dynamic_rendering`、`VK_EXT_vertex_input_dynamic_state` 等） |
| A | `vkEnumerateInstanceLayerProperties` / `vkEnumerateInstanceExtensionProperties` / `vkEnumeratePhysicalDevices` / `vkGetPhysicalDeviceProperties` / `vkGetPhysicalDeviceMemoryProperties` / `vkGetPhysicalDeviceQueueFamilyProperties` | 枚举与过滤（可对自己隐身，pre-instance 拦截需 manifest 声明）；记录设备、内存类型、队列族以支撑替换策略 |
| B pipeline | `vkCreateGraphicsPipelines` / `vkCreateComputePipelines` | **指纹主战场**：shader module、顶点输入状态、拓扑、深度/混合、dynamic state 列表；并记录 compute 变形 / GPU skinning 管线 |
| B | `vkCreatePipelineLayout` / `vkCreatePipelineCache` / `vkGetPipelineCacheData` / `vkMergePipelineCaches` | push constant range 与 set layout 绑定（定位 UBO/SSBO 的依据）；感知 pipeline cache 复用这一识别不稳诱因 |
| B | `vkCmdBindPipeline` | 运行时当前 pipeline → 查指纹表 → 决定本次 draw 是否改写 |
| C shader | `vkCreateShaderModule` / `vkDestroyShaderModule` | 对 `pCode`（SPIR-V word 流）做哈希作指纹主键；可反射提取 binding 号 |
| D 录制/绑定 | `vkCreateCommandPool` / `vkAllocateCommandBuffers` / `vkResetCommandBuffer` / `vkBeginCommandBuffer` / `vkEndCommandBuffer` | 建立 per-command-buffer **shadow state**（Vulkan 无查询 API，必须自跟踪） |
| D | `vkCmdBindVertexBuffers` / `vkCmdBindVertexBuffers2` / `vkCmdBindIndexBuffer` | 记录 vb / ib 绑定与 `VkIndexType` → 替换落点 |
| D | `vkCmdBindDescriptorSets` / `vkCmdPushConstants` | 记录 set / dynamic offset 以定位 UBO/SSBO；push constant 路径的骨骼注入点 |
| D | `vkCmdDraw` / `vkCmdDrawIndexed` | **draw call 识别与改写决策点** |
| D | `vkCmdDrawIndirect` / `vkCmdDrawIndexedIndirect` / `vkCmdDispatch` / `vkCmdDispatchIndirect` | 间接绘制与 compute 路径（参数在 buffer 中，改写更复杂） |
| D | `vkCmdPipelineBarrier` / `vkCmdPipelineBarrier2` / `vkCmdCopyBuffer` | 同步与搬运；前者也是移动端最大性能陷阱（§6.3） |
| E descriptor | `vkCreateDescriptorSetLayout` / `vkCreateDescriptorPool` / `vkAllocateDescriptorSets` / `vkUpdateDescriptorSets` | binding 号 → 类型映射以判断「哪块 buffer 是骨骼常量」；set 分配跟踪；从 `VkDescriptorBufferInfo{buffer, offset, range}` 精确定位候选缓冲 |
| F 内存/buffer | `vkCreateBuffer` | **可追加 usage 位**（如补 `VK_BUFFER_USAGE_TRANSFER_DST_BIT`）——层相对纯 hook 的独有优势 |
| F | `vkGetBufferMemoryRequirements` / `vkAllocateMemory` / `vkBindBufferMemory` / `vkMapMemory` / `vkUnmapMemory` / `vkFlushMappedMemoryRanges` / `vkInvalidateMappedMemoryRanges` | 内存类型与分配；捕获映射指针并维护可见性（非 coherent 内存必需） |
| F | `vkCmdUpdateBuffer` / `vkDestroyBuffer` / `vkFreeMemory` / `vkCreateImage` / `vkCmdCopyBufferToImage` | ≤64 KB 命令流内写入（骨骼常量首选）、生命周期回收、贴图替换（需 layout transition） |
| G submit | `vkGetDeviceQueue` / `vkQueueSubmit` / `vkQueueSubmit2` / `vkAcquireNextImageKHR` / `vkQueuePresentKHR` / `vkCreateSwapchainKHR` / `vkQueueWaitIdle` / `vkDeviceWaitIdle` | 队列与帧边界（TBDR 上很关键）；`vkQueueSubmit` 前是批量改写的最后窗口与 ring buffer 轮转点；等待类函数是资源重建安全点 |

## 3. 顶点 / 索引缓冲替换策略
### 3.1 与 3DMigoto 的概念映射
| PC（D3D11 / 3DMigoto） | Android（Vulkan / EFML4A） |
| --- | --- |
| `IASetVertexBuffers` 的 slot 0 = `vb0` | `vkCmdBindVertexBuffers` 的 `firstBinding + i`；约定 binding 0 视作 `vb0` |
| `IASetIndexBuffer` 的 `ib` | `vkCmdBindIndexBuffer` 的 buffer + `VkIndexType` |
| **直接替换指针/大小**（零拷贝） | **不能换指针**：handle 与 offset 已固化，只能换绑或换 buffer |
| `vb0` 的 stride/format 来自 InputLayout | 来自 `VkPipelineVertexInputStateCreateInfo`（或 dynamic state） |

### 3.2 为什么 Android 上不能直接改指针
1. `VkBuffer` 是不透明 handle，绑定发生在 command buffer **录制期**，游戏代码里没有「当前指针」可改。
2. device-local 内存**通常不可映射**，`vkMapMemory` 可能失败或极慢（取决于 `VkMemoryType.propertyFlags`）；缓冲还可能 in-flight 被 GPU 读取，CPU 直写造成写后读危害。
3. 故必须以「**预置 mod buffer + 正确同步下 copy/bind**」替代「改指针」。

### 3.3 替换实现与内存语义
| 方案 | 做法 | 成本与适用 |
| --- | --- | --- |
| **S1 影子区 + 换 offset（推荐）** | 在同一 device-local buffer 尾部预分配 mod 数据区，一次性 `vkCmdCopyBuffer` 后每帧只改 `vkCmdBindVertexBuffers` 的 `pOffsets`/`pSizes` | 每帧 ≈0 GPU 开销；静态替换（换模型/LOD/加部件） |
| S2 staging + 每帧 copy | host-visible staging → `vkCmdCopyBuffer` → device-local | 每帧一次 DMA（放 render pass 外可接受）；数据每帧变化且不可映射 |
| S3 直写 host-visible | `vkMapMemory` 写 + `vkFlushMappedMemoryRanges` | 最低延迟；UMA 设备（Android 上常见 host-visible 与 device-local 同属一种 memory type） |

> tiling（`VK_IMAGE_TILING_OPTIMAL` / `LINEAR`）**仅作用于 image，buffer 没有 tiling 概念**：vb/ib 替换不涉及 tiling，只有贴图替换才需 tiling + layout transition。故 vb/ib 替换比贴图替换**简单一个数量级**——别被「移动端 tiled GPU」误导，TBDR 的 tile 是**渲染目标**层面的片上 color/depth，不是 buffer 存储布局。

### 3.4 同步与 barrier 的正确做法
```cpp
// ① host 写 → transfer 读
VkMemoryBarrier b1{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
b1.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT;  b1.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_HOST_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,1,&b1,0,nullptr,0,nullptr);
vkCmdCopyBuffer(cb, staging, dst, 1, &region);           // ② staging → device-local
// ③ transfer 写 → 顶点/索引读
VkMemoryBarrier b2{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
b2.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
b2.dstAccessMask = VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT | VK_ACCESS_INDEX_READ_BIT;
vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_VERTEX_INPUT_BIT, 0,1,&b2,0,nullptr,0,nullptr);
```
- **barrier 尽量放在 render pass 之外**，否则 TBDR 被迫 flush/restore tile memory。
- **每帧变化的数据必须用 ring buffer / rolling buffer**：同一 buffer 被帧 N 与 N+1 同时引用时直写会产生 WAR 危害（与 EFMI RollingBuffer 思路一致，见 §5）。目标 buffer 需要 `VK_BUFFER_USAGE_TRANSFER_DST_BIT`；游戏未提供时层可在 `vkCreateBuffer` 阶段追加。

### 3.5 每帧开销量级评估
| 项 | 量级 | 备注 |
| --- | --- | --- |
| 层回调本身（每次 `vk*`） | 数十~数百 ns | 移动 CPU 较弱；热路径需无锁/预分配结构 |
| 换 bind（S1） / 指纹表查询 | 每 draw <1 µs CPU，0 GPU；O(1) 哈希查找 | 可忽略；避免每 draw 加锁 |
| 每帧 memcpy（S3，10k 顶点 × 32 B = 320 KB） | 数十 µs CPU | UMA 上与 GPU 争带宽 |
| 每帧 `vkCmdCopyBuffer`（320 KB） | 数十 µs GPU + barrier 代价 | **TBDR 上 barrier 代价可能远超拷贝本身** |

## 4. draw call 识别
### 4.1 pipeline 指纹构成
```
pipeline_fp = H( 每 stage 的 SPIR-V 哈希(来自 vkCreateShaderModule)
               ‖ stage flags（VERTEX/FRAGMENT/COMPUTE…） ‖ entry point 名 + specialization 常量
               ‖ VkPipelineVertexInputStateCreateInfo:
                   binding {binding, stride, inputRate} ×  attribute {location, binding, format, offset} ×
               ‖ VkPrimitiveTopology ‖ （可选）depth/stencil 与 blend 状态 )
```
- **必须包含顶点输入状态**：同一 shader 常被多种顶点布局复用，只看 SPIR-V 哈希会把「人物模型」与「地形」混为一谈——这正是 3DMigoto 的 ini 同时写 `vb0`、`stride`、`format` 的原因。**顶点签名**则把 `(binding, stride, VkFormat, offset)` 四元组序列单独哈希，得到「顶点布局指纹」，用于快速排除无关 draw。
- **识别流程**：`vkCmdDrawIndexed` → 取 command buffer 的 shadow state → 查 pipeline 指纹表 → 校验顶点签名 → 命中则改写绑定/注入常量 → 转发下家 `CmdDrawIndexed`。

### 4.2 与 PC「哈希狩猎」的对应与差异
| 维度 | PC / D3D11 | Android / Vulkan |
| --- | --- | --- |
| shader 指纹 | DXBC/IL 字节码哈希 | SPIR-V word 流哈希；游戏解密后传入，**层看到的是明文** |
| 顶点布局 / 状态改写 | 独立 InputLayout 对象；可自由改 state 对象 | 编进 pipeline（或 dynamic state）；pipeline **不可变**，只能改「绑定」与「参数」 |
| 运行时查询 / 识别稳定性 | 可查当前 state；稳定性高 | **无查询 API**，必须自建 shadow state；中：pipeline cache 复用、dynamic state、引擎变体干扰 |

## 5. 骨骼矩阵 / shape key 注入
### 5.1 定位与改写（含与 EFMI 的对照）
| 通路 / EFMI 概念 | 定位方法 | 改写方法 |
| --- | --- | --- |
| **push constant** | 拦 `vkCmdPushConstants`，按 `stageFlags`+`offset`+`size` 匹配（骨骼矩阵数组呈现为「矩阵数 × stride」的规律尺寸）；用 `vkCreatePipelineLayout` 的 push constant range 校验 | 改写 `pValues` 副本后转发；**最简单，无内存同步问题** |
| **UBO / SSBO**（对应 MergedSkeleton ConstantBuffer） | 拦 `vkUpdateDescriptorSets`，从 `VkDescriptorBufferInfo{buffer, offset, range}` 得候选；用 set layout 的 binding 号与 SPIR-V 反射交叉确认是骨骼还是材质/相机 | `vkCmdUpdateBuffer`（≤64 KB，需 `TRANSFER_DST`）或 staging + `vkCmdCopyBuffer`；UMA 上可 `vkMapMemory` 直写 |
| **dynamic offset UBO**（对应 RollingBuffer） | 拦 `vkCmdBindDescriptorSets` 的 `pDynamicOffsets` | 改 offset 指向 ring buffer 中的 mod 数据；层需维护「本帧用了哪个 slot」 |
| 直接改游戏常量缓冲内存 | 多数情况**不可行**（device-local + 无映射指针） | 必须在 `vkCreateBuffer`/`vkAllocateMemory` 阶段为可写性铺垫 |

> ⚠️ 未核实：EFMI 的 MergedSkeleton / RollingBuffer 实现细节以 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 的解剖结论为准，本文档只做概念映射。

### 5.2 shape key（blend shape / morph target）
三种可能的游戏侧实现需分别对待：① **额外顶点缓冲**（morph 数据作为第 2/3 个 vertex buffer）→ 在 `vkCmdBindVertexBuffers` 按签名识别并替换/叠加；② **storage buffer + compute**（GPU 变形）→ 在 `vkCmdDispatch` 前后识别并注入；③ **push constant / UBO 中的权重数组**（大小 = blend shape 数）→ 改权重而非几何。⚠️ 未核实：Endfield 是否使用 blend shape 及其数据通路，须在 [11-roadmap.md](/blog/efml4a-11-roadmap/) 的 M0 阶段用层自身的 dump 能力实测。

## 6. 落地难点清单
### 6.1 GPU 厂商差异
| 厂商 | 影响 |
| --- | --- |
| Qualcomm Adreno（骁龙全系） | 内存类型划分与桌面差异大；驱动对非法用法较宽容，容易掩盖层的 bug |
| Arm Mali（天玑 / 部分 Exynos、麒麟） | 典型 TBDR；render pass 内插 barrier/copy 代价显著；Arm 官方 libGPULayers 即为该类场景提供框架 |
| Imagination PowerVR / Samsung Xclipse（RDNA） | 前者传统 TBDR、行为更严格；后者扩展支持面与移动端惯例有差异 |

### 6.2 SPIR-V 与驱动优化
驱动可能重写/内联 SPIR-V；同一 SPIR-V 在不同驱动上产生的实际 pipeline 不同，但**层看到的是游戏传入的原始字节码**，对指纹是好事。游戏可能先解密/解压 shader 再交给 `vkCreateShaderModule`，此处已是明文——与 Promon 报告「GPU 边界上不存在加密」的论断一致。`VkPipelineCache` 复用会让同一 pipeline handle 在不同场景承载不同语义，指纹需「族化」而非一对一。

### 6.3 渲染通道与 tile memory
TBDR 下 color/depth 常驻片上 tile memory；在 render pass 内插 `vkCmdPipelineBarrier` 或 `vkCmdCopyBuffer` 会强制 tile flush/restore，性能可能崩塌。正确做法是把替换所需的拷贝/barrier 安排在 render pass 之前，或用 S1（影子区 + 换 offset）完全避免每帧传输。

### 6.4 工具能力边界
| 工具 | 能做什么 | 限制 |
| --- | --- | --- |
| Android GPU Inspector (AGI) | 系统级 GPU 性能计数、帧剖析、部分帧捕获；需 debuggable 或 userdebug | 依赖其自身层通道；与自定义层共存需处理层链顺序 |
| RenderDoc (Android) / 层自带 dump | RenderDoc 抓 Vulkan 帧、看 pipeline/资源/draw 参数；层自带 dump 在 `vkCreateShaderModule` / `vkCreateGraphicsPipelines` 处自主落盘 | RenderDoc 需可注入条件且与第三方层叠加存在兼容问题（⚠️ 未核实：issue #3001 本环境不可达）；自带 dump 需自行处理路径与性能 |

### 6.5 多进程 / 多 surface 与其它不稳定因素
隐式层会被加载进**每一个** Vulkan 进程（含游戏辅助进程、系统合成器、其它应用），层必须按 `VkApplicationInfo`（`pApplicationName`/`pEngineName`）与进程名自我限定。帧边界不能只依赖 `vkQueuePresentKHR`（可能多 swapchain / 多 surface / 纯离屏）。Unity 侧 SRP Batcher、GPU Instancing、compute 变形会让「一次 draw = 一个模型」的直觉失效；渲染线程与主线程分离也改变状态更新时序。

## 7. 准入与部署（哪些步骤需要 root）
| # | 步骤 | 操作 | 需要 root？ |
| --- | --- | --- | --- |
| 1 | 让目标应用「合格」 | 三选一：应用 `debuggable`；userdebug + root；Android 11+ manifest 自愿 opt-in | **是**（改造**成品**游戏需改 debuggable 评估/属性/设置；或走重打包） |
| 2 | 提供层库（donor app） | 自建普通 APK，把 `libefml4a_layer.so` 放进 `lib/<abi>/` 并安装 | 否（Android 10+ 任意已安装 app 可作 donor，donor 无准入要求） |
| 3 | 全局设置点名 app / 层 / donor | 在系统设置中指定目标包名、层名与 donor | **是**（写 Settings.Global 需 `WRITE_SECURE_SETTINGS`） |
| 4 | 平台属性通道 | `debug.vulkan.layers` 等属性；或把层放入 `/data/local/debug/vulkan` | **是**（改系统属性需 root） |
| 5 | manifest opt-in 通道 | 目标应用 manifest 声明自愿启用层（⚠️ 未核实：meta-data 键名未从官方文档确认，Promon 只描述为 "a manifest flag"） | 否（但需重打包目标应用） |
| 6 | 验证 | `adb logcat` 看 loader 层加载日志；层内自报状态 | 否 |

**开发期不需要 Android 准入**：先用桌面 JSON manifest 在 Linux 上跑通（`VK_LOADER_LAYERS_ENABLE`、`VK_INSTANCE_LAYERS`、`VK_LAYER_PATH`），把层逻辑与游戏准入解耦——这是 [11-roadmap.md](/blog/efml4a-11-roadmap/) 建议的第一步。

## 8. 检测面
| 游戏侧检查 | 层的暴露点 |
| --- | --- |
| 枚举可用层并查异常名字 | 层出现在 `vkEnumerateInstanceLayerProperties` 结果中（若层为 implicit 且 manifest ≥1.1.2，可拦 pre-instance 函数对自己隐身） |
| 检查自身是否被调试 | `ApplicationInfo.FLAG_DEBUGGABLE`、`/proc/self/status` 的 `TracerPid`、进程 dumpable 位——走「让 app 看起来可调试」路线的**必然暴露点** |
| 读系统属性 / 全局设置 | `ro.debuggable=1`、`enable_gpu_debug_layers` 等（普通应用读不到 Settings.Global，但 root 检测与原生代码可读） |
| 检查进程内模块 | `/proc/self/maps` 中出现 donor app 的 `lib/` 路径或可疑匿名可执行映射——层是从 donor 的 APK lib 目录映射进来的，路径特征明显 |
| Root 检测 / 行为检测 | su 路径、Magisk 属性、mount 痕迹、Play Integrity——**先于**任何注入痕迹被发现；顶点数/骨骼数与官方资源不一致也是老问题 |

**对研究项目的含义**：本路线**无法承诺隐身**，且其前提（root/debuggable）比注入痕迹更早暴露。项目应把可检测性当作既定约束（见 [08-threat-model.md](/blog/efml4a-08-threat-model/)），专注能力与工程实现，而非对抗检测。

## 9. 最小层实现骨架
### 9.1 文件划分与关键签名
```
efml4a-layer/
├── CMakeLists.txt                           # libefml4a_layer.so（Android NDK + 桌面双目标）
├── manifest/VkLayer_EFML4A_modloader.json   # 桌面开发用（Android 平台 loader 不读）
├── include/{vk_layer.h, dispatch.h}         # vk_layer.h 随 SDK 分发，勿自行改写
├── src/layer.cpp        # 导出入口：协商、Get*ProcAddr、Create{Instance,Device}
├── src/dispatch.cpp     # 两张 dispatch 表的初始化与 chain 转发工具
├── src/state.cpp        # per-command-buffer shadow state（pipeline/vb/ib/descriptor/push constant 快照）
├── src/signature.cpp    # 指纹：HashSpirv / HashVertexLayout / HashGraphicsPipeline + 指纹表
├── src/replace.cpp      # vb/ib 替换、常量注入、ring buffer
├── src/dump.cpp         # 研发期：把 pipeline/draw 元数据落盘
└── mods/                # JSON mod 规则（见 10-mod-format.md）
```
```cpp
// 导出与协商
extern "C" VK_LAYER_EXPORT VkResult VKAPI_CALL
vkNegotiateLoaderLayerInterfaceVersion(VkNegotiateLayerInterface *pVersionStruct);
extern "C" VK_LAYER_EXPORT PFN_vkVoidFunction VKAPI_CALL
efml4a_GetInstanceProcAddr(VkInstance instance, const char *pName);
extern "C" VK_LAYER_EXPORT PFN_vkVoidFunction VKAPI_CALL
efml4a_GetDeviceProcAddr(VkDevice device, const char *pName);
// 创建期：初始化 dispatch 表 + 收集设备信息
VKAPI_ATTR VkResult VKAPI_CALL efml4a_CreateInstance(
    const VkInstanceCreateInfo *, const VkAllocationCallbacks *, VkInstance *);
VKAPI_ATTR VkResult VKAPI_CALL efml4a_CreateDevice(
    VkPhysicalDevice, const VkDeviceCreateInfo *, const VkAllocationCallbacks *, VkDevice *);
// 拦截入口（replace.cpp）——每个都必须用 dispatch 表的下家指针转发
VKAPI_ATTR void VKAPI_CALL efml4a_CmdBindVertexBuffers(
    VkCommandBuffer, uint32_t first, uint32_t count, const VkBuffer *, const VkDeviceSize *);
VKAPI_ATTR void VKAPI_CALL efml4a_CmdBindIndexBuffer(
    VkCommandBuffer, VkBuffer, VkDeviceSize, VkIndexType);
VKAPI_ATTR void VKAPI_CALL efml4a_CmdPushConstants(
    VkCommandBuffer, VkPipelineLayout, VkShaderStageFlags, uint32_t, uint32_t, const void *);
VKAPI_ATTR void VKAPI_CALL efml4a_CmdDrawIndexed(
    VkCommandBuffer, uint32_t indexCount, uint32_t instanceCount,
    uint32_t firstIndex, int32_t vertexOffset, uint32_t firstInstance);
```
**骨架必须遵守的 6 条**：① 每个拦截函数先做自身逻辑、再用 dispatch 表下家指针转发，**永不**直接调同名符号；② `vkCreateInstance`/`vkCreateDevice` 中务必在下家调用**之前**前移 `chain_info->u.pLayerInfo`；③ 不包装任何对象，一律哈希表（键用 dispatch 表指针 + handle）；④ 指纹表与 mod 规则在 device 创建后一次性加载，热路径只做查表；⑤ barrier/copy 尽量在 render pass 之外，每帧变化数据用 ring buffer；⑥ 层按应用/进程自我限定，默认不作用于非目标进程。

## 10. 评分表与 3DMigoto 类比强度
| 维度 | 评分（1 差 ~ 5 优） | 说明 |
| --- | --- | --- |
| 可行性 / 工程量 | 4 / 2 | 机制真实且有公开研究（Promon）背书，但需完整 dispatch 转发 + shadow state + 指纹 + 替换 + 同步，数万行 C/C++ 量级 |
| 稳定性 / 性能开销 | 4 / 4 | 官方接口、ABI 稳定，但错一处同步即画面损坏或 device lost；逐调用开销可控，真正风险来自 barrier 与每帧传输 |
| 检测风险 | 2 | root/debuggable 前提与 donor 路径都很显眼；无隐身承诺 |
| 对游戏版本变化的鲁棒性 | 4 | 图形 API 与驱动接口稳定；但 pipeline/顶点指纹会随游戏更新漂移，需指纹库维护流程 |

**与 3DMigoto 的类比强度：最接近的对应物（强类比）**

| 3DMigoto（D3D11 / PC） | EFML4A（Vulkan / Android） | 相同 | 不同 |
| --- | --- | --- | --- |
| `dxgi.dll` 代理 + 注入 | Vulkan 隐式层（+ Zygisk 载体） | 都是「系统/加载器把代码放进目标进程」 | PC 可纯用户态免管理员；Android 必须 root 或重打包 |
| InputLayout + shader 哈希做 draw 指纹 | pipeline 指纹（SPIR-V 哈希 + 顶点输入状态） | 指纹狩猎方法论一致 | Vulkan 把顶点布局编进 pipeline，且有 dynamic state 变数 |
| `vb0` / `ib` 指针替换 | 影子区换 offset / 拷贝换绑 | 替换顶点与索引数据 | **不能改指针**，必须走 buffer 语义与同步 |
| ConstantBuffer 注入（MergedSkeleton / RollingBuffer） | push constant 或 UBO + dynamic offset + ring buffer | 注入骨骼/变换 | 内存类型与同步模型完全不同 |
| `.ini` 规则文件 / 单进程单窗口假设 | JSON mod 描述（[10-mod-format.md](/blog/efml4a-10-mod-format/)）/ 多进程多 surface | 声明式规则驱动 | 指纹字段需重设计；层会被加载进所有 Vulkan 进程，必须自我限定 |

**一句话总结**：Vulkan 隐式层是 Android 上唯一能在「图形 API 语义层」与 3DMigoto 对位的东西；但它把 PC 上「免权限的 DLL 代理」换成了「必须有 root 的层准入」，把「改指针」换成了「buffer + 同步」。**能力对得上，成本高一个数量级，准入换了一个维度。**

> ⚠️ 未核实（本文档范围内）：① Android 平台 loader 的 introspection 函数名；② `VkNegotiateLayerInterface` 成员命名与顺序；③ manifest 是否存在 ABI 区分子段；④ Android 11+ manifest opt-in 的 meta-data 键名；⑤ Arm *libGPULayers*（Vulkanised 2025 PDF 与 GitHub 本环境均 403/不可达）中移动 GPU 层实践的具体结论；⑥ RenderDoc issue #3001 中「Android 多层叠加冲突」的具体表现；⑦ Arknights: Endfield 是否使用 blend shape、GPU skinning 与 dynamic vertex state。上述各项落地前须以目标 Android 版本源码、随 SDK 分发的 `vk_layer.h` 与实机实测复核。

## 参考
- Promon, *App Threat Report Q3 2026: GPU debugger abuse in Android apps* — https://promon.io/security-news/app-threat-report-q3-2026-gpu-debugger-abuse-in-android-apps （layer 即进程内任意 native 代码；准入三条件与 donor app；全局设置必须点名应用；三种突破路径）
- Khronos, *Layer Interface to the Loader* — https://vulkan.lunarg.com/doc/view/latest/linux/LoaderLayerInterface.html （Layer Discovery、Android Layer Discovery、manifest 与 introspection、`VK_LOADER_LAYERS_ENABLE`/`VK_LOADER_LAYERS_DISABLE`、pre-instance 函数、dispatch 初始化、包装与哈希表、meta-layer/override）
- Khronos, *Application Interface to Loader* — https://vulkan.lunarg.com/doc/view/latest/linux/LoaderApplicationInterface.html （implicit vs explicit、`disable_environment` 要求、`VK_INSTANCE_LAYERS`、层顺序、device layer 弃用、"No Support For Implicit Layers on Android"）
- Vulkan Documentation Project, *Layers* — https://vulkan.lunarg.com/doc/view/1.4.313.2/windows/antora/guide/latest/layers.html （Android 章节：`ro.debuggable`、`/data/local/debug/vulkan`、ADB 推送层）
- AOSP `Settings.java`：`ENABLE_GPU_DEBUG_LAYERS = "enable_gpu_debug_layers"` — https://android.googlesource.com/platform/frameworks/base/+/eb7f3a60801e31eef0719444c39574d89ac8ed39/core/java/android/provider/Settings.java （仅由检索摘要确认，源码页未抓取成功）
