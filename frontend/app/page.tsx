import { GridVisualization } from "../components/grid/grid-visualization";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

async function getBackendHealth(): Promise<string> {
  if (!apiBaseUrl) {
    return "not configured";
  }

  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return "unavailable";
    }

    const payload = (await response.json()) as { status?: string };
    return payload.status ?? "unknown";
  } catch {
    return "unavailable";
  }
}

export default async function Home() {
  const backendStatus = await getBackendHealth();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="border-b border-slate-800 bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/10 text-sm font-black tracking-tight text-cyan-200">
              TW
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                Tripwire
              </p>
              <h1 className="text-xl font-semibold text-slate-50">
                Grid Cascade Intelligence
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
              <span className="text-slate-500">System</span>{" "}
              <span className="font-semibold uppercase text-emerald-300">Monitoring</span>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
              <span className="text-slate-500">API</span>{" "}
              <span className="font-semibold uppercase text-slate-100">{backendStatus}</span>
            </div>
          </div>
        </div>
      </section>
      <GridVisualization />
    </main>
  );
}
