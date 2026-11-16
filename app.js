import { chestIds, heartViews, layers, organs, poseLayers } from './anatomy.js';
import { BodyMission, bodyMissions, rebuildMissions } from './missions.js';
import { WebcamTracking } from './hand.js';
import { AnatomyScene } from './scene.js';

const $ = selector => document.querySelector(selector);
const byId = Object.fromEntries(organs.map(organ => [organ.id, organ]));
const stage = $('#stage');
const markerLayer = $('#markers');
const cursor = $('#handCursor');
const cameraCard = $('#cameraCard');
const pcBench = $('#pcBench');
const atlasTools = $('#atlasToolsDialog');
const toolLabels = {
  explore: ['Organs', 'Organ library'],
  rebuild: ['Challenge', 'Rebuild'],
  xray: ['Layers', 'Body layers'],
  pose: ['Scan tools', 'Body Scan tools']
};
const organIds = organs.map(organ => organ.id);
const stationTitles = { explore: 'BODY ATLAS', rebuild: 'REBUILD', xray: 'BODY LAYERS', pose: 'FULL BODY SCAN' };
const scanMessages = {
  off: ['CAMERA OFF', 'Enable the camera, then step back until your head, hands, and feet are visible.'],
  loading: ['STARTING', 'Loading the full-body tracking model…'],
  framing: ['FRAME BODY', 'Face the camera with your head, hands, and feet in frame.'],
  tracked: ['BODY DETECTED', 'Lift an arm or foot. Point and make a fist to move an organ.'],
  unavailable: ['UNAVAILABLE', 'Body tracking could not start. Retry to reload the pose model.']
};
const studyLabels = {
  heart: [1, 43],
  lung_l: [1, -31],
  lung_r: [-1, -25],
  liver: [-1, 36],
  stomach: [1, 22],
  kidney_l: [1, 14],
  kidney_r: [-1, 12]
};
const traySpots = [[.81, .46], [.19, .35], [.19, .68]];
const heartLabelPositions = {
  'aortic-arch': [1, -26],
  'pulmonary-trunk': [1, 15],
  'superior-vena-cava': [-1, -22],
  'ascending-aorta': [-1, -18],
  'ventricular-wall': [1, 20],
  'right-atrium': [-1, -15],
  'left-atrium': [1, -25],
  'right-ventricle': [-1, 28],
  'left-ventricle': [1, 26]
};
const targetLetter = id => String.fromCharCode(65 + rebuildMission().ids.indexOf(id));
const bodyMission = new BodyMission();
const svg = id => '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>';

const state = {
  ready: false,
  mode: 'explore',
  layer: 'skeleton',
  scanLayer: 'mixed',
  scanStatus: 'off',
  framing: { explore: 'upper', xray: 'full', pose: 'full' },
  pan: false,
  selected: 'heart',
  labels: true,
  looking: false,
  pendingInspection: null,
  part: null,
  heartView: 'outside',
  mission: 'chest',
  challenge: newRound(rebuildMissions.chest)
};
let atlas;
let pc;
let pcLoading;
let inPc = false;
let redraw = true;
let drag = null;
let inspectionPointer = null;
let handOrbit = null;
let handHover = null;
let markerNodes = new Map();
let feedbackTimer;
let modelAttempt = 0;

function notify(message, tone = 'success', duration = 3200) {
  clearTimeout(feedbackTimer);
  const node = $('#viewerFeedback');
  node.textContent = message;
  node.dataset.tone = tone;
  if (message) feedbackTimer = setTimeout(() => { node.textContent = ''; }, duration);
}

function rebuildMission() {
  return rebuildMissions[state.mission];
}

function newRound(mission, now = null) {
  return { phase: now === null ? 'ready' : 'playing', placed: new Set(), seconds: mission.seconds,
    until: now === null ? 0 : now + mission.seconds * 1000 };
}

function setRebuildMission(id) {
  if (!Object.hasOwn(rebuildMissions, id) || state.mission === id) return;
  cancelDrag();
  tracking.resetHands();
  state.mission = id;
  state.challenge = newRound(rebuildMission());
  atlas?.resetOrgans();
  atlas?.setRebuildMission(rebuildMission());
  clearMarkers();
  renderChallengeTargets();
  select(rebuildMission().ids[0]);
  filterOrgans();
  syncChallenge();
  refreshHint();
  notify('');
}

function currentFraming() {
  return state.framing[state.mode] ?? 'full';
}

function refreshHint() {
  let message;
  if (drag) message = 'Move the ' + byId[drag.id].name.toLowerCase() + (drag.gesture === 'fist' ? ' and open your hand.' : ' and release.');
  else if (state.mode === 'rebuild') {
    message = state.challenge.phase === 'playing' ? 'Drop each organ on its matching target.' : 'Start the round to place organs.';
  } else if (state.pan) {
    message = tracking.state === 'live' ? 'Drag or pinch and move to pan.' : 'Drag to move the view.';
  } else if (state.mode === 'xray') {
    message = tracking.state === 'live' ? 'Hold up two fingers to change layers.' : 'Switch layers to compare body systems.';
  } else if (state.looking) {
    message = tracking.state === 'live' ? 'Pinch and move to rotate the organ.' : 'Drag to rotate. Select a structure to identify it.';
  } else if (state.mode === 'pose' && state.scanStatus !== 'tracked') {
    message = tracking.state !== 'live' ? 'Enable the camera to mirror your movements.'
      : currentFraming() === 'upper' ? 'Keep your head and shoulders in frame.' : 'Keep your head, hands, and feet in frame.';
  } else {
    message = tracking.state === 'live' ? 'Make a fist to grab. Spread thumb and index to zoom.' : 'Drag an organ to pull it out.';
  }
  $('#viewerHint').textContent = message;
}

function syncInspector() {
  const data = byId[state.selected];
  const organ = atlas?.organs.get(state.selected);
  $('#organSystem').textContent = data.system;
  $('#organName').textContent = data.name;
  $('#organDescription').textContent = data.description;
  $('#organIcon').setAttribute('href', '#i-' + data.icon);
  $('#organBadge').className = 'organ-badge' + (data.icon === 'lungs' ? ' is-lung' : data.icon === 'cube' ? ' is-other' : '');
  $('#inspectorLabel').textContent = state.looking ? 'Organ close-up' : 'Selected organ';
  $('#organActions').hidden = state.looking;
  $('#inspectDetails').hidden = !state.looking;
  $('#inspectBtn').disabled = !state.ready || Boolean(state.pendingInspection);
  $('#inspectBtn').innerHTML = svg('arrow') + (state.pendingInspection ? 'Loading close-up…' : 'Inspect in 3D');
  $('#extractBtn').disabled = !state.ready || !organ || organ.outside;
  $('#returnBtn').disabled = !state.ready || !organ?.outside;
}

