// Set required environment variables BEFORE any module loads
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.REDIS_URL = 'redis://localhost:6379';
// Use a random high port so test bootstrap() doesn't collide with a running server
process.env.PORT = String(40000 + Math.floor(Math.random() * 20000));
