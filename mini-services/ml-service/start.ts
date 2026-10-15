/**
 * Bun wrapper that spawns the Python FastAPI ML service (uvicorn on port 4000)
 * and stays alive as its parent. The sandbox's process manager keeps `bun`
 * processes alive but reaps detached `python3` processes, so this wrapper
 * ensures the uvicorn child survives as long as bun does.
 *
 * Usage:  bun run start.ts   (from mini-services/ml-service/)
 */
import { spawn } from "bun";

const PORT = "4000";
const HOST = "0.0.0.0";

console.log(`[ml-service] launching uvicorn on ${HOST}:${PORT} ...`);

const child = spawn({
  cmd: ["python3", "-m", "uvicorn", "index:app", "--host", HOST, "--port", PORT],
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
  // Keep the child alive even if this bun process receives signals.
  onExit: async (_child, exitCode, signalCode) => {
    console.error(`[ml-service] uvicorn exited code=${exitCode} signal=${signalCode}; restarting in 2s ...`);
    await Bun.sleep(2000);
    // Re-exec self to restart the service.
    const proc = Bun.spawn(["bun", "run", import.meta.file], { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" });
    await proc.exited;
  },
});

// Keep the bun process alive for the lifetime of the child.
await child.exited;
