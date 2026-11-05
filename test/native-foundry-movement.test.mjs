import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { PF2eWolfAdapter } from '../src/foundry/pf2e-adapter.mjs';
import { reachableCells } from '../src/wolf/planner.mjs';
import { ManualMovement } from '../src/foundry/manual-movement.mjs';

// Optional local integration: import the user's installed grid implementation without copying it.
const core = new URL('file:///C:/Program%20Files/Foundry%20Virtual%20Tabletop%2014/resources/app/common/');
const hasCore = process.platform === 'win32' && await access(new URL('grid/square.mjs', core)).then(() => true, () => false);
let SquareGrid;
if (hasCore) {
  const primitives = await import(new URL('primitives/_module.mjs', core));
  for (const [name, fn] of Object.entries(primitives.Number)) if (typeof fn === 'function' && !Number.prototype[name]) {
    Object.defineProperty(Number.prototype, name, { value: fn, configurable: true });
  }
  for (const [name, fn] of Object.entries(primitives.Math)) if (typeof fn === 'function' && !Math[name]) {
    Object.defineProperty(Math, name, { value: fn, configurable: true });
  }
  ({ default: SquareGrid } = await import(new URL('grid/square.mjs', core)));
}

function fixture() {
  const grid = new SquareGrid({ size: 70, distance: 5, diagonals: 4 });
  globalThis.canvas = { grid };
  const document = { x: 0, y: 0, elevation: 0, level: 'ground', movementHistory: [],
    getSnappedPosition:p=>({x:Math.round(p.x/grid.size)*grid.size,y:Math.round(p.y/grid.size)*grid.size}) };
  const token = { document, measureMovementPath: points => grid.measurePath(points.map(point => ({ ...point,
    x: point.x + 35, y: point.y + 35 })), { cost: (from, to, distance, segment) => distance * (segment.terrain?.difficulty ?? 1) }) };
  return { grid, document, adapter: new PF2eWolfAdapter(token, {}) };
}

test('native Foundry grid: manual reaction path preserves explicit corners and all threatened departures', { skip: !hasCore }, () => {
  const { grid, document } = fixture();
  const point = (x, y) => ({ x, y, elevation: 0, level: 'ground' });
  const movement = new ManualMovement(null);
  const path = movement.path({ document }, [point(0, 0), point(210, 0), point(210, 140)]);
  assert.deepEqual(path.map(({ x, y }) => [x, y]), [[0, 0], [70, 0], [140, 0], [210, 0], [210, 70], [210, 140]]);
  assert.equal(grid.measurePath(path).distance, 25);
});

test('native Foundry grid: prior movement is subtracted from a new Stride', { skip: !hasCore }, () => {
  const { document, adapter } = fixture();
  document.x = 490;
  document.movementHistory = Array.from({ length: 8 }, (_, i) => ({ x: i * 70, y: 0 }));
  const context = adapter.movementContext();
  assert.equal(context.historyCost, 35);
  assert.equal(adapter.strideCost([{ x: 7, y: 0 }, { x: 8, y: 0 }], context), 5);
});

test('native Foundry grid: a new Stride retains the prior diagonal parity', { skip: !hasCore }, () => {
  const { document, adapter } = fixture();
  Object.assign(document, { x: 70, y: 70 });
  document.movementHistory = [{ x: 0, y: 0 }, { x: 70, y: 70 }];
  assert.equal(adapter.movementContext().historyCost, 5);
  assert.equal(adapter.strideCost([{ x: 1, y: 1 }, { x: 2, y: 2 }]), 10);
  document.movementHistory = [];
  assert.equal(adapter.strideCost([{ x: 1, y: 1 }, { x: 2, y: 2 }]), 5);
});

test('native Foundry grid: new movement discovers terrain without rewriting recorded movement', { skip: !hasCore }, () => {
  const { document, adapter } = fixture();
  document.x = 490;
  document.movementHistory = [{ x: 0, y: 0 }, { x: 490, y: 0 }];
  adapter.token.createTerrainMovementPath = (points, options) => {
    assert.equal(options.preview, false);
    assert.equal(points[0].x, 490, 'only new movement is regionalized');
    return points.map((point, i) => ({ ...point, terrain: i ? { difficulty: 2 } : null }));
  };
  const context = adapter.movementContext();
  assert.equal(context.historyCost, 35);
  assert.equal(adapter.strideCost([{ x: 7, y: 0 }, { x: 8, y: 0 }], context), 10);
  assert.equal(document.movementHistory[1].terrain, undefined);
});

test('native Foundry grid: regionalized terrain retains diagonal parity between actions', { skip: !hasCore }, () => {
  const { document, adapter } = fixture();
  Object.assign(document, { x: 70, y: 70, movementHistory: [{ x: 0, y: 0 }, { x: 70, y: 70 }] });
  adapter.token.createTerrainMovementPath = points => points.map((point, i) => ({ ...point, terrain: i ? { difficulty: 2 } : null }));
  assert.equal(adapter.strideCost([{ x: 1, y: 1 }, { x: 2, y: 2 }]), 20);
});

test('native Foundry grid: equal-cost paths prefer short smooth routes', { skip: !hasCore }, () => {
  const { grid } = fixture();
  const cells = reachableCells({ x: 0, y: 0 }, 35, {
    canEnter: p => p.x >= 0 && p.y >= 0 && p.x <= 7 && p.y <= 7,
    canTraverse: () => true,
    pathCost: path => grid.measurePath(path.map(p => ({ x: p.x * 70 + 35, y: p.y * 70 + 35 })),
      { cost: (from, to, distance) => distance }).cost,
  });
  const destination = cells.find(p => p.x === 4 && p.y === 2);
  assert.equal(destination.cost, 25);
  assert.equal(destination.path.length, 5);
  assert.ok(destination.bends <= 1);
});

test('native Foundry grid: passing an ally costs normal movement and the Stride ends beyond it', { skip: !hasCore }, () => {
  const { adapter } = fixture();
  const cells = reachableCells({ x: 0, y: 0 }, 15, {
    canEnter: cell => cell.x >= 0 && cell.x <= 3 && cell.y === 0,
    canStop: cell => cell.x !== 1,
    canTraverse: () => true,
    pathCost: path => adapter.strideCost(path),
  });
  assert.ok(!cells.some(cell => cell.x === 1));
  const end = cells.find(cell => cell.x === 3);
  assert.equal(end.cost, 15);
  assert.deepEqual(end.path.map(cell => cell.x), [0, 1, 2, 3]);
});
