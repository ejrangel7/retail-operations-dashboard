import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

let result = { code: 1, signal: null };

try {
  result = await run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]);
} finally {
  const cleanup = await run("docker", ["compose", "down", "--remove-orphans"]);
  if (cleanup.code !== 0) {
    console.error("Docker Compose cleanup failed.");
    if (result.code === 0) result = cleanup;
  }
}

if (result.signal) console.error(`Playwright stopped after receiving ${result.signal}.`);
process.exitCode = result.code ?? 1;
