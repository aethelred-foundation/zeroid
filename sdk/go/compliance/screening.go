package compliance

import (
	"strings"
	"time"
)

// RiskLevel represents the risk level from sanctions screening.
type RiskLevel int

const (
	// RiskNone indicates no risk was detected.
	RiskNone RiskLevel = iota
	// RiskLow indicates low risk.
	RiskLow
	// RiskMedium indicates medium risk.
	RiskMedium
	// RiskHigh indicates high risk.
	RiskHigh
	// RiskProhibited indicates the entity is prohibited.
	RiskProhibited
)

// String returns the human-readable name for a RiskLevel.
func (r RiskLevel) String() string {
	switch r {
	case RiskNone:
		return "None"
	case RiskLow:
		return "Low"
	case RiskMedium:
		return "Medium"
	case RiskHigh:
		return "High"
	case RiskProhibited:
		return "Prohibited"
	default:
		return "Unknown"
	}
}

// Entity represents an entity to be screened against sanctions lists.
type Entity struct {
	// Name is the entity's full name.
	Name string
	// Aliases contains alternative names for the entity.
	Aliases []string
	// Country is the entity's country code.
	Country string
	// Identifiers contains additional identifiers (e.g., passport numbers).
	Identifiers map[string]string
}

// ScreeningResult contains the result of a sanctions screening.
type ScreeningResult struct {
	// Clear indicates whether the entity is clear of all sanctions.
	Clear bool
	// Risk is the assessed risk level.
	Risk RiskLevel
	// Matches contains the names of any matching sanctions entries.
	Matches []string
	// ScreenedAt is when the screening was performed.
	ScreenedAt time.Time
	// ListsChecked contains the names of the sanctions lists checked.
	ListsChecked []string
}

// SanctionEntry represents an entry on a sanctions list.
type SanctionEntry struct {
	// Name is the sanctioned entity's name.
	Name string
	// Aliases contains alternative names.
	Aliases []string
	// Country is the entity's country code.
	Country string
	// ListName is the name of the sanctions list.
	ListName string
}

// Screener performs sanctions screening against configurable lists.
type Screener struct {
	entries []SanctionEntry
	now     func() time.Time
}

// NewScreener creates a new Screener with a default mock sanctions list.
func NewScreener() *Screener {
	return &Screener{
		entries: defaultSanctionsList(),
		now:     time.Now,
	}
}

// NewScreenerWithEntries creates a new Screener with the given sanctions entries.
func NewScreenerWithEntries(entries []SanctionEntry) *Screener {
	return &Screener{
		entries: entries,
		now:     time.Now,
	}
}

// SetTimeFunc overrides the time function used for screening timestamps.
func (s *Screener) SetTimeFunc(fn func() time.Time) {
	s.now = fn
}

// Screen performs sanctions screening for the given entity against all
// configured sanctions lists.
func (s *Screener) Screen(entity *Entity) *ScreeningResult {
	result := &ScreeningResult{
		Clear:        true,
		Risk:         RiskNone,
		ScreenedAt:   s.now(),
		ListsChecked: s.listNames(),
	}

	if entity == nil {
		return result
	}

	for _, entry := range s.entries {
		if s.matches(entity, &entry) {
			result.Clear = false
			result.Risk = RiskProhibited
			result.Matches = append(result.Matches, entry.Name+" ("+entry.ListName+")")
		}
	}

	return result
}

func (s *Screener) matches(entity *Entity, entry *SanctionEntry) bool {
	entityName := strings.ToLower(entity.Name)
	entryName := strings.ToLower(entry.Name)

	// Check primary name
	if entityName == entryName {
		return true
	}

	// Check entity aliases against entry name
	for _, alias := range entity.Aliases {
		if strings.ToLower(alias) == entryName {
			return true
		}
	}

	// Check entry aliases against entity name
	for _, alias := range entry.Aliases {
		if strings.ToLower(alias) == entityName {
			return true
		}
	}

	// Check entity aliases against entry aliases
	for _, eAlias := range entity.Aliases {
		for _, sAlias := range entry.Aliases {
			if strings.ToLower(eAlias) == strings.ToLower(sAlias) {
				return true
			}
		}
	}

	return false
}

func (s *Screener) listNames() []string {
	seen := make(map[string]bool)
	var names []string
	for _, e := range s.entries {
		if !seen[e.ListName] {
			seen[e.ListName] = true
			names = append(names, e.ListName)
		}
	}
	return names
}

func defaultSanctionsList() []SanctionEntry {
	return []SanctionEntry{
		{
			Name:     "Sanctioned Corp Alpha",
			Aliases:  []string{"SCA", "Alpha Corp Sanctioned"},
			Country:  "XX",
			ListName: "OFAC-SDN",
		},
		{
			Name:     "Bad Actor Beta",
			Aliases:  []string{"BAB", "Beta Bad"},
			Country:  "YY",
			ListName: "OFAC-SDN",
		},
		{
			Name:     "Restricted Entity Gamma",
			Aliases:  []string{"REG"},
			Country:  "ZZ",
			ListName: "EU-SANCTIONS",
		},
	}
}
