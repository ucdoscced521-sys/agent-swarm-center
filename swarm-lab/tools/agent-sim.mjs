/**
 * agent-sim.mjs — 子智能体模拟器（Step 1 用假 worker，零 credits）
 *
 * 用法: node agent-sim.mjs <swarmDir> <taskId> <builder|verifier> [mode]
 *
 * mode:
 *   normal            正常产出：交付物 + 证据 + 合规 verdict
 *   no-verdict        不写 verdict 文件
 *   malformed         verdict 首行格式不合规
 *   no-evidence       verdict 合规但 EVIDENCE 为空
 *   dangling-evidence verdict 声称的证据文件不存在（假 PASS 的典型形态）
 *   big-body          verdict 合规，但正文塞满垃圾以验证"只读首行"
 *   disagree          verifier 专用：与 builder 判定不一致
 *
 * 关键纪律：模拟器【只写自己的产出】，不碰 state/，不改别人的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , swarmDir = '.swarm', taskId, role = 'builder', mode = 'normal'] = process.argv;
if (!taskId || !role) {
  console.error('usage: node agent-sim.mjs <swarmDir> <taskId> <builder|verifier> [mode]');
  process.exit(2);
}

const ROOT = path.dirname(path.resolve(swarmDir)); // swarmDir 的父目录 = 项目根
const OUTBOX = path.join(swarmDir, 'bus', 'outbox');
const EVID = path.join(swarmDir, 'evidence', taskId);

fs.mkdirSync(OUTBOX, { recursive: true });
fs.mkdirSync(EVID, { recursive: true });

const j = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8');
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };

// ── 故障注入：直接产出坏 verdict，跳过正常流程 ────────────────────────────
function writeFault(modeName, agentId) {
  const vp = path.join(OUTBOX, `${taskId}.verdict.md`);
  if (modeName === 'no-verdict') {
    w(path.join(EVID, 'build.log'), '模拟：本 worker 故意不写 verdict 文件\n');
    return;
  }
  if (modeName === 'malformed') {
    w(vp, [
      '### 判定: PASSED-BY-AI',            // ← 首行不合规
      `TASK: ${taskId}`,
      `AGENT: ${agentId}`,
      `EVIDENCE: evidence/${taskId}/build.log`,
      '',
      '（正文：worker 自认为一切正常）',
    ].join('\n'));
    w(path.join(EVID, 'build.log'), 'ok\n');
    return;
  }
  if (modeName === 'no-evidence') {
    w(vp, [
      '### 判定: PASS',
      `TASK: ${taskId}`,
      `AGENT: ${agentId}`,
      'EVIDENCE:',                          // ← 空
      '',
      '（正文：我检查过了，没问题）',
    ].join('\n'));
    return;
  }
  if (modeName === 'dangling-evidence') {
    w(vp, [
      '### 判定: PASS',
      `TASK: ${taskId}`,
      `AGENT: ${agentId}`,
      `EVIDENCE: evidence/${taskId}/this-file-does-not-exist.txt`,
      '',
      '（正文：典型假 PASS —— 判定合规但证据是编的）',
    ].join('\n'));
    return;
  }
  if (modeName === 'big-body') {
    const junk = 'X'.repeat(200 * 1024); // 200KB 垃圾正文
    w(vp, [
      '### 判定: PASS',
      `TASK: ${taskId}`,
      `AGENT: ${agentId}`,
      `EVIDENCE: evidence/${taskId}/test-run.txt`,
      '',
      junk,
    ].join('\n'));
    w(path.join(EVID, 'test-run.txt'), '（此文件仅为让证据成立）\n');
    return;
  }
  throw new Error(`unknown fault mode: ${modeName}`);
}

// ── 正常流程 ───────────────────────────────────────────────────────────
if (role === 'builder') {
  if (mode !== 'normal') {
    writeFault(mode, `builder-core@sim`);
    console.log(`[agent-sim] builder fault-injected: ${mode}`);
    process.exit(0);
  }

  // 1) 读任务说明书（只读，不猜）
  const spec = fs.readFileSync(path.join(swarmDir, 'bus', 'inbox', `${taskId}.task.md`), 'utf8');
  const need = ['交付物', '验收标准', '工作目录', '权限边界'];
  const missingFields = need.filter((k) => !spec.includes(k));
  if (missingFields.length) {
    w(path.join(OUTBOX, `${taskId}.verdict.md`),
      ['### 判定: BLOCKED', `TASK: ${taskId}`, 'AGENT: builder-core@sim',
       'EVIDENCE: ' + `evidence/${taskId}/blocked.txt`, '',
       '说明书缺项: ' + missingFields.join(',')].join('\n'));
    w(path.join(EVID, 'blocked.txt'), `missing spec fields: ${missingFields.join(',')}\n`);
    process.exit(0);
  }

  // 2) 实现交付物
  const deliverable = path.join(ROOT, 'src', 'count-fields.mjs');
  w(deliverable, `#!/usr/bin/env node
import fs from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('usage: count-fields.mjs <json-file>'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(3); }
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    console.error('top level must be a JSON object'); process.exit(4);
  }
  console.log(Object.keys(data).length);
} catch (e) { console.error('invalid json: ' + e.message); process.exit(5); }
`);

  // 3) 自测：原样跑验收标准，不美化
  const run = (args) => {
    try {
      const out = execFileSync(process.execPath, [deliverable, ...args], { encoding: 'utf8' });
      return { code: 0, out: out.trim(), err: '' };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout ?? '').trim(), err: (e.stderr ?? '').trim() };
    }
  };
  const r1 = run([path.join(ROOT, 'sample.json')]);
  const r2 = run([path.join(ROOT, 'nope.json')]);

  const a1 = r1.code === 0 && r1.out === '3';
  const a2 = r2.code !== 0;

  w(path.join(EVID, 'build.log'),
    [`deliverable: src/count-fields.mjs`,
     `cmd1: node src/count-fields.mjs sample.json -> exit=${r1.code} out=${r1.out}`,
     `cmd2: node src/count-fields.mjs nope.json   -> exit=${r2.code}`].join('\n') + '\n');
  w(path.join(EVID, 'test-run.txt'),
    [`-- acceptance 1 (sample.json) exit=${r1.code}`,
     `stdout: ${r1.out}`,
     `-- acceptance 2 (missing file) exit=${r2.code}`,
     `stderr: ${r2.err}`].join('\n') + '\n');
  j(path.join(EVID, 'summary.json'), {
    deliverable: 'src/count-fields.mjs',
    acceptance: [
      { criterion: 'sample.json -> 3, exit 0', result: a1 ? 'PASS' : 'FAIL', raw: `exit=${r1.code} out=${r1.out}` },
      { criterion: 'missing file -> non-zero exit', result: a2 ? 'PASS' : 'FAIL', raw: `exit=${r2.code}` },
    ],
  });

  // 4) 写 verdict（首行严格格式）
  const ok = a1 && a2;
  w(path.join(OUTBOX, `${taskId}.verdict.md`), [
    `### 判定: ${ok ? 'PASS' : 'FAIL'}`,
    `TASK: ${taskId}`,
    'AGENT: builder-core@sim',
    `EVIDENCE: evidence/${taskId}/test-run.txt, evidence/${taskId}/summary.json`,
    `METRICS: {"acceptance_passed":${[a1, a2].filter(Boolean).length}/2,"deliverable":"src/count-fields.mjs"}`,
    'HANDOFF: 交付物 src/count-fields.mjs 已实现；验收 2/2 通过；请独立复核，勿采信本文件的结论',
    '',
    '（以下为人类可读说明，主脑不应读取）',
    '本次实现使用 JSON.parse + Object.keys().length，未引入依赖。',
  ].join('\n'));
  console.log(`[agent-sim] builder done: verdict=${ok ? 'PASS' : 'FAIL'} (a1=${a1} a2=${a2})`);
  process.exit(0);
}

if (role === 'verifier') {
  if (mode === 'disagree') {
    w(path.join(OUTBOX, `${taskId}.verdict.md`), [
      '### 判定: FAIL',
      `TASK: ${taskId}`,
      'AGENT: verifier-independent@sim',
      `EVIDENCE: evidence/${taskId}/verify-report.md`,
      'METRICS: {"criteria":2,"passed":1}',
      'HANDOFF: 独立复核发现验收项 2 未满足；与 builder 判定不一致，以本判定为准',
      '',
      '（正文）',
    ].join('\n'));
    w(path.join(EVID, 'verify-report.md'),
      '标准2: 缺失文件应非零退出 —— 实测退出码 0，不满足\n');
    process.exit(0);
  }

  // 正常：不看 builder 结论，自己从验收标准重跑
  const deliverable = path.join(ROOT, 'src', 'count-fields.mjs');
  const run = (args) => {
    try {
      const out = execFileSync(process.execPath, [deliverable, ...args], { encoding: 'utf8' });
      return { code: 0, out: out.trim(), err: '' };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout ?? '').trim(), err: (e.stderr ?? '').trim() };
    }
  };
  const r1 = run([path.join(ROOT, 'sample.json')]);
  const r2 = run([path.join(ROOT, 'nope.json')]);
  const a1 = r1.code === 0 && r1.out === '3';
  const a2 = r2.code !== 0;

  w(path.join(EVID, 'verify-report.md'), [
    '独立复核（不读 builder 说明，仅从验收标准重演）',
    `标准1 我跑的是: node src/count-fields.mjs sample.json -> exit=${r1.code} out=${r1.out} -> ${a1 ? 'PASS' : 'FAIL'}`,
    `标准2 我跑的是: node src/count-fields.mjs nope.json  -> exit=${r2.code} -> ${a2 ? 'PASS' : 'FAIL'}`,
    `与 builder 差异: 无（或说明）`,
  ].join('\n') + '\n');

  const ok = a1 && a2;
  w(path.join(OUTBOX, `${taskId}.verdict.md`), [
    `### 判定: ${ok ? 'PASS' : 'FAIL'}`,
    `TASK: ${taskId}`,
    'AGENT: verifier-independent@sim',
    `EVIDENCE: evidence/${taskId}/verify-report.md`,
    `METRICS: {"criteria":2,"passed":${[a1, a2].filter(Boolean).length}}`,
    'HANDOFF: 异源独立复核完成；与 builder 判定一致；可进入下一环',
    '',
  ].join('\n'));
  console.log(`[agent-sim] verifier done: verdict=${ok ? 'PASS' : 'FAIL'}`);
  process.exit(0);
}

console.error(`unknown role: ${role}`);
process.exit(2);
