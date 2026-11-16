import * as THREE from 'three';

import { boardInCase, cables, components, deskY, ports, powerStrip } from './pc-build.js';
import { boardStandHeight, workMat, worktop } from './pc-table.js';

// Dimensions are in centimeters. The open side of the case faces +Z.

function brushedSteel() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const line = 221 + ((y * 37) % 29);
    for (let x = 0; x < canvas.width; x++) {
      const grain = line + ((x * 17 + y * 19) % 11) - 5;
      const i = (y * canvas.width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = grain;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function materials(useTextures) {
  const finish = (color, roughness = .65, metalness = .06) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const result = {
    steel: finish('#3d4853', .48, .52),
    edge: finish('#657482', .48, .55),
    inside: finish('#49545c', .58, .45),
    graphite: finish('#232b33'),
    black: finish('#101722', .82),
    blade: finish('#5d7180', .58),
    rubber: finish('#141a21', .93),
    silver: finish('#c5cfd2', .33, .58),
    fin: finish('#899ba6', .47, .58),
    brass: finish('#bca373', .36, .50),
    copper: finish('#bf814d', .39, .48),
    gold: finish('#d5ac63', .37, .55),
    pcb: finish('#22504a', .74),
    pcbDark: finish('#243e3d', .77),
    trace: finish('#698576', .65),
    silk: finish('#a5b7ae', .64),
    teal: finish('#549587', .54, .17),
    sticker: finish('#d2d9d4', .72),
    desk: finish('#625346', .84), mat: finish('#38454a', .94),
    keycap: finish('#343d46', .87), keyAccent: finish('#465d65', .78),
    cable: finish('#596169', .88), cableDark: finish('#303940', .92),
    glass: new THREE.MeshStandardMaterial({ color: '#92bdce', transparent: true, opacity: .17, roughness: .2, metalness: .18, depthWrite: false }),
    light: new THREE.MeshStandardMaterial({ color: '#596d77', emissive: '#32e7b8', emissiveIntensity: 0, roughness: .56 })
  };
  if (useTextures) {
    const brushed = brushedSteel();
    result.steel.map = result.silver.map = result.fin.map = brushed;
  }
  return result;
}

const geometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  round: new THREE.CylinderGeometry(1, 1, 1, 18),
  hex: new THREE.CylinderGeometry(1, 1, 1, 6),
  ring: new THREE.TorusGeometry(1, .044, 5, 48)
};

function shape(parent, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function box(parent, material, size, position, rotation) {
  const mesh = shape(parent, geometry.box, material, position, rotation);
  mesh.scale.set(...size);
  return mesh;
}

function disc(parent, material, radius, depth, position, axis = 'z', hex = false) {
  const rotation = axis === 'y' ? undefined : axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  const mesh = shape(parent, hex ? geometry.hex : geometry.round, material, position, rotation);
  mesh.scale.set(radius, depth, radius);
  return mesh;
}

function band(parent, material, radius, position) {
  const mesh = shape(parent, geometry.ring, material, position);
  mesh.scale.setScalar(radius);
  return mesh;
}

function tube(parent, material, points, radius, sides = 6) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return shape(parent, new THREE.TubeGeometry(path, Math.max(12, points.length * 4), radius, sides, false), material, [0, 0, 0]);
}

function screw(parent, m, x, y, z, size = .18) {
  disc(parent, m.silver, size, .08, [x, y, z], 'z', true);
  box(parent, m.graphite, [size * 1.18, .035, .014], [x, y, z + .046]);
  box(parent, m.graphite, [.035, size * 1.18, .014], [x, y, z + .046]);
}

function fan(parent, m, rotors, size, position, rotation, lit = false) {
  const frame = new THREE.Group();
  frame.position.set(...position);
  if (rotation) frame.rotation.set(...rotation);
  frame.scale.setScalar(size / 12);
  parent.add(frame);
  for (const x of [-5.6, 5.6]) {
    box(frame, m.graphite, [.78, 11.8, .66], [x, 0, 0]);
    for (const y of [-5.25, 5.25]) screw(frame, m, x, y, .43, .24);
  }
  for (const y of [-5.6, 5.6]) box(frame, m.graphite, [11.8, .78, .66], [0, y, 0]);
  band(frame, m.edge, 5.15, [0, 0, .02]);
  if (lit) band(frame, m.light, 4.86, [0, 0, .24]);
  // Each blade uses a curved profile, with the axle along +Z.
  const blade = new THREE.Shape();
  blade.moveTo(1.02, -.30);
  blade.quadraticCurveTo(2.12, -1.26, 4.58, -1.10);
  blade.quadraticCurveTo(5.08, .10, 4.44, 1.30);
  blade.quadraticCurveTo(2.88, .63, 1.09, .73);
  blade.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: .16, bevelEnabled: false, curveSegments: 5 });
  const rotor = new THREE.Group();
  frame.add(rotor);
  for (let index = 0; index < 7; index++) {
    shape(rotor, bladeGeo, m.blade, [0, 0, .12], [0, 0, index * Math.PI * 2 / 7]);
  }
  disc(rotor, m.graphite, 1.55, .68, [0, 0, .18]);
  disc(rotor, m.edge, 1.13, .09, [0, 0, .58]);
  box(rotor, m.teal, [.42, .14, .032], [0, 0, .64]);
  rotors.push(rotor);
}

