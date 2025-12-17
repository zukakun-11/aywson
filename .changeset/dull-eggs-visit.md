---
"aywson": patch
---

Add security options for path, file size, and JSON limits

Introduces path validation to prevent path traversal attacks, file size limits (default 50MB) with override flags, and JSON parsing limits (size and depth) configurable via environment variables. Updates CLI help, argument parsing, and documentation to reflect new security features and best practices.
