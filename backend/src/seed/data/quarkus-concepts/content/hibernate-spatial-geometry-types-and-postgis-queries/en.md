---
version: 1.0
updatedAt: 2026-08-22
---
## Objective

Hibernate Spatial extends Hibernate ORM's type system so a geometry column (a point, a line, a polygon) is a first-class entity field backed by the database's native spatial type — PostGIS on PostgreSQL — instead of being serialized into a JSON blob or a pair of plain `double` columns. That means the database can index it, filter by it, and answer questions like "which rows fall inside this area" without pulling every row into the JVM to check.

## Use Cases

- Storing a GPS track (a running route, a delivery path) as a single `LineString` column instead of a separate table of lat/lng rows.
- Answering "what's near me" queries (`ST_DWithin`) directly in SQL instead of computing Haversine distance for every row in application code.
- Enforcing that a stored geometry is valid and in a known coordinate system (SRID), so two geometries from different sources can be compared correctly.
- Building map-based features (a bounding-box search, a "does this delivery zone contain this address" check) on top of a relational database you already run, without standing up a dedicated GIS datastore.

## Deep Dive

### Enabling the extension

Hibernate Spatial ships as a separate Hibernate ORM module. In a Quarkus project it's just another dependency — no separate spatial dialect class to configure, since modern Hibernate ORM (6+, which Quarkus 3.x uses) detects spatial support on the classpath and wires it into the standard PostgreSQL dialect automatically:

```xml
<dependency>
    <groupId>org.hibernate.orm</groupId>
    <artifactId>hibernate-spatial</artifactId>
</dependency>
```

The PostgreSQL side needs the PostGIS extension enabled once per database:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Declaring a geometry field

An entity field just needs to be typed as a JTS (Java Topology Suite) geometry type — `Point`, `LineString`, `Polygon`, or the common supertype `Geometry` — and Hibernate Spatial maps it automatically, no custom `@Type` annotation required:

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

### Coordinate system: SRID and GeometryFactory

A geometry's SRID (Spatial Reference System Identifier) says which coordinate system its numbers mean — 4326 is plain WGS84 latitude/longitude, the one GPS devices and `Apple Health`/Strava exports use. JTS geometries carry their SRID as plain state (`Geometry.getSRID()` / `setSRID(int)`), and it is not inferred from the coordinates — you have to set it explicitly when you build a geometry, or every spatial comparison against a properly-tagged column is comparing apples to oranges:

```java
GeometryFactory factory = new GeometryFactory(new PrecisionModel(), 4326);
Coordinate[] coords = { new Coordinate(-46.633, -23.550), new Coordinate(-46.634, -23.551) };
LineString path = factory.createLineString(coords);
// path.getSRID() == 4326
```

A common Quarkus pattern is to expose that `GeometryFactory` as a CDI bean pre-bound to your application's SRID, so every part of the codebase that builds geometries uses the same coordinate system by construction:

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

### Querying with spatial functions

Hibernate Spatial registers a standard set of spatial functions (from the Simple Feature Specification) usable in HQL, plus dialect-specific ones like `dwithin`:

```java
@Query("select r from Route r where within(r.path, :area) = true")
List<Route> findRoutesWithin(@Param("area") Polygon area);
```

```java
// distance-based search — "routes with a point within 500 meters of here"
"select r from Route r where dwithin(r.path, :origin, 500) = true"
```

Functions available include `distance`, `within`, `contains`, `intersects`, `dwithin`, and `envelope` (a geometry's bounding box) — each translates to the matching PostGIS `ST_*` function underneath.

## Trade-offs

- **A real spatial index beats computing distance in Java** — a `GIST` index on the geometry column lets PostGIS prune candidates before returning rows; computing Haversine distance for every row in application code (as a simpler alternative does) means scanning the whole table every time.
- **JTS's coordinate order is (x, y), i.e. (longitude, latitude)** — the opposite of how humans usually say "lat, lng." Swapping them silently produces a geometry that's technically valid but wrong, often off by a continent, with no error to catch it.
```java
// WRONG: reads as (latitude, longitude) but JTS wants (x=lon, y=lat)
new Coordinate(-23.550, -46.633);
// RIGHT
new Coordinate(-46.633, -23.550);
```
- **Ties your schema to PostGIS** — once a column is a native geometry type, switching to a database without a spatial extension means a real migration, not a config change; plain lat/lng columns are more portable but push every spatial query's logic into application code.
- **SRID mismatches fail silently, not loudly** — comparing a 4326 geometry against one with no SRID set (or a different one) doesn't throw; it just returns wrong results, since the numbers are compared without regard to what they mean.

## Documentation Links

- [Hibernate ORM guide — Hibernate Spatial section — Quarkus guide](https://quarkus.io/guides/hibernate-orm) — doc
- [Hibernate ORM User Guide — Spatial](https://docs.hibernate.org/orm/7.4/userguide/html_single/#spatial) — doc
