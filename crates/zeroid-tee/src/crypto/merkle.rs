/// Merkle tree construction and proof verification for selective disclosure.
///
/// Leaves are hashed with a `0x00` prefix and internal nodes with a `0x01`
/// prefix to prevent second-preimage attacks.

use crate::crypto::hash::keccak256;
use crate::error::{Result, ZeroIdTeeError};

/// A proof that a leaf is included in a Merkle tree.
#[derive(Debug, Clone, PartialEq)]
pub struct MerkleProof {
    /// The sibling hashes along the path from the leaf to the root.
    pub siblings: Vec<[u8; 32]>,
    /// For each level, whether the sibling is on the left (`true`) or right.
    pub path_indices: Vec<bool>,
}

/// Hash a leaf value with a domain-separation prefix.
pub fn hash_leaf(data: &[u8]) -> [u8; 32] {
    let mut prefixed = Vec::with_capacity(1 + data.len());
    prefixed.push(0x00);
    prefixed.extend_from_slice(data);
    keccak256(&prefixed)
}

/// Hash two child nodes into a parent node.
pub fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut prefixed = Vec::with_capacity(1 + 64);
    prefixed.push(0x01);
    prefixed.extend_from_slice(left);
    prefixed.extend_from_slice(right);
    keccak256(&prefixed)
}

/// Build a Merkle tree from a set of leaf values.
///
/// Returns `(root, layers)` where `layers[0]` contains the leaf hashes and the
/// last layer contains only the root hash.
///
/// If the number of leaves at any level is odd the last element is duplicated.
pub fn build_tree(leaves: &[&[u8]]) -> Result<([u8; 32], Vec<Vec<[u8; 32]>>)> {
    if leaves.is_empty() {
        return Err(ZeroIdTeeError::InvalidMerkleProof(
            "cannot build tree from empty leaves".into(),
        ));
    }

    let mut layers: Vec<Vec<[u8; 32]>> = Vec::new();
    let leaf_hashes: Vec<[u8; 32]> = leaves.iter().map(|l| hash_leaf(l)).collect();
    layers.push(leaf_hashes);

    while layers.last().unwrap().len() > 1 {
        let prev = layers.last().unwrap();
        let mut next = Vec::new();
        let mut i = 0;
        while i < prev.len() {
            let left = &prev[i];
            let right = if i + 1 < prev.len() {
                &prev[i + 1]
            } else {
                &prev[i] // duplicate last element
            };
            next.push(hash_pair(left, right));
            i += 2;
        }
        layers.push(next);
    }

    let root = layers.last().unwrap()[0];
    Ok((root, layers))
}

/// Generate a Merkle proof for the leaf at `index`.
pub fn generate_proof(layers: &[Vec<[u8; 32]>], index: usize) -> Result<MerkleProof> {
    if layers.is_empty() {
        return Err(ZeroIdTeeError::InvalidMerkleProof(
            "empty tree layers".into(),
        ));
    }
    if index >= layers[0].len() {
        return Err(ZeroIdTeeError::InvalidMerkleProof(format!(
            "index {index} out of range for {} leaves",
            layers[0].len()
        )));
    }

    let mut siblings = Vec::new();
    let mut path_indices = Vec::new();
    let mut idx = index;

    for layer in layers.iter().take(layers.len() - 1) {
        let sibling_idx = if idx.is_multiple_of(2) {
            if idx + 1 < layer.len() {
                idx + 1
            } else {
                idx // duplicate
            }
        } else {
            idx - 1
        };
        siblings.push(layer[sibling_idx]);
        path_indices.push(!idx.is_multiple_of(2)); // true if current is on the right
        idx /= 2;
    }

    Ok(MerkleProof {
        siblings,
        path_indices,
    })
}

