# PB-04 DDoS Response
classification: ddos
keywords: DDoS, SYN flood, UDP flood, HTTP flood, requests per second, packets per second, bandwidth spike, connection exhaustion, 503 errors, upstream saturation, bot traffic, amplification, WAF

## §2.1 Confirm service impact
Compare external availability checks, origin latency, error rates, and edge traffic volumes for the affected service against its normal baseline. Record the incident start time and affected endpoints, and check scheduled events or deployments that could explain a legitimate traffic surge.

## §2.2 Identify the attack vector
Inspect edge, WAF, load balancer, and network flow telemetry to classify the traffic as a volumetric, protocol, or application-layer flood. Record destination ports, request paths, packet rates, and distinguishing traffic attributes without treating every source address as malicious.

## §2.3 Preserve traffic evidence
Export representative edge logs, network flow summaries, and existing packet captures covering the attack window to restricted evidence storage. Record sampling rates and timestamps, and avoid starting captures that could overload saturated infrastructure.

## §3.1 Reroute traffic through mitigation (approval)
Obtain incident-commander and network-owner approval before rerouting the affected service through the contracted DDoS scrubbing provider. Confirm the destination configuration and rollback plan, then monitor availability and routing health during the change.

## §3.2 Apply targeted edge filtering (approval)
Obtain analyst and service-owner approval before deploying temporary WAF rules or rate limits for validated attack characteristics. Limit the rules to affected endpoints where possible and track legitimate request failures so harmful rules can be rolled back promptly.

## §4.1 Assess upstream capacity
Review transit utilization and mitigation-provider telemetry to determine whether the attack exceeds available upstream capacity. Record the affected links, measured traffic rates, provider incident references, and capacity gaps for the network response team.

## §5.1 Verify sustained recovery
Compare service availability, latency, error rates, and attack volumes with the agreed recovery thresholds over the incident commander's observation window. Record residual attack traffic and mitigation expiry times, and request a separately approved change before removing production traffic controls.
