import { describe, expect, test } from 'vitest';
import {
  BOUND_TEXT_PADDING,
  MIN_LABEL_WIDTH,
  PATH_LABEL_WIDTH,
  attachLabelMasks,
  boundLabelChangesFor,
  createBoundLabel,
  expandWithBoundTexts,
  findBoundTextIn,
  fitLabelToDoc,
  labelWrapWidthFor,
  maxLabelWidthFor,
  pathLabelCenter,
  syncDependentsAfterMutation,
} from './syncDependents';
import { TEXT_BOX_PADDING } from './constants';
import { duplicateElements } from './slideFactory';
import type { ShapeElement, SlideElement, TextElement } from '../types/presentation';

const base = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
};

const style = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 'normal' as const,
  fontStyle: 'normal' as const,
  textDecoration: 'none' as const,
  color: '#111111',
  align: 'center' as const,
  verticalAlign: 'middle' as const,
  lineHeight: 1.2,
};

function rect(id: string, over?: Partial<ShapeElement>): ShapeElement {
  return {
    ...base,
    id,
    type: 'shape', creationPreset: 'rect',
    shapeType: 'rect',
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 1,
    cornerRadius: 0,
    ...over,
  };
}

function path(id: string, over?: Partial<ShapeElement>): ShapeElement {
  return {
    ...base,
    id,
    type: 'shape', creationPreset: 'line',
    shapeType: 'path',
    fill: '',
    stroke: '#000',
    strokeWidth: 3,
    cornerRadius: 0,
    points: [0, 0, 200, 0],
    curve: 'linear',
    closed: false,
    width: 200,
    height: 0,
    ...over,
  };
}

function label(id: string, containerId: string, over?: Partial<TextElement>): TextElement {
  return {
    ...base,
    id,
    type: 'text', textSizing: 'user-width', boundTextLayout: 'padded',
    text: 'Label',
    style: { ...style },
    containerId,
    width: 100,
    height: 40,
    ...over,
  };
}

describe('findBoundTextIn / expandWithBoundTexts', () => {
  const elements: Record<string, SlideElement> = {
    box: rect('box'),
    lbl: label('lbl', 'box'),
    free: label('free', 'box', { containerId: undefined }),
  };
  delete (elements.free as TextElement).containerId;
  const order = ['box', 'lbl', 'free'];

  test('finds the bound text for a container, null otherwise', () => {
    expect(findBoundTextIn(elements, order, 'box')?.id).toBe('lbl');
    expect(findBoundTextIn(elements, order, 'nope')).toBeNull();
  });

  test('expands container ids with their labels, in elementOrder order', () => {
    expect(expandWithBoundTexts(elements, order, ['box'])).toEqual(['box', 'lbl']);
    expect(expandWithBoundTexts(elements, order, ['free'])).toEqual(['free']);
    // Already-included labels are not duplicated.
    expect(expandWithBoundTexts(elements, order, ['lbl', 'box'])).toEqual(['lbl', 'box']);
  });
});

describe('maxLabelWidthFor / labelWrapWidthFor', () => {
  test('shape container: inner width, floored at MIN_LABEL_WIDTH', () => {
    expect(maxLabelWidthFor(rect('box', { width: 200 }))).toBe(200 - 2 * BOUND_TEXT_PADDING);
    expect(maxLabelWidthFor(rect('box', { width: 30 }))).toBe(MIN_LABEL_WIDTH);
  });

  test('path container: fixed PATH_LABEL_WIDTH', () => {
    expect(maxLabelWidthFor(path('arrow'))).toBe(PATH_LABEL_WIDTH);
  });

  test('wrap width subtracts the text box inner padding', () => {
    expect(labelWrapWidthFor(rect('box', { width: 200 }))).toBe(
      200 - 2 * BOUND_TEXT_PADDING - 2 * TEXT_BOX_PADDING,
    );
    expect(labelWrapWidthFor(path('arrow'))).toBe(PATH_LABEL_WIDTH - 2 * TEXT_BOX_PADDING);
  });
});

