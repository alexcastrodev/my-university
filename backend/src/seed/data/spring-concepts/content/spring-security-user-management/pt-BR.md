---
version: 1.0
updatedAt: 2026-07-29
title: Gestão de Usuários no Spring Security
---
## Objective

Entenda como o Spring Security representa um usuário: o contrato `UserDetails` descreve credenciais e status da conta, `GrantedAuthority` descreve o que um usuário tem permissão para fazer, e `UserDetailsService`/`UserDetailsManager` descrevem como o framework encontra — e, na variante `Manager`, cria e modifica — usuários. Juntas, essas quatro interfaces são a metade de "gestão de usuários" do fluxo de autenticação apresentado em `spring-security-authentication-architecture`.

## Use Cases

- Envolver uma entidade JPA `User` existente em uma implementação `UserDetails` separada em vez de fazer a própria entidade implementar o contrato, mantendo as preocupações de persistência e as preocupações do Spring Security em classes diferentes.
- Escolher entre implementar `UserDetailsService` (busca somente leitura, suficiente apenas para autenticação) e `UserDetailsManager` (adiciona criar/atualizar/deletar/trocar senha) com base em se a aplicação realmente precisa gerenciar usuários, não apenas autenticá-los.
- Usar a classe builder `User` para produzir rapidamente uma instância `UserDetails` imutável em uma demo ou teste, sem escrever uma classe dedicada.
- Reconhecer por que uma entidade JPA que também implementa `UserDetails` diretamente tende a ficar difícil de ler — e aplicar a divisão em decorator (classe de entidade + wrapper `SecurityUser`) para corrigir isso.

## Deep Dive

### O contrato `UserDetails`: credenciais mais quatro flags de status da conta

`UserDetails` é o formato que o Spring Security espera que um usuário tenha. Apenas dois métodos carregam dados de autenticação; o resto rege autorização e status da conta:

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

Os quatro métodos `isXxx()` são todos formulados de modo que `true` significa "deixe essa conta passar" — `isAccountNonExpired()` ler como uma dupla negativa é proposital: a mente humana associa `true` ao caso positivo e `false` ao negativo, então cada um dos quatro métodos reprova a conta retornando `false`. Aplicações que não modelam expiração ou bloqueio simplesmente retornam `true` incondicionalmente nos quatro.

### `GrantedAuthority`: um método, nomeando um privilégio

`GrantedAuthority` representa um único privilégio que um usuário possui — leitura, escrita, ou um nome de ação específico da aplicação:

```java
public interface GrantedAuthority extends Serializable {
  String getAuthority();
}
```

Como tem exatamente um método abstrato, uma lambda já basta para implementá-la, embora `SimpleGrantedAuthority` seja a alternativa embutida e mais explícita:

```java
GrantedAuthority g1 = () -> "READ";
GrantedAuthority g2 = new SimpleGrantedAuthority("READ");
```

### Uma implementação mínima de `UserDetails`, depois uma real

A implementação mais simples possível retorna valores fixos para cada método — útil só para ver o formato do contrato:

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

Uma implementação prática recebe `username`/`password` como argumentos de construtor, de forma que cada instância possa representar um usuário diferente:

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

### O builder `User`: uma instância `UserDetails` sem uma classe dedicada

Para casos simples, o builder `User.withUsername(...)` do Spring Security produz uma instância `UserDetails` imutável sem declarar nenhuma classe:

```java
UserDetails u = User.withUsername("bill")
    .password("12345")
    .authorities("read", "write")
    .accountExpired(false)
    .disabled(true)
    .build();
```

`build()` aplica uma função opcional de codificação de senha, e então constrói a instância. O builder também pode partir de um `UserDetails` já existente (`User.withUserDetails(existing)`), útil para produzir uma cópia modificada.

### Separando a entidade JPA da implementação de `UserDetails`

Uma entidade JPA que também implementa `UserDetails` diretamente mistura duas responsabilidades em uma classe só — campos de persistência e getters/setters lado a lado com métodos do contrato de segurança com nomenclatura diferente (`getAuthority()` retornando uma `String`, `getAuthorities()` retornando uma `Collection` que implementa a interface):

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

Dividir isso em uma entidade JPA simples e um decorator separado restaura uma única responsabilidade por classe:

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

`SecurityUser` só faz sentido envolvendo um `User`, então o campo é `final` e obrigatório no construtor — a classe documenta sua própria dependência.

### `UserDetailsService`: um método, a única coisa que a autenticação estritamente precisa

```java
public interface UserDetailsService {
  UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}
```

O `AuthenticationProvider` chama esse método para encontrar um usuário pelo username; se não existir nenhum, ele lança `UsernameNotFoundException` (uma `RuntimeException` por baixo dos panos — a cláusula `throws` é só documentação, já que ela por fim estende `AuthenticationException`). Uma implementação mínima sobre uma lista em memória não precisa de mais nada:

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

### `UserDetailsManager`: `UserDetailsService` mais operações de gestão de usuário

A autenticação sozinha só precisa de `UserDetailsService`. Aplicações que também precisam criar, atualizar ou deletar usuários implementam o contrato mais amplo `UserDetailsManager`:

```java
public interface UserDetailsManager extends UserDetailsService {
  void createUser(UserDetails user);
  void updateUser(UserDetails user);
  void deleteUser(String username);
  void changePassword(String oldPassword, String newPassword);
  boolean userExists(String username);
}
```

Essa divisão é uma aplicação direta do princípio de segregação de interfaces: uma aplicação que só autentica usuários nunca é forçada a implementar `createUser`/`deleteUser`/etc. `InMemoryUserDetailsManager` — usada para registrar um único usuário de demonstração em `spring-security-authentication-architecture` — é um `UserDetailsManager`; só a sua metade `UserDetailsService` foi necessária ali.

## Trade-offs

- **Um `UserDetails` mínimo (estilo `DummyUser`) é um recurso didático, não um design** — toda instância representa o mesmo usuário, o que anula o propósito de um sistema de autenticação; código real precisa de pelo menos username/password como estado da instância.
- **Implementar `UserDetailsManager` quando `UserDetailsService` já resolveria adiciona superfície não usada** — cinco métodos extras (`createUser`, `updateUser`, `deleteUser`, `changePassword`, `userExists`) que precisam ser implementados (mesmo que só para lançar `UnsupportedOperationException`) para uma aplicação que só autentica, nunca provisiona, usuários.
- **Misturar uma entidade JPA com `UserDetails` parece limpo no começo e piora a cada relacionamento adicionado** — a classe de dupla responsabilidade neste Deep Dive é pequena; na prática, adicionar relacionamentos de entidade (papéis, campos de auditoria) a uma classe que também satisfaz um contrato de segurança amplia a confusão que a divisão em decorator evita.
- **O builder `User` é conveniente, mas implícito** — construir um `UserDetails` inline esconde o tipo do resto da base de código atrás de `User.withUsername(...)`, o que é aceitável para uma demo, mas dificulta adicionar depois campos que uma classe dedicada poderia manter como estado de primeira classe.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 3: "Managing users", p. 61-78](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — In-Memory Authentication (UserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/in-memory.html) — doc
- [Spring Security Reference — JDBC Authentication (JdbcUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/jdbc.html) — doc
- [Spring Security API — UserDetailsService](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/core/userdetails/UserDetailsService.html) — doc