const screwX = [-11.1, -.9, 11.15];
const screwY = [-14.0, -.85, 14.0];

function chassis(m, rotors) {
  const stage = new THREE.Group();
  // Powder-coated steel panels and folded rails.
  box(stage, m.inside, [44.8, 45.2, .45], [0, 0, -10.4]);
  box(stage, m.steel, [46.0, .92, 21.9], [0, -22.65, 0]);
  box(stage, m.edge, [45.9, .56, 21.9], [0, 22.55, 0]);
  box(stage, m.steel, [46.0, .46, 22.0], [0, 23.03, 0]);
  box(stage, m.graphite, [34.8, .13, 14.0], [-1.5, 23.31, -.4]);
  for (const z of [-10.0, 9.55]) box(stage, m.steel, [.68, 44.4, 1.45], [-22.7, 0, z]);
  for (const [y, height] of [[21.2, 2.3], [-11.24, 2.52], [-22.0, 1.1]]) {
    box(stage, m.steel, [.68, height, 19.3], [-22.7, y, -.26]);
  }
  box(stage, m.steel, [.68, 43.8, 1.91], [-22.7, -.2, 8.14]);
  box(stage, m.steel, [.68, 16.29, 1.52], [-22.7, 10.85, -3.7]);
  for (const x of [-22.65, 22.65]) {
    box(stage, m.edge, [.72, 45.5, .9], [x, 0, 10.48]);
    box(stage, m.steel, [.54, 45.5, 1.3], [x + .35, 0, 10.62]);
  }
  for (const y of [-22.5, 22.6]) {
    box(stage, m.steel, [44.9, .72, .97], [0, y, 10.6]);
  }
  for (const x of [-16.7, 16.7]) {
    for (const z of [-7.8, 7.8]) {
      box(stage, m.rubber, [5.9, 1.55, 4.1], [x, -23.8, z]);
      box(stage, m.edge, [6.0, .33, 4.2], [x, -23.1, z]);
    }
  }
  // Fan cutout, I/O shield and perforated expansion blanking plates.
  fan(stage, m, rotors, 10.7, [-22.0, 13.1, 1.57], [0, Math.PI / 2, 0]);
  for (let i = 0; i < 18; i++) {
    box(stage, m.edge, [.18, .105, 10.55], [-22.86, 8.30 + i * .575, 1.58]);
  }
  for (let i = 0; i < 7; i++) {
    const y = 1.35 - i * 1.42;
    box(stage, m.edge, [.5, .95, 11.2], [-22.1, y, .35]);
    for (let row = 0; row < 9; row++) box(stage, m.black, [.08, .34, .48], [-21.8, y, -4.4 + row * 1.09]);
  }

  // Stamped tray, mounting posts and cable passthroughs.
  for (const [x, y, width, height] of [
    [-8.4, -4.3, 26.5, 16.5], [-17.74, 10.97, 7.82, 14.04], [-.5, 10.97, 11.0, 14.04], [-8.4, 18.76, 26.5, 1.9]
  ]) {
    box(stage, m.steel, [width, height, .54], [x, y, -9.18]);
  }
  box(stage, m.graphite, [10.7, 11.6, .16], [-11.35, 10.95, -10.09]);
  for (const x of [-19.25, -3.7, .8]) {
    box(stage, m.inside, [1.03, 14.2, .11], [x, -3.5, -8.87]);
    box(stage, m.edge, [.08, 14.2, .10], [x - .47, -3.5, -8.81]);
  }
  for (const x of screwX) {
    for (const y of screwY) {
      disc(stage, m.brass, .34, .70, [boardInCase[0] + x, boardInCase[1] + y, -8.6], 'z', true);
      disc(stage, m.black, .12, .025, [boardInCase[0] + x, boardInCase[1] + y, -8.24]);
    }
  }
  for (const y of [-7, 4.9, 14.4]) {
    box(stage, m.rubber, [2.3, 5.65, .28], [6.0, y, -9.82]);
    box(stage, m.black, [1.4, 4.7, .05], [6.0, y, -9.65]);
    for (let row = 0; row < 7; row++) box(stage, m.inside, [1.52, .045, .04], [6.0, y - 1.95 + row * .65, -9.61]);
  }
  box(stage, m.steel, [21.8, 8.4, .8], [9.2, -18.0, 9.20]);
  box(stage, m.inside, [22.7, .60, 20.0], [9.5, -13.8, -.2]);
  box(stage, m.black, [16.0, 8.3, .12], [9.7, -18.0, 9.67]);
  for (let index = 0; index < 29; index++) {
    box(stage, m.steel, [.22, 6.9, .10], [2.36 + index * .524, -18, 9.8], [0, 0, -.19]);
  }

  // Recessed front grille lets the intake fans show through.
  for (const z of [-9.97, 9.97]) {
    box(stage, m.edge, [1.8, 44.6, 1.35], [22.32, 0, z]);
    box(stage, m.steel, [.67, 44.95, 2.5], [23.17, 0, z]);
  }
  for (const y of [-21.9, 21.9]) box(stage, m.steel, [1.35, 2.1, 20.0], [22.82, y, 0]);
  for (const z of [-8.15, 8.15]) {
    box(stage, m.graphite, [.45, 41.2, 4.45], [20.57, 0, z]);
    box(stage, m.steel, [1.38, 42.35, .55], [21.85, 0, z * .99]);
  }
  for (const y of [-19.25, -6.4, 6.4, 19.25]) box(stage, m.steel, [.76, 1.02, 13.1], [20.97, y, 0]);
  for (const y of [-12.8, 0, 12.8]) fan(stage, m, rotors, 12.2, [21.27, y, .15], [0, Math.PI / 2, 0], true);
  for (let row = 0; row < 75; row++) {
    box(stage, m.graphite, [.27, .12, 18.5], [23.52, -20.55 + .555 * row, 0]);
  }
  for (let column = 0; column < 18; column++) {
    box(stage, m.inside, [.24, 41.7, .080], [23.56, 0, -8.8 + column * 1.035]);
  }
  for (let index = 0; index < 41; index++) box(stage, m.inside, [.17, .1, 13.5], [-18 + index * .825, 23.43, -.4]);
  const io = [[19.1, 5.4], [19.1, 2.7], [19.1, -.05]];
  for (const [x, z] of io) {
    box(stage, m.edge, [1.72, .22, .92], [x, 23.46, z]);
    box(stage, m.black, [1.31, .08, .56], [x, 23.59, z]);
    box(stage, m.teal, [1.0, .035, .22], [x, 23.64, z]);
  }
  disc(stage, m.silver, .67, .18, [19.1, 23.54, -5.7], 'y');
  stage.userData.switch = disc(stage, m.light, .54, .08, [19.1, 23.66, -5.7], 'y');
  return stage;
}

