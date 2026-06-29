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
// surface grabbing, collidable preference, a player-launch shield, and a yellow
// proximity highlight.
//
// SNAPPING (Horizon-style upgrade): a snap-enabled held piece previews a ghost of
// where it will land and hard-snaps on release. Built in numbered layers:
//   1 type rules      - canSnap() compatibility table, filtered before scoring
//   2 overlap reject   - candidate AABB tested against placed pieces
//   3 hysteresis       - locked target sticks until a rival clearly wins
//   4 local alignment  - flush math done in the neighbour's local frame (rotated ok)
//   5 grid fallback     - open-space release quantises to snapGrid + 90 deg yaw
//   6 feedback         - ghost blue(search)/green(valid)/red(blocked) + audio hook
//   7 broadphase       - a uniform spatial hash feeds the candidate search
//
// By default the GRIP grabs; in edit mode grabbing is driven from the TRIGGER via
// grab()/release() with setGripEnabled(false).


export type Hand = 'Left' | 'Right';

export type GrabbableOptions = {
  onGrab?: (hand: Hand) => void,
  onRelease?: (hand: Hand) => void,
  grabPoints?: Vector3[],
  grabBox?: Vector3,
  snapGrid?: number,
  snapCategory?: string, // [1] e.g. 'wall' | 'floor' | 'door' | 'prop'
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
  snapCategory: string,                  // [1]
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
  snapTargetEntity: Entity | undefined,  // [3] currently locked snap neighbour
  snapScore: number,                     // [3]
  prevSnapValidTarget: Entity | undefined, // [6] for the "new lock" sound edge
  hashKey: string | undefined,           // [7]
  inHash: boolean,                       // [7]
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


// --- Snap tunables (edit these to change the feel) --------------------------
const maxSnapDistance = 0.2;        // [base] max distance a piece may move to reach a neighbour snap
const ghostAlpha = 0.3;             // [base] ghost translucency
const ghostColorSearching = new Color(0.30, 0.60, 1.0);  // [6] blue: searching / grid fallback
const ghostColorValid = new Color(0.20, 0.95, 0.45);     // [6] green: a valid snap is locked
const ghostColorInvalid = new Color(0.95, 0.25, 0.25);   // [6] red: nearest slot is occupied / blocked
const snapOverlapTolerance = 0.01;  // [2] slack so flush (touching) faces are not read as overlapping
const snapHysteresis = 0.12;        // [3] a rival must beat the locked target's score by 12% to steal it
const defaultSnapGrid = 0.1;        // [5] grid cell used when a piece has no snapGrid of its own
const snapCellSize = 0.5;           // [7] spatial-hash cell size in metres (>= maxSnapDistance + piece size)

// [1] Category compatibility table - the single place to edit what snaps to what.
// canSnap() is symmetric: listing it in either direction is enough.
const snapCompatibility: { [category: string]: string[] } = {
  wall: ['wall', 'floor', 'door', 'window'],
  floor: ['floor', 'wall', 'prop'],
  door: ['wall'],
  window: ['wall'],
  prop: ['prop', 'floor'],
};
function canSnap(a: string, b: string): boolean {
  return (snapCompatibility[a]?.includes(b) ?? false) || (snapCompatibility[b]?.includes(a) ?? false);
}


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
  setSnapCategory,
  getSnapCategory,
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

  const state: GrabbableState = {
    entity, grabRadius, options,
    grabPoints: options.grabPoints ?? [],
    grabBox: options.grabBox,
    snapGrid: options.snapGrid ?? 0,
    snapEnabled: false,
    snapCategory: options.snapCategory ?? 'prop',
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
    snapTargetEntity: undefined,
    snapScore: Infinity,
    prevSnapValidTarget: undefined,
    hashKey: undefined,
    inHash: false,
  };

  grabbables.set(entity, state);
  hashInsert(state); // [7] index the freshly-placed piece
}

