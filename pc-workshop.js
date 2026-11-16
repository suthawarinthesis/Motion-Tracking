import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { PcBuild, caseOrigin, monitorOrigin, keyboardOrigin, deskY, components, cables, mountSlots, ports } from './pc-build.js';
import { MonitorDisplay } from './pc-display.js';
import { createPcModel } from './pc-model.js';
import { closeToWorktop, nearestTablePosition, surfaceHeight, worktop, worktopLimits } from './pc-table.js';

const isPart = id => Boolean(components[id]);
const isInternal = id => isPart(id) || cables[id]?.internal;
const itemData = id => components[id] ?? cables[id];
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const OPEN_SIDE = new THREE.Vector3(0, 0, 1);
const upright = [0, 0, 0];
const bootMessages = {
  CPU: 'POST · CPU',
  DRAM: 'POST · DRAM',
  VGA: 'POST · VGA',
  CPU_FAN: 'POST · CPU FAN ERROR',
  BOOT: 'POST · BOOT DEVICE',
  keyboard: 'POST · KEYBOARD'
};
const bootScreenMessages = {
  CPU_FAN: 'CPU Fan Error',
  BOOT: 'No bootable device',
  keyboard: 'Keyboard not detected'
};
const cameraViews = {
  bench: { target: [0, -11.0, 14.0], direction: [.18, .57, .84], width: 174, distance: 214 },
  case: { target: [0, .9, 4.5], direction: [.29, .24, .94], width: 61, distance: 96 },
  board: { target: [0, 0, 1], direction: [.13, .87, .49], width: 41, distance: 62 },
  ports: { target: [1.5, -4.7, -22], direction: [-.57, .34, -.78], width: 135, distance: 164 },
  screen: { target: [-31, -4.7, -17], direction: [0, .035, 1], width: 62, distance: 59 },
  startup: { target: [-20, -6, -13], direction: [-.06, .14, 1], width: 101, distance: 127 },
  parts: { target: [2.0, -22.0, 39.5], direction: [.10, .92, .39], width: 137, distance: 116 }
};
const guideSize = {
  board: [12.45, 15.55], cpu: [2.25, 2.25], ram: [.48, 6.8], ssd: [4.1, 1.28],
  gpu: [7.9, .84], psu: [8, 4.3], cooler: [4.5, 4.5], radiator: [12.4, 1.6]
};
const handControls = '.pc-toolbar .pc-control, .pc-bottom .pc-control, .pc-stage .camera-button';
const assemblyControls = '.pc-toolbar button, .pc-bottom button, #pcInventory';
const ease = value => value * value * (3 - 2 * value);

function lightScene(scene) {
  scene.add(new THREE.HemisphereLight('#ebf6ff', '#7c8c90', 2.02));
  for (const [color, intensity, position] of [
    ['#fff1de', 2.70, [-48, 72, 51]],
    ['#b2d9fb', 1.75, [52, 43, 42]],
    ['#c3edf0', 2.10, [18, 62, -58]]
  ]) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
  }
}

const cableGeometry = new THREE.CylinderGeometry(1, 1, 1, 7);
class CablePath {
  constructor(parent, material, radius) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.pieces = Array.from({ length: 22 }, () => {
      const mesh = new THREE.Mesh(cableGeometry, material);
      this.group.add(mesh);
      return mesh;
    });
    parent.add(this.group);
  }

  follow(points, onTable = false) {
    const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const samples = path.getPoints(this.pieces.length);
    if (onTable) {
      const edge = worktopLimits({ min: { x: -this.radius, z: -this.radius }, max: { x: this.radius, z: this.radius } });
      for (const point of samples) {
        point.x = THREE.MathUtils.clamp(point.x, edge.minX, edge.maxX);
        point.z = THREE.MathUtils.clamp(point.z, edge.minZ, edge.maxZ);
      }
    }
    for (const [index, mesh] of this.pieces.entries()) {
      const begin = samples[index], end = samples[index + 1];
      const delta = end.clone().sub(begin);
      mesh.position.copy(begin).lerp(end, .5);
      mesh.scale.set(this.radius, delta.length() + this.radius * .56, this.radius);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, delta.normalize());
    }
  }
}

