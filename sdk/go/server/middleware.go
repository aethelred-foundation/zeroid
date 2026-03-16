package server

import (
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// RateLimiter provides per-IP rate limiting for HTTP handlers.
type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	limit    int
	window   time.Duration
	now      func() time.Time
}

type visitor struct {
	count    int
	windowStart time.Time
}

// NewRateLimiter creates a new rate limiter that allows the specified number
// of requests per window duration per IP address.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		visitors: make(map[string]*visitor),
		limit:    limit,
		window:   window,
		now:      time.Now,
	}
}

// SetTimeFunc overrides the time function for testing.
func (rl *RateLimiter) SetTimeFunc(fn func() time.Time) {
	rl.now = fn
}

// Middleware wraps an http.Handler with rate limiting.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		if !rl.allow(ip) {
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (rl *RateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	v, ok := rl.visitors[ip]
	if !ok {
		rl.visitors[ip] = &visitor{count: 1, windowStart: now}
		return true
	}

	if now.Sub(v.windowStart) > rl.window {
		v.count = 1
		v.windowStart = now
		return true
	}

	v.count++
	return v.count <= rl.limit
}

func extractIP(r *http.Request) string {
	// Only trust forwarding headers when TRUSTED_PROXY is configured
	if os.Getenv("TRUSTED_PROXY") != "" {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.SplitN(xff, ",", 2)
			return strings.TrimSpace(parts[0])
		}
		if xri := r.Header.Get("X-Real-IP"); xri != "" {
			return xri
		}
	}
	// Use socket peer address — not spoofable
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}

// RequestLogger creates middleware that logs HTTP requests.
type RequestLogger struct {
	logger *log.Logger
}

// NewRequestLogger creates a new request logging middleware.
func NewRequestLogger(logger *log.Logger) *RequestLogger {
	return &RequestLogger{logger: logger}
}

// Middleware wraps an http.Handler with request logging.
func (rl *RequestLogger) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		rl.logger.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

// AuthTokenValidator creates middleware that validates bearer tokens.
type AuthTokenValidator struct {
	validTokens map[string]bool
}

// NewAuthTokenValidator creates a new token validation middleware with
// the given set of valid tokens.
func NewAuthTokenValidator(tokens []string) *AuthTokenValidator {
	m := make(map[string]bool)
	for _, t := range tokens {
		m[t] = true
	}
	return &AuthTokenValidator{validTokens: m}
}

// Middleware wraps an http.Handler with bearer token authentication.
func (atv *AuthTokenValidator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeError(w, http.StatusUnauthorized, "missing authorization header")
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "invalid authorization format")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if !atv.validTokens[token] {
			writeError(w, http.StatusForbidden, "invalid token")
			return
		}

		next.ServeHTTP(w, r)
	})
}
