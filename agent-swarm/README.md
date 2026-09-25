# 蜂群调度中心 · Agent Swarm Center

> 丢一句话进去，出来一份经过独立验收的交付。
> 一份包，双宿主上架：WorkBuddy 专家团 + Codex 插件。

---

## 这是什么

一个「一主多子」多智能体协作插件。主智能体只调度不干活，子智能体真实并行独立执行，判定以首行 PASS/FAIL 回流，状态全部落在磁盘上，所以**任何新会话读完交接文件就能接着干**。

**三条设计底线**

1. **循环归程序，决策归模型** —— 长时运行不靠模型记性，靠 `.swarm/` 磁盘状态
2. **状态归磁盘，不归上下文** —— 对话可随时丢弃，这是"跨会话续跑"的物理前提
3. **能力剥夺优先于行为禁止** —— 主脑"不写代码"靠权限，不靠提示词自律

---

## 目录结构

```
agent-swarm/
├── manifest.yaml                     底座索引（type: expert）
├── settings.json                     Team 型必需，指向主理人
├── .codebuddy-plugin/plugin.json     ← WorkBuddy 专家中心清单
├── .codex-plugin/plugin.json         ← Codex 插件市场清单
├── agents-fragment.md                Codex 侧 AGENTS.md 注入片段
├── agents/                           ★ 通用提示词正本（双宿主共用）
│   ├── agent-swarm-team-lead.md            主智能体 · 隋调度 · 总调度长
│   ├── scout-router.md               资源猎人 · 甄可选（热度榜选人）
│   ├── planner-splitter.md           拆解参谋 · 许分明
│   ├── builder-core.md               主力编码官 · 寇图灵
│   ├── tester-breaker.md             破防测试官 · 查必现
│   ├── verifier-independent.md       独立验收官 · 严佐证（异源）
│   ├── scribe-handoff.md             交接书记官 · 纪长明
│   └── bridge-crosshost.md           跨宿主桥接官 · 连两岸
└── skills/agent-swarm/
    ├── SKILL.md                      Codex 侧主控规程
    └── references/protocol.md        ★ 共享协议正本（判定/回流/选人/桥接/交接）
```

**只有清单文件分叉，角色提示词与协议双宿主共用。**

---

## 形态 A：装成 WorkBuddy 专家团

```bash
# ⚠ 专家必须生成到专家目录，否则不会被检测到
EXPERT_DIR="$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins"

# 1) 初始化骨架
python3 <expert-manager>/scripts/init_expert.py agent-swarm --type team --path "$EXPERT_DIR"

# 2) 把本包内容覆盖进去（agents/ skills/ manifest.yaml settings.json .codebuddy-plugin/）
#    并补 avatars/（8 个头像，PNG 512×512 ≤500KB）

# 3) 校验 + 注册 + 打包
python3 <expert-manager>/scripts/validate_expert.py "$EXPERT_DIR/agent-swarm"
python3 <expert-manager>/scripts/register_expert.py "$EXPERT_DIR/agent-swarm"
python3 <expert-manager>/scripts/package_expert.py  "$EXPERT_DIR/agent-swarm"
```

**使用**：专家中心 → 我的专家 → 「蜂群调度中心」→ 丢一句任务。

---

## 形态 B：装成 Codex 插件

已实测可用的路径（Codex CLI v0.117+，本地市场，零外部依赖）：

```bash
# 0) 先探明环境（别猜路径）
codex plugin marketplace list --json   # 看已配置市场与各自 root
echo $CODEX_HOME                       # CLI 的真实 home

# 1) 把插件放到家目录的 plugins/ 下（local source 的基准就是家目录）
#    ~/plugins/agent-swarm/

# 2) 追加条目到用户级市场目录文件 ~/.agents/plugins/marketplace.json
#    source.path 相对【家目录】："./plugins/agent-swarm"
#    （务必读原文件再合并，别覆盖已有 plugins）

# 3) 安装
codex plugin add agent-swarm@personal --json

# 4) 验证：期望 installed[] 出现 installed:true, enabled:true
codex plugin list --json
```

安装产物落在 `$CODEX_HOME/plugins/cache/personal/agent-swarm/<version>/`。

**使用**：开新会话（`/new`）后
- `$agent-swarm:agent-swarm` 显式调用，或
- 直接描述任务，由 `interface.defaultPrompt` 隐式激活

**两个必须知道的点**

1. **Codex 不会自动合并**本插件的 `agents-fragment.md` 到 `AGENTS.md`。不注入时只有显式调用才生效；要让它在每个 Codex 会话里默认生效，需手动把 `agents-fragment.md` 追加到全局或项目级 `AGENTS.md`（建议首尾各注一次以抵抗长上下文漂移，并加可识别标记便于回退）。
2. 远端目录拉取在受限网络下会报 `failed to list remote marketplace plugins` —— 这是**无害警告**，本地市场照常工作。


---

## 0 → 1 怎么跑起来（首轮）

```bash
# 1. 建工作区与状态目录
mkdir -p .swarm/{state,bus/inbox,bus/outbox,bus/claims,evidence,experience}

# 2. 在 WorkBuddy 选专家团 / 在 Codex 调 $agent-swarm:agent-swarm

# 3. 丢一句话
帮我做完 <你的任务>，你自己拆解、自己派人、自己验收，中途不用问我。
```

主脑会自动走：**立项 → 侦察（拉热度榜）→ 拆解 → 派单 → 回流判定 → 异源验收 → 收口交接**。

---

## 阶段末必须做的事

`scribe-handoff` 封板后，**开新对话**继续（Seal → Clear → Replay）：

1. **Seal 封板** —— 生成/更新 `.swarm/HANDOFF.md` + `.swarm/state/brief.json`（≤2KB）
2. **Clear 清空** —— 开新对话，旧上下文整体丢弃
3. **Replay 重放** —— 新会话只读 `HANDOFF.md` + `brief.json` + `contract.md` 三样，从 `tasks.json` 续跑

---

## 选人策略（一句话）

**热度决定顺序，证据决定采信。**

先用硬门槛筛掉能力不覆盖的（热门也不选），再在存活集合内按榜单名次升序取 Top-1 主派 + Top-2 备胎；所有产出必过异源独立验收。详见 `skills/agent-swarm/references/protocol.md` §4。

---

## 已知未决项

| # | 事项 | 现状 |
|---|---|---|
| U1 | `codebuddy` headless 调用参数 | 入口存在（`cli\bin\codebuddy`），`--help` 输出为空 → **待实测**；未确认前 Codex→WorkBuddy 一律走文件总线 |
| U2 | `codex exec` 结构化输出能力 | 部分参数已实测；`--json` 类输出来源待确认 |
| U3 | Codex 侧并发槽位与配额 | 待压测 |
| U4 | 头像风格 | 待生成 |
