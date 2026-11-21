const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function workshopZip(entries) {
  const local = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [name, data] of entries) {
    const filename = encoder.encode(name);
    const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
    const checksum = crc32(bytes);
    const entry = new Uint8Array(30 + filename.length);
    const a = new DataView(entry.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(6, 0x800, true);
    a.setUint32(14, checksum, true); a.setUint32(18, bytes.length, true); a.setUint32(22, bytes.length, true);
    a.setUint16(26, filename.length, true); entry.set(filename, 30);
    const central = new Uint8Array(46 + filename.length);
    const b = new DataView(central.buffer);
    b.setUint32(0, 0x02014b50, true); b.setUint16(4, 20, true); b.setUint16(6, 20, true); b.setUint16(8, 0x800, true);
    b.setUint32(16, checksum, true); b.setUint32(20, bytes.length, true); b.setUint32(24, bytes.length, true);
    b.setUint16(28, filename.length, true); b.setUint32(42, offset, true); central.set(filename, 46);
    local.push(entry, bytes);
    directory.push(central);
    offset += entry.length + bytes.length;
    directorySize += central.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true); end.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end.buffer], { type: 'application/zip' });
}

export function workshopCsv(logs) {
  const rows = [['Date', 'Type', 'Status', 'Title', 'Odometer (mi)', 'Log cost (USD)', 'Notes'],
    ...logs.map(log => [log.date, log.type, log.status, log.title, log.mileage ?? '', (log.cost / 100).toFixed(2), log.notes])];
  return rows.map(row => row.map(value => {
    const escaped = String(value).replace(/^([\s]*[=+@-])/, "'$1");
    return '"' + escaped.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
