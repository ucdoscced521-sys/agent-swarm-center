# Step 3 · 判定硬化验证报告

- 运行时间：2026-09-25T18:27:19.894Z
- 断言结果：**8/8 通过**
- 成本：0 credits

## 变更点

| | 旧（text gate） | 新（json gate） |
|---|---|---|
| 判定载体 | 文本首行 | JSON 对象 |
| 校验方式 | 正则 `^### 判定:\s*(...)$` | **JSON Schema**（enum/type/required/additionalProperties/minItems/maxLength）|
| 证据语义 | 逗号分隔字符串 | **数组**，类型与条数由 schema 强制 |
| 任务绑定 | ❌ 不校验 | ✅ `verdict.task` 必须等于本次任务号 |
| 夹带字段 | 无法察觉 | `additionalProperties:false` 直接拒 |
| 体积控制 | 无上限 | maxItems/maxLength/白名单三重钉死 |
| 上下文成本 | 只读头部 | 需整文件解析，但**体积被 schema 钉死** |

## 同一批样本的对照结果

| 样本 | 场景 | text gate | json gate | 期望 |
|------|------|-----------|-----------|------|
| T-301 | 合规样本（对照组） | PASS/ok | PASS/ok | ok ✅ |
| T-302 | 判定拼写漂移 PASSED | FAIL/malformed_verdict | FAIL/schema_violation | schema_violation ✅ |
| T-303 | 证据为空 | FAIL/evidence_absent | FAIL/schema_violation | schema_violation ✅ |
| T-304 | 证据写成字符串（类型错） | FAIL/evidence_dangling | FAIL/schema_violation | schema_violation ✅ |
| T-305 | 夹带未声明字段 approve | PASS/ok | FAIL/schema_violation | schema_violation ✅ |
| T-306 | 张冠李戴（声明别的任务号） | PASS/ok | FAIL/task_mismatch | task_mismatch ✅ |
| T-307 | 证据指向不存在的文件 | FAIL/evidence_dangling | FAIL/evidence_dangling | evidence_dangling ✅ |
| T-308 | 判定写成小写 pass | FAIL/malformed_verdict | FAIL/schema_violation | schema_violation ✅ |

> 文本版被**绕过**（判 PASS）的坏样本：**2 例** → T-305(夹带未声明字段 approve)、T-306(张冠李戴（声明别的任务号）)
> 这 2 例在 json gate 下全部被拦，且归因精确 —— 这就是本次硬化的**实际增益**。

## 断言明细

| # | 断言 | 期望 | 实际 | 结果 |
|---|------|------|------|------|
| 1 | J1 对照组：json gate 不误杀合规样本 | PASS | PASS/ok | ✅ |
| 2 | J2 7 个坏样本 json gate 全部拦下 | 7/7 FAIL | 7/7 | ✅ |
| 3 | J3 归因精确（每个样本 reason 符合预期） | 7/7 精确 | T-302:schema_violation T-303:schema_violation T-304:schema_violation T-305:schema_violation T-306:task_mismatch T-307:evidence_dangling T-308:schema_violation | ✅ |
| 4 | J4 【覆盖增益】文本版被绕过的样本数 | >= 2 | 2 例：T-305,T-306 | ✅ |
| 5 | J5 【覆盖增益】这些样本 json gate 全部拦下 | 全部 FAIL | T-305:FAIL T-306:FAIL | ✅ |
| 6 | J6 体积预算：合规 verdict ≤ 1024B（整文件读也不伤上下文） | <= 1024B | 281B | ✅ |
| 7 | J7 零外部依赖（不引入未打包的第三方） | 0 个 | 0 个 | ✅ |
| 8 | J8 schema 上限可推导（体积可控，非拍脑袋） | 可推导 | evidence 8×256 + handoff 300 + agent 64 + task 32 + metrics ≈ 2.9KB（理论上限） | ✅ |

## 生产接线（Step 3 之后怎么用）

本验证覆盖的是**校验端**。生产上还要在**生产端**让模型输出受同一份 schema 约束：

```bash
# Codex（--output-schema 已实测存在：Path to a JSON Schema file describing the model's final response shape）
codex exec -C <wt> --output-schema schemas/verdict.schema.json --json "<task>"
# WorkBuddy（--json-schema 已实测存在）
node <cbc> -p "<task>" --output-format json --json-schema "$(cat schemas/verdict.schema.json)"
```

两端用**同一份** `schemas/verdict.schema.json` —— 契约单源，校验端与生产端不可能漂移。

## 结论

✅ **Step 3 成立**：判定从"文本 + 正则"升级为"JSON + Schema 强校验"，并在实测中**多拦下 2 例原文本版会放过的坏样本**。
