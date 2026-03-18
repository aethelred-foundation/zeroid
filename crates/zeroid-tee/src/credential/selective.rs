/// Selective disclosure within the TEE.
///
/// Allows a credential holder to reveal only a subset of attributes while
/// proving membership in the full credential via a Merkle proof.
use crate::crypto::hash::keccak256;
use crate::crypto::merkle::{build_tree, generate_proof, verify_proof, MerkleProof};
use crate::error::{Result, ZeroIdTeeError};

/// A selective disclosure request: which attributes to reveal.
#[derive(Debug, Clone, PartialEq)]
pub struct DisclosureRequest {
    /// Names of attributes to disclose.
    pub attributes: Vec<String>,
}

impl DisclosureRequest {
    /// Create a new disclosure request.
    pub fn new(attributes: Vec<String>) -> Self {
        Self { attributes }
    }

    /// Check whether the request is empty.
    pub fn is_empty(&self) -> bool {
        self.attributes.is_empty()
    }

    /// Return the number of attributes to disclose.
    pub fn len(&self) -> usize {
        self.attributes.len()
    }
}

/// A selective disclosure proof: revealed values plus Merkle proofs.
#[derive(Debug, Clone, PartialEq)]
pub struct DisclosureProof {
    /// The Merkle root of the full credential.
    pub credential_root: [u8; 32],
    /// Revealed attribute name-value pairs.
    pub revealed: Vec<(String, Vec<u8>)>,
    /// Merkle proofs for each revealed attribute.
    pub proofs: Vec<MerkleProof>,
}

/// A set of credential attributes (name → value).
#[derive(Debug, Clone, PartialEq)]
pub struct AttributeSet {
    /// Ordered list of (name, value) pairs.
    pub entries: Vec<(String, Vec<u8>)>,
}

impl AttributeSet {
    /// Create a new empty attribute set.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Add an attribute.
    pub fn add(&mut self, name: impl Into<String>, value: impl Into<Vec<u8>>) {
        self.entries.push((name.into(), value.into()));
    }

    /// Return the number of attributes.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check whether the set is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Encode each attribute as `name:value` for hashing.
    fn encoded_leaves(&self) -> Vec<Vec<u8>> {
        self.entries
            .iter()
            .map(|(name, value)| {
                let mut leaf = Vec::new();
                leaf.extend_from_slice(name.as_bytes());
                leaf.push(b':');
                leaf.extend_from_slice(value);
                leaf
            })
            .collect()
    }
}

