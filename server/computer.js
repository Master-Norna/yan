// 言 · 本机检查：固定的只读探针，不接受脚本文本。某一项失败只回报该项，不拖垮整次检查。
"use strict";
const os = require("node:os");
const { spawn } = require("node:child_process");

const SECTION_TITLES = {
  overview: "系统概况",
  resources: "资源与进程",
  storage: "磁盘与存储",
  network: "网络与监听",
  services: "服务状态",
  startup: "启动项",
  software: "已装软件",
  development: "开发环境",
  security: "安全状态",
  events: "近期系统错误"
};
const DEFAULT_SECTIONS = ["overview", "resources", "storage", "network", "development"];
const OUTPUT_LIMIT = 8000;

function encodePowerShell(text) {
  return Buffer.from(text, "utf16le").toString("base64");
}
function clip(text, limit = OUTPUT_LIMIT) {
  const value = String(text || "").trim();
  return value.length > limit ? `${value.slice(0, limit)}\n…（其余 ${value.length - limit} 字已省略）` : value;
}
function prettyJson(text) {
  const value = String(text || "").trim();
  if (!value) return "（无结果）";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
function runPowerShell(script, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const wrapped = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'\n${script}`;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(wrapped)],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "",
      stderr = "",
      timedOut = false;
    const append = (old, chunk) => (old + chunk.toString("utf8")).slice(-OUTPUT_LIMIT * 2);
    child.stdout.on("data", chunk => (stdout = append(stdout, chunk)));
    child.stderr.on("data", chunk => (stderr = append(stderr, chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (timedOut) return reject(Error("检查超时"));
      // 个别 Windows provider 会在给出完整 JSON 后仍把退出码置 1；结果能解析就保留，不因一条附带诊断丢掉整项。
      if (code) {
        try {
          JSON.parse(String(stdout || "").trim());
          return resolve(clip(prettyJson(stdout)));
        } catch {
          return reject(Error(clip(stderr || stdout || `PowerShell 退出码 ${code}`, 500)));
        }
      }
      resolve(clip(prettyJson(stdout)));
    });
  });
}
function overview() {
  const cpus = os.cpus();
  return JSON.stringify(
    {
      platform: `${os.type()} ${os.release()}`,
      version: typeof os.version === "function" ? os.version() : "",
      architecture: os.arch(),
      hostname: os.hostname(),
      uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
      cpu: cpus[0]?.model || "",
      logicalProcessors: cpus.length,
      memoryGB: {
        total: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        free: Math.round((os.freemem() / 1024 ** 3) * 10) / 10
      }
    },
    null,
    2
  );
}
function windowsScript(section, maxItems) {
  const json = value => `${value} | ConvertTo-Json -Depth 6 -Compress`;
  switch (section) {
    case "resources":
      return json(
        `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${maxItems} Name,Id,@{n='MemoryMB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='CpuSeconds';e={if ($_.CPU -ne $null) {[math]::Round($_.CPU,1)} else {$null}}}`
      );
    case "storage":
      return json(
        "Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Root} | Select-Object Name,Root,@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}},@{n='FreePercent';e={if (($_.Used+$_.Free) -gt 0) {[math]::Round(100*$_.Free/($_.Used+$_.Free),1)} else {$null}}}"
      );
    case "network":
      return json(
        `[pscustomobject]@{Configuration=(ipconfig ${maxItems > 12 ? "/all" : ""} | Out-String).Trim();Listeners=@(netstat -ano -p tcp | Select-String 'LISTENING' | Select-Object -First ${maxItems} | ForEach-Object {$_.Line.Trim()})}`
      );
    case "services":
      return json(
        `[pscustomobject]@{Counts=@(Get-Service | Group-Object Status | Select-Object Name,Count);AutomaticButStopped=@(Get-Service | Where-Object {$_.StartType -eq 'Automatic' -and $_.Status -ne 'Running'} | Select-Object -First ${maxItems} Name,DisplayName,Status,StartType)}`
      );
    case "startup":
      return json(
        `$items=@(); foreach($path in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run')) { if(Test-Path $path) { foreach($name in (Get-Item $path).Property) { $items += [pscustomobject]@{Name=$name;Location=$path} } } }; foreach($folder in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup'))) { if($folder -and (Test-Path $folder)) { Get-ChildItem $folder -File | ForEach-Object { $items += [pscustomobject]@{Name=$_.Name;Location=$folder} } } }; $items | Select-Object -First ${maxItems}`
      );
    case "software":
      return json(
        `Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName | Sort-Object DisplayName -Unique | Select-Object -First ${maxItems} DisplayName,DisplayVersion,Publisher,InstallDate`
      );
    case "development":
      return json(
        `[pscustomobject]@{PowerShell=$PSVersionTable.PSVersion.ToString();Node=${JSON.stringify(process.version)};Commands=@(Get-Command git,node,npm,python,py,wsl,docker -ErrorAction SilentlyContinue | Select-Object Name,Source,@{n='Version';e={$_.Version.ToString()}})}`
      );
    case "security":
      return json(
        "[pscustomobject]@{Services=@(Get-Service WinDefend,SecurityHealthService,wscsvc -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType);DefenderSignature=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Signature Updates' -ErrorAction SilentlyContinue | Select-Object AVSignatureVersion,ASSignatureVersion,SignaturesLastUpdated)}"
      );
    case "events":
      return json(
        `Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddDays(-1)} -MaxEvents ${maxItems} -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,ProviderName,LevelDisplayName,@{n='Message';e={($_.Message -replace '\\s+',' ').Trim()}}`
      );
    default:
      return "";
  }
}
function normalizeSections(input) {
  const values = Array.isArray(input) ? input : input ? [input] : DEFAULT_SECTIONS;
  const sections = [...new Set(values.map(String).filter(name => Object.hasOwn(SECTION_TITLES, name)))];
  return sections.length ? sections : DEFAULT_SECTIONS;
}
async function inspectSection(name, detail) {
  const started = Date.now();
  try {
    let output;
    if (name === "overview") output = overview();
    else if (process.platform !== "win32") {
      if (name === "development")
        output = JSON.stringify({ node: process.version, executable: process.execPath, platform: process.platform }, null, 2);
      else throw Error("该检查项目前只支持 Windows 主机");
    } else
      output = await runPowerShell(
        windowsScript(name, detail === "full" ? 30 : 12),
        name === "events" || name === "software" ? 20000 : 12000
      );
    return { name, title: SECTION_TITLES[name], ok: true, output: clip(output), durationMs: Date.now() - started };
  } catch (error) {
    return { name, title: SECTION_TITLES[name], ok: false, error: clip(error?.message || error, 600), durationMs: Date.now() - started };
  }
}
async function inspectComputer(sections, detail) {
  const names = normalizeSections(sections),
    results = [];
  // 最多并行三项，免得一次「全查」同时拉起许多 PowerShell 抢机器。
  for (let i = 0; i < names.length; i += 3)
    results.push(...(await Promise.all(names.slice(i, i + 3).map(name => inspectSection(name, detail)))));
  return results;
}

module.exports = function createComputer({ sendJson, readJson }) {
  async function handleInspect(req, res) {
    try {
      const body = await readJson(req),
        started = Date.now(),
        detail = body.detail === "full" ? "full" : "summary",
        sections = await inspectComputer(body.sections, detail);
      sendJson(res, 200, { sections, durationMs: Date.now() - started });
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message || error).slice(0, 500) });
    }
  }
  return { handleInspect };
};

module.exports.inspectComputer = inspectComputer;
module.exports.normalizeSections = normalizeSections;
module.exports.SECTION_TITLES = SECTION_TITLES;
