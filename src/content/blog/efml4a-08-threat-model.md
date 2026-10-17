---
title: "08 · 威胁模型、风险与合规"
description: "EFML4A 研究文档 · 08-threat-model（Arknights: Endfield Mod Loader for Android）"
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

## 0. 目的与范围

本文回答：**能做什么、绝对不做什么、做错了会怎样**，是 [09-architecture.md](/blog/efml4a-09-architecture/) 与 [11-roadmap.md](/blog/efml4a-11-roadmap/) 的约束输入：决策与 §1.2 红线或 §2 可见性策略冲突时，以本文为准。

> ⚠️ 未核实：文中法律条文（DMCA §1201 适用边界、各法域反规避条款域外效力）未经执业律师审阅，仅为工程侧合规假设，**不构成法律意见**。

## 1. 定位声明与红线清单

### 1.1 定位

EFML4A 是**图形层与资产层的外观替换研究项目**：研究如何把用户自制的模型 / 贴图 / 材质差异数据注入用户自己合法拥有的游戏客户端。它是 PC 端 [EFMI (Endfield Model Importer)](https://github.com/SpectrumQT/EFMI-Package) 在 Android 的对位物，血统回溯到 3DMigoto（见 [12-references.md](/blog/efml4a-12-references/)）：**只改变"长什么样"，不改变"打多少伤害"。**

### 1.2 红线清单（不可协商）

每条都是**否决项**：任何 PR、issue、分支或实验脚本触碰其一，必须回退，不得进入私有主线。

| 编号 | 红线 | 判定标准（可机械检查） |
| --- | --- | --- |
| R-01 | 不修改游戏数值 | 无对伤害/掉落/冷却/货币/概率字段的写操作 |
| R-02 | 不做联网作弊 | 无封包篡改、服务端请求伪造、协议重放 |
| R-03 | 不做自动战斗 / 透视 / 瞄准辅助 | 不读敌方状态做决策，不改相机与可见性剔除 |
| R-04 | 不分发游戏原始资源 | 发布物不含 AssetBundle / `global-metadata.dat` / `libil2cpp.so` 的字节 |
| R-05 | 不含绕过 DRM 的密钥 | 无解密密钥、签名伪造材料、被禁用的私有密钥 |
| R-06 | 不提供游戏破解工具 | 无包体解密器、付费内容解锁、账号体系绕过 |
| R-07 | 不绕过反作弊完整性校验 | 不实现针对 `global-metadata.dat` / `libil2cpp.so` 校验的屏蔽或伪装 |
| R-08 | 不规避服务器侧制裁逻辑、不外发用户隐私 | 不伪造设备指纹规避封禁；不采集设备标识 / 账号 / IP 并上传 |
| R-09 | 公开期之前保持私有 | 见 §2 |

> **R-07 与 R-05/R-06 的区别是本项目最重要的自我约束**：我们**允许**一个改变 GPU 提交内容的层在用户设备上运行（它本身就是检测面，见 §5.1），但**不允许**把"让完整性校验看不见我们"做成功能去实现与分发。

## 2. 可见性策略：开发期强制私有

### 2.1 规则

> **在 §2.3 的 Exit Criteria 全部满足之前，本仓库必须保持 private。规则不可协商：不接受"先开源攒星再补合规"，也不接受以 fork / 镜像 / gist / 预编译产物 / 网盘链接等任何形式变相公开。**

- **仓库本体**：仅 private，禁止改为 public（包括临时改动）。
- **禁止** fork / 镜像 / gist：fork 会把历史暴露在他人命名空间。
- **禁止**启用 GitHub Pages、禁止公开 Releases / 网盘 / IM 分发（私有期可本地构建，不上传）。
- **公开技术讨论仅限方法论**：不给出可运行步骤或 PoC 细节。

### 2.2 理由与推理

1. **关注面不对称。** 成熟的 Windows mod 工具与"Android 上的运行时注入 PoC"在反作弊厂商、平台方与安全 社区眼中风险等级完全不同：Android 注入天然更靠近作弊器/恶意软件的技术栈（Zygisk、ptrace、inline hook、隐式 Vulkan 层），早期公开会让项目被归入错误类别且难以纠正。
2. **公开 PoC 会降低滥用门槛。** 一份"能在 Android 上给 Unity 游戏注入渲染层"的可运行代码，距离被改造 成通用外挂底座只差一次 fork；我们不愿自己的代码成为那条路径的起点。
3. **封号风险会外溢到用户。** 早期版本必然粗糙（层加载时机、hook 稳定性、内存读写模式都会留下可检测 痕迹，§5.1），公开等于批量劝诱用户拿账号做实验。
4. **对标对象是先例而非巧合。** EFMI 属于 3DMigoto 系生态（GIMI / SRMI / ZZMI 家族），它是在 Windows 侧积累多年 成熟工具链与免责声明之后才广泛公开的；我们要复刻的是其**成熟度门槛**，不是公开时点。而一旦公开，commit 历史与 release 二进制永久留存，已被抓取或镜像的内容无法撤回——**先例成本不可逆**，远高于私有期成本。

### 2.3 解除私有的门槛条件（Exit Criteria）

"进入维护阶段" = 下表**全部**为 ✅；任何一项为 ❌ / ⚠️，仓库保持 private。

| # | 门槛条件 | 验收方式 | 状态 |
| --- | --- | --- | --- |
| E-01 | 四条技术路线完成选型（[07-route-matrix.md](/blog/efml4a-07-route-matrix/)），且至少一条后端可用（端到端跑通一个示例 mod） | 选型结论 + 理由表 + 可复现 demo 记录 | ☐ |
| E-02 | 免责声明齐备（§4.5 文本已入 README） | README diff | ☐ |
| E-03 | AGPL-3.0 授权齐备（`LICENSE` + 源文件 SPDX 头），且发布物审查清单（§6）全项通过 | 许可扫描 + 清单留档 | ☐ |
| E-04 | 代码与**历史**中无硬编码游戏密钥 / 无绕过 DRM 实现 | `gitleaks` 全历史为空 | ☐ |
| E-05 | 反滥用红线文档定稿并链接在 README 首屏 | 本文 §1.2 | ☐ |
| E-06 | 供应链校验链路可用（sha256 + 可选签名）、漏洞报告渠道可用（§7）、仓库历史已清理（无大文件误提交 / 临时密钥 / 第三方私有代码） | [10-mod-format.md](/blog/efml4a-10-mod-format/) §6 测试 + 试提一条报告 + `git log --stat` 复核 | ☐ |

### 2.4 私有期禁令

- 禁止邀请未签署 §1.2 + §2 约定的外部协作者；禁止在 CI 日志、issue、PR 中粘贴游戏原始资源片段，或用公开 pastebin / gist 分享可能含资源路径与哈希的调试输出。

## 3. 私有仓库下的工程约束

| 约束 | 要求 | 动机 |
| --- | --- | --- |
| Actions 配额 | 私有仓库 Actions 用量**计入账户配额**（公开仓库通常不计费）。> ⚠️ 未核实：GitHub Free 当前私有仓库包含分钟数与最新政策，以官方计费文档为准 <https://docs.github.com/en/billing/concepts/product-billing/github-actions> | 避免拖爆配额或产生费用 |
| CI 最小权限 / Pages | 每个 workflow 顶层声明 `permissions: contents: read`；**禁止启用 GitHub Pages**（会把内容推到公网） | 默认 token 权限过大；避免变相公开 |
| 构建产物 | 禁止上传含敏感的产物（dump、抓帧、含资源路径的日志） | 产物共享链接可带出仓库 |
| 资源、密钥与预提交检查 | 禁止提交游戏资源或密钥；`gitleaks`（或 `git-secrets`）pre-commit + CI 全历史扫描 | R-04 / R-05；防止密钥进入历史 |
| 协作面 / 依赖 / 日志 | 私有期关闭 wiki / projects / discussions；依赖锁定版本，禁止 `curl \| bash` 式安装；默认关闭详细路径日志或提供 `--redact-paths` | 减少公开面与钓鱼面、控制供应链；日志常含绝对路径 |

CI 基线：`on: [push, pull_request]`；`permissions: { contents: read }`；`actions/checkout` 用 `fetch-depth: 0`（gitleaks 需全历史）；只跑 `gitleaks detect --redact` 与 `cargo build --locked`。 **私有期原则：CI 只做验证，不做分发**——任何"自动发布"工作流在 Exit Criteria 达成前不得启用。

## 4. 法律与合规

### 4.1 AGPL-3.0 对本项目的义务

| 义务 | 内容 | 我们的做法 |
| --- | --- | --- |
| 源码可用性 / 同一许可 | 分发二进制须同时提供对应源码（含修改）；衍生作品整体以 AGPL-3.0 分发 | Release 附源码 tag，不发布"仅二进制"；源文件加 SPDX 头 `AGPL-3.0-only` |
| 网络服务条款 §13 | 若用户经网络与修改版交互，须向其提供对应源码 | 本项目为本地工具，**不运营网络服务**；未来若提供在线 mod 索引/校验服务，其修改版必须开源 |

> ⚠️ 未核实：AGPL-3.0 §13 在本项目（本地工具 + 可选在线索引）的触发边界须结合最终发布形态逐案判断，上表为保守解释。许可全文：<https://www.gnu.org/licenses/agpl-3.0.html>。

### 4.2 下游 mod 作者：数据文件是否被"传染"

| 对象 | 是否传染 | 依据 |
| --- | --- | --- |
| 加载器源码 / 第三方 fork | 是 | 本项目自身即 AGPL-3.0，衍生作品必须同许可 |
| Mod 包**数据文件**（网格、贴图、`mod.toml`） | **倾向"否"，但不确定** | 数据文件通常不构成加载器的衍生作品（被解释而非被链接）；若清单内嵌可执行着色器/脚本片段，该片段可能被视为衍生 |
| Mod 内**可执行代码**（HLSL/GLSL/SPIR-V、脚本、so） | 倾向"是"，至少高风险 | 与加载器构成整体作品的可能性较高；建议同许可发布 |

给下游作者的实务建议（亦写入 [10-mod-format.md](/blog/efml4a-10-mod-format/) §4）：纯数据 mod 在 `mod.toml` 的 `license` 字段声明自己的许可（CC-BY、MIT 等均可），本项目不主张其许可；携带可执行着色器/脚本的 mod 应以 AGPL-3.0 或兼容许可发布；不要引用本项目私有头文件或内部 ABI 分发闭源插件。

> ⚠️ 未核实：以上是工程侧保守假设，**不是法律结论**；各法域对"衍生作品"与"聚合"的界定不同。

### 4.3 与 EFMI 的 GPL-3.0 生态关系

| 问题 | 结论 | 说明 |
| --- | --- | --- |
| GPL-3.0 代码能否并入 AGPL-3.0 项目 | **可以** | 单向兼容：GPL-3.0 作品可整体以 AGPL-3.0 分发，反向不行。见 <https://www.gnu.org/licenses/license-compatibility.html> |
| vendor Magisk 的 Zygisk 模块 API 头（`native/src/core/zygisk/api.hpp`，本项目存于 `android/zygisk-module/src/main/cpp/zygisk/`） | **可以**，保留原版权与许可声明 | 该头文件**自身**携带 ISC 风格宽松许可（"Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted."，Copyright 2022-2023 John "topjohnwu" Wu），且 Magisk 官方将其标注为 "This is the public API for Zygisk modules"；即便按 Magisk 整体的 GPL-3.0 理解，GPL-3.0 → AGPL-3.0 亦为单向兼容（见上一行）。已核实：该文件与官方发布版 `zygisk-module-sample/module/jni/zygisk.hpp` 逐字节相同 |
| 整体许可 / 复用 EFMI 的 ini、HLSL 资源 | 整体为 AGPL-3.0；复用需逐文件判断 | 必须保留原作者署名与来源标注；若资源由 EFMI 以 GPL-3.0 发布则触发同许可义务，第三方 mod 作者的资源许可未必是 GPL |
| 能否"参考"其字段语义 | 可以但需谨慎 | 接口与字段语义属思想层面，通常不受版权保护；直接复制常量表、字符串表、结构定义有风险。我们的做法是独立设计格式、只做**概念映射**（[10-mod-format.md](/blog/efml4a-10-mod-format/) §5） |

> ⚠️ 未核实：EFMI-Package / EFMI-Tools 各文件的**实际授权**未在本次核查中读取到原文；引用前必须逐仓库、逐文件确认 `LICENSE` 与文件头。**确认之前默认禁止复制任何 EFMI 代码或资源。**

### 4.4 EULA / 反规避 / 版权

- **用户自备 root 与已购买的游戏**；不提供游戏本体、账号或绕过购买校验的手段。EULA 通常禁止"修改 客户端""使用第三方软件干扰服务"；违约后果通常是**账号封禁（合同层面）**，与**侵权（法律层面）** 是两个不同风险。目标游戏偏 PVE，但不改变 EULA 文本的适用。
- **反规避**：DMCA §1201 规制规避**访问控制**技术措施。> ⚠️ 未核实：客户端对自身资源的完整性校验 是否构成受保护的"访问控制"，判例并不统一（参照 <https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-chapter12&edition=prelim>）。 我们的界限：只做渲染层替换，**不实现、不分发**针对完整性校验的规避（R-05、R-07）。
- **版权**：绝不分发游戏原始资源，mod 只分发**差异数据**；由游戏资源派生的贴图仍可能是衍生作品， 合法性由 mod 作者自负，我们只提供格式与校验能力。

### 4.5 README 免责声明（可直接使用）

```text
【中文】EFML4A 是研究性质的非官方客户端侧外观替换工具，与游戏开发商、发行商及其关联公司无任何关系，未获其
授权或认可。1) 不含、不分发任何游戏原始资源，不含破解工具、解密密钥或绕过 DRM 的实现。2) 仅改变本地客户端
渲染外观：不改游戏数值，不提供自动战斗、透视、瞄准辅助等竞技性作弊功能，不参与联网作弊。3) 使用需您自行获取
设备 root 权限并合法拥有游戏副本，并自行确认此类修改是否违反您与运营方的协议。4) 使用风险（账号封禁、设备
不稳定、数据损坏等）由您自行承担。5) 以 GNU Affero GPL v3.0 发布，不提供任何担保。6) 不鼓励也不支持在任何
官方竞技或排行环境中使用。

【English】EFML4A is an unofficial, research-oriented client-side cosmetic modification tool, not affiliated
with, authorized by, or endorsed by the game's developer or publisher. 1) No original game assets are contained
or distributed; no cracking tools, decryption keys, or DRM circumvention. 2) It only alters local rendering
appearance: no gameplay values changed, no auto-play, wallhack, aim assistance, or network-side cheating.
3) Use requires that you obtain root access yourself and own a legitimate copy of the game; you must determine
whether this violates your agreement with the operator. 4) All risks (account bans, device instability, data
loss) rest solely with you. 5) Released under the GNU Affero GPL v3.0, with NO WARRANTY. 6) Use in official
competitive or ranked environments is neither encouraged nor supported.
```

## 5. 技术风险与反作弊

### 5.1 检测面清单

| 检测面 | 痕迹 | 可缓解性 | 备注 |
| --- | --- | --- | --- |
| root / 可调试位 | `su` 路径、`ro.debuggable`、Magisk 属性、SELinux 状态 | 低（用户侧） | 与加载器无关但同样触发风控 |
| Vulkan layer chain 枚举 | `vkEnumerateInstanceLayerProperties` 可见的额外隐式层 | 中 | 见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) |
| 进程内模块 / 内存扫描 | `/proc/self/maps` 中非预期 `.so`；hook 残留、trampoline 字节、rwx 异常页 | 中 | 隐藏模块接近"规避反作弊"，与 R-07 冲突；inline hook 的典型特征 |
| `global-metadata.dat` / `libil2cpp.so` 完整性 | 文件或内存镜像被改、磁盘哈希校验 | 高（易被发现） | 见 [05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/) |
| 行为检测 / 调试器 | 帧时间异常、DrawCall 结构变化、GPU 提交模式统计；RenderDoc / AGI 风格注入 | 低—中 | 客户端与服务端均可做；调试器仅作**开发期诊断**，不发布给终端用户 |

