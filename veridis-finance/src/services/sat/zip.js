/**
 * Minimal ZIP reader for SAT Descarga Masiva packages.
 *
 * The SAT generates its packages with .NET, which often writes "streaming"
 * entries: the local file header carries ZERO sizes (general-purpose flag bit 3)
 * and the real sizes live in a data descriptor after the data — and always in
 * the CENTRAL DIRECTORY at the end of the file. A naive sequential local-header
 * walk silently reads nothing on those files, so we parse the central directory
 * (authoritative sizes + offsets) and only fall back to the sequential walk for
 * truncated buffers with no directory.
 *
 * Supports STORE (method 0) and DEFLATE (method 8) — everything the SAT uses.
 */

const zlib = require('node:zlib');

const LOCAL_SIG = 0x04034b50; // "PK\x03\x04"
const CENTRAL_SIG = 0x02014b50; // "PK\x01\x02"
const EOCD_SIG = 0x06054b50; // "PK\x05\x06"

function inflateEntry(method, compData) {
  if (method === 0) return Buffer.from(compData);
  if (method === 8) return zlib.inflateRawSync(compData);
  return Buffer.alloc(0); // unknown method — skip content, keep going
}

/** Find the End Of Central Directory record (scan the last 64KB + 22 bytes). */
function findEocd(buf) {
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Authoritative path: walk the central directory. */
function readViaCentralDirectory(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) break;

    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    // The local header repeats name/extra with ITS OWN lengths (extra often
    // differs from the central one) — read them from the local header itself.
    if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === LOCAL_SIG) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      if (!name.endsWith('/')) {
        try {
          entries.push({ name, data: inflateEntry(method, compData) });
        } catch {
          /* one corrupt entry never kills the package */
        }
      }
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** Fallback: sequential local-header walk (only works without streaming bit). */
function readViaLocalHeaders(buf) {
  const entries = [];
  let offset = 0;

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_SIG) break;

    const generalFlag = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;

    // Streaming entry with unknown size — can't walk past it safely.
    if ((generalFlag & 0x08) !== 0 && compSize === 0) break;

    const compData = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      try {
        entries.push({ name, data: inflateEntry(method, compData) });
      } catch {
        /* skip corrupt entry */
      }
    }

    offset = dataStart + compSize;
    if (offset + 4 <= buf.length && buf.readUInt32LE(offset) === CENTRAL_SIG) break;
  }

  return entries;
}

/**
 * @param {Buffer} buf  raw ZIP bytes
 * @returns {Array<{ name: string, data: Buffer }>}
 */
function readZipEntries(buf) {
  const viaCentral = readViaCentralDirectory(buf);
  if (viaCentral && viaCentral.length) return viaCentral;
  return readViaLocalHeaders(buf);
}

module.exports = { readZipEntries };
