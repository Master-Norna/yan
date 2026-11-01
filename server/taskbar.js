// 言 · 桥接 · 游目浏览器不占任务栏：窗口挪到了屏幕外，任务栏上却还挂着它一枚按钮，点了也看不到东西（看它请到游目）。
// 浏览器由 Playwright 起，言管不着它的窗口：另起一个看不见的 PowerShell 守着——按调试口认出浏览器的进程，每秒把它可见的顶层窗口
// 从任务栏上摘掉（ITaskbarList.DeleteTab，窗口本身不动）。实测调窗、切签、新开标签都不会让按钮回来，新开窗口、资源管理器重启会，所以一直守着；
// 浏览器关了就等下一个占这个口的，桥接退了它也退。只在 Windows 上做
"use strict";
const { spawn } = require("node:child_process");
const { encodePowerShell } = require("./work/text.js");

const TASKBAR_CS = String.raw`
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
[ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITaskbarList { void HrInit(); void AddTab(IntPtr h); void DeleteTab(IntPtr h); void ActivateTab(IntPtr h); void SetActiveAlt(IntPtr h); }
[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] class TaskbarList {}
public static class YanTaskbar {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int cls, uint reserved);
  // 在这个口上监听的进程（IPv4、IPv6 都看：v4 的口被占时浏览器会退到 v6）
  static uint Listener(int port) {
    foreach (int af in new int[] { 2, 23 }) {
      int size = 0;
      GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, 3, 0);
      IntPtr buf = Marshal.AllocHGlobal(size);
      try {
        if (GetExtendedTcpTable(buf, ref size, false, af, 3, 0) != 0) continue;
        int rows = Marshal.ReadInt32(buf), width = af == 2 ? 24 : 56, portAt = af == 2 ? 8 : 20, pidAt = af == 2 ? 20 : 52;
        for (int i = 0; i < rows; i++) {
          IntPtr row = buf + 4 + i * width;
          int p = Marshal.ReadInt32(row, portAt);
          if ((((p & 0xFF) << 8) | ((p >> 8) & 0xFF)) == port) return (uint)Marshal.ReadInt32(row, pidAt);
        }
      } finally { Marshal.FreeHGlobal(buf); }
    }
    return 0;
  }
  static bool Alive(int pid) {
    try { return !Process.GetProcessById(pid).HasExited; } catch (ArgumentException) { return false; }
  }
  public static void Run(int port, int bridge) {
    ITaskbarList bar = (ITaskbarList)new TaskbarList();
    bar.HrInit();
    uint browser = 0;
    while (Alive(bridge)) {
      if (browser == 0 || !Alive((int)browser)) browser = Listener(port);
      if (browser != 0)
        EnumWindows(delegate (IntPtr h, IntPtr l) {
          uint owner;
          GetWindowThreadProcessId(h, out owner);
          if (owner == browser && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) bar.DeleteTab(h);
          return true;
        }, IntPtr.Zero);
      Thread.Sleep(1000);
    }
  }
}`;

/** @type {Set<number>} 已有人守着的调试口 */
const watched = new Set();
/** 守住在这个调试口上的浏览器，让它不占任务栏 @param {number} port */
function hideFromTaskbar(port) {
  if (process.platform !== "win32" || watched.has(port)) return;
  watched.add(port);
  const script = `Add-Type -TypeDefinition @'\n${TASKBAR_CS}\n'@\n[YanTaskbar]::Run(${port}, ${process.pid})`;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)],
    {
      windowsHide: true,
      stdio: "ignore"
    }
  );
  child.on("error", () => watched.delete(port));
  child.on("exit", () => watched.delete(port));
}

module.exports = { hideFromTaskbar };
