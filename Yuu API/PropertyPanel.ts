import { Color } from "./Basic Types/Color";
import { Quaternion } from "./Basic Types/Quaternion";
import { Vector3 } from "./Basic Types/Vector3";
import { Entity } from "./Entity";
import { Events } from "./Events";
import { grabbable } from "./Grabbable";
import { Player } from "./Player";
import { registerStart } from "./RegisterStart";
import { spawnPrimitive } from "./SpawnPrimitive";


// ============================================================================
// PropertyPanel - an in-world, tabbed property panel for an entity.
// ----------------------------------------------------------------------------
// Modeled on the engine's entity inspector. A curved "umbilical" line connects
// the panel to the object it edits. Drive everything with the ray pointer: aim
// a hand at a control and pull the trigger.
//
// Tabs:
//   Behavior   - Visible*, Reflect & Shadow, Collidable*, Children Override,
//                Collide With (dropdown), Motion (None/Animated/Interactive),
//                Interaction (Grabbable/Physics/Both), Gravity.
//   Attributes - Position / Rotation / Scale read-outs, Tint Color swatches*,
//                Tint Strength* (object opacity).
//   Gameplay   - tappable preset tag chips* (entity.tags).
//   Physics    - placeholder mass / friction / bounce fields.
//
// (*) = wired to a real engine API. The rest are styled placeholders, ready to
// hook up when the underlying API exists (gravity, reflect/shadow, collision
// layers, animated motion, mass/friction/bounce).
// ============================================================================


type TabName = 'Behavior' | 'Attributes' | 'Gameplay' | 'Physics';
type CollideWith = 'Both' | 'Objects' | 'Players' | 'None';
type Motion = 'None' | 'Animated' | 'Interactive';
type Interaction = 'Grabbable' | 'Physics' | 'Physics and Grabbable';

type OpenOptions = {
  /** Title shown in the panel header. */
  name?: string,
  /** If provided, the Duplicate tool icon calls this with the target. */
  onDuplicate?: (target: Entity) => void,
};

type Settings = {
  reflectShadow: boolean,
  childrenOverride: boolean,
  collideWith: CollideWith,
  motion: Motion,
  interaction: Interaction,
  gravity: boolean,
  tintColor: Color,
  tintAlpha: number,
};

type Btn = { root: Entity, label: Entity };


// --- per-entity persisted state --------------------------------------------

// A missing physics entry means "enabled" (a normal Physics body).
const physicsEnabled = new Map<Entity, boolean>();
// Pose a physics-off entity is pinned to while it isn't held.
const frozen = new Map<Entity, { pos: Vector3, rot: Quaternion }>();
// Inspector settings remembered per entity across opens.
const settingsMap = new Map<Entity, Settings>();

function defaultSettings(): Settings {
  return {
    reflectShadow: true,
    childrenOverride: false,
    collideWith: 'Both',
    motion: 'Interactive',
    interaction: 'Grabbable',
    gravity: true,
    tintColor: new Color(1, 1, 1),
    tintAlpha: 1,
  };
}

function getSettings(entity: Entity): Settings {
  let s = settingsMap.get(entity);
  if (!s) { s = defaultSettings(); settingsMap.set(entity, s); }
  return s;
}


export const propertyPanel = {
  open,
  close,
  isOpen,
  getPhysicsEnabled,
  setPhysicsEnabled,
  setFrozenPose,
};


// --- theme ------------------------------------------------------------------

const panelBg = new Color(0.11, 0.11, 0.13);
const sectionBg = new Color(0.16, 0.16, 0.19);
const accent = new Color(0.42, 0.36, 0.95);   // selected / "on" purple
const idle = new Color(0.32, 0.32, 0.38);     // "off"
const idleDark = new Color(0.20, 0.20, 0.24); // unselected control
const disabled = new Color(0.18, 0.18, 0.22);
const lineColor = new Color(0.02, 0.02, 0.02);

const W = 0.5;   // panel width
const H = 0.62;  // panel height
const SEG = 12;  // connector line segments


// --- live panel state -------------------------------------------------------

