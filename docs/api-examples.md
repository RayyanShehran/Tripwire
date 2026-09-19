# API Demo Examples

Use these concise examples while the backend is running at `http://127.0.0.1:8000`.

## GET /api/grid

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/grid
```

Response shape:

```json
{
  "nodes": [{"id": "bus-0", "name": "North Hub", "type": "bus", "status": "healthy"}],
  "lines": [{"id": "line-101", "source": "bus-0", "target": "bus-1", "loading_percent": 42.1}],
  "metrics": {"total_demand_mw": 400.0, "served_load_mw": 400.0, "load_lost_percent": 0.0}
}
```

## GET /api/demo-presets

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/demo-presets
```

Response shape:

```json
{
  "presets": [
    {
      "id": "severe-cascade",
      "initial_failure": {"component_type": "line", "component_id": "line-101"},
      "expected_outcome": {"cascade_depth": 2, "load_lost_percent": 100.0}
    }
  ]
}
```

## Custom grid definition endpoints

```powershell
$definition = (Invoke-RestMethod http://127.0.0.1:8000/api/grid/definition).grid_definition

Invoke-RestMethod http://127.0.0.1:8000/api/grid/validate `
  -Method Post -ContentType "application/json" `
  -Body (@{ grid_definition = $definition } | ConvertTo-Json -Depth 20)

Invoke-RestMethod http://127.0.0.1:8000/api/grid/solve `
  -Method Post -ContentType "application/json" `
  -Body (@{ grid_definition = $definition; operating_condition = @{ load_multiplier = 1; generation_multiplier = 1; line_rating_multiplier = 1; dispatch_profile = "balanced" } } | ConvertTo-Json -Depth 20)
```

Validation responses contain `valid`, structured `errors`, structured `warnings`, and `island_count`. A custom definition can also be supplied as `grid_definition` in failure, cascade, and recommendation request bodies. Prediction accepts only an exact built-in definition because the saved model was trained for that topology.

## POST /api/predict

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/predict `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.25,"generation_multiplier":1.0,"line_rating_multiplier":0.35,"dispatch_profile":"balanced"}}'
```

Response shape:

```json
{
  "cascade_probability": 0.8876,
  "predicted_load_lost_percent": 69.58,
  "risk_level": "CRITICAL",
  "model_version": "tripwire-ml-v1"
}
```

## POST /api/failure

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/failure `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.25,"generation_multiplier":1.0,"line_rating_multiplier":0.35,"dispatch_profile":"balanced"}}'
```

Response shape:

```json
{
  "status": "solved",
  "termination_reason": "solved",
  "initial_failure": {"component_type": "line", "component_id": "line-101"},
  "grid": {"nodes": [], "lines": [], "metrics": {}},
  "metrics": {}
}
```

## POST /api/cascade

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/cascade `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.25,"generation_multiplier":1.0,"line_rating_multiplier":0.35,"dispatch_profile":"balanced"}}'
```

Response shape:

```json
{
  "cascade_depth": 2,
  "termination_reason": "total_blackout",
  "steps": [],
  "final_metrics": {"load_lost_percent": 100.0, "failed_lines": 12}
}
```

## POST /api/recommend

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/recommend `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"component_type":"line","component_id":"line-101","operating_condition":{"load_multiplier":1.25,"generation_multiplier":1.0,"line_rating_multiplier":0.35,"dispatch_profile":"balanced"},"top_n":3}'
```

Response shape:

```json
{
  "baseline": {"load_lost_percent": 100.0, "cascade_depth": 2},
  "recommendations": [
    {
      "description": "Shed 5% total load",
      "predicted_or_simulated_outcome": {
        "original_demand_mw": 500.0,
        "served_load_mw": 475.0,
        "controlled_shed_mw": 25.0,
        "involuntary_unserved_mw": 0.0,
        "total_unserved_mw": 25.0,
        "load_lost_percent": 5.0
      },
      "improvement": {
        "load_loss_before_percent": 100.0,
        "load_loss_after_percent": 5.0,
        "load_loss_reduction_percentage_points": 95.0
      }
    }
  ],
  "summary": "Recommended based on Tripwire simulation."
}
```

Every scenario response also includes `scenario_id` and `scenario_config`. Send the same operating condition and initial component to all four POST endpoints. Recommendation responses preserve `baseline_cascade_result` separately from each candidate's `cascade_result`. The legacy `unserved_load_mw` field equals `total_unserved_mw` and includes controlled shedding.
