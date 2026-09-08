import { ConfigurationError } from './components/ConfigurationError'
import { ToastProvider } from './components/ui/ToastProvider'
import { AuthProvider } from './features/auth/AuthProvider'
import { isSupabaseConfigured } from './lib/supabase'
import { AppRoutes } from './routes/AppRoutes'

export default function App() {
  // Checked before the providers mount: AuthProvider's first action is a
  // Supabase call, and there is nothing useful it can do without credentials.
  if (!isSupabaseConfigured) return <ConfigurationError />

  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  )
}
