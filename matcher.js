/* Self-contained so the same matcher runs in a worker and in node tests. */
function matchSymbols(input, report = () => {}) {
  const {
    pixels,
    width: W,
    height: H,
    rect,
    threshold,
    scales = [1],
    matchMode = 'luminance',
    colorTolerance = 0.12,
    allowInverted = false,
  } = input;
  if (
    !Number.isInteger(W) ||
    !Number.isInteger(H) ||
    W < 1 ||
    H < 1 ||
    W * H > 18_000_000 ||
    !pixels ||
    pixels.length !== W * H * 4 ||
    !rect ||
    !['x', 'y', 'w', 'h'].every((key) => Number.isInteger(rect[key])) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w < 3 ||
    rect.h < 3 ||
    rect.x + rect.w > W ||
    rect.y + rect.h > H ||
    !Number.isFinite(threshold) ||
    threshold < 0.65 ||
    threshold > 1 ||
    !Array.isArray(scales) ||
    !scales.length ||
    scales.length > 10 ||
    !scales.every((scale) => Number.isFinite(scale) && scale >= 0.25 && scale <= 4) ||
    !['luminance', 'color'].includes(matchMode) ||
    !Number.isFinite(colorTolerance) ||
    colorTolerance < 0 ||
    colorTolerance > 0.5 ||
    typeof allowInverted !== 'boolean' ||
    (matchMode === 'color' && allowInverted)
  ) {
    throw new Error('Invalid matching input.');
  }
  const channels = matchMode === 'color' ? 3 : 1;
  const values = new Float32Array(W * H * channels);
  for (let i = 0; i < W * H; i++) {
    const a = pixels[i * 4 + 3] / 255;
    if (channels === 3) {
      for (let channel = 0; channel < 3; channel++) {
        values[i * 3 + channel] = pixels[i * 4 + channel] * a + 255 * (1 - a);
      }
    } else
      values[i] =
        (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) *
          a +
        255 * (1 - a);
  }
  const candidates = [];
  for (let si = 0; si < scales.length; si++) {
    const scale = scales[si],
      w = Math.max(3, Math.round(rect.w * scale)),
      h = Math.max(3, Math.round(rect.h * scale));
    if (w > W || h > H) continue;
    // Spread deterministic samples across the entire box, including its background.
    const n = Math.min(w * h, 320),
      samples = [];
    for (let i = 0; i < n; i++) {
      const p = Math.floor((i * w * h) / n),
        dx = p % w,
        dy = Math.floor(p / w);
      const sx = rect.x + Math.floor((dx * rect.w) / w);
      const sy = rect.y + Math.floor((dy * rect.h) / h);
      for (let channel = 0; channel < channels; channel++) {
        samples.push({ dx, dy, channel, v: values[(sy * W + sx) * channels + channel] });
      }
    }
    const coarse = samples.filter(
      (_, i) => Math.floor(i / channels) % Math.max(1, Math.floor(n / 40)) === 0,
    );
    function prepare(s) {
      const mean = s.reduce((a, p) => a + p.v, 0) / s.length;
      const variance = s.reduce((a, p) => a + (p.v - mean) ** 2, 0);
      return { s, mean, variance };
    }
    const full = prepare(samples),
      rough = prepare(coarse);
    // Channel differences alone are not a shape: reject spatially flat samples.
    let spatialVariance = 0;
    for (let channel = 0; channel < channels; channel++) {
      spatialVariance += prepare(
        samples.filter((point) => point.channel === channel),
      ).variance;
    }
    if (spatialVariance < 25 * n * channels)
      throw new Error(
        'The sample has too little contrast. Include the symbol and a small background margin.',
      );
    function correlate(x, y, data) {
      let sum = 0,
        square = 0,
        dot = 0;
      for (const p of data.s) {
        const v = values[((y + p.dy) * W + x + p.dx) * channels + p.channel];
        sum += v;
        square += v * v;
        dot += v * (p.v - data.mean);
      }
      const variance = square - (sum * sum) / data.s.length;
      if (variance <= 0.01) return 0;
      const correlation = dot / Math.sqrt(variance * data.variance);
      return allowInverted ? Math.abs(correlation) : correlation;
    }
    function colorError(x, y) {
      let squaredError = 0;
      for (const point of samples) {
        const value =
          values[((y + point.dy) * W + x + point.dx) * channels + point.channel];
        squaredError += (value - point.v) ** 2;
      }
      return Math.sqrt(squaredError / samples.length) / 255;
    }
    for (let y = 0; y <= H - h; y++) {
      for (let x = 0; x <= W - w; x++) {
        if (rough.variance > 1 && correlate(x, y, rough) < Math.max(0.2, threshold - 0.2))
          continue;
        const score = correlate(x, y, full);
        if (
          score + 1e-6 >= threshold &&
          (channels === 1 || colorError(x, y) <= colorTolerance + 1e-6)
        )
          candidates.push({ x, y, w, h, score: Math.min(1, score) });
      }
      if (y % 40 === 0) report(Math.round((100 * (si + y / H)) / scales.length));
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const a of candidates) {
    const duplicate = kept.some((b) => {
      const area =
        Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return area / Math.min(a.w * a.h, b.w * b.h) > 0.35;
    });
    if (!duplicate) kept.push(a);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}
if (typeof module !== 'undefined') module.exports = { matchSymbols };
