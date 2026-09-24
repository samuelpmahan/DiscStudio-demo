import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part } from '../part-first-kernel/src/pxc.mjs';
import { createExperience, initialDraft } from './model.ts';
import { creatorPqlPlans } from './pql.ts';
import { plasticGuides } from './plastics.ts';

const photo = { kind: 'photo' as const, src: 'data:image/webp;base64,AAAA', name: 'fixture.webp' };

test('MVP-family suggestions are shared; new named blends remain optional input values', () => {
  assert.strictEqual(plasticGuides.MVP.values, plasticGuides.Axiom.values);
  assert.strictEqual(plasticGuides.MVP.values, plasticGuides.Streamline.values);
  for (const name of ['Particle Glow Proton', 'Particle Eclipse', 'Particle Proton', 'Particle Proton Soft']) {
    assert.ok(plasticGuides.MVP.values.includes(name), `missing ${name}`);
  }
  assert.ok(plasticGuides.Innova.values.includes('Duo'));
});

test('demo intake creates four physical Disc Parts without a shelf or a browser archive', async () => {
  const app = createExperience(() => {}, { intakeOnly: true });
  const crave = app.seedOptions('Crave').find(row => row.seed.id === 'axiom--crave');
  assert.ok(crave);
  for (let index = 0; index < 4; index++) {
    const address = await app.save({ ...initialDraft(), mold: crave.address }, photo);
    assert.equal(address, `ds.px.disc.crave-${index + 1}`);
    assert.equal(app.pxc.get(address).composition.calculation, app.pxc.get('fn.CREATE'));
    const receipt = app.events.at(-1)!;
    assert.equal(receipt.event, 'disc.intake.completed');
    assert.equal(receipt.intakeAddress, app.intakeAddress);
    assert.equal(app.pxc.get(`ds.px.receipt.pql.${receipt.operationId}`).value[2].plan, creatorPqlPlans.readIntake);
    assert.equal(app.pxc.get(app.intakeAddress!).composition.calculation, app.pxc.get('fn.addReference'));
  }
  assert.deepEqual(app.intake().map(row => row.disc.id), ['crave-1', 'crave-2', 'crave-3', 'crave-4']);
  assert.equal(app.pxc.entries().some(([address]: [string, Part]) => address.startsWith('ds.px.shelf.')), false);
  assert.equal(app.pxc.entries().some(([address]: [string, Part]) => address.startsWith('ds.px.bag.')), false);
  await assert.rejects(app.save(initialDraft(), photo), /at most four discs/);
  assert.equal(app.events.filter(event => event.event === 'disc.intake.completed').length, 4);
  assert.equal(createExperience(() => {}, { intakeOnly: true }).intake().length, 0);
});

test('demo card output accepts four snapshots and refuses a fifth without changing the queue', async () => {
  const app = createExperience(() => {}, { intakeOnly: true });
  const address = await app.save(initialDraft(), photo);
  const row = app.intake()[0];
  assert.equal(row.address, address);
  const card = { disc: row.disc, orientation: 'vertical' as const, cardDesign: 'u02' };
  await app.enqueueOutput([card, card, card, card]);
  assert.equal(app.outputQueue().length, 4);
  const queueAddress = app.outputQueueAddress;
  await assert.rejects(app.enqueueOutput([card]), /at most four cards/);
  assert.equal(app.outputQueueAddress, queueAddress);
  assert.equal(app.outputQueue().length, 4);
  await app.removeOutput(0);
  await app.enqueueOutput([{ ...card, orientation: 'horizontal', cardDesign: 'b01' }]);
  assert.equal(app.outputQueue().length, 4);
});
