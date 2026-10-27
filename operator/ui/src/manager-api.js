export function createManagerApiFetch({ token, tokenProvider, instanceId, fetchImpl = globalThis.fetch } = {}) {
  let apiToken = token || null;
  let tokenPromise = null;

  async function readToken(force = false) {
    if (apiToken && !force) return apiToken;
    if (!tokenProvider) return apiToken;
    if (!tokenPromise) {
      tokenPromise = Promise.resolve(tokenProvider()).then(value => {
        apiToken = value;
        return value;
      }).finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  return async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (instanceId) headers.set('x-leesh-loop-instance-id', instanceId);
    else headers.delete('x-leesh-loop-instance-id');

    const request = async () => {
      const currentToken = await readToken();
      if (currentToken) headers.set('x-leesh-loop-token', currentToken);
      else headers.delete('x-leesh-loop-token');
      return fetchImpl(input, { ...init, headers });
    };

    const response = await request();
    if (response.status !== 401 || !tokenProvider) return response;

    apiToken = null;
    await readToken(true);
    return request();
  };
}
