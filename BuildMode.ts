import { Quaternion } from "./Yuu API/Basic Types/Quaternion";
import { Vector3 } from "./Yuu API/Basic Types/Vector3";
import { Controller } from "./Yuu API/Controller";
import { Events } from "./Yuu API/Events";
import { Player } from "./Yuu API/Player";
import { registerStart } from "./Yuu API/RegisterStart";


/**
 * Build Mode
 * ==========
 * A free-fly editing mode. While it is active you fly the camera (the player rig)
 * around the world by physically grabbing space with the controller grips.
 *
 * CONTROLS
 *  - Toggle on / off : click BOTH thumbsticks in at the same time.
 *  - Move            : hold ONE grip and move your hand. The world stays stuck to
 *                      your hand, pulling you through space (grab & drag).
 *  - Rotate          : hold BOTH grips and twist. The world yaws to follow the line
 *                      between your hands.
 *  - Zoom            : hold BOTH grips and spread / squeeze your hands. Pinch to zoom
 *                      in and out, clamped between a min and a max.
 *
 * WHY IT IS BUILT THIS WAY (API constraints)
 *  - Godot.events.onControllerInput only reports button *presses*; there is no
 *    thumbstick axis, so all locomotion is driven by 6DoF hand motion.
 *  - There is no rig-scaling call, so "zoom" is a clamped dolly (the rig is moved
 *    toward / away from the point between your hands) rather than true world scaling.
 *  - There is NO API to disable the player's gravity or body collider (Godot.localPlayer
 *    only exposes position/rotation). So instead of "switching off" gravity, build mode
 *    OWNS the rig transform while active: it records a desired position and re-asserts
 *    it every process AND physics frame, so gravity / ground-snap can never pull you
 *    back down. You float freely; on exit, normal movement and gravity resume.
 *    (A true "only my hands collide, my body has no collider" would need a new
 *    engine-side function, like the other C++ TODOs in this codebase.)
 *
 * The grab maths re-derive from a fixed world anchor every frame, so movement and
 * rotation self-correct, never drift, and naturally cancel any gravity nudge.
 */


// ---------------------------------------------------------------------------
// Tunable settings - safe to tweak.
// ---------------------------------------------------------------------------
export const BuildModeSettings = {
  /** Most you can zoom IN  (upper bound on the zoom level; 1 = your zoom on entry). */
  maxZoomIn: 20,
  /** Most you can zoom OUT (lower bound on the zoom level; 1 = your zoom on entry). */
  maxZoomOut: 0.05,
  /** Pinch response. 1 = the world scales 1:1 with how far your hands spread. */
  zoomSensitivity: 1,
  /** Twist response. 1 = the world turns 1:1 with the twist of your hands. */
  rotateSensitivity: 1,
  /** Hold the rig in place against gravity / ground-snap while build mode is active. */
  holdAgainstGravity: true,
  /** Print "Build Mode: ON/OFF" to the console when toggled. */
  logToggles: true,
};


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const BuildMode = {
  /** Turn build mode on. */
  enable,
  /** Turn build mode off. */
  disable,
  /** Flip build mode on / off. */
  toggle,
  /** @returns true while build mode is active. */
  isActive: (): boolean => active,
};


let active = false;

/**
 * The pose build mode wants the rig to be at. We hold the rig here every frame so
 * gravity cannot drag us to the floor. The grab gestures update it.
 */
let desiredPos: Vector3 = Vector3.zero;
let desiredRot: Quaternion = Quaternion.one;

function enable() {
  if (active) { return; }

  active = true;
  zoomLevel = 1;        // reset zoom each time you enter
  lastGripCount = -1;   // force grab references to re-seed on the next frame

  // Start holding from wherever we currently are, so entering never snaps you.
  desiredPos = Player.position.get() ?? desiredPos;
  desiredRot = Player.rotation.get() ?? desiredRot;

  if (BuildModeSettings.logToggles) { console.log('Build Mode: ON'); }
}

function disable() {
  if (!active) { return; }

  active = false; // stop holding -> normal movement + gravity resume

  if (BuildModeSettings.logToggles) { console.log('Build Mode: OFF'); }
}

