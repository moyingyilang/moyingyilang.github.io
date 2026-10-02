---
title: 小度青禾 V20 内核编译实录：官方 KernelSU、驱动覆盖比对与救砖体系
description: 给一台百度 DuerOS 定制学生手机（Unisoc UMS9230 / T616）自编译内核的完整过程：如何用「驱动覆盖比对」判断一棵内核树能不能驱动目标设备、为什么 Termux 的 bionic 环境注定编不过内核主机工具、官方 KernelSU 为何必须退回 v0.9.5、SuSFS 摘除中的 #else 陷阱，以及围绕 GKI 启动结构（recovery 与系统共用内核）建立的救砖体系与 U-Boot 逆向初步结果。
date: 2026-10-02
updatedDate: 2026-10-02
category: android
tags:
  - Android
  - 内核
  - KernelSU
  - U-Boot
  - 逆向
  - Unisoc
  - 刷机
---

## 摘要

本文记录给一台百度 DuerOS 定制设备（小度青禾 V20，`xps06e`，展锐 UMS9230 / T616）
自编译 Android 内核的完整过程。三个核心结论：

1. **「这棵树能不能驱动我的机器」可以用数据回答**，不必先刷机试错；
2. **Termux 的 bionic 环境几乎不可能编过内核主机工具**，用 chroot 里的 glibc 环境
   才是正解；
3. **官方 KernelSU 从 v1.0 起已放弃 non-GKI 内核**，5.4 内核必须退回 `v0.9.5`。

最终产出：`Image` 29 MB + 177 个 `.ko`（140 MB），内核符号表里可见完整的 KernelSU
接口。同时完成了启动结构与救砖体系分析，并给出 U-Boot 逆向的初步结果。

---

## 设备信息

| 项 | 值 |
| --- | --- |
| 商品名 | 小度青禾 V20（Baidu Qinghe V20） |
| 型号 | xps06e / XD-SEE00-2301 |
| SoC | 展锐 UMS9230（T616），ARM64 |
| 平台 | `ums9230_1h10`（展锐公版参考设计） |
| 系统 | Android 12（SDK 31） |
| 内核 | Linux 5.4.161（non-GKI） |
| Root | Magisk（Alpha 分支 `io.github.vvb2060.magisk`） |
| Recovery | TWRP，装在 `vendor_boot` 的 recovery ramdisk 里 |

---

## 一、基座选型：用「驱动覆盖比对」替代试错

### 1.1 候选从哪里来

社区里针对 UMS9230 的开源内核树不止一棵。遍历 GitHub 后整理出这些候选：

| 仓库 | 分支 | 内核版本 |
| --- | --- | --- |
| `rifsxd/android_kernel_realme_RMX3511` | dev | 5.4.256-rev6 |
| `Bocchi-The-Dev/kernel_transsion_ums9230` | android12-5.4 | 5.4.302 |
| `Seuj09/android_kernel_ums9230_helix` | master | 5.4.254 |
| `Kyros70/android_kernel_ums9230` | master | 5.4.254 |
| `notedphy/android_kernel_ums9230` | ZTMY | 5.4.254 |
| `realme-kernel-opensource/android_kernel_realme_ums9230` | ums9230_v_15.0 | 5.15.178 |

### 1.2 比对方法

关键洞察：**设备上的 `/proc/config.gz` 就是一份现成的「硬件需求清单」**，
里面的 `=m` 对应实际加载的模块，`=y` 对应内置驱动。

于是比对分三步：

```bash
# 1) 从设备抓原始配置
adb shell 'su -c "zcat /proc/config.gz"' > device_config.txt

# 2) 在内核树里跑 olddefconfig（Kconfig 里不存在的符号会被丢弃）
make ARCH=arm64 olddefconfig

# 3) 求差集：设备有、树里没有 = 这棵树无法提供的驱动
comm -23 <(grep -oE '^CONFIG_[A-Z0-9_]+=m' device_config.txt | sort) \
         <(grep -oE '^CONFIG_[A-Z0-9_]+=m' .config | sort)
```

再补一步**按实际模块文件名比对**（因为 `.ko` 名字由 Makefile 决定，不一定等于配置项名）：

```bash
adb shell 'ls /vendor/lib/modules/*.ko' | xargs -n1 basename | sort -u > device_kos.txt
# 逐个到树的 Makefile 里找 obj-$(...) += <name>.o
```

### 1.3 结果

```
设备 .ko 总数                        112
树里能直接找到构建目标的              98
需处理命名差异 / 从 kernel_modules 接入 13
源码真正缺失                          1
```

**结论：所有开源 UMS9230 内核树本质是同一套展锐 BSP**（文件数都在 74,220 上下），
驱动覆盖完全一致。`aw87xxx` 音频功放在**所有**开源树里都不存在——它是 Awinic 的
第三方驱动，厂商各自私加。因此**换基座零收益**。

### 1.4 一个容易误判的坑

第一次比对时我用 `find -name "*aw87*"` 之类的**文件名匹配**，得出「大量驱动缺失」的
错误结论。实际上：

- `chipone_tddi_9916.ko`（触摸屏）→ 树里是 `drivers/input/touchscreen/chipone-tddi/`，
  编出来的 `.ko` 叫 `chipone-tddi.ko`，**驱动是有的，只是名字不同**；
- `sc7a20`、`mc34xx` 等传感器 → 源码在展锐的 `kernel_modules/` 暂存目录里
  （该目录默认**没有接入构建**，顶层 Kconfig/Makefile 都不引用它）。

**判定「驱动是否缺失」必须看源码，不能只看名字。**

---

## 二、构建环境：为什么 Termux 注定编不过

### 2.1 三个 bionic 特有的坑

