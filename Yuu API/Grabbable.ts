import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


// Proximity grab with preserved offset and throw-on-release.
//
// Supports one- OR two-handed holding:
//   - One hand:  the object tracks that hand's position AND rotation, keeping
//                whatever offset it had when grabbed.
//   - Two hands: the object tracks the midpoint between the two hands. Its
//                orientation is held fixed (no two-handed rotation) - moving the
//                hands slides it around, but does not turn it.
//
// Grabbing with a second hand, or releasing one of two hands, re-captures the
// offset so control passes smoothly without the object snapping.
//
// While held, the object's velocity is driven each physics frame so it tracks the
// grab frame (this overrides gravity). On full release we stop driving it, so the
// velocity from the last frame remains and the object is thrown with that motion.
//
// The grabbed entity must be of type 'Physics' for velocity (and throwing) to work.


type Hand = 'Left' | 'Right';

export type GrabbableOptions = {
  /** Called when a hand grabs this entity (fires for each hand) */
  onGrab?: (hand: Hand) => void,
  /** Called when a hand releases this entity (fires for each hand) */
  onRelease?: (hand: Hand) => void,
}

type GrabbableState = {
  entity: Entity,
  grabRadius: number,
  options: GrabbableOptions,
  heldBy: Hand[],             // hands currently holding this: 0, 1, or 2
  localPosOffset: Vector3,    // object position relative to the grab frame, in frame-local space
  localRotOffset: Quaternion, // object rotation relative to the grab frame
}


const grabbables = new Map<Entity, GrabbableState>();

// Each hand can hold at most one grabbable.
const handHeld = new Map<Hand, GrabbableState | undefined>([
  ['Left', undefined],
  ['Right', undefined],
]);


export const grabbable = {
  make,
  remove,
  isHeld,
  releaseAll,
}


/**
 * Register an entity so it can be grabbed when a hand is within range and the grip is squeezed.
 * Can be grabbed by either hand, or both hands at once.
 * @param entity the entity to make grabbable (should be a 'Physics' entity so it can be thrown)
 * @param grabRadius how close (in meters) a hand must be to grab it, defaults to 0.2
 * @param options optional onGrab / onRelease callbacks
 */
function make(entity: Entity, grabRadius: number = 0.2, options: GrabbableOptions = {}): void {
  if (entity.type !== 'Physics') {
    console.log('grabbable.make: entity should be a Physics entity for throw-on-release to work.');
  }

  grabbables.set(entity, {
    entity: entity,
    grabRadius: grabRadius,
    options: options,
    heldBy: [],
    localPosOffset: Vector3.zero,
    localRotOffset: Quaternion.one,
  });
}

/**
 * Remove an entity from the grabbable system (releasing it from any hands first)
 */
function remove(entity: Entity): void {
  const state = grabbables.get(entity);

  if (state) {
    [...state.heldBy].forEach((hand) => release(hand));
  }

  grabbables.delete(entity);
}

/**
 * @returns true if the entity is currently being held by at least one hand
 */
function isHeld(entity: Entity): boolean {
  const state = grabbables.get(entity);

  return state !== undefined && state.heldBy.length > 0;
}

/**
 * Release whatever both hands are currently holding
 */
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


/**
 * The "grab frame" is the moving reference the held object is locked to:
 *   - one hand:  origin = hand position, rot = hand rotation
 *   - two hands: origin = midpoint of the hands, rot = identity (a non-rotating
 *                frame, so the object keeps a fixed orientation)
 * Returns undefined if a required hand transform isn't available this frame.
 */
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

    // Midpoint, with a fixed (identity) orientation -> position follows the hands,
    // rotation stays put.
    return { origin: posA.lerp(posB, 0.5), rot: Quaternion.one };
  }

  return undefined;
}

/**
 * Capture the object's current offset from the current grab frame, so that
 * changing which hands hold it doesn't make it jump.
 */
function captureOffset(state: GrabbableState): void {
  const frame = getGrabFrame(state);

  if (!frame) {
    return;
  }

  const invFrameRot = frame.rot.inverse();

  state.localPosOffset = invFrameRot.rotateVector(state.entity.pos.subtract(frame.origin));
  state.localRotOffset = invFrameRot.multiply(state.entity.rot);
}


function tryGrab(hand: Hand): void {
  if (handHeld.get(hand)) {
    return; // this hand is already holding something
  }

  const handPos = getHandPos(hand);

  if (!handPos) {
    return;
  }

  // Find the nearest grabbable within range that this hand isn't already holding.
  // An object held by the OTHER hand is allowed -> that becomes a two-handed grab.
  let nearest: GrabbableState | undefined;
  let nearestDist = Infinity;

  grabbables.forEach((state) => {
    if (state.heldBy.includes(hand) || !state.entity.exists()) {
      return;
    }

    const dist = state.entity.pos.distanceTo(handPos);

    if (dist <= state.grabRadius && dist < nearestDist) {
      nearest = state;
      nearestDist = dist;
    }
  });

  if (!nearest) {
    return;
  }

  nearest.heldBy.push(hand);
  handHeld.set(hand, nearest);

  // Re-capture against the new grab frame (now possibly two-handed).
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

  // If another hand is still holding it, re-capture against the new (single-hand)
  // frame so control passes smoothly instead of snapping.
  if (state.heldBy.length > 0) {
    captureOffset(state);
  }

  // When the last hand lets go we stop driving velocity. The velocity set on the
  // last frame remains on the physics body, so the object keeps the grab frame's
  // motion -> it is thrown.

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

  grabbables.forEach((state) => {
    if (state.heldBy.length === 0) {
      return;
    }

    // The held entity may have been destroyed elsewhere.
    if (!state.entity.exists()) {
      state.heldBy.forEach((hand) => handHeld.set(hand, undefined));
      state.heldBy = [];
      return;
    }

    const frame = getGrabFrame(state);

    if (!frame) {
      return;
    }

    const targetPos = frame.origin.add(frame.rot.rotateVector(state.localPosOffset));
    const targetRot = frame.rot.multiply(state.localRotOffset);

    // Velocity-based move: reach the target this frame. As the grab frame moves,
    // the required velocity tracks its motion, which is what we want left over on
    // release (for throwing).
    const requiredVel = targetPos.subtract(state.entity.pos).divide(deltaTime);
    state.entity.velocity.set(requiredVel);

    // No angular-velocity API is exposed, so match the target rotation directly.
    state.entity.rot = targetRot;
  });
}
