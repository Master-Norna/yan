import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./harness.mjs";

const date = day => `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`;
const group = (id, day) => ({ id, name: id, createdAt: date(day), presetId: "", workdir: "" });
const chat = (id, groupId, day, pinned = false) => ({
  id,
  title: id,
  groupId,
  updatedAt: day ? date(day) : "",
  pinned
});

function setup(groups, conversations) {
  const page = load(["store", "groupListHtml", "groupDetailHtml", "formatDay"]);
  page.store.settings.groups = groups;
  page.store.settings.presets = [];
  page.store.conversations = conversations;
  return page;
}

test("分组总览用同一次汇总排组、报总数和画行，空组与并列保持旧口径", () => {
  const groups = Object.freeze(
      [group("tie-member", 2), group("empty", 9), group("busy", 1), group("tie-empty", 6), group("no-date", 7), group("old", 8)].map(
        Object.freeze
      )
    ),
    conversations = Object.freeze(
      [
        chat("newest", "busy", 10),
        chat("pinned", "busy", 4, true),
        chat("middle", "busy", 5),
        chat("tied", "tie-member", 6),
        chat("blank", "no-date", null),
        chat("dormant", "old", 3),
        chat("orphan", "missing", 20),
        chat("loose", "", 21)
      ].map(Object.freeze)
    ),
    { groupListHtml, formatDay } = setup(groups, conversations),
    html = groupListHtml();
  assert.match(html, /<span class="page-facts">6 组 · 6 段对话<\/span>/);
  const rows = [...html.matchAll(/<button type="button" class="strip dir" data-group-page="([^"]+)">(.*?)<\/button>/g)].map(
    ([, id, row]) => [id, Number(row.match(/<\/strong><\/span><span>(\d+)<\/span>/)[1]), row.match(/<span>([^<>]*)<\/span>$/)[1]]
  );
  assert.deepEqual(rows, [
    ["busy", 3, formatDay(date(10))],
    ["empty", 0, formatDay(date(9))],
    ["no-date", 1, formatDay(date(7))],
    ["tie-member", 1, formatDay(date(6))],
    ["tie-empty", 0, formatDay(date(6))],
    ["old", 1, formatDay(date(3))]
  ]);
});

test("分组总览每回只读每段对话一次；没有组就不扫描", () => {
  const reads = [],
    conversations = new Proxy([chat("a", "one", 1), chat("b", "two", 2), chat("orphan", "missing", 3)], {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.push(key);
        return Reflect.get(target, key, receiver);
      }
    }),
    { store, groupListHtml } = setup([group("one", 1), group("two", 1), group("empty", 1)], conversations);
  groupListHtml();
  assert.deepEqual(reads, ["0", "1", "2"]);
  store.settings.groups = [];
  reads.length = 0;
  const html = groupListHtml();
  assert.match(html, /<span class="page-facts"><\/span>/);
  assert.match(html, /尚无分组/);
  assert.deepEqual(reads, []);
});

test("分组详情仍在本组内先排置顶，同档再按动笔时间排", () => {
  const selected = group("one", 1),
    { groupDetailHtml } = setup(
      [selected, group("two", 1)],
      [
        chat("earlier-pin", "one", 2, true),
        chat("earlier", "one", 7),
        chat("other-pin", "two", 20, true),
        chat("later-pin", "one", 3, true),
        chat("later", "one", 8)
      ]
    );
  const html = groupDetailHtml(selected);
  assert.match(html, /<span class="page-facts">4 段对话<\/span>/);
  assert.deepEqual(
    [...html.matchAll(/data-group-chat="([^"]+)"/g)].map(([, id]) => id),
    ["later-pin", "earlier-pin", "later", "earlier"]
  );
});
