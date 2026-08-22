---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate ORM's second-level cache sits above the per-transaction first-level cache (the persistence context) and can keep entity state, collections, and even query results around across sessions and transactions. In Quarkus, a JCache/Caffeine-based implementation is included as a transitive dependency by default, so second-level caching is available out of the box — you opt individual entities in with `@Cacheable`, tune per-region memory and expiration limits, and separately opt individual queries into a shared query-result cache. This concept covers how regions are named, how to size and expire them, how to cache collections, and how to enable query caching.

## Use Cases

- Caching reference/lookup data that rarely changes (countries, currencies, category trees) to avoid repeated round trips to the database.
- Bounding memory usage of the cache per entity type, since different entities have very different instance sizes and access patterns.
- Caching the result set of a frequently-run, rarely-changing query (e.g. "all active fruit varieties") rather than just individual entities.
- Understanding the real limitation of this cache before relying on it: it's local to each application instance, so it is not a substitute for a distributed cache in a clustered deployment.

## Deep Dive

### Opting an entity into the second-level cache with `@Cacheable`

By default, entities are not second-level cached. Marking one `@Cacheable` enables caching of its own fields (but not its collections or relations, which need separate configuration):

```java
@Entity
@Cacheable
public class Country {
    // Fields are cached except collections and relations
}
```

### How cache regions are named

Each `@Cacheable` entity gets its own cache region, named after its fully-qualified class name:

```
org.acme.Country
```

A cached collection gets its own region too, named as the owning entity plus the collection field, separated by `#`:

```
org.acme.Country#cities
```

All cached *queries* (see below), by contrast, share one common region:

```
default-query-results-region
```

These region names are exactly what you target when tuning memory/expiration per region.

### Sizing and expiring a region

The default eviction limits are 10,000 max entries and 100 seconds maximum idle time. To override the entry-count limit for a specific region:

```properties
quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.object-count=1000
```

To override expiration (idle time) instead:

```properties
quarkus.hibernate-orm.cache."org.acme.Country".expiration.max-idle=100s
```

### Weight-based eviction for variable-sized entities

When entities in a region vary a lot in size, counting objects is a poor proxy for memory usage. A weight-based limit with a custom weigher can be used instead — `object-count` and `maximum-weight` are mutually exclusive per region:

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

### Caching collections and relations

`@Cacheable` alone does not cache an entity's collections. To cache a collection association, add Hibernate's own `@Cache` annotation with an explicit concurrency strategy:

```java
@Entity
@Cacheable
public class Country {
    @OneToMany
    @Cache(usage = CacheConcurrencyStrategy.READ_ONLY)
    List<City> cities;
}
```

### Query caching

Query results can be cached separately from entity state, by setting the `org.hibernate.cacheable` hint on the query:

```java
Query query = entityManager.createQuery("SELECT f FROM Fruit f");
query.setHint("org.hibernate.cacheable", Boolean.TRUE);
```

The same hint works on a `@NamedQuery`:

```java
@NamedQuery(name = "Fruits.findAll",
    query = "SELECT f FROM Fruit f ORDER BY f.name",
    hints = @QueryHint(
        name = "org.hibernate.cacheable",
        value = "true"))
public class Fruit { }
```

Cached query results all land in the shared `default-query-results-region` mentioned above, rather than a per-query region.

### Disabling the second-level cache entirely

If you need to turn caching off globally rather than region-by-region, that's a `persistence.xml`-level switch:

```xml
<property name="hibernate.cache.use_second_level_cache" value="false"/>
```

## Trade-offs

- **The cache is local to each application instance, with no cross-instance invalidation** — when running multiple copies (e.g. on Kubernetes), each copy's cache can go stale relative to changes made by another copy or by an external process writing to the same store directly.
- **Only genuinely stable data should be cached** — the guide's own recommendation is to cache only entities, collections, and queries that essentially never change, since anything else risks serving stale reads with no built-in cross-instance consistency.
- **`object-count` vs `maximum-weight` is an either/or choice per region** — you can't mix a simple entry-count cap with a custom weigher on the same region, so the choice has to be made once per entity type based on how uniform its instance size is.
  ```properties
  quarkus.hibernate-orm.cache."org.acme.MyEntity".memory.object-count=1000
  ```
- **Caching a collection needs its own annotation and its own concurrency strategy** — forgetting `@Cache` on a `@OneToMany`/`@ManyToMany` means the owning entity is cached but the collection still hits the database every time.
- **Query caching only pays off for queries that repeat with the same parameters and stable underlying data** — for anything with high parameter cardinality or frequent underlying writes, the cache-invalidation overhead can outweigh the benefit.

## Documentation Links

- [Hibernate ORM guide — Quarkus](https://quarkus.io/guides/hibernate-orm) — source guide covering `@Cacheable`, cache region naming, `quarkus.hibernate-orm.cache."region".*` memory/expiration properties, and query caching via the `org.hibernate.cacheable` hint.
