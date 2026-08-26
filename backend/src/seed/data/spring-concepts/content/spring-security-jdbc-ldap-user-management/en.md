---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

`UserDetailsManager` extends `UserDetailsService` with the write side of user
management (create, update, delete, change password). Spring Security ships two
production-oriented implementations beyond the in-memory one: `JdbcUserDetailsManager`,
which manages users in a relational database over plain JDBC, and
`LdapUserDetailsManager`, which authenticates against an LDAP directory. Both plug
into the same `AuthenticationProvider` → `UserDetailsService` flow described by the
`UserDetails`/`UserDetailsService` architecture — only the storage backend changes.

## Use Cases

- An application that already has a relational database and wants Spring Security to
  read/write users without a custom repository layer or ORM mapping.
- An enterprise application that must authenticate against an existing corporate
  directory (Active Directory, OpenLDAP) instead of owning its own user store.
- Renaming or reshaping the user/authority tables to fit an existing schema, instead
  of adopting `JdbcUserDetailsManager`'s default table layout.

## Deep Dive

### The UserDetailsManager contract

```java
public interface UserDetailsManager extends UserDetailsService {
    void createUser(UserDetails user);
    void updateUser(UserDetails user);
    void deleteUser(String username);
    void changePassword(String oldPassword, String newPassword);
    boolean userExists(String username);
}
```

`InMemoryUserDetailsManager` (used for the first hands-on example in this book)
already implements this — `loadUserByUsername()` comes from `UserDetailsService`,
and `createUser()`/`deleteUser()`/etc. come from `UserDetailsManager`.

### JdbcUserDetailsManager

`JdbcUserDetailsManager` talks to the database directly via JDBC, independent of any
ORM. Wired as the `UserDetailsService` bean, it just needs a `DataSource`:

```java
@Bean
public UserDetailsService userDetailsService(DataSource dataSource) {
    return new JdbcUserDetailsManager(dataSource);
}
```

By default it expects a `users` table (`username`, `password`, `enabled`) and an
`authorities` table (`username`, `authority`) — the exact names and columns the
built-in queries target.

### Overriding the default queries

When the schema doesn't match those defaults, override the two lookup queries
instead of renaming your tables:

```java
@Bean
public UserDetailsService userDetailsService(DataSource dataSource) {
    var userDetailsManager = new JdbcUserDetailsManager(dataSource);
    userDetailsManager.setUsersByUsernameQuery(
        "select username, password, enabled from users where username = ?");
    userDetailsManager.setAuthoritiesByUsernameQuery(
        "select username, authority from spring.authorities where username = ?");
    return userDetailsManager;
}
```

Each query takes the username as its single `?` parameter and must return exactly
the columns `JdbcUserDetailsManager` expects, in order.

### LdapUserDetailsManager

For directory-backed authentication, `LdapUserDetailsManager` takes a context
source pointing at the LDAP server plus mappers describing how usernames map to
directory entries:

```java
@Bean
public UserDetailsService userDetailsService() {
    var cs = new DefaultSpringSecurityContextSource(
        "ldap://127.0.0.1:33389/dc=springframework,dc=org");
    cs.afterPropertiesSet();

    var manager = new LdapUserDetailsManager(cs);
    manager.setUsernameMapper(
        new DefaultLdapUsernameToDnMapper("ou=groups", "uid"));
    manager.setGroupSearchBase("ou=groups");
    return manager;
}
```

For development, Spring Boot can start an embedded LDAP server from an LDIF file
(`spring.ldap.embedded.ldif`, `.base-dn`, `.port`) instead of requiring a real
directory — useful for local testing without provisioning infrastructure.

## Trade-offs

- **`JdbcUserDetailsManager`'s default schema is convenient until it isn't.** It
  saves writing a repository, but only for the exact `users`/`authorities` shape it
  expects; any deviation means overriding both queries by hand, and getting the
  column order wrong fails silently at authentication time rather than at startup.
- **LDAP only pays off when a directory already exists.** Standing up
  `LdapUserDetailsManager` for an application with no pre-existing corporate
  directory adds a protocol, a context source, and username-to-DN mapping for no
  benefit over `JdbcUserDetailsManager` — it's a fit for integrating with what's
  already there, not a default choice.
- **`NoOpPasswordEncoder` in these examples is illustrative only.** The book uses it
  to keep the JDBC/LDAP examples focused, but storing passwords in cleartext is
  never acceptable outside a demo — the next chapter's `PasswordEncoder`
  implementations (`BCryptPasswordEncoder`, etc.) are what a real configuration
  should use instead.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 3,
  "Managing users", sections 3.3.3-3.4, p. 78-85 — doc
- [Spring Security Reference — JDBC Authentication (JdbcUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/jdbc.html) — doc
- [Spring Security Reference — LDAP Authentication (LdapUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/ldap.html) — doc
- [Spring Boot Reference — Data Initialization (spring.sql.init.mode)](https://docs.spring.io/spring-boot/how-to/data-initialization.html) — doc
- [MySQL — Connector/J's new Maven coordinates (com.mysql:mysql-connector-j)](https://blogs.oracle.com/mysql/mysql-connectorj-has-new-maven-coordinates) — doc
