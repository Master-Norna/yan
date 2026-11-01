// 言 · 便携包的启动器（言.exe）：用旁边 node\ 里自带的 Node 起本机桥接（server.js --open --exit-with-page），没带就用系统装的。
// 自带的 Node 接在 PATH 末尾：模型跑的 node、npx 与环境里 npm 装的工具找得到它，系统已装的仍然优先。
// 不开窗口：桥接跑在一个看不见的控制台里（CreateNoWindow），它再起的 powershell、git、npm 都沿用这个控制台，不会一条指令弹一个黑窗；
// 最后一页关了桥接自己退（见 server.js 的 --exit-with-page）。输出记进旁边的 桥接.log，每次启动重写；异常退出时弹框给出末几行。
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
    static int Main(string[] args)
    {
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
        // 日志被占着＝已有一个桥接在跑：这一回的桥接只会打开页面就退，不必记
        StreamWriter log = null;
        try
        {
            log = new StreamWriter(Path.Combine(root, "桥接.log"), false, new UTF8Encoding(false));
            log.AutoFlush = true;
        }
        catch (IOException) { }
        Queue<string> tail = new Queue<string>();
        DataReceivedEventHandler keep = delegate (object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (tail)
            {
                if (log != null) log.WriteLine(e.Data);
                tail.Enqueue(e.Data);
                if (tail.Count > 12) tail.Dequeue();
            }
        };
        int code;
        try
        {
            Process bridge = Process.Start(start);
            bridge.OutputDataReceived += keep;
            bridge.ErrorDataReceived += keep;
            bridge.BeginOutputReadLine();
            bridge.BeginErrorReadLine();
            bridge.WaitForExit();
            code = bridge.ExitCode;
        }
        catch (Win32Exception)
        {
            MessageBox.Show("未找到 node：包里的 node 文件夹不见了，系统也没装 Node.js。请重新解压言的便携包，或装 Node.js 22 以上（https://nodejs.org）。", "言", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        if (code != 0)
        {
            string text;
            lock (tail) text = string.Join("\n", tail.ToArray());
            MessageBox.Show("桥接意外退出（退出码 " + code + "），页面此时已连不上桥接。最后的输出：\n\n" + text + "\n\n全文见 " + Path.Combine(root, "桥接.log"), "言", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return code;
    }
}
