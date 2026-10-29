---
title: 没有模拟器，怎么验证一个自动化脚本
description: 游戏自动化脚本的验证一向是「插上模拟器跑一遍」，可如果手边没有呢？用自定义 Controller 造假设备、合成帧跑真实 Pipeline、把语料格式做成闭环——顺带说说这套办法抓到的三个 bug。
date: 2026-10-29
category: lessons
tags:
  - 测试
  - MaaFramework
  - Rust
  - 自动化
  - 碧蓝航线
---

## 0. 问题的形状

游戏自动化脚本的传统验证方式是：接上模拟器、跑一遍、看结果。
问题是这种验证：

- 不能进 CI（要设备、要游戏、要账号）
- 不可重复（同一段流程每次画面都不一样）
- 覆盖不了异常路径（断连、卡死、弹窗）

我在重写 [MaaAzure](https://github.com/moyingyilang/MaaAzure) 时手边**一台模拟器都没有**，
只有一台安卓手机。于是被迫想了个办法：**骗过引擎，让它以为自己连着设备**。

## 1. 伪造设备：MaaFramework 的 CustomController

MaaFramework 的 Rust 绑定暴露了一个回调式控制器：

```rust
pub trait CustomControllerCallback: Send + Sync {
    fn connect(&self) -> bool;
    fn screencap(&self) -> Option<Vec<u8>>;   // 返回 PNG 字节
    fn click(&self, x: i32, y: i32) -> bool;
    fn swipe(&self, x1: i32, y1: i32, x2: i32, y2: i32, duration: i32) -> bool;
    // …touch/key/scroll 等
}
```

`Controller::new_custom(callback)` 一挂，引擎就按正常流程「截图 → 识别 → 动作」。

于是「截图」这件事完全由我们决定。最直接的用法：**造一张 1280×720 灰底板，
把目标节点的模板贴到它的 `roi` 上**——模板匹配必然命中，Pipeline 就真的往下走了。

```rust
let mut canvas = Canvas::new();                    // 灰底
canvas.paste_node(&bundles, "commission_goto_reward")?;  // 贴到它的 roi
let frame = canvas.to_frame();                      // PNG 字节
```

节点和 `roi` 都从资源包现查，所以这一步**同时在校验「这个节点写的 roi 对不对」**。

## 2. 它验证什么，不验证什么

| 验证 | 不验证 |
|---|---|
| 模板路径 / `roi` / 阈值是否自洽 | 真实画面是否长这样 |
| `next` 图与跳转逻辑 | 截图链路时延 |
| `Custom` 节点能否被调到 | OCR 在真实字体上的准确率 |
| FFI 全链路（Controller → Tasker → Pipeline） | 与真机的时序差异 |

说白了这是**链路验证**，不是游戏模拟。但对我这种情况，它把「完全不能验证」
变成了「除画面真实度以外都能验证」。

跑起来是这样的：

```
$ maazure-daemon --synth CommissionStart --show commission_goto_reward,commission_page

── 结果 ──
耗时      2.9s
点击      [(27, 185), (565, 288)]
执行节点  ["CommissionStart", "commission_goto_reward", "commission_page", "commission_done"]
Pipeline  成功
```

## 3. 三个真 bug——全是离线检查发现不了的

这套办法最大的价值不是「跑通」，而是**它会真的报错**。

### bug 1：模板图是整张截图

```
TemplateMatcher: templ size is too large [image=[189,30,16]] [templ=[720,1280,16]]
```

旧仓的 `Button` 资产存的是整屏截图，匹配时才按 `area` 裁。转换器直接整图落盘 →
模板比 ROI 还大。修完资源从 138MB 降到 68MB。

### bug 2：锚点被当成变量

```
PipelineTask: get_pipeline_data failed, node not exist [node={"anchor":true,"name":"home"}]
```

我把任务起点的 `next` 写成了 `[Anchor]home`。锚点是**运行期变量**：只有
`global_home` 被执行过才解析得到，起点处它还不存在。

结论写进了规范：**默认用节点引用，锚点只在「确实已经过主界面」时用。**

### bug 3：`_meta` 被当成节点

```
PipelineResMgr: key already exists [key=_meta]
加载资源失败: MaaStatus(4000)
```

pipeline JSON 的每个顶层键都会被当节点解析，`_meta` 在两个文件里撞名 → 整包加载失败。

这三个都不是「代码写错了」，而是**我对引擎语义的假设错了**。
文档读十遍也不如让它跑一次。

## 4. 从「跑一次」到「可回归」

单帧手工跑不够，做成脚本才能进 CI：

```jsonc
{
  "name": "commission_happy_path",
  "entry": "CommissionStart",
  "frames": [
    { "show": ["commission_goto_reward"] },
    { "show": ["commission_goto_reward", "commission_goto_commission"] },
    { "show": ["commission_goto_reward", "commission_page"] }
  ],
  "expect": {
    "min_clicks": 2,
    "max_clicks": 6,
    "outcome": "ok",
    "visited": ["commission_goto_reward", "commission_page"],
    "not_visited": ["global_recover"]
  }
}
```

帧随点击推进，所以「点完画面变了」的流程也能覆盖。
断言不只是「点了几次」，还有**执行路径**（`visited` / `not_visited`）。

当前四个用例：

| 用例 | 验证 | 实测 |
|---|---|---|
| `commission_happy_path` | 三帧递进走完进入流程 | 2 次点击 / ok |
| `global_home_only` | 主界面标志命中即结束 | 0 点击 / ok |
| `nothing_matches` | **负向**：全空必须失败 | 0 点击 / failed |
| `commission_no_pick` | 委托页可见、选择落空 → done | 0 点击 / ok |

第三条是故意的：如果断言写成「永远通过」，它就会失败。**没有负向用例的测试套件
等于没有测试。**

我还做了两次负向验证（故意改坏再跑）：

- 把 `visited` 写错 → 断言报出真实路径 `["CommissionStart", "global_home"]`
- 把 fixture 引用的节点名写错 → `xtask check` 当场报「引用了不存在的节点」

## 5. 语料闭环：合成帧也能喂「回放」

真机语料要等设备，但**语料格式可以先用合成帧验证**：

```bash
# 1) 跑合成帧，同时导出成 golden corpus 布局
maazure-daemon --synth --script data/fixtures/commission_happy_path.json \
    --dump corpus/synth_commission

# 2) 把这份语料当成「录像」喂真实 Pipeline
maazure-daemon --corpus-run corpus/synth_commission --entry CommissionStart
#   执行节点 ["CommissionStart","commission_goto_reward","commission_goto_commission",
#             "commission_page","commission_done"]
#   Pipeline ok / 断言通过（与录制一致：ok）
```

关键在于 `--corpus-run` 和真机录制**用同一套格式**。等设备到手，
录制器导出的目录可以**直接**丢进来跑，不用改一行代码。

## 6. 这套办法的边界

诚实地说，它替代不了真机：

- 模板是贴上去的，所以「真实画面下会不会误匹配」它答不了
- OCR 拿到的永远是空白，所以依赖 OCR 的决策只能靠单测覆盖
- 时序、截图延迟、设备抖动全都不在范围内

但**在这个范围内，它把「完全黑盒」变成了「每次改代码都有 4 个断言兜着」**。
剩下那部分，等设备到手，用同一套语料格式补上就行。

---

系列文章：

1. [架构：把 28 万行 Python 换成 MaaFramework + Rust](/blog/maazure-1-architecture)
2. [资源迁移：把「数据即代码」拆开](/blog/maazure-2-migration)
3. [在 arm64 安卓手机上交叉编译 Windows 程序](/blog/maazure-3-cross-compile)
4. **没有模拟器，怎么验证一个自动化脚本**（本篇）

代码：[MaaAzure](https://github.com/moyingyilang/MaaAzure)（AGPL-3.0）
