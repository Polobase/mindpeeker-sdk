export interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  body: string | undefined
}

export interface MockFetch {
  fetch: typeof fetch
  calls: RecordedRequest[]
}

/**
 * Build a `fetch` stub from a handler. Every call is recorded (url, method,
 * headers, body) so tests can assert on the outgoing request.
 */
export function mockFetch(
  handler: (req: RecordedRequest, callIndex: number) => Response | Promise<Response>,
): MockFetch {
  const calls: RecordedRequest[] = []
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    if (request.signal.aborted) throw request.signal.reason
    const recorded: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: init?.body === undefined ? undefined : await request.text(),
    }
    calls.push(recorded)
    const response = await handler(recorded, calls.length - 1)
    if (request.signal.aborted) throw request.signal.reason
    return response
  }
  return { fetch: impl as typeof fetch, calls }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

/** A fetch stub that never settles until the request's signal aborts. */
export function hangingFetch(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    return new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason))
    })
  }) as typeof fetch
}
