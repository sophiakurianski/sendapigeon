# Security policy

## Supported versions

Until the first stable release, security fixes are made on the latest version
of the default branch only.

## Reporting a vulnerability

Please use **Report a vulnerability** in this repository's GitHub Security tab.
If private vulnerability reporting is not available, contact a maintainer
privately using the contact information on their GitHub profile. Do not include
exploits, credentials, CRM records or personal contact data in a public issue.

Include the affected version, impact, reproduction steps and any suggested
mitigation. You should receive an acknowledgement within seven days. Please
allow time for a fix before public disclosure.

## Deployment warning

SendAPigeon is currently a local-first application and its REST API has no
authentication or tenant isolation. The server binds to `127.0.0.1` by default.
Do not expose it directly to the public internet or an untrusted network.

A hosted deployment needs an authentication and authorization layer, TLS,
rate limiting, tenant isolation, secure secret management, backups, audit
retention and appropriate privacy controls. Treat every vault as sensitive:
it may contain personal contact details and confidential meeting notes.
