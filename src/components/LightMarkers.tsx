import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useLightingStore } from "../lib/lighting-store";
import { claimPointer, releasePointer } from "../lib/pointer-claims";
import {
  MARKER_CENTRE, directionOnDome, domeSide, lightAngles, lightTowards, markerPosition, type StageLight,
} from "../lib/stage-lighting";
import { OVERLAY_LAYER } from "../rig/ViewerOverlay";

/**
 * The lights in the 3D view (21 Nov 2026, community request): a bulb where each light is, a cone the way it shines, and
 * a drag on a bulb to move its light. Canvas child; mounted only while "Show lights" is on and the UI is shown.
 *
 * Where: every marker sits on one sphere round the character (stage-lighting.ts, "light dome"): these lights are
 * directional, so only their direction is real. Dragging slides the bulb over that sphere and sets the light's bearing
 * and height through the store, the same edit the panel's sliders make, so the sliders follow the drag and a slider
 * moves the bulb. Colour and brightness show too: the bulb and the cone take the light's colour, the cone gets bolder
 * with brightness, a light that is off is grey. Outlines are dark on a light backdrop and light on a dark one.
 *
 * Drawn over everything, as editors draw their gizmos, and at half strength while a light is on the far side of the
 * character: a rim light behind the body stays easy to find and still reads as behind.
 *
 * Never in a picture: everything here is on OVERLAY_LAYER alone (ViewerOverlay.ts explains how each capture skips it).
 * Every material is marked `viewerOverlay` in its userData (a fresh object each, never shared) for the still view.
 *
 * Input: three's OrbitControls and r3f listen on the same element, r3f first, so a press on a bulb switches the orbit
 * off before the orbit sees it, and it is put back on release. The scene turntable listens on the canvas itself and so
 * hears the press first; it ignores the pointer once it is claimed (pointer-claims.ts).
 */

const BULB = 0.036, OUTLINE = 0.05, SUN_RING = 0.072;
const CONE_LENGTH = 0.3, CONE_RADIUS = 0.1;
const OFF_COLOUR = "#7a808a", SELECTED_COLOUR = "#ec2c4c";
// Outlines contrast with the backdrop (the light's own colour can be the backdrop's: a white light on Studio grey).
const INK = "#0b0d12", CHALK = "#f2efe9";

interface Geometries { bulb: THREE.BufferGeometry; outline: THREE.BufferGeometry; hit: THREE.BufferGeometry;
  hitTouch: THREE.BufferGeometry; cone: THREE.BufferGeometry; coneEdges: THREE.BufferGeometry; ring: THREE.BufferGeometry }

function makeGeometries(): Geometries {
  // The cone opens along +Z, the way a marker's group faces (it looks at the dome's centre), its tip at the bulb's edge.
  const cone = new THREE.ConeGeometry(CONE_RADIUS, CONE_LENGTH, 28, 1, true);
  cone.rotateX(-Math.PI / 2); // tip (+Y) to -Z
  cone.translate(0, 0, CONE_LENGTH / 2 + OUTLINE);
  // Its outline: the rim circle and four lines from the tip.
  const edges: number[] = [], tip = OUTLINE, base = OUTLINE + CONE_LENGTH, steps = 40;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2, b = ((i + 1) / steps) * Math.PI * 2;
    edges.push(Math.cos(a) * CONE_RADIUS, Math.sin(a) * CONE_RADIUS, base, Math.cos(b) * CONE_RADIUS, Math.sin(b) * CONE_RADIUS, base);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    edges.push(0, 0, tip, Math.cos(a) * CONE_RADIUS, Math.sin(a) * CONE_RADIUS, base);
  }
  const coneEdges = new THREE.BufferGeometry();
  coneEdges.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
  return {
    bulb: new THREE.SphereGeometry(BULB, 20, 14),
    outline: new THREE.SphereGeometry(OUTLINE, 20, 14),
    // What a press has to hit: larger than the bulb, larger still for a finger.
    hit: new THREE.SphereGeometry(0.09, 10, 8),
    hitTouch: new THREE.SphereGeometry(0.14, 10, 8),
    cone, coneEdges,
    ring: new THREE.TorusGeometry(SUN_RING, 0.007, 6, 40),
  };
}

const coarsePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

interface ControlsLike { enabled: boolean }

/** `dark`: the backdrop is dark (light outlines then), as CharacterViewer decides for its own chrome. */
export function LightMarkers({ dark }: { dark: boolean }) {
  const look = useLightingStore(state => state.look);
  const selected = useLightingStore(state => state.selected);
  const { edit, select } = useLightingStore.getState();
  const camera = useThree(state => state.camera);
  const raycaster = useThree(state => state.raycaster);
  const controls = useThree(state => state.controls) as unknown as ControlsLike | null;
  const element = useThree(state => state.gl.domElement);
  const geometries = useMemo(makeGeometries, []);
  const touch = useMemo(coarsePointer, []);
  const root = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const endDrag = useRef<(() => void) | null>(null);
  // The lights whose markers are on the far half of the dome from the camera, as one string (set only on a change).
  const [far, setFar] = useState("");
  useFrame(() => {
    const now = look.lights.filter(l => domeSide(l, camera.position.toArray()) === "far").map(l => l.id).join(" ");
    if (now !== far) setFar(now);
  });
  const farIds = new Set(far.split(" "));

  // The live camera draws the overlay layer, and r3f's picking ray tests it, only while the markers are mounted.
  useEffect(() => {
    camera.layers.enable(OVERLAY_LAYER);
    raycaster.layers.enable(OVERLAY_LAYER);
    return () => { camera.layers.disable(OVERLAY_LAYER); raycaster.layers.disable(OVERLAY_LAYER); };
  }, [camera, raycaster]);
  // Every object here on the overlay layer alone (after each render: markers come and go with the lights).
  useLayoutEffect(() => { root.current?.traverse(object => object.layers.set(OVERLAY_LAYER)); });
  useEffect(() => () => {
    endDrag.current?.();
    for (const geometry of Object.values(geometries)) geometry.dispose();
  }, [geometries]);
  // The cursor says what a press will do.
  useEffect(() => {
    element.style.cursor = dragging ? "grabbing" : hovered ? "grab" : "";
  }, [element, hovered, dragging]);
  useEffect(() => () => { element.style.cursor = ""; }, [element]);

  const startDrag = (light: StageLight, event: ThreeEvent<PointerEvent>) => {
    const press = event.nativeEvent;
    if (press.pointerType === "mouse" && press.button !== 0) return;
    event.stopPropagation();
    endDrag.current?.();
    select(light.id);
    // Keep the bulb on the half of the dome it was picked up on (directionOnDome).
    const side = domeSide(light, camera.position.toArray());
    const orbitWasOn = controls?.enabled ?? false;
    if (controls) controls.enabled = false;
    claimPointer(press.pointerId);
    setDragging(light.id);
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const move = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const direction = directionOnDome(ray.ray.origin.toArray(), ray.ray.direction.toArray(), side);
      edit(next => ({ ...next, lights: next.lights.map(l => l.id === light.id ? lightTowards(l, direction) : l) }));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      releasePointer(press.pointerId);
      // Back as it was: off stays off (the scene turntable keeps the orbit off).
      if (controls && !controls.enabled) controls.enabled = orbitWasOn;
      endDrag.current = null;
      setDragging(null);
    };
    const end = (event: PointerEvent) => { if (event.pointerId === press.pointerId) finish(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    endDrag.current = finish;
  };

  return (
    <group ref={root} name="Light markers">
      {look.lights.map(light => (
        <Marker key={light.id} light={light} exposure={look.exposure} geometries={geometries} touch={touch}
          behind={farIds.has(light.id)} contrast={dark ? CHALK : INK}
          state={dragging === light.id || selected === light.id ? "selected" : hovered === light.id ? "hovered" : "idle"}
          labelled={dragging === light.id || hovered === light.id || (!dragging && !hovered && selected === light.id)}
          onDown={event => startDrag(light, event)}
          onHover={on => setHovered(current => on ? light.id : current === light.id ? null : current)} />
      ))}
    </group>
  );
}

const overlay = () => ({ viewerOverlay: true });

function Marker({ light, exposure, geometries, touch, behind, contrast, state, labelled, onDown, onHover }: {
  light: StageLight; exposure: number; geometries: Geometries; touch: boolean; behind: boolean; contrast: string;
  state: "idle" | "hovered" | "selected";
  labelled: boolean; onDown(event: ThreeEvent<PointerEvent>): void; onHover(on: boolean): void;
}) {
  const group = useRef<THREE.Group>(null);
  const position = markerPosition(light);
  const [px, py, pz] = position;
  useLayoutEffect(() => {
    // +Z towards the dome's centre: the cone opens the way the light shines.
    group.current?.lookAt(MARKER_CENTRE[0], MARKER_CENTRE[1], MARKER_CENTRE[2]);
  }, [px, py, pz]);
  const on = light.enabled && light.intensity > 0;
  // The still view tone-maps everything it draws with the look's exposure; dividing it out keeps a bulb's colour the
  // light's colour whatever the exposure.
  const colour = useMemo(() => new THREE.Color(on ? light.color : OFF_COLOUR).multiplyScalar(1 / Math.max(exposure, 0.2)),
    [on, light.color, exposure]);
  const strength = on ? Math.min(1, light.intensity / 4) : 0;
  const outline = state === "idle" ? contrast : SELECTED_COLOUR;
  const fade = behind && state === "idle" ? 0.5 : 1;
  const grow = state === "idle" ? 1 : 1.25;
  const { bearing, height } = lightAngles(light.position);
  return (
    <group ref={group} position={position}>
      <mesh geometry={geometries.outline} renderOrder={20} scale={grow}>
        <meshBasicMaterial color={outline} side={THREE.BackSide} transparent opacity={0.9 * fade} depthTest={false}
          depthWrite={false} userData={overlay()} />
      </mesh>
      <mesh geometry={geometries.bulb} renderOrder={21}>
        <meshBasicMaterial color={colour} transparent opacity={fade} depthTest={false} depthWrite={false} userData={overlay()} />
      </mesh>
      {light.role === "sun" && (
        // The sun (the light that casts the shadow) wears a ring.
        <mesh geometry={geometries.ring} renderOrder={22}>
          <meshBasicMaterial color={colour} transparent opacity={0.85 * fade} depthTest={false} depthWrite={false}
            userData={overlay()} />
        </mesh>
      )}
      <mesh geometry={geometries.cone} renderOrder={23}>
        <meshBasicMaterial color={colour} transparent opacity={(0.18 + 0.3 * strength) * fade} side={THREE.DoubleSide}
          depthTest={false} depthWrite={false} userData={overlay()} />
      </mesh>
      <lineSegments geometry={geometries.coneEdges} renderOrder={24}>
        <lineBasicMaterial color={contrast} transparent opacity={(on ? 0.7 : 0.4) * fade} depthTest={false} depthWrite={false}
          userData={overlay()} />
      </lineSegments>
      {/* What a press has to hit (never drawn). */}
      <mesh geometry={touch ? geometries.hitTouch : geometries.hit}
        onPointerDown={onDown}
        onPointerOver={event => { event.stopPropagation(); onHover(true); }}
        onPointerOut={() => onHover(false)}>
        <meshBasicMaterial visible={false} userData={overlay()} />
      </mesh>
      {labelled && (
        // A DOM label (never in a picture: pictures are drawn from the 3D scene only). Under the viewer's controls.
        <Html zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span className="hud pointer-events-none ml-4 -mt-3 block whitespace-nowrap bg-ink-950/85 px-2 py-1 text-[11px] text-fg">
            {light.name}{on ? "" : " (off)"} · {Math.round(bearing)}° / {Math.round(height)}°
          </span>
        </Html>
      )}
    </group>
  );
}
