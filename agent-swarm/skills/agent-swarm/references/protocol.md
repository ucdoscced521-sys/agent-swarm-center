# 共享协议正本（protocol.md）

> 本文件是「蜂群调度中心」全体智能体（主脑 + 7 个编制内角色）的**唯一协议来源**。
> 由 `skills: [agent-swarm]` 预加载。**任何角色不得自行发明协议变体。**

---

## 0. 工作目录契约（初始化时固化，之后不得变更）

```
<WORKSPACE>/
├── .swarm/
│   ├── HANDOFF.md                    # 跨会话交接正本（人 + 机器都读）
│   ├── main-log.md                   # 人读流水日志（yyyymmdd hhmm）
│   ├── decisions.md                  # 主脑决策记录（选人/调度/升级理由）
│   ├── contract.md                   # 环境契约（初始化产物，写死后续沿用）
│   ├── state/
│   │   ├── tasks.json                # 任务状态机（断点续跑唯一依据）
│   │   ├── agents.json               # 编制内 + 外聘能力地图与统计
│   │   ├── events.jsonl              # 机器读事件流（append-only）
│   │   └── brief.json                # 给主脑的 ≤2KB 压缩状态摘要
│   ├── bus/                          # ★ 跨宿主文件总线（保底通道）
│   │   ├── inbox/<task-id>.task.md   #   派单：任务说明书
│   │   ├── outbox/<task-id>.verdict.md # 回收：判定（首行必须合规）
│   │   └── claims/<task-id>.claim    #   认领锁（防重复执行）
│   ├── evidence/<task-id>/           # 证据：测试输出/日志/diff hash/截图
│   └── experience/patterns.md        # 经验库：失败模式、降权专家、有效提示词
```

**唯一事实源 = 磁盘。** 对话上下文是可丢弃缓存。任何人不得只在对话里"记住"状态。

---

## 1. 任务说明书模板（派单唯一格式）

派给任何子智能体（含外聘）的任务必须是这个格式，**自包含**——对端宿主看不到你的对话上下文。

```markdown
# TASK <task-id>
- 目标（一句话，可验证）：
- 交付物（精确路径）：
- 输入（路径，不要塞正文）：
- 验收标准（可自动判定，≥2 条；**只写可判定的判据，不写会过期的字面值**）：
- 证据要求（必须落到 <SWARM_DIR 绝对路径>/evidence/<task-id>/）：
- 权限边界（可写目录 / 禁止触碰，用 glob）：
- 工作目录（**绝对路径** / worktree）：
- 预算（时限 / 最多命令数 / **最多读取文件数**）：
- 失败时怎么办（重试上限 / 上报条件）：
- 回流格式：见 protocol.md §2
```

**禁止**：把素材/代码正文塞进说明书（只给路径）；用形容词代替验收标准（"做得好一点"不是标准）；**写死会过期的字面值**（如"测试恰好 72 项"——应写"`exit 0` 且 0 失败"）。

### 1.1 ⚠️ 路径硬规矩（不遵守必然产生「双调度根」）

> **实测事故**：说明书里写相对路径 `.swarm/bus/outbox/...`，而产出人的 cwd 是**代码仓库**（≠ 工作区），
> 于是它们在仓库内新建了**第二个 `.swarm/`**，判定与证据全落到那里 → 主脑过闸时全部报 `no_verdict`。

- **说明书里一切 `SWARM_DIR` 相关路径必须写绝对路径**，例如
  `C:\Users\<user>\WorkBuddy\<项目>\<会话>\…\.swarm\bus\outbox\<task-id>.verdict.json`
- **只有 `evidence` 数组内部**才用相对 `.swarm/` 的短路径（因为闸门会做 `path.join(SWARM_DIR, p)`）
- 派单时**必须同时告知产出人它的 cwd 与 SWARM_DIR 是两个不同目录**，并禁止它在 cwd 下创建 `.swarm/`

### 1.2 🔴 派单前自检（**强制闸，不过不许派单**）

