---
version: 1.0
updatedAt: 2026-08-22
title: "Cache de Segundo Nível: Regiões, Eviction e Query Cache"
summary: "Como @Cacheable, propriedades de memória/expiração por região, e o hint de query org.hibernate.cacheable trabalham juntos para habilitar os caches de segundo nível e de query do Hibernate no Quarkus."
---
## Objective

O cache de segundo nível do Hibernate ORM fica acima do cache de primeiro nível por transação (o contexto de persistência), e consegue manter estado de entidade, coleções, e até resultados de query, entre sessões e transações. No Quarkus, uma implementação baseada em JCache/Caffeine é incluída como dependência transitiva por padrão, então o cache de segundo nível está disponível de fábrica; você inclui entidades individuais com `@Cacheable`, ajusta limites de memória e expiração por região, e separadamente inclui queries individuais em um cache compartilhado de resultado de query. Este conceito cobre como as regiões são nomeadas, como dimensioná-las e expirá-las, como fazer cache de coleções, e como habilitar cache de query.

## Use Cases

- Fazer cache de dados de referência/consulta que raramente mudam (países, moedas, árvores de categoria) para evitar idas e voltas repetidas ao banco de dados.
- Limitar o uso de memória do cache por tipo de entidade, já que entidades diferentes têm tamanhos de instância e padrões de acesso muito diferentes.
- Fazer cache do conjunto de resultados de uma query rodada com frequência e raramente alterada (por exemplo, "todas as variedades de fruta ativas"), em vez de só entidades individuais.
- Entender a limitação real deste cache antes de depender dele: ele é local a cada instância de aplicação, então não é um substituto para um cache distribuído em um deploy em cluster.

## Deep Dive

### Incluindo uma entidade no cache de segundo nível com `@Cacheable`

Por padrão, entidades não são cacheadas no segundo nível. Marcar uma como `@Cacheable` habilita o cache de seus próprios campos (mas não suas coleções ou relações, que precisam de configuração separada):

```java
@Entity
@Cacheable
public class Country {
    // Fields are cached except collections and relations
}
```

### Como as regiões de cache são nomeadas

Toda entidade `@Cacheable` ganha sua própria região de cache, nomeada segundo o nome totalmente qualificado de sua classe:

```
org.acme.Country
```

Uma coleção cacheada também ganha sua própria região, nomeada como a entidade dona mais o campo da coleção, separados por `#`:

```
org.acme.Country#cities
```

Toda *query* cacheada (veja abaixo), por outro lado, compartilha uma única região:

```
default-query-results-region
```

Esses nomes de região são exatamente o que você mira ao ajustar memória/expiração por região.

### Dimensionando e expirando uma região

Os limites de eviction padrão são 10.000 entradas máximas e 100 segundos de tempo máximo ocioso. Para sobrescrever o limite de contagem de entrada de uma região específica:

```properties
quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.object-count=1000
```

Para sobrescrever a expiração (tempo ocioso) em vez disso:

```properties
quarkus.hibernate-orm.cache."org.acme.Country".expiration.max-idle=100s
```

### Eviction baseada em peso para entidades de tamanho variável

Quando as entidades de uma região variam bastante em tamanho, contar objetos é um proxy ruim para uso de memória. Um limite baseado em peso, com um weigher customizado, pode ser usado em vez disso; `object-count` e `maximum-weight` são mutuamente exclusivos por região:

```properties
quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.maximum-weight=104857600
quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.weigher-class=org.acme.MyEntityWeigher
```

```java
import com.github.benmanes.caffeine.cache.Weigher;

public class MyEntityWeigher implements Weigher<Object, Object> {
    @Override
    public int weigh(Object key, Object value) {
        return 100; // default weight
    }
}
```

### Fazendo cache de coleções e relações

`@Cacheable` sozinho não faz cache das coleções de uma entidade. Para fazer cache de uma associação de coleção, adicione a própria anotação `@Cache` do Hibernate com uma estratégia de concorrência explícita:

```java
@Entity
@Cacheable
public class Country {
    @OneToMany
    @Cache(usage = CacheConcurrencyStrategy.READ_ONLY)
    List<City> cities;
}
```

### Cache de query

Resultados de query podem ser cacheados separadamente do estado de entidade, definindo o hint `org.hibernate.cacheable` na query:

```java
Query query = entityManager.createQuery("SELECT f FROM Fruit f");
query.setHint("org.hibernate.cacheable", Boolean.TRUE);
```

O mesmo hint funciona em uma `@NamedQuery`:

```java
@NamedQuery(name = "Fruits.findAll",
    query = "SELECT f FROM Fruit f ORDER BY f.name",
    hints = @QueryHint(
        name = "org.hibernate.cacheable",
        value = "true"))
public class Fruit { }
```

Resultados de query cacheados todos param na `default-query-results-region` compartilhada mencionada acima, em vez de uma região por query.

### Desabilitando o cache de segundo nível por completo

Se você precisa desligar o cache globalmente em vez de região por região, isso é um interruptor no nível de `persistence.xml`:

```xml
<property name="hibernate.cache.use_second_level_cache" value="false"/>
```

## Trade-offs

- **O cache é local a cada instância de aplicação, sem invalidação entre instâncias**: ao rodar múltiplas cópias (por exemplo, no Kubernetes), o cache de cada cópia pode ficar desatualizado em relação a mudanças feitas por outra cópia ou por um processo externo escrevendo diretamente no mesmo armazenamento.
- **Só dados genuinamente estáveis deveriam ser cacheados**: a própria recomendação do guia é fazer cache só de entidades, coleções e queries que essencialmente nunca mudam, já que qualquer outra coisa arrisca servir leituras desatualizadas sem consistência incorporada entre instâncias.
- **`object-count` vs `maximum-weight` é uma escolha do tipo ou-um-ou-outro por região**: você não consegue combinar um teto simples de contagem de entrada com um weigher customizado na mesma região, então a escolha precisa ser feita uma vez por tipo de entidade, com base em quão uniforme é o tamanho de suas instâncias.
  ```properties
  quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.object-count=1000
  ```
- **Fazer cache de uma coleção precisa da própria anotação e da própria estratégia de concorrência**: esquecer `@Cache` em um `@OneToMany`/`@ManyToMany` significa que a entidade dona é cacheada, mas a coleção ainda acessa o banco de dados a cada vez.
- **Cache de query só compensa para queries que se repetem com os mesmos parâmetros e dados subjacentes estáveis**: para qualquer coisa com alta cardinalidade de parâmetro ou escritas frequentes subjacentes, o overhead de invalidação de cache pode superar o benefício.

## Documentation Links

- [Guia Hibernate ORM: Quarkus](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo `@Cacheable`, nomenclatura de região de cache, propriedades de memória/expiração `quarkus.hibernate-orm.cache."region".*`, e cache de query via o hint `org.hibernate.cacheable`)
