// Office 编辑只改选中的 XML，其余 ZIP 局部记录（图、样式、关系）原样搬运，不解压也不重建。
"use strict";
const { crc32, deflateRawSync, inflateRawSync } = require("node:zlib");
const { isUtf8 } = require("node:buffer");
const LIMIT = 8 * 1024 * 1024;
const PART_LIMIT = 2 * 1024 * 1024;
const invalid = () => Error("文档压缩结构不支持编辑");
const extension = file => String(file).split(".").pop().toLowerCase();
function officePart(ext, name, writing = false) {
  if (ext === "docx") return name === "word/document.xml";
  if (ext === "xlsx")
    return (
      /^xl\/worksheets\/[^/]+\.xml$/.test(name) ||
      (!writing && ["xl/sharedStrings.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"].includes(name))
    );
  return ["odt", "ods"].includes(ext) && name === "content.xml";
}
function officeZip(buffer) {
  if (buffer.length > LIMIT) throw Error("文档超过编辑上限（8 MB）");
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50 && at + 22 + buffer.readUInt16LE(at + 20) === buffer.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw invalid();
  const count = buffer.readUInt16LE(end + 10),
    start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(end + 4) || buffer.readUInt16LE(end + 8) !== count || count > 4096 ||
      start + buffer.readUInt32LE(end + 12) !== end) throw invalid();
  const records = [],
    names = new Set();
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(at + 8),
      method = buffer.readUInt16LE(at + 10),
      size = buffer.readUInt32LE(at + 20),
      plain = buffer.readUInt32LE(at + 24),
      nameLen = buffer.readUInt16LE(at + 28),
      offset = buffer.readUInt32LE(at + 42),
      next = at + 46 + nameLen + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (next > end || offset + 30 > start || buffer.readUInt32LE(offset) !== 0x04034b50 ||
        flags & 0x2041 || buffer.readUInt16LE(at + 34) || size === 0xffffffff || plain === 0xffffffff) throw invalid();
    const label = buffer.subarray(at + 46, at + 46 + nameLen),
      name = label.toString("utf8"),
      localName = buffer.readUInt16LE(offset + 26),
      data = offset + 30 + localName + buffer.readUInt16LE(offset + 28);
    if (names.has(name) || !isUtf8(label) || localName !== nameLen ||
        !label.equals(buffer.subarray(offset + 30, offset + 30 + localName)) ||
        buffer.readUInt16LE(offset + 6) !== flags || buffer.readUInt16LE(offset + 8) !== method ||
        data + size > start || /(^|\/)(?:_xmlsignatures|documentsignatures\.xml|macrosignatures\.xml)(\/|$)/i.test(name))
      throw invalid();
    names.add(name);
    records.push({ name, flags, method, size, plain, offset, data, central: buffer.subarray(at, next), end: 0 });
    at = next;
  }
  if (at !== end || !records.length) throw invalid();
  const ordered = [...records].sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < ordered.length; i++) {
    const record = ordered[i];
    record.end = ordered[i + 1]?.offset ?? start;
    if (record.data + record.size > record.end) throw invalid();
  }
  return { records, ordered, footer: buffer.subarray(end) };
}
function readPart(buffer, record) {
  if (record.plain > PART_LIMIT) throw Error("文档内部 XML 超过编辑上限");
  const packed = buffer.subarray(record.data, record.data + record.size),
    plain = record.method === 0 ? packed : record.method === 8 ? inflateRawSync(packed, { maxOutputLength: PART_LIMIT }) : null;
  if (!plain || plain.length !== record.plain || crc32(plain) !== record.central.readUInt32LE(16) || !isUtf8(plain)) throw invalid();
  const text = plain.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || /<\?xml[^?]*encoding\s*=\s*["'](?!UTF-8["'])/i.test(text)) throw invalid();
  return text;
}
function readOffice(file, buffer) {
  const ext = extension(file),
    { records } = officeZip(buffer),
    parts = {};
  let total = 0;
  for (const record of records) {
    if (!officePart(ext, record.name)) continue;
    total += record.plain;
    if (total > LIMIT) throw Error("文档内部 XML 超过编辑上限");
    parts[record.name] = readPart(buffer, record);
  }
  if (!Object.keys(parts).some(name => officePart(ext, name, true))) throw invalid();
  return parts;
}
function patchOffice(file, buffer, parts) {
  const ext = extension(file),
    zip = officeZip(buffer);
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) throw invalid();
  const edits = new Map();
  let total = 0;
  for (const [name, text] of Object.entries(parts)) {
    const record = zip.records.find(r => r.name === name);
    if (!record || !officePart(ext, name, true) || typeof text !== "string" || /<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid();
    const plain = Buffer.from(text);
    total += plain.length;
    if (plain.length > PART_LIMIT || total > LIMIT) throw Error("文档内部 XML 超过编辑上限");
    if (readPart(buffer, record) !== text) edits.set(name, plain);
  }
  if (!edits.size) return buffer;
  const local = [buffer.subarray(0, zip.ordered[0].offset)],
    central = new Map();
  let offset = local[0].length;
  for (const record of zip.ordered) {
    const header = Buffer.from(record.central),
      plain = edits.get(record.name);
    let entry = buffer.subarray(record.offset, record.end);
    if (plain) {
      const prefix = Buffer.from(buffer.subarray(record.offset, record.data)),
        packed = record.method === 0 ? plain : deflateRawSync(plain),
        crc = crc32(plain),
        flags = record.flags & ~8;
      prefix.writeUInt16LE(flags, 6);
      prefix.writeUInt32LE(crc, 14);
      prefix.writeUInt32LE(packed.length, 18);
      prefix.writeUInt32LE(plain.length, 22);
      header.writeUInt16LE(flags, 8);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(packed.length, 20);
      header.writeUInt32LE(plain.length, 24);
      entry = Buffer.concat([prefix, packed]);
    }
    header.writeUInt32LE(offset, 42);
    central.set(record.name, header);
    local.push(entry);
    offset += entry.length;
  }
  const directory = Buffer.concat(zip.records.map(record => central.get(record.name))),
    footer = Buffer.from(zip.footer);
  footer.writeUInt32LE(directory.length, 12);
  footer.writeUInt32LE(offset, 16);
  if (offset + directory.length + footer.length > LIMIT) throw Error("文档超过编辑上限（8 MB）");
  return Buffer.concat([...local, directory, footer]);
}
module.exports = { readOffice, patchOffice };