### 5.2 供应链风险与 mod 包校验

mod 包本质是**任意数据的载体**，与外挂分发渠道共享同一风险面。

| 风险 | 缓解 |
| --- | --- |
| 包被篡改 / 作者身份伪造 | `checksums.txt` 全文件 sha256（默认强校验）；可选 Ed25519 分离签名 + 信任指纹列表 |
| 路径穿越（`../../`、绝对路径、符号链接） | 解析前路径规范化 + 白名单前缀校验 |
| 超大 / 畸形文件、包内可执行着色器 | 尺寸/顶点/索引/分辨率硬上限 + 流式解析；**默认禁止**执行包内着色器（如需必须显式 opt-in + 沙箱 + 用户确认） |
| 未知字段成为攻击面 | 解析器必须**忽略**未知字段而非报错（[10-mod-format.md](/blog/efml4a-10-mod-format/) §6） |

### 5.3 稳定性 / 封号风险分级（按技术路线）

| 路线 | 稳定性 | 封号风险 | 主要理由 | 结论 |
| --- | --- | --- | --- | --- |
| Vulkan 隐式层 | 中 | **中** | 不触碰游戏代码与文件，但层链枚举与提交模式变化可见；崩溃会拖垮整个应用 | 优先研究，默认候选 |
| IL2CPP hook | 高 | **中—高** | hook 残留明显，`libil2cpp.so` 校验命中率高，崩溃定位困难 | 能力最强、风险最高，仅作研究 |
| AssetBundle 磁盘替换 | 低 | **中—高** | 可能触发文件哈希/尺寸校验，易被服务端资源校验发现 | 稳定性最好，隐蔽性中等 |
| frida / ptrace 辅助 | 高 | **高** | frida 特征被广泛识别，ptrace 与反调试直接冲突 | 仅限开发期诊断，不进发布路径 |

