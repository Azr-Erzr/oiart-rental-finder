# OIART Rental Scoring Methodology (v2)

_Last updated: June 1, 2026. This version replaces the flat "add up 6 buckets" rubric. It documents the **graduated, honesty-first** scoring now running live in the app (`computeScore` in `app.js`) so that a person hand-scoring a **login-only site** (Facebook Marketplace, Western/Fanshawe off-campus boards, Roomies behind a login, Kijiji DMs, etc.) produces the **same number the app computes** from the Google Sheet._

Audience: anyone on the team adding or scoring listings. You do **not** need to touch code — fill the sheet fields honestly and the app scores it. This doc is for when you're on a site the app can't read and you want to sanity-check or pre-score by hand.

---

## 1. The three principles

1. **Reward what the listing actually says.** Points are graduated, not all-or-nothing. "Available now" earns something; "July-to-July" earns full marks.
2. **Never fake-penalize a blank.** If a listing is simply silent on a field (very common on login-only/DM sites), that field is marked **N/A and removed from the maths** — it does *not* score 0. Instead it raises an orange **"Confirm ___"** flag so the team knows to ask.
3. **But a missing _must-have_ caps the score.** You can't show a 90 when the price, location, or parking is invisible. Each missing must-have pulls the score down a full band and turns the score **amber or red**. This stops "looks amazing, actually a mystery" leads from rising to the top.

> The score answers: **"Of what we actually know, how good is this fit — and how much do we still need to confirm?"**

---

## 2. The score: 100 points across 7 components

| # | Component | Max | What earns the points |
|---|---|---:|---|
| 1 | Location / commute | 30 | Drive time to 502 Newbold St + neighbourhood tier |
| 2 | Cost / all-in value | 20 | Monthly cost to the student, bonus if all-inclusive |
| 3 | Parking | 10 | One outdoor spot available |
| 4 | Internet / utilities | 5 | Included vs extra |
| 5 | Privacy / housing type | 15 | Private unit/bath > private room > shared |
| 6 | Lease timing / fit | 10 | July-to-July, 12-month, student-friendly |
| 7 | Trust / clarity | 10 | Real address, direct listing, photos, no scam flags |

Parking (10) + Internet (5) together equal the old "Parking + internet = 15" bucket; they're split so each can be marked N/A independently.

### How the total is calculated

```
total = ( sum of points earned on KNOWN components )
        ────────────────────────────────────────────  × 100
        ( sum of the max of KNOWN components )
```

Then the **must-have cap** is applied (see §4). N/A components are in neither the top nor the bottom of that fraction — they're set aside, not zeroed.

---

## 3. Point rules per component (use these exact thresholds)

### 1 · Location / commute — max 30
First, classify the neighbourhood:
- **Core** (full value): Pond Mills, Glen Cairn, Deveron, Frontenac, Commissioners, White Oaks, Jalna, Ernest, Exeter, Bradley, Ashley, Millbank, Westminster, Southdale, Adelaide, Wellington, Highland, Wilkins, Baseline, Gordon, Southcrest.
- **Stretch** (capped at 26): Old South, Wortley, Grand Ave, Ridout, Brighton, Winston, Westmount, Wonderland, Garden Vista, Byron, Lambeth, Longwoods, Springbank.
- **Avoid** (capped at 14): Fanshawe, Carling, Masonville, Huron Heights, far North London, downtown core.

Then score by **drive time** (use the higher number if a range is given):

| Drive to OIART | Points |
|---|---:|
| ≤ 10 min | 30 |
| 11–15 min | 26 |
| 16–20 min | 18 |
| 21–25 min | 12 |
| > 25 min | 8 |

- If **no drive time** but the area is known: Core = 24, Stretch = 18, otherwise = 10.
- Apply the tier cap after (Avoid ≤ 14, Stretch ≤ 26).
- **N/A** only if there's **no drive time AND the area is unknown** (e.g. location just says "London"). → This is a **must-have**, so it caps the score (§4).

