---
title: "44. 第 4 阶段总结：hook 基础设施完全打通 + 图形层定位（第 55–59 轮）"
description: "EFML4A 研究文档 · 44-phase4-final（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 44.1 ★★★★★ 最重要的发现：游戏有反篡改，会还原代码补丁

### 44.1.1 铁证

**hook 安装后立刻读 `/proc/<pid>/mem` 验证目标处字节：**

```
❌ 无看门狗时：a8 6e 1a 39 55 e2 09 d0 80 02 40 f9 …
             ⇒ 【原始代码】⇒ hook 被抹掉
✅ 有看门狗时：50 00 00 58 00 02 1f d6 dc 5e aa d5 76 00 00 00
             ⇒ ldr x16,#8 ; br x16 ⇒ hook 活着

日志： [gles] glCompressedTexImage2D HOOKED
       [gles] 检测到还原，已重装 #N
```

### 44.1.2 ★★★ 这解释了此前【所有】的「0 次调用」

```
· Mesh.get_bounds / get_vertices / SetUVs / get_subMeshCount   → 0 次
· VFSFileReadStream.Read / ValidChunkLength / get_Position     → 0 次
· HGMeshRendererData.GetMeshes                                → 0 次

⇒ 不是「函数冷门」（我反复猜错的方向）
⇒ 而是游戏有代码完整性校验，周期性还原被修改的 .text
   ⇒ 所有 hook 都被【悄悄抹掉】，日志说 HOOKED 但永远 0 次调用
```

### 44.1.3 对策：看门狗（每 200 ms 检查 + 重装）

```c
/* install()：saved_once 守卫，只在第一次保存原始字节
   （重装时不能把我们的跳转当成原始字节存下来） */
static int saved_once=0;
if(!saved_once){ memcpy(g_saved,g_target,16); saved_once=1; ... }

/* waiter()：检查目标处是否为 0x58000050（ldr x16,#8），不是就重装 */
for(long long tick=0; tick<9000; tick++){
  if(!g_hooked) install_once();
  else { uint32_t cur0; memcpy(&cur0,g_target,4);
         if(cur0!=0x58000050u){ g_hooked=0; install_once(); } }
  usleep(200000);
}
```

## 44.2 ★★★★★ 两个致命 crash bug（都已修复）

### 44.2.1 写入未映射页 ⇒ SIGSEGV

```
signal 11 (SIGSEGV) SEGV_MAPERR, fault addr = target 地址
backtrace: #00 /memfd:zygisk-payload   ← 我们的 payload
Process uptime: 4s
```

**根因**：游戏启动仅 4 秒，`libil2cpp.so` 的代码段**尚未完全映射**，
`find_base()` 拿到基址就立刻写跳转 ⇒ 目标页不存在 ⇒ 段错误。

### 44.2.2 ★ `is_mapped` 的实现陷阱

```
❌ 第一版：sscanf 解析 /proc/self/maps ⇒ 误报「未映射」⇒ hook 永不安装
   （保护本身对，只是判据错）
✅ 第二版：mincore() 系统调用（最可靠）

static int is_mapped(unsigned long addr){
  unsigned long pg=(unsigned long)sysconf(_SC_PAGESIZE);
  unsigned long p=addr & ~(pg-1);
  unsigned char vec=0;
  if(mincore((void*)p,pg,&vec)!=0) return 0;
  return 1;
}
```

### 44.2.3 payload 构建必须遵守（反复踩坑）

```
① clang -O2 -fPIC -shared -target aarch64-linux-android24
   -Wl,-rpath,/system/lib64 -llog -ldl -lm -lpthread
   （NDK clang 是 x86-64 ⇒ Exec format error ⇒ 只能用 Termux clang）
② ★ patchelf --remove-rpath     ← 每次新编译的 .so 都会带上 Termux RUNPATH！
③ ★ patchelf --set-soname
④ 必须有 .init_array（constructor）+ 声明 DT_NEEDED
⑤ constructor 早于 libil2cpp 加载 ⇒ 必须线程轮询 /proc/self/maps
⑥ ★ 支持 branch 检测：B/BL/B.cond(0x54)/CBZ(0x34,0x35,0xb4,0xb5)/TBZ(0x36,0x37,0xb6,0xb7)
```

## 44.3 ★★★★ 运行时 hook 的可靠实现（已验证可用）

**目标处最终状态（内存验证）：**
```
50 00 00 58 00 02 1f d6 …
= ldr x16,#8 ; br x16 ; <8 字节绝对地址 = hook_entry>
```

**工作流：**
```
1) find_lib(name)   从 maps 的可执行段反推基址（base = exec_start - exec_offset）
2) find_sym(base,nm) ★ 手写 ELF .dynsym/.dynstr 解析器 ⇒ stripped 库也能定位导出符号
3) is_mapped(sym)   mincore 检查
4) 保存原始 16 字节 + 建 trampoline（原始指令 + 跳回 target+16）
5) 写 16 字节绝对跳转
6) 看门狗每 200ms 检查并重装
```

## 44.4 ★★★★ 图形层的 Hook 点（本阶段最终方向）

### 44.4.1 已排除

| 目标 | RVA | 结果 |
| --- | --- | --- |
| `Texture2D.LoadRawTextureDataImpl(IntPtr,UInt64)` | `0x1a4b2a4c` | ★ hook 成功但**0 次调用** |
| `Texture2D.SetPixelDataImpl` | `0x1a4b2b64` | 序言含 BL ⇒ 不可 hook |
| `Texture2D.SetPixelDataImplArray` | `0x1a4b2aec` | 序言含 B ⇒ 不可 hook |
| `Texture2D.ApplyImpl` | `0x1a4b24ac` | 序言含 B.cond ⇒ 不可 hook |
| `Texture2D.GetRawTextureData` | `0x1a4b3204` | 序言含 TBZ ⇒ 不可 hook |
| `libunity.so` 纹理符号 | — | stripped，347 个 dynsym 全是 Android API => 无法按名 hook |

⇒ **游戏不走 managed API，直接用 native 加载纹理。**

### 44.4.2 ★★★★★ 找到可用 hook 点：GLES 驱动的导出符号

```
libGLESv2_adreno.so（6.2 MB，711 个动态符号，纹理函数全部导出）:
  glCompressedTexImage2D      @ 0x2f3c20   ← ★ BC7 上传必经之路
  glCompressedTexSubImage2D   @ 0x282cb0
  glTexImage2D                @ 0x33dc50
  glTexSubImage2D             @ 0x287c90
```

**签名与 ARM64 寄存器映射：**
```c
void glCompressedTexImage2D(GLenum target, GLint level, GLenum internalformat,
                            GLsizei width, GLsizei height, GLint border,
                            GLsizei imageSize, const void *data);
/* w0=target w1=level w2=internalformat w3=width w4=height
   w5=border w6=imageSize x7=data */
```

**⇒ 识别条件：`width==512 && height==512 && imageSize==262144` ⇒ 把 `x7` 换成 mod 的 BC7 数据！**

**实测安装成功：**
```
[gles] base=0x76a8e06000 glCompressedTexImage2D=0x76a90f9c20
       ⇒ 0x76a8e06000 + 0x2f3c20 = 0x76a90f9c20 ✓ 与符号表一致
[gles] bytes 3f2303d5 nz=15
[gles] glCompressedTexImage2D HOOKED
游戏 pid 2138 未崩溃
```

**⚠️ 截至本阶段：调用次数仍为 0 ⇒ 游戏可能用 Vulkan 而非 GLES 上传纹理。**

### 44.4.3 备选：Vulkan

```
/vendor/lib64/hw/vulkan.adreno.so（5.35 MB，742 个动态符号）
  需确认 vkCmdCopyBufferToImage 是否导出（本阶段 awk 取字段出错，未拿到）
⇒ 纹理上传走 vkCmdCopyBufferToImage（staging buffer → image）
```

## 44.5 ★★★ mod 目标澄清（重要）

```
mod 文件: "Components-5 t=1f4e3bca BC7-sRGB.dds"
  512×512 BC7 (DXGI format 99), 1 mip, 数据 262,144 字节
  ⇒ 数据部分恰是 GPU 原始格式

EFMI 的 Component5 标识（mod.ini）:
  [TextureOverride_EntryPoint_Component5]
    hash = fa04a7b6            ← 索引缓冲 hash
    match_index_count = 16524  ← 索引数量

交叉验证 ComponentN_IB.buf 大小 / 2 == match_index_count: 【8/11 完全匹配】
  Component0: 27615 ✓  Component1: 9000 ✓  Component2: 4524 ✓
  Component4: 1638  ✓  Component6: 117  ✓  Component7: 1386 ✓
  Component8: 90    ✓  Component10: 2286 ✓
  不匹配: Component3(差5130) Component5(差9801) Component9(差72690)
  ⇒ Component5 的 52650 字节 = LOD0(16524) + LOD1(9801)

★ 但我们改的 e2cd202a 的内容是:
  asset 名 : SK_actor_endminf_introAvatar
  路径     : intro/model/sk_actor_endminf_
  骨骼     : eyeLfJoint(左眼), Neck_M/Head_M/hair_L_a_0, Shoulder, Wrist_R/PinkyFinger …
  网格     : Mesh_all/lod, Mesh_all/lod1
  ⇒ 【终末地女管理员 Endministrator】= 玩家角色
  ⇒ 【introAvatar】= 开场/介绍专用 ⇒ 游戏内正常游玩时可能不渲染

InitBundle 只有 3 个角色模型（全部是管理员）:
  sk_actor_endminf_ / sk_actor_endminf_03_ / sk_actor_ui_endminm_01_
  ⇒ 【没有普瑞赛斯】⇒ 她的资源在 Bundle 块
```

## 44.6 ★★ 游戏启动流程观测（fd / maps）

```
只读 InitBundle 阶段（启动早期）:
  VFS/0CE8FA57 (InitBundle)  17 fd   ← 我们的 mod 文件被反复读取
进入资源加载后:
  VFS/7064D8E2 (Bundle)      44 fd   ← ★ 开始读角色资源
  VFS/F151B649 (HotfixAudio)  8 fd
  VFS/24ED34CF (Audio)        4 fd
  VFS/E1E7D7CE (AudioChinese) 2 fd
但始终【未读 BundleManifest(1CDDBF1F)】⇒ XXE1..ctor 未触发 ⇒ 密钥未拿到
```

**Temp 目录（每次启动重新生成，UUID 命名，游戏 mmap 之）：**
```
85e10b84-…  3.7 MB  含 20 条 Assets/ 路径
c24141f3-…  9.1 MB  含 51 条 Assets/ 路径
⇒ 说明 .chk 被解压到 Temp 再 mmap（但文件名无映射关系）
```

**index_main.json / pref_main.json / index_initial.json / pref_initial.json：**
```
全部以 "vJXc2L3hmLbO2tuQ…" 开头
⇒ 【加密】（XXE1/ChaCha20），非明文 JSON ⇒ 需要密钥
```

## 44.7 ★★★★ 新增 C 工具（累计 30 个）

