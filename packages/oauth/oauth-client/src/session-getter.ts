import {
  CachedGetter,
  GetCachedOptions,
  SimpleStore,
} from '@atproto-labs/simple-store'
import { Key } from '@atproto/jwk'
import { OAuthResponseError } from './oauth-response-error.js'
import { TokenSet } from './oauth-server-agent.js'
import { OAuthServerFactory } from './oauth-server-factory.js'
import { RefreshError } from './refresh-error.js'
import { Runtime } from './runtime.js'
import { withSignal } from './util.js'

export type Session = {
  dpopKey: Key
  tokenSet: TokenSet
}

export type SessionStore = SimpleStore<string, Session>

/**
 * There are several advantages to wrapping the sessionStore in a (single)
 * CachedGetter, the main of which is that the cached getter will ensure that at
 * most one fresh call is ever being made. Another advantage, is that it
 * contains the logic for reading from the cache which, if the cache is based on
 * localStorage/indexedDB, will sync across multiple tabs (for a given sub).
 */
export class SessionGetter extends CachedGetter<string, Session> {
  constructor(
    sessionStore: SessionStore,
    serverFactory: OAuthServerFactory,
    private readonly runtime: Runtime,
  ) {
    super(
      async (sub, options, storedSession) => {
        // There needs to be a previous session to be able to refresh. If
        // storedSession is undefined, it means that the store does not contain
        // a session for the given sub. Since this might have been caused by the
        // value being cleared in another process (e.g. another tab), we will
        // give a chance to the process running this code to detect that the
        // session was revoked. This should allow processes not implementing a
        // subscribe/notify between instances to still be "notified" that the
        // session was revoked.
        if (storedSession === undefined) {
          // Because the session is not in the store, the sessionStore.del
          // function will not be called, even if the "deleteOnError" callback
          // returns true when the error is an "OAuthRefreshError". Let's
          // call it here manually.
          await sessionStore.del(sub)
          throw new RefreshError(sub, 'The session was revoked')
        }

        if (sub !== storedSession.tokenSet.sub) {
          // Fool-proofing (e.g. against invalid session storage)
          throw new RefreshError(sub, 'Stored session sub mismatch')
        }

        // Since refresh tokens can only be used once, we might run into
        // concurrency issues if multiple tabs/instances are trying to refresh
        // the same token. The chances of this happening when multiple instances
        // are started simultaneously is reduced by randomizing the expiry time
        // (see isStale() bellow). Even so, There still exist chances that
        // multiple tabs will try to refresh the token at the same time. The
        // best solution would be to use a mutex/lock to ensure that only one
        // instance is refreshing the token at a time. A simpler workaround is
        // to check if the value stored in the session store is the same as the
        // one in memory. If it isn't, then another instance has already
        // refreshed the token.

        const { tokenSet, dpopKey } = storedSession
        const server = await serverFactory.fromIssuer(tokenSet.iss, dpopKey)

        // We must not use the "signal" to cancel anything beyond this point.
        // This is because we want to ensure that the refreshed token are stored
        // in the sessionStore, even if the signal is aborted. This should
        // prevent the token from being refreshed again in the future, causing
        // the entire session to be invalidated.
        options?.signal?.throwIfAborted()

        const newTokenSet = await server
          .refresh(tokenSet)
          .catch(async (err) => {
            if (await isRefreshDeniedError(err)) {
              // In case there is no lock implementation in the runtime, we will
              // wait for a short time to give the other concurrent instances a
              // chance to finish their refreshing of the token. If a concurrent
              // refresh indeed occurred, we will pretend that this one
              // succeeded.
              await new Promise((r) => setTimeout(r, 1000))

              const stored = await this.getStored(sub)
              if (stored !== undefined) {
                if (
                  stored.tokenSet.access_token !== tokenSet.access_token ||
                  stored.tokenSet.refresh_token !== tokenSet.refresh_token
                ) {
                  // A concurrent refresh occurred. Pretend this one succeeded.
                  return stored.tokenSet
                } else {
                  // The session data will be deleted from the sessionStore by
                  // the "deleteOnError" callback.
                }
              }
            }

            throw err
          })
        return { ...storedSession, tokenSet: newTokenSet }
      },
      sessionStore,
      {
        isStale: (sub, { tokenSet }) => {
          return (
            tokenSet.expires_at != null &&
            new Date(tokenSet.expires_at).getTime() <
              // Add some lee way to ensure the token is not expired when it
              // reaches the server.
              Date.now() + 60e3
          )
        },
        onStoreError: async (err, sub, { tokenSet, dpopKey }) => {
          // If the token data cannot be stored, let's revoke it
          const server = await serverFactory.fromIssuer(tokenSet.iss, dpopKey)
          await server.revoke(tokenSet.refresh_token ?? tokenSet.access_token)
          throw err
        },
        deleteOnError: async (err, sub, { tokenSet }) => {
          // Not possible to refresh without a refresh token
          if (!tokenSet.refresh_token) return true

          // If the refresh token is invalid, delete the session from the store
          if (err instanceof RefreshError) return true

          // If fetching a refresh token fails because they are no longer valid,
          // delete the session from the sessionStore.
          if (await isRefreshDeniedError(err)) return true

          // Unknown cause, keep the session in the store
          return false
        },
      },
    )
  }

  /**
   * @param refresh When `true`, the credentials will be refreshed even if they
   * are not expired. When `false`, the credentials will not be refreshed even
   * if they are expired. When `undefined`, the credentials will be refreshed
   * if, and only if, they are (about to be) expired. Defaults to `undefined`.
   */
  async getSession(sub: string, refresh?: boolean) {
    const session = await this.get(sub, {
      noCache: refresh === true,
      allowStale: refresh === false,
    })

    if (sub !== session.tokenSet.sub) {
      // Fool-proofing (e.g. against invalid session storage)
      throw new Error('Token set does not match the expected sub')
    }

    return session
  }

  async get(sub: string, options?: GetCachedOptions): Promise<Session> {
    return this.runtime.withLock(`@atproto-oauth-client-${sub}`, async () => {
      // Make sure, even if there is no signal in the options, that the request
      // will be cancelled after at most 30 seconds.
      return withSignal({ signal: options?.signal, timeout: 30e3 }, (signal) =>
        super.get(sub, { ...options, signal }),
      )
    })
  }
}

async function isRefreshDeniedError(err: unknown) {
  return (
    err instanceof OAuthResponseError &&
    err.status === 400 &&
    err.error === 'invalid_grant'
  )
}
