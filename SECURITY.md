# Security policy

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** flow. If private reporting is unavailable, contact the repository owner through GitHub and request a private channel without disclosing vulnerability details. Do not open a public issue containing credentials, a LinkedIn session cookie, profile data, or an exploitable proof of concept.

Supported releases are the latest commit on `main` and the latest tagged release. Secrets must be supplied through the deployment platform's secret manager; they must never be committed, copied into an image, printed in logs, or added to an issue.

If a `LINKEDIN_LI_AT` value is exposed, revoke the LinkedIn session immediately, rotate `API_KEYS`, remove the leaked value from the deployment platform, and review access logs. If only an API key is exposed, remove it from `API_KEYS`, deploy the replacement set, notify affected clients through a private channel, and review rate-limit and access logs for misuse.