function sidePanel(m) {
  const panel = new THREE.Group();
  const window = box(panel, m.glass, [43.7, 43.6, .32], [0, 0, 0]);
  window.renderOrder = 2;
  for (const x of [-22.0, 22.0]) {
    box(panel, m.steel, [1.15, 44.8, .66], [x, 0, 0]);
    for (const y of [-21.45, 21.45]) screw(panel, m, x, y, .39, .31);
  }
  for (const y of [-22.0, 22.0]) box(panel, m.steel, [43.9, 1.25, .67], [0, y, 0]);
  return panel;
}

function socketPins(parent, m, width, height, position) {
  box(parent, m.graphite, [width, height, .67], position);
  const [x, y, z] = position;
  const length = Math.floor((height - .14) / .34);
  for (const offset of [-.21, .21]) {
    for (let i = 0; i < length; i++) {
      const pinY = y + (i - (length - 1) / 2) * .34;
      box(parent, m.black, [.24, .22, .06], [x + offset, pinY, z + .34]);
    }
  }
}

function chip(parent, m, x, y, z, width, height) {
  box(parent, m.black, [width, height, .26], [x, y, z]);
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      box(parent, m.silver, [.29, .073, .075], [x + side * width * .52, y + height * (i - 2.5) * .15, z - .09]);
    }
  }
  box(parent, m.edge, [width * .49, .045, .02], [x, y, z + .135]);
}

function connector(parent, m, x, y, z, length, color) {
  box(parent, m.black, [length, .55, .74], [x, y, z]);
  box(parent, color, [length - .25, .17, .08], [x, y, z + .38]);
  box(parent, m.steel, [.42, 1.0, .91], [x + length / 2 + .02, y + .09, z]);
}

