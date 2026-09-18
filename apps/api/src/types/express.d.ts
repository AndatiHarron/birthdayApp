import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    /** Set by `requireAuth` / `optionalAuth`. */
    interface AuthContext {
      userId: string;
      role: UserRole;
      isPremium: boolean;
      sessionId: string;
    }

    interface Request {
      /** Correlation id, echoed back as `x-request-id`. */
      id: string;
      auth?: AuthContext;
      /** Populated by the `validate` middleware from the matching schema. */
      valid: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
