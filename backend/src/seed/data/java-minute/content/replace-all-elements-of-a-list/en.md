---
version: 1.0
updatedAt: 2026-08-26
---
## Question

# How can you replace all the elements of a list?

## Short Answer

There is a method for that.

## Less Short Answer

There is a factory method in the `Collections` factory class called `replaceAll`, which, as its name suggests, replaces all the occurrences of a value in a list with another one. It takes the list as its first parameter, then the value you want to replace, and finally the value you want to replace it with.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Ana", "Cid"));
Collections.replaceAll(names, "Ana", "Zoe");
// names = ["Zoe", "Bob", "Zoe", "Cid"]
```

## Replacing `null` Values

This method supports the replacement of `null` values, which is great, because you can use this pattern to replace the `null` values you may have in your list with a default value.

```java
List<String> values = new ArrayList<>(Arrays.asList("A", null, "B", null));
Collections.replaceAll(values, null, "N/A");
// values = ["A", "N/A", "B", "N/A"]
```

## Under the Hood

If you check the implementation of the method, you will see that it is optimized depending on the size and the nature of your list — it may access your elements through indexes, or fall back to a `ListIterator`, whichever is more efficient for the kind of list you gave it.

## One Last Word: What the Return Value Means

This method returns `true` if the element to be replaced was found in the list — which does not mean that your list was actually modified, because you could have asked to replace it with the same value it already had. Why would you do that? Nobody knows, but the API designers thought about it anyway.

## References

- [Java Coding Tip #389: How Can You Replace All the Elements of a List?](https://youtube.com/shorts/eRRKMgEBsHQ?is=Swn3DDxijA91ljpd) — video
- [Collections.replaceAll — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#replaceAll(java.util.List,java.lang.Object,java.lang.Object)) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