| 工具 | 功能 | 性能 |
| --- | --- | --- |
| `blctool.c` | .blc 解密/dump/find/xfind/head/strs/paths/crc | 32 MB → **0.34 s** |
| `vfslist.c` | 完整解析所有条目（name/offset/len/bt/enc/ivSeed/chunkMD5） | 270,435 条 → **1.26 s** |
| `xxe1.c` | XXE1=ChaCha20 解/加密 | — |
| `bsearch.c` | 二进制模式搜索（分块+跨块） | 217 MB → **2.3 s** |
| `texscan.c` | 扫描 Unity Texture2D 结构 | — |
| `prologue.c` | 批量检查函数序言 + trampoline 安全性 | — |
| `elfinfo.c` | ELF 机器类型 | — |
| `hashtest.c` | 多哈希试匹配 | — |
| `payload-gleshook.c` | ★ hook glCompressedTexImage2D（含手写 ELF dynsym 解析） | — |

**修过的 C 工具 bug：**
```
bsearch.c : fseek(END) 后 start=0 时没 fseek 回开头 ⇒ fread 返回 0（已修）
blcfix.c  : 自动定位常数 0x23 应为 0x19 ⇒ 写错位置（已修）
is_mapped : sscanf 版误报 ⇒ 改 mincore（已修）
```

## 44.8 Python 已彻底清除

```
删 8 个仓库 .py + 17 个 scratch .py
.gitignore 加 *.py / *.pyc / __pycache__
scripts 内联 python3 已替换（build-local.sh → elfinfo.c）
```

## 44.9 当前状态与下一步

**状态：**
```
target.json = libefml4a_gleshook.so（已启用）
游戏运行中（pid 2138），glCompressedTexImage2D hook 已装，未崩溃
调用次数 0 ⇒ 待确认游戏用 GLES 还是 Vulkan 上传纹理
```

**下一步（按优先级）：**
```
[1] 确认游戏用 GLES 还是 Vulkan（看 /proc/pid/maps 里哪个驱动有活跃映射，
    或在 hook 里记录 eglGetProcAddress/vkGetInstanceProcAddr）
[2] 若 Vulkan ⇒ hook vkCmdCopyBufferToImage（先确认 vulkan.adreno.so 导出该符号）
[3] 命中后：把 mod 的 262144 字节 BC7 数据（DDS 去掉 148 字节头）替换进 data
[4] 游戏内验证普瑞赛斯瞳孔变化
```

**合规：** 全程只读 + 等长替换；不改游戏数值/存档、不用于竞技作弊、不散布游戏资源。

---

# 44.10 ★★★★★ 最终突破：Vulkan 纹理上传 hook 完全成功（第 60 轮）

## 44.10.1 找到了真正的纹理上传路径

**`vkCmdCopyBufferToImage` 是 Vulkan 下纹理上传的必经之路（staging buffer → image）。**

```
/vendor/lib64/hw/vulkan.adreno.so（5.35 MB，742 个动态符号）
  _ZN11qglinternal22vkCmdCopyBufferToImageEP17VkCommandBuffer_TP10VkBuffer_TP9VkImage_T13VkImageLayoutjPK17VkBufferImageCopy
  ⇒ 地址 0x172770（C++ 命名空间 qglinternal，需用 mangled 名查找）
```

**签名与 ARM64 寄存器映射：**
```c
void vkCmdCopyBufferToImage(VkCommandBuffer commandBuffer, VkBuffer srcBuffer,
                            VkImage dstImage, VkImageLayout dstImageLayout,
                            uint32_t regionCount, const VkBufferImageCopy* pRegions);
/* x0=cmd x1=srcBuffer x2=dstImage w3=dstLayout w4=regionCount x5=pRegions */
```

## 44.10.2 ★ `VkBufferImageCopy` 的正确布局（踩过坑）

```c
typedef struct VkBufferImageCopy {
    VkDeviceSize             bufferOffset;       // +0   (8)
    uint32_t                 bufferRowLength;    // +8   (4)
    uint32_t                 bufferImageHeight;  // +12  (4)
    VkImageSubresourceLayers imageSubresource;   // +16  (16)
        //   aspectMask(4) mipLevel(4) baseArrayLayer(4) layerCount(4)
    VkOffset3D               imageOffset;        // +32  (12)  x y z
    VkExtent3D               imageExtent;        // +44  (12)  width height depth
};
```

**⚠️ 我第一版把 `imageExtent` 当成 +36 ⇒ 读到的是 `imageOffset.z` / 错位字段**
**⇒ 症状：`ext=0x0x1920`（前两个恒为 0）⇒ 改成 +44/+48/+52 后完全正常**

## 44.10.3 ★★★★★ 验证成功的证据

```
[vk] base=0x76aa276000
     vkCmdCopyBufferToImage=0x76aa3e8770
     ⇒ 0x76aa276000 + 0x172770 = 0x76aa3e8770  ✓ 与符号表完全一致
[vk] bytes 3f2303d5 nz=16
[vk] vkCmdCopyBufferToImage HOOKED
游戏 pid 10329 未崩溃

调用统计（游戏启动早期，40 次）:
  12× 1920x1080x1   ← 屏幕/UI 纹理
   9× 4x4x1
   9× 1x1x1         ← 默认白纹理
   2× 16x16x1
   1× 64x64x1 / 58x58x1 / 4x64x1 / 4x4x16 / 256x64x1 / 256x2x1 / 128x128x1 / 1024x1x1
⇒ 全部是【合理的纹理尺寸】⇒ 参数解读完全正确！
```

## 44.10.4 下一步（mod 加载的最后一步）

```
[1] 用户进入游戏场景（让游戏加载角色纹理）
[2] 日志里出现 ext=512x512x1 ⇒ 就是候选目标（mod 是 512×512 BC7）
[3] 替换数据的方式：
      · VkBuffer 是 GPU 句柄，不能直接写指针
      · 方案 A: hook vkCmdCopyBufferToImage 时，用 vkMapMemory 拿到 staging buffer
                映射地址，覆写 262144 字节（需先拿到 device/allocator）
      · 方案 B: 拦截 vkCreateBuffer/vkBindBufferMemory 记录 buffer→内存映射关系
      · 方案 C: 在 vkQueueSubmit 前用 vkCmdUpdateBuffer 注入
[4] mod 数据 = DDS 去掉 148 字节头 ⇒ 262,144 字节 BC7
```

## 44.10.5 图形 API 判定（结论）

```
游戏【同时】加载 GLES 与 Vulkan 驱动，但:
  · glCompressedTexImage2D  调用 0 次
  · vkCmdCopyBufferToImage  调用 40 次（尺寸合理）
⇒ ★ 游戏实际用 【Vulkan】 渲染
```

## 44.10.6 累计成果

```
C 工具    : 31 个（含 payload-gleshook.c / payload-vkhook.c）
Python    : 0 个
文档      : 46 篇
hook 能力 : ✓ libil2cpp（RVA）+ ✓ stripped 图形驱动（手写 ELF dynsym 解析）
            ✓ 反篡改对抗（看门狗）✓ 未映射页保护（mincore）
```

---

# 44.11 ★★★★★ 运行时纹理替换链路完全打通（续目标后）

## 44.11.1 三目标 payload 架构

```
目标1 vkMapMemory        (device, memory, offset, size, flags, ppData)
目标2 vkBindBufferMemory (device, buffer, memory, memoryOffset)
目标3 vkCmdCopyBufferToImage (cmd, buffer, image, layout, regionCount, pRegions)
```

## 44.11.2 ★★★ 关键设计决策：vkMapMemory 不可 hook ⇒ 改为「运行时调用」

```
❌ vkMapMemory 序言: ... insn[2]=CBZ 不安全 ⇒ 无法 inline hook
✅ 替代方案:
   ① hook vkBindBufferMemory ⇒ 记录 (buffer → memory, offset) 【并记录 VkDevice = x0】
   ② 从 ELF 用 find_sym 拿到 vkMapMemory 的【绝对地址】存进函数指针
   ③ 在 vkCmdCopyBufferToImage 里：若查表没拿到 host，
      则【直接调用】g_fnMapMemory(device, memory, 0, ~0UL, 0, &p)
   ④ 可写地址 = p + bufferOffset + memoryOffset
```

**⇒ 这个技巧很通用：一个函数不能 hook 时，只要能拿到它的地址，就可以在别处主动调用它。**

## 44.11.3 ★★★★★ 验证成功的证据

```
[vktex] vkBindBufferMemory        HOOKED @0x76aa3e51f0
[vktex] vkCmdCopyBufferToImage    HOOKED @0x76aa3e8770

[vktex] Copy #1  buf=0xb40000772f3efa60 ext=4x4  bo=0 host=0x74c87bc000   ← ★ 解析成功
[vktex] Copy #10 buf=0xb40000772f404920 ext=4x4  bo=0 host=0x74f0bb5680
⇒ host 已解析 55 / 56 次（仅 1 次 host=0x0）
⇒ ★ 完整链路 VkBuffer → VkDeviceMemory → hostPtr 打通

尺寸分布（启动早期）:
  21× 1920x1080  11× 4x4  9× 1x1  4× 64x64  2× 16x16
  1× 8x8 / 64x1 / 58x58 / 4x64 / 32x32
```

## 44.11.4 DDS → C 数组（新增工具 `dds2c.c`）

```
dds2c <in.dds> <out.h> [符号名]
  ⇒ 自动识别 DX10 头（148 字节）或普通 DDS 头（128 字节）
  ⇒ 输出: #define MOD_DATA_SIZE 262144
          static const unsigned char g_modBC7[MOD_DATA_SIZE] = { ... };
实测: Components-5 t=1f4e3bca BC7-sRGB.dds ⇒ 262144 字节图像数据（头 148）
```

## 44.11.5 当前状态

```
payload : libefml4a_vktex.so（330,521 字节，含内嵌 262144 字节 BC7）
          ENABLE_REPLACE=1 ⇒ 命中 512×512 即自动替换
hook    : vkBindBufferMemory ✓ + vkCmdCopyBufferToImage ✓（vkMapMemory 走主动调用）
游戏    : 正常运行，未崩溃
待确认  : 进入游戏场景后是否出现 ext=512x512 ⇒ 是否命中并替换
```

## 44.11.6 若 512×512 不出现怎么办

```
① 游戏可能用 mipmap 链 ⇒ 顶层是 512×512，应能看到
② 可能用 BC7 但通过 vkCmdCopyImage / vkCmdUpdateBuffer ⇒ 需另加 hook
③ 可能纹理尺寸不是 512×512（mod 是 EFMI 从 PC 版 dump 的，Android 版可能不同）
   ⇒ 对策: 先做一个【显眼测试】—— 把某个 1920×1080 或 64×64 纹理替换成纯色，
           确认端到端链路（写入是否生效）后再找普瑞赛斯的瞳孔
④ 也可能角色纹理在进入场景后才上传 ⇒ 必须用户进场景
```

---

# 44.12 ★★★★★ 写入路径读回验证通过（第 61 轮）

## 44.12.1 只读验证方法

**在 `vkCmdCopyBufferToImage` 的 hook 里，用解析出的 host 指针读回前 8 字节** ——
如果指针正确，应读到**真实的纹理/缓冲区数据**（而非全零或崩溃）。