function syncLibrary() {
  for (const button of document.querySelectorAll('[data-organ]')) {
    const id = button.dataset.organ;
    const placed = state.mode === 'rebuild' && state.challenge.placed.has(id);
    button.setAttribute('aria-pressed', String(state.selected === id));
    if (button.dataset.placed !== String(placed)) {
      button.dataset.placed = String(placed);
      button.querySelector('.organ-item-arrow').innerHTML = svg(placed ? 'check' : 'chevron');
    }
  }
}

function select(id) {
  if (!byId[id]) return;
  if (state.selected !== id && (state.looking || state.pendingInspection)) closeInspection();
  state.selected = id;
  atlas?.select(id);
  syncLibrary();
  syncInspector();
  if (state.mode === 'rebuild') syncTargetActions();
  redraw = true;
}

function setLabels(enabled) {
  state.labels = enabled;
  $('#labelsBtn').setAttribute('aria-pressed', String(enabled));
  redraw = true;
}

function syncViewTools() {
  const rebuild = state.mode === 'rebuild';
  $('#framingControl').hidden = rebuild || state.looking;
  $('#exitInspect').hidden = !state.looking;
  $('#poseHud').hidden = state.mode !== 'pose';
  $('#rebuildMissionPanel').hidden = !rebuild;
  $('#bodyMissionPanel').hidden = state.mode !== 'pose' || state.looking;
  if (state.mode === 'pose') syncBodyMission();
  const [label, title] = state.looking ? ['Structures', 'Organ close-up'] : toolLabels[state.mode];
  $('#atlasToolsLabel').textContent = label;
  $('#atlasDialogTitle').textContent = title;
  if (state.mode === 'pose' && !state.looking) {
    $('#viewerTitle').textContent = currentFraming() === 'upper' ? 'UPPER BODY SCAN' : stationTitles.pose;
  }
  for (const button of document.querySelectorAll('[data-framing]')) {
    button.setAttribute('aria-pressed', String(button.dataset.framing === currentFraming()));
  }
  const fit = state.looking ? 'Recenter view' : currentFraming() === 'upper' ? 'Fit upper body' : 'Fit whole body';
  $('#recenterBtn').setAttribute('aria-label', fit);
  $('#recenterBtn').title = fit;
  $('#panBtn').setAttribute('aria-pressed', String(state.pan));
  $('#viewer').dataset.pan = String(state.pan && !rebuild);
}

function setFraming(framing) {
  if (!['upper', 'full'].includes(framing) || state.mode === 'rebuild' || state.looking || currentFraming() === framing) return;
  cancelDrag();
  tracking.resetHands();
  state.framing[state.mode] = framing;
  if (state.mode === 'pose') {
    bodyMission.reset();
    atlas?.resetPose();
    tracking.setPoseFraming(framing);
    syncPoseStatus();
  }
  atlas?.setFraming(framing);
  syncViewTools();
  refreshHint();
  redraw = true;
}

function setPan(enabled) {
  if (state.mode === 'rebuild') return;
  cancelDrag();
  tracking.resetHands();
  state.pan = enabled;
  atlas?.setPan(enabled);
  syncViewTools();
  refreshHint();
}

function setStation(mode) {
  showAtlas();
  if (state.mode === mode) return;
  cancelDrag();
  tracking.resetHands();
  closeInspection();
  notify('');
  state.mode = mode;
  bodyMission.reset();
  const inPose = mode === 'pose';
  const rebuild = mode === 'rebuild';
  state.challenge = newRound(rebuildMission());
  if (inPose) tracking.setPoseFraming(currentFraming());
  tracking.setPoseEnabled(inPose);
  atlas?.resetOrgans();
  atlas?.setMode(mode, inPose ? state.scanLayer : state.layer, currentFraming());
  $('#workspace').dataset.mode = mode;
  $('#libraryCard').hidden = mode === 'xray';
  $('#organSearch').hidden = rebuild;
  $('#layerCard').hidden = mode !== 'xray';
  $('#inspectorCard').hidden = mode !== 'explore' && !inPose;
  $('#challengeCard').hidden = !rebuild;
  $('#xrayCard').hidden = mode !== 'xray';
  $('#scanCard').hidden = !inPose;
  $('#zoomTools').hidden = rebuild;
  $('#labelsBtn').hidden = rebuild;
  $('#viewerTitle').textContent = stationTitles[mode];
  const keyboardHint = rebuild
    ? 'Interactive anatomy model. Use the organ library and placement buttons to place each organ.'
    : 'Interactive anatomy model. Use the arrow keys to rotate or turn on Pan to move the view.';
  $('#stageDescription').textContent = keyboardHint;
  syncStations();
  const choices = rebuildMission().ids;
  select(!rebuild || choices.includes(state.selected) ? state.selected : choices[0]);
  if (mode === 'xray') selectLayer(state.layer);
  if (inPose) syncPoseStatus();
  syncViewTools();
  syncCameraControls(tracking.state);
  filterOrgans();
  syncChallenge();
  markBody();
  refreshHint();
}

function syncStations() {
  for (const button of document.querySelectorAll('.station-button[data-mode]')) {
    button.setAttribute('aria-pressed', String(!inPc && button.dataset.mode === state.mode));
  }
  $('#openPc').setAttribute('aria-pressed', String(inPc));
}

function showAtlas() {
  if (!inPc) return;
  tracking.resetHands();
  pc?.hide();
  inPc = false;
  pcBench.hidden = true;
  $('#workspace').hidden = false;
  $('#viewer').append(cursor, cameraCard);
  syncStations();
  if (state.mode === 'pose') {
    tracking.setPoseFraming(currentFraming());
    tracking.setPoseEnabled(true);
  }
  syncCameraControls(tracking.state);
  redraw = true;
}

