import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { Controller } from "./Yuu API/Controller";
import { grabbable, Hand } from "./Yuu API/Grabbable";
import { propertyPanel } from "./Yuu API/PropertyPanel";
import { registerStart } from "./Yuu API/RegisterStart";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


// ============================================================================
// Grabbables - first project scene
// ----------------------------------------------------------------------------
// A table sits in front of the player with a cube resting on top of it.
// Move a hand close to the cube and squeeze grip to grab it; release to drop
// or throw it. (No floor, so anything knocked off the table keeps falling.)
// ============================================================================


// Wood-ish colors for the table.
const tableTopColor = new Color(0.45, 0.30, 0.18);
const tableLegColor = new Color(0.35, 0.23, 0.13);

// Where the table stands and how big it is (meters).
const tableCenter = new Vector3(0, 0, -0.6); // on the ground, 0.6m in front of player
const topThickness = 0.05;
const topWidth = 0.8;   // along X
const topDepth = 0.5;   // along Z
const legHeight = 1.05; // along Y (taller table)
const legThickness = 0.05;

// Height of the tabletop's upper surface (used to rest the cube on it).
const tableSurfaceY = tableCenter.y + legHeight + topThickness;

// The grabbable cube.
const cubeSize = 0.2;         // 20cm cube
const grabPointRadius = 0.07; // how close (m) a hand must be to a corner/edge/face to grab it


// registerStart queues this function to run once when the scene starts.
registerStart(start);

function start() {
  // Floating debug console so we can read logs from inside the headset.
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  // Build the table to stand on.
  makeTable();

  // ---- Grabbable cube -------------------------------------------------------
  // Spawn it just above the table surface so it settles and rests on top.
  // Must be a 'Physics' entity so it responds to gravity and can be thrown.
  const cube = spawnPrimitive.cube(
    new Vector3(tableCenter.x, tableSurfaceY + 0.11, tableCenter.z), // small gap above surface
    new Vector3(cubeSize, cubeSize, cubeSize),
    Quaternion.one,
    Color.red,
    1,
    true,        // collider, so it can rest on the table
    'Physics',   // physics body (gravity + throwable)
    undefined
  );

  // Make it grabbable by its SURFACE, not its center: the hand must be within
  // grabPointRadius of a corner, edge, or face of the cube. Reaching into the
  // dead center no longer grabs it.
  grabbable.make(cube, grabPointRadius, {
    grabPoints: cubeGrabPoints(cubeSize / 2),
    onGrab: (hand) => console.log(hand + ' hand grabbed the cube'),
    onRelease: (hand) => console.log(hand + ' hand released the cube'),
  });

  // While holding the cube, click the holding hand's thumbstick to open/close the
  // property panel. Operate the panel by pointing your OTHER hand at a button and
  // pulling the trigger.
  const togglePanel = (hand: Hand) => {
    if (!grabbable.heldBy(cube).includes(hand)) {
      return; // only the hand actually holding the cube opens the panel
    }

    if (propertyPanel.isOpen()) {
      propertyPanel.close();
    }
    else {
      propertyPanel.open(cube);
    }
  };

  Controller.subscribe('leftThumbstick', 'Pressed', () => togglePanel('Left'));
  Controller.subscribe('rightThumbstick', 'Pressed', () => togglePanel('Right'));

  console.log('Grabbables ready: pick the cube up off the table with grip.');
}


// Builds a simple table (one top + four legs) from static cubes.
function makeTable() {
  // Tabletop: a wide, thin static cube centered above the legs.
  const topY = tableCenter.y + legHeight + (topThickness / 2);

  spawnPrimitive.cube(
    new Vector3(tableCenter.x, topY, tableCenter.z),
    new Vector3(topWidth, topThickness, topDepth),
    Quaternion.one,
    tableTopColor,
    1,
    true,
    'Static',   // never moves
    undefined
  );

  // Four legs, inset slightly from the corners of the top.
  const legOffsetX = (topWidth / 2) - legThickness;
  const legOffsetZ = (topDepth / 2) - legThickness;
  const legY = tableCenter.y + (legHeight / 2);

  const legPositions = [
    new Vector3(tableCenter.x - legOffsetX, legY, tableCenter.z - legOffsetZ),
    new Vector3(tableCenter.x + legOffsetX, legY, tableCenter.z - legOffsetZ),
    new Vector3(tableCenter.x - legOffsetX, legY, tableCenter.z + legOffsetZ),
    new Vector3(tableCenter.x + legOffsetX, legY, tableCenter.z + legOffsetZ),
  ];

  legPositions.forEach((legPos) => {
    spawnPrimitive.cube(
      legPos,
      new Vector3(legThickness, legHeight, legThickness),
      Quaternion.one,
      tableLegColor,
      1,
      true,
      'Static',
      undefined
    );
  });
}


// Local-space grab anchors for a cube of the given half-extent: its 8 corners,
// 12 edge midpoints, and 6 face centers - but NOT the dead center. Returned as
// offsets (meters) from the cube's center; they rotate/move with the cube.
function cubeGrabPoints(halfExtent: number): Vector3[] {
  const coords = [-halfExtent, 0, halfExtent];
  const points: Vector3[] = [];

  coords.forEach((x) => {
    coords.forEach((y) => {
      coords.forEach((z) => {
        if (x === 0 && y === 0 && z === 0) {
          return; // skip the center - we don't want to grab from inside the cube
        }

        points.push(new Vector3(x, y, z));
      });
    });
  });

  return points;
}