function board(m) {
  const part = new THREE.Group();
  box(part, m.pcb, [24.4, 30.5, .23], [0, 0, 0]);
  for (const x of screwX) for (const y of screwY) {
    disc(part, m.brass, .37, .065, [x, y, .145]);
    disc(part, m.black, .17, .068, [x, y, .15]);
  }
  for (let i = 0; i < 23; i++) {
    const x = -10.2 + i * .85;
    const y = -9.6 + ((i * 71) % 21) * .36;
    box(part, m.trace, [.07, 5.8 + (i % 7) * .5, .018], [x, y, .13]);
    box(part, m.trace, [2.42, .057, .021], [x + 1.15, y + 2.1, .132]);
  }
  for (let i = 0; i < 9; i++) box(part, m.trace, [.06, 18.9 - i * .67, .019], [2.6 + i * .94, 2.4, .13]);
  for (const [x, y, w, h] of [[6.8, -10, 3.2, 2.5], [-7.8, -9.0, 2.3, 1.8], [.35, -6.9, 1.6, 1.45], [-7.6, -.7, 1.38, 1.54], [7.5, .3, 1.60, 1.92]]) chip(part, m, x, y, .25, w, h);
  for (let i = 0; i < 9; i++) {
    const x = -8.8 + i * .99;
    box(part, m.black, [.63, .75, .38], [x, 11.88, .31]);
    disc(part, m.silver, .28, .58, [x, 10.98, .41]);
    disc(part, m.teal, .13, .035, [x, 10.98, .72]);
  }
  box(part, m.steel, [10.6, 2.57, .95], [-4.7, 13.55, .66]);
  for (let i = 0; i < 16; i++) box(part, m.fin, [.16, 2.44, .3], [-9.43 + i * .64, 13.55, 1.25]);
  box(part, m.fin, [2.15, 7.0, .98], [-7.20, 6.0, .64]);
  box(part, m.teal, [.34, 7.0, .08], [-7.85, 6.0, 1.17]);
  // LGA frame, latch and contact field.
  box(part, m.graphite, [5.75, 5.92, .32], [-3, 7.3, .30]);
  for (const x of [-5.69, -.31]) box(part, m.silver, [.36, 5.58, .34], [x, 7.3, .51]);
  for (const y of [4.63, 9.97]) box(part, m.silver, [5.54, .36, .34], [-3, y, .51]);
  box(part, m.brass, [4.08, 4.37, .12], [-3, 7.3, .49]);
  for (let i = 0; i < 13; i++) box(part, m.pcbDark, [4.0, .047, .03], [-3, 5.28 + i * .337, .56]);
  box(part, m.fin, [.15, 5.36, .17], [.15, 7.14, .54], [0, 0, .047]);
  box(part, m.gold, [.35, .14, .046], [-5.0, 5.16, .57], [0, 0, .78]);

  for (let index = 0; index < 4; index++) {
    const x = 5.05 + index * 1.27;
    box(part, m.graphite, [.67, 13.75, .70], [x, 4.6, .47]);
    box(part, index % 2 ? m.teal : m.black, [.18, 13.34, .07], [x, 4.6, .86]);
    for (const y of [-2.36, 11.55]) box(part, m.fin, [.62, .49, .82], [x, y, .54]);
  }
  socketPins(part, m, .97, 4.40, [11.45, 2.70, .44]);
  socketPins(part, m, .97, 1.57, [-6.2, 14.31, .44]);
  connector(part, m, -3.30, -4.30, .46, 9.86, m.silver);
  connector(part, m, -6.55, -9.7, .43, 4.2, m.teal);
  box(part, m.black, [.57, 2.45, .55], [1.54, -1.3, .41]);
  disc(part, m.silver, .19, .28, [-6.38, -1.3, .29]);
  disc(part, m.silver, .99, .46, [5.09, -5.9, .39]);
  disc(part, m.fin, .82, .06, [5.09, -5.9, .65]);
  box(part, m.graphite, [4.35, 3.55, .84], [7.0, -8.8, .66], [0, 0, -.10]);
  for (let i = 0; i < 8; i++) box(part, m.fin, [3.77, .09, .09], [7.0, -9.94 + i * .32, 1.13], [0, 0, -.1]);

  for (const [y, h, color] of [[12.3, 2.7, m.teal], [9.12, 2.12, m.black], [6.45, 1.83, m.teal], [3.7, 2.21, m.black], [1.02, 2.22, m.graphite]]) {
    box(part, m.silver, [2.52, h, 2.63], [-10.8, y, 1.48]);
    box(part, color, [.13, h * .69, 1.82], [-12.13, y, 1.51]);
  }
  for (let index = 0; index < 4; index++) box(part, m.silk, [2.8 - index * .44, .075, .015], [6.0, -12.8 + index * .35, .13]);
  return part;
}