Termux 用的是 Android 的 **bionic libc**，而内核主机工具是按 **glibc** 假设写的。
实测踩到：

**（1）`bcmp()` 不存在**

```text
scripts/kconfig/confdata.c:74: implicitly declaring library function 'bcmp'
ld.lld: error: undefined symbol: bcmp
```

`bcmp` 是 BSD 遗留函数，glibc 有、bionic 没有。改成语义等价的 `memcmp` 即可。

**（2）Termux 的 `linux/elf.h` 里有递归宏**

```c
/* /usr/include/linux/elf.h:111 */
#define ELF32_ST_TYPE(x) ELF_ST_TYPE(x)     /* 展开成自身 */
```

预处理器遇到自引用会停止递归，最终留下一个**未声明的函数调用**：

```text
scripts/sortextable.h:190: implicit declaration of function 'ELF32_ST_TYPE'
```

注意：因为该宏「确实已定义」，`#ifndef` 判断会跳过我们的定义。
**必须 `#undef` 后按 glibc 语义重定义**：

```c
#undef ELF32_ST_TYPE
#define ELF32_ST_TYPE(val) ((val) & 0xf)
```

**（3）内核 uapi 头与 bionic 的 libc 头系统性冲突**

这是真正无法用几个补丁糊过去的墙：

```text
./include/linux/types.h:112: typedef redefinition ('u64' vs '__uint64_t')
/usr/include/sys/types.h:54:  typedef redefinition ('unsigned long' vs 'u64')
/usr/include/sys/types.h:81:  ('__timer_t' vs '__kernel_timer_t')
/usr/include/sys/types.h:94:  ('uint64_t' vs '__kernel_dev_t')
/usr/include/sys/types.h:105: ('off_t' vs '__kernel_loff_t')
./include/linux/linkage.h:8: fatal error: 'asm/linkage.h' file not found
```

`u64` / `timer_t` / `dev_t` / `off_t` 在两边定义不同，且内核头还需要 arch 目录。
**这不是少量补丁能解决的。**

### 2.2 正解：chroot 进 glibc 环境

手机上装 Linux 容器最省事的是 **TMOE**，本机已有 Debian 12（bookworm）容器：

```bash
# 容器位置
~/.local/share/tmoe-linux/containers/chroot/debian-bookworm_arm64

# 关键：chroot 时不要继承 Termux 的 PATH，否则连 cat 都找不到
exec chroot "$R" /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root TERM=xterm LANG=C LC_ALL=C \
    /bin/bash -c "$*"
```

容器里环境：**glibc 2.36 + GCC 12.2.0（原生 aarch64）**，apt 配国内镜像。
补装依赖：

```bash
apt-get install -y device-tree-compiler cpio lz4 zstd xz-utils \
    libssl-dev libelf-dev libncurses-dev u-boot-tools ccache rsync zip unzip
```

再把内核源码 bind-mount 进容器即可：

```bash
mount --bind ~/android_kernel_realme_RMX3511 "$R/build"
```

### 2.3 一个 shell 层面的教训

用 `adb shell 'su -c "多行命令"'` 时，多层引号会在传递中丢失，
命令最终以 `uid=2000(shell)` 而非 root 运行——表现为「读不了块设备」这种
莫名其妙的现象。**稳妥做法是自提权脚本**：

```sh
#!/system/bin/sh
[ "$(id -u)" = "0" ] || exec su -c "sh $0 $*"
# 下面是真正需要 root 的逻辑
```

然后用最简单的 `adb shell "sh /data/local/tmp/script.sh"` 调用，彻底避开嵌套引号。

---

## 三、官方 KernelSU：为什么必须退回 v0.9.5

设备原本装的是 **SukiSU**（KernelSU 的一个 fork，自带 SuSFS 隐藏补丁）。
按需求要换成**官方 KernelSU** 并移除 SuSFS。

直接集成官方主线后，编译接连失败：

```text
drivers/kernelsu/feature/sucompat.c:8: linux/pgtable.h: No such file or directory
drivers/kernelsu/feature/sucompat.c:112: implicit declaration of 'strncpy_from_user_nofault'
drivers/kernelsu/hook/arm64/patch_memory.c:150: implicit declaration of 'copy_to_kernel_nofault'
drivers/kernelsu/manager/pkg_observer.c:39: 'struct fsnotify_ops' has no member named 'handle_inode_event'
```

逐个都是 **5.8+/5.9+ 才引入的 API**：

| 用到的 API | 引入版本 | 5.4 上的等价物 |
| --- | --- | --- |
| `linux/pgtable.h` | 5.8 | `asm/pgtable.h` |
| `strncpy_from_user_nofault` | 5.9 | `strncpy_from_unsafe_user` |
| `copy_to_kernel_nofault` | 5.8 | `probe_kernel_write` |
| `fsnotify_ops.handle_inode_event` | 5.9 | `fsnotify_ops.handle_event`（签名不同） |

修到第四个（fsnotify 签名完全不同，需要写适配层）时，我去翻了官方文档，看到了这句：

> ⚠️ **Since KernelSU v1.0, we have dropped official support for non-GKI devices.**
> The last supported version is **v0.9.5**.

**官方从 v1.0 起就放弃 non-GKI 内核了。**我们这棵 5.4 正是 non-GKI。
继续给主线打补丁是**方向性错误**。

换成官方 `v0.9.5` 后一次通过——它的 `kernel_compat.c` 里内建了版本守卫：

```c
#if LINUX_VERSION_CODE >= KERNEL_VERSION(5, 8, 0)
	return strncpy_from_user_nofault(dst, unsafe_addr, count);
#elif LINUX_VERSION_CODE >= KERNEL_VERSION(5, 3, 0)
	return strncpy_from_unsafe_user(dst, unsafe_addr, count);   /* ← 5.4 走这条 */
#else
	/* 4.9 的实现，含 set_fs() 用法 */
#endif
```

