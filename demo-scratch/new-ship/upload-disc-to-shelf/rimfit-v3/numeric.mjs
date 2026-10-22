/** Small, deterministic numeric primitives used by the browser RimFit port. */

export const TAU = Math.PI * 2;

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = Array.from(values, Number).sort((a, b) => a - b);
  const position = (sorted.length - 1) * clamp(percent, 0, 100) / 100;
  const lower = Math.floor(position), upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function mean(values) {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function median(values) {
  return percentile(values, 50);
}

/** scipy.ndimage's default reflect boundary: ... c b a | a b c ... */
export function reflectIndex(index, length) {
  if (length <= 1) return 0;
  const period = length * 2;
  let wrapped = index % period;
  if (wrapped < 0) wrapped += period;
  return wrapped < length ? wrapped : period - wrapped - 1;
}

export function gaussianKernel(sigma) {
  // scipy.ndimage.gaussian_filter's default `truncate=4` computes
  // radius=int(truncate*sigma + .5), rather than ceil(4*sigma).
  const radius = Math.max(1, Math.floor(4 * sigma + .5));
  const kernel = new Float64Array(radius * 2 + 1);
  const denominator = 2 * sigma * sigma;
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / denominator);
    kernel[i + radius] = value;
    total += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  return { kernel, radius };
}

export function gaussianBlur(channel, width, height, sigma) {
  const { kernel, radius } = gaussianKernel(sigma);
  const horizontal = new Float64Array(channel.length);
  const output = new Float64Array(channel.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) value += channel[row + reflectIndex(x + k, width)] * kernel[k + radius];
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) value += horizontal[reflectIndex(y + k, height) * width + x] * kernel[k + radius];
      output[y * width + x] = value;
    }
  }
  return output;
}

/** Match numpy.gradient for a unit-spaced image axis. */
export function gradient(channel, width, height, axis) {
  const output = new Float64Array(channel.length);
  if (axis === 1) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      if (width === 1) continue;
      output[row] = channel[row + 1] - channel[row];
      for (let x = 1; x < width - 1; x++) output[row + x] = (channel[row + x + 1] - channel[row + x - 1]) * 0.5;
      output[row + width - 1] = channel[row + width - 1] - channel[row + width - 2];
    }
  } else {
    if (height === 1) return output;
    for (let x = 0; x < width; x++) {
      output[x] = channel[width + x] - channel[x];
      for (let y = 1; y < height - 1; y++) output[y * width + x] = (channel[(y + 1) * width + x] - channel[(y - 1) * width + x]) * 0.5;
      output[(height - 1) * width + x] = channel[(height - 1) * width + x] - channel[(height - 2) * width + x];
    }
  }
  return output;
}

/** Bilinear map_coordinates(order=1, mode=nearest) for image channels. */
export function sample(channel, width, height, y, x) {
  const xx = clamp(x, 0, width - 1), yy = clamp(y, 0, height - 1);
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = xx - x0, ty = yy - y0;
  const top = channel[y0 * width + x0] * (1 - tx) + channel[y0 * width + x1] * tx;
  const bottom = channel[y1 * width + x0] * (1 - tx) + channel[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

export function sampleMany(channel, width, height, ys, xs) {
  const output = new Float64Array(ys.length);
  for (let i = 0; i < output.length; i++) output[i] = sample(channel, width, height, ys[i], xs[i]);
  return output;
}

/** Solve a small dense linear system with partial pivoting. */
export function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = Array.from({ length: n }, (_, row) => [...matrix[row], vector[row]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    const scale = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[n]);
}

export function l2Norm(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

export function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
