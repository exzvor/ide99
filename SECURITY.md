# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** through GitHub Security Advisories:

https://github.com/exzvor/ide99/security/advisories/new

Do not file public issues for security problems. A maintainer will respond and coordinate a fix and disclosure.

When reporting, please include:
- A description of the vulnerability and its impact
- Steps to reproduce
- The version of ide99 and OS affected
- Any proof-of-concept code (privately attached)

## Supported versions

Security fixes are applied to the latest released minor version on the `main` branch. Older versions are not patched.

## Scope

In scope:
- The desktop client (this repository)
- The MCP server exposed by the IDE

Out of scope:
- PostgreSQL itself — report upstream at https://www.postgresql.org/support/security/
- External AI agents that connect via MCP (Claude Code, Cursor, etc.) — report to those vendors
