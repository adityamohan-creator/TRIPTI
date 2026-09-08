import { EmptyState } from '../components/ui/States'

export function Missions() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Missions</h1>
        <p className="mt-1 text-sm text-ink-2">
          Dispatch, multi-stop routes, and live status from the field.
        </p>
      </div>

      <EmptyState
        title="Mission dispatch is not built yet"
        description="Matching currently produces a preview a coordinator can read, but turning that preview into a mission — with a volunteer, a vehicle, a route and a status timeline — is still ahead. No placeholder missions are shown here."
      />
    </section>
  )
}
