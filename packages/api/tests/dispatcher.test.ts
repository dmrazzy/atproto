import assert from 'assert'
import getPort from 'get-port'
import {
  AtpAgent,
  AtpSessionEvent,
  AtpSessionData,
  BSKY_LABELER_DID,
  AtpSessionManager,
} from '../src'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import { getPdsEndpoint, isValidDidDoc } from '@atproto/common-web'
import { createHeaderEchoServer } from './util/echo-server'

const getPdsEndpointUrl = (...args: Parameters<typeof getPdsEndpoint>) => {
  const endpoint = getPdsEndpoint(...args)
  return endpoint ? new URL(endpoint) : endpoint
}

describe('AtpSessionManager', () => {
  let network: TestNetworkNoAppView

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'api_agent',
      pds: {
        enableDidDocWithSession: true,
      },
    })
  })

  afterAll(async () => {
    await network.close()
  })

  it('creates a new session on account creation.', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    const res = await sessionMgr.createAccount({
      handle: 'user1.test',
      email: 'user1@test.com',
      password: 'password',
    })

    expect(sessionMgr.hasSession).toEqual(true)
    expect(sessionMgr.session?.accessJwt).toEqual(res.data.accessJwt)
    expect(sessionMgr.session?.refreshJwt).toEqual(res.data.refreshJwt)
    expect(sessionMgr.session?.handle).toEqual(res.data.handle)
    expect(sessionMgr.session?.did).toEqual(res.data.did)
    expect(sessionMgr.session?.email).toEqual('user1@test.com')
    expect(sessionMgr.session?.emailConfirmed).toEqual(false)
    assert(isValidDidDoc(res.data.didDoc))
    expect(sessionMgr.pdsUrl).toEqual(getPdsEndpointUrl(res.data.didDoc))

    const agent = new AtpAgent(sessionMgr)
    const { data: sessionInfo } = await agent.com.atproto.server.getSession({})
    expect(sessionInfo).toMatchObject({
      did: res.data.did,
      handle: res.data.handle,
      email: 'user1@test.com',
      emailConfirmed: false,
    })
    expect(isValidDidDoc(sessionInfo.didDoc)).toBe(true)

    expect(events.length).toEqual(1)
    expect(events[0]).toEqual('create')
    expect(sessions.length).toEqual(1)
    expect(sessions[0]?.accessJwt).toEqual(sessionMgr.session?.accessJwt)
  })

  it('creates a new session on login.', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const agent1 = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    const email = 'user2@test.com'
    await agent1.createAccount({
      handle: 'user2.test',
      email,
      password: 'password',
    })

    const sessionMgr2 = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    const res1 = await sessionMgr2.login({
      identifier: 'user2.test',
      password: 'password',
    })

    expect(sessionMgr2.hasSession).toEqual(true)
    expect(sessionMgr2.session?.accessJwt).toEqual(res1.data.accessJwt)
    expect(sessionMgr2.session?.refreshJwt).toEqual(res1.data.refreshJwt)
    expect(sessionMgr2.session?.handle).toEqual(res1.data.handle)
    expect(sessionMgr2.session?.did).toEqual(res1.data.did)
    expect(sessionMgr2.session?.email).toEqual('user2@test.com')
    expect(sessionMgr2.session?.emailConfirmed).toEqual(false)
    assert(isValidDidDoc(res1.data.didDoc))
    expect(sessionMgr2.pdsUrl).toEqual(getPdsEndpointUrl(res1.data.didDoc))

    const agent2 = new AtpAgent(sessionMgr2)
    const { data: sessionInfo } = await agent2.com.atproto.server.getSession({})
    expect(sessionInfo).toMatchObject({
      did: res1.data.did,
      handle: res1.data.handle,
      email,
      emailConfirmed: false,
    })
    expect(isValidDidDoc(sessionInfo.didDoc)).toBe(true)

    expect(events.length).toEqual(2)
    expect(events[0]).toEqual('create')
    expect(events[1]).toEqual('create')
    expect(sessions.length).toEqual(2)
    expect(sessions[0]?.accessJwt).toEqual(agent1.session?.accessJwt)
    expect(sessions[1]?.accessJwt).toEqual(sessionMgr2.session?.accessJwt)
  })

  it('resumes an existing session.', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr1 = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    await sessionMgr1.createAccount({
      handle: 'user3.test',
      email: 'user3@test.com',
      password: 'password',
    })
    if (!sessionMgr1.session) {
      throw new Error('No session created')
    }

    const sessionMgr2 = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    const res1 = await sessionMgr2.resumeSession(sessionMgr1.session)

    expect(sessionMgr2.hasSession).toEqual(true)
    expect(sessionMgr2.session?.handle).toEqual(res1.data.handle)
    expect(sessionMgr2.session?.did).toEqual(res1.data.did)
    assert(isValidDidDoc(res1.data.didDoc))
    expect(sessionMgr2.pdsUrl).toEqual(getPdsEndpointUrl(res1.data.didDoc))

    const agent2 = new AtpAgent(sessionMgr2)
    const { data: sessionInfo } = await agent2.com.atproto.server.getSession({})
    expect(sessionInfo).toMatchObject({
      did: res1.data.did,
      handle: res1.data.handle,
      email: res1.data.email,
      emailConfirmed: false,
    })
    expect(isValidDidDoc(sessionInfo.didDoc)).toBe(true)

    expect(events.length).toEqual(2)
    expect(events[0]).toEqual('create')
    expect(events[1]).toEqual('update')
    expect(sessions.length).toEqual(2)
    expect(sessions[0]?.accessJwt).toEqual(sessionMgr1.session?.accessJwt)
    expect(sessions[1]?.accessJwt).toEqual(sessionMgr2.session?.accessJwt)
  })

  it('refreshes existing session.', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    // create an account and a session with it
    await sessionMgr.createAccount({
      handle: 'user4.test',
      email: 'user4@test.com',
      password: 'password',
    })
    if (!sessionMgr.session) {
      throw new Error('No session created')
    }
    const session1 = sessionMgr.session
    const origAccessJwt = session1.accessJwt

    // wait 1 second so that a token refresh will issue a new access token
    // (if the timestamp, which has 1 second resolution, is the same -- then the access token won't change)
    await new Promise((r) => setTimeout(r, 1000))

    // patch the fetch handler to fake an expired token error on the next request
    sessionMgr.setFetch(async (req) => {
      if (
        req.headers.get('authorization') === `Bearer ${origAccessJwt}` &&
        !req.url.includes('com.atproto.server.refreshSession')
      ) {
        return new Response(JSON.stringify({ error: 'ExpiredToken' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return globalThis.fetch(req)
    })

    // put the agent through the auth flow
    const res1 = await createPost(sessionMgr)

    expect(res1.success).toEqual(true)
    expect(sessionMgr.hasSession).toEqual(true)
    expect(sessionMgr.session?.accessJwt).not.toEqual(session1.accessJwt)
    expect(sessionMgr.session?.refreshJwt).not.toEqual(session1.refreshJwt)
    expect(sessionMgr.session?.handle).toEqual(session1.handle)
    expect(sessionMgr.session?.did).toEqual(session1.did)
    expect(sessionMgr.session?.email).toEqual(session1.email)
    expect(sessionMgr.session?.emailConfirmed).toEqual(session1.emailConfirmed)

    expect(events.length).toEqual(2)
    expect(events[0]).toEqual('create')
    expect(events[1]).toEqual('update')
    expect(sessions.length).toEqual(2)
    expect(sessions[0]?.accessJwt).toEqual(origAccessJwt)
    expect(sessions[1]?.accessJwt).toEqual(sessionMgr.session?.accessJwt)
  })

  it('dedupes session refreshes.', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    // create an account and a session with it
    await sessionMgr.createAccount({
      handle: 'user5.test',
      email: 'user5@test.com',
      password: 'password',
    })
    if (!sessionMgr.session) {
      throw new Error('No session created')
    }
    const session1 = sessionMgr.session
    const origAccessJwt = session1.accessJwt

    // wait 1 second so that a token refresh will issue a new access token
    // (if the timestamp, which has 1 second resolution, is the same -- then the access token won't change)
    await new Promise((r) => setTimeout(r, 1000))

    // patch the fetch handler to fake an expired token error on the next request
    let expiredCalls = 0
    let refreshCalls = 0
    sessionMgr.setFetch(async (req) => {
      if (req.headers.get('authorization') === `Bearer ${origAccessJwt}`) {
        expiredCalls++
        return new Response(JSON.stringify({ error: 'ExpiredToken' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (req.url.includes('com.atproto.server.refreshSession')) {
        refreshCalls++
      }
      return globalThis.fetch(req)
    })

    // put the agent through the auth flow
    const [res1, res2, res3] = await Promise.all([
      createPost(sessionMgr),
      createPost(sessionMgr),
      createPost(sessionMgr),
    ])

    expect(expiredCalls).toEqual(3)
    expect(refreshCalls).toEqual(1)
    expect(res1.success).toEqual(true)
    expect(res2.success).toEqual(true)
    expect(res3.success).toEqual(true)
    expect(sessionMgr.hasSession).toEqual(true)
    expect(sessionMgr.session?.accessJwt).not.toEqual(session1.accessJwt)
    expect(sessionMgr.session?.refreshJwt).not.toEqual(session1.refreshJwt)
    expect(sessionMgr.session?.handle).toEqual(session1.handle)
    expect(sessionMgr.session?.did).toEqual(session1.did)
    expect(sessionMgr.session?.email).toEqual(session1.email)
    expect(sessionMgr.session?.emailConfirmed).toEqual(session1.emailConfirmed)

    expect(events.length).toEqual(2)
    expect(events[0]).toEqual('create')
    expect(events[1]).toEqual('update')
    expect(sessions.length).toEqual(2)
    expect(sessions[0]?.accessJwt).toEqual(origAccessJwt)
    expect(sessions[1]?.accessJwt).toEqual(sessionMgr.session?.accessJwt)
  })

  it('persists an empty session on login and resumeSession failures', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    try {
      await sessionMgr.login({
        identifier: 'baduser.test',
        password: 'password',
      })
    } catch (_e: any) {
      // ignore
    }
    expect(sessionMgr.hasSession).toEqual(false)

    try {
      await sessionMgr.resumeSession({
        accessJwt: 'bad',
        refreshJwt: 'bad',
        did: 'bad',
        handle: 'bad',
      })
    } catch (_e: any) {
      // ignore
    }
    expect(sessionMgr.hasSession).toEqual(false)

    expect(events.length).toEqual(2)
    expect(events[0]).toEqual('create-failed')
    expect(events[1]).toEqual('network-error')
    expect(sessions.length).toEqual(2)
    expect(typeof sessions[0]).toEqual('undefined')
    expect(typeof sessions[1]).toEqual('undefined')
  })

  it('does not modify or persist the session on a failed refresh', async () => {
    const events: string[] = []
    const sessions: (AtpSessionData | undefined)[] = []
    const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
      events.push(evt)
      sessions.push(sess)
    }

    const sessionMgr = new AtpSessionManager({
      service: network.pds.url,
      persistSession,
    })

    // create an account and a session with it
    await sessionMgr.createAccount({
      handle: 'user6.test',
      email: 'user6@test.com',
      password: 'password',
    })
    if (!sessionMgr.session) {
      throw new Error('No session created')
    }
    const session1 = sessionMgr.session
    const origAccessJwt = session1.accessJwt

    // patch the fetch handler to fake an expired token error on the next request
    sessionMgr.setFetch(async (req) => {
      if (req.headers.get('authorization') === `Bearer ${origAccessJwt}`) {
        return new Response(JSON.stringify({ error: 'ExpiredToken' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (req.url.includes('com.atproto.server.refreshSession')) {
        return new Response(undefined, { status: 500 })
      }
      return globalThis.fetch(req)
    })

    // put the agent through the auth flow
    try {
      const agent = new AtpAgent(sessionMgr)
      await agent.api.app.bsky.feed.getTimeline()
      throw new Error('Should have failed')
    } catch (e: any) {
      // the original error passes through
      expect(e.status).toEqual(400)
      expect(e.error).toEqual('ExpiredToken')
    }

    // still has session because it wasn't invalidated
    expect(sessionMgr.hasSession).toEqual(true)

    expect(events.length).toEqual(1)
    expect(events[0]).toEqual('create')
    expect(sessions.length).toEqual(1)
    expect(sessions[0]?.accessJwt).toEqual(origAccessJwt)
  })

  describe('setPersistSessionHandler', () => {
    it('sets persist session handler', async () => {
      let originalHandlerCallCount = 0
      let newHandlerCallCount = 0

      const persistSession = () => {
        originalHandlerCallCount++
      }
      const newPersistSession = () => {
        newHandlerCallCount++
      }

      const sessionMgr = new AtpSessionManager({
        service: network.pds.url,
        persistSession,
      })

      await sessionMgr.createAccount({
        handle: 'user7.test',
        email: 'user7@test.com',
        password: 'password',
      })

      expect(originalHandlerCallCount).toEqual(1)

      sessionMgr.setPersistSessionHandler(newPersistSession)
      sessionMgr.session = undefined

      await sessionMgr.createAccount({
        handle: 'user8.test',
        email: 'user8@test.com',
        password: 'password',
      })

      expect(originalHandlerCallCount).toEqual(1)
      expect(newHandlerCallCount).toEqual(1)
    })
  })

  describe('createAccount', () => {
    it('persists an empty session on failure', async () => {
      const events: string[] = []
      const sessions: (AtpSessionData | undefined)[] = []
      const persistSession = (evt: AtpSessionEvent, sess?: AtpSessionData) => {
        events.push(evt)
        sessions.push(sess)
      }

      const sessionMgr = new AtpSessionManager({
        service: network.pds.url,
        persistSession,
      })

      await expect(
        sessionMgr.createAccount({
          handle: '',
          email: '',
          password: 'password',
        }),
      ).rejects.toThrow()

      expect(sessionMgr.hasSession).toEqual(false)
      expect(sessionMgr.session).toEqual(undefined)
      expect(events.length).toEqual(1)
      expect(events[0]).toEqual('create-failed')
      expect(sessions.length).toEqual(1)
      expect(sessions[0]).toEqual(undefined)
    })
  })

  describe('App labelers header', () => {
    it('adds the labelers header as expected', async () => {
      const port = await getPort()
      const server = await createHeaderEchoServer(port)
      const sessionMgr = new AtpAgent({ service: `http://localhost:${port}` })
      const sessionMgr2 = new AtpAgent({ service: `http://localhost:${port}` })

      const res1 = await sessionMgr.com.atproto.server.describeServer()
      expect(res1.data['atproto-accept-labelers']).toEqual(
        `${BSKY_LABELER_DID};redact`,
      )

      AtpAgent.configure({ appLabelers: ['did:plc:test1', 'did:plc:test2'] })
      const res2 = await sessionMgr.com.atproto.server.describeServer()
      expect(res2.data['atproto-accept-labelers']).toEqual(
        'did:plc:test1;redact, did:plc:test2;redact',
      )
      const res3 = await sessionMgr2.com.atproto.server.describeServer()
      expect(res3.data['atproto-accept-labelers']).toEqual(
        'did:plc:test1;redact, did:plc:test2;redact',
      )
      AtpAgent.configure({ appLabelers: [BSKY_LABELER_DID] })

      await new Promise((r) => server.close(r))
    })
  })

  describe('configureLabelersHeader', () => {
    it('adds the labelers header as expected', async () => {
      const port = await getPort()
      const server = await createHeaderEchoServer(port)
      const sessionMgr = new AtpAgent({ service: `http://localhost:${port}` })

      sessionMgr.configureLabelersHeader(['did:plc:test1'])
      const res1 = await sessionMgr.com.atproto.server.describeServer()
      expect(res1.data['atproto-accept-labelers']).toEqual(
        `${BSKY_LABELER_DID};redact, did:plc:test1`,
      )

      sessionMgr.configureLabelersHeader(['did:plc:test1', 'did:plc:test2'])
      const res2 = await sessionMgr.com.atproto.server.describeServer()
      expect(res2.data['atproto-accept-labelers']).toEqual(
        `${BSKY_LABELER_DID};redact, did:plc:test1, did:plc:test2`,
      )

      await new Promise((r) => server.close(r))
    })
  })

  describe('configureProxyHeader', () => {
    it('adds the proxy header as expected', async () => {
      const port = await getPort()
      const server = await createHeaderEchoServer(port)
      const sessionMgr = new AtpAgent({ service: `http://localhost:${port}` })

      const res1 = await sessionMgr.com.atproto.server.describeServer()
      expect(res1.data['atproto-proxy']).toBeFalsy()

      sessionMgr.configureProxyHeader('atproto_labeler', 'did:plc:test1')
      const res2 = await sessionMgr.com.atproto.server.describeServer()
      expect(res2.data['atproto-proxy']).toEqual(
        'did:plc:test1#atproto_labeler',
      )

      const res3 = await sessionMgr
        .withProxy('atproto_labeler', 'did:plc:test2')
        .com.atproto.server.describeServer()
      expect(res3.data['atproto-proxy']).toEqual(
        'did:plc:test2#atproto_labeler',
      )

      await new Promise((r) => server.close(r))
    })
  })
})

const createPost = async (sessionMgr: AtpSessionManager) => {
  const agent = new AtpAgent(sessionMgr)
  return agent.api.com.atproto.repo.createRecord({
    repo: await agent.getDid(),
    collection: 'app.bsky.feed.post',
    record: {
      text: 'hello there',
      createdAt: new Date().toISOString(),
    },
  })
}