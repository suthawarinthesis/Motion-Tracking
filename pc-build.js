export const hardware = Object.freeze({
  cpu: 'Intel Core i9-14900KF',
  gpu: 'GeForce RTX 5050',
  graphicsMemory: '8 GB GDDR6',
  board: 'Z790 ATX',
  memory: '32 GB DDR5',
  storage: '1 TB NVMe'
});

export const deskY = -24.58;
export const caseOrigin = [31, 0, -17];
export const boardInCase = [-8.4, 3.6, -8.1];
export const monitorOrigin = [-31, -5, -18];
export const keyboardOrigin = [-29, deskY + .7, 9];
const add = (origin, point) => origin.map((value, index) => value + point[index]);
const onMonitor = (x, y, z) => add(monitorOrigin, [x, y, z]);
const onDesk = (x, height, z) => [x, deskY + height, z];
const flat = [-Math.PI / 2, 0, 0];
const flatLong = [0, 0, Math.PI / 2];
const rearFacing = [0, -Math.PI / 2, 0];

export const components = {
  board: { kind: 'board', name: hardware.board, detail: 'LGA1700 · DDR5', bench: onDesk(-42, 2.38, 40), angles: flat },
  cpu: { kind: 'cpu', name: hardware.cpu, detail: 'LGA1700', bench: onDesk(-18, .34, 32), angles: flat },
  'ram-a': { kind: 'ram', name: 'DDR5 DIMM 1', detail: '16 GB', bench: onDesk(-15, .68, 44), angles: flatLong },
  'ram-b': { kind: 'ram', name: 'DDR5 DIMM 2', detail: '16 GB', bench: onDesk(-15, .68, 50), angles: flatLong },
  ssd: { kind: 'ssd', name: 'NVMe SSD', detail: '1 TB · M.2 2280', bench: onDesk(-5, .30, 32), angles: flat },
  gpu: { kind: 'gpu', name: hardware.gpu, detail: hardware.graphicsMemory, bench: onDesk(10, 1.45, 49), angles: [Math.PI, 0, 0] },
  psu: { kind: 'psu', name: 'ATX Power Supply', detail: '750 W', bench: onDesk(36, 4.52, 42) },
  air: { kind: 'cooler', name: 'Dual-tower Air Cooler', detail: '120 mm', bench: onDesk(61, .24, 40), angles: flat, needs: ['cpu'], cooling: 'air' },
  pump: { kind: 'cooler', name: 'AIO Pump Block', detail: 'LGA1700', bench: onDesk(56, .24, 27), angles: flat, needs: ['cpu'], cooling: 'liquid' },
  radiator: { kind: 'radiator', name: 'AIO Radiator', detail: '240 mm · 2 × 120 mm', bench: onDesk(57.5, 2.18, 51), cooling: 'liquid' }
};

// Slot coordinates are local to the chassis or the motherboard.
const caseSlot = (kind, position, tolerance, pointOffset = [0, 0, .45], footprint) => ({
  kind, frame: 'case', position, point: add(position, pointOffset), tolerance, footprint
});
const boardSlot = (kind, position, tolerance, pointOffset = [0, 0, .45]) => {
  const local = position.map((value, index) => value - boardInCase[index]);
  return { kind, frame: 'board', position: local, point: add(local, pointOffset), tolerance };
};

export const mountSlots = {
  'atx-tray': caseSlot('board', boardInCase, 5.0, [0, 0, .5], [12.45, 15.55]),
  lga: boardSlot('cpu', [-11.4, 10.9, -7.53], 3.0),
  'dimm-1': boardSlot('ram', [-3.35, 8.2, -7.5], 1.05, [0, 0, .8]),
  'dimm-2': boardSlot('ram', [-2.08, 8.2, -7.5], 1.05, [0, 0, .8]),
  'dimm-3': boardSlot('ram', [-.81, 8.2, -7.5], 1.05, [0, 0, .8]),
  'dimm-4': boardSlot('ram', [.46, 8.2, -7.5], 1.05, [0, 0, .8]),
  'm2-slot': boardSlot('ssd', [-10.9, 2.3, -7.65], 3.25),
  'pcie-slot': boardSlot('gpu', [-11.47, -.7, -7.46], 5.15, [-.22, 0, .6]),
  'psu-bay': caseSlot('psu', [-14.1, -17.3, -1.25], 6.0, [0, 0, 2.4]),
  'cpu-mount': boardSlot('cooler', [-11.4, 10.9, -7.12], 5.2, [0, 0, .85]),
  'top-mount': caseSlot('radiator', [2.0, 21.18, 0], 8.0, [0, -.36, 0])
};

