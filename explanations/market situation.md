# Market Situation Dashboard: Terms, Calculations and Examples

This guide explains every number and label on the **Market situation** card and the **bucket tiles** below it. All numbers in the examples come from the real data for **2026‑10‑16, Largecap, EMA20** (the screenshot you shared).

Source code: [mbi/metrics.py](../mbi/metrics.py) (the numbers), [mbi/classifier.py](../mbi/classifier.py) (the state), [data/config/regime_config.json](../data/config/regime_config.json) (all thresholds), [web/components/MarketStateCard.tsx](../web/components/MarketStateCard.tsx) and [web/components/charts/KpiTile.tsx](../web/components/charts/KpiTile.tsx) (the UI).

---

## 1. The big picture

The dashboard answers one question: **"What is the mood of the market today, and what kind of trades suit it?"**

It does this with only **two breadth measures**, both computed from the top 1000 NSE stocks:

| Measure | Short name | Question it answers |
|---|---|---|
| % of stocks above their EMA | **P** | Is the market in an uptrend or a downtrend? (direction) |
| Volume Ratio | **VR** | How much demand or panic is there today? (participation / intensity) |

A small rule table combines P and VR (plus a 5‑day trend, **dP**) into one of **six market situations**. A 2‑day smoothing filter then stops the label from flipping on one noisy day.

```
 daily prices + volumes
        |
        v
  per stock: valid? above EMA? high / low volume?
        |
        v
  per bucket: P (% above EMA)   VR (high-vol count / low-vol count)
        |
        v
  dP = P today - P five sessions ago
        |
        v
  classify(VR, P, dP) -> raw state ---> smoothing (2 days) ---> confirmed state + playbook
```

---

## 2. Buckets (the pills and tiles)

The universe is the **top 1000 NSE stocks by market cap**, split into rank buckets:

| Bucket | Rank | Stocks |
|---|---|---|
| Largecap | 1–100 | 100 |
| Midcap | 101–250 | 150 |
| Smallcap | 251–500 | 250 |
| Microcap | 501–750 | 250 |
| Nanocap | 751–1000 | 250 |
| **ALL (1000)** | 1–1000 | ~1000 |

Each bucket is computed **independently** with its own counts. ALL is a count over all stocks, **not** an average of the five bucket percentages.

**Valid stocks** (`valid 100 / 100`, `valid 249 / 250`, `valid 982 / 1001`): only valid stocks are counted. A stock is excluded for the day if any of these is true:

- it did not trade that day;
- it has fewer than 50 sessions of history (the EMA50 would be unreliable);
- its close moved by more than a factor of 0.6 to 1.6 versus the previous close, which suggests an unadjusted split or bonus;
- it has no 20‑day average volume.

*Example:* Nanocap shows `valid 234 / 250`, so 16 stocks were excluded that day and P and VR are computed from the other 234.

---

## 3. P: "% above EMA" (direction)

### 3.1 EMA (Exponential Moving Average)
A moving average that weights recent prices more heavily. The number is the **span**: EMA10 reacts fast, EMA20 is medium, EMA50 is slow.

```
alpha    = 2 / (span + 1)          EMA20: alpha = 2/21 = 0.0952
EMA_today = alpha * close_today + (1 - alpha) * EMA_yesterday
```

It is computed on **split‑adjusted closes**, over a rolling window of the last 320 sessions, so the result for a date is the same whether you run `daily` or `recompute`.

### 3.2 P (the "% above EMA20 (P)" value)

```
P = 100 x (number of valid stocks with close > EMA) / (number of valid stocks)
```

*Example (Largecap, EMA20, 2026‑10‑16):* 35 of the 100 valid stocks closed above their own EMA20, so **P = 35.0%**.

How to read it:

| P | Meaning |
|---|---|
| high (60% and above) | most stocks in an uptrend, strong market |
| middle (40–60%) | mixed market |
| low (below 40%) | most stocks below their average, weak market |

### 3.3 The three EMA boxes on each tile
Each tile shows P for EMA10, EMA20 and EMA50, with the **change versus the previous session** underneath. The EMA you picked in the header (EMA 20 here) is highlighted, and that is the one used for the state.

*Example (Largecap tile):*

| | EMA10 | EMA20 | EMA50 |
|---|---|---|---|
| P today (10‑16) | 50% | 35% | 25% |
| P yesterday (10‑15) | 54% | 32% | 24% |
| Shown change | −4.0 | +3.0 | +1.0 |

Reading: short‑term (EMA10) breadth slipped, while the medium and slow breadth improved a little. Because EMA10 is the fastest, it is the most volatile of the three.

