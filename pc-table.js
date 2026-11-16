import { deskY } from './pc-build.js';

export const worktop = Object.freeze({
  x: 0, z: 10, width: 153, depth: 110, height: deskY + .014
});

export const workMat = Object.freeze({
  x: 2.5, z: 42.20, width: 128.8, depth: 40.8, height: deskY + .225
});

export const boardStandHeight = 2.12;
const clearance = .18;
const edgeCatch = 11;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function closeToWorktop(x, z) {
  return Math.abs(x - worktop.x) <= worktop.width / 2 + edgeCatch &&
    Math.abs(z - worktop.z) <= worktop.depth / 2 + edgeCatch;
}

export function worktopLimits(bounds) {
  return {
    minX: worktop.x - worktop.width / 2 - bounds.min.x + clearance,
    maxX: worktop.x + worktop.width / 2 - bounds.max.x - clearance,
    minZ: worktop.z - worktop.depth / 2 - bounds.min.z + clearance,
    maxZ: worktop.z + worktop.depth / 2 - bounds.max.z - clearance
  };
}

export function surfaceHeight(x, z, bounds) {
  const onMat = x + bounds.max.x > workMat.x - workMat.width / 2 &&
    x + bounds.min.x < workMat.x + workMat.width / 2 &&
    z + bounds.max.z > workMat.z - workMat.depth / 2 &&
    z + bounds.min.z < workMat.z + workMat.depth / 2;
  return onMat ? workMat.height : worktop.height;
}

export function nearestTablePosition(wanted, bounds, obstacles = []) {
  const { minX, maxX, minZ, maxZ } = worktopLimits(bounds);
  if (minX > maxX || minZ > maxZ || !Number.isFinite(wanted.x + wanted.z)) return null;

  const x = clamp(wanted.x, minX, maxX);
  const z = clamp(wanted.z, minZ, maxZ);
  const xChoices = new Set([x]);
  const zChoices = new Set([z]);
  const keepOut = obstacles.map(other => ({
    left: other.min.x - bounds.max.x - clearance,
    right: other.max.x - bounds.min.x + clearance,
    front: other.min.z - bounds.max.z - clearance,
    back: other.max.z - bounds.min.z + clearance,
    bottom: other.min.y - bounds.max.y - clearance,
    top: other.max.y - bounds.min.y + clearance
  }));
  for (const other of keepOut) {
    xChoices.add(clamp(other.left, minX, maxX));
    xChoices.add(clamp(other.right, minX, maxX));
    zChoices.add(clamp(other.front, minZ, maxZ));
    zChoices.add(clamp(other.back, minZ, maxZ));
  }

  // The closest valid point is either the intended point or on a keep-out edge.
  let best = null, bestDistance = Infinity;
  for (const tx of xChoices) {
    for (const tz of zChoices) {
      const distance = (tx - x) ** 2 + (tz - z) ** 2;
      if (distance >= bestDistance) continue;
      const y = surfaceHeight(tx, tz, bounds) - bounds.min.y + .018;
      if (keepOut.some(other => tx > other.left && tx < other.right && tz > other.front &&
          tz < other.back && y > other.bottom && y < other.top)) continue;
      best = { x: tx, y, z: tz };
      bestDistance = distance;
      if (distance === 0) return best;
    }
  }
  return best;
}
