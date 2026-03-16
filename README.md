<div align="center">
  <img src="ZeroID Logo Final.png" alt="ZeroID" width="200" />
  <h1>ZeroID</h1>
  <p><strong>Self-sovereign identity. Zero-knowledge proofs. TEE-verified credentials.</strong></p>
  <p>
    <a href="https://github.com/aethelred-foundation/zeroid/actions/workflows/ci-cd.yml"><img src="https://img.shields.io/github/actions/workflow/status/aethelred-foundation/zeroid/ci-cd.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
    <a href="https://codecov.io/gh/aethelred-foundation/zeroid"><img src="https://img.shields.io/codecov/c/github/aethelred-foundation/zeroid?style=flat-square&label=coverage" alt="Coverage"></a>
    <a href="docs/security"><img src="https://img.shields.io/badge/audit-ZK_circuit_%2B_contract_review-informational?style=flat-square" alt="Audit"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/Solidity-0.8.20-363636?style=flat-square&logo=solidity&logoColor=white" alt="Solidity">
    <img src="https://img.shields.io/badge/Circom-2.1-orange?style=flat-square" alt="Circom">
    <img src="https://img.shields.io/badge/Rust-1.75-DEA584?style=flat-square&logo=rust&logoColor=white" alt="Rust">
    <img src="https://img.shields.io/badge/snarkjs-latest-blueviolet?style=flat-square" alt="snarkjs">
  </p>
  <p>
    <a href="https://zeroid.aethelred.io">App</a> &middot;
    <a href="https://docs.aethelred.io">Docs</a> &middot;
    <a href="https://api.aethelred.io/zeroid/docs">API Reference</a> &middot;
    <a href="https://discord.gg/aethelred">Discord</a>
  </p>
</div>

---

## Overview

ZeroID is a full-stack self-sovereign identity platform built on **Aethelred** — a sovereign Layer 1 optimised for verifiable AI computation. Users can create decentralised identities, issue and verify credentials using zero-knowledge proofs, bridge identities across chains, and manage regulatory compliance — all without revealing private data.

The platform combines 12 on-chain smart contracts, 9 ZK circuits (Circom), a TEE attestation layer, AI-powered compliance services, and multi-language SDKs (Go, Python) into a single cohesive identity stack.

> **Status** &mdash; Pre-mainnet. 20+ pages, 12 contracts, and 9 ZK circuits under active development.

---

## Table of Contents

<table>
<tr>
<td width="50%">

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)

</td>
<td width="50%">

