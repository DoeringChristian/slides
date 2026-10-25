/** Independent painted-route oracle for the original crescent. No helper-plan
 * substitution: the actual shared leaf and Canvas/PDF are rasterized unchanged.
 * Reference intersection uses the historical native L and the actual head side,
 * not the terminal-consumption solver. */
export async function terminalStrokePaintOracle() {
  const base = canvasTest.snapshot().slide.elements.subject;
  const el = { ...base, x: 0, y: 0, rotation: 0, opacity: 1, fill: 'none', stroke: '#000',
    points: [325, 370, 233.5, 146.5, 230.5, 145.5], cornerRadius: 8, strokeWidth: 9,
    startHead: 'none', endHead: 'triangle', closed: false };
  const geo = canvasTest.pathArrowGeometry(el);
  const coordinates = geo.originalD.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const [ax, ay, bx, by] = coordinates;
  const tri = geo.endGeo.fills[0].points;
  // Intersection of the first native line with the tip->second wing side.
  const vx = bx - ax, vy = by - ay, wx = tri[4] - tri[0], wy = tri[5] - tri[1];
  const t = ((tri[0] - ax) * wy - (tri[1] - ay) * wx) / (vx * wy - vy * wx);
  const join = [ax + t * vx, ay + t * vy];
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = 800; return c; };
  const reference = canvas(), ref = reference.getContext('2d');
  ref.scale(2, 2); ref.lineWidth = 9; ref.lineCap = ref.lineJoin = 'round';
  ref.save();
  for (const cut of geo.shaftClipPaths) ref.clip(new Path2D(cut), 'evenodd');
  ref.beginPath(); ref.moveTo(ax, ay); ref.lineTo(...join); ref.stroke(); ref.restore();
  ref.beginPath(); ref.moveTo(tri[0], tri[1]); ref.lineTo(tri[2], tri[3]); ref.lineTo(tri[4], tri[5]); ref.closePath(); ref.fill();
  const results = [];
  for (const mode of ['static', 'presenter', 'create', 'tipDraw', 'pdf']) {
    const c = canvas(), ctx = c.getContext('2d');
    if (mode === 'pdf') { ctx.scale(2, 2); canvasTest.drawShapeElement(ctx, el); }
    else {
      const svg = canvasTest.arrowMarkup(el, mode).replace('width="400" height="400"', 'width="800" height="800" viewBox="0 0 400 400"');
      const image = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      image.src = url; await image.decode(); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url);
    }
    const actual = ctx.getImageData(0, 0, 800, 800).data, expected = ref.getImageData(0, 0, 800, 800).data;
    let missingInterior = 0, unexpectedInterior = 0, alphaDelta = 0, differentPixels = 0;
    // The independently constructed join and shaft must both remain visible;
    // absent crescent alone would also pass a renderer that hid the whole shaft.
    for (let y = 275; y < 755; y++) for (let x = 448; x < 665; x++) {
      const i = (y * 800 + x) * 4 + 3, a = actual[i], b = expected[i];
      if (b === 255 && a < 245) missingInterior++;
      if (b === 0 && a > 32) unexpectedInterior++;
      alphaDelta += Math.abs(a - b); if (a !== b) differentPixels++;
    }
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    results.push({ mode: ['create', 'tipDraw'].includes(mode) ? `${mode}-completed-animation` : mode,
      crescent: pixel(463, 284), shaft: pixel(550, 495), join: pixel(471, 304),
      missingInterior, unexpectedInterior, alphaDelta, differentPixels, png: c.toDataURL() });
  }
  const inflight = await terminalInflight();
  return { results, inflight, join, head: tri, d: geo.d, originalD: geo.originalD, plan: geo.strokePlan };

  async function terminalInflight() {
    // Actuals always use arrowMarkup -> renderPresenterElement -> the real
    // RenderPaths/TipDrawArrow leaves. Only the independent reference is drawn
    // here. Never substitute a helper strokePlan into the actual renderer.
    const records = [];
    const svgDocument = svg => new DOMParser().parseFromString(svg, 'image/svg+xml');
    const polygon = points => {
      const p = new Path2D(); p.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) p.lineTo(points[i], points[i + 1]);
      p.closePath(); return p;
    };
    const outside = (ctx, points) => {
      const cut = new Path2D(); cut.rect(-100, -100, 600, 600); cut.addPath(polygon(points));
      ctx.clip(cut, 'evenodd');
    };
    const referenceContext = () => {
      const c = canvas(), ctx = c.getContext('2d'); ctx.scale(2, 2);
      ctx.lineWidth = 9; ctx.lineCap = ctx.lineJoin = 'round'; return ctx;
    };
    async function compare(name, element, mode, progress, expected, bounds = [0, 0, 800, 800]) {
      const markup = canvasTest.arrowMarkup(element, mode, progress);
      const c = canvas(), ctx = c.getContext('2d'), image = new Image();
      const url = URL.createObjectURL(new Blob([markup.replace('width="400" height="400"',
        'width="800" height="800" viewBox="0 0 400 400"')], { type: 'image/svg+xml' }));
      image.src = url; await image.decode(); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url);
      const a = ctx.getImageData(0, 0, 800, 800).data;
      const b = expected.getImageData(0, 0, 800, 800).data;
      let interiorDisagreement = 0, testedInterior = 0, alphaDelta = 0;
      // AA edges are recorded, not treated as identical across Canvas/SVG.
      // Every flat 3x3 reference neighbourhood (including transparent space)
      // must match within four alpha levels. This catches hidden shaft, spill,
      // wrong reveal extent and wrong fill/stroke opacity independently.
      const [left, top, right, bottom] = bounds;
      for (let y = Math.max(1, top); y < Math.min(799, bottom); y++)
        for (let x = Math.max(1, left); x < Math.min(799, right); x++) {
          const i = (y * 800 + x) * 4 + 3, delta = Math.abs(a[i] - b[i]);
          alphaDelta += delta;
          if ([-801, -800, -799, -1, 1, 799, 800, 801].every(d => b[i + 4 * d] === b[i])) {
            testedInterior++;
            if (delta > 4) interiorDisagreement++;
          }
        }
      const record = { name, mode, progress, interiorDisagreement, testedInterior, alphaDelta,
        png: c.toDataURL(), referencePng: expected.canvas.toDataURL(), markup };
      records.push(record);
      return { record, document: svgDocument(markup), pixel: (x, y) => a[(y * 800 + x) * 4 + 3] };
    }

    // Browser SVG arc length measures the unchanged historical native path,
    // independently of the terminal solver/retained plan. The early reveal
    // ends on its first straight leg; near-end head fill is 2/3, stroke 1/3.
    const original = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    original.setAttribute('d', geo.originalD);
    const originalLength = original.getTotalLength();
    for (const progress of [.175, .95]) {
      const expected = referenceContext();
      expected.save(); outside(expected, tri);
      expected.beginPath(); expected.moveTo(ax, ay);
      const revealLength = originalLength * Math.min(1, progress / .35);
      const lineLength = Math.hypot(vx, vy);
      expected.lineTo(...(progress < .35 ? [ax + vx * revealLength / lineLength, ay + vy * revealLength / lineLength] : join));
      expected.stroke(); expected.restore();
      if (progress > .85) {
        expected.globalAlpha = (progress - .85) / .15; expected.fill(polygon(tri));
        expected.globalAlpha = (1 - progress) / .15; expected.stroke(polygon(tri)); expected.globalAlpha = 1;
      }
      const actual = await compare(`original-create-${progress}`, el, 'create', progress, expected);
      const shaft = [...actual.document.querySelectorAll('path')].find(p => p.getAttribute('d') === geo.d);
      const head = [...actual.document.querySelectorAll('path')].find(p => p.getAttribute('fill') === '#000' && p.getAttribute('d')?.endsWith(' Z'));
      Object.assign(actual.record, { originalLength, expectedDashOffset: originalLength * Math.max(0, 1 - progress / .35),
        shaftDash: Number(shaft?.getAttribute('stroke-dasharray')), shaftDashOffset: Number(shaft?.getAttribute('stroke-dashoffset')),
        headFillOpacity: Number(head?.getAttribute('fill-opacity')), headStrokeOpacity: Number(head?.getAttribute('stroke-opacity')),
        branchSignature: !!shaft?.hasAttribute('stroke-dasharray') && !!head?.hasAttribute('fill-opacity'),
        shaftAlpha: actual.pixel(600, 620), crescentAlpha: actual.pixel(463, 284) });
    }

    // A moving head, not the final tip: .349/.35 lies on the short last leg of
    // the ORIGINAL crescent fixture. Hand-compute its arc-length position and
    // 30-by-30 triangle, then intersect its side with the first authored line.
    // Also sample .175 while the head is on the long first leg.
    for (const progress of [.175, .349]) {
      const firstLength = Math.hypot(91.5, 223.5), lastLength = Math.sqrt(10);
      const distance = (firstLength + lastLength) * progress / .35;
      const onLast = distance > firstLength;
      const ux = onLast ? -3 / lastLength : -91.5 / firstLength;
      const uy = onLast ? -1 / lastLength : -223.5 / firstLength;
      const remaining = onLast ? distance - firstLength : distance;
      const tip = [(onLast ? 233.5 : 325) + ux * remaining, (onLast ? 146.5 : 370) + uy * remaining];
      const head = [...tip, tip[0] - 30 * ux - 15 * uy, tip[1] - 30 * uy + 15 * ux,
        tip[0] - 30 * ux + 15 * uy, tip[1] - 30 * uy - 15 * ux];
      let end;
      if (onLast) {
        const sx = head[4] - head[0], sy = head[5] - head[1];
        const t = ((head[0] - 325) * sy - (head[1] - 370) * sx) / (-91.5 * sy + 223.5 * sx);
        end = [325 - 91.5 * t, 370 - 223.5 * t];
      } else end = [tip[0] - 30 * ux, tip[1] - 30 * uy];
      const expected = referenceContext(); expected.save(); outside(expected, head);
      expected.beginPath(); expected.moveTo(325, 370); expected.lineTo(...end); expected.stroke(); expected.restore();
      expected.fill(polygon(head));
      const actual = await compare(`original-tipDraw-${progress}`, el, 'tipDraw', progress, expected);
      const actualHead = actual.document.querySelector('polygon')?.getAttribute('points')?.match(/-?\d+(?:\.\d+)?/g).map(Number);
      Object.assign(actual.record, { expectedHead: head, actualHead, expectedTip: tip, finalTip: [230.5, 145.5],
        shaftAlpha: actual.pixel(600, 620), branchSignature: !!actualHead && !actual.document.querySelector('path[stroke-dasharray]') });
    }

    // Analytic closed polyline: original length=480+80*sqrt(2); terminal
    // triangle consumes the last 26 2/3 units of the vertical leg, but the
    // retained closing diagonal MUST still start at original distance480.
    const multi = { ...el, points: [20,100,180,100,180,20,100,20,100,180],
      closed: true, cornerRadius: 0, strokeWidth: 8, opacity: .5, stroke: 'rgba(40,80,160,.5)' };
    const length = 480 + 80 * Math.SQRT2;
    for (const progress of [.27, .32, .34]) {
      const expected = referenceContext(); expected.lineWidth = 8;
      expected.strokeStyle = 'rgba(40,80,160,.25)';
      expected.setLineDash([length, length]); expected.lineDashOffset = length * (1 - progress / .35);
      // Away from the terminal silhouette, the untouched original polyline is
      // an independent phase reference. No retained-run helper is used here.
      expected.stroke(new Path2D('M20 100 L180 100 L180 20 L100 20 L100 180 Z'));
      const actual = await compare(`multi-run-create-${progress}`, multi, 'create', progress, expected, [50, 50, 350, 302]);
      const paths = [...actual.document.querySelectorAll('mask path')];
      Object.assign(actual.record, { originalLength: length, expectedOffsets: [length * (1 - progress / .35), length * (1 - progress / .35) + 480],
        runDash: paths.map(p => Number(p.getAttribute('stroke-dasharray'))),
        runOffsets: paths.map(p => Number(p.getAttribute('stroke-dashoffset'))),
        runD: paths.map(p => p.getAttribute('d')), branchSignature: paths.length === 2,
        diagonalAlpha: [actual.pixel(140, 300), actual.pixel(120, 280), actual.pixel(80, 240)],
        crossingAlpha: actual.pixel(200, 200) });
    }
    return records;
  }
}

