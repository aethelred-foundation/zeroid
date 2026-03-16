import {
  CONTRACT_ADDRESSES,
  IDENTITY_REGISTRY_ADDRESS,
  CREDENTIAL_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  CREDENTIAL_REGISTRY_ABI,
  GOVERNANCE_ABI,
  GOVERNANCE_TOKEN_ABI,
  ZK_VERIFIER_ABI,
  GOVERNANCE_ADDRESS,
  GOVERNANCE_TOKEN_ADDRESS,
  ZK_VERIFIER_ADDRESS,
  ZK_CIRCUIT_BASE_URL,
  CREDENTIAL_SCHEMAS,
  SCHEMA_LABELS,
  ATTRIBUTE_KEYS,
  CreditTier,
  KYCLevel,
  CIRCUIT_IDS,
  CIRCUITS,
  TEE_FRESHNESS_REQUIREMENTS,
  TEE_ENDPOINTS,
  API_BASE_URL,
  TEE_SERVICE_URL,
  DID_METHOD_PREFIX,
  CREDENTIALS_PAGE_SIZE,
  PROOF_REQUESTS_PAGE_SIZE,
  PROPOSALS_PAGE_SIZE,
  PROOF_GENERATION_TIMEOUT_MS,
  CREDENTIAL_POLL_INTERVAL_MS,
  TEE_NODE_POLL_INTERVAL_MS,
  SECONDS_PER_YEAR,
} from '../constants';

describe('constants - CONTRACT_ADDRESSES', () => {
  it('exports CONTRACT_ADDRESSES object with expected keys', () => {
    expect(CONTRACT_ADDRESSES).toBeDefined();
    expect(CONTRACT_ADDRESSES).toHaveProperty('identityRegistry');
    expect(CONTRACT_ADDRESSES).toHaveProperty('credentialRegistry');
    expect(CONTRACT_ADDRESSES).toHaveProperty('zkVerifier');
    expect(CONTRACT_ADDRESSES).toHaveProperty('governanceModule');
    expect(CONTRACT_ADDRESSES).toHaveProperty('aiAgentRegistry');
  });
});

describe('constants - ABIs', () => {
  it('exports IDENTITY_REGISTRY_ABI as an array', () => {
    expect(Array.isArray(IDENTITY_REGISTRY_ABI)).toBe(true);
    expect(IDENTITY_REGISTRY_ABI.length).toBeGreaterThan(0);
  });

  it('exports CREDENTIAL_REGISTRY_ABI with getCredential function', () => {
    const fn = CREDENTIAL_REGISTRY_ABI.find((item: any) => item.name === 'getCredential');
    expect(fn).toBeDefined();
  });

  it('exports GOVERNANCE_ABI with propose function', () => {
    const fn = GOVERNANCE_ABI.find((item: any) => item.name === 'propose');
    expect(fn).toBeDefined();
  });

  it('exports ZK_VERIFIER_ABI with verifyProof function', () => {
    const fn = ZK_VERIFIER_ABI.find((item: any) => item.name === 'verifyProof');
    expect(fn).toBeDefined();
  });
});

describe('constants - CREDENTIAL_SCHEMAS', () => {
  it('exports known schema hashes', () => {
    expect(CREDENTIAL_SCHEMAS.GOVERNMENT_ID).toBeDefined();
    expect(CREDENTIAL_SCHEMAS.AGE_VERIFICATION).toBeDefined();
    expect(CREDENTIAL_SCHEMAS.KYC_AML).toBeDefined();
  });

  it('has matching labels for all schemas', () => {
    for (const hash of Object.values(CREDENTIAL_SCHEMAS)) {
      expect(SCHEMA_LABELS[hash]).toBeDefined();
    }
  });
});