describe('boundLabelChangesFor (label placement math)', () => {
  test('shape container: label keeps its OWN hugged size, recentred on the bbox center', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = label('lbl', 'box', { x: 0, y: 0, width: 50, height: 40 });
    const changes = boundLabelChangesFor(container, lbl);
    // Width 50 hugs the text and is under the cap → untouched; recenter only.
    expect(changes).toEqual({ x: 200 - 25, y: 140 - 20 });
    expect(changes).not.toHaveProperty('width');
    expect(changes).not.toHaveProperty('height');
  });

  test('shape container: width capped at the container inner width (shrunk container)', () => {
    const container = rect('box', { x: 0, y: 0, width: 100, height: 100 });
    const lbl = label('lbl', 'box', { x: 500, y: 500, width: 150, height: 40 });
    // Cap = 100 − 2·8 = 84 < 150 → width shrinks with the recenter.
    expect(boundLabelChangesFor(container, lbl)).toEqual({ x: 50 - 42, y: 50 - 20, width: 84 });
  });

  test('shape container: cap floors at MIN_LABEL_WIDTH for tiny containers', () => {
    const container = rect('box', { x: 0, y: 0, width: 30, height: 30 });
    const lbl = label('lbl', 'box', { x: 500, y: 500 });
    expect(boundLabelChangesFor(container, lbl)!.width).toBe(MIN_LABEL_WIDTH);
  });

  test('shape container: already in place → null (epsilon guard)', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = label('lbl', 'box', { x: 200 - 25, y: 120, width: 50, height: 40 });
    expect(boundLabelChangesFor(container, lbl)).toBeNull();
  });

  test('path container: recentred on the arc-length midpoint, size kept', () => {
    const container = path('arrow', { x: 100, y: 50 });
    const lbl = label('lbl', 'arrow', { x: 0, y: 0, width: 100, height: 40 });
    // Midpoint of [0,0]→[200,0] at element (100,50) is absolute (200, 50).
    expect(pathLabelCenter(container)).toEqual({ x: 200, y: 50 });
    expect(boundLabelChangesFor(container, lbl)).toEqual({ x: 150, y: 30 });
  });

  test('path container with degenerate points falls back to bbox placement', () => {
    const container = path('arrow', { points: [0, 0] });
    // < 2 vertices → not a usable path; treated like a box container:
    // recentred on the bbox center (200×0 at 0,0), own width kept.
    expect(boundLabelChangesFor(container, label('lbl', 'arrow'))).toEqual({
      x: 100 - 50,
      y: -20,
    });
  });
});

describe('createBoundLabel', () => {
  test('shape container: SMALL empty centred label with center/middle alignment', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = createBoundLabel(container);
    expect(lbl.type).toBe('text');
    expect(lbl.text).toBe('');
    expect(lbl.containerId).toBe('box');
    expect(lbl.style.align).toBe('center');
    expect(lbl.style.verticalAlign).toBe('middle');
    // Hug model: labels START small and grow with the text, they no longer
    // span the container.
    expect(lbl.width).toBe(MIN_LABEL_WIDTH);
    expect(lbl.x + lbl.width / 2).toBeCloseTo(200); // container center x
    expect(lbl.y + lbl.height / 2).toBeCloseTo(140); // container center y
  });

  test('path container: small label centred on the arc midpoint', () => {
    const container = path('arrow', { x: 100, y: 50 });
    const lbl = createBoundLabel(container);
    expect(lbl.width).toBe(MIN_LABEL_WIDTH);
    expect(lbl.x + lbl.width / 2).toBeCloseTo(200);
    expect(lbl.y + lbl.height / 2).toBeCloseTo(50);
  });
});

