import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import createTimers from "../../server/timers.js";

test("structurally corrupt timer book never crashes startup or overwrites the original", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-timer-book-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "约.json");
  const valid = { id: "t1", to: "chat", step: "", note: "", created: Date.now(), due: Date.now() + 60000 };
  for (const bad of [null, { ...valid, due: "invalid" }, { ...valid, every: -1 }]) {
    const original = JSON.stringify({ seq: 1, timers: [bad] });
    fs.writeFileSync(file, original);
    const { routes } = createTimers({ home: () => dir, known: () => true, route: handle => handle });
    assert.throws(() => routes["POST /api/timer/list"]({}), /约簿损坏/);
    assert.throws(() => routes["POST /api/timer/set"]({ to: "chat", due: Date.now() }), /约簿损坏/);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    fs.writeFileSync(file, JSON.stringify({ seq: 1, timers: [] }));
    assert.deepEqual(routes["POST /api/timer/list"]({}), { timers: [] });
  }
});
