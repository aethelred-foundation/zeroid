/// Cryptographic hash functions for the ZeroID TEE crate.
///
/// Implements Keccak-256 and SHA-256 from scratch (no external dependencies).

/// Keccak-256 round constants.
const KECCAK_RC: [u64; 24] = [
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808A,
    0x8000000080008000,
    0x000000000000808B,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008A,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000A,
    0x000000008000808B,
    0x800000000000008B,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800A,
    0x800000008000000A,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
];

/// Keccak-256 rotation offsets.
const KECCAK_ROTATIONS: [[u32; 5]; 5] = [
    [0, 1, 62, 28, 27],
    [36, 44, 6, 55, 20],
    [3, 10, 43, 25, 39],
    [41, 45, 15, 21, 8],
    [18, 2, 61, 56, 14],
];

/// Perform the Keccak-f[1600] permutation on a 5x5 state of u64 lanes.
fn keccak_f1600(state: &mut [u64; 25]) {
    for round in 0..24 {
        // Theta
        let mut c = [0u64; 5];
        for x in 0..5 {
            c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        let mut d = [0u64; 5];
        for x in 0..5 {
            d[x] = c[(x + 4) % 5] ^ c[(x + 1) % 5].rotate_left(1);
        }
        for x in 0..5 {
            for y in 0..5 {
                state[x + 5 * y] ^= d[x];
            }
        }

        // Rho and Pi
        let mut b = [0u64; 25];
        for x in 0..5 {
            for y in 0..5 {
                let idx = x + 5 * y;
                let new_x = y;
                let new_y = (2 * x + 3 * y) % 5;
                b[new_x + 5 * new_y] = state[idx].rotate_left(KECCAK_ROTATIONS[y][x]);
            }
        }

        // Chi
        for x in 0..5 {
            for y in 0..5 {
                let idx = x + 5 * y;
                state[idx] = b[idx] ^ ((!b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
            }
        }

        // Iota
        state[0] ^= KECCAK_RC[round];
    }
}

/// Compute the Keccak-256 hash of `data`.
///
/// This is the Ethereum-flavour Keccak (not NIST SHA-3), using a `0x01` suffix
/// and a 1088-bit (136-byte) rate.
///
/// # Examples
/// ```
/// use zeroid_tee::crypto::hash::keccak256;
/// let hash = keccak256(b"hello");
/// assert_eq!(hash.len(), 32);
/// ```
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let rate = 136; // r = 1088 bits = 136 bytes for Keccak-256
    let mut state = [0u64; 25];

    // Absorb
    let mut offset = 0;
    // Process full blocks
    while offset + rate <= data.len() {
        for i in 0..(rate / 8) {
            let lane = u64::from_le_bytes([
                data[offset + i * 8],
                data[offset + i * 8 + 1],
                data[offset + i * 8 + 2],
                data[offset + i * 8 + 3],
                data[offset + i * 8 + 4],
                data[offset + i * 8 + 5],
                data[offset + i * 8 + 6],
                data[offset + i * 8 + 7],
            ]);
            state[i] ^= lane;
        }
        keccak_f1600(&mut state);
        offset += rate;
    }

    // Pad the last block: Keccak uses 0x01 domain suffix (not SHA-3's 0x06)
    let mut last_block = vec![0u8; rate];
    let remaining = data.len() - offset;
    last_block[..remaining].copy_from_slice(&data[offset..]);
    last_block[remaining] = 0x01;
    last_block[rate - 1] |= 0x80;

    for i in 0..(rate / 8) {
        let lane = u64::from_le_bytes([
            last_block[i * 8],
            last_block[i * 8 + 1],
            last_block[i * 8 + 2],
            last_block[i * 8 + 3],
            last_block[i * 8 + 4],
            last_block[i * 8 + 5],
            last_block[i * 8 + 6],
            last_block[i * 8 + 7],
        ]);
        state[i] ^= lane;
    }
    keccak_f1600(&mut state);

    // Squeeze 256 bits
    let mut out = [0u8; 32];
    for i in 0..4 {
        let bytes = state[i].to_le_bytes();
        out[i * 8..(i + 1) * 8].copy_from_slice(&bytes);
    }
    out
}

/// SHA-256 round constants (first 32 bits of the fractional parts of the cube
/// roots of the first 64 primes).
const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

/// SHA-256 helper: big-Sigma-0.
fn bsig0(x: u32) -> u32 {
    x.rotate_right(2) ^ x.rotate_right(13) ^ x.rotate_right(22)
}

/// SHA-256 helper: big-Sigma-1.
fn bsig1(x: u32) -> u32 {
    x.rotate_right(6) ^ x.rotate_right(11) ^ x.rotate_right(25)
}

/// SHA-256 helper: small-sigma-0.
fn ssig0(x: u32) -> u32 {
    x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3)
}

/// SHA-256 helper: small-sigma-1.
fn ssig1(x: u32) -> u32 {
    x.rotate_right(17) ^ x.rotate_right(19) ^ (x >> 10)
}

/// SHA-256 helper: Ch(x,y,z).
fn ch(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ ((!x) & z)
}

/// SHA-256 helper: Maj(x,y,z).
fn maj(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ (x & z) ^ (y & z)
}

/// Compute the SHA-256 hash of `data`.
///
/// # Examples
/// ```
/// use zeroid_tee::crypto::hash::sha256;
/// let hash = sha256(b"hello");
/// assert_eq!(hash.len(), 32);
/// ```
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    // Pre-processing: pad the message
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = data.to_vec();
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit (64-byte) block
    for block in padded.chunks_exact(64) {
        // Prepare message schedule
        let mut w = [0u32; 64];
        for t in 0..16 {
            w[t] = u32::from_be_bytes([
                block[t * 4],
                block[t * 4 + 1],
                block[t * 4 + 2],
                block[t * 4 + 3],
            ]);
        }
        for t in 16..64 {
            w[t] = ssig1(w[t - 2])
                .wrapping_add(w[t - 7])
                .wrapping_add(ssig0(w[t - 15]))
                .wrapping_add(w[t - 16]);
        }

        // Initialise working variables
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;

        // 64 rounds
        for t in 0..64 {
            let t1 = h
                .wrapping_add(bsig1(e))
                .wrapping_add(ch(e, f, g))
                .wrapping_add(SHA256_K[t])
                .wrapping_add(w[t]);
            let t2 = bsig0(a).wrapping_add(maj(a, b, c));

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }

        // Add compressed chunk to running hash
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
        state[5] = state[5].wrapping_add(f);
        state[6] = state[6].wrapping_add(g);
        state[7] = state[7].wrapping_add(h);
    }

    let mut out = [0u8; 32];
    for (i, val) in state.iter().enumerate() {
        out[i * 4..(i + 1) * 4].copy_from_slice(&val.to_be_bytes());
    }
    out
}

