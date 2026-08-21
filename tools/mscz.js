"use strict";

const zlib = require("node:zlib");

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const STORE = 0;
const DEFLATE = 8;

// CRC-32, needed because zip stores a checksum per entry and MuseScore
// rejects archives whose checksums do not match.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function findEndOfCentralDirectory(buf) {
  // The end record is at the tail, after a comment of at most 65535 bytes.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === END_SIG) return i;
  }
  throw new Error("not a zip archive: no end-of-central-directory record");
}

function readMscz(buffer) {
  const end = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error("corrupt zip: bad central directory signature");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`corrupt zip: bad local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === STORE) entries.set(name, Buffer.from(raw));
    else if (method === DEFLATE) entries.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`unsupported compression method ${method} for ${name}`);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  const mainName = [...entries.keys()].find((n) => n.endsWith(".mscx") && !n.includes("Excerpts/"))
    || [...entries.keys()].find((n) => n.endsWith(".mscx"));
  if (!mainName) throw new Error("archive contains no .mscx score");

  return { entries, mainName };
}

function writeMscz(archive) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, contents] of archive.entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(contents, { level: 9 });
    const useDeflate = deflated.length < contents.length;
    const payload = useDeflate ? deflated : contents;
    const method = useDeflate ? DEFLATE : STORE;
    const crc = crc32(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);            // mod time
    local.writeUInt16LE(0, 12);            // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(archive.entries.size, 8);
  end.writeUInt16LE(archive.entries.size, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

function replaceMain(archive, newText) {
  const entries = new Map(archive.entries);
  entries.set(archive.mainName, Buffer.from(newText, "utf8"));
  return { entries, mainName: archive.mainName };
}

module.exports = { readMscz, writeMscz, replaceMain, crc32 };
