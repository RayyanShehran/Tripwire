from __future__ import annotations

from dataclasses import dataclass, field

from app.simulation.grid import (
    GridComponentType,
    GridResponse,
    apply_component_outage,
    create_test_grid,
    run_power_flow,
    serialize_grid_state,
)


@dataclass(frozen=True)
class ComponentFailure:
    component_type: GridComponentType
    component_id: str


@dataclass
class GridScenario:
    failures: list[ComponentFailure] = field(default_factory=list)

    def current_grid(self) -> GridResponse:
        return self._solve(self.failures)

    def apply_failure(self, failure: ComponentFailure) -> GridResponse:
        next_failures = self.failures if failure in self.failures else [*self.failures, failure]
        response = self._solve(next_failures)
        self.failures = list(next_failures)
        return response

    def reset(self) -> GridResponse:
        self.failures.clear()
        return self._solve(self.failures)

    def _solve(self, failures: list[ComponentFailure]) -> GridResponse:
        net = create_test_grid()
        for failure in failures:
            apply_component_outage(net, failure.component_type, failure.component_id)
        run_power_flow(net)
        return serialize_grid_state(net)
