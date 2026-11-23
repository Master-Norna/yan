// 文档里要的那一份太大（解压后过 8 MB 或合计过 16 MB）：以前悄悄跳过，抽出来是空文，看着像「这份文档没内容」；
// 现在明确抛错，由上传时记下 extractionError、发问与预览时照实说
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 一个不压缩的 zip：中央目录里声称 word/document.xml 解压后是 claimed 字节（实际只存了一个字节，
// 但太大这一档在解压之前就判了，不会读到假的长度）
function zipClaiming(name, claimed) {
  const label = Buffer.from(name),
    data = Buffer.from("x"),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(label.length, 26);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(claimed, 24);
  central.writeUInt16LE(label.length, 28);
  central.writeUInt32LE(0, 42);
  const locals = Buffer.concat([local, label, data]),
    directory = Buffer.concat([central, label]),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(locals.length, 16);
  return new Uint8Array(Buffer.concat([locals, directory, end]));
}

test("文档里的一份太大：说清是哪一份，不悄悄抽出空文", async () => {
  const f = load(["extractDocumentText"]);
  await assert.rejects(
    () => f.extractDocumentText("论文.docx", zipClaiming("word/document.xml", 9 * 1024 * 1024)),
    /太大（word\/document\.xml）/
  );
});
