# PB-03 Credential Stuffing Response
classification: credential_stuffing
keywords: credential stuffing, failed login, authentication failure, login attempts, password spray, distributed IPs, successful login, impossible travel, bot score, rate limit, account takeover, MFA challenge, user agent

## §2.1 Preserve authentication evidence
Export authentication events for the affected application and alert time window into the restricted evidence store. Include account identifiers, source IP addresses, timestamps, user agents, authentication outcomes, and MFA results without collecting passwords or session tokens.

## §2.2 Confirm the attack pattern
Compare failed and successful login counts across accounts, source networks, and user agents against the application's normal authentication baseline. Distinguish distributed credential reuse from password spraying and legitimate retry bursts, and escalate ambiguous patterns to L2.

## §2.3 Identify compromised accounts
Correlate successful logins from the attack sources with account changes, unfamiliar sessions, and sensitive application activity. Record the accounts with evidence of takeover separately from accounts that received only failed attempts.

## §3.1 Lock confirmed compromised accounts (approval)
Obtain analyst approval before temporarily locking accounts with confirmed unauthorized access in the identity provider. Record the evidence, affected account identifiers, lock duration, and recovery owner to limit unnecessary user disruption.

## §3.2 Apply targeted login restrictions (approval)
Obtain analyst and application-owner approval before applying temporary rate limits or challenge rules to the confirmed abusive login traffic. Scope the rules to the affected login route and validated attack characteristics, then monitor legitimate login failures and roll back rules that exceed the agreed impact threshold.

## §4.1 Coordinate account recovery
Open recovery tasks with the identity team for each confirmed compromised account using an independently verified user contact channel. Require identity verification, credential replacement, session revocation, and MFA review through the approved recovery process before requesting account reactivation.

## §5.1 Verify containment and record impact
Review authentication and application audit logs for renewed attack activity and unauthorized account changes after the approved controls take effect. Document the affected accounts, observed success rate, control expiration times, and unresolved risks for L2 review.