> **实测教训**：一次真实运行中**契约层失误 5 次**（schema 双份打架 / 验收标准与禁改范围互斥 / 路径相对绝对混淆 /
> 说明书内部矛盾 / 任务书与交付物互斥），**主脑自查 0 次，全部由下游先发现**。失误率约 **19%**。

下发前逐条打勾，任一不过就**先别派**：

```
□ 路径全部绝对？SWARM_DIR 绝不写相对
□ 验收标准与"禁止写"的范围是否冲突？（标准要求的结果能否在约束内达成）
□ 说明书内部有无互斥条目？（同一件事有没有两条互相打架的要求）
□ 引用的契约是否唯一来源？（有没有第二份"差不多"的 schema / 规范）
□ 判据是否写死了会过期的字面值？（应作"exit 0 且 0 失败"，而非"恰好 N 项"）
□ 违反约束才能满足标准时，产出人该怎么办？→ 已写明"上报，禁止硬凑 PASS"
```

**契约定罪原则**：若产出人因"标准与约束打架"而无法达标，**责任在主脑，不在产出人**；
产出人正确做法是**上报**，不是绕路或硬凑。

---

## 2. VERDICT 协议（JSON + Schema 强校验 · 已实测）

子智能体产出**必须**写 `<WORKSPACE>/.swarm/bus/outbox/<task-id>.verdict.json`，
且必须通过 `schemas/verdict.schema.json` 的校验。
**已废弃**早期的"文本首行 + 正则"形式（`### 判定: ...`）—— 它有 2 个实测盲区，见下。

```json
{
  "verdict": "PASS",
  "task": "T-003",
  "agent": "builder-core@workbuddy",
  "evidence": ["evidence/T-003/test-run.txt"],
  "metrics": { "exit_code": 0, "tests": "12/12", "duration_s": 83 },
  "independent_level": "N/A",
  "handoff": "下一环所需的最小信息，≤300 字"
}
```

**七个字段全部必填，不得增删。** 其中：

- `metrics.tests` **只放短标识**（≤64 字符）：✅`"88/88"`、`"2/2 标准通过"` ❌`"全部通过，但有一个边界未覆盖"`
- `independent_level`：产出人一律写 `"N/A"`；**复核人必须写真实级别**（见 §2.1）

### 2.1 异源验收：分级定义与适用条件

> **设计动因**：协议原版要求"必须不同厂商的模型"，但真实环境往往只有一个模型可用 →
> 团队只能静默降级，而**按协议字面该轮全部验收无效**。**提一个做不到的要求，等于没有要求。**
> 故改为**分级 + 强制标注**：做不到高档就如实降级，并让降级**在账面上可见**。

| 级别 | 条件（**全部满足**才算） | 效力 | 适用条件 |
|---|---|---|---|
| **L3** `L3_cross_vendor` | 复核模型与产出模型**不同厂商** | ✅ **完全达标** | 有多个厂商的模型可用时，**优先用 L3** |
| **L2** `L2_strong` | ① 不同会话（独立上下文）② 不同 agent 身份 ③ **自己产出的证据文件**（不复用产出人的）④ **未读产出人的判定与结论** ⑤ 自己的 cwd 与产出人隔离 | ⚠️ **有条件达标**——可计入验收，但**必须在 `handoff` 与最终报告里标注实际级别** | 单厂商环境下的**默认档次** |
| **L1** `L1_weak` | 仅"不同 agent 身份"，与产出人共享上下文或复用其证据 | ❌ **视为未验收** | 仅可用于"冒烟复读"，不得计入覆盖 |

**判定规则**

- 复核人**必须在 `independent_level` 里如实声明**自己实际达到的级别；**虚报级别比降级更严重**（等同造假）
- 主脑收口时必须统计各级别数量并**写进报告**；不得用"已独立复核"含糊表述
- **L1 不得计入复核覆盖**；只有 L2/L3 计入

### 2.2 复核分级：不是每个任务都要同等复核（**cost 最大杠杆**）

