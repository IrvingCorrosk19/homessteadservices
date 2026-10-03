import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root);
assertSafeToMutateControlDev(dataDir, "wipe");

for (const name of ["homestead.sqlite", "homestead.sqlite-wal", "homestead.sqlite-shm"]) {
  const path = join(dataDir, name);
  if (existsSync(path)) rmSync(path);
}

console.log("WIPED", dataDir);
