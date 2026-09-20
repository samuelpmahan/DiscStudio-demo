import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { find, inventory, inspectPart, printable, createScratch, reviseScratch } from './devtools-data.mjs';
import { objectId, objectModel, runCalculation, runMember, createObjectPlayground } from './devtools-data.mjs';

test('discovery exposes descriptors and prototype without invoking getter or toJSON', () => {
  let calls=0; const symbol=Symbol('test');
  class Example { get computed() { calls++; return 8; } method() { return this; } }
  const obj=new Example(); Object.defineProperty(obj,'hidden',{value:2}); obj[symbol]=3;
  obj.toJSON=()=>{ calls++; throw Error('must not run'); };
  const model=objectModel(obj); printable(obj);
  assert.equal(calls,0); assert.equal(model.prototype,Example.prototype);
  assert.ok(model.properties.some(p=>p.key===symbol));
  assert.equal(model.properties.find(p=>p.key==='hidden').enumerable,false);
  assert.equal(objectId(obj),objectId(obj)); assert.notEqual(objectId(obj),objectId({}));
  assert.equal(typeof objectModel(model.prototype).properties.find(p=>p.key==='computed').get,'function');
});
test('actual getter, receiver-bound methods, promises and failures have execution evidence', async () => {
  const pxc=new PxC(), address=createObjectPlayground(pxc), counter=pxc.get(address).value;
  const getter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(counter),'doubled').get;
  assert.equal(counter.getterCalls,0);
  const result=await runMember(pxc,counter,getter,[],'getter');
  assert.equal(result.output.value,4); assert.equal(counter.getterCalls,1);
  const changed=await runMember(pxc,counter,counter.increment,[3]);
  assert.equal(changed.output.value,5); assert.equal(counter.count,5);
  assert.equal(changed.output.composition.inputs.receiver.value,counter);
  assert.equal((await runMember(pxc,counter,counter.later,[2])).output.value,7);
  await assert.rejects(runMember(pxc,counter,counter.fail),/Deliberate/);
  assert.equal(pxc.receipts().at(-1).status,'failed');
  assert.equal(pxc.get('devtools.run.4.finished').value.state,'failed');
  assert.equal((await runMember(pxc,counter.map,Map.prototype.get,['same counter'])).output.value,counter);
});
test('Calculation runner binds references and literals explicitly and records in-flight state', async () => {
  const pxc=new PxC(); pxc.set('input',new Part(3));
  let finish; const fn=new Part(({a,b})=>new Promise(resolve=>{finish=()=>resolve(a+b);}));
  const pending=runCalculation(pxc,fn,{a:{ref:'input'},b:{value:5}});
  assert.equal(pxc.get('devtools.run.1.started').value.state,'running');
  finish(); const result=await pending;
  assert.equal(result.output.value,8); assert.equal(result.output.composition.calculation,fn);
  assert.equal(result.output.composition.inputs.a,pxc.get('input'));
  await assert.rejects(runCalculation(pxc,fn,{a:{ref:'missing'}}),/Missing Part/);
  await assert.rejects(runCalculation(pxc,fn,{a:{ref:'input',value:3}}),/exactly/);
  await assert.rejects(runCalculation(pxc,fn,[]),/named object/);
});
test('reflection errors are visible instead of breaking discovery', () => {
  const proxy=new Proxy({}, {ownKeys(){throw Error('trap failure');}});
  assert.match(objectModel(proxy).error,/trap failure/);
  assert.match(printable(proxy),/inspection failed/);
});

test('one finder takes explicit collections and searchable fields', () => {
  const molds = [{ manufacturer: 'Innova', mold: 'Destroyer' }, { manufacturer: 'Discraft', mold: 'Buzzz' }];
  assert.deepEqual(find({ collection: molds, query: 'INNOVA dest', fields: x => Object.values(x) }), [molds[0]]);
  assert.equal(find({ collection: molds, query: '', fields: x => Object.values(x) }).length, 2);
  assert.equal(find({ collection: molds, query: 'absent', fields: x => Object.values(x) }).length, 0);
});
test('inspector follows actual identity including aliases and inline contributors', async () => {
  const pxc = new PxC(), input = new Part(3), calc = new Part(({ n }) => n * 2);
  pxc.set('n', input); pxc.set('alias', input); pxc.set('fn.double', calc);
  await pxc.compose({ into: 'result', calculation: 'fn.double', inputs: { n: input, note: new Part('inline') } });
  assert.deepEqual(inspectPart(pxc, input).addresses, ['n', 'alias']);
  assert.equal(inspectPart(pxc, input).consumers[0].address, 'result');
  assert.equal(inspectPart(pxc, pxc.get('result')).edges.at(-1).addresses.length, 0);
  assert.equal(inventory(pxc).find(x => x.address === 'fn.double').kind, 'Calculation');
});
test('scratch derivation retains original without changing it and records composition', async () => {
  const pxc = new PxC(), original = pxc.set('ds.disc.test', new Part({ flight: [5,4,0,1] }));
  const scratch = createScratch(pxc, { hello: 'world' });
  const next = await reviseScratch(pxc, original, { flight: [5,4,-1,1] });
  assert.match(scratch, /^devtools.scratch/);
  assert.equal(pxc.get('ds.disc.test'), original);
  assert.deepEqual(original.value.flight, [5,4,0,1]);
  assert.equal(pxc.get(next).composition.inputs.original, original);
  assert.equal(pxc.receipts().at(-1).into, next);
});
test('printable handles cycles, functions, image bytes, maps and bigints honestly', () => {
  const obj = { big: 2n, fn: () => 1, img: 'data:image/png;base64,AAAA', map: new Map([['a', 1]]) }; obj.self = obj;
  const output = printable(obj);
  assert.ok(output.includes('circular')); assert.ok(output.includes('Calculation'));
  assert.ok(!output.includes('AAAA')); assert.ok(output.includes('2n')); assert.ok(output.includes('Map'));
});
