import { getConfig } from '../server/config';
import { openConfiguredDatabase } from '../server/db';
import { createLead, changeStage, addNote } from '../server/leads';
import type { Stage } from '../src/domain';
const cfg = getConfig(),
  db = await openConfiguredDatabase(cfg);
if (await db.prepare("SELECT 1 FROM leads WHERE source='demo' LIMIT 1").get()) {
  console.log('Demo data already exists; no records added.');
  await db.close();
  process.exit(0);
}
const records: [string, string, Stage, string, number?][] = [
  ['Emma Wilson', 'Garden room enquiry', 'New', 'Milton Keynes'],
  ['James Mitchell', 'Home renovation', 'Qualified', 'Northampton'],
  ['Sophie Taylor', 'Garden room enquiry', 'Appointment Booked', 'Bedford'],
  ['Oliver Brown', 'Home renovation', 'Contacted', 'Milton Keynes'],
  ['Charlotte Evans', 'Garden room enquiry', 'Won', 'Bedford', 485000],
  ['Jack Thompson', 'Home renovation', 'New', 'Luton'],
  ['Amelia Clarke', 'Garden room enquiry', 'Qualified', 'Milton Keynes'],
  ['Harry Davies', 'Home renovation', 'Won', 'Northampton', 725000],
  ['Grace Robinson', 'Garden room enquiry', 'Lost', 'Bedford'],
  ['Noah Anderson', 'Home renovation', 'Unqualified', 'Manchester'],
  ['Isla Walker', 'Garden room enquiry', 'Appointment Booked', 'Milton Keynes'],
  ['Leo Harris', 'Home renovation', 'Contacted', 'Bedford'],
  ['Freya Scott', 'Garden room enquiry', 'Qualified', 'Northampton'],
  ['George Turner', 'Home renovation', 'Won', 'Luton', 360000],
];
const now = Date.now();
for (let i = 0; i < records.length; i++) {
  const [name, form, stage, town, value] = records[i],
    received = new Date(now - (i * 1.1 + 0.1) * 86400000).toISOString();
  let lead = (
    await createLead(
      db,
      cfg,
      {
        source: 'demo',
        name,
        email: `${name.toLowerCase().replaceAll(' ', '.')}@example.com`,
        phone: '+44 7700 900123',
        form_id: form === 'Home renovation' ? '99887766554433221' : '99887766554433222',
        form_name: form,
        received_at: received,
        is_demo: true,
        follow_up_at: !['Won', 'Lost', 'Unqualified'].includes(stage)
          ? new Date(now + ((i % 4) - 1) * 86400000 + (i % 3) * 3600000).toISOString()
          : undefined,
        appointment_at:
          stage === 'Appointment Booked' ? new Date(now + 3 * 86400000).toISOString() : undefined,
        form_answers: [
          { name: 'service_required', values: [form] },
          { name: 'location', values: [town] },
          { name: 'timeframe', values: ['Within 3 months'] },
        ],
        sale_minor: value,
      },
      'Demo seed',
    )
  ).lead;
  if (stage !== 'New') {
    const journey: Stage[] =
      stage === 'Won'
        ? ['Contacted', 'Qualified', 'Appointment Booked', 'Won']
        : stage === 'Appointment Booked'
          ? ['Contacted', 'Qualified', 'Appointment Booked']
          : stage === 'Qualified'
            ? ['Contacted', 'Qualified']
            : [stage];
    for (let j = 0; j < journey.length; j++)
      lead = (
        await changeStage(
          db,
          cfg,
          lead.id,
          {
            stage: journey[j],
            version: lead.version,
            occurred_at: new Date(Date.parse(received) + (j + 1) * 900000).toISOString(),
            reason:
              stage === 'Lost'
                ? 'Project postponed'
                : stage === 'Unqualified'
                  ? 'Outside service area'
                  : undefined,
            appointment_at:
              journey[j] === 'Appointment Booked'
                ? lead.appointment_at || new Date(now + 86400000).toISOString()
                : undefined,
            sale_minor: value,
          },
          'Demo owner',
        )
      ).lead;
  }
  if (['Qualified', 'Appointment Booked', 'Won'].includes(stage))
    await db
      .prepare('UPDATE leads SET qualification=? WHERE id=?')
      .run(
        JSON.stringify([
          'Relevant service requirement',
          'Within service area',
          'Confirmed interest',
          'Suitable timeframe',
        ]),
        lead.id,
      );
  await addNote(
    db,
    lead.id,
    stage === 'Won'
      ? 'Demo note: scope agreed and sale confirmed.'
      : `Demo note: enquiry about ${form.toLowerCase()}. Follow up on scope and timing.`,
    'Demo owner',
  );
}
console.log(`${records.length} synthetic leads added. Demo events are permanently suppressed.`);
await db.close();
