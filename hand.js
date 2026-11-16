import { bodyInFrame, landmarkInFrame, poseLinks } from './pose-rig.js';

const wasmURL = new URL('./vendor/mediapipe/wasm/', import.meta.url).href.replace(/\/$/, '');
const modelFiles = {
  hand: {
    type: 'HandLandmarker', file: 'hand_landmarker.task',
    options: { numHands: 2, minHandDetectionConfidence: .55, minHandPresenceConfidence: .52, minTrackingConfidence: .53 }
  },
  pose: {
    type: 'PoseLandmarker', file: 'pose_landmarker_lite.task',
    options: { numPoses: 1, minPoseDetectionConfidence: .55, minPosePresenceConfidence: .54, minTrackingConfidence: .54 }
  }
};
const handLinks = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(value, hi));
const distance = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

export function handShape(points, aspect) {
  const gap = (a, b) => distance(points[a], points[b], aspect);
  const palm = Math.max(.017, gap(5, 17), gap(0, 9) * .82);
  const finger = (mcp, pip, dip, tip) => {
    const length = gap(mcp, pip) + gap(pip, dip) + gap(dip, tip);
    const straightness = gap(mcp, tip) / Math.max(.0001, length);
    const extension = (gap(0, tip) - gap(0, pip)) / palm;
    return {
      extended: straightness > .86 && extension > .085,
      curled: straightness < .76 || extension < .025
    };
  };
  const fingers = [finger(5, 6, 7, 8), finger(9, 10, 11, 12), finger(13, 14, 15, 16), finger(17, 18, 19, 20)];
  const [index, middle, ring, pinky] = fingers;
  const pinch = gap(4, 8) / palm;
  const thumbStraight = gap(2, 4) / Math.max(.0001, gap(2, 3) + gap(3, 4)) > .80;
  const thumbOut = gap(4, 9) > palm * .70 && gap(4, 5) > palm * .45 && gap(4, 17) - gap(3, 17) > palm * .075;
  return {
    palm, pinch,
    fist: index.curled && fingers.filter(rule => rule.curled).length >= 3 && !middle.extended,
    spread: thumbStraight && thumbOut && index.extended && middle.curled && ring.curled && pinky.curled,
    labels: index.extended && middle.extended && !ring.extended && !pinky.extended
  };
}

function supportsTracking() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return Boolean(context);
}

let visionBundle;
function loadVision() {
  visionBundle ??= (async () => {
    const sdk = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = await sdk.FilesetResolver.forVisionTasks(wasmURL);
    return { sdk, fileset };
  })().catch(error => { visionBundle = null; throw error; });
  return visionBundle;
}

function closeTracker(tracker) {
  try { tracker?.close(); } catch (error) { console.warn('BioAre tracking cleanup:', error); }
}

async function buildTracker(kind, video, stillStarting) {
  const { type, file, options } = modelFiles[kind];
  const url = new URL('./assets/models/' + file, import.meta.url);
  const [{ sdk, fileset }, model] = await Promise.all([
    loadVision(),
    fetch(url).then(response => {
      if (!response.ok) throw new Error('Unable to load the ' + kind + ' tracking model.');
      return response.arrayBuffer();
    })
  ]);
  let failure;
  for (const delegate of ['GPU', 'CPU']) {
    if (!stillStarting()) return null;
    let tracker;
    try {
      tracker = await sdk[type].createFromOptions(fileset, {
        ...options, runningMode: 'VIDEO',
        baseOptions: { delegate, modelAssetBuffer: new Uint8Array(model) }
      });
      if (!stillStarting()) {
        closeTracker(tracker);
        return null;
      }
      const timestamp = performance.now();
      tracker.detectForVideo(video, timestamp);
      return { tracker, timestamp, videoTime: video.currentTime };
    } catch (error) {
      closeTracker(tracker);
      failure = error;
    }
  }
  throw failure;
}

