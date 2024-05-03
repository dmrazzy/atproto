import type { ClientMetadata, Session } from './types'

export type LinkDefinition = {
  title: string
  href: string
  rel?: string
}

export type CustomizationData = {
  name?: string
  logo?: string
  links?: LinkDefinition[]
}

export type ErrorData = {
  error: string
  error_description: string
}

export type AuthorizeData = {
  clientId: string
  clientMetadata: ClientMetadata
  requestUri: string
  csrfCookie: string
  sessions: Session[]
  newSessionsRequireConsent: boolean
  loginHint?: string
}

// see "declareBackendData()" in the backend
const readBackendData = <T>(key: string): T | undefined => {
  const value = window[key] as T | undefined
  delete window[key] // Prevent accidental usage / potential leaks to dependencies
  return value
}

// These values are injected by the backend when it builds the
// page HTML.

export const customizationData = readBackendData<CustomizationData>(
  '__customizationData',
)
export const errorData = readBackendData<ErrorData>('__errorData')
export const authorizeData = readBackendData<AuthorizeData>('__authorizeData')