let panelRoot: Entity | undefined;
let contentRoot: Entity | undefined;
let target: Entity | undefined;
let openOptions: OpenOptions = {};
let activeTab: TabName = 'Behavior';
let tabHandles: { name: TabName, root: Entity }[] = [];
let connector: Entity[] = [];


function isOpen(): boolean { return panelRoot !== undefined; }

function getPhysicsEnabled(entity: Entity): boolean { return physicsEnabled.get(entity) ?? true; }

function setPhysicsEnabled(entity: Entity, enabled: boolean): void {
  physicsEnabled.set(entity, enabled);
  frozen.delete(entity);
}

function setFrozenPose(entity: Entity, pos: Vector3, rot: Quaternion): void {
  frozen.set(entity, { pos: pos.clone(), rot: rot.clone() });
}


// A yaw that makes a panel at `pos` face the player.
function facePlayer(pos: Vector3): Quaternion {
  const head = Player.head.position.get();
  if (!head) { return Quaternion.one; }

  const dx = head.x - pos.x;
  const dz = head.z - pos.z;
  const len = Math.sqrt((dx * dx) + (dz * dz));
  if (len < 0.0001) { return Quaternion.one; }

  return Quaternion.fromEuler(new Vector3(0, Math.atan2(dx / len, dz / len), 0));
}


function open(t: Entity, options: OpenOptions = {}): void {
  close();

  target = t;
  openOptions = options;
  activeTab = 'Behavior';

  // Sync the remembered tint with the object's current color.
  const current = t.mesh.color.get();
  if (current) {
    const s = getSettings(t);
    s.tintColor = current.color;
    s.tintAlpha = current.alpha;
  }

  const anchor = t.pos.add(new Vector3(0.35, 0.5, 0));
  const facing = facePlayer(anchor);

  panelRoot = spawnPrimitive.plane('Front', anchor, new Vector3(W, H, 1), facing, panelBg, 1, 'None', 'Static', undefined);

  buildChrome(t);
  buildContent(t);
  buildConnector();
}

function close(): void {
  if (panelRoot) { panelRoot.destroy(); }
  connector.forEach((seg) => { if (seg.exists()) { seg.destroy(); } });

  panelRoot = undefined;
  contentRoot = undefined;
  target = undefined;
  tabHandles = [];
  connector = [];
}


// --- chrome: title, tools, tabs, footer ------------------------------------

function buildChrome(t: Entity): void {
  const root = panelRoot!;

  // Title row: icon, name, close.
  rect(root, new Vector3(-0.215, 0.275, 0.002), new Vector3(0.032, 0.032, 1), accent, false);
  label(root, new Vector3(-0.05, 0.275, 0.003), openOptions.name ?? 'Object', 4, Color.white);

  const closeBtn = button(root, new Vector3(0.215, 0.275, 0.002), new Vector3(0.042, 0.042, 1), 'X', 4, accent, Color.white);
  closeBtn.root.rayClick.setClickFunction(() => close());

  // Tool icons: snap-to-grid, duplicate, reset rotation.
  const snap = button(root, new Vector3(-0.205, 0.222, 0.002), new Vector3(0.042, 0.038, 1), 'Snap', 2, grabbable.getSnapEnabled(t) ? accent : idleDark, Color.white);
  snap.root.rayClick.setClickFunction(() => {
    grabbable.setSnapEnabled(t, !grabbable.getSnapEnabled(t));
    snap.root.mesh.color.set(grabbable.getSnapEnabled(t) ? accent : idleDark, 1);
  });

  const dup = button(root, new Vector3(-0.155, 0.222, 0.002), new Vector3(0.042, 0.038, 1), 'Dup', 2, idleDark, Color.white);
  if (openOptions.onDuplicate) {
    const onDuplicate = openOptions.onDuplicate;
    dup.root.rayClick.setClickFunction(() => onDuplicate(t));
  }

  const reset = button(root, new Vector3(-0.105, 0.222, 0.002), new Vector3(0.042, 0.038, 1), 'Rot0', 2, idleDark, Color.white);
  reset.root.rayClick.setClickFunction(() => { t.rot = Quaternion.one; });

  // Tab bar.
  const names: TabName[] = ['Behavior', 'Attributes', 'Gameplay', 'Physics'];
  const tx = [-0.186, -0.062, 0.062, 0.186];
  tabHandles = [];
  names.forEach((n, i) => {
    const tab = button(root, new Vector3(tx[i], 0.165, 0.002), new Vector3(0.118, 0.05, 1), n, 2, n === activeTab ? accent : idleDark, Color.white);
    tab.root.rayClick.setClickFunction(() => setTab(n));
    tabHandles.push({ name: n, root: tab.root });
  });

  // Footer: attached-script placeholder.
  rect(root, new Vector3(0, -0.265, 0.0015), new Vector3(W - 0.03, 0.07, 1), sectionBg, false);
  label(root, new Vector3(-0.15, -0.247, 0.003), 'Attached Script', 2, Color.white);
  const script = chip(root, new Vector3(0.11, -0.282, 0.003), new Vector3(0.17, 0.032, 1), openOptions.name ?? 'Object', 2, new Color(0.15, 0.45, 0.8), Color.white);
  void script;
}

