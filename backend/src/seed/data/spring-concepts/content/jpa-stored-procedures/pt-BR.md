---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

O JPA consegue chamar uma stored procedure do banco de dados diretamente através de `@NamedStoredProcedureQuery`, sem precisar recorrer a uma query nativa. Você declara o nome da procedure e seus parâmetros (que podem ser `IN`, `OUT`, `INOUT` ou `REF_CURSOR`) uma única vez em uma entidade, e depois referencia essa declaração pelo nome sempre que precisar chamá-la.

## Use Cases

- Chamar lógica de negócio que já existe no banco como stored procedure, em vez de duplicá-la em Java.
- Recuperar um valor calculado através de um parâmetro `OUT` (um total, um código de status) em vez de um result set de entidades.
- Chamar uma procedure que retorna um cursor (`REF_CURSOR`) em bancos onde é assim que uma procedure produz linhas.
- Trabalhar em um ambiente onde os DBAs são donos das procedures e o código da aplicação deve chamá-las, não substituí-las.

## Deep Dive

### Declarando uma named stored procedure query

```java
@Entity
@NamedStoredProcedureQuery(
    name = "calculate",
    procedureName = "calculate",
    parameters = {
        @StoredProcedureParameter(name = "x", mode = ParameterMode.IN, type = Integer.class),
        @StoredProcedureParameter(name = "y", mode = ParameterMode.IN, type = Integer.class),
        @StoredProcedureParameter(name = "result", mode = ParameterMode.OUT, type = Integer.class)
    }
)
public class Calculation { /* ... */ }
```

`name` é o identificador que o código da sua aplicação usa para procurar essa query; `procedureName` é o nome real da stored procedure no banco de dados. Manter os dois iguais deixa o mapeamento mais fácil de acompanhar, mas eles não precisam ser idênticos. Uma procedure pode declarar mais de um parâmetro `OUT`, cada um recuperado separadamente depois da chamada.

### Chamando a procedure: `execute()`, não `getResultList()`

```java
StoredProcedureQuery query = em.createNamedStoredProcedureQuery("calculate");
query.setParameter("x", 3);
query.setParameter("y", 4);

query.execute();

Integer result = (Integer) query.getOutputParameterValue("result");
```

Uma chamada a stored procedure é executada com `execute()`, diferente de um `SELECT` em JPQL ou nativo, que usa `getResultList()`/`getSingleResult()`. Parâmetros `IN` são definidos da mesma forma que em qualquer outra query; valores de parâmetros `OUT` (e `INOUT`) só ficam disponíveis depois, através de `getOutputParameterValue(name)`.

### Parâmetros `REF_CURSOR`

```java
@StoredProcedureParameter(name = "cursor", mode = ParameterMode.REF_CURSOR, type = void.class)
```

Alguns bancos de dados (Oracle e PostgreSQL entre eles) retornam um result set de uma procedure via um parâmetro de cursor, em vez de como o resultado da própria query. Um parâmetro em modo `REF_CURSOR` mapeia esse cursor para que o Hibernate consiga lê-lo como uma lista de resultados, mas o suporte e o comportamento exato são específicos de cada banco.

## Trade-offs

- **`execute()` é obrigatório, não uma escolha de estilo.** Chamar `getResultList()` em uma stored procedure query que não produz result set (só parâmetros `OUT`) é um erro de uso; o modo do parâmetro dita qual método de recuperação se aplica.
- **A lógica da stored procedure vive fora da sua base de código e do seu tooling de migrations.** Mudanças na assinatura da procedure (quantidade de parâmetros, tipos, ordem) quebram o mapeamento de `@NamedStoredProcedureQuery` de forma silenciosa até a próxima chamada, já que nada no código Java garante que os dois fiquem sincronizados.
- **O suporte a `REF_CURSOR` não é uniforme entre bancos.** Um mapeamento que funciona no Oracle pode precisar de ajuste no PostgreSQL ou pode nem ser suportado em bancos sem um mecanismo de cursor equivalente.

## Documentation Links

- [Jakarta Persistence API — StoredProcedureQuery](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/storedprocedurequery) — doc
- [Jakarta Persistence API — NamedStoredProcedureQuery](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/namedstoredprocedurequery) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
