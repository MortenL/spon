export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const X_AXIS: Readonly<Vec3> = Object.freeze(vec3(1, 0, 0));
export const Y_AXIS: Readonly<Vec3> = Object.freeze(vec3(0, 1, 0));
export const Z_AXIS: Readonly<Vec3> = Object.freeze(vec3(0, 0, 1));

export const v3add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const v3dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const v3length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function v3normalize(a: Vec3): Vec3 {
  const len = v3length(a);
  return len === 0 ? vec3(0, 0, 0) : vec3(a.x / len, a.y / len, a.z / len);
}

export function v3near(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}