function cpu(m) {
  const part = new THREE.Group();
  box(part, m.pcb, [3.74, 4.47, .21], [0, 0, 0]);
  box(part, m.fin, [3.26, 3.91, .18], [0, 0, .17]);
  box(part, m.silver, [3.12, 3.71, .20], [0, 0, .30]);
  box(part, m.gold, [.33, .16, .04], [-1.65, -2.00, .133], [0, 0, .78]);
  for (let index = 0; index < 11; index++) {
    box(part, m.gold, [3.13, .10, .03], [0, -1.70 + index * .337, -.123]);
  }
  for (let index = 0; index < 4; index++) {
    box(part, m.fin, [1.55 - index * .25, .051, .018], [-.26, .32 - index * .22, .411]);
  }
  return part;
}

function ram(m) {
  const part = new THREE.Group();
  box(part, m.pcbDark, [.13, 13.30, 2.45], [0, 0, 1.18]);
  for (let i = 0; i < 25; i++) box(part, m.gold, [.158, .32, .40], [0, -6.27 + i * .506, .19]);
  box(part, m.graphite, [.73, 13.48, 2.65], [0, 0, 1.85]);
  box(part, m.fin, [.82, 12.8, .32], [0, 0, 3.15]);
  box(part, m.teal, [.86, 8.6, .18], [0, .47, 3.34]);
  for (let i = 0; i < 8; i++) box(part, m.edge, [.751, .18, 1.58], [0, -5.5 + i * 1.58, 1.82], [-.38, 0, 0]);
  return part;
}

function ssd(m) {
  const part = new THREE.Group();
  box(part, m.pcb, [8.0, 2.20, .15], [0, 0, 0]);
  for (let i = 0; i < 10; i++) box(part, m.gold, [.62, .105, .03], [3.64, -.88 + i * .19, .091]);
  chip(part, m, 1.15, 0, .18, 1.95, 1.48);
  chip(part, m, -1.52, 0, .18, 2.12, 1.59);
  box(part, m.sticker, [3.65, 1.27, .025], [-.7, -.03, .328]);
  for (let line = 0; line < 4; line++) box(part, m.pcbDark, [1.42 - line * .22, .053, .01], [-1.23, .34 - line * .18, .347]);
  disc(part, m.silver, .20, .075, [-3.76, 0, .144]);
  return part;
}

function airCooler(m, rotors) {
  const part = new THREE.Group();
  box(part, m.copper, [4.3, 4.55, .40], [0, 0, .21]);
  box(part, m.fin, [5.25, 4.6, .45], [0, 0, .60]);
  for (const sign of [-1, 1]) {
    for (const y of [-2.1, 0, 2.1]) {
      tube(part, m.copper, [[0, y, .51], [sign * 3.9, y, .95], [sign * 4.13, y, 3.05], [sign * 4.13, y, 14.9]], .155, 7);
    }
    for (let i = 0; i < 22; i++) {
      box(part, i === 21 ? m.edge : m.fin, [4.43, 11.75, .12], [sign * 3.85, 0, 2.39 + i * .59]);
    }
    box(part, m.graphite, [4.5, 11.8, .24], [sign * 3.85, 0, 15.08]);
    for (let i = 0; i < 3; i++) disc(part, m.silver, .20, .16, [sign * 4.13, (i - 1) * 2.1, 15.23]);
  }
  fan(part, m, rotors, 11.65, [0, 0, 8.75], [0, Math.PI / 2, 0]);
  fan(part, m, rotors, 11.65, [6.46, 0, 8.75], [0, Math.PI / 2, 0]);
  box(part, m.teal, [3.2, .20, .045], [-3.85, -4.45, 15.23]);
  return part;
}

function pumpBlock(m) {
  const part = new THREE.Group();
  box(part, m.copper, [4.52, 4.54, .32], [0, 0, .16]);
  box(part, m.graphite, [6.9, 5.68, .35], [0, 0, .60]);
  for (const x of [-3.20, 3.20]) for (const y of [-2.47, 2.47]) screw(part, m, x, y, .86, .23);
  disc(part, m.steel, 2.79, 2.54, [0, 0, 2.13], 'z', true);
  disc(part, m.black, 2.42, .18, [0, 0, 3.50]);
  band(part, m.light, 2.05, [0, 0, 3.58]);
  disc(part, m.teal, .40, .09, [0, 0, 3.61], 'z', true);
  for (const y of [-1.03, 1.03]) disc(part, m.edge, .49, 1.03, [2.65, y, 1.99], 'x');
  return part;
}

function radiator(m, rotors) {
  const part = new THREE.Group();
  box(part, m.steel, [27.34, 1.90, 12.0], [0, 0, 0]);
  box(part, m.graphite, [24.78, .12, 11.25], [0, .98, 0]);
  for (let i = 0; i < 42; i++) box(part, m.fin, [.18, .075, 10.88], [-12.06 + i * .59, 1.07, 0]);
  for (const x of [-6.15, 6.15]) {
    fan(part, m, rotors, 11.8, [x, -1.28, 0], [Math.PI / 2, 0, 0]);
  }
  for (const z of [-2.8, .20]) disc(part, m.edge, .46, .77, [12.78, -.95, z], 'y');
  return part;
}

