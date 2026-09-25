/**
 * metrics.mjs — M1–M6 并行度指标（Step 2 的判定核心）
 *
 * 设计要点：同一份测量代码必须能【区分】真并行与串行。
 * 这是"指标灵敏度"的证明：parallel 记录应全过、serial 记录必须挂。
 */
import fs from 'node:fs';
import path from 'node:path';

const TH = {
  M1: 2.5,      // 并发度 = Σ任务时长 ÷ 阶段墙钟
  M3: 3,        // 峰值并发进程数
};

function overlapMs(a, b) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

export function measure(rec) {
  const tasks = rec.tasks ?? [];
  const n = tasks.length;

  // ── M1 并发度 ──────────────────────────────────────────────
  const sumDur = tasks.reduce((s, t) => s + t.durMs, 0);
  const m1val = rec.wallMs > 0 ? sumDur / rec.wallMs : 0;
  const M1 = {
    name: 'M1 并发度',
    formula: 'Σ任务时长 ÷ 阶段墙钟',
    value: Number(m1val.toFixed(2)),
    threshold: `>= ${TH.M1}`,
    pass: m1val >= TH.M1,
  };

  // ── M2 时间线重叠 ─────────────────────────────────────────
  let overlappingPairs = 0;
  let maxOverlap = 0;
  for (let i = 0; i < n; i++) {
    for (let k = i + 1; k < n; k++) {
      const o = overlapMs(tasks[i], tasks[k]);
      if (o > 0) overlappingPairs++;
      maxOverlap = Math.max(maxOverlap, o);
    }
  }
  const M2 = {
    name: 'M2 时间线重叠',
    formula: '任两任务 [start,end] 区间有交集',
    value: `${overlappingPairs} 对重叠 / 最大重叠 ${maxOverlap}ms`,
    threshold: '>= 1 对',
    pass: overlappingPairs >= 1,
  };

  // ── M3 峰值并发进程数（父进程实测采样）────────────────────
  const M3 = {
    name: 'M3 峰值并发进程数',
    formula: '100ms 轮询存活子进程数的峰值',
    value: rec.peakConcurrent ?? 0,
    threshold: `>= ${TH.M3}`,
    pass: (rec.peakConcurrent ?? 0) >= TH.M3,
  };

  // ── M4 上下文隔离 ─────────────────────────────────────────
  // 用【任务号字面量 + 词边界】匹配，不能用 T-\d+ 这种粗正则
  // （踩过：T-201R1 会被粗正则截成 T-201，造成误报泄漏 + 误报缺号）
  const allIds = tasks.map((t) => t.id);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasId = (txt, id) => new RegExp(`(?<![A-Za-z0-9-])${esc(id)}(?![A-Za-z0-9])`).test(txt);
  const leak = [];
  for (const t of tasks) {
    if (!t.promptFile || !fs.existsSync(t.promptFile)) { leak.push(`${t.id}:prompt缺失`); continue; }
    const txt = fs.readFileSync(t.promptFile, 'utf8');
    if (!hasId(txt, t.id)) leak.push(`${t.id}:缺自己的任务号`);
    const foreign = allIds.filter((o) => o !== t.id && hasId(txt, o));
    if (foreign.length) leak.push(`${t.id}:泄漏了 ${foreign.join('/')}`);
  }
  const M4 = {
    name: 'M4 上下文隔离',
    formula: '每个 worker 的 prompt 只含自己的 task-id',
    value: leak.length === 0 ? `${n}/${n} 隔离` : leak.join('; '),
    threshold: '100% 隔离',
    pass: leak.length === 0,
  };

  // ── M5 写冲突暴露 / worktree 隔离 ─────────────────────────
  const paths = new Map();
  const bad = [];
  for (const t of tasks) {
    if (!t.artifact) { bad.push(`${t.id}:无产物路径`); continue; }
    if (!fs.existsSync(t.artifact)) { bad.push(`${t.id}:产物不存在`); continue; }
    const abs = path.resolve(t.artifact);
    if (paths.has(abs)) bad.push(`${t.id}:与 ${paths.get(abs)} 写同一路径`);
    paths.set(abs, t.id);
    const body = fs.readFileSync(abs, 'utf8');
    if (!body.includes(`owner=${t.id}`)) bad.push(`${t.id}:产物被他人覆盖`);
  }
  const M5 = {
    name: 'M5 写冲突隔离',
    formula: '同相对路径的产物各自独立、内容归属正确',
    value: rec.isolation === 'none'
      ? `isolation=none；${bad.length ? bad.join('; ') : '未检出（异常）'}`
      : (bad.length === 0 ? `${n} 份产物零互覆（isolation=${rec.isolation}）` : bad.join('; ')),
    threshold: '零互覆',
    pass: rec.isolation !== 'none' && bad.length === 0,
  };

  // ── M6 会话独立 ───────────────────────────────────────────
  const pids = tasks.map((t) => t.pid);
  const sess = tasks.map((t) => t.sessionId);
  const M6 = {
    name: 'M6 会话独立',
    formula: 'pid 与 sessionId 全局唯一',
    value: `${new Set(pids).size}/${n} 唯一 pid，${new Set(sess).size}/${n} 唯一 session`,
    threshold: '100% 唯一',
    pass: new Set(pids).size === n && new Set(sess).size === n,
  };

  const all = { M1, M2, M3, M4, M5, M6 };
  return {
    mode: rec.mode,
    isolation: rec.isolation,
    wallMs: rec.wallMs,
    sumDurMs: sumDur,
    metrics: all,
    passed: Object.values(all).filter((m) => m.pass).length,
    total: Object.keys(all).length,
    overall: Object.values(all).every((m) => m.pass),
  };
}

export function renderTable(results, title) {
  const lines = [];
  lines.push(`### ${title}`, '');
  lines.push('| 指标 | 度量式 | 结果 | 阈值 | 判定 |');
  lines.push('|------|--------|------|------|------|');
  for (const m of Object.values(results.metrics)) {
    lines.push(`| ${m.name} | ${m.formula} | ${m.value} | ${m.threshold} | ${m.pass ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push(`- 阶段墙钟：${results.wallMs}ms ｜ 任务时长合计：${results.sumDurMs}ms ｜ 隔离方式：${results.isolation}`);
  lines.push(`- **${results.passed}/${results.total} 通过** → ${results.overall ? 'Gate PASS' : 'Gate FAIL'}`);
  lines.push('');
  return lines;
}
