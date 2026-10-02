---
title: 小度青禾 V20 救砖操作单：从展锐 BROM 写回 boot
description: 一台 Unisoc UMS9230 设备（小度青禾 V20）刷入自编译内核后系统半瘫、二次尝试时 USB 链路失效导致失联。这份操作单记录已被改动的内容、当前设备状态、以及用展锐 BROM/FDL 从 Windows 环境写回 boot 的完整三步流程，附每一层兜底手段。
date: 2026-10-02
updatedDate: 2026-10-02
category: android
tags:
  - Unisoc
  - 展锐
  - 救砖
  - BROM
  - spd_dump
  - fastbootd
---

## 一、设备现在到底什么状态

### 只被改动了两个分区

| 分区 | 现在的内容 |
| --- | --- |
| `boot_a` | 自编译内核 `5.4.256-rev6`（原始 ramdisk 未动，仍是 Magisk 补丁版） |
| `misc` | fastbootd 的 BCB：`boot-recovery` + `recovery\n--fastboot\n` |

### 其余全部完好

```
uboot_a / uboot_b              未动
splloader / splloader_bak      未动
vendor_boot_a / _b             未动（TWRP 仍在）
init_boot_a / _b               未动（本来就是空的）
dtbo_a / _b                    未动
vbmeta*                        未动
super（system/vendor/…）       未动
userdata                       未动
vendor_dlkm_a                  未动
```

**没有任何分区损坏，数据完好。** 现在的状态是「够不着」，不是「弄坏了」。

### 为什么够不着

```
USB     设备完全不出现在总线上（主机只剩两个根 hub）
网络    <已隐去的内网地址> 不响应
```

判断依据：**展锐 BROM 在 SoC 的掩膜 ROM 里**，内核崩了、uboot 崩了、
boot 分区全毁了，BROM **依然会枚举**。它此前确实出现过（`1782:4d00`，
还成功握手到 `BSL_REP_VER: "SPRD3"`）。现在连 BROM 都不出现
⇒ **问题在物理层。**

而这条链路的失效其实早有征兆：

```
64MB fastboot 传输   → SendBuffer() 失败
39.5MB 裁剪后        → 同样失败
BROM 握手            → CMD_CONNECT bootrom 成功，紧接着数据收发必失败
fastboot             → < waiting for any device >
最终                 → 设备彻底从总线上消失
```

同一条链路上**小传输一直正常**（`getvar` 全部秒回）。
**不是协议问题，是链路质量。**

## 二、为什么必须换 Windows 主机

设备所有者此前在 Windows + QIKU 驱动 + `spd_dump.exe` 上**跑通过完整流程**。
原因是厂商驱动层代劳了 BROM 的模式切换——而这正是 libusb 路径缺失的一环。

Android 主机（Redmi + Termux + `spd_dump` 的 aarch64 静态构建）虽然**二进制能跑**：

```
ver:229, sha1:ad0ce43b210ebd0e0ffc4e436b0f350922304a3f
libusb_control_transfer ok
CHECK_BAUD bootrom
BSL_REP_VER: "SPRD3\0"
CMD_CONNECT bootrom
current exec_addr is 0x65015f08
usb_send failed : LIBUSB_ERROR_TIMEOUT
```

协议层是通的，但**数据传输阶段撑不住**。所以这条路先放弃，换 Windows。

## 三、需要带的文件

```
boot_a.img                     67 MB  原始 boot 备份（恢复用）
ums9230_Baidu_Qinghe_V20.zip   1.4 MB FDL loader + BROM 利用 payload + 原始脚本
spd_dump.exe（或新版 spd_dump）        主机端程序
QIKU 驱动 / 紫光驱动                    Windows 驱动
```

`ums9230_Baidu_Qinghe_V20.zip` 解开后的关键内容：

```
fdl1-dl.bin                        FDL1 loader
fdl2-dl.bin                        FDL2 loader
custom_exec_no_verify_65015f08.bin BROM 签名绕过 payload
unlock_autopatch_9230.bat          原始解锁脚本（可参考参数）
misc-wipe.bin
spd_dump.exe
```

## 四、救援三步（每步都用最小写入量试探）

