// 冲突分支由真实桥接执行；端口上的服务与开浏览器这一动作由夹具代替。
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const exec = promisify(execFile);

test("启动冲突只接用同版桥接，不终止占用端口的进程", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yan-start-"));
  const probe = path.join(temp, "probe.cjs");
  fs.writeFileSync(probe, `require(${JSON.stringify(path.join(root, "server/platform.js"))}).openUrl = url => console.log("OPEN " + url);`);
  let status = 200;
  let body;
  let checked = 0;
  const running = http.createServer((req, res) => {
    if (req.url === "/api/bootstrap") checked++;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  try {
    await new Promise((resolve, reject) => running.once("error", reject).listen(0, "127.0.0.1", resolve));
    const { port } = running.address();
    const address = `http://127.0.0.1:${port}`;
    const env = { ...process.env, YAN_HOME: path.join(temp, ".yan"), YAN_PORT: String(port) };
    const launch = (...args) =>
      exec(process.execPath, ["--require", probe, "server.js", "--open", ...args], { cwd: root, env, timeout: 15000 });
    const older = "0.0.0-startup-test";
    await t.test("同版重复启动仍会打开页面；无浏览器模式不会打开", async () => {
      body = { version, work: {} };
      const normal = await launch();
      assert.match(normal.stdout, /言已在运行/);
      assert.ok(normal.stdout.includes(`OPEN ${address}`));
      const quiet = await launch("--no-open");
      assert.match(quiet.stdout, /言已在运行/);
      assert.doesNotMatch(quiet.stdout, /OPEN /);
    });
    await t.test("异版启动失败，说明两个版本并提示先退出，端口上的服务不动", async () => {
      body = { version: older, work: {} };
      await assert.rejects(launch(), error => {
        assert.equal(error.code, 1);
        assert.doesNotMatch(error.stdout, /OPEN |言已在运行/);
        assert.ok(error.stderr.includes(older));
        assert.ok(error.stderr.includes(version));
        assert.match(error.stderr, /请先退出正在运行的桥接/);
        return true;
      });
      assert.deepEqual(await (await fetch(`${address}/api/bootstrap`)).json(), body);
    });
    await t.test("无法确认版本不接用", async () => {
      body = { work: {} };
      await assert.rejects(launch(), { code: 1, stderr: /版本未知/, stdout: "" });
    });
    await t.test("非成功引导响应只报告端口占用", async () => {
      status = 503;
      body = { version, work: {} };
      await assert.rejects(launch(), { code: 1, stderr: /端口 \d+ 已被占用/, stdout: "" });
    });
    assert.equal(checked, 6);
  } finally {
    running.closeAllConnections();
    await new Promise(resolve => running.close(resolve));
    fs.rmSync(temp, { force: true, recursive: true });
  }
});
