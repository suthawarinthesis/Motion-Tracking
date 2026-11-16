import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { BodyPoseRig } from './pose-rig.js';
import { airways, heartParts, heartViews, organs } from './anatomy.js';
import { rebuildMissions } from './missions.js';

const bodyURL = new URL('./assets/models/body.glb', import.meta.url).href;
const lungsURL = new URL('./assets/models/lungs.glb', import.meta.url).href;
const heartURL = new URL('./assets/models/heart.glb', import.meta.url).href;
const namedOrgans = Object.fromEntries(organs.map(organ => [organ.id, organ]));
const upperCamera = { target: [0, 1.28, .01], distance: 1.61, minAspect: .72 };
const upperPoseCamera = { target: [0, 1.42, .02], distance: 2.01, minAspect: .83 };
const fullCamera = { target: [0, .86, 0], distance: 3.14, minAspect: .56 };
const fullPoseCamera = { target: [0, .92, 0], distance: 3.39, minAspect: .66 };
const detailCamera = { target: [0, 0, 0], distance: 1.65, minAspect: .75 };

function surface(color, { flat = false, opacity = 1 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity === 1,
    roughness: flat ? .80 : .55,
    metalness: 0
  });
}

function worldCenter(object) {
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

function light(scene) {
  scene.add(new THREE.HemisphereLight(0xf6f7ef, 0x697883, 1.65));
  const key = new THREE.DirectionalLight(0xffefe2, 2.25);
  key.position.set(-2.5, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb1e5e7, 1.2);
  fill.position.set(3.5, 1.4, 0.7);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x8de6d3, 1.65);
  rim.position.set(1, 2, -3);
  scene.add(rim);
}