async function loadPc() {
  if (pc) {
    pc.show();
    return;
  }
  if (!pcLoading) {
    const loading = $('#pcLoading');
    loading.hidden = false;
    $('#pcLoadingSpinner').hidden = false;
    $('#pcLoadingText').textContent = 'กำลังจัดโต๊ะ…';
    $('#retryPc').hidden = true;
    pcLoading = import('./pc-workshop.js').then(({ PcWorkshop }) => {
      pc = new PcWorkshop(pcBench);
      loading.hidden = true;
    }).catch(error => {
      console.warn('PC Assembly:', error);
      $('#pcStage > canvas')?.remove();
      $('#pcLoadingSpinner').hidden = true;
      $('#pcLoadingText').textContent = 'โหลดโมเดลคอมพิวเตอร์ไม่สำเร็จ';
      $('#retryPc').hidden = false;
    }).finally(() => { pcLoading = null; });
  }
  await pcLoading;
  if (inPc) pc?.show();
}

function showPc() {
  if (!inPc) {
    if (atlasTools.open) atlasTools.close();
    tracking.resetHands();
    cancelDrag();
    tracking.setPoseEnabled(false);
    inPc = true;
    pcBench.hidden = false;
    $('#workspace').hidden = true;
    $('#pcStage').append(cursor, cameraCard);
    syncStations();
    syncCameraControls(tracking.state);
  }
  loadPc();
}

function selectScanLayer(id) {
  if (!poseLayers.some(layer => layer.id === id)) return;
  state.scanLayer = id;
  if (state.mode === 'pose') atlas?.applyLayer(id);
  for (const button of document.querySelectorAll('[data-pose-layer]')) {
    button.setAttribute('aria-pressed', String(button.dataset.poseLayer === id));
  }
  redraw = true;
}

function syncPoseStatus() {
  const status = state.scanStatus;
  const upper = currentFraming() === 'upper';
  const [title, detail] = scanMessages[status];
  const upperHelp = {
    off: 'Enable the camera and bring your head and shoulders into frame.',
    framing: 'Face the camera. Keep the hand you want to use in view.',
    tracked: 'Raise an arm to move the atlas. Point and make a fist to grab an organ.'
  };
  $('#scanTitle').textContent = upper ? 'Upper-body tracking' : 'Full-body tracking';
  $('#poseBadge').textContent = title;
  $('#poseHud').textContent = title;
  $('#poseBadge').dataset.state = status === 'tracked' ? 'live' : status === 'loading' ? 'loading' : 'off';
  $('#poseInstructions').textContent = upper ? upperHelp[status] ?? detail : detail;
  $('#retryPose').hidden = status !== 'unavailable';
}

function syncBodyMission() {
  const mission = bodyMissions[state.framing.pose];
  const { phase, score, progress } = bodyMission;
  const live = state.scanStatus === 'tracked';
  $('#bodyMissionScore').textContent = score + '/' + mission.steps.length;
  const prompt = phase === 'won' ? 'ครบทุกท่าแล้ว!'
    : phase === 'ready' ? mission.name + ' · ทำแต่ละท่าค้างไว้จนแถบเต็ม'
      : !live ? state.scanStatus === 'unavailable' ? 'กด Scan tools เพื่อลองเปิดตัวตรวจจับร่างกายอีกครั้ง'
        : state.framing.pose === 'upper' ? 'เปิดกล้องและให้เห็นไหล่กับมือทั้งสองข้าง'
          : 'เปิดกล้องและถอยให้เห็นทั้งตัว'
        : mission.steps[score].label;
  const promptNode = $('#bodyMissionPrompt');
  if (promptNode.textContent !== prompt) promptNode.textContent = prompt;
  const hold = $('#bodyMissionHold');
  hold.hidden = phase !== 'playing';
  hold.value = Math.round(progress * 100);
  const start = $('#startBodyMission');
  start.disabled = !state.ready;
  start.textContent = phase === 'won' ? 'เล่นอีกครั้ง'
    : phase === 'playing' ? 'เริ่มใหม่' : 'เริ่มภารกิจ';
}

function startBodyMission() {
  if (!state.ready || state.mode !== 'pose' || state.looking) return;
  bodyMission.reset(bodyMissions[currentFraming()].steps);
  syncBodyMission();
  if (tracking.state === 'off') tracking.start();
}

function poseStatus(status, world, time) {
  if (state.scanStatus !== status) {
    state.scanStatus = status;
    syncPoseStatus();
    refreshHint();
  }
  if (state.mode !== 'pose' || !state.ready) return;
  if (status === 'tracked' && !state.looking && !inPc) bodyMission.sample(world, time);
  else bodyMission.pause();
  syncBodyMission();
  if (status === 'tracked') {
    atlas.applyPose(world, time);
    if (!state.looking) redraw = true;
  } else if (status === 'off') {
    atlas.resetPose();
    redraw = true;
  }
}

function selectLayer(id) {
  const index = layers.findIndex(layer => layer.id === id);
  if (index < 0) return;
  state.layer = id;
  atlas?.applyLayer(id);
  for (const button of document.querySelectorAll('[data-layer]')) {
    button.setAttribute('aria-pressed', String(button.dataset.layer === id));
  }
  $('#layerName').textContent = layers[index].name;
  $('#layerDescription').textContent = layers[index].description;
  $('#layerPill').textContent = 'Layer ' + (index + 1) + ' / ' + layers.length;
  redraw = true;
}

function cycleLayer() {
  const current = layers.findIndex(layer => layer.id === state.layer);
  selectLayer(layers[(current + 1) % layers.length].id);
  notify(layers.find(layer => layer.id === state.layer).name + ' layer');
}

async function inspect() {
  if (!state.ready || state.pendingInspection || state.looking) return;
  const id = state.selected;
  const request = { id };
  state.pendingInspection = request;
  syncInspector();
  try {
    const detail = await atlas.prepareDetail(id);
    if (inPc || state.pendingInspection !== request || !['explore', 'pose'].includes(state.mode)) return;
    cancelDrag();
    tracking.resetHands();
    state.looking = true;
    state.part = null;
    state.heartView = 'outside';
    atlas.openDetail(detail);
    $('#viewerTitle').textContent = byId[id].name.toUpperCase();
    $('#stageDescription').textContent = 'Organ close-up. Use the arrow keys to rotate, or select a labeled structure.';
    $('#heartTabs').hidden = id !== 'heart';
    markDetail();
    updatePart(null);
    syncViewTools();
    refreshHint();
    if (document.activeElement === $('#openAtlasTools') || document.activeElement === document.body) $('#exitInspect').focus({ preventScroll: true });
  } catch (error) {
    if (state.pendingInspection === request) notify('The organ close-up could not load. Try again.', 'miss');
    console.warn('BioAre organ detail:', error);
  } finally {
    if (state.pendingInspection === request) {
      state.pendingInspection = null;
      syncInspector();
    }
  }
}