/// Verify that `leaf_data` is in the tree with the given `root`.
pub fn verify_proof(
    root: &[u8; 32],
    leaf_data: &[u8],
    proof: &MerkleProof,
) -> Result<bool> {
    if proof.siblings.len() != proof.path_indices.len() {
        return Err(ZeroIdTeeError::InvalidMerkleProof(
            "siblings and path_indices length mismatch".into(),
        ));
    }

    let mut current = hash_leaf(leaf_data);

    for (sibling, &is_right) in proof.siblings.iter().zip(proof.path_indices.iter()) {
        current = if is_right {
            hash_pair(sibling, &current)
        } else {
            hash_pair(&current, sibling)
        };
    }

    Ok(current == *root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_leaf_deterministic() {
        let h1 = hash_leaf(b"hello");
        let h2 = hash_leaf(b"hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_leaf_different_data() {
        assert_ne!(hash_leaf(b"a"), hash_leaf(b"b"));
    }

    #[test]
    fn hash_pair_deterministic() {
        let a = hash_leaf(b"a");
        let b = hash_leaf(b"b");
        assert_eq!(hash_pair(&a, &b), hash_pair(&a, &b));
    }

    #[test]
    fn hash_pair_order_matters() {
        let a = hash_leaf(b"a");
        let b = hash_leaf(b"b");
        assert_ne!(hash_pair(&a, &b), hash_pair(&b, &a));
    }

    #[test]
    fn build_tree_empty_fails() {
        let result = build_tree(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn build_tree_single_leaf() {
        let (root, layers) = build_tree(&[b"only"]).unwrap();
        assert_eq!(layers.len(), 1);
        assert_eq!(root, hash_leaf(b"only"));
    }

    #[test]
    fn build_tree_two_leaves() {
        let (root, layers) = build_tree(&[b"a", b"b"]).unwrap();
        assert_eq!(layers.len(), 2);
        let expected = hash_pair(&hash_leaf(b"a"), &hash_leaf(b"b"));
        assert_eq!(root, expected);
    }

    #[test]
    fn build_tree_three_leaves() {
        let (root, layers) = build_tree(&[b"a", b"b", b"c"]).unwrap();
        // 3 leaves => duplicate last: [a, b, c, c] at internal level
        assert_eq!(layers[0].len(), 3);
        assert_eq!(layers.len(), 3); // leaf layer, internal, root
        assert_eq!(root, layers.last().unwrap()[0]);
    }

    #[test]
    fn build_tree_four_leaves() {
        let (root, layers) = build_tree(&[b"a", b"b", b"c", b"d"]).unwrap();
        assert_eq!(layers[0].len(), 4);
        assert_eq!(layers[1].len(), 2);
        assert_eq!(layers[2].len(), 1);
        assert_eq!(root, layers[2][0]);
    }

    #[test]
    fn generate_proof_out_of_range() {
        let (_, layers) = build_tree(&[b"a", b"b"]).unwrap();
        let result = generate_proof(&layers, 5);
        assert!(result.is_err());
    }

    #[test]
    fn generate_proof_empty_layers() {
        let result = generate_proof(&[], 0);
        assert!(result.is_err());
    }

    #[test]
    fn proof_verify_two_leaves() {
        let leaves: Vec<&[u8]> = vec![b"alpha", b"beta"];
        let (root, layers) = build_tree(&leaves).unwrap();

        for (i, leaf) in leaves.iter().enumerate() {
            let proof = generate_proof(&layers, i).unwrap();
            assert!(verify_proof(&root, leaf, &proof).unwrap());
        }
    }

    #[test]
    fn proof_verify_four_leaves() {
        let leaves: Vec<&[u8]> = vec![b"w", b"x", b"y", b"z"];
        let (root, layers) = build_tree(&leaves).unwrap();

        for (i, leaf) in leaves.iter().enumerate() {
            let proof = generate_proof(&layers, i).unwrap();
            assert!(
                verify_proof(&root, leaf, &proof).unwrap(),
                "proof failed for leaf {i}"
            );
        }
    }

    #[test]
    fn proof_verify_three_leaves() {
        let leaves: Vec<&[u8]> = vec![b"one", b"two", b"three"];
        let (root, layers) = build_tree(&leaves).unwrap();

        for (i, leaf) in leaves.iter().enumerate() {
            let proof = generate_proof(&layers, i).unwrap();
            assert!(verify_proof(&root, leaf, &proof).unwrap());
        }
    }

    #[test]
    fn proof_verify_single_leaf() {
        let (root, layers) = build_tree(&[b"solo"]).unwrap();
        let proof = generate_proof(&layers, 0).unwrap();
        assert!(proof.siblings.is_empty());
        assert!(verify_proof(&root, b"solo", &proof).unwrap());
    }

    #[test]
    fn proof_verify_wrong_leaf_fails() {
        let leaves: Vec<&[u8]> = vec![b"a", b"b", b"c", b"d"];
        let (root, layers) = build_tree(&leaves).unwrap();
        let proof = generate_proof(&layers, 0).unwrap();
        assert!(!verify_proof(&root, b"wrong", &proof).unwrap());
    }

    #[test]
    fn verify_proof_length_mismatch() {
        let proof = MerkleProof {
            siblings: vec![[0u8; 32]],
            path_indices: vec![],
        };
        let result = verify_proof(&[0u8; 32], b"x", &proof);
        assert!(result.is_err());
    }

    #[test]
    fn proof_clone_eq() {
        let leaves: Vec<&[u8]> = vec![b"a", b"b"];
        let (_, layers) = build_tree(&leaves).unwrap();
        let proof = generate_proof(&layers, 0).unwrap();
        let proof2 = proof.clone();
        assert_eq!(proof, proof2);
    }

    #[test]
    fn proof_debug() {
        let proof = MerkleProof {
            siblings: vec![],
            path_indices: vec![],
        };
        let dbg = format!("{proof:?}");
        assert!(dbg.contains("MerkleProof"));
    }

    #[test]
    fn build_tree_five_leaves() {
        let leaves: Vec<&[u8]> = vec![b"1", b"2", b"3", b"4", b"5"];
        let (root, layers) = build_tree(&leaves).unwrap();
        assert_eq!(layers[0].len(), 5);
        // Verify all proofs
        for (i, leaf) in leaves.iter().enumerate() {
            let proof = generate_proof(&layers, i).unwrap();
            assert!(verify_proof(&root, leaf, &proof).unwrap());
        }
    }
}
