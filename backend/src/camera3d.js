import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './config.js';

const STOP_TIMEOUT_MS = 3000;
const OFF = { state: 'off', message: '', width: null, height: null, fps: null, gap_ms: null };

let child = null;
let ownerId = null;
let status = { ...OFF };

export function getCamera3dStatus() {
  return { ...status };
}

export function getCamera3dOwner() {
  return child ? ownerId : null;
}

function parseLine(line) {
  const [kind, word, ...rest] = line.trim().split(' ');

  if (kind === 'STATUS' && word === 'starting') {
    status = { ...OFF, state: 'starting', message: 'Starting 3D camera…' };
  } else if (kind === 'STATUS' && word === 'ready') {
    const [width, height] = (rest[0] || '').split('x').map(Number);
    status = { ...status, state: 'ready', message: '', width, height, fps: Number(rest[1]) || null };
    console.log(`[camera3d] Ready: ${rest.join(' ')}`);
  } else if (kind === 'STATUS' && word === 'error') {
    status = { ...status, state: 'error', message: rest.join(' ') };
    console.warn(`[camera3d] Error: ${rest.join(' ')}`);
  } else if (kind === 'STATS') {
    const values = Object.fromEntries(line.split(' ').slice(1).map((pair) => pair.split('=')));
    status = { ...status, fps: Number(values.fps), gap_ms: Number(values.gap_ms) };
  } else if (line.trim() && !(kind === 'STATUS' && word === 'stopped')) {
    console.log(`[camera3d] ${line}`);
  }
}

// Kills the process and everything it started (Windows needs taskkill for that).
function killTree(proc) {
  console.warn('[camera3d] Did not stop in time, killing it');
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
  } else {
    proc.kill('SIGKILL');
  }
}

export function startCamera3d(userId) {
  if (child) return getCamera3dStatus();

  const { pythonPath, script, args } = config.camera3d;
  if (!existsSync(script)) {
    status = { ...OFF, state: 'error', message: `3D camera script not found: ${script}. Set TWO_CAMS_SCRIPT in backend/.env.` };
    return getCamera3dStatus();
  }

  console.log(`[camera3d] Starting: ${pythonPath} ${script} ${args.join(' ')}`);
  status = { ...OFF, state: 'starting', message: 'Starting 3D camera…' };
  ownerId = userId;

  const proc = spawn(pythonPath, ['-u', script, ...args], {
    cwd: path.dirname(script),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child = proc;

  readline.createInterface({ input: proc.stdout }).on('line', parseLine);
  readline.createInterface({ input: proc.stderr }).on('line', (line) => console.warn(`[camera3d stderr] ${line}`));
  proc.stdin.on('error', () => {}); // the script may already be gone when we close stdin

  proc.on('error', (error) => {
    status = {
      ...OFF,
      state: 'error',
      message: `Could not start Python (${pythonPath}): ${error.message}. Set PYTHON_PATH in backend/.env.`,
    };
    console.warn(`[camera3d] ${status.message}`);
  });

  proc.on('close', (code) => {
    if (child !== proc) return;
    child = null;
    ownerId = null;
    if (proc.stopRequested) {
      status = { ...OFF };
    } else if (status.state !== 'error') {
      // Exited on its own without explaining why.
      status = { ...OFF, state: 'error', message: `The 3D camera stopped unexpectedly (exit code ${code}).` };
    }
    console.log(`[camera3d] Stopped (exit code ${code})`);
  });

  return getCamera3dStatus();
}

// Asks the script to stop by closing its stdin; kills it after 3 s if it hasn't exited.
export function stopCamera3d(reason = 'requested') {
  if (!child) {
    status = { ...OFF };
    return Promise.resolve(getCamera3dStatus());
  }

  const proc = child;
  // Already stopping (e.g. the tab's stop request and its socket disconnect arrive together):
  // wait for that same stop instead of starting a second one.
  if (proc.stopping) return proc.stopping;

  console.log(`[camera3d] Stopping (${reason})`);
  proc.stopRequested = true;

  proc.stopping = new Promise((resolve) => {
    const timer = setTimeout(() => killTree(proc), STOP_TIMEOUT_MS);
    proc.once('close', () => {
      clearTimeout(timer);
      resolve(getCamera3dStatus());
    });
    proc.stdin.end();
  });
  return proc.stopping;
}

// Last resort when the backend exits: never leave the cameras on.
export function killCamera3dNow() {
  if (child) killTree(child);
}
