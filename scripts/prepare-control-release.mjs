import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return (result.stdout || "").trim();
}

const sha = git(["rev-parse", "HEAD"]);
const dirty = git(["status", "--porcelain"]);
const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8");
const nextConfig = readFileSync(join(root, "next.config.ts"), "utf8");

const requiredProd = [
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "DATA_DIR",
  "CONTENT_MEDIA_SIGNING_SECRET",
];
const mustBeAbsentOrFalse = ["HOMESTEAD_CONTROL_ISOLATED", "NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED"];

const report = {
  at: new Date().toISOString(),
  tree: {
    sha,
    dirty: Boolean(dirty),
    dirtyFiles: dirty ? dirty.split("\n").slice(0, 40) : [],
  },
  dockerignoreExcludesData: /^data$/m.test(dockerignore) || dockerignore.includes("\ndata\n") || dockerignore.includes("data\n"),
  isolatedFlagInNextConfig: /HOMESTEAD_CONTROL_ISOLATED/.test(nextConfig),
  requiredProductionEnv: requiredProd,
  mustBeAbsentOrFalse,
  doNotCopy: ["data/control-dev", "docs/auditoria-homestead-app/evidence", ".env", ".env.local"],
  rollback: "Volver la imagen/commit anterior. No restaurar data/control-dev sobre producción.",
  goLiveContent: "El despliegue de UI no autoriza publicar piezas históricas ni reintentar Meta.",
};

if (report.isolatedFlagInNextConfig) {
  console.error("RELEASE_FAIL isolated_flag_in_next_config");
  process.exit(1);
}
if (!existsSync(join(root, "public", "admin", "manifest.webmanifest"))) {
  console.error("RELEASE_FAIL missing_manifest");
  process.exit(1);
}
if (!existsSync(join(root, "public", "admin", "sw.js"))) {
  console.error("RELEASE_FAIL missing_sw");
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
console.log("RELEASE_PREP_OK", sha);
