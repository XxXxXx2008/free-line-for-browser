const EPSILON = 1e-7;

export function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function signedDistance(point, normalX, normalY, offset) {
  return point.x * normalX + point.y * normalY - offset;
}

function intersectSegment(start, end, startDistance, endDistance) {
  const denominator = startDistance - endDistance;
  if (Math.abs(denominator) < EPSILON) {
    return { ...end };
  }

  const t = startDistance / denominator;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function clipPolygonToHalfPlane(points, normalX, normalY, offset, keepPositive) {
  if (points.length === 0) {
    return [];
  }

  const output = [];
  let previous = points[points.length - 1];
  let previousDistance = signedDistance(previous, normalX, normalY, offset);
  let previousInside = keepPositive
    ? previousDistance >= -EPSILON
    : previousDistance <= EPSILON;

  for (const current of points) {
    const currentDistance = signedDistance(current, normalX, normalY, offset);
    const currentInside = keepPositive
      ? currentDistance >= -EPSILON
      : currentDistance <= EPSILON;

    if (currentInside !== previousInside) {
      output.push(
        intersectSegment(previous, current, previousDistance, currentDistance),
      );
    }

    if (currentInside) {
      output.push({ ...current });
    }

    previous = current;
    previousDistance = currentDistance;
    previousInside = currentInside;
  }

  return output;
}

export function createClipPolygons({
  width,
  height,
  centerX,
  centerY,
  angle,
}) {
  if (!(width > 0) || !(height > 0)) {
    return {
      positive: [],
      negative: [],
      normalX: 0,
      normalY: -1,
    };
  }

  const radians = (normalizeAngle(angle) * Math.PI) / 180;
  const normalX = Math.sin(radians);
  const normalY = -Math.cos(radians);
  const offset = centerX * normalX + centerY * normalY;
  const rectangle = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  return {
    positive: clipPolygonToHalfPlane(
      rectangle,
      normalX,
      normalY,
      offset,
      true,
    ),
    negative: clipPolygonToHalfPlane(
      rectangle,
      normalX,
      normalY,
      offset,
      false,
    ),
    normalX,
    normalY,
  };
}

export function polygonArea(points) {
  if (points.length < 3) {
    return 0;
  }

  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceArea) / 2;
}

export function polygonToClipPath(points) {
  if (points.length < 3) {
    return "polygon(0 0, 0 0, 0 0)";
  }

  const coordinates = points
    .map((point) => `${point.x.toFixed(2)}px ${point.y.toFixed(2)}px`)
    .join(", ");

  return `polygon(${coordinates})`;
}

export function rotateLineAroundPivot({
  pointer,
  pivot,
  side,
  width,
  height,
  minimumDimension,
  minimumDistance = 56,
  maximumSpanRatio = 0.46,
}) {
  const deltaX = pointer.x - pivot.x;
  const deltaY = pointer.y - pivot.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < minimumDistance || !(minimumDimension > 0)) {
    return null;
  }

  const directionSign = side === "right" ? 1 : -1;
  const directionX = (directionSign * deltaX) / distance;
  const directionY = (directionSign * deltaY) / distance;
  const centerX = (pointer.x + pivot.x) / 2;
  const centerY = (pointer.y + pivot.y) / 2;

  return {
    x: centerX / width,
    y: centerY / height,
    angle: normalizeAngle(
      (Math.atan2(directionY, directionX) * 180) / Math.PI,
    ),
    spanRatio: Math.min(
      Math.max(distance / 2 / minimumDimension, 0.06),
      maximumSpanRatio,
    ),
  };
}