> **实测**：一次小项目做了 26 派单 / **10 个独立复核**，接近 1:1 全覆盖 → 这是最大的成本来源。
> 复核要按**风险**分配，不是按"任务数"平均分配。

| 风险档 | 判定条件 | 复核要求 |
|---|---|---|
| **R3 高危** | 触碰真实数据/生产库、删除文件、改对外契约/公开 API、改 DB schema | **必须 L2 或 L3 独立复核**，不可豁免 |
| **R2 中危** | 新增功能、改核心逻辑、改测试 | **抽检**：主脑按 wave 抽 ≥50%，其余靠可复现证据 + 闸门 |
| **R1 低危** | 文档、注释、文案、格式化、只读审计 | **免独立复核**，只留自验证据；但**必须在报告里显式标注"R1 免复核"**及理由 |

**硬规矩**：无复核 **≠** 未验收。区分开：
- `R1` 免复核 → 计入验收（标注豁免理由）
- `R2/R3` 该复核却没有 → **不计入验收，且不得收口**

### ⚠️ 严格结构化输出模式的硬约束（只在真模型上暴露，必须遵守）

- 每个 object 的 `properties` 必须**全部**出现在 `required` 中 → **不允许"可选字段"**
- 每个 object 必须 `additionalProperties: false`
- 因此 `metrics` 只保留 3 个必填项，`handoff` 也为必填
- 违规会被 provider **直接拒收**：
  `Invalid schema ... 'required' is required to be supplied and to be an array including every key in properties`
- **改任何字段后，必须过一次真 provider 的最小调用**才能确认可用

### 三层防御（缺一不可）

| 层 | 防什么 | 手段 | 归因码 |
|---|---|---|---|
| **结构层** | 拼写漂移 / **夹带未声明字段** / 类型错 | JSON Schema | `schema_violation` |
| **身份层** | **张冠李戴、串号** | `verdict.task === 请求的 taskId` | `task_mismatch` |
| **事实层** | 假 PASS（判定合规但证据是编的） | 证据路径存在性 | `evidence_dangling` |

其余归因码：`no_verdict`（没写）/ `malformed_json`（不是合法 JSON）。

> **为什么必须升级**：实测中文本版放过了 2 类坏样本 —— ①夹带未声明字段（`approve:true`）②张冠李戴（`TASK:` 写别人的号）。
> 正则只管首行长什么样，管不了"结构对不对、是不是本人"。详见 `step3-report.md`。

### 主脑消费规则（上下文卫生的核心）

- 主脑**只**调用 `tools/json-gate.mjs` 对该文件做判定，**不得**自行解析判定内容。
- **永不**读判定之外的正文、永不读交付物内容、永不读 diff。
- **无证据即 FAIL**：`evidence` 为空数组或指向不存在的文件 → 直接 FAIL，不追问。
- 判定是**结构性**的，不依赖任何提示词措辞 → 改提示词无法绕过。

### 生产端与校验端共用同一份 schema（单源契约）

```bash
# Codex（--output-schema 已实测存在）
codex exec -C <wt> -s read-only --skip-git-repo-check \
  --output-schema <pkg>/schemas/verdict.schema.json "<task>"

# WorkBuddy（--json-schema 已实测存在）
node <cbc> -p "<task>" --output-format json \
  --json-schema "$(cat <pkg>/schemas/verdict.schema.json)"
```

### 体积预算（JSON 无法"只读头部"解析，故用 schema 钉死上限）

`evidence ≤ 8×256 + handoff ≤300 + agent ≤64 + task ≤32 + metrics(3 字段)`
→ 理论上限约 2.9KB，**实测合规样本仅 182–251B**。整文件解析也不伤上下文。

---

## 3. 状态回流三通道

| 通道 | 写入者 | 读取者 | 用途 |
|---|---|---|---|
| `bus/outbox/*.verdict.json` | 子智能体 | 主脑 | 判定回流（**json-gate 三层强校验**） |
| `state/events.jsonl` | 所有角色（append-only） | 机器/Engine | 时间线、并发度计算、审计 |
| `state/tasks.json` | 主脑 | 所有角色 | 断点续跑、依赖屏障 |

