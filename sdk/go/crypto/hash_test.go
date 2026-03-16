package crypto

import (
	"encoding/hex"
	"testing"
)

func TestKeccak256(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		wantHex  string
	}{
		{
			name:    "empty input",
			input:   []byte{},
			wantHex: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
		},
		{
			name:    "hello world",
			input:   []byte("hello world"),
			wantHex: "47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad",
		},
		{
			name:    "single byte",
			input:   []byte{0x00},
			wantHex: "bc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Keccak256(tt.input)
			gotHex := hex.EncodeToString(got[:])
			if gotHex != tt.wantHex {
				t.Errorf("Keccak256() = %s, want %s", gotHex, tt.wantHex)
			}
		})
	}
}

func TestComputeDIDHash(t *testing.T) {
	tests := []struct {
		name string
		did  string
	}{
		{
			name: "standard DID",
			did:  "did:zero:0x1234567890abcdef1234567890abcdef12345678",
		},
		{
			name: "empty DID",
			did:  "",
		},
		{
			name: "short DID",
			did:  "did:zero:0x01",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputeDIDHash(tt.did)
			want := Keccak256([]byte(tt.did))
			if got != want {
				t.Errorf("ComputeDIDHash(%q) != Keccak256([]byte(%q))", tt.did, tt.did)
			}
		})
	}
}
