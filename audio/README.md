# Папка аудио-треков

Доступные встроенные треки:

- `slow60.mp3` — трек по умолчанию (60 BPM, удобен для тестов)
- `Neon Horizon.mp3`
- `Neon Pulse.mp3`
- `Neon Velocity.mp3`
- `fastSnakes.mp3` — быстрый DRIVE

**Важно:** открывайте игру через локальный HTTP-сервер, а не двойным кликом по `index.html`:

```bash
python -m http.server 8080
```

Затем откройте `http://localhost:8080` в браузере.

Без сервера браузер блокирует и загрузку MP3 через `fetch`, и ES-модули из папки `js/`, поэтому игра не запустится.

Треки по умолчанию: `slow60.mp3` для режима RELAX, `Neon Velocity.mp3` для режима DRIVE.

---

## Промпты для Suno (новые треки под редизайн)

### RELAX — «Drift Tide» (~90–100 BPM)

```
Instrumental ambient lo-fi, 92 BPM, no vocals, soft piano and warm pad swells,
underwater feel, gentle sidechain, long reverb tails, minimal percussion (soft kick every 2 bars),
meditative and safe, no sudden drops, seamless loop-friendly, mobile game relax mode
```

**Style tags:** `ambient lo-fi, meditative, underwater, soft piano, instrumental`

**Negative:** `vocals, aggressive, EDM drop, heavy drums, sudden loud hits`

---

### DRIVE — «Commute Rage» (~128–140 BPM)

```
Instrumental hyper-casual drive track, 132 BPM, punchy four-on-the-floor kick,
distorted bass stabs, short glassy synth hits perfect for smash gameplay,
build-ups every 16 bars into short FEVER sections, energetic but not chaotic,
no vocals, mobile rhythm game, satisfying impact on every beat
```

**Style tags:** `electro house, hyper-casual, punchy, instrumental, game music`

**Negative:** `slow ballad, acoustic, long intro, vocals, jazz`

---

### Универсальный (both) — «Neon Corridor» (~110 BPM)

```
Instrumental synthwave, 110 BPM, neon arpeggios, steady groove,
works for both calm and energetic play, no vocals, clean mix for phone speakers
```

После генерации положите файлы в эту папку и добавьте запись в `js/config.js` → `TRACKS`.
