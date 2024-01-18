import { envInt, envList, envStr } from '@atproto/common'

export const readEnv = (): OzoneEnvironment => {
  return {
    nodeEnv: envStr('NODE_ENV'),
    version: envStr('OZONE_VERSION'),
    port: envInt('OZONE_PORT'),
    publicUrl: envStr('OZONE_PUBLIC_URL'),
    serverDid: envStr('OZONE_SERVER_DID'),
    appviewUrl: envStr('OZONE_APPVIEW_URL'),
    appviewDid: envStr('OZONE_APPVIEW_DID'),
    pdsUrl: envStr('OZONE_PDS_URL'),
    pdsDid: envStr('OZONE_PDS_DID'),
    dbPostgresUrl: envStr('OZONE_DB_POSTGRES_URL'),
    dbPostgresSchema: envStr('OZONE_DB_POSTGRES_SCHEMA'),
    didPlcUrl: envStr('OZONE_DID_PLC_URL'),
    moderatorDids: envList('OZONE_MODERATOR_DIDS'),
    triageDids: envList('OZONE_TRIAGE_DIDS'),
    signingKeyHex: envStr('OZONE_SIGNING_KEY_HEX'),
  }
}

export type OzoneEnvironment = {
  nodeEnv?: string
  version?: string
  port?: number
  publicUrl?: string
  serverDid?: string
  appviewUrl?: string
  appviewDid?: string
  pdsUrl?: string
  pdsDid?: string
  dbPostgresUrl?: string
  dbPostgresSchema?: string
  didPlcUrl?: string
  moderatorDids: string[]
  triageDids: string[]
  signingKeyHex?: string
}