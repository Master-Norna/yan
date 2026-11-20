// 言 · 便携包的启动器（言.exe）：用旁边 node\ 里自带的 Node 起本机桥接（server.js --open --exit-with-page），没带就用系统装的。
// 自带的 Node 接在 PATH 末尾：模型跑的 node、npx 与环境里 npm 装的工具找得到它，系统已装的仍然优先。
// 不开窗口：桥接跑在一个看不见的控制台里（CreateNoWindow），它再起的 powershell、git、npm 都沿用这个控制台，不会一条指令弹一个黑窗；
// 最后一页断开后，桥接留出重连时间，后台指令跑完才退出。日志能打开时重写 桥接.log；非零退出时弹框给出末几行。
// 要看着终端调试，用 start.cmd。由 pack/pack.mjs 用系统自带的 csc 编出（C# 5，/target:winexe，不另装 SDK）
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

class Launcher
{
    static bool CloseLog(StreamWriter log)
    {
        if (log == null) return false;
        try { log.Dispose(); return true; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    static void Report(string message, MessageBoxIcon icon, bool noOpen)
    {
        // 冒烟用同一个入口，不开浏览器也不让错误弹框挡住退出码。
        if (noOpen)
        {
            // 重定向的 stderr 也用 UTF-8，不随 Windows 的控制台代码页走。
            try
            {
                using (StreamWriter stderr = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)))
                    stderr.WriteLine(message);
            }
            catch (IOException) { }
        }
        else MessageBox.Show(message, "言", MessageBoxButtons.OK, icon);
    }

    static int Main(string[] args)
    {
        bool noOpen = Array.IndexOf(args, "--no-open") >= 0;
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string bundled = Path.Combine(root, "node");
        bool own = File.Exists(Path.Combine(bundled, "node.exe"));
        ProcessStartInfo start = new ProcessStartInfo(own ? Path.Combine(bundled, "node.exe") : "node");
        start.Arguments = "server.js --open --exit-with-page " + string.Join(" ", args);
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        if (own)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            start.EnvironmentVariables["PATH"] = path.TrimEnd(';') + ";" + bundled;
        }
        // 文件日志可选。占用、只读、运行中写盘失败都不能打断桥接或内存尾行。
        string logPath = Path.Combine(root, "桥接.log");
        StreamWriter log = null;
        try
        {
            log = new StreamWriter(logPath, false, new UTF8Encoding(false));
            log.AutoFlush = true;
        }
        catch (IOException) { CloseLog(log); log = null; }
        catch (UnauthorizedAccessException) { CloseLog(log); log = null; }
        Queue<string> tail = new Queue<string>();
        DataReceivedEventHandler keep = delegate (object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (tail)
            {
                tail.Enqueue(e.Data);
                if (tail.Count > 12) tail.Dequeue();
                if (log != null)
                {
                    try { log.WriteLine(e.Data); }
                    catch (IOException) { CloseLog(log); log = null; }
                    catch (UnauthorizedAccessException) { CloseLog(log); log = null; }
                }
            }
        };
        int code;
        bool logComplete;
        try
        {
            using (Process bridge = Process.Start(start))
            {
                bridge.OutputDataReceived += keep;
                bridge.ErrorDataReceived += keep;
                bridge.BeginOutputReadLine();
                bridge.BeginErrorReadLine();
                bridge.WaitForExit(); // 无超时的重载会一并等两个输出回调收完。
                code = bridge.ExitCode;
            }
        }
        catch (Win32Exception)
        {
            Report("未能启动 Node.js。请重新解压言的便携包，或确认系统已装 Node.js 22 以上（https://nodejs.org）。", MessageBoxIcon.Error, noOpen);
            return 1;
        }
        finally { logComplete = CloseLog(log); }
        if (code != 0)
        {
            string text = string.Join("\n", tail.ToArray());
            Report("桥接未能启动或意外退出（退出码 " + code + "）。最后的输出：\n\n" + text +
                (logComplete ? "\n\n全文见 " + logPath : ""), MessageBoxIcon.Warning, noOpen);
        }
        return code;
    }
}
