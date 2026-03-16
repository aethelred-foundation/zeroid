"""ZeroID Python SDK — self-sovereign identity on the Aethelred blockchain."""

__version__ = "0.1.0"

from zeroid.did.resolver import DIDResolver
from zeroid.did.document import DIDDocument, VerificationMethod, ServiceEndpoint
from zeroid.did.method import ZeroMethod
from zeroid.credential.issuer import CredentialIssuer
from zeroid.credential.verifier import CredentialVerifier
from zeroid.credential.schema import SchemaRegistry
from zeroid.credential.types import VerifiableCredential, VerifiablePresentation
from zeroid.crypto.hashing import keccak256, compute_merkle_root, compute_merkle_proof
from zeroid.crypto.bbs import BBSKeyPair, bbs_sign, bbs_verify, bbs_create_proof, bbs_verify_proof
from zeroid.crypto.accumulator import Accumulator
from zeroid.compliance.engine import ComplianceEngine
from zeroid.compliance.screening import SanctionsScreener
from zeroid.compliance.jurisdiction import Jurisdiction, JurisdictionRegistry
from zeroid.risk.scorer import RiskScorer, RiskLevel
from zeroid.risk.features import FeatureExtractor
from zeroid.risk.model import LogisticRegressionModel
from zeroid.registry.client import RegistryClient, InMemoryRegistryClient
from zeroid.registry.types import Identity, CredentialRecord, AttestationReport
from zeroid.tee.attestation import AttestationVerifier
from zeroid.tee.types import TEEPlatform, AttestationEvidence

__all__ = [
    "__version__",
    "DIDResolver",
    "DIDDocument",
    "VerificationMethod",
    "ServiceEndpoint",
    "ZeroMethod",
    "CredentialIssuer",
    "CredentialVerifier",
    "SchemaRegistry",
    "VerifiableCredential",
    "VerifiablePresentation",
    "keccak256",
    "compute_merkle_root",
    "compute_merkle_proof",
    "BBSKeyPair",
    "bbs_sign",
    "bbs_verify",
    "bbs_create_proof",
    "bbs_verify_proof",
    "Accumulator",
    "ComplianceEngine",
    "SanctionsScreener",
    "Jurisdiction",
    "JurisdictionRegistry",
    "RiskScorer",
    "RiskLevel",
    "FeatureExtractor",
    "LogisticRegressionModel",
    "RegistryClient",
    "InMemoryRegistryClient",
    "Identity",
    "CredentialRecord",
    "AttestationReport",
    "AttestationVerifier",
    "TEEPlatform",
    "AttestationEvidence",
]