### 3.1 事件行格式（**强制契约** —— 不遵守则并发度无法度量）

> **实测事故**：协议原规定 `{"ts":…,"e":"task.start",…}`，真实运行却用了 `{"ts":…,"phase":0,"event":"…","actor":…,"detail":…}`。
> 字段名不一致 → **M1–M6 六个并发度指标一个都算不出来**；更糟的是 `ts` 被写成「**合成阶梯**」（非真实时间），时间线彻底失真。
> **教训：协议与度量工具必须共用同一套字段名，且时间戳必须真实。**

一行一 JSON，禁止多行。
**必填**：`ts` / `event` / `task` / `actor` ｜ **可选**：`phase` / `detail` / `pid` / `dur_s` / `verdict` / `wt`

```json
{"ts":"2026-09-26T01:10:03+08:00","event":"task.start","task":"T-003","actor":"builder-core","phase":3,"pid":24118,"wt":"C:/ws/.wt/T-003"}
{"ts":"2026-09-26T01:11:26+08:00","event":"task.end","task":"T-003","actor":"builder-core","phase":3,"pid":24118,"verdict":"PASS","dur_s":83}
{"ts":"2026-09-26T01:12:00+08:00","event":"dispatch","task":"T-004","actor":"scout-router","phase":3,"detail":"hotrank#2, capability=viz"}
```

- **`ts` 必须是真实时刻**（ISO 8601 带时区）。**严禁合成 / 推导 / 等距编排的时间戳**——那会让时间线与并发度全部失真
- `event` 白名单：`project_init` / `task.start` / `task.end` / `dispatch` / `decision` / `gate` / `escalate` / `capability.decision` / `meta`
- 并发度（M1）由 `task.start` / `task.end` 的 `ts` 与 `dur_s` 计算 → **缺任一项即视为"不可度量"，必须上报而非猜测**
- 本协议**吸收产出方的实践改进**：`phase` / `actor` / `detail` 三字段来自真实运行，比原版 `e`/`agent` 更有信息量

**主脑只读 `brief.json`**（由 `scribe-handoff` 或 Engine 生成），不读 events.jsonl 全文。

---

## 4. 选人调度策略（热度榜优先）

```
S0 硬门槛过滤（先筛，不看热度）
   ① 能力覆盖：候选能力域 ⊇ 任务所需能力域
   ② 宿主可达：已安装 或 市场可获取
   ③ 权限足够
   → 不满足任一条：淘汰，热门也不选

S1 候选排序（仅 S0 存活集合内）
   ① 热度/榜单排名升序（WorkBuddy 专家中心热度榜 > Codex 市场目录排名）
   ② 本地已安装 > 需安装
   ③ 能力域命中数多者优先
   ④ 成本/时延（仅 ①②③ 全同分时）

S2 派单：Top-1 主派 + Top-2 备胎（失败升级用）

S3 记录 decisions.md：候选池 / 热度排名 / 入选理由 / 备胎 / 榜单拉取时间

S4 反噬保护
   · 热度只决定"先试谁"，不决定"信谁"——一切产出必过 verifier-independent
   · 同一外聘专家连续 2 次 FAIL → 写入 experience/patterns.md 并降权
   · 榜单 TTL = 24h，每阶段开始重拉；拿不到榜单 → 退化为 ②③④ 排序并标注
```

**记忆句：热度决定顺序，证据决定采信。**

---

## 5. 跨宿主桥（命令均已实测，除标注 ⚠）

```bash
# ① WorkBuddy → Codex：起一个真独立进程干活
codex exec -C <worktree> -m <model> -s workspace-write "<task-spec>"

# ② 只读侦察
codex exec -s read-only "<probe>"

# ③ 枚举 Codex 侧并行会话（并发度证据）
codex agents

# ④ 向运行中的 Codex 会话异步投递消息
codex queue "<msg>"

# ⑤ Codex 侧市场：枚举可用能力
codex plugin list --json
codex plugin list --available --json

# ⑥ Codex → WorkBuddy（入口已定位；Windows 必须用 node 拉起，见下方说明）
node "<WORKBUDDY_CLI>/bin/codebuddy" -p "<task-spec>" --output-format json
```