impl Default for AttributeSet {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a Merkle tree over the credential attributes and compute the root.
pub fn compute_credential_root(attributes: &AttributeSet) -> Result<[u8; 32]> {
    if attributes.is_empty() {
        return Err(ZeroIdTeeError::CredentialError(
            "cannot compute root for empty attribute set".into(),
        ));
    }
    let leaves = attributes.encoded_leaves();
    let leaf_refs: Vec<&[u8]> = leaves.iter().map(|l| l.as_slice()).collect();
    let (root, _) = build_tree(&leaf_refs)?;
    Ok(root)
}

/// Create a selective disclosure proof revealing only the requested attributes.
pub fn create_disclosure_proof(
    attributes: &AttributeSet,
    request: &DisclosureRequest,
) -> Result<DisclosureProof> {
    if attributes.is_empty() {
        return Err(ZeroIdTeeError::CredentialError(
            "empty attribute set".into(),
        ));
    }
    if request.is_empty() {
        return Err(ZeroIdTeeError::CredentialError(
            "empty disclosure request".into(),
        ));
    }

    let leaves = attributes.encoded_leaves();
    let leaf_refs: Vec<&[u8]> = leaves.iter().map(|l| l.as_slice()).collect();
    let (root, layers) = build_tree(&leaf_refs)?;

    let mut revealed = Vec::new();
    let mut proofs = Vec::new();

    for attr_name in &request.attributes {
        let idx = attributes
            .entries
            .iter()
            .position(|(name, _)| name == attr_name)
            .ok_or_else(|| {
                ZeroIdTeeError::CredentialError(format!("attribute not found: {attr_name}"))
            })?;

        revealed.push(attributes.entries[idx].clone());
        let proof = generate_proof(&layers, idx)?;
        proofs.push(proof);
    }

    Ok(DisclosureProof {
        credential_root: root,
        revealed,
        proofs,
    })
}

/// Verify a selective disclosure proof against a known credential root.
pub fn verify_disclosure_proof(expected_root: &[u8; 32], proof: &DisclosureProof) -> Result<bool> {
    if proof.revealed.len() != proof.proofs.len() {
        return Err(ZeroIdTeeError::InvalidMerkleProof(
            "revealed attributes and proofs count mismatch".into(),
        ));
    }

    if proof.credential_root != *expected_root {
        return Ok(false);
    }

    for ((name, value), merkle_proof) in proof.revealed.iter().zip(proof.proofs.iter()) {
        let mut leaf = Vec::new();
        leaf.extend_from_slice(name.as_bytes());
        leaf.push(b':');
        leaf.extend_from_slice(value);

        if !verify_proof(expected_root, &leaf, merkle_proof)? {
            return Ok(false);
        }
    }

    Ok(true)
}

/// Compute the hash of a disclosed attribute (name + value).
pub fn attribute_hash(name: &str, value: &[u8]) -> [u8; 32] {
    let mut data = Vec::new();
    data.extend_from_slice(name.as_bytes());
    data.push(b':');
    data.extend_from_slice(value);
    keccak256(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_attributes() -> AttributeSet {
        let mut attrs = AttributeSet::new();
        attrs.add("name", b"Alice".to_vec());
        attrs.add("age", b"30".to_vec());
        attrs.add("country", b"US".to_vec());
        attrs.add("verified", b"true".to_vec());
        attrs
    }

    #[test]
    fn attribute_set_basics() {
        let attrs = sample_attributes();
        assert_eq!(attrs.len(), 4);
        assert!(!attrs.is_empty());
    }

    #[test]
    fn attribute_set_default_empty() {
        let attrs = AttributeSet::default();
        assert!(attrs.is_empty());
        assert_eq!(attrs.len(), 0);
    }

    #[test]
    fn disclosure_request_basics() {
        let req = DisclosureRequest::new(vec!["name".into()]);
        assert_eq!(req.len(), 1);
        assert!(!req.is_empty());
    }

    #[test]
    fn disclosure_request_empty() {
        let req = DisclosureRequest::new(vec![]);
        assert!(req.is_empty());
        assert_eq!(req.len(), 0);
    }

    #[test]
    fn compute_root_empty_fails() {
        let attrs = AttributeSet::new();
        assert!(compute_credential_root(&attrs).is_err());
    }

    #[test]
    fn compute_root_deterministic() {
        let attrs = sample_attributes();
        let r1 = compute_credential_root(&attrs).unwrap();
        let r2 = compute_credential_root(&attrs).unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn create_disclosure_proof_single() {
        let attrs = sample_attributes();
        let req = DisclosureRequest::new(vec!["name".into()]);
        let proof = create_disclosure_proof(&attrs, &req).unwrap();
        assert_eq!(proof.revealed.len(), 1);
        assert_eq!(proof.revealed[0].0, "name");
    }

    #[test]
    fn create_disclosure_proof_multiple() {
        let attrs = sample_attributes();
        let req = DisclosureRequest::new(vec!["name".into(), "country".into()]);
        let proof = create_disclosure_proof(&attrs, &req).unwrap();
        assert_eq!(proof.revealed.len(), 2);
    }

    #[test]
    fn create_disclosure_proof_empty_attrs_fails() {
        let attrs = AttributeSet::new();
        let req = DisclosureRequest::new(vec!["x".into()]);
        assert!(create_disclosure_proof(&attrs, &req).is_err());
    }

    #[test]
    fn create_disclosure_proof_empty_request_fails() {
        let attrs = sample_attributes();
        let req = DisclosureRequest::new(vec![]);
        assert!(create_disclosure_proof(&attrs, &req).is_err());
    }

    #[test]
    fn create_disclosure_proof_unknown_attribute_fails() {
        let attrs = sample_attributes();
        let req = DisclosureRequest::new(vec!["unknown".into()]);
        assert!(create_disclosure_proof(&attrs, &req).is_err());
    }

    #[test]
    fn verify_disclosure_proof_valid() {
        let attrs = sample_attributes();
        let root = compute_credential_root(&attrs).unwrap();
        let req = DisclosureRequest::new(vec!["name".into(), "age".into()]);
        let proof = create_disclosure_proof(&attrs, &req).unwrap();
        assert!(verify_disclosure_proof(&root, &proof).unwrap());
    }

    #[test]
    fn verify_disclosure_proof_all_attributes() {
        let attrs = sample_attributes();
        let root = compute_credential_root(&attrs).unwrap();
        let req = DisclosureRequest::new(attrs.entries.iter().map(|(n, _)| n.clone()).collect());
        let proof = create_disclosure_proof(&attrs, &req).unwrap();
        assert!(verify_disclosure_proof(&root, &proof).unwrap());
    }

    #[test]
    fn verify_disclosure_proof_wrong_root() {
        let attrs = sample_attributes();
        let root = compute_credential_root(&attrs).unwrap();
        let req = DisclosureRequest::new(vec!["name".into()]);
        let proof = create_disclosure_proof(&attrs, &req).unwrap();
        let wrong_root = [0xFF; 32];
        assert!(!verify_disclosure_proof(&wrong_root, &proof).unwrap());
    }

    #[test]
    fn verify_disclosure_proof_tampered_value() {
        let attrs = sample_attributes();
        let root = compute_credential_root(&attrs).unwrap();
        let req = DisclosureRequest::new(vec!["name".into()]);
        let mut proof = create_disclosure_proof(&attrs, &req).unwrap();
        proof.revealed[0].1 = b"Bob".to_vec(); // tamper
        assert!(!verify_disclosure_proof(&root, &proof).unwrap());
    }

    #[test]
    fn verify_disclosure_proof_length_mismatch() {
        let proof = DisclosureProof {
            credential_root: [0; 32],
            revealed: vec![("a".into(), vec![])],
            proofs: vec![],
        };
        assert!(verify_disclosure_proof(&[0; 32], &proof).is_err());
    }

    #[test]
    fn attribute_hash_deterministic() {
        let h1 = attribute_hash("name", b"Alice");
        let h2 = attribute_hash("name", b"Alice");
        assert_eq!(h1, h2);
    }

    #[test]
    fn attribute_hash_differs() {
        assert_ne!(
            attribute_hash("name", b"Alice"),
            attribute_hash("name", b"Bob")
        );
    }

    #[test]
    fn disclosure_proof_debug() {
        let proof = DisclosureProof {
            credential_root: [0; 32],
            revealed: vec![],
            proofs: vec![],
        };
        let dbg = format!("{proof:?}");
        assert!(dbg.contains("DisclosureProof"));
    }

    #[test]
    fn attribute_set_clone_eq() {
        let attrs = sample_attributes();
        let attrs2 = attrs.clone();
        assert_eq!(attrs, attrs2);
    }

    #[test]
    fn disclosure_request_clone_eq() {
        let req = DisclosureRequest::new(vec!["a".into()]);
        let req2 = req.clone();
        assert_eq!(req, req2);
    }
}
