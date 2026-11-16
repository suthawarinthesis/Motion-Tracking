import { CanvasTexture, SRGBColorSpace } from 'three';
import { hardware } from './pc-build.js';

const W = 960;
const H = 540;

function roundRect(ctx, color, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function letters(ctx, text, x, y, size, color = '#eeeff6', weight = 400, align = 'left') {
  ctx.font = weight + ' ' + size + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function windowsMark(ctx, x, y, size, fill) {
  const edge = size * .4625;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, edge, edge);
  ctx.fillRect(x + size - edge, y, edge, edge);
  ctx.fillRect(x, y + size - edge, edge, edge);
  ctx.fillRect(x + size - edge, y + size - edge, edge, edge);
}

function wallpaper() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const ground = ctx.createLinearGradient(45, 0, 869, H);
  ground.addColorStop(0, '#1d3d82');
  ground.addColorStop(.54, '#4e7eb7');
  ground.addColorStop(1, '#122662');
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);

  const colors = [
    ['#2447a5', '#78befd', '#123e8e'],
    ['#147df3', '#78dcff', '#1a408f'],
    ['#2c56d8', '#6db7fb', '#0a2768'],
    ['#4f98ed', '#c1e6fb', '#073c8d'],
    ['#1859c3', '#76c9ff', '#123079']
  ];
  for (const [index, palette] of colors.entries()) {
    const offset = index * 33;
    const gradient = ctx.createLinearGradient(420, 240 - offset, 770, 390 - offset);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(.44, palette[1]);
    gradient.addColorStop(1, palette[2]);
    ctx.beginPath();
    ctx.moveTo(385 + offset * .65, 518 - offset);
    ctx.bezierCurveTo(270 + offset, 413 - offset, 270 + offset * .9, 254 - offset, 498 + offset, 209 - offset);
    ctx.bezierCurveTo(712 + offset, 160 - offset, 733 + offset, 60 - offset, 813 + offset, 133 - offset * .48);
    ctx.bezierCurveTo(940 + offset, 244 - offset, 865 - offset * .6, 416 - offset, 638 - offset * .45, 447 - offset);
    ctx.bezierCurveTo(497 - offset * .16, 465 - offset, 489 + offset, 570 - offset, 385 + offset * .65, 518 - offset);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  return canvas;
}