**这就是「官方 v0.9.5」与「官方主线」在 5.4 上的本质差别。**

---

## 四、SuSFS 摘除：一个 `#else` 引发的血案

### 4.1 定位改动范围

SuSFS 是 SukiSU 的隐藏补丁。第一次扫描我用 `grep -rl susfs`，
结果**漏掉了一半文件**——因为 SuSFS 在部分文件里**根本不含 "susfs" 字样**：

```c
/* fs/dcache.c 里的 SuSFS 代码，没有任何 susfs 字样 */
#ifdef CONFIG_KSU_SUSFS_SUS_PATH
    if (dentry->d_inode && unlikely(dentry->d_inode->i_state & 16777216) &&
        likely(current_cred()->user->android_kabi_reserved1 & 16777216)) {
        continue;
    }
#endif
```

它把标记藏在 Android 的 `android_kabi_reserved*` 字段和**魔数**
（`67108864` = 1<<26、`16777216` = 1<<24）里。

**可靠线索只有一个：`CONFIG_KSU_SUSFS`（大写）。**

最终定位到 18 个文件：15 个需摘除、3 个是 SuSFS 专属文件直接删除：

```text
fs/Makefile  fs/dcache.c  fs/devpts/inode.c  fs/inode.c  fs/namei.c
fs/namespace.c  fs/overlayfs/{inode,readdir,super}.c
fs/proc/{task_mmu,proc_namespace}.c  fs/readdir.c  fs/stat.c  fs/statfs.c
kernel/sys.c
+ 删除 fs/susfs.c  fs/sus_su.c  include/linux/susfs.h
```

### 4.2 `#else` 陷阱

第一版摘除器扫到 `#ifdef CONFIG_KSU_SUSFS_*` 就把到 `#endif` 的整块删掉。
编译后报：

```text
fs/namei.c:3146:13: error: 'error' undeclared (first use in this function)
```

回头看 SuSFS 块的原始形态：

```c
static int may_o_create(const struct path *dir, struct dentry *dentry, umode_t mode)
{
	struct user_namespace *s_user_ns;
#ifdef CONFIG_KSU_SUSFS_SUS_PATH
	int error;

	if (dentry->d_inode && unlikely(...)) {
		error = inode_permission(...);
		if (error) return error;
		return -ENOENT;
	}
	error = security_path_mknod(dir, dentry, mode, 0);
#else
	int error = security_path_mknod(dir, dentry, mode, 0);   /* ← 正常路径，被我一起删了 */
#endif
	if (error)
		return error;
```

**SuSFS 有些块是 `#ifdef / #else / #endif` 三段式，必须保留 `#else` 分支的内容。**

修正后的摘除器要点：扫描到 `depth == 1` 的 `#else` 时，保留其后的内容，
只丢弃 `#ifdef` 分支、`#else` 行和 `#endif`。

最终结果：**移除 325 行、正确保留 2 个 `#else` 分支**
（`fs/namei.c` 与 `fs/proc_namespace.c`）。

---

## 五、厂商代码里的那些坑

编译过程中被厂商私有代码拦下多次，逐个记录：

**（1）顶层 Makefile 硬编码 `-Werror`**

```make
# 厂商版本
KBUILD_CFLAGS := -Wall -Werror -Wundef -Werror=strict-prototypes ...
```

上游是把 `-Werror` 放在 `CONFIG_WERROR` 条件里的。硬编码导致展锐私有驱动里
任何一个格式串告警都会中断整个编译。恢复上游行为：

```make
KBUILD_CFLAGS := -Wall -Wundef -Werror=strict-prototypes ...
ifdef CONFIG_WERROR
KBUILD_CFLAGS += -Werror
endif
```

**（2）宏参数名与结构体成员名相同**

```c
#define zram_set_element(zram, index, element) (zram->table[index].element = element)
```

预处理器会把 `.element` 里的 `element` **也替换成宏参数**，于是
`zram_set_element(zram, index, blk_idx)` 展开成 `zram->table[index].blk_idx`，
报 `'struct zram_table_entry' has no member named 'blk_idx'`——报错信息极具误导性。

改参数名即可：`#define zram_set_element(zram, index, val) (...(val))`。

**（3）条件编译导致的重复成员**

```c
#ifdef CONFIG_ZRAM_WRITEBACK
	struct block_device *bdev;      /* 第一处 */
	unsigned int old_block_size;
	unsigned long nr_pages;
#endif
#if (defined CONFIG_ZRAM_WRITEBACK) || (defined CONFIG_HYBRIDSWAP_CORE)
	struct block_device *bdev;      /* 第二处，条件更宽 */
	unsigned int old_block_size;
	unsigned long nr_pages;
#endif
```

两个开关同时打开就 duplicate member。删掉第一处即可（第二处条件已覆盖）。

**（4）缺返回类型**

```c
static inline meminfo_show(struct hybridswap_stat *stat, char *buf, ssize_t len)
```

应为 `static inline ssize_t meminfo_show(...)`。

**（5）`#include <本地头文件>` 用了尖括号**

尖括号**不会搜索源文件所在目录**。6 个 Makefile 需要补 `ccflags-y += -I$(src)`：

```text
drivers/devfreq/sprd/          (<sprd_ddr_dvfs.h>)
drivers/gpu/drm/sprd/gsp/      ("gsp_core.h" 在父目录)
drivers/input/touchscreen/ili9882q/
drivers/soc/sprd/sfp/          (<sfp.h>)
drivers/usb/musb/              (<../../input/touchscreen/...>)
drivers/trusty/                (<trusty.h>)
```

