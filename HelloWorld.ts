import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { inWorldConsole } from "./Yuu API/Console";
import { grabbable } from "./Yuu API/Grabbable";
import { registerStart } from "./Yuu API/RegisterStart";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


registerStart(start);
function start() {
  inWorldConsole.visible(true, new Vector3(0, 2, -2));

  // A floor to catch the cube when it is dropped or thrown
  spawnPrimitive.plane(
    'Front',
    Vector3.zero,
    new Vector3(10, 10, 1),
    Quaternion.fromEuler(new Vector3(-Math.PI / 2, 0, 0)),
    new Color(0.5, 0.5, 0.5),
    1,
    'Concave',
    'Static',
    undefined
  );

  // A grabbable physics cube floating in front of the player
  const cube = spawnPrimitive.cube(
    new Vector3(0, 1.2, -0.5),
    new Vector3(0.2, 0.2, 0.2),
    Quaternion.one,
    Color.red,
    1,
    true,
    'Physics',
    undefined
  );

  grabbable.make(cube, 0.2, {
    onGrab: (hand) => console.log(hand + ' hand grabbed the cube'),
    onRelease: (hand) => console.log(hand + ' hand released the cube'),
  });

  console.log('Grab demo: move a hand near the cube and squeeze grip to grab');
}
