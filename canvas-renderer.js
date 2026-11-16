import { Matrix3, Matrix4 } from 'three';

const rgb = (r, g, b, a = 255) => (a << 24) | (b << 16) | (g << 8) | r;
const clamp8 = value => Math.max(0, Math.min(255, Math.round(value)));
const opaqueColor = (shade, red, green, blue) => rgb(clamp8(red * shade), clamp8(green * shade), clamp8(blue * shade));

function blend(background, foreground, alpha) {
  const otherAlpha = (background >>> 24) / 255 * (1 - alpha);
  const total = alpha + otherAlpha;
  const w = alpha / total;
  return rgb(
    clamp8((foreground & 255) * w + (background & 255) * (1 - w)),
    clamp8(((foreground >>> 8) & 255) * w + ((background >>> 8) & 255) * (1 - w)),
    clamp8(((foreground >>> 16) & 255) * w + ((background >>> 16) & 255) * (1 - w)),
    clamp8(total * 255)
  );
}

function readAttribute(attribute) {
  const values = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    values[i * 3] = attribute.getX(i);
    values[i * 3 + 1] = attribute.getY(i);
    values[i * 3 + 2] = attribute.getZ(i);
  }
  return values;
}

function geometryData(geometry) {
  const positions = readAttribute(geometry.attributes.position);
  return {
    positions,
    normals: geometry.attributes.normal ? readAttribute(geometry.attributes.normal) : null,
    uv: geometry.attributes.uv,
    index: geometry.index?.array || null,
    vertices: new Float32Array(positions.length / 3 * 4)
  };
}

export class CanvasRenderer {
  constructor(canvas, { maxPixels = 310000 } = {}) {
    this.maxPixels = maxPixels;
    this.domElement = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    if (!this.context) throw new Error('Canvas rendering is unavailable.');
    this.view = new Matrix4();
    this.clip = new Matrix4();
    this.normal = new Matrix3();
    this.cache = new WeakMap();
    this.textures = new WeakMap();
  }

