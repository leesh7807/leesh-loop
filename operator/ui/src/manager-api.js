export function createManagerApiFetch({ token, instanceId, fetchImpl = globalThis.fetch } = {}) {
  return (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('x-leesh-loop-token', token);
    if (instanceId) headers.set('x-leesh-loop-instance-id', instanceId);
    else headers.delete('x-leesh-loop-instance-id');
    return fetchImpl(input, { ...init, headers });
  };
}
