import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


// Proximity grab with preserved offset and throw-on-release. Supports one- or
// two-handed holding, surface grabbing, grid snapping, a per-object collidable
// preference, and avoids launching the player:
//   - While held, an object is "ghosted" (collision off) so it can't shove the
//     player or jitter on the world, and follows the hand smoothly.
//   - A non-held object near the player's body is ghosted + pinned, so you pass
//     through it instead of being thrown.
//   - With snapping on, a non-held object is held to a grid position with an
//     axis-aligned rotation (so it stays put and perfectly straight).
//   - The Collide preference (get/setCollidable) is restored after ghosting.


export type Hand = 'Left' | 'Right';

export type GrabbableOptions = {
  onGrab?: (hand: Hand) => void,
  onRelease?: (hand: Hand) => void,
  /** Discrete local-space anchor points to grab near (used if grabBox is unset). */
  grabPoints?: Vector3[],
  /** Local half-extents; if set, grab anywhere within grabRadius of the box surface. */
  grabBox?: Vector3,
  /** Grid cell size (meters) used when snapping is enabled. 0 = never snap. */
  snapGrid?: number,
}

type Pose = { pos: Vector3, rot: Quaternion };

type GrabbableState = {
  entity: Entity,
  grabRadius: number,
  options: GrabbableOptions,
  grabPoints: Vector3[],
  grabBox: Vector3 | undefined,
  snapGrid: number,
  snapEnabled: boolean,
  collidablePref: boolean,      // the user's chosen collidable state (restored after ghosting)
  heldBy: Hand[],
  localPosOffset: Vector3,
  localRotOffset: Quaternion,
  shielded: boolean,            // currently phased out because the player body is close
  shieldPose: Pose | undefined,
}


const grabbables = new Map<Entity, GrabbableState>();

// Each hand can hold at most one grabbable.
const handHeld = new Map<Hand, GrabbableState | undefined>([
  ['Left', undefined],
  ['Right', undefined],
]);

// How close the player's body may get to a non-held object before it phases out.
const playerBodyReach = 0.25;


export const grabbable = {
  make,
  remove,
  isHeld,
  releaseAll,
  heldBy,
  heldEntity,
  setGrabPoints,
  setGrabBox,
  setSnapEnabled,
  getSnapEnabled,
  setCollidable,
  getCollidable,
}


function make(entity: Entity, grabRadius: number = 0.2, options: GrabbableOptions = {}): void {
  if (entity.type !== 'Physics') {
    console.log('grabbable.make: entity should be a Physics entity for throw-on-release to work.');
  }

  grabbables.set(entity, {
    entity: entity,
    grabRadius: grabRadius,
    options: options,
    grabPoints: options.grabPoints ?? [],
    grabBox: options.grabBox,
    snapGrid: options.snapGrid ?? 0,
    snapEnabled: false,
    collidablePref: true,
    heldBy: [],
    localPosOffset: Vector3.zero,
    localRotOffset: Quaternion.one,
    shielded: false,
    shieldPose: undefined,
  });
}

function remove(entity: Entity): void {
  const state = grabbables.get(entity);

  if (state) {
    [...state.heldBy].forEach((hand) => release(hand));
  }

  grabbables.delete(entity);
}

function isHeld(entity: Entity): boolean {
  const state = grabbables.get(entity);

  return state !== undefined && state.heldBy.length > 0;
}

function heldBy(entity: Entity): Hand[] {
  const state = grabbables.get(entity);

  return state ? [...state.heldBy] : [];
}

function heldEntity(hand: Hand): Entity | undefined {
  return handHeld.get(hand)?.entity;
}

function setGrabPoints(entity: Entity, points: Vector3[]): void {
  const state = grabbables.get(entity);

  if (state) {
    state.grabPoints = points;
  }
}

function setGrabBox(entity: Entity, halfExtents: Vector3): void {
  const state = grabbables.get(entity);

  if (state) {
    state.grabBox = halfExtents;
  }
}

function setSnapEnabled(entity: Entity, enabled: boolean): void {
  const state = grabbables.get(entity);

  if (state) {
    state.snapEnabled = enabled;
  }
}

function getSnapEnabled(entity: Entity): boolean {
  return grabbables.get(entity)?.snapEnabled ?? false;
}

function setCollidable(entity: Entity, collidable: boolean): void {
  const state = grabbables.get(entity);

  if (state) {
    state.collidablePref = collidable;

    // Apply now unless the object is currently force-ghosted (held or shielded);
    // in those cases the preference is applied when it un-ghosts.
    if (state.heldBy.length === 0 && !state.shielded) {
      entity.collidable.set(collidable);
    }
  }
}

