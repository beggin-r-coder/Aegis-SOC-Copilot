# PB-02 Ransomware Response
classification: ransomware
keywords: ransomware, encryption, vssadmin, shadow copy, ransom note, encrypted files, mass file rename, backup deletion, bcdedit, wbadmin, suspicious PowerShell, lateral movement, EDR detection

## §3.1 Isolate the affected endpoint (approval)
Obtain analyst approval before network-isolating the affected endpoint through the EDR console to contain ransomware activity. Keep the EDR management channel available and record the host identifier, isolation time, and approval in the incident.

## §3.2 Disable the compromised account (approval)
Obtain analyst approval before disabling the compromised account in the authoritative identity provider to prevent further unauthorized access. Coordinate session revocation with the identity team and record the account identifier, approval, and completion time.

## §3.3 Preserve evidence
Capture available EDR process trees, authentication logs, ransom notes, affected file samples, and volatile evidence through approved forensic tooling. Store evidence with timestamps and hashes in restricted storage without executing suspicious files or powering off the endpoint solely for collection.

## §3.4 Block attacker infrastructure at the perimeter firewall
Block confirmed attacker command-and-control IP addresses and domains at the perimeter firewall using narrowly scoped indicators validated by L2. Check for shared legitimate infrastructure before applying the rule and record its scope, owner, expiration, and rollback procedure.

## §4.1 Close the initial access vector (patch the CVE)
Apply the vendor remediation for the confirmed initial-access CVE to an isolated recovery instance of the affected product. Validate the installed version and exploitation path, and obtain the service owner's change approval before deploying any remediation that interrupts production.

## §4.2 Hunt for spread
Search EDR, identity, and network logs across the environment for the confirmed ransomware hashes, command lines, remote logons, and attacker destinations. Escalate newly affected hosts and accounts to L2 for separately approved containment.

## §5.1 Restore from clean backups
Restore affected data from a verified pre-compromise backup into an isolated recovery environment after removing the confirmed persistence mechanisms. Scan the restored systems, test application integrity, and obtain service-owner authorization before reconnecting them to production.

## §5.2 Never contact the attacker or pay a ransom
Route all ransom demands to the incident commander and legal team without contacting the attacker or paying a ransom. Preserve the demands as evidence and use internal approved communication channels for response coordination.

## §6.1 Notify the Data Protection Officer within 6 hours if personal data is affected
Notify the Data Protection Officer within 6 hours of identifying that personal data is affected by the ransomware incident. Treat this interval as an internal escalation target and provide the known data categories, affected systems, exposure evidence, and incident timeline for assessment of applicable reporting duties.
