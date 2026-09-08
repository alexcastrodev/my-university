---
version: 1.0
updatedAt: 2026-08-17
title: "Pré-requisitos de Teste de Banco de Dados e Gerenciamento de Transações"
summary: "Por que o schema e os dados de referência pertencem ao controle de versão, por que a entrega baseada em migração vence a baseada em estado assim que dados reais existem (o argumento de movimentação de dados), e por que testes de integração precisam de uma transação separada por seção de arrange/act/assert em vez de reutilizar uma única sessão."
---
## Objective

Testar contra um banco de dados real e gerenciado (veja o conceito irmão `managed-vs-unmanaged-dependencies` para entender por que mockar esse tipo de dependência é a decisão errada) exige preparação antes que o primeiro teste de integração seja escrito: o próprio schema precisa ser reproduzível e versionado, e tanto o código de produção quanto o código de teste precisam de disciplinas próprias, e diferentes, em torno das transações de banco de dados. Errar essa disciplina transacional nos testes não só os torna instáveis; faz com que passem quando o caminho real de código de produção teria falhado.

## Use Cases

- Escolher entre migrações no estilo Flyway/Liquibase e uma ferramenta de "comparar dois bancos e gerar um script de diff" ao definir como um time entrega mudanças de schema.
- Revisar uma mudança de schema que divide uma coluna em duas e reconhecer que uma ferramenta de migração precisa de um script de transformação de dados escrito à mão, não apenas de um diff estrutural.
- Introduzir uma separação repositório/unit-of-work em um controller que atualmente abre uma nova conexão de banco de dados por chamada, para tornar uma operação de negócio de múltiplos passos atômica.
- Revisar um teste de integração que reutiliza um único `EntityManager`/sessão JPA em suas seções de arrange, act e assert, e reconhecer por que isso esconde bugs que um caminho de código de produção de fato encontraria.

## Deep Dive

### Schema e dados de referência pertencem ao controle de versão

Trate o schema do banco de dados (tabelas, views, índices, stored procedures) como código-fonte: guarde-o no Git, não como uma instância "modelo de banco de dados" isolada que o time compara contra a produção com uma ferramenta de diff. Um banco de dados modelo não tem histórico de mudanças (não dá para reconstruir como o schema estava em um ponto passado, o que importa ao reproduzir um bug de produção) e vira uma segunda fonte de verdade, concorrente com o Git.

**Dados de referência fazem parte do schema, não são dados regulares**, mesmo vivendo em uma tabela ao lado de linhas que a aplicação de fato modifica. O teste distintivo: se a aplicação pode modificar o dado, é dado regular; se só uma migração pode, é dado de referência (uma tabela de consulta tipo enum de tipos de usuário, por exemplo). Dados de referência são entregues como comandos `INSERT` dentro das migrações, da mesma forma que mudanças estruturais.

Dê a cada desenvolvedor uma instância de banco de dados local e separada em vez de compartilhar uma: uma instância compartilhada significa que a execução de teste de um desenvolvedor corrompe a de outro, e uma mudança de schema não retrocompatível bloqueia o trabalho de todos os outros simultaneamente.

### Entrega baseada em migração vence a baseada em estado, por causa da movimentação de dados

```
Baseada em estado: scripts SQL descrevem o estado final desejado; uma ferramenta de
                   comparação gera o diff contra o banco de dados ativo e produz o
                   script de upgrade para você. O estado é explícito, o mecanismo de
                   migração é implícito.

Baseada em migração: você escreve cada passo de upgrade (Flyway, Liquibase, ou uma
                   biblioteca de DSL de migração) explicitamente; o estado atual do
                   banco de dados só é reconstruído reproduzindo as migrações em
                   ordem. As migrações são explícitas, o estado é implícito.
```

A ferramenta de diff da abordagem baseada em estado é boa em gerar um diff *estrutural* (adicionar esta coluna, remover aquele índice), mas não tem ideia do que fazer com os *dados* já existentes nas colunas que está reestruturando; dividir uma coluna `name` em `first_name`/`last_name` precisa de um script que de fato redistribua os valores existentes, algo que nenhuma ferramenta de comparação consegue inferir com segurança. Khorikov chama isso de **movimentação de dados** e argumenta que ela domina esse trade-off em qualquer projeto com dados reais de produção: a abordagem baseada em estado é aceitável antes do lançamento (quando ainda não há dado real a preservar), mas a abordagem baseada em migração se torna necessária no momento em que existe dado que não pode simplesmente ser regenerado. Uma vez em migrações: nunca edite uma migração já commitada depois do fato; escreva uma nova para corrigir um erro, a menos que a original arrisque perda real de dados.

### Código de produção: separe "o que atualizar" de "se deve fazer commit"

