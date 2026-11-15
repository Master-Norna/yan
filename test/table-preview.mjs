// CSV / TSV 的宽表只能在纸内横向滚动，不能越过纸边；长表仍由预览台纵向滚动。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";

mkdirSync(ARCHIVE, { recursive: true });
const columns = Array.from({ length: 24 }, (_, i) => `指标_${i}_长字段`),
  rows = Array.from({ length: 60 }, (_, r) => columns.map((_, c) => `${r}_${c}_123456789.123456789`));
for (const [name, separator] of [
  ["宽表.csv", ","],
  ["宽表.tsv", "\t"]
])
  writeFileSync(`${ARCHIVE}/${name}`, [columns, ...rows].map(row => row.join(separator)).join("\n"));
writeFileSync(`${ARCHIVE}/小表.csv`, "品名,价格\n藜麦,48.9");

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE });
await evalJs(`document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('[data-library-disk="宽表.csv"]')`);

const open = async name => {
  await evalJs(`document.querySelector('[data-library-disk="${name}"]').click(); true`);
  await waitFor(`!!document.querySelector("#fileViewerStage .file-viewer-table")`);
  await sleep(300);
};
const shut = async () => {
  await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
  await waitFor(`document.querySelector("#fileViewer").classList.contains("hidden")`);
};

try {
  for (const width of [1280, 800]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor: 1, mobile: false });
    for (const name of ["宽表.csv", "宽表.tsv"]) {
      await open(name);
      const bounds = JSON.parse(
        await evalJs(`(() => {
        const stage = document.querySelector("#fileViewerStage"), paper = stage.querySelector(".file-viewer-fit"), table = paper.querySelector("table");
        stage.scrollLeft = 0;
        paper.scrollLeft = 0;
        const box = paper.getBoundingClientRect(), first = table.querySelector("th").getBoundingClientRect();
        const result = { stageWidth: stage.clientWidth, stageScroll: stage.scrollWidth, paperLeft: box.left, paperRight: box.right, viewport: innerWidth,
          paperWidth: paper.clientWidth, paperScroll: paper.scrollWidth, firstLeft: first.left, firstRight: first.right };
        paper.scrollLeft = paper.scrollWidth;
        const last = table.querySelector("tr").lastElementChild.getBoundingClientRect();
        result.scrollLeft = paper.scrollLeft;
        result.lastLeft = last.left; result.lastRight = last.right;
        stage.scrollTop = stage.scrollHeight;
        const bottom = table.querySelector("tr:last-child td").getBoundingClientRect();
        result.scrollTop = stage.scrollTop; result.bottom = bottom.bottom; result.stageBottom = stage.getBoundingClientRect().bottom;
        return JSON.stringify(result);
      })()`)
      );
      check(
        `${width}px ${name}：宽表不越过纸边、预览台不横向溢出`,
        bounds.stageScroll <= bounds.stageWidth + 1 && bounds.paperLeft >= 0 && bounds.paperRight <= bounds.viewport,
        JSON.stringify(bounds)
      );
      check(
        `${width}px ${name}：纸内可从首列滚到末列，不裁掉内容`,
        bounds.paperScroll > bounds.paperWidth &&
          bounds.scrollLeft > 0 &&
          bounds.firstLeft >= bounds.paperLeft &&
          bounds.firstRight <= bounds.paperRight &&
          bounds.lastLeft >= bounds.paperLeft &&
          bounds.lastRight <= bounds.paperRight + 1,
        JSON.stringify(bounds)
      );
      check(
        `${width}px ${name}：长表可纵向滚到最后一行`,
        bounds.scrollTop > 0 && bounds.bottom <= bounds.stageBottom + 1,
        JSON.stringify(bounds)
      );
      await shut();
    }
    await open("小表.csv");
    const small = JSON.parse(
      await evalJs(`(() => {
      const stage = document.querySelector("#fileViewerStage"), paper = stage.querySelector(".file-viewer-fit"), box = paper.getBoundingClientRect();
      return JSON.stringify({ width: box.width, center: (box.left + box.right) / 2, viewport: innerWidth, scroll: paper.scrollWidth, client: paper.clientWidth });
    })()`)
    );
    check(
      `${width}px：小表仍按内容收窄居中，不出现多余横向滚动`,
      small.width < width * 0.75 && Math.abs(small.center - small.viewport / 2) < 12 && small.scroll <= small.client + 1,
      JSON.stringify(small)
    );
    await shut();
  }
} finally {
  await send("Emulation.clearDeviceMetricsOverride");
  close();
}
