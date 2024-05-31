import { InvalidRequestError } from '@atproto/xrpc-server'
import { INVALID_HANDLE } from '@atproto/syntax'
import AppContext from '../../../../context'
import { Server } from '../../../../lexicon'
import { authPassthru } from '../../../proxy'
import { didDocForSession } from './util'
import { AuthScope } from '../../../../auth-verifier'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.server.getSession({
    auth: ctx.authVerifier.accessStandard({
      additional: [AuthScope.SignupQueued],
    }),
    handler: async ({ auth, req }) => {
      const did = auth.credentials.did
      if (ctx.entrywayAgent) {
        const [res, user] = await Promise.all([
          ctx.entrywayAgent.com.atproto.server.getSession(
            undefined,
            authPassthru(req),
          ),
          ctx.accountManager.getAccount(did, { includeDeactivated: true }),
        ])
        if (!user) {
          throw new InvalidRequestError(
            `Could not find user info for account: ${did}`,
          )
        }
        return {
          encoding: 'application/json',
          body: {
            ...res.data,
            active: user.active,
            status: user.status,
          },
        }
      }

      const [user, didDoc] = await Promise.all([
        ctx.accountManager.getAccount(did, { includeDeactivated: true }),
        didDocForSession(ctx, did),
      ])
      if (!user) {
        throw new InvalidRequestError(
          `Could not find user info for account: ${did}`,
        )
      }
      return {
        encoding: 'application/json',
        body: {
          handle: user.handle ?? INVALID_HANDLE,
          did: user.did,
          email: user.email ?? undefined,
          didDoc,
          emailConfirmed: !!user.emailConfirmedAt,
          active: user.active,
          status: user.status,
        },
      }
    },
  })
}
