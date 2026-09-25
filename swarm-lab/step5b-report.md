# Step 5B · 真模型 builder + verifier（端到端）

- 运行时间：2026-09-25T15:22:34.708Z
- 断言结果：**5/10 通过**
- 真实模型调用：2 次 ｜ 耗时：builder 126.3s / verifier 102.9s

## 真模型实际产出

```json
{
  "agent": "builder-core@real",
  "evidence": [
    "evidence/T-421/test-run.txt"
  ],
  "handoff": "Filesystem writes and Node execution were denied; script and evidence were not created, and exit_code=-1 indicates no script execution.",
  "metrics": {
    "duration_s": 58,
    "exit_code": -1,
    "tests": "0/2"
  },
  "task": "T-421",
  "verdict": "FAIL"
}
```
```json
{
  "agent": "verifier-independent@real",
  "evidence": [
    "evidence/T-421/verify-report.md"
  ],
  "handoff": "Both launches and report writes were denied; rerun with working permissions; exit_code -1 means unavailable.",
  "metrics": {
    "duration_s": 0.3552504,
    "exit_code": -1,
    "tests": "0/2"
  },
  "task": "T-421",
  "verdict": "FAIL"
}
```

## 断言明细

| # | 断言 | 期望 | 实际 | 结果 |
|---|------|------|------|------|
| 1 | B1 真 builder 产出交付物文件 | true | false | ❌ |
| 2 | B2 真 builder 产出证据文件 | true | false | ❌ |
| 3 | B3 真 builder 的 verdict 可解析 | true | JSON ok | ✅ |
| 4 | B4 真 builder 的 verdict 通过 json-gate | PASS/ok | FAIL/evidence_dangling | ❌ |
| 5 | B5 主脑复验：交付物真能跑且输出 3 | exit 0 / out 3 | exit 1 / out  | ❌ |
| 6 | V1 真 verifier 的 verdict 可解析 | true | JSON ok | ✅ |
| 7 | V2 真 verifier 的 verdict 通过 json-gate | PASS/ok | FAIL/evidence_dangling | ❌ |
| 8 | V3 证据独立（不是同一个文件） | 两份不同证据 | evidence/T-421/test-run.txt vs evidence/T-421/verify-report.md | ✅ |
| 9 | V4 异源标记（agent 字段不同） | 不同 agent | builder-core@real vs verifier-independent@real | ✅ |
| 10 | X1 记录两者判定是否一致（一致/不一致都接受，只记录） | 已记录 | builder=FAIL verifier=FAIL → 一致 | ✅ |

## 诚实标注
- 本步的"异源"只是**不同会话/不同 agent 身份**，仍是**同一底层模型**。
  真正的异源（不同厂商模型）需要 WorkBuddy 侧的跨模型验收，本步未覆盖。
- builder 与 verifier 共用同一 schema 文件（单源契约），该文件已通过 provider 严格模式校验。
- 原始 stdout/stderr 落在 `runs/real-5b/*.txt`，可逐条复核。
