import { createApp } from './app.js'
import { config } from './config.js'

const app = createApp()

app.listen(config.PORT, () => {
  console.log(`TRIPTI API listening on http://localhost:${config.PORT}`)

  if (!config.ANTHROPIC_API_KEY) {
    // Loud, because a coordinator reading the board needs to know that nothing
    // has actually read the incoming reports.
    console.warn(
      [
        '',
        '  No ANTHROPIC_API_KEY set — running with keyword extraction only.',
        '  Reports are still accepted, but nothing reads them: category, severity',
        '  and needs come from a keyword scan, and every incident is flagged for',
        '  manual triage. Add a key to backend/.env for real extraction.',
        '',
      ].join('\n'),
    )
  }
})
