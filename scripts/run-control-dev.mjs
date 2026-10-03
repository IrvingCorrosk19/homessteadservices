import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { applyControlIsolatedEnv } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root);
if (!existsSync(join(dataDir, "homestead.sqlite"))) {
  const { spawnSync } = await import("node:child_process");
  const seeded = spawnSync("npx", ["tsx", "scripts/seed-control-dev.mjs"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: true,
  });
  if (seeded.status !== 0) process.exit(seeded.status || 1);
}

console.log("Homestead Control aislado");
console.log("DATA_DIR", dataDir);
console.log("Login local: contraseña control-local (solo válida en este modo aislado)");
console.log("Abre /admin/login y luego /admin/contenido");

const child = spawn("npx", ["next", "dev"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code || 0));