function toggle() {
  if (active) { disable(); } else { enable(); }
}


// ---------------------------------------------------------------------------
// Toggle gesture: both thumbsticks clicked in together
// ---------------------------------------------------------------------------
let leftStickDown = false;
let rightStickDown = false;
let toggleArmed = true; // stops it firing repeatedly while both are held

function reevaluateToggleGesture() {
  if (leftStickDown && rightStickDown) {
    if (toggleArmed) {
      toggleArmed = false;
      toggle();
    }
  }
  else {
    toggleArmed = true; // re-arm once at least one stick is released
  }
}


// ---------------------------------------------------------------------------
// Grip + grab state
// ---------------------------------------------------------------------------
let leftGripDown = false;
let rightGripDown = false;

/** How many grips were held last frame, used to detect 0 / 1 / 2-hand transitions. */
let lastGripCount = -1;

/** Single-hand drag: the world point we keep glued under the gripping hand. */
let dragAnchor: Vector3 = Vector3.zero;

/** Two-hand references, captured whenever the held-grip count changes. */
let twoHandAnchor: Vector3 = Vector3.zero;    // world midpoint to keep under the hands
let twoHandRefVector: Vector3 = Vector3.zero; // horizontal left -> right hand vector
let prevHandDistance = 1;                     // hand spread last frame (drives zoom)

/** Cumulative zoom; 1 on entry, clamped to [maxZoomOut, maxZoomIn]. */
let zoomLevel = 1;


// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
registerStart(start);
function start() {
  Controller.subscribe('leftThumbstick', 'Pressed', () => { leftStickDown = true; reevaluateToggleGesture(); });
  Controller.subscribe('leftThumbstick', 'Released', () => { leftStickDown = false; reevaluateToggleGesture(); });
  Controller.subscribe('rightThumbstick', 'Pressed', () => { rightStickDown = true; reevaluateToggleGesture(); });
  Controller.subscribe('rightThumbstick', 'Released', () => { rightStickDown = false; reevaluateToggleGesture(); });

  Controller.subscribe('leftGrip', 'Pressed', () => { leftGripDown = true; });
  Controller.subscribe('leftGrip', 'Released', () => { leftGripDown = false; });
  Controller.subscribe('rightGrip', 'Pressed', () => { rightGripDown = true; });
  Controller.subscribe('rightGrip', 'Released', () => { rightGripDown = false; });

  Events.onUpdate(onUpdate);               // smooth, render-rate locomotion
  Events.onPhysicsUpdate(onPhysicsUpdate); // re-assert pose so gravity can't win
}


// ---------------------------------------------------------------------------
// Per-frame locomotion (process / render rate)
// ---------------------------------------------------------------------------
function onUpdate(_deltaTime: number) {
  if (!active) {
    lastGripCount = -1;
    return;
  }

  const leftHand = Player.leftHand.position.get();
  const rightHand = Player.rightHand.position.get();

  const gripCount = (leftGripDown ? 1 : 0) + (rightGripDown ? 1 : 0);

  // Re-seed references whenever the number of held grips changes, so the view
  // never jumps as you add or release a hand.
  if (gripCount !== lastGripCount) {
    seedReferences(leftHand, rightHand);
    lastGripCount = gripCount;
  }

  if (gripCount === 1) {
    const hand = leftGripDown ? leftHand : rightHand;
    if (hand) { dragMove(hand); }
  }
  else if (gripCount === 2) {
    if (leftHand && rightHand) { twoHandManipulate(leftHand, rightHand); }
  }

  // Hold our pose even when not gripping, so releasing the grips leaves you
  // floating instead of falling.
  holdPose();
}


// ---------------------------------------------------------------------------
// Per-physics-frame hold (this is what actually beats gravity)
// ---------------------------------------------------------------------------
function onPhysicsUpdate(_deltaTime: number) {
  if (!active) { return; }
  holdPose();
}


function holdPose() {
  if (BuildModeSettings.holdAgainstGravity) {
    Player.position.set(desiredPos);
  }
}


