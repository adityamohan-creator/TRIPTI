import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Profile, Role, SelfServiceRole } from '../../types/api'

export interface SignUpInput {
  email: string
  password: string
  fullName: string
  role: SelfServiceRole
  phone?: string
  org?: string
}

export interface AuthState {
  /** Null until the initial session check finishes. */
  session: Session | null
  /** The authoritative profile, loaded from the backend. Null while signed out. */
  profile: Profile | null
  /** True until the first session check resolves — not on every later change. */
  initialising: boolean
  /**
   * Set when the session is valid but the profile could not be loaded (backend
   * down, or no profiles row). The user is signed in but has no role, so
   * role-gated screens must stay closed rather than guessing.
   */
  profileError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>')
  return state
}

/** Convenience for the common "is this person allowed to run operations" check. */
export function hasRole(profile: Profile | null, allowed: readonly Role[]): boolean {
  return profile != null && allowed.includes(profile.role)
}
