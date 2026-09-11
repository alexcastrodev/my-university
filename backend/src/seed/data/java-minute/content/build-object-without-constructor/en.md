---
version: 1.0
updatedAt: 2026-09-11
---
## Question

# Can you build an object without calling its constructor?

## Short Answer

No.

## Less Short Answer

Actually, you can. The Java language is designed so that calling a constructor is the only way to create an object. Of course, you can create factory methods that you call from your application code, so that the constructor call does not appear in that code. But that factory method still calls a constructor internally. This is how Java was designed from the beginning.

## The Exception: Serialization

There is one exception to that: serialization. When you deserialize an object, the deserialization mechanism does not call the constructor of that object. It bypasses it, which is actually a security issue: if you have validation rules in your constructor, they get bypassed by the deserialization mechanism, allowing a corrupted object to live in your application.

## One Last Word

Records were created after serialization was implemented, and they are an exception to the exception. Deserialization does call your record's canonical constructor and its validation rules. There is no way to create a record without calling its canonical constructor. One more reason to use them wherever you can.

## References

- [Java Coding Tip #394: Can You Build an Object Without Calling Its Constructor?](https://www.youtube.com/watch?v=ZYEsagr1CjI) — video
- [Record Classes — The Java Tutorials](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Serializable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
