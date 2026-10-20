---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Write the syntax and the two typing rules that System F adds to the simply typed lambda calculus: type abstraction $\Lambda\alpha.\,e$ and type application $e\,[\tau]$.
- Define polymorphic terms (identity, Church booleans and numerals) and compute their types by instantiation.
- Use parametricity to derive a "free theorem" from a type alone, and explain when a language breaks it.
- Contrast System F with Hindley-Milner type inference, and relate the theory to how Java, C#, Rust, and Haskell implement generics.

## Context & Motivation

`software-distributed/programming-languages` introduced the simply typed lambda calculus, in which `id` must be written once per type, and then type inference by unification, which assigns `id` the type $\forall\alpha.\,\alpha \to \alpha$ without annotations. This concept looks at the system underneath: **System F**, discovered independently by Girard (1972) and Reynolds (1974), the polymorphic lambda calculus. It is the smallest calculus that has real generics, and it is the core of Haskell's intermediate language, an ancestor of ML-family polymorphism, and a clean model for `<T>` in Java and C#.

System F matters for practitioners for two reasons. First, it explains what a generic signature promises. Because a function of type $\forall\alpha.\,\alpha \to \alpha$ cannot look inside a value of unknown type, the signature alone nearly determines its behavior, a principle Wadler called "theorems for free". Second, it explains why generics are implemented so differently across languages (erasure, monomorphization, dictionaries, reification), since the type-theoretic story is the same and the runtime stories are not.

## Core Theory

### Syntax and rules

System F extends the simply typed lambda calculus with a type variable $\alpha$, a universally quantified type, and terms to introduce and eliminate it:

$$\tau ::= \alpha \mid \tau \to \tau \mid \forall\alpha.\,\tau \qquad e ::= x \mid \lambda x{:}\tau.\,e \mid e\ e \mid \Lambda\alpha.\,e \mid e\,[\tau]$$

$$\frac{\Gamma,\ \alpha \vdash e : \tau}{\Gamma \vdash \Lambda\alpha.\,e : \forall\alpha.\,\tau}\ \text{(T-TAbs)} \qquad \frac{\Gamma \vdash e : \forall\alpha.\,\tau_1}{\Gamma \vdash e\,[\tau_2] : \tau_1[\alpha \mapsto \tau_2]}\ \text{(T-TApp)}$$

In T-TAbs, $\alpha$ must not already be free in $\Gamma$. The identity function is $\text{id} = \Lambda\alpha.\,\lambda x{:}\alpha.\,x$ with type $\forall\alpha.\,\alpha \to \alpha$, and $\text{id}\,[\text{Int}]\ 3$ has type $\text{Int}$. Type application is checked by substitution and erased at run time; in a language with inference you rarely write it.

A distinctive feature of System F is that the quantified type may be instantiated at a quantified type itself (**impredicativity**). The term $\lambda x{:}(\forall\alpha.\,\alpha \to \alpha).\ x\,[\forall\alpha.\,\alpha \to \alpha]\ x$ is well typed, and it has no typing in the simply typed calculus or in Hindley-Milner.

### Encoding data

System F can encode data types with no built-in constructors. **Church booleans** have type $\forall\alpha.\,\alpha \to \alpha \to \alpha$, with $\text{true} = \Lambda\alpha.\lambda t{:}\alpha.\lambda f{:}\alpha.\,t$ and `false` returning $f$. **Church numerals** have type $\text{Nat} = \forall\alpha.\,(\alpha \to \alpha) \to \alpha \to \alpha$, and the numeral for $n$ applies its first argument $n$ times to its second. Every well-typed System F term terminates (**strong normalization**), so the calculus cannot express general recursion and is not Turing complete. This is the same reason a total functional language and a logic can share a type system, an idea developed in the concept on dependent types.

### Parametricity and free theorems

A function of type $\forall\alpha.\,\ldots$ must treat $\alpha$ uniformly, since it has no operation available on values of an unknown type except moving them around. Reynolds formalized this as **parametricity**, and Wadler showed it yields theorems from types alone:

- $f : \forall\alpha.\,\alpha \to \alpha$ must return its argument (or fail to terminate in a language with general recursion).
- $r : \forall\alpha.\,[\alpha] \to [\alpha]$ commutes with `map`: $r\,(\text{map}\ g\ xs) = \text{map}\ g\ (r\ xs)$ for every $g$. So $r$ can reorder, drop, or duplicate elements by position, but it cannot depend on their values.
- $s : \forall\alpha.\,\alpha \to \alpha \to \alpha$ is either "return the first" or "return the second".

### Inference: Hindley-Milner versus full System F

Hindley-Milner (ML, Haskell 98) restricts System F so that quantifiers appear only at the outermost level of a type (**prenex**, rank-1 polymorphism) and polymorphism is introduced only by `let`. That restriction makes type inference decidable and efficient by unification, with no annotations. Full System F is much more expressive but its type inference is **undecidable** (Wells, 1994), so programs need explicit type annotations once they use higher-rank types. GHC's `RankNTypes` and Java's explicit generic method calls (`Collections.<String>emptyList()`) sit on either side of that trade-off, with local inference filling in the obvious cases.

### How languages implement it

The type theory is the same; the runtime is a design choice:

