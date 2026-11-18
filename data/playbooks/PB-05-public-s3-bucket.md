# PB-05 Public S3 Bucket Response
classification: public_s3_bucket
keywords: public bucket, S3 bucket, AllUsers, AuthenticatedUsers, bucket policy, public-read, PutBucketPolicy, PutBucketAcl, Block Public Access, Access Analyzer, anonymous access, GetObject, sensitive data

## §2.1 Verify the bucket exposure
Inspect the flagged bucket's policy, access control list, access point policies, and account-level and bucket-level S3 Block Public Access settings using read-only AWS APIs. Confirm the bucket owner and intended access pattern with the resource owner before concluding that public access is unauthorized.

## §2.2 Preserve configuration evidence
Export the current bucket policy, access control list, public access settings, and relevant CloudTrail configuration-change events to restricted evidence storage. Record the account, region, bucket identifier, collection time, and actor responsible for the exposure where available.

## §2.3 Assess affected data and access
Review the bucket inventory, data classification records, and available S3 access logs or CloudTrail data events to identify exposed object prefixes and observed reads. Record logging gaps and the earliest supported exposure time without interpreting missing access events as proof that no data was accessed.

## §3.1 Block public bucket access (approval)
Obtain analyst and resource-owner approval before enabling all four S3 Block Public Access settings on the affected bucket. Record the expected effect on public consumers and verify that required authenticated application access still works after the change.

## §3.2 Remove unintended public grants (approval)
Obtain analyst and resource-owner approval before removing unintended public principals from the bucket policy and public grants from applicable access control lists. Preserve the previous configuration for controlled rollback and validate the exact policy changes before applying them.

## §4.1 Investigate the configuration change
Trace the policy or access-control change through CloudTrail to its initiating identity, source address, and deployment pipeline. Preserve related events and escalate evidence of credential compromise to L2 for separately approved identity containment.

## §5.1 Verify exposure closure and escalate data impact
Recheck the bucket's effective public access status and Access Analyzer findings after the approved changes have propagated. Record remaining exposure paths and notify the incident commander and Data Protection Officer if personal data was affected so they can assess reporting obligations.