function remove(entity: Entity): void {
  const s = grabbables.get(entity);
  if (s) { [...s.heldBy].forEach((h) => release(h)); destroyGhost(s); hashRemove(s); }
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
function setSnapCategory(entity: Entity, category: string): void { const s = grabbables.get(entity); if (s) { s.snapCategory = category; } }
function getSnapCategory(entity: Entity): string { return grabbables.get(entity)?.snapCategory ?? 'prop'; }
function setCollidable(entity: Entity, collidable: boolean): void { const s = grabbables.get(entity); if (s) { s.collidablePref = collidable; if (s.heldBy.length === 0 && !s.shielded) { entity.collidable.set(collidable); } } }
function getCollidable(entity: Entity): boolean { return grabbables.get(entity)?.collidablePref ?? true; }

/** Enable/disable grip grabbing. When off, grabbing is driven from grab()/release(). */
function setGripEnabled(enabled: boolean): void { gripEnabled = enabled; }

function releaseAll(): void { release('Left'); release('Right'); }

// Called when a piece leaves its resting state: drop it from the spatial hash and
// clear any remembered snap target so the next hold starts fresh.
function onGrabbed(s: GrabbableState): void {
  hashRemove(s);
  s.snapTargetEntity = undefined;
  s.snapScore = Infinity;
  s.prevSnapValidTarget = undefined;
}

function forceGrab(entity: Entity, hand: Hand): void {
  const s = grabbables.get(entity);
  if (!s || handHeld.get(hand) || s.heldBy.includes(hand)) { return; }
  const hp = getHandPos(hand);
  if (hp) { entity.pos = hp; }
  const wasUnheld = s.heldBy.length === 0;
  s.heldBy.push(hand);
  handHeld.set(hand, s);
  if (wasUnheld) { if (s.shielded) { s.shielded = false; s.shieldPose = undefined; } entity.collidable.set(false); onGrabbed(s); }
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
  if (wasUnheld) { if (nearest.shielded) { nearest.shielded = false; nearest.shieldPose = undefined; } nearest.entity.collidable.set(false); onGrabbed(nearest); }
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
    const finalPose = s.pendingSnap ?? gridPose(s); // [5] grid fallback when nothing was locked
    s.entity.pos = finalPose.pos;
    s.entity.rot = finalPose.rot;
    s.entity.velocity.set(Vector3.zero);
    playSnapSound('place'); // [6]
  }
  destroyGhost(s);
  s.pendingSnap = undefined;
  s.snapTargetEntity = undefined;
  s.prevSnapValidTarget = undefined;
  hashInsert(s); // [7] re-index at the placed position
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
      hashRemove(s);
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
    reindexIfMoved(s); // [7] keep the hash correct for resized / nudged pieces
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


// ============================================================================
// Horizon-style snapping
// ============================================================================

function absVec(v: Vector3): Vector3 { return new Vector3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)); }
function axisGet(v: Vector3, i: number): number { return i === 0 ? v.x : (i === 1 ? v.y : v.z); }
function nearestOf(target: number, options: number[]): number {
  let best = options[0];
  let bd = Math.abs(options[0] - target);
  for (let i = 1; i < options.length; i++) { const d = Math.abs(options[i] - target); if (d < bd) { bd = d; best = options[i]; } }
  return best;
}


// --- [7] spatial hash of placed (unheld) pieces -----------------------------
const spatialHash = new Map<string, Set<GrabbableState>>();
function cellKey(x: number, y: number, z: number): string { return x + '_' + y + '_' + z; }
function cellOf(p: Vector3): { x: number, y: number, z: number } { return { x: Math.floor(p.x / snapCellSize), y: Math.floor(p.y / snapCellSize), z: Math.floor(p.z / snapCellSize) }; }

function hashInsert(s: GrabbableState): void {
  if (s.inHash || !s.entity.exists()) { return; }
  const c = cellOf(s.entity.pos);
  const k = cellKey(c.x, c.y, c.z);
  let set = spatialHash.get(k);
  if (!set) { set = new Set(); spatialHash.set(k, set); }
  set.add(s);
  s.hashKey = k;
  s.inHash = true;
}

function hashRemove(s: GrabbableState): void {
  if (!s.inHash || s.hashKey === undefined) { s.inHash = false; s.hashKey = undefined; return; }
  const set = spatialHash.get(s.hashKey);
  if (set) { set.delete(s); if (set.size === 0) { spatialHash.delete(s.hashKey); } }
  s.hashKey = undefined;
  s.inHash = false;
}