---

## 4. VR: Volume Ratio (participation, demand versus panic)

### 4.1 Relative volume (per stock)
Each stock's volume today is compared with its own normal volume:

```
avgvol20 = average volume of the 20 sessions BEFORE today (today excluded by default)
rel_vol  = volume_today / avgvol20
```

(The "include today in average" option is a config flag, `include_today_in_avg`, default off.)

*Example:* a stock averaged 10 lakh shares over the previous 20 days and traded 16 lakh today. `rel_vol` = 1.6, so it counts as high.

### 4.2 High and low volume stocks

| Class | Rule | Meaning |
|---|---|---|
| **High volume** | `rel_vol >= 1.5` | unusually heavy trading, at least 1.5× normal |
| **Low volume** | `rel_vol < 0.5` | unusually quiet, less than half of normal |
| (neither) | `0.5 <= rel_vol < 1.5` | ordinary, not counted |

### 4.3 The ratio

```
VR = N_high / N_low
```

*Example (Largecap, 2026‑10‑16):* the card says **"22 high / 3 low volume"**, so VR = 22 / 3 = **7.33**.

If `N_low = 0`, the ratio is undefined and shown as `null` (the tile then shows "–" with the counts). The classifier treats a null VR as the **high** zone.

### 4.4 Volume regime labels (the text under the big VR number)

| VR | Label | Plain English |
|---|---|---|
| below 0.25 | Extreme low demand / fear | almost nobody is active |
| 0.25 – 0.50 | Choppy and muted | the most common state, nothing happening |
| 0.50 – 0.70 | Improving, tradable | participation is returning |
| 0.70 – 1.00 | Building demand | more active than quiet stocks, nearly even |
| 1.00 – 2.00 | High‑demand phase | clearly more heavy‑volume stocks than quiet ones |
| 2.00 and above | Extreme excess / climax | a blow‑off or capitulation day |

*Examples from your screenshot:*

| Bucket | VR | Label |
|---|---|---|
| Largecap | 7.33 | Extreme excess / climax |
| Midcap | 0.68 | Improving, tradable |
| Smallcap | 0.33 | Choppy and muted |
| Nanocap | 0.12 | Extreme low demand / fear |

### 4.5 The small number next to VR (e.g. `+2.58`) and the sparkline
The change is **VR today minus VR on the previous session**. For Largecap, VR was 4.75 on 10‑15, so 7.33 − 4.75 = **+2.58**. The sparkline under it is the VR of the last 30 sessions, drawn on its own min‑to‑max scale (so compare shapes, not heights, between tiles). The second sparkline, under the EMA boxes, is the same for P of the selected EMA.

---

## 5. dP: the 5‑session trend of P

```
dP = P_today - P_five_sessions_ago        (window = 5, from config "trend.dp_window")
```

*Example:* Largecap EMA20 P was 15% on 2026‑10‑09 and is 35% on 2026‑10‑16 (five sessions later), so **dP = +20.0**. Breadth has risen sharply.

`dP` only matters in a few rule cells (see §6.3). If it can't be computed (not enough history), it is treated as `0`.

---

## 6. How the state is decided

### 6.1 The six states

| Code | Name | Meaning | Focus (playbook) |
|---|---|---|---|
| **BD** ▲ | Bullish Domination | Stocks move upward easily | Breakouts, gaps, strong‑structure reversal setups |
| **LD** ◇ | Lack of Demand | No strong demand; stocks fail to follow through | Intraday breakouts, shorting gaps, reversals and pullbacks |
| **EU** ✦ | Euphoria / Overheated Market | Highly extended; breakouts may fail | Parabolic shorts, gap‑up shorts, playing the index trend |
| **BR** ▼ | Bearish Domination | Majority of stocks are falling | Short setups, stocks entering stage 4 |
| **LS** ◆ | Lack of Supply | Sellers pausing after a strong decline | Resilient stocks that are not falling further; breakouts from strong structures |
| **PA** ✖ | Panic / Overheated Decline | Oversold, bottoming situation | Reversals; parabolic long setups in strong‑structure or declining stocks |

The coloured bar at the top of the card, the badge, and the **Playbook** box all come from this table.

### 6.2 Zones

**P zones** (lower edge inclusive, so exactly 40.0 falls in the upper zone):

| Zone | P range |
|---|---|
| VL (very low) | below 20 |
| L (low) | 20 to below 40 |
| M (middle) | 40 to below 60 |
| H (high) | 60 to below 80 |
| VH (very high) | 80 and above |

**VR zones:**

