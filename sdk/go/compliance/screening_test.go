package compliance

import (
	"testing"
	"time"
)

func TestRiskLevelString(t *testing.T) {
	tests := []struct {
		level RiskLevel
		want  string
	}{
		{RiskNone, "None"},
		{RiskLow, "Low"},
		{RiskMedium, "Medium"},
		{RiskHigh, "High"},
		{RiskProhibited, "Prohibited"},
		{RiskLevel(99), "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.level.String(); got != tt.want {
				t.Errorf("RiskLevel(%d).String() = %q, want %q", int(tt.level), got, tt.want)
			}
		})
	}
}

func TestNewScreener(t *testing.T) {
	s := NewScreener()
	if s == nil {
		t.Fatal("NewScreener() returned nil")
	}
	if len(s.entries) == 0 {
		t.Error("default screener should have entries")
	}
}

func TestNewScreenerWithEntries(t *testing.T) {
	entries := []SanctionEntry{
		{Name: "Test Entry", ListName: "TEST-LIST"},
	}
	s := NewScreenerWithEntries(entries)
	if s == nil {
		t.Fatal("NewScreenerWithEntries() returned nil")
	}
	if len(s.entries) != 1 {
		t.Errorf("entries length = %d, want 1", len(s.entries))
	}
}

func TestScreenerScreen(t *testing.T) {
	now := time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		entity    *Entity
		wantClear bool
		wantRisk  RiskLevel
		wantMatch int
	}{
		{
			name: "clean entity",
			entity: &Entity{
				Name:    "Legitimate Company",
				Country: "US",
			},
			wantClear: true,
			wantRisk:  RiskNone,
			wantMatch: 0,
		},
		{
			name: "sanctioned by primary name",
			entity: &Entity{
				Name:    "Sanctioned Corp Alpha",
				Country: "XX",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name: "sanctioned by alias",
			entity: &Entity{
				Name:    "SCA",
				Country: "XX",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name: "case insensitive match",
			entity: &Entity{
				Name:    "sanctioned corp alpha",
				Country: "XX",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name: "entity alias matches entry name",
			entity: &Entity{
				Name:    "Some Company",
				Aliases: []string{"Bad Actor Beta"},
				Country: "US",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name: "entity alias matches entry alias",
			entity: &Entity{
				Name:    "Some Company",
				Aliases: []string{"REG"},
				Country: "US",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name: "entity name matches entry alias case insensitive",
			entity: &Entity{
				Name:    "alpha corp sanctioned",
				Country: "US",
			},
			wantClear: false,
			wantRisk:  RiskProhibited,
			wantMatch: 1,
		},
		{
			name:      "nil entity",
			entity:    nil,
			wantClear: true,
			wantRisk:  RiskNone,
			wantMatch: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewScreener()
			s.SetTimeFunc(func() time.Time { return now })

			result := s.Screen(tt.entity)
			if result.Clear != tt.wantClear {
				t.Errorf("Clear = %v, want %v", result.Clear, tt.wantClear)
			}
			if result.Risk != tt.wantRisk {
				t.Errorf("Risk = %v, want %v", result.Risk, tt.wantRisk)
			}
			if len(result.Matches) != tt.wantMatch {
				t.Errorf("Matches = %d, want %d: %v", len(result.Matches), tt.wantMatch, result.Matches)
			}
			if !result.ScreenedAt.Equal(now) {
				t.Error("ScreenedAt should match fixed time")
			}
			if len(result.ListsChecked) == 0 {
				t.Error("ListsChecked should not be empty")
			}
		})
	}
}

func TestScreenerSetTimeFunc(t *testing.T) {
	s := NewScreener()
	fixed := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	s.SetTimeFunc(func() time.Time { return fixed })
	result := s.Screen(&Entity{Name: "test"})
	if !result.ScreenedAt.Equal(fixed) {
		t.Error("SetTimeFunc not applied")
	}
}

func TestScreenerEmptyEntries(t *testing.T) {
	s := NewScreenerWithEntries([]SanctionEntry{})
	result := s.Screen(&Entity{Name: "anyone"})
	if !result.Clear {
		t.Error("empty entries should always be clear")
	}
	if len(result.ListsChecked) != 0 {
		t.Errorf("ListsChecked should be empty, got %v", result.ListsChecked)
	}
}

func TestScreenerMultipleMatches(t *testing.T) {
	entries := []SanctionEntry{
		{Name: "Bad Guy", ListName: "LIST-A"},
		{Name: "Bad Guy", ListName: "LIST-B"},
	}
	s := NewScreenerWithEntries(entries)
	result := s.Screen(&Entity{Name: "Bad Guy"})
	if result.Clear {
		t.Error("should not be clear")
	}
	if len(result.Matches) != 2 {
		t.Errorf("Matches = %d, want 2", len(result.Matches))
	}
}

func TestDefaultSanctionsList(t *testing.T) {
	list := defaultSanctionsList()
	if len(list) != 3 {
		t.Errorf("default list length = %d, want 3", len(list))
	}
	for _, entry := range list {
		if entry.Name == "" {
			t.Error("entry name should not be empty")
		}
		if entry.ListName == "" {
			t.Error("entry list name should not be empty")
		}
	}
}

func TestEntityFields(t *testing.T) {
	e := Entity{
		Name:    "Test Corp",
		Aliases: []string{"TC", "Test Corporation"},
		Country: "US",
		Identifiers: map[string]string{
			"tax_id": "12-3456789",
		},
	}

	if e.Name != "Test Corp" {
		t.Errorf("Name = %q", e.Name)
	}
	if len(e.Aliases) != 2 {
		t.Errorf("Aliases length = %d", len(e.Aliases))
	}
	if e.Country != "US" {
		t.Errorf("Country = %q", e.Country)
	}
	if e.Identifiers["tax_id"] != "12-3456789" {
		t.Errorf("Identifiers[tax_id] = %q", e.Identifiers["tax_id"])
	}
}