```java
public class UserController {
    private final Transaction transaction;
    private final UserRepository userRepository;
    private final CompanyRepository companyRepository;

    public UserController(Transaction transaction, MessageBus messageBus, DomainLogger logger) {
        this.transaction = transaction;
        this.userRepository = new UserRepository(transaction);
        this.companyRepository = new CompanyRepository(transaction);
        // ...
    }

    public String changeEmail(long userId, String newEmail) {
        User user = userRepository.getUserById(userId);
        String error = user.canChangeEmail();
        if (error != null) return error;

        Company company = companyRepository.getCompany();
        user.changeEmail(newEmail, company);

        companyRepository.saveCompany(company);
        userRepository.saveUser(user);
        // ...

        transaction.commit();   // only reached on the happy path
        return "OK";
    }
}
```

Uma classe `Database` que abre uma conexão nova (e, portanto, uma transação implícita nova) a cada chamada de método significa que uma operação de negócio de múltiplos passos (ler o usuário, ler a empresa, salvar a empresa, salvar o usuário) se espalha por várias transações independentes. Se o processo travar entre os dois `save`, as tabelas de empresa e usuário terminam inconsistentes, sem forma de desfazer a primeira escrita. A correção é dividir responsabilidades: **repositórios** cuidam do acesso a dados e têm vida curta (criados e descartados a cada chamada), enquanto uma **transação** (ou, de forma mais poderosa, uma **unit of work**) abrange a operação de negócio inteira e só recebe commit depois que cada passo tiver dado certo. O `commit()` fica bem no final do método justamente para que qualquer retorno antecipado (um erro de validação, uma exceção) o pule, e a transação desfaça tudo. A maioria dos ORMs (o `EntityManager` do Hibernate/JPA é o análogo direto do `DbContext`/`ISession` do livro) já implementa o padrão unit-of-work para você, adicionalmente adiando todas as escritas para um único flush no final da operação, em vez de emiti-las de forma incremental.

### Testes precisam de uma regra mais rígida: nunca reutilize uma transação entre seções

```java
// Wrong: one EntityManager spans arrange, act, and assert:
try (var em = emf.createEntityManager()) {
    // arrange: save user + company via em
    // act: run the controller, passing em
    // assert: query user + company back out via the same em
}

// Right: a fresh EntityManager per section:
User user = createUser("user@mycorp.com", UserType.EMPLOYEE);   // own EntityManager internally
String result = execute(controller -> controller.changeEmail(user.getId(), "new@gmail.com"));  // own EntityManager
User userFromDb = queryUser(user.getId());   // own EntityManager
```

Reutilizar um único `EntityManager`/sessão entre as seções de arrange, act e assert de um teste não corresponde a como o controller de fato é invocado em produção, onde cada operação de negócio recebe sua própria sessão exclusiva, criada imediatamente antes da chamada e descartada logo depois. O descompasso importa concretamente porque uma sessão de ORM costuma armazenar em cache entidades que já carregou; uma seção de assert que compartilha a sessão da seção de arrange pode ler silenciosamente sua própria cópia em cache na memória, em vez de ir de fato ao banco, o que significa que o teste pode passar mesmo quando a linha realmente persistida está errada. A regra: **use pelo menos três transações (ou unidades de trabalho) separadas por teste de integração, uma para cada seção de arrange, act e assert**, para que a seção de assert esteja provadamente lendo o estado real e recém-consultado do banco de dados, não um cache.

## Trade-offs

- **A otimização de escrita adiada de uma unit of work só compensa quando a maioria dos passos de uma operação de negócio genuinamente precisa fazer commit junto**: para uma operação de escrita única, transações simples por chamada e uma abstração completa de unit of work custam praticamente o mesmo, então o maquinário adicional só vale a pena quando a atomicidade em múltiplos passos é de fato um requisito real.
- **Entrega de schema baseada em estado é uma escolha legítima e temporária antes do lançamento**: o argumento da movimentação de dados contra ela só morde depois que existe dado real de produção que não pode simplesmente ser regenerado; escolher migrações desde o primeiro dia em um projeto pré-lançamento é rigor opcional, ainda não um requisito obrigatório.
- **Transações separadas por seção de teste custam tempo real de execução** em comparação a uma sessão compartilhada; aceite esse custo deliberadamente, já que a alternativa (um teste que passa mas não corresponde ao comportamento de produção) é um falso positivo, um dos tipos mais caros de falha de teste para eventualmente rastrear.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 10 "Testing the database", Seções 10.1-10.2, pp. 230-243 (book)
- [Flyway: migrações de banco de dados](https://documentation.red-gate.com/fd) (doc)
- [Spring Framework: Gerenciamento de Transações](https://docs.spring.io/spring-framework/reference/data-access/transaction.html) (doc)
