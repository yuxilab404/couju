import type { Me } from '@couju/protocol';
import { href } from '../base.ts';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(href(path), {
    method,
    headers: raw ? { 'Content-Type': raw.type } : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    return (await api<{ me: Me }>('GET', '/api/me')).me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