describe('fitLabelToDoc (hug-the-text box from a measured layout doc)', () => {
  // Mocked SvgTextDoc extents — layoutSvgText computes doc.width from the
  // widest laid-out line and doc.height from the summed line advances; math
  // spans contribute via their MathJax-parsed widthPx / above+belowBaseline
  // (textLayout.ts), so a "$x^2$" label flows through this same math.

  test('label hugs the doc: width/height from doc + inner padding, centred on the container', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = label('lbl', 'box', { x: 0, y: 0, width: 184, height: 40 });
    const fit = fitLabelToDoc(container, lbl, { width: 60, height: 28.8 });
    const w = 60 + 2 * TEXT_BOX_PADDING;
    const h = 28.8 + 2 * TEXT_BOX_PADDING;
    expect(fit.label).toEqual({ x: 200 - w / 2, y: 140 - h / 2, width: w, height: h });
    expect(fit.container).toBeNull();
  });

  test('LaTeX-shaped doc ("$x^2$" measured extents) sizes via doc.width/doc.height', () => {
    // A MathJax x² span is wider than tall glyph-for-glyph and pushes the
    // line height past fontSize·lineHeight; the fit must consume BOTH doc
    // extents rather than re-deriving from character counts.
    const container = rect('box', { x: 0, y: 0, width: 200, height: 100 });
    const lbl = label('lbl', 'box', { x: 0, y: 0, width: 40, height: 56.8 });
    const mathDoc = { width: 57.3, height: 41.6 }; // measured-style extents
    const fit = fitLabelToDoc(container, lbl, mathDoc);
    expect(fit.label).toEqual({
      x: 100 - (57.3 + 2 * TEXT_BOX_PADDING) / 2,
      y: 50 - (41.6 + 2 * TEXT_BOX_PADDING) / 2,
      width: 57.3 + 2 * TEXT_BOX_PADDING,
      height: 41.6 + 2 * TEXT_BOX_PADDING,
    });
  });

  test('width clamps into [MIN_LABEL_WIDTH, container inner width]', () => {
    const container = rect('box', { x: 0, y: 0, width: 200, height: 100 });
    const tiny = fitLabelToDoc(container, label('lbl', 'box'), { width: 1, height: 28.8 });
    expect((tiny.label as { width: number }).width).toBe(MIN_LABEL_WIDTH);
    const wide = fitLabelToDoc(container, label('lbl', 'box'), { width: 500, height: 28.8 });
    expect((wide.label as { width: number }).width).toBe(200 - 2 * BOUND_TEXT_PADDING);
  });

  test('already fitted → null label patch (epsilon guard, no undo/collab spam)', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const w = 60 + 2 * TEXT_BOX_PADDING;
    const h = 28.8 + 2 * TEXT_BOX_PADDING;
    const lbl = label('lbl', 'box', { x: 200 - w / 2, y: 140 - h / 2, width: w, height: h });
    const fit = fitLabelToDoc(container, lbl, { width: 60.1, height: 28.9 });
    expect(fit.label).toBeNull();
    expect(fit.container).toBeNull();
  });

  test('container grows (symmetric, grow-only) when the wrapped text exceeds its inner height', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 60 });
    const fit = fitLabelToDoc(container, label('lbl', 'box'), { width: 100, height: 80 });
    const labelH = 80 + 2 * TEXT_BOX_PADDING;
    const needed = labelH + 2 * BOUND_TEXT_PADDING;
    expect(fit.container).toEqual({ height: needed, y: 100 - (needed - 60) / 2 });
    // Oversized container is NEVER shrunk back.
    const roomy = rect('box', { x: 100, y: 100, width: 200, height: 400 });
    expect(fitLabelToDoc(roomy, label('lbl', 'box'), { width: 100, height: 80 }).container).toBeNull();
  });

  test('path container: centred on the arc midpoint, container never resized', () => {
    const container = path('arrow', { x: 100, y: 50 });
    const fit = fitLabelToDoc(container, label('lbl', 'arrow'), { width: 60, height: 200 });
    const w = 60 + 2 * TEXT_BOX_PADDING;
    const h = 200 + 2 * TEXT_BOX_PADDING;
    expect(fit.label).toEqual({ x: 200 - w / 2, y: 50 - h / 2, width: w, height: h });
    expect(fit.container).toBeNull();
  });
});