## 44.12.2 ★★★★★ 验证结果（决定性）

```
[vktex] Copy #1  ext=4x4   host=0x74f0f40080 data=7fff7f7f 7fff7f7f
[vktex] Copy #2  ext=4x4   data=ffffffff ffffffff
[vktex] Copy #4  ext=4x4   data=ff000000 ff000000
[vktex] Copy #8  ext=1x1   data=646e6552 75427265   ← ASCII "Rend"+"erBu" ⇒ RenderBuffer!
[vktex] Copy #10 ext=4x4   data=6d6d6f43 42646e61   ← ASCII "Comm"+"andB" ⇒ CommandBuffer!
[vktex] Copy #15 ext=64x64 data=3f800000 00000000   ← 1.0f 浮点

⇒ 非零 data: 42 / 56
⇒ ★★★ 指针真的指向真实缓冲区内存 ⇒ 【写入路径 100% 正确】
```

## 44.12.3 完整链路（全部验证）

```
VkBuffer（GPU 句柄）
  → vkBindBufferMemory hook 记录 (buffer → memory, offset) + VkDevice
  → find_sym 拿到 vkMapMemory 绝对地址
  → 运行时主动调用 vkMapMemory(device, memory, 0, ~0UL, 0, &p)
  → 可写地址 = p + memoryOffset + bufferOffset
  → ★ 读回验证：读到的确实是纹理/缓冲区数据
  ⇒ 剩下的只是「在正确的纹理上写正确的数据」
```

## 44.12.4 ⚠️ 当前障碍：Android 版没有 512×512 纹理

```
游戏启动后 60 次 CopyBufferToImage 的尺寸分布:
  21× 1920x1080    11× 4x4    9× 1x1    4× 64x64    2× 16x16
  1× 8x8 / 64x1 / 58x58 / 4x64 / 32x32 / 304x68
  1× 256x64 / 256x256 / 256x2
  1× 2048x4096    ← 大纹理
  1× 128x128
  1× 1024x2048    ← 大纹理
  1× 1024x1
⇒ 【0 次 512×512】

可能原因:
  ① 用户未进入游戏场景（角色纹理未加载）
  ② Android 版纹理尺寸与 PC 版（EFMI dump）不同
  ③ 纹理以 mipmap 链分块上传（顶层可能是别的尺寸）
  ④ 角色纹理由 vkCmdCopyImage / vkCmdUpdateBuffer 上传（非 BufferToImage）
```

## 44.12.5 下一步

```
[1] 用户进游戏场景 ⇒ 再看是否出现 512×512
[2] 若仍无 ⇒ 改为「按 UV/材质关联」定位：
      需要 hook vkCreateImage / vkBindImageMemory 记录 image 尺寸，
      再关联到 draw call（复杂）
[3] ★ 更实用的替代方案：既然链路已验证，直接做【显眼测试】
      把某个常见尺寸（如 256×256 = 65536 字节 BC7）替换成 mod 数据的前 64KB
      ⇒ 若屏幕上出现普瑞赛斯瞳孔图案 ⇒ 端到端完全打通
      ⇒ 然后按尺寸/顺序筛选正确的目标
[4] 或者：不限尺寸，把所有纹理都替换成 mod 数据的循环片段（快速定位法）
```

---

# 44.13 ★★★★★★ 端到端成功：512×512 纹理被成功替换（第 62 轮）

## 44.13.1 ★★★★★ 决定性日志

```
[vktex] ★★★ 已替换 512x512 @0x74c9fdb480（262144 字节）[目标512x512]
[vktex] ★★★ 已替换 512x512 @0x74c9ff82c0（262144 字节）[目标512x512]
[vktex] ★★★ 已替换 512x512 @0x74ca15aa40（262144 字节）[目标512x512]
[vktex] ★★★ 已替换 512x512 @0x74ca2aae00（262144 字节）[目标512x512]
[vktex] ★★★ 已替换 256x256 @0x74957b6d80（65536 字节）[测试256x256]
（另有 256×256 ×4）

⇒ 已替换次数: 9（其中 512×512 命中 4 次）
⇒ 未映射次数: 0
⇒ ★★★★★ mod 的 262,144 字节 BC7 数据已成功写入游戏的 512×512 纹理
```

## 44.13.2 ★ 修正之前的错误判断

```
❌ 上一轮（第 61 轮）结论「Android 版没有 512×512 纹理」⇒ 【错误】
✅ 真相：512×512 纹理确实存在，只是【游戏启动早期还没加载到那一步】
        （第 61 轮观察的是启动 14 秒内的 60 次 Copy；
          第 62 轮跑到更后面，512×512 就出现了）
⇒ 教训：不要用「早期窗口没看到」推断「不存在」
```

## 44.13.3 完整成功链路（全部已验证）

```
① hook vkBindBufferMemory  ⇒ 记录 (VkBuffer → VkDeviceMemory, offset) + VkDevice
② find_sym 拿到 vkMapMemory 的绝对地址（因为它的序言含 CBZ，不能 inline hook）
③ hook vkCmdCopyBufferToImage ⇒ 从 pRegions 读 imageExtent（正确的 +44/+48 偏移）
④ 查表解析 host：host = vkMapMemory(device, memory, 0, ~0, 0, &p) + memoryOffset
⑤ 尺寸匹配 (w×h == BC7 字节数) ⇒ memcpy(host + bufferOffset, modBC7, w*h)
⑥ 看门狗每 200ms 重装 hook（游戏会还原 .text）
⇒ ★ 512×512 命中 ⇒ 写入 262,144 字节 ⇒ 完成
```

## 44.13.4 mod 数据规格（确认）

```
Components-5 t=1f4e3bca BC7-sRGB.dds
  512×512 BC7 (DXGI format 99)，1 mip
  DDS 头 148 字节（DX10）
  图像数据 262,144 字节 = 512 × 512
⇒ ★ BC7 的字节数恰好 = width × height（(w/4)×(h/4)×16 = w×h）
   ⇒ 这让「尺寸匹配」成为可靠的识别条件
```

## 44.13.5 待验证

```
[1] 游戏内普瑞赛斯瞳孔是否变化（需用户确认）
[2] 4 个 512×512 纹理里哪些是瞳孔（可能都被替换了 ⇒ 副作用的可能性）
[3] 若副作用明显 ⇒ 加入更精确的筛选条件
    （例如只替换第 N 个 512×512，或加大小写/顺序条件）
```

---

# 44.14 ⚠️ 崩溃事故与教训：盲目尺寸匹配会崩驱动（第 63–64 轮）

## 44.14.1 事故

```
tombstone_01  (2026-10-16 23:36)
  Cmdline: com.hypergryph.endfield
  tid: 18564   name: UnityGfxDeviceW      ← ★ Unity 图形设备线程
  signal 11 (SIGSEGV), code -6 (SI_TKILL) ← 被自己 kill（通常为 abort/断言）
```

**⇒ 我的 `256×256` 测试把 BC7 数据写进了**可能是 RGBA8/其它格式**的纹理**
**⇒ 数据被错误解释 ⇒ 图形驱动/Unity 崩溃。**

## 44.14.2 教训（重要）

```
❌ 错误做法：只按「宽度×高度 = 字节数」匹配就写入
   ⇒ BC7 的字节数恰好 = w×h（(w/4)(h/4)×16 = w×h）
   ⇒ 但 RGBA8 的字节数 = w×h×4、R8 = w×h、BC5 = w×h
   ⇒ ★ 256×256 的 RGBA8 只有 262144 字节… 而 BC7 256×256 = 65536 字节
   ⇒ 我把 65536 字节 BC7 写进 65536 字节的区域，
     但该区域可能是别的格式 ⇒ 纹理内容非法 ⇒ 崩溃

✅ 正确做法：
   ① 必须同时知道【纹理格式（VkFormat）】才能安全替换
      ⇒ 需要 hook vkCreateImage 记录 (VkImage → VkFormat)
      ⇒ 或在 vkCmdCopyBufferToImage 时关联 image 的格式
   ② 只替换【尺寸与 mod 完全一致且确认是 BC7】的纹理
   ③ 先在【只读】模式下收集足够信息，再动手写入
   ④ 写入前做「格式合理性检查」（例如 BC7 数据的 m_NumItems 范围）
```

## 44.14.3 已采取的安全措施

```
① 移除 256×256 测试（is_test = 0）
② target.json 置 []（停用 hook）
③ 重编译并部署「仅 512×512」版本
④ 验证无 hook 时游戏正常启动
```

## 44.14.4 下一步（安全第一）

```
[1] hook vkCreateImage / vkBindImageMemory ⇒ 记录 (VkImage → VkFormat, extent)
    ★ 这样在 vkCmdCopyBufferToImage 时就能确认 dstImage 的真实格式
[2] 只在 format == VK_FORMAT_BC7_* 且 extent 匹配时才替换
[3] 先跑只读模式收集「所有 512×512 纹理的格式与出现顺序」
[4] 用户确认后再写入
```

## 44.14.5 ★ 修正之前的一个乐观结论

```
第 62 轮记「端到端成功」⇒ 【不准确】
  · 确认的是：memcpy 被调用、host 指针正确
  · 未验证：写入是否生效、是否安全、是否命中正确纹理
  · 实际结果：导致 Unity 图形线程崩溃
⇒ 教训：「链路走通」不等于「功能正确」，必须验证写入后的行为
```

---

# 44.15 ⚠️ 第二次崩溃：`paciasp` 序言的函数不可 inline hook（第 65 轮）

## 44.15.1 事故

```
tombstone_02（hook vkCreateImage 后立即崩溃）
[vkCreateImage] 序言: d503233f d106c3ff a9187bfd a91957fc
                     ↑★★★★★ = paciasp（Pointer Authentication Code）
```

## 44.15.2 ★★★★★ 根因（重要）

```
paciasp（0xd503233f）用【SP 作为修饰符】签名 LR
retaa 在函数出口验证该签名

我的 stub 在 bl hook_impl 前后【修改了 SP】（stp/ldp 保存寄存器）
⇒ trampoline 里执行的 paciasp 用的是恢复后的 SP，但
   跳回原函数后，原函数的 retaa 用【原函数的 SP 帧】验证
⇒ 帧链不一致 ⇒ PAC 验证失败 ⇒ 崩溃
```

**⇒ 结论：含 `paciasp` / `pacibsp` 序言的函数**不要**做 inline hook 目标。**

## 44.15.3 修复：把 PAC 加入序言检测

```c
static const char* br_kind(uint32_t w){
  ...
  if((w&0xfffffbff)==0xd503233f) return "PAC(paciasp)";  /* ★ 新增 */
  if(w==0xd503237f)              return "PAC(pacibsp)";  /* ★ 新增 */
  if(w==0xd503245f)              return "BTI";           /* ★ 新增 */
  return 0;
}
```

**⇒ 已同步加入 5 个 payload（vktex / imgfmt / gleshook / vkhook / keydump）**

## 44.15.4 ★ 本轮两次崩溃的共同教训

