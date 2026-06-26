import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Controller } from "./Controller";
import { Entity } from "./Entity";
import { Hand } from "./Grabbable";
import { Player } from "./Player";
import { Raycast } from "./Raycast";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// ============================================================================
// SpawnMenu - a palette that pops up in front of the player (left X button).
// ----------------------------------------------------------------------------
// Each item gets a button with an optional 3D icon and a text label. Point a
// hand at a button and pull the trigger to activate it; the action is told WHICH
// hand clicked (so the project can spawn the object into that hand).
//
// We do our own per-hand raycast on trigger because the shared ray-click
// callback doesn't say which hand clicked.
// ============================================================================


export type SpawnMenuItem = {
  label: string,
  color: Color,
  /** Optional: build a small 3D icon parented to the given button entity. */
  icon?: (button: Entity) => void,
  onSpawn: (hand: Hand) => void,
}


export const spawnMenu = {
  configure,
  open,
  close,
  toggle,
  isOpen,
}


let menuTitle = 'Spawn';
let items: SpawnMenuItem[] = [];
let menuRoot: Entity | undefined;
let buttons: { entity: Entity, item: SpawnMenuItem }[] = [];

const buttonBg = new Color(0.22, 0.22, 0.26);


/** Set the menu title and the list of things it can spawn. */
function configure(title: string, menuItems: SpawnMenuItem[]): void {
  menuTitle = title;
  items = menuItems;
}

function isOpen(): boolean {
  return menuRoot !== undefined;
}

function toggle(): void {
  if (isOpen()) {
    close();
  }
  else {
    open();
  }
}

/** Open the menu floating in front of the player, facing them. */
function open(): void {
  close();

  const headPos = Player.head.position.get();
  const headForward = Player.head.forward.get();

  if (!headPos || !headForward) {
    return;
  }

  // Horizontal facing direction so the menu stays upright.
  let fx = headForward.x;
  let fz = headForward.z;
  const len = Math.sqrt((fx * fx) + (fz * fz));

  if (len < 0.0001) {
    fx = 0;
    fz = -1;
  }
  else {
    fx /= len;
    fz /= len;
  }

  const center = new Vector3(headPos.x + (fx * 0.9), headPos.y - 0.05, headPos.z + (fz * 0.9));
  const yaw = Math.atan2(-fx, -fz); // face back toward the player
  const rot = Quaternion.fromEuler(new Vector3(0, yaw, 0));

  menuRoot = spawnPrimitive.plane(
    'Front',
    center,
    new Vector3(0.5, 0.34, 1),
    rot,
    new Color(0.12, 0.12, 0.14),
    1,
    'None',
    'Static',
    undefined
  );

  addLabel(menuRoot, new Vector3(0, 0.12, 0.002), menuTitle, 5, Color.white);

  // Lay the item buttons out in a row.
  const count = items.length;
  const spacing = 0.15;
  const startX = -((count - 1) * spacing) / 2;

  items.forEach((item, i) => {
    const button = spawnPrimitive.plane(
      'Front',
      new Vector3(startX + (i * spacing), -0.02, 0.0025),
      new Vector3(0.13, 0.15, 1),
      Quaternion.one,
      buttonBg,
      1,
      'Concave', // collider so the raycast can hit it
      'Static',
      menuRoot!
    );

    button.rayClick.initialize(false); // shows the pointer ray; action handled below

    if (item.icon) {
      item.icon(button); // a small 3D shape sits on the button (no collider)
    }

    const label = new Entity(new Vector3(0, -0.05, 0.004), Quaternion.one, Vector3.one, button, 'Static');
    label.text.create(item.label, 3, 0);
    label.text.doubleSided.set(false);
    label.text.color.set(Color.white);

    buttons.push({ entity: button, item: item });
  });
}

function close(): void {
  if (menuRoot) {
    menuRoot.destroy(); // destroys child buttons + icons + text too
  }

  menuRoot = undefined;
  buttons = [];
}


function addLabel(parent: Entity, pos: Vector3, text: string, fontSize: number, color: Color): Entity {
  const label = new Entity(pos, Quaternion.one, Vector3.one, parent, 'Static');

  label.text.create(text, fontSize, 0);
  label.text.doubleSided.set(false);
  label.text.color.set(color);

  return label;
}


registerStart(start);
function start() {
  Controller.subscribe('leftX', 'Pressed', () => toggle());
  Controller.subscribe('leftTrigger', 'Pressed', () => onTrigger('Left'));
  Controller.subscribe('rightTrigger', 'Pressed', () => onTrigger('Right'));
}

function onTrigger(hand: Hand): void {
  if (!isOpen()) {
    return;
  }

  const pos = hand === 'Left' ? Player.leftHand.position.get() : Player.rightHand.position.get();
  const forward = hand === 'Left' ? Player.leftHand.forward.get() : Player.rightHand.forward.get();

  if (!pos || !forward) {
    return;
  }

  const hit = Raycast.directional(pos, forward, 5, { getEntity: true });

  if (hit && hit.entity) {
    const match = buttons.find((b) => b.entity === hit.entity);

    if (match) {
      match.item.onSpawn(hand);
    }
  }
}