| Zone | VR range |
|---|---|
| low | below 0.5 |
| mid | 0.5 to below 1.0 |
| high | 1.0 and above |

### 6.3 Classification order

For each bucket, each day, and each EMA, `classify()` runs these steps **in order** and stops at the first one that fires:

1. **Panic override:** if `VR >= 2.0` **and** `P < 30` → **PA**.
   A volume climax while most stocks are already below the average is treated as capitulation.
2. **Euphoria override:** if `P >= 80` → **EU**.
3. **Rule table:** look up the cell `P zone × VR zone`:

| P zone ↓ \ VR zone → | low (below 0.5) | mid (0.5 to 1.0) | high (1.0 and above) |
|---|---|---|---|
| **VH** | EU | EU | EU |
| **H** | LD | BD | BD |
| **M** | LD | LD, or **BD** if VR ≥ 0.7 **and** dP > 0 | BD |
| **L** | LS, or **BR** if dP < 0 | BR | BR |
| **VL** | LS | BR | PA |

The "or" cells are the only ones that use dP, to separate "improving" from "still deteriorating".

The card's **Rule** field shows which cell fired, for example `L × high`. A `(trend condition met)` suffix means the alternative state was chosen.

### 6.4 Worked example: why Largecap is BR today

Inputs (2026‑10‑16, Largecap, EMA20): **P = 35.0, VR = 7.33, dP = +20.0**.

1. Panic override? VR ≥ 2.0 is true, but P < 30 is **false** (35 is not below 30). Not fired.
2. Euphoria override? P ≥ 80 is false. Not fired.
3. P zone: 35 lies in 20 to 40, so **L**. VR zone: 7.33 ≥ 1.0, so **high**.
4. Table cell `L × high` = **BR**. This cell has no trend condition, so dP is not used.

Result: **BR · Bearish** with rule **"L × high"**, which is what the card shows. The playbook text "Majority of stocks are falling / Short setups, stocks entering stage 4" is the BR entry from §6.1.

Reading it in plain English: only 35% of large caps are above their EMA20 (weak), and today's volume is highly active (22 stocks surging versus 3 quiet). Heavy volume in a weak market means active selling, not buying, so it's "bearish domination".

### 6.5 More examples (varied inputs)

| P | VR | dP | Step that fires | State |
|---|---|---|---|---|
| 10 | 8.0 | −2 | Panic override (VR ≥ 2, P < 30) | **PA** (this was Largecap on 10‑08) |
| 85 | 0.3 | any | Euphoria override | **EU** |
| 55 | 1.4 | any | Table `M × high` | **BD** |
| 55 | 0.8 | +3 | Table `M × mid`, VR ≥ 0.7 and dP > 0 | **BD** (trend condition met) |
| 55 | 0.8 | −3 | Table `M × mid`, condition fails | **LD** |
| 25 | 0.3 | +4 | Table `L × low`, dP not negative | **LS** |
| 25 | 0.3 | −4 | Table `L × low`, dP < 0 | **BR** (trend condition met) |
| 15 | 0.4 | any | Table `VL × low` | **LS** |
| 15 | 1.2 | any | Table `VL × high` (VR below 2, so no panic override) | **PA** |

### 6.6 Smoothing: "4 session(s) in state" and "show raw state"

The raw state can flicker day to day around a boundary. To avoid whipsaws, a **new state is confirmed only after it appears for 2 consecutive sessions** (`confirm_days = 2`).

- **Raw state:** the direct output of `classify()` that day (tick "show raw state" to see it).
- **Confirmed state:** the smoothed state the badge shows by default.
- **Sessions in state:** how many sessions the confirmed state has lasted. When a change is confirmed, the counter resets to 1 and counts from the first day of the new run.
- If the raw state differs from the confirmed one, the card adds *"raw today: X (awaiting confirmation)"*.

*Real Largecap EMA20 sequence:*

| Date | P | VR | Raw state | Confirmed state | Days in state | What happened |
|---|---|---|---|---|---|---|
| 10‑09 | 15 | 1.00 | PA | PA | 8 | PA continuing |
| 10‑12 | 15 | 0.70 | BR | **PA** | 9 | BR appears once, not yet confirmed |
| 10‑13 | 27 | 1.00 | BR | **BR** | 1 | BR appears a 2nd day in a row, so the change is confirmed |
| 10‑14 | 30 | 5.00 | BR | BR | 2 | P is now 30, so the panic override no longer applies |
| 10‑15 | 32 | 4.75 | BR | BR | 3 | |
| 10‑16 | 35 | 7.33 | BR | BR | **4** | today's card: "4 session(s) in state" |

