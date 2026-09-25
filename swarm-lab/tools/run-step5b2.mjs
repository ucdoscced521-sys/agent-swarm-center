/**
 * run-step5b2.mjs — Step 5B（改道版）：真模型当 builder + verifier，全程 read-only
 *
 * 为什么要改道：
 *   -s workspace-write 会让 codex 在 Windows 上安装自己的 OS 级沙箱，
 *   触发宿主沙箱拦截（两次被拒，连 node.exe 执行都被拦）。
 *   → 改成：模型在 -s read-only 下【把产物内容当数据返回】，编排层负责落盘与执行验收。
 *   这绕开了 codex 的写沙箱安装，同时仍然真实检验：
 *     ① 真模型能否产出【可运行的正确代码】
 *     ② 真 verifier 能否在【只看产物 + 原始验收输出、不看 builder 结论】的前提下独立判定
 *
 * 运行: node tools/run-step5b2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeJson } from './json-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const SWARM = path.join(LAB, '.swarm');
const SCHEMA = path.join(LAB, 'schemas', 'builder-artifacts.schema.json');
const CODEX = process.env.CODEX_CLI ?? 'E:\\Codex\\bin\\codex.exe';
const TASK = 'T-421';
const RUN = path.join(LAB, 'runs', 'real-5b2');
const WT = path.join(RUN, 'worktree');

const A = [];
const check = (n, e, a, ok) => A.push({ name: n, expected: e, actual: a, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const stamp = () => new Date().toISOString();

fs.rmSync(RUN, { recursive: true, force: true });
fs.mkdirSync(WT, { recursive: true });
w(path.join(WT, 'sample.json'), JSON.stringify({ alpha: 1, beta: 2, gamma: 3 }, null, 2) + '\n');

function callCodex(prompt, tag) {
  const t0 = Date.now();
  const r = spawnSync(CODEX, [
    'exec', '-C', WT, '-s', 'read-only', '--skip-git-repo-check',
    '--output-schema', SCHEMA, prompt,
  ], { encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024, input: '' });
  w(path.join(RUN, `${tag}.stdout.txt`), r.stdout ?? '');
  w(path.join(RUN, `${tag}.stderr.txt`), r.stderr ?? '');
  const out = (r.stdout ?? '').trim();
  let obj = null;
  const s = out.indexOf('{'), e = out.lastIndexOf('}');
  if (s >= 0 && e > s) { try { obj = JSON.parse(out.slice(s, e + 1)); } catch { /* ignore */ } }
  return { status: r.status, durS: Number(((Date.now() - t0) / 1000).toFixed(1)), obj, out, stderr: r.stderr ?? '' };
}

// ── ① Builder（read-only，产物作为数据返回）────────────────────
const builderPrompt = [
  'You are builder-core. You have READ-ONLY sandbox: you CANNOT write files.',
  'Instead, return the deliverables as DATA in the `files` array of your JSON answer.',
  '',
  'TASK: write a Node ESM module that reads a JSON file path from argv[2]',
  'and prints the number of top-level keys.',
  '  - missing file  -> error to stderr + non-zero exit',
  '  - non-object top level -> non-zero exit',
  '',
  'Put it at path `src/count-fields.mjs` in the files array (content = full source).',
  'Also put a short self-check note at `evidence/T-421/selfcheck.md`.',
  `Then fill the verdict fields: task="${TASK}", agent="builder-core@real",`,
  '  evidence=["evidence/T-421/selfcheck.md"],',
  '  metrics={"exit_code":0,"tests":"0/2","duration_s":<seconds you spent>},',
  '  verdict="PASS" if you believe the code satisfies both criteria else "FAIL",',
  '  handoff="<one short sentence>"',
].join('\n');

const b = callCodex(builderPrompt, 'builder');
const bObj = b.obj ?? { files: [], evidence: [], verdict: 'FAIL', task: TASK, agent: 'builder-core@real' };

// 编排层落盘（不是"主脑干活"，是 I/O）
let materialized = [];
for (const f of bObj.files ?? []) {
  if (typeof f?.path !== 'string' || typeof f?.content !== 'string') continue;
  const abs = path.join(WT, f.path);
  if (!abs.startsWith(WT)) continue; // 防目录穿越
  w(abs, f.content);
  materialized.push(f.path);
}

