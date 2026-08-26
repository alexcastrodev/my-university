---
version: 1.0
updatedAt: 2026-08-04
title: Configuração Específica por Ambiente com Spring Profiles
---
## Objective

A configuração de uma aplicação raramente serve igualmente para todos os
ambientes — desenvolvimento quer um banco de dados embarcado, rápido e
descartável, e logging verboso; produção quer um banco de dados de verdade e
logs silenciosos. Os Spring profiles permitem que os dois conjuntos de
propriedades (e até beans inteiros) convivam no mesmo código-fonte, lado a
lado, alternando entre eles com base em qual profile está ativo em runtime, em
vez de depender de quais propriedades por acaso estão presentes.

## Use Cases

- Usar um banco de dados H2 embarcado com logging em nível `DEBUG` durante o
  desenvolvimento, enquanto uma instância de produção implantada usa um banco
  de dados MySQL externo com logging em nível `WARN` — sem manter dois builds
  separados.
- Carregar dados de seed/teste automaticamente na inicialização em
  desenvolvimento e QA, mas nunca em produção, a partir da mesma definição de
  bean `CommandLineRunner`.
- Agrupar vários profiles relacionados (um profile de banco de dados, um
  profile de message queue) sob um nome, para que ativar uma única flag ligue
  toda a configuração de um ambiente de uma vez.

## Deep Dive

### O problema que os profiles resolvem: um arquivo de config, vários ambientes

Definir propriedades de configuração como variáveis de ambiente simples
funciona, mas fica difícil de manejar rapidamente — mais de uma ou duas
propriedades por ambiente vira uma penca de comandos `export` manuais, sem
rastreamento ou rollback fácil:

```bash
% export SPRING_DATASOURCE_URL=jdbc:mysql://localhost/tacocloud
% export SPRING_DATASOURCE_USERNAME=tacouser
% export SPRING_DATASOURCE_PASSWORD=tacopassword
```

Profiles são configuração condicional: um conjunto de beans, classes de
configuração e propriedades que só se aplicam quando um determinado nome de
profile está ativo — permitindo que o mesmo `application.yml` carregue tanto
um default amigável para desenvolvimento quanto uma sobreposição de produção,
em vez de escolher um ou outro.

### Definindo propriedades específicas por profile: um arquivo dedicado por profile

A abordagem mais direta é um arquivo separado por profile, nomeado
`application-{nome do profile}.yml` (ou `.properties`):

```yaml
# application-prod.yml
spring:
  datasource:
    url: jdbc:mysql://localhost/tacocloud
    username: tacouser
    password: tacopassword
logging:
  level:
    tacos: WARN
```

Só precisam aparecer aqui as propriedades que diferem do padrão — qualquer
coisa não sobreposta num arquivo específico de profile cai de volta para o que
o próprio `application.yml` já define.

### Ativando um profile: em qualquer lugar exceto o documento default do próprio application.yml

Definir propriedades de profile não faz nada até que um profile esteja
realmente ativo. Definir `spring.profiles.active` dentro da seção default do
`application.yml` funciona tecnicamente, mas anula o propósito — vira o
default permanente para todo ambiente, não só um. O livro recomenda defini-lo
totalmente fora do arquivo de propriedades: como uma variável de ambiente,

```bash
% export SPRING_PROFILES_ACTIVE=prod
```

ou como um argumento de linha de comando ao rodar um JAR executável:

```bash
% java -jar taco-cloud.jar --spring.profiles.active=prod
```

O nome da propriedade estar no plural — `profiles`, não `profile` — reflete
que mais de um pode estar ativo simultaneamente, como uma lista separada por
vírgulas:

```bash
% export SPRING_PROFILES_ACTIVE=prod,audit,ha
```

### Criando beans condicionalmente: @Profile

Profiles não se limitam a valores de propriedade — um `@Bean` inteiro (ou uma
classe `@Configuration` inteira) pode ser restrito a profiles específicos com
`@Profile`:

```java
@Bean
@Profile("dev")
public CommandLineRunner dataLoader(IngredientRepository repo,
      UserRepository userRepo, PasswordEncoder encoder) {
    // seeds the embedded database with development data
}
```

`@Profile` aceita uma lista (o bean é criado se *qualquer* profile listado
estiver ativo) e expressões de profile com `!` para negar:

