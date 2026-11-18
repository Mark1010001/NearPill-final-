#!/usr/bin/env node
// Packet 0 acceptance must execute every discovered test file, including
// security contracts. Run bounded, independently attested TAP batches: large
// monolithic Node invocations have stalled on constrained verification hosts.
// Batching is not a way to skip or weaken any mandatory acceptance gate.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const baselineMode = args[0] === '--baseline';
const partialMode = args[0] === '--partial-baseline';
const files = (baselineMode || partialMode) ? args.slice(1) : args;
const packet0Test = /^backend\/test\/(?:[\w.-]+\/)*packet0-[\w.-]+\.test\.(?:mjs|cjs|js)$/;
const remainingTest = /^(?:backend\/test\/(?:[\w.-]+\/)*(?!packet0-)[\w.-]+|test\/(?:[\w.-]+\/)*[\w.-]+)\.test\.(?:mjs|cjs|js)$/;
if (!files.length || files.some((name) => name.split('/').some((part) => part === '.' || part === '..' || part === '') ||
  !((baselineMode || partialMode) ? remainingTest : packet0Test).test(name))) {
  console.error((baselineMode || partialMode)
    ? 'FAIL: expected canonical remaining backend/test or root test/*.test.* files.'
    : 'FAIL: expected at least one canonical backend/test/packet0-*.test.{mjs,cjs,js} file.');
  process.exit(1);
}

// Node's runner silently deduplicates duplicate arguments. Reject them before
// executing any source; every discovered file must be accounted for exactly once.
if (new Set(files).size !== files.length) {
  console.error('FAIL: duplicate test file arguments in Packet 0 acceptance inventory.');
  process.exit(1);
}

const label = baselineMode ? 'Remaining Node baseline' : partialMode ? 'Unsupported-runtime Node subset' : 'Packet 0';
// A stalled test must not leave a verifier waiting indefinitely. The optional
// override can LOWER the watchdog for a disposable regression fixture, but
// cannot silently disable or increase the reviewed 120-second safety ceiling.
const maxBatchTimeoutMs = 120_000;
const timeoutOverride = process.env.NEARPILL_PACKET0_BATCH_TIMEOUT_MS;
if (timeoutOverride !== undefined &&
    (!/^[1-9][0-9]{0,5}$/.test(timeoutOverride) ||
     Number(timeoutOverride) < 250 || Number(timeoutOverride) > maxBatchTimeoutMs)) {
  console.error('FAIL: invalid Packet 0 batch deadline override (250..120000 ms); cannot disable watchdog.');
  process.exit(1);
}
const batchTimeoutMs = timeoutOverride === undefined ? maxBatchTimeoutMs : Number(timeoutOverride);
// Small fixed batches keep expensive security/DB characterization subprocesses
// beneath the existing 120s watchdog without skipping any discovered file.
// The prior 18-file third batch repeatedly hit the watchdog on this host.
const batchSize = 9;
const batches = [];
for (let start = 0; start < files.length; start += batchSize) {
  batches.push(files.slice(start, start + batchSize));
}

