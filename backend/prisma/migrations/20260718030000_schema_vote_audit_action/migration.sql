-- Record non-terminal schema votes distinctly from terminal approval/rejection.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SCHEMA_VOTE_CAST';
