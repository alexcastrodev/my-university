---
version: 1.0
updatedAt: 2026-08-22
title: "Hibernate Spatial: Tipos de Geometria e Queries PostGIS"
summary: "O Hibernate Spatial mapeia tipos de geometria JTS (Point, LineString, Polygon) para colunas nativas PostGIS, para que rotas e áreas possam ser indexadas e consultadas espacialmente, em vez de serializadas como JSON ou varridas linha por linha."
---
## Objective

O Hibernate Spatial estende o sistema de tipos do Hibernate ORM para que uma coluna de geometria (um ponto, uma linha, um polígono) seja um campo de entidade de primeira classe apoiado no tipo espacial nativo do banco de dados, o PostGIS no PostgreSQL, em vez de ser serializada em um blob JSON ou em um par de colunas `double` simples. Isso significa que o banco de dados consegue indexá-la, filtrar por ela, e responder perguntas como "quais linhas caem dentro desta área" sem puxar cada linha para a JVM para checar.

## Use Cases

- Armazenar um trajeto GPS (uma rota de corrida, um caminho de entrega) como uma única coluna `LineString`, em vez de uma tabela separada de linhas lat/lng.
- Responder queries de "o que há perto de mim" (`ST_DWithin`) diretamente em SQL, em vez de calcular distância de Haversine para cada linha no código da aplicação.
- Garantir que uma geometria armazenada seja válida e esteja em um sistema de coordenadas conhecido (SRID), para que duas geometrias de fontes diferentes possam ser comparadas corretamente.
- Construir funcionalidades baseadas em mapa (uma busca por bounding box, uma checagem de "esta zona de entrega contém este endereço") em cima de um banco de dados relacional que você já roda, sem levantar um datastore GIS dedicado.

## Deep Dive

### Habilitando a extensão

O Hibernate Spatial vem como um módulo separado do Hibernate ORM. Em um projeto Quarkus é só mais uma dependência; nenhuma classe de dialeto espacial separada para configurar, já que o Hibernate ORM moderno (6+, que o Quarkus 3.x usa) detecta suporte espacial no classpath e o conecta automaticamente ao dialeto PostgreSQL padrão:

```xml
<dependency>
    <groupId>org.hibernate.orm</groupId>
    <artifactId>hibernate-spatial</artifactId>
</dependency>
```

O lado do PostgreSQL precisa da extensão PostGIS habilitada uma vez por banco de dados:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Declarando um campo de geometria

Um campo de entidade só precisa ser tipado como um tipo de geometria JTS (Java Topology Suite), `Point`, `LineString`, `Polygon`, ou o supertipo comum `Geometry`, e o Hibernate Spatial o mapeia automaticamente, sem exigir uma anotação `@Type` customizada:

```java
import org.locationtech.jts.geom.LineString;

@Entity
public class Route {
    @Id
    @GeneratedValue
    Long id;

    String name;

    LineString path; // mapped to a PostGIS geometry column
}
```

### Sistema de coordenadas: SRID e GeometryFactory

O SRID de uma geometria (Spatial Reference System Identifier) diz qual sistema de coordenadas seus números representam; 4326 é o WGS84 simples de latitude/longitude, o que dispositivos GPS e exportações do Apple Health/Strava usam. Geometrias JTS carregam seu SRID como estado simples (`Geometry.getSRID()` / `setSRID(int)`), e ele não é inferido a partir das coordenadas; você precisa defini-lo explicitamente ao construir uma geometria, ou toda comparação espacial contra uma coluna corretamente marcada estará comparando coisas incomparáveis:

```java
GeometryFactory factory = new GeometryFactory(new PrecisionModel(), 4326);
Coordinate[] coords = { new Coordinate(-46.633, -23.550), new Coordinate(-46.634, -23.551) };
LineString path = factory.createLineString(coords);
// path.getSRID() == 4326
```

Um padrão comum no Quarkus é expor esse `GeometryFactory` como um bean CDI pré-vinculado ao SRID da sua aplicação, de modo que toda parte da base de código que constrói geometrias use o mesmo sistema de coordenadas por construção:

```java
@ApplicationScoped
public class GeometryConfig {
    @Produces
    @ApplicationScoped
    GeometryFactory geometryFactory() {
        return new GeometryFactory(new PrecisionModel(), 4326);
    }
}
```

### Consultando com funções espaciais

O Hibernate Spatial registra um conjunto padrão de funções espaciais (da Simple Feature Specification) utilizáveis em HQL, mais funções específicas de dialeto como `dwithin`:

```java
@Query("select r from Route r where within(r.path, :area) = true")
List<Route> findRoutesWithin(@Param("area") Polygon area);
```

```java
// distance-based search: "routes with a point within 500 meters of here"
"select r from Route r where dwithin(r.path, :origin, 500) = true"
```

Funções disponíveis incluem `distance`, `within`, `contains`, `intersects`, `dwithin`, e `envelope` (o bounding box de uma geometria); cada uma se traduz para a função `ST_*` correspondente do PostGIS por baixo.

## Trade-offs

- **Um índice espacial de verdade vence calcular distância em Java**: um índice `GIST` na coluna de geometria permite ao PostGIS descartar candidatos antes de retornar linhas; calcular distância de Haversine para cada linha no código da aplicação (uma alternativa mais simples) significa varrer a tabela inteira toda vez.
- **A ordem de coordenadas do JTS é (x, y), ou seja, (longitude, latitude)**: o oposto de como humanos costumam dizer "lat, lng". Trocá-las produz silenciosamente uma geometria tecnicamente válida, mas errada, muitas vezes fora por um continente inteiro, sem erro algum para capturar.
```java
// WRONG: reads as (latitude, longitude) but JTS wants (x=lon, y=lat)
new Coordinate(-23.550, -46.633);
// RIGHT
new Coordinate(-46.633, -23.550);
```
- **Amarra seu schema ao PostGIS**: uma vez que uma coluna é um tipo de geometria nativo, trocar para um banco de dados sem uma extensão espacial vira uma migração de verdade, não uma mudança de configuração; colunas lat/lng simples são mais portáveis, mas empurram toda a lógica de query espacial para o código da aplicação.
- **Descompassos de SRID falham silenciosamente, não ruidosamente**: comparar uma geometria 4326 contra uma sem SRID definido (ou com um diferente) não lança exceção; simplesmente retorna resultados errados, já que os números são comparados sem levar em conta o que significam.

## Documentation Links

- [Guia Hibernate ORM: seção Hibernate Spatial: guia do Quarkus](https://quarkus.io/guides/hibernate-orm) (doc)
- [Hibernate ORM User Guide: Spatial](https://docs.hibernate.org/orm/7.4/userguide/html_single/#spatial) (doc)