// A placed piece can be moved without a grab (resize gizmo, duplicate). Cheap cell
// compare keeps it in the right bucket. TODO: a fully incremental, multi-cell index
// for very large pieces that straddle several cells.
function reindexIfMoved(s: GrabbableState): void {
  const c = cellOf(s.entity.pos);
  const k = cellKey(c.x, c.y, c.z);
  if (k !== s.hashKey) { hashRemove(s); hashInsert(s); }
}

function hashQuery(p: Vector3): GrabbableState[] {
  const c = cellOf(p);
  const out: GrabbableState[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const set = spatialHash.get(cellKey(c.x + dx, c.y + dy, c.z + dz));
        if (set) { set.forEach((s) => out.push(s)); }
      }
    }
  }
  return out;
}


// --- [4] flush + edge/corner pose, computed in the NEIGHBOUR's local frame ---
function flushPoseInNeighbor(s: GrabbableState, gbA: Vector3, o: GrabbableState): Pose {
  const gbB = o.grabBox!;
  const rotB = o.entity.rot;
  const cB = o.entity.pos;

  const rel90 = snapRotation(rotB.inverse().multiply(s.entity.rot)); // A oriented to B's local 90s
  const worldRot = rotB.multiply(rel90);
  const heAL = absVec(rel90.rotateVector(gbA));                      // A half-extents in B-local axes
  const localCA = rotB.inverse().rotateVector(s.entity.pos.subtract(cB)); // A centre in B-local

  // Contact axis = axis of greatest separation in B-local (B's centre is the origin).
  let k = 0;
  if (Math.abs(localCA.y) > Math.abs(axisGet(localCA, k))) { k = 1; }
  if (Math.abs(localCA.z) > Math.abs(axisGet(localCA, k))) { k = 2; }

  const out = [localCA.x, localCA.y, localCA.z];
  for (let j = 0; j < 3; j++) {
    if (j === k) {
      const sign = axisGet(localCA, j) >= 0 ? 1 : -1;
      out[j] = sign * (axisGet(gbB, j) + axisGet(heAL, j)); // flush faces
    } else {
      const lo = -axisGet(gbB, j) + axisGet(heAL, j); // low edges aligned
      const hi = axisGet(gbB, j) - axisGet(heAL, j);  // high edges aligned
      out[j] = nearestOf(axisGet(localCA, j), [lo, 0, hi]); // 0 = centred
    }
  }

  const worldPos = cB.add(rotB.rotateVector(new Vector3(out[0], out[1], out[2])));
  return { pos: worldPos, rot: worldRot };
}

// --- [2] AABB overlap of a candidate pose against placed pieces --------------
function poseOverlapsPlaced(pose: Pose, gbA: Vector3, self: GrabbableState, target: GrabbableState): boolean {
  const heA = absVec(pose.rot.rotateVector(gbA));
  const nearby = hashQuery(pose.pos);
  for (const o of nearby) {
    if (o === self || o === target || o.heldBy.length > 0 || !o.entity.exists() || !o.grabBox) { continue; }
    const heB = absVec(o.entity.rot.rotateVector(o.grabBox));
    const d = pose.pos.subtract(o.entity.pos);
    if (Math.abs(d.x) < heA.x + heB.x - snapOverlapTolerance &&
      Math.abs(d.y) < heA.y + heB.y - snapOverlapTolerance &&
      Math.abs(d.z) < heA.z + heB.z - snapOverlapTolerance) {
      return true;
    }
  }
  return false;
}

// --- [5] open-space fallback: grid position + 90 deg yaw ---------------------
function gridPose(s: GrabbableState): Pose {
  const rot = snapRotation(s.entity.rot);
  const g = s.snapGrid > 0 ? s.snapGrid : defaultSnapGrid;
  const p = s.entity.pos;
  return { pos: new Vector3(Math.round(p.x / g) * g, Math.round(p.y / g) * g, Math.round(p.z / g) * g), rot };
}


type SnapResult = { display: Pose, apply: Pose, color: Color, lockedTarget: Entity | undefined };