export class AnatomyScene {
  constructor(stage) {
    this.stage = stage;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.03, 50);
    this.scene = new THREE.Scene();
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    this.software = !gl;
    if (gl) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
    } else {
      this.renderer = new CanvasRenderer(this.canvas);
    }
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-describedby', 'stageDescription');
    this.stage.append(this.canvas);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.enablePan = true;
    this.controls.rotateSpeed = .68;
    this.controls.zoomSpeed = .9;
    this.controls.minPolarAngle = Math.PI * .13;
    this.controls.maxPolarAngle = Math.PI * .87;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.angles = new THREE.Spherical();
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.projected = new THREE.Vector3();
    this.organPosition = new THREE.Vector3();
    this.plane = new THREE.Plane();
    this.mode = 'explore';
    this.framing = 'upper';
    this.pan = false;
    this.organs = new Map();
    this.details = new Map();
    this.boneContext = surface('#8e9a90', { flat: true, opacity: .66 });
    this.boneSolo = surface('#c9cbbb', { flat: true });
    this.skinMaterial = surface('#809e8e', { flat: true, opacity: .10 });
    this.layer = 'skeleton';
    this.bonePose = surface('#88968b', { flat: true, opacity: .76 });
    this.selected = 'heart';
    light(this.scene);
    this.frame(upperCamera);
    this.resize();
  }

  loadAsset(url) {
    return this.loader.loadAsync(this.software ? url.replace(/\.glb$/, '-light.glb') : url);
  }

  async loadBody() {
    const [gltf, lungs] = await Promise.all([this.loadAsset(bodyURL), this.loader.loadAsync(lungsURL)]);
    const body = gltf.scene;
    const systems = Object.fromEntries(
      ['skeleton', 'organs', 'skin', 'muscles', 'vessels', 'nerves'].map(id => [id, body.getObjectByName(id)])
    );
    for (const id of ['lung_l', 'lung_r']) {
      const lungMesh = lungs.scene.getObjectByName(id);
      if (!lungMesh?.isMesh || !systems.organs) throw new Error('Missing a lung surface.');
      systems.organs.getObjectByName(id)?.removeFromParent();
      systems.organs.add(lungMesh);
    }
    const expected = organs.map(organ => body.getObjectByName(organ.id));
    if (Object.values(systems).some(group => !group) || expected.some(mesh => !mesh?.isMesh)) {
      throw new Error('Body atlas is missing named anatomy meshes.');
    }
    this.body = body;
    this.systems = systems;
    this.scene.add(body);
    body.updateMatrixWorld(true);
    this.movable = new THREE.Group();
    body.add(this.movable);
    systems.skin.traverse(mesh => {
      if (mesh.isMesh) {
        mesh.material = this.skinMaterial;
        mesh.renderOrder = 3;
      }
    });
    systems.skeleton.traverse(mesh => {
      if (mesh.isMesh) mesh.renderOrder = 1;
    });
    for (let i = 0; i < expected.length; i++) {
      const mesh = expected[i];
      const organ = organs[i];
      const material = surface(organ.color);
      mesh.material = material;
      mesh.userData.organ = organ.id;
      const home = worldCenter(mesh);
      const prototype = mesh.clone();
      const pivot = new THREE.Group();
      this.movable.add(pivot);
      pivot.position.copy(home);
      pivot.attach(mesh);
      this.organs.set(organ.id, { mesh, pivot, prototype, home, outside: false });
    }
    this.rig = new BodyPoseRig([systems.skeleton, systems.muscles], this.organs);
    this.setMode('explore');
    this.select('heart');
  }

  setMode(mode, layer = 'skeleton', framing = mode === 'explore' ? 'upper' : 'full') {
    if (!this.body) return;
    this.closeDetail();
    if (this.mode === 'pose' && mode !== 'pose') this.rig.reset();
    this.mode = mode;
    this.framing = framing;
    this.setPan(this.pan);
    this.body.visible = true;
    // Mirror the display while the rig keeps each anatomical side assignment.
    this.body.scale.x = Math.abs(this.body.scale.x) * (mode === 'pose' ? -1 : 1);
    this.body.updateMatrixWorld(true);
    this.applyLayer(layer);
    this.recenter();
  }

  applyLayer(layer) {
    if (!this.body) return;
    this.layer = layer;
    const inXray = this.mode === 'xray';
    const inPose = this.mode === 'pose';
    const { skeleton, muscles, skin, vessels, nerves } = this.systems;
    skeleton.visible = inPose ? layer === 'mixed' : !inXray || layer === 'skeleton';
    muscles.visible = (inXray || inPose) && layer === 'muscles';
    this.movable.visible = !inXray || layer === 'organs';
    skin.visible = !inPose && (!inXray || layer === 'organs');
    vessels.visible = nerves.visible = false;
    const boneMaterial = inXray ? this.boneSolo : inPose ? this.bonePose : this.boneContext;
    if (this.appliedBoneMaterial !== boneMaterial) {
      skeleton.traverse(mesh => {
        if (mesh.isMesh) mesh.material = boneMaterial;
      });
      this.appliedBoneMaterial = boneMaterial;
    }
    this.setOrganVisibility();
  }

  setRebuildMission(mission) {
    this.rebuildMission = mission;
    if (this.mode !== 'rebuild') return;
    this.setOrganVisibility();
    this.recenter();
  }

  setOrganVisibility() {
    for (const [id, entry] of this.organs) {
      if (this.mode === 'rebuild') entry.pivot.visible = this.currentMission.ids.includes(id);
      else if (this.mode === 'explore') entry.pivot.visible = true;
      else entry.pivot.visible = this.layer !== 'muscles' || entry.outside;
    }
  }

  select(id) {
    this.selected = id;
    this.setOrganVisibility();
    for (const [key, entry] of this.organs) {
      entry.mesh.material.emissive.set(key === id && ['explore', 'pose'].includes(this.mode) ? '#7c3e28' : '#000000');
      entry.mesh.material.emissiveIntensity = .27;
    }
  }

  applyPose(points, time) {
    if (this.mode !== 'pose' || !this.rig) return;
    this.rig.apply(points, time, this.framing);
    this.body.updateMatrixWorld(true);
  }

  resetPose() {
    if (!this.rig) return;
    this.rig.reset();
    this.body.updateMatrixWorld(true);
  }

  resetOrgans() {
    for (const id of this.organs.keys()) this.returnOrg(id, false);
    this.setOrganVisibility();
  }

  returnOrg(id, refresh = true) {
    const entry = this.organs.get(id);
    if (!entry) return;
    entry.outside = false;
    this.rig.moveOrgan(id, entry);
    if (refresh) this.setOrganVisibility();
  }

  pullOut(id) {
    const organ = this.organs.get(id);
    const side = id === 'heart' || id.endsWith('_l') || id === 'stomach' ? 1 : -1;
    this.rig.moveOrgan(id, organ);
    organ.pivot.position.add(new THREE.Vector3(side * .31, .03, .16));
    organ.outside = true;
    this.setOrganVisibility();
  }

  async prepareDetail(id) {
    if (this.details.has(id)) return this.details.get(id);
    const entries = new Map();
    let group;
    if (id === 'heart') {
      group = (await this.loadAsset(heartURL)).scene;
      group.traverse(mesh => {
        const key = mesh.userData.structureId;
        if (!mesh.isMesh || !heartParts[key]) return;
        mesh.material = surface(heartParts[key].color);
        entries.set(key, { mesh, data: heartParts[key] });
      });
      if (Object.keys(heartParts).some(key => !entries.has(key))) {
        throw new Error('The heart model is missing a chamber or vessel.');
      }
    } else {
      group = new THREE.Group();
      const mesh = this.organs.get(id).prototype.clone();
      mesh.material = surface(namedOrgans[id].color);
      group.add(mesh);
      entries.set(id, { mesh, data: namedOrgans[id] });
      if (id.startsWith('lung_')) {
        for (const [key, data] of Object.entries(airways)) {
          const source = this.organs.get(key)?.prototype;
          if (!source) continue;
          const airway = source.clone();
          airway.material = surface(data.color);
          group.add(airway);
          entries.set(key, { mesh: airway, data });
        }
      }
    }
    const bounds = new THREE.Box3().setFromObject(group);
    const size = bounds.getSize(new THREE.Vector3());
    const parent = new THREE.Group();
    parent.add(group);
    parent.scale.setScalar(.69 / Math.max(size.x, size.y, size.z));
    group.position.copy(bounds.getCenter(new THREE.Vector3())).negate();
    for (const [key, entry] of entries) {
      entry.mesh.userData.part = key;
      entry.center = entry.mesh.worldToLocal(worldCenter(entry.mesh));
    }
    const detail = { id, parent, entries };
    this.details.set(id, detail);
    return detail;
  }

  openDetail(detail) {
    this.savedView = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.detail = detail;
    this.scene.add(detail.parent);
    this.body.visible = false;
    this.frame(detailCamera);
  }

  closeDetail() {
    if (!this.detail) return;
    this.detail.parent.removeFromParent();
    this.detail = null;
    this.body.visible = true;
    this.frame(this.defaultFrame());
    this.camera.position.copy(this.savedView.position);
    this.controls.target.copy(this.savedView.target);
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  updateDetail(view, part) {
    const { detail } = this;
    if (!detail) return;
    const inside = detail.id === 'heart' && view === 'inside';
    const revealAirway = detail.id.startsWith('lung_') && Boolean(airways[part]);
    for (const [key, entry] of detail.entries) {
      const { mesh } = entry;
      mesh.visible = detail.id !== 'heart' || (inside ? heartViews.inside.includes(key)
        : !['left-ventricle', 'right-ventricle'].includes(key));
      mesh.material.emissive.set(part === key ? entry.data.color : '#000000');
      mesh.material.emissiveIntensity = .33;
      if (key === detail.id && detail.id.startsWith('lung_')) {
        mesh.material.opacity = revealAirway ? .28 : 1;
        mesh.material.transparent = revealAirway;
        mesh.material.depthWrite = !revealAirway;
      }
    }
  }

  partCenter(id) {
    const entry = this.detail?.entries.get(id);
    return entry?.mesh.localToWorld(entry.center.clone());
  }

  frame(config) {
    const controls = this.controls;
    const extra = Math.max(1, config.minAspect / this.camera.aspect);
    controls.target.set(...config.target);
    controls.minDistance = config.distance * .46;
    controls.maxDistance = config.distance * 3.3;
    controls.enableRotate = controls.enableZoom = this.mode !== 'rebuild';
    this.camera.position.set(config.target[0], config.target[1], config.distance * extra);
    controls.update();
    this.camera.updateMatrixWorld();
  }

  get currentMission() {
    return this.rebuildMission ?? rebuildMissions.chest;
  }

  defaultFrame() {
    if (this.mode === 'rebuild') return this.currentMission.camera;
    if (this.mode === 'pose') return this.framing === 'upper' ? upperPoseCamera : fullPoseCamera;
    return this.framing === 'upper' ? upperCamera : fullCamera;
  }

  setFraming(framing) {
    this.framing = framing;
    this.recenter();
  }

  setPan(enabled) {
    this.pan = enabled;
    this.controls.enablePan = this.mode !== 'rebuild';
    this.controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = enabled ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }

  panView(dx, dy) {
    if (this.mode === 'rebuild') return;
    const height = 2 * this.camera.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const shift = right.multiplyScalar(-dx * height * this.camera.aspect).addScaledVector(up, dy * height);
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  recenter() {
    this.frame(this.detail ? detailCamera : this.defaultFrame());
  }

  moveView(dx, dy) {
    if (this.mode === 'rebuild') return;
    this.angles.setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.angles.theta -= dx * Math.PI * 2;
    this.angles.phi = THREE.MathUtils.clamp(this.angles.phi - dy * Math.PI, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    this.camera.position.setFromSpherical(this.angles).add(this.controls.target);
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  zoom(factor) {
    if (this.mode === 'rebuild') return;
    const direction = this.camera.position.clone().sub(this.controls.target);
    const dist = THREE.MathUtils.clamp(direction.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(direction.setLength(dist));
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  viewAngle() {
    return this.controls.getAzimuthalAngle();
  }

  resize() {
    const { clientWidth, clientHeight } = this.stage;
    if (clientWidth < 1 || clientHeight < 1) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    if (this.mode === 'rebuild') this.recenter();
  }

  pointerRay(x, y) {
    const rect = this.stage.getBoundingClientRect();
    this.ndc.set(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  pick(x, y, choices) {
    this.pointerRay(x, y);
    const candidates = this.detail
      ? Array.from(this.detail.entries.values()).map(entry => entry.mesh).filter(mesh => mesh.visible)
      : choices.map(id => this.organs.get(id)).filter(entry => entry.pivot.visible).map(entry => entry.mesh);
    const hit = this.ray.intersectObjects(candidates, false)[0];
    return hit ? { key: hit.object.userData.part ?? hit.object.userData.organ, point: hit.point } : null;
  }

  startDrag(id, point) {
    const organ = this.organs.get(id);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    const outside = organ.outside;
    organ.outside = true;
    return { organ, plane, point, outside, depth: 0, constant: plane.constant, origin: organ.pivot.position.clone() };
  }

  restoreDrag(id, drag) {
    if (drag.outside) {
      drag.organ.pivot.position.copy(drag.origin);
      drag.organ.outside = true;
    } else {
      this.returnOrg(id);
    }
  }

  dragTo(drag, x, y, near = 0) {
    const limit = Math.min(.62, this.camera.position.distanceTo(drag.point) * .32);
    const shift = this.mode === 'rebuild' ? 0 : THREE.MathUtils.clamp(near * .73, -limit, limit);
    drag.depth = THREE.MathUtils.lerp(drag.depth, shift, .45);
    drag.plane.constant = drag.constant + drag.depth;
    this.pointerRay(x, y);
    const point = this.ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (point) {
      const { pivot } = drag.organ;
      const worldOrigin = pivot.parent.localToWorld(drag.origin.clone());
      const target = worldOrigin.add(point.sub(drag.point));
      pivot.position.copy(pivot.parent.worldToLocal(target));
    }
  }

  stagePosition(x, y, z) {
    const rect = this.stage.getBoundingClientRect();
    this.pointerRay(rect.left + x * rect.width, rect.top + y * rect.height);
    this.plane.constant = -z;
    this.plane.normal.set(0, 0, 1);
    return this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  projectOrgan(id) {
    const point = this.organs.get(id).pivot.getWorldPosition(this.organPosition);
    return this.project(point);
  }

  project(point) {
    this.projected.copy(point).project(this.camera);
    return {
      x: (this.projected.x * .5 + .5) * this.stage.clientWidth,
      y: (.5 - this.projected.y * .5) * this.stage.clientHeight,
      visible: Math.abs(this.projected.x) <= 1 && Math.abs(this.projected.y) <= 1 && Math.abs(this.projected.z) <= 1
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
