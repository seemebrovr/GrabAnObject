# Horizon-Style Snap Upgrade — Changelog & Test Checklist

All changes are in `Yuu API/Grabbable.ts` (snap logic) and `Grabbables.ts` (per-shape
categories). The existing surface snap, grab/hold, two-hand stretch, player shield,
and highlight behavior were preserved — this only **extends** snapping.

## Changelog (per numbered item)

1. **Type rules.** Added a `snapCategory` per object (`GrabbableOptions.snapCategory`,
   default `'prop'`) plus a single data-driven `snapCompatibility` table and a
   symmetric `canSnap(a, b)`. Candidates are filtered by `canSnap` *before* any pose
   is computed or scored. In the scene, box pieces (Cube/Slab/Pillar) are `'wall'`,
   round shapes are `'prop'`.

2. **Overlap rejection.** After a candidate pose is computed, `poseOverlapsPlaced()`
   tests its world AABB against nearby placed pieces (with `snapOverlapTolerance` slack
   so flush faces don't count). The scorer walks the ranked list and takes the first
   *non-overlapping* pose; if all compatible neighbors are occupied it shows red and
   falls back to the grid. `// TODO:` left for an explicit named-slot/socket occupancy
   system backed by the spatial hash.

3. **Hysteresis (anti-flicker).** The locked target is remembered across frames
   (`snapTargetEntity`) and only surrendered when a rival beats its score by
   `snapHysteresis` (12%). Near-ties hold steady; a clear move still switches.

4. **Local-space alignment.** `flushPoseInNeighbor()` transforms the held piece into
   the **neighbor's** local frame, does the face-flush + edge/corner alignment there,
   snaps rotation to the neighbor's local 90s, then maps back to world. Rotated
   neighbors now snap cleanly; world-aligned cases are unchanged.

5. **Grid fallback.** When nothing is in range, release quantizes position to the
   object's `snapGrid` (repurposed; defaults to `defaultSnapGrid` = 0.1 m) and yaw to
   the nearest 90°. A neighbor snap always takes priority over the grid.

6. **Feedback (audio + color).** Ghost color now signals state: **blue** searching /
   grid, **green** valid lock, **red** blocked/occupied. Audio is a marked stub
   (`playSnapSound('lock' | 'place')`) with a `// TODO:` — this engine exposes no audio
   API, so it is a no-op hook ready to wire.

7. **Broadphase.** A uniform spatial hash (`snapCellSize` = 0.5 m) indexes placed
   pieces. Candidate search and overlap checks query only the 27 neighboring cells.
   Pieces are inserted on placement, removed on grab, and cheaply re-indexed if moved
   (resize/duplicate). Heavy snap work stays roughly flat as the room grows.

## Tunable constants (top of `Grabbable.ts`)

- `maxSnapDistance` (0.2) — max move to reach a neighbor snap
- `ghostAlpha` (0.3) — ghost translucency
- `ghostColorSearching` / `ghostColorValid` / `ghostColorInvalid` — blue / green / red
- `snapOverlapTolerance` (0.01) — overlap slack for flush faces
- `snapHysteresis` (0.12) — margin a rival must beat to steal the lock
- `defaultSnapGrid` (0.1) — grid cell when an object has no `snapGrid`
- `snapCellSize` (0.5) — spatial-hash cell size
- `snapCompatibility` — the category table (edit in one place)

## Manual test checklist (maps to acceptance criteria)

1. **Type rules** — Spawn two cubes, Snap on both, bring together → they snap
   (wall↔wall). Bring a cube near a sphere → no snap (wall vs prop). Edit one row of
   `snapCompatibility` (e.g. add `prop` to `wall`) → cube now snaps to sphere, nothing
   else changed.
2. **Overlap** — Snap two cubes flush. Try to drop a third into the exact same slot →
   ghost turns **red** and it will not stack; releasing drops it to the grid, not inside.
   Flush neighbors do **not** falsely read red.
3. **Hysteresis** — Hover a piece roughly between two equal neighbors → ghost holds on
   one instead of strobing. Move clearly toward the other → it switches.
4. **Local-space** — Rotate one wall ~30° off-axis, Snap on. Bring a piece to it →
   snaps flush and gap-free, oriented to the rotated wall. Confirm world-aligned walls
   still snap exactly as before.
5. **Grid fallback** — In open space (no neighbor in range) with Snap on, release →
   piece lands on the 0.1 m grid and straightens to 90° yaw. With a neighbor in range,
   the surface snap wins.
6. **Feedback** — Watch the ghost: blue while hunting, green when a valid slot locks,
   red over an occupied slot. (Audio: no sound yet — stub is in place; see TODO.)
7. **Broadphase** — Build a large wall of many pieces; snapping a new piece stays
   responsive (no slow-down as the count grows).

Verify in **both** normal mode (grip to grab/release) and edit mode (trigger).

## Known gaps / TODOs (intentional, marked in code)

- **Audio** — no engine API; `playSnapSound` is a stub. Wire when an audio API appears.
- **Named-slot occupancy** — current overlap test is volumetric; a per-slot socket
  system with the spatial hash is marked `// TODO:`.
- **Spatial hash** keys on the center cell; very large pieces straddling many cells are
  a `// TODO:` (cheap per-frame re-index keeps moved pieces correct).
- **Round pieces** (sphere/cone) snap as their bounding box by design (out of scope).
