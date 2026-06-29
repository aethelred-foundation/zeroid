/**
 * ZeroID — OpenID4VCI credential configurations.
 *
 * Declares the credential types ZeroID can issue (the
 * `credential_configuration_ids` advertised in issuer metadata), each pinned to
 * an SD-JWT VC `vct` and the set of claim names that are selectively-disclosable.
 * The regulated-eligibility credential's `vct` matches the presentation policy's
 * expected `vct`, so issuance and verification stay aligned.
 */
import { SD_JWT_VC_FORMAT } from '../oid4vp/dcql';

export interface CredentialConfig {
  /** credential_configuration_id */
  id: string;
  format: string;
  vct: string;
  /** Claim names issued as selectively-disclosable (`_sd`); the rest are plain. */
  sdClaimNames: string[];
}

const CONFIGS: Record<string, CredentialConfig> = {
  'regulated-eligibility-v1': {
    id: 'regulated-eligibility-v1',
    format: SD_JWT_VC_FORMAT,
    vct: 'https://credentials.zeroid/regulated-eligibility/v1',
    sdClaimNames: ['resident_country', 'sanctions_status', 'risk_tier'],
  },
  'ai-agent-passport-v1': {
    id: 'ai-agent-passport-v1',
    format: SD_JWT_VC_FORMAT,
    vct: 'https://credentials.zeroid/ai-agent-passport/v1',
    sdClaimNames: ['scopes', 'max_risk_tier', 'controller_did'],
  },
};

export function getCredentialConfig(id: string): CredentialConfig | undefined {
  return CONFIGS[id];
}

export function credentialConfigurationIds(): string[] {
  return Object.keys(CONFIGS);
}

/** `credential_configurations_supported` map for issuer metadata. */
export function credentialConfigurationsSupported(): Record<
  string,
  { format: string; vct: string; cryptographic_binding_methods_supported: string[]; credential_signing_alg_values_supported: string[] }
> {
  const out: Record<string, ReturnType<typeof one>> = {};
  function one(c: CredentialConfig) {
    return {
      format: c.format,
      vct: c.vct,
      cryptographic_binding_methods_supported: ['jwk'],
      credential_signing_alg_values_supported: ['ES256'],
    };
  }
  for (const c of Object.values(CONFIGS)) out[c.id] = one(c);
  return out;
}