function psu(m, rotors) {
  const part = new THREE.Group();
  box(part, m.graphite, [16, 8.6, 15.0], [0, 0, 0]);
  box(part, m.edge, [15.75, .24, 14.70], [0, 4.26, 0]);
  box(part, m.black, [12.9, .13, 12.9], [-.5, 4.43, 0]);
  fan(part, m, rotors, 12.25, [-.5, 4.49, 0], [-Math.PI / 2, 0, 0]);
  for (let i = 0; i < 9; i++) box(part, m.steel, [12.15, .18, .108], [-.5, 5.24, -5.4 + i * 1.35]);
  box(part, m.steel, [15.64, 5.6, .15], [0, .18, 7.55]);
  box(part, m.fin, [10.3, 3.98, .08], [.05, .18, 7.68]);
  box(part, m.graphite, [9.9, 3.62, .08], [.05, .18, 7.76]);
  box(part, m.teal, [.4, 2.78, .06], [-4.01, .18, 7.83]);
  for (let i = 0; i < 5; i++) box(part, m.silver, [4.6 - i * .53, i ? .09 : .27, .036], [-.97 + i * .26, 1.01 - i * .44, 7.83]);
  box(part, m.black, [.22, 3.20, 3.95], [-8.1, .6, 4.01]);
  box(part, m.edge, [.28, 1.55, 2.55], [-8.13, 2.4, -2.65]);
  for (const y of [-2.2, .5, 2.4]) {
    for (const z of [-4.7, -1.4, 2.15, 5.1]) box(part, m.edge, [.10, 1.34, 2.46], [8.08, y, z]);
  }
  return part;
}

function gpu(m, rotors) {
  const part = new THREE.Group();
  box(part, m.pcbDark, [19.48, .22, 10.90], [0, .03, 5.75]);
  box(part, m.graphite, [19.70, 2.98, 11.58], [0, -1.53, 6.21]);
  box(part, m.steel, [19.68, .43, 11.74], [0, .89, 6.25]);
  box(part, m.edge, [19.45, .12, .48], [0, 1.14, 10.2]);
  box(part, m.black, [14.20, .06, 4.50], [1.18, 1.15, 7.58]);
  box(part, m.teal, [7.20, .19, .10], [-4.1, -1.15, 12.04]);
  for (let i = 0; i < 21; i++) {
    box(part, m.fin, [.10, .65, 4.36], [-4.7 + i * .67, .92, 7.56], [0, -.22, 0]);
    box(part, m.fin, [.11, 1.88, .16], [-9.23 + i * .92, -1.51, 12.01]);
  }
  for (const x of [-4.67, 4.71]) {
    box(part, m.black, [8.51, .20, 8.94], [x, -3.10, 6.41]);
    fan(part, m, rotors, 8.77, [x, -3.46, 6.41], [Math.PI / 2, 0, 0]);
  }
  box(part, m.silver, [.37, 4.15, 12.0], [-10.22, -1.06, 6.03]);
  for (const z of [3.08, 5.03, 7.24, 9.31]) {
    box(part, m.black, [.42, .62, 1.33], [-10.42, -.19, z]);
  }
  box(part, m.pcb, [9.57, .25, .73], [-.23, .032, -.09]);
  for (let i = 0; i < 28; i++) {
    if (i === 6) continue;
    box(part, m.gold, [.19, .271, .49], [-4.90 + i * .34, .035, -.15]);
  }
  socketPins(part, m, .92, 1.67, [5.55, .10, 11.94]);
  return part;
}

function deskSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 448;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const stripe = y + 2.9 * Math.sin(x * .012 + y * .023);
      const grain = 3.4 * Math.sin(stripe * 1.27) + 2.3 * Math.sin(stripe * .19) +
        1.2 * Math.sin(stripe * 3.1) + ((x * 53 + y * 89) % 13) * .24;
      const light = 1.03 - Math.hypot((x - 320) / 1110, (y - 210) / 1000) * .37;
      const i = (y * canvas.width + x) * 4;
      image.data[i] = (113 + grain) * light;
      image.data[i + 1] = (96 + grain) * light;
      image.data[i + 2] = (80 + grain * .85) * light;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}