function setTab(tab: TabName): void {
  if (!panelRoot || !target) { return; }
  activeTab = tab;
  tabHandles.forEach((h) => h.root.mesh.color.set(h.name === tab ? accent : idleDark, 1));
  if (contentRoot) { contentRoot.destroy(); contentRoot = undefined; }
  buildContent(target);
}

function buildContent(t: Entity): void {
  contentRoot = new Entity(new Vector3(0, 0, 0.004), Quaternion.one, Vector3.one, panelRoot!, 'Static');

  if (activeTab === 'Behavior') { buildBehavior(t); }
  else if (activeTab === 'Attributes') { buildAttributes(t); }
  else if (activeTab === 'Gameplay') { buildGameplay(t); }
  else { buildPhysics(); }
}


// --- Behavior tab -----------------------------------------------------------

function buildBehavior(t: Entity): void {
  const c = contentRoot!;
  const y = [0.085, 0.045, 0.005, -0.035, -0.075, -0.115, -0.155, -0.195];

  toggle(c, y[0], 'Visible', () => t.visible.get() ?? true, () => t.visible.set(!(t.visible.get() ?? true)), true);
  toggle(c, y[1], 'Reflect & Shadow', () => getSettings(t).reflectShadow, () => { const s = getSettings(t); s.reflectShadow = !s.reflectShadow; }, true);
  toggle(c, y[2], 'Collidable', () => grabbable.getCollidable(t), () => grabbable.setCollidable(t, !grabbable.getCollidable(t)), true);
  toggle(c, y[3], 'Children Override', () => getSettings(t).childrenOverride, () => { }, false);

  dropdown(c, y[4], 'Collide With', () => getSettings(t).collideWith, () => { const s = getSettings(t); s.collideWith = nextCollide(s.collideWith); });

  segmented(c, y[5], 'Motion', ['None', 'Anim', 'Intr'], () => motionIndex(t), (i) => {
    const s = getSettings(t);
    s.motion = (['None', 'Animated', 'Interactive'] as Motion[])[i];
    applyMotion(t);
  });

  segmented(c, y[6], 'Interaction', ['Grab', 'Phys', 'Both'], () => interactionIndex(t), (i) => {
    const s = getSettings(t);
    s.interaction = (['Grabbable', 'Physics', 'Physics and Grabbable'] as Interaction[])[i];
    applyInteraction(t);
  });

  toggle(c, y[7], 'Gravity', () => getSettings(t).gravity, () => { const s = getSettings(t); s.gravity = !s.gravity; }, true);
}

function motionIndex(t: Entity): number { const m = getSettings(t).motion; return m === 'None' ? 0 : (m === 'Animated' ? 1 : 2); }
function interactionIndex(t: Entity): number { const x = getSettings(t).interaction; return x === 'Grabbable' ? 0 : (x === 'Physics' ? 1 : 2); }