// 编排层执行验收（实验台行为），产出真实证据
const deliverable = path.join(WT, 'src', 'count-fields.mjs');
const runOne = (args) => {
  try {
    const r = spawnSync(process.execPath, [deliverable, ...args], { encoding: 'utf8', input: '', timeout: 30000 });
    return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  } catch (e) { return { code: -1, out: '', err: `spawn error: ${e.message}` }; }
};
const r1 = fs.existsSync(deliverable) ? runOne([path.join(WT, 'sample.json')]) : { code: -1, out: '', err: 'deliverable missing' };
const r2 = fs.existsSync(deliverable) ? runOne([path.join(WT, 'nope.json')]) : { code: -1, out: '', err: 'deliverable missing' };
const ac1 = r1.code === 0 && r1.out === '3';
const ac2 = r2.code !== 0;
const harnessReport = [
  `harness ran: node src/count-fields.mjs sample.json -> exit=${r1.code} stdout=${r1.out}`,
  `harness ran: node src/count-fields.mjs nope.json   -> exit=${r2.code} stderr=${r2.err}`,
  `AC1 (prints 3, exit 0): ${ac1 ? 'PASS' : 'FAIL'}`,
  `AC2 (missing file non-zero): ${ac2 ? 'PASS' : 'FAIL'}`,
].join('\n');
w(path.join(SWARM, `evidence/${TASK}/test-run.txt`), harnessReport + '\n');
w(path.join(SWARM, `bus/outbox/${TASK}.verdict.json`), JSON.stringify({
  verdict: bObj.verdict, task: bObj.task, agent: bObj.agent,
  evidence: bObj.evidence,
  metrics: { exit_code: r1.code, tests: `${[ac1, ac2].filter(Boolean).length}/2`, duration_s: b.durS },
  independent_level: 'N/A',
  handoff: bObj.handoff,
}, null, 2) + '\n');
const bJudge = judgeJson(TASK, SWARM, SCHEMA.replace('builder-artifacts', 'verdict'));

check('B1 真 builder 返回了产物文件', '>=1', `${materialized.length} 个（${materialized.join(',') || '无'}）`, materialized.length >= 1);
check('B2 产物路径正确 src/count-fields.mjs', true, materialized.includes('src/count-fields.mjs'), materialized.includes('src/count-fields.mjs'));
check('B3 builder 返回的 verdict 结构合规', true, b.obj ? 'JSON ok' : `解析失败 (${b.status})`, !!b.obj);
check('B4 真 builder 产出【可运行的代码】(AC1)', 'PASS', `exit ${r1.code} out "${r1.out}"`, ac1);
check('B5 真 builder 处理了异常路径 (AC2)', 'PASS', `exit ${r2.code}`, ac2);
check('B6 实测结果与 builder 自述一致（不盲信自述）', '一致',
  `自述 verdict=${bObj.verdict} / 实测 ${ac1 && ac2 ? 'PASS' : 'FAIL'}`,
  (bObj.verdict === 'PASS') === (ac1 && ac2));

// ── ② Verifier（read-only，只看产物 + 原始验收输出，不看 builder 结论）──
const codeText = fs.existsSync(deliverable) ? fs.readFileSync(deliverable, 'utf8') : '(missing)';
const verifierPrompt = [
  'You are verifier-independent. You did NOT write this code. Do not trust any summary.',
  'You have READ-ONLY sandbox: return your report as DATA in the `files` array.',
  '',
  'Artifact `src/count-fields.mjs` source:',
  '---8<---',
  codeText,
  '---8<---',
  '',
  'Raw output produced by the harness when running the artifact:',
  '---8<---',
  harnessReport,
  '---8<---',
  '',
  'Acceptance criteria:',
  '  AC1: sample.json -> prints 3, exit 0',
  '  AC2: missing file -> non-zero exit',
  'Judge INDEPENDENTLY: does the evidence actually satisfy each criterion?',
  'Also inspect the source for a case the harness did NOT test (e.g. non-object JSON top level).',
  'Put your written findings at `evidence/T-421/verify-report.md` in the files array.',
  `Then: task="${TASK}", agent="verifier-independent@real",`,
  '  evidence=["evidence/T-421/verify-report.md"],',
  '  metrics={"exit_code":<AC1 exit code>,"tests":"<passed>/2","duration_s":<seconds>},',
  '  verdict="PASS" only if BOTH criteria are genuinely satisfied in your judgment, else "FAIL",',
  '  handoff="<one short sentence>"',
].join('\n');

