# Serialization and Deserialization

---

## Overview

**Serialization** converts a Java object graph into a byte stream. **Deserialization** reconstructs objects from that byte stream. The mechanism is provided by `java.io.ObjectOutputStream` and `java.io.ObjectInputStream`.

---

## Serializable Marker Interface

A class must implement `java.io.Serializable` to be serializable. It declares no methods — it is a **marker interface** that signals intent to the JVM.

```java
import java.io.Serializable;

public class Product implements Serializable {
    private String name;
    private double price;
    private int stock;
}
```

> **Exam tip:** If an object's class does not implement `Serializable`, serializing it throws `NotSerializableException`.

---

## serialVersionUID

`serialVersionUID` is a `static final long` that the JVM uses to verify that a deserialized class is compatible with the loaded class definition.

```java
public class Product implements Serializable {
    private static final long serialVersionUID = 1L;

    private String name;
    private double price;
}
```

If `serialVersionUID` is not declared, the JVM generates one automatically from the class structure. Changing the class (adding/removing fields) regenerates the UID, causing an `InvalidClassException` when deserializing old data.

> **Exam tip:** Always declare `serialVersionUID` explicitly to control versioning. Forgetting it is a common source of `InvalidClassException` on exam questions.

---

## Writing and Reading Objects

```java
Product p = new Product("Widget", 9.99);

// Serialize
try (ObjectOutputStream oos = new ObjectOutputStream(
        new BufferedOutputStream(new FileOutputStream("product.ser")))) {
    oos.writeObject(p);
}

// Deserialize
try (ObjectInputStream ois = new ObjectInputStream(
        new BufferedInputStream(new FileInputStream("product.ser")))) {
    Product loaded = (Product) ois.readObject();  // unchecked cast
    System.out.println(loaded.getName());
}
```

`readObject()` throws `ClassNotFoundException` (checked) in addition to `IOException`.

---

## What Gets Serialized

| Element | Serialized? |
|---------|-------------|
| Instance fields (non-transient) | Yes |
| `transient` instance fields | No — reset to default value on deserialization |
| `static` fields | No — belong to the class, not the instance |
| Superclass fields (if superclass implements `Serializable`) | Yes |
| Superclass fields (if superclass does NOT implement `Serializable`) | No — superclass no-arg constructor is called instead |

---

## transient Fields

Mark fields `transient` to exclude them from serialization (passwords, caches, open connections):

```java
public class Session implements Serializable {
    private static final long serialVersionUID = 1L;

    private String userId;
    private transient String cachedToken;   // not serialized
    private transient Connection dbConn;    // not serialized
}
```

After deserialization, `cachedToken` is `null` and `dbConn` is `null` — they must be reinitialised manually.

---

## Inheritance and Serialization

- If a **superclass** implements `Serializable`, all subclasses are automatically serializable.
- If a **superclass** does not implement `Serializable`, the superclass's no-arg constructor is invoked during deserialization to initialise the superclass portion. If no accessible no-arg constructor exists, deserialization throws `InvalidClassException`.

```java
public class Animal {                        // NOT Serializable
    private String species;
    public Animal() { this.species = "Unknown"; }  // required
    public Animal(String s) { this.species = s; }
}

public class Dog extends Animal implements Serializable {
    private static final long serialVersionUID = 1L;
    private String name;
}
// On deserialization: Animal() is called, then Dog's fields are restored.
```

---

## Custom Serialization — readObject / writeObject

Override these private methods to control the serialized form:

```java
public class SecureUser implements Serializable {
    private static final long serialVersionUID = 1L;

    private String username;
    private transient char[] password;

    private void writeObject(ObjectOutputStream oos) throws IOException {
        oos.defaultWriteObject();                // writes non-transient fields
        oos.writeInt(password.length);
        for (char c : password) oos.writeChar(c);
    }

    private void readObject(ObjectInputStream ois)
            throws IOException, ClassNotFoundException {
        ois.defaultReadObject();                 // restores non-transient fields
        int len = ois.readInt();
        password = new char[len];
        for (int i = 0; i < len; i++) password[i] = ois.readChar();
    }
}
```

`defaultWriteObject()` and `defaultReadObject()` must be called first when used.

---

## readResolve and writeReplace

| Method | Purpose |
|--------|---------|
| `Object readResolve()` | Returns a replacement object after deserialization (e.g., singletons) |
| `Object writeReplace()` | Returns a replacement object before serialization |

```java
public class Singleton implements Serializable {
    private static final Singleton INSTANCE = new Singleton();
    private Singleton() {}

    public static Singleton getInstance() { return INSTANCE; }

    private Object readResolve() {
        return INSTANCE;  // prevents a second instance from being created
    }
}
```

---

## Records and Serialization

Records implement `Serializable` the same way as classes, but their serialization is tighter:

```java
public record Point(int x, int y) implements Serializable {
    private static final long serialVersionUID = 1L;
}
```

- Records cannot define `writeObject`, `readObject`, `writeReplace`, or `readResolve` (serialisation is handled differently to preserve the canonical constructor invariant).
- The canonical constructor is always invoked during deserialization, guaranteeing validation logic runs.

> **Exam tip:** Custom `readObject`/`writeObject` methods are silently ignored for records — the JVM uses the canonical constructor path instead.

---

## Security and Versioning Considerations

- **Deserialization of untrusted data is a known attack vector** (remote code execution via gadget chains). In production, use `ObjectInputFilter` or avoid Java serialization entirely.
- Changing `serialVersionUID` deliberately prevents old streams from being read — use this as a version break when fields change incompatibly.
- Adding a field with a matching `serialVersionUID` is generally backward-compatible; removing a field loses that data silently.

---

## Key Points for the Exam

- `Serializable` is a marker interface with no methods.
- Declare `serialVersionUID` explicitly to avoid `InvalidClassException` surprises.
- `transient` and `static` fields are not serialized.
- If the superclass is not `Serializable`, its no-arg constructor is called during deserialization.
- `readObject()` throws both `IOException` and `ClassNotFoundException`.
- Records use the canonical constructor during deserialization; custom `readObject`/`writeObject` are ignored.
- `readResolve()` is the standard way to preserve singleton semantics across deserialization.

## References

- [Oracle Docs — Serializable (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html)
- [Oracle Docs — ObjectOutputStream (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectOutputStream.html)
