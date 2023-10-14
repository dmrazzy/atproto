import util from 'util'
import { CID } from 'multiformats/cid'
import { AtUri } from '@atproto/syntax'
import { cborToLexRecord } from '@atproto/repo'
import { AtpAgent } from '@atproto/api'
import { Keypair } from '@atproto/crypto'
import { createServiceAuthHeaders } from '@atproto/xrpc-server'
import { Record as PostRecord } from '../lexicon/types/app/bsky/feed/post'
import { Record as ProfileRecord } from '../lexicon/types/app/bsky/actor/profile'
import { ids } from '../lexicon/lexicons'
import {
  ProfileViewBasic,
  ProfileView,
  ProfileViewDetailed,
} from '../lexicon/types/app/bsky/actor/defs'
import { FeedViewPost, PostView } from '../lexicon/types/app/bsky/feed/defs'
import {
  Main as EmbedImages,
  isMain as isEmbedImages,
} from '../lexicon/types/app/bsky/embed/images'
import {
  Main as EmbedExternal,
  isMain as isEmbedExternal,
} from '../lexicon/types/app/bsky/embed/external'
import {
  Main as EmbedRecord,
  isMain as isEmbedRecord,
  View as EmbedRecordView,
} from '../lexicon/types/app/bsky/embed/record'
import {
  Main as EmbedRecordWithMedia,
  isMain as isEmbedRecordWithMedia,
} from '../lexicon/types/app/bsky/embed/recordWithMedia'
import { ActorStore } from '../actor-store'
import { ActorDb } from '../actor-store/db'
import { ServiceDb } from '../service-db'
import { LocalRecords, RecordDescript } from './types'

type CommonSignedUris = 'avatar' | 'banner' | 'feed_thumbnail' | 'feed_fullsize'

export class LocalViewer {
  did: string
  actorDb: ActorDb
  serviceDb: ServiceDb
  signingKey: Keypair
  pdsHostname: string
  appViewAgent?: AtpAgent
  appviewDid?: string
  appviewCdnUrlPattern?: string

  constructor(params: {
    did: string
    actorDb: ActorDb
    serviceDb: ServiceDb
    signingKey: Keypair
    pdsHostname: string
    appViewAgent?: AtpAgent
    appviewDid?: string
    appviewCdnUrlPattern?: string
  }) {
    this.did = params.did
    this.actorDb = params.actorDb
    this.serviceDb = params.serviceDb
    this.signingKey = params.signingKey
    this.pdsHostname = params.pdsHostname
    this.appViewAgent = params.appViewAgent
    this.appviewDid = params.appviewDid
    this.appviewCdnUrlPattern = params.appviewCdnUrlPattern
  }

  static creator(params: {
    actorStore: ActorStore
    serviceDb: ServiceDb
    signingKey: Keypair
    pdsHostname: string
    appViewAgent?: AtpAgent
    appviewDid?: string
    appviewCdnUrlPattern?: string
  }) {
    const { actorStore, ...rest } = params
    return async (did: string) => {
      const actorDb = await actorStore.db(did)
      return new LocalViewer({ did, actorDb, ...rest })
    }
  }

  getImageUrl(pattern: CommonSignedUris, cid: string) {
    if (!this.appviewCdnUrlPattern) {
      return `https://${this.pdsHostname}/xrpc/${ids.ComAtprotoSyncGetBlob}?did=${this.did}&cid=${cid}`
    }
    return util.format(this.appviewCdnUrlPattern, pattern, this.did, cid)
  }

  async serviceAuthHeaders(did: string) {
    if (!this.appviewDid) {
      throw new Error('Could not find bsky appview did')
    }
    return createServiceAuthHeaders({
      iss: did,
      aud: this.appviewDid,
      keypair: this.signingKey,
    })
  }

