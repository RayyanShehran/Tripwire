# Tripwire Demo Script

## Before The Presentation

1. Open https://tripwire-api-4ecd.onrender.com/health.
2. If the Render instance is sleeping, wait for `{"status":"ok"}`.
3. Open https://tripwire-api-4ecd.onrender.com/ready and confirm both checks are `ok`.
4. Open https://tripwire-eta.vercel.app and confirm **API connected** appears.
5. Begin the presentation only after the solved eight-bus network is visible.

The free Render instance can take 50 seconds or more to wake. Tripwire now shows
**Starting simulation backend...** with a retry control during this period, but
waking the service before the presentation remains the most reliable demo flow.

## 0:00-0:30 - Problem

Tripwire demonstrates how a single transmission-grid outage can propagate into broader cascading failures. The project is a university decision-support prototype, not an operational control tool.

## 0:30-1:00 - Healthy Grid

Start with the solved baseline grid. Point out generators, buses, loads, and transmission lines. Show the status legend and the top metrics: served load, unserved load, failed components, and maximum line loading.

## 1:00-1:45 - Predict Risk

Load the **Severe Cascade** demo preset. Tripwire selects `line-101` and applies the deterministic stressed operating condition. Click **Predict Risk** and explain that the ML model uses pre-failure features only. Show cascade probability, predicted load loss, and risk level.

## 1:45-2:30 - Run Cascade

Click **Run Cascade**. Play the timeline and step through the initial failure and secondary failure rounds. Show overloaded lines, failed components, cascade depth, and actual load lost.

## 2:30-3:15 - Mitigation

Load or keep the **Mitigation Example** preset. Click **Find Mitigation**. Explain that Tripwire simulates bounded redispatch and load-shedding candidates, then ranks only beneficial outcomes. Use **Simulate Recommendation** to replay the top recommendation and compare before/after load loss.

## 3:15-4:00 - Methodology And Limits

Open the methodology/help section in the side panel or reference the README. Summarize the pipeline: pandapower power flow, deterministic cascade simulation, synthetic dataset generation, scikit-learn prediction, and simulation-based mitigation. State limitations clearly: synthetic grid, synthetic training data, no utility validation, and not for operational deployment.

## Backup Flow

If the severe preset takes too long to recommend mitigation live, show the already completed cascade summary first, then run **Find Mitigation** while explaining the candidate search. The recommendation endpoint is the slowest demo operation because it runs multiple simulations.

If the API is still waking, open `/health` in another tab and wait for the JSON
response, then use **Retry connection** in Tripwire. Do not start the scenario
demonstration while the header still says **Backend starting**.