> 封号风险分级会随游戏方策略变化而失效；任何一档都必须在发布前重新评估并更新 §8。

## 6. 安全发布规范

**全项通过**方可发布；任一 ❌ 即阻断。

| # | 检查项 | 判定方式 |
| --- | --- | --- |
| P-01 | **仓库可见性就绪**：§2.3 的 Exit Criteria 全部满足（公开发布才允许转 public） | 对照 §2.3 逐项签字 |
| P-02 | 不含私钥 / API 密钥 / 签名材料 | `gitleaks` 全历史 + `git grep` 抽查 |
| P-03 | 不含游戏原始资源（任何格式、片段），不含破解工具或规避实现 | 资源清单审查 + 二进制抽样 + 对照 R-05/R-06/R-07 核查 |
| P-04 | 含 README 免责声明（中文 + 英文，§4.5）、版本号、构建时间、源码 tag 与提交哈希 | 渲染检查 + Release notes |
| P-05 | 含发布物 sha256 列表（与 `checksums.txt` 一致）、AGPL-3.0 全文 `LICENSE` 与源文件 SPDX 头 | 校验脚本 + 许可扫描 |
| P-06 | 依赖许可已复核（无 GPL 不兼容依赖混入），日志 / 抓帧默认脱敏 | 依赖清单审查 + 默认配置检查 |

