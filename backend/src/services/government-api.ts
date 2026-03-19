import { logger, redis, prisma } from "../index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface UAEPassAuthRequest {
  authorizationCode: string;
  redirectUri: string;
  identityId: string;
}

export interface UAEPassProfile {
  uuid: string;
  fullNameEN: string;
  fullNameAR: string;
  gender: string;
  nationalityEN: string;
  nationalityAR: string;
  dateOfBirth: string;
  idCardNumber: string;
  idCardExpiryDate: string;
  passportNumber?: string;
  email?: string;
  mobile?: string;
  photo?: string;
  idn: string;
  userType: "CITIZEN" | "RESIDENT" | "VISITOR";
}

export interface EmiratesIDVerificationRequest {
  idNumber: string;
  dateOfBirth: string;
  identityId: string;
}

export interface EmiratesIDVerificationResult {
  verified: boolean;
  idNumber: string;
  fullName: string;
  nationality: string;
  expiryDate: string;
  status: "VALID" | "EXPIRED" | "CANCELLED" | "NOT_FOUND";
}

export interface GovernmentVerificationResult {
  verified: boolean;
  provider: string;
  referenceId: string;
  verifiedFields: string[];
  verifiedAt: Date;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const UAE_PASS_CONFIG = {
  clientId: process.env.UAE_PASS_CLIENT_ID ?? "",
  clientSecret: process.env.UAE_PASS_CLIENT_SECRET ?? "",
  tokenEndpoint:
    process.env.UAE_PASS_TOKEN_URL ?? "https://stg-id.uaepass.ae/idshub/token",
  userInfoEndpoint:
    process.env.UAE_PASS_USERINFO_URL ??
    "https://stg-id.uaepass.ae/idshub/userinfo",
  authEndpoint:
    process.env.UAE_PASS_AUTH_URL ??
    "https://stg-id.uaepass.ae/idshub/authorize",
  scope: "urn:uae:digitalid:profile:general",
};

const EMIRATES_ID_CONFIG = {
  apiUrl: process.env.EMIRATES_ID_API_URL ?? "https://api.ica.gov.ae/v1",
  apiKey: process.env.EMIRATES_ID_API_KEY ?? "",
  apiSecret: process.env.EMIRATES_ID_API_SECRET ?? "",
};

const GOV_VERIFICATION_CACHE_TTL = parseInt(
  process.env.GOV_VERIFICATION_CACHE_TTL ?? "86400",
  10,
);

// ---------------------------------------------------------------------------
// Government API Service
// ---------------------------------------------------------------------------
export class GovernmentAPIService {
  // -------------------------------------------------------------------------
  // UAE Pass: Get authorization URL
  // -------------------------------------------------------------------------
  getUAEPassAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: UAE_PASS_CONFIG.clientId,
      scope: UAE_PASS_CONFIG.scope,
      redirect_uri: redirectUri,
      state,
      acr_values: "urn:safelayer:tws:policies:authentication:level:low",
    });

    return `${UAE_PASS_CONFIG.authEndpoint}?${params.toString()}`;
  }

  // -------------------------------------------------------------------------
  // UAE Pass: Exchange code for tokens and fetch profile
  // -------------------------------------------------------------------------
  async authenticateWithUAEPass(
    request: UAEPassAuthRequest,
  ): Promise<GovernmentVerificationResult> {
    logger.info("uaepass_auth_start", { identityId: request.identityId });

    try {
      // 1. Exchange authorization code for access token
      const tokenResponse = await fetch(UAE_PASS_CONFIG.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: request.authorizationCode,
          redirect_uri: request.redirectUri,
          client_id: UAE_PASS_CONFIG.clientId,
          client_secret: UAE_PASS_CONFIG.clientSecret,
        }),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        logger.error("uaepass_token_exchange_failed", {
          status: tokenResponse.status,
          body: errorBody,
        });
        throw new GovernmentAPIError(
          "UAE Pass token exchange failed",
          "GOV_UAEPASS_TOKEN_FAILED",
        );
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
      };

      // 2. Fetch user profile
      const profileResponse = await fetch(UAE_PASS_CONFIG.userInfoEndpoint, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!profileResponse.ok) {
        throw new GovernmentAPIError(
          "UAE Pass profile fetch failed",
          "GOV_UAEPASS_PROFILE_FAILED",
        );
      }

      const profile = (await profileResponse.json()) as UAEPassProfile;

      // 3. Validate profile data
      this.validateUAEPassProfile(profile);

      // 4. Generate a reference ID for this verification
      const referenceId = `uaepass-${crypto.randomUUID()}`;

      // 5. Update identity with government verification
      await prisma.identity.update({
        where: { id: request.identityId },
        data: {
          governmentVerified: true,
          governmentRefId: referenceId,
        },
      });

      const result: GovernmentVerificationResult = {
        verified: true,
        provider: "UAE_PASS",
        referenceId,
        verifiedFields: [
          "fullName",
          "nationality",
          "dateOfBirth",
          "idCardNumber",
          "userType",
        ],
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600_000), // 1 year
      };

      // 6. Cache verification result
      await redis.set(
        `gov:verification:${request.identityId}`,
        JSON.stringify(result),
        "EX",
        GOV_VERIFICATION_CACHE_TTL,
      );

      // 7. Audit log
      await prisma.auditLog.create({
        data: {
          identityId: request.identityId,
          action: "GOV_API_CALLED",
          resourceType: "government_verification",
          resourceId: referenceId,
          details: {
            provider: "UAE_PASS",
            userType: profile.userType,
            verifiedFields: result.verifiedFields,
          },
        },
      });

      logger.info("uaepass_auth_success", {
        identityId: request.identityId,
        referenceId,
        userType: profile.userType,
      });

      return result;
    } catch (err) {
      if (err instanceof GovernmentAPIError) throw err;

      logger.error("uaepass_auth_error", {
        identityId: request.identityId,
        error: (err as Error).message,
      });

      throw new GovernmentAPIError(
        `UAE Pass authentication failed: ${(err as Error).message}`,
        "GOV_UAEPASS_ERROR",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Emirates ID: Verify identity card
  // -------------------------------------------------------------------------
  async verifyEmiratesID(
    request: EmiratesIDVerificationRequest,
  ): Promise<GovernmentVerificationResult> {
    logger.info("emirates_id_verification_start", {
      identityId: request.identityId,
    });

    // Validate Emirates ID format: 784-YYYY-NNNNNNN-C
    if (!this.isValidEmiratesIDFormat(request.idNumber)) {
      throw new GovernmentAPIError(
        "Invalid Emirates ID format",
        "GOV_EID_INVALID_FORMAT",
      );
    }

    try {
      // Check cache first
      const cacheKey = `gov:eid:${this.hashSensitiveData(request.idNumber)}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info("emirates_id_cache_hit", {
          identityId: request.identityId,
        });
        return JSON.parse(cached) as GovernmentVerificationResult;
      }

      // Call ICA (Federal Authority for Identity and Citizenship) API
      const response = await fetch(
        `${EMIRATES_ID_CONFIG.apiUrl}/identity/verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": EMIRATES_ID_CONFIG.apiKey,
            "X-API-Secret": EMIRATES_ID_CONFIG.apiSecret,
          },
          body: JSON.stringify({
            idNumber: request.idNumber,
            dateOfBirth: request.dateOfBirth,
          }),
        },
      );

      if (!response.ok) {
        const statusCode = response.status;
        if (statusCode === 404) {
          throw new GovernmentAPIError(
            "Emirates ID not found",
            "GOV_EID_NOT_FOUND",
            404,
          );
        }
        throw new GovernmentAPIError(
          "Emirates ID verification API error",
          "GOV_EID_API_ERROR",
        );
      }

      const verificationData =
        (await response.json()) as EmiratesIDVerificationResult;

      // Check card validity
      if (verificationData.status !== "VALID") {
        const referenceId = `eid-${crypto.randomUUID()}`;

        await prisma.auditLog.create({
          data: {
            identityId: request.identityId,
            action: "GOV_API_CALLED",
            resourceType: "government_verification",
            resourceId: referenceId,
            details: {
              provider: "EMIRATES_ID",
              status: verificationData.status,
              verified: false,
            },
          },
        });

        throw new GovernmentAPIError(
          `Emirates ID status: ${verificationData.status}`,
          "GOV_EID_INVALID_STATUS",
        );
      }

      const referenceId = `eid-${crypto.randomUUID()}`;

      // Update identity
      await prisma.identity.update({
        where: { id: request.identityId },
        data: {
          governmentVerified: true,
          governmentRefId: referenceId,
        },
      });

      const result: GovernmentVerificationResult = {
        verified: true,
        provider: "EMIRATES_ID",
        referenceId,
        verifiedFields: ["fullName", "nationality", "idNumber", "expiryDate"],
        verifiedAt: new Date(),
        expiresAt: new Date(verificationData.expiryDate),
      };

      // Cache result
      await redis.set(
        cacheKey,
        JSON.stringify(result),
        "EX",
        GOV_VERIFICATION_CACHE_TTL,
      );

      // Audit log
      await prisma.auditLog.create({
        data: {
          identityId: request.identityId,
          action: "GOV_API_CALLED",
          resourceType: "government_verification",
          resourceId: referenceId,
          details: {
            provider: "EMIRATES_ID",
            verified: true,
            verifiedFields: result.verifiedFields,
          },
        },
      });

      logger.info("emirates_id_verified", {
        identityId: request.identityId,
        referenceId,
      });

      return result;
    } catch (err) {
      if (err instanceof GovernmentAPIError) throw err;

      logger.error("emirates_id_verification_error", {
        identityId: request.identityId,
        error: (err as Error).message,
      });

      throw new GovernmentAPIError(
        `Emirates ID verification failed: ${(err as Error).message}`,
        "GOV_EID_ERROR",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Check if government verification is still valid
  // -------------------------------------------------------------------------
  async getVerificationStatus(
    identityId: string,
  ): Promise<GovernmentVerificationResult | null> {
    const cached = await redis.get(`gov:verification:${identityId}`);
    if (cached) {
      const result = JSON.parse(cached) as GovernmentVerificationResult;
      if (new Date(result.expiresAt) > new Date()) {
        return result;
      }
    }

    // Check identity record
    const identity = await prisma.identity.findUnique({
      where: { id: identityId },
      select: { governmentVerified: true, governmentRefId: true },
    });

    if (!identity?.governmentVerified || !identity.governmentRefId) {
      return null;
    }

    return {
      verified: identity.governmentVerified,
      provider: identity.governmentRefId.startsWith("uaepass-")
        ? "UAE_PASS"
        : "EMIRATES_ID",
      referenceId: identity.governmentRefId,
      verifiedFields: [],
      verifiedAt: new Date(), // Exact timestamp not available from DB alone
      expiresAt: new Date(Date.now() + 365 * 24 * 3600_000),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private validateUAEPassProfile(profile: UAEPassProfile): void {
    if (!profile.uuid || !profile.fullNameEN || !profile.idCardNumber) {
      throw new GovernmentAPIError(
        "Incomplete UAE Pass profile data",
        "GOV_UAEPASS_INCOMPLETE_PROFILE",
      );
    }

    if (!["CITIZEN", "RESIDENT", "VISITOR"].includes(profile.userType)) {
      throw new GovernmentAPIError(
        `Unknown user type: ${profile.userType}`,
        "GOV_UAEPASS_UNKNOWN_USER_TYPE",
      );
    }
  }

  private isValidEmiratesIDFormat(idNumber: string): boolean {
    // Format: 784-YYYY-NNNNNNN-C (15 digits total when hyphens removed)
    const cleaned = idNumber.replace(/-/g, "");
    if (cleaned.length !== 15) return false;
    if (!cleaned.startsWith("784")) return false;
    return /^\d{15}$/.test(cleaned);
  }

  private hashSensitiveData(data: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------
export class GovernmentAPIError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = "GovernmentAPIError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const governmentAPIService = new GovernmentAPIService();
