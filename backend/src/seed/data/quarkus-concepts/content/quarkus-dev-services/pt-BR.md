---
version: 1.0
updatedAt: 2026-08-22
title: "Quarkus Dev Services: Containers com Configuração Zero para Dev e Teste"
summary: "O Dev Services inicia automaticamente infraestrutura apoiada em Testcontainers (Postgres, Kafka, Redis, e mais) sempre que uma extensão está presente, mas nenhuma conexão está configurada, incluindo scripts de inicialização privilegiados para coisas como CREATE EXTENSION."
---
## Objective

O Dev Services é a resposta do Quarkus para "eu adicionei uma dependência de banco de dados, agora preciso instalar e configurar um banco de dados antes de sequer conseguir rodar a aplicação". Quando uma extensão como `quarkus-datasource-postgresql` está no classpath e nenhuma URL de conexão está configurada, o Quarkus automaticamente inicia um container Testcontainers correspondente, conecta o datasource a ele, e o derruba quando a aplicação para, sem boilerplate algum de teste ou modo de desenvolvimento.

## Use Cases

- Rodar `quarkus:dev` em um checkout novo, sem instalação local de Postgres/Kafka/Redis; o container simplesmente aparece.
- Testes de integração que precisam de um banco de dados real (não H2, não mocks) sem um campo `@Container` do Testcontainers e gerenciamento de ciclo de vida em toda classe de teste.
- Inicializar um banco de dados com extensões de schema (como PostGIS) ou dados de semeadura antes de o Hibernate ou o Flyway sequer tocá-lo, via um script de inicialização que roda com privilégios elevados.
- Compartilhar um container entre vários serviços em uma sessão de desenvolvimento multi-módulo, em vez de cada um subir o seu próprio.

## Deep Dive

### A regra de ativação

O Dev Services ativa quando uma extensão está presente **e** a propriedade de conexão externa correspondente está ausente:

```properties
# no quarkus.datasource.jdbc.url set -> Dev Services starts a Postgres container automatically
```

No momento em que você define `quarkus.datasource.jdbc.url` (ou o perfil `%prod` está ativo), o Dev Services se afasta e sua configuração explícita assume o controle; o mesmo `application.properties` funciona sem mudanças de um laptop até um datasource de produção real.

### Escolhendo a imagem do container

```properties
quarkus.datasource.devservices.image-name=docker.io/library/postgres:18
quarkus.datasource.devservices.port=5432
```

Sem `port` definido, o Quarkus escolhe uma porta de host livre aleatória, para que múltiplas sessões de desenvolvimento não colidam.

### Scripts de inicialização, incluindo privilegiados

Um script SQL do classpath pode rodar contra o container recém-iniciado antes de a aplicação se conectar; a variante privilegiada roda com uma conta elevada, o que importa para statements como `CREATE EXTENSION`, que um usuário de aplicação normal não pode executar:

```properties
quarkus.datasource.devservices.init-script-path=db/init.sql
quarkus.datasource.devservices.init-privileged-script-path=db/setup-extensions.sql
```

```sql
-- db/setup-extensions.sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

É exatamente assim que um container Postgres do Dev Services se torna um container PostGIS funcional, sem nenhum passo manual de `docker run`; o script privilegiado instala a extensão no momento em que o container sobe, antes de o Hibernate criar o schema.

### Desligando, ou reutilizando entre reinícios

```properties
# global kill switch
quarkus.devservices.enabled=false

# per-service kill switch
quarkus.datasource.devservices.enabled=false
```

Por padrão, um container é derrubado quando a sessão de desenvolvimento ou a execução de teste termina. Optar pela reutilização o mantém rodando entre reinícios (iteração mais rápida, ao custo de o estado carregar de uma execução para a outra):

```properties
quarkus.datasource.devservices.reuse=true
```

```properties
# ~/.testcontainers.properties
testcontainers.reuse.enable=true
```

### Compartilhando um container entre serviços

```properties
quarkus.kafka.devservices.shared=true
quarkus.kafka.devservices.service-name=kafka
```

Com `shared=true`, o Quarkus procura por um container rodando, rotulado `quarkus-dev-service-kafka` com um nome de serviço correspondente, antes de iniciar um novo; útil quando vários microsserviços no mesmo ambiente de desenvolvimento querem todos "um Kafka", não um cada.

## Trade-offs

- **Pegada zero em produção, por design**: a lógica do Dev Services vive inteiramente nos módulos `deployment` de tempo de build do Quarkus; ela não vai para o artefato de produção, então não há risco de um caminho de código que inicia containers acabar chegando à produção.
- **Um timeout padrão de 60 segundos na inicialização pode morder em uma máquina lenta ou uma imagem grande**: um container que demora mais para baixar ou inicializar falha a inicialização inteira da aplicação, a menos que você o eleve explicitamente:
```properties
quarkus.devservices.timeout=120
```
- **Reutilização troca reprodutibilidade por velocidade**: com `reuse=true`, uma execução de teste pode herdar estado (linhas, deriva de schema) deixado de uma execução anterior, já que "o Quarkus não vai resetar o estado do banco de dados entre execuções a menos que você configure explicitamente para isso". Bom para iteração local rápida, arriscado para CI, onde um estado limpo importa.
- **É uma conveniência de desenvolvimento/teste, não uma ferramenta de deploy**: o container que ele inicia é infraestrutura genuinamente efêmera; nada no Dev Services ajuda você a rodar Postgres em produção, e recorrer a ele ali é um erro de categoria.

## Documentation Links

- [Guia Dev Services: Quarkus](https://quarkus.io/guides/dev-services) (doc)