describe('constants - Enums', () => {
  it('defines CreditTier values', () => {
    expect(CreditTier.Prime).toBe('prime');
    expect(CreditTier.NearPrime).toBe('near_prime');
    expect(CreditTier.Subprime).toBe('subprime');
    expect(CreditTier.DeepSubprime).toBe('deep_subprime');
    expect(CreditTier.Unscored).toBe('unscored');
  });

  it('defines KYCLevel values and reverse mappings', () => {
    expect(KYCLevel.None).toBe(0);
    expect(KYCLevel.Basic).toBe(1);
    expect(KYCLevel.Enhanced).toBe(2);
    expect(KYCLevel.Full).toBe(3);
    // Numeric enums have reverse mappings
    expect(KYCLevel[0]).toBe('None');
    expect(KYCLevel[1]).toBe('Basic');
    expect(KYCLevel[2]).toBe('Enhanced');
    expect(KYCLevel[3]).toBe('Full');
  });
});

describe('constants - Circuits', () => {
  it('exports all circuit IDs', () => {
    expect(CIRCUIT_IDS.AGE_PROOF).toBeDefined();
    expect(CIRCUIT_IDS.RESIDENCY_PROOF).toBeDefined();
    expect(CIRCUIT_IDS.CREDIT_TIER_PROOF).toBeDefined();
    expect(CIRCUIT_IDS.KYC_STATUS_PROOF).toBeDefined();
    expect(CIRCUIT_IDS.IDENTITY_OWNERSHIP).toBeDefined();
  });

  it('exports circuit metadata with required fields', () => {
    const ageCircuit = CIRCUITS[CIRCUIT_IDS.AGE_PROOF];
    expect(ageCircuit).toBeDefined();
    expect(ageCircuit.name).toBe('Age Proof');
    expect(ageCircuit.publicInputs.length).toBeGreaterThan(0);
    expect(ageCircuit.wasmPath).toBeDefined();
  });

  it('exports all circuit metadata entries', () => {
    expect(CIRCUITS[CIRCUIT_IDS.RESIDENCY_PROOF]).toBeDefined();
    expect(CIRCUITS[CIRCUIT_IDS.RESIDENCY_PROOF].name).toBe('Residency Proof');
    expect(CIRCUITS[CIRCUIT_IDS.CREDIT_TIER_PROOF]).toBeDefined();
    expect(CIRCUITS[CIRCUIT_IDS.CREDIT_TIER_PROOF].name).toBe('Credit Tier Proof');
  });
});

describe('constants - TEE config', () => {
  it('exports freshness requirements', () => {
    expect(TEE_FRESHNESS_REQUIREMENTS.IntelSGX).toBe(86400);
  });

  it('exports TEE endpoints', () => {
    expect(TEE_ENDPOINTS.BIOMETRIC_ENROLL).toContain('/tee/biometric/enroll');
  });
});

describe('constants - UI constants', () => {
  it('exports expected values', () => {
    expect(DID_METHOD_PREFIX).toBe('did:aethelred');
    expect(CREDENTIALS_PAGE_SIZE).toBe(12);
    expect(PROOF_GENERATION_TIMEOUT_MS).toBe(60000);
    expect(typeof API_BASE_URL).toBe('string');
    expect(typeof TEE_SERVICE_URL).toBe('string');
  });

  it('exports page size and polling constants', () => {
    expect(PROOF_REQUESTS_PAGE_SIZE).toBe(10);
    expect(PROPOSALS_PAGE_SIZE).toBe(10);
    expect(CREDENTIAL_POLL_INTERVAL_MS).toBe(15000);
    expect(TEE_NODE_POLL_INTERVAL_MS).toBe(30000);
    expect(SECONDS_PER_YEAR).toBe(31557600);
  });
});

describe('constants - convenience aliases', () => {
  it('exports address aliases matching CONTRACT_ADDRESSES', () => {
    expect(IDENTITY_REGISTRY_ADDRESS).toBe(CONTRACT_ADDRESSES.identityRegistry);
    expect(CREDENTIAL_REGISTRY_ADDRESS).toBe(CONTRACT_ADDRESSES.credentialRegistry);
    expect(GOVERNANCE_ADDRESS).toBe(CONTRACT_ADDRESSES.governanceModule);
    expect(GOVERNANCE_TOKEN_ADDRESS).toBe(CONTRACT_ADDRESSES.aethelToken);
    expect(ZK_VERIFIER_ADDRESS).toBe(CONTRACT_ADDRESSES.zkVerifier);
  });

  it('exports ZK_CIRCUIT_BASE_URL', () => {
    expect(typeof ZK_CIRCUIT_BASE_URL).toBe('string');
  });

  it('exports GOVERNANCE_TOKEN_ABI as an array', () => {
    expect(Array.isArray(GOVERNANCE_TOKEN_ABI)).toBe(true);
    expect(GOVERNANCE_TOKEN_ABI.length).toBeGreaterThan(0);
  });
});

