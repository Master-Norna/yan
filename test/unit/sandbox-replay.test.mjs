// 用独立的临时对话目录跑回放脚本：当前路径、历史版本、旁注与冷行迹中的真实指令都要算进去。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

test("沙箱回放覆盖历史版本、旁注及其中另存的帮手行迹", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-replay-")),
    talks = path.join(root, "对话"),
    command = text => ({ name: "run_command", arguments: JSON.stringify({ command: text }) }),
    id = "replay-fixture",
    code = crypto.createHash("sha1").update(id).digest("hex").slice(0, 10),
    trails = path.join(talks, "行迹", code);
  try {
    fs.mkdirSync(trails, { recursive: true });
    fs.writeFileSync(path.join(trails, "piece.json"), JSON.stringify({ subs: { helper: { steps: [command("echo cold")] } } }));
    const conversation = {
      id,
      title: "回放夹具",
      messages: [{ steps: [command("echo main")] }],
      forks: [{ messages: [{ steps: [command("echo fork"), { sub: { id: "helper" } }], cold: { key: "piece" } }] }],
      threads: [{ messages: [{ steps: [command("echo side")] }] }]
    };
    fs.writeFileSync(path.join(talks, "fixture.json"), JSON.stringify({ conversation }));
    const output = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../sandbox-replay.mjs")], {
      env: { ...process.env, YAN_HOME: root },
      encoding: "utf8"
    });
    assert.match(output, /接回冷行迹 1 答/);
    assert.match(output, /共 4 条指令（1 段对话）：放行 4、拦下 0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
