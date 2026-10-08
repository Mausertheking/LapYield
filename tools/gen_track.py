#!/usr/bin/env python3
"""Generate js/track.js (track geometry, corners, reference laps, kart model) and
js/sample.js (a real recorded session for demo mode).

Run from the eco-line-coach folder:  python3 tools/gen_track.py
Needs ../kart_sim (kart_sim.py, baku_track.csv, data_2026-10-08/gps2.csv).
"""
import json, os, sys, csv
from dataclasses import asdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
SIM = os.path.join(os.path.dirname(APP), 'kart_sim')
sys.path.insert(0, SIM)
import kart_sim as ks

LAT0, LON0 = 40.3352, 49.8388           # local projection origin (same as analysis)
R = 6371000.0
WIDTH = 12.0                            # usable track width, m
SF_HINT = (-60.0, -22.0)                # start/finish line on the pit straight (local m)
DS = 2.0

def to_latlon(x, y):
    lat = LAT0 + np.degrees(y / R)
    lon = LON0 + np.degrees(x / (R * np.cos(np.radians(LAT0))))
    return lat, lon

def proj(lat, lon):
    x = np.radians(np.asarray(lon) - LON0) * R * np.cos(np.radians(LAT0))
    y = np.radians(np.asarray(lat) - LAT0) * R
    return x, y

# ---------------- centreline ----------------
d = np.loadtxt(os.path.join(SIM, 'baku_track.csv'), delimiter=',', skiprows=1)
cx, cy, w = ks.resample_closed(d[:, 0], d[:, 1], np.full(len(d), WIDTH), DS)

