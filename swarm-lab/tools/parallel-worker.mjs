/**
 * parallel-worker.mjs — Step 2 用的真实子进程 worker
 *
 * 由 run-step2 以独立进程 spawn。自己不做任何"上报"，只干活 + 落文件；
 * 时间线由父进程测量（更可信，且避免并发写日志的锁问题）。
 *
 * 用法: node parallel-worker.mjs <token> <workMs> <sharedRelPath> <sessionId> <taskId>
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , token, workMsRaw, sharedRel, sessionId, taskId] = process.argv;
const workMs = Number(workMsRaw ?? 1500);

const ROOT = process.cwd();                 // 父进程通过 cwd 指定本 worker 的隔离目录
const EVID = path.join(ROOT, 'evidence', taskId);
fs.mkdirSync(EVID, { recursive: true });

// 1) 写"共享路径"产物 —— 用来验隔离是否生效（每个 worker 都写同一个相对路径）
const artifact = path.join(ROOT, sharedRel);
fs.mkdirSync(path.dirname(artifact), { recursive: true });
fs.writeFileSync(artifact, `owner=${taskId}\ntoken=${token}\nsession=${sessionId}\n`, 'utf8');

// 2) 占用可观测时长（busy-wait，保持进程存活，便于父进程采样到真实并发）
const t0 = Date.now();
while (Date.now() - t0 < workMs) { /* burn */ }

// 3) 证据
fs.writeFileSync(path.join(EVID, 'note.txt'),
  `task=${taskId}\nsession=${sessionId}\npid=${process.pid}\nworkMs=${Date.now() - t0}\nartifact=${sharedRel}\n`, 'utf8');

// 4) verdict（首行严格协议）
fs.writeFileSync(path.join(EVID, 'verdict.md'), [
  '### 判定: PASS',
  `TASK: ${taskId}`,
  `AGENT: builder-core@local`,
  `EVIDENCE: evidence/${taskId}/note.txt`,
  `METRICS: {"pid":${process.pid},"session":"${sessionId}"}`,
  `HANDOFF: ${taskId} 完成，产物 ${sharedRel}`,
  '',
].join('\n'), 'utf8');

process.exit(0);