export const powerStrip = onDesk(-61.7, .2, -8);
const plugType = {
  atx: { body: [1.10, 4.31, 1.2], shell: '#687783', band: '#dbc47e' },
  eps: { body: [1.08, 1.64, 1.25], shell: '#47555e', band: '#cba864' },
  pcie: { body: [1.08, 1.63, 1.22], shell: '#58656c', band: '#9fd0b1' },
  fan: { body: [.8, 1.12, .9], shell: '#838e90', band: '#cae0d1' },
  switch: { body: [.64, .56, .8], shell: '#607b81', band: '#83c5cb' },
  iec: { body: [2.75, 1.86, 2.5], shell: '#576976', band: '#71818b' },
  dc: { body: [.83, .83, 1.88], shell: '#5b707d', band: '#879eab' },
  hdmi: { body: [1.75, .82, 1.95], shell: '#52626e', band: '#dace93' },
  usb: { body: [1.48, .7, 1.77], shell: '#52626e', band: '#7aa2c9' }
};
const cable = (kind, name, rest, end, options = {}) => ({ kind, name, rest, end, ...plugType[kind], ...options });

export const cables = {
  'tower-ac': cable('iec', 'สายไฟเคส', onDesk(2.0, 1.08, -27), [powerStrip[0], deskY + .55, powerStrip[2] - 7]),
  'monitor-ac': cable('dc', 'สายไฟจอ', onDesk(-48, .49, -24), [powerStrip[0], deskY + .55, powerStrip[2] - 1]),
  display: cable('hdmi', 'สาย HDMI', onDesk(-6, .48, -4), onMonitor(13.5, -10.5, -2.1)),
  keyboard: cable('usb', 'สายคีย์บอร์ด USB', onDesk(-4.8, .48, 14), add(keyboardOrigin, [10.5, .02, -6.78])),
  atx: cable('atx', 'ATX 24-pin', onDesk(2, 1.45, 6), [8.15, 1.1, -2.7], { owner: 'psu', internal: true }),
  eps: cable('eps', 'CPU EPS 8-pin', onDesk(8, .92, 14), [8.15, 2.2, -4.45], { owner: 'psu', internal: true }),
  'gpu-power': cable('pcie', 'GPU PCIe 8-pin', onDesk(15, .83, 17), [8.15, -.7, 4], { owner: 'psu', internal: true }),
  'power-switch': cable('switch', 'PWR SW', onDesk(18.5, .48, 6.0), [19, 20, 5.5], { internal: true, caseEnd: true }),
  'air-fan': cable('fan', 'สายพัดลม CPU', onDesk(58.6, .56, 23), [-4.7, 5.7, 7.4], { owner: 'air', cooling: 'air', internal: true }),
  'pump-power': cable('fan', 'สายปั๊ม AIO', onDesk(63, .58, 24), [1.9, 0.8, 2.9], { owner: 'pump', cooling: 'liquid', internal: true }),
  'rad-fan': cable('fan', 'สายพัดลมหม้อน้ำ', onDesk(53, .56, 46), [-10.4, -.5, -5.3], { owner: 'radiator', cooling: 'liquid', internal: true })
};

const port = (kind, position, needs, face = 'inside', orientation = [0, 0, 0]) => ({
  kind, position, needs, face, orientation, frame: face === 'monitor-rear' ? 'world' : 'case', body: plugType[kind].body
});
export const ports = {
  'psu-inlet': port('iec', [-22.65, -16.7, 2.76], 'psu', 'rear', rearFacing),
  'monitor-dc': port('dc', onMonitor(-14.9, -9.5, -2.27), null, 'monitor-rear', [0, Math.PI, 0]),
  'board-hdmi': port('hdmi', [-22.72, 15.89, -6.47], 'board', 'rear', rearFacing),
  'gpu-hdmi': port('hdmi', [-22.75, -.90, 2.91], 'gpu', 'rear', rearFacing),
  'usb-rear': port('usb', [-22.72, 12.80, -6.47], 'board', 'rear', rearFacing),
  'usb-front': port('usb', [19.1, 23.65, 5.4], 'board', 'top', flat),
  'atx-main': port('atx', [3.05, 6.3, -7.08], 'board'),
  'eps-cpu': port('eps', [-14.6, 17.91, -7.08], 'board'),
  'pcie-power': port('pcie', [-5.92, .225, 4.47], 'gpu'),
  'cpu-header': port('fan', [-5.27, 17.84, -7.41], 'board'),
  'pump-header': port('fan', [.63, 17.86, -7.41], 'board'),
  'sys-header': port('fan', [2.85, -5.19, -7.41], 'board'),
  'switch-header': port('switch', [1.36, -9.66, -7.37], 'board'),
  'led-header': port('switch', [2.83, -9.66, -7.37], 'board')
};

