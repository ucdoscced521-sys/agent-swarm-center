/**
 * run-step5b.mjs — Step 5B：真模型当 builder + 真模型当 verifier
 *
 * 5A 只验了"输出契约遵从度"。5B 验三件事：
 *   ① 真模型能否**按规格真正实现**（写文件 + 跑通）
 *   ② 真 verifier 能否**独立复核**（不看 builder 结论、用不同证据文件）
 *   ③ 两者判定是否一致（一致率高本身是可疑信号，须记录）
 *
 * 运行: node tools/run-step5b.mjs
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
const CODEX = process.env.CODEX_CLI ?? 'E:\\Codex\\bin\\codex.exe';
const TASK = 'T-421';
const WT = path.join(LAB, 'runs', 'real-5b', 'worktree');

const A = [];
const check = (n, e, a, ok) => A.push({ name: n, expected: e, actual: a, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };

fs.rmSync(path.join(LAB, 'runs', 'real-5b'), { recursive: true, force: true });
fs.mkdirSync(WT, { recursive: true });
w(path.join(WT, 'sample.json'), JSON.stringify({ alpha: 1, beta: 2, gamma: 3 }, null, 2) + '\n');

function callCodex({ sandbox, prompt, tag }) {
  const t0 = Date.now();
  const r = spawnSync(CODEX, [
    'exec', '-C', WT, '-s', sandbox, '--skip-git-repo-check',
    '--output-schema', SCHEMA, prompt,
  ], { encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024, input: '' });
  const durS = Number(((Date.now() - t0) / 1000).toFixed(1));
  w(path.join(LAB, 'runs', 'real-5b', `${tag}.stdout.txt`), r.stdout ?? '');
  w(path.join(LAB, 'runs', 'real-5b', `${tag}.stderr.txt`), r.stderr ?? '');
  return { status: r.status, durS, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' };
}

function extractVerdict(stdout, taskId) {
  const s = stdout.indexOf('{');
  const e = stdout.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  const slice = stdout.slice(s, e + 1);
  w(path.join(SWARM, 'bus', 'outbox', `${taskId}.verdict.json`), slice + '\n');
  try { return JSON.parse(slice); } catch { return null; }
}

// ── Builder：真模型实现 ────────────────────────────────────────
const builderPrompt = [
  'You are builder-core. Working directory is your sandbox root.',
  'TASK:',
  '1) Create file `src/count-fields.mjs` (Node ESM, no dependencies).',
  '   It reads a JSON file path from argv[2] and prints the number of top-level keys.',
  '   If the file is missing -> print an error to stderr and exit with non-zero code.',
  '   If JSON is not an object at top level -> exit non-zero.',
  '2) Run it against `sample.json` and against a missing file to prove both paths.',
  '3) Write the raw command outputs to `evidence/T-421/test-run.txt`.',
  '4) Then output ONLY a JSON object matching the provided schema as your final message.',
  `   verdict=PASS if both acceptance checks behaved correctly, else FAIL.`,
  `   task="${TASK}", agent="builder-core@real", evidence=["evidence/T-421/test-run.txt"],`,
  '   metrics={"exit_code":<your script exit code for sample.json>,"tests":"<passed>/2","duration_s":<seconds you spent>},',
  '   handoff="<one short sentence>"',
].join('\n');

const b = callCodex({ sandbox: 'workspace-write', prompt: builderPrompt, tag: 'builder' });
const bVerdict = extractVerdict(b.stdout, TASK);
const bJudge = judgeJson(TASK, SWARM, SCHEMA);

check('B1 真 builder 产出交付物文件', true, fs.existsSync(path.join(WT, 'src', 'count-fields.mjs')),
  fs.existsSync(path.join(WT, 'src', 'count-fields.mjs')));
check('B2 真 builder 产出证据文件', true, fs.existsSync(path.join(WT, 'evidence', TASK, 'test-run.txt')),
  fs.existsSync(path.join(WT, 'evidence', TASK, 'test-run.txt')));
check('B3 真 builder 的 verdict 可解析', true, bVerdict ? 'JSON ok' : '解析失败', !!bVerdict);
check('B4 真 builder 的 verdict 通过 json-gate', 'PASS/ok', `${bJudge.verdict}/${bJudge.reason}`, bJudge.reason === 'ok');

// 主脑复验：交付物是否真能跑（不看 builder 自述）
let runOut = '', runCode = -1;
try {
  const rr = spawnSync(process.execPath, [path.join(WT, 'src', 'count-fields.mjs'), path.join(WT, 'sample.json')],
    { encoding: 'utf8', input: '' });
  runOut = (rr.stdout ?? '').trim(); runCode = rr.status;
} catch (e) { runOut = `err ${e.message}`; }
check('B5 主脑复验：交付物真能跑且输出 3', 'exit 0 / out 3', `exit ${runCode} / out ${runOut}`,
  runCode === 0 && runOut === '3');

// ── Verifier：独立复核（不给 builder 的结论）────────────────────
const verifierPrompt = [
  'You are verifier-independent. You did NOT write the code and must NOT trust any summary.',
  'Independently verify the deliverable at `src/count-fields.mjs` against these acceptance criteria:',
  '  AC1: running it with `sample.json` prints `3` and exits 0',
  '  AC2: running it with a missing file exits non-zero',
  'Run BOTH checks yourself. Do not read any verdict or report file.',
  'Write your own raw outputs to `evidence/T-421/verify-report.md`.',
  'Then output ONLY a JSON object matching the provided schema as your final message.',
  `  task="${TASK}", agent="verifier-independent@real", evidence=["evidence/T-421/verify-report.md"],`,
  '  verdict=PASS only if BOTH criteria actually passed in your own runs, else FAIL.',
  '  metrics={"exit_code":<AC1 exit code>,"tests":"<passed>/2","duration_s":<seconds>},',
  '  handoff="<one short sentence>"',
].join('\n');

const v = callCodex({ sandbox: 'workspace-write', prompt: verifierPrompt, tag: 'verifier' });
const vVerdict = extractVerdict(v.stdout, TASK);
const vJudge = judgeJson(TASK, SWARM, SCHEMA);

check('V1 真 verifier 的 verdict 可解析', true, vVerdict ? 'JSON ok' : '解析失败', !!vVerdict);
check('V2 真 verifier 的 verdict 通过 json-gate', 'PASS/ok', `${vJudge.verdict}/${vJudge.reason}`, vJudge.reason === 'ok');
check('V3 证据独立（不是同一个文件）', '两份不同证据',
  `${bVerdict?.evidence?.[0] ?? '?'} vs ${vVerdict?.evidence?.[0] ?? '?'}`,
  !!bVerdict && !!vVerdict && bVerdict.evidence?.[0] !== vVerdict.evidence?.[0]);
check('V4 异源标记（agent 字段不同）', '不同 agent',
  `${bVerdict?.agent ?? '?'} vs ${vVerdict?.agent ?? '?'}`,
  !!bVerdict && !!vVerdict && bVerdict.agent !== vVerdict.agent);

const agree = bVerdict && vVerdict && bVerdict.verdict === vVerdict.verdict;
check('X1 记录两者判定是否一致（一致/不一致都接受，只记录）', '已记录',
  `builder=${bVerdict?.verdict ?? '?'} verifier=${vVerdict?.verdict ?? '?'} → ${agree ? '一致' : '不一致'}`, true);

// ── 报告 ───────────────────────────────────────────────────────
const passed = A.filter((x) => x.ok).length;
const L = [];
L.push('# Step 5B · 真模型 builder + verifier（端到端）', '');
L.push(`- 运行时间：${new Date().toISOString()}`);
L.push(`- 断言结果：**${passed}/${A.length} 通过**`);
L.push(`- 真实模型调用：2 次 ｜ 耗时：builder ${b.durS}s / verifier ${v.durS}s`, '');
L.push('## 真模型实际产出');
L.push('');
L.push('```json');
L.push(JSON.stringify(bVerdict, null, 2));
L.push('```');
L.push('```json');
L.push(JSON.stringify(vVerdict, null, 2));
L.push('```');
L.push('');
L.push('## 断言明细');
L.push('');
L.push('| # | 断言 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 诚实标注');
L.push('- 本步的"异源"只是**不同会话/不同 agent 身份**，仍是**同一底层模型**。');
L.push('  真正的异源（不同厂商模型）需要 WorkBuddy 侧的跨模型验收，本步未覆盖。');
L.push('- builder 与 verifier 共用同一 schema 文件（单源契约），该文件已通过 provider 严格模式校验。');
L.push('- 原始 stdout/stderr 落在 `runs/real-5b/*.txt`，可逐条复核。');
w(path.join(LAB, 'step5b-report.md'), L.join('\n') + '\n');
fs.appendFileSync(path.join(SWARM, 'main-log.md'),
  `(step5b) 真 builder+verifier：断言 ${passed}/${A.length}，判定一致=${agree}\n`);

console.log(`STEP5B ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === A.length ? 0 : 1);