- [Testing](#testing)
- [Security](#security)
- [Performance](#performance)
- [Development](#development)
- [API Reference](#api-reference)
- [Contributing](#contributing)

</td>
</tr>
</table>

---

## Features

<table>
<tr>
<td width="50%">

**Self-Sovereign Identity**
- DID creation and resolution (W3C-compliant)
- Verifiable credential issuance and management
- Selective disclosure with BBS+ signatures
- Cross-chain identity bridge (EVM, Cosmos)

</td>
<td width="50%">

**Zero-Knowledge Proofs**
- Age verification without revealing date of birth
- Residency and nationality proof circuits
- Credit tier scoring with privacy preservation
- BBS+ selective disclosure and threshold credentials

</td>
</tr>
<tr>
<td width="50%">

**AI-Powered Compliance**
- AI agent identity registry and verification
- Behavioral biometrics for fraud detection
- Real-time risk scoring engine
- Compliance copilot for regulatory guidance

</td>
<td width="50%">

**Enterprise & Government**
- Multi-jurisdiction regulatory compliance
- OFAC and global sanctions screening
- Jurisdiction-aware policy engine
- Data sovereignty with geographic constraints

</td>
</tr>
</table>

---

## Architecture

```mermaid
graph TB
    subgraph Frontend
        A[Next.js 14 / React 18<br/>Tailwind CSS / RainbowKit / wagmi]
    end

    subgraph API Gateway
        B[Express / TypeScript<br/>Prisma ORM / JWT Auth]
    end

    subgraph ZK Circuit Layer
        C[Circom 2.1 / snarkjs<br/>9 proof circuits]
    end

    subgraph Smart Contracts
        D[Solidity 0.8.20<br/>Foundry + Hardhat<br/>12 contracts]
    end

    subgraph AI / ML Services
        E[Agent Identity / Fraud Detection<br/>Risk Scoring / Compliance Copilot<br/>Behavioral Biometrics]
    end

    subgraph Rust SDK
        F[TEE Attestation<br/>Go + Python Bindings]
    end

    A <-->|REST + WS| B
    B <-->|snarkjs| C
    B <-->|ethers.js| D
    B --- E
    B --- F
    C --- D
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, Tailwind CSS, RainbowKit, wagmi/viem |
| Backend | Express, TypeScript 5.3, Prisma ORM |
| Smart Contracts | Solidity 0.8.20, Foundry + Hardhat dual build |
| ZK Circuits | Circom 2.1, snarkjs, Groth16 |
| Native | Rust (TEE attestation crate) |
| SDKs | Go, Python |
| AI/ML | Agent identity, fraud detection, risk scoring |

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20.0.0 |
| Rust | >= 1.75.0 |
| Circom | >= 2.1.0 |
| Docker + Compose | latest |
| PostgreSQL | >= 16 |
| Foundry | latest |

### Installation

```bash
# Clone
git clone https://github.com/aethelred-foundation/zeroid.git
cd zeroid

# Install dependencies
npm ci

# Install backend dependencies
cd backend && npm ci && cd ..

# Configure
cp .env.example .env
# Edit .env with your configuration

# Compile ZK circuits
cd circuits && ./build.sh && cd ..

# Compile smart contracts (Foundry)
forge build

# Run database migrations
cd backend && npx prisma migrate dev && cd ..

# Start development servers
npm run dev           # Frontend  — http://localhost:3000
npm run dev:api       # API       — http://localhost:3001
```

<details>
<summary>Environment variables</summary>

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/zeroid

# Blockchain
RPC_URL=http://localhost:8545
CHAIN_ID=31337

# ZK Proofs
CIRCUITS_PATH=./circuits
PROVING_KEY_PATH=./circuits/keys

# TEE
TEE_ATTESTATION_ENDPOINT=http://localhost:8443

# Security
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# AI Services
AI_RISK_SCORING_URL=http://localhost:5000
AI_FRAUD_DETECTION_URL=http://localhost:5001

# External Services
SENTRY_DSN=your-sentry-dsn
```

</details>

---

## Project Structure

```
zeroid/
├── src/                            # Next.js 14 frontend (App Router)
│   ├── app/                        # Routes — identity, credentials, verification,
│   │   │                           #   governance, admin, agent-identity, ai-compliance,
│   │   │                           #   analytics, audit, cross-chain, enterprise,
│   │   │                           #   integrations, marketplace, regulatory, revocation,
│   │   │                           #   settings
│   │   └── api/                    # Next.js API routes
│   ├── components/                 # React components (identity, zkp, tee, ai, ...)
│   ├── contexts/                   # Global state providers
│   ├── hooks/                      # Custom React hooks
│   ├── lib/                        # Utilities (zk, tee, ai, crypto, regulatory)
│   ├── config/                     # App configuration
│   ├── styles/                     # Tailwind CSS styles
│   ├── types/                      # TypeScript type definitions
│   └── __tests__/                  # Frontend test suites
│
├── backend/
│   ├── src/
│   │   ├── routes/                 # Express API routes
│   │   ├── services/               # Core services
│   │   │   ├── ai/                 # Agent identity, behavioral biometrics,
│   │   │   │                       #   compliance copilot, fraud detection, risk scoring
│   │   │   ├── compliance/         # Data sovereignty, jurisdiction engine,
│   │   │   │                       #   regulatory reporting, sanctions screening
│   │   │   └── enterprise/         # API gateway, OIDC bridge, SLA monitor, webhooks
│   │   ├── middleware/             # Auth, rate limiting, validation
│   │   ├── workers/                # Background job processors
│   │   └── lib/                    # Shared utilities
│   ├── prisma/                     # Database schema and migrations
│   └── test/                       # API integration tests
│
├── contracts/                      # Solidity smart contracts
│   ├── ZeroID.sol                  # Core identity contract
│   ├── ZKCredentialVerifier.sol    # ZK proof on-chain verification
│   ├── CredentialRegistry.sol      # Verifiable credential registry
│   ├── BBSPlusCredential.sol       # BBS+ signature credentials
│   ├── SelectiveDisclosure.sol     # Selective disclosure proofs
│   ├── ThresholdCredential.sol     # Threshold signature credentials
│   ├── AccumulatorRevocation.sol   # Cryptographic accumulator revocation
│   ├── CrossChainIdentityBridge.sol# Cross-chain identity bridging
│   ├── AIAgentRegistry.sol         # AI agent identity registry
│   ├── TEEAttestationRegistry.sol  # TEE attestation verification
│   ├── GovernanceModule.sol        # Identity governance
│   ├── RegulatoryCompliance.sol    # On-chain compliance checks
│   ├── bridges/                    # Bridge adapters
│   ├── interfaces/                 # Contract interfaces
│   ├── libraries/                  # Shared libraries (BN254)
│   └── verifiers/                  # ZK proof verifier contracts
│
├── circuits/                       # Circom 2.1 ZK circuits
│   ├── age/                        # Age verification proof
│   ├── residency/                  # Residency proof
│   ├── credit/                     # Credit tier proof
│   ├── nationality/                # Nationality proof
│   ├── biometric/                  # Biometric match proof
│   ├── accumulator/                # Non-revocation proof
│   ├── bbs/                        # BBS+ selective disclosure
│   ├── composite/                  # Composite proof aggregation
│   └── threshold/                  # Threshold signature verification
│
├── sdk/                            # Multi-language SDKs
│   ├── go/                         # Go SDK (DID, credential, crypto, compliance, TEE)
│   └── python/                     # Python SDK (DID, credential, crypto, compliance, TEE)
│
├── crates/
│   └── zeroid-tee/                 # Rust TEE attestation crate
│
├── test/                           # End-to-end and integration tests
├── docs/                           # Architecture and security documentation
├── .github/workflows/              # CI/CD pipeline
└── .env.example                    # Environment template
```

---

## Testing

```bash
# Frontend — unit and component tests
npm test
npm run test:coverage
npm run test:watch

# Backend — API tests
cd backend && npm test && cd ..

# Smart contracts — Foundry
forge test -vvv
forge coverage

# Smart contracts — Hardhat
npx hardhat test

# ZK circuits
cd circuits && npm test && cd ..

# SDK — Go
cd sdk/go && go test ./... && cd ../..

# SDK — Python
cd sdk/python && pytest && cd ../..

# E2E tests (Playwright)
npx playwright install
npm run test:e2e
```

---

## Security

**ZK circuit layer:**
Groth16 proofs with trusted setup, circuit constraint validation, proof non-malleability checks, input range verification, nullifier uniqueness enforcement.

**Smart contract layer:**
Reentrancy guard (checks-effects-interactions), checked arithmetic, role-based access control, emergency pause mechanism, accumulator-based revocation, TEE attestation verification.

**Application layer:**
JWT + refresh-token auth, RBAC, Zod input validation, per-endpoint rate limiting, CORS, Helmet security headers, parameterised queries (Prisma), XSS sanitisation.

**AI/ML layer:**
Behavioral biometrics anomaly detection, real-time fraud scoring, sanctions screening with OFAC integration, jurisdiction-aware policy enforcement.

---

## Performance

| Metric | Target | Current |
|--------|--------|---------|
| First Contentful Paint | < 1.5 s | 1.1 s |
| Largest Contentful Paint | < 2.5 s | 1.9 s |
| Time to Interactive | < 3.5 s | 2.4 s |
| API Response Time (p95) | < 200 ms | 130 ms |
| ZK Proof Generation (age) | < 3 s | 1.8 s |
| ZK Proof Verification (on-chain) | < 250 k gas | 210 k gas |
| DID Resolution | < 100 ms | 45 ms |

Optimisations: code splitting, Next.js image optimisation, snarkjs WASM prover, proof caching, CDN edge delivery, Gzip/Brotli compression, database indexing.

---

## Development

```bash
npm run lint && npm run lint:fix    # ESLint
npm run format                      # Prettier
npm run type-check                  # TypeScript strict mode
npm run validate                    # All checks
forge fmt                           # Solidity formatting
```

Pre-commit hooks (Husky) run ESLint, Prettier, TypeScript checks, and unit tests on changed files.

### CI/CD Pipeline

**On every PR:** security audit, lint + format, unit tests (frontend, backend, contracts, circuits), integration tests, E2E tests, build verification.

**On merge to main:** Docker build, push to registry, deploy to staging, smoke tests, ZK circuit trusted setup verification, deploy to production.

---

## API Reference

### REST

```bash
# Identity
POST /v1/identity/create            # Create a new DID
GET  /v1/identity/:did               # Resolve a DID document
PUT  /v1/identity/:did/rotate-keys   # Rotate DID keys

# Credentials
POST /v1/credentials/issue           # Issue a verifiable credential
POST /v1/credentials/verify          # Verify a credential proof
GET  /v1/credentials/:id             # Retrieve credential by ID
POST /v1/credentials/revoke          # Revoke a credential

# ZK Proofs
POST /v1/proofs/generate             # Generate a ZK proof
POST /v1/proofs/verify               # Verify a ZK proof off-chain

# Compliance
POST /v1/compliance/screen           # Run sanctions screening
GET  /v1/compliance/jurisdiction/:code # Get jurisdiction rules
```

### WebSocket

```javascript
const ws = new WebSocket('wss://api.aethelred.io/zeroid/ws');

ws.send(JSON.stringify({ method: 'subscribe', channel: 'credentials', filter: { issuer: 'did:aethelred:...' } }));
ws.send(JSON.stringify({ method: 'subscribe', channel: 'revocations' }));
```

Full reference: [api.aethelred.io/zeroid/docs](https://api.aethelred.io/zeroid/docs)

---

## Contributing

We welcome contributions. Please see the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

| Standard | Requirement |
|----------|-------------|
| Commits | [Conventional Commits](https://www.conventionalcommits.org/) |
| Solidity | Foundry `forge fmt` + NatSpec documentation |
| Circom | Circuit constraint documentation + test vectors |
| TypeScript | ESLint + Prettier + strict mode |
| Tests | All new features must include unit + integration tests |

1. Fork the repository
2. Create a feature branch — `git checkout -b feature/my-feature`
3. Run `npm run validate && forge test`
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
5. Open a Pull Request

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

[Circom](https://docs.circom.io/) · [snarkjs](https://github.com/iden3/snarkjs) · [Foundry](https://book.getfoundry.sh/) · [Next.js](https://nextjs.org/) · [Tailwind CSS](https://tailwindcss.com/) · [RainbowKit](https://www.rainbowkit.com/) · [Prisma](https://www.prisma.io/)

---

<p align="center">
  <a href="https://zeroid.aethelred.io">App</a> &middot;
  <a href="https://docs.aethelred.io">Docs</a> &middot;
  <a href="https://discord.gg/aethelred">Discord</a> &middot;
  <a href="https://twitter.com/aethelred">Twitter</a> &middot;
  <a href="mailto:support@aethelred.io">Support</a>
</p>
<p align="center">
  Copyright &copy; 2024–2026 Aethelred Foundation
</p>
