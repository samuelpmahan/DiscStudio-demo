/*
 * Bounded Powell minimization adapted from SciPy's
 * scipy.optimize._optimize (_minimize_powell, _linesearch_powell,
 * _minimize_scalar_bounded, and Brent), SciPy 1.17.0.
 *
 * Copyright (c) 2001-2025 SciPy Developers.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

const GOLDEN_MEAN = 0.5 * (3 - Math.sqrt(5));
const BRENT_CG = 0.3819660;
const SQRT_EPS = Math.sqrt(2.2e-16);
const TINY = 1e-20;

const finite = value => Number.isFinite(value);
const copy = values => Array.from(values, Number);
const zeros = n => Array.from({ length: n }, () => 0);

function signOrOne(value) {
  return value < 0 ? -1 : 1;
}

function evaluate(fn, x, state) {
  const value = Number(fn(x.slice()));
  state.nfev += 1;
  return value;
}

function lineForSearch(x0, direction, lower, upper) {
  let lmin = -Infinity;
  let lmax = Infinity;
  for (let i = 0; i < direction.length; i++) {
    const alpha = direction[i];
    if (alpha === 0) continue;
    const low = (lower[i] - x0[i]) / alpha;
    const high = (upper[i] - x0[i]) / alpha;
    const lo = Math.min(low, high);
    const hi = Math.max(low, high);
    if (lo > lmin) lmin = lo;
    if (hi < lmax) lmax = hi;
  }
  return lmax >= lmin ? [lmin, lmax] : [0, 0];
}

function boundedScalar(fn, bounds, xatol = 1e-5, maxiter = 500) {
  const x1 = Number(bounds[0]);
  const x2 = Number(bounds[1]);
  if (!finite(x1) || !finite(x2)) throw new RangeError('Optimization bounds must be finite scalars.');
  if (x1 > x2) throw new RangeError('The lower bound exceeds the upper bound.');
  if (x1 === x2) {
    return { x: x1, fun: Number(fn(x1)), nit: 1, nfev: 1, success: true };
  }

  let a = x1;
  let b = x2;
  let xf = a + GOLDEN_MEAN * (b - a);
  let fulc = xf;
  let nfc = xf;
  let rat = 0;
  let e = 0;
  let x = xf;
  let fx = Number(fn(x));
  let fu = Infinity;
  let ffulc = fx;
  let fnfc = fx;
  let nfev = 1;
  let nit = 0;
  let xm = 0.5 * (a + b);
  let tol1 = SQRT_EPS * Math.abs(xf) + xatol / 3;
  let tol2 = 2 * tol1;
  let flag = 0;

  while (Math.abs(xf - xm) > (tol2 - 0.5 * (b - a))) {
    let golden = true;
    if (Math.abs(e) > tol1) {
      golden = false;
      let r = (xf - nfc) * (fx - ffulc);
      let q = (xf - fulc) * (fx - fnfc);
      let p = (xf - fulc) * q - (xf - nfc) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      q = Math.abs(q);
      r = e;
      e = rat;
      if (Math.abs(p) < Math.abs(0.5 * q * r) && p > q * (a - xf) && p < q * (b - xf)) {
        rat = p / q;
        x = xf + rat;
        if ((x - a) < tol2 || (b - x) < tol2) {
          rat = tol1 * signOrOne(xm - xf);
        }
      } else {
        golden = true;
      }
    }
    if (golden) {
      e = xf >= xm ? a - xf : b - xf;
      rat = GOLDEN_MEAN * e;
    }
    const step = signOrOne(rat) * Math.max(Math.abs(rat), tol1);
    x = xf + step;
    // scipy's arithmetic keeps x in [a,b]; round-off at a boundary can be
    // observable in a browser, so retain the same invariant explicitly.
    x = Math.min(b, Math.max(a, x));
    fu = Number(fn(x));
    nfev += 1;
    nit += 1;

    if (fu <= fx) {
      if (x >= xf) a = xf;
      else b = xf;
      fulc = nfc;
      ffulc = fnfc;
      nfc = xf;
      fnfc = fx;
      xf = x;
      fx = fu;
    } else {
      if (x < xf) a = x;
      else b = x;
      if (fu <= fnfc || nfc === xf) {
        fulc = nfc;
        ffulc = fnfc;
        nfc = x;
        fnfc = fu;
      } else if (fu <= ffulc || fulc === xf || fulc === nfc) {
        fulc = x;
        ffulc = fu;
      }
    }

    xm = 0.5 * (a + b);
    tol1 = SQRT_EPS * Math.abs(xf) + xatol / 3;
    tol2 = 2 * tol1;
    if (nfev >= maxiter) {
      flag = 1;
      break;
    }
  }
  if (Number.isNaN(xf) || Number.isNaN(fx) || Number.isNaN(fu)) flag = 2;
  return { x: xf, fun: fx, nit, nfev, success: flag === 0 };
}

function bracket(fn, xa = 0, xb = 1, maxiter = 1000) {
  const GOLD = 1.618034;
  const VERY_SMALL = 1e-21;
  let fa = Number(fn(xa));
  let fb = Number(fn(xb));
  let nfev = 2;
  if (fa < fb) {
    [xa, xb] = [xb, xa];
    [fa, fb] = [fb, fa];
  }
  let xc = xb + GOLD * (xb - xa);
  let fc = Number(fn(xc));
  nfev += 1;
  let iter = 0;
  while (fc < fb) {
    const tmp1 = (xb - xa) * (fb - fc);
    const tmp2 = (xb - xc) * (fb - fa);
    const val = tmp2 - tmp1;
    const denom = Math.abs(val) < VERY_SMALL ? 2 * VERY_SMALL : 2 * val;
    let w = xb - ((xb - xc) * tmp2 - (xb - xa) * tmp1) / denom;
    const wlim = xb + 110 * (xc - xb);
    if (iter > maxiter) throw new Error('No valid bracket was found before the iteration limit was reached.');
    iter += 1;
    let fw;
    if ((w - xc) * (xb - w) > 0) {
      fw = Number(fn(w));
      nfev += 1;
      if (fw < fc) {
        xa = xb; xb = w; fa = fb; fb = fw;
        break;
      } else if (fw > fb) {
        xc = w; fc = fw;
        break;
      }
      w = xc + GOLD * (xc - xb);
      fw = Number(fn(w));
      nfev += 1;
    } else if ((w - wlim) * (wlim - xc) >= 0) {
      w = wlim;
      fw = Number(fn(w));
      nfev += 1;
    } else if ((w - wlim) * (xc - w) > 0) {
      fw = Number(fn(w));
      nfev += 1;
      if (fw < fc) {
        xb = xc; xc = w; w = xc + GOLD * (xc - xb);
        fb = fc; fc = fw;
        fw = Number(fn(w));
        nfev += 1;
      }
    } else {
      w = xc + GOLD * (xc - xb);
      fw = Number(fn(w));
      nfev += 1;
    }
    xa = xb; xb = xc; xc = w;
    fa = fb; fb = fc; fc = fw;
  }
  const cond1 = (fb < fc && fb <= fa) || (fb < fa && fb <= fc);
  const cond2 = (xa < xb && xb < xc) || (xc < xb && xb < xa);
  const cond3 = finite(xa) && finite(xb) && finite(xc);
  if (!(cond1 && cond2 && cond3)) {
    // Match SciPy's minimize_scalar recovery: use the best sampled point.
    const samples = [[xa, fa], [xb, fb], [xc, fc]].filter(q => !Number.isNaN(q[1]));
    if (!samples.length) return { xa, xb, xc, fa, fb, fc, nfev, valid: false };
    samples.sort((u, v) => u[1] - v[1]);
    return { xa, xb, xc, fa, fb, fc, nfev, valid: false, best: samples[0] };
  }
  return { xa, xb, xc, fa, fb, fc, nfev, valid: true };
}

function brentScalar(fn, xatol = 1.48e-8, maxiter = 500) {
  const info = bracket(fn);
  if (!info.valid) return { x: info.best?.[0] ?? NaN, fun: info.best?.[1] ?? NaN, nit: 0, nfev: info.nfev, success: false };
  let { xa, xb, xc, fa, fb, fc, nfev } = info;
  let a = Math.min(xa, xc);
  let b = Math.max(xa, xc);
  let x = xb;
  let w = xb;
  let v = xb;
  let fx = fb;
  let fw = fb;
  let fv = fb;
  let deltax = 0;
  let rat = 0;
  let nit = 0;
  while (nit < maxiter) {
    const tol1 = xatol * Math.abs(x) + 1e-11;
    const tol2 = 2 * tol1;
    const xmid = 0.5 * (a + b);
    if (Math.abs(x - xmid) < (tol2 - 0.5 * (b - a))) break;
    if (Math.abs(deltax) <= tol1) {
      deltax = x >= xmid ? a - x : b - x;
      rat = BRENT_CG * deltax;
    } else {
      const tmp1 = (x - w) * (fx - fv);
      const tmp2 = (x - v) * (fx - fw);
      let p = (x - v) * tmp2 - (x - w) * tmp1;
      let tmp = 2 * (tmp2 - tmp1);
      if (tmp > 0) p = -p;
      tmp = Math.abs(tmp);
      const dxTemp = deltax;
      deltax = rat;
      if (p > tmp * (a - x) && p < tmp * (b - x) && Math.abs(p) < Math.abs(0.5 * tmp * dxTemp)) {
        rat = p / tmp;
        const u = x + rat;
        if (u - a < tol2 || b - u < tol2) rat = xmid - x >= 0 ? tol1 : -tol1;
      } else {
        deltax = x >= xmid ? a - x : b - x;
        rat = BRENT_CG * deltax;
      }
    }
    const u = x + (Math.abs(rat) < tol1 ? signOrOne(rat) * tol1 : rat);
    const fu = Number(fn(u));
    nfev += 1;
    if (fu > fx) {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) {
        v = w; w = u; fv = fw; fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u; fv = fu;
      }
    } else {
      if (u >= x) a = x; else b = x;
      v = w; w = x; x = u;
      fv = fw; fw = fx; fx = fu;
    }
    nit += 1;
  }
  return { x, fun: fx, nit, nfev, success: nit < maxiter && !Number.isNaN(x) && !Number.isNaN(fx) };
}

function lineSearch(fn, p, direction, lower, upper, fval, state, tol) {
  if (!direction.some(value => value !== 0)) return { fun: fval, x: p.slice(), direction: direction.slice() };
  const bounded = lower && upper;
  if (!bounded) {
    const scalar = alpha => evaluate(fn, p.map((value, i) => value + alpha * direction[i]), state);
    const result = brentScalar(scalar, 1.48e-8, 500);
    return {
      fun: result.fun,
      x: p.map((value, i) => value + result.x * direction[i]),
      direction: direction.map(value => result.x * value),
    };
  }
  const [lo, hi] = lineForSearch(p, direction, lower, upper);
  if (lo === hi) return { fun: fval, x: p.slice(), direction: zeros(direction.length) };
  if (!finite(lo) && !finite(hi)) return lineSearch(fn, p, direction, null, null, fval, state, tol);
  let scalar;
  let result;
  if (finite(lo) && finite(hi)) {
    scalar = alpha => evaluate(fn, p.map((value, i) => value + alpha * direction[i]), state);
    result = boundedScalar(scalar, [lo, hi], tol / 100, 500);
  } else {
    const loAngle = Math.atan(lo);
    const hiAngle = Math.atan(hi);
    scalar = angle => evaluate(fn, p.map((value, i) => value + Math.tan(angle) * direction[i]), state);
    result = boundedScalar(scalar, [loAngle, hiAngle], tol / 100, 500);
    result.x = Math.tan(result.x);
  }
  return {
    fun: result.fun,
    x: p.map((value, i) => value + result.x * direction[i]),
    direction: direction.map(value => result.x * value),
  };
}

/**
 * SciPy-compatible bounded Powell minimizer for small deterministic problems.
 * `fn` receives a fresh ordinary Array at every evaluation. `bounds` is an
 * array of [lower, upper] pairs. The result is {x, fun, nfev, nit, success}.
 */