// The full snap decision for a held piece (items 1-5 combined).
function computeSnap(s: GrabbableState): SnapResult {
  const gbA = s.grabBox;
  const grid = gridPose(s);
  if (!gbA) { return { display: grid, apply: grid, color: ghostColorSearching, lockedTarget: undefined }; }

  const cA = s.entity.pos;

  // [1 + 7] gather compatible candidates from the spatial hash, score by distance moved.
  const candidates: { pose: Pose, score: number, target: GrabbableState }[] = [];
  hashQuery(cA).forEach((o) => {
    if (o === s || o.heldBy.length > 0 || !o.entity.exists() || !o.grabBox) { return; }
    if (!canSnap(s.snapCategory, o.snapCategory)) { return; }
    const pose = flushPoseInNeighbor(s, gbA, o);
    const score = pose.pos.distanceTo(cA);
    if (score <= maxSnapDistance) { candidates.push({ pose, score, target: o }); }
  });
  candidates.sort((a, b) => a.score - b.score);

  if (candidates.length === 0) {
    s.snapTargetEntity = undefined;
    return { display: grid, apply: grid, color: ghostColorSearching, lockedTarget: undefined };
  }

  // [3] hysteresis: keep the locked target unless a rival beats it by the margin.
  let leader = candidates[0];
  if (s.snapTargetEntity) {
    const heldCand = candidates.find((c) => c.target.entity === s.snapTargetEntity);
    if (heldCand && leader.target.entity !== heldCand.target.entity && leader.score >= heldCand.score * (1 - snapHysteresis)) {
      leader = heldCand;
    }
  }

  // [2] from the leader down, take the first pose that does not overlap a placed piece.
  const ordered = [leader, ...candidates.filter((c) => c !== leader)];
  let blocked: { pose: Pose, score: number, target: GrabbableState } | undefined;
  for (const c of ordered) {
    if (poseOverlapsPlaced(c.pose, gbA, s, c.target)) { if (!blocked) { blocked = c; } continue; }
    s.snapTargetEntity = c.target.entity;
    s.snapScore = c.score;
    return { display: c.pose, apply: c.pose, color: ghostColorValid, lockedTarget: c.target.entity };
  }

  // Every compatible neighbour is occupied: show red at the blocked spot, place on the grid.
  s.snapTargetEntity = undefined;
  return { display: blocked ? blocked.pose : grid, apply: grid, color: ghostColorInvalid, lockedTarget: undefined };
}


function makeGhost(): Entity {
  const g = spawnPrimitive.cube(Vector3.zero, Vector3.one, Quaternion.one, ghostColorSearching, ghostAlpha, false, 'Empty', undefined);
  g.visible.set(false);
  return g;
}

function updateSnapPreview(s: GrabbableState): void {
  const r = computeSnap(s);
  s.pendingSnap = r.apply;

  if (s.grabBox) {
    if (!s.snapGhost || !s.snapGhost.exists()) { s.snapGhost = makeGhost(); }
    s.snapGhost.visible.set(true);
    s.snapGhost.pos = r.display.pos;
    s.snapGhost.rot = r.display.rot;
    s.snapGhost.scale = new Vector3(s.grabBox.x * 2, s.grabBox.y * 2, s.grabBox.z * 2);
    s.snapGhost.mesh.color.set(r.color, ghostAlpha); // [6] blue / green / red
  }

  // [6] soft click the instant a NEW valid lock is acquired.
  if (r.lockedTarget && r.lockedTarget !== s.prevSnapValidTarget) { playSnapSound('lock'); }
  s.prevSnapValidTarget = r.lockedTarget;
}

function clearSnap(s: GrabbableState): void {
  s.pendingSnap = undefined;
  s.snapTargetEntity = undefined;
  s.prevSnapValidTarget = undefined;
  if (s.snapGhost && s.snapGhost.exists()) { s.snapGhost.visible.set(false); }
}

function destroyGhost(s: GrabbableState): void {
  if (s.snapGhost && s.snapGhost.exists()) { s.snapGhost.destroy(); }
  s.snapGhost = undefined;
}

// [6] Audio hook. This engine exposes no audio API yet, so these are stubs.
// TODO: play a soft click on 'lock' and a firmer click on 'place' once an engine
// sound API (an AudioStreamPlayer-style wrapper) is available.
function playSnapSound(kind: 'lock' | 'place'): void {
  void kind; // intentionally empty until an audio API exists
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
