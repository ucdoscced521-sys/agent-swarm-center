/**
 * run-step5a.mjs — Step 5A：真模型 vs 判定契约（schema 遵从度）
 *
 * 四步验证全用假 worker，最大的未知是：**真模型会不会遵守我们的 schema？**
 * 本步用 Codex 真模型 + `--output-schema`（该参数已实测存在于 codex exec --help）
 * 让模型直接产出 verdict JSON，再用 Step 3 的 json-gate 校验。
 *
 * 判据：schema 遵从率。若真模型会漂移，Step 3 的契约就必须加"模型侧纠偏"回路。
 *
 * 运行: node tools/run-step5a.mjs [runs=3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeJson } from './json-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const SWARM = path.join(LAB, '.swarm');
const SCHEMA = path.join(LAB, 'schemas', 'verdict.schema.json');
const RUNS = Number(process.argv[2] ?? 3);
const CODEX = process.env.CODEX_CLI ?? 'E:\\Codex\\bin\\codex.exe';
const RUN_DIR = path.join(LAB, 'runs', 'real-5a');

const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const nowIso = () => new Date().toISOString();

// 预置证据文件（让"证据存在性"这道闸有机会通过）
for (let i = 1; i <= RUNS; i++) w(path.join(SWARM, `evidence/T-41${i}/proof.txt`), `real-model run ${i}\n`);
// ⚠️ codex exec 的 -C 指向的工作目录必须**已存在**，否则报 os error 2（踩过）
fs.mkdirSync(RUN_DIR, { recursive: true });

const results = [];

for (let i = 1; i <= RUNS; i++) {
  const taskId = `T-41${i}`;
  const prompt = [
    'Return ONLY a single JSON object that conforms to the provided JSON schema.',
    'No prose. No markdown code fences. No explanation.',
    'Facts to encode:',
    `- task: "${taskId}"`,
    '- agent: "builder-core@local"',
    '- verdict: "PASS"',
    `- evidence: ["evidence/${taskId}/proof.txt"]`,
    '- metrics: {"exit_code": 0, "tests": "2/2", "duration_s": 1.5}',
    '- independent_level: "N/A"',
    '- handoff: "delivered"',
  ].join('\n');

  const t0 = Date.now();
  // 两个必须显式处理的点（都踩过）：
  //  ① input: '' —— 不关 stdin 的话 codex 会 "Reading additional input from stdin..." 并失败
  //  ② --skip-git-repo-check —— -C 目录不是受信 git 仓库时会被拒（错误信息自己提示了这个参数名）
  const r = spawnSync(CODEX, [
    'exec',
    '-C', RUN_DIR,
    '-s', 'read-only',
    '--skip-git-repo-check',
    '--output-schema', SCHEMA,
    prompt,
  ], { encoding: 'utf8', timeout: 420000, maxBuffer: 32 * 1024 * 1024, input: '' });
  const durS = Number(((Date.now() - t0) / 1000).toFixed(1));

  // 落原始输出，便于事后核对
  w(path.join(RUN_DIR, `raw-${taskId}.stdout.txt`), r.stdout ?? '');
  w(path.join(RUN_DIR, `raw-${taskId}.stderr.txt`), r.stderr ?? '');

  // 提取最终 JSON：从 stdout 里找第一个 { 到最后一个 }
  const out = (r.stdout ?? '').trim();
  const s = out.indexOf('{');
  const e = out.lastIndexOf('}');
  let parsed = null;
  let parseNote = '';
  if (s >= 0 && e > s) {
    const slice = out.slice(s, e + 1);
    try { parsed = JSON.parse(slice); } catch (err) { parseNote = `JSON.parse 失败: ${err.message}`; }
    w(path.join(SWARM, 'bus', 'outbox', `${taskId}.verdict.json`), slice + '\n');
  } else {
    parseNote = 'stdout 中未找到 JSON 对象';
    w(path.join(SWARM, 'bus', 'outbox', `${taskId}.verdict.json`), out);
  }

  const jr = judgeJson(taskId, SWARM, SCHEMA);
  results.push({
    taskId, exit: r.status, durS,
    bytes: out.length,
    parsed: parsed !== null,
    parseNote,
    verdict: jr.verdict,
    reason: jr.reason,
    firstErr: jr.schemaErrors?.[0] ?? '',
    rawHead: out.split('\n').slice(0, 4).join(' ⏎ ').slice(0, 220),
  });
  console.log(`[5A] ${taskId} exit=${r.status} ${durS}s -> ${jr.verdict}/${jr.reason}`);
}

// ── 报告 ───────────────────────────────────────────────────────
const compliant = results.filter((x) => x.reason === 'ok');
const parseOk = results.filter((x) => x.parsed);
const L = [];
L.push('# Step 5A · 真模型 vs 判定契约（schema 遵从度）', '');
L.push(`- 运行时间：${nowIso()}`);
L.push(`- 模型：Codex 默认（\`${CODEX}\`），\`--output-schema\` 指向 \`schemas/verdict.schema.json\``);
L.push(`- 样本数：${RUNS} ｜ 单次耗时：${results.map((r) => r.durS + 's').join(' / ')}`, '');
L.push('## 结果', '');
L.push('| 任务 | exit | 耗时 | 输出字节 | 可解析 JSON | json-gate 判定 | 归因 |');
L.push('|------|------|------|----------|-------------|----------------|------|');
for (const r of results) {
  L.push(`| ${r.taskId} | ${r.exit} | ${r.durS}s | ${r.bytes} | ${r.parsed ? '✅' : '❌'} | ${r.verdict}/${r.reason} | ${r.firstErr || r.parseNote || '-'} |`);
}
L.push('');
L.push(`**schema 遵从率：${compliant.length}/${RUNS}** ｜ 可解析率：${parseOk.length}/${RUNS}`);
L.push('');
if (compliant.length === RUNS) {
  L.push('✅ **真模型 100% 遵守 schema**，且落地后通过 json-gate —— Step 3 的契约在真模型上成立，无需额外纠偏回路。');
} else {
  L.push('❌ **真模型存在漂移**，Step 3 的契约需要补"模型侧纠偏回路"（如 schema 校验失败则带错误重试一次）。');
  L.push('');
  L.push('漂移样本的原始输出开头：');
  for (const r of results.filter((x) => x.reason !== 'ok')) L.push(`- ${r.taskId}: \`${r.rawHead}\``);
}
L.push('');
L.push('## 诚实标注');
L.push('- 本步只验证**输出契约遵从度**，不验证"模型能否按规格写代码"（那是 5B）。');
L.push('- `-s read-only` 沙箱，本步模型不写任何文件，风险面为零。');
L.push('- 原始 stdout/stderr 已落 `runs/real-5a/raw-*.txt`，可逐条复核。');
w(path.join(LAB, 'step5a-report.md'), L.join('\n') + '\n');
fs.appendFileSync(path.join(SWARM, 'main-log.md'),
  `(step5a) 真模型 schema 遵从：${compliant.length}/${RUNS}\n`);

process.exit(compliant.length === RUNS ? 0 : 1);