注意 `drivers/usb/musb/Makefile` 里原本有 `CFLAGS_musb_trace.o := -I$(src)`，
但它**只对 `musb_trace.o` 生效**，对 `musb_sprd.o` 无效——需要全局的 `ccflags-y`。

---

## 六、`config.gz` 不是厂商真实的构建配置

编译到 MODPOST 阶段，报了一批**未定义符号**：

```text
ERROR: "get_hardware_info_data"   [sensorhub.ko / charger-manager.ko / ...] undefined!
ERROR: "hq_register_sensor_info"  [sensorhub.ko] undefined!
ERROR: "sgm4154x_charger_redetect"[musb_sprd.ko] undefined!
ERROR: "set_lcm_bias_voltage_*"   [sprd-drm.ko] undefined!
```

顺着符号找到提供者，发现**这些配置项在设备的 `/proc/config.gz` 里根本不存在**：

| 符号 | 提供者 | 配置项 | 设备配置里 |
| --- | --- | --- | --- |
| `get_hardware_info_data` | `drivers/misc/hqhardwareinfo/` | `HQ_HARDWARE_INFO` | 无 |
| `hq_register_sensor_info` | `drivers/misc/device_info/` | `OPLUS_DEVICE_IFNO` | 无 |
| `sgm4154x_charger_*` | `drivers/power/supply/sgm4154x_chg.c` | `CHARGER_SGM4154X` | 无 |
| `set_lcm_bias_voltage_*` | `drivers/input/lcd_bias/` | `LCM_BIAS_VOLTAGE_ON` | 无 |

**消费者开着、提供者全无——厂商自己也不可能编过。**

⇒ **设备上的 `/proc/config.gz` 只是厂商交付的一份近似配置，不是真实构建配置。**
这解释了为什么它和某棵内核树里的 `.config` 能逐字节相同（都是从设备抓的），
却依然编不过。

补齐这 4 项 + `SECTION_MISMATCH_WARN_ONLY` 后，编译通过。

---

## 七、编译结果

```text
arch/arm64/boot/Image    29 MB    Linux 5.4.256-rev6 aarch64, 4K pages
177 个 .ko               140 MB   vermagic=5.4.256-rev6 SMP preempt mod_unload modversions aarch64

KernelSU 符号（System.map）：
  ksu_handle_execveat     ksu_get_app_profile    ksu_set_app_profile
  __ksu_is_allow_uid      ksu_uid_should_umount  ksu_get_root_profile
```

包含的关键模块（与设备硬件对应）：

| 硬件 | 模块 |
| --- | --- |
| 触摸屏 | `chipone-tddi.ko`、`ilitek.ko` |
| 充电 | `sgm4154x_chg.ko`、`charger-manager.ko`、`sc2730_fast_charger.ko` |
| 传感器 | `sensorhub.ko`、`sc27xx_adc.ko` |
| 音频 | `snd-soc-sprd-codec-sc2730.ko` 等 10+ |
| 无线 | `sc2355_sdio_wlan.ko`、`sprd_wlan.ko`、`wcn_bsp.ko` |
| 存储 | `sdhci-sprd.ko`、`ufs-sprd_qogirl6.ko` |
| 指纹 | 5 家厂商（focaltech/jiiov/silead/nico/oplus） |

---

## 八、启动结构：一个必须先搞清的风险

刷机前把设备的分区结构摸清了（纯读取，零风险）：

| 分区 | 大小 | 实际内容 |
| --- | --- | --- |
| `boot_a` / `boot_b` | 64 MB | header v4：内核 38.3 MB + ramdisk 2.1 MB |
| `init_boot_a` / `init_boot_b` | 8 MB | **全 0，空分区** |
| `vendor_boot_a` / `vendor_boot_b` | 100 MB | platform ramdisk(空) + **recovery ramdisk 38 MB** + DTB |
| `dtb_a` / `dtb_b` | 8 MB | **全 0，空分区** |

`init_boot_a.img`、`init_boot_b.img`、`dtb_a.img`、`dtb_b.img` 四个文件的
**SHA256 完全相同**——设备声明了这些分区但根本没使用，真正的 DTB 放在
`vendor_boot` 里（`DTB_SZ = 162929`）。

`boot_a` 的 ramdisk 是 **Magisk 补丁版**：

```text
init                200 KB      ← magiskinit（替换了原始 init）
.backup/init.xz     888 KB      ← 原始 init（压缩保存）
.backup/.magisk     140 B
overlay.d/sbin/                 ← Magisk 官方自定义挂载点
```

`vendor_boot_a` 的 recovery ramdisk 解压后 89 MB / 3838 个文件，含 `twres/`、
`system/bin/twrp`、`twrp.flags`——确认是 **TWRP**。

### ⚠️ 由此推出的关键风险

**GKI 结构下 recovery 与系统共用 `boot` 分区里的内核。**
`vendor_boot` 只提供 ramdisk，内核来自 `boot`。所以：

> **如果新内核本身起不来，TWRP 也一起起不来。**

而且 A/B 双槽也救不了：`/dev/block/mapper/` 里**只有 `_a` 的逻辑分区**，
super 里没有 `_b` 的 system/vendor，B 槽没有可启动系统。

---

## 九、救援体系：只有 fastboot 和 BROM 能救内核级故障

按覆盖能力排序：

| 路径 | 前提 | 能救内核挂掉吗 |
| --- | --- | --- |
| **fastboot 刷回备份** | USB 接线 + bootloader 完好 | ✅ |
| BROM / FDL | 全砖也可 | ✅（最后手段） |
| TWRP（硬件键进入） | **内核能启** | ❌ |
| TWRP 的 adb shell + dd | **内核能启** | ❌ |
| Magisk 救砖模块（三击音量键） | **内核能启** + Magisk 加载 | ❌ |
| KernelSU + adb root | **内核能启** | ❌ |

