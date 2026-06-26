import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// Proximity grab with preserved offset, throw-on-release, one/two-handed holding,
// surface grabbing, grid snapping, collidable preference, a player-launch shield,
// and a yellow proximity highlight.
//
// By default the GRIP grabs. In edit mode the grip is needed for flying, so the
// project can switch grabbing to the TRIGGER: setGripEnabled(false) stops grip
// from grabbing, and grab()/release() can be driven from the trigger instead.


export type Hand = 'Left' | 'Right';

export type GrabbableOptions = {
  onGrab?: (hand: Hand) => void,
  onRelease?: (hand: Hand) => void,
  grabPoints?: Vector3[],
  grabBox?: Vector3,
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
  collidablePref: boolean,
  twoHandStartDist: number,
  twoHandStartScale: Vector3,
  heldBy: Hand[],
  localPosOffset: Vector3,
  localRotOffset: Quaternion,
  shielded: boolean,
  shieldPose: Pose | undefined,
  highlighted: boolean,
  snapGhost: Entity | undefined,
  pendingSnap: Pose | undefined,
}


const grabbables = new Map<Entity, GrabbableState>();

const handHeld = new Map<Hand, GrabbableState | undefined>([
  ['Left', undefined],
  ['Right', undefined],
]);

const playerBodyReach = 0.25;

// When false, the grip no longer grabs (used in edit mode, where grip = movement
// and grabbing is driven from the trigger via grab()/release()).
let gripEnabled = true;

// Yellow glow shown when a hand is near or inside a grabbable.
const highlightColor = new Color(1, 0.85, 0.1);
const highlightStrength = 1.5;
const highlightRange = 0.07; // metres from the surface (or inside) to start glowing

// Object-to-object snapping. A held object previews a translucent "ghost" at the
// flush pose against a nearby object's nearest face (edges/corners aligned on the
// other two axes), then hard-snaps there on release.
const maxSnapDistance = 0.2; // how far the object may move to reach a snap
const ghostColor = new Color(0.3, 0.9, 1);
const ghostAlpha = 0.3;


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
  forceGrab,
  grab: tryGrab,
  releaseHand: release,
  setGripEnabled,
}


function make(entity: Entity, grabRadius: number = 0.2, options: GrabbableOptions = {}): void {
  if (entity.type !== 'Physics') {
    console.log('grabbable.make: entity should be a Physics entity for throw-on-release to work.');
  }

  grabbables.set(entity, {
    entity, grabRadius, options,
    grabPoints: options.grabPoints ?? [],
    grabBox: options.grabBox,
    snapGrid: options.snapGrid ?? 0,
    snapEnabled: false,
    collidablePref: true,
    twoHandStartDist: 0.05,
    twoHandStartScale: Vector3.one,
    heldBy: [],
    localPosOffset: Vector3.zero,
    localRotOffset: Quaternion.one,
    shielded: false,
    shieldPose: undefined,
    highlighted: false,
    snapGhost: undefined,
    pendingSnap: undefined,
  });
}

function remove(entity: Entity): void {
  const s = grabbables.get(entity);
  if (s) { [...s.heldBy].forEach((h) => release(h)); destroyGhost(s); }
  grabbables.delete(entity);
}

function isHeld(entity: Entity): boolean {
  const s = grabbables.get(entity);
  return s !== undefined && s.heldBy.length > 0;
}

function heldBy(entity: Entity): Hand[] {
  const s = grabbables.get(entity);
  return s ? [...s.heldBy] : [];
}

function heldEntity(hand: Hand): Entity | undefined { return handHeld.get(hand)?.entity; }
function setGrabPoints(entity: Entity, points: Vector3[]): void { const s = grabbables.get(entity); if (s) { s.grabPoints = points; } }
function setGrabBox(entity: Entity, halfExtents: Vector3): void { const s = grabbables.get(entity); if (s) { s.grabBox = halfExtents; } }
function setSnapEnabled(entity: Entity, enabled: boolean): void { const s = grabbables.get(entity); if (s) { s.snapEnabled = enabled; } }
function getSnapEnabled(entity: Entity): boolean { return grabbables.get(entity)?.snapEnabled ?? false; }
function setCollidable(entity: Entity, collidable: boolean): void { const s = grabbables.get(entity); if (s) { s.collidablePref = collidable; if (s.heldBy.length === 0 && !s.shielded) { entity.collidable.set(collidable); } } }
function getCollidable(entity: Entity): boolean { return grabbables.get(entity)?.collidablePref ?? true; }

/** Enable/disable grip grabbing. When off, grabbing is driven from grab()/release(). */
function setGripEnabled(enabled: boolean): void { gripEnabled = enabled; }

function releaseAll(): void { release('Left'); release('Right'); }