### 第一步：只读验证通路

```bat
spd_dump --wait 300 exec_addr 0x65015f08 ^
  fdl fdl1-dl.bin 0x65000800 ^
  fdl fdl2-dl.bin 0x9efffe00 ^
  exec read_part miscdata 8192 64 m.bin
```

参数含义：

| 参数 | 含义 |
| --- | --- |
| `--wait 300` | 等待设备进入 BROM（秒） |
| `exec_addr 0x65015f08` | CVE-2022-38694 的 BROM 利用地址 |
| `fdl fdl1-dl.bin 0x65000800` | 加载 FDL1 到该地址 |
| `fdl fdl2-dl.bin 0x9efffe00` | 加载 FDL2 到该地址 |
| `read_part miscdata 8192 64` | 读 miscdata 偏移 8192 处 64 字节 |

**读到内容 = 通路活，继续。读不到 = 先解决 USB 物理连接。**
这一步不写任何东西。

### 第二步：清 `misc` 的 BCB（2KB）

BCB 若残留 `boot-recovery`，设备会持续尝试进 recovery/fastbootd。先清零：

```bat
fsutil file createnew misc-zero.bin 2048
spd_dump --wait 300 exec_addr 0x65015f08 ^
  fdl fdl1-dl.bin 0x65000800 ^
  fdl fdl2-dl.bin 0x9efffe00 ^
  exec w misc misc-zero.bin reset
```

### 第三步：写回原始 `boot`

```bat
spd_dump --wait 300 exec_addr 0x65015f08 ^
  fdl fdl1-dl.bin 0x65000800 ^
  fdl fdl2-dl.bin 0x9efffe00 ^
  exec w boot boot_a.img reset
```

写完重启，设备应回到刷机前的状态（原厂内核 + 原厂模块）。

## 五、若 BROM 也进不去：四级兜底

按优先级：

**1. 充电半小时以上**
之前反复进出 BROM / fastbootd 很耗电。电量见底时 USB 控制器可能不枚举。

**2. 换线、换 OTG 转接头**
这条链路的失效是间歇性的，高度指向接触不良。

**3. BROM 键组合**
关机状态下按住不放**再插 USB**：
- 音量+
- 音量−
- 音量+ 和 音量− 同时
- 音量+ 与电源键同时

每种按住 10 秒以上。成功时设备管理器会出现新的端口设备。

**4. USB 测试点（硬件级强制进 BROM）**
短接测试点后上电，SoC 会强制停在 BootROM——
**无论 boot 分区什么状态都能进**。需要点位图，是最后的兜底，但最可靠。

## 六、顺便记录：fastbootd 的真正入口

这次排查中最有价值的发现，值得单独记下来。

这台机器长期被认为「fastboot 不可用」——`adb reboot bootloader` 只能进到
`18d1:4ee8`，`fastboot` 和 `adb` 都谈不进去。真相是 **`misc` 分区的 BCB**：

`misc-fastbootd.bin`（2048 字节）：

```
偏移 0x00   "boot-recovery"
偏移 0x40   "recovery\n--fastboot\n"
```

对照样本 `misc-wipe.bin` 是 `recovery\n--wipe_data\n`（标准恢复出厂）。

**`--fastboot` 是传给 recovery 的参数**，Android 的 `init` 读 BCB 后引导
recovery ramdisk，recovery 收到该参数即启动 **fastbootd**（用户空间 fastboot）。
这是 **AOSP 自己的机制，与 uboot 的 `cboot` 无关**。

写入方式：

```sh
dd if=misc-fastbootd.bin of=/dev/block/by-name/misc bs=2048 count=1 conv=fsync
sync
reboot
```

约 40 秒后：

```
Bus 001 Device 082: ID 18d1:4ee0
fastboot devices
→ <已隐去的序列号>     fastbootd
```

`fastbootd` 能力：

```
product             xps06e
is-userspace        yes
max-download-size   0x10000000 (256 MB)
slot-count          2
可刷：boot / init_boot / vendor_boot / dtbo / vbmeta* / super
```

BCB 是**一次性**的——进入 fastbootd 后 `misc` 前 2048 字节自动清零，
`fastboot reboot` 能正常回 Android，不会锁死。

