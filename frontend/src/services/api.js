const TOKEN_KEY = 'vrcall.token'

// sessionStorage (not localStorage) so two tabs can be logged in as different users.
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

let onUnauthorized = () => {}

// AuthContext registers a callback here so a 401 logs the user out.
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken()
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the server. Check that the backend is running.')
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    // A 401 on a request that sent a token means the session is no longer valid.
    if (response.status === 401 && token) {
      clearToken()
      onUnauthorized()
    }
    const error = new Error(data.error || `Request failed (${response.status}).`)
    error.status = response.status
    throw error
  }

  return data
}
