import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { grabbable } from "./Yuu API/Grabbable";
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
const legHeight = 0.95; // along Y (taller table)
const legThickness = 0.05;

// Height of the tabletop's upper surface (used to rest the cube on it).
const tableSurfaceY = tableCenter.y + legHeight + topThickness; // 0.75


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
    new Vector3(tableCenter.x, tableSurfaceY + 0.11, tableCenter.z), // 1cm gap above surface
    new Vector3(0.2, 0.2, 0.2),  // 20cm cube
    Quaternion.one,
    Color.red,
    1,
    true,        // collider, so it can rest on the table
    'Physics',   // physics body (gravity + throwable)
    undefined
  );

  // Register the cube with the grab system.
  // grabRadius = how close (in meters) a hand must be to grab it.
  grabbable.make(cube, 0.2, {
    onGrab: (hand) => console.log(hand + ' hand grabbed the cube'),
    onRelease: (hand) => console.log(hand + ' hand released the cube'),
  });

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