describe('constants - ATTRIBUTE_KEYS', () => {
  it('exports all attribute key values', () => {
    // Ensure every key is accessed to cover all statement assignments
    const keys = Object.values(ATTRIBUTE_KEYS);
    expect(keys).toContain('fullName');
    expect(keys).toContain('dateOfBirth');
    expect(keys).toContain('nationality');
    expect(keys).toContain('gender');
    expect(keys).toContain('country');
    expect(keys).toContain('stateProvince');
    expect(keys).toContain('city');
    expect(keys).toContain('postalCode');
    expect(keys).toContain('documentType');
    expect(keys).toContain('documentNumber');
    expect(keys).toContain('issuingAuthority');
    expect(keys).toContain('issueDate');
    expect(keys).toContain('expiryDate');
    expect(keys).toContain('creditTier');
    expect(keys).toContain('kycLevel');
    expect(keys).toContain('amlStatus');
    expect(keys).toContain('certificationName');
    expect(keys).toContain('certifyingBody');
    expect(keys).toContain('degreeType');
    expect(keys).toContain('institution');
    expect(keys).toContain('employer');
    expect(keys).toContain('jobTitle');
    expect(keys.length).toBe(22);
  });
});

describe('constants - all CONTRACT_ADDRESSES keys', () => {
  it('exports all enterprise contract addresses', () => {
    expect(CONTRACT_ADDRESSES).toHaveProperty('teeAttestation');
    expect(CONTRACT_ADDRESSES).toHaveProperty('selectiveDisclosure');
    expect(CONTRACT_ADDRESSES).toHaveProperty('aethelToken');
    expect(CONTRACT_ADDRESSES).toHaveProperty('bbsPlusCredential');
    expect(CONTRACT_ADDRESSES).toHaveProperty('thresholdCredential');
    expect(CONTRACT_ADDRESSES).toHaveProperty('crossChainBridge');
    expect(CONTRACT_ADDRESSES).toHaveProperty('accumulatorRevocation');
    expect(CONTRACT_ADDRESSES).toHaveProperty('regulatoryCompliance');
  });
});

describe('constants - TEE freshness exhaustive', () => {
  it('exports all platform freshness values', () => {
    expect(TEE_FRESHNESS_REQUIREMENTS.AMDSEV).toBe(86400);
    expect(TEE_FRESHNESS_REQUIREMENTS.ArmTrustZone).toBe(43200);
  });
});

describe('constants - TEE endpoints exhaustive', () => {
  it('exports all TEE endpoint paths', () => {
    expect(TEE_ENDPOINTS.BIOMETRIC_VERIFY).toContain('/tee/biometric/verify');
    expect(TEE_ENDPOINTS.ATTESTATION_VERIFY).toContain('/tee/attestation/verify');
    expect(TEE_ENDPOINTS.CREDENTIAL_ISSUE).toContain('/tee/credential/issue');
    expect(TEE_ENDPOINTS.NODE_STATUS).toContain('/tee/nodes/status');
  });
});

describe('constants - circuit metadata exhaustive', () => {
  it('exports full metadata for all circuits', () => {
    for (const circuit of Object.values(CIRCUITS)) {
      expect(circuit.circuitId).toBeDefined();
      expect(circuit.name).toBeDefined();
      expect(circuit.description).toBeDefined();
      expect(circuit.publicInputs.length).toBeGreaterThan(0);
      expect(circuit.privateInputs.length).toBeGreaterThan(0);
      expect(circuit.outputs.length).toBeGreaterThan(0);
      expect(circuit.wasmPath).toBeDefined();
      expect(circuit.zkeyPath).toBeDefined();
      expect(circuit.vkeyPath).toBeDefined();
      expect(circuit.estimatedProvingTimeMs).toBeGreaterThan(0);
    }
  });
});