function getCollidable(entity: Entity): boolean {
  return grabbables.get(entity)?.collidablePref ?? true;
}

function releaseAll(): void {
  release('Left');
  release('Right');
}


function getHandPos(hand: Hand): Vector3 | undefined {
  return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get();
}

function getHandRot(hand: Hand): Quaternion | undefined {
  return hand === 'Left' ? Player.leftHand.rotation.get() : Player.rightHand.rotation.get();
}


function getGrabFrame(state: GrabbableState): { origin: Vector3, rot: Quaternion } | undefined {
  if (state.heldBy.length === 1) {
    const pos = getHandPos(state.heldBy[0]);
    const rot = getHandRot(state.heldBy[0]);

    if (!pos || !rot) {
      return undefined;
    }

    return { origin: pos, rot: rot };
  }

  if (state.heldBy.length >= 2) {
    const posA = getHandPos(state.heldBy[0]);
    const posB = getHandPos(state.heldBy[1]);

    if (!posA || !posB) {
      return undefined;
    }

    return { origin: posA.lerp(posB, 0.5), rot: Quaternion.one };
  }

  return undefined;
}

function captureOffset(state: GrabbableState): void {
  const frame = getGrabFrame(state);

  if (!frame) {
    return;
  }

  const invFrameRot = frame.rot.inverse();

  state.localPosOffset = invFrameRot.rotateVector(state.entity.pos.subtract(frame.origin));
  state.localRotOffset = invFrameRot.multiply(state.entity.rot);
}


// Signed distance from a world point to an axis-aligned box (in the box's local
// frame). Negative inside, positive outside, 0 on the surface.
function boxSurfaceDistance(center: Vector3, rot: Quaternion, half: Vector3, point: Vector3): number {
  const local = rot.inverse().rotateVector(point.subtract(center));

  const qx = Math.abs(local.x) - half.x;
  const qy = Math.abs(local.y) - half.y;
  const qz = Math.abs(local.z) - half.z;

  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);

  const outside = Math.sqrt((ox * ox) + (oy * oy) + (oz * oz));
  const inside = Math.min(Math.max(qx, qy, qz), 0);

  return outside + inside;
}

function halfExtentsOf(state: GrabbableState): Vector3 {
  if (state.grabBox) {
    return state.grabBox;
  }

  const s = state.entity.scale;

  return new Vector3(s.x / 2, s.y / 2, s.z / 2);
}

function handGrabDistance(state: GrabbableState, handPos: Vector3): number {
  if (state.grabBox) {
    return Math.abs(boxSurfaceDistance(state.entity.pos, state.entity.rot, state.grabBox, handPos));
  }

  if (state.grabPoints.length > 0) {
    const pos = state.entity.pos;
    const rot = state.entity.rot;

    let nearest = Infinity;

    state.grabPoints.forEach((localPoint) => {
      const worldPoint = pos.add(rot.rotateVector(localPoint));
      const dist = worldPoint.distanceTo(handPos);

      if (dist < nearest) {
        nearest = dist;
      }
    });

    return nearest;
  }

  return state.entity.pos.distanceTo(handPos);
}


// Axis-aligned (multiples of 90 degrees) candidate orientations, built once.
let snapOrientationsCache: Quaternion[] | undefined;

function snapOrientations(): Quaternion[] {
  if (!snapOrientationsCache) {
    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const list: Quaternion[] = [];

    angles.forEach((x) => {
      angles.forEach((y) => {
        angles.forEach((z) => {
          list.push(Quaternion.fromEuler(new Vector3(x, y, z)));
        });
      });
    });

    snapOrientationsCache = list;
  }

  return snapOrientationsCache;
}

// Snap a rotation to the nearest axis-aligned (90-degree) orientation, keeping
// which way the object is turned (so a box placed along Z stays along Z).
function snapRotation(q: Quaternion): Quaternion {
  const candidates = snapOrientations();

  let best = candidates[0];
  let bestDot = -1;

  candidates.forEach((c) => {
    // |dot| because q and -q are the same rotation; nearest = largest |dot|.
    const dot = Math.abs((q.x * c.x) + (q.y * c.y) + (q.z * c.z) + (q.w * c.w));

    if (dot > bestDot) {
      bestDot = dot;
      best = c;
    }
  });

  return best.clone();
}


