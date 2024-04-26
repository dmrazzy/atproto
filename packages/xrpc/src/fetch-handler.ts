import { Awaitable, HeaderGetter } from './types'
import { combineHeaders } from './util'

export type FetchHandler = (
  this: void,
  /**
   * The URL (pathname + query parameters) to make the request to, without the
   * origin. The origin (protocol, hostname, and port) must be added by this
   * {@link FetchHandler}, typically based on authentication or other factors.
   */
  url: string,
  init: RequestInit,
) => Promise<Response>

export type FetchHandlerOptions = BuildFetchHandlerOptions | string | URL

export type BuildFetchHandlerOptions = {
  /**
   * The service URL to make requests to. This can be a string, URL, or a
   * function that returns a string or URL. This is useful for dynamic URLs,
   * such as a service URL that changes based on authentication.
   */
  service: string | URL | (() => Awaitable<string | URL>)

  /**
   * Headers to be added to every request. If a function is provided, it will be
   * called on each request to get the headers. This is useful for dynamic
   * headers, such as authentication tokens that may expire.
   */
  headers?: {
    [_ in string]?: HeaderGetter
  }

  /**
   * Bring your own fetch implementation. Typically useful for testing, logging,
   * mocking, or adding retries, session management, signatures, proof of
   * possession (DPoP), etc. Defaults to the global `fetch` function.
   */
  fetch?: typeof globalThis.fetch
}

export function buildFetchHandler(options: FetchHandlerOptions): FetchHandler {
  const {
    service,
    headers: extraHeaders = undefined,
    fetch = globalThis.fetch,
  } = typeof options === 'string' || options instanceof URL
    ? { service: options }
    : options

  if (typeof fetch !== 'function') {
    throw new TypeError(
      'XrpcDispatcher requires fetch() to be available in your environment.',
    )
  }

  return async function (url, init) {
    const base = typeof service === 'function' ? await service() : service
    const fullUrl = new URL(url, base)

    const headers =
      extraHeaders != null
        ? await combineHeaders(init.headers, Object.entries(extraHeaders))
        : init.headers

    return fetch(fullUrl, { ...init, headers })
  }
}