// Keep the full transcript on stdout and only a bounded tail for the final
// summary. Each batch must independently have a complete, valid TAP summary.
async function runBatch(batch, index) {
  console.log(`${label} batch ${index + 1}/${batches.length}: ${batch.length} distinct test files`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--test', '--test-reporter=tap', '--test-concurrency=2', ...batch,
    ], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    // On POSIX the entire test-runner process group must be terminated: Node
    // --test spawns child workers, which would survive killing the runner alone.
    function signalBatch(signal) {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else if (child.pid) process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') console.error(`FAIL: cannot signal ${label} test group: ${error.message}`);
      }
    }
    let timedOut = false;
    let killTimer;
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      console.error(`FAIL: ${label} batch ${index + 1} exceeded its ${batchTimeoutMs} ms deadline; no test result is accepted.`);
      signalBatch('SIGTERM');
      killTimer = setTimeout(() => signalBatch('SIGKILL'), 1500);
      killTimer.unref();
    }, batchTimeoutMs);
    deadlineTimer.unref();
    const expectedFileNames = new Set(batch);
    const emptyFileCases = new Set();
    let pendingTapLine = '';
    let tail = '';
    let spawnFailure = null;
    function observeTapLine(line) {
      const prefix = '# Subtest: ';
      if (line.startsWith(prefix)) {
        const name = line.slice(prefix.length).replace(/\r$/u, '').replace(/\\+/g, '/');
        if (expectedFileNames.has(name)) emptyFileCases.add(name);
      }
    }
    child.stdout.on('data', (data) => {
      process.stdout.write(data);
      const chunk = data.toString('utf8');
      tail = (tail + chunk).slice(-128 * 1024);
      const lines = (pendingTapLine + chunk).split('\n');
      pendingTapLine = lines.pop() ?? '';
      for (const line of lines) observeTapLine(line);
    });
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.on('error', (error) => { spawnFailure = error; });
    child.on('close', (status, signal) => {
      clearTimeout(deadlineTimer);
      if (killTimer) clearTimeout(killTimer);
      if (pendingTapLine) observeTapLine(pendingTapLine);
      if (timedOut) {
        console.error(`FAIL: ${label} batch ${index + 1} timed out; later batches must not run.`);
        resolve(null);
        return;
      }
      if (spawnFailure) {
        console.error(`FAIL: cannot start ${label} batch ${index + 1}: ${spawnFailure.message}`);
        resolve(null);
        return;
      }
      if (emptyFileCases.size) {
        console.error(`FAIL: ${label} batch ${index + 1} includes a file with no registered tests: ${[...emptyFileCases].join(', ')}`);
        resolve(null);
        return;
      }
      const summary = tail.match(/(?:^|\n)1\.\.(\d+)\r?\n# tests (\d+)\r?\n# suites \d+\r?\n# pass (\d+)\r?\n# fail (\d+)\r?\n# cancelled (\d+)\r?\n# skipped (\d+)\r?\n# todo (\d+)\r?\n# duration_ms [0-9.]+\s*$/u);
      if (status !== 0 || signal || !summary) {
        console.error(`FAIL: ${label} batch ${index + 1} exited ${status}, signal ${signal ?? 'none'}, or has no complete TAP summary.`);
        resolve(null);
        return;
      }
      const [total, reported, passed, failed, cancelled, skipped, todo] = summary.slice(1).map(Number);
      const valid = partialMode
        ? total > 0 && total === reported && passed > 0 && passed + skipped === total && !failed && !cancelled && !todo
        : total > 0 && total === reported && passed === total && !failed && !cancelled && !skipped && !todo;
      if (!valid) {
        console.error(`FAIL: ${label} batch ${index + 1} has incomplete or skipped test coverage: tests=${reported}, pass=${passed}, fail=${failed}, cancelled=${cancelled}, skipped=${skipped}, todo=${todo}.`);
        resolve(null);
        return;
      }
      console.log(`${label} batch ${index + 1}/${batches.length}: ${passed}/${reported} passed, ${skipped} skipped`);
      resolve({ total: reported, passed, skipped });
    });
  });
}

let total = 0;
let passed = 0;
let skipped = 0;
for (const [index, batch] of batches.entries()) {
  const result = await runBatch(batch, index);
  if (!result) {
    console.error(`FAIL: ${label} attestation stopped; no partial batch result is accepted as a full PASS.`);
    process.exitCode = 1;
    break;
  }
  total += result.total;
  passed += result.passed;
  skipped += result.skipped;
}
if (!process.exitCode) {
  if (partialMode) {
    console.log(`PARTIAL: unsupported-runtime Node subset: ${passed}/${total} passed, ${skipped} skipped across ${batches.length} attested batches; NOT full baseline acceptance.`);
  } else {
    console.log(`PASS: ${label} TAP attests ${passed}/${total} executed tests across ${batches.length} batches, with zero skipped/todo/cancelled.`);
  }
}
