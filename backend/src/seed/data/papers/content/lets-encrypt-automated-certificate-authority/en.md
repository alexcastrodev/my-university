---
title: "Let's Encrypt: An Automated Certificate Authority to Encrypt the Entire Web"
summary: The builders of Let's Encrypt describe how a free, fully automated certificate authority, its ACME protocol and its software were designed, what went wrong along the way, and how it changed HTTPS adoption on the Web.
researchArea: Security and Privacy
keywords: https, certificate authority, web pki, acme protocol, domain validation, certificate transparency
version: 1.0
updatedAt: 2026-11-01
---

## Overview

HTTPS protects Web traffic from eavesdropping and tampering, but it needs a certificate from a certificate authority (CA) that browsers trust, and getting one used to be hard. A server operator had to generate keys with arcane tools, prove control of the domain by hand and pay. The authors say that as recently as 2015, between 55% and 70% of browser page loads used plain HTTP. The average price of a one-year certificate from the five largest CAs in 2015 was $178 for a single domain and $766 for a wildcard.

This paper, from the team that built Let's Encrypt (Josh Aas and eleven co-authors, ACM CCS 2019), is an experience report. It describes how a nonprofit built a CA that is free and automated from the first request to renewal, how its protocol and software work, what it measured about its effect on the Web, and the security lessons it drew.

Worth knowing first: public-key certificates and what a CA vouches for, what TLS and HTTPS add to HTTP, and the difference between domain validation and organization validation.

## Contribution

- **A fully automated, free CA.** Domain validation and issuance are done by software, with no manual override, which lowers the cost per certificate to the point of providing it at no charge.
- **ACME,** the protocol, later standardized by the IETF, by which a client asks for a certificate, proves control of a domain, and renews or revokes. Many independent clients exist, including Certbot, which the team created.
- **Boulder,** the CA software, split into components that run independently (the API, the registration authority, the validation authority, the certificate authority, OCSP) so that a compromise of an exposed component does not reach the signing keys.
- **A measurement of the impact** on HTTPS adoption and on the CA market, and a discussion of lessons from running the service.

## Methodology

The paper is a systems and operations case study, supported by measurements. For the design, it describes the organization (ISRG), the architecture and the protocol, including the validation challenges and the controls that limit risk (separation of components, restricted access to data centers, redundant instances, checking certificates through Certificate Transparency logs).

For impact, the authors use several sources: longitudinal Censys scans of HTTPS, Certificate Transparency logs, Firefox telemetry from the Beta channel, and their own scans of the names found in the logs. Most numbers are from January 2019, with some telemetry up to September 2019.

## Findings

These are the authors' reported results.

- By January 21, 2019, Let's Encrypt had issued 538 million certificates for 223 million unique domain names, and had 91 million unexpired certificates valid for 155 million names, more than all other browser-trusted CAs combined.
- At peak it issues more than a million certificates a day on modest infrastructure. The biggest scaling challenge has been the CA database and log data, about 150 GB a day as of September 2019, not computing power.
- Among the top million sites that use HTTPS, its share grew from about 2% in July 2016 to over 25% in January 2019. It is used by 5% of the top 1,000 sites, 20% of the top 100,000 and 35% of the top million. In Firefox Beta telemetry it went from 0.44% of full TLS handshakes in March 2017 to 3.7% in September 2019, a much smaller share than its share of sites, because the most popular sites use other CAs, often for organization or extended validation certificates that Let's Encrypt does not issue.
- The authors argue that the growth supports their view that usability, more than security of the PKI, was the main barrier to HTTPS, and that free certificates and automation depend on each other.
- Problems found along the way include a flaw reported in early 2018 in the TLS-SNI validation challenge, which did not authenticate domain control in many shared-hosting environments. Let's Encrypt immediately disabled that challenge, re-enabled it only for a small set of providers that were not vulnerable, and eventually phased it out in favor of a TLS-ALPN challenge. Separately, the HTTP challenge was changed to prohibit HTTPS requests, because of a similar shared-hosting weakness. Multi-perspective validation, checking from several networks, was added against some network attacks.
- In the 90 days before September 22, 2019, the CA completed 266 million successful challenges: 86% used HTTP, 13% DNS and 0.3% TLS-ALPN.

## Critical Analysis

This is a rare, detailed account of how a widely used security service was built, and it is open about mistakes. As evidence, it has limits.

- **The authors built the system.** The paper is both a design report and an evaluation of that design, written by its creators, so the claims about success and about causes (that free and automated explains the growth) are interpretation, not controlled comparison. Other factors, such as browser warnings about HTTP, also pushed adoption.
- **The adoption data are indirect.** They rely on scans, CT logs and one browser's telemetry from its Beta channel, each with its own biases.
- **Domain validation is weak by nature.** The paper says that validation itself is not cryptographically protected, so "none of these measures can protect against the full spectrum of validation attacks", and it offers no easy solution.
- **More HTTPS does not mean safer sites.** The authors note that Let's Encrypt is used on phishing and malware sites, and argue that CAs are poorly placed to detect them. In our reading, this is a real tension: encryption and identity of the domain are not the same as trust in the site's owner.
- **The paper is a 2019 snapshot** of a service that has kept changing.

## Further Research

- Stronger domain validation, for example with checks from more vantage points or ways to bind a domain to a key without relying on unprotected channels.
- Studying how much of HTTPS growth is due to automation, price or browser policy, with designs that can separate the causes.
- Applying the same automation to other parts of the Web PKI and to other Internet security infrastructure, as the authors hope.
- Measuring the effect on phishing and what, if anything, CAs can reasonably do about it.