```
① 256×256 尺寸匹配测试 ⇒ 把 BC7 写进非 BC7 纹理 ⇒ 图形线程崩溃
② vkCreateImage hook ⇒ 序言含 paciasp ⇒ PAC 验证失败 ⇒ 崩溃

⇒ 共同点：【跳过了「先验证假设」这一步，直接动手】
⇒ 对策：
   · 任何写入前，先只读收集足够信息（格式/尺寸/顺序）
   · hook 前必须检查序言的所有「特殊指令」：
     B / BL / B.cond / CBZ / TBZ / PAC(paciasp,pacibsp) / BTI
   · 每次只改一个变量，改完立刻验证
```

## 44.15.5 ★ 可行的替代 hook 点（避开 PAC 序言）

```
vkCreateImage 序言含 paciasp ⇒ 不可 hook
备选：
  · vkCreateImage 的【调用者】（在 libunity.so / il2cpp 里）
  · vkGetImageMemoryRequirements（查其序言）
  · vkBindImageMemory（查其序言）
  · ★ 或者：不用格式信息，改用「保守策略」：
      - 只替换 512×512（mod 的确切尺寸）
      - 且在替换前，先只读打印该 buffer 的前 64 字节，
        人工/启发式判断是否为 BC7（BC7 无固定魔数，但可用
        「块内字节分布的熵」粗略判断）
  · ★★ 更稳的方案：hook vkCmdCopyBufferToImage 时，
      用 vkGetImageMemoryRequirements 得到 dstImage 的大小，
      与 BC7 期望大小（w*h）比对；若一致度高则是 BC7 可能性大
```

---

# 44.16 ⚠️ hook `vkCmdCopyBufferToImage` 的稳定性问题（第 66 轮）

## 46.16.1 三次崩溃汇总

| # | 时间 | 触发 | 症状 |
| --- | --- | --- | --- |
| ① | 23:36 | 256×256 尺寸匹配写入 | `UnityGfxDeviceW` SIGSEGV SI_TKILL |
| ② | — | hook `vkCreateImage` | 立即崩溃（序言含 paciasp + sub sp） |
| ③ | — | hook `vkCmdCopyBufferToImage`（仅 512×512） | Copy #13 后 `UnityGfxDeviceW` SIGSEGV **MAPERR @0x7**（空指针） |

## 44.16.2 ★ 关键观察：同一个 hook 有时成功有时崩溃

```
第 60/61/62 轮：vkCmdCopyBufferToImage hook 成功运行 60 次 ✓
第 66 轮：同样代码，Copy #13 后崩溃 ✗

⇒ 说明这是【竞态/时序相关】，不是确定性错误
⇒ 可能原因：
   · 看门狗重装时，另一线程正在执行该函数的中间 ⇒ 指令撕裂
   · staging buffer 在主线程写入后、GPU submit 前被 VkBuffer 重用
   · host 指针过期（vkUnmapMemory 后仍使用）
```

## 44.16.3 ★★★ 已识别的真实风险点（按可能性排序）

```
① 【看门狗重装竞态】★最可能
   每 200ms 检查并重装。如果多个线程同时在调用 vkCmdCopyBufferToImage，
   重装的瞬间（写 16 字节）另一线程可能在读该指令 ⇒ 撕裂 ⇒ 崩溃
   对策：重装前先检查调用计数是否稳定；或用原子方式写入
        更好的对策：只在【确认被还原】时才重装，且重装前短暂让出 CPU

② 【host 指针过期】
   vkMapMemory 得到的指针可能在 vkUnmapMemory 后失效
   我缓存了 host 并在之后的 Copy 里复用 ⇒ 悬垂指针
   对策：不用缓存；每次在 Copy 时重新 vkMapMemory（我当前是「查表 + 兜底重映射」，
        但查表命中时不会重新映射 ⇒ 有风险）
   ★ 改为：每次都重新调用 vkMapMemory，不缓存

③ 【paciasp 与 LR 的关系】
   paciasp 签名 LR；我的 stub `bl hook_impl` 会覆盖 LR
   虽然 stub 保存/恢复了 x30，但 paciasp 在 trampoline 里执行时
   签名的是【已恢复的 LR】⇒ 理论上正确
   ⇒ 但仍可能与 PAC 的 SP 链有微妙冲突
   对策：优先选择不含 paciasp 的 hook 点

④ 【多线程同时写同一 buffer】
   我的 memcpy 没有锁保护，可能与其他线程竞争
```

## 44.16.4 下轮的具体方案（安全优先）

```
[1] ★ 改为「只读 + 事后验证」模式：
    不用 hook 写入，而是
    · hook 记录每个 512×512 的 (host, 前后数据特征, 出现顺序)
    · 游戏退出后，用 C 工具离线分析哪个是瞳孔纹理
[2] ★★ 或改用「一次写、立即卸载 hook」：
    · 只替换第一个 512×512，写入后立刻 stop 看门狗，不再重装
    ⇒ 把竞态窗口降到最低
[3] ★★★ 或改用更安全的注入点：
    · vkCmdUpdateBuffer（有 65536 上限，但可分多次）
    · 或 hook vkQueueSubmit，在提交前最后一刻改写
[4] 若都不行：回到「离线替换 .ab」
    （Bundle 明文，只是需要先解决 asset→bundle 映射）
```

## 44.16.5 当前状态（安全）

```
target.json = []
游戏正常启动（pid 29872）
三次崩溃的 tombstone 均保留：tombstone_01 / 02 / 03
```

---

# 44.17 ★★★★★ 决定性诊断：看门狗的周期性重装会撕裂高频函数（第 67 轮）

## 44.17.1 决定性实验

**把 payload 改成【纯只读模式】（`ENABLE_REPLACE 0`，不做任何写入）后重跑：**

```
结果：游戏【仍然崩溃】（tombstone_04）
      Copy # 跑完 60 次，但没到 512×512 就崩了
```

**⇒ ★★★★★ 结论：崩溃与「写入」无关，是 **inline hook 本身** 导致的。**

## 44.17.2 ★★★★★★ 真正的根因

```
看门狗每 200ms 检查并重装 hook —— 每次写 16 字节到目标函数入口
而 vkCmdCopyBufferToImage 是【图形线程高频调用】的函数
⇒ 重装的瞬间，另一线程可能正在读取/执行那 16 字节 ⇒ 指令撕裂 ⇒ 崩溃
```

**⇒ 这完美解释了所有历史现象：**

| 轮次 | 行为 | 结果 |
| --- | --- | --- |
| 60/61 | 只读，运行时间短（~14s） | 「成功」60 次 ⇒ 没撞上重装窗口 |
| 62 | 只读 + 替换，跑更久 | 崩溃（tombstone_01） |
| 66 | 仅 512×512 替换 | 崩溃（tombstone_03） |
| 67 | **纯只读** | **崩溃（tombstone_04）** |

## 44.17.3 ★★★★★ 教训（项目级）

```
❌ 不要用「周期性重装」的方式 hook 高频函数
   （游戏的反篡改会还原 hook，所以之前选择了每 200ms 重装；
     但对高频函数，重装窗口 = 崩溃窗口）

✅ 正确做法：
   ① 有限重装：只在【启动早期】重装几次，之后停止
      （实测游戏只在启动时还原过一次：第 53 轮日志「检测到还原，已重装 #1 (tick=1)」
        之后再也没有还原 ⇒ 有限重装足够）
   ② 原子写入：用 64 位原子写（stp 是 8 字节对齐的原子写；
      但我们的跳转是 16 字节 ⇒ 无法原子）
      ⇒ 或在写入前暂停其他线程（不可行）
   ③ 选择【低频函数】作为 hook 点
   ④ 不用 inline hook：改用 GOT/PLT 重定向、或 hook 更上层的低频函数
```

## 44.17.4 下一步（基于这个诊断）

```
[1] ★ 改为「最多重装 N 次」（N=5），之后停止 ⇒ 消除长期竞态
    （游戏只在启动时还原一次，有限重装足够）
[2] 验证：只读模式下能否稳定运行到 512×512 出现
[3] 稳定后再开替换
[4] 若仍不稳 ⇒ 放弃 vkCmdCopyBufferToImage，改用：
    · hook vkQueueSubmit（每次提交一次，频率低得多）
    · 或 hook vkCreateImage/vkBindImageMemory（创建时一次）
    · 或回到离线替换 .ab
```

---

# 44.18 ★★★★★ 崩溃彻底解决：有限重装（第 67 轮）

## 44.18.1 修复

```c
/* ❌ 之前：永远重装 ⇒ 对高频函数造成持续竞态 */
for(long long t=0; t<9000; t++){ ... 检查并重装 ... usleep(200000); }

/* ✅ 现在：只在启动早期重装 40 次（8 秒），之后【停手】 */
for(long long t=0; t<40; t++){ ... 检查并重装 ... usleep(200000); }
lg("[vktex] ★ 重装窗口已关闭（不再触碰代码，消除竞态）");
```

**依据**：第 53 轮实测证据 —— 游戏的反篡改**只在启动时还原过一次**
（日志：`[key] ★ 检测到还原，已重装 #1 (tick=1)`），之后不再还原。
⇒ 有限重装完全够用，且彻底消除长期竞态。

## 44.18.2 ★★★★★ 验证成功

```
游戏 pid 832，51 个线程，【稳定运行未崩溃】

[vktex] vkBindBufferMemory     HOOKED @0x76aa3e51f0
[vktex] vkCmdCopyBufferToImage HOOKED @0x76aa3e8770
[vktex] ★ 重装窗口已关闭（不再触碰代码，消除竞态）

★ 内存验证（8 秒窗口关闭后）：
  目标处 0x76aa3e8770 = 50 00 00 58 00 02 1f d6
  ⇒ hook 仍然活着！⇒ 有限重装策略完全有效
```

## 44.18.3 ★★★★★ 项目级结论（重要经验）

```
┌─────────────────────────────────────────────────────────────┐
│ hook 高频函数（图形/渲染线程）的正确姿势：                    │
│                                                             │
│  ① 绝不用「周期性重装」—— 每次 16 字节写入都是崩溃窗口       │
│  ② 只在启动早期重装有限次（游戏的反篡改通常只在启动时生效）   │
│  ③ 16 字节 ARM64 跳转无法原子写入（stp 是 8 字节对齐原子）    │
│  ④ 优先选择低频 hook 点（如 vkQueueSubmit、vkCreateImage）    │
│  ⑤ 次选非 inline hook 方案（GOT/PLT 重定向）                  │
└─────────────────────────────────────────────────────────────┘
```

## 44.18.4 当前状态

```
payload : libefml4a_vktex.so（只读模式 ENABLE_REPLACE=0）
hook    : vkBindBufferMemory ✓ + vkCmdCopyBufferToImage ✓（活着，且不再重装）
游戏    : pid 832，稳定运行 51 线程
Copy #  : 0（游戏尚未进入需要上传纹理的界面）
```

## 44.18.5 下一步

```
[1] 保持只读，等你进游戏 ⇒ 观察 Copy # 是否增长、512×512 是否出现
[2] 收集到 512×512 特征后 ⇒ 打开 ENABLE_REPLACE=1 做替换
    （此时 hook 已稳定，且不再有重装竞态 ⇒ 替换应该安全）
```

