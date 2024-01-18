import {
  ModeratorClient,
  SeedClient,
  TestNetwork,
  basicSeed,
} from '@atproto/dev-env'
import AtpAgent from '@atproto/api'
import {
  REASONOTHER,
  REASONSPAM,
} from '../src/lexicon/types/com/atproto/moderation/defs'
import { forSnapshot } from './_util'
import { TestOzone } from '@atproto/dev-env/src/ozone'

describe('admin get repo view', () => {
  let network: TestNetwork
  let ozone: TestOzone
  let agent: AtpAgent
  let sc: SeedClient
  let modClient: ModeratorClient

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'ozone_admin_get_repo',
    })
    ozone = network.ozone
    agent = ozone.getClient()
    sc = network.getSeedClient()
    modClient = network.ozone.getModClient()
    await basicSeed(sc)
    await network.processAll()
  })

  afterAll(async () => {
    await network.close()
  })

  beforeAll(async () => {
    await modClient.emitModerationEvent({
      event: { $type: 'com.atproto.admin.defs#modEventAcknowledge' },
      subject: {
        $type: 'com.atproto.admin.defs#repoRef',
        did: sc.dids.alice,
      },
    })
    await sc.createReport({
      reportedBy: sc.dids.bob,
      reasonType: REASONSPAM,
      subject: {
        $type: 'com.atproto.admin.defs#repoRef',
        did: sc.dids.alice,
      },
    })
    await sc.createReport({
      reportedBy: sc.dids.carol,
      reasonType: REASONOTHER,
      reason: 'defamation',
      subject: {
        $type: 'com.atproto.admin.defs#repoRef',
        did: sc.dids.alice,
      },
    })
    await modClient.emitModerationEvent({
      event: { $type: 'com.atproto.admin.defs#modEventTakedown' },
      subject: {
        $type: 'com.atproto.admin.defs#repoRef',
        did: sc.dids.alice,
      },
    })
  })

  it('gets a repo by did, even when taken down.', async () => {
    const result = await agent.api.com.atproto.admin.getRepo(
      { did: sc.dids.alice },
      { headers: await ozone.adminHeaders() },
    )
    expect(forSnapshot(result.data)).toMatchSnapshot()
  })

  it('does not include account emails for triage mods.', async () => {
    const { data: moderator } = await agent.api.com.atproto.admin.getRepo(
      { did: sc.dids.bob },
      { headers: await ozone.adminHeaders() },
    )
    const { data: triage } = await agent.api.com.atproto.admin.getRepo(
      { did: sc.dids.bob },
      { headers: await ozone.adminHeaders('triage') },
    )
    expect(moderator.email).toEqual('bob@test.com')
    expect(triage.email).toBeUndefined()
    expect(triage).toEqual({ ...moderator, email: undefined })
  })

  it('includes emailConfirmedAt timestamp', async () => {
    const { data: beforeEmailVerification } =
      await agent.api.com.atproto.admin.getRepo(
        { did: sc.dids.bob },
        { headers: await ozone.adminHeaders() },
      )

    expect(beforeEmailVerification.emailConfirmedAt).toBeUndefined()
    const timestampBeforeVerification = Date.now()
    const bobsAccount = sc.accounts[sc.dids.bob]
    const verificationToken =
      await network.pds.ctx.accountManager.createEmailToken(
        sc.dids.bob,
        'confirm_email',
      )
    await network.pds.getClient().api.com.atproto.server.confirmEmail(
      { email: bobsAccount.email, token: verificationToken },
      {
        encoding: 'application/json',

        headers: sc.getHeaders(sc.dids.bob),
      },
    )
    const { data: afterEmailVerification } =
      await agent.api.com.atproto.admin.getRepo(
        { did: sc.dids.bob },
        { headers: await ozone.adminHeaders() },
      )

    expect(afterEmailVerification.emailConfirmedAt).toBeTruthy()
    expect(
      new Date(afterEmailVerification.emailConfirmedAt as string).getTime(),
    ).toBeGreaterThan(timestampBeforeVerification)
  })

  it('fails when repo does not exist.', async () => {
    const promise = agent.api.com.atproto.admin.getRepo(
      { did: 'did:plc:doesnotexist' },
      { headers: await ozone.adminHeaders() },
    )
    await expect(promise).rejects.toThrow('Repo not found')
  })
})