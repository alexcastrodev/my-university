---
title: "Why Johnny Can't Encrypt: A Usability Evaluation of PGP 5.0"
summary: A usability study of the PGP 5.0 email encryption program, with an expert walkthrough and a lab test with twelve people, argues that usable security needs its own standard of usability, because only a third of the participants managed to send an encrypted email.
researchArea: Human-Computer Interaction
keywords: usable security, usability evaluation, cognitive walkthrough, user study, pgp, public-key cryptography
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Security often fails because of people, not because of the cryptography. The authors quote a claim that configuration errors may cause more than 90% of computer security failures. Yet security programs tend to have clumsy or missing interfaces. Alma Whitten and J. D. Tygar ask whether this is only a lack of ordinary interface design, or whether security needs something different.

Their hypothesis is that the usual design techniques for consumer software are not enough for security. To test it, they choose a program that has a good interface by general standards, PGP 5.0, an email encryption and signing tool with a graphical interface, and study whether novices can use it to protect their email. The paper was published at the 8th USENIX Security Symposium in 1999.

Worth knowing first: what public and private keys are, what it means to sign and to encrypt a message, and what a usability study measures.

## Contribution

- **A definition of usability for security.** Security software is usable if the people who use it are reliably made aware of the security tasks they need to do, can figure out how to do them, do not make dangerous errors, and are comfortable enough with the interface to keep using it.
- **Five properties of security that make interface design hard:** the unmotivated user (security is a secondary goal), abstraction (policies are alien to many people), lack of feedback (the right configuration is what the user really wants, which software cannot know), the barn door (a secret that was exposed once cannot be taken back) and the weakest link (one mistake is enough).
- **An evaluation of PGP 5.0** with two methods that complement each other: a cognitive walkthrough, which is direct analysis by experts, and a laboratory user test.
- **Evidence that a well-designed standard interface was not enough.**

## Methodology

The cognitive walkthrough applied the usability standard to the interface step by step, and found design flaws that may contribute to security failures. It covers the program's metaphors, its terminology and actions that cannot be undone.

In the user test, twelve people who were experienced with email and could not explain the difference between public and private key cryptography took the role of the coordinator of a political campaign. Their task was to send a secret message (a candidate's itinerary) to five team members, signed and encrypted with PGP, using the Eudora email program. They had 90 minutes and the manuals. The test monitor, posing as team members, sent emails that depended on what the participant did: asking them to try encryption after a plaintext email, saying that a message could not be decrypted, and reminding them to back up keys.

## Findings

These are the authors' reported results.

- Only one third of the twelve participants (four) managed to correctly sign and encrypt an email to the team in 90 minutes.
- Three of the twelve (one quarter) accidentally emailed the secret without encryption. Two realized it immediately, and one seemed to believe that the security was supposed to be transparent to him and had already happened.
- One participant could not work out how to encrypt at all. Among the eleven who did, seven used only their own public key to encrypt, which means the public key model was widely misunderstood. Only two of those seven eventually sent a correctly encrypted email, after fairly explicit prompting.
- Ten of the twelve published their public key, and eight got the team members' keys, all of them from the key server. Of those eight, only three expressed concern about whether to trust the keys, and none used the validity and trust labels in the interface.
- Participants were confused by the key icons, with some afraid of publishing their private key by mistake. Several expressed frustration, to the point where, the authors judge, they would probably not have continued to use PGP.
- The authors conclude that PGP 5.0 is not usable enough to provide effective security for most users, despite its attractive graphical interface, and that interface design for effective security remains an open problem.

## Critical Analysis

The paper is a landmark because it names a problem and shows it with a concrete study. As evidence it has limits, and the authors acknowledge several.

- **Small, educated sample.** Twelve participants, all with some college, in one lab. The authors say the purpose is to find extreme usability problems, not to compare groups or estimate rates, so the proportions (one third, one quarter) should be read as illustrations.
- **The test was not fully standardized.** The monitor played team members and answered in different ways to different people, and the authors discuss this openly. They argue that the extra help could hide problems but not invent them.
- **One program, one version, one scenario.** PGP 5.0 on the Macintosh, in a secure email task. The authors note that PGP 6.0 had just been released. Whether the same properties hold for other security tools is the paper's hypothesis, and it is argued more than tested.
- **No alternative design was tried.** The claim that security needs a different usability standard is supported by the failure of one conventional design, not by a comparison with a design built on the new standard. In our reading, the later growth of usable security as a field is what made the claim stronger, and that is outside the paper.

## Further Research

- Interface design principles and techniques made for security, which the authors say they continue to develop.
- Evaluation methods for security usability, since the authors call good evaluation for security an open problem in itself.
- Designs that help users form a correct mental model of public keys, and give feedback about the state of their security.
- Larger and more varied studies, including other tools and populations.