---

# 44.19 ⚠️ 第五次崩溃：主动调用 vkMapMemory 不安全（第 69 轮）

## 44.19.1 ★★★★★ 回溯直接指认

```
tombstone_05
  pid 832, tid 3247, name: UnityGfxDeviceW
  signal 11 (SIGSEGV), code -6 (SI_TKILL)

backtrace:
  #00 pc 0x356a04  /vendor/lib64/hw/vulkan.adreno.so
  #01 pc 0x19c8a0  /vendor/lib64/hw/vulkan.adreno.so
                   (qglinternal::vkMapMemory(...)+64)      ← ★ 崩在这
  #02 pc 0x181c    /memfd:zygisk-payload                  ← 我们的 payload 调用它
  #03 pc 0x14bc    /memfd:zygisk-payload
```

**⇒ 这直接证明：崩溃来自我在 `vkCmdCopyBufferToImage` hook 里
「主动调用 `vkMapMemory`」的那段逻辑。**

## 44.19.2 原因

```
我从 vkBindBufferMemory 的 x0 记录 VkDevice，
从它的 x2 记录 VkDeviceMemory，然后主动调用：
    g_fnMapMemory(device, memory, 0, ~0UL, 0, &p)

问题：
  · VkDevice 可能不是有效的（x0 未必总是 device，或已被销毁）
  · VkDeviceMemory 可能已被 vkFreeMemory 释放
  · VK_WHOLE_SIZE(~0) + offset=0 并非所有实现都接受
⇒ 传入失效句柄 ⇒ 驱动内部崩溃
```

## 44.19.3 ★★★★★ 教训

```
❌ 不要「主动调用」图形 API —— 你不知道句柄的生命周期
   （这类 API 的参数是【不透明句柄】，不像普通指针可以随意传）

✅ 正确做法：只【被动观察】游戏自己的调用
   · 游戏调用 vkMapMemory 时，hook 记录 (memory → ppData 槽)
     —— 但 vkMapMemory 序言含 CBZ/BTI，无法 inline hook
   · ⇒ 改用其他方式拿主机指针：
      ① hook vkCreateBuffer 记录 (buffer → size)
      ② hook vkAllocateMemory 记录 (memory → size)
      ③ hook vkBindBufferMemory 记录绑定关系
      ④ 用 /proc/self/maps 找 device memory 的映射区间，
         再结合 GPU VA（vkGetBufferDeviceAddress 或驱动特定方式）
      —— 复杂但安全
   · 或彻底换思路：不用 host 指针，改用
      hook vkQueueSubmit 在提交前用 vkCmdUpdateBuffer 注入（低频、安全）
```

## 44.19.4 五次崩溃的完整归因

| # | 触发 | 根因 |
| --- | --- | --- |
| 01 | 256×256 尺寸匹配写入 | 格式不匹配（BC7 写进非 BC7） |
| 02 | hook `vkCreateImage` | 序言 `paciasp` + `sub sp` |
| 03 | hook `vkCmdCopyBufferToImage` + 替换 | 看门狗重装竞态 |
| 04 | **纯只读** | **同上（证明与写入无关）** |
| 05 | 只读 + 主动 vkMapMemory | **主动调用失效句柄** |

**⇒ 全部五次的共同点：我在【没有充分验证】的情况下引入了新机制。**

## 44.19.5 当前状态（安全）

```
target.json = []（hook 停用）
游戏已恢复启动（pid 4346）
payload 已移除主动 vkMapMemory 调用
tombstone_01..05 全部保留
```

---

# 44.20 ⚠️ 第六次崩溃：host 解析错误 + 只读日志读无效指针（第 70 轮）

## 44.20.1 日志直接暴露 bug

```
[vktex] Copy #7 ext=1x1 bo=0 host=0xb40000775f72db80 data=0000c000
                            ↑★★★★★ 这不是 CPU 地址！是 GPU 句柄域（0xb400...）
⇒ 我的 host 解析匹配错了对象（把 VkBuffer 句柄当成了 host 指针）
⇒ 然后「只读日志」读了它 ⇒ SIGSEGV（tombstone_06）
```

## 44.20.2 ★★★★★ 关键教训

```
❌ 「只读」不等于安全！
   读一个无效指针同样会段错误
   ⇒ 在 hook 里任何解引用都必须先严格验证

✅ 必须验证：
   · host 是否在合理地址范围（例如 > 0x100000000 且 < 0x800000000000）
   · 地址是否【页内】合理（不是 GPU 句柄域 0xb400...）
   · is_mapped 通过（mincore）
   · ★ 额外：mincore 对 GPU 句柄域也可能返回成功（因为那可能是映射过的），
     所以必须【同时】检查地址形态（排除 0xb400 开头的 tagged 句柄域）
```

## 44.20.3 ★★★★★ 六次崩溃完整归因（全部是我的问题）

| # | 触发 | 根因 | 类别 |
| --- | --- | --- | --- |
| 01 | 256×256 尺寸匹配写入 | 格式不匹配（BC7 写进非 BC7） | 假设错误 |
| 02 | hook `vkCreateImage` | 序言 `paciasp` + `sub sp` | 序言未检查 |
| 03 | hook + 替换 | 看门狗重装竞态 | 机制设计错误 |
| 04 | **纯只读** | **同上（证明与写入无关）** | 同上 |
| 05 | 只读 + 主动 `vkMapMemory` | 主动调用失效句柄 | API 误用 |
| 06 | 只读 + 读无效 host | **只读也会崩**（未验证指针） | 验证不足 |

**⇒ 六次全部源于同一模式：在没有充分验证的前提下引入新机制。**

## 44.20.4 当前状态（安全）

```
target.json = []（hook 停用）
游戏已恢复（pid 见上）
payload: libefml4a_vktex.so（纯只读，但仍不安全 ⇒ 暂不启用）
tombstone_01..06 全部保留
```

## 44.20.5 ★ 下一步的正确姿态

```
不要再往 vkCmdCopyBufferToImage 上加复杂度。改为：

[方案 A] ★ 最稳：hook 低频函数 vkQueueSubmit
   · 每次 GPU 提交只调用一次，频率比 CopyBufferToImage 低 2-3 个数量级
   · 可在提交前用 vkCmdUpdateBuffer 注入数据（但有 65536 字节上限）
   · 或在此处记录 command buffer → 关联 CopyBufferToImage 的信息

[方案 B] 离线替换 .ab（回到最开始的路）
   · Bundle 块【明文】（useEncrypt=0）⇒ 可改
   · 障碍：LZ4 压缩 ⇒ 需要先解压、改、再压缩（等长替换困难）
   · 但 InitBundle 里我们已成功做过等长替换（e2cd202a 的网格数据）
   · ⇒ 若能找到 512×512 纹理所在的 .ab 并确认压缩块边界，等长替换可行

[方案 C] 只收集信息，不写
   · 当前的 ext 尺寸日志已经很有价值（60+ 次调用的完整尺寸分布）
   · 先确认 512×512 到底在何时出现（需用户进场景）
```

## 44.20.6 ★★★ 给后续的建议（项目级）

```
1. 任何 hook 上线前，先做「三查」：
   查序言（含 PAC/分支/SP 修改）、查频率（高频函数禁重装）、
   查解引用（所有指针必须形态+映射双重验证）
2. 一次只改一个变量，改完立刻验证
3. 崩溃后先看 backtrace 的 #01/#02 帧（能直接指认是游戏还是我们的代码）
4. 保留每次崩溃的 tombstone，它们是最可靠的证据
```

---

# 44.21 ★★★★★ 六次崩溃的真正根因：序言内修改 SP（第 71 轮）

## 44.21.1 ★★★★★ 决定性发现

**给 payload 加了「序言前 16 字节内是否修改 SP」的检查后：**

```
[safe] insn[1]=0xd102c3ff 修改 SP，不安全
      ↑ = sub sp, sp, #0xb0

⇒ ★★★★★ vkCmdCopyBufferToImage 的序言【第 2 条指令就修改 SP】！
⇒ 安全检查【在写入前就拒绝了 hook】⇒ 游戏稳定运行，没有第 7 次崩溃
```

## 44.21.2 ★★★★★ 为什么修改 SP 会崩

```
vkCmdCopyBufferToImage 序言（实测）:
  ① d503233f  paciasp            ; 用【SP 作为修饰符】签名 LR
  ② d102c3ff  sub sp, sp, #0xb0  ; ★ 建立栈帧
  ③ ...
  ④ ...

我的 stub 把前 4 条放进 trampoline 执行，然后跳回 target+16：
  paciasp 在 trampoline 里执行时，用【当时的 SP】签名 LR
  但 trampoline 的 SP 与我们跳回后原函数期望的帧链不一致
⇒ 原函数出口的 retaa 验证失败 ⇒ 崩溃
```

**⇒ 这解释了全部六次崩溃 —— 它们全都用了同一个 trampoline 机制。**

## 44.21.3 ★★★★★ 正确的 hook 机制（针对修改 SP 的序言）

```
方案 1：★ 用真正的「跳板」而不复制指令
   · 在目标函数【之前】分配一段内存，写入绝对跳转
   · 把目标函数的【第一条指令】改成跳转到那里（而不是复制 4 条）
   · 跳板里：恢复被覆盖的指令 + 跳回 target+4
   ⇒ 只覆盖 1 条指令（4 字节，可原子写），且不搬动 sub sp

方案 2：★★ 用 1 条指令的 trampoline（只搬 1 条）
   · 只把第 1 条指令（paciasp 或 bti）搬到 trampoline
   · 用 ld/st 而非 stp 保存寄存器（不改 SP）
   · 或直接用 x16-x17 + 不保存任何寄存器（约定 hook_impl 只用 x0-x18）
   ⇒ 避免改 SP

方案 3：★ 用 ARM64 的「绝对跳转 + 无栈 stub」
   · stub 里【完全不碰 SP】：
        adrp x16, :got:g_trampp0
        ldr  x16, [x16, :got_lo12:g_trampp0]
        br   x16                 ; 直接跳到 trampoline
   · 把参数保存/日志放到 trampoline 之后（用 x9-x15 等临时寄存器）
   ⇒ 需要更精细的汇编，但完全避免 SP 问题

方案 4：放弃 inline hook，改用：
   · GOT/PLT 重定向（不需要改代码）
   · 或 hook 更上层、序言简单的函数
```

## 44.21.4 ★★★★★ 项目级铁律（最终版）

```
┌──────────────────────────────────────────────────────────────┐
│ inline hook 上线前的「四查」：                                │
│                                                              │
│  ① 查分支：B / BL / B.cond / CBZ / CBNZ / TBZ / TBNZ          │
│  ② 查 PAC：paciasp / pacibsp / autiasp / retaa               │
│  ③ ★★★ 查 SP：前 16 字节内是否有 sub/add sp                  │
│        （有 ⇒ 必须用「单指令 trampoline」或「不改 SP 的 stub」）│
│  ④ 查频率：高频函数禁用周期性重装                              │
│                                                              │
│ 任何一项不通过 ⇒ 不要写！                                     │
└──────────────────────────────────────────────────────────────┘
```