function makeDesk(m) {
  const desk = new THREE.Group();
  box(desk, m.desk, [worktop.width, 2.55, worktop.depth], [worktop.x, deskY - 1.28, worktop.z]);
  shape(desk, new THREE.PlaneGeometry(worktop.width - .09, worktop.depth - .08), deskSurface(),
    [worktop.x, worktop.height, worktop.z], [-Math.PI / 2, 0, 0]);
  box(desk, m.edge, [153.13, .28, .69], [0, deskY - .37, 65.01]);
  box(desk, m.graphite, [153.25, 1.65, .43], [0, deskY - 1.82, 65.14]);
  for (const x of [-69.8, 69.8]) {
    box(desk, m.graphite, [4.6, 17.0, 4.9], [x, deskY - 10.18, 54.0]);
    box(desk, m.graphite, [4.6, 17.0, 4.9], [x, deskY - 10.18, -31.0]);
  }
  // The loose electronics sit on a large anti-static mat.
  box(desk, m.rubber, [workMat.width, .15, workMat.depth], [workMat.x, deskY + .068, workMat.z]);
  box(desk, m.mat, [127.4, .106, 39.5], [2.5, deskY + .141, 42.20]);
  for (const x of [-60.9, 65.9]) box(desk, m.edge, [.066, .025, 38.8], [x, deskY + .21, 42.20]);
  for (const z of [22.8, 61.6]) box(desk, m.edge, [126.68, .025, .06], [2.5, deskY + .21, z]);
  for (let i = 0; i < 64; i++) {
    const x = -62.5 + i * 2;
    box(desk, m.edge, [.044, .021, i % 5 === 0 ? 1.15 : .49], [x, deskY + .212, 60.99]);
  }

  const [sx, sy, sz] = powerStrip;
  desk.userData.powerStrip = box(desk, m.graphite, [5.35, 2.12, 22.8], [sx, sy + .88, sz]);
  box(desk, m.edge, [4.73, .16, 21.1], [sx, sy + 1.98, sz]);
  for (const z of [-7, -1, 5.0]) {
    disc(desk, m.black, 1.19, .12, [sx, sy + 2.08, sz + z], 'y');
    for (const x of [-.39, .39]) box(desk, m.silver, [.115, .017, .48], [sx + x, sy + 2.15, sz + z]);
  }
  box(desk, m.teal, [.76, .145, 1.42], [sx, sy + 2.13, sz + 9.25]);
  return desk;
}

function makeBoardStand(m) {
  const stand = new THREE.Group();
  for (const z of [-11.6, 11.6]) {
    box(stand, m.rubber, [21.7, 1.96, 2.20], [0, -boardStandHeight + .98, z]);
    box(stand, m.mat, [21.6, .09, 2.1], [0, -.157, z]);
  }
  return stand;
}

function makeMonitor(m, texture) {
  const monitor = new THREE.Group();
  const bezel = box(monitor, m.graphite, [53.5, 31, 2.02], [0, 0, 0]);
  const back = box(monitor, m.steel, [50.7, 29.5, 1.29], [0, 0, -1.02]);
  box(monitor, m.black, [52.61, 29.98, .22], [0, .30, 1.00]);
  const screen = shape(monitor, new THREE.PlaneGeometry(51.84, 29.16),
    new THREE.MeshBasicMaterial({ color: '#ffffff', map: texture, toneMapped: false }), [0, .35, 1.145]);
  box(monitor, m.edge, [53.08, .38, .30], [0, -15.18, 1.014]);
  const neck = box(monitor, m.graphite, [5.5, 11.7, 3.0], [0, -13.15, -4.22]);
  box(monitor, m.steel, [4.26, 15.45, 1.17], [0, -11.09, -4.35], [.15, 0, 0]);
  const foot = box(monitor, m.steel, [21.54, 1.34, 12.82], [0, -18.81, -4.04]);
  monitor.userData.solidPieces = [bezel, back, neck, foot];
  box(monitor, m.graphite, [19.83, .13, 11.44], [0, -18.08, -4.06]);
  for (let i = 0; i < 29; i++) box(monitor, m.black, [.51, 2.35, .09], [-20.3 + i * 1.45, 9.50, -1.76]);
  for (const x of [-7.2, 7.2]) screw(monitor, m, x, -6.7, -1.75, .23);
  box(monitor, m.black, [35.0, 3.4, .70], [0, -10.37, -1.79]);
  const button = disc(monitor, m.edge, .41, .09, [24.5, -14.47, 1.25]);
  const indicator = disc(monitor, m.black, .14, .035, [23.49, -14.47, 1.20]);
  indicator.material = new THREE.MeshBasicMaterial({ color: '#171d27' });
  return { monitor, monitorScreen: screen, monitorPower: button, monitorIndicator: indicator };
}

