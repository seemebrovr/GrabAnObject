import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


// Proximity grab with preserved offset and throw-on-release.
//
// While held, the object's velocity is driven each physics frame so it tracks the hand
// (this overrides gravity). On release we simply stop driving it, so the velocity from
// the last frame remains and the object is thrown with the hand's motion.
//
// The grabbed entity must be of type 'Physics' for velocity (and therefore throwing) to work.


type Hand = 'Left' | 'Right';

export type GrabbableOptions = {
  /** Called when a hand grabs this entity */
  onGrab?: (hand: Hand) => void,
  /** Called when a hand releases this entity */
  onRelease?: (hand: Hand) => void,
}

type GrabbableState = {
  entity: Entity,
  grabRadius: number,
  options: GrabbableOptions,
  heldBy: Hand | undefined,
  localPosOffset: Vector3,    // object position relative to the hand, in hand-local space, at grab time
  localRotOffset: Quaternion, // object rotation relative to the hand rotation at grab time
}


const grabbables = new Map<Entity, GrabbableState>();

// Each hand can hold at most one grabbable
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
    heldBy: undefined,
    localPosOffset: Vector3.zero,
    localRotOffset: Quaternion.one,
  });
}

/**
 * Remove an entity from the grabbable system (releasing it first if currently held)
 */
function remove(entity: Entity): void {
  const state = grabbables.get(entity);

  if (state && state.heldBy) {
    release(state.heldBy);
  }

  grabbables.delete(entity);
}

/**
 * @returns true if the entity is currently being held by a hand
 */
function isHeld(entity: Entity): boolean {
  return grabbables.get(entity)?.heldBy !== undefined;
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


function tryGrab(hand: Hand): void {
  if (handHeld.get(hand)) {
    return; // this hand is already holding something
  }

  const handPos = getHandPos(hand);
  const handRot = getHandRot(hand);

  if (!handPos || !handRot) {
    return;
  }

  // Find the nearest un-held grabbable within its grab radius
  let nearest: GrabbableState | undefined;
  let nearestDist = Infinity;

  grabbables.forEach((state) => {
    if (state.heldBy || !state.entity.exists()) {
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

  // Capture the object's current offset from the hand, expressed in the hand's local space,
  // so the object keeps its relative position and orientation while held.
  const invHandRot = handRot.inverse();

  nearest.localPosOffset = invHandRot.rotateVector(nearest.entity.pos.subtract(handPos));
  nearest.localRotOffset = invHandRot.multiply(nearest.entity.rot);
  nearest.heldBy = hand;

  handHeld.set(hand, nearest);

  nearest.options.onGrab?.(hand);
}

function release(hand: Hand): void {
  const state = handHeld.get(hand);

  if (!state) {
    return;
  }

  state.heldBy = undefined;
  handHeld.set(hand, undefined);

  // We stop overriding velocity here. The velocity set on the last frame remains on the
  // physics body, so the object continues moving along the hand's motion -> it is thrown.

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

  handHeld.forEach((state, hand) => {
    if (!state) {
      return;
    }

    // The held entity may have been destroyed elsewhere
    if (!state.entity.exists()) {
      handHeld.set(hand, undefined);
      return;
    }

    const handPos = getHandPos(hand);
    const handRot = getHandRot(hand);

    if (!handPos || !handRot) {
      return;
    }

    const targetPos = handPos.add(handRot.rotateVector(state.localPosOffset));
    const targetRot = handRot.multiply(state.localRotOffset);

    // Velocity-based move: reach the target this frame. As the hand moves, the required
    // velocity tracks the hand's velocity, which is exactly what we want left over on release.
    const requiredVel = targetPos.subtract(state.entity.pos).divide(deltaTime);
    state.entity.velocity.set(requiredVel);

    // No angular-velocity API is exposed, so match the hand's rotation directly.
    state.entity.rot = targetRot;
  });
}
