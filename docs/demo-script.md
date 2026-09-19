# Tripwire Demonstration Script

## Before The Presentation

1. Open https://tripwire-api-4ecd.onrender.com/health and wait for `{"status":"ok"}`.
2. Open https://tripwire-api-4ecd.onrender.com/ready and confirm both checks are `ok`.
3. Open https://tripwire-eta.vercel.app and confirm **API connected** appears.
4. Confirm the healthy eight-bus network and 400.0 MW served load are visible.
5. Keep `docs/screenshots/` available as evidence if venue connectivity is poor.

The free Render instance can take 50 seconds or more to wake. Tripwire explains
this state and provides **Retry connection**, but warming the API before speaking
is the reliable presentation path.

## 0:00-0:35 - Problem And Architecture

Tripwire demonstrates how one transmission-grid outage can propagate into a
larger cascading failure. State the boundary immediately: this is a university
decision-support prototype using a synthetic teaching network, not an operational
control system.

## 0:35-1:15 - Healthy Grid And Inspection

Show the solved baseline. Identify generators, buses, loads, and transmission
lines, then select a component. Point out 400.0 MW demand, 400.0 MW served,
0.0 MW unserved, healthy status, and line loading below the 80% stress threshold.

## 1:15-2:00 - Grid Scenario Builder

Open **Edit Grid**. Briefly show component add/edit controls, validation, layout
movement, named browser scenarios, and JSON import/export. Load the saved release
scenario if available, then cancel back to the built-in topology. Explain that
custom grids use the real simulator but the current ML model deliberately rejects
modified topology.

## 2:00-2:40 - Predict Risk

Choose **Severe Cascade**. It deterministically selects `line-101` and the critical
operating profile. Click **Predict Risk**. Explain that the classifier uses only
pre-failure features; predicted load loss is a secondary estimate with substantial
documented error.

## 2:40-3:35 - Run And Replay The Cascade

Click **Run Cascade**. Step through the initial failure and each secondary trip,
then use **Replay**. Point out overloaded and failed lines, cascade depth, peak
loading, failed components, served load, and the final 100% blackout. The severe
preset reaches depth 2 and fails all 12 lines.

## 3:35-4:30 - Mitigation Comparison

Choose **Mitigation Example** and click **Run Cascade**, then **Find Mitigation**.
Explain that Tripwire simulates every bounded candidate and ranks only beneficial
outcomes. Click **Simulate Recommendation** on the top result. The deterministic
example changes total load loss from 100% to 5% through 25 MW controlled shedding,
a 95 percentage-point improvement, while leaving involuntary unserved load at zero.

## 4:30-5:00 - Evidence And Limitations

Summarize the verified pipeline: pandapower AC power flow, deterministic cascade,
3,000 synthetic scenarios, scikit-learn models, and simulation-based mitigation.
State the limitations: synthetic grid and data, simplified protection behavior,
weak load-loss regression, no utility validation, and no operational use. Finish
with **Reset** to return to the healthy baseline.

## Backup Flow

- If the API is waking, show `docs/screenshots/01-healthy-grid.png` and wait for
  `/health` before using **Retry connection**.
- If mitigation is slow, use `10-mitigation-recommendation.png` and
  `11-before-after-comparison.png` while explaining the candidate simulations.
- If time is reduced, omit live grid editing and show `04-custom-grid.png`.
- Do not claim that prediction or mitigation results generalize to real grids.