function makeKeyboard(m) {
  const keyboard = new THREE.Group();
  box(keyboard, m.steel, [41.4, 1.22, 13.20], [0, 0, 0], [-.054, 0, 0]);
  box(keyboard, m.black, [40.27, .22, 12.25], [0, .62, 0]);
  // Main block, function row and arrows. The stepped caps sit above the deck.
  const rows = [[1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1.7],
    [1.4,1,1,1,1,1,1,1,1,1,1,1,1,1.25],
    [1.65,1,1,1,1,1,1,1,1,1,1,1,2.4],
    [2.1,1,1,1,1,1,1,1,1,1,1,2.2],
    [1.3,1.3,1.3,6.34,1.3,1.3,1.3]];
  for (const [row, keys] of rows.entries()) {
    const z = -5.1 + row * 1.98;
    let edge = -19.89;
    for (const [i, units] of keys.entries()) {
      const width = units * 2.18;
      const x = edge + width * .5;
      const color = i === 0 || units > 1.1 ? m.keyAccent : m.keycap;
      box(keyboard, m.graphite, [width - .15, .46, 1.78], [x, .91, z]);
      box(keyboard, color, [width - .38, .25, 1.54], [x, 1.245, z]);
      if (units < 4) box(keyboard, m.silk, [.23, .012, .065], [x - width * .20, 1.38, z - .23]);
      edge += width;
    }
  }
  for (const [x, z] of [[16.65, 2.95], [14.45, 4.93], [16.65, 4.93], [18.85, 4.93]]) {
    box(keyboard, m.keyAccent, [1.85, .56, 1.61], [x, 1.04, z]);
    box(keyboard, m.silk, [.24, .023, .083], [x, 1.34, z]);
  }
  for (let i = 0; i < 3; i++) box(keyboard, m.teal, [.25, .047, .175], [15.66 + i * .78, .79, -5.28]);
  return keyboard;
}

function makePlug(m, data) {
  const plug = new THREE.Group();
  const [width, height, depth] = data.body;
  const plastic = new THREE.MeshStandardMaterial({ color: data.shell, roughness: .82 });
  const accent = new THREE.MeshStandardMaterial({ color: data.band, roughness: .60 });
  // The pin end points toward -Z. The flexible strain relief is on +Z.
  box(plug, plastic, [width, height, depth], [0, 0, depth * .44]);
  box(plug, accent, [width * .95, height * .93, .13], [0, 0, depth * .72]);
  if (data.kind === 'dc') disc(plug, m.silver, width * .38, .94, [0, 0, -.32]);
  else box(plug, m.silver, [width * .80, height * .74, .65], [0, 0, -.29]);
  box(plug, m.black, [width * .54, height * .67, .5], [0, 0, depth + .10]);
  return plug;
}

function makePort(m, data) {
  const socket = new THREE.Group();
  const [width, height] = data.body;
  if (data.kind === 'dc') {
    disc(socket, m.silver, width * .59, .12, [0, 0, 0]);
    disc(socket, m.black, width * .42, .13, [0, 0, .05]);
  } else {
    box(socket, m.edge, [width * 1.08, height * 1.12, .21], [0, 0, -.04]);
    box(socket, m.black, [width * .86, height * .80, .095], [0, 0, .095]);
    if (data.kind === 'usb') box(socket, m.teal, [width * .70, height * .22, .04], [0, .065, .152]);
    if (['atx', 'eps', 'pcie', 'fan', 'switch'].includes(data.kind)) {
      const count = data.kind === 'atx' ? 12 : data.kind === 'eps' || data.kind === 'pcie' ? 4 : 2;
      for (let i = 0; i < count; i++) box(socket, m.silver, [width * .52, .047, .048], [0, (i - (count - 1) / 2) * height * .69 / count, .16]);
    }
  }
  socket.position.set(...data.position);
  socket.rotation.set(...data.orientation);
  return socket;
}

export function createPcModel(screenTexture, useTextures = false) {
  const m = materials(useTextures);
  const fanList = [];
  const collect = (id, builder) => {
    const rotors = [];
    const result = builder(m, rotors);
    fanList.push(...rotors.map(rotor => ({ id, rotor })));
    return result;
  };
  const frame = collect('case', chassis);
  const panel = sidePanel(m);
  const kinds = {
    board: board(m), cpu: cpu(m), ssd: ssd(m),
    gpu: collect('gpu', gpu), psu: collect('psu', psu),
    air: collect('air', airCooler), pump: pumpBlock(m), radiator: collect('radiator', radiator)
  };
  const parts = Object.fromEntries(Object.keys(components).map(id => [id, kinds[id] ?? ram(m)]));
  const plugs = Object.fromEntries(Object.entries(cables).map(([id, data]) => [id, makePlug(m, data)]));
  const sockets = Object.fromEntries(Object.entries(ports).map(([id, data]) => [id, makePort(m, data)]));
  return {
    frame, panel, parts, plugs, sockets, fanList, light: m.light,
    desk: makeDesk(m), boardStand: makeBoardStand(m), keyboard: makeKeyboard(m), ...makeMonitor(m, screenTexture),
    wireColors: [m.cable, m.cableDark]
  };
}
