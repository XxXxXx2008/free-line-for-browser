import assert from "node:assert/strict";
import {
  createClipPolygons,
  normalizeAngle,
  polygonArea,
  rotateLineAroundPivot,
} from "../orange-split-extension/geometry.mjs";

function assertClose(actual, expected, tolerance = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

assert.equal(normalizeAngle(0), 0);
assert.equal(normalizeAngle(360), 0);
assert.equal(normalizeAngle(-90), 270);

for (const angle of [0, 17, 45, 90, 137, 271, 359]) {
  const width = 1280;
  const height = 720;
  const polygons = createClipPolygons({
    width,
    height,
    centerX: 512,
    centerY: 309,
    angle,
  });
  const totalArea =
    polygonArea(polygons.positive) + polygonArea(polygons.negative);
  assertClose(totalArea, width * height);
}

const centered = createClipPolygons({
  width: 1000,
  height: 600,
  centerX: 500,
  centerY: 300,
  angle: 0,
});
assertClose(polygonArea(centered.positive), 300000);
assertClose(polygonArea(centered.negative), 300000);
assert.ok(centered.positive.every((point) => point.y <= 300.0001));
assert.ok(centered.negative.every((point) => point.y >= 299.9999));

const edge = createClipPolygons({
  width: 800,
  height: 600,
  centerX: 0,
  centerY: 0,
  angle: 45,
});
assertClose(polygonArea(edge.positive) + polygonArea(edge.negative), 480000);

for (const side of ["left", "right"]) {
  const pivot = side === "left" ? { x: 760, y: 360 } : { x: 520, y: 360 };
  const pointer = side === "left" ? { x: 280, y: 210 } : { x: 920, y: 510 };
  const result = rotateLineAroundPivot({
    pointer,
    pivot,
    side,
    width: 1200,
    height: 800,
    minimumDimension: 800,
  });
  assert.ok(result);

  const radians = (result.angle * Math.PI) / 180;
  const center = { x: result.x * 1200, y: result.y * 800 };
  const radius = result.spanRatio * 800;
  const left = {
    x: center.x - Math.cos(radians) * radius,
    y: center.y - Math.sin(radians) * radius,
  };
  const right = {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };

  assertClose((side === "left" ? left : right).x, pointer.x);
  assertClose((side === "left" ? left : right).y, pointer.y);
  assertClose((side === "left" ? right : left).x, pivot.x);
  assertClose((side === "left" ? right : left).y, pivot.y);
}

console.log("Geometry tests passed.");