function nextCollide(c: CollideWith): CollideWith {
  const order: CollideWith[] = ['Both', 'Objects', 'Players', 'None'];
  return order[(order.indexOf(c) + 1) % order.length];
}

// Motion / Interaction map onto the existing physics-on/off behavior.
function applyMotion(t: Entity): void {
  const s = getSettings(t);
  if (s.motion === 'Interactive') { applyInteraction(t); }
  else if (s.motion === 'None') { setPhysicsEnabled(t, false); }
  // 'Animated' is a placeholder for now.
}

function applyInteraction(t: Entity): void {
  const s = getSettings(t);
  const physics = (s.interaction === 'Physics' || s.interaction === 'Physics and Grabbable');
  setPhysicsEnabled(t, physics);
}


// --- Attributes tab ---------------------------------------------------------

function buildAttributes(t: Entity): void {
  const c = contentRoot!;

  fieldRow3(c, 0.085, 'Position', [f2(t.pos.x), f2(t.pos.y), f2(t.pos.z)]);
  fieldRow3(c, 0.030, 'Rotation', ['0.00', '0.00', '0.00']);
  fieldRow3(c, -0.025, 'Scale', [f2(t.scale.x), f2(t.scale.y), f2(t.scale.z)]);

  // Tint color swatches.
  label(c, new Vector3(-0.175, -0.085, 0.001), 'Tint Color', 3, Color.white);
  const swatches = [
    new Color(0.85, 0.2, 0.2), new Color(0.2, 0.7, 0.3), new Color(0.2, 0.45, 1),
    new Color(0.95, 0.8, 0.2), new Color(0.6, 0.3, 0.85), new Color(0.95, 0.55, 0.15),
    new Color(1, 1, 1), new Color(0.12, 0.12, 0.14),
  ];
  let sx = -0.02;
  swatches.forEach((col) => {
    const sw = rect(c, new Vector3(sx, -0.085, 0.0018), new Vector3(0.03, 0.03, 1), col, true);
    sw.rayClick.setClickFunction(() => {
      const s = getSettings(t);
      s.tintColor = col;
      t.mesh.color.set(col, s.tintAlpha);
    });
    sx += 0.035;
  });

  // Tint strength (object opacity) steppers.
  const s = getSettings(t);
  label(c, new Vector3(-0.165, -0.150, 0.001), 'Tint Strength', 3, Color.white);
  const minus = button(c, new Vector3(0.02, -0.150, 0.001), new Vector3(0.032, 0.034, 1), '-', 4, idleDark, Color.white);
  const valLabel = label(c, new Vector3(0.105, -0.150, 0.002), s.tintAlpha.toFixed(2), 3, Color.white);
  const plus = button(c, new Vector3(0.19, -0.150, 0.001), new Vector3(0.032, 0.034, 1), '+', 4, idleDark, Color.white);

  const applyTint = () => { t.mesh.color.set(s.tintColor, s.tintAlpha); valLabel.text.display.set(s.tintAlpha.toFixed(2)); };
  minus.root.rayClick.setClickFunction(() => { s.tintAlpha = Math.max(0.1, Math.round((s.tintAlpha - 0.1) * 10) / 10); applyTint(); });
  plus.root.rayClick.setClickFunction(() => { s.tintAlpha = Math.min(1, Math.round((s.tintAlpha + 0.1) * 10) / 10); applyTint(); });
}


// --- Gameplay tab -----------------------------------------------------------

const presetTags = ['Wall', 'Floor', 'Prop', 'Goal', 'Spawn', 'Trigger'];

function tagSummary(t: Entity): string {
  const tags = t.tags.get();
  return (tags.length > 0 ? tags[0] : 'none') + '    ' + tags.length + '/20';
}

