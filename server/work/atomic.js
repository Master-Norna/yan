"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// 先写同目录临时文件，写成后才替换原件；保留原文件权限与目录内链接的落点。
module.exports = async function writeTextAtomic(file, content) {
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
    const handle = await fs.promises.open(temporary, "wx", original?.mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (original) await fs.promises.chmod(temporary, original.mode);
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
};
