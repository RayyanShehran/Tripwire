import { GridVisualization } from "../components/grid/grid-visualization";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function getBackendHealth(): Promise<string> {
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
    <main className="min-h-screen">
      <section className="border-b border-neutral-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-red-700">
              Tripwire
            </p>
            <h1 className="text-2xl font-semibold text-neutral-950">
              Power-grid cascade simulation platform
            </h1>
          </div>
          <div className="rounded border border-neutral-200 px-3 py-2 text-sm">
            API: <span className="font-semibold">{backendStatus}</span>
          </div>
        </div>
      </section>
      <GridVisualization />
    </main>
  );
}