function closeInspection() {
  state.pendingInspection = null;
  if (!state.looking) return;
  state.looking = false;
  state.part = null;
  handOrbit = null;
  atlas.closeDetail();
  $('#viewerTitle').textContent = stationTitles[state.mode];
  $('#stageDescription').textContent = 'Interactive anatomy model. Use the arrow keys to rotate, or select an organ from the library.';
  markBody();
  syncInspector();
  syncViewTools();
  refreshHint();
}

function activeParts() {
  return state.selected === 'heart' ? heartViews[state.heartView] : Array.from(atlas.detail.entries.keys());
}

function changeHeartView(view) {
  if (!state.looking || state.selected !== 'heart' || state.heartView === view) return;
  state.heartView = view;
  updatePart(null);
}

function updatePart(id) {
  if (!state.looking) return;
  state.part = id;
  atlas.updateDetail(state.heartView, id);
  for (const button of document.querySelectorAll('[data-heart-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.heartView === state.heartView));
  }
  const list = $('#structureList');
  const ids = activeParts();
  if (list.dataset.parts !== ids.join(',')) {
    list.dataset.parts = ids.join(',');
    list.replaceChildren();
    for (const key of ids) {
      const data = atlas.detail.entries.get(key).data;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.part = key;
      button.className = 'structure';
      const dot = document.createElement('i');
      dot.style.setProperty('--structure-color', data.color);
      button.append(dot, document.createTextNode(data.name));
      button.addEventListener('click', () => updatePart(key));
      list.append(button);
    }
  }
  for (const button of list.children) button.setAttribute('aria-pressed', String(button.dataset.part === id));
  const data = id ? atlas.detail.entries.get(id)?.data : null;
  $('#detailNote').textContent = data?.description ?? (
    state.selected === 'heart' && state.heartView === 'inside' ? 'The colored ventricular surfaces show the spaces where blood collects.'
      : state.selected === 'heart' ? 'Select a vessel to trace where blood flows.'
      : state.selected.startsWith('lung_') ? 'Select the lung or an airway to follow the path of air.' : 'Rotate and zoom to examine the organ.'
  );
  redraw = true;
}

function markLabel(id, name) {
  const label = document.createElement('span');
  label.textContent = name;
  label.className = 'marker-label';
  const pin = document.createElement('span');
  pin.className = 'marker-pin';
  const line = document.createElement('span');
  line.className = 'marker-line';
  const group = document.createElement('div');
  group.dataset.label = id;
  group.append(line, pin, label);
  markerNodes.set(id, { group, label, pin, line });
  markerLayer.append(group);
}

function clearMarkers() {
  markerLayer.replaceChildren();
  markerNodes = new Map();
  redraw = true;
}

function markBody() {
  clearMarkers();
  if (state.mode !== 'rebuild') {
    for (const organ of organs) markLabel(organ.id, organ.name);
  }
}

function markDetail() {
  clearMarkers();
  for (const [id, entry] of atlas.detail.entries) markLabel(id, entry.data.name);
}

function markTargets() {
  clearMarkers();
  for (const id of rebuildMission().ids) {
    const target = document.createElement('span');
    target.className = 'marker-target';
    target.dataset.target = targetLetter(id);
    target.textContent = targetLetter(id);
    markerNodes.set(id, { target });
    markerLayer.append(target);
  }
}

function setMarker(node, point, offset, selected) {
  node.group.hidden = !point.visible || point.x < 14 || point.x > stage.clientWidth - 14
    || point.y < 67 || point.y > stage.clientHeight - 62;
  if (node.group.hidden) return;
  const dx = Math.min(69, Math.max(38, stage.clientWidth * .108));
  const side = point.x < 112 ? 1 : point.x > stage.clientWidth - 112 ? -1 : offset[0];
  const labelY = Math.max(72, Math.min(stage.clientHeight - 64, point.y + offset[1]));
  const labelX = point.x + dx * side;
  const rise = labelY - point.y;
  const run = labelX - point.x;
  node.label.classList.toggle('is-left', side < 0);
  node.label.classList.toggle('is-selected', selected);
  node.label.style.left = labelX + 'px';
  node.label.style.top = labelY + 'px';
  node.pin.style.left = node.line.style.left = point.x + 'px';
  node.pin.style.top = node.line.style.top = point.y + 'px';
  node.line.style.width = Math.hypot(run, rise) + 'px';
  node.line.style.transform = 'rotate(' + Math.atan2(rise, run) + 'rad)';
}

function moveMarkers() {
  const angle = atlas.viewAngle();
  const absolute = Math.abs(angle);
  const front = absolute < .26;
  const view = front ? 'Anterior view' : absolute > 2.84 ? 'Posterior view'
    : absolute > 1.23 && absolute < 1.91 ? (angle > 0 ? 'Left lateral view' : 'Right lateral view') : 'Oblique view';
  $('#viewCaption').textContent = state.mode === 'pose' && !state.looking ? 'Mirror view' : view;
  $('#orientation').hidden = !front || state.looking || state.mode === 'pose';
  if (state.mode === 'rebuild') {
    const hovered = drag ? dropTarget(drag) : null;
    for (const [id, { target }] of markerNodes) {
      const home = atlas.project(atlas.organs.get(id).home);
      const placed = state.challenge.placed.has(id);
      target.hidden = !home.visible;
      target.style.left = home.x + 'px';
      target.style.top = home.y + 'px';
      target.classList.toggle('is-hover', hovered === id);
      target.classList.toggle('is-done', placed);
      if ((target.dataset.done === 'true') !== placed) {
        target.dataset.done = String(placed);
        target.innerHTML = placed ? svg('check') : targetLetter(id);
      }
    }
    return;
  }
  const chest = stage.clientWidth < 420;
  const showBody = state.mode !== 'xray' || state.layer === 'organs';
  for (const [id, node] of markerNodes) {
    if (state.looking) {
      const entry = atlas.detail.entries.get(id);
      const detailId = atlas.detail.id;
      const isHeart = detailId === 'heart';
      const defaults = state.heartView === 'inside' ? heartViews.inside : ['aortic-arch', 'pulmonary-trunk', 'superior-vena-cava'];
      const show = entry.mesh.visible && (id === state.part || (!state.part && (
        isHeart ? defaults.includes(id) : id === detailId || id === 'trachea'
      )));
      if (!state.labels || !show) { node.group.hidden = true; continue; }
      const offset = isHeart ? heartLabelPositions[id] ?? [1, 12] : id === 'trachea' ? [-1, -17] : [1, 18];
      setMarker(node, atlas.project(atlas.partCenter(id)), offset, id === state.part);
    } else {
      const entry = atlas.organs.get(id);
      const show = showBody && entry.pivot.visible && (chestIds.includes(id) || id === state.selected);
      if (!state.labels || !show || (chest && state.mode === 'xray' && id !== state.selected)) { node.group.hidden = true; continue; }
      const point = atlas.projectOrgan(id);
      const label = studyLabels[id];
      const side = label ? label[0] * (state.mode === 'pose' ? -1 : 1) : point.x < stage.clientWidth / 2 ? -1 : 1;
      setMarker(node, point, [side, label?.[1] ?? -14], id === state.selected);
    }
  }
}

function syncTimer() {
  const { seconds } = state.challenge;
  const minutes = Math.floor(seconds / 60);
  const text = minutes + ':' + String(seconds % 60).padStart(2, '0');
  $('#timeLeft').textContent = text;
  $('#timeLeft').classList.toggle('is-urgent', seconds <= 15);
  $('#challengeBar').style.width = seconds / rebuildMission().seconds * 100 + '%';
  const { phase, placed } = state.challenge;
  const hud = $('#roundHud');
  hud.hidden = state.mode !== 'rebuild' || phase === 'ready';
  hud.textContent = (phase === 'won' ? 'ครบ · ' : text + ' · ') + placed.size + '/' + rebuildMission().ids.length;
}

function syncTargetActions() {
  const id = state.selected;
  $('#placeAt').textContent = 'Place ' + byId[id].name.toLowerCase() + ' at';
  for (const button of document.querySelectorAll('[data-place]')) {
    button.disabled = state.challenge.placed.has(id) || state.challenge.placed.has(button.dataset.place);
  }
}

function syncChallenge() {
  const { phase, placed } = state.challenge;
  const { name, ids } = rebuildMission();
  $('#challengePoints').innerHTML = placed.size + '<span>/' + ids.length + '</span>';
  const quickStart = $('#rebuildQuickStart');
  quickStart.disabled = $('#challengeStart').disabled = !state.ready;
  quickStart.textContent = phase === 'playing' ? 'เริ่มใหม่'
    : phase === 'won' || phase === 'expired' ? 'เล่นอีกครั้ง' : 'เริ่มเกม';
  $('#challengeAction').textContent = phase === 'playing' ? 'Restart round'
    : phase === 'won' || phase === 'expired' ? 'Play again' : 'Start round';
  $('#challengeTitle').textContent = phase === 'won' ? 'ประกอบครบแล้ว' : phase === 'expired' ? 'หมดเวลา' : name;
  $('#challengeDescription').textContent = phase === 'won'
    ? name + ' · วางอวัยวะถูกตำแหน่งครบทุกชิ้น'
    : phase === 'expired' ? 'วางถูก ' + placed.size + ' จาก ' + ids.length + ' ชิ้น'
      : 'วางอวัยวะที่จุด A, B หรือ C ให้ถูกตำแหน่ง ได้ 1 คะแนนต่อชิ้น';
  $('#keyboardPlacement').hidden = phase !== 'playing';
  for (const item of $('#placementList').children) {
    const hasPlaced = placed.has(item.dataset.id);
    item.dataset.placed = String(hasPlaced);
    item.querySelector('small').textContent = hasPlaced ? 'Placed' : 'To place';
  }
  syncLibrary();
  syncTargetActions();
  syncTimer();
}

function positionTray(id) {
  const position = atlas.stagePosition(...traySpots[rebuildMission().ids.indexOf(id)], .095);
  if (!position) return;
  const organ = atlas.organs.get(id);
  organ.pivot.position.copy(position);
  organ.outside = true;
  redraw = true;
}

function startRound() {
  if (state.mode !== 'rebuild' || !state.ready) return;
  cancelDrag();
  tracking.resetHands();
  atlas.recenter();
  const mission = rebuildMission();
  state.challenge = newRound(mission, performance.now());
  for (const id of mission.ids) positionTray(id);
  markTargets();
  select(mission.ids[0]);
  syncChallenge();
  refreshHint();
  notify('');
}

function completeRound(phase) {
  cancelDrag();
  state.challenge.phase = phase;
  if (phase === 'expired') state.challenge.seconds = 0;
  syncChallenge();
  refreshHint();
  notify(phase === 'won' ? 'ประกอบครบแล้ว · ' + rebuildMission().ids.length + ' คะแนน' : 'Round ended. Start again to keep practising.', phase === 'won' ? 'success' : 'miss', 4200);
}

function tickTimer(now) {
  if (state.mode !== 'rebuild' || state.challenge.phase !== 'playing') return;
  const remaining = Math.max(0, Math.ceil((state.challenge.until - now) / 1000));
  if (remaining !== state.challenge.seconds) {
    state.challenge.seconds = remaining;
    syncTimer();
  }
  if (remaining === 0) completeRound('expired');
}

function placeOrgan(id, target) {
  tickTimer(performance.now());
  if (state.challenge.phase !== 'playing' || state.challenge.placed.has(id)) return;
  if (id !== target || state.challenge.placed.has(target)) {
    positionTray(id);
    notify(target ? byId[id].name + ' does not fit target ' + targetLetter(target) + '. Try another.' : 'Drop the organ over one of the lettered targets.', 'miss');
    return;
  }
  atlas.returnOrg(id);
  state.challenge.placed.add(id);
  const remaining = rebuildMission().ids.find(key => !state.challenge.placed.has(key));
  if (remaining) {
    select(remaining);
    syncChallenge();
    notify(byId[id].name + ' placed · +1 point');
  } else {
    completeRound('won');
  }
  redraw = true;
}

function pickChoices() {
  if (state.mode === 'xray' || !state.ready) return [];
  if (state.mode === 'rebuild') {
    return state.challenge.phase === 'playing' ? rebuildMission().ids.filter(id => !state.challenge.placed.has(id)) : [];
  }
  return organIds;
}

function beginDrag(x, y, source, gesture) {
  if (drag || state.looking) return false;
  const ids = pickChoices();
  if (!ids.length) return false;
  const hit = atlas.pick(x, y, ids);
  if (!hit) return false;
  select(hit.key);
  drag = { id: hit.key, source, gesture, info: atlas.startDrag(hit.key, hit.point), x, y, startX: x, startY: y, moved: false };
  atlas.controls.enabled = false;
  refreshHint();
  return true;
}

function moveDrag(x, y, depth = 0) {
  if (!drag) return;
  drag.x = x;
  drag.y = y;
  const freeDepth = drag.gesture === 'fist' && state.mode !== 'rebuild' ? depth : 0;
  drag.moved ||= Math.hypot(x - drag.startX, y - drag.startY) > 5 || Math.abs(freeDepth) > .086;
  if (drag.moved) atlas.dragTo(drag.info, x, y, freeDepth);
  redraw = true;
}

function dropTarget(current) {
  const cursorPoint = stage.getBoundingClientRect();
  const point = atlas.projectOrgan(current.id);
  const threshold = Math.max(23, stage.clientHeight * .056);
  let chosen = null;
  let best = threshold;
  for (const id of rebuildMission().ids) {
    if (state.challenge.placed.has(id)) continue;
    const target = atlas.project(atlas.organs.get(id).home);
    if (!target.visible) continue;
    const centerDistance = Math.hypot(point.x - target.x, point.y - target.y);
    const pointerDistance = Math.hypot(current.x - cursorPoint.left - target.x, current.y - cursorPoint.top - target.y);
    const distance = Math.min(centerDistance, pointerDistance + 11);
    if (distance < best) {
      chosen = id;
      best = distance;
    }
  }
  return chosen;
}

function finishDrag() {
  if (!drag) return;
  const finished = drag;
  drag = null;
  atlas.controls.enabled = true;
  if (finished.moved) {
    const { id, info } = finished;
    if (state.mode === 'rebuild') {
      placeOrgan(id, dropTarget(finished));
    } else if (state.mode === 'explore' && finished.gesture !== 'fist' && info.organ.pivot.position.distanceTo(info.organ.home) < .067) {
      atlas.returnOrg(id);
      notify(byId[id].name + ' returned to the body');
    } else {
      info.organ.outside = true;
      notify(byId[id].name + ' placed in the scene');
    }
  } else {
    atlas.restoreDrag(finished.id, finished.info);
  }
  syncInspector();
  refreshHint();
  redraw = true;
}

function cancelDrag() {
  if (!drag) return;
  const cancelled = drag;
  drag = null;
  if (cancelled.source === 'mouse' && atlas.canvas.hasPointerCapture(cancelled.pointerId)) {
    atlas.canvas.releasePointerCapture(cancelled.pointerId);
  }
  atlas.restoreDrag(cancelled.id, cancelled.info);
  atlas.controls.enabled = true;
  refreshHint();
  redraw = true;
}

function fromHand(point) {
  const rect = stage.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

function syncCameraControls(status) {
  const scanning = !inPc && state.mode === 'pose';
  $('#cameraBtnText').textContent = status === 'live' ? 'Stop camera' : status === 'loading' ? 'Cancel setup' : 'Enable camera';
  $('#inputText').textContent = status === 'live' ? (scanning ? 'Body and hand tracking' : 'Hand tracking') : 'Mouse and touch controls';
}

function trackingStatus(status, message, error) {
  const live = status === 'live';
  const loading = status === 'loading';
  cameraCard.dataset.cameraState = status;
  $('#cameraState').dataset.state = status;
  $('#cameraState').textContent = live ? 'LIVE' : loading ? 'STARTING' : 'OFF';
  $('#cameraIcon').setAttribute('href', live || loading ? '#i-stop' : '#i-camera');
  $('#cameraNote').textContent = error || loading ? message : '';
  $('#cameraNote').dataset.tone = error ? 'error' : '';
  $('#cameraPlaceholder').hidden = !$('#webcam').hidden;
  $('#cameraPlaceholderText').textContent = loading ? 'Connecting camera…' : 'Camera preview';
  syncCameraControls(status);
  refreshHint();
}

function gestureIndicator(kind) {
  const label = { fist: 'Fist grab', pinch: 'Pinch grab', spread: 'Finger zoom', 'two-hands': 'Two-hand zoom' }[kind];
  const indicator = $('#gestureIndicator');
  indicator.hidden = !label;
  if (label && indicator.textContent !== label) indicator.textContent = label;
}

const tracking = new WebcamTracking($('#webcam'), $('#handOverlay'), {
  onStatus: trackingStatus,
  onPose: poseStatus,
  onGesture: gestureIndicator,
  canZoom: () => !dialogOpen() && (inPc
    ? pc?.ready && !pc.pointer && !pc.sequence
    : state.ready && state.mode !== 'rebuild' && drag?.source !== 'mouse'),
  onZoom: factor => inPc ? pc?.zoom(factor) : atlas.zoom(factor),
  onLost: () => {
    cursor.hidden = true;
    gestureIndicator(null);
    handOrbit = handHover = null;
    if (inPc) pc?.handEnd(false);
    if (drag?.source === 'hand') cancelDrag();
  },
  onPointer: (point, kind) => {
    const aiming = kind === 'aim';
    cursor.hidden = !(inPc ? pc?.ready : state.ready) || dialogOpen();
    cursor.style.left = point.x * 100 + '%';
    cursor.style.top = point.y * 100 + '%';
    cursor.classList.toggle('is-pinched', kind === 'pinch');
    cursor.classList.toggle('is-fist', kind === 'fist');
    if (inPc) {
      cursor.classList.toggle('is-hover', Boolean(aiming && !cursor.hidden && pc.handHit(point)));
      return;
    }
    gestureIndicator(cursor.hidden ? null : kind);
    if (aiming && !cursor.hidden) {
      const { x, y } = fromHand(point);
      const ids = pickChoices();
      const hit = !drag && (state.looking || ids.length) && atlas.pick(x, y, ids);
      cursor.classList.toggle('is-hover', Boolean(hit));
      if (hit && ['explore', 'pose'].includes(state.mode) && !state.looking) {
        const now = performance.now();
        if (handHover?.id !== hit.key) handHover = { id: hit.key, since: now };
        else if (now - handHover.since > 350 && state.selected !== hit.key) select(hit.key);
      } else {
        handHover = null;
      }
    } else {
      handHover = null;
    }
  },
  onGrab: (point, kind) => {
    if (dialogOpen()) return;
    if (inPc) {
      pc?.handGrab(point, kind);
      return;
    }
    if (!state.ready || drag) return;
    if (state.pan && kind === 'pinch' && state.mode !== 'rebuild') {
      handOrbit = point;
      return;
    }
    const { x, y } = fromHand(point);
    if (state.looking) {
      const hit = atlas.pick(x, y, []);
      if (hit && atlas.detail.entries.has(hit.key)) updatePart(hit.key);
    }
    if (beginDrag(x, y, 'hand', kind)) return;
    if (kind === 'pinch' && state.mode !== 'rebuild') handOrbit = point;
    else if (kind === 'fist' && !state.looking && ['explore', 'pose'].includes(state.mode)) notify('Point at an organ before making a fist.', 'miss');
  },
  onMove: (point, _kind, depth) => {
    if (dialogOpen()) return;
    if (inPc) {
      pc?.handMove(point);
      return;
    }
    if (drag?.source === 'hand') {
      const { x, y } = fromHand(point);
      moveDrag(x, y, depth);
    } else if (handOrbit && !drag) {
      const dx = point.x - handOrbit.x;
      const dy = point.y - handOrbit.y;
      if (state.pan) atlas.panView(dx, dy);
      else atlas.moveView(dx, dy);
      handOrbit = point;
    }
  },
  onRelease: () => {
    if (inPc) pc?.handEnd(true);
    if (drag?.source === 'hand') finishDrag();
    handOrbit = null;
  },
  onLabels: () => {
    if (dialogOpen()) return;
    if (inPc || !state.ready) return;
    if (state.mode === 'xray') cycleLayer();
    if (state.mode === 'explore' || state.mode === 'pose') {
      setLabels(!state.labels);
      notify(state.labels ? 'Labels visible' : 'Labels hidden');
    }
  }
});

function bindCanvas() {
  const canvas = atlas.canvas;
  canvas.addEventListener('pointerdown', event => {
    if (!state.ready || event.button !== 0 || !event.isPrimary) return;
    if (state.mode !== 'rebuild' && (state.pan || event.shiftKey || event.ctrlKey || event.metaKey)) return;
    if (state.looking) inspectionPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (beginDrag(event.clientX, event.clientY, 'mouse')) {
      drag.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (drag?.source !== 'mouse' || event.pointerId !== drag.pointerId) return;
    moveDrag(event.clientX, event.clientY);
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  canvas.addEventListener('pointerup', event => {
    if (drag?.source === 'mouse' && event.pointerId === drag.pointerId) {
      moveDrag(event.clientX, event.clientY);
      finishDrag();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      event.stopImmediatePropagation();
    } else if (state.looking && inspectionPointer?.id === event.pointerId
        && Math.hypot(event.clientX - inspectionPointer.x, event.clientY - inspectionPointer.y) <= 6) {
      const hit = atlas.pick(event.clientX, event.clientY, []);
      if (hit && atlas.detail.entries.has(hit.key)) updatePart(hit.key);
    }
    inspectionPointer = null;
  }, true);
  const abortPointer = event => {
    if (drag?.source === 'mouse' && drag.pointerId === event.pointerId) cancelDrag();
    inspectionPointer = null;
  };
  canvas.addEventListener('pointercancel', abortPointer);
  canvas.addEventListener('lostpointercapture', abortPointer);
  canvas.addEventListener('keydown', event => {
    if (!state.ready || state.mode === 'rebuild') return;
    const movement = { ArrowLeft: [-.03, 0], ArrowRight: [.03, 0], ArrowUp: [0, -.036], ArrowDown: [0, .036] }[event.key];
    if (!movement) return;
    event.preventDefault();
    if (state.pan || event.shiftKey) atlas.panView(...movement);
    else atlas.moveView(...movement);
  });
}

function reset() {
  if (!state.ready) return;
  cancelDrag();
  tracking.resetHands();
  atlas.recenter();
  if (state.mode === 'rebuild') {
    state.challenge = newRound(rebuildMission());
    atlas.resetOrgans();
    syncChallenge();
    clearMarkers();
  } else if (!state.looking) {
    atlas.resetOrgans();
    syncInspector();
  }
  refreshHint();
  notify(state.looking ? 'View recentered' : 'Model reset');
  redraw = true;
}

function filterOrgans() {
  const rebuild = state.mode === 'rebuild';
  const query = rebuild ? '' : $('#organSearch').value.trim().toLowerCase();
  let matches = 0;
  for (const button of $('#organList').children) {
    const organ = byId[button.dataset.organ];
    const available = !rebuild || rebuildMission().ids.includes(organ.id);
    button.hidden = !available || !(organ.name + ' ' + organ.system).toLowerCase().includes(query);
    if (!button.hidden) matches++;
  }
  $('#atlasCount').textContent = String(matches);
  $('#atlasCount').title = matches + ' organ structures';
  $('#organSearchEmpty').hidden = matches > 0;
}

function renderPanels() {
  for (const data of organs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'organ-item';
    button.dataset.organ = data.id;
    const icon = document.createElement('span');
    icon.className = 'organ-item-icon' + (data.icon === 'lungs' ? ' is-lung' : data.icon === 'cube' ? ' is-other' : '');
    icon.innerHTML = svg(data.icon);
    const text = document.createElement('span');
    const name = document.createElement('b');
    const system = document.createElement('small');
    name.textContent = data.name;
    system.textContent = data.system;
    text.append(name, system);
    const arrow = document.createElement('span');
    arrow.className = 'organ-item-arrow';
    button.append(icon, text, arrow);
    button.addEventListener('click', () => select(data.id));
    $('#organList').append(button);
  }
  for (const layer of layers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer-button';
    button.dataset.layer = layer.id;
    button.textContent = layer.name;
    button.addEventListener('click', () => selectLayer(layer.id));
    $('#layerList').append(button);
  }
  for (const { id, name } of poseLayers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.poseLayer = id;
    button.textContent = name;
    button.addEventListener('click', () => selectScanLayer(id));
    $('#scanLayers').append(button);
  }
  for (const [id, mission] of Object.entries(rebuildMissions)) {
    $('#rebuildMission').add(new Option(mission.name, id));
  }
  renderChallengeTargets();
  markerLayer.setAttribute('aria-hidden', 'true');
}

function renderChallengeTargets() {
  const list = $('#placementList');
  const actions = $('.target-actions');
  list.replaceChildren();
  actions.replaceChildren();
  for (const id of rebuildMission().ids) {
    const row = document.createElement('li');
    row.dataset.id = id;
    const name = document.createElement('span');
    name.textContent = byId[id].name;
    row.append(name, document.createElement('small'));
    list.append(row);
  }
  for (const id of rebuildMission().ids) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-secondary';
    button.dataset.place = id;
    button.textContent = targetLetter(id);
    button.setAttribute('aria-label', 'Place at target ' + targetLetter(id));
    button.addEventListener('click', () => {
      cancelDrag();
      placeOrgan(state.selected, id);
    });
    actions.append(button);
  }
}

function dialogOpen() {
  return [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
}

function openDialog(id) {
  cancelDrag();
  tracking.resetHands();
  $(id).showModal();
}

function bindUI() {
  for (const button of document.querySelectorAll('.station-button[data-mode]')) button.addEventListener('click', () => setStation(button.dataset.mode));
  for (const button of document.querySelectorAll('[data-heart-view]')) button.addEventListener('click', () => changeHeartView(button.dataset.heartView));
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
  $('#openPc').addEventListener('click', showPc);
  $('#openPc').disabled = false;
  $('#retryPc').addEventListener('click', loadPc);
  $('#openAtlasTools').addEventListener('click', () => openDialog('#atlasToolsDialog'));
  $('#inspectBtn').addEventListener('click', () => {
    atlasTools.close();
    inspect();
  });
  $('#exitInspect').addEventListener('click', () => {
    closeInspection();
    $('#openAtlasTools').focus({ preventScroll: true });
  });
  $('#backToBody').addEventListener('click', () => {
    closeInspection();
    atlasTools.close();
  });
  $('#extractBtn').addEventListener('click', () => {
    atlas.pullOut(state.selected);
    atlasTools.close();
    syncInspector();
    redraw = true;
  });
  $('#returnBtn').addEventListener('click', () => {
    atlas.returnOrg(state.selected);
    atlasTools.close();
    syncInspector();
    redraw = true;
  });
  $('#cameraBtn').addEventListener('click', () => tracking.state === 'off' ? tracking.start() : tracking.stop());
  $('#rebuildMission').addEventListener('change', event => setRebuildMission(event.target.value));
  $('#rebuildQuickStart').addEventListener('click', startRound);
  $('#startBodyMission').addEventListener('click', startBodyMission);
  $('#challengeStart').addEventListener('click', () => {
    atlasTools.close();
    startRound();
  });
  $('#organSearch').addEventListener('input', filterOrgans);
  for (const button of document.querySelectorAll('[data-framing]')) button.addEventListener('click', () => setFraming(button.dataset.framing));
  $('#panBtn').addEventListener('click', () => setPan(!state.pan));
  $('#retryPose').addEventListener('click', () => tracking.startPose());
  $('#labelsBtn').addEventListener('click', () => setLabels(!state.labels));
  $('#resetBtn').addEventListener('click', reset);
  $('#recenterBtn').addEventListener('click', () => { if (state.ready) atlas.recenter(); });
  $('#zoomIn').addEventListener('click', () => { if (state.ready) atlas.zoom(.85); });
  $('#zoomOut').addEventListener('click', () => { if (state.ready) atlas.zoom(1.18); });
  $('#openGuide').addEventListener('click', () => openDialog('#guideDialog'));
  $('#openCredits').addEventListener('click', () => openDialog('#creditsDialog'));
  $('#retryModel').addEventListener('click', loadModel);
  const fullScreen = $('#fullScreenBtn');
  const syncFullScreen = () => {
    const active = Boolean(document.fullscreenElement) || document.body.classList.contains('model-only');
    const label = active ? 'Exit full screen' : 'Enter full screen';
    fullScreen.setAttribute('aria-label', label);
    fullScreen.title = label;
    $('#fullScreenIcon').setAttribute('href', active ? '#i-contract' : '#i-expand');
  };
  fullScreen.hidden = false;
  fullScreen.addEventListener('click', async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.body.classList.contains('model-only')) {
      document.body.classList.remove('model-only');
    } else if (document.fullscreenEnabled) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        document.body.classList.add('model-only');
      }
    } else {
      document.body.classList.add('model-only');
    }
    syncFullScreen();
  });
  document.addEventListener('fullscreenchange', syncFullScreen);
  document.addEventListener('keydown', event => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || dialogOpen() || event.target.matches?.('input, textarea, [contenteditable]')) return;
    if (event.key === 'Escape' && document.body.classList.contains('model-only')) {
      document.body.classList.remove('model-only');
      syncFullScreen();
      return;
    }
    if (inPc) return;
    if (event.key.toLowerCase() === 'r') reset();
    if (event.key.toLowerCase() === 'l' && state.mode !== 'rebuild') setLabels(!state.labels);
  });
  window.addEventListener('pagehide', () => { if (tracking.state !== 'off') tracking.stop(); });
}

