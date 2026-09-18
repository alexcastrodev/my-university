---
version: 1.0
updatedAt: 2026-09-18
---
## Question

# Why should you favor composition over inheritance?

## Short Answer

Because it's written in the manual.

## Less Short Answer

You read the manual, didn't you? The question you should ask yourself is the following: when you need to add a given behavior to an object, should you create a method on that object, or should you create a delegate that implements this behavior?

Imagine it's 2005, and you need to marshal your object to XML.

- Solution one: you create a `toXML()` method on that class.
- Solution two: you create this `toXML()` method in a factory class somewhere else.

Now it's 2025, twenty years later, and you no longer need XML. What you need is JSON. In solution one, you add a `toJSON()` method, but the real question is: what do you do with the now-useless `toXML()` method? From a functional point of view, this is dead code. Odds are you will decide to keep it, because it would be too costly to refactor your application to remove all the calls to that method. In solution two, you just throw away the class, because nobody should be calling it anymore.

## Why This Matters

Composition makes decoupling the different modules of your application much easier. And if you think this is just about organizing your application in a better way, think again: this is about making your code easier to dispose of when you no longer need it, preventing dead code from staying there and plaguing your application.

## One Last Word

It was written in the manual more than thirty years ago. The GoF book was published in 1994. And even if it's always better to fully understand the rules you follow, sometimes it's more important to just follow them, even if you do not fully understand them.

## References

- [Java Coding Tip #396: Why Should You Favor Composition Over Inheritance?](https://youtube.com/shorts/DIZTQxkOsy4) — video
- [Design Patterns: Elements of Reusable Object-Oriented Software (Gamma, Helm, Johnson, Vlissides, Addison-Wesley, 1994)](https://en.wikipedia.org/wiki/Design_Patterns) — doc
