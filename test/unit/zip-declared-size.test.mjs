// 解包只信中央目录声明大小的老毛病：一条声明 100 字节、实际解出几 MB 的条目曾绕过每件 8 MB、总额 16 MB 两道上限。
// 这里按 unzipSelected 读央目录的顺序手搓 zip：本地头 30 字节、中央目录 46 字节、末尾 22 字节，声明值与真身各写各的
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { unzipSelected } = load(["unzipSelected"]),
  encoder = new TextEncoder(),
  MB = 1024 * 1024;

// 一段 deflate-raw（Node 22 自带 CompressionStream）
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function join(parts) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// 一个包：每条给出真身（body）、声明值（size）、压缩方式（method，0 存储 / 8 deflate）；CRC 不校验，写 0
function zip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const { name, method, size, body } of entries) {
    const label = encoder.encode(name),
      local = new Uint8Array(30 + label.length + body.length),
      localView = new DataView(local.buffer),
      central = new Uint8Array(46 + label.length),
      centralView = new DataView(central.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, label.length, true);
    local.set(label, 30);
    local.set(body, 30 + label.length);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, label.length, true);
    centralView.setUint32(42, offset, true);
    central.set(label, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = join(centrals),
    end = new Uint8Array(22),
    endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return join([...locals, directory, end]);
}

// 解压是不是「边读边数」：包一层 DecompressionStream，记下真从压缩流里拽出了多少字节。
// 老写法 response.arrayBuffer() 会一路读到尾（8 MB 全拽出来才判），新写法超预算就 cancel
function meterInflate() {
  const Real = globalThis.DecompressionStream,
    meter = { pulled: 0 };
  globalThis.DecompressionStream = function (format) {
    const real = new Real(format),
      readable = real.readable.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            meter.pulled += chunk.byteLength;
            controller.enqueue(chunk);
          }
        })
      );
    return { readable, writable: real.writable };
  };
  return {
    get pulled() {
      return meter.pulled;
    },
    restore: () => (globalThis.DecompressionStream = Real)
  };
}

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>你好，言</w:t></w:r></w:p></w:body></w:document>`,
  STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="w"><w:style w:styleId="1"><w:name w:val="Heading 1"/></w:style></w:styles>`,
  PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

test("正常的 docx 式小包：声明与实际一致，正文抽得出来", async () => {
  const bytes = zip([
    { name: "[Content_Types].xml", method: 8, size: 40, body: await deflate(encoder.encode("<Types/>".padEnd(40, " "))) },
    { name: "word/document.xml", method: 8, size: encoder.encode(DOCUMENT_XML).length, body: await deflate(encoder.encode(DOCUMENT_XML)) },
    { name: "word/media/image1.png", method: 0, size: PNG.length, body: PNG }
  ]);
  const entries = await unzipSelected(bytes, name => name === "word/document.xml");
  assert.equal(entries.size, 1);
  assert.equal(entries.get("word/document.xml"), DOCUMENT_XML);
});

test("raw 为真时存原字节，为假时存解码后的字（entries 语义不变）", async () => {
  const bytes = zip([
    { name: "word/media/image1.png", method: 8, size: PNG.length, body: await deflate(PNG) },
    { name: "word/media/image2.png", method: 0, size: PNG.length, body: PNG }
  ]);
  const raw = await unzipSelected(bytes, () => true, true),
    decoded = await unzipSelected(bytes, () => true);
  for (const name of ["word/media/image1.png", "word/media/image2.png"]) {
    assert.ok(raw.get(name) instanceof Uint8Array, name);
    assert.deepEqual([...raw.get(name)], [...PNG], name);
    assert.equal(typeof decoded.get(name), "string", name);
  }
});

test("声明 100 字节、实际解出 8 MB：抛错说清哪一条，且不把整份内容解出来", async () => {
  const real = new Uint8Array(8 * MB).fill(0x61),
    bytes = zip([{ name: "word/document.xml", method: 8, size: 100, body: await deflate(real) }]),
    meter = meterInflate();
  try {
    await assert.rejects(
      unzipSelected(bytes, () => true),
      error => {
        assert.match(error.message, /文档压缩结构不符/);
        assert.match(error.message, /word\/document\.xml/);
        assert.match(error.message, /声明 100 字节/);
        return true;
      }
    );
  } finally {
    // 关掉计数先取数：pulled 是老写法会整份读出来、新写法读到超预算就停的分界
    meter.restore();
  }
  assert.ok(meter.pulled > 0, "确实解了一段");
  assert.ok(meter.pulled < MB, `超预算就停手，只读了 ${meter.pulled} 字节`);
});

