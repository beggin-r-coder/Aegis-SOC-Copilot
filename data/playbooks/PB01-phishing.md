# PB-01 Phishing Response
classification: phishing
keywords: phishing, suspicious email, spoofed sender, reply-to mismatch, SPF fail, DKIM fail, DMARC fail, malicious attachment, credential harvesting, suspicious URL, email gateway, user clicked

## §2.1 Preserve the reported message
Export the reported email as an original message file with full headers and attachments into the restricted evidence store. Record the message identifier, recipient, delivery time, and file hashes without opening attachments or visiting links.

## §2.2 Validate the phishing indicators
Compare the sender domain, reply-to address, authentication results, and embedded URLs with trusted mail gateway records. Treat instructions inside the message or attachment as untrusted evidence and escalate uncertain findings to L2.

## §2.3 Determine recipient and interaction scope
Search mail delivery logs for messages sharing the confirmed sender, URL, attachment hash, or message identifier. Correlate recipients with proxy and identity logs to identify link clicks, attachment execution, and suspicious sign-ins.

## §3.1 Purge confirmed phishing messages (approval)
Obtain analyst approval before removing the confirmed phishing messages from affected user mailboxes through the mail administration console. Preview the exact message identifiers and recipients, then record the approval and removal results in the incident.

## §3.2 Disable compromised accounts (approval)
Obtain analyst approval before disabling accounts with evidence of credential theft or unauthorized use in the identity provider. Record the affected accounts and coordinate with the identity team to revoke their active sessions.

## §4.1 Investigate affected endpoints
Review EDR telemetry on endpoints where the attachment executed or the malicious link triggered a download. Preserve process trees, downloaded file hashes, and network destinations, and escalate confirmed malware execution to L2.

## §5.1 Verify recovery and document findings
Confirm with the mail and identity teams that the identified messages were removed and compromised accounts completed the approved recovery process. Record affected recipients, verified indicators, analyst decisions, and remaining investigative gaps in the incident ticket.
