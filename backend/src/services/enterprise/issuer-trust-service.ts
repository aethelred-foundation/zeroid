import { z } from 'zod';
import { prisma } from '../../index';

export const ISSUER_TRUST_STATUSES = [
  'pending_review',
  'accredited',
  'suspended',
  'revoked',
] as const;

export type IssuerTrustStatus = typeof ISSUER_TRUST_STATUSES[number];

export const ISSUER_KEY_STATUSES = [
  'active',
  'retired',
  'revoked',
] as const;

export type IssuerKeyStatus = typeof ISSUER_KEY_STATUSES[number];

export const RegisterIssuerTrustSchema = z.object({
  issuerIdentityId: z.string().min(1).optional(),
  issuerDid: z.string().min(3).optional(),
  accreditationScope: z.enum(['enterprise', 'sovereign', 'regulated_marketplace']).default('enterprise'),
  assuranceLevel: z.enum(['standard', 'advanced', 'qualified', 'sovereign']).default('standard'),
  allowedCredentialTypes: z.array(z.string().min(1)).min(1),
  allowedJurisdictions: z.array(z.string().min(2).max(32)).default([]),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
}).refine((value) => Boolean(value.issuerIdentityId || value.issuerDid), {
  message: 'Either issuerIdentityId or issuerDid is required',
  path: ['issuerIdentityId'],
});

export type RegisterIssuerTrustInput = z.infer<typeof RegisterIssuerTrustSchema>;

