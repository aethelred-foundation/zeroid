import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';
import {
  EnterpriseContext,
  EnterpriseOrganizationError,
  EnterpriseRole,
  enterpriseOrganizationService,
} from '../services/enterprise/organization-service';

export interface EnterpriseAuthenticatedRequest extends AuthenticatedRequest {
  enterpriseContext?: EnterpriseContext;
}

function extractRequestedOrganizationId(req: Request): string | undefined {
  const headerValue = req.headers['x-zeroid-org-id'];
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  const queryValue = req.query.organizationId;
  if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
    return queryValue.trim();
  }

  return undefined;
}

export function requireEnterpriseContext(
  requiredRoles: EnterpriseRole[],
  resolveOrganizationId?: (req: Request) => string | undefined,
) {
  return async (
    req: EnterpriseAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const identityId = req.identity?.id;
      if (!identityId) {
        res.status(401).json({
          error: 'Authenticated enterprise identity required',
          code: 'ENTERPRISE_AUTH_REQUIRED',
        });
        return;
      }

      const organizationId = resolveOrganizationId?.(req) ?? extractRequestedOrganizationId(req);
      req.enterpriseContext = await enterpriseOrganizationService.resolveContext(
        identityId,
        organizationId,
        requiredRoles,
      );
      next();
    } catch (error) {
      if (error instanceof EnterpriseOrganizationError) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
        });
        return;
      }

      next(error);
    }
  };
}
