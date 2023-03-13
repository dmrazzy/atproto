import assert from 'assert'

export interface ServerConfigValues {
  version: string
  port?: number
  publicUrl?: string
  dbPostgresUrl: string
  dbPostgresSchema?: string
  blobstoreLocation?: string
  blobstoreTmp?: string
  didPlcUrl: string
  imgUriSalt: string
  imgUriKey: string
  imgUriEndpoint?: string
  blobCacheLocation?: string
  repoProvider: string
  repoSubLockId?: number
}

export class ServerConfig {
  constructor(private cfg: ServerConfigValues) {}

  static readEnv(overrides?: Partial<ServerConfigValues>) {
    const version = process.env.BSKY_VERSION || '0.0.0'
    const publicUrl = process.env.PUBLIC_URL || undefined
    const envPort = parseInt(process.env.PORT || '', 10)
    const port = isNaN(envPort) ? 2583 : envPort
    const didPlcUrl = process.env.DID_PLC_URL || 'http://localhost:2582'
    const blobstoreLocation = process.env.BLOBSTORE_LOC
    const blobstoreTmp = process.env.BLOBSTORE_TMP
    const imgUriSalt =
      process.env.IMG_URI_SALT || '9dd04221f5755bce5f55f47464c27e1e'
    const imgUriKey =
      process.env.IMG_URI_KEY ||
      'f23ecd142835025f42c3db2cf25dd813956c178392760256211f9d315f8ab4d8'
    const imgUriEndpoint = process.env.IMG_URI_ENDPOINT
    const blobCacheLocation = process.env.BLOB_CACHE_LOC
    const dbPostgresUrl = process.env.DB_POSTGRES_URL
    assert(dbPostgresUrl)
    const dbPostgresSchema = process.env.DB_POSTGRES_SCHEMA
    const repoProvider = process.env.REPO_PROVIDER // E.g. ws://abc.com:4000
    assert(repoProvider)
    return new ServerConfig({
      version,
      port,
      publicUrl,
      dbPostgresUrl,
      dbPostgresSchema,
      blobstoreLocation,
      blobstoreTmp,
      didPlcUrl,
      imgUriSalt,
      imgUriKey,
      imgUriEndpoint,
      blobCacheLocation,
      repoProvider,
      ...overrides,
    })
  }

  get version() {
    return this.cfg.version
  }

  get port() {
    return this.cfg.port
  }

  get publicUrl() {
    return this.cfg.publicUrl
  }

  get dbPostgresUrl() {
    return this.cfg.dbPostgresUrl
  }

  get dbPostgresSchema() {
    return this.cfg.dbPostgresSchema
  }

  get blobstoreLocation() {
    return this.cfg.blobstoreLocation
  }

  get blobstoreTmp() {
    return this.cfg.blobstoreTmp
  }

  get didPlcUrl() {
    return this.cfg.didPlcUrl
  }

  get imgUriSalt() {
    return this.cfg.imgUriSalt
  }

  get imgUriKey() {
    return this.cfg.imgUriKey
  }

  get imgUriEndpoint() {
    return this.cfg.imgUriEndpoint
  }

  get blobCacheLocation() {
    return this.cfg.blobCacheLocation
  }

  get repoProvider() {
    return this.cfg.repoProvider
  }

  get repoSubLockId() {
    return this.cfg.repoSubLockId
  }
}