export const RecordIssuerKeySchema = z.object({
  keyVersion: z.string().min(1).max(64),
  keyAlgorithm: z.string().min(1).max(64),
  publicKey: z.string().min(32),
  verificationMethod: z.string().min(1).max(255),
  status: z.enum(ISSUER_KEY_STATUSES).default('active'),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type RecordIssuerKeyInput = z.infer<typeof RecordIssuerKeySchema>;

export interface IssuerTrustSummary {
  id: string;
  organizationId: string;
  issuerIdentityId: string;
  issuerDid: string;
  issuerDisplayName: string | null;
  status: IssuerTrustStatus;
  accreditationScope: string;
  assuranceLevel: string;
  allowedCredentialTypes: string[];
  allowedJurisdictions: string[];
  proposedByIdentityId: string;
  accreditedByIdentityId: string | null;
  suspensionReason: string | null;
  metadata: Record<string, unknown> | null;
  accreditedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssuerKeyHistorySummary {
  id: string;
  issuerIdentityId: string;
  issuerDid: string;
  keyVersion: string;
  keyAlgorithm: string;
  verificationMethod: string;
  status: IssuerKeyStatus;
  validFrom: Date;
  validUntil: Date | null;
  rotatedByIdentityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export class IssuerTrustRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'IssuerTrustRegistryError';
  }
}

export class IssuerTrustRegistryService {
  async registerIssuerTrust(
    organizationId: string,
    proposedByIdentityId: string,
    input: RegisterIssuerTrustInput,
  ): Promise<IssuerTrustSummary> {
    const parsed = RegisterIssuerTrustSchema.parse(input);
    const identity = await this.resolveIssuerIdentity(parsed);

    const trustModel = this.getTrustModel();
    const existing = await trustModel.findFirst({
      where: {
        organizationId,
        issuerIdentityId: identity.id,
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (existing && existing.status !== 'REVOKED') {
      throw new IssuerTrustRegistryError(
        'Issuer already has a trust record for this organization',
        'ISSUER_TRUST_DUPLICATE',
        409,
      );
    }

    const record = await trustModel.create({
      data: {
        organizationId,
        issuerIdentityId: identity.id,
        issuerDid: identity.did,
        status: 'PENDING_REVIEW',
        accreditationScope: parsed.accreditationScope.toUpperCase(),
        assuranceLevel: parsed.assuranceLevel.toUpperCase(),
        allowedCredentialTypes: parsed.allowedCredentialTypes,
        allowedJurisdictions: parsed.allowedJurisdictions,
        proposedByIdentityId,
        metadata: parsed.metadata,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: proposedByIdentityId,
        action: 'IDENTITY_UPDATED',
        resourceType: 'issuer_trust_record',
        resourceId: record.id,
        details: {
          organizationId,
          issuerIdentityId: identity.id,
          issuerDid: identity.did,
          status: 'PENDING_REVIEW',
          allowedCredentialTypes: parsed.allowedCredentialTypes,
          allowedJurisdictions: parsed.allowedJurisdictions,
        },
      },
    });

    return this.formatTrustRecord(record);
  }

  async listIssuerTrustRecords(
    organizationId: string,
    status?: IssuerTrustStatus,
  ): Promise<IssuerTrustSummary[]> {
    const trustModel = this.getTrustModel();
    const records = await trustModel.findMany({
      where: {
        organizationId,
        ...(status ? { status: status.toUpperCase() } : {}),
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return records.map((record: any) => this.formatTrustRecord(record));
  }

  async accreditIssuer(
    trustRecordId: string,
    organizationId: string,
    accreditedByIdentityId: string,
  ): Promise<IssuerTrustSummary> {
    const trustModel = this.getTrustModel();
    const record = await this.getTrustRecord(trustRecordId, organizationId);
    if (record.status === 'REVOKED') {
      throw new IssuerTrustRegistryError(
        'Revoked issuer cannot be re-accredited',
        'ISSUER_TRUST_REVOKED',
        409,
      );
    }

    const updated = await trustModel.update({
      where: { id: trustRecordId },
      data: {
        status: 'ACCREDITED',
        accreditedByIdentityId,
        accreditedAt: new Date(),
        suspensionReason: null,
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: accreditedByIdentityId,
        action: 'IDENTITY_UPDATED',
        resourceType: 'issuer_trust_record',
        resourceId: trustRecordId,
        previousState: { status: record.status },
        newState: { status: 'ACCREDITED' },
        details: {
          organizationId,
          issuerIdentityId: record.issuerIdentityId,
        },
      },
    });

    return this.formatTrustRecord(updated);
  }

  async suspendIssuer(
    trustRecordId: string,
    organizationId: string,
    actorIdentityId: string,
    reason: string,
  ): Promise<IssuerTrustSummary> {
    const trustModel = this.getTrustModel();
    const record = await this.getTrustRecord(trustRecordId, organizationId);
    const updated = await trustModel.update({
      where: { id: trustRecordId },
      data: {
        status: 'SUSPENDED',
        suspensionReason: reason,
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        identityId: actorIdentityId,
        action: 'IDENTITY_SUSPENDED',
        resourceType: 'issuer_trust_record',
        resourceId: trustRecordId,
        previousState: { status: record.status },
        newState: { status: 'SUSPENDED', suspensionReason: reason },
        details: {
          organizationId,
          issuerIdentityId: record.issuerIdentityId,
        },
      },
    });

    return this.formatTrustRecord(updated);
  }

  async recordIssuerKeyVersion(
    issuerIdentityId: string,
    rotatedByIdentityId: string,
    input: RecordIssuerKeyInput,
  ): Promise<IssuerKeyHistorySummary> {
    const parsed = RecordIssuerKeySchema.parse(input);
    const identity = await prisma.identity.findUnique({
      where: { id: issuerIdentityId },
      select: {
        id: true,
        did: true,
        status: true,
      },
    });

    if (!identity || identity.status !== 'ACTIVE') {
      throw new IssuerTrustRegistryError(
        'Issuer identity not found or inactive',
        'ISSUER_KEY_IDENTITY_INVALID',
        404,
      );
    }

    const keyHistoryModel = this.getKeyHistoryModel();

    if (parsed.status === 'active') {
      await keyHistoryModel.updateMany?.({
        where: {
          issuerIdentityId,
          status: 'ACTIVE',
        },
        data: {
          status: 'RETIRED',
          validUntil: parsed.validFrom ? new Date(parsed.validFrom) : new Date(),
        },
      });
    }

    const record = await keyHistoryModel.create({
      data: {
        issuerIdentityId,
        issuerDid: identity.did,
        keyVersion: parsed.keyVersion,
        keyAlgorithm: parsed.keyAlgorithm,
        publicKey: parsed.publicKey,
        verificationMethod: parsed.verificationMethod,
        status: parsed.status.toUpperCase(),
        rotatedByIdentityId,
        metadata: parsed.metadata,
        validFrom: parsed.validFrom ? new Date(parsed.validFrom) : new Date(),
        validUntil: parsed.validUntil ? new Date(parsed.validUntil) : undefined,
      },
    });

    if (parsed.status === 'active') {
      await prisma.identity.update({
        where: { id: issuerIdentityId },
        data: {
          publicKey: parsed.publicKey,
          keyVersion: parsed.keyVersion,
          keyAlgorithm: parsed.keyAlgorithm,
          verificationMethod: parsed.verificationMethod,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        identityId: rotatedByIdentityId,
        action: 'SIGNING_KEY_ROTATED',
        resourceType: 'issuer_key_history',
        resourceId: record.id,
        details: {
          issuerIdentityId,
          issuerDid: identity.did,
          keyVersion: parsed.keyVersion,
          keyAlgorithm: parsed.keyAlgorithm,
          status: parsed.status.toUpperCase(),
        },
      },
    });

    return this.formatKeyHistoryRecord(record);
  }

  async listIssuerKeyHistory(issuerIdentityId: string): Promise<IssuerKeyHistorySummary[]> {
    const records = await this.getKeyHistoryModel().findMany({
      where: { issuerIdentityId },
      orderBy: {
        validFrom: 'desc',
      },
    });

    return records.map((record: any) => this.formatKeyHistoryRecord(record));
  }

  private async resolveIssuerIdentity(input: RegisterIssuerTrustInput): Promise<{ id: string; did: string; status: string }> {
    const identity = await prisma.identity.findFirst?.({
      where: input.issuerIdentityId
        ? { id: input.issuerIdentityId }
        : { did: input.issuerDid },
      select: {
        id: true,
        did: true,
        status: true,
      },
    }) ?? await prisma.identity.findUnique({
      where: input.issuerIdentityId
        ? { id: input.issuerIdentityId }
        : { did: input.issuerDid! },
      select: {
        id: true,
        did: true,
        status: true,
      },
    } as any);

    if (!identity || identity.status !== 'ACTIVE') {
      throw new IssuerTrustRegistryError(
        'Issuer identity not found or inactive',
        'ISSUER_TRUST_IDENTITY_INVALID',
        404,
      );
    }

    return identity;
  }

  private async getTrustRecord(trustRecordId: string, organizationId: string): Promise<any> {
    const record = await this.getTrustModel().findFirst({
      where: {
        id: trustRecordId,
        organizationId,
      },
      include: {
        issuer: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!record) {
      throw new IssuerTrustRegistryError(
        'Issuer trust record not found',
        'ISSUER_TRUST_NOT_FOUND',
        404,
      );
    }

    return record;
  }

  private getTrustModel(): any {
    const model = (prisma as any).issuerTrustRecord;
    if (!model) {
      throw new IssuerTrustRegistryError(
        'Issuer trust registry model is not available in this runtime',
        'ISSUER_TRUST_MODEL_UNAVAILABLE',
        500,
      );
    }
    return model;
  }

  private getKeyHistoryModel(): any {
    const model = (prisma as any).issuerKeyHistory;
    if (!model) {
      throw new IssuerTrustRegistryError(
        'Issuer key history model is not available in this runtime',
        'ISSUER_KEY_MODEL_UNAVAILABLE',
        500,
      );
    }
    return model;
  }

  private formatTrustRecord(record: any): IssuerTrustSummary {
    return {
      id: record.id,
      organizationId: record.organizationId,
      issuerIdentityId: record.issuerIdentityId,
      issuerDid: record.issuerDid,
      issuerDisplayName: record.issuer?.displayName ?? null,
      status: String(record.status ?? 'PENDING_REVIEW').toLowerCase() as IssuerTrustStatus,
      accreditationScope: String(record.accreditationScope ?? 'ENTERPRISE').toLowerCase(),
      assuranceLevel: String(record.assuranceLevel ?? 'STANDARD').toLowerCase(),
      allowedCredentialTypes: record.allowedCredentialTypes ?? [],
      allowedJurisdictions: record.allowedJurisdictions ?? [],
      proposedByIdentityId: record.proposedByIdentityId,
      accreditedByIdentityId: record.accreditedByIdentityId ?? null,
      suspensionReason: record.suspensionReason ?? null,
      metadata: (record.metadata ?? null) as Record<string, unknown> | null,
      accreditedAt: record.accreditedAt ?? null,
      expiresAt: record.expiresAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private formatKeyHistoryRecord(record: any): IssuerKeyHistorySummary {
    return {
      id: record.id,
      issuerIdentityId: record.issuerIdentityId,
      issuerDid: record.issuerDid,
      keyVersion: record.keyVersion,
      keyAlgorithm: record.keyAlgorithm,
      verificationMethod: record.verificationMethod,
      status: String(record.status ?? 'ACTIVE').toLowerCase() as IssuerKeyStatus,
      validFrom: record.validFrom,
      validUntil: record.validUntil ?? null,
      rotatedByIdentityId: record.rotatedByIdentityId ?? null,
      metadata: (record.metadata ?? null) as Record<string, unknown> | null,
      createdAt: record.createdAt,
    };
  }
}

export const issuerTrustRegistryService = new IssuerTrustRegistryService();