function forceGrab(entity: Entity, hand: Hand): void {
  const s = grabbables.get(entity);
  if (!s || handHeld.get(hand) || s.heldBy.includes(hand)) { return; }
  const hp = getHandPos(hand);
  if (hp) { entity.pos = hp; }
  const wasUnheld = s.heldBy.length === 0;
  s.heldBy.push(hand);
  handHeld.set(hand, s);
  if (wasUnheld) { if (s.shielded) { s.shielded = false; s.shieldPose = undefined; } entity.collidable.set(false); }
  captureOffset(s);
  captureTwoHandStart(s);
  s.options.onGrab?.(hand);
}

function getHandPos(hand: Hand): Vector3 | undefined { return hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get(); }
function getHandRot(hand: Hand): Quaternion | undefined { return hand === 'Left' ? Player.leftHand.rotation.get() : Player.rightHand.rotation.get(); }

function getGrabFrame(s: GrabbableState): { origin: Vector3, rot: Quaternion } | undefined {
  if (s.heldBy.length === 1) {
    const p = getHandPos(s.heldBy[0]);
    const r = getHandRot(s.heldBy[0]);
    if (!p || !r) { return undefined; }
    return { origin: p, rot: r };
  }
  if (s.heldBy.length >= 2) {
    const a = getHandPos(s.heldBy[0]);
    const b = getHandPos(s.heldBy[1]);
    if (!a || !b) { return undefined; }
    return { origin: a.lerp(b, 0.5), rot: Quaternion.one };
  }
  return undefined;
}

function captureOffset(s: GrabbableState): void {
  const f = getGrabFrame(s);
  if (!f) { return; }
  const inv = f.rot.inverse();
  s.localPosOffset = inv.rotateVector(s.entity.pos.subtract(f.origin));
  s.localRotOffset = inv.multiply(s.entity.rot);
}

function captureTwoHandStart(s: GrabbableState): void {
  if (s.heldBy.length !== 2) { return; }
  const a = getHandPos(s.heldBy[0]);
  const b = getHandPos(s.heldBy[1]);
  if (a && b) { s.twoHandStartDist = Math.max(a.distanceTo(b), 0.05); s.twoHandStartScale = s.entity.scale; }
}

function applyTwoHandStretch(s: GrabbableState): void {
  if (s.heldBy.length < 2) { return; }
  const a = getHandPos(s.heldBy[0]);
  const b = getHandPos(s.heldBy[1]);
  if (!a || !b) { return; }
  const f = a.distanceTo(b) / s.twoHandStartDist;
  const n = new Vector3(Math.max(s.twoHandStartScale.x * f, 0.02), Math.max(s.twoHandStartScale.y * f, 0.02), Math.max(s.twoHandStartScale.z * f, 0.02));
  s.entity.scale = n;
  if (s.grabBox) { s.grabBox = new Vector3(n.x / 2, n.y / 2, n.z / 2); }
}

// Signed distance from a point to the box surface (negative inside).
function boxSurfaceDistance(center: Vector3, rot: Quaternion, half: Vector3, point: Vector3): number {
  const l = rot.inverse().rotateVector(point.subtract(center));
  const qx = Math.abs(l.x) - half.x;
  const qy = Math.abs(l.y) - half.y;
  const qz = Math.abs(l.z) - half.z;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt((ox * ox) + (oy * oy) + (oz * oz)) + Math.min(Math.max(qx, qy, qz), 0);
}

function halfExtentsOf(s: GrabbableState): Vector3 {
  if (s.grabBox) { return s.grabBox; }
  const sc = s.entity.scale;
  return new Vector3(sc.x / 2, sc.y / 2, sc.z / 2);
}

function handGrabDistance(s: GrabbableState, hp: Vector3): number {
  if (s.grabBox) { return Math.abs(boxSurfaceDistance(s.entity.pos, s.entity.rot, s.grabBox, hp)); }
  if (s.grabPoints.length > 0) {
    const pos = s.entity.pos;
    const rot = s.entity.rot;
    let n = Infinity;
    s.grabPoints.forEach((lp) => { const d = pos.add(rot.rotateVector(lp)).distanceTo(hp); if (d < n) { n = d; } });
    return n;
  }
  return s.entity.pos.distanceTo(hp);
}

// Signed (negative inside) for the highlight, so reaching INTO an object glows too.
function handHighlightDistance(s: GrabbableState, hp: Vector3): number {
  if (s.grabBox) { return boxSurfaceDistance(s.entity.pos, s.entity.rot, s.grabBox, hp); }
  return handGrabDistance(s, hp);
}

