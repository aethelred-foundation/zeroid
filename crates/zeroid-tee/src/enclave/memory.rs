/// Sealed / encrypted memory operations.
///
/// Provides a simulation of SGX sealing: data is encrypted with an
/// enclave-derived key so it can be persisted and later restored only by the
/// same enclave.
use crate::crypto::hash::{keccak256, sha256};
use crate::error::{Result, ZeroIdTeeError};

/// A sealed data blob.  In a real SGX implementation this would use the
/// platform sealing key; here we use a deterministic XOR cipher derived from
/// the sealing key for testability.
#[derive(Debug, Clone, PartialEq)]
pub struct SealedData {
    /// The encrypted payload.
    pub ciphertext: Vec<u8>,
    /// A tag used to verify integrity on unseal.
    pub tag: [u8; 32],
    /// Additional authenticated data (not encrypted).
    pub aad: Vec<u8>,
}

/// Derive a keystream byte at position `i` from a sealing key.
fn keystream_byte(sealing_key: &[u8; 32], index: usize) -> u8 {
    // Derive a per-block key using the index to avoid repeating patterns.
    let block = index / 32;
    let offset = index % 32;
    let mut block_input = Vec::with_capacity(40);
    block_input.extend_from_slice(sealing_key);
    block_input.extend_from_slice(&(block as u64).to_le_bytes());
    let block_key = sha256(&block_input);
    block_key[offset]
}

/// Compute an integrity tag over plaintext + aad using the sealing key.
fn compute_tag(sealing_key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> [u8; 32] {
    let mut tag_input = Vec::with_capacity(32 + plaintext.len() + aad.len());
    tag_input.extend_from_slice(sealing_key);
    tag_input.extend_from_slice(plaintext);
    tag_input.extend_from_slice(aad);
    keccak256(&tag_input)
}

/// Seal (encrypt) `plaintext` with the given 32-byte `sealing_key`.
///
/// Optional additional authenticated data (`aad`) is integrity-protected but
/// not encrypted.
pub fn seal(sealing_key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> SealedData {
    let ciphertext: Vec<u8> = plaintext
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ keystream_byte(sealing_key, i))
        .collect();

    let tag = compute_tag(sealing_key, plaintext, aad);

    SealedData {
        ciphertext,
        tag,
        aad: aad.to_vec(),
    }
}

/// Unseal (decrypt) a [`SealedData`] blob with the given `sealing_key`.
///
/// Returns `Err` if the integrity tag does not match (wrong key or corrupted
/// data).
pub fn unseal(sealing_key: &[u8; 32], sealed: &SealedData) -> Result<Vec<u8>> {
    let plaintext: Vec<u8> = sealed
        .ciphertext
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ keystream_byte(sealing_key, i))
        .collect();

    let expected_tag = compute_tag(sealing_key, &plaintext, &sealed.aad);
    if expected_tag != sealed.tag {
        return Err(ZeroIdTeeError::SealingError(
            "integrity check failed — wrong key or corrupted data".into(),
        ));
    }

    Ok(plaintext)
}

/// Seal data with an empty AAD.
pub fn seal_simple(sealing_key: &[u8; 32], plaintext: &[u8]) -> SealedData {
    seal(sealing_key, plaintext, &[])
}

/// Unseal data that was sealed with [`seal_simple`].
pub fn unseal_simple(sealing_key: &[u8; 32], sealed: &SealedData) -> Result<Vec<u8>> {
    unseal(sealing_key, sealed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        [0x42u8; 32]
    }

    #[test]
    fn seal_unseal_roundtrip() {
        let key = test_key();
        let plaintext = b"secret data";
        let sealed = seal(&key, plaintext, b"aad");
        let recovered = unseal(&key, &sealed).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn seal_simple_roundtrip() {
        let key = test_key();
        let plaintext = b"hello world";
        let sealed = seal_simple(&key, plaintext);
        let recovered = unseal_simple(&key, &sealed).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn ciphertext_differs_from_plaintext() {
        let key = test_key();
        let plaintext = b"not the same";
        let sealed = seal_simple(&key, plaintext);
        assert_ne!(&sealed.ciphertext, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = [0x01u8; 32];
        let key2 = [0x02u8; 32];
        let sealed = seal_simple(&key1, b"data");
        let result = unseal_simple(&key2, &sealed);
        assert!(result.is_err());
        match result.unwrap_err() {
            ZeroIdTeeError::SealingError(_) => {}
            other => panic!("expected SealingError, got: {other}"),
        }
    }

    #[test]
    fn corrupted_ciphertext_fails() {
        let key = test_key();
        let mut sealed = seal_simple(&key, b"data");
        if let Some(b) = sealed.ciphertext.first_mut() {
            *b ^= 0xFF;
        }
        let result = unseal_simple(&key, &sealed);
        assert!(result.is_err());
    }

    #[test]
    fn corrupted_tag_fails() {
        let key = test_key();
        let mut sealed = seal_simple(&key, b"data");
        sealed.tag[0] ^= 0xFF;
        let result = unseal_simple(&key, &sealed);
        assert!(result.is_err());
    }

    #[test]
    fn aad_is_authenticated() {
        let key = test_key();
        let mut sealed = seal(&key, b"data", b"aad1");
        sealed.aad = b"aad2".to_vec(); // tamper with aad
        let result = unseal(&key, &sealed);
        assert!(result.is_err());
    }

    #[test]
    fn empty_plaintext() {
        let key = test_key();
        let sealed = seal_simple(&key, b"");
        let recovered = unseal_simple(&key, &sealed).unwrap();
        assert!(recovered.is_empty());
    }

    #[test]
    fn large_plaintext() {
        let key = test_key();
        let plaintext = vec![0xABu8; 10_000];
        let sealed = seal_simple(&key, &plaintext);
        let recovered = unseal_simple(&key, &sealed).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn sealed_data_clone_eq() {
        let key = test_key();
        let sealed = seal_simple(&key, b"test");
        let sealed2 = sealed.clone();
        assert_eq!(sealed, sealed2);
    }

    #[test]
    fn sealed_data_debug() {
        let key = test_key();
        let sealed = seal_simple(&key, b"x");
        let dbg = format!("{sealed:?}");
        assert!(dbg.contains("SealedData"));
    }

    #[test]
    fn keystream_byte_deterministic() {
        let key = test_key();
        assert_eq!(keystream_byte(&key, 0), keystream_byte(&key, 0));
        assert_eq!(keystream_byte(&key, 100), keystream_byte(&key, 100));
    }

    #[test]
    fn compute_tag_deterministic() {
        let key = test_key();
        let t1 = compute_tag(&key, b"pt", b"aad");
        let t2 = compute_tag(&key, b"pt", b"aad");
        assert_eq!(t1, t2);
    }

    #[test]
    fn different_aad_different_tag() {
        let key = test_key();
        let t1 = compute_tag(&key, b"pt", b"aad1");
        let t2 = compute_tag(&key, b"pt", b"aad2");
        assert_ne!(t1, t2);
    }
}
