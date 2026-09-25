# Agent Swarm — AGENTS.md 注入片段

> Codex 不会自动合并插件内的 AGENTS.md，需由 postinstall 脚本把本文件内容追加到项目根的 `AGENTS.md`（或 `~/.codex/AGENTS.md`）。
> 注入位置建议放在文件**开头与结尾各一次**（首尾重复可抵抗长上下文漂移）。

---

## 多智能体协作约定（Agent Swarm）

本仓库使用「蜂群调度中心」协作规程。任何非平凡任务（≥3 步或涉及多文件）必须走以下流程，禁止单打独斗。

**状态目录**：`.swarm/`（唯一事实源）。开始工作前先读 `.swarm/HANDOFF.md` 与 `.swarm/state/brief.json`；若不存在，说明这是首轮，需先初始化。

**角色**：主脑 `agent-swarm-team-lead` 只调度不干活；执行角色 `scout-router` / `planner-splitter` / `builder-core` / `tester-breaker` / `verifier-independent` / `scribe-handoff` / `bridge-crosshost`。

**五条硬约束**：

1. **判定只有一个合法形态**：`.swarm/bus/outbox/<task-id>.verdict.json`，且必须通过 `schemas/verdict.schema.json`（**七个字段全必填**）。主脑**调用 `tools/json-gate.mjs` 判定**，不自行解析、不读其正文。自然语言汇报一律不算判定。
2. **三层闸缺一不可**：结构（Schema）/ 身份（`task` 必须等于本任务号）/ 事实（`evidence` 路径必须真实存在）。任一不过即 FAIL。
3. **异源分级，如实声明**：优先 **L3**（不同厂商模型）；做不到用 **L2**（不同会话 + 不同身份 + **自己的证据** + 未读对方结论 + cwd 隔离）；**L1 视为未验收**。级别必须写进 `independent_level`——**虚报等同造假**。
4. **隔离作业**：每个执行者使用独立工作目录（`git worktree`），禁止共享可写目录。
5. **主脑能力受契约约束**：以 `contracts/master-capability.json` 为准，主脑的写能力被**物理移除**（不是自律），越界动作必须被拒并留痕。
6. **路径必须绝对**：说明书与产出中一切 `SWARM_DIR` 相关路径写**绝对路径**；产出人**禁止在自己的 cwd 下创建 `.swarm/`**（会造成**双调度根**，主脑过闸全报 `no_verdict`）。
7. **成本纪律**：证据摘要化（禁把 >8KB 输出塞进回流）/ 同一 wave 内测试**只跑一次**多处引用 / 遵守读取预算（默认 ≤15 文件、≤12 命令）/ **禁止全仓 grep**。
8. **派单前自检 6 条**（protocol.md §1.2）不过**不许派单**；因"标准与约束打架"导致产出人无法达标时，**责任在主脑**。
9. **复核按风险分级**：R3 必复核 / R2 抽检 ≥50% / R1 免复核但需留痕；该复核却没有 → **不得收口**。
10. **时间戳必须真实**：`events.jsonl` 的 `ts` 用 ISO 真实时刻，**严禁合成阶梯**——否则并发度无法度量。

**跨宿主**：WorkBuddy 与 Codex 互相调用只走 `bridge-crosshost` 角色；文件总线 `.swarm/bus/` 是永远可用的兜底通道，CLI 调用只是加速器。

**热度榜调度**：选用专家/插件时按「先筛资格、再排热度」顺序——能力不覆盖者一律淘汰（热门也不选）；在存活集合内按榜单名次升序取主派，次名者为备胎。热度只决定"先试谁"，不决定"信谁"。

**已完成阶段必须交接**：阶段末由 `scribe-handoff` 封板并生成 `HANDOFF.md` + `brief.json`，然后开新对话继续（Seal → Clear → Replay）。
