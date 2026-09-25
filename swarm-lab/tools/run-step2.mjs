/**
 * run-step2.mjs — Step 2「真并行」验证编排
 *
 * Phase A 真并行：3 个 worker 同时 spawn（各自独立工作目录）→ 指标应全过
 * Phase B 串行假实现：同样 3 个任务，一个跑完再跑下一个 → 指标必须挂（红队反测）
 * Phase C 无隔离对照：2 个 worker 写同一目录同一路径 → M5 必须检出互覆
 *
 * 核心主张：同一份 metrics 代码，必须对 A 判 PASS、对 B 判 FAIL。
 * 运行: node tools/run-step2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure, renderTable } from './metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const SWARM = path.join(LAB, '.swarm');
const RUNS = path.join(LAB, 'runs');
const WORKER = path.join(HERE, 'parallel-worker.mjs');
const SHARED_REL = path.join('shared', 'notes.md');
const WORK_MS = 2500;

const A = [];
const check = (name, expected, actual, ok) => A.push({ name, expected, actual, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
const j = (p, o) => w(p, JSON.stringify(o, null, 2) + '\n');
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// ── 峰值并发采样器：100ms 轮询存活子进程 ──────────────────────
function makeSampler() {
  const pids = new Set();
  let peak = 0;
  const timer = setInterval(() => {
    let alive = 0;
    for (const pid of pids) {
      try { process.kill(pid, 0); alive++; } catch { pids.delete(pid); }
    }
    if (alive > peak) peak = alive;
  }, 100);
  return {
    track: (pid) => pids.add(pid),
    stop: () => { clearInterval(timer); return peak; },
  };
}

// ── 单个 worker：记录真实起止时间 + pid ───────────────────────
function runWorker({ runDir, taskId, token, sessionId, cwd, sampler, workMs = WORK_MS, extraPrompt = '' }) {
  const promptFile = path.join(runDir, 'prompts', `${taskId}.prompt.md`);
  w(promptFile, [
    `# TASK ${taskId}`,
    `- 交付物（在本工作目录内）：${SHARED_REL}`,
    `- 你的专属 token：${token}`,
    `- 你的会话：${sessionId}`,
    '- 验收：产物内容须含 owner=' + taskId,
    '- 回流：evidence/ 下落 verdict',
    extraPrompt,
    '',
  ].join('\n'));

  const startMs = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath,
      [WORKER, token, String(workMs), SHARED_REL, sessionId, taskId],
      { cwd, stdio: 'ignore' });
    sampler?.track(child.pid);
    child.on('exit', (code) => {
      const endMs = Date.now();
      resolve({
        id: taskId, pid: child.pid, sessionId, token,
        startMs, endMs, durMs: endMs - startMs,
        exitCode: code,
        promptFile,
        worktree: cwd,
        artifact: path.join(cwd, SHARED_REL),
      });
    });
  });
}

// ── Phase A：真并行（可重跑多轮做稳定性验证）────────────────────
async function phaseA(suffix = '') {
  const runDir = path.join(RUNS, `A${suffix}-parallel`);
  fs.rmSync(runDir, { recursive: true, force: true });
  const sampler = makeSampler();
  const ids = ['T-201', 'T-202', 'T-203'].map((x) => (suffix ? `${x}R${suffix}` : x));
  const t0 = Date.now();
  const tasks = await Promise.all(ids.map((id, i) => runWorker({
    runDir,
    taskId: id,
    token: `TOKEN-${id}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: `sess-${id}-${process.pid}-${i}`,
    cwd: (() => { const d = path.join(runDir, 'worktrees', id); fs.mkdirSync(d, { recursive: true }); return d; })(),
    sampler,
  })));
  const wallMs = Date.now() - t0;
  const peakConcurrent = sampler.stop();
  const rec = { runId: `A${suffix}-parallel`, mode: 'parallel', isolation: 'dir-copy', wallMs, peakConcurrent, tasks };
  return { runDir, rec };
}

// ── Phase B：串行假实现（红队反测）─────────────────────────────
async function phaseB() {
  const runDir = path.join(RUNS, 'B-serial-fake');
  fs.rmSync(runDir, { recursive: true, force: true });
  const sampler = makeSampler();
  const ids = ['T-211', 'T-212', 'T-213'];
  const t0 = Date.now();
  const tasks = [];
  for (const id of ids) {
    const d = path.join(runDir, 'worktrees', id);
    fs.mkdirSync(d, { recursive: true });
    tasks.push(await runWorker({
      runDir, taskId: id,
      token: `TOKEN-${id}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: `sess-${id}-${process.pid}`,
      cwd: d, sampler,
    }));
  }
  const wallMs = Date.now() - t0;
  const peakConcurrent = sampler.stop();
  const rec = { runId: 'B-serial-fake', mode: 'serial', isolation: 'dir-copy', wallMs, peakConcurrent, tasks };
  return { runDir, rec };
}

// ── Phase C：无隔离对照 ───────────────────────────────────────
async function phaseC() {
  const runDir = path.join(RUNS, 'C-no-isolation');
  fs.rmSync(runDir, { recursive: true, force: true });
  const shared = path.join(runDir, 'same-dir');
  fs.mkdirSync(shared, { recursive: true });
  const ids = ['T-221', 'T-222'];
  const tasks = [];
  for (const id of ids) {
    tasks.push(await runWorker({
      runDir, taskId: id,
      token: `TOKEN-${id}`,
      sessionId: `sess-${id}-noiso`,
      cwd: shared, // ← 故意共用同一目录
    }));
  }
  const rec = {
    runId: 'C-no-isolation', mode: 'serial', isolation: 'none',
    wallMs: tasks.reduce((s, t) => s + t.durMs, 0), peakConcurrent: 1, tasks,
  };
  return { runDir, rec };
}

// ── Phase D：上下文污染对照（M4 的负向对照）───────────────────
// 每个指标都必须有负向对照，否则无法证明它有灵敏度。M1-M3 由 B 承担，M5 由 C 承担，M4 由 D 承担。
async function phaseD() {
  const runDir = path.join(RUNS, 'D-context-leak');
  fs.rmSync(runDir, { recursive: true, force: true });
  const ids = ['T-231', 'T-232'];
  const tasks = [];
  for (const id of ids) {
    const d = path.join(runDir, 'worktrees', id);
    fs.mkdirSync(d, { recursive: true });
    // 故意污染：让 T-231 的 prompt 里出现 T-232 的任务号
    const extraPrompt = id === 'T-231' ? `- 参考（污染注入）：T-232 的产出可直接复用` : '';
    tasks.push(await runWorker({
      runDir, taskId: id, token: `TOKEN-${id}`, sessionId: `sess-${id}-leak`,
      cwd: d, workMs: 200, extraPrompt,
    }));
  }
  const rec = {
    runId: 'D-context-leak', mode: 'parallel', isolation: 'dir-copy',
    wallMs: Math.max(...tasks.map((t) => t.durMs)), peakConcurrent: 2, tasks,
  };
  return { runDir, rec };
}

// ── Phase E：会话复用对照（M6 的负向对照）─────────────────────
// 无法让两个真实进程共享 pid，因此直接构造记录来测【指标本身】是否有灵敏度。
// 对照记录必须自身合法：除目标指标外，其余各项都要满足阈值，
// 否则失败原因不唯一，无法证明是该指标检出的（踩过：2 任务的记录 M1/M3 天然不达标，一次挂 3 项）。
function phaseE() {
  const runDir = path.join(RUNS, 'E-session-dup');
  fs.rmSync(runDir, { recursive: true, force: true });
  const t0 = Date.now();
  const tasks = ['T-241', 'T-242', 'T-243'].map((id) => {
    const wt = path.join(runDir, 'worktrees', id);
    fs.mkdirSync(path.join(wt, 'shared'), { recursive: true });
    w(path.join(wt, 'shared', 'notes.md'), `owner=${id}\ntoken=TOKEN-${id}\n`);
    const pf = path.join(runDir, 'prompts', `${id}.prompt.md`);
    w(pf, `# TASK ${id}\n- 交付物：${SHARED_REL}\n`);
    return {
      // ↓ 只有这两项被故意污染，其余全部合法
      id, pid: 4242, sessionId: 'shared-session', token: `TOKEN-${id}`,
      startMs: t0, endMs: t0 + 1500, durMs: 1500, exitCode: 0,
      promptFile: pf, worktree: wt, artifact: path.join(wt, SHARED_REL),
    };
  });
  const rec = {
    runId: 'E-session-dup', mode: 'parallel', isolation: 'dir-copy',
    wallMs: 1000,            // Σdur 4500 / 1000 → M1 = 4.5 ✅
    peakConcurrent: 3,       // M3 = 3 ✅
    tasks,                   // 区间全重叠 → M2 ✅；3 个独立 worktree → M5 ✅
  };
  return { runDir, rec };
}

// ── 事件流落盘（人可审计）─────────────────────────────────────
function emitEvents(rec) {
  const lines = [];
  for (const t of rec.tasks) {
    lines.push(JSON.stringify({ ts: iso(t.startMs - Date.now()), e: 'task.start', task: t.id, agent: 'builder-core', host: 'local', pid: t.pid, wt: t.worktree }));
    lines.push(JSON.stringify({ ts: iso(t.endMs - Date.now()), e: 'task.end', task: t.id, agent: 'builder-core', host: 'local', pid: t.pid, verdict: t.exitCode === 0 ? 'PASS' : 'FAIL', dur_s: Number((t.durMs / 1000).toFixed(2)) }));
  }
  fs.appendFileSync(path.join(SWARM, 'state', 'events.jsonl'), lines.join('\n') + '\n', 'utf8');
}

// ── 主流程 ───────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(RUNS, { recursive: true });
  fs.mkdirSync(path.join(SWARM, 'state'), { recursive: true });

  // Phase A 重跑 3 轮：并发度指标必须稳定，否则不能当 Gate 用
  const reps = [];
  for (const k of ['1', '2', '3']) {
    const r = await phaseA(k);
    reps.push({ rec: r.rec, m: measure(r.rec) });
  }
  const mA = reps[0].m;
  const m1s = reps.map((r) => r.m.metrics.M1.value);
  const m1min = Math.min(...m1s);
  const m1avg = Number((m1s.reduce((a, b) => a + b, 0) / m1s.length).toFixed(2));

  const Bres = await phaseB(); const mB = measure(Bres.rec);
  const Cres = await phaseC(); const mC = measure(Cres.rec);
  const Dres = await phaseD(); const mD = measure(Dres.rec);
  const Eres = phaseE(); const mE = measure(Eres.rec);

  reps.forEach((r) => emitEvents(r.rec));
  emitEvents(Bres.rec);
  j(path.join(RUNS, 'records.json'), { A: reps.map((r) => r.rec), B: Bres.rec, C: Cres.rec, D: Dres.rec });

  // ── 断言：Phase A 必须全过 ──
  check('A1 M1 并发度达标', '>= 2.5', mA.metrics.M1.value, mA.metrics.M1.pass);
  check('A2 M2 时间线有重叠', '>= 1 对', mA.metrics.M2.value, mA.metrics.M2.pass);
  check('A3 M3 峰值并发 >= 3', '>= 3', mA.metrics.M3.value, mA.metrics.M3.pass);
  check('A4 M4 上下文 100% 隔离', '100%', mA.metrics.M4.value, mA.metrics.M4.pass);
  check('A5 M5 产物零互覆', '零互覆', mA.metrics.M5.value, mA.metrics.M5.pass);
  check('A6 M6 会话/进程唯一', '100% 唯一', mA.metrics.M6.value, mA.metrics.M6.pass);
  check('A7 【Gate】真并行整体判定', 'PASS', mA.overall ? 'PASS' : 'FAIL', mA.overall);
  check('A8 稳定性：3 轮重跑 M1 最小值仍达标', '>= 2.5', `${m1s.join(' / ')}（min=${m1min}）`, m1min >= 2.5);
  check('A9 稳定性：3 轮重跑 Gate 全 PASS', '3/3 PASS',
    `${reps.filter((r) => r.m.overall).length}/3`, reps.every((r) => r.m.overall));

  // ── 断言：Phase B 必须挂（红队反测）──
  check('R1 灵敏度：M1 能测出串行', '< 2.5', mA.metrics.M1.value + ' vs ' + mB.metrics.M1.value, !mB.metrics.M1.pass);
  check('R2 灵敏度：M2 串行无重叠', '0 对', mB.metrics.M2.value, !mB.metrics.M2.pass);
  check('R3 灵敏度：M3 串行峰值=1', '1', mB.metrics.M3.value, !mB.metrics.M3.pass);
  check('R4 【红队】串行假实现必须被判 FAIL', 'FAIL', mB.overall ? 'PASS（危险！）' : 'FAIL', !mB.overall);

  // ── 断言：Phase C/D 负向对照必须被检出 ──
  check('R5 【红队】无隔离写冲突必须被 M5 检出', 'FAIL', mC.metrics.M5.value, !mC.metrics.M5.pass);
  check('R6 【红队】上下文污染必须被 M4 检出', 'FAIL', mD.metrics.M4.value, !mD.metrics.M4.pass);
  check('R7 【红队】会话/进程复用必须被 M6 检出', 'FAIL', mE.metrics.M6.value, !mE.metrics.M6.pass);
  check('R8 M6 对照的单一失败性（其余指标不受牵连）', '仅 M6 挂',
    `${Object.values(mE.metrics).filter((m) => !m.pass).map((m) => m.name).join('/') || '无'}`,
    Object.values(mE.metrics).filter((m) => !m.pass).length === 1);

  // ── 总断言：同一份指标代码区分能力 ──
  check('S1 同一份 metrics 对 A=PASS、对 B=FAIL', '区分成立',
    `A=${mA.overall ? 'PASS' : 'FAIL'} / B=${mB.overall ? 'PASS' : 'FAIL'}`,
    mA.overall === true && mB.overall === false);

  // ── 报告 ──
  const passed = A.filter((x) => x.ok).length;
  const lines = [];
  lines.push('# Step 2 · 真并行验证报告', '');
  lines.push(`- 运行时间：${new Date().toISOString()}`);
  lines.push(`- 断言结果：**${passed}/${A.length} 通过**`);
  lines.push('- 成本：0 credits（真实子进程，非模型调用）', '');
  lines.push('> 核心主张：**同一份 metrics 代码必须对"真并行"判 PASS、对"串行假实现"判 FAIL。**');
  lines.push('> 若两者都判 PASS，说明指标没有区分力 → 判定伪协作，步骤作废。', '');
  lines.push(...renderTable(mA, 'A · 真并行（3 worker 同时 spawn；下表为第 1 轮）'));
  lines.push('**Phase A 稳定性（重跑 3 轮）**', '');
  lines.push('| 轮次 | M1 并发度 | M3 峰值 | Gate |');
  lines.push('|------|-----------|---------|------|');
  reps.forEach((r, i) => lines.push(`| 第 ${i + 1} 轮 | ${r.m.metrics.M1.value} | ${r.m.metrics.M3.value} | ${r.m.overall ? 'PASS' : 'FAIL'} |`));
  lines.push('');
  lines.push(`- M1 分布：${m1s.join(' / ')} ｜ min=${m1min} ｜ avg=${m1avg}（阈值 2.5，余量 ${(m1min / 2.5).toFixed(2)}x）`);
  lines.push('- 稳定性是硬要求：若 M1 在某轮跌破阈值，该指标不能作为 Gate 判据。');
  lines.push('');
  lines.push(...renderTable(mB, 'B · 串行假实现（红队反测）'));
  lines.push(...renderTable(mC, 'C · 无隔离对照（2 worker 共用同一目录）'));
  lines.push(...renderTable(mD, 'D · 上下文污染对照（M4 负向对照）'));
  lines.push(...renderTable(mE, 'E · 会话复用对照（M6 负向对照）'));
  lines.push('## 每个指标的负向对照覆盖表', '');
  lines.push('| 指标 | 负向对照来自 | 对照是否被检出 |');
  lines.push('|------|--------------|----------------|');
  lines.push(`| M1 并发度 | B 串行假实现 | ${mB.metrics.M1.pass ? '❌ 未检出' : '✅'} |`);
  lines.push(`| M2 时间线重叠 | B 串行假实现 | ${mB.metrics.M2.pass ? '❌ 未检出' : '✅'} |`);
  lines.push(`| M3 峰值并发 | B 串行假实现 | ${mB.metrics.M3.pass ? '❌ 未检出' : '✅'} |`);
  lines.push(`| M4 上下文隔离 | D 污染注入 | ${mD.metrics.M4.pass ? '❌ 未检出' : '✅'} |`);
  lines.push(`| M5 写冲突 | C 无隔离共用目录 | ${mC.metrics.M5.pass ? '❌ 未检出' : '✅'} |`);
  lines.push(`| M6 会话独立 | E 会话复用 | ${mE.metrics.M6.pass ? '❌ 未检出' : '✅'} |`);
  lines.push('');
  lines.push('> 每个指标都必须有负向对照。没有对照的指标只是"看起来在工作"，无法证明有灵敏度。');
  lines.push('');
  lines.push('## 断言明细', '');
  lines.push('| # | 断言 | 期望 | 实际 | 结果 |');
  lines.push('|---|------|------|------|------|');
  A.forEach((x, i) => lines.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
  lines.push('');
  lines.push('## 结论', '');
  lines.push(passed === A.length
    ? '✅ **Step 2 成立**：指标能区分真并行与串行，"伪协作"在数字上无处藏身。'
    : '❌ **存在不通过项**：指标区分力不足或实现有缺陷，禁止进入 Step 3。');
  w(path.join(LAB, 'step2-report.md'), lines.join('\n') + '\n');
  fs.appendFileSync(path.join(SWARM, 'main-log.md'),
    `(step2) 真并行验证：断言 ${passed}/${A.length}，A.M1=${mA.metrics.M1.value} B.M1=${mB.metrics.M1.value}\n`);

  console.log(`STEP2 ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
  process.exit(passed === A.length ? 0 : 1);
})();
