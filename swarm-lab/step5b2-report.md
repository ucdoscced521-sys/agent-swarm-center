# Step 5B（改道版）· 真模型 builder + verifier，全程 read-only

- 运行时间：2026-09-25T18:30:03.717Z
- 断言结果：**11/11 通过**
- 真实模型调用：2 次 ｜ 耗时：builder 52.9s / verifier 51.2s
- 沙箱：`-s read-only`（避开 codex 写沙箱安装 → 不再触发宿主拦截）

## 为什么改道

`-s workspace-write` 会让 codex 在 Windows 上安装自己的 OS 级沙箱（触碰 `AppData\Local\Microsoft\Windows\Caches`、`System32\CatRoot2`），**被宿主沙箱两次拦截**（连 `node.exe` 执行都被拒）。
改为：模型在 read-only 下**把产物内容当数据返回**，编排层负责落盘与执行验收。
**代价要说清**：验收命令由实验台执行，不是模型自己跑的；模型只负责"写出正确代码"。

## 真 builder 产出

```javascript
import { readFile } from 'node:fs/promises';

try {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node count-fields.mjs <file.json>');

  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Top-level JSON value must be an object');
  }

  console.log(Object.keys(value).length);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

```

## 实验台实测（不采信模型自述）

```
harness ran: node src/count-fields.mjs sample.json -> exit=0 stdout=3
harness ran: node src/count-fields.mjs nope.json   -> exit=1 stderr=ENOENT: no such file or directory, open 'C:\Users\lxjhudan\WorkBuddy\2026-09-25-20-44-40\multi-agent-plugin\swarm-lab\runs\real-5b2\worktree\nope.json'
AC1 (prints 3, exit 0): PASS
AC2 (missing file non-zero): PASS
```

## 真 verifier 判定

```json
{
  "verdict": "PASS",
  "agent": "verifier-independent@real",
  "evidence": [
    "evidence/T-421/verify-report.md"
  ],
  "metrics": {
    "duration_s": 0,
    "exit_code": 0,
    "tests": "2/2"
  },
  "handoff": "Both criteria pass on the supplied raw evidence; the report also assesses untested non-object input handling."
}
```

## 断言明细

| # | 断言 | 期望 | 实际 | 结果 |
|---|------|------|------|------|
| 1 | B1 真 builder 返回了产物文件 | >=1 | 2 个（src/count-fields.mjs,evidence/T-421/selfcheck.md） | ✅ |
| 2 | B2 产物路径正确 src/count-fields.mjs | true | true | ✅ |
| 3 | B3 builder 返回的 verdict 结构合规 | true | JSON ok | ✅ |
| 4 | B4 真 builder 产出【可运行的代码】(AC1) | PASS | exit 0 out "3" | ✅ |
| 5 | B5 真 builder 处理了异常路径 (AC2) | PASS | exit 1 | ✅ |
| 6 | B6 实测结果与 builder 自述一致（不盲信自述） | 一致 | 自述 verdict=PASS / 实测 PASS | ✅ |
| 7 | V1 真 verifier 返回结构合规 | true | JSON ok | ✅ |
| 8 | V2 verifier 证据与 builder 证据不同 | 两份不同 | evidence/T-421/selfcheck.md vs evidence/T-421/verify-report.md | ✅ |
| 9 | V3 异源标记（agent 不同） | 不同 | builder-core@real vs verifier-independent@real | ✅ |
| 10 | V4 verifier 写出了复核报告 | >=1 个文件 | 1 个 | ✅ |
| 11 | X1 记录两者判定是否一致（一致/不一致都接受） | 已记录 | builder=PASS verifier=PASS → 一致 | ✅ |

## 诚实标注
- **"异源"只是不同会话、不同 agent 身份、同一底层模型**；真异源需不同厂商模型，本步未覆盖。
- verifier 的输入含实验台提供的原始验收输出（它自己没有执行权限），因此它验的是"证据是否支持结论"，不是"亲自重跑"。
- 原始 stdout/stderr 落在 `runs/real-5b2/*.txt`。
