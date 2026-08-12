---
version: 1.0
updatedAt: 2026-08-12
---
## Question

# What is a group in a regular expression?

## Short Answer

Something very useful to analyze strings of characters.

## What It Is

Groups are actually a feature of regular expressions specified outside of the JDK. A group is just a portion of your regular expression between parentheses. With such a regular expression, you can analyze a string of characters, match it to get a `Matcher`, and if you have a match, get the different elements you need from it.

```java
Pattern pattern = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})");
Matcher matcher = pattern.matcher("Published on 2026-08-12");

if (matcher.find()) {
    String year = matcher.group(1);
    String month = matcher.group(2);
    String day = matcher.group(3);
}
```

## Named Groups

The nice thing is that you can give names to groups to make your code more expressive. You specify the name of a group directly in your regular expression, and then if you have a match, you can get the values of the different groups by their names — which makes your code much more readable.

```java
Pattern pattern = Pattern.compile(
    "(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})"
);
Matcher matcher = pattern.matcher("Published on 2026-08-12");

if (matcher.find()) {
    String year = matcher.group("year");
    String month = matcher.group("month");
    String day = matcher.group("day");
}
```

## Practical Example

If what you're looking for is the first occurrence of something in a long text, remember that `Matcher` also exposes a lazy stream of matches through `results()`, returning a `Stream<MatchResult>`.

```java
Pattern pattern = Pattern.compile("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})");
Matcher matcher = pattern.matcher(longText);

Optional<MatchResult> firstMatch = matcher.results().findFirst();
firstMatch.ifPresent(match -> System.out.println(match.group("year")));
```

## Solution and Conclusion

Groups let you carve a regular expression into the pieces you actually care about, and named groups let you refer to those pieces by intent instead of by position. When you only need the first match out of a long text, `Matcher.results()` gives you a lazy `Stream<MatchResult>` so you can stop as soon as you find it, instead of scanning the whole text upfront.

## References

- [Java Coding Tip #385: What Is a Group in a Regular Expression?](https://www.youtube.com/watch?v=iTRIbbiZBVs) — video
- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
- [Matcher — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Matcher.html) — doc
