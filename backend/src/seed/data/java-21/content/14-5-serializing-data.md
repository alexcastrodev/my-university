# Serializing Data

> Serialization converts a live Java object graph into a sequence of bytes that can be written to a file or sent over a network, then later reconstructed (deserialized) back into objects. The OCP exam tests the `Serializable` marker interface, `ObjectOutputStream`/`ObjectInputStream`, the `transient` keyword, `serialVersionUID`, and key security concerns.

---

## The `Serializable` Interface

`java.io.Serializable` is a **marker interface** — it has no methods. Its presence tells the JVM that objects of this class may be serialized.

```java
import java.io.Serializable;

public class Employee implements Serializable {
    private String name;
    private int    salary;
    // No Serializable methods required
}
```

If you attempt to serialize an object whose class does not implement `Serializable`, the JVM throws `NotSerializableException` at runtime.

Every field's type must also be serializable (or `transient`) — including fields inherited from superclasses.

---

## Writing Objects: `ObjectOutputStream`

```java
Employee emp = new Employee("Alice", 95000);

try (ObjectOutputStream oos = new ObjectOutputStream(
        new BufferedOutputStream(
            new FileOutputStream("/tmp/employee.ser")))) {

    oos.writeObject(emp);
}
```

The pattern is always:
`ObjectOutputStream` → `BufferedOutputStream` → `FileOutputStream`

The `BufferedOutputStream` layer is optional but strongly recommended for performance.

---

## Reading Objects: `ObjectInputStream`

```java
try (ObjectInputStream ois = new ObjectInputStream(
        new BufferedInputStream(
            new FileInputStream("/tmp/employee.ser")))) {

    Employee emp = (Employee) ois.readObject();
    System.out.println(emp.getName());
}
```

`readObject()` returns `Object`, so an explicit cast is required. It throws both `IOException` and `ClassNotFoundException` (checked), so both must be handled or declared.

---

## The `transient` Keyword

Fields marked `transient` are **excluded** from serialization. When the object is deserialized, transient fields are set to their default value (`null` for objects, `0` for numbers, `false` for booleans).

```java
public class UserSession implements Serializable {
    private String username;
    private transient String passwordHash;  // never persisted
    private transient Socket connection;    // not serializable anyway
}

// After deserialization:
// session.username    → restored from bytes
// session.passwordHash → null
// session.connection  → null
```

Use `transient` for:
- Sensitive data (passwords, tokens) you never want persisted
- Non-serializable fields (threads, sockets, streams)
- Derived/cached values that can be recomputed

---

## `serialVersionUID`

The JVM uses a version identifier to verify that a serialized class matches the class currently in the JVM. If they do not match, `InvalidClassException` is thrown during deserialization.

```java
public class Employee implements Serializable {
    private static final long serialVersionUID = 1L;

    private String name;
    private int    salary;
}
```

If you do **not** declare `serialVersionUID`, the JVM computes one automatically from the class structure. Any change to the class (adding a field, changing a method signature) can change this computed value and break deserialization of previously saved data.

**Best practice:** Always declare `serialVersionUID` explicitly so you control compatibility.

| Scenario | Result |
|---|---|
| Same `serialVersionUID`, added new field | Deserialized OK; new field gets default value |
| Same `serialVersionUID`, removed field | Deserialized OK; removed field silently ignored |
| `serialVersionUID` mismatch | `InvalidClassException` at runtime |
| No `serialVersionUID`, class changed | Likely `InvalidClassException` (JVM-computed value changed) |

---

## Serializing an Object Graph

When you serialize an object, **every object reachable from that object** is also serialized (provided all classes implement `Serializable`).

```java
public class Department implements Serializable {
    private String        name;
    private List<Employee> employees;  // Employee must also be Serializable
}
```

If any object in the graph is not serializable (and not transient), serialization fails with `NotSerializableException`.

---

## Customizing Serialization

You can override default behavior by declaring these exact methods:

```java
private void writeObject(ObjectOutputStream oos) throws IOException {
    oos.defaultWriteObject();       // serialize all non-transient fields
    oos.writeInt(computedValue());  // then write extra data
}

private void readObject(ObjectInputStream ois)
        throws IOException, ClassNotFoundException {
    ois.defaultReadObject();        // deserialize all non-transient fields
    // recompute or validate transient fields here
}
```

These methods must have exactly this signature and visibility.

---

## Security Concerns

Deserialization is a significant attack vector. Deserializing untrusted data can lead to **remote code execution** if the classpath contains classes with dangerous `readObject` implementations.

Key defensive practices:
- Never deserialize data from untrusted sources without validation.
- Use serialization filters (`ObjectInputFilter`) introduced in Java 9 to restrict which classes can be deserialized.
- Prefer safer alternatives (JSON, XML, Protocol Buffers) for data exchange across trust boundaries.

```java
// Java 17+ — set a deserialization filter
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
    "com.example.*;maxdepth=5;maxbytes=10000");
ois.setObjectInputFilter(filter);
```

---

## Key Rules Summary

- `Serializable` is a marker interface — no methods to implement.
- `serialVersionUID` should always be declared explicitly to control version compatibility.
- `transient` fields are skipped during serialization and reset to defaults on deserialization.
- Both `IOException` and `ClassNotFoundException` are thrown by `readObject()` — both are checked.
- Serializing an object serializes the entire reachable object graph.
- Deserializing untrusted data is dangerous — use filters or safer serialization formats.

---

## References

- [Oracle Docs — Serializable](https://docs.oracle.com/en/java/docs/api/java.base/java/io/Serializable.html)
- [Oracle Docs — ObjectInputFilter](https://docs.oracle.com/en/java/docs/api/java.base/java/io/ObjectInputFilter.html)
- OCP Study Guide, Chapter 14 — I/O