后四条只能救「内核能启、系统层出问题」。

### 9.1 先备份

```bash
# 自提权脚本（避开多层引号陷阱）
for p in boot_a boot_b init_boot_a init_boot_b vendor_boot_a vendor_boot_b \
         dtb_a dtb_b dtbo_a dtbo_b vbmeta_a vbmeta_b vbmeta_system_a \
         vbmeta_system_ext_a vbmeta_vendor_a; do
    dd if=/dev/block/by-name/$p of=$OUT/$p.img bs=1M
done
sha256sum *.img > SHA256SUMS
```

15 个分区、381 MB，SHA256 全部校验通过。

### 9.2 bootloader 状态：注意伪装

`ro.boot.*` 属性可能被隐藏 root 的模块（如 Play Integrity Fix）**伪装**。
要看 `/proc/cmdline`——那是 bootloader 直传的，改不了：

```text
androidboot.flash.locked=0                  ← 真身：未锁定
androidboot.verifiedbootstate=orange        ← 真身：orange
androidboot.vbmeta.device_state=unlocked

而被伪装的 runtime 属性：
  ro.boot.flash.locked        = 1
  ro.boot.vbmeta.device_state = locked
  ro.boot.verifiedbootstate   = green
```

### 9.3 进入 bootloader 实测

`adb reboot bootloader` 与 `svc power reboot bootloader`（即 Magisk 应用内部执行的命令）
效果相同，底层是往 `misc` 分区写 BCB 命令：

```text
dd if=/dev/block/by-name/misc | strings
bootonce-bootloader
BCAB
```

该模式下设备枚举为 **`18d1:4ee8`**（Google VID），描述符：

```text
Interface 0: class ff  subclass 42  protocol 01   2 endpoints
Interface 1: class ff  subclass 00  protocol 00
Interface 2: class ff  subclass 00  protocol 00
Interface 3: class ff  subclass 00  protocol 00
```

Interface 0 的 `ff/42/01` 是 **ADB 协议**标识（fastboot 应为 `ff/42/03`），
但**实测 adb 与 fastboot 均无响应**。

好消息：该模式停留 1~5 分钟后设备会**自行重启回 Android**，不会永久卡死。

---

## 十、U-Boot 逆向：启动模式由 `miscdata` 决定

### 10.1 固件身份

```text
uboot_a / uboot_b   各 3 MB，SHA256 完全相同
头部 magic          "DHTB" (44 48 54 42)   ← 展锐 bootloader 容器格式
构建路径            /root/jenkins_build/workspace/DuerShow_T616/t616/bsp/bootloader/u-boot15/...
工具链              aarch64-linux-gnu-gcc (Linaro GCC 4.8-2015.06) 4.8.5
```

就是为 `DuerShow_T616`（本机）构建的**展锐 U-Boot 2015**。

### 10.2 启动模式选择

```text
bootcmd=cboot normal
bootdelay=0
preboot=role                       ← role 命令决定 uboot 扮 dloader 还是 cboot

cboot                              ← U-Boot 命令
recovery, fastboot, dloader, charge, normal, vlx, caliberation.
cboot;cboot fastboot               ← 用法：cboot <mode>

get_miscdata_boot_flag / set_miscdata_boot_flag
Detect the firsrt_mode flag in the miscdata partition
get mode from firstmode field: %s
first_mode=%x
```

⇒ **U-Boot 从 `miscdata` 分区的 `first_mode` 字段读启动模式**，
另有 `misc` 分区的 recovery 消息，以及一个 reset mode 寄存器/标志。

`miscdata` 分区（1 MB，`/dev/block/sda2`）结构初步 dump：

```text
偏移 0     "51PS<SN>"                        序列号
偏移 64    "<已隐去的设备 ID>"              另一组 ID
偏移 132   12 00 00 00                       计数 = 18
偏移 136   18 个 16 字节定长字符串（工厂测试模式名）：
           DOWNLOAD WRITESN BT FT BBAT MMIF SMTCHECK MMI1 AGING
           MMI2 ANTENNA CURRENT DUALCAME CAMEVFY AUDIO IMEI
           FRESET CHKIMEI
偏移 448   00 01 "PASS"
偏移 10016 "enabled" / "disabled" / "autoreboot-enable"
偏移 10112 "~~600WW"                         skuid
```

**这个分区在 Android 里是可写的**——如果能定位 `first_mode` 的精确偏移，
就可以不依赖 USB、不依赖按键，直接从系统里安排下一次启动进 fastboot。

### 10.3 U-Boot fastboot 的完整命令表

```text
   fastboot mode
getvar:   download:   is-userspace   max-download-size
flash:    erase:      powerdown
reboot-bootloader
reboot-fastboot          ← 支持在 fastboot 内重启回 fastboot
reboot-recovery
set_active:   setdump   getdump   flashing   getlcs   setrma   getsocid

OEM 命令：
  unlock_critical            get_unlock_ability
  get_unlock_bootloader_nonce
  unlock_bootloader          "Please firstly execute <fastboot oem get_identifier_token>"
  getsecurityversion         getversions      backupnv
```

`unlock_bootloader` 的完整交互提示（含音量键确认流程）都在固件里，
与 `/proc/cmdline` 的 `device_state=unlocked` 相互印证——
**这台机器的解锁就是用 U-Boot 的 fastboot OEM 命令做的**。

### 10.4 两套 VID/PID 都在 uboot 里

在 `uboot_a.img` 中按小端字节序列搜索：

```text
18 d1  (Google VID)   4 次        82 17  (Unisoc VID)   4 次
e8 4e  (PID)          4 次        03 40  (PID)          9 次
```