  async getRecordsSinceRev(rev: string): Promise<LocalRecords> {
    const res = await this.actorDb.db
      .selectFrom('record')
      .innerJoin('ipld_block', 'ipld_block.cid', 'record.cid')
      .select([
        'ipld_block.content',
        'uri',
        'ipld_block.cid',
        'record.indexedAt',
      ])
      .where('record.repoRev', '>', rev)
      .orderBy('record.repoRev', 'asc')
      .execute()
    return res.reduce(
      (acc, cur) => {
        const descript = {
          uri: new AtUri(cur.uri),
          cid: CID.parse(cur.cid),
          indexedAt: cur.indexedAt,
          record: cborToLexRecord(cur.content),
        }
        if (
          descript.uri.collection === ids.AppBskyActorProfile &&
          descript.uri.rkey === 'self'
        ) {
          acc.profile = descript as RecordDescript<ProfileRecord>
        } else if (descript.uri.collection === ids.AppBskyFeedPost) {
          acc.posts.push(descript as RecordDescript<PostRecord>)
        }
        return acc
      },
      { profile: null, posts: [] } as LocalRecords,
    )
  }

  async getProfileBasic(): Promise<ProfileViewBasic | null> {
    const profileQuery = this.actorDb.db
      .selectFrom('record')
      .leftJoin('ipld_block', 'ipld_block.cid', 'record.cid')
      .where('record.collection', '=', ids.AppBskyActorProfile)
      .where('record.rkey', '=', 'self')
      .selectAll()
    const handleQuery = this.serviceDb.db
      .selectFrom('did_handle')
      .where('did', '=', this.did)
      .selectAll()
    const [profileRes, handleRes] = await Promise.all([
      profileQuery.executeTakeFirst(),
      handleQuery.executeTakeFirst(),
    ])
    if (!handleRes) return null
    const record = profileRes?.content
      ? (cborToLexRecord(profileRes.content) as ProfileRecord)
      : null
    return {
      did: this.did,
      handle: handleRes.handle,
      displayName: record?.displayName,
      avatar: record?.avatar
        ? this.getImageUrl('avatar', record.avatar.ref.toString())
        : undefined,
    }
  }

  async formatAndInsertPostsInFeed(
    feed: FeedViewPost[],
    posts: RecordDescript<PostRecord>[],
  ): Promise<FeedViewPost[]> {
    if (posts.length === 0) {
      return feed
    }
    const lastTime = feed.at(-1)?.post.indexedAt ?? new Date(0).toISOString()
    const inFeed = posts.filter((p) => p.indexedAt > lastTime)
    const newestToOldest = inFeed.reverse()
    const maybeFormatted = await Promise.all(
      newestToOldest.map((p) => this.getPost(p)),
    )
    const formatted = maybeFormatted.filter((p) => p !== null) as PostView[]
    for (const post of formatted) {
      const idx = feed.findIndex((fi) => fi.post.indexedAt < post.indexedAt)
      if (idx >= 0) {
        feed.splice(idx, 0, { post })
      } else {
        feed.push({ post })
      }
    }
    return feed
  }

  async getPost(
    descript: RecordDescript<PostRecord>,
  ): Promise<PostView | null> {
    const { uri, cid, indexedAt, record } = descript
    const author = await this.getProfileBasic()
    if (!author) return null
    const embed = record.embed
      ? await this.formatPostEmbed(author.did, record)
      : undefined
    return {
      uri: uri.toString(),
      cid: cid.toString(),
      author,
      record,
      embed: embed ?? undefined,
      indexedAt,
    }
  }

  async formatPostEmbed(did: string, post: PostRecord) {
    const embed = post.embed
    if (!embed) return null
    if (isEmbedImages(embed) || isEmbedExternal(embed)) {
      return this.formatSimpleEmbed(embed)
    } else if (isEmbedRecord(embed)) {
      return this.formatRecordEmbed(embed)
    } else if (isEmbedRecordWithMedia(embed)) {
      return this.formatRecordWithMediaEmbed(did, embed)
    } else {
      return null
    }
  }

