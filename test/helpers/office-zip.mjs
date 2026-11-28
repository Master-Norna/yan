import { crc32, deflateRawSync } from "node:zlib";

export function officeZipFixture(parts) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const label = Buffer.from(name),
      plain = Buffer.from(text),
      packed = deflateRawSync(plain),
      l = Buffer.alloc(30),
      c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(plain), 14);
    l.writeUInt32LE(packed.length, 18);
    l.writeUInt32LE(plain.length, 22);
    l.writeUInt16LE(label.length, 26);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(plain), 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(plain.length, 24);
    c.writeUInt16LE(label.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, label, packed);
    central.push(c, label);
    offset += l.length + label.length + packed.length;
  }
  const dir = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
