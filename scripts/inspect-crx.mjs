import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const inputPath = path.resolve(
  process.argv[2] || "orange-split-extension.crx",
);
const bytes = readFileSync(inputPath);
const magic = bytes.subarray(0, 4).toString("ascii");
const version = bytes.readUInt32LE(4);
const headerLength = bytes.readUInt32LE(8);
const header = bytes.subarray(12, 12 + headerLength);

function readVarint(buffer, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    shift += 7;
  }
  throw new Error("Invalid protobuf varint.");
}

function readFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 7;

    if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      fields.push({
        fieldNumber,
        wireType,
        value: buffer.subarray(offset, offset + length.value),
      });
      offset += length.value;
    } else if (wireType === 0) {
      const value = readVarint(buffer, offset);
      fields.push({ fieldNumber, wireType, value: value.value });
      offset = value.offset;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}.`);
    }
  }
  return fields;
}

function extensionIdFromPublicKey(publicKey) {
  const digest = createHash("sha256").update(publicKey).digest("hex");
  return digest
    .slice(0, 32)
    .split("")
    .map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
    .join("");
}

if (magic !== "Cr24" || version !== 3) {
  throw new Error("Not a CRX3 file.");
}

const headerFields = readFields(header);
const proofs = headerFields.filter(
  (field) =>
    field.wireType === 2 &&
    (field.fieldNumber === 2 || field.fieldNumber === 3),
);

const keys = proofs.map((proof) => {
  const proofFields = readFields(proof.value);
  const publicKey = proofFields.find((field) => field.fieldNumber === 1)?.value;
  if (!publicKey) {
    throw new Error("CRX proof is missing a public key.");
  }
  return {
    algorithm: proof.fieldNumber === 2 ? "RSA" : "ECDSA",
    publicKeyBytes: publicKey.length,
    extensionId: extensionIdFromPublicKey(publicKey),
  };
});

console.log(
  JSON.stringify(
    {
      path: inputPath,
      bytes: bytes.length,
      magic,
      version,
      headerLength,
      keys,
    },
    null,
    2,
  ),
);