结合实测：正常 Android 是 `1782:4003`，bootloader 模式是 `18d1:4ee8`。

⇒ **`18d1:4ee8` 确实是 uboot 自己的模式**，但它的 Interface 0 是 ADB 协议标识
而非 fastboot 的，且两者都不响应——这与设备所有者「**uboot 被改过**」的说明一致，
推测是定制固件在此模式下实现了非标准协议。

### 10.5 逆向方法备注

`uboot_a.img` 的分析思路（供参考）：

```python
# DHTB 头：magic[4] + version[4] + sha256[32] + ... ⇒ 头 64 字节，载荷紧随其后
CODE_OFF = 0x40
CODE_SIZE = 0xe5c60

# 验证载荷是代码：数 RET(0xD65F03C0)
# 找指针表 → 反推加载基址：统计 8 字节值高 32 位的分布
#   ⇒ 大量值落在 0x9f0xxxxx，说明基址在这一带

# 交叉引用字符串：ARM64 用 ADRP+ADD / ADRP+LDR
#   ADRP: (instr & 0x9F000000) == 0x90000000
#         imm = sign_extend((immhi<<2)|immlo, 21) << 12
#         page = (PC & ~0xFFF) + imm         ← 注意 PC 必须页对齐
#   ADD : (instr & 0x7F000000) == 0x11000000 且 sf=1
```

> ⚠️ **性能提示**：这类逐字节扫描用 Python 跑几百万次会非常慢。
> 涉及大文件的全量扫描（几 MB × 几百万次迭代）应当改用 C 实现，
> 或至少用 `mmap` + `numpy`/`struct.iter_unpack` 批量处理。

---

## 十一、工具与命令速查

```bash
# 从设备抓内核配置
adb shell 'su -c "zcat /proc/config.gz"' > device_config.txt

# 驱动覆盖比对
comm -23 <(grep -oE '^CONFIG_[A-Z0-9_]+=m' device_config.txt | sort) \
         <(grep -oE '^CONFIG_[A-Z0-9_]+=m' .config | sort)

# 进入 Debian chroot（关键：重置 PATH）
exec chroot "$R" /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root TERM=xterm /bin/bash -c "$*"

# 编译
make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- -j10 Image modules

# 解包/重打包 boot 镜像（用设备上的 Magisk）
/data/adb/magisk/magiskboot unpack boot.img
/data/adb/magisk/magiskboot cpio ramdisk.cpio "ls"
/data/adb/magisk/magiskboot cpio ramdisk.cpio "exists .backup"   # Magisk 补丁标志

# 备份分区（自提权脚本方式，避开引号陷阱）
dd if=/dev/block/by-name/$p of=$OUT/$p.img bs=1M

# 真实 bootloader 状态（属性可能被伪装）
cat /proc/cmdline | tr ' ' '\n' | grep -E "flash.locked|verifiedbootstate|device_state"

# 进入 bootloader
svc power reboot bootloader
```

---

## 十二、后续待办

- [ ] **打包 `boot.img`**：把新内核 + TWRP 设备树给出的打包参数
      （header v4 / pagesize 4096 / kernel base 0x0 / ramdisk offset 0x05400000 /
      tags offset 0x100 / boot 64 MB / vendor_boot 100 MB / ramdisk LZ4）组合起来，
      **先只打包不刷写**
- [ ] **模块命名映射**：177 个模块与设备 `modules.load` 里的文件名不一致
      （如设备要 `sgm41510-charger.ko`，树里产出 `sgm4154x_chg.ko`）
- [ ] **移植 `aw87xxx` 音频功放驱动**（唯一确认缺失的驱动）
- [ ] **接入 `kernel_modules/`**（GPU / 传感器 / 相机 / 蓝牙 / FM）
- [ ] **定位 `miscdata` 的 `first_mode` 偏移**，实现「从系统内安排下一次启动进 fastboot」
- [ ] 补全 `docs/kernel-boot-and-rescue.md` 中的逆向细节

---

## 经验总结

1. **先比对，再动手。**「这棵树能不能驱动我的机器」可以用
   `config.gz` + 实际 `.ko` 列表回答，成本几乎为零，却能把「可能变砖」
   降级为「某个外设可能不工作」。
2. **认不清工具链的边界，会浪费大量时间。**在 bionic 上给内核主机工具打补丁
   是逆流而上；换一个 glibc 环境，问题一次性消失。
3. **官方文档里的一句话能省掉几天工作。**KernelSU 的 non-GKI 支持在文档里
   写得很清楚，早点看到就不必逐个 API 打补丁。
4. **厂商代码的报错信息可能严重误导。**「no member named 'blk_idx'」的真实原因
   是宏参数名与成员名冲突。
5. **不要相信设备上的配置文件。**`/proc/config.gz` 可能只是近似值。
6. **GKI 设备的 recovery 与系统共用内核**——这决定了「内核挂了」时
   哪些救援路径有效，必须在刷机前想清楚。

---

## 续篇：刷入、半瘫、失联

上一节停在「内核编好了」。之后发生的事比编译本身精彩得多，也更值得记下来。

### 一、找到了真正的 fastboot 入口

这台机器此前一直被认为「fastboot 不可用」——`adb reboot bootloader` 只能进到
`18d1:4ee8`，无论是 `fastboot` 还是 `adb` 都谈不进去，设备的特殊按键组合也失效。

翻设备的刷机工具包时发现一个 2048 字节的文件 `misc-fastbootd.bin`：

```
偏移 0x00   "boot-recovery"
偏移 0x40   "recovery\n--fastboot\n"
```

旁边还有对照样本 `misc-wipe.bin`（`recovery\n--wipe_data\n`，标准的恢复出厂）。

