import { CachedGetter, SimpleStore } from '@atproto-labs/simple-store'
import { Key } from '@atproto/jwk'
import { OAuthResponseError } from './oauth-response-error.js'
import { TokenSet } from './oauth-server-agent.js'
import { OAuthServerFactory } from './oauth-server-factory.js'
import { OAuthRefreshError } from './oauth-refresh-error.js'

export type Session = {
  dpopKey: Key
  tokenSet: TokenSet
}

export type SessionStore = SimpleStore<string, Session> & {
  revoked?: (sub: string) => void | PromiseLike<void>
}

/**
 * There are several advantages to wrapping the sessionStore in a (single)
 * CachedGetter, the main of which is that the cached getter will ensure that at
 * most one fresh call is ever being made. Another advantage, is that it
 * contains the logic for reading from the cache which, if the cache is based on
 * localStorage/indexedDB, will sync across multiple tabs (for a given sub).
 */
export class SessionGetter extends CachedGetter<string, Session> {
  constructor(sessionStore: SessionStore, serverFactory: OAuthServerFactory) {
    super(
      async (sub, options, storedSession) => {
        // There needs to be a previous session to be able to refresh. If
        // storedSession is undefined, it means that the store does not contain
        // a session for the given sub. Since this might have been caused
        // by the value being cleared in another process (e.g. another tab), we
        // will give a chance to this process to detect that the session was
        // revoked. This should allow processes not implementing a
        // subscribe/notify between instances to still get a notification when
        // the session is revoked (though they will need to wait for this
        // function to be called for this notification to happen).
        if (storedSession === undefined) {
          // Because the session is not in the store, the sessionStore.del
          // function will not be called, even if the "deleteOnError" callback
          // returns true when the error is an "OAuthRefreshError". In order to
          // notify the sessionStore that we are working on a session that was
          // revoked through an unknown process, we will call the "revoked".
          await sessionStore.revoked?.(sub)
          throw new OAuthRefreshError(sub, 'The session was revoked')
        }

        if (sub !== storedSession.tokenSet.sub) {
          // Fool-proofing (e.g. against invalid session storage)
          throw new OAuthRefreshError(sub, 'Stored session sub mismatch')
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
        const newTokenSet = await server
          .refresh(tokenSet)
          .catch(async (err) => {
            if (await isRefreshDeniedError(err)) {
              // Allow some time for the concurrent request to be stored before
              // we try to get it.
              await new Promise((r) => setTimeout(r, 500))

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
              Date.now() +
                // Add some lee way to ensure the token is not expired when it
                // reaches the server.
                30e3 +
                // Add some randomness to prevent all instances from trying to
                // refreshing at the exact same time, when they are started at
                // the same time.
                60e3 * Math.random()
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
          if (err instanceof OAuthRefreshError) return true

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
}

async function isRefreshDeniedError(err: unknown) {
  return (
    err instanceof OAuthResponseError &&
    err.status === 400 &&
    err.error === 'invalid_grant'
  )
}
