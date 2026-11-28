"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// 先写同目录临时文件，写成后才替换原件；保留原文件权限与目录内链接的落点。
// verify 在替换前最后核一次原件（人的保存带着读时的指纹）：临时文件已备好、原件还没换，
// 这中间别处写入就当场作废，不是等下一次读才知道。它只收窄窗口，不与任意外部程序做原子条件替换。
module.exports = async function writeTextAtomic(file, content, signal, verify) {
  signal?.throwIfAborted();
  const link = await fs.promises.lstat(file).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  const target = link?.isSymbolicLink() ? await fs.promises.realpath(file) : file;
  const original = await fs.promises.stat(target).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    signal?.throwIfAborted();
    const handle = await fs.promises.open(temporary, "wx", original?.mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (original) await fs.promises.chmod(temporary, original.mode);
    // 停止要盖住写临时文件与刷盘的等待，原件在最后一步才替换。
    signal?.throwIfAborted();
    if (verify && !(await verify())) throw Object.assign(Error("原件在保存途中被别处改动"), { code: "YAN_STALE" });
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
};