function buildGameplay(t: Entity): void {
  const c = contentRoot!;

  label(c, new Vector3(-0.16, 0.095, 0.001), 'Gameplay Tag', 3, Color.white);
  const summary = chip(c, new Vector3(0.12, 0.095, 0.001), new Vector3(0.18, 0.04, 1), tagSummary(t), 2, idleDark, Color.white);

  label(c, new Vector3(-0.15, 0.035, 0.001), 'Tap a tag to add or remove it', 2, idle);

  const cols = [-0.13, 0.0, 0.13];
  const rows = [-0.02, -0.075];
  presetTags.forEach((tag, i) => {
    const col = cols[i % 3];
    const row = rows[Math.floor(i / 3)];
    const on = t.tags.get().includes(tag);
    const c2 = button(c, new Vector3(col, row, 0.001), new Vector3(0.12, 0.045, 1), tag, 2, on ? accent : idleDark, Color.white);
    c2.root.rayClick.setClickFunction(() => {
      if (t.tags.get().includes(tag)) { t.tags.remove(tag); } else { t.tags.add(tag); }
      const nowOn = t.tags.get().includes(tag);
      c2.root.mesh.color.set(nowOn ? accent : idleDark, 1);
      summary.label.text.display.set(tagSummary(t));
    });
  });
}


// --- Physics tab (placeholder) ---------------------------------------------

function buildPhysics(): void {
  const c = contentRoot!;
  fieldRow1(c, 0.085, 'Mass', '1.00');
  fieldRow1(c, 0.030, 'Friction', '0.50');
  fieldRow1(c, -0.025, 'Bounce', '0.00');
  label(c, new Vector3(0, -0.10, 0.001), '(placeholder - not wired yet)', 2, idle);
}


// --- control builders -------------------------------------------------------

function toggle(parent: Entity, y: number, text: string, getOn: () => boolean, onToggle: () => void, enabled: boolean): void {
  label(parent, new Vector3(-0.165, y, 0.001), text, 3, enabled ? Color.white : idle);
  const on = getOn();
  const pill = button(parent, new Vector3(0.16, y, 0.001), new Vector3(0.08, 0.036, 1), on ? 'On' : 'Off', 3, enabled ? (on ? accent : idle) : disabled, Color.white);
  if (enabled) {
    pill.root.rayClick.setClickFunction(() => {
      onToggle();
      const nowOn = getOn();
      pill.label.text.display.set(nowOn ? 'On' : 'Off');
      pill.root.mesh.color.set(nowOn ? accent : idle, 1);
    });
  }
}

function dropdown(parent: Entity, y: number, text: string, getValue: () => string, onCycle: () => void): void {
  label(parent, new Vector3(-0.165, y, 0.001), text, 3, Color.white);
  const pill = button(parent, new Vector3(0.14, y, 0.001), new Vector3(0.16, 0.036, 1), getValue() + '   v', 2, idleDark, Color.white);
  pill.root.rayClick.setClickFunction(() => { onCycle(); pill.label.text.display.set(getValue() + '   v'); });
}

function segmented(parent: Entity, y: number, text: string, opts: string[], getIndex: () => number, onSelect: (i: number) => void): void {
  label(parent, new Vector3(-0.175, y, 0.001), text, 3, Color.white);
  const xs = [0.02, 0.105, 0.19];
  const roots: Entity[] = [];
  const retint = () => { const idx = getIndex(); roots.forEach((r, i) => r.mesh.color.set(i === idx ? accent : idleDark, 1)); };
  opts.forEach((o, i) => {
    const b = button(parent, new Vector3(xs[i], y, 0.001), new Vector3(0.078, 0.034, 1), o, 2, idleDark, Color.white);
    roots.push(b.root);
    b.root.rayClick.setClickFunction(() => { onSelect(i); retint(); });
  });
  retint();
}

function fieldRow3(parent: Entity, y: number, text: string, vals: string[]): void {
  label(parent, new Vector3(-0.185, y, 0.001), text, 3, Color.white);
  const xs = [0.02, 0.105, 0.19];
  vals.forEach((v, i) => chip(parent, new Vector3(xs[i], y, 0.001), new Vector3(0.078, 0.034, 1), v, 2, idleDark, Color.white));
}

