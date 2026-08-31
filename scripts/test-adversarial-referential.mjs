import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const behavior = spawnSync("npx", ["tsx", "scripts/adversarial-referential-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (behavior.stdout) process.stdout.write(behavior.stdout);
if (behavior.stderr) process.stderr.write(behavior.stderr);
if (behavior.status !== 0) process.exit(1);
console.log("ADVERSARIAL REFERENTIAL GATE PASS");
