---
version: 1.0
updatedAt: 2026-08-26
---
## Question

# What is the difference between an interface and an abstract class?

## Short Answer

Well, it's not the same thing.

## Less Short Answer

There are two major differences. First, an abstract class has a constructor, which is called to construct your final object — this is not the case for an interface. Second, an abstract class can carry a mutable state, which again is not the case for an interface.

```java
abstract class Vehicle {
    private int speed; // mutable state

    protected Vehicle(int speed) { // constructor
        this.speed = speed;
    }
}

interface Movable {
    // no constructor, no mutable state allowed
}
```

## A Word of Caution

This question may sound like a trick question, because you can have static and instance methods in both abstract classes and interfaces. It is a feature that was added to interfaces in Java 8, in 2014.

## One Last Word

Now, you may be wondering: when should one use abstract classes or interfaces? By default, prefer interfaces. Why? Well, that will be for another time.

## References

- [Java Coding Tip #156: What Is the Difference Between an Interface and an Abstract Class?](https://www.youtube.com/watch?v=f5hKXYeJ90s) — video
- [Interfaces — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/createinterface.html) — doc
- [Abstract Methods and Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/abstract.html) — doc