> **但要记住这次的教训：能进 fastbootd ≠ 能刷。**
> 进入、识别、读变量全部成功，真正刷写需要的却是几十 MB 的**可靠**传输。
> 那是完全不同量级的要求。

## 七、下次刷机的正确姿势

```
1. 先补齐缺失的模块（至少 mali_kbase，GPU）
2. 重建 vendor_dlkm 镜像
3. 确保设备与主机之间有稳定通路（强烈建议 Windows）
4. vendor_dlkm 与 boot 必须同进同退
```

**绝对不要单独刷 `boot`** —— 那正是这次系统半瘫的原因：
内核 5.4.256 + 模块 5.4.161，vermagic 不匹配，一个模块都加载不了。

补充一个实测结论：`vendor_dlkm` 是 dm 层只读映射，
**从 Android 内部 `dd` 写入会得到 0 字节**（即使先 `umount` 也一样），
只能用 fastbootd 刷。而 `boot` 可以直接从 Android 内部 `dd` ——
这次的第一次回滚就是这么成功的。

## 八、这次踩过的三个工程细节

**1. `magiskboot repack` 会把 ramdisk 写坏。**
解包原始 boot、换 kernel、重新打包后，新镜像里的 ramdisk 前 16 字节全是 0
（原始的应是 cpio magic `070701`）。改用**字节级原地替换**：boot 镜像 v4 是
顺序布局 `header → kernel → ramdisk → …`，新内核比原内核小，直接写在原位置，
页对齐后的 ramdisk 起点不变，连头部字段都不用改。

```sh
dd if=new_kernel of=boot.img bs=4096 seek=1 conv=notrunc
```

用 `cmp` 验证：

```
kernel 区差异:        34,377,385 字节
ramdisk 及之后差异:               0 字节
```

（坑中坑：`kernel_size=38300160` 不是页对齐的，38300160/4096 = 9350.625，
所以 ramdisk 在 `4096 + round_up(38300160, 4096)`。）

**2. 模块必须 strip，而且原文件系统 inode 不够。**
编译带 `-g` 时 177 个模块**总计 140MB**，而 `vendor_dlkm` 分区只有 16MB。
`strip --strip-debug` 后降到 **12.4MB**（zram 8%、chipone 13%），vermagic 保留。

而 `e2fsck` 显示原文件系统：

```
vendor_dlkm: 137/144 files, 4111/4124 blocks
```

**只有 144 个 inode**，我们有 179 个模块 ⇒ 必须重建。而默认 `mkfs.ext4`
会建 journal，16MB 的盘直接爆掉。原始分区**没有 `has_journal`**、
`reserved block count = 0`，照抄才成功：

```sh
mkfs.ext4 -F -q -b 4096 -I 256 -N 600 -m 0 \
  -O ext_attr,dir_index,filetype,extent,sparse_super,large_file,huge_file,uninit_bg,dir_nlink,extra_isize \
  -O ^has_journal,^resize_inode,^64bit,^flex_bg,^metadata_csum \
  -L vendor_dlkm -d <模块目录> out.img
```

`mkfs.ext4 -d` 直接从目录填充，**不需要挂载** —— 在 Android 侧 loop 挂载被
SELinux 拒绝、chroot 侧找不到空闲 loop 的情况下，这是唯一的出路。

**3. 命名要迁就设备的 `modules.load`。**
设备里叫 `chipone_tddi_9916.ko`（触摸屏）、`sgm41510-charger.ko`（充电），
而编译产物叫 `chipone-tddi.ko`、`sgm4154x_chg.ko`。
做法是保留设备原始的 `modules.load`（依赖顺序是对的），再各做一份改名副本。

## 九、最后

这次唯一的失误是**在救援通路没有真正验证过的情况下就动了 `boot`**。

「fastbootd 能进、能识别、能读变量」给人很强的虚假安全感，
但真正该测的是：**能不能稳定传完一个 64MB 的镜像。**

而备份救了这一切——两份备份（设备内一份方便 `dd`，主机上一份防止失联），
第一次回滚一次就成功。**这个习惯值得保持。**
