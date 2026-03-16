// Package server provides HTTP handlers for the ZeroID DID resolution
// and credential verification API.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/aethelred/zeroid-sdk-go/did"
)

// DIDResolver defines the interface for resolving DIDs into DID Documents.
type DIDResolver interface {
	// Resolve resolves a DID URI into a DID Document.
	Resolve(didURI string) (*did.DIDDocument, error)
}

// Handler contains the HTTP handlers for the ZeroID API.
type Handler struct {
	resolver DIDResolver
}

// NewHandler creates a new Handler with the given DID resolver.
func NewHandler(resolver DIDResolver) *Handler {
	return &Handler{resolver: resolver}
}

// ResolveDID handles GET /1.0/identifiers/{did} requests.
// It resolves the given DID URI and returns the DID Document as JSON.
func (h *Handler) ResolveDID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Extract DID from path: /1.0/identifiers/{did}
	path := strings.TrimPrefix(r.URL.Path, "/1.0/identifiers/")
	if path == "" || path == r.URL.Path {
		writeError(w, http.StatusBadRequest, "missing DID in path")
		return
	}

	didURI := path

	doc, err := h.resolver.Resolve(didURI)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		if strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "not supported") {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, doc)
}

// HealthCheck handles GET /health requests, returning the service health status.
func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	resp := map[string]string{
		"status":  "ok",
		"service": "zeroid-resolver",
	}
	writeJSON(w, http.StatusOK, resp)
}

// RegisterRoutes registers all handler routes on the given ServeMux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/1.0/identifiers/", h.ResolveDID)
	mux.HandleFunc("/health", h.HealthCheck)
}

// ErrorResponse represents an API error response.
type ErrorResponse struct {
	// Error is the error message.
	Error string `json:"error"`
	// Code is the HTTP status code.
	Code int `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{Error: message, Code: status})
}