/** Shared assertions: both browser consumers enforce the in-flight contract. */
export function assertTerminalStrokeInflight(records, assert) {
  assert.equal(records.length, 7, 'two Create, two moving-tip and three multi-run frames');
  const near = (a, b, tolerance, label) => assert(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
  for (const r of records) {
    assert(r.progress > 0 && r.progress < 1, `${r.name}: explicit in-flight progress`);
    assert(r.branchSignature, `${r.name}: production animation branch markup`);
    assert(r.testedInterior > 70000, `${r.name}: substantial positive and negative reference area`);
    assert.equal(r.interiorDisagreement, 0, `${r.name}: independent geometry/opacity interior pixels`);
    if (r.name.startsWith('original-create')) {
      near(r.shaftDash, r.originalLength, .05, `${r.name}: original-length reveal clock`);
      near(r.shaftDashOffset, r.expectedDashOffset, .05, `${r.name}: reveal phase`);
      near(r.headFillOpacity, r.progress < .5 ? 0 : 2 / 3, 1e-8, `${r.name}: staggered head fill`);
      near(r.headStrokeOpacity, r.progress < .5 ? 0 : 1 / 3, 1e-8, `${r.name}: staggered head trace`);
      assert.equal(r.shaftAlpha, 255, `${r.name}: shaft remains painted`);
    } else if (r.mode === 'tipDraw') {
      assert(r.progress < .35, 'TipDraw must exercise moving-prefix branch, not its completed fallback');
      assert.equal(r.actualHead?.length, 6, `${r.name}: real moving triangle`);
      r.expectedHead.forEach((v, i) => near(r.actualHead[i], v, 1e-6, `${r.name}: independent moving head coordinate${i}`));
      assert(Math.hypot(r.actualHead[0] - r.finalTip[0], r.actualHead[1] - r.finalTip[1]) > .5,
        `${r.name}: head has not snapped to final tip`);
      assert.equal(r.shaftAlpha, 255, `${r.name}: moving head does not hide original shaft`);
    } else {
      assert.equal(r.runOffsets.length, 2, `${r.name}: actual two-run coverage mask`);
      r.runOffsets.forEach((v, i) => near(v, r.expectedOffsets[i], 1e-6, `${r.name}: original run${i} phase`));
      r.runDash.forEach(v => near(v, r.originalLength, 1e-6, `${r.name}: uncompressed clock`));
      const expected = r.progress === .27 ? [0, 0, 0] : r.progress === .32 ? [64, 64, 0] : [64, 64, 64];
      assert.deepEqual(r.diagonalAlpha, expected, `${r.name}: closing run reveal advances at original distance480`);
      assert.equal(r.crossingAlpha, 64, `${r.name}: colour and element alpha each applied once`);
    }
  }
}