## 7. 漏洞报告渠道（Security Policy 草案）

```text
# 安全策略（草案）
## 报告方式  用本仓库「私密安全公告」(Security Advisories → Report a vulnerability)，或邮件至 <待填写>；勿公开披露。
## 支持范围  仅对最新发布版本提供安全修复。
## 我们关心  · 解析恶意 mod 包时的内存破坏、路径穿越、任意代码执行
            · checksums.txt / 签名校验可被绕过的缺陷；加载器自身的权限提升或沙箱逃逸
            · 会在用户不知情下修改游戏数值或外发数据的缺陷
## 不在范围  · 绕过游戏反作弊 / 完整性校验的方法（不实现、不接受此类贡献，见 R-07）；游戏本体漏洞请报给厂商
## 响应时限  （目标非承诺）确认收到 ≤ 3 个工作日；初步评估 ≤ 10 个工作日；修复时间视严重性。
```

## 8. 风险登记表

本文档核心产出。概率以"私有开发期 + 小范围测试"为前提估计。

| # | 风险项 | 类别 | 触发条件 | 影响 | 概率 | 缓解措施 | 残留风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K-01 | 账号封禁 | 合规/用户 | 用户在官服使用 mod | 高 | 中 | README 显著警示；不提供一键安装；仅 PVE 场景说明（无法控制用户行为） | 中 |
| K-02 | 被权利方要求下架 / 被认定为规避技术措施 | 法律 | 公开后被游戏方关注、或实现了完整性校验屏蔽 | 极高 | 低—中 | 严守 R-04/R-05/R-06 与 R-07；默认配合下架请求 | 低—中 |
| K-03 | 上游许可污染 / 兼容性误判 | 法律/工程 | 误复制 GPL 代码未标注、依赖含 GPL-2.0-only 组件 | 高 | 中 | 禁止复制（如需复用则整体 AGPL + 署名，§4.3）；依赖许可审查（P-05） | 中：需人工审计 |
| K-04 | 密钥泄漏 / 私有期被变相公开 | 安全/合规 | 误提交或 CI 日志泄露；fork / gist / 网盘外传 | 极高 | 中 | `gitleaks` 全历史 + 最小权限 CI + 日志脱敏；§2.1 矩阵 + 访问审计 | 低—中 |
| K-05 | CI 配额耗尽或产生费用 | 工程 | 私有仓库 Actions 超限 | 低—中 | 中 | 最小化 CI 触发；本地优先；监控用量 | 低 |
| K-06 | 恶意 mod 包导致 RCE / 校验链被绕过 | 安全 | 解析器或签名哈希校验实现缺陷 | 极高 | 中 | §5.2 全部缓解；模糊测试；负向用例 + 第三方评审；默认禁止包内着色器 | 中 |
| K-07 | 反作弊检测升级 / 版本更新破坏兼容 | 技术 | 游戏侧新增检测面；资源布局与管线变化 | 高 | 高 | 追踪 [07-route-matrix.md](/blog/efml4a-07-route-matrix/)、保留多后端；`target` 版本范围 + `abi` 协商，快速失败而非静默错渲 | 高：本质是持续对抗 |
| K-08 | 驱动碎片化 / 供应链投毒 / 加载器崩溃 | 技术/安全/稳定性 | 驱动行为差异、恶意依赖版本、层内空指针越界 | 中 | 高 | 多设备矩阵测试；锁定依赖 + 校验和；防御式编程与异常边界 | 中 |
| K-09 | 用户设备变砖（root 侧） | 稳定性 | Magisk / KernelSU 模块冲突 | 高 | 低—中 | 文档说明；不打包系统级模块（环境不可控） | 中 |
| K-10 | 被滥用为外挂底座 | 声誉/合规 | fork 后改造成作弊工具 | 高 | 中 | 红线文档 + 免责声明 + 不提供通用注入框架 API | 中—高：开源固有风险 |

## 9. 交叉引用

- 注入面与路线：[03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)、[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)、[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)、[06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)、[07-route-matrix.md](/blog/efml4a-07-route-matrix/)
- 格式与校验：[10-mod-format.md](/blog/efml4a-10-mod-format/)；架构/排期/总览：[09-architecture.md](/blog/efml4a-09-architecture/)、[11-roadmap.md](/blog/efml4a-11-roadmap/)、[01-overview.md](/blog/efml4a-01-overview/)、[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)；参考：[12-references.md](/blog/efml4a-12-references/)
