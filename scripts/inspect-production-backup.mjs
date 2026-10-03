import { existsSync, statSync, accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, userInfo } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "production-backup.mjs");
const sh = join(root, "scripts", "production-backup.sh");

function inspect(path) {
  if (!existsSync(path)) return { path, exists: false };
  const st = statSync(path);
  const mode = (st.mode & 0o777).toString(8).padStart(3, "0");
  let readable = false;
  let writable = false;
  let executable = false;
  try {
    accessSync(path, constants.R_OK);
    readable = true;
  } catch {}
  try {
    accessSync(path, constants.W_OK);
    writable = true;
  } catch {}
  try {
    accessSync(path, constants.X_OK);
    executable = true;
  } catch {}
  return {
    path,
    exists: true,
    size: st.size,
    mode,
    uid: st.uid,
    gid: st.gid,
    worldWritable: (st.mode & 0o002) !== 0,
    readable,
    writable,
    executable,
  };
}

const report = {
  at: new Date().toISOString(),
  platform: platform(),
  user: userInfo().username,
  cwd: resolve(root),
  nodeScript: inspect(script),
  shellScript: inspect(sh),
  notes: [
    "chmod +x no repara un propietario incorrecto ni un directorio no escribible.",
    "El backup WAL-safe es scripts/production-backup.mjs (API backup de SQLite).",
    "No ejecutar este inspector contra DATA_DIR de producción desde el entorno local aislado.",
  ],
};

if (platform() !== "win32" && report.nodeScript.worldWritable) {
  console.error("BACKUP_INSPECT_FAIL world_writable_script");
  process.exit(1);
}
if (platform() === "win32") {
  report.notes.push("En Windows el bit world-writable de Node no es evidencia de ACL reales; revisar icacls en el VPS Linux.");
}
if (!report.nodeScript.exists || !report.nodeScript.readable) {
  console.error("BACKUP_INSPECT_FAIL script_unreadable");
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
console.log("BACKUP_INSPECT_OK");
