import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { validate, auditQuerySchema, uuidSchema } from '../middleware/validation';
import { prisma, logger } from '../index';
import { z } from 'zod';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/v1/audit — Query audit logs
// ---------------------------------------------------------------------------
router.get(
  '/',
  validate({ query: auditQuerySchema }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { identityId, action, resourceType, resourceId, from, to, page, limit } =
        req.query as unknown as z.infer<typeof auditQuerySchema>;

      // Users can only view their own audit logs unless they are querying
      // by a resource they have access to
      const where: Record<string, unknown> = {};

      if (identityId) {
        // Only allow viewing own logs
        if (identityId !== identity.id) {
          res.status(403).json({
            error: 'Can only view own audit logs',
            code: 'AUDIT_ACCESS_DENIED',
          });
          return;
        }
        where.identityId = identityId;
      } else {
        where.identityId = identity.id;
      }

      if (action) where.action = action;
      if (resourceType) where.resourceType = resourceType;
      if (resourceId) where.resourceId = resourceId;

      if (from || to) {
        where.timestamp = {};
        if (from) (where.timestamp as Record<string, Date>).gte = new Date(from);
        if (to) (where.timestamp as Record<string, Date>).lte = new Date(to);
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            identityId: true,
            action: true,
            resourceType: true,
            resourceId: true,
            details: true,
            ipAddress: true,
            timestamp: true,
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        data: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('audit_query_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/audit/:id — Get a single audit log entry
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  validate({ params: z.object({ id: uuidSchema }) }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;

      const log = await prisma.auditLog.findUnique({
        where: { id: req.params.id as string },
      });

      if (!log) {
        res.status(404).json({ error: 'Audit log not found', code: 'AUDIT_NOT_FOUND' });
        return;
      }

      // Verify access
      if (log.identityId && log.identityId !== identity.id) {
        res.status(403).json({ error: 'Access denied', code: 'AUDIT_ACCESS_DENIED' });
        return;
      }

      res.json({ data: log });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/audit/resource/:type/:id — Get audit trail for a resource
// ---------------------------------------------------------------------------
router.get(
  '/resource/:type/:resourceId',
  validate({
    params: z.object({
      type: z.enum(['identity', 'credential', 'schema', 'verification', 'attestation', 'session', 'government_verification']),
      resourceId: uuidSchema,
    }),
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { type, resourceId } = req.params;
      const { page, limit } = req.query as unknown as { page: number; limit: number };

      // Verify the user has access to this resource
      const hasAccess = await verifyResourceAccess(identity.id, type as string, resourceId as string);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied to this resource', code: 'AUDIT_RESOURCE_ACCESS_DENIED' });
        return;
      }

      const where = { resourceType: type as string, resourceId: resourceId as string };

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        data: logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/audit/summary — Get audit summary / statistics
// ---------------------------------------------------------------------------
router.get(
  '/summary/stats',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000);

      const [totalEvents, recentEvents, actionBreakdown] = await Promise.all([
        prisma.auditLog.count({
          where: { identityId: identity.id },
        }),
        prisma.auditLog.count({
          where: {
            identityId: identity.id,
            timestamp: { gte: thirtyDaysAgo },
          },
        }),
        prisma.auditLog.groupBy({
          by: ['action'],
          where: { identityId: identity.id },
          _count: { action: true },
          orderBy: { _count: { action: 'desc' } },
          take: 10,
        }),
      ]);

      const lastActivity = await prisma.auditLog.findFirst({
        where: { identityId: identity.id },
        orderBy: { timestamp: 'desc' },
        select: { action: true, timestamp: true, resourceType: true },
      });

      res.json({
        data: {
          totalEvents,
          eventsLast30Days: recentEvents,
          actionBreakdown: actionBreakdown.map((a) => ({
            action: a.action,
            count: a._count.action,
          })),
          lastActivity: lastActivity
            ? {
                action: lastActivity.action,
                resourceType: lastActivity.resourceType,
                timestamp: lastActivity.timestamp,
              }
            : null,
        },
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      logger.error('audit_summary_error', { error: error.message });
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/audit/export — Export audit logs as JSON
// ---------------------------------------------------------------------------
router.get(
  '/export/download',
  validate({
    query: z.object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      format: z.enum(['json']).default('json'),
    }),
  }),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const identity = req.identity!;
      const { from, to } = req.query as unknown as { from: Date; to: Date };

      // Limit export window to 90 days
      const maxRangeMs = 90 * 24 * 3600_000;
      if (to.getTime() - from.getTime() > maxRangeMs) {
        res.status(400).json({
          error: 'Export range cannot exceed 90 days',
          code: 'AUDIT_EXPORT_RANGE_TOO_LARGE',
        });
        return;
      }

      const logs = await prisma.auditLog.findMany({
        where: {
          identityId: identity.id,
          timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: 'asc' },
        take: 10000, // Hard cap
      });

      res.set('Content-Type', 'application/json');
      res.set('Content-Disposition', `attachment; filename="audit-${identity.id}-${from.toISOString().split('T')[0]}.json"`);

      res.json({
        exportedAt: new Date().toISOString(),
        identityId: identity.id,
        range: { from, to },
        totalRecords: logs.length,
        records: logs,
      });
    } catch (err) {
      const error = err as Error & { statusCode?: number; code?: string };
      res.status(error.statusCode ?? 500).json({ error: error.message, code: error.code });
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function verifyResourceAccess(
  identityId: string,
  resourceType: string,
  resourceId: string,
): Promise<boolean> {
  switch (resourceType) {
    case 'identity':
      return resourceId === identityId;

    case 'credential': {
      const cred = await prisma.credential.findUnique({
        where: { id: resourceId },
        select: { issuerId: true, subjectId: true },
      });
      return cred !== null && (cred.issuerId === identityId || cred.subjectId === identityId);
    }

    case 'schema': {
      const schema = await prisma.schemaGovernance.findUnique({
        where: { id: resourceId },
        select: { proposedBy: true },
      });
      return schema !== null && schema.proposedBy === identityId;
    }

    case 'verification': {
      const verification = await prisma.verification.findUnique({
        where: { id: resourceId },
        select: { verifierId: true, subjectId: true },
      });
      return verification !== null &&
        (verification.verifierId === identityId || verification.subjectId === identityId);
    }

    default:
      // For attestation, session, government_verification: check audit log ownership
      const log = await prisma.auditLog.findFirst({
        where: { resourceType, resourceId, identityId },
      });
      return log !== null;
  }
}

export { router as auditRoutes };
