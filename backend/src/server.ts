import { createApp } from './app.js'
import { config } from './config.js'

const app = createApp()

app.listen(config.PORT, () => {
  console.log(`TRIPTI API listening on http://localhost:${config.PORT}`)
})
