# Release Screenshots

The release evidence set was captured from the deployed application at a consistent
1440 x 900 viewport. Files are stored in `docs/screenshots/`.

| File | Evidence |
| --- | --- |
| `01-healthy-grid.png` | Healthy solved teaching network and baseline metrics |
| `02-component-inspection.png` | Selected component details |
| `03-grid-editor.png` | Grid Scenario Builder entry state |
| `04-custom-grid.png` | Valid custom grid with an added bus, generator, load, and line |
| `05-risk-prediction.png` | Severe-preset ML risk prediction |
| `06-cascade-start.png` | Initial failure step |
| `07-cascade-midpoint.png` | Secondary cascade step |
| `08-blackout.png` | Final total-blackout state |
| `09-timeline.png` | Cascade replay and timeline controls |
| `10-mitigation-recommendation.png` | Ranked mitigation recommendation |
| `11-before-after-comparison.png` | Original versus mitigated outcome |
| `12-saved-custom-scenario.png` | Saved custom scenario restored from browser storage |

Regenerate the production smoke evidence from `frontend/`:

```powershell
pnpm release:evidence
```

Override `TRIPWIRE_FRONTEND_URL` or `TRIPWIRE_API_URL` to test another deployment.
The runner checks `/health`, `/ready`, `/api/grid`, component selection, grid CRUD,
validation, drag layout, save/reload, JSON export/import, custom-grid analysis,
prediction, cascade playback, mitigation, comparison, and reset before it succeeds.