  setSize(width, height) {
    const scale = Math.min(1, Math.sqrt(this.maxPixels / (width * height)));
    this.width = this.domElement.width = Math.max(1, Math.round(width * scale));
    this.height = this.domElement.height = Math.max(1, Math.round(height * scale));
    this.image = this.context.createImageData(this.width, this.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(this.pixels.length);
    this.transparentDepth = new Float32Array(this.pixels.length);
    this.transparentPixels = new Uint32Array(this.pixels.length);
    this.opacity = new Uint8Array(this.pixels.length);
  }

  render(scene, camera) {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    this.view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.pixels.fill(0);
    this.depth.fill(Infinity);
    const transparent = new Map();
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.material?.visible) return;
      if (!mesh.material.transparent) {
        this.draw(mesh, false);
      } else {
        const order = mesh.renderOrder;
        if (!transparent.has(order)) transparent.set(order, []);
        transparent.get(order).push(mesh);
      }
    });
    for (const order of [...transparent.keys()].sort((a, b) => a - b)) {
      this.transparentDepth.set(this.depth);
      this.opacity.fill(0);
      for (const mesh of transparent.get(order)) this.draw(mesh, true);
      for (let i = 0; i < this.opacity.length; i++) {
        if (this.opacity[i]) this.pixels[i] = blend(this.pixels[i], this.transparentPixels[i], this.opacity[i] / 255);
      }
    }
    this.context.putImageData(this.image, 0, 0);
  }

  texture(map) {
    if (!map?.isCanvasTexture) return null;
    const stored = this.textures.get(map);
    if (stored?.version === map.version) return stored;
    const { width, height } = map.image;
    const image = map.image.getContext('2d').getImageData(0, 0, width, height);
    const snapshot = { width, height, version: map.version, pixels: new Uint32Array(image.data.buffer) };
    this.textures.set(map, snapshot);
    return snapshot;
  }

  draw(mesh, transparent) {
    let data = this.cache.get(mesh.geometry);
    if (!data) {
      data = geometryData(mesh.geometry);
      this.cache.set(mesh.geometry, data);
    }
    const { positions, normals, index, vertices, uv } = data;
    const texture = uv && this.texture(mesh.material.map);
    const weights = texture ? (data.weights ??= new Float32Array(uv.count)) : null;
    const clip = this.clip.multiplyMatrices(this.view, mesh.matrixWorld).elements;
    const normal = this.normal.getNormalMatrix(mesh.matrixWorld).elements;
    for (let i = 0, j = 0; i < positions.length; i += 3, j += 4) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const w = x * clip[3] + y * clip[7] + z * clip[11] + clip[15];
      if (w <= 0) {
        vertices[j + 2] = Infinity;
        continue;
      }
      if (weights) weights[j / 4] = 1 / w;
      vertices[j] = ((x * clip[0] + y * clip[4] + z * clip[8] + clip[12]) / w + 1) * this.width * .5;
      vertices[j + 1] = (1 - (x * clip[1] + y * clip[5] + z * clip[9] + clip[13]) / w) * this.height * .5;
      vertices[j + 2] = (x * clip[2] + y * clip[6] + z * clip[10] + clip[14]) / w;
      let shade = .86;
      if (normals) {
        const a = normals[i], b = normals[i + 1], c = normals[i + 2];
        const nx = a * normal[0] + b * normal[3] + c * normal[6];
        const ny = a * normal[1] + b * normal[4] + c * normal[7];
        const nz = a * normal[2] + b * normal[5] + c * normal[8];
        const invLength = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        const key = Math.max(0, (-.47 * nx + .61 * ny + .64 * nz) * invLength);
        const fill = Math.max(0, (.78 * nx + .33 * ny + .52 * nz) * invLength);
        const rim = Math.max(0, (.47 * nx + .41 * ny - .77 * nz) * invLength);
        shade = .38 + .58 * key + .35 * fill + .19 * rim + .1 * key ** 12;
      }
      vertices[j + 3] = shade;
    }
    const material = mesh.material;
    const winding = mesh.matrixWorld.determinant() < 0 ? -1 : 1;
    const rgba = (material.color?.getHex() ?? 0xb6b6b0);
    const tint = material.emissiveIntensity && material.emissive?.getHex() ? 1.13 : 1;
    const red = (rgba >>> 16) * tint;
    const green = ((rgba >>> 8) & 255) * tint;
    const blue = (rgba & 255) * tint;
    const opacity = clamp8(material.opacity * 255);
    const count = index?.length ?? positions.length / 3;
    const depth = transparent ? this.transparentDepth : this.depth;
    const pixels = transparent ? this.transparentPixels : this.pixels;
    for (let i = 0; i < count; i += 3) {
      const a = (index ? index[i] : i) * 4;
      const b = (index ? index[i + 1] : i + 1) * 4;
      const c = (index ? index[i + 2] : i + 2) * 4;
      const az = vertices[a + 2], bz = vertices[b + 2], cz = vertices[c + 2];
      if (!Number.isFinite(az + bz + cz) || Math.max(az, bz, cz) < -1 || Math.min(az, bz, cz) > 1) continue;
      const ax = vertices[a], ay = vertices[a + 1];
      const bx = vertices[b], by = vertices[b + 1];
      const cx = vertices[c], cy = vertices[c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < .01 || (material.side === 0 && area * winding > 0)) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxX = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const maxY = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
      const du = (by - cy) / area;
      const dv = (cy - ay) / area;
      const ds = vertices[a + 3], bt = vertices[b + 3], ct = vertices[c + 3];
      const av = a / 4, bv = b / 4, cv = c / 4;
      const s0 = weights ? uv.getX(av) * weights[av] : 0;
      const s1 = weights ? uv.getX(bv) * weights[bv] : 0;
      const s2 = weights ? uv.getX(cv) * weights[cv] : 0;
      const t0 = weights ? uv.getY(av) * weights[av] : 0;
      const t1 = weights ? uv.getY(bv) * weights[bv] : 0;
      const t2 = weights ? uv.getY(cv) * weights[cv] : 0;
      for (let y = minY; y <= maxY; y++) {
        const py = y + .5;
        let u = ((by - cy) * (minX + .5 - cx) + (cx - bx) * (py - cy)) / area;
        let v = ((cy - ay) * (minX + .5 - cx) + (ax - cx) * (py - cy)) / area;
        let pixel = y * this.width + minX;
        for (let x = minX; x <= maxX; x++, pixel++, u += du, v += dv) {
          const w = 1 - u - v;
          if (u < -.00001 || v < -.00001 || w < -.00001) continue;
          const z = u * az + v * bz + w * cz;
          if (z < -1 || z >= depth[pixel]) continue;
          if (texture) {
            const inverse = 1 / (u * weights[av] + v * weights[bv] + w * weights[cv]);
            const sx = Math.min(texture.width - 1, Math.max(0, Math.floor((u * s0 + v * s1 + w * s2) * inverse * texture.width)));
            const sy = Math.min(texture.height - 1, Math.max(0, Math.floor((1 - (u * t0 + v * t1 + w * t2) * inverse) * texture.height)));
            pixels[pixel] = texture.pixels[sy * texture.width + sx];
          } else {
            const shade = u * ds + v * bt + w * ct;
            pixels[pixel] = opaqueColor(shade, red, green, blue);
          }
          depth[pixel] = z;
          if (transparent) this.opacity[pixel] = opacity;
        }
      }
    }
  }
}
