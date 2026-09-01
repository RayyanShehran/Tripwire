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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-8 md:grid-cols-[2fr_1fr]">
        <div className="rounded border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-neutral-950">
            Transmission Network
          </h2>
          <div className="mt-5 h-[420px] rounded border border-dashed border-neutral-300 bg-neutral-50 p-6">
            <div className="flex h-full items-center justify-center text-center text-sm text-neutral-600">
              React Flow network visualization will be implemented in a later
              milestone.
            </div>
          </div>
        </div>

        <aside className="rounded border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-neutral-950">
            Scenario Status
          </h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Load lost</dt>
              <dd className="font-semibold">Not simulated</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Failed components</dt>
              <dd className="font-semibold">Not simulated</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Cascade depth</dt>
              <dd className="font-semibold">Not simulated</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Blackout severity</dt>
              <dd className="font-semibold">Not simulated</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}