const v = callCodex(verifierPrompt, 'verifier');
const vObj = v.obj ?? { files: [], evidence: [], verdict: 'FAIL', task: TASK, agent: 'verifier-independent@real' };
for (const f of vObj.files ?? []) {
  if (typeof f?.path !== 'string' || typeof f?.content !== 'string') continue;
  const abs = path.join(WT, f.path);
  if (!abs.startsWith(WT)) continue;
  w(abs, f.content);
}
w(path.join(SWARM, `bus/outbox/${TASK}.verdict.verifier.json`), JSON.stringify(vObj, null, 2) + '\n');
const vJudge = judgeJson(TASK, SWARM, SCHEMA.replace('builder-artifacts', 'verdict'));

check('V1 真 verifier 返回结构合规', true, v.obj ? 'JSON ok' : `解析失败 (${v.status})`, !!v.obj);
check('V2 verifier 证据与 builder 证据不同', '两份不同',
  `${(bObj.evidence ?? [])[0] ?? '?'} vs ${(vObj.evidence ?? [])[0] ?? '?'}`,
  (bObj.evidence ?? [])[0] !== (vObj.evidence ?? [])[0]);
check('V3 异源标记（agent 不同）', '不同', `${bObj.agent} vs ${vObj.agent}`, bObj.agent !== vObj.agent);
check('V4 verifier 写出了复核报告', '>=1 个文件', `${(vObj.files ?? []).length} 个`, (vObj.files ?? []).length >= 1);
const agree = bObj.verdict === vObj.verdict;
check('X1 记录两者判定是否一致（一致/不一致都接受）', '已记录',
  `builder=${bObj.verdict} verifier=${vObj.verdict} → ${agree ? '一致' : '不一致'}`, true);

// ── 报告 ───────────────────────────────────────────────────────
const passed = A.filter((x) => x.ok).length;
const L = [];
L.push('# Step 5B（改道版）· 真模型 builder + verifier，全程 read-only', '');
L.push(`- 运行时间：${stamp()}`);
L.push(`- 断言结果：**${passed}/${A.length} 通过**`);
L.push(`- 真实模型调用：2 次 ｜ 耗时：builder ${b.durS}s / verifier ${v.durS}s`);
L.push(`- 沙箱：\`-s read-only\`（避开 codex 写沙箱安装 → 不再触发宿主拦截）`, '');
L.push('## 为什么改道');
L.push('');
L.push('`-s workspace-write` 会让 codex 在 Windows 上安装自己的 OS 级沙箱（触碰 `AppData\\Local\\Microsoft\\Windows\\Caches`、`System32\\CatRoot2`），**被宿主沙箱两次拦截**（连 `node.exe` 执行都被拒）。');
L.push('改为：模型在 read-only 下**把产物内容当数据返回**，编排层负责落盘与执行验收。');
L.push('**代价要说清**：验收命令由实验台执行，不是模型自己跑的；模型只负责"写出正确代码"。');
L.push('');
L.push('## 真 builder 产出');
L.push('');
L.push('```javascript');
L.push(codeText);
L.push('```');
L.push('');
L.push('## 实验台实测（不采信模型自述）');
L.push('');
L.push('```');
L.push(harnessReport);
L.push('```');
L.push('');
L.push('## 真 verifier 判定');
L.push('');
L.push('```json');
L.push(JSON.stringify({ verdict: vObj.verdict, agent: vObj.agent, evidence: vObj.evidence, metrics: vObj.metrics, handoff: vObj.handoff }, null, 2));
L.push('```');
L.push('');
L.push('## 断言明细');
L.push('');
L.push('| # | 断言 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 诚实标注');
L.push('- **"异源"只是不同会话、不同 agent 身份、同一底层模型**；真异源需不同厂商模型，本步未覆盖。');
L.push('- verifier 的输入含实验台提供的原始验收输出（它自己没有执行权限），因此它验的是"证据是否支持结论"，不是"亲自重跑"。');
L.push('- 原始 stdout/stderr 落在 `runs/real-5b2/*.txt`。');
w(path.join(LAB, 'step5b2-report.md'), L.join('\n') + '\n');
fs.appendFileSync(path.join(SWARM, 'main-log.md'),
  `(step5b2) 真 builder+verifier(read-only)：断言 ${passed}/${A.length}，实测AC=${ac1}/${ac2}，判定一致=${agree}\n`);

console.log(`STEP5B2 ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === A.length ? 0 : 1);
