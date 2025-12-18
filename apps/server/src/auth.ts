import { NextFunction, Request, RequestHandler, Response } from 'express';

export interface AuthenticatedUser {
  id: string;
  roles: string[];
  email?: string;
  displayName?: string;
}

export type PermissionAction = 'read' | 'write' | 'delete';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends AuthenticatedUser {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function resolveUserFromHeaders(req: Request): AuthenticatedUser {
  const id = req.header('x-user-id');
  const name = req.header('x-user-name');
  const user: AuthenticatedUser = {
    id: id ?? 'anonymous',
    displayName: name ?? id ?? 'Anonymous',
    roles: id ? ['user'] : ['guest'],
  };
  return user;
}

export function attachUser(): RequestHandler {
  return (req, _res, next) => {
    // Placeholder for future SSO/session integration.
    // This hook will later validate cookies or bearer tokens to populate req.user.
    req.user = resolveUserFromHeaders(req);
    next();
  };
}

export function requireUser(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    next();
  };
}

export function requireWorkspacePermission(action: PermissionAction): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (!hasWorkspacePermission(user, action)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

function hasWorkspacePermission(_user: AuthenticatedUser, _action: PermissionAction): boolean {
  // Placeholder hook: future SSO/ACL integration can enforce ownership and roles here.
  return true;
}
