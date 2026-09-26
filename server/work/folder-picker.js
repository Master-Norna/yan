// 言 · 桥接 · 选工作目录的系统对话框
"use strict";
const { spawn } = require("node:child_process");
const { encodePowerShell } = require("./text.js");

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

module.exports = { pickFolder };
