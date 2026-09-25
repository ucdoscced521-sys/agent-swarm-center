/**
 * run-step1.mjs — Step 1「最小闭环」编排与验收
 *
 * 验证链路：派单 → 子智能体产出 → 主脑判定 → 异源复核 → 故障注入拦截
 * 全程零 credits（用 agent-sim 冒充子智能体）
 *
 * 运行: node tools/run-step1.mjs
 * 产出: swarm-lab/step1-report.md（人读）+ .swarm/state/*（机器读）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judge } from './gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);                       // swarm-lab/
const SWARM = path.join(LAB, '.swarm');
const TASK = 'T-001';
const TASK_NEG = 'T-901';

const A = []; // assertions
const check = (name, expected, actual, ok) => A.push({ name, expected, actual, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const j = (p, o) => w(p, JSON.stringify(o, null, 2) + '\n');
const now = () => new Date().toISOString();
const log = [];

// ─────────────────────────────────────────────────────────────
// Phase 0 · 地基：目录契约 + 环境契约（无 LLM 参与）
// ─────────────────────────────────────────────────────────────
function phase0() {
  for (const d of ['state', 'bus/inbox', 'bus/outbox', 'bus/claims', 'evidence', 'experience']) {
    fs.mkdirSync(path.join(SWARM, d), { recursive: true });
  }
  w(path.join(SWARM, 'contract.md'), [
    '# 环境契约（初始化后不得变更）',
    '- WORKSPACE: swarm-lab',
    '- BATCH_SIZE: 1',
    '- CONCURRENCY: 3 (上限 5)',
    '- BUDGET: 单任务 20min / 单阶段 3 轮迭代',
    '- RANK_CACHE_TTL: 24h',
    `- initialized_at: ${now()}`,
  ].join('\n') + '\n');
  w(path.join(SWARM, 'main-log.md'), `(${stamp()}) 项目启动，任务：Step 1 最小闭环验证\n`);
  w(path.join(SWARM, 'decisions.md'), '# 决策记录\n');
  w(path.join(SWARM, 'experience/patterns.md'), '# 经验库\n');
  w(path.join(LAB, 'sample.json'), JSON.stringify({ alpha: 1, beta: 2, gamma: 3 }, null, 2) + '\n');
  log.push('Phase0 地基完成：目录 + contract + sample.json');
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};

// ─────────────────────────────────────────────────────────────
// Phase 1 · 派单：写自包含任务说明书
// ─────────────────────────────────────────────────────────────
function phase1() {
  w(path.join(SWARM, 'bus', 'inbox', `${TASK}.task.md`), [
    `# TASK ${TASK}`,
    '- 目标（一句话，可验证）：实现一个 CLI，读取 JSON 文件并打印其顶层字段数量',
    '- 交付物（精确路径）：swarm-lab/src/count-fields.mjs',
    '- 输入（路径，不要塞正文）：swarm-lab/sample.json',
    '- 验收标准（可自动判定，≥2 条）：',
    '  1. `node src/count-fields.mjs sample.json` 打印 `3` 且退出码 0',
    '  2. `node src/count-fields.mjs nope.json` 退出码非 0',
    '- 证据要求（必须落到 evidence/T-001/）：test-run.txt, summary.json',
    '- 权限边界（可写目录 / 禁止触碰）：可写 swarm-lab/src/**、.swarm/evidence/T-001/**、.swarm/bus/outbox/**；禁止改 .swarm/state/**',
    '- 工作目录（绝对路径）：swarm-lab',
    '- 预算（时限 / 最多命令数）：5min / 30',
    '- 失败时怎么办（重试上限 / 上报条件）：自修 2 次，仍失败报 FAIL',
    '- 回流格式：见 skills/agent-swarm/references/protocol.md §2（首行必须为 ### 判定: PASS|FAIL|BLOCKED）',
  ].join('\n') + '\n');
  log.push(`Phase1 派单完成：inbox/${TASK}.task.md`);
}

// ─────────────────────────────────────────────────────────────
// Phase 2-4 · 执行 → 判定 → 异源复核
// ─────────────────────────────────────────────────────────────
function runSim(taskId, role, mode = 'normal') {
  execFileSync(process.execPath, [path.join(HERE, 'agent-sim.mjs'), SWARM, taskId, role, mode], {
    stdio: 'pipe', encoding: 'utf8',
  });
}

function phase2to4() {
  // builder
  runSim(TASK, 'builder');
  const b = judge(TASK, SWARM);
  check('C1 builder 判定为 PASS', 'PASS', b.verdict, b.verdict === 'PASS');
  check('C2 判定首行严格合规', 'PASS', b.firstLine, b.firstLine === '### 判定: PASS');
  check('C3 证据文件真实存在', '2 个', `${b.evidence.length} 个（missing=${b.missing.length}）`,
    b.evidence.length === 2 && b.missing.length === 0);
  check('C4 交付物落盘', true, fs.existsSync(path.join(LAB, 'src', 'count-fields.mjs')),
    fs.existsSync(path.join(LAB, 'src', 'count-fields.mjs')));
  log.push(`Phase2 builder 产出：src/count-fields.mjs + evidence/${TASK}/（test-run.txt, summary.json）`);
  log.push(`Phase3 主脑判定：${b.verdict}（reason=${b.reason}，首行="${b.firstLine}"，未读正文）`);

  // 清空 outbox，模拟 verifier 覆盖判定（异源独立）
  fs.rmSync(path.join(SWARM, 'bus', 'outbox', `${TASK}.verdict.md`), { force: true });
  runSim(TASK, 'verifier');
  const v = judge(TASK, SWARM);
  check('C5 verifier 独立判定为 PASS', 'PASS', v.verdict, v.verdict === 'PASS');
  check('C6 verifier 证据独立存在', true,
    fs.existsSync(path.join(SWARM, 'evidence', TASK, 'verify-report.md')),
    fs.existsSync(path.join(SWARM, 'evidence', TASK, 'verify-report.md')));
  log.push(`Phase4 异源复核：verifier-independent 重演验收标准 → ${v.verdict}（未采信 builder 结论）`);
}

// ─────────────────────────────────────────────────────────────
// Phase 5 · 故障注入：每一条都必须被拦住
// ─────────────────────────────────────────────────────────────
const FAULTS = [
  ['no-verdict', 'no_verdict', '不写 verdict'],
  ['malformed', 'malformed_verdict', '首行格式不合规（PASSED-BY-AI）'],
  ['no-evidence', 'evidence_absent', '判定合规但证据为空'],
  ['dangling-evidence', 'evidence_dangling', '证据路径指向不存在的文件（假 PASS）'],
];

function phase5() {
  const blocked = [];
  for (const [mode, expectReason, desc] of FAULTS) {
    fs.rmSync(path.join(SWARM, 'bus', 'outbox', `${TASK_NEG}.verdict.md`), { force: true });
    runSim(TASK_NEG, 'builder', mode);
    const r = judge(TASK_NEG, SWARM);
    check(`C7[${mode}] 被拦为 FAIL`, 'FAIL', r.verdict, r.verdict === 'FAIL');
    check(`C8[${mode}] 归因正确 (${desc})`, expectReason, r.reason, r.reason === expectReason);
    blocked.push(`${mode}→${r.reason}`);
  }
  log.push(`Phase5 故障注入 4 类，全部被拦：${blocked.join('、')}`);
}

// ─────────────────────────────────────────────────────────────
// Phase 6 · 只读首行的客观证明
// ─────────────────────────────────────────────────────────────
function phase6() {
  fs.rmSync(path.join(SWARM, 'bus', 'outbox', `${TASK_NEG}.verdict.md`), { force: true });
  runSim(TASK_NEG, 'builder', 'big-body');
  const r = judge(TASK_NEG, SWARM);
  const ratio = r.fileSize / Math.max(r.bytesRead, 1);
  check('C9 200KB 正文的 verdict 仍判 PASS（合规即采信）', 'PASS', r.verdict, r.verdict === 'PASS');
  check('C10 主脑只读了文件头部（head-only 证明）', 'bytesRead < fileSize 且 ≥50x 差距',
    `bytesRead=${r.bytesRead}B / fileSize=${r.fileSize}B（相差 ${ratio.toFixed(0)}x）`,
    r.bytesRead < r.fileSize && ratio >= 50);
  log.push(`Phase6 上下文卫生证明：verdict 正文 ${r.fileSize}B，主脑仅读 ${r.bytesRead}B（${ratio.toFixed(0)}x 差距），仍正确判定 ${r.verdict}`);
}

// ─────────────────────────────────────────────────────────────
// 收口：状态封板 + 报告
// ─────────────────────────────────────────────────────────────
function seal() {
  const passed = A.filter((x) => x.ok).length;
  const total = A.length;

  j(path.join(SWARM, 'state', 'tasks.json'), {
    phases: { P0: 'done', P1: 'done', P2: 'done', P3: 'done', P4: 'done' },
    tasks: [
      { id: TASK, goal: 'count-fields CLI', status: passed === total ? 'PASS' : 'FAIL', evidence: `evidence/${TASK}/` },
      { id: TASK_NEG, goal: '故障注入探针', status: 'PASS', evidence: `evidence/${TASK_NEG}/` },
    ],
  });
  j(path.join(SWARM, 'state', 'brief.json'), {
    phase: 'P1-最小闭环', round: 1,
    done: [TASK], active: [], blocked: [],
    next: ['Step2 真并行（M1-M6 + 红队反测）'],
    assertions: `${passed}/${total}`,
  });

  const lines = [];
  lines.push('# Step 1 · 最小闭环验证报告', '');
  lines.push(`- 运行时间：${now()}`);
  lines.push(`- 断言结果：**${passed}/${total} 通过**`);
  lines.push(`- 成本：0 credits（全程用 agent-sim 冒充子智能体）`, '');
  lines.push('## 断言明细', '');
  lines.push('| # | 断言 | 期望 | 实际 | 结果 |');
  lines.push('|---|------|------|------|------|');
  A.forEach((x, i) => {
    lines.push(`| ${i + 1} | ${x.name} | ${String(x.expected).replace(/\|/g, '/')} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`);
  });
  lines.push('', '## 链路时序', '');
  log.forEach((l, i) => lines.push(`${i + 1}. ${l}`));
  lines.push('', '## 结论', '');
  lines.push(passed === total
    ? '✅ **最小闭环成立**：派单 → 子智能体产出 → 主脑只读首行判定 → 异源复核 → 故障注入全被拦住。'
    : '❌ **存在不通过项**，先修对应环节再往下走。');

  w(path.join(LAB, 'step1-report.md'), lines.join('\n') + '\n');
  fs.appendFileSync(path.join(SWARM, 'main-log.md'),
    `(${stamp()}) Step1 最小闭环收口：断言 ${passed}/${total}\n`);

  console.log(lines.join('\n'));
  process.exit(passed === total ? 0 : 1);
}

phase0(); phase1(); phase2to4(); phase5(); phase6(); seal();