### 5.1 WorkBuddy CLI 真实能力表（实测 v2.137.1）

入口：`<WorkBuddy安装目录>/resources/app.asar.unpacked/cli/bin/codebuddy`（包名 `@genie/agent-cli`，bin 别名 `codebuddy` / `codebuddy-code` / `cbc`）。
**它是无扩展名的 Node 脚本 → Windows 下必须 `<node.exe> <该路径>` 调用，直接双击/裸执行不会跑（表现为无输出）。**

| 需求 | 实参 |
|---|---|
| 非交互单次执行 | `-p/--print "<prompt>"` |
| 结构化输出 | `--output-format json` / `stream-json` |
| **强约束返回结构** | `--json-schema '{"type":"object",...}'` |
| 流式输入 | `--input-format stream-json` |
| 跳过权限确认 | `-y/--dangerously-skip-permissions` |
| 权限模式 | `--permission-mode <acceptEdits\|bypassPermissions\|default\|plan\|dontAsk\|auto>` |
| 子智能体权限 | `--subagent-permission-mode <mode>` |
| **能力剥夺（主脑禁用写权限）** | `--tools ""` / `--disallowedTools "Bash,Edit,Write"` / `--allowedTools` |
| **注入角色提示词** | `--system-prompt-file <path>` / `--system-prompt` / `--append-system-prompt` |
| **JSON 定义多个角色** | `--agents '{"reviewer":{"description":"...","prompt":"..."}}'` |
| 指定主 agent | `--agent <agent>` |
| **独立工作目录隔离** | `-w/--worktree [name]`（原生 git worktree）、`--add-dir` |
| **后台会话（真并行）** | `--bg` / `--background`、`--name <name>`、`--exec <command>` |
| **原生多智能体模式** | `--swarm`（teammates 作为独立进程运行） |
| 会话续接 | `--session-id <uuid>`、`-c/--continue`、`-r/--resume [id]`、`--fork-session` |
| 预算控制 | `--max-turns <n>`、`--effort <level>`、`--autocompact` |
| 本地插件目录 | `--plugin-dir <dirs...>`、`--channels <plugin:name@marketplace>` |
| 常驻服务 | `--serve`（Web UI / REST API / ACP over HTTP SSE）、`--acp`（stdio） |
| MCP | `--mcp-config <fileOrString>` |
| 跨宿主/远端 | `--remote-control [client]`、`--sandbox [url]` |

> 关键：`--tools ""` + `--disallowedTools` 让"主脑不写代码"从提示词自律升级为**物理不可为**；
> `--swarm` + `--bg` + `--worktree` 是 WorkBuddy 侧**原生**的真并行三件套；
> `--json-schema` / `--output-schema` **已作为本协议的正式形态**（见 §2）—— 判定不再依赖文本首行。

### 5.2 调用注意（实测踩坑 —— 三次尝试均失败，逐条留证）

**实测结论：`-p` 在"WorkBuddy 子进程"语境下不执行一次性回合。** 三次尝试：

| # | 做法 | 结果 |
|---|---|---|
| 1 | 同步调用 | 父 shell 被 `windows-child-process-containment` 带走，脚本半路死 |
| 2 | 后台 + 继承 stdin | 进程存活 300MB，**4 分钟零输出** |
| 3 | 后台 + 关 stdin + 清除继承的 `CODEBUDDY_SESSION_ID` | 仍 **EXIT=-1 / 228.7s / OUT_LEN=0** |

**决定性证据（第 3 次的进程日志）**：启动**完整成功**——13 个插件、agents、6 个 marketplaces 全部加载完毕，发出一条 trace（`Exported 1 spans`），然后**再也没有任何模型请求**，CPU 从 48% 跌到 0% 后永久静默。
对照正常会话必然出现的 `[ModelProvider] Stream idle monitor armed: requestId=...` —— 该进程**从头到尾没发起过请求**。
其会话注册为 `sessionId=interactive-<pid>` 且 **`url` 字段为空**；而正常托管的会话都有本地 HTTP 端点（见下）。