/// Convert a byte slice to a lowercase hex string.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Known Keccak-256 test vector: keccak256("") =
    // c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
    #[test]
    fn keccak256_empty() {
        let hash = keccak256(b"");
        let hex = to_hex(&hash);
        assert_eq!(
            hex,
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    // keccak256("hello") known value
    #[test]
    fn keccak256_hello() {
        let hash = keccak256(b"hello");
        let hex = to_hex(&hash);
        assert_eq!(
            hex,
            "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        );
    }

    #[test]
    fn keccak256_longer_input() {
        // keccak256 of a string longer than one block (136 bytes)
        let data = vec![0xABu8; 200];
        let hash = keccak256(&data);
        // Deterministic — just verify length and consistency.
        assert_eq!(hash.len(), 32);
        let hash2 = keccak256(&data);
        assert_eq!(hash, hash2);
    }

    // SHA-256 test vectors from NIST
    #[test]
    fn sha256_empty() {
        let hash = sha256(b"");
        let hex = to_hex(&hash);
        assert_eq!(
            hex,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_hello() {
        let hash = sha256(b"hello");
        let hex = to_hex(&hash);
        assert_eq!(
            hex,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn sha256_abc() {
        let hash = sha256(b"abc");
        let hex = to_hex(&hash);
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sha256_longer_input() {
        let data = vec![0x61u8; 1000]; // 'a' repeated 1000 times
        let hash = sha256(&data);
        assert_eq!(hash.len(), 32);
        let hash2 = sha256(&data);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn to_hex_works() {
        assert_eq!(to_hex(&[0xab, 0xcd, 0xef]), "abcdef");
        assert_eq!(to_hex(&[]), "");
        assert_eq!(to_hex(&[0x00, 0xff]), "00ff");
    }
}
