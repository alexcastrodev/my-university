---
version: 1.0
updatedAt: 2026-08-30
---
## Question

# What are the SOLID principles?

## Short Answer

A set of principles for object-oriented programming that you should know and follow.

## Less Short Answer

The SOLID acronym was coined by Kent Beck, author of several books on test-driven development and extreme programming, among others.

## S — Single Responsibility Principle

One reason to change your class or your method. One stakeholder — two is already too much.

## O — Open-Closed Principle

Open for extension, closed for modification. You can implement it with composition, which makes it even more powerful.

## L — Liskov Substitution Principle

Named after Barbara Liskov, it defines what inheritance is: if an instance of `B` behaves the same as an instance of `A`, to a point that you cannot tell which one is which, then `B` extends `A`.

## I — Interface Segregation Principle

In a nutshell, an interface should not have methods that you don't use.

## D — Dependency Inversion Principle

If a module `A` depends on module `B` at runtime, then `B` should depend on `A` at compile time. The two dependency arrows are opposite — this is what inversion means.

## One Last Word

All this may sound like old stuff, and it is — these principles have been around for more than 25 years. But applying them will help you make your legacy code much easier to manage.

## References

- [Java Coding Tip #370: What Are the SOLID Principles?](https://youtube.com/shorts/WkZF3uOA9hA?is=AfegoVaia0RGE20Q) — video
- [SOLID — Wikipedia](https://en.wikipedia.org/wiki/SOLID) — doc
- [Liskov Substitution Principle — Wikipedia](https://en.wikipedia.org/wiki/Liskov_substitution_principle) — doc
