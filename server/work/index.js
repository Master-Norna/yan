// 言 · 桥接的执事接口：工作目录、各接口共用的落点与沙箱筛查、指令与后台指令、目录选择对话框；
// 文件读写见 files.js，列与搜见 find.js，意与指纹见 intent.js，卷宗目录见 archive.js
// 由 server.js 装配：require("./server/work/index.js")({ archiveHome, workHome, toolEnv })
"use strict";
const { sendJson, readJson, jsonRoute, requestSignal, stamp, errorText } = require("../http.js");
const fs = require("node:fs");
const path = require("node:path");
const sandbox = require("../sandbox.js");
const paths = require("./paths.js");
const { SCRATCH_DIR, WORK_SKIP, describeFsError, clampNumber, pathIsInside, resolveTarget, assertReachable, relPath } = paths;
const { pick } = require("./picker.js");
const createShell = require("./shell.js");
const createLocks = require("./locks.js");
const createArchive = require("./archive.js");
const createFiles = require("./files.js");
const createFind = require("./find.js");
const createIntent = require("./intent.js");

module.exports = function createWork({ archiveHome, workHome, storeRoot = () => "", toolEnv, playable }) {
  // ---- 执事模式：给模型一个工作目录，能跑指令、读写文件 ----
  // 只做四件事：跑一条指令、写文件、读文件、列目录。路径默认限定在工作目录之内（页面放开后绝对路径可指向目录之外）；指令在工作目录里用本机 shell 执行。
  // 不做进程隔离——这是用户自己的机器，页面上每条指令都看得见，并按问而后行 / 审而后行 / 径行三档处理。
  // 请求带 sandbox: true 时再加一道沙箱（server/sandbox.js）：路径不出目录、机密文件不碰、指令先筛、环境变量去掉机密——在桥接这头守，页面与模型都绕不过
  // 执事没给目录时的退路：存储根里的 工作/（workHome()，见 server/store.js），与卷宗、对话同在一处
  // 卷宗：对话没绑工作目录时，模型的工具就落在这里——写出的表格、文档都收在卷宗里；页面上的卷宗即这个目录的视图。
  // 位置在存储根里（archiveHome()，见 server/store.js），随每个请求的 root 传来的也认。
  // 各接口出错时回给页面的那句话：截到 300 字
  // 报错原样交给模型（卡片上只露头一句）：放得下一段线索——路径不对时同名的在哪、old 对不上时文件里最像的那一段
  const failed = error => errorText(error, 4000);
  const resolveWorkdir = raw => paths.resolveWorkdir(raw, workHome);
  const {
      WORK_SHELL,
      runShell,
      runForeground,
      releaseForeground,
      startBackground,
      backgroundReport,
      discardBackground,
      checkBackground,
      watchBackground,
      backgroundRunning
    } = createShell({
      toolEnv
    }),
    { lockFile } = createLocks();
  // 沙箱分两档：问而后行（或没说档位的请求）用严的；审而后行、径行用宽的——文件工具在宽档里不设防，指令只守系统本身（见 server/sandbox.js）
  const looseTier = body => body.permission === "review" || body.permission === "auto";
  const strictBox = body => body.sandbox === true && !looseTier(body);
  // 各文件接口的落点：严的沙箱里不认「全盘」，目录内的机密文件、.git 内部（写）也拦下；宽档与没开沙箱时，可及范围只由「全盘 / 目录内」定
  async function targetOf(workdir, body, { write = false } = {}) {
    const boxed = strictBox(body),
      target = resolveTarget(workdir, body.path, body.roam === true && !boxed);
    await assertReachable(workdir, target);
    // 存储根里的配置与登录文件：不论档位与沙箱（见 server/sandbox.js 的 screenStorePath）
    const guarded = sandbox.screenStorePath(target, storeRoot());
    if (guarded) throw Error(guarded);
    if (boxed) {
      const why = sandbox.screenPath(relPath(workdir, target), { write });
      if (why) throw Error(why);
    }
    return target;
  }
  // 路径不对时给一句线索，模型下一回就能找对，不必先列目录：同名的在目录里别处（多半记错了上一层），
  // 不然列出还在的最近一层目录里有什么。沙箱里不借它报出机密文件的名字
  const HINT_SCAN = 4000,
    HINT_LIST = 15;
  async function missingHint(workdir, target, boxed) {
    const name = path.basename(target).toLowerCase(),
      visible = full => !(boxed && sandbox.screenPath(relPath(workdir, full))),
      same = [];
    let seen = 0;
    const walk = async dir => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++seen > HINT_SCAN || same.length >= 3) return;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase() === name && visible(full)) same.push(shownPath(workdir, full));
        if (entry.isDirectory() && !entry.isSymbolicLink() && !WORK_SKIP.has(entry.name)) await walk(full);
      }
    };
    if (pathIsInside(workdir, target)) await walk(workdir);
    if (same.length) return `；同名的在：${same.join("、")}`;
    let parent = path.dirname(target);
    while (!(await fs.promises.stat(parent).catch(() => null))?.isDirectory() && path.dirname(parent) !== parent)
      parent = path.dirname(parent);
    const entries = (await fs.promises.readdir(parent, { withFileTypes: true }).catch(() => []))
      .filter(entry => !WORK_SKIP.has(entry.name) && visible(path.join(parent, entry.name)))
      .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    if (!entries.length) return "";
    return `；${shownPath(workdir, parent) || "."}/ 下有：${entries.slice(0, HINT_LIST).join("、")}${entries.length > HINT_LIST ? ` 等 ${entries.length} 项` : ""}`;
  }
  // 给页面与模型看的路径：目录之内给相对路径，目录之外给完整路径
  function shownPath(workdir, file) {
    return pathIsInside(workdir, file) ? relPath(workdir, file) : file;
  }
  // 系统的选择框：默认选目录；files 选文件（multiple 可多选）。给真路径，取消给空串
  const handleWorkPick = jsonRoute(async body => {
    const result = await pick({ files: !!body.files, multiple: !!body.multiple, current: String(body.current || "").trim() });
    if ("error" in result) throw Error(result.error);
    return { paths: result.paths };
  }, failed);
  const handleWorkPrepare = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    const existing = await fs.promises.stat(workdir).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`路径已被文件占用，不是目录：${workdir}`);
    if (!existing)
      await fs.promises.mkdir(workdir, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, workdir));
      });
    // 目录记忆原名账本：旧目录里的 .yan/账本.md 改名为 记忆.md，往后只认这一个名字（见 src/15-tools/21-files.js 的 LEDGER_PATH）。
    // 新名已有就不动——rename 在 Windows 上会盖掉目标
    const yan = path.join(workdir, ".yan"),
      renamed = path.join(yan, "记忆.md");
    if (!fs.existsSync(renamed)) await fs.promises.rename(path.join(yan, "账本.md"), renamed).catch(() => {});
    const entries = await fs.promises.readdir(workdir).catch(() => []);
    return {
      workdir,
      platform: process.platform,
      shell: WORK_SHELL,
      home: workHome(),
      entries: entries.length,
      created: !existing
    };
  }, failed);
  async function handleWorkRun(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        command = String(body.command || "").trim();
      if (!command) throw Error("指令不能为空");
      if (!fs.existsSync(workdir)) throw Error("工作目录已不存在，请重新发送以重建，或另起对话");
      const guarded = sandbox.screenStoreCommand(command, storeRoot(), workdir);
      if (guarded) throw Error(guarded);
      const boxed = body.sandbox === true,
        // 审而后行里规则拦下、审查模型照用户的原话准了的这一条：不再过宽的沙箱与审查规则（存储根那一道、调桥接与藏字仍守）
        reviewed = body.permission === "review" && body.reviewed === true,
        // macOS 上严档沙箱再加一道 seatbelt：静态筛查管不住脚本里现拼的写盘路径（见 server/work/shell.js）
        seatbelt = strictBox(body);
      const unreviewable = reviewed && sandbox.screenUnreviewable(command);
      if (unreviewable) throw Error(`审查拒绝：${unreviewable}`);
      if (boxed && !reviewed) {
        const why = looseTier(body) ? sandbox.screenLoose(command) : sandbox.screenCommand(command, workdir);
        if (why) throw Error(why);
      }
      if (body.permission === "review" && !reviewed) {
        const why = sandbox.screenAutoReview(command);
        if (why) throw Error(why);
      }
      if (body.background === true) {
        if (res.destroyed) return;
        console.log(`${stamp()} $ （后台）${command.slice(0, 120)}`);
        const job = startBackground(command, workdir, boxed, seatbelt);
        let delivered = false;
        const disconnected = () => {
          if (!delivered) discardBackground(job);
        };
        res.once("close", disconnected);
        res.once("finish", () => {
          delivered = true;
          res.removeListener("close", disconnected);
        });
        const report = await backgroundReport(job, 5000);
        if (res.destroyed) return disconnected();
        return sendJson(res, 200, report);
      }
      console.log(`${stamp()} $ ${command.slice(0, 120)}`);
      // 页面那头停止生成会中止这个请求：响应还没写就断开，即是中止，把指令连同它起的子进程一并杀掉。指令不拿目录锁，见 locks.js
      const signal = requestSignal(res);
      // 模型的 run_command 带 ticket：到时不掐，转入后台接着跑（见 runForeground）。前台最多等十分钟——
      // 指令能跑多久不受它限，只是模型不该被一条指令攥住十分钟以上（单位给错，60000 当毫秒，就是十几个小时）
      if (body.ticket) {
        const waitMs = clampNumber(Number(body.timeout) * 1000, 120000, 1000, 600000),
          { job, report } = await runForeground(command, workdir, boxed, waitMs, signal, String(body.ticket), seatbelt);
        if (!report) return;
        // 转入了后台、编号却没能交到页面：无人能再凭编号叫停它，收掉
        if (res.destroyed) return report.running && discardBackground(job);
        return sendJson(res, 200, report);
      }
      // 探针、测试这类自己跑的：到时即掐。封顶在 2³¹−1 毫秒（约 24 天）只因 setTimeout 超过它会溢出、当作 1 毫秒
      const timeoutMs = clampNumber(Number(body.timeout) * 1000, 120000, 1000, 2147483647);
      // 守的钩子跑测试：将要做的那一步交给它（见 src/19-intent/10-store.js 的 keepHook）
      const hook = body.hook && typeof body.hook === "object" ? body.hook : null,
        env = hook ? { YAN_TOOL: String(hook.tool || ""), YAN_TARGET: String(hook.target || "") } : {};
      const started = Date.now(),
        result = await runShell(command, workdir, timeoutMs, signal, { boxed, env, seatbelt });
      if (result.aborted) console.log(`${stamp()}   已中止：${command.slice(0, 80)}`);
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, { ...result, durationMs: Date.now() - started });
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  // 页面说有话要递（用户补言、主模型递话给帮手）：那条前台指令转入后台，结果当即交回
  const handleWorkRelease = jsonRoute(async body => releaseForeground(body.ticket), failed);
  const handleWorkCheck = jsonRoute(
    async body =>
      await checkBackground(body.id, body.stop === true, clampNumber(Number(body.wait) * 1000, 0, 0, 120000), String(body.key || "")),
    failed
  );
  // 等一条后台指令结束：请求一直挂着（走总线不占连接），结束了才回；页面停了、关了，请求随之作罢
  async function handleWorkWatch(req, res) {
    try {
      const body = await readJson(req),
        result = await watchBackground(body.id, body.key, requestSignal(res));
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  // 发指令前先问一声会不会拦。问而后行（没说档位的也算）问严的沙箱——会拦的照样请示，用户批了这一条就出沙箱跑；
  // 审而后行问宽的沙箱与审查规则——会拦的交专司里的审查模型再判（见 src/15-tools/03-review.js），准了即带 reviewed 来跑；
  // 审查也不放行的（调桥接、藏字）标 hard，不必去问
  const handleWorkScreen = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      command = String(body.command || "");
    if (body.permission === "review")
      return {
        why: (body.sandbox === true && sandbox.screenLoose(command)) || sandbox.screenAutoReview(command),
        hard: !!sandbox.screenUnreviewable(command)
      };
    return { why: sandbox.screenCommand(command, workdir) };
  }, failed);
  // 文件、列与搜、意各一段，共用上面的落点、沙箱筛查与报错写法
  const work = { failed, resolveWorkdir, targetOf, missingHint, shownPath, strictBox, lockFile, storeRoot };

  return {
    workHome,
    SCRATCH_DIR,
    WORK_SHELL,
    backgroundRunning,
    // 都碰本机磁盘或本机进程：只受理本站页面与 VS Code Webview（见 server.js 的接口表）
    routes: {
      "POST /api/work/prepare": handleWorkPrepare,
      "POST /api/work/pick": handleWorkPick,
      "POST /api/work/run": handleWorkRun,
      "POST /api/work/screen": handleWorkScreen,
      "POST /api/work/release": handleWorkRelease,
      "POST /api/work/check": handleWorkCheck,
      "POST /api/work/watch": handleWorkWatch,
      ...createFiles(work),
      ...createFind(work),
      ...createIntent(work),
      ...createArchive({ archiveHome, playable, lockFile })
    }
  };
};
