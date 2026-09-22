// 桥接安全检查：Origin 门禁、工作目录必须完整限定、链接不能越出工作目录；卷宗接口不能越出卷宗目录、网页按纯文本给；沙箱在桥接这头守
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
const PORT = Number(process.env.YAN_PORT || 8797),
  BASE = `http://127.0.0.1:${PORT}`;
import { TMP } from "./lib.mjs";
const WORK = `${TMP}/link-work`,
  OUTSIDE = `${TMP}/link-outside`;
for (const dir of [WORK, OUTSIDE]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
writeFileSync(`${OUTSIDE}/secret.txt`, "OUTSIDE-SECRET line\n");
writeFileSync(`${WORK}/inside.txt`, "inside line\n");
symlinkSync(OUTSIDE, `${WORK}/escape`, "junction"); // 目录 junction 不需要管理员权限
const check = (label, ok, detail = "") => console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
};
for (let i = 0; i < 40; i++) {
  try {
    await fetch(BASE + "/api/bootstrap");
    break;
  } catch {
    await new Promise(r => setTimeout(r, 250));
  }
}
const win = process.platform === "win32",
  workdir = WORK.split("/").join(win ? "\\" : "/");
// 静态服务只给页面资源：仓库源码、测试与 .git 即使同在服务根目录，也不能被其他本地网页读走。
for (const publicPath of [
  "/",
  "/support.js",
  "/app.css",
  "/theme-boot.js",
  "/preview.html",
  "/prompts/assistant.js",
  "/vendor/marked.umd.js"
]) {
  const response = await fetch(BASE + publicPath, { headers: { Origin: "http://127.0.0.1:9999" } });
  check(`public static asset ${publicPath} is served`, response.status === 200, String(response.status));
  await response.body?.cancel();
}
for (const privatePath of [
  "/server.js",
  "/server/chats.js",
  "/test/bridge-security.mjs",
  "/prompts/README.md",
  "/.git/config",
  "/package.json",
  "/vendor%5c..%5cserver.js"
]) {
  const response = await fetch(BASE + privatePath, { headers: { Origin: "http://127.0.0.1:9999" } });
  check(`private repository path ${privatePath} is hidden`, response.status === 404, String(response.status));
  await response.body?.cancel();
}
// Origin 门禁
let r = await post("/api/work/run", { workdir, command: "echo hi" }, { Origin: "null" });
check("Origin: null cannot reach the work API", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
r = await post("/api/work/run", { workdir, command: "echo hi" }, { Origin: "http://127.0.0.1:9999" });
check("other local port is rejected", r.status === 403, String(r.status));
r = await post("/api/work/run", { workdir, command: "echo hi" }, { Origin: "https://evil.example" });
check("foreign origin is rejected", r.status === 403, String(r.status));
r = await fetch(BASE + "/api/work/run", { method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "POST" } });
check("preflight from null origin is refused too", r.status === 403, String(r.status));
r = await post("/api/work/prepare", { workdir }, { Origin: `http://127.0.0.1:${PORT}` });
check(
  "own origin passes",
  r.status === 200 && r.data.workdir.toLowerCase() === workdir.toLowerCase(),
  `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`
);
r = await post("/api/chats/load", { root: "relative-chats" });
check(
  "custom chats directory requires an absolute path",
  r.status === 500 && /完整的绝对路径/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/chats/load", { root: win ? "C:\\" : "/" });
check(
  "custom chats directory refuses a disk root",
  r.status === 500 && /整个磁盘/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
// 工作目录必须完整限定
for (const bad of win ? ["\\yan-drive-relative", "/yan-drive-relative", "C:yan-relative", "foo", "./foo"] : ["foo", "./foo"]) {
  r = await post("/api/work/prepare", { workdir: bad });
  check(
    `workdir ${JSON.stringify(bad)} refused`,
    r.status === 400 && /完整的绝对路径/.test(r.data?.error || ""),
    `${r.status} ${r.data?.error}`
  );
  check(`  …and nothing was created for ${JSON.stringify(bad)}`, !existsSync(bad));
}
r = await post("/api/work/prepare", { workdir: win ? "C:\\" : "/" });
check("disk root refused", r.status === 400 && /整个磁盘/.test(r.data?.error || ""), r.data?.error);
r = await post("/api/work/prepare", { workdir: workdir + (win ? "\\" : "/") });
check("trailing separator still accepted", r.status === 200, `${r.status} ${r.data?.error || ""}`);
// 链接不能越出
r = await post("/api/work/search", { workdir, query: "OUTSIDE" });
check("search does not follow the junction out", r.status === 200 && r.data.matches.length === 0, JSON.stringify(r.data).slice(0, 160));
r = await post("/api/work/search", { workdir, query: "inside" });
check("search still finds real files", r.status === 200 && r.data.matches.length === 1, JSON.stringify(r.data).slice(0, 160));
r = await post("/api/work/list", { workdir, depth: 3 });
check(
  "list marks the link and does not descend",
  r.status === 200 && r.data.entries.includes("escape@") && !r.data.entries.some(e => e.includes("secret")),
  JSON.stringify(r.data.entries)
);
r = await post("/api/work/read", { workdir, path: "escape/secret.txt" });
check("read through the junction is refused", r.status === 400 && /越出/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/write", { workdir, path: "escape/planted.txt", content: "x" });
check(
  "write through the junction is refused",
  r.status === 400 && /越出/.test(r.data?.error || "") && !existsSync(`${OUTSIDE}/planted.txt`),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/edit", { workdir, path: "escape/secret.txt", old: "OUTSIDE", new: "X" });
check("edit through the junction is refused", r.status === 400 && /越出/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/read", { workdir, path: "../link-outside/secret.txt" });
check("plain .. is refused", r.status === 400 && /越出/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
// 放开可及范围（roam）：完整的绝对路径可以在目录之外，相对路径与链接越界照旧拒绝，整个磁盘不行
const outsideFile = `${OUTSIDE}/secret.txt`.split("/").join(win ? "\\" : "/");
r = await post("/api/work/read", { workdir, roam: true, path: outsideFile });
check(
  "roam: absolute path outside the directory is readable",
  r.status === 200 && /OUTSIDE-SECRET/.test(r.data?.text || "") && r.data.path === outsideFile,
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/read", { workdir, roam: true, path: "../link-outside/secret.txt" });
check("roam: relative .. still refused", r.status === 400 && /越出/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/read", { workdir, path: outsideFile });
check(
  "without roam the same absolute path is refused",
  r.status === 400 && /越出/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/list", { workdir, roam: true, path: win ? "C:\\" : "/" });
check("roam: a whole disk is refused", r.status === 400, `${r.status} ${r.data?.error}`);
r = await post("/api/work/write", {
  workdir,
  roam: true,
  path: `${OUTSIDE}/planted-roam.txt`.split("/").join(win ? "\\" : "/"),
  content: "x"
});
check(
  "roam: writing outside works and reports the full path",
  r.status === 200 && existsSync(`${OUTSIDE}/planted-roam.txt`) && /planted-roam/.test(r.data?.path || ""),
  `${r.status} ${r.data?.error}`
);
// ---- 卷宗接口
const ARCHIVE = `${TMP}/archive-security`;
r = await post("/api/archive/put", { name: "../escaped.txt", data: "data:text/plain;base64,aGk=" });
check(
  "archive put keeps only the basename",
  r.status === 200 && r.data.path === "escaped.txt" && existsSync(`${ARCHIVE}/escaped.txt`) && !existsSync(`${TMP}/escaped.txt`),
  `${r.status} ${JSON.stringify(r.data)}`
);
r = await post("/api/archive/put", { name: "escaped.txt", data: "data:text/plain;base64,aGk=" });
check("archive put never overwrites: same name gets (2)", r.status === 200 && r.data.name === "escaped (2).txt", JSON.stringify(r.data));
r = await post("/api/archive/put", { name: "page.html", data: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" });
let f = await fetch(`${BASE}/api/archive/file?path=page.html`);
check(
  "archive html is served as plain text in a sandbox",
  f.status === 200 && /^text\/plain/.test(f.headers.get("content-type") || "") && f.headers.get("content-security-policy") === "sandbox",
  `${f.status} ${f.headers.get("content-type")}`
);
f = await fetch(`${BASE}/api/archive/file?path=../link-outside/secret.txt`);
check("archive file refuses ..", f.status === 404);
f = await fetch(`${BASE}/api/archive/file?path=escaped.txt`, { headers: { Origin: "https://evil.example" } });
check("archive file refuses foreign origin", f.status === 403);
r = await post("/api/archive/list", {});
check(
  "archive list shows the files with size and mtime",
  r.status === 200 && r.data.entries.some(e => e.path === "escaped.txt" && e.size === 2 && e.modifiedAt),
  JSON.stringify(r.data?.entries?.slice(0, 3))
);
r = await post("/api/archive/remove", { path: "../link-outside/secret.txt" });
check("archive remove refuses ..", r.status === 400 && existsSync(`${OUTSIDE}/secret.txt`), `${r.status} ${r.data?.error}`);
r = await post("/api/archive/remove", { path: "escaped.txt" });
check("archive remove deletes inside", r.status === 200 && !existsSync(`${ARCHIVE}/escaped.txt`), `${r.status} ${r.data?.error}`);
r = await post("/api/archive/list", { root: win ? "C:\\" : "/" });
check("archive root refuses a whole disk", r.status === 400, `${r.status} ${r.data?.error}`);
r = await post("/api/archive/list", { root: "relative/dir" });
check("archive root must be absolute", r.status === 400, `${r.status} ${r.data?.error}`);
r = await post("/api/archive/put", { root: workdir, name: "in-work.txt", data: "data:text/plain;base64,aGk=" });
check(
  "archive root can be redirected to another absolute directory",
  r.status === 200 && existsSync(`${WORK}/in-work.txt`),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/archive/clean", { root: workdir, id: "../escape" });
check(
  "archive clean strips path characters from the id",
  r.status === 200 && existsSync(`${OUTSIDE}/secret.txt`),
  `${r.status} ${r.data?.error}`
);
// ---- 工具定义过多不再静默截断
r = await post("/api/chat", {
  profile: { source: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "x", apiKey: "k" },
  messages: [{ role: "user", content: "hi" }],
  tools: Array.from({ length: 129 }, (_, i) => ({
    type: "function",
    function: { name: `t${i}`, parameters: { type: "object", properties: {} } }
  }))
});
check(
  "129 tools is an explicit error, not a silent slice",
  r.status === 400 && /工具定义过多/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
// ---- 公网 IPv6 字面量能过 SSRF 校验（走到连接那一步），本机 / 映射的内网地址照样拒绝
r = await post("/api/fetch", { url: "http://[::1]:1/" });
check(
  "IPv6 loopback literal is refused as private (not sent to DNS)",
  r.status === 400 && /本机或内网/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/fetch", { url: "http://[::ffff:127.0.0.1]:1/" });
check(
  "IPv4-mapped loopback (dotted) is refused",
  r.status === 400 && /本机或内网/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/fetch", { url: "http://[::ffff:c0a8:0101]:1/" });
check(
  "IPv4-mapped 192.168.1.1 (hex) is refused",
  r.status === 400 && /本机或内网/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/fetch", { url: "http://198.18.0.1:1/" });
check(
  "a literal fake-ip address is still refused as a reserved private range",
  r.status === 400 && /本机或内网/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/fetch", { url: "http://[2001:db8::1]:1/" });
check(
  "public IPv6 literal passes the address check",
  r.status === 400 && !/本机或内网|解析/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
// ---- 停止生成要真正停掉指令：请求一中止，整棵进程树一起收
if (win) {
  const tick = `${WORK}/tick.txt`;
  const abort = new AbortController();
  const running = fetch(BASE + "/api/work/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workdir,
      command: "1..40 | ForEach-Object { Add-Content -Path tick.txt -Value $_; Start-Sleep -Milliseconds 250 }",
      timeout: 60
    }),
    signal: abort.signal
  }).catch(() => null);
  const { readFileSync } = await import("node:fs");
  const count = () => (existsSync(tick) ? readFileSync(tick, "utf8").trim().split(/\r?\n/).length : 0);
  // 等 PowerShell 起来、写下头几行再中止
  for (let i = 0; i < 60 && count() < 2; i++) await new Promise(r => setTimeout(r, 150));
  abort.abort();
  await running;
  await new Promise(r => setTimeout(r, 1200));
  const after = count();
  await new Promise(r => setTimeout(r, 1500));
  check(
    "aborting the request kills the running command (no more ticks after the abort)",
    after > 0 && count() === after && after < 40,
    `${after} → ${count()}`
  );
}
// ---- 同一文件的并行修改按先后排队：两处 edit 同时到，两处改动都落地，不互相覆盖
writeFileSync(`${WORK}/race.txt`, "alpha\nbeta\n");
const edits = await Promise.all([
  post("/api/work/edit", { workdir, path: "race.txt", old: "alpha", new: "ALPHA" }),
  post("/api/work/edit", { workdir, path: "race.txt", old: "beta", new: "BETA" })
]);
{
  const { readFileSync } = await import("node:fs");
  check(
    "concurrent edits to one file both apply",
    edits.every(e => e.status === 200) && readFileSync(`${WORK}/race.txt`, "utf8") === "ALPHA\nBETA\n",
    `${edits.map(e => e.status).join(",")} ${JSON.stringify(readFileSync(`${WORK}/race.txt`, "utf8"))}`
  );
}
// ---- 沙箱（sandbox: true）：路径不出目录、机密文件不碰、指令先筛、机密环境变量不给指令；不带 sandbox 的请求照旧
writeFileSync(`${WORK}/.env`, "API_KEY=inside-secret\n");
writeFileSync(`${WORK}/plain.txt`, "API_KEY mention in a plain file\n");
mkdirSync(`${WORK}/.git`, { recursive: true });
writeFileSync(`${WORK}/.git/config`, "[core]\n");
r = await post("/api/work/run", {
  workdir,
  sandbox: true,
  command: win ? "Copy-Item plain.txt C:\\Windows\\yan-probe.txt" : "cp plain.txt /etc/yan-probe.txt"
});
check(
  "sandbox: a command mutating outside the workdir is refused with a reason",
  r.status === 400 && /沙箱拒绝.*越出/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/run", {
  workdir,
  sandbox: true,
  command: win ? "Copy-Item plain.txt ../probe.txt" : "cp plain.txt ../probe.txt"
});
check("sandbox: .. is refused for mutations", r.status === 400 && /沙箱拒绝/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
// 查看则不锁目录——给电脑做检查要翻系统目录、注册表与进程，这条路必须通
r = await post("/api/work/run", { workdir, sandbox: true, command: win ? "Get-ChildItem C:\\Windows" : "ls /etc" });
check("sandbox: reading outside the workdir is allowed", r.status === 200, `${r.status} ${r.data?.error || ""}`);
r = await post("/api/work/run", { workdir, sandbox: true, command: "Get-ChildItem .." });
check("sandbox: .. is allowed for reads", r.status === 200, `${r.status} ${r.data?.error || ""}`);
r = await post("/api/work/run", { workdir, sandbox: true, command: "curl https://example.com" });
check("sandbox: direct outbound fetch is refused", r.status === 400 && /外联/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/run", { workdir, sandbox: true, command: win ? "Get-Content .env" : "cat .env" });
check(
  "sandbox: the command channel cannot read .env",
  r.status === 400 && /机密|凭据/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/run", {
  workdir,
  sandbox: true,
  command: win ? "Set-Content .git/config x" : "printf x > .git/config"
});
check(
  "sandbox: the command channel cannot directly write .git internals",
  r.status === 400 && /\.git 内部/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
r = await post("/api/work/run", { workdir, sandbox: false, command: "Get-ChildItem .." });
check("without sandbox the same command runs", r.status === 200, `${r.status} ${r.data?.error}`);
r = await post("/api/work/run", {
  workdir,
  sandbox: false,
  permission: "review",
  command: win ? "Set-Content reviewed.txt ok" : "printf ok > reviewed.txt"
});
check(
  "automatic review allows ordinary work without asking",
  r.status === 200 && existsSync(`${WORK}/reviewed.txt`),
  `${r.status} ${r.data?.error || ""}`
);
r = await post("/api/work/run", {
  workdir,
  sandbox: false,
  permission: "review",
  command: win ? "Set-ExecutionPolicy Unrestricted" : "sudo true"
});
check(
  "automatic review rejects clear host risk",
  r.status === 400 && /审查拒绝/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error || ""}`
);
const outsideNative = OUTSIDE.split("/").join(win ? "\\" : "/"),
  outsideReviewFile = `${outsideNative}${win ? "\\" : "/"}reviewed-outside.txt`;
r = await post("/api/work/run", {
  workdir,
  sandbox: false,
  permission: "review",
  command: win ? `Set-Content "${outsideReviewFile}" x` : `printf x > "${outsideReviewFile}"`
});
check(
  "automatic review lets a command write outside the workdir",
  r.status === 200 && existsSync(outsideReviewFile),
  `${r.status} ${r.data?.error || ""}`
);
rmSync(outsideReviewFile, { force: true });
r = await post("/api/work/write", {
  workdir,
  sandbox: false,
  permission: "review",
  roam: true,
  path: outsideReviewFile,
  content: "x"
});
check(
  "automatic review leaves file-tool reach to the roam setting",
  r.status === 200 && existsSync(outsideReviewFile),
  `${r.status} ${r.data?.error || ""}`
);
rmSync(outsideReviewFile, { force: true });
r = await post("/api/work/read", { workdir, sandbox: false, permission: "review", path: ".env" });
check("automatic review does not guard secret files (that is the sandbox's job)", r.status === 200, `${r.status} ${r.data?.error || ""}`);
if (win) {
  r = await post("/api/work/run", {
    workdir,
    sandbox: true,
    command: 'Write-Output "tok=[$env:YAN_TEST_SECRET_TOKEN] path=[$($env:PATH.Length -gt 0)]"'
  });
  check(
    "sandbox: env vars named like secrets are withheld from the command while PATH stays",
    r.status === 200 && /tok=\[\] path=\[True\]/.test(r.data?.stdout || ""),
    `${r.status} ${JSON.stringify(r.data?.stdout)}`
  );
}
r = await post("/api/work/read", { workdir, sandbox: true, path: ".env" });
check("sandbox: reading .env is refused", r.status === 400 && /机密文件/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/read", { workdir, sandbox: false, path: ".env" });
check("without sandbox .env is readable", r.status === 200, `${r.status} ${r.data?.error}`);
r = await post("/api/work/write", { workdir, sandbox: true, path: ".git/config", content: "x" });
check("sandbox: writing into .git is refused", r.status === 400 && /\.git 内部/.test(r.data?.error || ""), `${r.status} ${r.data?.error}`);
r = await post("/api/work/read", { workdir, sandbox: true, path: ".git/config" });
check("sandbox: reading .git/config is fine", r.status === 200, `${r.status} ${r.data?.error}`);
r = await post("/api/work/search", { workdir, sandbox: true, query: "API_KEY" });
check(
  "sandbox: search skips secret files but still hits plain ones",
  r.status === 200 && r.data.matches.every(m => !/\.env$/.test(m.file)) && r.data.matches.some(m => /plain\.txt$/.test(m.file)),
  `${r.status} ${JSON.stringify(r.data?.matches)}`
);
r = await post("/api/work/read", {
  workdir,
  sandbox: true,
  roam: true,
  path: `${OUTSIDE.split("/").join(win ? "\\" : "/")}${win ? "\\" : "/"}secret.txt`
});
check(
  "sandbox: roam (全盘) is ignored — absolute paths outside are refused",
  r.status === 400 && /越出/.test(r.data?.error || ""),
  `${r.status} ${r.data?.error}`
);
rmSync(ARCHIVE, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
rmSync(OUTSIDE, { recursive: true, force: true });