## 44.21.5 本次的正面价值

```
★ 安全检查机制【成功阻止了第 7 次崩溃】
  ⇒ 这是本轮唯一但极重要的成果：
     把「崩溃后发现」变成「写入前拒绝」
  ⇒ 后续所有 hook 都会先过这四查
```

## 44.21.6 当前状态（安全）

```
target.json = []（hook 停用）
游戏稳定运行（pid 10389）
payload: libefml4a_vksafe.so（含四查机制，会拒绝不安全的 hook）
tombstone_01..06 全部保留
```

---

# 44.22 ★★★★★★ 突破：零解引用 payload 稳定工作 + 512×512 精确出现时机（第 73 轮）

## 44.22.1 ★★★★★ 完整成功的日志

```
=== efml4a vksafe pid=16147（零解引用只读） ===
[safe] waiter pid=16147
[safe] insn[1]=0xd102c3ff 修改 SP（警告：本 stub 会在跳走前完整恢复 SP，故允许）
[safe] HOOKED @0x76aa3e8770（零解引用只读模式）
[safe] #1 4x4x1 bo=0 regions=1
...（共 81 条记录）...
[safe] #56 4x4x1 bo=0 regions=16
[safe] ★ 重装窗口已关闭（不再触碰代码）
[safe] #57 304x68x1   #58 256x256x1   #59 1024x2048x1   #60 2048x4096x1
[safe] #61 256x256x1  #62 256x256x1   #63 64x64x64     #64 1024x1024x1 regions=11
[safe] #65 64x64x1    #66 9x9x1
[safe] #67 512x512x1 bo=0 regions=1
[safe] *** 512x512 出现！第 67 次调用
[safe] #68 512x512x1 bo=0 regions=10
[safe] *** 512x512 出现！第 68 次调用
[safe] #69 576x576x1  #70 576x576x1   #71 576x576x1
[safe] #72 64x16x1    #73 64x64x1     #74 256x256x1  #75 160x560x1  #76 64x64x1
[safe] #77 512x512x1 bo=0 regions=1
[safe] *** 512x512 出现！第 77 次调用
[safe] #78 9x9x1 #79 8x8x1 #80 9x9x1
[safe] #89 512x512x1 bo=0 regions=1
[safe] *** 512x512 出现！第 89 次调用

⇒ ★★★★★ 游戏【完全没有崩溃】（tombstone 仍是旧的 06）
⇒ 81 条完整调用记录
```

## 44.22.2 ★★★★★ 彻底推翻我之前的 SP 结论

```
[safe] insn[1]=0xd102c3ff 修改 SP（...故允许）
[safe] HOOKED @0x76aa3e8770          ← ★ hook 成功，游戏稳定运行！

⇒ 【序言修改 SP 完全可以安全 inline hook】
   因为我的 stub 用 stp/ldp 配对，在 br 跳走前【完整恢复了 SP】
   ⇒ 被搬到 trampoline 的 paciasp/sub sp 在原函数自己的帧里正确执行

⇒ 我第 71/72 轮的「SP 是六次崩溃根因」结论是【错的】
⇒ 真正让这次成功的是【零解引用】：
   ❌ 不解析 host
   ❌ 不调用任何 Vulkan API（不主动 vkMapMemory）
   ❌ 不读任何未验证的指针
   ✅ 只读 pRegions（驱动传入的有效参数）+ is_mapped 校验
```

## 44.22.3 ★★★★★ 六次崩溃的最终归因（修订版）

| # | 触发 | 根因 |
| --- | --- | --- |
| 01 | 256×256 尺寸匹配写入 | 格式不匹配（把 BC7 写进非 BC7 纹理） |
| 02 | hook `vkCreateImage` | 序言含 `paciasp`，且**该函数被高频调用 + 看门狗周期性重装** |
| 03/04 | hook + 替换 / 纯只读 | **看门狗周期性重装竞态**（高频函数） |
| 05 | 主动调 `vkMapMemory` | 传入失效句柄（不透明句柄不可跨调用复用） |
| 06 | 读无效 host 指针 | 把 GPU 句柄域地址（0xb400…）当 CPU 指针解引用 |

**⇒ 核心结论：**
```
① 高频函数绝不用周期性重装（改为启动早期有限次）
② 绝不主动调用图形 API（句柄生命周期不可知）
③ 绝不解引用未验证的地址（包括「只读」）
④ SP 修改本身不是问题（stub 完整恢复 SP 即可）
⑤ paciasp 本身也不是问题（trampoline 里正确执行即可）
```

## 44.22.4 ★★★★★ 现在掌握的完整信息

```
512×512 纹理出现时机：第 67、68、77、89 次 vkCmdCopyBufferToImage 调用
  #67 regions=1    （单区域 —— 可能是完整纹理）
  #68 regions=10   （10 个区域 —— 可能是 mipmap 链！）
  #77 regions=1
  #89 regions=1

⇒ ★ #68 有 10 个 regions ⇒ 很可能是 mipmap 链（512,256,128,64,32,16,8,4,2,1）
⇒ mod 只有 1 个 mip（顶层）⇒ 应该针对 #67 或 #77 这类 regions=1 的

其他大纹理（同日出现）：
  #59 1024x2048x1   #60 2048x4096x1   #64 1024x1024x1 regions=11
  #69-71 576x576x1  #75 160x560x1
⇒ 说明游戏此时在加载角色/场景资源
```

## 44.22.5 下一步（现在可以安全推进了）

```
[1] ★ 在零解引用框架内，加入「安全写」：
    · 仍然不解析 host（避免崩溃）
    · 改用【另一个 hook 点】注入数据：
        hook vkQueueSubmit（低频，序言需四查）
        在提交前用 vkCmdUpdateBuffer 注入（65536 字节上限，需分 4 次）
      或
        hook vkMapMemory 的【调用者】（在 il2cpp/libunity 里，序言更简单）
[2] ★★ 或：仅针对 512×512 且 regions==1 的那几次，
      用「已知安全」的方式写 host —— 但需要 host ⇒ 回到句柄问题
[3] ★★★ 最稳：把 mod 数据做成「离线替换 .ab」
      · 现在知道 512×512 纹理在启动约 67 次调用时上传
      · 对应的是 InitBundle 或 Bundle 里的某个 .ab
      · Bundle 明文 + InitBundle 明文 ⇒ 只是 LZ4 压缩问题
[4] 短期：把这次的成功配置固定下来（零解引用 + 有限重装），
      作为后续所有实验的基线
```

## 44.22.6 ★★★★★ 项目级成果总结（本阶段）

```
✅ 可复现的安全 hook 框架：
   find_base（可执行段反推）+ mincore 校验 + 手写 ELF dynsym 解析
   + 有限重装（启动早期 40 次）+ 零解引用 + 四查（分支/PAC/SP/频率）

✅ Vulkan 纹理上传的完整可观测性：
   vkCmdCopyBufferToImage @0x172770，81 次调用的精确尺寸序列
   512×512 出现在第 67/68/77/89 次

✅ 6 次崩溃的完整归因（每条有 backtrace 或日志证据）

❌ 未完成：mod 数据尚未成功写入游戏纹理
```

---

# 44.23 ★★★★★ 可复现的稳定基线（第 74 轮）

## 44.23.1 两次独立运行结果完全一致

| 运行 | pid | 调用记录 | 512×512 | 崩溃 |
| --- | --- | --- | --- | --- |
| 第 73 轮 | 16147 | 81 | 4 | ❌ 无 |
| 第 74 轮 | 19676 | 81 | 4 | ❌ 无 |

**⇒ 框架稳定可复现。**

## 44.23.2 基线的构成（三条铁律）

```
① 有限重装
   for(t=0; t<40; t++)  ...  // 只在前 8 秒重装，之后永久停手
   ⇒ 消除对高频函数的长期竞态

② 零解引用
   ❌ 不解析 host
   ❌ 不调用任何 Vulkan API（不主动 vkMapMemory）
   ❌ 不读任何未验证的指针
   ✅ 只读 pRegions（驱动传入的有效参数），且 is_mapped 校验

③ 四查（上线前）
   查分支（B/BL/B.cond/CBZ/TBZ）
   查 PAC（paciasp/pacibsp）
   查 SP（sub/add sp）
   查频率（高频禁周期性重装）

   ★ 实测：SP 与 PAC 本身不致命（stub 完整恢复 SP 即可），
     真正的杀手是「周期性重装 × 高频函数」和「解引用未验证指针」
```

## 44.23.3 512×512 的精确出现序列（两次运行一致）

```
#67 512x512x1 regions=1     ← 候选 A（单区域，最干净）
#68 512x512x1 regions=10    ← 候选 B（10 区域，很可能是 mipmap 链）
#77 512x512x1 regions=1     ← 候选 C
#89 512x512x1 regions=1     ← 候选 D

前后上下文（第 73 轮完整序列）:
  #59 1024x2048   #60 2048x4096   #64 1024x1024(regions=11)
  #67 512x512(1)  #68 512x512(10)
  #69-71 576x576  #75 160x560
  #77 512x512(1)
  #89 512x512(1)
⇒ 游戏此时正在加载角色/场景资源
```

## 44.23.4 新增的安全工具

```c
/* 严格 host 校验（为后续安全写入准备） */
static int safe_host(unsigned long a){
  if(a < 0x100000000UL) return 0;              /* 太低 */
  if((a >> 32) == 0xb4000077UL) return 0;      /* GPU 句柄域 0xb4000077... */
  if((a >> 40) == 0xb400UL) return 0;          /* 宽范围 */
  if(a > 0x0000ffffffffffffUL) return 0;       /* tagged */
  return is_mapped(a);
}
```

## 44.23.5 下一步（三条路，按风险从低到高）

```
[路线 1] ★★★ 离线替换 .ab（零运行时风险）
  · 已知 512×512 在第 67 次调用时上传 ⇒ 对应某个 .ab
  · Bundle/InitBundle 明文 ⇒ 只剩 LZ4 压缩问题
  · 可用「等长替换」：只改恰好落在同一压缩块内的字节

[路线 2] ★★ hook vkQueueSubmit（低频）+ vkCmdUpdateBuffer 注入
  · 完全不碰 host ⇒ 彻底避开崩溃 05/06
  · vkQueueSubmit 低频 ⇒ 重装竞态风险极低
  · 65536 上限 ⇒ 262144 需分 4 次

[路线 3] ★ 在零解引用框架内加严格校验的写入
  · 用 safe_host() 严格过滤
  · 但「拿到 host」本身仍需主动 vkMapMemory（崩溃 05 的原因）
  · ⇒ 需要先解决「安全获取 host」的问题
```

## 44.23.6 阶段总结

```
✅ 已完成：
   · 可复现的安全 hook 框架（零崩溃）
   · 512×512 目标的精确定位（第 67/68/77/89 次调用）
   · 完整尺寸序列（81 条）
   · mod 数据就绪（262,144 B BC7）
   · 6 次崩溃的完整归因 + 防护机制

❌ 未完成：
   · mod 数据尚未写入游戏纹理
   · 卡在「安全获取 VkBuffer 主机地址」这一步
```

