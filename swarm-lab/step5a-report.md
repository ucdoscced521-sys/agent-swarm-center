# Step 5A · 真模型 vs 判定契约（schema 遵从度）

- 运行时间：2026-09-25T18:28:18.629Z
- 模型：Codex 默认（`E:\Codex\bin\codex.exe`），`--output-schema` 指向 `schemas/verdict.schema.json`
- 样本数：1 ｜ 单次耗时：42.1s

## 结果

| 任务 | exit | 耗时 | 输出字节 | 可解析 JSON | json-gate 判定 | 归因 |
|------|------|------|----------|-------------|----------------|------|
| T-411 | 0 | 42.1s | 207 | ✅ | PASS/ok | - |

**schema 遵从率：1/1** ｜ 可解析率：1/1

✅ **真模型 100% 遵守 schema**，且落地后通过 json-gate —— Step 3 的契约在真模型上成立，无需额外纠偏回路。

## 诚实标注
- 本步只验证**输出契约遵从度**，不验证"模型能否按规格写代码"（那是 5B）。
- `-s read-only` 沙箱，本步模型不写任何文件，风险面为零。
- 原始 stdout/stderr 已落 `runs/real-5a/raw-*.txt`，可逐条复核。