export class PcWorkshop {
  constructor(root) {
    this.root = root;
    this.stage = this.node('pcStage');
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'โต๊ะจำลองประกอบคอม');
    this.stage.prepend(this.canvas);
    const gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true });
    this.software = !gl;
    if (gl) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.70));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.06;
    } else {
      this.renderer = new CanvasRenderer(this.canvas, { maxPixels: 680000 });
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(37, 1, .14, 1100);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.rotateSpeed = .62;
    this.controls.zoomSpeed = .84;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 760;
    this.controls.minPolarAngle = .16;
    this.controls.maxPolarAngle = 1.565;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.spherical = new THREE.Spherical();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    lightScene(this.scene);

    this.display = new MonitorDisplay();
    this.model = createPcModel(this.display.texture, !this.software);
    this.chassis = new THREE.Group();
    this.chassis.add(this.model.frame, this.model.panel);
    this.laidFlat = true;
    this.positionCase(1);
    this.model.monitor.position.set(...monitorOrigin);
    this.model.keyboard.position.set(...keyboardOrigin);
    this.items = { ...this.model.parts, ...this.model.plugs };
    this.scene.add(this.model.desk, this.chassis, this.model.monitor, this.model.keyboard, this.model.boardStand,
      ...Object.values(this.items), ...Object.values(this.model.sockets));
    this.partBounds = Object.fromEntries(Object.entries(this.items).map(([id, obj]) =>
      [id, new THREE.Box3().setFromObject(obj, true)]));
    this.centers = Object.fromEntries(Object.entries(this.partBounds).map(([id, bounds]) =>
      [id, bounds.getCenter(new THREE.Vector3())]));
    this.standBounds = new THREE.Box3().setFromObject(this.model.boardStand);
    this.tablePositions = new Map();
    this.wires = Object.fromEntries(Object.entries(cables).map(([id, cable], index) =>
      [id, new CablePath(this.scene, this.model.wireColors[index % 2], cable.kind === 'atx' ? .28 : cable.internal ? .141 : .19)]));
    this.hoses = [-1, 1].map(() => new CablePath(this.scene, this.model.wireColors[1], .345));

    this.build = new PcBuild();
    this.view = 'bench';
    this.panelOpen = true;
    this.panelAngle = 1.83;
    this.panelPose();
    this.phase = 'off';
    this.monitorEnabled = true;
    this.feedbackUntil = 0;
    this.pointer = null;
    this.surfaceTap = null;
    this.held = null;
    this.handOrbit = null;
    this.handDwell = null;
    this.hover = null;
    this.sequence = null;
    this.guide = this.node('pcSnapGuides');
    this.guideContext = this.guide.getContext('2d');
    this.tag = this.node('pcItemTag');
    this.lastPaint = 0;
    this.frameAt = 0;
    this.dirty = true;
    this.refreshWires = true;
    this.bind();
    this.makeInventory();
    this.resize();
    this.sync();
    this.ready = true;
  }

  node(id) {
    return this.root.querySelector('#' + id);
  }

  makeInventory() {
    const select = this.node('pcInventory');
    const placeholder = new Option('หยิบชิ้นส่วนหรือสาย', '');
    const sections = [document.createElement('optgroup'), document.createElement('optgroup')];
    sections[0].label = 'ชิ้นส่วน';
    sections[1].label = 'สายและหัวต่อ';
    for (const [id, item] of Object.entries({ ...components, ...cables })) {
      if (!this.build.useItem(id)) continue;
      const placed = this.build.plugged.has(id) || this.build.mounted.has(id);
      const children = id === 'board' ? this.boardParts().length : 0;
      const description = children ? ' · ' + children + ' ชิ้นบนบอร์ด' : '';
      sections[isPart(id) ? 0 : 1].append(new Option(item.name + description + (placed ? ' ✓' : ''), id));
    }
    select.replaceChildren(placeholder, ...sections);
    select.value = this.held?.id ?? '';
  }

  bind() {
    new ResizeObserver(() => this.resize()).observe(this.stage);
    for (const btn of this.root.querySelectorAll('[data-pc-view]')) {
      btn.addEventListener('click', () => this.setView(btn.dataset.pcView));
    }
    for (const btn of this.root.querySelectorAll('[data-cooling]')) {
      btn.addEventListener('click', () => this.chooseCooling(btn.dataset.cooling));
    }
    this.node('pcPanel').addEventListener('click', () => this.togglePanel());
    this.node('pcLayCase').addEventListener('click', () => this.setCaseOrientation(!this.laidFlat));
    this.node('pcPower').addEventListener('click', () => this.togglePower());
    this.node('pcAssistWires').addEventListener('click', () => this.startWiring(false));
    this.node('pcZoomIn').addEventListener('click', () => this.zoom(.82));
    this.node('pcZoomOut').addEventListener('click', () => this.zoom(1.22));
    this.node('pcReset').addEventListener('click', () => this.reset());
    this.node('pcCancel').addEventListener('click', () => this.cancelHeld());
    this.node('pcInventory').addEventListener('change', event => {
      const id = event.target.value;
      this.cancelHeld();
      if (!id || !this.grab(id, 'carry')) return;
      this.centerHeld();
      this.canvas.focus({ preventScroll: true });
    });

    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event), { capture: true });
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event), { capture: true });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; });
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event), { capture: true });
    this.canvas.addEventListener('pointercancel', event => this.cancelPointer(event));
    this.canvas.addEventListener('lostpointercapture', event => this.cancelPointer(event));
    this.canvas.addEventListener('keydown', event => this.key(event));
  }

  show() {
    this.resize();
    this.dirty = true;
  }

  hide() {
    this.cancelHeld();
    this.handOrbit = null;
    this.clearHandAim();
  }

  resize() {
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height || (width === this.width && height === this.height)) return;
    const needsFit = this.width == null || ((this.width / this.height < 1.15) !== (width / height < 1.15));
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.guide.width = Math.round(width * pixelRatio);
    this.guide.height = Math.round(height * pixelRatio);
    this.guideContext?.setTransform(this.guide.width / width, 0, 0, this.guide.height / height, 0, 0);
    if (needsFit && !this.sequence) this.fit();
    if (this.held) this.centerHeld();
    this.dirty = true;
  }

  viewPose(view, flat = this.laidFlat) {
    const model = cameraViews[view];
    const target = new THREE.Vector3(...model.target);
    let direction = model.direction;
    if (view === 'bench' && flat) direction = [.135, .75, .65];
    if (view === 'case') {
      this.chassis.localToWorld(target);
      if (flat) direction = [.23, .85, .49];
    } else if (view === 'board') {
      const board = this.items.board;
      board.localToWorld(target);
      if (this.build.inCase('board')) direction = flat ? [.13, .89, .44] : [.18, .20, .965];
    }
    const distance = Math.max(model.distance, model.width / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 2 * this.camera.aspect));
    return { target, position: new THREE.Vector3(...direction).setLength(distance).add(target) };
  }

  cameraMotion(view, flat) {
    return {
      from: { target: this.controls.target.clone(), position: this.camera.position.clone() },
      to: this.viewPose(view, flat)
    };
  }

  applyCamera({ from, to }, progress) {
    this.controls.target.lerpVectors(from.target, to.target, progress);
    this.camera.position.lerpVectors(from.position, to.position, progress);
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.dirty = true;
  }

  fit() {
    this.applyCamera(this.cameraMotion(this.view), 1);
  }

  setView(view) {
    if (this.sequence || !cameraViews[view]) return;
    this.view = view;
    this.hover = null;
    this.fit();
    if (this.held) {
      this.centerHeld();
      this.canvas.focus({ preventScroll: true });
    }
    this.sync();
  }

  togglePanel() {
    if (this.sequence) return;
    this.panelOpen = !this.panelOpen;
    if (this.panelOpen && this.view === 'bench') this.setView('case');
    else this.sync();
  }

  setCaseOrientation(flat) {
    if (this.sequence) return;
    this.laidFlat = flat;
    this.positionCase(Number(flat));
    this.sync();
    this.clearTableOverlaps();
    if (this.view === 'bench' || this.view === 'case' || (this.view === 'board' && this.build.inCase('board'))) this.fit();
    if (this.held) this.centerHeld();
  }

  positionCase(flatness) {
    const [x, y, z] = caseOrigin;
    const angle = flatness * Math.PI / 2;
    this.chassis.position.set(x, deskY + (y - deskY) * Math.cos(angle) + 11.08 * Math.sin(angle), z - flatness * 2);
    this.chassis.rotation.x = -angle;
    this.chassis.updateMatrixWorld(true);
  }

  panelPose() {
    const hinge = new THREE.Vector3(22.35, 0, 11.13);
    const arm = new THREE.Vector3(-22.35, 0, 0).applyAxisAngle(Y_AXIS, this.panelAngle);
    this.model.panel.position.copy(hinge).add(arm);
    this.model.panel.rotation.y = this.panelAngle;
  }

  chooseCooling(choice) {
    if (this.sequence) return;
    if (this.phase !== 'off') return this.status('ปิดเครื่องก่อนเปลี่ยนชุดระบายความร้อน');
    if (!this.build.chooseCooling(choice)) return;
    this.cancelHeld();
    this.display.cooling = choice;
    this.makeInventory();
    this.status(choice === 'air' ? 'Dual-tower Air Cooler' : 'AIO Liquid Cooler · 240 mm', 'ok');
    this.sync();
    this.clearTableOverlaps();
  }

  frameOf(target) {
    if (target.frame === 'case') return this.chassis;
    return target.frame === 'board' ? this.items.board : null;
  }

  setPose(object, position, angles, frame) {
    object.position.set(...position);
    object.rotation.set(...angles);
    if (frame) {
      frame.localToWorld(object.position);
      object.quaternion.premultiply(frame.getWorldQuaternion(new THREE.Quaternion()));
    }
    object.updateMatrixWorld(true);
  }

  boardParts() {
    return [...this.build.mounted.keys()].filter(id => this.build.attachedToBoard(id));
  }

  alignBoardParts() {
    for (const id of this.boardParts()) {
      if (this.held?.id === id) continue;
      const slot = this.build.slotOf(id);
      this.setPose(this.items[id], slot.position, upright, this.items.board);
    }
  }

  tableShape(id) {
    const angles = components[id]?.angles ?? upright;
    const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...angles));
    const bounds = this.partBounds[id].clone();
    if (id === 'board') {
      for (const attachment of this.boardParts()) {
        const location = this.build.slotOf(attachment);
        bounds.union(this.partBounds[attachment].clone().translate(new THREE.Vector3(...location.position)));
      }
    }
    bounds.applyMatrix4(rotation);
    if (id === 'board') bounds.union(this.standBounds);
    return { bounds, rotation };
  }

  defaultTablePosition(id) {
    return components[id]?.bench ?? cables[id].rest;
  }

  restPosition(id) {
    const position = this.tablePositions.get(id);
    return position ? [position.x, position.y, position.z] : this.defaultTablePosition(id);
  }

  tableObstacles(id) {
    const { frame, keyboard, monitor, desk, boardStand } = this.model;
    const solids = [frame, keyboard, desk.userData.powerStrip, ...monitor.userData.solidPieces];
    if (id !== 'board' && boardStand.visible) solids.push(boardStand);
    for (const [other, object] of Object.entries(this.items)) {
      if (other === id || other === this.held?.id || !this.build.useItem(other) ||
          this.build.inCase(other) || this.build.plugged.has(other)) continue;
      if (id === 'board' && this.build.attachedToBoard(other)) continue;
      solids.push(object);
    }
    return solids.map(object => new THREE.Box3().setFromObject(object));
  }

  rememberTablePosition(id, wanted, bounds = this.tableShape(id).bounds) {
    const adjusted = nearestTablePosition(wanted, bounds, this.tableObstacles(id));
    if (adjusted) this.tablePositions.set(id, adjusted);
    return adjusted;
  }

  clearTableOverlaps() {
    for (const [id, previous] of this.tablePositions) {
      if (id === this.held?.id || !this.build.useItem(id) || this.build.mounted.has(id) || this.build.plugged.has(id)) continue;
      const next = this.rememberTablePosition(id, previous);
      if (next && (next.x !== previous.x || next.y !== previous.y || next.z !== previous.z)) this.seatLayout();
    }
  }

  returnToTable(id) {
    const [x, , z] = this.restPosition(id);
    this.rememberTablePosition(id, { x, z });
  }

  dropOnTable(id, x, y) {
    const ray = this.makeRay(x, y);
    if (ray.direction.y >= -.025) return null;
    const tablePlane = new THREE.Plane(Y_AXIS, -worktop.height);
    const contact = ray.intersectPlane(tablePlane, new THREE.Vector3());
    if (!contact || !closeToWorktop(contact.x, contact.z)) return null;
    const { bounds, rotation } = this.tableShape(id);
    const grip = this.held.grip.clone().applyMatrix4(rotation);
    const xGuess = contact.x - grip.x;
    const zGuess = contact.z - grip.z;
    const base = surfaceHeight(xGuess, zGuess, bounds) - bounds.min.y;
    tablePlane.constant = -(base + grip.y);
    const release = ray.intersectPlane(tablePlane, new THREE.Vector3());
    if (!release) return null;
    return this.rememberTablePosition(id, { x: release.x - grip.x, z: release.z - grip.z }, bounds);
  }

  seatLayout() {
    for (const [id, part] of Object.entries(components)) {
      const obj = this.items[id];
      obj.visible = this.build.useItem(id);
      if (this.held?.id === id || this.build.attachedToBoard(id)) continue;
      const location = this.build.slotOf(id);
      this.setPose(obj, location?.position ?? this.restPosition(id), location ? upright : part.angles ?? upright,
        location ? this.frameOf(location) : null);
    }
    this.alignBoardParts();
    this.model.boardStand.visible = !this.build.inCase('board') && this.held?.id !== 'board';
    if (this.model.boardStand.visible) {
      this.model.boardStand.position.copy(this.items.board.position);
      this.model.boardStand.updateMatrixWorld(true);
    }
    for (const id of Object.keys(cables)) {
      const connector = this.items[id];
      connector.visible = this.build.useItem(id);
      if (this.held?.id === id) continue;
      const port = ports[this.build.plugged.get(id)];
      this.setPose(connector, port?.position ?? this.restPosition(id), port?.orientation ?? upright, port ? this.frameOf(port) : null);
    }
    for (const [id, port] of Object.entries(ports)) {
      const socket = this.model.sockets[id];
      socket.visible = this.build.portReady(port);
      this.setPose(socket, port.position, port.orientation, this.frameOf(port));
    }
    this.refreshWires = true;
    this.dirty = true;
  }

  routeWires() {
    this.scene.updateMatrixWorld(true);
    for (const [id, cable] of Object.entries(cables)) {
      const path = this.wires[id];
      const active = this.build.useItem(id);
      path.group.visible = active;
      if (!active) continue;
      const plugged = this.build.plugged.has(id);
      const moving = this.held?.id === id || this.sequence?.wires?.some(wire => wire.id === id && wire.moving);
      const plug = this.model.plugs[id];
      const tip = plug.localToWorld(new THREE.Vector3(0, 0, cable.body[2] + .26)).toArray();
      if (cable.internal && !plugged && !moving) {
        const [x, y, z] = tip;
        path.follow([[x - 3.2, y - .17, z - 1.7], [x - 4.5, y - .16, z + 1.37], [x - 2.35, y - .14, z + 2.8], tip], true);
        continue;
      }

      const device = cable.owner && this.items[cable.owner];
      const source = device || (cable.caseEnd ? this.chassis : null);
      const from = source ? source.localToWorld(new THREE.Vector3(...cable.end)).toArray() : cable.end;
      const [x, y, z] = from;
      const [tx, ty, tz] = tip;
      if (cable.internal && plugged) {
        const [sx, sy, sz] = this.chassis.worldToLocal(new THREE.Vector3(...from)).toArray();
        const [ex, ey, ez] = this.chassis.worldToLocal(new THREE.Vector3(...tip)).toArray();
        const route = [[sx, sy, sz], [Math.min(18.5, sx + 3.2), sy + .27, sz + .4],
          [Math.min(15.5, Math.max(-21.0, (sx + ex) * .5 + 3.5)), (sy + ey) * .5 - 1, 2.62],
          [ex + 1.9, ey - .92, ez + 1.48], [ex, ey, ez]];
        path.follow(route.map(point => this.chassis.localToWorld(new THREE.Vector3(...point)).toArray()));
      } else {
        const base = deskY + .20;
        const lane = id === 'keyboard' ? 4.4 : -29.4 + (id === 'tower-ac' ? -2.25 : 0);
        path.follow([from, [x + .3, base + .17, (z + lane) * .5], [(x + tx) / 2, base + .06, lane],
          [tx - 1.0, base + .15, (lane + tz) / 2], [tx, (ty + base) / 2, tz + .35], tip], !plugged && !moving);
      }
    }

    for (const [index, hose] of this.hoses.entries()) {
      hose.group.visible = this.build.cooling === 'liquid';
      if (!hose.group.visible) continue;
      const offset = index ? 1 : -1;
      const from = this.items.pump.localToWorld(new THREE.Vector3(3.1, offset * 1.03, 2.0)).toArray();
      const to = this.items.radiator.localToWorld(new THREE.Vector3(12.77, -1.32, -.7 + offset * 1.45)).toArray();
      const mid = [(from[0] + to[0]) * .5 + 4.1, (from[1] + to[1]) * .5 + 3.2, (from[2] + to[2]) * .5 + 3.5 + offset * .85];
      hose.follow([from, [from[0] + 3.0, from[1] + 1.5, from[2] + 1.02], mid, [to[0] + 1.8, to[1] - 2.6, to[2] + 1.3], to]);
    }
    this.refreshWires = false;
  }

  status(message, tone = '') {
    const node = this.node('pcStatus');
    node.textContent = message;
    node.dataset.tone = tone;
    this.feedbackUntil = message ? performance.now() + 4200 : 0;
  }

  sync() {
    const on = this.phase !== 'off';
    const busy = Boolean(this.sequence);
    this.root.dataset.powered = String(on);
    this.root.dataset.sequence = this.sequence?.stage ?? '';
    for (const control of this.root.querySelectorAll(assemblyControls)) control.disabled = busy;
    this.node('pcPower').setAttribute('aria-pressed', String(on));
    this.node('pcPowerText').textContent = on ? 'ปิดเครื่อง' : 'ทดสอบเปิดเครื่อง';
    const assist = this.node('pcAssistWires');
    assist.hidden = !this.build.hardwareReady() || on;
    assist.disabled = busy || this.build.wiringPlan().every(([id, target]) => this.build.connected(id, target));
    assist.textContent = assist.disabled && !busy ? 'ต่อสายครบแล้ว' : 'ต่อสายอัตโนมัติ';
    this.node('pcPanel').setAttribute('aria-pressed', String(this.panelOpen));
    this.node('pcPanelText').textContent = this.panelOpen ? 'ปิดฝาเคส' : 'เปิดฝาเคส';
    this.node('pcLayCase').setAttribute('aria-pressed', String(this.laidFlat));
    this.node('pcLayCaseText').textContent = this.laidFlat ? 'ตั้งเคส' : 'วางเคสนอน';
    const children = this.held?.id === 'board' ? this.boardParts().length : 0;
    this.node('pcHeldLabel').textContent = this.held
      ? 'กำลังถือ ' + itemData(this.held.id).name + (children ? ' พร้อมอุปกรณ์ ' + children + ' ชิ้น' : '') : '';
    this.node('pcCancel').hidden = !this.held;
    this.node('pcInventory').value = this.held?.id ?? '';
    for (const button of this.root.querySelectorAll('[data-pc-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.pcView === this.view));
    }
    for (const button of this.root.querySelectorAll('[data-cooling]')) {
      button.setAttribute('aria-pressed', String(button.dataset.cooling === this.build.cooling));
    }
    this.canvas.classList.toggle('is-holding', Boolean(this.held));
    this.seatLayout();
    this.updateMonitor();
  }

  updateMonitor() {
    const monitorPowered = this.monitorEnabled && this.build.connected('monitor-ac', 'monitor-dc');
    const noVideo = !this.build.videoSignal() || this.phase === 'off' || ['CPU', 'DRAM', 'VGA'].includes(this.code);
    const mode = !monitorPowered ? 'off'
      : noVideo ? 'standby'
        : this.phase === 'halted' ? 'error'
          : this.phase === 'booting' ? 'loading'
            : this.phase === 'desktop' ? 'desktop' : 'post';
    this.display.set(mode, bootScreenMessages[this.code] ?? '');
    this.model.monitorIndicator.material.color.set(mode === 'off' ? '#171d27' : mode === 'standby' ? '#ddaf69' : '#88eac5');
    this.root.dataset.display = mode;
    const system = this.node('pcSystem');
    const label = this.phase === 'desktop' ? (mode === 'desktop' ? 'WINDOWS' : 'ON')
      : this.phase === 'halted' ? bootMessages[this.code]
        : this.phase === 'off' ? 'OFF' : 'POST';
    if (system.textContent !== label) system.textContent = label;
    system.dataset.state = this.phase;
    const live = this.node('pcMonitorStatus');
    const message = mode === 'desktop' ? 'Windows 11 จำลองพร้อมใช้งาน'
      : mode === 'error' ? bootScreenMessages[this.code] ?? '' : mode === 'standby' ? 'จอไม่มีสัญญาณ' : '';
    if (live.textContent !== message) live.textContent = message;
    this.dirty = true;
  }

  togglePower() {
    if (this.sequence) return;
    if (this.phase !== 'off') {
      this.powerOff();
      return;
    }
    this.startWiring(true);
  }

  startWiring(boot) {
    if (this.sequence || this.phase !== 'off' || (!boot && !this.build.hardwareReady())) return;
    this.cancelHeld();
    this.surfaceTap = this.handOrbit = this.hover = null;
    const plan = this.build.hardwareReady() ? this.build.wiringPlan() : [];
    if (!boot) {
      for (const [id, target] of plan) if (!this.build.connected(id, target)) this.build.remove(id);
      this.seatLayout();
    }
    const wires = plan.filter(([id, target]) => this.build.canSeat(id, target)).map(([id, target]) => {
      const { position, quaternion } = this.items[id];
      return { id, target, from: position.clone(), rotation: quaternion.clone(), moving: false, seated: false };
    });
    const now = performance.now();
    if (!wires.length) {
      if (boot) this.preparePower(now);
      return;
    }
    this.sequence = { stage: 'wiring', now, boot, wires, camera: this.cameraMotion('bench') };
    this.view = 'bench';
    this.controls.enabled = false;
    this.status('กำลังต่อสาย…');
    this.sync();
  }

  preparePower(now) {
    if (!this.build.hasPower()) {
      this.controls.enabled = true;
      this.status('เครื่องไม่ตอบสนอง ตรวจสายไฟและอุปกรณ์', 'fault');
      this.sync();
      return;
    }
    this.sequence = { stage: 'raising', now, flat: this.laidFlat, camera: this.cameraMotion('bench', false) };
    this.controls.enabled = this.panelOpen = false;
    this.view = 'bench';
    this.status(this.laidFlat ? 'กำลังตั้งเคส…' : 'กำลังเตรียมเปิดเครื่อง…');
    this.sync();
  }

  animateWiring(sequence, elapsed) {
    const lead = 360, gap = 74, duration = 560;
    this.applyCamera(sequence.camera, ease(Math.min(1, elapsed / lead)));
    for (const [index, wire] of sequence.wires.entries()) {
      if (wire.seated) continue;
      const progress = THREE.MathUtils.clamp((elapsed - lead - index * gap) / duration, 0, 1);
      if (progress === 0) continue;
      const plug = this.items[wire.id];
      const port = ports[wire.target];
      this.setPose(plug, port.position, port.orientation, this.frameOf(port));
      plug.position.lerp(wire.from, 1 - ease(progress));
      plug.position.y += Math.sin(progress * Math.PI) * 6.5;
      plug.quaternion.slerp(wire.rotation, 1 - ease(progress));
      plug.updateMatrixWorld(true);
      wire.moving = progress < 1;
      if (progress === 1) {
        wire.seated = true;
        this.build.seat(wire.id, wire.target);
      }
    }
    this.refreshWires = true;
    return elapsed >= lead + (sequence.wires.length - 1) * gap + duration;
  }

  animateSequence(now) {
    const sequence = this.sequence;
    if (!sequence) return;
    const elapsed = this.reducedMotion.matches ? Infinity : now - sequence.now;
    if (sequence.stage === 'wiring') {
      if (!this.animateWiring(sequence, elapsed)) return;
      this.sequence = null;
      if (sequence.boot) this.preparePower(now);
      else {
        this.controls.enabled = true;
        this.status('ต่อสายครบแล้ว พร้อมทดสอบเปิดเครื่อง', 'ok');
        this.sync();
      }
      return;
    }
    const raising = sequence.stage === 'raising';
    const duration = raising ? (sequence.flat ? 950 : 360) : 800;
    const progress = ease(THREE.MathUtils.clamp(elapsed / duration, 0, 1));
    this.applyCamera(sequence.camera, progress);
    if (raising && sequence.flat) {
      this.positionCase(1 - progress);
      this.seatLayout();
    }
    if (progress < 1) return;
    if (raising) {
      this.laidFlat = false;
      this.clearTableOverlaps();
      this.sequence = { stage: 'focusing', now, camera: this.cameraMotion('startup') };
      this.view = 'startup';
      this.status('กำลังเลื่อนมุมมองไปที่จอ…');
      this.sync();
    } else {
      this.sequence = null;
      this.controls.enabled = true;
      this.powerOn(now);
    }
  }

  powerOn(now) {
    this.code = this.build.post();
    this.bootAt = now;
    this.phase = 'posting';
    this.model.light.color.set('#73ebc1');
    this.model.light.emissiveIntensity = 1.35;
    this.status('');
    this.sync();
  }

  powerOff() {
    this.phase = 'off';
    this.code = '';
    this.model.light.color.set('#596d77');
    this.model.light.emissiveIntensity = 0;
    this.status('');
    this.sync();
  }

  reset() {
    if (this.sequence) return;
    this.cancelHeld();
    this.tablePositions.clear();
    const cooling = this.build.cooling;
    this.build = new PcBuild();
    this.build.chooseCooling(cooling);
    this.monitorEnabled = true;
    this.panelOpen = true;
    this.panelAngle = 1.83;
    this.panelPose();
    this.hover = null;
    this.setCaseOrientation(true);
    this.powerOff();
    this.makeInventory();
    this.setView('bench');
  }

  zoom(factor) {
    if (this.pointer || this.sequence) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    if (this.held) this.centerHeld();
    this.dirty = true;
  }

  makeRay(x, y) {
    const rect = this.stage.getBoundingClientRect();
    this.ndc.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray;
  }

  project(point) {
    const rect = this.stage.getBoundingClientRect();
    const ndc = (point.isVector3 ? point.clone() : new THREE.Vector3(...point)).project(this.camera);
    return {
      x: rect.left + (ndc.x * .5 + .5) * rect.width,
      y: rect.top + (.5 - ndc.y * .5) * rect.height,
      visible: Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && Math.abs(ndc.z) <= 1
    };
  }

  pick(x, y) {
    this.makeRay(x, y);
    let first;
    for (const [id, item] of Object.entries(this.items)) {
      if (!item.visible || (!this.panelOpen && this.build.inCase(id))) continue;
      const hit = this.ray.intersectObject(item, true)[0];
      if (hit && (!first || hit.distance < first.distance)) first = { id, ...hit };
    }
    const opaque = [this.model.desk, this.model.monitor, this.model.frame, this.model.keyboard];
    if (first && this.ray.intersectObjects(opaque, true).some(hit => hit.distance < first.distance - .04)) return null;
    return first ?? null;
  }

  grab(id, source, hit) {
    if (this.sequence) return false;
    this.cancelHeld();
    if (!this.build.useItem(id)) return false;
    const isPlaced = this.build.mounted.has(id) || this.build.plugged.has(id);
    if (isPlaced && isInternal(id) && this.phase !== 'off') {
      this.status('ปิดเครื่องก่อนถอดชิ้นส่วนหรือสายภายใน', 'fault');
      return false;
    }
    if (this.build.inCase(id) && !this.panelOpen) {
      this.status('ฝาเคสยังปิดอยู่', 'fault');
      return false;
    }
    if (isPlaced && !this.build.remove(id)) {
      this.status('ยังมีอุปกรณ์ยึดกับชิ้นส่วนนี้', 'fault');
      return false;
    }
    const obj = this.items[id];
    const plane = new THREE.Plane();
    const offset = new THREE.Vector3();
    const grip = hit ? obj.worldToLocal(hit.clone()) : this.centers[id].clone();
    this.held = { id, source, plane, offset, grip };
    if (hit) {
      plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), hit);
      offset.copy(obj.position).sub(hit);
      offset.y += .29;
    }
    this.controls.enabled = false;
    if (this.phase !== 'off' && !this.build.hasPower()) this.powerOff();
    this.status('');
    this.makeInventory();
    this.sync();
    return true;
  }

  centerHeld() {
    const { plane, offset, grip, id } = this.held;
    const focusDistance = this.camera.position.distanceTo(this.controls.target);
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const anchor = this.camera.position.clone().addScaledVector(direction, focusDistance * .70);
    plane.setFromNormalAndCoplanarPoint(direction, anchor);
    grip.copy(this.centers[id]);
    offset.copy(grip).applyQuaternion(this.items[id].quaternion).negate();
    const rect = this.stage.getBoundingClientRect();
    this.moveHeld(rect.left + rect.width * .5, rect.top + rect.height * .48);
  }

  moveHeld(x, y) {
    if (!this.held) return;
    const obj = this.items[this.held.id];
    const point = this.makeRay(x, y).intersectPlane(this.held.plane, new THREE.Vector3());
    if (!point) return;
    obj.position.copy(point).add(this.held.offset);
    obj.updateMatrixWorld(true);
    if (this.held.id === 'board') this.alignBoardParts();
    this.held.x = x;
    this.held.y = y;
    this.refreshWires = true;
    this.dirty = true;
  }

  portVisible(port, cameraInCase) {
    if (!this.build.portReady(port)) return false;
    if (port.face === 'inside') return this.panelOpen && cameraInCase.z > .6;
    if (port.face === 'rear') return cameraInCase.x < -22.9;
    if (port.face === 'monitor-rear') return this.camera.position.z < monitorOrigin[2] - 2.48;
    return cameraInCase.y > 23.8;
  }

  fitCandidates(id) {
    const part = isPart(id);
    const cameraInCase = this.chassis.worldToLocal(this.camera.position.clone());
    return Object.entries(part ? mountSlots : ports).filter(([key, socket]) => {
      if (!this.build.canSeat(id, key)) return false;
      if (!part) return this.portVisible(socket, cameraInCase);
      const inside = socket.frame === 'case' || this.build.inCase('board');
      if (inside && (!this.panelOpen || cameraInCase.z <= .6)) return false;
      const inFrame = this.frameOf(socket).worldToLocal(this.camera.position.clone());
      return inFrame.z > socket.position[2] + .3;
    });
  }

  drawGuides() {
    const context = this.guideContext;
    const { id, x, y } = this.held;
    const candidates = this.fitCandidates(id);
    this.guide.hidden = !context || !candidates.length || (this.phase !== 'off' && isInternal(id));
    if (this.guide.hidden) return;
    const rect = this.stage.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
    const ready = x != null ? this.findSocket(id, x, y, candidates) : null;
    const preferred = !isPart(id) ? Object.fromEntries(this.build.wiringPlan())[id] : null;
    for (const [key, socket] of candidates) {
      if (preferred && key !== preferred && !(id === 'keyboard' && key === 'usb-front')) continue;
      const frame = this.frameOf(socket);
      const origin = new THREE.Vector3(...(socket.point ?? socket.position));
      const [width, height] = guideSize[socket.kind] ?? socket.body;
      const rotation = new THREE.Euler(...(socket.orientation ?? upright));
      const screen = (a, b) => {
        const point = new THREE.Vector3(a, b, 0).applyEuler(rotation).add(origin);
        return this.project(frame ? frame.localToWorld(point) : point);
      };
      const center = screen(0, 0);
      if (!center.visible) continue;
      const corners = [[-width, -height], [width, -height], [width, height], [-width, height]].map(([a, b]) => screen(a, b));
      const span = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
      context.beginPath();
      if (span < 15) {
        context.arc(center.x - rect.left, center.y - rect.top, key === ready ? 9 : 6, 0, Math.PI * 2);
      } else {
        context.moveTo(corners[0].x - rect.left, corners[0].y - rect.top);
        for (const corner of corners.slice(1)) context.lineTo(corner.x - rect.left, corner.y - rect.top);
        context.closePath();
      }
      context.fillStyle = key === ready ? '#ffe16466' : '#ffd35423';
      context.fill();
      context.setLineDash([]);
      context.strokeStyle = '#32270ccf';
      context.lineWidth = key === ready ? 5 : 3.5;
      context.stroke();
      context.setLineDash(key === ready ? [] : [5, 3]);
      context.strokeStyle = '#ffdb4f';
      context.lineWidth = key === ready ? 3 : 1.8;
      context.stroke();
    }
    context.setLineDash([]);
  }

  updateItemTag() {
    const hover = this.hover;
    let target = null;
    if (this.held) {
      const { id, x, y, grip } = this.held;
      const point = x == null ? this.project(this.items[id].localToWorld(grip.clone())) : { x, y, visible: true };
      if (point.visible) target = { id, x: point.x, y: point.y };
    } else if (hover && !this.sequence) {
      if (!Object.hasOwn(hover, 'id')) hover.id = this.pick(hover.x, hover.y)?.id;
      if (hover.id) target = hover;
    }
    this.tag.hidden = !target;
    if (!target) return;
    const name = itemData(target.id).name;
    const rect = this.stage.getBoundingClientRect();
    if (this.tag.textContent !== name) this.tag.textContent = name;
    this.tag.style.left = THREE.MathUtils.clamp(target.x - rect.left + 13, 8, Math.max(8, rect.width - this.tag.offsetWidth - 8)) + 'px';
    this.tag.style.top = THREE.MathUtils.clamp(target.y - rect.top - 12, this.tag.offsetHeight + 8, rect.height - 8) + 'px';
  }

  findSocket(id, x, y, candidates = this.fitCandidates(id)) {
    const part = isPart(id);
    const ray = this.makeRay(x, y);
    const pixelScale = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    let chosen = null, distance = Infinity;
    for (const [key, socket] of candidates) {
      const frame = this.frameOf(socket);

      const local = new THREE.Vector3(...(socket.point ?? socket.position));
      const world = frame ? frame.localToWorld(local.clone()) : local;
      const projected = this.project(world);
      const pixelsPerCm = pixelScale / this.camera.position.distanceTo(world);
      const threshold = part
        ? Math.max(16, Math.min(110, 1.24 * socket.tolerance * pixelsPerCm + 5))
        : Math.max(13, Math.min(38, (socket.kind === 'iec' ? 2.3 : 1.36) * pixelsPerCm + 4));
      let gap = projected.visible ? Math.hypot(projected.x - x, projected.y - y) : Infinity;

      if (part) {
        const normal = OPEN_SIDE.clone().transformDirection(frame.matrixWorld);
        if (ray.direction.dot(normal) >= -.035) continue;
        const grip = this.held?.id === id ? this.held.grip : null;
        if (grip) {
          const seatedGrip = frame.localToWorld(grip.clone().add(new THREE.Vector3(...socket.position)));
          const point = this.project(seatedGrip);
          if (point.visible) gap = Math.min(gap, Math.hypot(point.x - x, point.y - y));
        }
        if (socket.footprint) {
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
          const hit = ray.intersectPlane(plane, new THREE.Vector3());
          if (hit) {
            frame.worldToLocal(hit).sub(local);
            const [halfWidth, halfHeight] = socket.footprint;
            if (Math.abs(hit.x) <= halfWidth && Math.abs(hit.y) <= halfHeight) gap = 0;
          }
        }
      }
      if (gap < threshold && gap < distance) {
        chosen = key;
        distance = gap;
      }
    }
    return chosen;
  }

  finish(x, y) {
    if (!this.held) return;
    const id = this.held.id;
    const target = this.findSocket(id, x, y);
    const fitted = target && (this.phase === 'off' || !isInternal(id)) && this.build.seat(id, target);
    const onTable = !fitted && this.dropOnTable(id, x, y);
    if (!fitted && !onTable) this.returnToTable(id);
    if (fitted && this.build.attachedToBoard(id) && !this.build.inCase('board') && this.tablePositions.has('board')) {
      this.returnToTable('board');
    }
    this.held = null;
    this.hover = null;
    this.controls.enabled = true;
    const outcome = fitted ? 'เข้าล็อก' : onTable ? 'วางบนโต๊ะ' : 'กลับไปวางบนโต๊ะ';
    this.status(itemData(id).name + ' · ' + outcome, fitted || onTable ? 'ok' : '');
    this.makeInventory();
    this.sync();
  }

  cancelHeld() {
    if (!this.held) return;
    this.returnToTable(this.held.id);
    this.held = null;
    this.hover = null;
    this.pointer = null;
    this.controls.enabled = true;
    this.makeInventory();
    this.sync();
  }

  pointerDown(event) {
    if (this.sequence || !event.isPrimary || event.button !== 0) return;
    const { clientX: x, clientY: y, pointerId } = event;
    const dropping = Boolean(this.held);
    if (!dropping) {
      const hit = this.pick(x, y);
      if (!hit) {
        this.surfaceTap = { x, y, pointerId };
        return;
      }
      if (!this.grab(hit.id, 'pointer', hit.point)) {
        event.stopImmediatePropagation();
        return;
      }
    }
    this.pointer = { x, y, pointerId, dropping };
    event.preventDefault();
    event.stopImmediatePropagation();
    this.canvas.setPointerCapture(pointerId);
  }

  pointerMove(event) {
    if (!this.held && event.pointerType !== 'touch') {
      this.hover = this.sequence ? null : { x: event.clientX, y: event.clientY };
      return;
    }
    if (!this.held || this.held.source === 'hand' ||
        (this.pointer && this.pointer.pointerId !== event.pointerId)) return;
    this.moveHeld(event.clientX, event.clientY);
    event.stopImmediatePropagation();
  }

  pointerUp(event) {
    const { clientX: x, clientY: y, pointerId } = event;
    if (this.pointer?.pointerId === pointerId) {
      const press = this.pointer;
      this.pointer = null;
      if (press.dropping || Math.hypot(x - press.x, y - press.y) > 6) this.finish(x, y);
      else if (this.held) this.held.source = 'carry';
      event.stopImmediatePropagation();
      return;
    }
    const tap = this.surfaceTap;
    this.surfaceTap = null;
    if (tap?.pointerId === pointerId && Math.hypot(x - tap.x, y - tap.y) < 6) this.tapSurface(x, y);
  }

  cancelPointer(event) {
    if (this.pointer?.pointerId === event.pointerId) this.cancelHeld();
    if (this.surfaceTap?.pointerId === event.pointerId) this.surfaceTap = null;
  }

  tapSurface(x, y) {
    this.makeRay(x, y);
    const clickables = [this.model.frame.userData.switch, this.model.monitorPower, this.model.monitorScreen];
    if (!this.panelOpen) clickables.push(this.model.panel);
    const hit = this.ray.intersectObjects(clickables, true)[0];
    if (!hit) return;
    if (hit.object === this.model.frame.userData.switch) this.togglePower();
    else if (hit.object === this.model.monitorPower) {
      this.monitorEnabled = !this.monitorEnabled;
      this.updateMonitor();
    } else if (hit.object === this.model.monitorScreen) {
      this.display.click(hit.uv);
      this.dirty = true;
    } else if (!this.panelOpen) this.togglePanel();
  }

  key(event) {
    if (!this.held) return;
    if (event.key === 'Escape') {
      this.cancelHeld();
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (this.held.x != null) this.finish(this.held.x, this.held.y);
      event.preventDefault();
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    if (this.held.x == null) this.centerHeld();
    const step = event.shiftKey ? 3 : 13;
    this.moveHeld(this.held.x + delta[0] * step, this.held.y + delta[1] * step);
    event.preventDefault();
  }

  handPoint(point) {
    const rect = this.stage.getBoundingClientRect();
    return [rect.left + point.x * rect.width, rect.top + point.y * rect.height];
  }

  handButtonAt(x, y) {
    const button = document.elementFromPoint(x, y)?.closest(handControls);
    return button && this.stage.contains(button) ? button : null;
  }

  clearHandAim() {
    const dwell = this.handDwell;
    if (dwell) {
      dwell.button.classList.remove('is-hand-aimed');
      dwell.button.style.removeProperty('--hand-dwell');
      this.handDwell = null;
    }
    if (this.hover?.hand) this.hover = null;
  }

  aimButton(button, now) {
    if (this.handDwell?.button !== button) {
      this.clearHandAim();
      this.handDwell = { button, since: now, pressed: false };
      button.classList.add('is-hand-aimed');
    }
    this.hover = null;
    const dwell = this.handDwell;
    if (button.disabled && !dwell.pressed) dwell.since = now;
    const progress = dwell.pressed ? 1 : Math.min(1, (now - dwell.since) / 660);
    button.style.setProperty('--hand-dwell', Math.round(progress * 100) + '%');
    if (progress === 1) this.pressHandButton(button);
  }

  pressHandButton(button) {
    if (this.handDwell.pressed || button.disabled) return;
    this.handDwell.pressed = true;
    button.style.setProperty('--hand-dwell', '100%');
    button.click();
  }

  handHit(point, now = performance.now()) {
    if (this.held || this.pointer) return false;
    const [x, y] = this.handPoint(point);
    const button = this.handButtonAt(x, y);
    if (button) {
      this.aimButton(button, now);
      return !button.disabled;
    }
    this.clearHandAim();
    if (this.sequence || document.elementFromPoint(x, y) !== this.canvas) return false;
    const hit = this.pick(x, y);
    this.hover = { x, y, id: hit?.id, hand: true };
    return Boolean(hit);
  }

  handGrab(point, kind) {
    if (this.held || this.pointer) return;
    const [x, y] = this.handPoint(point);
    const button = this.handButtonAt(x, y);
    if (button) {
      this.aimButton(button, performance.now());
      if (kind === 'pinch') this.pressHandButton(button);
      return;
    }
    this.clearHandAim();
    if (this.sequence || document.elementFromPoint(x, y) !== this.canvas) return;
    const hit = this.pick(x, y);
    if (hit && this.grab(hit.id, 'hand', hit.point)) return;
    if (kind === 'pinch') this.handOrbit = point;
  }

  handMove(point) {
    if (this.held?.source === 'hand') {
      this.moveHeld(...this.handPoint(point));
    } else if (this.handOrbit) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      this.spherical.setFromVector3(offset);
      this.spherical.theta -= (point.x - this.handOrbit.x) * 3.3;
      this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi - (point.y - this.handOrbit.y) * 3.0,
        this.controls.minPolarAngle, this.controls.maxPolarAngle);
      this.camera.position.copy(offset.setFromSpherical(this.spherical)).add(this.controls.target);
      this.controls.update();
      this.handOrbit = point;
    }
  }

  handEnd(release) {
    this.handOrbit = null;
    if (!release) this.clearHandAim();
    if (this.held?.source !== 'hand') return;
    if (release && this.held.x != null) this.finish(this.held.x, this.held.y);
    else this.cancelHeld();
  }

  tick(now) {
    if (this.root.hidden || !this.height) return;
    this.animateSequence(now);
    const panelGoal = this.panelOpen ? 1.83 : 0;
    if (Math.abs(this.panelAngle - panelGoal) > .001) {
      this.panelAngle = this.reducedMotion.matches ? panelGoal : THREE.MathUtils.lerp(this.panelAngle, panelGoal, .20);
      this.panelPose();
      this.dirty = true;
    }
    if (this.phase === 'posting' && now - this.bootAt > 720) {
      this.phase = this.code === 'ready' ? 'booting' : 'halted';
      this.sync();
    } else if (this.phase === 'booting' && now - this.bootAt > 1950) {
      this.phase = 'desktop';
      this.sync();
      if (this.root.dataset.display !== 'desktop') this.status('จอไม่มีสัญญาณ ตรวจสายไฟจอและ HDMI ที่การ์ดจอ', 'fault');
    }
    if (this.phase !== 'off' && !this.reducedMotion.matches) {
      const delta = Math.min(50, now - (this.frameAt || now));
      for (const { id, rotor } of this.model.fanList) {
        if (id === 'case' || id === 'psu' ||
            (id === 'gpu' && this.build.connected('gpu-power', 'pcie-power')) ||
            (id === 'air' && this.build.connected('air-fan', 'cpu-header', 'sys-header')) ||
            (id === 'radiator' && this.build.connected('rad-fan', 'cpu-header', 'sys-header'))) rotor.rotation.z -= delta * .018;
      }
      this.dirty = true;
    }
    if (this.feedbackUntil && now > this.feedbackUntil) this.status('');
    this.updateItemTag();
    if (!this.held) this.guide.hidden = true;
    this.frameAt = now;
    if (!this.dirty || (this.software && now - this.lastPaint < 34)) return;
    if (this.refreshWires) this.routeWires();
    this.renderer.render(this.scene, this.camera);
    if (this.held) this.drawGuides();
    this.lastPaint = now;
    this.dirty = false;
  }
}
