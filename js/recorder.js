// GPS + motion recorder with screen wake lock, auto start/stop and crash-safe autosave.
import { saveSession } from './storage.js';

const AUTO_START_SPEED = 10 / 3.6;   // m/s
const AUTO_START_FIXES = 3;
const STOP_SPEED = 1.5;              // m/s
const AUTO_STOP_SECONDS = 45;
const AUTO_STOP_MIN_DISTANCE = 400;  // m driven before auto-stop is allowed
const AUTOSAVE_MS = 5000;
const MOTION_HZ = 10;

export class Recorder {
  constructor({ onFix, onState, onWakeLock, onMotion } = {}) {
    this.onFix = onFix || (() => {});
    this.onState = onState || (() => {});
    this.onWakeLock = onWakeLock || (() => {});
    this.onMotion = onMotion || (() => {});
    this.watchId = null;
    this.state = 'idle';           // idle -> warming -> armed -> recording -> finished
    this.session = null;
    this.lastFix = null;
    this.fastFixes = 0;
    this.stoppedSince = null;
    this.distance = 0;
    this.wakeLock = null;
    this.motionOn = false;
    this.lastMotionT = 0;
    this._onVisibility = () => { if (document.visibilityState === 'visible' && this.wantWake) this.requestWakeLock(); };
    this._onMotion = (e) => this.handleMotion(e);
  }

  // ---- permissions (call from a tap handler) ----
  static async requestMotionPermission() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        return (await DeviceMotionEvent.requestPermission()) === 'granted';
      }
      return typeof DeviceMotionEvent !== 'undefined';
    } catch (e) { return false; }
  }

  async requestWakeLock() {
    this.wantWake = true;
    if (!('wakeLock' in navigator)) { this.onWakeLock(false); return false; }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.onWakeLock(false); });
      document.addEventListener('visibilitychange', this._onVisibility);
      this.onWakeLock(true);
      return true;
    } catch (e) { this.onWakeLock(false); return false; }
  }

  releaseWakeLock() {
    this.wantWake = false;
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
  }

  // ---- GPS warm-up: start watching so the user sees accuracy before driving ----
  startGps() {
    if (!('geolocation' in navigator)) { this.setState('nogps'); return false; }
    if (this.watchId != null) return true;
    this.setState('warming');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handleFix(pos),
      (err) => { this.onFix(null, err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    return true;
  }

  startMotion() {
    if (this.motionOn || typeof window.DeviceMotionEvent === 'undefined') return;
    window.addEventListener('devicemotion', this._onMotion);
    this.motionOn = true;
  }

  // ---- arm: create the session; recording begins automatically when the kart moves ----
  arm({ kart } = {}) {
    const now = Date.now();
    this.session = { id: 's-' + now, startedAt: now, kart: kart || '', status: 'recording',
                     points: [], motion: [], recordingFrom: null, app: 'lapyield/1' };
    this.distance = 0; this.fastFixes = 0; this.stoppedSince = null;
    this.setState('armed');
    this.autosaveTimer = setInterval(() => this.autosave(), AUTOSAVE_MS);
    this.autosave();
  }

  handleFix(pos) {
    const c = pos.coords;
    const p = [pos.timestamp || Date.now(), c.latitude, c.longitude,
               c.accuracy != null ? Math.round(c.accuracy * 10) / 10 : null,
               c.speed != null && c.speed >= 0 ? Math.round(c.speed * 100) / 100 : null];
    // fall back to position-derived speed for the state machine when Doppler speed is missing
    let v = p[4];
    if (v == null && this.lastFix) {
      const dt = (p[0] - this.lastFix[0]) / 1000;
      if (dt > 0) v = haversine(this.lastFix, p) / dt;
    }
    const s = this.session;
    if (s && (this.state === 'armed' || this.state === 'recording')) {
      if (this.lastFix && p[0] > this.lastFix[0]) this.distance += haversine(this.lastFix, p);
      s.points.push(p);
      if (this.state === 'armed') {
        this.fastFixes = (v != null && v > AUTO_START_SPEED) ? this.fastFixes + 1 : 0;
        if (this.fastFixes >= AUTO_START_FIXES) { s.recordingFrom = p[0]; this.distance = 0; this.setState('recording'); }
      } else if (this.state === 'recording') {
        if (v != null && v < STOP_SPEED) {
          this.stoppedSince = this.stoppedSince || p[0];
          if ((p[0] - this.stoppedSince) / 1000 > AUTO_STOP_SECONDS && this.distance > AUTO_STOP_MIN_DISTANCE) this.finish('auto');
        } else this.stoppedSince = null;
      }
    }
    this.lastFix = p;
    this.onFix({ t: p[0], lat: p[1], lon: p[2], accuracy: p[3], speed: v, distance: this.distance });
  }

  handleMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const t = Date.now();
    if (t - this.lastMotionT < 1000 / MOTION_HZ) return;
    this.lastMotionT = t;
    this.onMotion(true);
    if (this.session && (this.state === 'armed' || this.state === 'recording'))
      this.session.motion.push([t, round2(a.x), round2(a.y), round2(a.z)]);
  }

  async autosave() { if (this.session) { try { await saveSession(this.session); } catch (e) { /* keep going */ } } }

  async finish(reason = 'manual') {
    if (!this.session || this.state === 'finished') return null;
    this.setState('finished');
    clearInterval(this.autosaveTimer);
    this.session.status = 'finished';
    this.session.endedAt = Date.now();
    this.session.stopReason = reason;
    await this.autosave();
    this.stopSensors();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
    return this.session;
  }

  stopSensors() {
    if (this.watchId != null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    if (this.motionOn) { window.removeEventListener('devicemotion', this._onMotion); this.motionOn = false; }
    this.releaseWakeLock();
  }

  cancel() {
    clearInterval(this.autosaveTimer);
    this.stopSensors();
    this.session = null;
    this.setState('idle');
  }

  setState(s) { this.state = s; this.onState(s); }
}

function round2(x) { return Math.round(x * 100) / 100; }
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[2] - a[2]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