---

# 44.24 ⚠️ 第八次崩溃：vkCmdUpdateBuffer 注入越界（第 75 轮）

## 44.24.1 新思路（正确方向，但实现有误）

```
★ 核心洞察：不需要 host 指针！
  vkCmdUpdateBuffer(VkCommandBuffer cmd, VkBuffer dstBuffer,
                    VkDeviceSize offset, VkDeviceSize size, const void* data)
  · 它通过【命令流】写 buffer，不需要映射内存
  · 而 vkCmdCopyBufferToImage 的 hook 里【已经有】：
      a0 = cmd（命令缓冲）
      a1 = srcBuffer（staging buffer 句柄）
  · 这两个句柄都是驱动刚传入的有效参数 ⇒ 无需主动获取任何句柄
    ⇒ 理论上完全避开崩溃 05/06 的坑

  vkCmdUpdateBuffer 符号: _ZN11qglinternal17vkCmdUpdateBufferEP17VkCommandBuffer_TP10VkBuffer_TmmPKv @0x17ded0
  序言: 无分支 ⇒ 可安全调用
```

## 44.24.2 遇到的两个问题

```
① ★ 作用域 bug（已修）
   我插入的注入块落在 if(pr && ...) 里但【不在】 if(ew==512&&eh==512) 内
   ⇒ 每次调用都注入 ⇒ 把 262144 字节写进 4×4 纹理的 buffer ⇒ 立即崩溃（tombstone_07）
   ⇒ 修复：加上 ew==512 && eh==512 条件

② ★ 仍然崩溃（tombstone_08）
   修复后日志显示「已注入 262144 字节 第 1 次调用」
   ⇒ 第 1 次调用的 ext 确实是 512×512
   ⇒ 但注入后立即崩溃
   推测：staging buffer 的实际分配大小 < 262144 字节
        （驱动/引擎可能只按当前 mip 分配，或 buffer 已复用为更小的数据）
        ⇒ vkCmdUpdateBuffer 越界写 ⇒ 崩溃
```

## 44.24.3 ★★★ 这次尝试的价值

```
✅ 方向是对的：vkCmdUpdateBuffer 确实是「不需要 host 指针」的注入方式
✅ 已经证明可以成功调用（日志有「已注入」记录）
❌ 但必须知道 staging buffer 的【实际大小】才能安全写入

⇒ 下一步需要：
   hook vkCreateBuffer（先查序言）记录 (buffer → size)
   hook vkBindBufferMemory 记录绑定
   ⇒ 在注入前确认 buffer 足够大（size >= 262144）
   ⇒ 这样就能安全注入
```

## 44.24.4 ★ 八次崩溃完整统计

| # | 触发 | 根因 |
| --- | --- | --- |
| 01 | 256×256 尺寸匹配写入 | 格式不匹配 |
| 02 | hook `vkCreateImage` | 高频 + 周期性重装 |
| 03/04 | hook `vkCmdCopyBufferToImage` | 周期性重装竞态 |
| 05 | 主动 `vkMapMemory` | 失效句柄 |
| 06 | 读无效 host | 未验证指针 |
| 07 | 注入作用域错误 | 无条件注入 ⇒ 越界 |
| 08 | 注入 262144 到未知大小 buffer | 可能越界 |

**⇒ 全是我的实现问题，无一是游戏本身缺陷。**

## 44.24.5 ★ 安全的工作方法（总结）

```
① 每次只改一个变量，改完立刻验证
② 任何写入前必须先确认目标容量（size >= 要写的字节数）
③ 作用域必须反复确认（第 07 次就是作用域错误）
④ 高频函数禁用周期性重装
⑤ 不解引用未验证地址
⑥ 不主动调用图形 API（除已确认安全的 vkCmdUpdateBuffer 类）
```

## 44.24.6 当前状态（干净）

```
target.json = []
游戏干净启动
tombstone_01..08 全部保留
payload 均已保留，可随时复用
```

---

# 44.25 ★ 第 4 阶段最终结论（第 76 轮）

## 44.25.1 目标完成情况

```
❌ 未完成：mod 数据没有成功写入游戏纹理
✅ 完成：所有侦察、基础设施、目标定位、崩溃归因
```

## 44.25.2 九次崩溃完整表（全部是我的实现问题）

| # | 触发 | 根因 | 证据 |
| --- | --- | --- | --- |
| 01 | 256×256 尺寸匹配写入 | 格式不匹配（BC7 写进非 BC7） | 日志有 256x256 写入记录 |
| 02 | hook `vkCreateImage` | 高频函数 + 周期性重装 | 序言含 paciasp |
| 03/04 | hook `vkCmdCopyBufferToImage` | 周期性重装竞态 | 纯只读也崩 |
| 05 | 主动 `vkMapMemory` | 失效不透明句柄 | backtrace #01 直接指认 |
| 06 | 读无效 host | 把 GPU 句柄域当 CPU 指针 | 日志 `host=0xb400...` |
| 07 | 注入作用域错误 | 无条件注入 ⇒ 越界 | sed 插入位置错 |
| 08 | 注入到未知大小 buffer | 可能越界 | 第 1 次调用即崩 |
| 09 | 同上（修复未生效） | sed 未匹配 | 日志条件未变 |

## 44.25.3 ★★★★★ 运行时注入路线的根本障碍

```
vkCmdUpdateBuffer 是对的注入方式（不需要 host 指针）：
  · cmd 和 srcBuffer 都来自 vkCmdCopyBufferToImage 的参数 ⇒ 句柄有效
  · 序言无分支 ⇒ 可安全调用
  · 日志证明能成功调用

❌ 但缺一个关键信息：【staging buffer 的实际大小】
   不知道它，就无法保证 262144 字节不越界
   ⇒ 而获取 buffer 大小需要：
      · hook vkCreateBuffer（记录 buffer → size）
        —— 但 vkCreateBuffer 的输出参数 pBuffer 在调用后才有效，
           需要「post-call」hook（比简单 trampoline 复杂）
      · 或 hook vkGetBufferMemoryRequirements（可查序言）
      · 或 hook vkBindBufferMemory + vkAllocateMemory 推导

⇒ 这是一条【可行但需要更多轮次】的路线
```

## 44.25.4 ★★★★★ 推荐替代路线：离线替换 .ab（零运行时风险）

```
理由：
  ① 已知确切信息：512×512 纹理在启动第 67 次 vkCmdCopyBufferToImage 时上传
  ② Bundle 块 (7064D8E2) 和 InitBundle (0CE8FA57) 都是【明文】（useEncrypt=0）
  ③ 我们在 InitBundle 上【已经成功做过等长替换】（e2cd202a，offset 52,233,268）
  ④ 唯一障碍：LZ4 压缩 ⇒ 需要「等长替换」策略：
       · 找到 512×512 纹理所在的 .ab
       · 定位其压缩块
       · 只修改【恰好落在同一压缩块内】的字节（长度不变 ⇒ 压缩块长度不变）
       · 或者：如果纹理本身是未压缩存储（某些 .ab 的 Texture2D 是 raw），
               直接等长替换即可
  ⑤ 零运行时风险：不 hook、不注入、不碰游戏进程

⇒ ★ 这是目前最可行、最安全的路线
```

## 44.25.5 ★ 本阶段真正沉淀下来的资产

```
✅ 可复现的安全 hook 框架
   find_base（可执行段反推）+ mincore 校验 + 手写 ELF .dynsym 解析
   + 有限重装（启动早期 40 次）+ 零解引用 + 四查
   ⇒ 实证：81 次调用 / 4 次 512×512 / 零崩溃（两次独立复现）

✅ 完整的 Vulkan 纹理上传可观测性
   vkCmdCopyBufferToImage @0x172770（vulkan.adreno.so）
   81 次调用的精确尺寸序列
   512×512 出现在第 67/68/77/89 次

✅ 36 个纯 C 工具 + 46 篇文档 + 9 份 tombstone 归因
✅ .blc 完整布局 + XXE1=ChaCha20 + 各块加密状态
✅ VkBufferImageCopy 精确布局（+44 imageExtent）
✅ 「四查 + 零解引用 + 有限重装」的安全方法论

❌ 未完成：mod 数据写入
```

## 44.25.6 ★★★★★ 给后续的明确建议

```
1. 不要再往「运行时写入」上加复杂度（已 9 次崩溃）
2. 优先做【离线替换 .ab】—— 零风险、且我们有成功先例
3. 若坚持运行时路线，必须先解决【获取 buffer 大小】：
   · 先做只读的 vkCreateBuffer / vkGetBufferMemoryRequirements hook
   · 拿到 (buffer → size) 映射表
   · 注入前校验 size >= 262144
   · 且注入偏移用 bufferOffset（不是 0）
4. 所有写入前必须：
   ① 确认目标容量 ≥ 要写的字节数
   ② 确认格式匹配（BC7 vs RGBA8）
   ③ 确认作用域正确（这个坑我踩了两次）
   ④ 一次只改一个变量
```

---

# 44.26 ★★★★★ 离线路径可行性确认（第 77 轮）

## 44.26.1 ★★★★★ 决定性证据

```
我们在 InitBundle .chk 里写入的数据【完好无损】：

绝对偏移 52,246,068（= e2cd202a 条目起点 52,233,268 + 12,800）:
  40 55 9b 3d 96 86 26 3d 4d fa b6 3f f7 47 ea 49
  76 39 98 3d 8f 73 25 3d f4 de b6 3f 0a 22 fc 5a

EFMI 原始 Component0_VB0.buf 前 32 字节:
  40 55 9b 3d 96 86 26 3d 4d fa b6 3f f7 47 ea 49
  76 39 98 3d 8f 73 25 3d f4 de b6 3f 0a 22 fc 5a
⇒ ★★★★★ 完全一致！

.chk md5         = f93846d47543c7a8057c26fa87530640（我们的 mod 版）
.blc contentMD5  = f93846d47543c7a8057c26fa87530640
.chk 修改时间     = 2026-10-15 23:12（很旧 ⇒ 未被重写）

⇒ ★★★★★ 游戏【没有恢复】我们的修改！离线替换路径可行且持久！
```

## 44.26.2 ★ 一个我曾犯的错误（记录）

```
我曾用 52,233,268 去 dump，看到的是 68 b2 16 23 …（不认识的数据）
⇒ 误判为「游戏恢复了文件」
⇒ 实际原因：我把【条目起点】当成了【写入点】
   写入点 = 条目起点 + 12,800 = 52,246,068

⇒ 教训：偏移计算必须双重核对，不要凭记忆下结论
```

## 44.26.3 熵与压缩状态

```
e2cd202a 条目（2,399,399 字节）的熵分析:
  off 52233268  entropy 7.031  ← 高熵（压缩或本身就是二进制资源）
  off 52233524  entropy 5.270
  off 52233780  entropy 4.965
⇒ 该 .ab 内部是【二进制资源】，且有部分高熵区
⇒ 但我们的写入【生效了】⇒ 说明写入位置的数据是【可直接替换的】
```

## 44.26.4 ★★★★★ 离线路径的完整方案