function updateHighlight(s: GrabbableState): void {
  const lh = getHandPos('Left');
  const rh = getHandPos('Right');

  let near = false;
  if (lh && handHighlightDistance(s, lh) < highlightRange) { near = true; }
  if (!near && rh && handHighlightDistance(s, rh) < highlightRange) { near = true; }

  if (near !== s.highlighted) {
    s.highlighted = near;
    if (near) {
      s.entity.mesh.material.emissionColor.set(highlightColor);
      s.entity.mesh.material.emissionStrength.set(highlightStrength);
    }
    else {
      s.entity.mesh.material.emissionColor.set(Color.black); // black disables emission
    }
  }
}

function tryGrab(hand: Hand): void {
  if (handHeld.get(hand)) { return; }
  const hp = getHandPos(hand);
  if (!hp) { return; }
  let nearest: GrabbableState | undefined;
  let nd = Infinity;
  grabbables.forEach((s) => {
    if (s.heldBy.includes(hand) || !s.entity.exists()) { return; }
    const d = handGrabDistance(s, hp);
    if (d <= s.grabRadius && d < nd) { nearest = s; nd = d; }
  });
  if (!nearest) { return; }
  const wasUnheld = nearest.heldBy.length === 0;
  nearest.heldBy.push(hand);
  handHeld.set(hand, nearest);
  if (wasUnheld) { if (nearest.shielded) { nearest.shielded = false; nearest.shieldPose = undefined; } nearest.entity.collidable.set(false); }
  captureOffset(nearest);
  captureTwoHandStart(nearest);
  nearest.options.onGrab?.(hand);
}

function release(hand: Hand): void {
  const s = handHeld.get(hand);
  if (!s) { return; }
  s.heldBy = s.heldBy.filter((h) => h !== hand);
  handHeld.set(hand, undefined);

  if (s.heldBy.length > 0) { captureOffset(s); s.options.onRelease?.(hand); return; }

  // Fully released: restore collision, then snap into place if enabled.
  s.entity.collidable.set(s.collidablePref);
  if (s.snapEnabled) {
    if (s.pendingSnap) {
      s.entity.pos = s.pendingSnap.pos;
      s.entity.rot = s.pendingSnap.rot;
    } else {
      s.entity.rot = snapRotation(s.entity.rot); // straighten in place when nothing is near
    }
    s.entity.velocity.set(Vector3.zero);
  }
  destroyGhost(s);
  s.pendingSnap = undefined;
  s.options.onRelease?.(hand);
}

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
  Controller.subscribe('leftGrip', 'Pressed', () => { if (gripEnabled) { tryGrab('Left'); } });
  Controller.subscribe('leftGrip', 'Released', () => { if (gripEnabled) { release('Left'); } });
  Controller.subscribe('rightGrip', 'Pressed', () => { if (gripEnabled) { tryGrab('Right'); } });
  Controller.subscribe('rightGrip', 'Released', () => { if (gripEnabled) { release('Right'); } });
}

function onPhysicsUpdate(deltaTime: number) {
  if (deltaTime <= 0) { return; }
  const bodyPos = Player.body.position.get();

  grabbables.forEach((s) => {
    if (!s.entity.exists()) {
      if (s.heldBy.length > 0) { s.heldBy.forEach((h) => handHeld.set(h, undefined)); s.heldBy = []; }
      return;
    }

    updateHighlight(s);

    if (s.heldBy.length > 0) {
      const f = getGrabFrame(s);
      if (!f) { return; }
      const tp = f.origin.add(f.rot.rotateVector(s.localPosOffset));
      const tr = f.rot.multiply(s.localRotOffset);
      s.entity.velocity.set(tp.subtract(s.entity.pos).divide(deltaTime));
      s.entity.rot = tr;
      applyTwoHandStretch(s);
      if (s.snapEnabled) { updateSnapPreview(s); } else { clearSnap(s); }
      return;
    }

    if (bodyPos) { applyPlayerShield(s, bodyPos); }
  });
}

let snapCache: Quaternion[] | undefined;
function snapOrientations(): Quaternion[] {
  if (!snapCache) {
    const a = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const list: Quaternion[] = [];
    a.forEach((x) => { a.forEach((y) => { a.forEach((z) => { list.push(Quaternion.fromEuler(new Vector3(x, y, z))); }); }); });
    snapCache = list;
  }
  return snapCache;
}
function snapRotation(q: Quaternion): Quaternion {
  const c = snapOrientations();
  let best = c[0];
  let bd = -1;
  c.forEach((x) => { const d = Math.abs((q.x * x.x) + (q.y * x.y) + (q.z * x.z) + (q.w * x.w)); if (d > bd) { bd = d; best = x; } });
  return best.clone();
}


// --- object-to-object snapping ---------------------------------------------