describe('syncDependentsAfterMutation (bound-text follows)', () => {
  test('container move → label follow emitted; nothing else touched', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = label('lbl', 'box', { x: 0, y: 0, width: 184, height: 40 });
    const free = label('free', 'box');
    delete (free as TextElement).containerId;
    const elements = { box: container, lbl, free };
    const order = ['box', 'lbl', 'free'];

    const deps = syncDependentsAfterMutation(elements, order, new Set(['box']));
    // Width 184 is exactly the cap → kept (hug model: sizing is owned by
    // fitLabelToDoc); the follow is a pure recenter.
    expect(deps).toEqual([
      { elementId: 'lbl', changes: { x: 108, y: 120 } },
    ]);
  });

  test('label already in place → no patch (no undo/collab spam)', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const lbl = label('lbl', 'box', { x: 108, y: 120, width: 184, height: 40 });
    const deps = syncDependentsAfterMutation({ box: container, lbl }, ['box', 'lbl'], new Set(['box']));
    expect(deps).toEqual([]);
  });

  test('unrelated element move → label untouched', () => {
    const container = rect('box', { x: 100, y: 100, width: 200, height: 80 });
    const other = rect('other', { x: 0, y: 0 });
    const lbl = label('lbl', 'box', { x: 0, y: 0 });
    const deps = syncDependentsAfterMutation(
      { box: container, other, lbl },
      ['box', 'other', 'lbl'],
      new Set(['other']),
    );
    expect(deps).toEqual([]);
  });

  test('label of a rebound connector follows the POST-rebind geometry', () => {
    // box at (200,0); arrow ends pinned to box's left-middle. Moving the box
    // right stretches the arrow via the rebind pass; the arrow's label must
    // recenter on the NEW arc midpoint in the same pass.
    const box = rect('box', { x: 300, y: 0, width: 100, height: 100 });
    const arrow = path('arrow', {
      x: 0,
      y: 50,
      width: 200,
      height: 0,
      points: [0, 0, 200, 0],
      endBinding: { elementId: 'box', mode: 'pinned', fixedPoint: [0, 0.5] },
    });
    const lbl = label('lbl', 'arrow', { x: 50, y: 30, width: 100, height: 40 });
    const elements = { box, arrow, lbl };
    const order = ['box', 'arrow', 'lbl'];

    const deps = syncDependentsAfterMutation(elements, order, new Set(['box']));
    const arrowPatch = deps.find((d) => d.elementId === 'arrow');
    const labelPatch = deps.find((d) => d.elementId === 'lbl');
    expect(arrowPatch).toBeDefined();
    // Rebound arrow: (0,50) → (300,50); arc midpoint at absolute (150,50).
    expect(labelPatch).toBeDefined();
    expect(labelPatch!.changes).toEqual({ x: 100, y: 30 });
  });

  test('dangling containerId is tolerated (no patch, no throw)', () => {
    const lbl = label('lbl', 'gone');
    const deps = syncDependentsAfterMutation({ lbl }, ['lbl'], new Set(['gone']));
    expect(deps).toEqual([]);
  });
});

describe('attachLabelMasks', () => {
  test('path container with a visible non-empty label gets a _labelMask hint', () => {
    const arrow = path('arrow', { x: 100, y: 50 });
    const lbl = label('lbl', 'arrow', { x: 150, y: 30, width: 100, height: 40 });
    const out = attachLabelMasks([arrow, lbl], '#123456');
    const masked = out[0] as ShapeElement & { _labelMask?: unknown };
    expect(masked._labelMask).toEqual({ x: 150, y: 30, width: 100, height: 40, color: '#123456' });
    // Label element itself passes through untouched.
    expect(out[1]).toBe(lbl);
  });

  test('non-path containers, empty labels, and hidden labels get no mask', () => {
    const box = rect('box');
    const boxLbl = label('lbl1', 'box');
    const arrowA = path('arrowA');
    const emptyLbl = label('lbl2', 'arrowA', { text: '   ' });
    const arrowB = path('arrowB', { id: 'arrowB' });
    const hiddenLbl = label('lbl3', 'arrowB', { visible: false });
    const input = [box, boxLbl, arrowA, emptyLbl, arrowB, hiddenLbl];
    const out = attachLabelMasks(input, '#fff');
    for (const el of out) {
      expect((el as ShapeElement & { _labelMask?: unknown })._labelMask).toBeUndefined();
    }
  });

  test('identity when nothing needs masking', () => {
    const box = rect('box');
    const input = [box];
    expect(attachLabelMasks(input, '#fff')).toBe(input);
  });
});

describe('duplicateElements (containerId remap)', () => {
  test('label copied with its container points at the clone', () => {
    const box = rect('box');
    const lbl = label('lbl', 'box');
    const [boxCopy, lblCopy] = duplicateElements([box, lbl]) as [ShapeElement, TextElement];
    expect(boxCopy.id).not.toBe('box');
    expect(lblCopy.id).not.toBe('lbl');
    expect(lblCopy.containerId).toBe(boxCopy.id);
  });

  test('label copied without its container becomes free text', () => {
    const lbl = label('lbl', 'box');
    const [lblCopy] = duplicateElements([lbl]) as [TextElement];
    expect(lblCopy.containerId).toBeUndefined();
    expect('containerId' in lblCopy).toBe(false);
  });
});


test('rotated path label uses the rendered arc midpoint, not unrotated x/y', () => {
  const container = path('rotated', { x: 100, y: 50, width: 100, height: 100, rotation: 90, points: [0, 0, 100, 0] });
  const anchor = pathLabelCenter(container)!;
  expect(anchor.x).toBeCloseTo(200); expect(anchor.y).toBeCloseTo(100);
});