export class MonitorDisplay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.wallpaper = wallpaper();
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.cooling = 'air';
    this.menu = false;
    this.app = false;
    this.set('off');
  }

  set(mode, code = '') {
    if (this.mode === mode && this.code === code) return;
    this.mode = mode;
    this.code = code;
    if (mode !== 'desktop') this.menu = this.app = false;
    this.paint();
  }

  desktop() {
    const ctx = this.ctx;
    ctx.drawImage(this.wallpaper, 0, 0);
    roundRect(ctx, '#183966bd', 17, 14, 71, 65, 8);
    roundRect(ctx, '#9ee0ff', 38, 21, 28, 21, 2);
    roundRect(ctx, '#6daccf', 49, 42, 6, 5, 1);
    letters(ctx, 'This PC', 52, 62, 11, '#fff', 500, 'center');

    if (this.app) {
      roundRect(ctx, '#17284d45', 167, 92, 636, 360, 13);
      roundRect(ctx, '#f3f7fd', 157, 81, 636, 360, 13);
      roundRect(ctx, '#e4edf9', 158, 82, 634, 43, 11);
      letters(ctx, 'Settings', 181, 104, 14, '#203755', 600);
      letters(ctx, '×', 768, 104, 27, '#203755', 400, 'center');
      letters(ctx, 'System  ›  About', 189, 160, 27, '#142342', 620);
      const specs = [
        ['Processor', hardware.cpu], ['Graphics', hardware.gpu + ' · ' + hardware.graphicsMemory],
        ['Installed RAM', hardware.memory], ['Storage', hardware.storage],
        ['Cooling', this.cooling === 'air' ? 'Dual-tower air' : '240 mm AIO liquid']
      ];
      for (const [index, [label, value]] of specs.entries()) {
        const y = 204 + index * 38;
        roundRect(ctx, index % 2 ? '#edf3fa' : '#e7f0fa', 184, y - 15, 582, 32, 5);
        letters(ctx, label, 197, y, 14, '#41597b', 510);
        letters(ctx, value, 362, y, 15, '#172e4f', 580);
      }
      letters(ctx, 'Windows 11 simulation', 195, 409, 13, '#506783');
    }

    if (this.menu) {
      roundRect(ctx, '#dce8f6', 320, 283, 320, 207, 13);
      roundRect(ctx, '#f5f9ff', 338, 301, 284, 29, 6);
      letters(ctx, 'Search', 356, 316, 13, '#49617a');
      letters(ctx, 'Pinned', 346, 349, 14, '#273b68', 650);
      roundRect(ctx, '#edf4fc', 345, 365, 84, 52, 8);
      letters(ctx, '⚙', 387, 382, 21, '#2871bd', 650, 'center');
      letters(ctx, 'Settings', 387, 404, 12, '#223b5a', 500, 'center');
      roundRect(ctx, '#edf4fc', 439, 365, 84, 52, 8);
      letters(ctx, '▣', 481, 382, 20, '#2871bd', 680, 'center');
      letters(ctx, 'This PC', 481, 404, 12, '#223b5a', 500, 'center');
      letters(ctx, 'Workshop PC', 350, 461, 13, '#334b69', 640);
    }

    ctx.fillStyle = '#dce9f9ed';
    ctx.fillRect(0, 499, W, 41);
    windowsMark(ctx, 410, 509, 22, '#2375c7');
    roundRect(ctx, '#f5f9ff', 447, 506, 99, 27, 7);
    letters(ctx, 'Search', 475, 520, 12, '#4b5d77');
    roundRect(ctx, '#ecb339', 562, 512, 22, 16, 3);
    roundRect(ctx, '#a6b5d1', 603, 510, 20, 20, 6);
    letters(ctx, 'ENG   ▰   ◓', 864, 519, 11, '#344b64', 550, 'right');
    letters(ctx, 'TKK LAB', 940, 518, 10, '#3e5370', 520, 'right');
  }

  paint() {
    const ctx = this.ctx;
    ctx.fillStyle = this.mode === 'off' ? '#070c14' : '#09101e';
    ctx.fillRect(0, 0, W, H);
    if (this.mode === 'standby') {
      roundRect(ctx, '#142039', 371, 239, 218, 60, 8);
      letters(ctx, 'NO SIGNAL', 480, 265, 22, '#aabed7', 600, 'center');
      letters(ctx, 'HDMI', 480, 285, 10, '#7790ae', 500, 'center');
    } else if (this.mode === 'post') {
      letters(ctx, 'UEFI', 480, 235, 74, '#adcedf', 620, 'center');
      letters(ctx, 'POST  ·  SYSTEM CHECK', 480, 309, 16, '#8a9fba', 580, 'center');
    } else if (this.mode === 'loading') {
      windowsMark(ctx, 432, 166, 96, '#48a7fc');
      letters(ctx, 'Starting Windows', 480, 326, 16, '#c1d8f0', 470, 'center');
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(452 + i * 14, 360, i === 2 ? 3.3 : 2.0, 0, Math.PI * 2);
        ctx.fillStyle = '#b2dafa';
        ctx.fill();
      }
    } else if (this.mode === 'error') {
      letters(ctx, 'UEFI   /   SYSTEM HALTED', 54, 63, 27, '#c4d8ed', 600);
      letters(ctx, this.code, 54, 125, 22, '#f0c18f', 520);
      letters(ctx, 'Power off before changing internal hardware.', 54, 174, 16, '#92a9c4');
    } else if (this.mode === 'desktop') {
      this.desktop();
    } else {
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, '#151f2b');
      gradient.addColorStop(.56, '#0d1520');
      gradient.addColorStop(1, '#080d14');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }
    this.texture.needsUpdate = true;
  }

  click(uv) {
    if (this.mode !== 'desktop' || !uv) return;
    const x = uv.x * W, y = (1 - uv.y) * H;
    if (y > 499 && x > 396 && x < 445) {
      this.menu = !this.menu;
    } else if ((this.menu && x > 343 && x < 525 && y > 362 && y < 421) || (x < 86 && y < 79)) {
      this.menu = false;
      this.app = true;
    } else if (this.app && x > 744 && x < 796 && y > 83 && y < 129) {
      this.app = false;
    } else {
      this.menu = false;
    }
    this.paint();
  }
}