| Strategy | Languages | What happens |
|---|---|---|
| Erasure | Java, Haskell, OCaml | One compiled body; type arguments are checked and then removed |
| Monomorphization | C++ templates, Rust | One specialized copy per instantiation: fast, larger binaries |
| Dictionary passing | Haskell type classes | Capabilities (e.g. `Ord`) are passed as extra arguments |
| Reification | C# / .NET | The runtime knows `List<int>` and `List<string>` as distinct types |

Java's erasure explains its restrictions: no `new T[]`, no `instanceof List<String>`, and casts inserted by the compiler at use sites. Java also breaks pure parametricity, because every object has `equals`, `hashCode`, `toString`, and `getClass`, and reflection and `null` are always available.

## Worked Examples

### Example 1: typing the identity and applying it

**Problem:** Derive the type of $\Lambda\alpha.\,\lambda x{:}\alpha.\,x$ and then of $\text{id}\,[\text{Bool}]\ \text{true}$.

**Derivation:** Under the context $\alpha, x{:}\alpha$ the variable $x$ has type $\alpha$ by lookup. T-ABS gives $\lambda x{:}\alpha.\,x : \alpha \to \alpha$ under context $\alpha$. T-TABS then abstracts the type variable: $\Lambda\alpha.\,\lambda x{:}\alpha.\,x : \forall\alpha.\,\alpha \to \alpha$. For the application, T-TAPP instantiates with $\tau_2 = \text{Bool}$, substituting in the body type to get $\text{Bool} \to \text{Bool}$. T-APP with $\text{true} : \text{Bool}$ yields $\text{Bool}$. In Java the same two steps are `static <T> T id(T x) { return x; }` followed by `id(true)`, where the compiler infers the type argument.

### Example 2: Church numerals

**Problem:** Check that $\text{two} = \Lambda\alpha.\,\lambda s{:}\alpha\to\alpha.\,\lambda z{:}\alpha.\,s\,(s\,z)$ has type $\text{Nat}$, and compute with it.

**Solution:** Inside the body, $z : \alpha$, so $s\,z : \alpha$ and $s\,(s\,z) : \alpha$. Abstracting over $z$, $s$, and $\alpha$ gives $\forall\alpha.\,(\alpha \to \alpha) \to \alpha \to \alpha$, which is $\text{Nat}$. To use it as an ordinary number, instantiate $\alpha := \text{Int}$ and supply `succ` and `0`: $\text{two}\,[\text{Int}]\ (\lambda n.\,n+1)\ 0$ reduces to $(\lambda n.\,n+1)((\lambda n.\,n+1)\ 0) = 2$. Successor is $\text{succ} = \lambda n{:}\text{Nat}.\,\Lambda\alpha.\,\lambda s.\,\lambda z.\,s\,(n\,[\alpha]\ s\ z)$, and addition $m + n$ is $m\,[\text{Nat}]\ \text{succ}\ n$.

### Example 3: a free theorem as a property test

**Problem:** A library method has the signature `static <T> List<T> rotate(List<T> xs)`, and the claim is that it never examines the elements. What can be tested without knowing the implementation?

**Solution:** Parametricity predicts $\text{map}\ g\ (\text{rotate}\ xs) = \text{rotate}\ (\text{map}\ g\ xs)$ for every function $g$. A property-based test can generate a random list and a random $g$, and check that the two sides are equal. If the test fails, the method is looking at element values (perhaps through `equals`, `hashCode`, or `instanceof`), which its signature does not admit. Contrast `static <T extends Comparable<? super T>> void sort(List<T> xs)`: the bound is an extra capability, and the free theorem weakens to "commutes with `map g` when $g$ preserves order".

## Common Misconceptions & Pitfalls

- **"Generics are templates."** C++ templates are instantiated per use and checked after instantiation. Java and System F generics are checked once, in generic form, and the checking is what gives the guarantee.
- **"In Java, `<T> T f(T x)` must be the identity."** Only in System F. Java lets `f` return `null`, throw, call `x.toString()`, or inspect `x.getClass()`, because the language has universal operations on all objects.
- **"System F is just Haskell types."** Haskell's source language uses a rank-1 fragment with inference, and uses System F internally (as a typed core language) after elaboration. Extensions such as `RankNTypes` let you write higher-rank types, with annotations.
- **"Erasure means Java's generics are unsound."** Erasure is an implementation strategy. The checker is sound as long as there are no unchecked warnings; raw types and unchecked casts cause *heap pollution* and the `ClassCastException`s that come with it.

## Summary

System F adds type abstraction and application to the simply typed lambda calculus, giving $\forall\alpha.\,\tau$ types with the rules T-TAbs and T-TApp, enough to encode booleans and numbers and to type self-application. Every typed term terminates. Parametricity says polymorphic functions treat their type argument uniformly, which yields free theorems from signatures. Hindley-Milner restricts System F to make inference decidable, and full System F inference is undecidable. Java erases type arguments, C++ and Rust monomorphize, Haskell passes dictionaries, and C# reifies, all implementing the same theory. The next concept adds the other half of object-oriented generics: subtyping, and how it interacts with parametric polymorphism through variance.

## Documentation Links

- [Pierce: Types and Programming Languages (MIT Press), chapters 23 and 24](https://www.cis.upenn.edu/~bcpierce/tapl/): doc
- [Wadler: Theorems for Free! (FPCA 1989)](https://dl.acm.org/doi/10.1145/99370.99404): doc
- [The Java Language Specification: Type Erasure (section 4.6)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.6): doc