**排除的原因**：不是 stdin（关掉无效）、不是会话抢占（清掉继承的 `CODEBUDDY_SESSION_ID` 无效）。

**剩余嫌疑**：该 CLI 被设计为由 WorkBuddy 桌面端以 `--serve`/`--prewarm` 托管启动（见 `bin/codebuddy` 注释），子进程的 stdio 是管道而非控制台；`-p` 路径在这种宿主语境下拿不到执行回合，只是空转。**在外部真实控制台里跑未测**——这是待用户确认的最后一步。

### 5.3 候选更强通道：会话本地 HTTP 端点（待验证）

每个被托管的会话都会在 `~/.workbuddy/sessions/<pid>.json` 里暴露一个本地端点：

```json
{ "pid": 16428, "sessionId": "d937520b-...", "cwd": "...", "kind": "interactive",
  "url": "http://127.0.0.1:64489", "endpoint": "http://127.0.0.1:64489",
  "mode": "local", "version": "2.137.1" }
```

配合 CLI 的 `--serve`（Web UI + REST + ACP over HTTP SSE）与 `--acp`（stdio），这比 `-p` 更适合做**常驻桥接**：

- 起一个专用 sidecar：`node <cbc> --serve --port <free> --auth password`
- 从 `sessions/<pid>.json` 读回 `url` 与端口
- 通过该端点投递任务、回收判定

⚠️ **安全红线**：不要用 `--auth none`（帮助原文："lets any local process execute commands and read/write files through the server"）。用默认 password 模式并妥善保管凭据。

**该通道尚未实测**，仅作为 `-p` 不通时的下一步方向记录在此。

### 五条桥接铁律

1. **B2 文件总线永远是兜底**：跨宿主任务必须在 `.swarm/bus/` 留可离线读取的凭证，B3 失败不得丢任务。
2. **说明书自包含**：对端宿主看不到你的对话。
3. **只共享文件，不共享上下文**：禁止把本宿主的聊天历史喂给对端。
4. **一任务一执行者**：禁止同一 task-id 双宿主并发（写冲突 + 双份判定）。
5. **失败即降级**：B3 连续 3 次失败 → 落回 B2 并标注待人工/下一轮领取。

跨宿主回收时，**必须**在主脑侧重新校验 verdict 首行格式（对端可能不遵守，格式不合即 FAIL）。

---

## 6. 上下文卫生铁律（借鉴参考图 + 强化）

| # | 铁律 | 强化方式 |
|---|---|---|
| 1 | 主脑只调度不干活 | 靠 **`contracts/master-capability.json`** 的能力剥夺（默认拒绝 + 白名单），不靠自律；越界必须被拒并写 `capability.decision` 审计事件 |
| 2 | 不读子智能体产出内容 | 只 `Grep` 首行判定 + 证据路径存在性检查 |
| 3 | 不读素材/代码正文 | 只传路径 |
| 4 | 不代写任何子智能体产出 | 违者该阶段整体作废重做 |
| 5 | 延迟到达的消息不展开讨论 | 只回"已确认"三个字 |
| 6 | 每轮工作前先读 `brief.json` | 不为回忆历史而翻对话 |

---

## 7. 失败升级四级（禁止无限重试）

| 级别 | 动作 | 触发 |
|---|---|---|
| L1 **重试** | 原角色原提示词重跑（换 worktree） | 首次 FAIL 且失败原因属环境抖动 |
| L2 **重述** | 同角色，重写任务说明书（补验收标准/减范围） | 同任务第 2 次 FAIL |
| L3 **换人** | 启用 S2 备胎，或外聘同域另一专家 | 同任务第 3 次 FAIL |
| L4 **交人** | 标记 `BLOCKED`，写 `HANDOFF.md`，停止该分支 | 第 4 次 FAIL 或触发预算红线 |

