---
version: 1.0
updatedAt: 2026-07-27
title: Autoconfiguração do Spring Boot
---
## Objective

Entenda como o Spring Boot remove quase toda a fiação (wiring) explícita de uma aplicação Spring: uma única classe anotada com `@SpringBootApplication`, mais um punhado de dependências *starter* no classpath, já bastam para o Spring Boot adivinhar quais beans a aplicação precisa e configurá-los automaticamente — uma técnica chamada *autoconfiguração*.

## Use Cases

- Bootstrapar uma nova aplicação web sem escrever um `DispatcherServlet`, um servidor embarcado ou configuração de `ObjectMapper` na mão — adicionar `spring-boot-starter-web` já é suficiente.
- Deixar que a presença de um JAR de driver (por exemplo, um driver JDBC) no classpath decida se um bean `DataSource` é criado, em vez de conectá-lo manualmente em cada projeto.
- Sobrescrever uma peça autoconfigurada (um `PasswordEncoder` customizado, um `ObjectMapper` customizado) mantendo o resto no caminho padrão — a autoconfiguração recua quando você fornece seu próprio bean.
- Raciocinar sobre uma dependência em termos da *capacidade* que ela adiciona (web, security, data JPA) em vez de decorar quais bibliotecas e versões individuais precisam ser declaradas juntas.

## Deep Dive

### `@SpringBootApplication` é três anotações em uma

A classe de bootstrap precisa de quase nenhum código — seu poder vem de uma única anotação composta:

```java
package tacos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TacoCloudApplication {

  public static void main(String[] args) {
    SpringApplication.run(TacoCloudApplication.class, args);
  }
}
```

`@SpringBootApplication` combina:

- `@SpringBootConfiguration` — uma `@Configuration` especializada, marcando a classe como fonte de definições de bean.
- `@EnableAutoConfiguration` — diz ao Spring Boot para configurar automaticamente os beans que ele acredita que a aplicação precisa, com base no classpath e nas definições de bean já existentes.
- `@ComponentScan` — descobre `@Component`, `@Controller`, `@Service`, etc. no pacote (e subpacotes) da classe anotada.

`SpringApplication.run()` é o que de fato inicializa o application context, passando a classe de configuração e os argumentos de linha de comando.

### Dependências starter empacotam capacidades, não apenas bibliotecas

Um starter (`spring-boot-starter-web`, `spring-boot-starter-data-jpa`, …) é um descritor de dependência sem código de biblioteca próprio — ele traz transitivamente tudo que é necessário para aquela capacidade, em versões que o POM pai `spring-boot-starter-parent` já validou em conjunto:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Adicionar essa única dependência traz o Spring MVC, um contêiner servlet embarcado e o Jackson — sem fixar um único número de versão no arquivo de build. O elemento `<parent>` (`spring-boot-starter-parent`) é quem fornece esse gerenciamento de versão; o POM filho só escolhe *quais* starters incluir.

### A autoconfiguração só age quando mais nada já fez o trabalho

Classes de autoconfiguração são classes `@Configuration` comuns, mas cada método `@Bean` dentro delas é protegido por anotações condicionais — mais comumente `@ConditionalOnClass` (uma classe precisa estar no classpath) e `@ConditionalOnMissingBean` (nenhum bean daquele tipo já foi definido):

```java
@Configuration
@ConditionalOnClass(DataSource.class)
class DataSourceAutoConfiguration {

  @Bean
  @ConditionalOnMissingBean
  DataSource dataSource(DataSourceProperties properties) {
    return properties.initializeDataSourceBuilder().build();
  }
}
```

É por isso que definir seu próprio `@Bean` de um determinado tipo já basta para desativar a autoconfiguração correspondente — o Spring Boot recua em vez de produzir um bean duplicado ou conflitante.

### O component scanning encontra o que a autoconfiguração não fornece

A autoconfiguração cuida dos beans de infraestrutura (um `DataSource`, um `PasswordEncoder`); ela não sabe nada sobre classes específicas da aplicação. O `@ComponentScan` (embutido dentro de `@SpringBootApplication`) é quem descobre um controller escrito à mão:

```java
package tacos;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class HomeController {

  @GetMapping("/")
  public String home() {
    return "home";
  }
}
```

Como `HomeController` fica no mesmo pacote da classe `@SpringBootApplication` (ou em um subpacote), o component scanning o pega automaticamente — sem necessidade de registro explícito de bean.

### O livro vs. hoje

O livro (5ª edição, 2019) mira o Spring Boot 2.0.4 e o Java 8 — os screenshots do Initializr mostram um dropdown de versão Java `1.8` e imports `javax.*`. O Spring Boot atual (3.x) exige Java 17+ como base, migrou para o namespace `jakarta.*` (Jakarta EE 9+), e a lista de dependências do Initializr cresceu de acordo (suporte a native image/GraalVM, `spring-boot-docker-compose`, e assim por diante). O *mecanismo* descrito aqui — `@SpringBootApplication`, starters, `@ConditionalOnClass`/`@ConditionalOnMissingBean` — permanece inalterado; só os nomes concretos de pacote e a versão mínima do Java avançaram.

## Trade-offs

- **Convenção em troca de visibilidade** — a autoconfiguração elimina boilerplate, mas "por que esse bean está aqui?" é genuinamente mais difícil de responder do que com métodos `@Bean` explícitos; você precisa conhecer as regras condicionais para prever o resultado para um determinado classpath.
- **`@ConditionalOnMissingBean` é a válvula de escape** — definir seu próprio bean do mesmo tipo já basta para sobrescrever um bean autoconfigurado, então o framework é totalmente sobrescrevível, um bean de cada vez:

```java
@Bean
DataSource dataSource() {
  return new HikariDataSource(myCustomConfig); // autoconfigured DataSource backs off
}
```

- **Empacotamento JAR-first é uma escolha deliberada da era cloud** — o Spring Initializr define por padrão novos projetos para empacotamento em JAR executável (servidor embarcado) em vez de WAR, o que se encaixa bem em deploy em container/cloud, mas é uma mudança mental para quem está acostumado a fazer deploy de WARs em um servidor de aplicação standalone.

## Documentation Links

- [Spring in Action, 5th Edition (Manning, 2019) — Chapter 1: "Getting started with Spring", p. 3-18](https://www.manning.com/books/spring-in-action-fifth-edition) — doc
- [Spring Boot Reference — Using Spring Boot](https://docs.spring.io/spring-boot/reference/using/index.html) — doc
- [Spring Boot Reference — Auto-configuration](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html) — doc
- [Spring Initializr](https://start.spring.io) — doc