**`--fastboot` 是传给 recovery 的参数。** Android 的 `init` 会读 `misc` 分区的
BCB（Bootloader Control Block）：command 是 `boot-recovery` 就引导 recovery
ramdisk，而 recovery 收到 `--fastboot` 就启动 **fastbootd**（用户空间 fastboot）。

这是 **AOSP 自己的机制，跟 uboot 的 `cboot` 毫无关系**。

这解释了我此前逆向 uboot 时的困惑：`get mode from firstmode field: %s`、
`cboot;cboot fastboot` 这些字符串在整个 uboot 载荷里**找不到任何代码引用**，
而同区域的 `get_miscdata_boot_flag` 有 7 处。当时怀疑是代码被删了
（设备所有者用 Ghidra 分析也得出同样结论），现在明白了——**那条路径根本不在
uboot 里**。

操作只有三步：

```sh
dd if=misc-fastbootd.bin of=/dev/block/by-name/misc bs=2048 count=1 conv=fsync
sync
reboot
```

40 秒后：

```
Bus 001 Device 082: ID 18d1:4ee0
fastboot devices
→ <已隐去的序列号>     fastbootd
```

`fastbootd` 的能力：

```
product             xps06e
is-userspace        yes
max-download-size   0x10000000 (256 MB)
slot-count          2
可刷：boot / init_boot / vendor_boot / dtbo / vbmeta* / super
```

而且 BCB 是**一次性**的——进入 fastbootd 后 `misc` 前 2048 字节被自动清零，
`fastboot reboot` 能正常回到 Android。不会把设备锁死。

### 二、把内核塞进 boot 镜像

`magiskboot repack` 在这台设备上**会把 ramdisk 写坏**：我解包原始 boot、
替换 kernel、重新打包，再解包新镜像验证，发现 ramdisk 前 16 字节全是 0，
原始的是合法的 cpio magic `070701`。

于是改用**字节级原地替换**。boot 镜像 v4 的布局是顺序的：

```
header (4096) → kernel (页对齐) → ramdisk (页对齐) → …
```

新内核 29.7MB，原内核 38.3MB，**原地放得下**。只要写内核区、不动头部字段，
页对齐后的 ramdisk 起点就完全不变：

```sh
dd if=new_kernel of=boot.img bs=4096 seek=1 conv=notrunc
```

验证方法是拿补丁后的镜像和原始备份做 `cmp`：

```
kernel 区差异:        34,377,385 字节   ← 内核确实换了
ramdisk 及之后差异:               0 字节   ← 一字未动
```

（顺便踩了个对齐的坑：`kernel_size=38300160` **不是页对齐的**，
38300160/4096 = 9350.625，所以 ramdisk 实际在 `4096 + round_up(38300160,4096)`。）

### 三、模块：三个必须跨过的坎

内核换了，模块也必须换——`vermagic` 不匹配的话一个都加载不了。
把 177 个编出来的模块准备好，遇到三个坎。

**坎一：体积。** 编译时带了 `-g -gdwarf-4`，177 个模块**总共 140MB**，
而 `vendor_dlkm` 分区只有 **16MB**。

`strip --strip-debug` 之后：

```
zram.ko          771008 →    67160  (8%)
chipone-tddi.ko 5259296 →   703768 (13%)
总计             140.2MB →  12.4MB
```

`vermagic` 完好保留：`5.4.256-rev6 SMP preempt mod_unload modversions aarch64`。

**坎二：inode 不够。** `e2fsck` 一查：

```
vendor_dlkm: 137/144 files (0.0% non-contiguous), 4111/4124 blocks
```

**整个文件系统只有 144 个 inode**，而我们塞了 179 个模块。必须重建。

**坎三：journal 撑爆。** 默认 `mkfs.ext4` 会建 journal，16MB 的盘上光 journal
就吃掉 4MB，直接报 `Could not allocate block`。

看原始分区的 features 才发现关键：

```
Filesystem features: ext_attr dir_index filetype extent sparse_super large_file
                     huge_file uninit_bg dir_nlink extra_isize
                     ← 没有 has_journal
Reserved block count: 0
```

照抄这些参数重建，features 与原始**逐字一致**：

```sh
mkfs.ext4 -F -q -b 4096 -I 256 -N 600 -m 0 \
  -O ext_attr,dir_index,filetype,extent,sparse_super,large_file,huge_file,uninit_bg,dir_nlink,extra_isize \
  -O ^has_journal,^resize_inode,^64bit,^flex_bg,^metadata_csum \
  -L vendor_dlkm -d <模块目录> out.img
```

结果：`193/608 files, 3478/4210 blocks`。

还有个命名问题：设备用的 `modules.load` 里是厂商自己的名字，
`chipone_tddi_9916.ko`（触摸屏）和 `sgm41510-charger.ko`（充电），
而我们的编译产物叫 `chipone-tddi.ko` 和 `sgm4154x_chg.ko`。
做法是保留设备原始的 `modules.load`（依赖顺序是对的），
再为两处改名各做一份副本。

**为什么用 `mkfs.ext4 -d` 而不是挂载**：Android 侧 loop 挂载被 SELinux 拒绝
（`mount: Invalid argument`），chroot 侧 `/dev/losetup` 找不到空闲 loop
（Android 的在 `/dev/block/loopN`）。`mkfs.ext4 -d` 直接从目录填充文件系统，
**完全绕开挂载**。这是这次最有用的一个发现。

### 四、刷入：内核成功，系统半瘫

按「大小分治」的思路：`vendor_dlkm` 17MB 走 fastboot，`boot` 64MB 走 `dd`。

结果 fastboot 那边：

```
Sending 'boot_a' (65536 KB)  FAILED (Write to device failed in SendBuffer() (Success))
```

裁到 38.6MB 再试，还是失败。而且过程中还出现过 `< waiting for any device >`。

