// 系统提示里环境那两句：备了环境的说「另备一套」（Windows），没另备环境的只说系统里现成有哪几件（macOS），
// 两者互斥，一句都不带也算对；一件都没探到时宁可整句不带，别拼出半句。
// 走页面的同一份代码（harness 拼 src），平台靠 setup 塞进 bootstrap.work.platform，在哪台机器上跑都一样
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { load } from "./harness.mjs";

const prompts = {};
const promptDir = new URL("../../prompts/", import.meta.url);
for (const name of readdirSync(promptDir).filter(f => f.endsWith(".js")))
  new Function("window", readFileSync(new URL(name, promptDir), "utf8"))({ YAN_PROMPTS: prompts });

// 拼一遍系统提示，只取「此机……」开头的环境那行
function envLines(status, platform) {
  const f = load([
    "systemPrompt",
    `setup: (status, platform, prompts) => {
      Object.assign(PROMPTS, prompts);
      bootstrap = { work: { archive: "/archive", platform, shell: platform === "darwin" ? "sh" : "PowerShell 7", scratch: ".draft" }, store: { root: "/s" } };
      store.settings.memoryEnabled = true;
      store.memory.items = [];
      envStatus = status;
    }`
  ]);
  f.setup(status, platform, prompts);
  const work = { id: "w", messages: [], workdir: "/work/demo" };
  return f
    .systemPrompt(work, [{ function: { name: "run_command" } }], { role: "main" })
    .split("\n")
    .filter(line => line.startsWith("此机"));
}

test("Windows 备了环境：带环境那句，不带系统工具那句", () => {
  const lines = envLines(
    {
      system: null,
      state: { python: "/env/py/python", packs: ["ffmpeg"], pip: ["sympy"], npm: [] },
      packs: [{ id: "ffmpeg", name: "ffmpeg", hint: "换壳", pip: [], npm: [] }]
    },
    "win32"
  );
  assert.equal(lines.length, 1, `该只有一句，实得：${JSON.stringify(lines)}`);
  assert.match(lines[0], /另备一套开发环境：\/env\/py\/python/);
  assert.match(lines[0], /另装 sympy/);
  assert.match(lines[0], /缺的库直接 pip/);
});

test("Windows 没备环境：两句都不带", () => {
  assert.deepEqual(envLines({ system: null, state: null, packs: [] }, "win32"), []);
});

test("macOS：只说系统里现成有哪几件，不说另备了环境", () => {
  const lines = envLines(
    {
      system: {
        python: { path: "/opt/homebrew/bin/python3", version: "Python 3.13.2" },
        node: { path: "/usr/local/bin/node", version: "v22.11.0" },
        ffmpeg: { path: "/opt/homebrew/bin/ffmpeg", version: "ffmpeg version 7.1" }
      },
      state: null,
      packs: []
    },
    "darwin"
  );
  assert.equal(lines.length, 1, `该只有一句，实得：${JSON.stringify(lines)}`);
  assert.match(lines[0], /没有另备的环境/);
  // 给的是探到的路径，不是名字：PATH 里的未必就是它们
  assert.match(lines[0], /\/opt\/homebrew\/bin\/python3、\/usr\/local\/bin\/node、\/opt\/homebrew\/bin\/ffmpeg/);
  assert.ok(!/另备一套/.test(lines[0]), "macOS 上不该说另备了环境");
  assert.ok(!/pip \/ npm i -g/.test(lines[0]), "macOS 上没有指向环境的 pip");
});

test("macOS 一件都没探到：整句不带，别拼出半句", () => {
  assert.deepEqual(envLines({ system: {}, state: null, packs: [] }, "darwin"), []);
});
