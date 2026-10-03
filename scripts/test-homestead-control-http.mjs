import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "http-test");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

async function probe(url) {
  try {
    const response = await fetch(`${url}/admin/manifest.webmanifest`, { redirect: "manual" });
    return response.ok;
  } catch {
    return false;
  }
}

let child = null;
let base = process.env.CONTROL_HTTP_BASE || "";
if (!base && !process.env.CONTROL_HTTP_PORT && (await probe("http://127.0.0.1:3000"))) {
  base = "http://127.0.0.1:3000";
}
if (!base) {
  const port = Number(process.env.CONTROL_HTTP_PORT || 3017);
  base = `http://127.0.0.1:${port}`;
  const useStart = existsSync(join(root, ".next", "BUILD_ID"));
  child = spawn("npx", ["next", useStart ? "start" : "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      if (/Ready|Local:|started server/i.test(String(chunk))) resolve();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setInterval(() => {
      if (Date.now() - started > 90_000) {
        clearInterval(timer);
        reject(new Error("next_dev_timeout"));
      }
    }, 1000);
  });
}

async function hit(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers || {}), origin: base },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, json, text };
}

function cookieHeader(response, extra = "") {
  const raw = response.headers.getSetCookie?.() || [];
  const pairs = raw.map((row) => row.split(";")[0]).filter(Boolean);
  if (extra) pairs.push(extra);
  return pairs.join("; ");
}

const unauth = await hit("/api/admin/content/home");
ok("HTTP-01 unauthorized without session", unauth.response.status === 401);

const badLogin = await hit("/api/admin/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "wrong-password" }),
});
ok("HTTP-02 bad password", badLogin.response.status === 401);

const login = await hit("/api/admin/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "control-local", returnUrl: "/admin/contenido" }),
});
ok("HTTP-03 login isolated", login.response.status === 200 && login.json?.ok === true);
const sessionCookie = cookieHeader(login.response);

const csrfRes = await hit("/api/admin/control/session", { headers: { cookie: sessionCookie } });
ok("HTTP-04 session csrf", csrfRes.response.status === 200 && Boolean(csrfRes.json?.csrf));
const csrf = csrfRes.json.csrf;

const noCsrf = await hit("/api/admin/content/studio", {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: sessionCookie },
  body: JSON.stringify({ paused: true }),
});
ok("HTTP-05 csrf rejected", noCsrf.response.status === 403);

const pause = await hit("/api/admin/content/studio", {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: sessionCookie, "x-csrf-token": csrf },
  body: JSON.stringify({ paused: true }),
});
ok("HTTP-06 pause with mutation auth", pause.response.status === 200 && pause.json?.ok === true);

const resume = await hit("/api/admin/content/studio", {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: sessionCookie, "x-csrf-token": csrf },
  body: JSON.stringify({ paused: false }),
});
ok("HTTP-07 resume", resume.response.status === 200 && resume.json?.paused === false);

const home = await hit("/api/admin/content/home", { headers: { cookie: sessionCookie } });
ok("HTTP-08 home authorized", home.response.status === 200 && home.json?.ok !== false);

const campaigns = await hit("/api/admin/content/campaigns", { headers: { cookie: sessionCookie } });
ok("HTTP-09 campaigns http", campaigns.response.status === 200);

const logout = await hit("/api/admin/logout", { method: "POST", headers: { cookie: sessionCookie } });
ok("HTTP-10 logout", logout.response.status === 200);
const afterLogout = await hit("/api/admin/content/home");
ok("HTTP-11 session cookie cleared", afterLogout.response.status === 401);
const reused = await hit("/api/admin/content/home", { headers: { cookie: sessionCookie } });
ok("HTTP-11b revoked token reuse rejected", reused.response.status === 401);

const manifest = await hit("/admin/manifest.webmanifest");
ok("HTTP-12 manifest public", manifest.response.status === 200 && /Homestead Control/.test(manifest.text));
const sw = await hit("/admin/sw.js");
ok("HTTP-13 service worker public", sw.response.status === 200 && /control-pwa-v2/.test(sw.text));
const offline = await hit("/admin/offline");
ok("HTTP-14 offline public", offline.response.status === 200 && /Sin conexión/.test(offline.text));

child?.kill();
if (failed) {
  console.error(`\n${failed} HTTP assertion(s) failed`);
  process.exit(1);
}
console.log("\nHOMESTEAD CONTROL HTTP tests OK");
console.log("BASE", base);
console.log("DATA_DIR", dataDir);
