"""DID Resolver for the did:zero method.

Resolves did:zero:<address> URIs into W3C DID Documents by looking up
identity records from the on-chain registry.
"""

from __future__ import annotations

from datetime import datetime, timezone

from zeroid.did.document import DIDDocument, DIDStatus, ServiceEndpoint, VerificationMethod
from zeroid.did.method import ZeroMethod
from zeroid.registry.client import RegistryClient


class DIDResolver:
    """Resolves did:zero DIDs into DID Documents.

    Attributes:
        registry: The registry client used for identity lookups.
    """

    def __init__(self, registry: RegistryClient) -> None:
        """Initialize the resolver with a registry client.

        Args:
            registry: Client for on-chain identity lookups.
        """
        self.registry = registry

    def resolve(self, did: str) -> DIDDocument:
        """Resolve a did:zero URI to a DID Document.

        Args:
            did: A valid did:zero URI.

        Returns:
            The resolved DID Document.

        Raises:
            ValueError: If the DID is not a valid did:zero URI.
            KeyError: If the DID is not found in the registry.
        """
        address = ZeroMethod.parse_address(did)
        identity = self.registry.get_identity(address)

        if identity is None:
            raise KeyError(f"DID not found: {did}")

        vm_id = f"{did}#key-1"
        vm = VerificationMethod(
            id=vm_id,
            type="EcdsaSecp256k1VerificationKey2019",
            controller=did,
            public_key_hex=identity.public_key_hex,
        )

        services: list[ServiceEndpoint] = []
        if identity.service_endpoint:
            services.append(
                ServiceEndpoint(
                    id=f"{did}#zeroid-service",
                    type="ZeroIDService",
                    endpoint=identity.service_endpoint,
                )
            )

        status = DIDStatus.ACTIVE
        if identity.revoked:
            status = DIDStatus.DEACTIVATED
        elif identity.suspended:
            status = DIDStatus.SUSPENDED

        now = datetime.now(timezone.utc).isoformat()
        return DIDDocument(
            id=did,
            verification_methods=[vm],
            authentication=[vm_id],
            assertion_method=[vm_id],
            services=services,
            status=status,
            created=identity.created_at or now,
            updated=now,
        )
