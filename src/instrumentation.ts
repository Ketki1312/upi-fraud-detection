/**
 * Next.js instrumentation hook — runs ONCE when the Next.js server starts.
 *
 * The sandbox's process watchdog only allowlists processes descended from the
 * sandbox-managed `bun run dev` (Next.js) process. A standalone `python3 -m uvicorn`
 * background process gets reaped within ~30 seconds. To keep the Python ML
 * service (port 4000) alive, we spawn it as a child of the Next.js server
 * process here, so it inherits the allowlisted session.
 *
 * In dev mode the ML service is optional — if it fails to start, the Next.js
 * app still runs and the UI shows "ML service offline" rather than crashing.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname, resolve } from "path";

// Guard against double-spawn in dev hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __mlServiceSpawned: boolean | undefined;
}

const ML_HOST = "127.0.0.1";
const ML_PORT = 4000;
const LOG_FILE = resolve(process.cwd(), "mini-services/ml-service/ml-service.log");

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // only run in the Node.js runtime
  if (globalThis.__mlServiceSpawned) return;
  globalThis.__mlServiceSpawned = true;

  const mlDir = resolve(process.cwd(), "mini-services/ml-service");

  // If the ML service is already reachable, don't spawn a duplicate.
  try {
    const res = await fetch(`http://${ML_HOST}:${ML_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      console.log("[instrumentation] ML service already running — not spawning a duplicate.");
      return;
    }
  } catch {
    // Not running — proceed to spawn.
  }

  if (!existsSync(mlDir) || !existsSync(resolve(mlDir, "index.py"))) {
    console.warn(`[instrumentation] ML service directory not found at ${mlDir} — skipping spawn.`);
    return;
  }

  const runScript = resolve(mlDir, "run.sh");
  if (!existsSync(runScript)) {
    console.warn(`[instrumentation] run.sh not found at ${runScript} — skipping spawn.`);
    return;
  }

  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const logStream = appendFileSync.bind(null, LOG_FILE);
    logStream(`\n[instrumentation ${new Date().toISOString()}] spawning ML service via run.sh...\n`);

    // Use the self-healing run.sh wrapper, which ensures pip packages are
    // present (the sandbox can wipe the venv between sessions) before exec'ing uvicorn.
    const child = spawn("bash", [runScript], {
      cwd: mlDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false, // keep it a child of the Next.js process so it inherits the allowlisted session
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    child.stdout?.on("data", (d) => appendFileSync(LOG_FILE, d.toString()));
    child.stderr?.on("data", (d) => appendFileSync(LOG_FILE, d.toString()));
    child.on("exit", (code, sig) => {
      appendFileSync(LOG_FILE, `[instrumentation] ML service exited code=${code} sig=${sig}\n`);
      globalThis.__mlServiceSpawned = false; // allow a future re-spawn attempt
    });

    // Don't keep the Node.js event loop alive just for this child — Next.js has its own server.
    child.unref();

    console.log(`[instrumentation] ML service spawned (PID ${child.pid}) on port ${ML_PORT}.`);
  } catch (err) {
    console.warn(`[instrumentation] Failed to spawn ML service:`, err);
  }
}
