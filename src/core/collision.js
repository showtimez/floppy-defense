// Collision helpers on the XZ plane (the board) and in 3D.

export function distSqXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distXZ(a, b) {
  return Math.sqrt(distSqXZ(a, b));
}

// Sphere vs sphere in 3D.
export function spheresOverlap(aPos, aR, bPos, bR) {
  const dx = aPos.x - bPos.x;
  const dy = aPos.y - bPos.y;
  const dz = aPos.z - bPos.z;
  const r = aR + bR;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

// Circle vs circle on XZ (ignores height). Use for range checks.
export function circlesOverlapXZ(aPos, aR, bPos, bR) {
  const r = aR + bR;
  return distSqXZ(aPos, bPos) <= r * r;
}

// Swept test: does segment p0->p1 pass within r of point c? (prevents fast projectiles tunnelling)
export function segmentHitsSphere(p0, p1, c, r) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? -(fx * dx + fy * dy + fz * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
  return px * px + py * py + pz * pz <= r * r;
}
