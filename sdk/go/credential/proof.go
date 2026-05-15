package credential

import (
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"golang.org/x/crypto/sha3"
)

// ComputeCredentialSubjectMerkleRoot returns the deterministic root covered by
// a credential proof. The subject ID and each attribute are committed as
// independent leaves so claim tampering changes the root.
func ComputeCredentialSubjectMerkleRoot(subject CredentialSubject) (string, error) {
	leaves := make([][]byte, 0, len(subject.Attributes)+1)

	idLeaf, err := hashSubjectLeaf("id", subject.ID)
	if err != nil {
		return "", err
	}
	leaves = append(leaves, idLeaf)

	keys := make([]string, 0, len(subject.Attributes))
	for key := range subject.Attributes {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		leaf, err := hashSubjectLeaf(key, subject.Attributes[key])
		if err != nil {
			return "", err
		}
		leaves = append(leaves, leaf)
	}

	root := computeMerkleRoot(leaves)
	return hex.EncodeToString(root), nil
}

// BuildCredentialProofPayload builds the canonical bytes signed by issuer
// proof keys.
func BuildCredentialProofPayload(cred *VerifiableCredential, subjectMerkleRoot string) ([]byte, error) {
	if cred == nil {
		return nil, fmt.Errorf("credential: nil credential")
	}
	payload := map[string]interface{}{
		"credentialSchema":  cred.SchemaID,
		"expirationDate":    formatProofTime(cred.ExpirationDate),
		"id":                cred.ID,
		"issuanceDate":      formatProofTime(cred.IssuanceDate),
		"issuer":            cred.Issuer,
		"subjectMerkleRoot": subjectMerkleRoot,
		"type":              cred.Type,
	}
	return json.Marshal(payload)
}

// ComputeCredentialProofValue computes the issuer-key MAC over a proof payload.
func ComputeCredentialProofValue(signingKey string, payload []byte) string {
	mac := hmac.New(sha3.New256, []byte(signingKey))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func hashSubjectLeaf(key string, value interface{}) ([]byte, error) {
	payload, err := json.Marshal(map[string]interface{}{key: value})
	if err != nil {
		return nil, fmt.Errorf("credential: subject leaf %q is not serializable: %w", key, err)
	}
	return sha3256(payload), nil
}

func computeMerkleRoot(leaves [][]byte) []byte {
	layer := make([][]byte, len(leaves))
	copy(layer, leaves)

	for len(layer) > 1 {
		next := make([][]byte, 0, (len(layer)+1)/2)
		for i := 0; i < len(layer); i += 2 {
			if i+1 >= len(layer) {
				next = append(next, layer[i])
				continue
			}
			next = append(next, hashMerklePair(layer[i], layer[i+1]))
		}
		layer = next
	}
	return layer[0]
}

func hashMerklePair(left, right []byte) []byte {
	if string(left) <= string(right) {
		return sha3256(append(append([]byte{}, left...), right...))
	}
	return sha3256(append(append([]byte{}, right...), left...))
}

func sha3256(data []byte) []byte {
	h := sha3.New256()
	h.Write(data)
	return h.Sum(nil)
}

func formatProofTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
