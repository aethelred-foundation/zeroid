package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aethelred/zeroid-sdk-go/did"
)

type mockResolver struct {
	docs map[string]*did.DIDDocument
	errs map[string]error
}

func (m *mockResolver) Resolve(didURI string) (*did.DIDDocument, error) {
	if err, ok := m.errs[didURI]; ok {
		return nil, err
	}
	doc, ok := m.docs[didURI]
	if !ok {
		return nil, errors.New("did: not found")
	}
	return doc, nil
}

func newMockResolver() *mockResolver {
	return &mockResolver{
		docs: make(map[string]*did.DIDDocument),
		errs: make(map[string]error),
	}
}

func TestNewHandler(t *testing.T) {
	h := NewHandler(newMockResolver())
	if h == nil {
		t.Fatal("NewHandler() returned nil")
	}
}

func TestResolveDID(t *testing.T) {
	validDID := "did:zero:0x1234567890abcdef1234567890abcdef12345678"

	tests := []struct {
		name       string
		method     string
		path       string
		setup      func(*mockResolver)
		wantStatus int
	}{
		{
			name:   "successful resolution",
			method: http.MethodGet,
			path:   "/1.0/identifiers/" + validDID,
			setup: func(m *mockResolver) {
				m.docs[validDID] = &did.DIDDocument{
					Context: []string{"https://www.w3.org/ns/did/v1"},
					ID:      validDID,
					Status:  did.StatusActive,
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "DID not found",
			method:     http.MethodGet,
			path:       "/1.0/identifiers/" + validDID,
			setup:      func(m *mockResolver) {},
			wantStatus: http.StatusNotFound,
		},
		{
			name:   "invalid DID",
			method: http.MethodGet,
			path:   "/1.0/identifiers/invalid-did",
			setup: func(m *mockResolver) {
				m.errs["invalid-did"] = errors.New("did: invalid DID format")
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:   "method not supported",
			method: http.MethodGet,
			path:   "/1.0/identifiers/did:ethr:0x1234",
			setup: func(m *mockResolver) {
				m.errs["did:ethr:0x1234"] = errors.New("did: method not supported")
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "POST not allowed",
			method:     http.MethodPost,
			path:       "/1.0/identifiers/" + validDID,
			setup:      func(m *mockResolver) {},
			wantStatus: http.StatusMethodNotAllowed,
		},
		{
			name:       "missing DID in path",
			method:     http.MethodGet,
			path:       "/1.0/identifiers/",
			setup:      func(m *mockResolver) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:   "internal server error",
			method: http.MethodGet,
			path:   "/1.0/identifiers/" + validDID,
			setup: func(m *mockResolver) {
				m.errs[validDID] = errors.New("database connection failed")
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := newMockResolver()
			tt.setup(resolver)
			handler := NewHandler(resolver)

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()

			handler.ResolveDID(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body: %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			// Verify JSON response
			contentType := rec.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
			}
		})
	}
}

func TestResolveDIDResponseBody(t *testing.T) {
	validDID := "did:zero:0x1234567890abcdef1234567890abcdef12345678"
	resolver := newMockResolver()
	resolver.docs[validDID] = &did.DIDDocument{
		Context: []string{"https://www.w3.org/ns/did/v1"},
		ID:      validDID,
		Status:  did.StatusActive,
	}
	handler := NewHandler(resolver)

	req := httptest.NewRequest(http.MethodGet, "/1.0/identifiers/"+validDID, nil)
	rec := httptest.NewRecorder()
	handler.ResolveDID(rec, req)

	var doc did.DIDDocument
	if err := json.NewDecoder(rec.Body).Decode(&doc); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if doc.ID != validDID {
		t.Errorf("doc.ID = %q, want %q", doc.ID, validDID)
	}
}

func TestHealthCheck(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		wantStatus int
	}{
		{
			name:       "GET health check",
			method:     http.MethodGet,
			wantStatus: http.StatusOK,
		},
		{
			name:       "POST not allowed",
			method:     http.MethodPost,
			wantStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := NewHandler(newMockResolver())
			req := httptest.NewRequest(tt.method, "/health", nil)
			rec := httptest.NewRecorder()

			handler.HealthCheck(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				var resp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("decode error: %v", err)
				}
				if resp["status"] != "ok" {
					t.Errorf("status = %q, want %q", resp["status"], "ok")
				}
				if resp["service"] != "zeroid-resolver" {
					t.Errorf("service = %q, want %q", resp["service"], "zeroid-resolver")
				}
			}
		})
	}
}

func TestRegisterRoutes(t *testing.T) {
	handler := NewHandler(newMockResolver())
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// Test health endpoint through mux
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("health check via mux: status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestErrorResponse(t *testing.T) {
	handler := NewHandler(newMockResolver())
	req := httptest.NewRequest(http.MethodGet, "/1.0/identifiers/", nil)
	rec := httptest.NewRecorder()
	handler.ResolveDID(rec, req)

	var errResp ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if errResp.Code != http.StatusBadRequest {
		t.Errorf("error code = %d, want %d", errResp.Code, http.StatusBadRequest)
	}
	if errResp.Error == "" {
		t.Error("error message should not be empty")
	}
}
