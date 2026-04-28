import crypto from 'crypto';
import * as https from 'https';
import * as net from 'net';
import { promises as dns } from 'dns';
import type { Prisma } from '@prisma/client';
import { logger, redis, prisma } from '../index';
import { isProductionRuntime } from './production-safety';

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
  userType: 'CITIZEN' | 'RESIDENT' | 'VISITOR';
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
  status: 'VALID' | 'EXPIRED' | 'CANCELLED' | 'NOT_FOUND';
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
const DEFAULT_UAE_PASS_BASE_URL = 'https://stg-id.uaepass.ae';
const UAE_PASS_SCOPE = 'urn:uae:digitalid:profile:general';
const GOVERNMENT_API_TIMEOUT_MS = 10_000;
const GOVERNMENT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const GOVERNMENT_ERROR_PREVIEW_BYTES = 2 * 1024;
const PRIVATE_GOVERNMENT_HOSTNAME_SUFFIXES = [
  '.corp',
  '.home',
  '.internal',
  '.lan',
  '.local',
  '.localhost',
  '.test',
];

interface UAEPassConfig {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  authEndpoint: string;
  scope: 'urn:uae:digitalid:profile:general';
}

interface EmiratesIDConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

type GovernmentProvider = GovernmentVerificationResult['provider'];

interface ResolvedGovernmentAddress {
  address: string;
  family: number;
}

interface ResolvedGovernmentEndpoint {
  endpoint: URL;
  pinnedAddress?: ResolvedGovernmentAddress;
}

interface GovernmentFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

const GOV_VERIFICATION_CACHE_TTL = parseInt(process.env.GOV_VERIFICATION_CACHE_TTL ?? '86400', 10);

