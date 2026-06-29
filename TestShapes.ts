import { Color } from "./Yuu API/Basic Types/Color";
import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { registerStart } from "./Yuu API/RegisterStart";
import { spawnPrimitive } from "./Yuu API/SpawnPrimitive";


/**
 * Test Shapes
 * ===========
 * Scatters a handful of colored primitives around the world at different heights so
 * Build Mode (fly / zoom / spawn ring) has things to navigate around, zoom into, and
 * aim near. Everything is created ONCE at world load (the crash-safe pattern), in
 * front of you (toward -Z) where the spawn ring shows.
 *
 * Visual only (no colliders) so they never get in the way while you test. To remove
 * them, delete the `import "./TestShapes";` line from Main.ts, or set ENABLED = false.
 */

const ENABLED = true;

const palette: Color[] = [
  Color.red, Color.orange, Color.yellow, Color.green, Color.cyan,
  Color.blue, Color.purple, Color.magenta, Color.pink, Color.lavender,
];


registerStart(spawnTestShapes);
function spawnTestShapes() {
  if (!ENABLED) { return; }

  // Cubes marching forward (-Z) and climbing in height.
  for (let i = 0; i < 6; i++) {
    const pos = new Vector3(-5 + i * 2, 0.5 + i, -3 - i * 1.5);
    spawnPrimitive.cube(pos, Vector3.one, Quaternion.one, palette[i % palette.length], 1, false, 'Empty', undefined);
  }

  // Floating spheres at a range of heights, off to the sides.
  const spheres: Vector3[] = [
    new Vector3(-4, 2.0, -6),
    new Vector3(4, 3.5, -7),
    new Vector3(-2, 5.0, -9),
    new Vector3(3, 6.5, -11),
  ];
  spheres.forEach((p, i) => {
    spawnPrimitive.sphere(16, 12, p, 1.2, Quaternion.one, palette[(i + 3) % palette.length], 1, 'None', 'Empty', undefined);
  });

  // Cones sitting on the floor - handy markers for aiming the spawn ring.
  const cones: Vector3[] = [
    new Vector3(-6, 0.5, -4),
    new Vector3(6, 0.5, -5),
    new Vector3(0, 0.5, -8),
  ];
  cones.forEach((p, i) => {
    spawnPrimitive.cone(16, p, 1, Quaternion.one, palette[(i + 6) % palette.length], 1, 'None', 'Empty', undefined);
  });

  // Tall pillars to fly up alongside and gauge height while zooming.
  for (let i = 0; i < 3; i++) {
    const pos = new Vector3(-8 + i * 8, 4, -13);
    spawnPrimitive.cube(pos, new Vector3(1, 8, 1), Quaternion.one, Color.white, 1, false, 'Empty', undefined);
  }
}
