---
title: Fuck4DuerOS 项目总结
description: 一台百度 DuerOS 定制学生手机的完整取证与净化记录：预置 PCDN 组件与 Xray 采集 SDK、通讯劫持组件、services.jar 框架层注入与 HOME 拦截，以及用 Magisk 模块与 hosts 完成清理；附音频调度、内存诊断与 U-Boot 分析。
date: 2026-10-01
category: android
tags:
  - Android
  - Magisk
  - 隐私
  - PCDN
  - 刷机
  - DuerOS
---

> **范围与依据**：本文基于对**自购**的一台小度学生手机（XD-SEE00-2301）的实际取证与修改，所有结论只对该型号与该固件版本负责。项目已以 AGPL-3.0 开源：[moyingyilang/Fuck4DuerOS](https://github.com/moyingyilang/Fuck4DuerOS)。

百度 DuerOS 定制 Android 设备（小度学生手机 XD-SEE00-2301）的逆向取证、净化与优化全过程记录。

## 📱 设备信息

| 项目 | 值 |
| --- | --- |
| 品牌 | 小度（Xiaodu） |
| 型号 | XD-SEE00-2301 |
| 平台 | 紫光展锐 UMS9230（T616） |
| CPU | 2×Cortex-A75 + 6×Cortex-A55 |
| GPU | Mali-G57 MP1（最高 750 MHz） |
| 内存 | 5.6 GB 物理 + 11 GB Swap |
| 存储 | UFS（健康度 `0x01`，已用 0–10%） |
| 系统 | DuerShow_T616_v1.65.0（Android 12 / SDK 31） |
| 内核 | Linux 5.4.161（GKI 1.0） |
| 分区 | A/B 双分区 + `vendor_boot` + `vendor_dlkm` |

## 🔍 一、取证与发现

### 1.1 PCDN 组件

发现路径：

```text
/system/app/PCDN/PCDN.apk
/system/app/PCDN/lib/arm/libpcdn.so
/system/app/PCDN/lib/arm/libpcdnsdk.so
/system/app/DuerShowSwan/lib/arm64/libcyber-pcdn.so
/system/app/DuerShowMedia/lib/arm64/libcyber-pcdn.so
/system/app/DuerShowLauncher/lib/arm64/libcyber-pcdn.so
```

行为特征：

- 以 `system`（uid 1000）权限常驻
- 由 `com.baidu.duer.ota` 通过 `LOCKED_BOOT_COMPLETED` 拉起
- 具备双向 P2P 传输能力（`P2pDownloader`）
- 配套 **Xray SDK**（全链路数据采集：HTTP／WebView／SQLite／OkHttp／电量／崩溃）
- 类名混淆 `com.a.a.a.a.a.a` 规避识别
- **禁用后自动恢复**

### 1.2 通讯劫持组件

百度桌面（`com.baidu.launcher`）注册了以下组件拦截通讯：

```text
ContactsControlService
CallPhoneActivity
TelecomCallVoltePhoneActivity
SelectDefaultPhoneActivity
SmsLoginActivity
PrismStatusReiver
```

### 1.3 系统框架层注入

`services.jar` 中注入的百度类：

```text
com.android.server.baidu.AppOpsUtils
com.android.server.baidu.DuerSystemConfigManager
com.android.server.baidu.DuerService（100+ 方法）
com.android.server.baidu.DuerLocalServiceIntf
com.baidu.am.ActivityStackMonitor（多任务拦截）
com.baidu.am.BroadcastBlocker
com.baidu.am.AppProcessController
com.baidu.pm.PreloadAppController
```

### 1.4 HOME 拦截机制

`ActivityStackMonitor.filterBlockedResolveInfo()` 中的白名单：

```java
VALID_LAUNCHER_APPS = [
    "com.sprd.powersavemodelauncher",
    "com.android.managedprovisioning",
    "com.android.provision",
    "com.baidu.duershowprovison",
    "com.baidu.launcher",
    "com.android.settings"
]
```

非白名单的 HOME 候选会被移除。

### 1.5 U-Boot 按键失效根因

`FUN_00005858` 汇编逻辑：

```asm
cmp w4, #1
b.le LAB_00005908        ; w4 <= 1 → 返回 -1（跳过按键检测）
tbz w1, #0, LAB_00005880
cmp w4, #2
b.eq LAB_0000590c        ; w4 == 2 → 返回（跳过）
```

`w4` 来自 `param_11 - 1`，`param_11` 是上层传入的「启动模式」值。

## 🛠️ 二、净化成果

### 2.1 Magisk 模块 duer_cleanup

目录结构：

```text
/data/adb/modules/duer_cleanup/
├── module.prop
├── service.sh
└── system/
    ├── app/
    │   ├── PCDN/.replace
    │   ├── Duerguard/.replace
    │   ├── GoodFather_DuerPhone/.replace
    │   ├── BaiduVoiceInput/.replace
    │   ├── SearchQuestion/.replace
    │   ├── DuerShowSwan/lib/arm64/libcyber-pcdn.so  (0 字节)
    │   ├── DuerShowMedia/lib/arm64/libcyber-pcdn.so (0 字节)
    │   └── DuerShowLauncher/lib/arm64/libcyber-pcdn.so (0 字节)
    ├── priv-app/
    │   ├── DuerShowStatistic/.replace
    │   └── DuerShowOTA/.replace
    └── etc/hosts
```

已禁用组件：

```text
com.baidu.pcdn
com.baidu.duerguard
com.baidu.duer.ota
com.baidu.duershow.statistic
com.goodfather.textbook.pad
com.baidu.duer.appstore
com.baidu.baidutranslate
com.baidu.input
com.baidu.atomkit
com.baidu.duer.aieye.searchquestion
com.baidu.duer.aieye.image.preprocessing
com.baidu.duer.aieye.correction
com.baidu.duer.superapp
```

已禁用通讯组件：

```text
com.baidu.launcher/com.baidu.duer.child.service.ContactsControlService
com.baidu.launcher/com.xiaoyu.communication.activity.CallPhoneActivity
com.baidu.launcher/com.xiaoyu.communication.telecom.TelecomCallVoltePhoneActivity
com.baidu.launcher/com.xiaoyu.communication.activity.global.SelectDefaultPhoneActivity
com.baidu.launcher/com.baidu.duer.account.sms.SmsLoginActivity
com.baidu.launcher/com.baidu.duer.prism.PrismStatusReiver
```

### 2.2 hosts 屏蔽

```text
127.0.0.1 pcdn.baidu.com
127.0.0.1 xray.baidu.com
127.0.0.1 duer.baidu.com
127.0.0.1 dueros.baidu.com
127.0.0.1 ota.baidu.com
127.0.0.1 statistic.baidu.com
127.0.0.1 ag.baidu.com
127.0.0.1 mobads.baidu.com
127.0.0.1 pos.baidu.com
127.0.0.1 cpro.baidu.com
127.0.0.1 union.baidu.com
127.0.0.1 dup.baidustatic.com
127.0.0.1 dudulu.duer.baidu.com
127.0.0.1 duer-static.baidu.com
127.0.0.1 duer.baidu.com.cn
127.0.0.1 dueros-h2.baidu.com
127.0.0.1 duer-ota.baidu.com
```

### 2.3 开机脚本

`/data/adb/service.d/fuck4duerOS.sh`：等待 `sys.boot_completed` 后延迟 15 秒执行全部禁用操作，日志输出到 `/data/local/tmp/fuck4duerOS.log`。

### 2.4 已解决的问题

| 问题 | 状态 |
| --- | --- |
| 通讯限制 | ✅ 已解除 |
| PCDN 进程 | ✅ 已停止 |
| PCDN 库文件 | ✅ 已覆盖为 0 字节 |
| Duerguard | ✅ 已禁用 |
| GoodFather 家长控制 | ✅ 已禁用 |
| 百度桌面通讯劫持 | ✅ 已禁用 6 个组件 |
| 拨号／短信 | ✅ 恢复系统原生 |
| hosts 屏蔽 | ✅ 已生效 |

### 2.5 未解决的问题

| 问题 | 原因 |
| --- | --- |
| 多任务（QuickStep） | Lawnchair 15/16 在 Android 12 上崩溃 |
| U-Boot 按键修复 | 未完成（已分析清楚，待 patch） |
| `services.jar` 修改 | 一次改 9 个方法导致 bootloop，已回退 |
| 内核编译 | Termux 环境工具链不兼容 |
| 蓝牙发射功率 | 未实施 |

## 📂 三、开源项目

- 仓库：<https://github.com/moyingyilang/Fuck4DuerOS>
- 协议：AGPL-3.0

```text
Fuck4DuerOS/
├── README.md
├── LICENSE (AGPL-3.0)
├── CONTRIBUTING.md
├── DISCLAIMER.md
├── .gitignore
├── docs/
│   ├── technical-report.md      (422 行)
│   ├── legal-basis.md           (145 行)
│   └── plain-language.md        (212 行)
├── scripts/
│   ├── check.sh                 (89 行)
│   ├── fuck4duerOS.sh           (90 行)
│   ├── install.sh               (155 行)
│   └── rollback.sh              (36 行)
├── modules/duer_cleanup/        (完整模块)
├── evidence/
│   ├── device-xd-see00-2301/
│   │   ├── process/processes.txt
│   │   ├── packages/enabled.txt
│   │   ├── packages/disabled.txt
│   │   ├── services/services.txt
│   │   └── apps/system_apps.txt
│   ├── reports/*.docx
│   ├── pcdn_backup_README.md
│   └── README.md
└── .github/ISSUE_TEMPLATE/
    ├── bug_report.md
    └── device_report.md
```

## ⚖️ 四、法律依据

| 法律 | 条款 | 对应事实 |
| --- | --- | --- |
| 《消费者权益保护法》 | 第 8 条 | PCDN 未经告知预置 |
| 《消费者权益保护法》 | 第 10 条 | 占用用户上行带宽 |
| 《个人信息保护法》 | 第 13 条 | Xray 采集数据未获同意 |
| 《个人信息保护法》 | 第 17 条 | 无显著告知 |
| 《网络安全法》 | 第 22 条第 3 款 | 信息收集未明示 |
| 《网络安全法》 | 第 41 条 | 超出必要原则 |
| 《电信条例》 | 第 7 条、第 8 条 | 未许可从事电信业务 |
| 《未成年人保护法》 | 第 72 条 | 未成年人设备未征得监护人同意 |
| 《民法典》 | 第 1165 条、第 1167 条 | 构成侵权 |

> 以上为作者基于公开法条的理解与梳理，**不构成法律意见**。

## 🎵 五、音频调度优化

### 问题

切屏时后台音乐卡顿、出错。

### 根因

Termux PulseAudio 的音频线程（`AudioTrack`）是 **TS（普通调度）**，而 `zsh` 和 pulseaudio 主线程是 **RT（实时调度）**，RT 线程一跑就抢占 TS 音频线程。

### 解决方案

**1. 优化 PulseAudio 配置**

`~/.config/pulse/daemon.conf`：

```ini
high-priority = yes
realtime-scheduling = yes
realtime-priority = 9
default-fragments = 3
default-fragment-size-msec = 15
flat-volumes = no
exit-idle-time = 180
```

**2. 手动提升线程优先级**

```bash
su
PA_PID=$(pgrep -f pulseaudio | head -1)

# 主线程 RT 20
chrt -f -p "$PA_PID" 20

# 音频数据线程 RT 10
for tid in $(ls /proc/$PA_PID/task/); do
    comm=$(cat /proc/$PA_PID/task/$tid/comm 2>/dev/null)
    case "$comm" in
        AudioTrack|sles-sink|AudioOut|FastMixer)
            chrt -f -p "$tid" 10
            ;;
    esac
done
```

**3. 关键发现**：Toybox 的 `chrt` 语法与 util-linux **相反**：

```bash
# Toybox:      chrt -f -p PID PRIORITY
# util-linux:  chrt -f -p PRIORITY PID
```

**4. 结果**：`AudioTrack` 和 `sles-sink` 均提升至 RT 10，pulseaudio 主线程 RT 20。卡顿问题解决。

## 💾 六、内存诊断

### 诊断结果

```text
物理内存:  5.6G  已用 5.5G  空闲 137M
Swap:      11G   已用 4.5G  空闲 6.3G
```

### 重启根因

```text
sys.boot.reason = kernel_panic,native_hung_minitor_trioomr
```

`native_hung_monitor` 触发 kernel panic，根因是内存极度紧张导致：

- GPU 分配失败 → `EGL_BAD_ALLOC`（tombstone_00）
- 蓝牙初始化超时 → `startup_timer_expired`（tombstone_14）

### UFS 健康

```text
eol_info = 0x01                    （正常）
life_time_estimation_a = 0x01      （已用 0-10%）
life_time_estimation_b = 0x00      （未记录）
```

**结论：UFS 健康，不是硬件问题。**

### 内存黑洞

| 进程 | 内存 |
| --- | --- |
| `tv.danmaku.bili`（全家桶） | ~1.5 GB |
| `com.tencent.mobileqq` + mm | ~1.2 GB |
| `com.netease.cloudmusic` | 325 MB |
| `com.deepseek.chat` | 357 MB |
| `com.twitter.android` | 310 MB |
| 各种 WebView 沙箱 | 460 MB |
| 各种 push service | 700 MB+ |

### 缓解方案

**1. 开启缓存应用冻结**

```bash
su -c 'settings put global cached_apps_freezer enabled'
su -c 'settings get global cached_apps_freezer'
```

**2. 限制后台进程**

```bash
su
device_config put activity_manager max_cached_processes 8
device_config put activity_manager max_phantom_processes 4
settings put global app_standby_enabled 1
```

**3. 加大 ZRAM**

```bash
su
echo lz4 > /sys/block/zram0/comp_algorithm
echo 5368709120 > /sys/block/zram0/disksize
mkswap /dev/block/zram0
swapon /dev/block/zram0
```

**4. 调整 vm 参数**

```bash
echo 30 > /proc/sys/vm/swappiness
echo 100 > /proc/sys/vm/vfs_cache_pressure
```

## 🔧 七、U-Boot 修改分析（未完成）

### 原始逻辑

```asm
0000585c  cmp w4, #1
00005870  b.le LAB_00005908        ; w4 <= 1 → 返回 -1
00005874  tbz w1, #0, LAB_00005880  ; w1 bit0 == 0 → 按键检测
00005878  cmp w4, #2
0000587c  b.eq LAB_0000590c        ; w4 == 2 → 返回
00005880  ...                       ; 按键检测
000058e8  cmp w4, #2
000058ec  b.eq LAB_0000590c
000058f0  ...                       ; 后续检测
00005904  b LAB_0000590c
00005908  mov w20, #0xffffffff
0000590c  mov w0, w20
00005910  ret
```

### 修改方案（待实施）

将 `00005870` 的 `b.le` 和 `00005874` 的 `tbz` 改为 `nop`，让按键检测无条件执行。

### 风险

- DHTB 签名会失效
- 需绕过 U-Boot 自校验（解锁状态下 SKIP VERIFY 可能有效）
- 刷坏需用 `spd_dump` 强刷恢复

## 📊 八、工具链与命令

### 常用命令速查

```bash
# 侦察
su -c 'sh /sdcard/duer_killer/check.sh'

# 禁用组件
pm disable <package>
pm disable-user --user 0 <package>

# 恢复组件
pm enable <package>

# 杀进程
am force-stop <package>
am kill-all

# 查看 RT 线程
chrt -p <tid>

# 设置 RT 优先级（Toybox）
chrt -f -p <tid> <prio>

# 设回 TS
chrt -o -p <tid> 0

# ZRAM 状态
cat /sys/block/zram0/disksize
cat /sys/block/zram0/mm_stat

# UFS 健康
cat /sys/devices/platform/soc/soc:ap-apb/20200000.ufs/health_descriptor/eol_info
cat /sys/devices/platform/soc/soc:ap-apb/20200000.ufs/health_descriptor/life_time_estimation_a

# 内存状态
free -h
dumpsys meminfo | head -40

# 启动原因
getprop sys.boot.reason

# tombstone
ls /data/tombstones/
cat /data/tombstones/tombstone_XX | head -50
```

### 编译环境（Termux）

```bash
pkg install flex bison bc libssl-dev libelf-dev busybox
```

### Toybox chrt 语法陷阱

```bash
# ❌ 错误（util-linux 语法）
chrt -f -p 10 7866

# ✅ 正确（Toybox 语法）
chrt -f -p 7866 10
```

## 📝 九、经验总结

### 9.1 技术要点

1. **GKI 1.0 架构**：内核核心在 `boot.img`，vendor 驱动在 `vendor_dlkm`，通过 KMI 符号连接
2. **DHTB 签名**：展锐 U-Boot 的独立签名机制，与 AVB 无关
3. **RT 调度优先级**：Toybox `chrt` 语法与 util-linux 相反
4. **Termux 编译内核**：ARM64 环境无法交叉编译 ARM64 5.4 内核，需 x86_64 宿主
5. **UFS 健康度**：通过 `health_descriptor` 目录读取，非 `mmcblk0`

### 9.2 踩坑记录

| 坑 | 教训 |
| --- | --- |
| `services.jar` 一次改 9 个方法 | 导致 bootloop，应逐个改逐步验证 |
| Termux 编译 5.4 内核 | Clang 21 太新，需 Clang 12.0.5 |
| `chrt` 语法 | Toybox 与 util-linux 相反 |
| `swapon --show` | Toybox 不支持，用 `cat /proc/swaps` |
| `unzip config.gz` | 应用 `gunzip -c`，gzip 不是 zip |
| `make o=out` | 应大写 `O=out` |

### 9.3 关键文件路径

```text
/data/adb/modules/duer_cleanup/          Magisk 模块
/data/adb/service.d/fuck4duerOS.sh       开机脚本
/data/local/tmp/fuck4duerOS.log          执行日志
/sdcard/duer_uboot_backup/               U-Boot 备份
/sdcard/duer_hosts/hosts                 hosts 备份
/sdcard/duer_cleanup/                    侦察数据备份
/data/tombstones/                        native 崩溃日志
/sys/fs/pstore/                          PStore 日志（本设备无）
/proc/last_kmsg                          Last kmsg（本设备无）
```

## 🎯 十、后续待办

| 项目 | 优先级 | 说明 |
| --- | --- | --- |
| U-Boot 按键修复 | 中 | 已分析清楚，待 patch |
| 音频调度持久化 | 高 | 写入 `service.sh` |
| 内存优化脚本 | 高 | 写入 `service.sh` |
| 内核编译 | 低 | 需要 x86_64 环境 |
| 蓝牙功率调整 | 低 | 需 NV 配置或 AT 命令 |
| `services.jar` 多任务修复 | 低 | 用 LSPosed Hook 更安全 |

---

> 文档版本：1.0 ｜ 最后更新：2026-10-01 ｜ 项目地址：<https://github.com/moyingyilang/Fuck4DuerOS>
