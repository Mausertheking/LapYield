// Kart physics and fuel model - a JavaScript port of kart_sim.py (same constants).
// All units SI: metres, seconds, kilograms, watts.

const G = 9.81;
const RHO_AIR = 1.2;

export function makeKart(params, fuel) {
  const k = { ...params };
  k.lhv = fuel.lhv;                 // J/kg
  k.density = fuel.density;         // kg/L
  k.co2PerKg = fuel.co2PerKg;       // kg CO2 per kg fuel
  k.vLimit = (k.rpm_max * 2 * Math.PI / 60 / k.gear_ratio) * k.wheel_radius;

  k.rpmAt = (v) => v / k.wheel_radius * k.gear_ratio * 60 / (2 * Math.PI);
  k.engineRpm = (v) => Math.min(Math.max(k.rpmAt(v), k.rpm_clutch), k.rpm_max);
  k.pAvail = (v) => k.p_max * k.engineRpm(v) / k.rpm_max;
  k.resist = (v) => 0.5 * RHO_AIR * k.cda * v * v + k.crr * k.mass * G;
  k.efficiency = (rpm, load) => {
    const l = Math.min(Math.max(load, 1e-3), 1);
    const fLoad = l * (1 + k.part_load_c) / (l + k.part_load_c);
    const x = (rpm - k.rpm_best) / (k.rpm_max - k.rpm_best);
    const fRpm = Math.min(Math.max(1 - 0.35 * x * x, 0.5), 1);
    return k.eta_peak * fLoad * fRpm;
  };
  k.idleKgS = k.idle_fuel_kg_h / 3600;
  return k;
}

/**
 * Integrate fuel and energy over a measured speed trace.
 * samples: array of {t (s), v (m/s)} in time order (already smoothed).
 * Returns per-interval arrays plus totals. Engine power is capped at what the
 * engine can physically deliver, so GPS noise cannot create impossible fuel use.
 */
export function fuelFromTrace(kart, samples) {
  const n = samples.length;
  const out = { fuelG: 0, brakeJ: 0, wheelJ: 0, dragJ: 0, rollJ: 0, throttleS: 0, coastS: 0, brakeS: 0,
                fuelCumG: new Array(n).fill(0) };
  for (let i = 1; i < n; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = b.t - a.t;
    if (!(dt > 0) || dt > 10) { out.fuelCumG[i] = out.fuelCumG[i - 1]; continue; }
    const vm = 0.5 * (a.v + b.v);
    const acc = (b.v - a.v) / dt;
    const fReq = kart.mass * acc + kart.resist(vm);
    let pWheel = Math.max(fReq, 0) * vm;
    const pMaxWheel = kart.pAvail(vm) * kart.drivetrain_eff;
    pWheel = Math.min(pWheel, pMaxWheel);
    const pBrake = Math.max(-fReq, 0) * vm;
    let rate = kart.idleKgS;                       // kg/s
    if (pWheel > 5 * vm && vm > 0.5) {
      const pEng = pWheel / kart.drivetrain_eff;
      const rpm = kart.engineRpm(vm);
      const load = pEng / kart.pAvail(vm);
      rate = Math.max(pEng / (kart.efficiency(rpm, load) * kart.lhv), kart.idleKgS);
      out.throttleS += dt;
    } else if (pBrake > 20 * vm) {
      out.brakeS += dt;
    } else {
      out.coastS += dt;
    }
    const g = rate * dt * 1000;
    out.fuelG += g;
    out.fuelCumG[i] = out.fuelCumG[i - 1] + g;
    out.wheelJ += pWheel * dt;
    out.brakeJ += pBrake * dt;
    out.dragJ += 0.5 * RHO_AIR * kart.cda * vm ** 3 * dt;
    out.rollJ += kart.crr * kart.mass * G * vm * dt;
  }
  return out;
}