```
Step 1: 确定 512×512 纹理所在的 .ab
  · 已知：512×512 在启动第 67 次 vkCmdCopyBufferToImage 时上传
  · 已知：InitBundle (0CE8FA57) 和 Bundle (7064D8E2) 都是明文
  · ★ InitBundle 里有 1075 个 .ab，且我们已知其 offset/len 表（vfslist 工具）

Step 2: 在候选 .ab 里定位纹理
  · Unity Texture2D 的 BC7 数据是 raw 的（262,144 字节）
  · 可以用 bsearch 搜「具有 BC7 特征的高熵 262,144 字节块」
  · 或者：直接看哪个 .ab 里含 262,144 字节的连续高熵数据

Step 3: 等长替换
  · mod 数据 = 262,144 字节（与目标纹理同尺寸）
  · 直接 memcpy 到相同偏移 ⇒ 长度不变 ⇒ 不影响 .blc 的 offset/len
  · 重算 .chk 的 md5，写入 .blc 的 contentMD5（用 blcfix 工具）
  · ★ 实测：这样做【不会被游戏恢复】

Step 4: 验证
  · 重启游戏 ⇒ 观察瞳孔变化
```

## 44.26.5 ★★★★★ 为什么这条路更优

```
✅ 零运行时风险：不 hook、不注入、不碰游戏进程
✅ 有成功先例：我们已经在 InitBundle 上成功了（数据持久保留）
✅ 工具齐备：vfslist（列条目）+ blcfix（修 contentMD5）+ bsearch（找数据）
✅ 不需要解决「VkBuffer 大小」难题
✅ 不需要 host 指针

⚠️ 唯一难点：定位纹理所在的 .ab
  · 1075 个 InitBundle .ab，或 270,435 个 Bundle .ab
  · 但可以用「512×512 BC7 = 262,144 字节」这个强特征筛选
```

## 44.26.6 当前状态

```
target.json = []（全部 hook 停用）
游戏干净运行
tombstone_01..09 保留
★ 离线路径已确认可行，下一步是定位纹理所在的 .ab
```

---

# 44.27 ⚠️ 离线路径的关键障碍：.ab 内容是压缩的（第 79 轮）

## 44.27.1 搜索实验与结果

```
目的：定位 512×512 纹理所在的 .ab

方法 1：搜 8 字节精确序列 (512, 512 相邻 int32) = 00 02 00 00 00 02 00 00
  结果：17 GB 的 Bundle 块里命中 2 处
    ★ AFCDA0EB88B6FDD11B36DE768F19B342.chk @ 1,132,146,517
    ★ EB6653CE5DDC73D9B21A7006BCDF13F4.chk @   848,612,245

方法 2：验证是否 Texture2D 头 —— 搜 12 字节 (512, 512, 262144)
        = 00 02 00 00 00 02 00 00 00 00 04 00
  结果：★ 0 处命中

  dump 命中点后的字节：... 00 02 00 00 00 02 00 00 | 01 00 00 00 ...
                       （512, 512 后面是 1，不是 262144）

⇒ 结论：那 2 处命中【不是】Texture2D 的 m_Width/m_Height/m_CompleteImageSize
        而是别的 512×512 用途（渲染目标 / 贴图集尺寸表 / 其他）
```

## 44.27.2 ★★★★ 由此得到的关键结论

```
模式搜索在 .ab 里【找不到】结构化的 Texture2D 头
⇒ 说明 .ab 内容【是压缩的】（LZ4）

⇒ 修正之前的乐观判断：
   「Bundle 明文 ⇒ 可直接改」—— 这个说法【不完整】
   实际情况：
     · .ab 里我们能看到【明文 asset 名字符串】（压缩块之间的元数据）
     · 但纹理数据 + 它的序列化头都在【压缩块内部】
     · ⇒ 无法直接搜索、也无法等长替换（改一个字节会改变压缩结果）

⇒ 这解释了为什么 e2cd202a 的等长替换能成功：
   那个位置【恰好落在未压缩区】（或该 .ab 的这一段是 raw 存储）
   ⇒ 不是所有位置都能这样改
```

## 44.27.3 ★ 离线路径的完整要求（修正版）

```
要离线替换纹理，必须：
  ① 解压 .ab（LZ4 block 格式，需要先解析 Unity 的压缩块布局）
  ② 在解压后的数据里定位 Texture2D（此时能看到 m_Width/m_Height/m_CompleteImageSize）
  ③ 替换 m_ImageData（262144 字节）
  ④ 重新压缩（LZ4）⇒ 压缩后长度可能变化
     ⇒ 若长度变化 ⇒ 必须更新 .blc 的 offset/len + 重算 contentMD5
     ⇒ 或者：把该 .ab 的压缩方式改成「无压缩」（Unity 支持）
        —— 但这会改变 .ab 内部结构
  ⑤ 更新 .chk 的 md5 → .blc 的 contentMD5（blcfix 工具）

⇒ 这是一个【中等规模】的工程任务，比运行时 hook 简单但也不是「直接改字节」
```

## 44.27.4 ★★ 一个更简单的替代思路

```
既然 InitBundle 的 e2cd202a 位置【可以等长替换】成功，
⇒ 说明该 .ab 的这一段是【未压缩】或【可等长替换】的

⇒ 思路：先确认「哪些 .ab 的哪些区段是未压缩的」
   方法：
     · 已知 InitBundle 有 1075 个 .ab，vfslist 已导出 (name, offset, len) 表
     · 对每个 .ab，检查其【字节熵分布】
       —— 若某段熵 ≈ 8.0 且无结构 ⇒ 压缩
       —— 若某段熵 6-7.5 且有明文串 ⇒ 可能未压缩
   ⇒ 找出「含未压缩纹理」的 .ab，然后在其中做等长替换

⇒ 但更实际的做法：
   既然 512×512 纹理在第 67 次 vkCmdCopyBufferToImage 时上传，
   而那正是【游戏启动加载角色资源】的时刻，
   ⇒ 该纹理很可能在 InitBundle 的某个 .ab 里（因为 InitBundle 是启动时加载的）
   ⇒ 但 InitBundle 里搜不到 512,512 特征 ⇒ 说明它也在压缩块内

★ 最实用的下一步：
   用 vfslist 导出 InitBundle 的 1075 个 .ab 的 (offset,len)，
   对每个 .ab 检查其【头部熵】，
   找出最可能是「未压缩纹理容器」的那些，
   再在其中找一个 len ≈ 262144 的段 ⇒ 直接等长替换
```

## 44.27.5 当前状态

```
target.json = []（hook 停用）
游戏干净运行
★ 离线路径的障碍已明确：.ab 内容是压缩的
★ 但【不是死路】：e2cd202a 的等长替换成功 ⇒ 说明存在可改区域
```

---

# 44.28 ★★★★ .ab 不是标准 Unity AssetBundle（第 80 轮）

## 44.28.1 搜索证据

```
在 InitBundle .chk（217 MB）里搜标准 Unity AssetBundle 头：
  UnityFS   → 0 处命中
  UnityWeb  → 0 处命中
  UnityRaw  → 0 处命中

⇒ 鹰角的 .ab 不是标准 Unity AssetBundle 格式
   要么是【自定义容器 + 整体压缩/加密】，要么头也被压缩了
```

## 44.28.2 ★★★ 与「有明文 asset 名字符串」的关系

```
已知事实：
  · .chk 里能看到明文 asset 名（如 SK_actor_endminf_introAvatar、Mesh_all/lod …）
  · 但搜不到 UnityFS 头
  · 也搜不到 Texture2D 的 512,512,262144 三连

⇒ 结论：.ab 是【混合结构】
   · 部分区域是【未压缩的元数据】（含 asset 名字符串）
   · 部分区域是【压缩的资产数据】（含 Texture2D 头 + 图像数据）
   · 这正是 e2cd202a 位置能等长替换成功的原因（它落在未压缩区）
   · 而纹理数据落在压缩区 ⇒ 不能直接搜索/替换
```

## 44.28.3 ★★★ 尺寸统计（InitBundle 1075 个 .ab）

```
len 恰好 = 262144          : 0 个
len 在 200KB ~ 400KB       : 18 个（都是 .ab 容器）
len 最大                    : 27,695,861 (27.7 MB)   ← 很可能是角色资源包
其次                        : 23,659,453 / 13,694,587 / 7,298,430 / 7,070,017
⇒ 没有「裸纹理」大小的条目 ⇒ 纹理都在容器内
```

## 44.28.4 ★★★★★ 战略评估（两条路都遇到了实质障碍）

```
【运行时路径】障碍：写入需要知道 buffer 大小 + 句柄生命周期
  · 已工作：只读 hook 稳定（81 次调用零崩溃）
  · 已失败：9 次写入尝试（全部是我的实现问题，已逐条归因）
  · 剩余工作量：
      ① hook vkCreateBuffer（需 post-call hook 拿输出参数）
      ② 建 (buffer → size) 表
      ③ 注入前校验 size >= 262144
      ④ 注入偏移用 bufferOffset
    ⇒ 可行，但需要更多轮次 + 试错

【离线路径】障碍：.ab 内容是压缩的 + 非标准格式
  · 已工作：定位到 e2cd202a 的未压缩区可等长替换（持久有效）
  · 已失败：搜不到 Texture2D 头 / 纹理数据
  · 剩余工作量：
      ① 逆向 .ab 的容器格式（自定义，无 UnityFS 头）
      ② 找到压缩块布局（LZ4 block？）
      ③ 实现解压/重压
      ④ 处理长度变化（更新 .blc offset/len）
    ⇒ 工作量更大，且格式未明
```

## 44.28.5 ★★★★★ 我的建议（按性价比排序）

```
[1] ★★★★★ 回到运行时路径，但严格按「只读先行」推进
    理由：
      · 运行时路径的【可观测性】已经建好（81 次调用的完整信息）
      · 只差「buffer 大小」这一个信息
      · vkCreateBuffer 的 post-call hook 是标准技术（保存 pBuffer 槽，
        下次调用时读回）—— 不需要改 SP，风险可控
    步骤：
      a) 只读 hook vkCreateBuffer ⇒ 收集 (buffer → size) 表
      b) 只读验证：确认 512×512 那个 buffer 的 size >= 262144
      c) 三确认通过后，注入 1 次（只 1 次！）
      d) 观察

[2] ★★ 继续离线路径的格式逆向
    · 先用 abtool 分析某个小 .ab（如 len=2458 的第一个）的结构
    · 找出压缩块的边界与格式
    ⇒ 工作量大但一劳永逸

[3] ★ 换目标：找「未压缩的纹理」
    · 遍历所有 .ab，找熵 6-7.5 且有结构的段
    · 可能有些纹理确实是 raw 存储的（尤其小纹理）
    ⇒ 但 512×512 目标未必是 raw
```

## 44.28.6 当前状态

```
target.json = []（hook 停用）
游戏干净运行
tombstone_01..09 保留
★ 两条路径的障碍都已明确，且都有可行的下一步
★ 我推荐 [1]（运行时 + 只读先行），因为可观测性已建好，只差一个信息
```
