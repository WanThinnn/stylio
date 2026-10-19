import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestGridSamplePlan,bilinearGridSampleAxes} from '../../web/src/raster/heic-grid-sample.js';

test('nearest grid sample plan covers each target pixel exactly once',()=>{
  const p=nearestGridSamplePlan(8,6,4,3,4,3);
  assert.equal(p.columns,2);assert.equal(p.rows,2);
  const seen=new Set();
  for(const bucket of p.buckets)for(const s of bucket){
    assert.ok(s.x>=0&&s.x<4&&s.y>=0&&s.y<3);
    assert.ok(!seen.has(s.target));seen.add(s.target);
  }
  assert.equal(seen.size,12);
});

test('nearest grid plan maps target quadrants to the correct source tile',()=>{
  const p=nearestGridSamplePlan(8,8,4,4,4,4);
  const byTarget=new Map();
  p.buckets.forEach((bucket,tile)=>bucket.forEach(s=>byTarget.set(s.target,tile)));
  assert.deepEqual([...byTarget.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),[
    0,0,1,1,
    0,0,1,1,
    2,2,3,3,
    2,2,3,3,
  ]);
});

test('nearest grid plan handles partial edge tiles without out-of-range local coordinates',()=>{
  const p=nearestGridSamplePlan(10,7,4,4,7,5);
  assert.equal(p.columns,3);assert.equal(p.rows,2);
  for(const bucket of p.buckets)for(const s of bucket){
    assert.ok(s.x>=0&&s.x<4);
    assert.ok(s.y>=0&&s.y<4);
  }
});

test('bilinear axes preserve normalized weights and clamp source edges',()=>{
  const axes=bilinearGridSampleAxes(10,7,7,5);
  for(const q of [...axes.x,...axes.y]){
    assert.ok(q.a>=0&&q.b>=q.a);
    assert.ok(q.wa>=0&&q.wb>=0);
    assert.ok(Math.abs(q.wa+q.wb-1)<1e-12);
  }
  assert.equal(axes.x[0].a,0);
  assert.equal(axes.x.at(-1).b,9);
  assert.equal(axes.y[0].a,0);
  assert.equal(axes.y.at(-1).b,6);
});
