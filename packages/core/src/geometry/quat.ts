import { v3cross, v3dot, v3normalize, type Vec3, vec3 } from './vec3';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const QUAT_IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Hamilton product. The resulting rotation applies `b` first, then `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  return len === 0 ? { ...QUAT_IDENTITY } : { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatFromAxisAngle(axis: Vec3, degrees: number): Quat {
  const a = v3normalize(axis);
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(half) };
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const r = v3dot(from, to) + 1;
  if (r < 1e-12) {
    // Opposite vectors: rotate 180° about any axis perpendicular to `from`.
    return quatNormalize(
      Math.abs(from.x) > Math.abs(from.z)
        ? { x: -from.y, y: from.x, z: 0, w: 0 }
        : { x: 0, y: -from.z, z: from.y, w: 0 },
    );
  }
  const c = v3cross(from, to);
  return quatNormalize({ x: c.x, y: c.y, z: c.z, w: r });
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + w·t + q×t, where t = 2·(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec3(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
}