```java
@Bean
@Profile({"dev", "qa"})
public CommandLineRunner dataLoader(/* ... */) { /* ... */ }

@Bean
@Profile("!prod")
public CommandLineRunner dataLoader(/* ... */) { /* ... */ }
```

`@Profile("!prod")` se lê como "cria este bean a menos que `prod` esteja
ativo" — um formato comum para qualquer coisa (como carregamento de dados de
seed) que deveria rodar em todo lugar exceto em produção.

## Trade-offs

- **Um arquivo `application-{profile}.yml` separado por profile é a
  abordagem mais clara, mas escala mal para muitos arquivos.** Para um punhado
  de ambientes, mantém as propriedades de cada profile fáceis de ler
  isoladamente; para muitos profiles, um único `application.yml`
  multi-documento (veja a nota de livro-vs-hoje abaixo) pode ser mais fácil de
  revisar como um arquivo só, ao custo de mais ruído visual por limite de
  documento.
- **Definir `spring.profiles.active` dentro da própria seção default do
  `application.yml` anula silenciosamente o propósito de usar profiles.** Vira
  um default fixo embutido no artefato implantado, em vez de algo que o
  ambiente controla — o livro é explícito que isso é quase a pior forma de
  ativar um profile, precisamente porque remove a capacidade do ambiente de
  escolher.
  ```yaml
  # anti-pattern: bakes "prod" in as the default for every environment
  spring:
    profiles:
      active:
        - prod
  ```
- **A negação de `@Profile` (`!prod`) é fácil de interpretar errado como
  "somente quando nada está ativo" em vez de "ativo a menos que este profile
  específico esteja".** Com nenhum profile ativo de forma alguma, um bean
  anotado com `@Profile("!prod")` *é* criado (já que `prod` não está ativo) —
  vale a pena conferir contra o conjunto real de profiles ativos num dado
  ambiente em vez de assumir só pela annotation.
- **Livro vs. hoje: a sintaxe YAML multi-documento do livro para declarar a
  qual profile pertence cada seção não faz mais parse.** O livro mostra
  `spring.profiles: prod` sob um documento separado por `---` como a forma de
  manter propriedades específicas de profile dentro do mesmo
  `application.yml`, em vez de um arquivo separado:
  ```yaml
  # book's syntax — no longer valid
  logging:
    level:
      tacos: DEBUG
  ---
  spring:
    profiles: prod
    datasource:
      url: jdbc:mysql://localhost/tacocloud
  ```
  Confirmado pela referência atual do Spring Boot: `spring.profiles` dentro de
  um cabeçalho de documento foi substituído por
  `spring.config.activate.on-profile`, e a sintaxe antiga é explicitamente
  apontada como inválida na documentação atual. A configuração equivalente
  hoje é:
  ```yaml
  logging:
    level:
      tacos: DEBUG
  ---
  spring:
    config:
      activate:
        on-profile: "prod"
  datasource:
    url: jdbc:mysql://localhost/tacocloud
  ```
  Arquivos `application-{profile}.yml` separados (a outra técnica do livro,
  descrita acima) não são afetados — esse mecanismo permanece inalterado.
- **Livro vs. hoje (capacidade nova, não uma correção): grupos de profile.**
  Desde o Spring Boot 2.4 (depois da publicação deste livro),
  `spring.profiles.group` permite que um nome de profile se expanda em vários
  na ativação — ativar um único profile `production` pode ligar `proddb` e
  `prodmq` juntos, em vez de precisar listar cada nome de profile
  individualmente na linha de comando ou numa variável de ambiente:
  ```yaml
  spring:
    profiles:
      group:
        production:
          - "proddb"
          - "prodmq"
  ```
  ```bash
  # activates production, proddb, and prodmq all at once
  % java -jar app.jar --spring.profiles.active=production
  ```
  O comportamento de `@Profile` em nível de método e classe, e o próprio
  mecanismo de ativação de `spring.profiles.active`, permanecem inalterados
  desde o livro.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 5, "Working with configuration properties", section 5.3, p. 129-133 — doc
- [Spring Boot Reference — Profiles](https://docs.spring.io/spring-boot/reference/features/profiles.html) — doc
- [Spring Boot Reference — Externalized Configuration (Multi-Document Files, spring.config.activate.on-profile)](https://docs.spring.io/spring-boot/reference/features/external-config.html) — doc
- [Spring Framework API — @Profile](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/context/annotation/Profile.html) — doc