test("声明与真身都超过每件 8 MB：同样在 8 MB 处停下", async () => {
  const real = new Uint8Array(8 * MB + 4096).fill(0x62),
    bytes = zip([{ name: "word/styles.xml", method: 8, size: 8 * MB, body: await deflate(real) }]),
    meter = meterInflate();
  try {
    await assert.rejects(
      unzipSelected(bytes, () => true),
      error => {
        assert.match(error.message, /文档压缩结构不符/);
        assert.match(error.message, /word\/styles\.xml/);
        assert.match(error.message, new RegExp(`超过 ${8 * MB} 字节`));
        return true;
      }
    );
  } finally {
    meter.restore();
  }
  assert.ok(meter.pulled < 9 * MB, `读到 8 MB 的预算就停手：${meter.pulled}`);
});

test("多条各声明很小、合计真实远超 16 MB：第一条就中止，一条也不交出去", async () => {
  const real = new Uint8Array(6 * MB).fill(0x63),
    body = await deflate(real),
    bytes = zip([1, 2, 3].map(i => ({ name: `word/media/part${i}.xml`, method: 8, size: 100, body }))),
    meter = meterInflate();
  try {
    await assert.rejects(
      unzipSelected(bytes, () => true, true),
      error => {
        assert.match(error.message, /文档压缩结构不符/);
        assert.match(error.message, /word\/media\/part1\.xml/);
        return true;
      }
    );
  } finally {
    meter.restore();
  }
  // 18 MB 的真身一段也没留在内存里：抛错中止，调用方拿不到任何一条
  assert.ok(meter.pulled < MB, `只读了 ${meter.pulled} 字节`);
});

test("声明如实时报账也按真长：总额 16 MB 之外的条目干脆不取，已取的不越界", async () => {
  const real = new Uint8Array(6 * MB).fill(0x64),
    body = await deflate(real),
    bytes = zip([1, 2, 3].map(i => ({ name: `word/media/part${i}.xml`, method: 8, size: 6 * MB, body })));
  const entries = await unzipSelected(bytes, () => true);
  assert.deepEqual([...entries.keys()], ["word/media/part1.xml", "word/media/part2.xml"]);
  assert.equal(
    [...entries.values()].reduce((n, text) => n + text.length, 0),
    12 * MB
  );
});

test("改过的两处之外，包照旧：抽两份 XML、坏包照旧报结构无效", async () => {
  const bytes = zip([
    { name: "word/document.xml", method: 8, size: encoder.encode(DOCUMENT_XML).length, body: await deflate(encoder.encode(DOCUMENT_XML)) },
    { name: "word/styles.xml", method: 8, size: encoder.encode(STYLES_XML).length, body: await deflate(encoder.encode(STYLES_XML)) }
  ]);
  const entries = await unzipSelected(bytes, name => /^word\/(document|styles)\.xml$/.test(name));
  assert.equal(entries.get("word/document.xml"), DOCUMENT_XML);
  assert.equal(entries.get("word/styles.xml"), STYLES_XML);
  await assert.rejects(
    unzipSelected(new Uint8Array(64), () => true),
    /文档压缩结构无效/
  );
});

test("损坏的 deflate 照旧抛错，不当作没有这一条", async () => {
  const bytes = zip([{ name: "word/document.xml", method: 8, size: 1000, body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }]);
  await assert.rejects(
    unzipSelected(bytes, () => true),
    error => {
      assert.doesNotMatch(error.message, /文档压缩结构不符/);
      return true;
    }
  );
});

test("存储型（method 0）也照真长核对：声明小、实际多的条目同样中止", async () => {
  const bytes = zip([{ name: "word/document.xml", method: 0, size: 10, body: encoder.encode("x".repeat(200)) }]);
  await assert.rejects(
    unzipSelected(bytes, () => true),
    /文档压缩结构不符：word\/document\.xml 声明 10 字节/
  );
});
