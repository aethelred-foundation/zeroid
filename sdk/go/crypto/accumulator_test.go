package crypto

import (
	"errors"
	"testing"
)

func TestNewAccumulator(t *testing.T) {
	acc := NewAccumulator()
	if acc == nil {
		t.Fatal("NewAccumulator() returned nil")
	}
	var zero [32]byte
	if acc.Value == zero {
		t.Error("accumulator value should not be zero")
	}
	if acc.elements == nil {
		t.Error("elements map should be initialized")
	}
}

func TestAccumulatorAdd(t *testing.T) {
	tests := []struct {
		name     string
		elements [][]byte
		addElem  []byte
		wantErr  error
	}{
		{
			name:    "add first element",
			addElem: []byte("element1"),
			wantErr: nil,
		},
		{
			name:     "add duplicate element",
			elements: [][]byte{[]byte("element1")},
			addElem:  []byte("element1"),
			wantErr:  ErrElementExists,
		},
		{
			name:     "add second unique element",
			elements: [][]byte{[]byte("element1")},
			addElem:  []byte("element2"),
			wantErr:  nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			acc := NewAccumulator()
			for _, e := range tt.elements {
				_, _ = acc.Add(e)
			}
			witness, err := acc.Add(tt.addElem)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("Add() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr == nil {
				if witness == nil {
					t.Error("Add() returned nil witness for successful add")
				}
				if !acc.Contains(tt.addElem) {
					t.Error("Contains() should return true after Add()")
				}
			}
		})
	}
}

func TestAccumulatorRemove(t *testing.T) {
	tests := []struct {
		name     string
		elements [][]byte
		remove   []byte
		wantErr  error
	}{
		{
			name:    "remove from empty",
			remove:  []byte("element1"),
			wantErr: ErrElementNotFound,
		},
		{
			name:     "remove existing element",
			elements: [][]byte{[]byte("element1")},
			remove:   []byte("element1"),
			wantErr:  nil,
		},
		{
			name:     "remove non-existing element",
			elements: [][]byte{[]byte("element1")},
			remove:   []byte("element2"),
			wantErr:  ErrElementNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			acc := NewAccumulator()
			for _, e := range tt.elements {
				_, _ = acc.Add(e)
			}
			err := acc.Remove(tt.remove)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("Remove() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr == nil && acc.Contains(tt.remove) {
				t.Error("Contains() should return false after Remove()")
			}
		})
	}
}

func TestAccumulatorRemoveRecomputes(t *testing.T) {
	acc := NewAccumulator()
	_, _ = acc.Add([]byte("a"))
	_, _ = acc.Add([]byte("b"))
	valueBefore := acc.Value
	_ = acc.Remove([]byte("a"))
	if acc.Value == valueBefore {
		t.Error("accumulator value should change after Remove()")
	}
}

func TestVerify(t *testing.T) {
	tests := []struct {
		name       string
		setup      func() ([]byte, *Witness, [32]byte)
		wantResult bool
	}{
		{
			name: "valid membership",
			setup: func() ([]byte, *Witness, [32]byte) {
				acc := NewAccumulator()
				elem := []byte("element1")
				w, _ := acc.Add(elem)
				return elem, w, acc.Value
			},
			wantResult: true,
		},
		{
			name: "nil witness",
			setup: func() ([]byte, *Witness, [32]byte) {
				return []byte("element1"), nil, [32]byte{}
			},
			wantResult: false,
		},
		{
			name: "wrong element",
			setup: func() ([]byte, *Witness, [32]byte) {
				acc := NewAccumulator()
				w, _ := acc.Add([]byte("element1"))
				return []byte("element2"), w, acc.Value
			},
			wantResult: false,
		},
		{
			name: "wrong accumulator value",
			setup: func() ([]byte, *Witness, [32]byte) {
				acc := NewAccumulator()
				elem := []byte("element1")
				w, _ := acc.Add(elem)
				wrongVal := Keccak256([]byte("wrong"))
				return elem, w, wrongVal
			},
			wantResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			elem, witness, accumVal := tt.setup()
			got := Verify(elem, witness, accumVal)
			if got != tt.wantResult {
				t.Errorf("Verify() = %v, want %v", got, tt.wantResult)
			}
		})
	}
}

func TestAccumulatorContains(t *testing.T) {
	acc := NewAccumulator()
	if acc.Contains([]byte("x")) {
		t.Error("empty accumulator should not contain anything")
	}
	_, _ = acc.Add([]byte("x"))
	if !acc.Contains([]byte("x")) {
		t.Error("should contain added element")
	}
	if acc.Contains([]byte("y")) {
		t.Error("should not contain element not added")
	}
}
