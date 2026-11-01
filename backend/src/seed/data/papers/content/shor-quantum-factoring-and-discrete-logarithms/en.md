---
title: "Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer"
summary: Shor shows that a quantum computer could factor integers and compute discrete logarithms in time polynomial in the number of digits, problems that no known classical algorithm solves efficiently and on which public-key cryptography relies.
researchArea: Quantum Computing
keywords: quantum algorithms, integer factorization, discrete logarithm, quantum Fourier transform, order finding, public-key cryptography
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Computer science rests on the belief that every reasonable computing device can be simulated by a Turing machine with at most a polynomial slowdown. This paper, by Peter Shor (then at AT&T), asks whether that still holds when the laws of quantum mechanics are taken into account. Its answer, for two famous problems, is that it may not.

The problems are factoring integers and computing discrete logarithms. No polynomial-time classical algorithm is known for either, and the security of cryptosystems such as RSA rests on that. The best classical factoring algorithm at the time, the number field sieve, takes time that grows faster than any polynomial in the number of digits. The paper shows efficient randomized algorithms for both problems on a hypothetical quantum computer. It appeared first at FOCS 1994 and in a revised form in the SIAM Journal on Computing in 1997, and this analysis follows the revised text.

Worth knowing first: the class P and the idea of polynomial time, modular arithmetic, the Fourier transform, and the basics of quantum states (superposition, measurement, unitary operations).

## Contribution

- **Polynomial-time quantum algorithms,** with a small probability of error, for factoring and for discrete logarithms. For factoring the number of quantum steps is O((log n)^2 (log log n)(log log log n)), plus polynomial classical post-processing.
- **Reduction to order finding.** Instead of factoring directly, the algorithm finds the order r of a random x modulo n, the smallest r with x^r = 1 (mod n), and a classical reduction turns that into a factor.
- **An efficient quantum Fourier transform** over a large number of values, built with a number of gates polynomial in the number of bits, which is what makes the speedup possible.
- **A frank discussion of physical obstacles,** precision and decoherence, and of what the algorithm does and does not suggest about the power of quantum computers.

## Methodology

The paper is theoretical, and it works with the quantum gate array model. To find the order of x modulo n, the algorithm picks a power of two q with n^2 <= q < 2n^2 and builds a uniform superposition over all numbers a below q. It then computes x^a mod n in a second register reversibly, applies the quantum Fourier transform to the first register, and measures it.

Measuring gives a value c such that c/q is, with good probability, close to a fraction d/r whose denominator is the unknown order r. A continued-fraction expansion recovers the fraction. The paper shows that each useful outcome has probability at least 1/(3r^2), so r is recovered with probability at least about phi(r)/(3r), and repeating about log log r times makes success likely. A classical step computes the gcd of x^(r/2) - 1 and n, which gives a non-trivial factor with probability at least 1 - 1/2^(k-1) when n has k distinct odd prime factors. The discrete logarithm algorithm follows the same pattern: a superposition over two exponents a and b, the value g^a x^(-b) mod p in a third register, and a Fourier transform on both exponents.

## Findings

These are the authors' reported results.

- The main results are theorems of complexity, not experiments: factoring and discrete logarithms can be solved in polynomial time on a quantum computer, with error probability that can be made small by repetition.
- The quantum part of the work for factoring is on the order of (log n)^2 steps up to small factors, against a classical best of exp(c (log n)^(1/3) (log log n)^(2/3)) for the number field sieve.
- Imprecision does not have to be extreme: citing earlier work of Bennett and co-authors, the paper notes that quantum gates need precision only on the order of 1 over the number of steps t, and that decoherence needs to be polynomially small in t.
- A consequence the author stresses: any general method that simulated quantum mechanics classically with only a polynomial slowdown would give a polynomial-time algorithm for factoring.

## Critical Analysis

This paper changed the field. It also has clear limits, which the author states.

- **No quantum computer existed.** The introduction says that nobody knows how to build one. The result is a statement about a model, and what it means for real machines depends on engineering.
- **The error question was open.** The paper notes that classical redundancy is ruled out for qubits by the no-cloning theorem, and only mentions early progress toward error correction. In our reading, the later development of quantum error-correcting codes and fault tolerance is what made the result more than a model.
- **The scope is narrow.** The author points out that factoring and discrete logarithms matter only because of public-key cryptography, and that quantum computers may stay a special-purpose tool unless more problems are found. He suggests short lattice vectors as a candidate, and thinks it unlikely that quantum computers solve NP-complete problems, though not ruled out.
- **A speedup is not proved.** The paper shows an efficient quantum algorithm. That factoring is hard for classical computers is a belief, not a theorem, so strictly the result does not prove that quantum computers are more powerful than classical ones.

## Further Research

- Building quantum computers with enough precision, low enough decoherence and error correction to run long computations, the obstacles the author lists.
- Finding other problems with exponential or large speedups on quantum computers, including the lattice problem the author suggests.
- Studying whether quantum computers can solve NP-complete problems, which the author does not rule out.
- Cryptography that does not depend on factoring or discrete logarithms, a direction that follows from the result.