function seedReferences(leftHand: Vector3 | undefined, rightHand: Vector3 | undefined) {
  if (leftGripDown && !rightGripDown && leftHand) { dragAnchor = leftHand.clone(); }
  if (rightGripDown && !leftGripDown && rightHand) { dragAnchor = rightHand.clone(); }

  if (leftHand && rightHand) {
    twoHandAnchor = midpoint(leftHand, rightHand);
    twoHandRefVector = horizontalXZ(rightHand.subtract(leftHand));
    prevHandDistance = Math.max(MIN_DISTANCE, leftHand.distanceTo(rightHand));
  }
}


/**
 * One grip held: drag the world so the grabbed point stays under the hand.
 * Re-derived from a fixed anchor every frame, so it self-corrects, never drifts,
 * and cancels any gravity nudge from the previous physics step.
 */
function dragMove(hand: Vector3) {
  const player = Player.position.get();
  if (!player) { return; }

  desiredPos = player.add(dragAnchor.subtract(hand));
  Player.position.set(desiredPos);
}


/**
 * Both grips held: yaw + zoom about the point between the hands, while keeping that
 * point anchored (so you also translate).
 */
function twoHandManipulate(leftHand: Vector3, rightHand: Vector3) {
  const player = Player.position.get();
  const playerRot = Player.rotation.get();
  if (!player || !playerRot) { return; }

  const mid = midpoint(leftHand, rightHand);
  const handVector = horizontalXZ(rightHand.subtract(leftHand));
  const handDistance = Math.max(MIN_DISTANCE, leftHand.distanceTo(rightHand));

  // Rotation: turn the rig so the current hand line re-aligns with the grab
  // reference. The world then appears to follow the twist of your hands.
  const yaw = signedAngleY(handVector, twoHandRefVector) * BuildModeSettings.rotateSensitivity;

  // Zoom: change in hand spread -> clamped dolly. Hand spread is unaffected by moving
  // the rig, so this needs no anchor and cannot feed back on itself.
  const rawScale = Math.pow(handDistance / prevHandDistance, BuildModeSettings.zoomSensitivity);
  const newZoom = clamp(zoomLevel * rawScale, BuildModeSettings.maxZoomOut, BuildModeSettings.maxZoomIn);
  const dolly = newZoom / zoomLevel; // 1 when pinned at a zoom limit
  zoomLevel = newZoom;
  prevHandDistance = handDistance;

  // Build the new rig pose, all relative to the hand midpoint:
  //   1) zoom      - move nearer / farther from the midpoint
  //   2) yaw       - orbit around the midpoint
  //   3) translate - so the midpoint lands back on the grab anchor
  let rel = player.subtract(mid);
  rel = rel.multiply(1 / dolly);  // zoom in -> dolly > 1 -> move closer
  rel = rotateAroundY(rel, yaw);  // orbit for rotation
  desiredPos = twoHandAnchor.add(rel);

  desiredRot = Quaternion.fromEuler(new Vector3(0, yaw, 0)).multiply(playerRot);

  Player.position.set(desiredPos);
  Player.rotation.set(desiredRot);
}


// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const MIN_DISTANCE = 0.0001;

function midpoint(a: Vector3, b: Vector3): Vector3 {
  return a.add(b).multiply(0.5);
}

/** Flatten a vector onto the horizontal (XZ) plane. */
function horizontalXZ(v: Vector3): Vector3 {
  return new Vector3(v.x, 0, v.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Signed angle (radians) from vector `a` to vector `b` about the world +Y axis. */
function signedAngleY(a: Vector3, b: Vector3): number {
  const cross = a.z * b.x - a.x * b.z; // Y component of a x b
  const dot = a.x * b.x + a.z * b.z;
  return Math.atan2(cross, dot);
}

/** Rotate a vector around the world +Y axis by `angle` radians. */
function rotateAroundY(v: Vector3, angle: number): Vector3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return new Vector3(
    v.x * cos + v.z * sin,
    v.y,
    -v.x * sin + v.z * cos,
  );
}
