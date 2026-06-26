import { Vector3 } from "./Vector3";


const quaternionEpsilon = 0.000001;


export class Quaternion {
  public x: number;
  public y: number;
  public z: number;
  public w: number;


  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }


  equals(quaternion: Quaternion, epsilon: number = quaternionEpsilon): boolean {
    return Math.abs(this.x - quaternion.x) < epsilon &&
      Math.abs(this.y - quaternion.y) < epsilon &&
      Math.abs(this.z - quaternion.z) < epsilon &&
      Math.abs(this.w - quaternion.w) < epsilon;
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  toString(): string {
    return `Quaternion(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
  }


  static get zero(): Quaternion { return new Quaternion(0, 0, 0, 0); }
  static get one(): Quaternion { return new Quaternion(0, 0, 0, 1); }


  /**
   * Creates a Quaternion from Euler Rotation in Radians
   * @param vec3 with rotation amounts in Radians
   * @returns Quaternion rotation
   */
  static fromEuler(vec3: Vector3): Quaternion {
    const c1 = Math.cos(vec3.y * 0.5);
    const c2 = Math.cos(vec3.z * 0.5);
    const c3 = Math.cos(vec3.x * 0.5);
    const s1 = Math.sin(vec3.y * 0.5);
    const s2 = Math.sin(vec3.z * 0.5);
    const s3 = Math.sin(vec3.x * 0.5);

    return new Quaternion(
      s3 * c1 * c2 - c3 * s1 * s2, // x
      c3 * s1 * c2 + s3 * c1 * s2, // y
      c3 * c1 * s2 - s3 * s1 * c2, // z
      c3 * c1 * c2 + s3 * s1 * s2  // w
    );
  }


  static equals(q1: Quaternion, q2: Quaternion, epsilon: number = quaternionEpsilon): boolean { return q1.equals(q2, epsilon); }
  static clone(vector: Quaternion): Quaternion { return vector.clone(); }
  static toString(vector: Quaternion): string { return vector.toString(); }

  /**
   * Returns a quaternion rotated from q1 to q2 by some percent of the way there
   * @param q1 starting rotation
   * @param q2 ending rotation
   * @param percent of the way to the end
   * @returns a new Quaternion
   */
  static slerp(q1: Quaternion, q2: Quaternion, percent: number): Quaternion {
    percent = Math.max(0, Math.min(1, percent));

    let ax = q1.x, ay = q1.y, az = q1.z, aw = q1.w;
    let bx = q2.x, by = q2.y, bz = q2.z, bw = q2.w;

    let cos = ax * bx + ay * by + az * bz + aw * bw;

    if (cos < 0) {
      cos = -cos;
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }

    if (cos > 0.9995) {
      const k = 1 - percent;
      return new Quaternion(
        k * ax + percent * bx,
        k * ay + percent * by,
        k * az + percent * bz,
        k * aw + percent * bw
      );
    }

    const theta = Math.acos(cos);
    const sinTheta = Math.sin(theta);

    const w1 = Math.sin((1 - percent) * theta) / sinTheta;
    const w2 = Math.sin(percent * theta) / sinTheta;

    return new Quaternion(
      ax * w1 + bx * w2,
      ay * w1 + by * w2,
      az * w1 + bz * w2,
      aw * w1 + bw * w2
    );
  }

  multiply(q: Quaternion): Quaternion {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x, by = q.y, bz = q.z, bw = q.w;

    return new Quaternion(
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    );
  }

  /**
   * Returns the conjugate (negated vector part). For a unit (rotation) quaternion this equals the inverse.
   */
  conjugate(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  /**
   * Returns the inverse rotation. Applying a rotation and then its inverse results in no rotation.
   */
  inverse(): Quaternion {
    const lenSq = this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;

    if (lenSq < quaternionEpsilon) {
      return Quaternion.one;
    }

    const inv = 1 / lenSq;

    return new Quaternion(-this.x * inv, -this.y * inv, -this.z * inv, this.w * inv);
  }

  /**
   * Rotates a Vector3 by this quaternion
   * @param vec3 the vector to rotate
   * @returns a new rotated Vector3
   */
  rotateVector(vec3: Vector3): Vector3 {
    // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
    const tx = 2 * (this.y * vec3.z - this.z * vec3.y);
    const ty = 2 * (this.z * vec3.x - this.x * vec3.z);
    const tz = 2 * (this.x * vec3.y - this.y * vec3.x);

    return new Vector3(
      vec3.x + this.w * tx + (this.y * tz - this.z * ty),
      vec3.y + this.w * ty + (this.z * tx - this.x * tz),
      vec3.z + this.w * tz + (this.x * ty - this.y * tx)
    );
  }

  static conjugate(q: Quaternion): Quaternion { return q.conjugate(); }
  static inverse(q: Quaternion): Quaternion { return q.inverse(); }
  static rotateVector(q: Quaternion, vec3: Vector3): Vector3 { return q.rotateVector(vec3); }

  /**
   * Calculates the forward and calls Quaternion.lookAt
   * @param from pos to look from
   * @param to look at
   * @param up direction
   * @returns rotation
   */
  static lookFromTo(from: Vector3, to: Vector3, up: Vector3): Quaternion {
    const forward = to.subtract(from).normalize();
    
    return this.lookAt(forward, up);
  }

  static lookAt(forward: Vector3, up: Vector3) {
    const right = Vector3.cross(up, forward).normalize();
    const rightAngleUp = Vector3.cross(forward, right);

    const trace = right.x + rightAngleUp.y + forward.z;
    const s = 0.5 / Math.sqrt(trace + 1.0);

    return new Quaternion(
      (rightAngleUp.z - forward.y) * s,
      (forward.x - right.z) * s,
      (right.y - rightAngleUp.x) * s,
      0.25 / s
    );
  }
}
