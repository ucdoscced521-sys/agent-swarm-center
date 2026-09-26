# 蜂群调度中心（Agent Swarm Center）

[![Stars](https://img.shields.io/github/stars/ucdoscced521-sys/agent-swarm-center?style=social&label=Star)](https://github.com/ucdoscced521-sys/agent-swarm-center/stargazers)
[![Forks](https://img.shields.io/github/forks/ucdoscced521-sys/agent-swarm-center?style=social&label=Fork)](https://github.com/ucdoscced521-sys/agent-swarm-center/forks)
[![Watchers](https://img.shields.io/github/watchers/ucdoscced521-sys/agent-swarm-center?style=social&label=Watch)](https://github.com/ucdoscced521-sys/agent-swarm-center/watchers)
[![Last commit](https://img.shields.io/github/last-commit/ucdoscced521-sys/agent-swarm-center?color=blue)](https://github.com/ucdoscced521-sys/agent-swarm-center/commits/master)

> 📖 **文档语言**：[English usage guide](docs/en/05-usage-guide.md) ｜ 简体中文（本页）
> Documentation index & policy: [`docs/README.md`](docs/README.md)

> 一句话任务进 → 自主拆解 → **真并行**多个独立子智能体 → 独立验收 → 可验证的交付物出。
> 面向 WorkBuddy 与 Codex 双宿主，跨会话可续跑。

**当前版本：`v0.2.0`** ｜ 状态：协议已硬化并通过九步验证（见 `swarm-lab/`）

---

## 这是什么

一个**多智能体协作协议 + 可直接安装的专家包**。它把一个模糊需求变成一条可审计的流水线：

```
立项 → 侦察选人 → 拆解 → 派单 → 真并行执行 → 收判定 → 独立验收 → 失败自行升级 → 收口封板
```

它的核心不是"让 AI 更聪明"，而是**让 AI 的产出可被机器验收**：

| 机制 | 作用 |
|---|---|
| **判定契约**（JSON + Schema） | 子智能体只能以结构化判定回流，口头结论一律不算 |
| **三层闸** | 结构合规 / 任务绑定 / 证据存在性 —— 假 PASS 藏不住 |
| **异源分级** | 复核与产出必须异源，做不到高档就**如实降级并标注** |
| **复核分级** | 按风险分配复核（R3 必核 / R2 抽检 / R1 免核），不搞 1:1 浪费 |
| **能力契约** | 主脑的写能力被**物理移除**，不是靠提示词自律 |
| **成本纪律** | 八条硬规矩，实测可省 45–60% |

---

## 快速开始

### 1. 安装（WorkBuddy）

把 `agent-swarm/` 放进用户级市场目录，然后在市场清单里登记：

```powershell
# 1) 复制包到市场
$mkt = "$env:USERPROFILE\.workbuddy\plugins\marketplaces\my-experts"
Copy-Item .\agent-swarm "$mkt\plugins\agent-swarm" -Recurse -Force

# 2) 在 $mkt\.codebuddy-plugin\marketplace.json 的 plugins 数组里追加：
#    { "name": "agent-swarm", "source": "./plugins/agent-swarm",
#      "policy": { "installation": "AVAILABLE" }, "category": "Engineering" }
```

### 2. 安装（Codex）

```powershell
node "<node.exe>" "$env:USERPROFILE\.workbuddy\plugins\marketplaces\my-experts\plugins\agent-swarm\..." # 见 docs/05 使用说明
codex plugin add agent-swarm@personal --json
```

> 详细安装、五落点同步、故障排查见 **[docs/05-使用说明.md](docs/05-使用说明.md)**

### 3. 召唤

- **WorkBuddy**：左侧栏「专家」→「我的专家」→ **蜂群调度中心** → 新对话 → 丢一句话
- **Codex**：新会话里显式输入 `$agent-swarm:agent-swarm`

预置提示词：

> 帮我完成这个任务，你自己拆解、自己派人、自己验收，中途不用问我。

---

## 项目结构

```
multi-agent-plugin/
├── README.md                        ← 本文件：项目入口
├── CHANGELOG.md                     ← 版本变更记录
├── .gitignore / .gitattributes      ← 忽略规则；强制 *.cmd 为 CRLF
│
├── agent-swarm/                     ★ 唯一交付物：可安装的专家包
│   ├── .codebuddy-plugin/plugin.json    WorkBuddy 清单（版本号在此）
│   ├── .codex-plugin/plugin.json        Codex 清单（版本号在此）
│   ├── manifest.yaml                    包类型声明
│   ├── settings.json                    默认主 agent 指向
│   ├── agents/                          8 个角色提示词
│   ├── agents-fragment.md               可注入 AGENTS.md 的片段
│   ├── skills/agent-swarm/
│   │   ├── SKILL.md                     技能入口（Codex 侧）
│   │   └── references/protocol.md       ★ 协议唯一事实源（28KB）
│   ├── schemas/                         判定契约（生产端 + 校验端共用）
│   ├── contracts/master-capability.json 主脑能力契约
│   ├── tools/                           零依赖工具（判定闸门等）
│   ├── avatars/                         9 张角色头像（512×512）
│   └── README.md                        包级说明
│
├── docs/                            ← 设计与人读文档
│   ├── README.md                      ★ 文档地图 + 命名/语言/更新规范
│   ├── 01-开发方案-v1.0.md
│   ├── 02-双宿主协同与部署架构-v2.md
│   ├── 03-跨宿主桥实测记录.md
│   ├── 04-优化路线与验证计划.md
│   ├── 05-使用说明.md                 ★ 完整使用手册（中文）
│   ├── 06-项目结构与维护指南.md         ★ 文件清单 + 改造/升级/同步
│   └── en/
│       └── 05-usage-guide.md         ★ English usage guide（面向一般用途）
│
├── scripts/
│   ├── gh-device-auth.ps1            ← 无 TTY 环境下的设备码授权 + 建私密仓库 + 推送
│   └── push-to-github.ps1            ← 已登录后的一键推送
│
└── swarm-lab/                       ← 验证实验台（可重跑，非交付物）
    ├── tools/                       验证与运维脚本（16 个，零依赖）
    ├── schemas/ contracts/          与包同源（单源契约）
    ├── runs/                        运行记录（gitignored）
    ├── step1..9-report.md           九步验证报告
    └── VALIDATION-SUMMARY.md        ← 验证总报告（先读这个）
```

> 每个文件的详细作用见 **[docs/06-项目结构与维护指南.md](docs/06-项目结构与维护指南.md)**

---

## 文档索引

| 你想知道 | 看哪 |
|---|---|
| **怎么装、怎么用、怎么排查（English）** | **[docs/en/05-usage-guide.md](docs/en/05-usage-guide.md)** ← general purpose |
| **怎么装、怎么用、怎么排查（中文）** | **[docs/05-使用说明.md](docs/05-使用说明.md)** ← 含**常见示例**与**版本信息** |
| **文档放哪 / 怎么命名 / 何时双语 / 更新流程** | [docs/README.md](docs/README.md) |
| 每个文件干什么、怎么改怎么升级 | [docs/06-项目结构与维护指南.md](docs/06-项目结构与维护指南.md) |
| 版本历史 / 变更记录 | [CHANGELOG.md](CHANGELOG.md) |
| 它到底验证过什么（9 步 / 91 条断言）| [swarm-lab/VALIDATION-SUMMARY.md](swarm-lab/VALIDATION-SUMMARY.md) |
| 为什么这么设计 | [docs/01-开发方案-v1.0.md](docs/01-开发方案-v1.0.md) |
| 双宿主怎么协同 | [docs/02-双宿主协同与部署架构-v2.md](docs/02-双宿主协同与部署架构-v2.md) |
| 跨宿主调用的实测坑 | [docs/03-跨宿主桥实测记录.md](docs/03-跨宿主桥实测记录.md) |
| 一次真实运行的复盘 | [swarm-lab/step8-real-run-review.md](swarm-lab/step8-real-run-review.md) |
| 怎么省钱 | [swarm-lab/step9-cost-optimization.md](swarm-lab/step9-cost-optimization.md) |

---

## 验证状态（不是"设计上应该行"，是实测过的）

| 步骤 | 证明了什么 | 断言 |
|---|---|---|
| Step1 最小闭环 | 链路通、假 PASS 拦得住 | 16/16 |
| Step2 真并行 | 指标能区分真并行与伪并行（M1 **2.91 vs 0.99**）| 18/18 |
| Step3 判定硬化 | JSON+Schema 比文本判定**多拦 2 类盲区** | 8/8 |
| Step4 边界硬化 | 主脑越界物理不可为（naive 4 → guarded **0**）| 26/26 |
| Step5A/5B | 真模型遵守契约（3/3）、真 builder 写出**可运行代码** | 1/1 · 11/11 |
| Step6 接线校验 | 验证成果真的落进产品包 | 9/9 |

**一键重跑**：`node swarm-lab/tools/run-step{1..4}.mjs`，退出码 0 即全绿。

---

## 已知边界（诚实标注）

- **真实业务长时运行**未验证（只在一次个人工作台项目上跑过完整一轮）
- **跨宿主 CLI 通道**（Codex → WorkBuddy）在受限环境下未能跑通，现走文件总线兜底
- **异源验收**在单模型环境下只能达到 L2（强异源），非 L3（不同厂商）
- 前端类交付物**无自动化视觉覆盖**，界面正确性需人工走查

---

## ⭐ 喜欢这个项目？

**GitHub 没有独立的"点赞"功能 —— Star 就是唯一的那一下。** 点右上角的 **Star** 即可：

[![Star this repo](https://img.shields.io/badge/%E2%AD%90_Star-this_repo-blue?style=for-the-badge&logo=github)](https://github.com/ucdoscced521-sys/agent-swarm-center/stargazers)

Star 的实际作用（不是客套话）：

| 作用 | 说明 |
|---|---|
| **提高被发现概率** | GitHub 的推荐、趋势与搜索结果都会参考 Star 数——这是陌生人找到它的**唯一**途径 |
| **给维护者正反馈** | Star 数是"这东西有人在乎"的客观信号，直接影响这个项目还会不会被继续投入 |
| **方便你自己回来找** | Star 过的仓库出现在你的 Stars 列表里，等于给自己加书签 |
| **顺带留个痕** | 你的头像会出现在 [Stargazers](https://github.com/ucdoscced521-sys/agent-swarm-center/stargazers) 页面上 |

**其他参与方式**（比 Star 更重，但更有用）：

| 想做什么 | 怎么做 |
|---|---|
| **提问题 / 报 Bug** | 开 [Issue](https://github.com/ucdoscced521-sys/agent-swarm-center/issues) |
| **按自己的需要改** | **Fork** 一份（右上角 Fork / 上面的 Fork 徽章），改完可以提 PR |
| **只想拿代码** | `git clone https://github.com/ucdoscced521-sys/agent-swarm-center.git` |
| **想投票 / 表态** | 在 Issue 或 Discussions 里用 **👍 表情回应**（GitHub 的 reaction 体系）|
| **单纯关注更新** | 右上角 **Watch** → 选 `Custom` → `Releases only`，只在发版时通知你 |

> If this project helps you, please hit **⭐ Star** at the top right — it is the only way GitHub
> surfaces the repo to others, and it is the main signal that this project is worth maintaining.

---

## 许可

**本仓库已公开：任何人都可以查看、克隆（clone）与拉取（pull）代码。**

**但目前未附开源许可证 —— 默认保留所有权利（All rights reserved）。**
请注意一个常见误解：**"公开可见" ≠ "授权使用"**。没有 `LICENSE` 文件时，默认不授予他人使用、修改、再分发或商用的权利。

如果想放宽（推荐，尤其你希望别人真的用起来）：

| 许可证 | 适合场景 | 特点 |
|---|---|---|
| **MIT** | 想让人**随便用**，追求最大采用率 | 极简，只需保留版权与许可声明 |
| **Apache-2.0** | 想让人用，且希望**明确专利授权** | 比 MIT 多专利授权与商标条款 |

选定后加上根目录的 `LICENSE` 文件即可（GitHub 会自动识别并在仓库页显示徽章）。

**只想先聊聊用途** → 开一个 [Issue](https://github.com/ucdoscced521-sys/agent-swarm-center/issues) 即可。
