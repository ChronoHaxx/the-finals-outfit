import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { captionText, framing, posedFraming, posedPoints, VIEW_REACH } from "../../src/rig/SharePreviewRender";

// A posed share card (10 Nov 2026) is framed from the pose as drawn, never from a cached box, and pulled back until
// a wide pose fits each of the four views.

const VIEWS = [0, 35, 90, 180], FOV = 30, HEIGHT = 630;

// A 2 m skinned bar along y, bound to two bones; bending the top bone swings its upper half out sideways.
function bar() {
  const geometry = new THREE.BoxGeometry(0.2, 2, 0.2, 1, 8, 1).translate(0, 1, 0);
  const position = geometry.attributes.position;
  const index: number[] = [], weight: number[] = [];
  for (let i = 0; i < position.count; i++) { index.push(position.getY(i) > 1 ? 1 : 0, 0, 0, 0); weight.push(1, 0, 0, 0); }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weight, 4));
  const root = new THREE.Bone(), top = new THREE.Bone();
  top.position.y = 1;
  root.add(top);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const group = new THREE.Group();
  group.add(root, mesh);
  mesh.bind(new THREE.Skeleton([root, top]));
  return { group, mesh, top };
}

test("a pose is measured as drawn, and the skinned mesh's cached box is left for the still card", () => {
  const { group, mesh, top } = bar();
  top.rotation.z = -Math.PI / 2; // the top half now points along +x
  const points = posedPoints(group);
  const box = new THREE.Box3().setFromPoints(points);
  assert.ok(box.max.x > 0.95, `the swung half reaches x = 1, got ${box.max.x}`);
  assert.ok(box.max.y < 1.2, `and no longer reaches y = 2, got ${box.max.y}`);
  assert.equal(mesh.boundingBox, null, "three's cached box must not be computed in a pose");
});

test("a wide pose pulls the camera back until every point is within its view's reach; a narrow one keeps the still framing", () => {
  const narrow = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 1.8, 0.1)];
  const still = framing(new THREE.Box3().setFromPoints(narrow), 0.16);
  assert.equal(posedFraming(narrow, { x: 0, z: 0 }).distance, still.distance);

  // Arms out (0.9 m each side, a T-pose) and a prop held behind.
  const wide = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.9, 1.4, 0.1), new THREE.Vector3(-0.9, 1.4, 0.1), new THREE.Vector3(-0.3, 1.2, -0.6)];
  const { distance } = posedFraming(wide, { x: 0, z: 0 });
  assert.ok(distance > still.distance);
  assert.ok(distance < still.distance * 1.6, "within the cap: everything fits");
  // Project every point through each view's camera: all land within that side's reach, one at least on its limit.
  let tightest = Infinity;
  const camera = new THREE.PerspectiveCamera(FOV, 400 / HEIGHT, 0.05, 50);
  VIEWS.forEach((degrees, index) => {
    const a = THREE.MathUtils.degToRad(degrees);
    camera.position.set(Math.sin(a) * distance, 1, Math.cos(a) * distance);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    for (const point of wide) {
      const px = point.clone().project(camera).x * (400 / 2); // NDC x -> px from the view centre
      const reach = px >= 0 ? VIEW_REACH[index].right : VIEW_REACH[index].left;
      assert.ok(Math.abs(px) <= reach + 0.5, `${degrees} deg: ${point.toArray()} at ${px.toFixed(1)} px, reach ${reach}`);
      tightest = Math.min(tightest, reach - Math.abs(px));
    }
  });
  assert.ok(tightest < 0.5, `pulled back no further than needed (closest margin ${tightest.toFixed(2)} px)`);
  // The ground keeps its place on the card (just above the caption); the extra height goes to the top.
  const posed = posedFraming(wide, { x: 0, z: 0 });
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const lowest = still.centerY - still.distance * tan / 1.2;
  assert.ok(Math.abs((posed.centerY - lowest) / (posed.distance * tan) - (still.centerY - lowest) / (still.distance * tan)) < 1e-9,
    "the lowest point sits at the same height on the card as without the pull-back");
});

test("a far stray point cannot shrink the body away; the caption names the frame", () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(40, 1, 0)];
  const still = framing(new THREE.Box3().setFromPoints(points), 0.16);
  assert.ok(Math.abs(posedFraming(points, { x: 0, z: 0 }).distance - still.distance * 1.6) < 1e-9);
  assert.deepEqual(captionText({ clip: "ace-pilot", label: "Ace Pilot", time: 37 / 30, paused: true, frame: 37, lastFrame: 90 }),
    { title: "ACE PILOT", detail: "1.23 s · frame 37 / 90 · paused" });
});
