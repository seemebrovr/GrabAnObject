import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { grabbable } from "./Grabbable";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// ============================================================================
// PropertyPanel - a small in-world property panel for an entity.
// ----------------------------------------------------------------------------
// Properties:
//   "Physics"  - On: falls / can be thrown.  Off: frozen in place.
//   "Snap"     - On: releasing snaps the object to a grid (great for building).
//   "Duplicate"- spawns a copy (handler supplied by the caller).
//   "X"        - close the panel.
// Operate it with the ray pointer: aim a hand at a button and pull the trigger.
// ============================================================================


type ButtonHandle = {
  root: Entity,
  label: Entity,
}

type OpenOptions = {
  /** If provided, a "Duplicate" button appears that calls this with the target. */
  onDuplicate?: (target: Entity) => void,
}


// Per-entity physics state. A missing entry means "enabled" (a normal Physics body).
const physicsEnabled = new Map<Entity, boolean>();
// Pose (position + rotation) a physics-off entity is pinned to while it isn't held.
const frozen = new Map<Entity, { pos: Vector3, rot: Quaternion }>();


export const propertyPanel = {
  open,
  close,
  isOpen,
  getPhysicsEnabled,
  setPhysicsEnabled,
  setFrozenPose,
};


let panelRoot: Entity | undefined;
let physicsButton: ButtonHandle | undefined;
let snapButton: ButtonHandle | undefined;


function isOpen(): boolean {
  return panelRoot !== undefined;
}

function getPhysicsEnabled(entity: Entity): boolean {
  return physicsEnabled.get(entity) ?? true;
}

function setPhysicsEnabled(entity: Entity, enabled: boolean): void {
  physicsEnabled.set(entity, enabled);
  frozen.delete(entity);
}

function setFrozenPose(entity: Entity, pos: Vector3, rot: Quaternion): void {
  frozen.set(entity, { pos: pos.clone(), rot: rot.clone() });
}


function open(target: Entity, options: OpenOptions = {}): void {
  close();

  const anchor = target.pos.add(new Vector3(0, 0.35, 0.12));

  panelRoot = spawnPrimitive.plane(
    'Front',
    anchor,
    new Vector3(0.34, 0.36, 1),
    Quaternion.one,
    new Color(0.12, 0.12, 0.14),
    1,
    'None',
    'Static',
    undefined
  );

  addLabel(panelRoot, new Vector3(0, 0.14, 0.002), 'Properties', 5, Color.white);

  // X close button (top-right corner).
  const closeButton = makeButton(
    panelRoot,
    new Vector3(0.145, 0.145, 0.002),
    new Vector3(0.04, 0.04, 1),
    'X',
    5,
    new Color(0.7, 0.15, 0.15),
    Color.white
  );
  closeButton.root.rayClick.setClickFunction(() => close());

  // Physics on/off row.
  addLabel(panelRoot, new Vector3(-0.085, 0.06, 0.002), 'Physics', 4, Color.white);

  physicsButton = makeButton(
    panelRoot,
    new Vector3(0.07, 0.06, 0.002),
    new Vector3(0.12, 0.06, 1),
    physicsCaption(target),
    4,
    physicsColor(target),
    Color.white
  );
  physicsButton.root.rayClick.setClickFunction(() => {
    setPhysicsEnabled(target, !getPhysicsEnabled(target));
    refreshPhysicsButton(target);
  });

  // Snap on/off row.
  addLabel(panelRoot, new Vector3(-0.085, -0.01, 0.002), 'Snap', 4, Color.white);

  snapButton = makeButton(
    panelRoot,
    new Vector3(0.07, -0.01, 0.002),
    new Vector3(0.12, 0.06, 1),
    snapCaption(target),
    4,
    snapColor(target),
    Color.white
  );
  snapButton.root.rayClick.setClickFunction(() => {
    grabbable.setSnapEnabled(target, !grabbable.getSnapEnabled(target));
    refreshSnapButton(target);
  });

  // Duplicate button (only shown if the caller provided a duplicate handler).
  if (options.onDuplicate) {
    const onDuplicate = options.onDuplicate;

    const dupButton = makeButton(
      panelRoot,
      new Vector3(0, -0.11, 0.002),
      new Vector3(0.24, 0.06, 1),
      'Duplicate',
      4,
      new Color(0.2, 0.35, 0.6),
      Color.white
    );
    dupButton.root.rayClick.setClickFunction(() => onDuplicate(target));
  }
}

function close(): void {
  if (panelRoot) {
    panelRoot.destroy(); // destroys child buttons + text too
  }

  panelRoot = undefined;
  physicsButton = undefined;
  snapButton = undefined;
}


function physicsCaption(target: Entity): string {
  return getPhysicsEnabled(target) ? 'On' : 'Off';
}

function physicsColor(target: Entity): Color {
  return getPhysicsEnabled(target) ? new Color(0.18, 0.5, 0.2) : new Color(0.4, 0.4, 0.45);
}

function refreshPhysicsButton(target: Entity): void {
  if (physicsButton) {
    physicsButton.label.text.display.set(physicsCaption(target));
    physicsButton.root.mesh.color.set(physicsColor(target), 1);
  }
}

function snapCaption(target: Entity): string {
  return grabbable.getSnapEnabled(target) ? 'On' : 'Off';
}

function snapColor(target: Entity): Color {
  return grabbable.getSnapEnabled(target) ? new Color(0.18, 0.5, 0.2) : new Color(0.4, 0.4, 0.45);
}

function refreshSnapButton(target: Entity): void {
  if (snapButton) {
    snapButton.label.text.display.set(snapCaption(target));
    snapButton.root.mesh.color.set(snapColor(target), 1);
  }
}


// --- small UI builders ------------------------------------------------------

function addLabel(parent: Entity, pos: Vector3, text: string, fontSize: number, color: Color): Entity {
  const label = new Entity(pos, Quaternion.one, Vector3.one, parent, 'Static');

  label.text.create(text, fontSize, 0);
  label.text.doubleSided.set(false);
  label.text.color.set(color);

  return label;
}

function makeButton(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bgColor: Color, textColor: Color): ButtonHandle {
  const root = spawnPrimitive.plane(
    'Front',
    pos.add(new Vector3(0, 0, 0.0005)),
    scale,
    Quaternion.one,
    bgColor,
    1,
    'Concave', // a collider is required so the ray can hit the button
    'Static',
    parent
  );

  const label = new Entity(new Vector3(0, 0, 0.001), Quaternion.one, Vector3.one, root, 'Static');

  label.text.create(text, fontSize, 0);
  label.text.doubleSided.set(false);
  label.text.color.set(textColor);

  root.rayClick.initialize(false);

  return { root: root, label: label };
}


// --- "physics off" freeze loop ---------------------------------------------

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
}

function onPhysicsUpdate(deltaTime: number) {
  physicsEnabled.forEach((enabled, entity) => {
    if (enabled || !entity.exists()) {
      return;
    }

    if (grabbable.isHeld(entity)) {
      frozen.delete(entity);
      return;
    }

    let pin = frozen.get(entity);

    if (!pin) {
      pin = { pos: entity.pos.clone(), rot: entity.rot.clone() };
      frozen.set(entity, pin);
    }

    entity.pos = pin.pos;
    entity.rot = pin.rot;
    entity.velocity.set(Vector3.zero);
  });
}
