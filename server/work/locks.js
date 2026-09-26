// 言 · 桥接 · 执事的写锁
"use strict";

// ---- 并行帮手共用一个目录时的写锁：同一文件的写入 / 修改按先后排队（edit 的读—改—写在锁内，不会互相覆盖），不同文件照常并行；
// run_command 可能改任意文件，拿的是整个工作目录的独占锁——指令跑着的时候文件写入等它，文件写着的时候指令等它们
class RwLock {
  constructor() {
    this.readers = 0;
    this.writer = false;
    this.queue = [];
  }
  acquire(exclusive) {
    return new Promise(resolve => {
      this.queue.push({ exclusive, resolve });
      this.pump();
    });
  }
  pump() {
    while (this.queue.length) {
      const head = this.queue[0];
      if (this.writer || (head.exclusive && this.readers)) break;
      this.queue.shift();
      if (head.exclusive) this.writer = true;
      else this.readers += 1;
      let released = false;
      head.resolve(() => {
        if (released) return;
        released = true;
        if (head.exclusive) this.writer = false;
        else this.readers -= 1;
        this.pump();
      });
    }
  }
}
module.exports = function createLocks() {
  const dirLocks = new Map(),
    pathLocks = new Map();
  function lockKey(file) {
    return process.platform === "win32" ? file.toLowerCase() : file;
  }
  function lockOf(map, key) {
    let lock = map.get(key);
    if (!lock) {
      lock = new RwLock();
      map.set(key, lock);
    }
    return lock;
  }
  // 写一个文件：目录共享锁 + 该路径独占锁；返回一次性的释放函数
  async function lockFile(workdir, file) {
    const releaseDir = await lockOf(dirLocks, lockKey(workdir)).acquire(false);
    const key = lockKey(file),
      releasePath = await lockOf(pathLocks, key).acquire(true);
    return () => {
      releasePath();
      releaseDir();
      const lock = pathLocks.get(key);
      if (lock && !lock.writer && !lock.readers && !lock.queue.length) pathLocks.delete(key);
    };
  }
  function lockWorkdir(workdir) {
    return lockOf(dirLocks, lockKey(workdir)).acquire(true);
  }
  return { lockFile, lockWorkdir };
};
