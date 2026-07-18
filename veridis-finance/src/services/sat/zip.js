/**
 * Minimal ZIP reader for SAT Descarga Masiva packages.
 *
 * The SAT returns each package as a base64 ZIP. For a "Metadata" request the ZIP
 * holds a single ~pipe-delimited text file (UUID | RFC emisor | RFC receptor |
 * Fecha | Total | …); for a "CFDI" request it holds one .xml per comprobante.
 * We only need to enumerate entries and inflate their bytes — no writing, no
 * directory traversal, no zip64 — so a tiny reader beats pulling in a dependency.
 *
 * Supports STORE (method 0) and DEFLATE (method 8), which is everything the SAT
 * uses. Reads local file headers sequentially; ignores the central directory.
 */

const zlib = require('node:zlib');

const LOCAL_SIG = 0x04034b50; // "PK\x03\x04"
const CENTRAL_SIG = 0x02014b50; // "PK\x01\x02" — start of central directory

/**
 * @param {Buffer} buf  raw ZIP bytes
 * @returns {Array<{ name: string, data: Buffer }>}
 */
function readZipEntries(buf) {
  const entries = [];
  let offset = 0;

  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_SIG) break; // hit central directory or padding

    const generalFlag = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    let compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;

    // Streaming entries (bit 3 set) don't carry sizes in the local header; the
    // SAT doesn't use this, but guard rather than mis-slice.
    if ((generalFlag & 0x08) !== 0 && compSize === 0) {
      break;
    }

    const compData = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compData);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compData);
    } else {
      // Unknown method — skip its bytes but keep going.
      data = Buffer.alloc(0);
    }

    // Directories end in "/" and have no content.
    if (!name.endsWith('/')) {
      entries.push({ name, data });
    }

    offset = dataStart + compSize;

    // Cheap sanity stop if the next signature is the central directory.
    if (offset + 4 <= buf.length && buf.readUInt32LE(offset) === CENTRAL_SIG) {
      break;
    }
  }

  return entries;
}

module.exports = { readZipEntries };
