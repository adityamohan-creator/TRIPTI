import type { Session } from '@supabase/supabase-js'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, get } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types/api'
import { AuthContext, type SignUpInput } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [initialising, setInitialising] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Guards against a slow profile fetch for a signed-out user landing after the
  // sign-out has already cleared state.
  const currentUserId = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const { profile: loaded } = await get<{ profile: Profile }>('/profile')
      if (currentUserId.current !== userId) return
      setProfile(loaded)
      setProfileError(null)
    } catch (err) {
      if (currentUserId.current !== userId) return

      /*
       * A rejected token is not a degraded state to sit in.
       *
       * The stored session can outlive the account it names — an expired
       * token, a revoked session, a user deleted from the dashboard. Leaving
       * the shell mounted then strands someone on a signed-in-looking app
       * where every request fails, with no way out but clearing site data.
       * Sign out and let the router send them to the login screen.
       */
      if (err instanceof ApiError && err.status === 401) {
        void supabase.auth.signOut()
        return
      }

      setProfile(null)
      setProfileError(
        err instanceof Error ? err.message : 'Could not load your profile.',
      )
    }
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      currentUserId.current = data.session?.user.id ?? null
      setSession(data.session)
      if (data.session) {
        void loadProfile(data.session.user.id).finally(() => {
          if (active) setInitialising(false)
        })
      } else {
        setInitialising(false)
      }
    })

    // Fires on sign-in, sign-out, and token refresh. The profile is only
    // refetched when the user actually changes — a token refresh every hour
    // should not cost a round trip.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      const nextId = next?.user.id ?? null
      const changed = nextId !== currentUserId.current

      currentUserId.current = nextId
      setSession(next)

      if (!next) {
        setProfile(null)
        setProfileError(null)
      } else if (changed) {
        void loadProfile(next.user.id)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }, [])

  const signUp = useCallback(async (input: SignUpInput) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        // The database trigger reads these. It clamps `role` to the self-service
        // set, so a crafted payload asking for 'admin' still lands as 'citizen'.
        data: {
          full_name: input.fullName,
          role: input.role,
          phone: input.phone ?? null,
          org: input.org ?? null,
        },
      },
    })
    if (error) throw new Error(error.message)

    // With email confirmation on, signUp returns a user but no session.
    return { needsEmailConfirmation: data.user != null && data.session == null }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (currentUserId.current) await loadProfile(currentUserId.current)
  }, [loadProfile])

  const value = useMemo(
    () => ({
      session,
      profile,
      initialising,
      profileError,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [session, profile, initialising, profileError, signIn, signUp, signOut, refreshProfile],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