# driving direction: check with the real GPS session (progress must increase)
rows = list(csv.DictReader(open(os.path.join(SIM, 'data_2026-10-08', 'gps2.csv'))))
glat = np.array([float(r['lat']) for r in rows]); glon = np.array([float(r['lon']) for r in rows])
gx, gy = proj(glat, glon)
idx = np.array([np.argmin((cx - a) ** 2 + (cy - b) ** 2) for a, b in zip(gx[40:120], gy[40:120])])
step = np.diff(idx); step = (step + len(cx) // 2) % len(cx) - len(cx) // 2
if np.median(step) < 0:
    cx, cy = cx[::-1].copy(), cy[::-1].copy()
    print('reversed centreline to match driving direction')

# put the start/finish line at index 0
i_sf = int(np.argmin((cx - SF_HINT[0]) ** 2 + (cy - SF_HINT[1]) ** 2))
cx, cy = np.roll(cx, -i_sf), np.roll(cy, -i_sf)
seg = np.hypot(np.roll(cx, -1) - cx, np.roll(cy, -1) - cy)
s_c = np.r_[0, np.cumsum(seg)[:-1]]; L = float(seg.sum())
print('centreline %.1f m, %d points' % (L, len(cx)))

# ---------------- corners ----------------
kap = ks.curvature(cx, cy, smooth=9)
thr = 1 / 30.0                           # radius < 30 m counts as a corner
mask = np.abs(kap) > thr
corners = []
i = 0; n = len(mask)
# rotate so we don't start inside a corner
start = int(np.argmin(np.abs(kap)))
order = np.roll(np.arange(n), -start)
runs = []; cur = []
for j in order:
    if mask[j]: cur.append(j)
    elif cur: runs.append(cur); cur = []
if cur: runs.append(cur)
# merge runs separated by < 12 m with same turn sign; drop tiny runs
merged = []
for r in runs:
    if merged and np.sign(kap[r[0]]) == np.sign(kap[merged[-1][-1]]) and \
       ((s_c[r[0]] - s_c[merged[-1][-1]]) % L) < 12:
        merged[-1] += r
    else:
        merged.append(list(r))
merged = [r for r in merged if len(r) * DS >= 8]
apex = [r[int(np.argmax(np.abs(kap[r])))] for r in merged]
apex_s = sorted(float(s_c[a]) for a in apex)
for k, a_s in enumerate(apex_s):
    a_i = int(round(a_s / DS)) % n
    corners.append({'id': k + 1, 'apexS': round(a_s, 1),
                    'radius': round(float(1 / max(abs(kap[a_i]), 1e-6)), 1),
                    'dir': 'L' if kap[a_i] > 0 else 'R'})
# sector boundaries = midpoints between apexes
for k, c in enumerate(corners):
    prev_s = corners[k - 1]['apexS'] - (L if k == 0 else 0)
    next_s = corners[(k + 1) % len(corners)]['apexS'] + (L if k == len(corners) - 1 else 0)
    c['s0'] = round(((prev_s + c['apexS']) / 2) % L, 1)
    c['s1'] = round(((c['apexS'] + next_s) / 2) % L, 1)
print('%d corners:' % len(corners), [(c['id'], c['dir'], c['radius']) for c in corners])

# ---------------- reference laps ----------------
kart = ks.Kart()
lx, ly, _ = ks.racing_line(cx, cy, np.full(len(cx), WIDTH), 1.0)
grid = np.arange(0, L, DS)
refs = {}
for name, drv in {'ideal': ks.Driver('ideal', 1.0, 1.0, 1.0, 1.0),
                  'eco': ks.PRESETS['eco']}.items():
    tel, summ = ks.simulate_lap(lx, ly, kart, drv)
    # project racing-line samples onto centreline arc length
    j = np.array([np.argmin((cx - a) ** 2 + (cy - b) ** 2) for a, b in zip(lx, ly)])
    sc = s_c[j]
    # unwrap to be monotonic starting at the SF line
    o = np.argsort(sc)
    v = np.interp(grid, sc[o], tel['speed_mps'][o], period=L)
    # time and fuel come straight from the simulation (racing line), indexed by
    # centreline position, so the reference lap time equals the simulated lap time
    t_rl = tel['time_s']; f_rl = tel['fuel_cum_g']
    s_u = np.unwrap(sc / L * 2 * np.pi) / (2 * np.pi) * L
    s_u -= s_u[0]
    i0 = int(np.argmin(np.abs(((sc + L / 2) % L) - L / 2)))   # racing-line sample nearest the SF line
    rl = np.roll(np.arange(len(sc)), -i0)
    s_m = np.maximum.accumulate((sc[rl] - sc[rl[0]]) % L * (np.arange(len(rl)) > 0))
    t_m = (t_rl[rl] - t_rl[rl[0]]) % summ['lap_time_s']
    f_m = (f_rl[rl] - f_rl[rl[0]]) % summ['fuel_g']
    tC = np.interp(grid, s_m, t_m); fC = np.interp(grid, s_m, f_m)
    refs[name] = {'v': np.round(v, 2).tolist(),
                  'tCum': np.round(tC, 3).tolist(),
                  'fuelCum': np.round(fC, 4).tolist(),
                  'lapTime': round(float(summ['lap_time_s']), 2),
                  'fuelG': round(float(summ['fuel_g']), 2)}
    print('%s: %.1f s, %.1f g fuel' % (name, refs[name]['lapTime'], refs[name]['fuelG']))

lat, lon = to_latlon(cx, cy)
track = {
    'id': 'baku-city-karting-2026',
    'name': 'Baku City Karting',
    'lat0': LAT0, 'lon0': LON0,
    'lengthM': round(L, 1), 'widthM': WIDTH, 'ds': DS,
    'centre': np.round(np.c_[cx, cy], 2).tolist(),
    'centreLatLon': np.round(np.c_[lat, lon], 7).tolist(),
    'corners': corners,
    'ref': refs,
    'kart': {k: v for k, v in asdict(kart).items()},
    'fuel': {'lhv': ks.FUEL_LHV, 'density': ks.FUEL_DENSITY, 'co2PerKg': ks.CO2_PER_KG_FUEL},
}
with open(os.path.join(APP, 'js', 'track.js'), 'w') as f:
    f.write('// Generated by tools/gen_track.py - do not edit by hand.\n')
    f.write('export const TRACK = ' + json.dumps(track, separators=(',', ':')) + ';\n')

# ---------------- demo session (real recording, 2026-10-08) ----------------
import datetime as dt_
t0 = None; pts = []
for r in rows:
    h, m, s = map(int, r['time'].split(':'))
    t = (h * 3600 + m * 60 + s) * 1000
    pts.append([t, float(r['lat']), float(r['lon']), 5, None])
base = int(dt_.datetime(2026, 10, 8, tzinfo=dt_.timezone.utc).timestamp() * 1000)
for p in pts: p[0] += base
sample = {'id': 'demo-2026-10-08', 'kart': '3', 'startedAt': pts[0][0], 'points': pts, 'motion': [],
          'note': 'Real phone GPS session recorded at Baku City Karting on 8 Oct 2026 (kart #3).'}
with open(os.path.join(APP, 'js', 'sample.js'), 'w') as f:
    f.write('// Real session recorded 8 Oct 2026 (Open GPX Tracker, 1 Hz). Points: [t_ms, lat, lon, accuracy_m, speed_mps]\n')
    f.write('export const SAMPLE_SESSION = ' + json.dumps(sample, separators=(',', ':')) + ';\n')
print('wrote js/track.js and js/sample.js')