但 `dd` 那边**成功了**：

```
boot: 0966329ae04903b4c1ecc2550f3d9b6dac687be78f2bdda36c2b04374571cd2e
期望: 0966329ae04903b4c1ecc2550f3d9b6dac687be78f2bdda36c2b04374571cd2e   ✓
```

而 `vendor_dlkm` 写不进去——即使是 `/dev/block/mapper/vendor_dlkm_a` 也不行：

```
dd if=vendor_dlkm_new.img of=/dev/block/mapper/vendor_dlkm_a bs=1M
→ 0+0 records out / 0 bytes copied
```

卸载 `/vendor_dlkm` 之后再写，还是 0 字节。**是 dm 层（只读映射）拒绝的。**

于是设备进入了**最坏的中间状态**：新内核 + 旧模块 → 重启后系统半瘫。

实测确实如此：**界面能用（说明内核启动成功），但设置崩溃、WiFi 没有**。
原因是设备的 112 个 vendor 模块全是 `5.4.161`，与 `5.4.256` 内核不匹配。

KernelSU 那边我原本以为的「刷自编译内核是单向门」也不成立了——
但这次暴露了另一个更隐蔽的风险：**`vendor_dlkm` 与 `boot` 必须同进同退。**

### 五、第一次回滚：dd 救场

好在备份是**两份**（设备上一份、主机上一份），而且 `dd` 被证明可靠：

```sh
su
dd if=/data/local/tmp/f4d_backup/boot_a.img of=/dev/block/by-name/boot_a bs=1M
sync
reboot
```

设备完全恢复：

```
USB: 1782:4003          ✓
ping: 0% packet loss    ✓ WiFi 回来了
无线 adb: device        ✓
uname -r: 5.4.161-...   ✓ 原厂内核
```

**备份救了一切。** 这一步验证了一个重要事实：`boot` 分区可以直接从 Android
内部 `dd` 写，完全绕开那条不稳的 USB 链路。

### 六、失联

第二次尝试想走 fastbootd 只刷 `vendor_dlkm`（17MB，比失败的 39MB 小一半）。
写 BCB、重启之后——

**设备再也没有出现在 USB 上。**

```
/dev/bus/usb/001/  只有 001（根 hub）
/dev/bus/usb/002/  只有 001（根 hub）
```

网络也不通。而主机侧一切正常（WiFi 正常、USB 子系统正常）。

**这个现象的判断价值在于**：展锐的 BROM 在 SoC 的掩膜 ROM 里，
内核崩了、uboot 崩了、boot 分区全毁了，**BROM 依然会枚举**。
它此前确实出现过（`1782:4d00`，还成功握手到 `BSL_REP_VER: "SPRD3"`）。
连 BROM 都不出现 ⇒ **问题在物理层，不在软件层。**

回头看，所有怪现象其实是一条线索：

```
64MB fastboot 传输    → SendBuffer() 失败
39.5MB 裁剪后         → 同样失败
BROM 握手             → CMD_CONNECT bootrom 成功，紧接着数据收发必失败
fastboot              → < waiting for any device >
最终                  → 设备完全从总线上消失
```

而同一条链路上**小传输一直正常**（`getvar` 全部秒回）。
**不是协议问题，是链路质量。**

### 七、这次真正学到的东西

**1. 「能进 fastbootd」不等于「能刷」。** 我验证了 fastbootd 可以进入、
可以识别设备、可以读变量——就以为救援通路通了。但真正刷写需要的
是**几十 MB 的可靠传输**，那是完全不同量级的要求。

**2. USB 链路质量是隐形杀手。** 握手成功给人极大的虚假安全感。
真正该测的是「能不能稳定传完一个 64MB 的镜像」，而不是「能不能 `getvar`」。

**3. Android 作为 USB 主机刷展锐设备不可靠。** 设备所有者此前在
Windows + QIKU 驱动上跑通过完整流程，因为厂商驱动层代劳了 BROM 的
模式切换——而这正是 libusb 路径缺失的一环。

**4. `vendor_dlkm` 与 `boot` 必须同进同退。** 单独刷任何一个都会让系统半瘫。

**5. 备份要两份，而且要在不同的物理介质上。** 设备内一份方便 `dd` 回滚，
主机上一份防止设备完全失联。

**6. `mkfs.ext4 -d` 是处理镜像的利器。** 不想、不能、或者懒得挂载时的首选。

**7. 逆向时找不到引用，先怀疑「这段代码不在这里」，而不是「代码被删了」。**
我在 uboot 里翻遍了载荷找 `--fastboot` 的处理逻辑，最后发现它压根不在 uboot
——是 Android 的 `init` 在读 BCB。

### 八、接下来

设备目前的状态是「够不着」而不是「弄坏了」：

```
boot_a   ← 自编译内核 5.4.256-rev6
misc     ← fastbootd 的 BCB

uboot / splloader / vendor_boot / vbmeta / super / userdata  ← 全部完好
```

数据无损，没有任何分区损坏。缺的只是一条能说话的线。

恢复路径已经备好：用设备所有者验证过的 Windows + QIKU 驱动环境，
按「只读验证 → 清 BCB → 写回 boot」三步走，每步都用最小的写入量试探链路。

而下次刷机前必须先补完模块——尤其是 `mali_kbase`（GPU）。
这些驱动在厂商源码里是 `kernel_modules/` 下**用 Soong 在树外编译**的
（设备原厂配置里连 `MALI_MIDGARD` 符号都没有），但目录里有完整的
Kbuild/Makefile，可以用 `make M=` 树外编出来。

> 编译那部分的故事是顺利的。真正难的从来不是「能不能编出来」，
> 而是「编出来之后，怎么安全地送到设备上，以及送错了怎么回来」。
