import { analyzeSession } from '../js/analysis.js';
import { SAMPLE_SESSION } from '../js/sample.js';
for (const kg of [undefined, 50, 70, 100, 130]) {
  const r = analyzeSession({ ...SAMPLE_SESSION, driverKg: kg });
  const b = r.best;
  console.log(`driver ${kg ?? 'default'} -> ${r.driverKg} kg (total ${r.totalMassKg}): best ${b.time.toFixed(1)} s, ideal ${r.ref.idealTime.toFixed(1)} s, pace ${b.paceScore.toFixed(0)}, eco ${b.ecoScore.toFixed(0)}, fuel ${b.fuelMl.toFixed(1)} mL, session ${r.session.litresPerHour.toFixed(2)} L/h, tips ${r.tips.map(t=>t.key+'@S'+t.sector).join(',')}`);
}
