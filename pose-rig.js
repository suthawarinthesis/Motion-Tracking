import { Matrix4, Quaternion, Vector3, MathUtils } from 'three';

export const poseLinks = [
  [7, 0], [0, 8], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32]
];

const mp = {
  l: { shoulder: 11, elbow: 13, wrist: 15, palm: 19, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  r: { shoulder: 12, elbow: 14, wrist: 16, palm: 20, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 }
};

const trunk = new Vector3(0, .903, -.021);
const neck = new Vector3(0, 1.491, -.033);
const toesForward = new Vector3(.009, -.026, .138);
const identity = new Quaternion();
const headMeshes = new Set(['skull', 'mandible', 'teeth']);
const pelvisMeshes = new Set(['pelvis', 'pelvic_floor', 'gluteal_l', 'gluteal_r']);
const headOrgans = new Set(['brain', 'cerebellum', 'brainstem', 'eye_l', 'eye_r', 'pituitary', 'tongue', 'salivary_glands', 'pharynx']);
const pelvicOrgans = new Set(['bladder', 'prostate', 'reproductive']);
const limbMeshes = {
  upperArm: ['humerus', 'upper_arm_muscles', 'deltoid', 'shoulder_muscles', 'rotator_cuff'],
  forearm: ['forearm', 'forearm_muscles'],
  hand: ['hand', 'hand_muscles'],
  thigh: ['femur', 'quadriceps', 'hamstrings', 'adductors'],
  shin: ['lower_leg', 'patella', 'calf', 'shin_muscles'],
  foot: ['foot', 'foot_muscles']
};

function midpoint(a, b) {
  return a.clone().add(b).multiplyScalar(.5);
}

function anchors(side) {
  const s = side === 'l' ? 1 : -1;
  return {
    shoulder: new Vector3(.160 * s, 1.390, -.025),
    elbow: new Vector3(.215 * s, 1.121, -.031),
    wrist: new Vector3(.255 * s, .890, -.010),
    finger: new Vector3(.280 * s, .758, .042),
    hip: new Vector3(.080 * s, .881, -.036),
    knee: new Vector3(.082 * s, .455, -.021),
    ankle: new Vector3(.083 * s, .065, -.031),
    toe: new Vector3(.083 * s, .065, -.031).add(new Vector3(toesForward.x * s, toesForward.y, toesForward.z))
  };
}

function canSee(point, threshold = .43) {
  return point && [point.x, point.y, point.z].every(Number.isFinite) &&
    (point.visibility ?? 1) > threshold && (point.presence ?? 1) > threshold;
}

export function landmarkInFrame(point) {
  return canSee(point) && point.x > .012 && point.x < .988 && point.y > .012 && point.y < .995;
}

export function bodyInFrame(points, framing = 'full') {
  const required = framing === 'upper' ? [0, 11, 12] : [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
  return required.every(index => landmarkInFrame(points?.[index]));
}

function meshRegion(name) {
  if (headMeshes.has(name)) return 'head';
  if (pelvisMeshes.has(name)) return 'pelvis';
  for (const [bone, stems] of Object.entries(limbMeshes)) {
    for (const side of ['l', 'r']) {
      if (stems.some(stem => name === stem + '_' + side)) return bone + side;
    }
  }
  return 'torso';
}

function orientation(right, left, up, alternate = identity) {
  const side = left.clone().sub(right);
  const front = new Vector3().crossVectors(side, up);
  if (side.lengthSq() < .00025 || front.lengthSq() < .00025) return alternate.clone();
  const upright = up.clone().normalize();
  front.normalize();
  const across = new Vector3().crossVectors(upright, front);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(across, upright, front));
}

function transform(from, to, rotation) {
  return { from, to, rotation };
}

function shift(point, motion, target = new Vector3()) {
  return target.copy(point).sub(motion.from).applyQuaternion(motion.rotation).add(motion.to);
}

function aim(baseStart, baseEnd, targetStart, rawDirection, parentRotation) {
  const original = baseEnd.clone().sub(baseStart);
  const directed = original.clone().applyQuaternion(parentRotation).normalize();
  const observed = rawDirection.lengthSq() > .00008 ? rawDirection.clone().normalize() : directed;
  const rotation = new Quaternion().setFromUnitVectors(directed, observed).multiply(parentRotation);
  const end = original.applyQuaternion(rotation).add(targetStart);
  return { ...transform(baseStart, targetStart, rotation), end };
}

export class BodyPoseRig {
  constructor(groups, organs) {
    this.organs = organs;
    this.meshes = [];
    this.rest = { l: anchors('l'), r: anchors('r') };
    for (const group of groups) {
      group.traverse(mesh => {
        if (mesh.isMesh) this.meshes.push({
          mesh, region: meshRegion(mesh.name),
          position: mesh.position.clone(), rotation: mesh.quaternion.clone()
        });
      });
    }
  }

  getMotion(id) {
    const region = headOrgans.has(id) ? 'head' : pelvicOrgans.has(id) ? 'pelvis' : 'torso';
    return this.motion?.[region];
  }

  moveOrgan(id, entry) {
    const motion = this.getMotion(id);
    if (!motion) {
      entry.pivot.position.copy(entry.home);
      entry.pivot.quaternion.identity();
      return;
    }
    shift(entry.home, motion, entry.pivot.position);
    entry.pivot.quaternion.copy(motion.rotation);
  }

  reset() {
    for (const entry of this.meshes) {
      entry.mesh.position.copy(entry.position);
      entry.mesh.quaternion.copy(entry.rotation);
    }
    this.points = null;
    this.motion = null;
    this.time = null;
    this.ground = undefined;
    for (const [id, entry] of this.organs) if (!entry.outside) this.moveOrgan(id, entry);
  }

  apply(raw, time, framing = 'full') {
    const measured = raw.map(point => canSee(point) ? new Vector3(point.x, -point.y, -point.z) : null);
    if (!this.points || time - this.time > 460) this.points = measured;
    else {
      const mix = MathUtils.clamp((time - this.time) / 175, .18, .70);
      for (let i = 0; i < measured.length; i++) {
        if (!measured[i]) continue;
        if (this.points[i]) this.points[i].lerp(measured[i], mix);
        else this.points[i] = measured[i];
      }
    }
    this.time = time;
    const world = this.points;
    const upper = framing === 'upper';
    const shoulders = midpoint(world[11], world[12]);
    const ears = world[7] && world[8];
    const head = ears ? midpoint(world[7], world[8]) : world[0] ?? shoulders.clone().add(new Vector3(0, .19, 0));
    const headUp = head.clone().sub(shoulders);
    const up = upper ? new Vector3(headUp.x, Math.max(.085, headUp.y), 0) : shoulders.clone().sub(midpoint(world[23], world[24]));
    const torsoQ = orientation(world[12], world[11], up);
    let pelvisQ = identity;
    if (!upper) {
      const hipSide = world[23].clone().sub(world[24]).normalize();
      const pelvisUp = new Vector3(0, 1, 0).addScaledVector(hipSide, -hipSide.y);
      pelvisQ = orientation(world[24], world[23], pelvisUp, torsoQ);
    }
    const torso = transform(trunk, trunk.clone(), torsoQ);
    const pelvis = transform(trunk, trunk.clone(), pelvisQ);
    const headQ = ears && canSee(raw[7], .57) && canSee(raw[8], .57)
      ? orientation(world[8], world[7], headUp, torsoQ) : torsoQ;
    const motions = { torso, pelvis, head: transform(neck, shift(neck, torso), headQ) };
    let lowestAnkle = Infinity;
    for (const side of ['l', 'r']) {
      const ref = this.rest[side];
      const ids = mp[side];
      const dir = (start, end) => {
        const from = world[ids[start]];
        const to = world[ids[end]];
        return from && to ? to.clone().sub(from) : new Vector3();
      };
      const shoulder = shift(ref.shoulder, torso);
      const arm = aim(ref.shoulder, ref.elbow, shoulder, dir('shoulder', 'elbow'), torsoQ);
      const forearm = aim(ref.elbow, ref.wrist, arm.end, dir('elbow', 'wrist'), arm.rotation);
      const hand = aim(ref.wrist, ref.finger, forearm.end, dir('wrist', 'palm'), forearm.rotation);
      motions['upperArm' + side] = arm;
      motions['forearm' + side] = forearm;
      motions['hand' + side] = hand;
      if (upper) {
        motions['thigh' + side] = transform(ref.hip, ref.hip.clone(), identity);
        motions['shin' + side] = transform(ref.knee, ref.knee.clone(), identity);
        motions['foot' + side] = transform(ref.ankle, ref.ankle.clone(), identity);
        continue;
      }
      const hip = shift(ref.hip, pelvis);
      const thigh = aim(ref.hip, ref.knee, hip, dir('hip', 'knee'), pelvisQ);
      const shin = aim(ref.knee, ref.ankle, thigh.end, dir('knee', 'ankle'), thigh.rotation);
      const foot = aim(ref.ankle, ref.toe, shin.end, dir('heel', 'toe'), pelvisQ);
      motions['thigh' + side] = thigh;
      motions['shin' + side] = shin;
      motions['foot' + side] = foot;
      lowestAnkle = Math.min(lowestAnkle, shin.end.y);
    }
    const correction = upper ? 0 : MathUtils.clamp(this.rest.l.ankle.y - lowestAnkle, -.20, .36);
    this.ground = upper || this.ground === undefined ? correction : MathUtils.lerp(this.ground, correction, .35);
    // Several adjacent segments share the same joint vector. Translate each joint once.
    for (const point of new Set(Object.values(motions).map(motion => motion.to))) point.y += this.ground;
    this.motion = motions;
    for (const entry of this.meshes) {
      const motion = motions[entry.region];
      shift(entry.position, motion, entry.mesh.position);
      entry.mesh.quaternion.multiplyQuaternions(motion.rotation, entry.rotation);
    }
    for (const [id, entry] of this.organs) if (!entry.outside) this.moveOrgan(id, entry);
  }
}