function absVec(v: Vector3): Vector3 { return new Vector3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)); }
function axisGet(v: Vector3, i: number): number { return i === 0 ? v.x : (i === 1 ? v.y : v.z); }
function nearestOf(target: number, options: number[]): number {
  let best = options[0];
  let bd = Math.abs(options[0] - target);
  for (let i = 1; i < options.length; i++) { const d = Math.abs(options[i] - target); if (d < bd) { bd = d; best = options[i]; } }
  return best;
}

/**
 * Best flush pose for `s` against a nearby object. Anchor-to-anchor, never
 * pivot-to-pivot: the held object contacts the target on the nearest face, and
 * its edges/corners line up on the other two axes (nearest of low/centre/high).
 * Rotation is straightened to the nearest 90 degrees. Returns undefined if no
 * object is within reach.
 */
function computeSnapCandidate(s: GrabbableState): Pose | undefined {
  const gbA = s.grabBox;
  if (!gbA) { return undefined; }
  const rotA = snapRotation(s.entity.rot);
  const heA = absVec(rotA.rotateVector(gbA));
  const cA = s.entity.pos;

  let best: Pose | undefined;
  let bestScore = maxSnapDistance;

  grabbables.forEach((o) => {
    const gbB = o.grabBox;
    if (o === s || o.heldBy.length > 0 || !o.entity.exists() || !gbB) { return; }
    const cB = o.entity.pos;
    const delta = cA.subtract(cB);
    if (delta.magnitude() > 2.0) { return; } // coarse reject
    const heB = absVec(o.entity.rot.rotateVector(gbB));

    // Contact axis = axis of greatest centre separation.
    let k = 0;
    if (Math.abs(delta.y) > Math.abs(axisGet(delta, k))) { k = 1; }
    if (Math.abs(delta.z) > Math.abs(axisGet(delta, k))) { k = 2; }

    const out = [cA.x, cA.y, cA.z];
    for (let j = 0; j < 3; j++) {
      if (j === k) {
        const sign = axisGet(delta, j) >= 0 ? 1 : -1;
        out[j] = axisGet(cB, j) + sign * (axisGet(heB, j) + axisGet(heA, j)); // flush faces
      } else {
        const lo = axisGet(cB, j) - axisGet(heB, j) + axisGet(heA, j); // low edges aligned
        const ce = axisGet(cB, j);                                     // centred
        const hi = axisGet(cB, j) + axisGet(heB, j) - axisGet(heA, j); // high edges aligned
        out[j] = nearestOf(axisGet(cA, j), [lo, ce, hi]);
      }
    }

    const pos = new Vector3(out[0], out[1], out[2]);
    const disp = pos.subtract(cA).magnitude();
    if (disp < bestScore) { bestScore = disp; best = { pos, rot: rotA }; }
  });

  return best;
}

function makeGhost(): Entity {
  const g = spawnPrimitive.cube(Vector3.zero, Vector3.one, Quaternion.one, ghostColor, ghostAlpha, false, 'Empty', undefined);
  g.visible.set(false);
  return g;
}

function updateSnapPreview(s: GrabbableState): void {
  const cand = computeSnapCandidate(s);
  s.pendingSnap = cand;

  if (cand && s.grabBox) {
    if (!s.snapGhost || !s.snapGhost.exists()) { s.snapGhost = makeGhost(); }
    s.snapGhost.visible.set(true);
    s.snapGhost.pos = cand.pos;
    s.snapGhost.rot = cand.rot;
    s.snapGhost.scale = new Vector3(s.grabBox.x * 2, s.grabBox.y * 2, s.grabBox.z * 2);
  } else if (s.snapGhost && s.snapGhost.exists()) {
    s.snapGhost.visible.set(false);
  }
}

function clearSnap(s: GrabbableState): void {
  s.pendingSnap = undefined;
  if (s.snapGhost && s.snapGhost.exists()) { s.snapGhost.visible.set(false); }
}

function destroyGhost(s: GrabbableState): void {
  if (s.snapGhost && s.snapGhost.exists()) { s.snapGhost.destroy(); }
  s.snapGhost = undefined;
}

function applyPlayerShield(s: GrabbableState, bodyPos: Vector3): boolean {
  if (!s.collidablePref) { return false; }
  const sd = boxSurfaceDistance(s.entity.pos, s.entity.rot, halfExtentsOf(s), bodyPos);
  if (sd < playerBodyReach) {
    if (!s.shielded) { s.shielded = true; s.shieldPose = { pos: s.entity.pos.clone(), rot: s.entity.rot.clone() }; s.entity.collidable.set(false); }
    if (s.shieldPose) { s.entity.pos = s.shieldPose.pos; s.entity.rot = s.shieldPose.rot; s.entity.velocity.set(Vector3.zero); }
    return true;
  }
  if (s.shielded) { s.shielded = false; s.shieldPose = undefined; s.entity.collidable.set(s.collidablePref); }
  return false;
}
