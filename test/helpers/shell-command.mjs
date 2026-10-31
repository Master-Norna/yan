// 指令类的测试数据按本机的 shell 给：Windows 走 PowerShell，macOS 走 sh
export const shellCommand = (powershell, posix) => (process.platform === "win32" ? powershell : posix);
