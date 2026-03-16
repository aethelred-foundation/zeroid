package server

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
})

func TestNewRateLimiter(t *testing.T) {
	rl := NewRateLimiter(10, time.Minute)
	if rl == nil {
		t.Fatal("NewRateLimiter() returned nil")
	}
	if rl.limit != 10 {
		t.Errorf("limit = %d, want 10", rl.limit)
	}
}

func TestRateLimiterMiddleware(t *testing.T) {
	now := time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		limit      int
		requests   int
		wantStatus int
	}{
		{
			name:       "within limit",
			limit:      5,
			requests:   3,
			wantStatus: http.StatusOK,
		},
		{
			name:       "at limit",
			limit:      5,
			requests:   5,
			wantStatus: http.StatusOK,
		},
		{
			name:       "exceeds limit",
			limit:      3,
			requests:   4,
			wantStatus: http.StatusTooManyRequests,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rl := NewRateLimiter(tt.limit, time.Minute)
			rl.SetTimeFunc(func() time.Time { return now })
			handler := rl.Middleware(okHandler)

			var lastStatus int
			for i := 0; i < tt.requests; i++ {
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				req.RemoteAddr = "192.168.1.1:1234"
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)
				lastStatus = rec.Code
			}

			if lastStatus != tt.wantStatus {
				t.Errorf("last status = %d, want %d", lastStatus, tt.wantStatus)
			}
		})
	}
}

func TestRateLimiterWindowReset(t *testing.T) {
	now := time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)
	currentTime := now

	rl := NewRateLimiter(2, time.Minute)
	rl.SetTimeFunc(func() time.Time { return currentTime })
	handler := rl.Middleware(okHandler)

	// Use up the limit
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "10.0.0.1:5000"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	// Next request should be rejected
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rec.Code)
	}

	// Advance time past window
	currentTime = now.Add(2 * time.Minute)

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 after window reset, got %d", rec.Code)
	}
}

func TestRateLimiterDifferentIPs(t *testing.T) {
	rl := NewRateLimiter(1, time.Minute)
	handler := rl.Middleware(okHandler)

	// First IP
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.RemoteAddr = "1.2.3.4:1000"
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Errorf("first IP: status = %d", rec1.Code)
	}

	// Second IP should also work
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "5.6.7.8:1000"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Errorf("second IP: status = %d", rec2.Code)
	}
}