export function boundedPowell(fn, seed, bounds, options = {}) {
  if (typeof fn !== 'function') throw new TypeError('boundedPowell requires a function.');
  const x0 = copy(seed);
  const n = x0.length;
  if (!n) return { x: [], fun: Number(fn([])), nfev: 1, nit: 0, success: true };
  if (!Array.isArray(bounds) || bounds.length !== n) throw new RangeError('bounds must contain one pair per parameter.');
  const lower = bounds.map(pair => pair?.[0] == null ? -Infinity : Number(pair[0]));
  const upper = bounds.map(pair => pair?.[1] == null ? Infinity : Number(pair[1]));
  for (let i = 0; i < n; i++) if (lower[i] > upper[i]) throw new RangeError('The lower bound exceeds the upper bound.');

  const xtol = Number.isFinite(options.xtol) ? Number(options.xtol) : 1e-4;
  const ftol = Number.isFinite(options.ftol) ? Number(options.ftol) : 1e-4;
  const maxiter = options.maxiter == null ? n * 1000 : Number(options.maxiter);
  const maxfev = options.maxfev == null ? Infinity : Number(options.maxfev);
  const x = x0.slice();
  const state = { nfev: 0 };
  let fval = evaluate(fn, x, state);
  let x1 = x.slice();
  const direc = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_v, j) => i === j ? 1 : 0));
  let iter = 0;
  let terminatedByMaxfev = false;
  let terminatedByNaN = false;

  while (true) {
    const fx = fval;
    let delta = 0;
    let bigind = 0;
    for (let i = 0; i < n; i++) {
      const fx2 = fval;
      const result = lineSearch(fn, x, direc[i], lower, upper, fval, state, xtol * 100);
      fval = result.fun;
      for (let j = 0; j < n; j++) x[j] = result.x[j];
      if ((fx2 - fval) > delta) {
        delta = fx2 - fval;
        bigind = i;
      }
      if (state.nfev >= maxfev) {
        terminatedByMaxfev = true;
        break;
      }
    }
    iter += 1;
    const bnd = ftol * (Math.abs(fx) + Math.abs(fval)) + TINY;
    if (2 * (fx - fval) <= bnd) break;
    if (terminatedByMaxfev || iter >= maxiter) break;
    if (Number.isNaN(fx) && Number.isNaN(fval)) {
      terminatedByNaN = true;
      break;
    }

    const extrapDirection = x.map((value, i) => value - x1[i]);
    x1 = x.slice();
    let lmax = 1;
    if (lower && upper) [, lmax] = lineForSearch(x, extrapDirection, lower, upper);
    const scale = Math.min(lmax, 1);
    const x2 = x.map((value, i) => value + scale * extrapDirection[i]);
    const fx2 = evaluate(fn, x2, state);
    if (fx > fx2) {
      let t = 2 * (fx + fx2 - 2 * fval);
      let temp = fx - fval - delta;
      t *= temp * temp;
      temp = fx - fx2;
      t -= delta * temp * temp;
      if (t < 0) {
        const result = lineSearch(fn, x, extrapDirection, lower, upper, fval, state, xtol * 100);
        fval = result.fun;
        for (let i = 0; i < n; i++) x[i] = result.x[i];
        if (result.direction.some(value => value !== 0)) {
          direc[bigind] = direc[n - 1];
          direc[n - 1] = result.direction;
        }
      }
    }
    if (state.nfev >= maxfev) {
      terminatedByMaxfev = true;
      break;
    }
  }

  let success = !terminatedByMaxfev && !terminatedByNaN && iter < maxiter && !x.some(value => Number.isNaN(value)) && !Number.isNaN(fval);
  // SciPy reports success when the objective tolerance terminates before the
  // iteration cap. A one-iteration cap has the same status as its source.
  if (iter >= maxiter) success = false;
  if (lower.some((value, i) => value > x[i]) || upper.some((value, i) => upper[i] < x[i])) success = false;
  return { x, fun: fval, nfev: state.nfev, nit: iter, success };
}

export default boundedPowell;