function fieldRow1(parent: Entity, y: number, text: string, val: string): void {
  label(parent, new Vector3(-0.15, y, 0.001), text, 3, Color.white);
  chip(parent, new Vector3(0.13, y, 0.001), new Vector3(0.12, 0.034, 1), val, 2, idleDark, Color.white);
}


// --- primitive UI helpers ---------------------------------------------------

function rect(parent: Entity, pos: Vector3, scale: Vector3, color: Color, interactive: boolean): Entity {
  const e = spawnPrimitive.plane('Front', pos, scale, Quaternion.one, color, 1, interactive ? 'Concave' : 'None', 'Static', parent);
  if (interactive) { e.rayClick.initialize(false); }
  return e;
}

function label(parent: Entity, pos: Vector3, text: string, fontSize: number, color: Color): Entity {
  const e = new Entity(pos, Quaternion.one, Vector3.one, parent, 'Static');
  e.text.create(text, fontSize, 0);
  e.text.doubleSided.set(false);
  e.text.color.set(color);
  return e;
}

function button(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bg: Color, fg: Color): Btn {
  const root = rect(parent, pos.add(new Vector3(0, 0, 0.0006)), scale, bg, true);
  const lab = label(root, new Vector3(0, 0, 0.001), text, fontSize, fg);
  return { root, label: lab };
}

function chip(parent: Entity, pos: Vector3, scale: Vector3, text: string, fontSize: number, bg: Color, fg: Color): Btn {
  const root = rect(parent, pos.add(new Vector3(0, 0, 0.0006)), scale, bg, false);
  const lab = label(root, new Vector3(0, 0, 0.001), text, fontSize, fg);
  return { root, label: lab };
}

function f2(n: number): string { return (Math.round(n * 100) / 100).toFixed(2); }


// --- connector line (panel <-> object) -------------------------------------

function buildConnector(): void {
  connector = [];
  for (let i = 0; i < SEG; i++) {
    const seg = spawnPrimitive.cube(Vector3.zero, new Vector3(0.006, 0.006, 0.05), Quaternion.one, lineColor, 1, false, 'Empty', undefined);
    connector.push(seg);
  }
  updateConnector();
}

function bezier(a: Vector3, c: Vector3, b: Vector3, t: number): Vector3 {
  const u = 1 - t;
  const w0 = u * u, w1 = 2 * u * t, w2 = t * t;
  return new Vector3(
    (a.x * w0) + (c.x * w1) + (b.x * w2),
    (a.y * w0) + (c.y * w1) + (b.y * w2),
    (a.z * w0) + (c.z * w1) + (b.z * w2),
  );
}

function lookRotation(dir: Vector3): Quaternion {
  const len = dir.magnitude();
  if (len < 1e-6) { return Quaternion.one; }
  const d = dir.divide(len);
  const yaw = Math.atan2(d.x, d.z);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, d.y)));
  return Quaternion.fromEuler(new Vector3(pitch, yaw, 0));
}

function updateConnector(): void {
  if (!panelRoot || !target || connector.length === 0) { return; }

  const a = target.pos;                                                   // object center
  const b = panelRoot.pos.add(panelRoot.rot.rotateVector(new Vector3(0, -H / 2, 0))); // panel bottom
  const control = a.add(b).multiply(0.5).add(new Vector3(0, -0.14, 0));   // sag for the swoop

  for (let i = 0; i < SEG; i++) {
    const p0 = bezier(a, control, b, i / SEG);
    const p1 = bezier(a, control, b, (i + 1) / SEG);
    const dir = p1.subtract(p0);
    const len = dir.magnitude();

    const seg = connector[i];
    seg.pos = p0.add(p1).multiply(0.5);
    seg.scale = new Vector3(0.006, 0.006, Math.max(0.001, len));
    seg.rot = lookRotation(dir);
  }
}


// --- update loop: freeze physics-off bodies + drive the connector ----------

registerStart(start);
function start() {
  Events.onPhysicsUpdate(onPhysicsUpdate);
}

function onPhysicsUpdate(deltaTime: number) {
  physicsEnabled.forEach((enabled, entity) => {
    if (enabled || !entity.exists()) { return; }

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

  updateConnector();
}