func TestExtractIP(t *testing.T) {
	tests := []struct {
		name         string
		headers      map[string]string
		remoteAddr   string
		trustedProxy string
		want         string
	}{
		{
			name:       "remote addr with port",
			remoteAddr: "192.168.1.1:1234",
			want:       "192.168.1.1",
		},
		{
			name:       "remote addr without port",
			remoteAddr: "192.168.1.1",
			want:       "192.168.1.1",
		},
		{
			name:         "X-Forwarded-For trusted proxy",
			headers:      map[string]string{"X-Forwarded-For": "10.0.0.1"},
			remoteAddr:   "192.168.1.1:1234",
			trustedProxy: "true",
			want:         "10.0.0.1",
		},
		{
			name:         "X-Forwarded-For multiple trusted proxy",
			headers:      map[string]string{"X-Forwarded-For": "10.0.0.1, 10.0.0.2"},
			remoteAddr:   "192.168.1.1:1234",
			trustedProxy: "true",
			want:         "10.0.0.1",
		},
		{
			name:         "X-Real-IP trusted proxy",
			headers:      map[string]string{"X-Real-IP": "10.0.0.5"},
			remoteAddr:   "192.168.1.1:1234",
			trustedProxy: "true",
			want:         "10.0.0.5",
		},
		{
			name:         "X-Forwarded-For takes precedence over X-Real-IP",
			headers:      map[string]string{"X-Forwarded-For": "10.0.0.1", "X-Real-IP": "10.0.0.5"},
			remoteAddr:   "192.168.1.1:1234",
			trustedProxy: "true",
			want:         "10.0.0.1",
		},
		{
			name:       "X-Forwarded-For ignored without trusted proxy",
			headers:    map[string]string{"X-Forwarded-For": "10.0.0.1"},
			remoteAddr: "192.168.1.1:1234",
			want:       "192.168.1.1",
		},
		{
			name:       "X-Real-IP ignored without trusted proxy",
			headers:    map[string]string{"X-Real-IP": "10.0.0.5"},
			remoteAddr: "192.168.1.1:1234",
			want:       "192.168.1.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.trustedProxy != "" {
				t.Setenv("TRUSTED_PROXY", tt.trustedProxy)
			}
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remoteAddr
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			got := extractIP(req)
			if got != tt.want {
				t.Errorf("extractIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRequestLoggerMiddleware(t *testing.T) {
	var buf bytes.Buffer
	logger := log.New(&buf, "", 0)
	rl := NewRequestLogger(logger)

	handler := rl.Middleware(okHandler)

	req := httptest.NewRequest(http.MethodGet, "/test-path", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	logOutput := buf.String()
	if logOutput == "" {
		t.Error("expected log output")
	}
	if !bytes.Contains(buf.Bytes(), []byte("GET")) {
		t.Error("log should contain method")
	}
	if !bytes.Contains(buf.Bytes(), []byte("/test-path")) {
		t.Error("log should contain path")
	}
	if !bytes.Contains(buf.Bytes(), []byte("200")) {
		t.Error("log should contain status code")
	}
}

func TestRequestLoggerWithStatusCode(t *testing.T) {
	var buf bytes.Buffer
	logger := log.New(&buf, "", 0)
	rl := NewRequestLogger(logger)

	errorHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	handler := rl.Middleware(errorHandler)
	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !bytes.Contains(buf.Bytes(), []byte("404")) {
		t.Error("log should contain 404 status code")
	}
}

func TestNewRequestLogger(t *testing.T) {
	logger := log.New(&bytes.Buffer{}, "", 0)
	rl := NewRequestLogger(logger)
	if rl == nil {
		t.Fatal("NewRequestLogger() returned nil")
	}
}

func TestNewAuthTokenValidator(t *testing.T) {
	atv := NewAuthTokenValidator([]string{"token1", "token2"})
	if atv == nil {
		t.Fatal("NewAuthTokenValidator() returned nil")
	}
	if len(atv.validTokens) != 2 {
		t.Errorf("validTokens length = %d, want 2", len(atv.validTokens))
	}
}

func TestAuthTokenValidatorMiddleware(t *testing.T) {
	tests := []struct {
		name       string
		authHeader string
		wantStatus int
	}{
		{
			name:       "valid token",
			authHeader: "Bearer valid-token-1",
			wantStatus: http.StatusOK,
		},
		{
			name:       "second valid token",
			authHeader: "Bearer valid-token-2",
			wantStatus: http.StatusOK,
		},
		{
			name:       "invalid token",
			authHeader: "Bearer invalid-token",
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "missing auth header",
			authHeader: "",
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong auth scheme",
			authHeader: "Basic dXNlcjpwYXNz",
			wantStatus: http.StatusUnauthorized,
		},
	}

	atv := NewAuthTokenValidator([]string{"valid-token-1", "valid-token-2"})

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := atv.Middleware(okHandler)
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus != http.StatusOK {
				var errResp ErrorResponse
				if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
					t.Fatalf("decode error: %v", err)
				}
				if errResp.Error == "" {
					t.Error("error message should not be empty")
				}
			}
		})
	}
}

func TestAuthTokenValidatorEmpty(t *testing.T) {
	atv := NewAuthTokenValidator([]string{})
	handler := atv.Middleware(okHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer any-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("empty token list: status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestRateLimiterSetTimeFunc(t *testing.T) {
	rl := NewRateLimiter(10, time.Minute)
	fixed := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	rl.SetTimeFunc(func() time.Time { return fixed })
	if got := rl.now(); !got.Equal(fixed) {
		t.Error("SetTimeFunc not applied")
	}
}
