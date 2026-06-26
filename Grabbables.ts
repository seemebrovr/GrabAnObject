import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { Controller } from "./Yuu API/Controller";
import { Entity } from "./Yuu API/Entity";
import { grabbable, Hand } from "./Yuu API/Grabbable";
import { Player } from "./Yuu API/Player";
import { propertyPanel } from "./Yuu API/PropertyPanel";
import { registerStart } from "./Yuu API/RegisterStart";
import { scaleGizmo } from "./Yuu API/ScaleGizmo";
import { spawnMenu } from "./Yuu API/SpawnMenu";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


// ============================================================================
// Grabbables - first project scene (a little building toy).
// Press the left X button for the Shapes menu and pull a shape into your hand.
// Each shape can be grabbed anywhere on its surface, held two-handed (spread your
// hands to stretch it), resized with the select-and-drag handles, snapped to a
// grid, duplicated, and toggled (Physics / Snap / Collide) from its property
// panel (thumbstick while holding). Shapes spawn with physics OFF so they stay.
// ============================================================================


// Mesh shape used by spawnGrabbableShape. Slab/Pillar are just 'Cube' meshes with
// non-cube default scales (chosen in the menu items below).
type Shape = 'Cube' | 'Sphere' | 'Cone' | 'Pyramid';

const tableTopColor = new Color(0.45, 0.30, 0.18);
const tableLegColor = new Color(0.35, 0.23, 0.13);

const tableCenter = new Vector3(0, 0, -0.6);
const topThickness = 0.05;
const topWidth = 0.8;
const topDepth = 0.5;
const legHeight = 1.05;
const legThickness = 0.05;

const tableSurfaceY = tableCenter.y + legHeight + topThickness;

const cubeSize = 0.2;
const grabReach = 0.07;

// Shape colors.
const shapeRed = new Color(0.85, 0.18, 0.18);
const shapeGreen = new Color(0.2, 0.7, 0.25);
const shapeBlue = new Color(0.2, 0.45, 1);
const shapeYellow = new Color(0.9, 0.8, 0.2);
const shapePurple = new Color(0.6, 0.3, 0.85);
const shapeOrange = new Color(0.95, 0.55, 0.15);

// Default spawn sizes.
const sizeUniform = new Vector3(cubeSize, cubeSize, cubeSize);
const sizeSlab = new Vector3(0.3, 0.06, 0.3);
const sizePillar = new Vector3(0.08, 0.4, 0.08);

// Remember which mesh shape each spawned entity is, so Duplicate recreates it.
const entityShape = new Map<Entity, Shape>();


registerStart(start);

function start() {
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  makeTable();

  // Starting cube resting on the table.
  spawnGrabbableShape('Cube', new Vector3(tableCenter.x, tableSurfaceY + (cubeSize / 2), tableCenter.z), sizeUniform, Quaternion.one, shapeRed);

  // While holding a shape, click that hand's thumbstick to open/close its panel.
  const togglePanel = (hand: Hand) => {
    const held = grabbable.heldEntity(hand);

    if (!held) {
      return;
    }

    if (propertyPanel.isOpen()) {
      propertyPanel.close();
    }
    else {
      propertyPanel.open(held, { onDuplicate: duplicateShape });
    }
  };

  Controller.subscribe('leftThumbstick', 'Pressed', () => togglePanel('Left'));
  Controller.subscribe('rightThumbstick', 'Pressed', () => togglePanel('Right'));

  // Shapes menu (left X button). Each item spawns into the hand that clicks it.
  spawnMenu.configure('Shapes', [
    { label: 'Cube', color: shapeRed, icon: (b) => addShapeIcon('Cube', b, shapeRed, sizeUniform), onSpawn: (hand) => spawnIntoHand(hand, 'Cube', sizeUniform, shapeRed) },
    { label: 'Sphere', color: shapeGreen, icon: (b) => addShapeIcon('Sphere', b, shapeGreen, sizeUniform), onSpawn: (hand) => spawnIntoHand(hand, 'Sphere', sizeUniform, shapeGreen) },
    { label: 'Cone', color: shapeBlue, icon: (b) => addShapeIcon('Cone', b, shapeBlue, sizeUniform), onSpawn: (hand) => spawnIntoHand(hand, 'Cone', sizeUniform, shapeBlue) },
    { label: 'Pyramid', color: shapeYellow, icon: (b) => addShapeIcon('Pyramid', b, shapeYellow, sizeUniform), onSpawn: (hand) => spawnIntoHand(hand, 'Pyramid', sizeUniform, shapeYellow) },
    { label: 'Slab', color: shapePurple, icon: (b) => addShapeIcon('Cube', b, shapePurple, sizeSlab), onSpawn: (hand) => spawnIntoHand(hand, 'Cube', sizeSlab, shapePurple) },
    { label: 'Pillar', color: shapeOrange, icon: (b) => addShapeIcon('Cube', b, shapeOrange, sizePillar), onSpawn: (hand) => spawnIntoHand(hand, 'Cube', sizePillar, shapeOrange) },
  ]);

  console.log('Grabbables ready: press the left X button for the Shapes menu.');
}


