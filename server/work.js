// 言 · 桥接的执事接口：工作目录、指令执行、文件读写与检索、目录选择对话框；卷宗目录的列、收、取、删
// 由 server.js 装配：require("./server/work.js")({ sendJson, readJson, decodeEntities, fetchPublicResponse, readLimitedBytes })
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const vm = require("node:vm");
const sandbox = require("./sandbox.js");

module.exports = function createWork({ sendJson, readJson, decodeEntities, fetchPublicResponse, readLimitedBytes, archiveHome }) {
  // ---- 执事模式：给模型一个工作目录，能跑指令、读写文件 ----
  // 只做四件事：跑一条指令、写文件、读文件、列目录。路径默认限定在工作目录之内（页面放开后绝对路径可指向目录之外）；指令在工作目录里用本机 shell 执行。
  // 不做进程隔离——这是用户自己的机器，页面上每条指令都看得见，并按问而后行 / 审而后行 / 径行三档处理。
  // 请求带 sandbox: true 时再加一道沙箱（server/sandbox.js）：路径不出目录、机密文件不碰、指令先筛、环境变量去掉机密——在桥接这头守，页面与模型都绕不过
  const WORK_HOME = path.join(os.homedir(), "言", "工作");
  // 卷宗：对话没绑工作目录时，模型的工具就落在这里——写出的表格、文档都收在卷宗里；页面上的卷宗即这个目录的视图。
  // 位置在存储根里（archiveHome()，见 server/store.js），随每个请求的 root 传来的也认。
  // 脚本与中间文件放在卷宗里的隐藏目录 .草稿/<对话id>/，页面不列它
  const SCRATCH_DIR = ".草稿";
  const WORK_SHELL = process.platform === "win32" ? "PowerShell" : "sh";
  const WORK_OUTPUT_LIMIT = 20000,
    WORK_FILE_LIMIT = 200000,
    WORK_LIST_LIMIT = 300;
  function expandHome(value) {
    const text = String(value || "").trim();
    return text.startsWith("~") ? path.join(os.homedir(), text.slice(1)) : text;
  }
  // 工作目录必须是完整限定的路径：path.isAbsolute 在 Windows 上会把「\foo」「/foo」也算作绝对，实际却跟着桥接进程所在的盘符走；
  // 「C:foo」则是相对当前目录。只认 resolve 前后一致的写法（盘符 / UNC / POSIX 根），其余一律拒绝
  function resolveWorkdir(raw) {
    const expanded = expandHome(raw) || WORK_HOME;
    const dir = path.resolve(expanded),
      plain = path.normalize(expanded).replace(/(?<=.)[\\/]+$/, "");
    const root = path.parse(dir).root;
    if (dir === root) throw Error("不可将整个磁盘作为工作目录");
    if (!path.isAbsolute(expanded) || plain.toLowerCase() !== dir.toLowerCase())
      throw Error(
        `工作目录必须是完整的绝对路径${process.platform === "win32" ? "（须带盘符，如 D:\\项目）" : ""}：${String(raw || "").trim()}`
      );
    return dir;
  }
  // 把 Node 的文件系统错误译成可读的说明，页面与模型都不必面对 ENOENT 之类的代号
  function describeFsError(error, target = "") {
    const code = error?.code,
      where = target ? `：${target}` : "";
    if (code === "ENOENT") return `路径不存在${where}`;
    if (code === "EEXIST" || code === "ENOTDIR") return `路径已被文件占用，不是目录${where}`;
    if (code === "EACCES" || code === "EPERM") return `没有访问权限${where}`;
    if (code === "EISDIR") return `目标是目录，不是文件${where}`;
    if (code === "EBUSY") return `文件正被占用${where}`;
    return String(error?.message || error).slice(0, 200);
  }
  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
  }
  function pathIsInside(root, target) {
    const relative = path.relative(root, target);
    return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }
  function resolveInside(workdir, raw) {
    const target = path.resolve(workdir, String(raw || "."));
    if (!pathIsInside(workdir, target)) throw Error(`路径越出了工作目录：${raw}`);
    return target;
  }
  // 文件工具的落点。默认限定在工作目录之内；用户在设置里放开（roam）后，完整限定的绝对路径（盘符 / UNC / POSIX 根）可以指向目录之外——
  // 系统级的配置、别处的资料本就该读得到；相对路径仍相对工作目录。目录之外的路径不再查链接（那是为守住目录边界设的），也不能是整个磁盘
  function resolveTarget(workdir, raw, roam) {
    const text = String(raw || ".").trim();
    if (!roam || !path.isAbsolute(text)) return resolveInside(workdir, text);
    const target = path.resolve(text);
    if (pathIsInside(workdir, target)) return target;
    if (
      path
        .normalize(text)
        .replace(/(?<=.)[\/]+$/, "")
        .toLowerCase() !== target.toLowerCase()
    )
      throw Error(`目录之外的路径必须是完整的绝对路径${process.platform === "win32" ? "（须带盘符）" : ""}：${raw}`);
    if (target === path.parse(target).root) throw Error("不可把整个磁盘当作目标");
    return target;
  }
  async function assertReachable(workdir, target) {
    if (pathIsInside(workdir, target)) await assertNoEscapingLink(workdir, target);
  }
  // 沙箱分两档：问而后行（或没说档位的请求）用严的；审而后行、径行用宽的——文件工具在宽档里不设防，指令只守系统本身（见 server/sandbox.js）
  const looseTier = body => body.permission === "review" || body.permission === "auto";
  const strictBox = body => body.sandbox === true && !looseTier(body);
  // 各文件接口的落点：严的沙箱里不认「全盘」，目录内的机密文件、.git 内部（写）也拦下；宽档与没开沙箱时，可及范围只由「全盘 / 目录内」定
  async function targetOf(workdir, body, { write = false } = {}) {
    const boxed = strictBox(body),
      target = resolveTarget(workdir, body.path, body.roam === true && !boxed);
    await assertReachable(workdir, target);
    if (boxed) {
      const why = sandbox.screenPath(relPath(workdir, target), { write });
      if (why) throw Error(why);
    }
    return target;
  }
  // 给页面与模型看的路径：目录之内给相对路径，目录之外给完整路径
  function shownPath(workdir, file) {
    return pathIsInside(workdir, file) ? relPath(workdir, file) : file;
  }
  // 逐层检查符号链接与 Windows junction；允许链接仍指向工作目录内部，拒绝借链接跳到目录外。
  async function assertNoEscapingLink(workdir, target) {
    const realRoot = await fs.promises.realpath(workdir).catch(error => {
      throw Error(describeFsError(error, workdir));
    });
    const relative = path.relative(workdir, target);
    let current = workdir;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fs.promises.lstat(current).catch(error => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw Error(describeFsError(error, current));
      });
      if (!stat) break;
      if (!stat.isSymbolicLink()) continue;
      const real = await fs.promises.realpath(current).catch(() => {
        throw Error(`路径包含失效的链接：${relPath(workdir, current)}`);
      });
      if (!pathIsInside(realRoot, real)) throw Error(`路径经过链接越出了工作目录：${relPath(workdir, current)}`);
    }
  }
  function relPath(workdir, file) {
    return path.relative(workdir, file).split(path.sep).join("/");
  }
  function tail(text, limit) {
    return text.length > limit ? `…（前面 ${text.length - limit} 字已省略）\n${text.slice(-limit)}` : text;
  }
  // Windows 的文件夹选择：Windows PowerShell 5.1 的 FolderBrowserDialog 还是 XP 年代那棵树；改走 IFileOpenDialog（FOS_PICKFOLDERS），
  // 就是资源管理器风格、带地址栏与搜索的现代对话框。编译失败（缺少编译器等）时退回旧对话框
  const FOLDER_PICKER_CS = String.raw`using System;
  using System.Runtime.InteropServices;
  public static class YanFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog {
      [PreserveSig] uint Show(IntPtr parent);
      void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
      void SetFileTypeIndex(uint iFileType);
      void GetFileTypeIndex(out uint piFileType);
      void Advise(IntPtr pfde, out uint pdwCookie);
      void Unadvise(uint dwCookie);
      void SetOptions(uint fos);
      void GetOptions(out uint pfos);
      void SetDefaultFolder(IShellItem psi);
      void SetFolder(IShellItem psi);
      void GetFolder(out IShellItem ppsi);
      void GetCurrentSelection(out IShellItem ppsi);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
      void GetResult(out IShellItem ppsi);
      void AddPlace(IShellItem psi, int alignment);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
      void Close(int hr);
      void SetClientGuid(ref Guid guid);
      void ClearClientData();
      void SetFilter(IntPtr pFilter);
      void GetResults(out IntPtr ppenum);
      void GetSelectedItems(out IntPtr ppsai);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IShellItem psi, uint hint, out int piOrder);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName([MarshalAs(UnmanagedType.LPWStr)] string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public static string Pick(string title, string okLabel, string initial) {
      var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
      uint options; dialog.GetOptions(out options);
      dialog.SetOptions(options | 0x20 | 0x40 | 0x8); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR
      dialog.SetTitle(title); dialog.SetOkButtonLabel(okLabel);
      if (!string.IsNullOrEmpty(initial)) {
        try { var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"); IShellItem start; SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out start); dialog.SetFolder(start); } catch {}
      }
      uint hr = dialog.Show(GetForegroundWindow());
      if (hr == 0x800704C7) return ""; // 用户取消
      if (hr != 0) throw new Exception("IFileOpenDialog.Show 0x" + hr.ToString("X8"));
      IShellItem result; dialog.GetResult(out result);
      string path; result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
      return path;
    }
  }`;
  function folderPickerScript(current) {
    const initial = current.replace(/'/g, "''");
    return `[Console]::OutputEncoding=[Text.Encoding]::UTF8
  $initial = '${initial}'
  $picked = $null
  try {
    Add-Type -TypeDefinition @'
  ${FOLDER_PICKER_CS}
'@ -ErrorAction Stop
    $picked = [YanFolderPicker]::Pick('选择工作目录', '以此为案', $initial)
  } catch {
    Add-Type -AssemblyName System.Windows.Forms
    $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '选择工作目录'; $d.ShowNewFolderButton = $true
    if ($initial) { $d.SelectedPath = $initial }
    $w = New-Object System.Windows.Forms.Form; $w.TopMost = $true
    if ($d.ShowDialog($w) -eq 'OK') { $picked = $d.SelectedPath }
  }
  if ($picked) { Write-Output $picked }`;
  }
  // 用系统自带的文件夹对话框选目录：Windows 走上面的脚本，macOS 走 osascript，Linux 尽量用 zenity
  function pickFolder(current) {
    return new Promise(resolve => {
      let cmd, args;
      if (process.platform === "win32") {
        cmd = "powershell.exe";
        args = [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodePowerShell(folderPickerScript(current))
        ];
      } else if (process.platform === "darwin") {
        cmd = "osascript";
        args = [
          "-e",
          `POSIX path of (choose folder with prompt "选择工作目录"${current ? ` default location POSIX file ${JSON.stringify(current)}` : ""})`
        ];
      } else {
        cmd = "zenity";
        args = [
          "--file-selection",
          "--directory",
          "--title=选择工作目录",
          ...(current ? [`--filename=${current.replace(/\/?$/, "/")}`] : [])
        ];
      }
      const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", chunk => {
        out += chunk.toString("utf8");
      });
      const timer = setTimeout(() => child.kill(), 300000);
      child.on("error", error => {
        clearTimeout(timer);
        resolve({ error: `无法打开文件夹对话框（${error.code === "ENOENT" ? `缺少 ${cmd}` : error.message}），请直接填写路径` });
      });
      child.on("close", code => {
        clearTimeout(timer);
        const picked = out.trim().replace(/\/$/, "");
        if (code && !picked) resolve({ error: "文件夹对话框未能打开，请直接填写路径" });
        else resolve({ path: picked });
      });
    });
  }
  async function handleWorkPick(req, res) {
    try {
      const body = await readJson(req),
        result = await pickFolder(String(body.current || "").trim());
      if (result.error) throw Error(result.error);
      sendJson(res, 200, { path: result.path });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  async function handleWorkPrepare(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir);
      const existing = await fs.promises.stat(workdir).catch(() => null);
      if (existing && !existing.isDirectory()) throw Error(`路径已被文件占用，不是目录：${workdir}`);
      if (!existing)
        await fs.promises.mkdir(workdir, { recursive: true }).catch(error => {
          throw Error(describeFsError(error, workdir));
        });
      const entries = await fs.promises.readdir(workdir).catch(() => []);
      sendJson(res, 200, {
        workdir,
        platform: process.platform,
        shell: WORK_SHELL,
        home: WORK_HOME,
        entries: entries.length,
        created: !existing
      });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // PowerShell 脚本一律走 -EncodedCommand（UTF-16LE base64）：引号、换行、$ 符号都不经过命令行解析
  function encodePowerShell(script) {
    return Buffer.from(script, "utf16le").toString("base64");
  }
  // stderr 被重定向时，PowerShell 会把错误记录序列化成 CLIXML（#< CLIXML <Objs>…）；还原成纯文字，模型与步骤卡看到的都是可读的报错
  function decodeClixml(text) {
    if (!text.includes("#< CLIXML") && !text.includes('<S S="Error">')) return text;
    const unescape = value => decodeEntities(value).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const errorsOf = block => [...block.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(match => unescape(match[1])).join("");
    return text
      .replace(/#< CLIXML\r?\n?<Objs[\s\S]*?<\/Objs>/g, errorsOf)
      .replace(/<Obj S="progress"[\s\S]*?<\/Obj>/g, "")
      .replace(/<S S="Error">([\s\S]*?)<\/S>/g, (_, body) => unescape(body))
      .replace(/#< CLIXML\r?\n?|<\/?Objs[^>]*>/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
  }
  // 文本文件的编码：UTF-8（可带 BOM）为常；Windows PowerShell 5.1 的 > 与 Out-File 写出的是带 BOM 的 UTF-16LE，老的中文文件多是 GBK。
  // 认得出的都解成文字，真是二进制（没有 BOM 却有 NUL）才回 null。UTF-8 里夹着零星几个坏字节的仍按 UTF-8 读，不整篇改按 GBK 读成乱码
  function decodeText(buffer) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
      return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      const body = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
      return { text: body.swap16().toString("utf16le"), encoding: "utf-16be" };
    }
    if (buffer.subarray(0, 4096).includes(0)) return null;
    const text = buffer.toString("utf8"),
      bad = (text.match(/�/g) || []).length;
    if (!bad || bad < text.length / 100) return { text, encoding: "utf-8" };
    return { text: new TextDecoder("gb18030").decode(buffer), encoding: "gbk" };
  }
  // 按原来的编码写回；GBK 编不回去（Node 只会编 UTF-8 / UTF-16），给 null，由调用者拒绝
  function encodeText(text, encoding) {
    if (encoding === "utf-8") return Buffer.from(text, "utf8");
    if (encoding === "utf-8-bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
    if (encoding === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    if (encoding === "utf-16be") return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
    return null;
  }
  // 行数按惯例：末尾的换行不算多一行（"a\nb\n" 是 2 行），空文件 0 行
  function countLines(text) {
    const value = String(text || "");
    if (!value) return 0;
    return value.split(/\r?\n/).length - (/\r?\n$/.test(value) ? 1 : 0);
  }
  // 杀整棵进程树：PowerShell 起的子进程（node、python、构建脚本）不能只杀 shell 本身，否则用户点了停止，脚本还在后台改文件
  function killTree(child) {
    if (!child.pid || child.exitCode !== null || child.signalCode) return;
    if (process.platform !== "win32") return child.kill("SIGKILL");
    // taskkill 能把孙进程一起收掉，但受限环境里可能被系统拒绝；那时至少要终止直属 shell，不能让指令继续写文件。
    const killShell = () => {
      if (child.exitCode !== null || child.signalCode) return;
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" }),
      fallback = setTimeout(killShell, 750);
    killer.once("error", killShell);
    killer.once("close", code => {
      clearTimeout(fallback);
      if (code) killShell();
    });
  }
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
  // 起一个 shell 跑指令：PowerShell 默认按系统代码页输出，中文会成乱码；先把输入输出都切到 UTF-8。
  // 原生程序的退出码在 $LASTEXITCODE；cmdlet 出错不设它，靠 $? 兜底，让模型能从退出码看出失败
  function spawnShell(command, cwd, { boxed = false } = {}) {
    const win = process.platform === "win32";
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'
  ${command}
  $ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $ok) { exit 1 }`;
    const args = win
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)]
      : ["-c", command];
    const child = spawn(win ? "powershell.exe" : "/bin/sh", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...(boxed ? sandbox.sandboxEnv(process.env) : process.env),
        TERM: "dumb",
        NO_COLOR: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        CI: "1"
      }
    });
    // 按字交出输出：一块一块各自解码，汉字恰好跨在两块之间就被劈成两个 �
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    runningShells.add(child);
    child.on("close", () => runningShells.delete(child));
    child.on("error", () => runningShells.delete(child));
    return child;
  }
  // 正在跑的 shell（前台与后台）：桥接退出时整棵收掉，不留在后台改文件、占端口
  const runningShells = new Set();
  function runShell(command, cwd, timeoutMs, signal = null, { boxed = false } = {}) {
    return new Promise(resolve => {
      const win = process.platform === "win32";
      const child = spawnShell(command, cwd, { boxed });
      let stdout = "",
        stderr = "",
        timedOut = false;
      const cap = (prev, chunk) => (prev + chunk.toString("utf8")).slice(-WORK_OUTPUT_LIMIT * 2);
      child.stdout.on("data", chunk => {
        stdout = cap(stdout, chunk);
      });
      child.stderr.on("data", chunk => {
        stderr = cap(stderr, chunk);
      });
      let aborted = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      // 页面停止生成（请求被中止）：连整棵进程树一起收掉
      const onAbort = () => {
        aborted = true;
        killTree(child);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", error => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode: -1, stdout, stderr: `${stderr}\n无法启动 shell：${error.message}`.trim(), timedOut, aborted });
      });
      child.on("close", (code, signalName) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code ?? (timedOut ? 124 : signalName || aborted ? 1 : 0),
          stdout: tail(stdout, WORK_OUTPUT_LIMIT),
          stderr: tail(win ? decodeClixml(stderr) : stderr, WORK_OUTPUT_LIMIT),
          timedOut,
          aborted
        });
      });
    });
  }
  async function handleWorkRun(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        command = String(body.command || "").trim();
      if (!command) throw Error("指令不能为空");
      if (!fs.existsSync(workdir)) throw Error("工作目录已不存在，请重新发送以重建，或另起对话");
      const boxed = body.sandbox === true;
      if (boxed) {
        const why = looseTier(body) ? sandbox.screenLoose(command) : sandbox.screenCommand(command, workdir);
        if (why) throw Error(why);
      }
      if (body.permission === "review") {
        const why = sandbox.screenAutoReview(command);
        if (why) throw Error(why);
      }
      if (body.background === true) {
        console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ （后台）${command.slice(0, 120)}`);
        return sendJson(res, 200, await backgroundReport(startBackground(command, workdir, boxed), 5000));
      }
      // 超时只有默认值没有上限：长测试、大装包、跑数据都可能超过十分钟，页面上本就有「停止」。
      // 封顶在 2³¹−1 毫秒（约 24 天）只因 setTimeout 超过它会溢出、当作 1 毫秒——模型给个大数，指令就被当场杀掉
      const timeoutMs = clampNumber(Number(body.timeout) * 1000, 120000, 1000, 2147483647);
      console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ ${command.slice(0, 120)}`);
      // 页面那头停止生成会中止这个请求：响应还没写就断开，即是中止，把指令连同它起的子进程一并杀掉
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const started = Date.now(),
        release = await lockWorkdir(workdir);
      let result;
      try {
        result = await runShell(command, workdir, timeoutMs, abort.signal, { boxed });
      } finally {
        release();
      }
      if (result.aborted) console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}   已中止：${command.slice(0, 80)}`);
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, { ...result, durationMs: Date.now() - started });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // ---- 后台指令：开发服务器、监听构建这类不会自己结束的，放到后台跑，先回头几秒的输出与一个编号，之后用 check_command 取新输出或结束它。
  // 后台指令不拿目录锁（它一直跑着，锁住了别的指令就都得排队）；桥接退出时一并收掉。只记最近的若干个，跑完的旧账先清
  const BACKGROUND_KEEP = 24,
    backgroundJobs = new Map();
  let backgroundSeq = 0;
  function startBackground(command, workdir, boxed) {
    const child = spawnShell(command, workdir, { boxed }),
      job = {
        id: `bg${++backgroundSeq}`,
        command,
        child,
        exitCode: null,
        started: Date.now(),
        grew: Date.now(),
        // 两路输出各留最近一截；base 是已裁掉的字数、read 是已交出去的位置（都按从头算的绝对位置记，裁了也对得上）
        text: { out: "", err: "" },
        base: { out: 0, err: 0 },
        read: { out: 0, err: 0 }
      };
    const take = (key, chunk) => {
      job.text[key] += chunk.toString("utf8");
      job.grew = Date.now();
      const cut = job.text[key].length - WORK_OUTPUT_LIMIT * 4;
      if (cut > 0) {
        job.text[key] = job.text[key].slice(cut);
        job.base[key] += cut;
      }
    };
    child.stdout.on("data", chunk => take("out", chunk));
    child.stderr.on("data", chunk => take("err", chunk));
    child.on("error", error => {
      take("err", `无法启动 shell：${error.message}`);
      job.exitCode = -1;
    });
    child.on("close", code => {
      job.exitCode = code ?? 1;
    });
    for (const [id, old] of backgroundJobs) if (backgroundJobs.size >= BACKGROUND_KEEP && old.exitCode !== null) backgroundJobs.delete(id);
    backgroundJobs.set(job.id, job);
    return job;
  }
  // 等到指令结束、输出停了一会儿（服务器起好了往往就不再出声）或时间到；交出去的是上次取过之后的新输出
  async function backgroundReport(job, waitMs) {
    const start = Date.now(),
      until = start + waitMs;
    while (Date.now() < until && job.exitCode === null && Date.now() - Math.max(job.grew, start) < 1500)
      await new Promise(resolve => setTimeout(resolve, 200));
    const fresh = key => {
      const text = job.text[key].slice(Math.max(0, job.read[key] - job.base[key]));
      job.read[key] = job.base[key] + job.text[key].length;
      return text;
    };
    const out = fresh("out"),
      err = fresh("err");
    return {
      id: job.id,
      running: job.exitCode === null,
      exitCode: job.exitCode,
      stdout: tail(out, WORK_OUTPUT_LIMIT),
      stderr: tail(process.platform === "win32" ? decodeClixml(err) : err, WORK_OUTPUT_LIMIT),
      durationMs: Date.now() - job.started
    };
  }
  // 桥接退出时把还在跑的指令（前台的与后台的）一并收掉（退出时起不了异步的 taskkill，用同步的）
  process.on("exit", () => {
    for (const child of runningShells)
      if (child.pid && child.exitCode === null && !child.signalCode)
        try {
          if (process.platform === "win32")
            spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
          else child.kill("SIGKILL");
        } catch {}
  });
  async function handleWorkCheck(req, res) {
    try {
      const body = await readJson(req),
        job = backgroundJobs.get(String(body.id || ""));
      if (!job) throw Error(`没有编号为 ${body.id} 的后台指令（桥接重启过的话，之前的后台指令已随之结束）`);
      if (body.stop === true && job.exitCode === null) {
        killTree(job.child);
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 3000);
          job.child.once("close", () => {
            clearTimeout(timer);
            resolve(null);
          });
        });
      }
      sendJson(res, 200, await backgroundReport(job, clampNumber(Number(body.wait) * 1000, 0, 0, 120000)));
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // 问而后行：发指令前先问一声严的沙箱会不会拦——会拦的照样请示，请示条上写明原因，用户批了这一条就出沙箱跑
  async function handleWorkScreen(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir);
      sendJson(res, 200, { why: sandbox.screenCommand(String(body.command || ""), workdir) });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  async function handleWorkWrite(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        file = await targetOf(workdir, body, { write: true });
      if (file === workdir) throw Error("请给出文件名");
      const content = String(body.content ?? "");
      if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw Error("单个文件不超过 32 MB");
      const release = await lockFile(workdir, file);
      try {
        const existing = await fs.promises.stat(file).catch(() => null);
        if (existing?.isDirectory()) throw Error(`${body.path} 是目录，不能作为文件写入`);
        await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(error => {
          throw Error(describeFsError(error, path.dirname(String(body.path))));
        });
        const existed = !!existing,
          previous = existed ? await fs.promises.readFile(file).catch(() => null) : null;
        const previousText = previous ? decodeText(previous)?.text : "",
          previousLines = previousText ? countLines(previousText) : 0;
        await fs.promises.writeFile(file, content, "utf8").catch(error => {
          throw Error(describeFsError(error, String(body.path)));
        });
        sendJson(res, 200, {
          path: shownPath(workdir, file),
          bytes: Buffer.byteLength(content),
          lines: countLines(content),
          existed,
          previousLines
        });
      } finally {
        release();
      }
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  async function handleWorkRead(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        file = await targetOf(workdir, body);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) throw Error(`文件不存在：${body.path}`);
      if (stat.isDirectory()) throw Error(`${body.path} 是目录，请改用 list_files`);
      if (stat.size > 8 * 1024 * 1024) throw Error("文件超过 8 MB，不予读取");
      const buffer = await fs.promises.readFile(file).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      const decoded = decodeText(buffer);
      if (!decoded) throw Error("二进制文件，不予读取");
      const lines = decoded.text.split(/\r?\n/),
        offset = Math.floor(clampNumber(body.offset, 1, 1, Math.max(1, lines.length))),
        limit = Math.floor(clampNumber(body.limit, 400, 1, 2000));
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      let text = slice.map((line, i) => `${String(offset + i).padStart(4)}| ${line}`).join("\n");
      if (text.length > WORK_FILE_LIMIT) text = `${text.slice(0, WORK_FILE_LIMIT)}\n…（内容过长已截断，请缩小 limit）`;
      sendJson(res, 200, {
        path: shownPath(workdir, file),
        totalLines: lines.length,
        offset,
        shown: slice.length,
        text,
        encoding: decoded.encoding
      });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  const WORK_SKIP = new Set([
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
    ".idea",
    ".vscode",
    "coverage"
  ]);
  // 极简 glob：** 跨目录、* 不跨目录、? 单字符；没有 / 的模式只匹配文件名
  function globToRegExp(pattern) {
    const text = String(pattern || "")
      .trim()
      .replace(/\\/g, "/");
    if (!text) return null;
    const body = text
      .replace(/[.+^${}()|[\]]/g, "\\$&")
      .replace(/\*\*\/?/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\0/g, "(?:.*/)?");
    return new RegExp(`^${text.includes("/") ? "" : "(?:.*/)?"}${body}$`, "i");
  }
  async function listTree(dir, base, depth, out, filter = null) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= WORK_LIST_LIMIT) return;
      const rel = path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        if (!filter) out.push(`${rel}@`);
        continue;
      } // 符号链接 / junction 只标出，不跟进：目标可能在工作目录之外
      if (entry.isDirectory()) {
        if (!filter) out.push(`${rel}/`);
        if (depth > 1 && !WORK_SKIP.has(entry.name)) await listTree(path.join(dir, entry.name), base, depth - 1, out, filter);
      } else if (!filter || filter.test(rel)) {
        const size = await fs.promises
          .stat(path.join(dir, entry.name))
          .then(s => s.size)
          .catch(() => 0);
        out.push(`${rel}\t${size}`);
      }
    }
  }
  async function handleWorkList(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        dir = await targetOf(workdir, body);
      const stat = await fs.promises.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) throw Error(`目录不存在：${body.path || "."}`);
      const filter = globToRegExp(body.pattern),
        out = [];
      await listTree(dir, dir, Math.floor(clampNumber(body.depth, filter ? 8 : 2, 1, 8)), out, filter);
      sendJson(res, 200, { path: shownPath(workdir, dir) || ".", entries: out, truncated: out.length >= WORK_LIST_LIMIT });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // ---- edit_file：精确文本替换。old 必须在文件里唯一出现（或显式 replace_all）；文件是 CRLF 时把片段的换行也换成 CRLF 再匹配
  async function handleWorkEdit(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        file = await targetOf(workdir, body, { write: true });
      const oldText = String(body.old ?? ""),
        newText = String(body.new ?? ""),
        replaceAll = body.replaceAll === true;
      if (file === workdir) throw Error("请给出文件名");
      if (!oldText) throw Error("old 不能为空；新建文件请用 write_file");
      if (oldText === newText) throw Error("old 与 new 相同，无需修改");
      const release = await lockFile(workdir, file);
      try {
        const stat = await fs.promises.stat(file).catch(() => null);
        if (!stat) throw Error(`文件不存在：${body.path}`);
        if (stat.isDirectory()) throw Error(`${body.path} 是目录`);
        if (stat.size > 8 * 1024 * 1024) throw Error("文件超过 8 MB，不予编辑");
        const decoded = decodeText(await fs.promises.readFile(file));
        if (!decoded) throw Error("二进制文件，不予编辑");
        if (decoded.encoding === "gbk")
          throw Error(
            "文件是 GBK 编码，edit_file 只改 UTF-8 / UTF-16 的文件；请用 write_file 整体重写（会存成 UTF-8），或用指令转码后再改"
          );
        const source = decoded.text,
          crlf = source.includes("\r\n") && !oldText.includes("\r\n");
        const needle = crlf ? oldText.replace(/\r?\n/g, "\r\n") : oldText,
          replacement = crlf ? newText.replace(/\r?\n/g, "\r\n") : newText;
        let count = 0;
        for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) count += 1;
        if (!count) throw Error("未找到要替换的文本：old 必须与文件内容逐字一致（含缩进与空格），请先 read_file 核对");
        if (count > 1 && !replaceAll) throw Error(`要替换的文本出现了 ${count} 处，请提供更长的唯一片段，或设置 replace_all`);
        const result = replaceAll ? source.split(needle).join(replacement) : source.replace(needle, () => replacement);
        // 按原来的编码写回：UTF-16 的还是 UTF-16，带 BOM 的还带 BOM
        const output = encodeText(result, decoded.encoding);
        await fs.promises.writeFile(file, output).catch(error => {
          throw Error(describeFsError(error, String(body.path)));
        });
        const line = source.slice(0, source.indexOf(needle)).split(/\r?\n/).length;
        sendJson(res, 200, {
          path: shownPath(workdir, file),
          replaced: replaceAll ? count : 1,
          line,
          lines: countLines(result),
          bytes: output.length
        });
      } finally {
        release();
      }
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // ---- search_files：在工作目录里按正则或原文逐行检索；跳过 node_modules 等目录与二进制、超大文件
  // 正则是模型写的：写成 (a+)+$ 这类会灾难性回溯的，一行就能把桥接卡死（单线程，所有对话一起停）。
  // 每个文件的逐行匹配放进 vm 跑、限两秒，超时即中止这次检索，把原因回给模型
  const SEARCH_REGEX_MS = 2000,
    searchScript = new vm.Script("hits = []; for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) hits.push(i);"),
    searchContext = vm.createContext({ regex: null, lines: null, hits: null });
  function matchLines(regex, lines, rel) {
    searchContext.regex = regex;
    searchContext.lines = lines;
    try {
      searchScript.runInContext(searchContext, { timeout: SEARCH_REGEX_MS });
      return searchContext.hits;
    } catch (error) {
      if (error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
        throw Error(
          `正则在 ${rel} 上回溯过久（超过 ${SEARCH_REGEX_MS / 1000} 秒），已中止：请改写得更具体（避免 (a+)+ 这类嵌套的重复），或用 literal 按原文找`
        );
      throw error;
    } finally {
      searchContext.regex = searchContext.lines = searchContext.hits = null;
    }
  }
  const SEARCH_MATCH_LIMIT = 200,
    SEARCH_FILE_LIMIT = 4000,
    SEARCH_FILE_BYTES = 2 * 1024 * 1024;
  // ---- download_file：把网上的文件存进工作目录。地址门禁与 fetch_page 同一套（不许本机与内网）；path 给目录或省略时按网址里的文件名存，
  // 已有同名文件就加 (2)；最多 64 MB
  const DOWNLOAD_LIMIT = 64 * 1024 * 1024;
  async function handleWorkDownload(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir);
      let url;
      try {
        url = new URL(String(body.url || "").trim());
      } catch {
        throw Error("网址无效");
      }
      const given = String(body.path || "").trim(),
        fromUrl =
          (() => {
            try {
              return decodeURIComponent(path.posix.basename(url.pathname));
            } catch {
              return path.posix.basename(url.pathname);
            }
          })() || "下载文件";
      let target = await targetOf(workdir, { ...body, path: given || "." }, { write: true });
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!given || /[\\/]$/.test(given) || stat?.isDirectory()) {
        // 网址末段解码后可能是「../」「..」或带 Windows 不许的字符：取最后一段、去掉怪字符，. 与 .. 一律换成默认名，不能借它落到目录外
        const base = path
          .basename(fromUrl)
          .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
          .trim();
        target = path.join(target, base && base !== "." && base !== ".." ? base : "下载文件");
        if (strictBox(body)) {
          const why = sandbox.screenPath(relPath(workdir, target), { write: true });
          if (why) throw Error(why);
        }
      }
      const started = Date.now(),
        { response } = await fetchPublicResponse(url.href, { timeout: 120000, allowLoopback: true });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Error(`对方返回 ${response.status}`);
      }
      const length = Number(response.headers.get("content-length") || 0);
      if (length > DOWNLOAD_LIMIT) {
        await response.body?.cancel().catch(() => {});
        throw Error(`文件超过 ${DOWNLOAD_LIMIT / 1048576} MB`);
      }
      const { buffer, truncated } = await readLimitedBytes(response, DOWNLOAD_LIMIT);
      if (truncated) throw Error(`文件超过 ${DOWNLOAD_LIMIT / 1048576} MB`);
      const release = await lockFile(workdir, target);
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const extension = path.extname(target),
          stem = target.slice(0, target.length - extension.length);
        let file = target;
        for (let n = 2; fs.existsSync(file); n++) file = `${stem} (${n})${extension}`;
        await fs.promises.writeFile(file, buffer).catch(error => {
          throw Error(describeFsError(error, shownPath(workdir, file)));
        });
        sendJson(res, 200, {
          path: shownPath(workdir, file),
          bytes: buffer.length,
          type: (response.headers.get("content-type") || "").split(";")[0].trim(),
          durationMs: Date.now() - started
        });
      } finally {
        release();
      }
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  async function handleWorkSearch(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        dir = await targetOf(workdir, body),
        boxed = strictBox(body);
      const query = String(body.query || "");
      if (!query.trim()) throw Error("query 不能为空");
      let regex;
      try {
        regex = new RegExp(
          body.literal === true ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query,
          body.caseSensitive === true ? "" : "i"
        );
      } catch (error) {
        throw Error(`正则无效：${error.message}`);
      }
      const filter = globToRegExp(body.glob),
        limit = Math.floor(clampNumber(body.limit, 60, 1, SEARCH_MATCH_LIMIT));
      const stat = await fs.promises.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) throw Error(`目录不存在：${body.path || "."}`);
      const matches = [];
      let scanned = 0,
        filesHit = new Set(),
        truncated = false;
      const walk = async current => {
        if (truncated) return;
        const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (truncated) return;
          const full = path.join(current, entry.name),
            rel = relPath(dir, full);
          if (entry.isSymbolicLink()) continue; // 不顺着链接读：链接指向目录外时，检索会把外面的内容带进来
          if (entry.isDirectory()) {
            if (!WORK_SKIP.has(entry.name)) await walk(full);
            continue;
          }
          if (filter && !filter.test(rel)) continue;
          if (boxed && sandbox.screenPath(rel)) continue; // 沙箱不借检索带出机密文件
          if (++scanned > SEARCH_FILE_LIMIT) {
            truncated = true;
            return;
          }
          const size = await fs.promises
            .stat(full)
            .then(s => s.size)
            .catch(() => 0);
          if (!size || size > SEARCH_FILE_BYTES) continue;
          const buffer = await fs.promises.readFile(full).catch(() => null),
            decoded = buffer && decodeText(buffer);
          if (!decoded) continue;
          const lines = decoded.text.split(/\r?\n/);
          for (const i of matchLines(regex, lines, rel)) {
            filesHit.add(rel);
            matches.push({ file: shownPath(workdir, full), line: i + 1, text: lines[i].trim().slice(0, 240) });
            if (matches.length >= limit) {
              truncated = true;
              return;
            }
          }
        }
      };
      await walk(dir);
      sendJson(res, 200, { path: shownPath(workdir, dir) || ".", matches, files: filesHit.size, scanned, truncated });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // ---- 卷宗目录：页面上的卷宗即这一目录的视图。列出全部文件（含子目录里的），收入 / 取出 / 移出都限定在目录内 ----
  const ARCHIVE_LIST_LIMIT = 600,
    ARCHIVE_FILE_LIMIT = 256 * 1024 * 1024;
  const ARCHIVE_MIME = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    zip: "application/zip",
    json: "application/json; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8"
  };
  // 网页、SVG、脚本一律按纯文本给：卷宗里的文件是模型写的，若以本站源头当网页打开，脚本便能读到页面的 localStorage
  function archiveMime(file) {
    const extension = path.extname(file).slice(1).toLowerCase();
    if (["html", "htm", "svg", "xml", "js", "mjs", "cjs"].includes(extension)) return "text/plain; charset=utf-8";
    return ARCHIVE_MIME[extension] || "application/octet-stream";
  }
  // 卷宗根：请求里带 root 就用它（须是完整限定的绝对路径，与工作目录同一套规矩），否则默认位置
  async function archiveRoot(raw) {
    const root = String(raw || "").trim() ? resolveWorkdir(raw) : archiveHome();
    const existing = await fs.promises.stat(root).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`卷宗路径已被文件占用：${root}`);
    if (!existing)
      await fs.promises.mkdir(root, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, root));
      });
    return root;
  }
  function archivePath(root, raw) {
    const rel = String(raw || "").trim();
    if (!rel) throw Error("请给出文件路径");
    return resolveInside(root, rel);
  }
  async function walkArchive(root, dir, out) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= ARCHIVE_LIST_LIMIT) return;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WORK_SKIP.has(entry.name)) await walkArchive(root, full, out);
        continue;
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({ path: relPath(root, full), name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  // 草稿占了多少：目录数与字节数，卷宗页上给用户一个数
  async function measureScratch(root) {
    const base = path.join(root, SCRATCH_DIR),
      dirs = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => []);
    let bytes = 0,
      files = 0;
    const walk = async dir => {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isSymbolicLink() || files > 5000) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          files += 1;
          bytes += await fs.promises
            .stat(full)
            .then(s => s.size)
            .catch(() => 0);
        }
      }
    };
    await walk(base);
    return { count: dirs.filter(d => d.isDirectory()).length, files, bytes };
  }
  async function handleArchiveList(req, res) {
    try {
      const body = await readJson(req),
        root = await archiveRoot(body.root);
      const out = [];
      await walkArchive(root, root, out);
      out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      sendJson(res, 200, {
        archive: root,
        entries: out,
        truncated: out.length >= ARCHIVE_LIST_LIMIT,
        scratch: await measureScratch(root)
      });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // 清草稿：给了 id 只清那段对话的，否则整个 .草稿 目录
  async function handleArchiveClean(req, res) {
    try {
      const body = await readJson(req),
        root = await archiveRoot(body.root),
        id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "");
      const target = id ? path.join(root, SCRATCH_DIR, id) : path.join(root, SCRATCH_DIR);
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2 }).catch(error => {
        throw Error(describeFsError(error, SCRATCH_DIR));
      });
      sendJson(res, 200, { cleaned: id || SCRATCH_DIR });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // 收入：页面拖进来的文件以 data: URL 送来；同名文件不覆盖，另取「名 (2).扩展名」
  async function handleArchivePut(req, res) {
    try {
      const body = await readJson(req, 400 * 1024 * 1024),
        root = await archiveRoot(body.root),
        name = path.basename(String(body.name || "").trim()) || "未命名文件";
      const data = String(body.data || ""),
        comma = data.indexOf(",");
      if (!data.startsWith("data:") || comma < 0) throw Error("文件内容格式无效");
      const bytes = Buffer.from(data.slice(comma + 1), /;base64/i.test(data.slice(0, comma)) ? "base64" : "utf8");
      if (bytes.length > ARCHIVE_FILE_LIMIT) throw Error(`单个文件不超过 ${ARCHIVE_FILE_LIMIT / 1048576} MB`);
      const extension = path.extname(name),
        stem = name.slice(0, name.length - extension.length);
      let target = path.join(root, name);
      for (let n = 2; fs.existsSync(target); n++) target = path.join(root, `${stem} (${n})${extension}`);
      await fs.promises.writeFile(target, bytes).catch(error => {
        throw Error(describeFsError(error, name));
      });
      const stat = await fs.promises.stat(target);
      sendJson(res, 200, {
        path: relPath(root, target),
        name: path.basename(target),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }
  // 取出：GET /api/archive/file?path=…（&root=… 指定卷宗根），页面用它做缩略图、置于案上与下载；?download=1 时让浏览器另存
  async function handleArchiveFile(req, res) {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const root = await archiveRoot(query.get("root")),
        file = archivePath(root, query.get("path"));
      await assertNoEscapingLink(root, file);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) throw Error("文件不存在");
      const name = path.basename(file);
      res.writeHead(200, {
        "Content-Type": archiveMime(file),
        "Content-Length": stat.size,
        "Cache-Control": "no-cache",
        "Last-Modified": stat.mtime.toUTCString(),
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": `${query.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      sendJson(res, 404, { error: String(error.message || error).slice(0, 300) });
    }
  }
  async function handleArchiveRemove(req, res) {
    try {
      const body = await readJson(req),
        root = await archiveRoot(body.root),
        file = archivePath(root, body.path);
      await assertNoEscapingLink(root, file);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) throw Error("文件不存在");
      await fs.promises.unlink(file).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      sendJson(res, 200, { removed: relPath(root, file) });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 300) });
    }
  }

  return {
    WORK_HOME,
    SCRATCH_DIR,
    WORK_SHELL,
    // 都碰本机磁盘或本机进程：只受理本站页面与 VS Code Webview（见 server.js 的接口表）
    routes: {
      "POST /api/work/prepare": handleWorkPrepare,
      "POST /api/work/pick": handleWorkPick,
      "POST /api/work/run": handleWorkRun,
      "POST /api/work/screen": handleWorkScreen,
      "POST /api/work/check": handleWorkCheck,
      "POST /api/work/write": handleWorkWrite,
      "POST /api/work/read": handleWorkRead,
      "POST /api/work/list": handleWorkList,
      "POST /api/work/edit": handleWorkEdit,
      "POST /api/work/search": handleWorkSearch,
      "POST /api/work/download": handleWorkDownload,
      "POST /api/archive/list": handleArchiveList,
      "POST /api/archive/put": handleArchivePut,
      "POST /api/archive/remove": handleArchiveRemove,
      "POST /api/archive/clean": handleArchiveClean,
      "GET /api/archive/file": handleArchiveFile
    }
  };
};
