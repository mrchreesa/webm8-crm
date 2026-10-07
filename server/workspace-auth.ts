import { createServerClient } from '@supabase/ssr';
import type { Request, Response } from 'express';
import type { Config } from './config.js';
import { sha256 } from './matching.js';

export class WorkspaceAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = 'AUTH_REQUIRED',
  ) {
    super(message);
  }
}

export async function workspaceSession(cfg: Config, req: Request, res: Response) {
  const client = createServerClient(cfg.workspaceAuth.url, cfg.workspaceAuth.publishableKey, {
    cookieOptions: {
      name: 'webm8-workspace-auth',
      path: '/',
      sameSite: 'lax',
      secure: cfg.production,
    },
    cookies: {
      getAll: () =>
        Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (values) =>
        values.forEach(({ name, value, options }) => {
          req.cookies[name] = value;
          // Supabase uses seconds; Express expects milliseconds.
          res.cookie(name, value, {
            ...options,
            maxAge: options.maxAge == null ? undefined : options.maxAge * 1000,
          });
        }),
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  const { data, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500))
    throw new WorkspaceAuthError(
      'Workspace sign-in is temporarily unavailable.',
      503,
      'AUTH_UNAVAILABLE',
    );
  if (error || !data.user) throw new WorkspaceAuthError('Sign in to your WebM8 workspace.', 401);
  const [live, profile, membership, workspace, claims] = await Promise.all([
    client.rpc('is_active_auth_session'),
    client
      .from('profiles')
      .select('id,name,email,global_role,status')
      .eq('id', data.user.id)
      .maybeSingle(),
    client
      .from('workspace_memberships')
      .select('role,status')
      .eq('workspace_id', cfg.workspaceAuth.workspaceId)
      .eq('user_id', data.user.id)
      .maybeSingle(),
    client
      .from('workspaces')
      .select('id,status')
      .eq('id', cfg.workspaceAuth.workspaceId)
      .maybeSingle(),
    client.auth.getClaims(),
  ]);
  if (live.error || profile.error || membership.error || workspace.error)
    throw new WorkspaceAuthError(
      'Workspace access could not be verified. Please try again.',
      503,
      'AUTH_UNAVAILABLE',
    );
  if (live.data !== true || claims.error || !claims.data?.claims.session_id)
    throw new WorkspaceAuthError('Your workspace session has ended.', 401);
  if (!profile.data || profile.data.status !== 'active')
    throw new WorkspaceAuthError('This account is not enabled.', 403, 'ACCESS_DENIED');
  if (profile.data.global_role === 'platform_admin' && claims.data.claims.aal !== 'aal2')
    throw new WorkspaceAuthError('Complete two-step verification.', 401, 'MFA_REQUIRED');
  if (
    workspace.data?.status !== 'active' ||
    membership.data?.status !== 'active' ||
    !['workspace_owner', 'manager'].includes(membership.data.role)
  )
    throw new WorkspaceAuthError(
      'Your account does not have CRM access to this WebM8 workspace.',
      403,
      'ACCESS_DENIED',
    );
  return {
    csrf_token: sha256(`crm-csrf:${claims.data.claims.session_id}`),
    owner: { name: profile.data.name, email: profile.data.email, id: profile.data.id },
    session_id: String(claims.data.claims.session_id),
  };
}