**熔断红线（任一触发即停机上报）**：单任务耗时 > 20min；单任务命令数 > 200；阶段 token 超预算；同一错误模式重复 ≥ 3 次；连续 2 轮无文件变更（空转）。

---

## 8. 交接协议（每阶段结束强制）

### 交接三步法

**Seal 封板** → **Clear 清空** → **Replay 重放**

1. **Seal**：`scribe-handoff` 更新 `tasks.json` / `events.jsonl` / `HANDOFF.md` / `decisions.md`，并把 `brief.json` 重生成（≤2KB）。
2. **Clear**：用户开新对话（新会话/换宿主），旧上下文整体丢弃。
3. **Replay**：新会话只读三样东西——`HANDOFF.md` + `brief.json` + `contract.md`，然后从 `tasks.json` 的 `PENDING/IN_PROGRESS` 继续。

### HANDOFF.md 固定栏目（不可增删）

```markdown
## status snapshot      — 一句话现状 + 当前阶段 Pn + 完成度 x/y
## completed            — 已完成项，每条带证据路径
## key decisions        — 决策 + 理由（含选人理由）
## pending todos        — 待办，按优先级
## blocked              — 卡点 + 需要谁决策
## assumptions to verify — 未验证的假设（标 falsifiable）
## next actions         — 下一会话的第一批动作（可直接执行）
## context for new session — 新会话必读清单（只列路径，不列正文）
```

**铁律**：只写指针不写正文；每条结论必须带证据路径；不确定的写进 `assumptions to verify` 而不是当结论。

---

## 9. 真并行验证指标（M1–M6，阶段 Gate 硬指标）

| 指标 | 计算 | 合格线 |
|---|---|---|
| **M1 并发度** | Σ(任务时长) ÷ 阶段墙钟 | ≥ 2.5（5 槽位） |
| **M2 时间线重叠** | events.jsonl 中 ≥2 个 `task.start` 时段存在交集 | 必须存在 |
| **M3 进程快照** | 同一时刻 ≥2 个子进程（`codex agents` / PID） | 峰值 ≥ 3 |
| **M4 上下文隔离** | 子智能体 prompt 中不含其他子智能体的产出正文 | 100% 隔离 |
| **M5 写冲突暴露** | 两子智能体同写一文件 → 必须被 worktree 隔离拦住 | 0 次互覆 |
| **M6 会话独立** | 每个子智能体有独立 session/进程标识 | 100% 独立 |

**红队反向测试（必须通过）**：把某个子智能体换成"串行假实现"，Gate **必须报 FAIL**。若 Gate 通过 → 判定为伪协作，架构作废重做。

---

## 10. 运行时阶段状态机（P0–P5）

Engine/主脑按此推进，每阶段有 Exit Gate + 一次人工放行：

| 阶段 | 目标 | Exit Gate |
|---|---|---|
| P0 地基 | 契约、目录、协议落盘（无 LLM 参与） | `contract.md` + 目录骨架齐；协议文件存在 |
| P1 单链路 | 1 个任务走通 派单→执行→verdict→判定 | **过 `json-gate` 三关**（结构/任务绑定/证据存在）；旧"首行可解析"已废弃 |
| P2 真并行 | ≥3 子智能体同时跑，无写冲突 | **M1–M6 全达标 + 红队反测 FAIL** |
| P3 主脑决策环 | brief → next_actions → 派单 闭环 | 连续 5 轮决策无人工介入 |
| P4 质量控制 | 异源验收 + 反假 PASS + 失败升级 | 注入假 PASS 必被拦；4 级升级生效 |
| P5 长时自主 | 跨会话续跑 + 预算熔断 + 交接 | **关掉对话清空上下文后，仅读 HANDOFF 续跑成功** |

---

## 11. 成本纪律（实测：小项目 45 分钟 / ~200 积分，明显偏高）

### 11.1 钱花在哪了（证据来自一次真实运行）

