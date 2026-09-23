// tests/render/support/zip64-fixture.ts
// [ARCHIEF-WAAR] Rewrite a real zip (as JSZip writes it) into ZIP64 form, byte for byte per
// APPNOTE 4.3.14–4.3.16 and 4.5.3 — and, on request, into specific malformed variants.
//
// JSZip never writes ZIP64, and a small archive never needs it; but writers that stream (or that
// force ZIP64) put the 32-bit placeholders 0xFFFF / 0xFFFFFFFF in the ordinary records and the real
// values in ZIP64 records. These fixtures are how the tests reach that shape without a 4 GB file.

export interface Zip64Options {
  /** Move each record's sizes into a ZIP64 extra field (0x0001); the record keeps placeholders. */
  sizes?: boolean;
  /** Move each record's local-header offset into the ZIP64 extra field as well. */
  offsets?: boolean;
  /** Write a ZIP64 end record + locator, and placeholders in the classic end record. */
  endRecord?: boolean;
  /** Bytes of "extensible data" in the ZIP64 end record — it is a variable-length record. */
  extensible?: number;
  // ── malformed variants ──
  /** Placeholders in the directory records, but no ZIP64 extra field to resolve them. */
  omitExtra?: boolean;
  /** Placeholders in the classic end record, but no locator and no ZIP64 end record. */
  omitLocator?: boolean;
  /** Added to the ZIP64 end record's own size field (so it no longer ends at the locator). */
  recordSizeSkew?: number;
  /** Added to the ZIP64 end record's total-entries field. */
  countSkew?: number;
  /** Added to the locator's offset of the ZIP64 end record. */
  locatorSkew?: number;
  /** The extensible block claims more data than the sector holds. */
  extensibleOverrun?: boolean;
}

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

export function zip64ify(zip: Buffer, o: Zip64Options): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("fixture: no end record");
  const count = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const local = zip.subarray(0, cdOffset);

  const records: Buffer[] = [];
  let pos = cdOffset;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("fixture: bad directory record");
    const nameLen = zip.readUInt16LE(pos + 28), extraLen = zip.readUInt16LE(pos + 30), commentLen = zip.readUInt16LE(pos + 32);
    const fixed = Buffer.from(zip.subarray(pos, pos + 46));
    const name = zip.subarray(pos + 46, pos + 46 + nameLen);
    const extra = zip.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
    const comment = zip.subarray(pos + 46 + nameLen + extraLen, pos + 46 + nameLen + extraLen + commentLen);
    const values: Buffer[] = [];
    if (o.sizes) {
      values.push(u64(fixed.readUInt32LE(24)), u64(fixed.readUInt32LE(20))); // uncompressed, compressed
      fixed.writeUInt32LE(0xffffffff, 24);
      fixed.writeUInt32LE(0xffffffff, 20);
    }
    if (o.offsets) {
      values.push(u64(fixed.readUInt32LE(42)));
      fixed.writeUInt32LE(0xffffffff, 42);
    }
    let z64extra = Buffer.alloc(0);
    if (values.length && !o.omitExtra) {
      const data = Buffer.concat(values);
      z64extra = Buffer.concat([u16(0x0001), u16(data.length), data]);
    }
    const newExtra = Buffer.concat([extra, z64extra]);
    fixed.writeUInt16LE(newExtra.length, 30);
    records.push(Buffer.concat([fixed, name, newExtra, comment]));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (pos !== cdOffset + cdSize) throw new Error("fixture: directory size mismatch");
  const cd = Buffer.concat(records);

  if (!o.endRecord) {
    const end = Buffer.from(zip.subarray(eocd));
    end.writeUInt32LE(cd.length, 12);
    return Buffer.concat([local, cd, end]);
  }

  // APPNOTE 4.3.14.2: the extensible data sector holds blocks of Header ID (2) + Data Size (4) + data.
  const extLen = o.extensible ?? 0;
  if (extLen !== 0 && extLen < 6) throw new Error("fixture: an extensible block needs at least 6 bytes");
  const ext = extLen === 0 ? Buffer.alloc(0)
    : Buffer.concat([u16(0x4242), u32(extLen - 6 + (o.extensibleOverrun ? 4 : 0)), Buffer.alloc(extLen - 6, 0x5a)]);
  const z64end = Buffer.concat([
    u32(0x06064b50),
    u64(44 + ext.length + (o.recordSizeSkew ?? 0)), // size of the record after these 12 bytes
    u16(45), u16(45),                                // version made by / needed
    u32(0), u32(0),                                  // this disk, disk with the directory
    u64(count), u64(count + (o.countSkew ?? 0)),     // entries on this disk, total entries
    u64(cd.length), u64(cdOffset),
    ext,
  ]);
  const z64Offset = cdOffset + cd.length;
  const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(z64Offset + (o.locatorSkew ?? 0)), u32(1)]);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0xffff), u16(0xffff), u16(0xffff), u16(0xffff),
    u32(0xffffffff), u32(0xffffffff), u16(0),
  ]);
  return o.omitLocator
    ? Buffer.concat([local, cd, end])
    : Buffer.concat([local, cd, z64end, locator, end]);
}
