import { EmptyState } from '../components/ui/States'

export function Resources() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Resources</h1>
        <p className="mt-1 text-sm text-ink-2">
          The supply side of the matching engine — donor and NGO inventory, availability,
          and capability tags.
        </p>
      </div>

      <EmptyState
        title="Resource management is not built yet"
        description="The resources table and its policies exist in the database; the CRUD endpoints and donor screens land with the core backend work. Nothing here is mocked — when it says empty, it is empty."
      />
    </section>
  )
}
