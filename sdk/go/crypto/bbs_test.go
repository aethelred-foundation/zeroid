package crypto

import (
	"errors"
	"testing"
)

func validPK() *BBSPublicKey {
	return &BBSPublicKey{Key: []byte("test-public-key"), MessageCount: 5}
}

func validSig() *BBSSignature {
	return &BBSSignature{Data: make([]byte, 48)}
}

func validMessages() [][]byte {
	return [][]byte{[]byte("msg1"), []byte("msg2")}
}

func TestBBSVerify(t *testing.T) {
	tests := []struct {
		name     string
		pk       *BBSPublicKey
		sig      *BBSSignature
		msgs     [][]byte
		wantErr  error
	}{
		{
			name:    "valid signature",
			pk:      validPK(),
			sig:     validSig(),
			msgs:    validMessages(),
			wantErr: nil,
		},
		{
			name:    "nil public key",
			pk:      nil,
			sig:     validSig(),
			msgs:    validMessages(),
			wantErr: ErrNilPublicKey,
		},
		{
			name:    "no messages",
			pk:      validPK(),
			sig:     validSig(),
			msgs:    [][]byte{},
			wantErr: ErrNoMessages,
		},
		{
			name:    "nil signature",
			pk:      validPK(),
			sig:     nil,
			msgs:    validMessages(),
			wantErr: ErrInvalidSignature,
		},
		{
			name:    "empty signature data",
			pk:      validPK(),
			sig:     &BBSSignature{Data: []byte{}},
			msgs:    validMessages(),
			wantErr: ErrInvalidSignature,
		},
		{
			name:    "empty public key",
			pk:      &BBSPublicKey{Key: []byte{}, MessageCount: 1},
			sig:     validSig(),
			msgs:    validMessages(),
			wantErr: ErrInvalidSignature,
		},
		{
			name:    "wrong signature length",
			pk:      validPK(),
			sig:     &BBSSignature{Data: []byte("short")},
			msgs:    validMessages(),
			wantErr: ErrInvalidSignature,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := BBSVerify(tt.pk, tt.sig, tt.msgs)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("BBSVerify() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestBBSCreateProof(t *testing.T) {
	tests := []struct {
		name            string
		pk              *BBSPublicKey
		sig             *BBSSignature
		msgs            [][]byte
		revealedIndexes []int
		wantErr         bool
		errContains     string
	}{
		{
			name:            "valid proof creation",
			pk:              validPK(),
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{0},
			wantErr:         false,
		},
		{
			name:            "nil public key",
			pk:              nil,
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{0},
			wantErr:         true,
			errContains:     "nil public key",
		},
		{
			name:            "no messages",
			pk:              validPK(),
			sig:             validSig(),
			msgs:            [][]byte{},
			revealedIndexes: []int{},
			wantErr:         true,
			errContains:     "no messages",
		},
		{
			name:            "nil signature",
			pk:              validPK(),
			sig:             nil,
			msgs:            validMessages(),
			revealedIndexes: []int{0},
			wantErr:         true,
			errContains:     "invalid signature",
		},
		{
			name:            "empty signature data",
			pk:              validPK(),
			sig:             &BBSSignature{Data: []byte{}},
			msgs:            validMessages(),
			revealedIndexes: []int{0},
			wantErr:         true,
			errContains:     "invalid signature",
		},
		{
			name:            "empty public key",
			pk:              &BBSPublicKey{Key: []byte{}, MessageCount: 1},
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{0},
			wantErr:         true,
			errContains:     "invalid signature",
		},
		{
			name:            "index out of range",
			pk:              validPK(),
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{5},
			wantErr:         true,
			errContains:     "out of range",
		},
		{
			name:            "negative index",
			pk:              validPK(),
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{-1},
			wantErr:         true,
			errContains:     "out of range",
		},
		{
			name:            "no revealed indexes",
			pk:              validPK(),
			sig:             validSig(),
			msgs:            validMessages(),
			revealedIndexes: []int{},
			wantErr:         false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proof, err := BBSCreateProof(tt.pk, tt.sig, tt.msgs, tt.revealedIndexes)
			if tt.wantErr {
				if err == nil {
					t.Error("BBSCreateProof() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Errorf("BBSCreateProof() unexpected error: %v", err)
				return
			}
			if proof == nil {
				t.Error("BBSCreateProof() returned nil proof")
				return
			}
			if len(proof.Data) != 32 {
				t.Errorf("proof data length = %d, want 32", len(proof.Data))
			}
			if len(proof.RevealedIndexes) != len(tt.revealedIndexes) {
				t.Errorf("revealed indexes length = %d, want %d", len(proof.RevealedIndexes), len(tt.revealedIndexes))
			}
		})
	}
}

func TestBBSVerifyProof(t *testing.T) {
	tests := []struct {
		name             string
		pk               *BBSPublicKey
		proof            *BBSProof
		revealedMessages [][]byte
		wantErr          error
	}{
		{
			name: "valid proof",
			pk:   validPK(),
			proof: &BBSProof{
				Data:            make([]byte, 32),
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          nil,
		},
		{
			name: "nil public key",
			pk:   nil,
			proof: &BBSProof{
				Data:            make([]byte, 32),
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrNilPublicKey,
		},
		{
			name:             "nil proof",
			pk:               validPK(),
			proof:            nil,
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrInvalidProof,
		},
		{
			name: "empty proof data",
			pk:   validPK(),
			proof: &BBSProof{
				Data:            []byte{},
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrInvalidProof,
		},
		{
			name: "empty public key",
			pk:   &BBSPublicKey{Key: []byte{}, MessageCount: 1},
			proof: &BBSProof{
				Data:            make([]byte, 32),
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrInvalidProof,
		},
		{
			name: "no revealed messages",
			pk:   validPK(),
			proof: &BBSProof{
				Data:            make([]byte, 32),
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{},
			wantErr:          ErrNoMessages,
		},
		{
			name: "mismatched message and index count",
			pk:   validPK(),
			proof: &BBSProof{
				Data:            make([]byte, 32),
				RevealedIndexes: []int{0, 1},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrInvalidProof,
		},
		{
			name: "wrong proof data length",
			pk:   validPK(),
			proof: &BBSProof{
				Data:            make([]byte, 16),
				RevealedIndexes: []int{0},
			},
			revealedMessages: [][]byte{[]byte("msg1")},
			wantErr:          ErrInvalidProof,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := BBSVerifyProof(tt.pk, tt.proof, tt.revealedMessages)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("BBSVerifyProof() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
