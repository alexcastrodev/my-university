---
version: 1.0
updatedAt: 2026-07-30
title: Gerenciamento de Usuários JDBC e LDAP no Spring Security
---
## Objective

`UserDetailsManager` estende `UserDetailsService` com o lado de escrita do
gerenciamento de usuários (criar, atualizar, apagar, mudar senha). O Spring
Security entrega duas implementações voltadas para produção além da
in-memory: `JdbcUserDetailsManager`, que gerencia usuários num banco de
dados relacional via JDBC puro, e `LdapUserDetailsManager`, que autentica
contra um diretório LDAP. Ambos se encaixam no mesmo fluxo
`AuthenticationProvider` → `UserDetailsService` descrito pela arquitetura de
`UserDetails`/`UserDetailsService` — só o backend de armazenamento muda.

## Use Cases

- Uma aplicação que já tem um banco de dados relacional e quer que o Spring
  Security leia/escreva usuários sem uma camada de repositório customizada
  ou mapeamento ORM.
- Uma aplicação corporativa que precisa autenticar contra um diretório
  corporativo existente (Active Directory, OpenLDAP) em vez de possuir seu
  próprio user store.
- Renomear ou remodelar as tabelas de usuário/authority para se encaixar num
  schema existente, em vez de adotar o layout de tabela default do
  `JdbcUserDetailsManager`.

## Deep Dive

### O contrato UserDetailsManager

```java
public interface UserDetailsManager extends UserDetailsService {
    void createUser(UserDetails user);
    void updateUser(UserDetails user);
    void deleteUser(String username);
    void changePassword(String oldPassword, String newPassword);
    boolean userExists(String username);
}
```

`InMemoryUserDetailsManager` (usado no primeiro exemplo prático deste
livro) já implementa isso — `loadUserByUsername()` vem de
`UserDetailsService`, e `createUser()`/`deleteUser()`/etc. vêm de
`UserDetailsManager`.

### JdbcUserDetailsManager

`JdbcUserDetailsManager` fala com o banco de dados diretamente via JDBC,
independente de qualquer ORM. Conectado como o bean `UserDetailsService`,
só precisa de um `DataSource`:

```java
@Bean
public UserDetailsService userDetailsService(DataSource dataSource) {
    return new JdbcUserDetailsManager(dataSource);
}
```

Por padrão ele espera uma tabela `users` (`username`, `password`,
`enabled`) e uma tabela `authorities` (`username`, `authority`) — os nomes
e colunas exatos que as queries embutidas visam.

### Sobrescrevendo as queries default

Quando o schema não combina com esses defaults, sobrescreva as duas
queries de lookup em vez de renomear suas tabelas:

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

Cada query recebe o username como seu único parâmetro `?` e precisa
retornar exatamente as colunas que `JdbcUserDetailsManager` espera, na
ordem.

### LdapUserDetailsManager

Para autenticação baseada em diretório, `LdapUserDetailsManager` recebe um
context source apontando para o servidor LDAP mais mappers descrevendo
como usernames mapeiam para entradas do diretório:

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

Para desenvolvimento, o Spring Boot consegue subir um servidor LDAP
embarcado a partir de um arquivo LDIF (`spring.ldap.embedded.ldif`,
`.base-dn`, `.port`) em vez de exigir um diretório de verdade — útil para
testes locais sem provisionar infraestrutura.

## Trade-offs

- **O schema default do `JdbcUserDetailsManager` é conveniente até deixar
  de ser.** Poupa escrever um repositório, mas só para o formato exato
  `users`/`authorities` que ele espera; qualquer desvio significa
  sobrescrever as duas queries à mão, e errar a ordem das colunas falha
  silenciosamente no momento da autenticação em vez de na inicialização.
- **LDAP só compensa quando um diretório já existe.** Levantar um
  `LdapUserDetailsManager` para uma aplicação sem diretório corporativo
  pré-existente adiciona um protocolo, um context source, e mapeamento
  username-para-DN sem nenhum benefício sobre `JdbcUserDetailsManager` — é
  uma opção para integrar com o que já existe, não uma escolha default.
- **`NoOpPasswordEncoder` nesses exemplos é apenas ilustrativo.** O livro o
  usa para manter os exemplos de JDBC/LDAP focados, mas armazenar senhas em
  texto claro nunca é aceitável fora de uma demo — as implementações de
  `PasswordEncoder` do próximo capítulo (`BCryptPasswordEncoder`, etc.) são
  o que uma configuração real deveria usar em vez disso.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 3,
  "Managing users", sections 3.3.3-3.4, p. 78-85 — doc
- [Spring Security Reference — JDBC Authentication (JdbcUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/jdbc.html) — doc
- [Spring Security Reference — LDAP Authentication (LdapUserDetailsManager)](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/ldap.html) — doc
- [Spring Boot Reference — Data Initialization (spring.sql.init.mode)](https://docs.spring.io/spring-boot/how-to/data-initialization.html) — doc
- [MySQL — Connector/J's new Maven coordinates (com.mysql:mysql-connector-j)](https://blogs.oracle.com/mysql/mysql-connectorj-has-new-maven-coordinates) — doc
