let csrf = '';
export const setCSRF = (value: string) => {
  csrf = value;
};
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
    public code = '',
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...options.headers,
      },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new APIError('Could not reach your CRM. Check your connection and try again.', 0);
  }
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth'))
      window.dispatchEvent(new Event('crm:expired'));
    throw new APIError(
      body.error || 'This request could not be completed.',
      res.status,
      body.fields,
      body.code,
    );
  }
  return body;
}
export const post = (path: string, data: unknown) =>
  api(path, { method: 'POST', body: JSON.stringify(data) });
