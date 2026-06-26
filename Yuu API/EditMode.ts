import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Events } from "./Events";
import { grabbable, Hand } from "./Grabbable";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";


// ============================================================================
// EditMode - a free-fly build mode.
// ----------------------------------------------------------------------------
//  - Toggle by clicking BOTH thumbsticks in at the same time.
//  - While active you float (the rig position is driven directly, so gravity is
//    overridden and your body passes through everything).
//  - Move by gripping EMPTY space and pulling: your rig slides opposite to your
//    hand, like climbing through the world. Two hands move you more smoothly.
//  - Gripping NEAR an object still grabs it (the grab system handles that), so a
//    hand that's holding something doesn't move you - you can carry a piece and
//    fly with the other hand.
// ============================================================================


type HandFlags = { Left: boolean, Right: boolean };
type HandVecs = { Left: Vector3, Right: Vector3 };

const hands: Hand[] = ['Left', 'Right'];


let active = false;

// The rig position we drive toward while in edit mode (our target).
let flyPos = Vector3.zero;

// Button down-states.
const gripDown: HandFlags = { Left: false, Right: false };
const thumbDown: HandFlags = { Left: false, Right: false };
let bothThumbsActive = false; // debounce so both-thumbsticks toggles once per press

// Per-hand locomotion tracking.
const wasWorldGripping: HandFlags = { Left: false, Right: false };
const lastHandLocal: HandVecs = { Left: Vector3.zero, Right: Vector3.zero };

const modeChangeCallbacks: ((isActive: boolean) => void)[] = [];


export const editMode = {
  /** Whether edit mode is currently on. */
  isActive: (): boolean => active,
  /** True while both thumbsticks are held (so other systems can ignore that press). */
  bothThumbsticksDown: (): boolean => thumbDown.Left && thumbDown.Right,
  /** Register a callback fired whenever edit mode turns on or off. */
  onModeChange: (callback: (isActive: boolean) => void): void => { modeChangeCallbacks.push(callback); },
}


function setActive(value: boolean): void {
  if (value === active) {
    return;
  }

  active = value;

  if (active) {
    const p = Player.position.get();
    flyPos = p ? p.clone() : Vector3.zero;

    wasWorldGripping.Left = false;
    wasWorldGripping.Right = false;

    console.log('Edit mode: ON - grip empty space to fly');
  }
  else {
    console.log('Edit mode: OFF');
  }

  modeChangeCallbacks.forEach((callback) => callback(active));
}


function handPos(hand: Hand): Vector3 | undefined {
  return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get();
}


registerStart(start);
function start() {
  Controller.subscribe('leftThumbstick', 'Pressed', () => onThumbPressed('Left'));
  Controller.subscribe('rightThumbstick', 'Pressed', () => onThumbPressed('Right'));
  Controller.subscribe('leftThumbstick', 'Released', () => onThumbReleased('Left'));
  Controller.subscribe('rightThumbstick', 'Released', () => onThumbReleased('Right'));

  Controller.subscribe('leftGrip', 'Pressed', () => { gripDown.Left = true; });
  Controller.subscribe('leftGrip', 'Released', () => { gripDown.Left = false; });
  Controller.subscribe('rightGrip', 'Pressed', () => { gripDown.Right = true; });
  Controller.subscribe('rightGrip', 'Released', () => { gripDown.Right = false; });

  Events.onPhysicsUpdate(onPhysicsUpdate);
}

function onThumbPressed(hand: Hand): void {
  thumbDown[hand] = true;

  if (thumbDown.Left && thumbDown.Right && !bothThumbsActive) {
    bothThumbsActive = true;
    setActive(!active);
  }
}

function onThumbReleased(hand: Hand): void {
  thumbDown[hand] = false;

  if (!(thumbDown.Left && thumbDown.Right)) {
    bothThumbsActive = false;
  }
}


function onPhysicsUpdate(deltaTime: number): void {
  if (!active) {
    return;
  }

  // Measure the hand against the rig's ACTUAL position (read fresh each frame),
  // not against our target. This closes the feedback loop, so the movement can't
  // run away even if the engine resists Player.position.set.
  const rigPos = Player.position.get();

  if (!rigPos) {
    return;
  }

  let move = Vector3.zero;
  let count = 0;

  hands.forEach((hand) => {
    // A hand moves you only when it grips empty space (not holding an object).
    const worldGripping = gripDown[hand] && grabbable.heldEntity(hand) === undefined;

    if (!worldGripping) {
      wasWorldGripping[hand] = false;
      return;
    }

    const handWorld = handPos(hand);

    if (!handWorld) {
      wasWorldGripping[hand] = false;
      return;
    }

    // Physical hand offset from the actual rig.
    const offset = handWorld.subtract(rigPos);

    if (wasWorldGripping[hand]) {
      const delta = offset.subtract(lastHandLocal[hand]);

      // Safety: ignore impossible single-frame jumps so nothing can fling you.
      if (delta.magnitude() < 0.3) {
        move = move.subtract(delta); // move opposite the hand's motion
        count++;
      }
    }

    lastHandLocal[hand] = offset;
    wasWorldGripping[hand] = true;
  });

  if (count > 0) {
    flyPos = flyPos.add(move.divide(count)); // average when both hands are pulling
  }

  // Drive the rig toward our target (holds you floating + applies movement).
  Player.position.set(flyPos);
}
