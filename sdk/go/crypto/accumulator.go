package crypto

import (
	"errors"
)

// ErrNilWitness is returned when a nil witness is provided to accumulator operations.
var ErrNilWitness = errors.New("accumulator: nil witness")

// ErrElementNotFound is returned when an element is not found in the accumulator.
var ErrElementNotFound = errors.New("accumulator: element not found")

// ErrElementExists is returned when trying to add an element that already exists.
var ErrElementExists = errors.New("accumulator: element already exists")

// Accumulator represents a cryptographic accumulator that allows
// membership proofs without revealing the full set of elements.
type Accumulator struct {
	// Value is the current accumulator value (hash-based).
	Value [32]byte
	// elements tracks the set members for this stub implementation.
	elements map[[32]byte]bool
}

// Witness represents a membership witness for an element in the accumulator.
type Witness struct {
	// Element is the hash of the element this witness is for.
	Element [32]byte
	// Data is the witness data used for verification.
	Data [32]byte
}

// NewAccumulator creates a new empty cryptographic accumulator.
func NewAccumulator() *Accumulator {
	seed := Keccak256([]byte("zeroid-accumulator-genesis"))
	return &Accumulator{
		Value:    seed,
		elements: make(map[[32]byte]bool),
	}
}

// Add adds an element to the accumulator and returns a membership witness.
// Returns ErrElementExists if the element is already in the accumulator.
func (a *Accumulator) Add(element []byte) (*Witness, error) {
	elemHash := Keccak256(element)
	if a.elements[elemHash] {
		return nil, ErrElementExists
	}
	a.elements[elemHash] = true

	// Update accumulator value: H(old_value || element_hash)
	combined := make([]byte, 64)
	copy(combined[:32], a.Value[:])
	copy(combined[32:], elemHash[:])
	a.Value = Keccak256(combined)

	// Generate witness: H(accumulator_value || element_hash)
	witData := make([]byte, 64)
	copy(witData[:32], a.Value[:])
	copy(witData[32:], elemHash[:])

	return &Witness{
		Element: elemHash,
		Data:    Keccak256(witData),
	}, nil
}

// Remove removes an element from the accumulator.
// Returns ErrElementNotFound if the element is not in the accumulator.
func (a *Accumulator) Remove(element []byte) error {
	elemHash := Keccak256(element)
	if !a.elements[elemHash] {
		return ErrElementNotFound
	}
	delete(a.elements, elemHash)

	// Recompute accumulator value from scratch.
	a.Value = Keccak256([]byte("zeroid-accumulator-genesis"))
	for eh := range a.elements {
		combined := make([]byte, 64)
		copy(combined[:32], a.Value[:])
		ehCopy := eh
		copy(combined[32:], ehCopy[:])
		a.Value = Keccak256(combined)
	}
	return nil
}

// Verify checks whether the given element, witness, and accumulator value
// form a valid membership proof. Returns true if the element is a member.
func Verify(element []byte, witness *Witness, accumValue [32]byte) bool {
	if witness == nil {
		return false
	}
	elemHash := Keccak256(element)
	if elemHash != witness.Element {
		return false
	}
	// Recompute expected witness data.
	witData := make([]byte, 64)
	copy(witData[:32], accumValue[:])
	copy(witData[32:], elemHash[:])
	expected := Keccak256(witData)
	return witness.Data == expected
}

// Contains checks whether the accumulator contains the given element.
func (a *Accumulator) Contains(element []byte) bool {
	elemHash := Keccak256(element)
	return a.elements[elemHash]
}
