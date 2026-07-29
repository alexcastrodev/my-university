---
version: 1.0
updatedAt: 2026-07-29
---
## Objective

Understand how Spring Security represents a user: the `UserDetails` contract describes credentials and account status, `GrantedAuthority` describes what a user is allowed to do, and `UserDetailsService`/`UserDetailsManager` describe how the framework finds — and, for the `Manager` variant, creates and modifies — users. Together these four interfaces are the "user management" half of the authentication flow introduced in `spring-security-authentication-architecture`.

## Use Cases

- Wrapping an existing JPA `User` entity in a separate `UserDetails` implementation instead of making the entity itself implement the contract, keeping persistence concerns and Spring Security concerns in different classes.
- Choosing between implementing `UserDetailsService` (read-only lookup, enough for authentication alone) and `UserDetailsManager` (adds create/update/delete/change-password) based on whether the application actually needs to manage users, not just authenticate them.
- Using the `User` builder class for a quick, immutable `UserDetails` instance in a demo or test, without writing a dedicated class.
- Recognizing why a JPA entity that also implements `UserDetails` directly tends to become hard to read — and applying the decorator split (entity class + `SecurityUser` wrapper) to fix it.

## Deep Dive

### The `UserDetails` contract: credentials plus four account-status flags

`UserDetails` is the shape Spring Security expects a user to have. Only two methods carry authentication data; the rest govern authorization and account status:

```java
public interface UserDetails extends Serializable {
  String getUsername();
  String getPassword();
  Collection<? extends GrantedAuthority> getAuthorities();
  boolean isAccountNonExpired();
  boolean isAccountNonLocked();
  boolean isCredentialsNonExpired();
  boolean isEnabled();
}
```

The four `isXxx()` methods are all phrased so that `true` means "let this account through" — `isAccountNonExpired()` reading as a double negative is deliberate: the human mind associates `true` with the positive case and `false` with the negative one, so every one of the four methods fails the account by returning `false`. Applications that don't model expiry or locking simply return `true` from all four unconditionally.

### `GrantedAuthority`: one method, naming a privilege

`GrantedAuthority` represents a single privilege a user holds — read, write, or an application-specific action name:

```java
public interface GrantedAuthority extends Serializable {
  String getAuthority();
}
```

Because it has exactly one abstract method, a lambda is enough to implement it, though `SimpleGrantedAuthority` is the built-in, more explicit alternative:

```java
GrantedAuthority g1 = () -> "READ";
GrantedAuthority g2 = new SimpleGrantedAuthority("READ");
```

### A minimal `UserDetails` implementation, then a real one

The simplest possible implementation returns fixed values for every method — useful only to see the contract's shape:

```java
public class DummyUser implements UserDetails {
  @Override public String getUsername() { return "bill"; }
  @Override public String getPassword() { return "12345"; }
  @Override public Collection<? extends GrantedAuthority> getAuthorities() {
    return List.of(() -> "READ");
  }
  @Override public boolean isAccountNonExpired() { return true; }
  @Override public boolean isAccountNonLocked() { return true; }
  @Override public boolean isCredentialsNonExpired() { return true; }
  @Override public boolean isEnabled() { return true; }
}
```

A practical implementation instead takes `username`/`password` as constructor arguments, so each instance can represent a different user:

```java
public class SimpleUser implements UserDetails {
  private final String username;
  private final String password;

  public SimpleUser(String username, String password) {
    this.username = username;
    this.password = password;
  }

  @Override public String getUsername() { return username; }
  @Override public String getPassword() { return password; }
  // ...
}
```

### The `User` builder: a `UserDetails` instance without a dedicated class

For simple cases, Spring Security's `User.withUsername(...)` builder produces an immutable `UserDetails` instance without declaring any class at all:

```java
UserDetails u = User.withUsername("bill")
    .password("12345")
    .authorities("read", "write")
    .accountExpired(false)
    .disabled(true)
    .build();
```

`build()` applies an optional password-encoding function, then constructs the instance. The builder can also start from an existing `UserDetails` (`User.withUserDetails(existing)`), useful for producing a modified copy.

### Separating the JPA entity from the `UserDetails` implementation