async function loadModel() {
  const attempt = ++modelAttempt;
  $('#viewerLoading').hidden = $('#loadingSpinner').hidden = false;
  $('#loadingText').textContent = 'Loading 3D anatomy…';
  $('#retryModel').hidden = true;
  try {
    if (!atlas) {
      atlas = new AnatomyScene(stage);
      atlas.controls.addEventListener('change', () => { redraw = true; });
      bindCanvas();
      new ResizeObserver(() => {
        if (inPc) return;
        cancelDrag();
        atlas.resize();
        if (state.ready && state.mode === 'rebuild' && state.challenge.phase === 'playing') {
          for (const id of rebuildMission().ids) if (!state.challenge.placed.has(id)) positionTray(id);
        }
        redraw = true;
      }).observe(stage);
    }
    await atlas.loadBody();
    if (attempt !== modelAttempt) return;
    state.ready = true;
    atlas.setRebuildMission(rebuildMission());
    atlas.setMode(state.mode, state.mode === 'pose' ? state.scanLayer : state.layer, currentFraming());
    atlas.setPan(state.pan);
    select(state.selected);
    syncChallenge();
    markBody();
    syncBodyMission();
    $('#viewerLoading').hidden = true;
  } catch (error) {
    console.warn('BioAre model:', error);
    $('#loadingSpinner').hidden = true;
    $('#retryModel').hidden = false;
    $('#loadingText').textContent = atlas ? 'The anatomy model could not load.' : '3D rendering is unavailable in this browser.';
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  tracking.process(now);
  tickTimer(now);
  if (bodyMission.lastFrame !== null && now - bodyMission.lastFrame > 360) {
    bodyMission.pause();
    if (state.mode === 'pose' && !inPc) syncBodyMission();
  }
  if (inPc) pc?.tick(now);
  else if (state.ready && redraw) {
    redraw = false;
    atlas.render();
    moveMarkers();
  }
}

renderPanels();
filterOrgans();
syncViewTools();
syncCameraControls(tracking.state);
bindUI();
selectLayer(state.layer);
selectScanLayer(state.scanLayer);
select(state.selected);
syncChallenge();
loadModel();
requestAnimationFrame(frame);