Note the lag: the market was moving out of oversold territory, yet the label stayed PA for one extra day (10‑12) because confirmation needs 2 days. This is the cost of the filter.

### 6.7 The `?` button next to the badge
Hover text that spells out the calculation in one line, for example:
`P(EMA20) = 35.0%, VR = 7.33, dP = +20.0, rule: L × high → Bearish`.

---

## 7. Reading the tiles (bottom row) together

For your 2026‑10‑16 screenshot, EMA20:

| Bucket | State | VR | VR regime | P (EMA20) | Interpretation |
|---|---|---|---|---|---|
| Largecap | BR ▼ | 7.33 | Climax | 35% | very heavy volume, weak breadth: selling pressure |
| Midcap | BR ▼ | 0.68 | Improving | 35% | weak breadth, volume recovering but not yet strong |
| Smallcap | LS ◆ | 0.33 | Choppy | 31% | weak breadth, sellers pausing, little activity |
| Microcap | LS ◆ | 0.38 | Choppy | 33% | same |
| Nanocap | LS ◆ | 0.12 | Fear | 35% | almost no activity, sellers pausing |
| ALL | LS ◆ | 0.37 | Choppy | 33% | overall quiet, weak breadth |

The big picture: **breadth is weak everywhere (P around 31–35%)**, but only Largecap and Midcap show an active "BR" mood. The smaller caps are in a muted "Lack of Supply" pause. Note that Smallcap with P = 31, VR = 0.33 and a 5‑session dP of +12.9 lands in `L × low`; because dP is not negative, it resolves to LS rather than BR. (Don't confuse this dP with the small "+2.8" under the tile's EMA20 box, which is only the change since yesterday.)

Mid and Small caps use the **same thresholds** as Largecap, even though their volume behaviour differs a lot (that is why Nanocap VR is so low). Compare each bucket against its own history, not against other buckets.

---

## 8. Other header items

| Item | Meaning |
|---|---|
| **Session 2026‑10‑16** | the latest trading day computed in the history |
| **Universe 2026‑10‑10** | the date of the stock list version in use (rebuilt every 6 months after the June and December reconstitutions) |
| **Data OK** | data quality badge; the day's data came from NSE bhavcopy without problems |
| **EMA 10 / 20 / 50** | which EMA span drives the card, badges and state (the tiles always show all three) |
| **Refresh data** | fetches any sessions not yet downloaded, recomputes and reclassifies (NSE publishes the bhavcopy after about 6:30 PM IST) |

---

## 9. Quick glossary

| Term | Definition |
|---|---|
| **EMA** | exponential moving average of the close; faster for a smaller span |
| **P** | % of valid stocks closing above their EMA |
| **dP** | P today minus P five sessions ago |
| **rel_vol** | a stock's volume today ÷ its 20‑day average volume (today excluded) |
| **High / Low volume stock** | rel_vol ≥ 1.5 / rel_vol < 0.5 |
| **VR** | (# high‑volume stocks) ÷ (# low‑volume stocks) |
| **Valid** | a stock that is traded, has ≥ 50 sessions of history, no suspected split error and has an average volume |
| **Bucket** | rank‑based group: Largecap, Midcap, Smallcap, Microcap, Nanocap, plus ALL |
| **Override** | a rule that wins before the table: panic (VR ≥ 2, P < 30) and euphoria (P ≥ 80) |
| **Raw vs confirmed state** | the same‑day classification vs the state after 2‑day confirmation |
| **Sessions in state** | the length of the current confirmed run |
| **Playbook** | the plain‑English meaning and suggested focus for the state |

---

## 10. Things to keep in mind

- **All thresholds are editable** in the **Config** page or in `data/config/regime_config.json`. After changing them, run `python -m mbi recompute` to reclassify the full history. Prices and the P and VR values do not change, only the labels.
- **The state is a description, not a signal.** It tells you the current conditions, and the playbook is a suggestion on what setups fit.
- **Boundary sensitivity:** zones have hard edges, so a P of 39.9 and 40.1 give different table rows. Treat values close to an edge (for example P within a couple of points of 20, 40, 60 or 80, or VR near 0.5 or 1.0) as borderline. The config has a `boundary_margin` (P ± 2, VR ± 0.05) intended for this, but the current code does not use it yet, so nothing is flagged automatically.
- **VR on a thin tier is noisy:** with 100 Largecap stocks, a swing from 3 to 2 low‑volume stocks changes VR by 50% (22/3 = 7.33 versus 22/2 = 11). Large VR numbers in small buckets reflect small denominators.
