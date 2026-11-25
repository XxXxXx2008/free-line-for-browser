import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(
  workspaceDirectory,
  "orange-split-extension",
  "icons",
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    rgba.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function roundedRectangleInside(x, y, size, inset, radius) {
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function distanceToDiagonal(x, y, size) {
  const x1 = size * 0.19;
  const y1 = size * 0.81;
  const x2 = size * 0.81;
  const y2 = size * 0.19;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const projection = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );
  const projectedX = x1 + projection * dx;
  const projectedY = y1 + projection * dy;
  return Math.hypot(x - projectedX, y - projectedY);
}

function colorAt(x, y, size) {
  if (!roundedRectangleInside(x, y, size, size * 0.035, size * 0.23)) {
    return null;
  }

  const lineDistance = distanceToDiagonal(x, y, size);
  if (lineDistance < size * 0.047) {
    return [255, 118, 26, 255];
  }
  if (lineDistance < size * 0.075) {
    return [255, 253, 248, 255];
  }

  return x + y < size
    ? [242, 233, 220, 255]
    : [41, 69, 65, 255];
}

function createIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const sampleGrid = 4;
  const sampleCount = sampleGrid * sampleGrid;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sampleY = 0; sampleY < sampleGrid; sampleY += 1) {
        for (let sampleX = 0; sampleX < sampleGrid; sampleX += 1) {
          const px = x + (sampleX + 0.5) / sampleGrid;
          const py = y + (sampleY + 0.5) / sampleGrid;
          const color = colorAt(px, py, size);
          if (color) {
            red += color[0];
            green += color[1];
            blue += color[2];
            alpha += color[3];
          }
        }
      }

      const offset = (y * size + x) * 4;
      const alphaSamples = alpha / 255;
      if (alphaSamples > 0) {
        rgba[offset] = Math.round(red / alphaSamples);
        rgba[offset + 1] = Math.round(green / alphaSamples);
        rgba[offset + 2] = Math.round(blue / alphaSamples);
      }
      rgba[offset + 3] = Math.round(alpha / sampleCount);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(outputDirectory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const outputPath = path.join(outputDirectory, `icon-${size}.png`);
  writeFileSync(outputPath, createIcon(size));
  console.log(outputPath);
}