const mainWiring = {
  atx: 'atx-main',
  eps: 'eps-cpu',
  'gpu-power': 'pcie-power',
  'power-switch': 'switch-header',
  'tower-ac': 'psu-inlet',
  'monitor-ac': 'monitor-dc',
  display: 'gpu-hdmi',
  keyboard: 'usb-rear'
};
const coolingWiring = {
  air: { 'air-fan': 'cpu-header' },
  liquid: { 'pump-power': 'pump-header', 'rad-fan': 'cpu-header' }
};
const mainHardware = ['board', 'cpu', 'ram-a', 'ram-b', 'ssd', 'gpu', 'psu'];

export class PcBuild {
  constructor() {
    this.cooling = 'air';
    this.mounted = new Map();
    this.plugged = new Map();
  }

  useItem(id) {
    const item = components[id] ?? cables[id];
    return Boolean(item && (!item.cooling || this.cooling === item.cooling));
  }

  slotOf(id) {
    return mountSlots[this.mounted.get(id)];
  }

  attachedToBoard(id) {
    return this.slotOf(id)?.frame === 'board';
  }

  inCase(id) {
    return this.mounted.has(id) && (!this.attachedToBoard(id) || this.mounted.has('board'));
  }

  portReady(port) {
    return !port.needs || this.inCase(port.needs);
  }

  canSeat(id, location) {
    if (!this.useItem(id) || this.mounted.has(id) || this.plugged.has(id)) return false;
    const part = components[id];
    if (!part) {
      const wire = cables[id], target = ports[location];
      return wire.kind === target?.kind && this.portReady(target)
        && (!wire.owner || this.inCase(wire.owner)) && ![...this.plugged.values()].includes(location);
    }
    const target = mountSlots[location];
    return part.kind === target?.kind && (part.needs ?? []).every(dependency => this.mounted.has(dependency))
      && ![...this.mounted.values()].includes(location);
  }

  seat(id, location) {
    if (!this.canSeat(id, location)) return false;
    const placements = components[id] ? this.mounted : this.plugged;
    placements.set(id, location);
    return true;
  }

  remove(id) {
    if (cables[id]) return this.plugged.delete(id);
    if ([...this.mounted.keys()].some(part => components[part].needs?.includes(id))) return false;
    if (!this.mounted.delete(id)) return false;
    for (const [wire, location] of this.plugged) {
      const owner = cables[wire].owner;
      if (!this.portReady(ports[location]) || (owner && !this.inCase(owner))) this.plugged.delete(wire);
    }
    return true;
  }

  chooseCooling(choice) {
    if (!['air', 'liquid'].includes(choice) || choice === this.cooling) return false;
    for (const id of ['air', 'pump', 'radiator']) this.remove(id);
    this.cooling = choice;
    return true;
  }

  connected(id, ...locations) {
    return locations.includes(this.plugged.get(id));
  }

  hardwareReady() {
    return mainHardware.every(id => this.inCase(id)) && (this.cooling === 'air'
      ? this.inCase('air') : this.inCase('pump') && this.inCase('radiator'));
  }

  wiringPlan() {
    return Object.entries({
      ...coolingWiring[this.cooling], ...mainWiring,
      keyboard: this.connected('keyboard', 'usb-front') ? 'usb-front' : mainWiring.keyboard
    });
  }

  hasPower() {
    return this.mounted.has('psu') && this.mounted.has('board') && this.connected('tower-ac', 'psu-inlet') &&
      this.connected('atx', 'atx-main') && this.connected('power-switch', 'switch-header');
  }

  post() {
    if (!this.hasPower()) return 'power';
    if (!this.mounted.has('cpu') || !this.connected('eps', 'eps-cpu')) return 'CPU';
    if (!this.mounted.has('ram-a') || !this.mounted.has('ram-b')) return 'DRAM';
    if (!this.mounted.has('gpu') || !this.connected('gpu-power', 'pcie-power')) return 'VGA';
    const coolingReady = this.cooling === 'air'
      ? this.mounted.has('air') && this.connected('air-fan', 'cpu-header')
      : this.mounted.has('pump') && this.mounted.has('radiator') &&
        this.connected('pump-power', 'pump-header') && this.connected('rad-fan', 'cpu-header');
    if (!coolingReady) return 'CPU_FAN';
    if (!this.mounted.has('ssd')) return 'BOOT';
    if (!this.connected('keyboard', 'usb-rear', 'usb-front')) return 'keyboard';
    return 'ready';
  }

  videoSignal() {
    return this.connected('monitor-ac', 'monitor-dc') && this.connected('display', 'gpu-hdmi');
  }
}