export class WebcamTracking {
  constructor(video, overlay, hooks) {
    this.video = video;
    this.overlay = overlay;
    this.context = overlay.getContext('2d');
    this.hooks = hooks;
    this.state = 'off';
    this.generation = 0;
    this.poseGeneration = 0;
    this.poseEnabled = false;
    this.poseFraming = 'full';
    this.resetHands();
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.hooks.onStatus('off', 'Use HTTPS or localhost to enable the camera.', true);
      return;
    }
    if (!supportsTracking()) {
      this.hooks.onStatus('off', 'Camera tracking needs WebGL. Use a WebGL-enabled browser or continue with mouse and touch.', true);
      return;
    }
    const generation = ++this.generation;
    this.state = 'loading';
    this.hooks.onStatus('loading', 'Allow camera access in your browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (generation === this.generation) this.stop('Camera disconnected. You can still use mouse or touch.', true);
        }, { once: true });
      }
      this.video.hidden = false;
      this.hooks.onStatus('loading', 'Loading the hand tracking model…');
      await this.video.play();
      if (generation !== this.generation) return;
      const task = await buildTracker('hand', this.video, () => generation === this.generation);
      if (generation !== this.generation || !task) {
        closeTracker(task?.tracker);
        return;
      }
      this.handTask = task;
      this.overlay.hidden = false;
      this.sizeOverlay();
      this.state = 'live';
      this.hooks.onStatus('live', 'Point, make a fist to grab, then open your hand. Video stays on this device.');
      if (this.poseEnabled) this.startPose();
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error.name === 'NotAllowedError' ? 'Camera access was blocked. Check your browser permissions.'
        : error.name === 'NotFoundError' || error.name === 'NotReadableError' ? 'No available camera. Check that it is connected and free.'
        : 'Camera tracking could not start. You can retry or use mouse and touch.';
      console.warn('BioAre hand tracking:', error);
      this.stop(message, true);
    }
  }

  setPoseEnabled(enabled) {
    if (enabled === this.poseEnabled) return;
    this.poseEnabled = enabled;
    this.resetHands();
    if (!enabled) this.stopPose();
    else if (this.state === 'live') this.startPose();
  }

  setPoseFraming(framing) {
    if (framing === this.poseFraming) return;
    this.poseFraming = framing;
    this.clearPoseSamples();
    if (this.poseTask) this.hooks.onPose('framing');
    this.draw();
  }

  clearPoseSamples() {
    this.posePoints = null;
    this.poseLocatedAt = this.lastBodyInFrame = null;
  }

  async startPose() {
    if (this.state !== 'live' || !this.poseEnabled || this.poseTask || this.poseLoading) return;
    const generation = ++this.poseGeneration;
    this.poseLoading = true;
    this.hooks.onPose('loading');
    try {
      const isCurrent = () => generation === this.poseGeneration && this.state === 'live' && this.poseEnabled;
      const task = await buildTracker('pose', this.video, isCurrent);
      if (!isCurrent()) {
        closeTracker(task?.tracker);
        return;
      }
      this.poseTask = task;
      this.hooks.onPose('framing');
    } catch (error) {
      if (generation !== this.poseGeneration) return;
      console.warn('BioAre pose tracking:', error);
      this.hooks.onPose('unavailable');
    } finally {
      if (generation === this.poseGeneration) this.poseLoading = false;
    }
  }

  stopPose() {
    ++this.poseGeneration;
    this.poseLoading = false;
    closeTracker(this.poseTask?.tracker);
    this.poseTask = null;
    this.clearPoseSamples();
    this.hooks.onPose('off');
    this.draw();
  }

  stop(message = 'Video stays on this device.', error = false) {
    ++this.generation;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = this.overlay.hidden = true;
    closeTracker(this.handTask?.tracker);
    this.handTask = null;
    this.state = 'off';
    this.stopPose();
    this.resetHands();
    this.hooks.onStatus('off', message, error);
  }

  resetHands() {
    this.pointer = null;
    this.wrist = null;
    this.lastSeen = -Infinity;
    this.grab = null;
    this.fistSince = null;
    this.armed = false;
    this.zoom = null;
    this.spreadSince = null;
    this.labelSince = null;
    this.hands = [];
    this.hooks.onLost();
    this.draw();
  }

  sizeOverlay() {
    if (this.overlay.width !== this.video.videoWidth || this.overlay.height !== this.video.videoHeight) {
      this.overlay.width = this.video.videoWidth;
      this.overlay.height = this.video.videoHeight;
    }
    this.aspect = this.overlay.width / this.overlay.height || 1;
  }

  draw() {
    const { context } = this;
    const { width, height } = this.overlay;
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // The video and canvas use the same contained aspect ratio. Keep marks readable in a small preview.
    const scale = Math.max(width / (this.overlay.clientWidth || width), height / (this.overlay.clientHeight || height));
    const trace = (points, connections, color, lineWidth) => {
      context.beginPath();
      for (const [a, b] of connections) {
        if ((points[a].visibility ?? 1) < .42 || (points[b].visibility ?? 1) < .42) continue;
        context.moveTo(points[a].x * width, points[a].y * height);
        context.lineTo(points[b].x * width, points[b].y * height);
      }
      context.lineWidth = (lineWidth + 1.9) * scale;
      context.strokeStyle = '#142620eb';
      context.stroke();
      context.lineWidth = lineWidth * scale;
      context.strokeStyle = color;
      context.stroke();
    };
    if (this.posePoints) {
      const connections = this.poseFraming === 'upper' ? poseLinks.slice(0, 7) : poseLinks;
      trace(this.posePoints, connections, '#7fe4ff', 1.25);
    }
    for (const hand of this.hands) {
      trace(hand, handLinks, '#a8fa79', 1.7);
      for (const [i, point] of hand.entries()) {
        const radius = (i === 4 || i === 8 ? 2.4 : 1.65) * scale;
        context.beginPath();
        context.arc(point.x * width, point.y * height, radius, 0, 2 * Math.PI);
        context.fillStyle = i === 4 || i === 8 ? '#e8ff9f' : '#d0ffb6';
        context.fill();
        context.strokeStyle = '#172d23';
        context.lineWidth = .85 * scale;
        context.stroke();
      }
    }
  }

  process(now) {
    if (this.state !== 'live' || this.video.readyState < 2) return;
    const videoTime = this.video.currentTime;
    const infer = (task, interval) => {
      if (!task || now - task.timestamp < interval || videoTime === task.videoTime) return null;
      task.timestamp = now;
      task.videoTime = videoTime;
      return task.tracker.detectForVideo(this.video, now);
    };
    this.sizeOverlay();
    let pose;
    try {
      pose = infer(this.poseTask, 76);
      if (pose) this.updatePose(pose, now);
    } catch (error) {
      console.warn('BioAre pose frame:', error);
      this.stopPose();
      this.hooks.onPose('unavailable');
    }
    try {
      const hand = infer(this.handTask, 45);
      if (hand) this.update(hand.landmarks || [], now);
      if (pose || hand) this.draw();
    } catch (error) {
      console.warn('BioAre hand frame:', error);
      this.stop('Hand tracking was interrupted. Re-enable the camera to try again.', true);
    }
  }

  updatePose(result, now) {
    const points = result.landmarks?.[0];
    const world = result.worldLandmarks?.[0];
    const usable = points?.length === 33 && world?.length === 33 &&
      world.every(point => [point.x, point.y, point.z].every(Number.isFinite));
    this.posePoints = points?.length === 33 ? points.map((point, i) => ({
      ...point, visibility: landmarkInFrame(point) ? Math.min(point.visibility ?? 1, world?.[i]?.visibility ?? 1, world?.[i]?.presence ?? 1) : 0
    })) : null;
    const tracked = usable ? world.map((point, i) => ({
      ...point, visibility: Math.min(point.visibility ?? 1, this.posePoints[i].visibility)
    })) : null;
    const ready = tracked && bodyInFrame(this.posePoints, this.poseFraming);
    if (ready) {
      this.poseLocatedAt ??= now;
      if (now - this.poseLocatedAt >= 145) {
        this.lastBodyInFrame = now;
        this.hooks.onPose('tracked', tracked, now);
      }
      return;
    }
    const coreIds = this.poseFraming === 'upper' ? [0, 11, 12] : [11, 12, 23, 24];
    const core = tracked && coreIds.every(id => tracked[id].visibility > .47);
    if (core && this.lastBodyInFrame != null && now - this.lastBodyInFrame < 500) {
      this.hooks.onPose('tracked', tracked, now);
    } else {
      this.poseLocatedAt = this.lastBodyInFrame = null;
      this.hooks.onPose('framing');
    }
  }

  mapped(point) {
    const x = 1 - point.x;
    return {
      x: clamp((x - .08) / .84, .015, .985),
      y: clamp((point.y - .08) / .84, .015, .985)
    };
  }

  follow(point) {
    const old = this.pointer;
    const mix = old && distance(old, point, 1) < .08 ? .52 : .78;
    this.pointer = old ? {
      x: old.x + (point.x - old.x) * mix,
      y: old.y + (point.y - old.y) * mix
    } : point;
  }

  moveZoom(kind, span) {
    if (this.zoom?.kind !== kind) {
      this.hooks.onLost();
      this.zoom = { kind, span };
    }
    if (Math.abs(this.zoom.span - span) >= (kind === 'spread' ? .022 : .010)) {
      this.hooks.onZoom(clamp((this.zoom.span / span) ** 1.18, .86, 1.16));
      this.zoom.span = span;
    }
    this.armed = false;
    this.labelSince = null;
    this.hooks.onGesture(kind);
  }

  update(hands, now) {
    this.hands = hands;
    if (!hands.length) {
      if (this.wrist && now - this.lastSeen > 175) this.resetHands();
      return;
    }
    let primary = hands[0];
    if (this.wrist) {
      primary = hands.reduce((nearest, hand) => (
        distance(hand[0], this.wrist, this.aspect) < distance(nearest[0], this.wrist, this.aspect) ? hand : nearest
      ));
      if (distance(primary[0], this.wrist, this.aspect) > .30) {
        this.resetHands();
        this.hands = hands;
      }
    }
    this.lastSeen = now;
    this.wrist = primary[0];

    const shape = handShape(primary, this.aspect);
    const tip = this.mapped(primary[8]);
    const palm = this.mapped({ x: (primary[0].x + primary[9].x) / 2, y: (primary[0].y + primary[9].y) / 2 });
    const wantsZoom = this.hooks.canZoom();
    const twoHands = wantsZoom && this.grab?.kind !== 'fist' && hands.length === 2 && hands.every(hand => {
      const pattern = handShape(hand, this.aspect);
      return !pattern.fist && pattern.pinch < (this.zoom?.kind === 'two-hands' ? .53 : .39);
    });
    const twoHandSpan = twoHands ? distance(hands[0][8], hands[1][8], this.aspect) : 0;
    if (twoHandSpan > .08) {
      this.grab = null;
      this.moveZoom('two-hands', twoHandSpan);
      return;
    }
    if (this.grab) {
      const previous = this.grab;
      const stillHeld = previous.kind === 'fist' ? shape.fist : shape.pinch < .555 && !shape.fist;
      if (stillHeld) {
        const anchor = previous.kind === 'fist' ? palm : tip;
        this.follow({
          x: clamp(anchor.x + previous.dx, .012, .988),
          y: clamp(anchor.y + previous.dy, .012, .988)
        });
        const relativeDepth = Math.log(shape.palm / previous.palm);
        this.hooks.onPointer(this.pointer, previous.kind);
        this.hooks.onMove(this.pointer, previous.kind, relativeDepth);
      } else {
        this.hooks.onRelease();
        this.grab = null;
        this.spreadSince = now + 120;
        this.pointer = tip;
        this.armed = !shape.fist && shape.pinch > .55;
        this.hooks.onPointer(this.pointer, 'aim');
      }
      return;
    }

    if (wantsZoom && hands.length === 1 && shape.spread && shape.pinch > (this.zoom?.kind === 'spread' ? .43 : .67)) {
      this.spreadSince ??= now;
      if (now - this.spreadSince >= 165 || this.zoom?.kind === 'spread') {
        this.moveZoom('spread', shape.pinch);
        return;
      }
    } else {
      this.spreadSince = null;
    }
    this.zoom = null;

    const requested = shape.fist ? 'fist' : shape.pinch < .383 ? 'pinch' : null;
    if (!requested) this.armed = true;
    if (this.armed && requested === 'fist') {
      this.fistSince ??= now;
      if (now - this.fistSince < 54) return;
    } else {
      this.fistSince = null;
    }
    if (this.armed && requested) {
      const anchor = requested === 'fist' ? palm : tip;
      const aim = this.pointer ?? anchor;
      this.grab = { kind: requested, dx: aim.x - anchor.x, dy: aim.y - anchor.y, palm: shape.palm };
      this.hooks.onPointer(aim, requested);
      this.hooks.onGrab(aim, requested);
      this.labelSince = null;
      return;
    }
    this.follow(tip);
    this.hooks.onPointer(this.pointer, 'aim');
    if (shape.labels && hands.length === 1) {
      this.labelSince ??= now;
      if (now - this.labelSince > 360) {
        this.hooks.onLabels();
        this.labelSince = Infinity;
      }
    } else {
      this.labelSince = null;
    }
  }
}
