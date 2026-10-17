---
title: "30. 灭屏保活（第 2 阶段第 6 项）"
description: "EFML4A 研究文档 · 30-keepalive-offscreen（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 目的：让长时间任务（`.blc` 扫描、`.ab` 解析、重打包）在**灭屏**时不被 Android 挂起/降频。

## 30.1 四道保活手段

| # | 手段 | 作用 | 命令 |
| --- | --- | --- | --- |
| ① | **Termux 唤醒锁** | 持有 `PARTIAL_WAKE_LOCK`，阻止 CPU 休眠 | `termux-wake-lock` |
| ② | **充电时保持常亮** | `stay_on_while_plugged_in=7`（AC+USB+无线） | `settings put global stay_on_while_plugged_in 7` |
| ③ | **deviceidle 白名单** | 免除 Doze 模式的网络/CPU 限制 | `dumpsys deviceidle whitelist +com.termux` |
| ④ | **钉住 CPU 最低频率** | 灭屏时 Android 会降频/停小核，此处把 `scaling_min_freq` 拉到最大 | 写 `/sys/devices/system/cpu/cpu*/cpufreq/scaling_min_freq` |

**另**：`echo -5 > /proc/self/oom_score_adj` 降低被 OOM 杀掉的概率。

## 30.2 两个脚本

### `scripts/keepalive.sh`（手动/临时）

```bash
bash scripts/keepalive.sh          # 常驻保活
bash scripts/keepalive.sh 3600     # 保活 1 小时后自动释放
bash scripts/keepalive.sh off      # 释放（复位 stay_on、解锁）
```

### `scripts/boot/05-efml4a-keepalive.sh`（开机自动）

装入 `~/.termux/boot/`，**排在其它 EFML4A 脚本之前**（`05-` 前缀），
保证开机即获得保活，之后的长任务都受益。

安装位置：
```
~/.termux/boot/05-efml4a-keepalive.sh     ← 实际生效
<repo>/scripts/boot/05-efml4a-keepalive.sh ← 版本留档
```

## 30.3 实测结果

**开机脚本手动执行**：
```
[06:12:52] EFML4A keepalive 启动
  termux-wake-lock ✓
  stay_on=7 ✓
  deviceidle 白名单 ✓
  scaling_min_freq → max ✓
[06:12:52] 就绪
```

**状态验证**：
```
termux:service-wakelock   ACQ=-4m52s LONG   pkg=com.termux   ← 长持有
stay_on = 7
deviceidle 白名单含 com.termux
```

## 30.4 灭屏压测

`~/.efml4a/scratch/longtask.sh` —— 60 秒计算任务，每秒一个 tick：
```bash
nohup bash ~/.efml4a/scratch/longtask.sh &
# 然后灭屏，之后检查：
tail -5 ~/.efml4a/scratch/longtask.log
# 若出现 "[..] done"，说明全程未被挂起
```

**日志格式**：
```
[06:12:57] tick 2/60 sum=200010000
[06:12:58] tick 3/60 sum=200010000
…
[..] done
```

## 30.5 注意事项

- `stay_on_while_plugged_in=7` 会让**充电时屏幕常亮**（耗电/烧屏风险）。
  不充电时不受影响。若不想常亮，改回 `0` 即可。
- `scaling_min_freq` 拉到最大会**增加耗电与发热**。任务结束后建议复位：
  ```bash
  su -c 'for c in /sys/devices/system/cpu/cpu*/cpufreq/scaling_min_freq; do echo 300000 > "$c"; done'
  ```
- 本项不影响游戏本身，只是保证 Termux 侧的长任务能跑完。
