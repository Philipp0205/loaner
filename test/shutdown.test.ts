import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The start command, read from package.json and railway.json so the tests run what Railway runs. */
function startArgs(): string[] {
  const npmStart = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: { start: string } }).scripts.start;
  const railwayStart = (JSON.parse(fs.readFileSync(path.join(ROOT, "railway.json"), "utf8")) as { deploy: { startCommand: string } }).deploy.startCommand;
  assert.equal(railwayStart, npmStart, "railway.json startCommand and the npm start script must match");
  const [bin, ...args] = npmStart.split(/\s+/);
  assert.equal(bin, "node");
  return args;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

type Started = {
  child: ChildProcess;
  output: () => string;
  stderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

/** The same command Railway runs (see startArgs), run directly with node (no npm wrapper). */
async function startServer(dbPath: string, port: number): Promise<Started> {
  const child = spawn(process.execPath, startArgs(), {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, APP_TZ: "UTC", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", FEEDBACK_ADMIN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk: Buffer) => (out += chunk));
  child.stderr?.on("data", (chunk: Buffer) => {
    out += chunk;
    err += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const started: Started = { child, output: () => out, stderr: () => err, exited };
  const deadline = Date.now() + 20000;
  while (!out.includes("listening")) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    if (Date.now() > deadline) throw new Error(`server did not start:\n${out}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return started;
}

test("quiet-warnings drops only the sqlite ExperimentalWarning", () => {
  const script = [
    'import "./src/quiet-warnings.ts";',
    'process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");',
    'process.emitWarning("Something else is experimental", "ExperimentalWarning");',
    'process.emitWarning("plain warning");',
  ].join("\n");
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /SQLite/);
  assert.match(run.stderr, /Something else is experimental/);
  assert.match(run.stderr, /plain warning/);
});

test("the start command boots the server with no sqlite ExperimentalWarning on stderr", async () => {
  // Only meaningful on Node 22, where importing node:sqlite emits the warning. Node 24 never
  // emits it, so there this passes without exercising the preload. Railway runs Node 22.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loaner-warning-"));
  let started: Started | undefined;
  try {
    started = await startServer(path.join(dir, "loaner.db"), await freePort());
    assert.doesNotMatch(started.stderr(), /ExperimentalWarning|SQLite is an experimental/i);
    started.child.kill("SIGTERM");
    await started.exited;
  } finally {
    if (started && started.child.exitCode === null) started.child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`${signal} stops the real server with exit 0 and leaves the db readable`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loaner-shutdown-"));
    const dbPath = path.join(dir, "loaner.db");
    let started: Started | undefined;
    const agent = new http.Agent({ keepAlive: true });
    try {
      const port = await freePort();
      started = await startServer(dbPath, port);

      // Leave an idle keep-alive connection open. It must not hold shutdown for the 8s fallback.
      await new Promise<void>((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/", agent }, (res) => {
          res.resume();
          res.once("end", resolve);
        });
        req.once("error", reject);
      });

      started.child.kill(signal);
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        started.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no exit after ${signal}:\n${started?.output()}`)), 7000);
        }),
      ]).finally(() => clearTimeout(timer));
      assert.equal(result.code, 0, `exit ${JSON.stringify(result)}\n${started.output()}`);
      assert.match(started.output(), new RegExp(`stopping on ${signal}`));
      assert.doesNotMatch(started.output(), /ExperimentalWarning/);

      const db = new DatabaseSync(dbPath);
      try {
        assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
        assert.equal((db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n, 0);
      } finally {
        db.close();
      }
    } finally {
      agent.destroy();
      if (started && started.child.exitCode === null) started.child.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
