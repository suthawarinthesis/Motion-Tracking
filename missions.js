import { roundSeconds, targetIds } from './anatomy.js';

export const rebuildMissions = {
  chest: {
    name: 'หัวใจและปอด', ids: targetIds, seconds: roundSeconds,
    camera: { target: [.003, 1.29, 0], distance: 1.12, minAspect: .75 }
  },
  digestive: {
    name: 'ระบบย่อยอาหาร', ids: ['liver', 'stomach', 'small_intestine'], seconds: 90,
    camera: { target: [0, 1.11, 0], distance: 1.27, minAspect: .75 }
  },
  urinary: {
    name: 'ระบบทางเดินปัสสาวะ', ids: ['kidney_r', 'kidney_l', 'bladder'], seconds: 90,
    camera: { target: [0, 1.02, 0], distance: 1.29, minAspect: .75 }
  }
};

const left = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const right = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
const visible = point => point && (point.visibility ?? 1) >= .55
  && [point.x, point.y, point.z].every(Number.isFinite);

function armUp(points, side, width) {
  const [shoulder, elbow, wrist] = [side.shoulder, side.elbow, side.wrist].map(id => points[id]);
  return [shoulder, elbow, wrist].every(visible) && shoulder.y - wrist.y > .24 * width
    && elbow.y - shoulder.y < .56 * width;
}

function armDown(points, side, width) {
  return visible(points[side.wrist]) && points[side.wrist].y - points[side.shoulder].y > .13 * width;
}

function armOut(points, side, other, width) {
  const shoulder = points[side.shoulder];
  const wrist = points[side.wrist];
  const elbow = points[side.elbow];
  const sign = Math.sign(shoulder.x - points[other.shoulder].x);
  return visible(wrist) && visible(elbow) && (wrist.x - shoulder.x) * sign > .40 * width
    && Math.abs(wrist.y - shoulder.y) < .32 * width;
}

function kneeUp(points, side, other, width) {
  const [hip, knee, otherHip, otherKnee] = [side.hip, side.knee, other.hip, other.knee].map(id => points[id]);
  return [hip, knee, otherHip, otherKnee, points[side.ankle], points[other.ankle]].every(visible)
    && (otherKnee.y - otherHip.y) - (knee.y - hip.y) > .45 * width;
}

const poses = {
  leftArm: { label: 'ยกมือซ้ายเหนือไหล่', test: (p, w) => armUp(p, left, w) && armDown(p, right, w) },
  rightArm: { label: 'ยกมือขวาเหนือไหล่', test: (p, w) => armUp(p, right, w) && armDown(p, left, w) },
  armsOut: { label: 'กางแขนทั้งสองข้างระดับไหล่', test: (p, w) => armOut(p, left, right, w) && armOut(p, right, left, w) },
  leftKnee: { label: 'ยกเข่าซ้าย', test: (p, w) => kneeUp(p, left, right, w) },
  rightKnee: { label: 'ยกเข่าขวา', test: (p, w) => kneeUp(p, right, left, w) }
};

export const bodyMissions = {
  upper: { name: 'ท่าทางครึ่งตัว', steps: [poses.leftArm, poses.rightArm, poses.armsOut] },
  full: { name: 'ท่าทางเต็มตัว', steps: [poses.leftArm, poses.rightKnee, poses.armsOut, poses.leftKnee, poses.rightArm] }
};

export class BodyMission {
  constructor() {
    this.reset();
  }

  reset(steps = []) {
    this.steps = steps;
    this.score = 0;
    this.phase = steps.length ? 'playing' : 'ready';
    this.pause();
  }

  pause() {
    this.progress = 0;
    this.since = null;
    this.lastFrame = null;
  }

  sample(points, now) {
    if (this.phase !== 'playing') return;
    if (this.lastFrame !== null && now - this.lastFrame > 360) this.pause();
    this.lastFrame = now;
    const a = points?.[left.shoulder], b = points?.[right.shoulder];
    const width = visible(a) && visible(b) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
    if (width < .045 || !this.steps[this.score].test(points, width)) {
      this.since = null;
      this.progress = 0;
      return;
    }
    this.since ??= now;
    this.progress = Math.min(1, (now - this.since) / 680);
    if (this.progress < 1) return;
    this.score += 1;
    this.pause();
    if (this.score === this.steps.length) this.phase = 'won';
  }
}
