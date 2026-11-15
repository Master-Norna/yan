// 待归组自带默认目录时，欢迎页与发送时同一口径（14-chat-engine/10-send.js 会取 pendingGroup().workdir）：
// workMode 说的「执事 / 对谈」要跟落点一致，推荐语与副标题才不会被带错
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("待归组带默认目录算执事；组没目录或待绑目录优先时照旧", () => {
  const f = load(["store", "workMode"]);
  f.store.conversations = [];
  f.store.settings.groups = [{ id: "g1", name: "组", workdir: "E:\\项目" }];
  f.store.settings.pendingGroupId = "g1";
  f.store.settings.pendingWorkdir = "";
  assert.equal(f.workMode(), true, "组带默认目录，发出去是执事");
  f.store.settings.groups = [{ id: "g1", name: "组", workdir: "" }];
  assert.equal(f.workMode(), false, "组没有目录，仍是言");
  f.store.settings.pendingWorkdir = "E:\\别处";
  assert.equal(f.workMode(), true, "待绑的目录优先，与发送时一致");
});
