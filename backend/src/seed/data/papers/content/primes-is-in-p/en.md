---
title: "PRIMES is in P"
summary: A deterministic algorithm that decides whether a number is prime in time polynomial in its number of digits, with no unproven assumption, built on a generalization of Fermat's little theorem to polynomials.
researchArea: Algorithms and Theory
keywords: primality testing, deterministic algorithms, computational complexity, polynomial identities, number theory, derandomization
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Deciding whether a number n is prime is one of the oldest problems in mathematics, and it matters in practice because many cryptographic protocols need large primes. Trial division is correct but needs about the square root of n steps, which is exponential in the size of the input (the number of digits, log n). An efficient test should take a number of steps polynomial in log n.

Before this paper, the best answers each gave up something. Miller (1975) gave a deterministic polynomial-time test, but it depends on the Extended Riemann Hypothesis. Rabin, and Solovay and Strassen, gave unconditional polynomial-time tests that are randomized. Adleman, Pomerance and Rumely (1983) gave an unconditional deterministic test, but with running time (log n) to the power O(log log log n), slightly worse than polynomial. The question was whether primality is in the class P, and this paper by Manindra Agrawal, Neeraj Kayal and Nitin Saxena (Annals of Mathematics, 2004) answers yes.

Worth knowing first: modular arithmetic, Fermat's little theorem, the idea of polynomial running time in the input size, and the difference between randomized and deterministic algorithms.

## Contribution

- **An unconditional, deterministic, polynomial-time primality test.** No random choices and no unproven hypothesis.
- **A new characterization of primes.** Fermat's little theorem says that `a^(n-1) = 1 (mod n)` for prime n, but some composite numbers (Carmichael numbers) pass it for every a. The paper uses the polynomial version, `(X + a)^n = X^n + a (mod n)`, which holds exactly when n is prime, and finds a way to test it cheaply.
- **An elementary proof.** The correctness proof uses simple algebra, apart from one result from sieve theory that is needed only for the better time bound. Earlier certificate-based algorithms had much more complex proofs.
- **A running time of about log^(15/2) n,** with a conjectured improvement to about log^6 n.

## Methodology

The paper is theoretical and its method is a proof. The identity above characterizes primes but checking it takes about n steps, because the left side has n coefficients. The authors reduce it modulo a polynomial `X^r - 1` for a small r, so that only r coefficients remain: `(X + a)^n = X^n + a (mod X^r - 1, n)`. Every prime passes for every a and r, but some composites pass for a few of them. The key result is that, for a suitably chosen r, passing for a polynomially bounded number of values of a forces n to be a prime power.

The algorithm has six steps: reject perfect powers; find the smallest r such that the order of n modulo r is larger than log^2 n; reject n if it shares a factor with some a up to r; answer prime if n is not larger than r; test the polynomial congruence for a = 1 up to about the square root of the totient of r times log n; otherwise answer prime. The paper then proves that a suitable r of size at most about log^5 n exists, that the algorithm answers prime exactly for primes, and counts the time.

## Findings

These are the authors' proved results.

- **Theorem 4.1.** The algorithm returns prime if and only if n is prime.
- **Theorem 5.1.** The running time is O~(log^(21/2) n), where O~ hides logarithmic factors. The loop of step 5 dominates, with about r^2 log^3 n work.
- **Theorem 5.3.** Using a result of Fouvry on the density of primes q for which q minus 1 has a large prime factor, a suitable r of size O(log^3 n) exists, and the time falls to O~(log^(15/2) n).
- **Conjectural bounds.** If the density of Sophie Germain primes behaves as conjectured, r can be about log^2 n and the time O~(log^6 n). If a further conjecture from the literature (6.1), checked by others for r up to 100 and n up to 10^10, were proved, the time would be O~(log^3 n).
- The paper reports that Lenstra and Pomerance had obtained a modified version with a provable O~(log^6 n) running time.

## Critical Analysis

This is a landmark result, and its proof is short enough to read. Some points for a careful reader:

- **Theory, not engineering.** The paper has no implementation and no timing. A polynomial of high degree can still be slow, and in our reading randomized tests such as Miller-Rabin remain the ones used in practice because they are much faster, with an error that can be made negligible. The paper's value is that it settles the complexity question.
- **The better bound leans on number theory outside the paper.** Theorem 5.3 depends on a sieve-theory result by others, and the best bounds depend on conjectures that were not proved at the time.
- **It says what is in P, not how to find primes.** The test decides primality of a given number. It does not by itself produce a large prime, which in practice is done by testing random candidates.
- **The authors point to improvements themselves,** such as a smaller set of values of a that may suffice, so the O~(log^(15/2) n) bound should be read as a first result.

## Further Research

- Showing that fewer values of a are enough in the loop of step 5, which the authors think is very likely.
- Proving Conjecture 6.1 and the density conjectures, which would lower the exponent to 3 and 6.
- Practical implementations and a comparison with randomized tests on the number sizes that cryptography uses.
- The broader question of whether other randomized algorithms can be made deterministic with similar polynomial-identity ideas.
