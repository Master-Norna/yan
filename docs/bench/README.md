# 右栏基准数据

两组在不同云设备上取得的真实测量，用来比较「多个独立浏览器窗口/标签页」与「主页面 + 同源 iframe 右栏」的资源占用。负载全部是合成对话与假模型；测于 `87ed348`（多栏实现完成、连接预算与明暗同步修复之前）。它们只作为本 PR 的证据，不代表最终分支在真实设备、真实作答或主观操作上的表现。

## 文件

- `iframe-vs-tabs.json` / `iframe-vs-tabs.csv`：K=2..5，`tabs`（K 个独立窗口/标签页）对 `iframe`（主页面 + K−1 栏）。同一台云设备，Chromium 130 headless，Debian 13 arm64，2 vCPU / 8 GB；30 段对话 × 40 条消息（约 1.8 MB），假模型；静置 10 秒后取 Chromium 进程树 PSS 之和、GC 后 JS 堆；空闲 CPU 取 20 秒；K 段同时发 `SLOWTEXT`（单段理想约 8 秒）。
- `two-session-resource-comparison.json`：两个会话，窗口对 iframe，各 3 轮；另一台云设备，Chromium 156 headless，Debian 12，1920×1080；每轮新 profile、模式交替；预热后每轮采样 12 次取 PSS 中位数，另记 profile 增长与 localStorage 字节。
- `../../test/bench/bench-panes.mjs`：第一组的基准脚本。只在 Linux 上跑（读 `/proc` 与 `smaps_rollup`），需要 `YAN_TEST_BROWSER`；不属于 `node test/run.mjs` 的用例。

## 数据口径

- 第一组是「K 个会话」的横向扩展：标签页每多一页就多一个 renderer 进程；iframe 模式始终只是主页面进程树里的同源页面。第二组只测两个会话，重点看中位数与 profile 增长。
- PSS 是进程树的 proportional set size 之和，不是机器总内存，也不是单页私有内存；不同内核/浏览器版本之间不能直接横比。
- 两组数据的浏览器版本、OS、CPU 不同，**不要合并、平均或互相换算**；它们是两次独立观测。
- 第二组的 profile 增长包含浏览器后台与缓存写入，不等于应用安装体积或纯应用磁盘占用。
- 功能检查只确认两段对话都渲染出预期内容、输入框可用；没有测打字、发送、流式作答或主观切换手感。
- 第二组在正式 3 轮之前有一次尝试被云端共享 Linux 的算力/速率限制中断；未计入 3 轮有效测量，也不是被测实现或测试脚本的错误。

## 脱敏

- 负载为合成对话、假模型与固定端口；不含真实会话内容、账号标识、API Key、主机名、用户目录或个人数据。
- 保留浏览器/OS/CPU/版本信息仅用于复现；不含设备标识、用户名或路径。
- `test/bench/bench-panes.mjs` 里的 `/tmp/bench-*` 是临时目录名，不含个人路径。
- 数据是真实测量结果，不是估算或生成值；没有为了好看做过取舍。

## 复现

```bash
# Linux；YAN_TEST_BROWSER 指向 Chrome/Chromium
node test/bench/bench-panes.mjs tabs 2
node test/bench/bench-panes.mjs iframe 2
# 依次跑 2..5；每次用新的 profile，避免缓存影响
```

第二组由另一台设备上的独立脚本产生，原始脚本未随仓库提供；其方法、采样与限制见 JSON 的 `method` 与 `interpretation_limits`。
