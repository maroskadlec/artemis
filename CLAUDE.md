# Artemis Tracker — kontext pro Claude

Jednoduchá PWA aplikace zobrazující aktuální vzdálenost kosmické lodě Orion (mise Artemis) od Země a od Měsíce. Data pochází z NASA JPL Horizons API v reálném čase.

---

## Struktura projektu

```
Artemis/
├── public/              # Statické soubory servírované prohlížeči
│   ├── index.html       # Celá UI aplikace (HTML + CSS + JS v jednom souboru)
│   ├── manifest.json    # PWA manifest (název, ikona, display mode)
│   └── icon.png         # Ikona 1024×1024 px (RGBA PNG) pro plochu telefonu
├── api/
│   └── distance.js      # Vercel serverless funkce — proxy na NASA Horizons API
├── server.js            # Lokální dev server (Node.js, žádné závislosti)
├── STYLES.md            # Zdrojový design systém (přenesený z MoneyApp)
└── CLAUDE.md            # Tento soubor
```

Soubory `index.html`, `manifest.json` a původní PNG ikonka existují také v kořeni složky jako pracovní kopie z doby vývoje — kanonická verze je v `public/`.

---

## Jak spustit lokálně

```bash
node server.js
# → http://localhost:3000
```

Žádný `npm install` není potřeba — server.js používá pouze vestavěné Node.js moduly (`http`, `https`, `fs`, `path`).

---

## Deployment (Vercel)

Repozitář: `https://github.com/maroskadlec/artemis.git`

Vercel automaticky detekuje:
- `public/` → statické soubory na `/`
- `api/distance.js` → serverless funkce na `/api/distance`

Každý push do větve `main` spustí automatický redeploy.

---

## Datový zdroj: NASA JPL Horizons API

**URL:** `https://ssd.jpl.nasa.gov/api/horizons.api`

Veřejné API bez nutnosti klíče. Vrací efemeridy kosmických těles.

### Proč proxy server (api/distance.js)?

NASA Horizons API **neposílá CORS hlavičky** (`Access-Control-Allow-Origin` chybí). Přímý `fetch()` z prohlížeče je proto zablokován. Serverless funkce / server.js funguje jako proxy — volá Horizons server-side a výsledek přeposílá do browseru.

### Klíčové parametry dotazu

| Parametr | Hodnota | Poznámka |
|---|---|---|
| `COMMAND` | `-1024` nebo `-64` | NAIF ID spacecraft (viz níže) |
| `EPHEM_TYPE` | `OBSERVER` | Typ efemerid |
| `QUANTITIES` | `20` | Observer range — vzdálenost v AU + rychlost v km/s |
| `CENTER` | `500@399` | Střed = geocentrum Země |
| `CENTER` | `500@301` | Střed = střed Měsíce |

**Důležité:** `QUANTITIES=19` vrací vzdálenost od **Slunce** (ne od Země). Správná hodnota pro vzdálenost pozorovatele je `QUANTITIES=20` (pole `delta` v AU).

### Parsování odpovědi

Odpověď je JSON s polem `result` (string). Vzdálenost se nachází v bloku mezi `$$SOE` a `$$EOE`:

```
$$SOE
 2026-Apr-02 12:00     0.00051143126023   0.0279930
$$EOE
```

- Sloupec 3 (index 2 po split): `delta` v AU → převod `× 149 597 870,7` = km
- Sloupec 4: `deldot` v km/s (rychlost; v aplikaci nevyužito)

---

## Spacecraft NAIF IDs

| ID | Mise | Poznámka |
|---|---|---|
| `-1024` | Artemis II (Orion) | Aktivní od 1. 4. 2026, první crewed lunar flyby od Apollo 17 |
| `-64` | Artemis I (Orion) | Dokončena prosinec 2022, fallback |

Kód zkouší IDs postupně (`CANDIDATE_IDS`) — první, pro které Horizons vrátí platná data, vyhraje. Při budoucích misích stačí přidat nové ID na začátek pole.