### 2 · Cost / all-in value — max 20
Use **Approx monthly share** = what the student actually pays per month (for a 2-bed split, that's the per-person share, not the whole rent). "All-in" = internet/utilities included.

| Monthly share | All-inclusive | Utilities extra/unknown |
|---|---:|---:|
| ≤ $900 | 20 | 18 |
| ≤ $1,000 | 19 | 16 |
| ≤ $1,150 | 14 | 14 |
| ≤ $1,300 | 11 | 11 |
| ≤ $1,500 | 8 | 8 |
| ≤ $1,800 | 5 | 5 |
| > $1,800 | 3 | 3 |

- **N/A** if no price is stated. → **Must-have**, caps the score.

### 3 · Parking — max 10
| Situation | Points / flag |
|---|---|
| Confirmed or clearly stated (yes / included / driveway / assigned / outdoor spot) | **10** |
| Available for an extra fee | **7** (amber) |
| Explicitly **no parking** / street-only | **0** (red flag) |
| Not mentioned | **N/A** → must-have, caps + "Confirm parking" |

### 4 · Internet / utilities — max 5
| Situation | Points |
|---|---:|
| Included / all-inclusive | 5 |
| Partial (e.g. hydro extra) | 3 |
| Internet extra / not included | 2 |
| Not mentioned | **N/A** → "Confirm internet" (not a must-have; no cap) |

### 5 · Privacy / housing type — max 15
| Type | Points |
|---|---:|
| Private unit: basement, studio, bachelor, 1-bed, apartment, ensuite, own/private bath, separate entrance | 15 |
| Private bedroom in a shared house | 12 |
| "Room" (shared house, privacy unclear) | 11 |
| Type stated but vague | 8 |
| **Shared bedroom** | 5 (red flag) |
| Type not stated at all | **N/A** → "Confirm room type" (not a must-have) |

### 6 · Lease timing / fit — max 10
Reward what they say; flag silence.

| What the listing states | Points |
|---|---:|
| July confirmed, OR 12-month / July-to-July | 10 |
| July / late-July start mentioned | 9 |
| Flexible / negotiable start | 7 |
| Available now / immediate / move-in ready | 7 |
| August start | 6 |
| **September only** | 4 (red flag) |
| Nothing stated about timing | **N/A** → orange "Confirm lease timing" (not a must-have) |

### 7 · Trust / clarity — max 10
Always assessable. Start at **10** and subtract:
- High scam risk: **−6**  ·  Medium scam risk: **−3**
- Only a search/source page, no direct listing URL: **−3**
- No exact address (area-only / approximate / unknown): **−2**
- No photo: **−1**
- Floor at 0.

(See the scam red-flag checklist in the main memory file §8 — two or more major flags = don't add.)

---

## 4. Must-have caps — the guardrail

**Must-haves (the "big 3"):** Location/commute, Cost, Parking.

If any are **N/A** (never stated), the score is capped one band per missing item:

| Must-haves unknown | Score capped at | Score pill colour |
|---|---:|---|
| 0 | no cap (up to 100) | 🟢 green |
| 1 | **79** | 🟠 amber ⚠ |
| 2 | **69** | 🟠 amber ⚠ (red at 2+) |
| 3 | **59** | 🔴 red ⚠ |

This is why a great-looking lead with an invisible price can't read above 79 — it's honest about the risk that the unknown turns out to be a dealbreaker.

> **Configurable:** the team can add a 4th must-have (e.g. Privacy, since a private bedroom is required, or Lease timing) by editing `CRITICAL_KEYS` in `app.js`. Default is the big-3.

---

## 5. Colour & flag legend (what you'll see in the app)

- **🟢 Green score** — all three must-haves known. Trust the number.
- **🟠 Amber score (⚠)** — one must-have unconfirmed; score is capped at 79.
- **🔴 Red score (⚠)** — two or more must-haves unconfirmed; capped at 69/59.
- **Orange "Confirm ___" chip** — that field is N/A; contact the lister to fill it in. Clearing it (and ticking the matching `…Confirmed` box in the sheet) restores the points.
- **Red chip** (e.g. "No parking", "September start", "Shared bedroom") — a stated negative, scored low on purpose.

---

## 6. Score bands → action (unchanged from §7 of the memory file)

| Score | Meaning | Action |
|---:|---|---|
| 90–100 | Top-tier | Contact immediately |
| 80–89 | Strong lead | Worth a viewing |
| 70–79 | Decent / fills a gap | Add if it covers a missing area or is a good stretch |
| 60–69 | Backup | Only if nothing better |
| < 60 | Usually cut | Unless a special reason |

Read the **colour with the number**: an amber 79 means "could be strong, but we're flying blind on a must-have — confirm before investing time." A green 75 is a known-quantity 75.

---

## 7. Worked examples

**Example A — OIART room, 15 Dow Rd**
Core area, 4-min drive (30/30), $450 all-in (20/20), parking stated yes (10/10), internet incl (5/5), private room (12/15), lease timing **not stated** → N/A, trust 9/10.
Known max = 90; earned = 86 → **96/100**. Lease isn't a must-have, so no cap. **Green**, with an orange "Confirm lease timing" chip. → Contact now, ask about July.

**Example B — Facebook room, "South London," $700, parking not mentioned**
Area core-ish but **no drive time and vague area** → location N/A. $700 → cost 16/20. Parking **not mentioned** → N/A. Internet not mentioned → N/A. Private room 12/15. Timing silent → N/A. Trust 7/10 (no exact address).
Two must-haves unknown (location, parking) → **capped at 69**, **red ⚠**. Even though the known parts are fine, the app says "too many blanks to trust." → Message to confirm address, drive time, and parking before it can rise.

**Example C — Lambeth basement, 25-min drive, $825 all-in, parking yes, own bath, July**
Stretch area, 25 min → location 12/30. $825 all-in → 19/20. Parking 10/10. Internet 5/5. Own bath → 15/15. July → 9/10. Trust ~8/10.
All must-haves known → no cap. ≈ **78/100, green.** A known, honest "decent but the commute hurts" lead.

---

## 8. Scoring login-only sites by hand

On sites the app can't read (Facebook Marketplace, Western/Fanshawe boards behind login, Roomies/Kijiji in-DM details), **capture into the sheet, don't score in your head.** The app re-scores automatically. The only discipline you need:

**Capture checklist — copy each into its sheet field:**
- `Neighbourhood` + `Address / locator` (exact address or nearest intersection if given)
- `Est drive min` — check Google Maps from **502 Newbold St** at a realistic commute time; use the higher end of a range
- `Approx monthly share` — the **per-person** monthly cost
- `Parking` — quote what they say ("driveway, 1 spot", "street only", or leave blank)
- `Internet / utilities` — included / extra / blank
- `Type` — room / basement / studio / 1-bed / 2-bed split…
- `Availability` — "July", "now", "Sept", or blank
- `URL` — the direct listing if one exists (for DM/login leads, note in `What to verify` that it's login-gated)
- `ScamRisk` — low/medium/high per the red-flag checklist

**The golden rule for blanks:** if the listing genuinely doesn't say, **leave the field empty — do not guess "Yes" to be optimistic.** An empty field becomes an honest N/A (orange flag, and a cap if it's a must-have). Guessing "Yes" fakes a high score and wastes a teammate's time later. Once you confirm a field with the lister, fill it in (and tick `ParkingConfirmed` / `InternetConfirmed` / `AddressConfirmed` / `JulyConfirmed`), and the score updates and the flag clears.

**Want a fast pre-score before you've added the row?** Walk the seven tables in §3, mark anything the listing doesn't state as N/A, total the known points over the known max, then apply the §4 cap. You'll land within a point or two of the app.

---

## 9. What changed from v1 (flat rubric)

| v1 (old) | v2 (now) |
|---|---|
| Each bucket scored 0→max; blanks guessed or scored low | Graduated points; **blanks = N/A, removed from the maths** |
| Parking + internet = one 15-pt bucket | Split into Parking (10) + Internet (5) so each can be N/A |
| Lease timing was pass/fail-ish | Graduated: 12-month/July 10 → September 4, silence = N/A |
| A vague listing could still total high | **Must-have caps**: missing location/price/parking caps at 79/69/59 |
| Score was just a number | **Traffic-light colour + ⚠** and per-field "Confirm" flags |
| Scored once by hand, went stale | **Recomputed live** from the sheet every load; manual `ScoreOverride` still wins |

---

_Source of truth is the live calculation in `app.js` (`computeScore`). If a threshold here ever disagrees with the app, the app wins — update this doc to match._
