---
"aywson": patch
---

Support string and array paths in all API operations

All path-based operations now accept both string (dot/bracket notation) and array formats for paths. The implementation normalizes paths internally, and the documentation and tests have been updated to reflect and verify this enhanced flexibility.