| 成本源 | 证据 | 量级 |
|---|---|---|
| **复核 1:1 全覆盖** | 26 派单里含 **10 个独立复核**，每个都要重跑测试、重读代码 | **最大头** |
| 大文件反复进上下文 | 单份 `npm-test` 日志 **20–61KB**，被多个任务各读一遍（`run1`/`run2`/`x2`/`5files`…）| 很大 |
| 子智能体探索过度 | 单个 subagent 记录 **2.0–3.3MB** | 大 |
| 同一套测试重复跑 | 88 个测试跑了很多次 | 中 |
| 派单过细 + 补派 | 26 派单 / 11 wave，含空 wave；`T-307b/308a/309/310/311` 多为补派 | 中 |
| 主账过胖 | `tasks.json` 27KB / `decisions.md` 21KB / `HANDOFF.md` 17.5KB，反复读 | 中 |
| 收口后追加 | `T-311` 在宣布收口后落地 → 多一整轮 | 中 |

### 11.2 八条硬纪律（按省钱效果排序）

| # | 纪律 | 预期效果 |
|---|---|---|
| **S1** | **复核分级**（见 §2.2）：R3 必复核、R2 抽检 ≥50%、R1 免复核 | **省 40–50%** |
| **S2** | **证据摘要化**：禁止把 >8KB 的命令输出塞进回流；只回 `{exit_code, 用例数, 失败数, 首条失败}` + 落盘路径 | 大 |
| **S3** | **测试一次跑、多处引用**：同一 wave 内测试只跑一次，其他任务**引用同一路径**，禁止各跑一遍 | 大 |
| **S4** | **读取预算**：说明书必须写"最多读 N 个文件 / 最多跑 M 条命令"（默认 N=15, M=12）；**禁止全仓 grep** | 中 |
| **S5** | **模型分级路由**：主脑/复核用强模型；侦察/拆解/书记/文档类用快模型 | 中 |
| **S6** | **派单合并**：同一文件内的改动合并为一个任务；禁止"一句话改动开一个任务" | 中 |
| **S7** | **收口冻结**：宣布收口后不得再派单；追加需新开阶段并重新过 Exit Gate | 中 |
| **S8** | **主账瘦身**：`tasks.json` 只留 `{id,status,evidence,verifier,level}`；明细移 `state/tasks.detail/<id>.json` 按需读 | 小-中 |

### 11.3 预算硬闸（必须写进 `contract.md`）

`BUDGET` 必须含四条：单任务 ≤N min ｜ 单阶段 ≤R 轮 ｜ **单任务读取 ≤N 文件** ｜ **全局 token 上限**

每 wave 结束后主脑**必须**在 `main-log.md` 记一行消耗；**累计超上限 → 暂停并上报，不得自行续跑**。

### 11.4 🔴 不许为了省钱砍掉的东西

证据存在性校验 ｜ R3 高危任务的独立复核 ｜ 真实时间戳 ｜ 未验项登记

> **省钱只能省"重复劳动与上下文"，不能省"证据与复核"。**

---

## 12. 交付物与报告格式（输出形式 · 固定栏目）

每次收口**必须**产出 `report.md`（路径写进 HANDOFF），**固定 8 栏，不可增删**：

| # | 栏目 | 要求 |
|---|---|---|
| 1 | **范围** | 做了什么 / **明确没做什么** |
| 2 | **交付物** | 绝对路径清单 |
| 3 | **验收结果** | 逐条：标准原文 → 判定 → 证据路径 |
| 4 | **复核覆盖与异源级别** | 必须写成 `L3×a / L2×b / L1×c / R1豁免×d`，并给 **覆盖数/应复核数** |
| 5 | **未验项（诚实边界）** | 每条必须 **falsifiable**，含"怎么验" |
| 6 | **风险与遗留** | 含"红线邻近动作" |
| 7 | **成本** | 派单数 / 复核数 / 估算 token / **与预算对比** |
| 8 | **next actions** | 新会话第一批可执行动作 |

**禁止**：用"全部通过""已独立复核"这类**不含数字与级别**的表述。