// ---------------------------------------------------------------------------
// Government API Service
// ---------------------------------------------------------------------------
export class GovernmentAPIService {
  // -------------------------------------------------------------------------
  // UAE Pass: Get authorization URL
  // -------------------------------------------------------------------------
  getUAEPassAuthUrl(redirectUri: string, state: string): string {
    const config = this.getUAEPassConfig();
    this.assertAllowedUAEPassRedirectUri(redirectUri);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      scope: config.scope,
      redirect_uri: redirectUri,
      state,
      acr_values: 'urn:safelayer:tws:policies:authentication:level:low',
    });

    return `${config.authEndpoint}?${params.toString()}`;
  }

  // -------------------------------------------------------------------------
  // UAE Pass: Exchange code for tokens and fetch profile
  // -------------------------------------------------------------------------
  async authenticateWithUAEPass(request: UAEPassAuthRequest): Promise<GovernmentVerificationResult> {
    logger.info('uaepass_auth_start', { identityId: request.identityId });

    try {
      const config = this.getUAEPassConfig();
      this.assertAllowedUAEPassRedirectUri(request.redirectUri);
      // 1. Exchange authorization code for access token
      const tokenResponse = await this.fetchGovernmentEndpoint(config.tokenEndpoint, 'UAE Pass', 'GOV_UAEPASS', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: request.authorizationCode,
          redirect_uri: request.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorBodyPreview = await this.readGovernmentErrorPreview(tokenResponse);
        logger.error('uaepass_token_exchange_failed', {
          status: tokenResponse.status,
          bodyPreview: redactGovernmentErrorPreview(errorBodyPreview),
        });
        throw new GovernmentAPIError('UAE Pass token exchange failed', 'GOV_UAEPASS_TOKEN_FAILED');
      }

      const tokenData = await this.readGovernmentJsonResponse<{
        access_token: string;
        token_type: string;
        expires_in: number;
      }>(tokenResponse, 'UAE Pass token');

      // 2. Fetch user profile
      const profileResponse = await this.fetchGovernmentEndpoint(config.userInfoEndpoint, 'UAE Pass', 'GOV_UAEPASS', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!profileResponse.ok) {
        throw new GovernmentAPIError('UAE Pass profile fetch failed', 'GOV_UAEPASS_PROFILE_FAILED');
      }

      const profile = await this.readGovernmentJsonResponse<UAEPassProfile>(
        profileResponse,
        'UAE Pass profile',
      );

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
        provider: 'UAE_PASS',
        referenceId,
        verifiedFields: [
          'fullName',
          'nationality',
          'dateOfBirth',
          'idCardNumber',
          'userType',
        ],
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600_000), // 1 year
      };

      // 6. Cache verification result
      await redis.set(
        `gov:verification:${request.identityId}`,
        JSON.stringify(result),
        'EX',
        GOV_VERIFICATION_CACHE_TTL,
      );

      // 7. Audit log
      await prisma.auditLog.create({
        data: {
          identityId: request.identityId,
          action: 'GOV_API_CALLED',
          resourceType: 'government_verification',
          resourceId: referenceId,
          details: {
            provider: 'UAE_PASS',
            userType: profile.userType,
            verifiedFields: result.verifiedFields,
          },
        },
      });

      logger.info('uaepass_auth_success', {
        identityId: request.identityId,
        referenceId,
        userType: profile.userType,
      });

      return result;
    } catch (err) {
      if (err instanceof GovernmentAPIError) throw err;

      logger.error('uaepass_auth_error', {
        identityId: request.identityId,
        error: (err as Error).message,
      });

      throw new GovernmentAPIError(
        `UAE Pass authentication failed: ${(err as Error).message}`,
        'GOV_UAEPASS_ERROR',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Emirates ID: Verify identity card
  // -------------------------------------------------------------------------
  async verifyEmiratesID(request: EmiratesIDVerificationRequest): Promise<GovernmentVerificationResult> {
    logger.info('emirates_id_verification_start', { identityId: request.identityId });

    // Validate Emirates ID format: 784-YYYY-NNNNNNN-C
    if (!this.isValidEmiratesIDFormat(request.idNumber)) {
      throw new GovernmentAPIError('Invalid Emirates ID format', 'GOV_EID_INVALID_FORMAT');
    }

    try {
      const config = this.getEmiratesIDConfig();
      // Check cache first
      const cacheKey = `gov:eid:${this.hashSensitiveData(`${request.idNumber}:${request.dateOfBirth}`)}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const cachedResult = await this.parseCachedVerificationResult(
          cached,
          cacheKey,
          'EMIRATES_ID',
        );
        if (cachedResult) {
          const result = this.createIdentityScopedCachedVerificationResult(
            cachedResult,
            'eid',
          );
          await this.markIdentityGovernmentVerified(request.identityId, result);
          await this.cacheIdentityVerificationStatus(request.identityId, result);
          await this.auditGovernmentVerification(
            request.identityId,
            result,
            { provider: 'EMIRATES_ID', verified: true, cached: true },
          );
          logger.info('emirates_id_cache_hit', { identityId: request.identityId });
          return result;
        }
      }

      // Call ICA (Federal Authority for Identity and Citizenship) API
      const verificationUrl = `${config.apiUrl}/identity/verify`;
      const response = await this.fetchGovernmentEndpoint(verificationUrl, 'Emirates ID', 'GOV_EID', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
          'X-API-Secret': config.apiSecret,
        },
        body: JSON.stringify({
          idNumber: request.idNumber,
          dateOfBirth: request.dateOfBirth,
        }),
      });

      if (!response.ok) {
        const statusCode = response.status;
        if (statusCode === 404) {
          throw new GovernmentAPIError('Emirates ID not found', 'GOV_EID_NOT_FOUND', 404);
        }
        throw new GovernmentAPIError('Emirates ID verification API error', 'GOV_EID_API_ERROR');
      }

      const verificationData =
        await this.readGovernmentJsonResponse<EmiratesIDVerificationResult>(
          response,
          'Emirates ID verification',
        );

      // Check card validity
      if (verificationData.status !== 'VALID') {
        const referenceId = `eid-${crypto.randomUUID()}`;

        await prisma.auditLog.create({
          data: {
            identityId: request.identityId,
            action: 'GOV_API_CALLED',
            resourceType: 'government_verification',
            resourceId: referenceId,
            details: {
              provider: 'EMIRATES_ID',
              status: verificationData.status,
              verified: false,
            },
          },
        });

        throw new GovernmentAPIError(
          `Emirates ID status: ${verificationData.status}`,
          'GOV_EID_INVALID_STATUS',
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
        provider: 'EMIRATES_ID',
        referenceId,
        verifiedFields: ['fullName', 'nationality', 'idNumber', 'expiryDate'],
        verifiedAt: new Date(),
        expiresAt: new Date(verificationData.expiryDate),
      };

      // Cache result
      await redis.set(cacheKey, JSON.stringify(result), 'EX', GOV_VERIFICATION_CACHE_TTL);
      await this.cacheIdentityVerificationStatus(request.identityId, result);

      // Audit log
      await this.auditGovernmentVerification(request.identityId, result, {
        provider: 'EMIRATES_ID',
        verified: true,
        verifiedFields: result.verifiedFields,
      });

      logger.info('emirates_id_verified', {
        identityId: request.identityId,
        referenceId,
      });

      return result;
    } catch (err) {
      if (err instanceof GovernmentAPIError) throw err;

      logger.error('emirates_id_verification_error', {
        identityId: request.identityId,
        error: (err as Error).message,
      });

      throw new GovernmentAPIError(
        `Emirates ID verification failed: ${(err as Error).message}`,
        'GOV_EID_ERROR',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Check if government verification is still valid
  // -------------------------------------------------------------------------
  async getVerificationStatus(identityId: string): Promise<GovernmentVerificationResult | null> {
    const cacheKey = `gov:verification:${identityId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const result = await this.parseCachedVerificationResult(cached, cacheKey);
      if (result) return result;
    }

    logger.warn('government_verification_status_missing', { identityId });
    return null;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private getUAEPassConfig(): UAEPassConfig {
    const baseUrl = trimTrailingSlash(process.env.UAE_PASS_API_URL ?? DEFAULT_UAE_PASS_BASE_URL);
    const config: UAEPassConfig = {
      clientId: process.env.UAE_PASS_CLIENT_ID?.trim() ?? '',
      clientSecret: process.env.UAE_PASS_CLIENT_SECRET?.trim() ?? '',
      tokenEndpoint: process.env.UAE_PASS_TOKEN_URL?.trim() ?? `${baseUrl}/idshub/token`,
      userInfoEndpoint: process.env.UAE_PASS_USERINFO_URL?.trim() ?? `${baseUrl}/idshub/userinfo`,
      authEndpoint: process.env.UAE_PASS_AUTH_URL?.trim() ?? `${baseUrl}/idshub/authorize`,
      scope: UAE_PASS_SCOPE,
    };

    this.assertProductionGovernmentConfig('UAE Pass', 'GOV_UAEPASS', [
      ['UAE_PASS_CLIENT_ID', config.clientId],
      ['UAE_PASS_CLIENT_SECRET', config.clientSecret],
      ['UAE_PASS_TOKEN_URL', config.tokenEndpoint],
      ['UAE_PASS_USERINFO_URL', config.userInfoEndpoint],
      ['UAE_PASS_AUTH_URL', config.authEndpoint],
    ], [config.tokenEndpoint, config.userInfoEndpoint, config.authEndpoint]);

    return config;
  }

  private getEmiratesIDConfig(): EmiratesIDConfig {
    const apiUrl = process.env.EMIRATES_ID_API_URL?.trim()
      ?? process.env.EMIRATES_ID_VERIFICATION_URL?.trim()
      ?? 'https://api.ica.gov.ae/v1';
    const config: EmiratesIDConfig = {
      apiUrl: trimTrailingSlash(apiUrl),
      apiKey: process.env.EMIRATES_ID_API_KEY?.trim() ?? '',
      apiSecret: process.env.EMIRATES_ID_API_SECRET?.trim() ?? '',
    };

    this.assertProductionGovernmentConfig('Emirates ID', 'GOV_EID', [
      ['EMIRATES_ID_API_URL', config.apiUrl],
      ['EMIRATES_ID_API_KEY', config.apiKey],
      ['EMIRATES_ID_API_SECRET', config.apiSecret],
    ], [config.apiUrl]);

    return config;
  }

  private assertProductionGovernmentConfig(
    provider: string,
    codePrefix: string,
    requiredValues: Array<[string, string]>,
    endpointUrls: string[],
  ): void {
    if (!isProductionRuntime()) return;

    const missing = requiredValues
      .filter(([, value]) => value.length === 0)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new GovernmentAPIError(
        `${provider} configuration missing required production values: ${missing.join(', ')}`,
        `${codePrefix}_CONFIG_MISSING`,
        503,
      );
    }

    const unsafeEndpoint = endpointUrls.find((url) => !isTrustedProductionEndpoint(url));
    if (unsafeEndpoint) {
      throw new GovernmentAPIError(
        `${provider} production endpoint is not allowed: ${unsafeEndpoint}`,
        `${codePrefix}_ENDPOINT_UNSAFE`,
        503,
      );
    }
  }

  private async fetchGovernmentEndpoint(
    endpointUrl: string,
    provider: string,
    codePrefix: string,
    options: GovernmentFetchOptions = {},
  ): Promise<Response> {
    const resolved = await this.resolveSafeGovernmentEndpoint(
      endpointUrl,
      provider,
      codePrefix,
    );

    if (!resolved.pinnedAddress) {
      return fetch(endpointUrl, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(GOVERNMENT_API_TIMEOUT_MS),
      });
    }

    return this.fetchGovernmentEndpointWithPinnedAddress(
      resolved.endpoint,
      resolved.pinnedAddress,
      options,
    );
  }

  private async resolveSafeGovernmentEndpoint(
    endpointUrl: string,
    provider: string,
    codePrefix: string,
  ): Promise<ResolvedGovernmentEndpoint> {
    const endpoint = new URL(endpointUrl);
    if (!isProductionRuntime()) return { endpoint };

    const hostname = normalizeGovernmentHostname(endpoint.hostname);
    if (isLocalOrPrivateGovernmentHostname(hostname)) {
      throw new GovernmentAPIError(
        `${provider} endpoint resolved to localhost, private, or internal network infrastructure`,
        `${codePrefix}_ENDPOINT_UNSAFE_RESOLUTION`,
        503,
      );
    }

    const resolvedAddresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true,
    });
    if (
      resolvedAddresses.length === 0 ||
      resolvedAddresses.some((entry) =>
        isLocalOrPrivateGovernmentHostname(normalizeGovernmentHostname(entry.address)),
      )
    ) {
      throw new GovernmentAPIError(
        `${provider} endpoint resolved to localhost, private, or internal network infrastructure`,
        `${codePrefix}_ENDPOINT_UNSAFE_RESOLUTION`,
        503,
      );
    }

    return { endpoint, pinnedAddress: resolvedAddresses[0] };
  }

  private async fetchGovernmentEndpointWithPinnedAddress(
    endpoint: URL,
    pinnedAddress: ResolvedGovernmentAddress,
    options: GovernmentFetchOptions,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const body = options.body;
      const headers = {
        ...(options.headers ?? {}),
        ...(body !== undefined
          ? { 'Content-Length': Buffer.byteLength(body).toString() }
          : {}),
      };
      const request = https.request(
        endpoint,
        {
          method: options.method ?? 'GET',
          headers,
          lookup: (_hostname, _options, callback) => {
            callback(null, pinnedAddress.address, pinnedAddress.family);
          },
          servername: endpoint.hostname,
          timeout: GOVERNMENT_API_TIMEOUT_MS,
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const responseHeaders = new Headers();
          for (const [header, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(header, item);
            } else if (value !== undefined) {
              responseHeaders.set(header, String(value));
            }
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;

          response.on('data', (chunk: Buffer | string) => {
            const chunkBuffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);
            totalBytes += chunkBuffer.byteLength;
            if (totalBytes > GOVERNMENT_RESPONSE_MAX_BYTES) {
              request.destroy(
                new GovernmentAPIError(
                  `Government API response exceeded ${GOVERNMENT_RESPONSE_MAX_BYTES} byte limit`,
                  'GOV_RESPONSE_TOO_LARGE',
                  502,
                ),
              );
              return;
            }
            chunks.push(chunkBuffer);
          });
          response.on('end', () => {
            resolve(new Response(Buffer.concat(chunks, totalBytes), {
              status,
              headers: responseHeaders,
            }));
          });
          response.on('error', reject);
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Government API request timed out'));
      });
      request.on('error', reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  private async parseCachedVerificationResult(
    raw: string,
    cacheKey: string,
    expectedProvider?: GovernmentProvider,
  ): Promise<GovernmentVerificationResult | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('government_verification_cache_parse_failed', { cacheKey });
      await redis.del(cacheKey).catch(() => undefined);
      return null;
    }

    const result = normalizeGovernmentVerificationResult(parsed);
    if (
      !result ||
      (expectedProvider && result.provider !== expectedProvider) ||
      result.verified !== true ||
      result.expiresAt <= new Date()
    ) {
      logger.warn('government_verification_cache_invalid', {
        cacheKey,
        expectedProvider,
      });
      await redis.del(cacheKey).catch(() => undefined);
      return null;
    }

    return result;
  }

  private assertAllowedUAEPassRedirectUri(redirectUri: string): void {
    if (!isProductionRuntime()) return;

    const normalizedRedirectUri = normalizeTrustedRedirectUri(redirectUri);
    if (!normalizedRedirectUri) {
      throw new GovernmentAPIError(
        'UAE Pass redirect URI must be a trusted HTTPS URL in production',
        'GOV_UAEPASS_REDIRECT_URI_UNSAFE',
        400,
      );
    }

    const allowedRedirectUris = parseCsv(
      process.env.UAE_PASS_REDIRECT_URI_ALLOWLIST
        ?? process.env.GOVERNMENT_REDIRECT_URI_ALLOWLIST,
    )
      .map(normalizeTrustedRedirectUri)
      .filter((value): value is string => Boolean(value));

    if (allowedRedirectUris.length === 0) {
      throw new GovernmentAPIError(
        'UAE Pass production redirect URI allowlist is not configured',
        'GOV_UAEPASS_REDIRECT_URI_ALLOWLIST_MISSING',
        503,
      );
    }

    if (!allowedRedirectUris.includes(normalizedRedirectUri)) {
      throw new GovernmentAPIError(
        'UAE Pass redirect URI is not registered in the production allowlist',
        'GOV_UAEPASS_REDIRECT_URI_UNTRUSTED',
        400,
      );
    }
  }

  private async readGovernmentJsonResponse<T>(
    response: Response,
    label: string,
  ): Promise<T> {
    const body = await this.readGovernmentResponseBody(response, label);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new GovernmentAPIError(
        `${label} response was not valid JSON`,
        'GOV_RESPONSE_INVALID_JSON',
        502,
      );
    }
  }

  private async readGovernmentResponseBody(
    response: Response,
    label: string,
  ): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (
        Number.isFinite(parsedLength) &&
        parsedLength > GOVERNMENT_RESPONSE_MAX_BYTES
      ) {
        throw new GovernmentAPIError(
          `${label} response exceeded ${GOVERNMENT_RESPONSE_MAX_BYTES} byte limit`,
          'GOV_RESPONSE_TOO_LARGE',
          502,
        );
      }
    }

    return this.readBoundedGovernmentResponse(
      response,
      label,
      GOVERNMENT_RESPONSE_MAX_BYTES,
    );
  }

  private async readGovernmentErrorPreview(response: Response): Promise<string> {
    try {
      return await this.readBoundedGovernmentResponse(
        response,
        'government API error',
        GOVERNMENT_ERROR_PREVIEW_BYTES,
      );
    } catch {
      return '[unavailable]';
    }
  }

  private async readBoundedGovernmentResponse(
    response: Response,
    label: string,
    maxBytes: number,
  ): Promise<string> {
    if (!response.body) {
      const body = await response.text();
      const totalBytes = Buffer.byteLength(body, 'utf8');
      if (totalBytes > maxBytes) {
        throw new GovernmentAPIError(
          `${label} response exceeded ${maxBytes} byte limit`,
          'GOV_RESPONSE_TOO_LARGE',
          502,
        );
      }
      return body;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = Buffer.from(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new GovernmentAPIError(
            `${label} response exceeded ${maxBytes} byte limit`,
            'GOV_RESPONSE_TOO_LARGE',
            502,
          );
        }
        chunks.push(chunk);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes).toString('utf8');
  }

  private validateUAEPassProfile(profile: UAEPassProfile): void {
    if (!profile.uuid || !profile.fullNameEN || !profile.idCardNumber) {
      throw new GovernmentAPIError(
        'Incomplete UAE Pass profile data',
        'GOV_UAEPASS_INCOMPLETE_PROFILE',
      );
    }

    if (!['CITIZEN', 'RESIDENT', 'VISITOR'].includes(profile.userType)) {
      throw new GovernmentAPIError(
        `Unknown user type: ${profile.userType}`,
        'GOV_UAEPASS_UNKNOWN_USER_TYPE',
      );
    }
  }

  private isValidEmiratesIDFormat(idNumber: string): boolean {
    // Format: 784-YYYY-NNNNNNN-C (15 digits total when hyphens removed)
    const cleaned = idNumber.replace(/-/g, '');
    if (cleaned.length !== 15) return false;
    if (!cleaned.startsWith('784')) return false;
    return /^\d{15}$/.test(cleaned);
  }

  private hashSensitiveData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private createIdentityScopedCachedVerificationResult(
    cachedResult: GovernmentVerificationResult,
    referencePrefix: 'eid',
  ): GovernmentVerificationResult {
    return {
      ...cachedResult,
      referenceId: `${referencePrefix}-${crypto.randomUUID()}`,
      verifiedAt: new Date(),
    };
  }

  private async markIdentityGovernmentVerified(
    identityId: string,
    result: GovernmentVerificationResult,
  ): Promise<void> {
    await prisma.identity.update({
      where: { id: identityId },
      data: {
        governmentVerified: true,
        governmentRefId: result.referenceId,
      },
    });
  }

  private async cacheIdentityVerificationStatus(
    identityId: string,
    result: GovernmentVerificationResult,
  ): Promise<void> {
    await redis.set(
      `gov:verification:${identityId}`,
      JSON.stringify(result),
      'EX',
      GOV_VERIFICATION_CACHE_TTL,
    );
  }

  private async auditGovernmentVerification(
    identityId: string,
    result: GovernmentVerificationResult,
    details: Prisma.InputJsonObject,
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        identityId,
        action: 'GOV_API_CALLED',
        resourceType: 'government_verification',
        resourceId: result.referenceId,
        details,
      },
    });
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
    this.name = 'GovernmentAPIError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const governmentAPIService = new GovernmentAPIService();

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeGovernmentVerificationResult(
  value: unknown,
): GovernmentVerificationResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.verified !== 'boolean' ||
    !['UAE_PASS', 'EMIRATES_ID'].includes(String(record.provider)) ||
    typeof record.referenceId !== 'string' ||
    record.referenceId.length === 0 ||
    !Array.isArray(record.verifiedFields) ||
    !record.verifiedFields.every((field) => typeof field === 'string')
  ) {
    return null;
  }

  const verifiedAt = coerceValidDate(record.verifiedAt);
  const expiresAt = coerceValidDate(record.expiresAt);
  if (!verifiedAt || !expiresAt) return null;

  return {
    verified: record.verified,
    provider: record.provider as GovernmentProvider,
    referenceId: record.referenceId,
    verifiedFields: record.verifiedFields,
    verifiedAt,
    expiresAt,
  };
}

function coerceValidDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

function isTrustedProductionEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const hostname = normalizeGovernmentHostname(url.hostname);
    if (isLocalOrPrivateGovernmentHostname(hostname)) return false;
    return !/(^|[.-])(stg|stage|staging|sandbox|test|dev)([.-]|$)/.test(hostname);
  } catch {
    return false;
  }
}

function normalizeTrustedRedirectUri(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash) return null;
    if (!isTrustedProductionEndpoint(value)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function redactGovernmentErrorPreview(value: string): string {
  return value.replace(
    /(["']?(?:access_token|refresh_token|id_token|client_secret|api[_-]?key|api[_-]?secret)["']?\s*[:=]\s*)(["'][^"']+["']|[^,\s&}]+)/gi,
    '$1[redacted]',
  );
}

function normalizeGovernmentHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isLocalOrPrivateGovernmentHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '127.0.0.1' ||
    hostname === '::' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  ) {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(hostname);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = extractIpv4MappedAddress(hostname);
    if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4);

    return (
      hostname === '::' ||
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe80:')
    );
  }

  return (
    !hostname.includes('.') ||
    PRIVATE_GOVERNMENT_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function isPrivateIpv4Address(value: string): boolean {
  const octets = value.split('.').map(Number);
  const first = octets[0];
  const second = octets[1];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function extractIpv4MappedAddress(value: string): string | null {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];

  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return null;

  const high = parseInt(hexadecimal[1], 16);
  const low = parseInt(hexadecimal[2], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join('.');
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