### Jak zjistit NAIF ID nové mise

1. Jdi na `https://ssd.jpl.nasa.gov/horizons/app.html`
2. Do pole Target Body zadej název mise (např. "Artemis III")
3. ID je číslo v závorce v názvu výsledku, typicky záporné

---

## API endpoint

### `GET /api/distance`

Vrací aktuální vzdálenost spacecraft od Země a Měsíce.

**Úspěšná odpověď (200):**
```json
{
  "spacecraftId": "-1024",
  "earthKm": 76432,
  "moonKm": 389105,
  "fetchedAt": "2026-04-02T14:00:00.000Z"
}
```

**Chybová odpověď (404) — žádná aktivní mise:**
```json
{ "error": "no_active_mission" }
```

---

## UI (public/index.html)

Celá aplikace je jeden HTML soubor bez závislostí (kromě Google Fonts — Inter).

### Design systém

Přenesen ze souboru `STYLES.md` (původně MoneyApp). Klíčové tokeny:

| Token | Hodnota | Použití |
|---|---|---|
| `--glass` | `#F3F5F7` | Pozadí karet |
| `--glass-border` | `#DCE0E3` | Border karet |
| `--text` | `#181E25` | Primární text |
| `--accent` | `#01FF94` | Zelená — živý stav, thruster glow |
| `--warn` | `#ff9500` | Oranžová — varování |
| `--radius` | `24px` | Zaoblení karet |
| `--font` | Inter | Systémový fallback sans-serif |

### SVG vizualizace

Inline SVG (viewBox `0 0 432 160`) znázorňuje trasu Země → Měsíc.

- **Země** (cx=56): dvě překrývající se kružnice + radialGradient + atmosférická aura
- **Měsíc** (cx=376): kružnice + radialGradient + 4 krátery
- **Spacecraft** (`<g id="spacecraft">`): obdélníkové tělo + solární panely + tryska se zeleným glowem
- Spacecraft se pohybuje po trase JS voláním `setAttribute('transform', 'translate(x, 80)')`, kde `x` je lineárně interpolováno z `earthKm / EARTH_MOON_KM` do rozsahu px 88–352
- Progress bar pod každou kartou ukazuje polohu vůči průměrné vzdálenosti Země–Měsíc (384 400 km)

### Stavy aplikace

| Stav | Dot barva | Chování |
|---|---|---|
| Načítání | šedá | shimmer animace na hodnotách |
| Živá data | `#01FF94` zelená | hodnoty + čas aktualizace |
| Žádná mise | `#ff9500` oranžová | alert s vysvětlením |
| Chyba sítě | `#ff3b30` červená | alert "Spusťte: node server.js" |

---

## PWA (Progressive Web App)

- `public/manifest.json` — název "Artemis Tracker", short_name "Artemis", display `standalone`, theme `#181E25`
- `public/icon.png` — 1024×1024 RGBA PNG, purpose `any maskable`
- Meta tagy v HTML pro iOS Safari (`apple-touch-icon`, `apple-mobile-web-app-*`)

**Instalace na telefon:**
- iOS: Safari → Sdílet → Přidat na plochu
- Android: Chrome → ⋮ → Nainstalovat aplikaci

Telefon musí být na stejné Wi-Fi jako počítač se serverem (nebo použít Vercel URL).

---

## Časté situace při údržbě

**Mise skončila, data se nezobrazují:**
Přidat NAIF ID nové aktivní mise na začátek `CANDIDATE_IDS` v `server.js` i `api/distance.js`.

**Horizons vrací jiný formát dat:**
Zkontrolovat parsovací funkci `parseRange()` — hledá první číslo > 0 a < 10 (v AU) na řádku za datumem a časem v bloku `$$SOE`/`$$EOE`.

**Vercel build selže:**
Zkontrolovat, zda `api/distance.js` exportuje funkci jako `module.exports = (req, res) => {...}` (Vercel Node.js serverless formát).