function tryGrab(hand: Hand): void {
  if (handHeld.get(hand)) {
    return;
  }

  const handPos = getHandPos(hand);

  if (!handPos) {
    return;
  }

  let nearest: GrabbableState | undefined;
  let nearestDist = Infinity;

  grabbables.forEach((state) => {
    if (state.heldBy.includes(hand) || !state.entity.exists()) {
      return;
    }

    const dist = handGrabDistance(state, handPos);

    if (dist <= state.grabRadius && dist < nearestDist) {
      nearest = state;
      nearestDist = dist;
    }
  });

  if (!nearest) {
    return;
  }

  const wasUnheld = nearest.heldBy.length === 0;

  nearest.heldBy.push(hand);
  handHeld.set(hand, nearest);

  // Ghost the object while held so it can't shove the player or snag on the world.
  if (wasUnheld) {
    if (nearest.shielded) {
      nearest.shielded = false;
      nearest.shieldPose = undefined;
    }

    nearest.entity.collidable.set(false);
  }

  captureOffset(nearest);

  nearest.options.onGrab?.(hand);
}

function release(hand: Hand): void {
  const state = handHeld.get(hand);

  if (!state) {
    return;
  }

  state.heldBy = state.heldBy.filter((h) => h !== hand);
  handHeld.set(hand, undefined);

  if (state.heldBy.length > 0) {
    // Still held by the other hand: re-capture so control passes smoothly.
    captureOffset(state);
  }
  else {
    // Fully released: restore the user's collidable preference. (Grid snapping,
    // if on, is applied continuously in onPhysicsUpdate.)
    state.entity.collidable.set(state.collidablePref);
  }

  state.options.onRelease?.(hand);
}


registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);

  Controller.subscribe('leftGrip', 'Pressed', () => tryGrab('Left'));
  Controller.subscribe('leftGrip', 'Released', () => release('Left'));
  Controller.subscribe('rightGrip', 'Pressed', () => tryGrab('Right'));
  Controller.subscribe('rightGrip', 'Released', () => release('Right'));
}

function onPhysicsUpdate(deltaTime: number) {
  if (deltaTime <= 0) {
    return;
  }

  const bodyPos = Player.body.position.get();

  grabbables.forEach((state) => {
    if (!state.entity.exists()) {
      if (state.heldBy.length > 0) {
        state.heldBy.forEach((hand) => handHeld.set(hand, undefined));
        state.heldBy = [];
      }
      return;
    }

    // Held: drive the object to follow the grab frame (it is ghosted already).
    if (state.heldBy.length > 0) {
      const frame = getGrabFrame(state);

      if (!frame) {
        return;
      }

      const targetPos = frame.origin.add(frame.rot.rotateVector(state.localPosOffset));
      const targetRot = frame.rot.multiply(state.localRotOffset);

      const requiredVel = targetPos.subtract(state.entity.pos).divide(deltaTime);
      state.entity.velocity.set(requiredVel);
      state.entity.rot = targetRot;
      return;
    }

    // Not held: shield the player from being launched by this object.
    const shielded = bodyPos ? applyPlayerShield(state, bodyPos) : false;

    // Snapping on: hold a grid position and an axis-aligned rotation every frame
    // so it stays put and perfectly straight (no physics tipping).
    if (!shielded && state.snapEnabled && state.snapGrid > 0) {
      const g = state.snapGrid;
      const p = state.entity.pos;

      state.entity.pos = new Vector3(
        Math.round(p.x / g) * g,
        Math.round(p.y / g) * g,
        Math.round(p.z / g) * g,
      );
      state.entity.rot = snapRotation(state.entity.rot);
      state.entity.velocity.set(Vector3.zero);
    }
  });
}

// Returns true if the object is currently shielded (phased out near the player).
function applyPlayerShield(state: GrabbableState, bodyPos: Vector3): boolean {
  // If the user already made it non-collidable, there's nothing to shield.
  if (!state.collidablePref) {
    return false;
  }

  const surfaceDist = boxSurfaceDistance(state.entity.pos, state.entity.rot, halfExtentsOf(state), bodyPos);

  if (surfaceDist < playerBodyReach) {
    if (!state.shielded) {
      state.shielded = true;
      state.shieldPose = { pos: state.entity.pos.clone(), rot: state.entity.rot.clone() };
      state.entity.collidable.set(false);
    }

    if (state.shieldPose) {
      state.entity.pos = state.shieldPose.pos;
      state.entity.rot = state.shieldPose.rot;
      state.entity.velocity.set(Vector3.zero);
    }

    return true;
  }

  if (state.shielded) {
    state.shielded = false;
    state.shieldPose = undefined;
    state.entity.collidable.set(state.collidablePref);
  }

  return false;
}