  async formatSimpleEmbed(embed: EmbedImages | EmbedExternal) {
    if (isEmbedImages(embed)) {
      const images = embed.images.map((img) => ({
        thumb: this.getImageUrl('feed_thumbnail', img.image.ref.toString()),
        fullsize: this.getImageUrl('feed_fullsize', img.image.ref.toString()),
        alt: img.alt,
      }))
      return {
        $type: 'app.bsky.embed.images#view',
        images,
      }
    } else {
      const { uri, title, description, thumb } = embed.external
      return {
        $type: 'app.bsky.embed.external#view',
        uri,
        title,
        description,
        thumb: thumb
          ? this.getImageUrl('feed_thumbnail', thumb.ref.toString())
          : undefined,
      }
    }
  }

  async formatRecordEmbed(embed: EmbedRecord): Promise<EmbedRecordView> {
    const view = await this.formatRecordEmbedInternal(embed)
    return {
      $type: 'app.bsky.embed.record#view',
      record:
        view === null
          ? {
              $type: 'app.bsky.embed.record#viewNotFound',
              uri: embed.record.uri,
            }
          : view,
    }
  }

  async formatRecordEmbedInternal(embed: EmbedRecord) {
    if (!this.appViewAgent || !this.appviewDid) {
      return null
    }
    const collection = new AtUri(embed.record.uri).collection
    if (collection === ids.AppBskyFeedPost) {
      const res = await this.appViewAgent.api.app.bsky.feed.getPosts(
        {
          uris: [embed.record.uri],
        },
        await this.serviceAuthHeaders(this.did),
      )
      const post = res.data.posts[0]
      if (!post) return null
      return {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: post.uri,
        cid: post.cid,
        author: post.author,
        value: post.record,
        labels: post.labels,
        embeds: post.embed ? [post.embed] : undefined,
        indexedAt: post.indexedAt,
      }
    } else if (collection === ids.AppBskyFeedGenerator) {
      const res = await this.appViewAgent.api.app.bsky.feed.getFeedGenerator(
        {
          feed: embed.record.uri,
        },
        await this.serviceAuthHeaders(this.did),
      )
      return {
        $type: 'app.bsaky.feed.defs#generatorView',
        ...res.data.view,
      }
    } else if (collection === ids.AppBskyGraphList) {
      const res = await this.appViewAgent.api.app.bsky.graph.getList(
        {
          list: embed.record.uri,
        },
        await this.serviceAuthHeaders(this.did),
      )
      return {
        $type: 'app.bsaky.graph.defs#listView',
        ...res.data.list,
      }
    }
    return null
  }

  async formatRecordWithMediaEmbed(did: string, embed: EmbedRecordWithMedia) {
    if (!isEmbedImages(embed.media) && !isEmbedExternal(embed.media)) {
      return null
    }
    const media = this.formatSimpleEmbed(embed.media)
    const record = await this.formatRecordEmbed(embed.record)
    return {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record,
      media,
    }
  }

  updateProfileViewBasic(
    view: ProfileViewBasic,
    record: ProfileRecord,
  ): ProfileViewBasic {
    return {
      ...view,
      displayName: record.displayName,
      avatar: record.avatar
        ? this.getImageUrl('avatar', record.avatar.ref.toString())
        : undefined,
    }
  }

  updateProfileView(view: ProfileView, record: ProfileRecord): ProfileView {
    return {
      ...this.updateProfileViewBasic(view, record),
      description: record.description,
    }
  }

  updateProfileDetailed(
    view: ProfileViewDetailed,
    record: ProfileRecord,
  ): ProfileViewDetailed {
    return {
      ...this.updateProfileView(view, record),
      banner: record.banner
        ? this.getImageUrl('banner', record.banner.ref.toString())
        : undefined,
    }
  }
}