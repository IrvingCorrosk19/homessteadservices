import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root);
assertSafeToMutateControlDev(dataDir, "backup-drill");

if (!existsSync(join(dataDir, "homestead.sqlite"))) {
  const seeded = spawnSync("npx", ["tsx", "scripts/seed-control-dev.mjs"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: true,
  });
  if (seeded.status !== 0) process.exit(seeded.status || 1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = join(dataDir, "backups", stamp);
const restoreDest = join(dataDir, "restore-drill", stamp);
mkdirSync(join(dataDir, "backups"), { recursive: true });

const backup = spawnSync(process.execPath, ["scripts/production-backup.mjs", "--dest", dest], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dataDir },
  stdio: "inherit",
});
if (backup.status !== 0) process.exit(backup.status || 1);

const restore = spawnSync(
  process.execPath,
  ["scripts/production-restore.mjs", "--from", dest, "--dest", restoreDest, "--force"],
  {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: "inherit",
  },
);
if (restore.status !== 0) process.exit(restore.status || 1);

const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
if (!manifest.database?.sha256) {
  console.error("DRILL_FAIL missing_sha");
  process.exit(1);
}
if (!String(restoreDest).replaceAll("\\", "/").includes("/data/control-dev/restore-drill/")) {
  console.error("DRILL_FAIL restore_not_isolated");
  process.exit(1);
}

console.log("BACKUP_DRILL_OK", { dest, restoreDest, sha256: manifest.database.sha256 });