A JPA entity that also implements `UserDetails` directly mixes two responsibilities in one class — persistence fields and getters/setters next to security-contract methods with different naming (`getAuthority()` returning a `String`, `getAuthorities()` returning a `Collection` implementing the interface):

```java
@Entity
public class User implements UserDetails {
  @Id private int id;
  private String username;
  private String password;
  private String authority;

  @Override public String getUsername() { return this.username; }
  @Override public String getPassword() { return this.password; }
  @Override public Collection<? extends GrantedAuthority> getAuthorities() {
    return List.of(() -> this.authority);
  }
  // JPA getters/setters interleaved with security-contract overrides
}
```

Splitting this into a plain JPA entity and a separate decorator restores a single responsibility per class:

```java
@Entity
public class User {
  @Id private int id;
  private String username;
  private String password;
  private String authority;
  // plain JPA entity — no Spring Security dependency
}

public class SecurityUser implements UserDetails {
  private final User user;

  public SecurityUser(User user) { this.user = user; }

  @Override public String getUsername() { return user.getUsername(); }
  @Override public String getPassword() { return user.getPassword(); }
  @Override public Collection<? extends GrantedAuthority> getAuthorities() {
    return List.of(() -> user.getAuthority());
  }
  // ...
}
```

`SecurityUser` only makes sense wrapping a `User`, so the field is `final` and required in the constructor — the class documents its own dependency.

### `UserDetailsService`: one method, the only thing authentication strictly needs

```java
public interface UserDetailsService {
  UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}
```

The `AuthenticationProvider` calls this method to find a user by username; if none exists, it throws `UsernameNotFoundException` (a `RuntimeException` under the hood — the `throws` clause is documentation only, since it ultimately extends `AuthenticationException`). A minimal implementation over an in-memory list needs nothing more:

```java
public class InMemoryUserDetailsService implements UserDetailsService {
  private final List<UserDetails> users;

  public InMemoryUserDetailsService(List<UserDetails> users) {
    this.users = users;
  }

  @Override
  public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
    return users.stream()
        .filter(u -> u.getUsername().equals(username))
        .findFirst()
        .orElseThrow(() -> new UsernameNotFoundException("User not found"));
  }
}
```

### `UserDetailsManager`: `UserDetailsService` plus user-management operations

Authentication alone only needs `UserDetailsService`. Applications that also need to create, update, or delete users implement the wider `UserDetailsManager` contract instead:

```java
public interface UserDetailsManager extends UserDetailsService {
  void createUser(UserDetails user);
  void updateUser(UserDetails user);
  void deleteUser(String username);
  void changePassword(String oldPassword, String newPassword);
  boolean userExists(String username);
}
```

This split is a direct application of the interface segregation principle: an application that only authenticates users is never forced to implement `createUser`/`deleteUser`/etc. `InMemoryUserDetailsManager` — used to register a single demo user in `spring-security-authentication-architecture` — is a `UserDetailsManager`; only its `UserDetailsService` half was needed there.

## Trade-offs

- **A minimal `UserDetails` (`DummyUser`-style) is a teaching device, not a design** — every instance represents the same user, which defeats the purpose of an authentication system; real code needs at least username/password as instance state.
- **Implementing `UserDetailsManager` when `UserDetailsService` would do adds unused surface area** — five extra methods (`createUser`, `updateUser`, `deleteUser`, `changePassword`, `userExists`) that have to be implemented (even if only to throw `UnsupportedOperationException`) for an app that only ever authenticates, never provisions, users.
- **Mixing a JPA entity with `UserDetails` reads cleanly at first and gets worse with every relationship added** — the two-responsibility class in this Deep Dive is small; in practice, adding entity relationships (roles, audit fields) to a class that also satisfies a security contract compounds the confusion the decorator split avoids.
- **The `User` builder is convenient but implicit** — building a `UserDetails` inline hides the type from the rest of the codebase behind `User.withUsername(...)`, which is fine for a demo but makes it harder to later add fields that a dedicated class could hold as first-class state.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 3: "Managing users", p. 61-78](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — In-Memory Authentication (UserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/in-memory.html) — doc
- [Spring Security Reference — JDBC Authentication (JdbcUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/jdbc.html) — doc
- [Spring Security API — UserDetailsService](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/core/userdetails/UserDetailsService.html) — doc