/**
 * Create a grabbable, scalable, snappable physics shape. Physics starts OFF so it
 * stays where you place it (toggle it on in the property panel).
 */
function spawnGrabbableShape(shape: Shape, pos: Vector3, scale: Vector3, rot: Quaternion, color: Color): Entity {
  let entity: Entity;

  if (shape === 'Sphere') {
    entity = spawnPrimitive.sphere(16, 12, pos, 1, rot, color, 1, 'Sphere', 'Physics', undefined);
  }
  else if (shape === 'Cone') {
    entity = spawnPrimitive.cone(16, pos, 1, rot, color, 1, 'Convex', 'Physics', undefined);
  }
  else if (shape === 'Pyramid') {
    entity = spawnPrimitive.cone(4, pos, 1, rot, color, 1, 'Convex', 'Physics', undefined); // a 4-sided cone
  }
  else {
    entity = spawnPrimitive.cube(pos, Vector3.one, rot, color, 1, true, 'Physics', undefined);
  }

  entity.scale = scale; // round shapes are built at size 1, then scaled to match
  entityShape.set(entity, shape);

  grabbable.make(entity, grabReach, {
    grabBox: new Vector3(scale.x / 2, scale.y / 2, scale.z / 2),
    snapGrid: 0.1,
    onGrab: (hand) => console.log(hand + ' grabbed a ' + shape),
    onRelease: (hand) => console.log(hand + ' released a ' + shape),
  });

  scaleGizmo.attach(entity, {
    onScale: (s) => grabbable.setGrabBox(entity, new Vector3(s.x / 2, s.y / 2, s.z / 2)),
  });

  propertyPanel.setPhysicsEnabled(entity, false);

  return entity;
}


/** Duplicate: same shape, size, rotation and color, placed beside the original. */
function duplicateShape(target: Entity): void {
  const shape = entityShape.get(target) ?? 'Cube';
  const scale = target.scale;
  const rot = target.rot;

  const colorInfo = target.mesh.color.get();
  const color = colorInfo ? colorInfo.color : shapeRed;

  const pos = target.pos.add(new Vector3(scale.x + 0.1, 0, 0));

  spawnGrabbableShape(shape, pos, scale, rot, color);
}


/** Spawn a shape straight into the given hand (used by the Shapes menu). */
function spawnIntoHand(hand: Hand, shape: Shape, scale: Vector3, color: Color): void {
  const handPos = (hand === 'Left'
    ? Player.leftHand.position.get()
    : Player.rightHand.position.get()) ?? new Vector3(0, 1.4, -0.4);

  const entity = spawnGrabbableShape(shape, handPos, scale, Quaternion.one, color);

  grabbable.forceGrab(entity, hand);
}


/**
 * A small, non-colliding 3D shape used as the icon on a Shapes-menu button. For
 * box shapes the icon takes the proportions of `scaleHint` (so a Slab icon is
 * flat, a Pillar icon is tall).
 */
function addShapeIcon(shape: Shape, button: Entity, color: Color, scaleHint: Vector3): void {
  const at = new Vector3(0, 0.018, 0.012);
  const iconMax = 0.055;

  if (shape === 'Sphere') {
    spawnPrimitive.sphere(12, 8, at, iconMax, Quaternion.one, color, 1, 'None', 'Empty', button);
  }
  else if (shape === 'Cone') {
    spawnPrimitive.cone(12, at, iconMax, Quaternion.fromEuler(new Vector3(0.3, 0, 0)), color, 1, 'None', 'Empty', button);
  }
  else if (shape === 'Pyramid') {
    spawnPrimitive.cone(4, at, iconMax, Quaternion.fromEuler(new Vector3(0.3, 0.5, 0)), color, 1, 'None', 'Empty', button);
  }
  else {
    const m = Math.max(scaleHint.x, scaleHint.y, scaleHint.z);
    const f = iconMax / m;
    const iconScale = new Vector3(scaleHint.x * f, scaleHint.y * f, scaleHint.z * f);

    spawnPrimitive.cube(at, iconScale, Quaternion.fromEuler(new Vector3(0.45, 0.6, 0)), color, 1, false, 'Empty', button);
  }
}


// Builds a simple table (one top + four legs) from static cubes.
function makeTable() {
  const topY = tableCenter.y + legHeight + (topThickness / 2);

  spawnPrimitive.cube(
    new Vector3(tableCenter.x, topY, tableCenter.z),
    new Vector3(topWidth, topThickness, topDepth),
    Quaternion.one,
    tableTopColor,
    1,
    true,
    'Static',
    undefined
  );

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
