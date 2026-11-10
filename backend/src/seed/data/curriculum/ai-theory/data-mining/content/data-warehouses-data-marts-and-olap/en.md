---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the warehouse definition credited to Inmon, and design a star schema by declaring its grain.
- Tell apart what the Inmon and Kimball camps recommend, with the source of each claim.
- Write roll-up, drill-down, slice, dice, and pivot in SQL, noting where sources differ.
- Predict and check the output of `ROLLUP`, `CUBE`, and `GROUPING SETS`.
- Avoid summing a non-additive measure and confusing a real `NULL` with a subtotal.

## Context & Motivation

Step 2 of `the-kdd-process-and-the-data-mining-task-taxonomy` creates a target data set, often from a warehouse. `operational-vs-analytical-systems` explains why analytics runs apart from production and how ETL feeds it, and `column-oriented-storage-for-analytics` explains the storage layout and materialized cubes. This lesson adds how the data is modeled.

An OLAP user states the question and reads an aggregate. By the KDD definition, computing a predefined quantity is not mining, since no search is involved. Fayyad et al. draw the same line: OLAP tools support interactive analysis, "but the goal of KDD tools is to automate as much of the process as possible".

## Core Theory

### What a warehouse is

Chaudhuri and Dayal (1997), citing Inmon's *Building the Data Warehouse* (1992), give the definition as a "subject-oriented, integrated, time-varying, non-volatile collection of data that is used primarily in organizational decision making". Citing authors word it differently, so check the source before quoting. Each term is a requirement:

- **Subject-oriented**: organized around sales or customers, not around one application.
- **Integrated**: several sources reconciled into one set of names and codes.
- **Time-varying**: history is kept, and each fact is tied to a period.
- **Non-volatile**: loaded and read, rather than updated in place by transactions.

### Grain, facts, and dimensions

A dimensional model has a **fact table** of measurements and **dimension tables** of descriptive context. The Kimball Group's four-step design process is: select the business process, declare the grain, identify the dimensions, identify the facts. The **grain** "establishes exactly what a single fact table row represents", and it comes before the dimensions and facts, because every one of them must agree with it.

Measures fall into three classes, in Kimball's terms. **Additive** ones can be summed across all dimensions (revenue). **Semi-additive** ones can be summed across some but not all (an account balance, not across time). **Non-additive** ones cannot be summed at all (ratios).

### Star and snowflake

A **star schema**, per Chaudhuri and Dayal, has a single fact table and a single table for each dimension. A **snowflake schema** normalizes the dimension tables, with "advantages in maintaining the dimension tables", while the star "may be more appropriate for browsing the dimensions". The Kimball Group goes further: "you should avoid snowflakes because it is difficult for business users to understand and navigate snowflakes". Both hold the same information (Example 5).

### Data marts and the two architectures

A **data mart** is, in Chaudhuri and Dayal's words, one of the "departmental subsets focused on selected subjects". They add that marts roll out faster but may bring integration problems if no complete business model is developed.

Inmon, with Imhoff and Sousa, wrote *Corporate Information Factory* (1998). An open comparison is Margy Ross's 2004 column. It is written from the Kimball side, so it speaks for one party, and Inmon's books are sold:

| Question | Corporate Information Factory (CIF) | Kimball bus architecture |
|---|---|---|
| Normalized store before the dimensional one | required: a 3NF warehouse of atomic data | depends on the sources; not advocated, not forbidden |
| Where atomic data lives | in the normalized warehouse | in dimensional structures |
| What the dimensional layer holds | summaries, by department | atomic and summary data, by business process |
| How integration happens | through the normalized warehouse | through conformed dimensions on the bus |

The column lists common ground too: both want an enterprise view from the start and call independent marts problematic, which the shorthand "top-down against bottom-up" hides. A **conformed dimension** has the same column names and domain contents wherever it appears, which lets results from separate fact tables align on one report.

### OLAP operations

| Operation | Meaning here | SQL form |
|---|---|---|
| Roll-up | climb a hierarchy or drop a dimension | fewer `GROUP BY` columns |
| Drill-down | the reverse, toward detail | more `GROUP BY` columns |
| Slice | fix one dimension to one value | one equality in `WHERE` |
| Dice | restrict two or more dimensions | several conditions in `WHERE` |
| Pivot | turn row values into column headers | `PIVOT` |

**Variant warning.** The slice and dice split above is the one on Wikipedia's OLAP cube page. Chaudhuri and Dayal treat `slice_and_dice` as one operation: "reducing the dimensionality of the data, i.e., taking a projection of the data on a subset of dimensions for selected values of the other dimensions". Their wording for roll-up can also mislead: "doing a further group-by on one of the dimensions" reads, in their example, as aggregating that dimension away, the fewer-columns form in the table. The OLAP operation roll-up is not the SQL keyword `ROLLUP`, which returns several aggregation levels in one result.

**The SQL operators.** `GROUPING SETS` lists the groupings to compute. `ROLLUP (a, b, c)` gives the $n+1$ prefixes $(a,b,c),(a,b),(a),()$, so column order matters. `CUBE` gives all $2^n$ subsets. Gray et al. introduced the cube operator and give its result $\prod_i(C_i+1)$ rows for attributes of cardinality $C_i$, the extra value being `ALL`. On a sparse table that product is only an upper bound (Example 3). SQL shows `ALL` as `NULL`, and `GROUPING()` or `GROUPING_ID()` identifies these rows.

### Book vs today: columnar cloud warehouses

Chaudhuri and Dayal (1997) describe an enterprise warehouse as "projected to be hundreds of gigabytes to terabytes in size", served by ROLAP or MOLAP servers with bitmap indices, join indices, and materialized summaries. Three later sources show what changed.

- **2016, Snowflake** (Dageville et al.): generally available since June 2015, it stores tables on Amazon S3 with each column's values grouped inside a file, and it uses min-max pruning instead of B+-tree indices.
- **2020, Dremel and BigQuery** (Melnik et al.): "The industry has converged on an architecture that uses elastic compute services to analyze data in cloud storage."
- **2021, Lakehouse** (Armbrust et al., at Databricks): the warehouse architecture "will wither in the coming years", replaced by systems on open formats such as Parquet. This is a vendor's forecast, not a finding.

Grain, facts, and dimensions are logical ideas, so the modeling survives. The change is that a precomputed cube is now one option among several, since a scan of a few columns is often fast enough. As one measurement, not a benchmark, DuckDB 2.0.0 on an Apple M1 Pro (10 threads) wrote `SELECT d, s, sum(rev) ... GROUP BY CUBE (d, s)` to a temporary table from 10 million in-memory rows in about 0.015 seconds. The rows came from `range(10000000)`, with `d = i % 365`, `s = i % 50`, and `rev = hash(i) % 100`. Those columns are periodic, so only lcm(365, 50) = 3650 of the 18,250 pairs occur, and the result has 3650 + 365 + 50 + 1 = 4066 rows. With `d = hash(i) % 365` and `s = hash(i + 20000000) % 50` all pairs occur, giving (365 + 1)(50 + 1) = 18,666 rows in about 0.02 seconds. `column-oriented-storage-for-analytics` covers why materialized views remain useful for heavy repeated queries.

## Worked Examples

All output below is from DuckDB 2.0.0, on invented rows.

### Example 1: a star, with its grain declared

Business process: sales. Grain: one row per customer, product, store, and month. Dimensions: date, store, product. Facts: `qty` and `revenue`. The customer stays in the fact table as a plain label.

```sql
CREATE TABLE dim_date   (date_key INT PRIMARY KEY, month VARCHAR, quarter VARCHAR);
CREATE TABLE dim_store  (store_key INT PRIMARY KEY, city VARCHAR, region VARCHAR);
CREATE TABLE dim_product(product_key INT PRIMARY KEY, product VARCHAR, category VARCHAR);
CREATE TABLE fact_sales (date_key INT, store_key INT, product_key INT,
                         customer VARCHAR, qty INT, revenue INT);

INSERT INTO dim_date VALUES (1,'01','Q1'), (2,'02','Q1'), (4,'04','Q2'), (5,'05','Q2');
INSERT INTO dim_store VALUES (1,'Recife','NE'), (2,'Salvador','NE'), (3,'Sao Paulo','SE');
INSERT INTO dim_product VALUES (1,'Atlas','Books'), (2,'Novel','Books'), (3,'Vinyl','Music');
INSERT INTO fact_sales VALUES
  (1,1,1,'ana',1,50), (1,1,3,'bia',2,60),  (2,2,2,'ana',3,45), (2,3,1,'caio',2,100),
  (2,3,3,'caio',1,30), (4,1,2,'bia',2,30), (4,2,3,'ana',1,30), (4,3,2,'duda',4,60),
  (5,1,1,'ana',1,50), (5,3,3,'duda',3,90);

CREATE VIEW sales AS
SELECT d.month, d.quarter, s.city, s.region, p.product, p.category, f.customer, f.qty, f.revenue
FROM fact_sales f
JOIN dim_date d USING (date_key)
JOIN dim_store s USING (store_key)
JOIN dim_product p USING (product_key);
```

The view has 10 lines and total revenue 545.

### Example 2: `ROLLUP` along a hierarchy

```sql
SELECT region, city, sum(revenue) AS revenue
FROM sales
GROUP BY ROLLUP (region, city)
ORDER BY region NULLS LAST, city NULLS LAST;
```

```text
region  city       revenue
NE      Recife     190
NE      Salvador   75
NE      NULL       265
SE      Sao Paulo  280
SE      NULL       280
NULL    NULL       545
```

The rows with a `NULL` city are subtotals: $190+75=265$. The last row is the total: $265+280=545$. Reversing the arguments gives city totals and a grand total, without region subtotals, so the order follows the hierarchy.

### Example 3: `CUBE` and `GROUPING SETS`

```sql
SELECT quarter, category, sum(revenue) AS revenue
FROM sales
GROUP BY CUBE (quarter, category)
ORDER BY quarter NULLS LAST, category NULLS LAST;
```

```text
quarter  category  revenue
Q1       Books     195
Q1       Music     90
Q1       NULL      285
Q2       Books     140
Q2       Music     120
Q2       NULL      260
NULL     Books     335
NULL     Music     210
NULL     NULL      545
```

Those are $2^2=4$ grouping sets in $(2+1)(2+1)=9$ rows. `GROUPING SETS` names only the groupings needed, and `GROUPING()` marks the column aggregated away:

```sql
SELECT region, category, sum(revenue) AS revenue,
       GROUPING(region) AS g_region, GROUPING(category) AS g_category
FROM sales
GROUP BY GROUPING SETS ((region), (category), ())
ORDER BY g_region, g_category, region, category;
```

```text
region  category  revenue  g_region  g_category
NE      NULL      265      0         1
SE      NULL      280      0         1
NULL    Books     335      1         0
NULL    Music     210      1         0
NULL    NULL      545      1         1
```

Counting with `count(*)` and `count(DISTINCT GROUPING_ID(...))` over each result:

```text
grouping                              grouping sets   result rows   product of (C+1)
ROLLUP (quarter, region, category)    4               15            (not a cube)
CUBE   (quarter, region, category)    8               27            3*3*3 = 27
CUBE   (quarter, city, category)      8               33            3*4*3 = 36
```

The third line falls short because only 9 of the $2\cdot3\cdot2=12$ base combinations occur.

### Example 4: slice, dice, drill-down, pivot

Drill down from quarter to month. The two Q1 rows add up to the quarter's 285:

```text
quarter  month  revenue
Q1       01     110
Q1       02     175
Q2       04     120
Q2       05     140
```

A slice fixes one dimension, `WHERE quarter = 'Q1'`, grouped by the other two:

```text
region  category  revenue
NE      Books     95
NE      Music     60
SE      Books     100
SE      Music     30
```

A dice restricts two dimensions, `WHERE region = 'NE' AND category = 'Books'`, grouped by quarter and city:

```text
quarter  city      revenue
Q1       Recife    50
Q1       Salvador  45
Q2       Recife    80
```

A pivot changes the layout and not the numbers:

```sql
PIVOT (SELECT region, quarter, revenue FROM sales)
ON quarter USING sum(revenue)
GROUP BY region
ORDER BY region;
```

```text
region  Q1   Q2
NE      155  110
SE      130  150
```

### Example 5: what does not add up, and a snowflake that does

**Non-additive measures.** Distinct customers cannot be summed across quarters, and averages cannot be averaged when the groups differ in size:

```text
quarter  customers  revenue  lines  avg_line
Q1       3          285      5      57.00
Q2       3          260      5      52.00
NULL     4          545      10     54.50

region  lines  revenue  avg_line
NE      6      265      44.17
SE      4      280      70.00
NULL    10     545      54.50

avg_of_avgs
57.08
```

The total is 4 customers, not $3+3$, since ana and bia bought in both quarters. The regional averages average to 57.08, not 54.50, because the regions differ in line count. The Kimball Group's advice is to store the additive components and calculate at the end: $545/10=54.50$.

**The `NULL` trap.** Add a product with a `NULL` category and one sale of 40. `COALESCE(category, 'ALL')` over `ROLLUP (category)`, ordered by revenue, produces two rows called `ALL`:

```text
category  revenue
ALL       40
Music     210
Books     335
ALL       585
```

```sql
SELECT category, sum(revenue) AS revenue, GROUPING(category) AS is_total
FROM sales GROUP BY ROLLUP (category) ORDER BY is_total, category;
```

```text
category  revenue  is_total
Books     335      0
Music     210      0
NULL      40       0
NULL      585      1
```

Only `GROUPING()` separates the unknown category from the total. The extra rows are removed before the next step.

**Same answer from a snowflake.** Split `dim_store` into `dim_city (city_key, city, region_key)` and `dim_region (region_key, region)`, and run the `ROLLUP` of Example 2 with two joins. `EXCEPT` in both directions returned 0 rows.

## Common Misconceptions & Pitfalls

- **"Inmon says warehouse, Kimball says marts."** Per Ross's column, Kimball builds models by business process, not department, and the CIF also uses dimensional marts.
- **"Columnar cloud warehouses made dimensional modeling obsolete."** They changed storage and execution. The grain still decides what a row means.

## Summary

A dimensional model declares its grain and separates dimensions from facts, and a snowflake returns the same answers. Marts are departmental subsets in Chaudhuri and Dayal's definition, and the CIF and Kimball architectures differ mainly on normalized storage and on where atomic data lives. OLAP operations map onto `GROUP BY`, `WHERE`, and `PIVOT`. `ROLLUP` gives $n+1$ grouping sets and `CUBE` gives $2^n$, with $\prod_i(C_i+1)$ rows only on dense data. Storage has moved to columnar cloud systems, while the logical model has stayed.

## Documentation Links

- [Chaudhuri and Dayal (1997), An Overview of Data Warehousing and OLAP Technology](https://www.cs.ubc.ca/~rap/teaching/504/2006/readings/chaudhuri-olap.pdf): the definition citing Inmon, marts, schemas, and OLAP operations.
- [Gray et al. (1997), Data Cube](https://arxiv.org/pdf/cs/0701155): the cube operator and the $\prod_i(C_i+1)$ cardinality.
- [Ross (2004), Differences of Opinion](https://www.kimballgroup.com/2004/03/differences-of-opinion/): the Kimball bus against the CIF, from the Kimball side.
- [Kimball Group, Four-Step Dimensional Design Process](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/four-4-step-design-process/): the four design decisions.
- [Kimball Group, Grain](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/grain/): why the grain comes before dimensions and facts.
- [Kimball Group, Additive, Semi-Additive, and Non-Additive Facts](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/additive-semi-additive-non-additive-fact/): the three classes of measure.
- [Kimball Group, Snowflaked Dimensions](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/snowflake-dimension/): the argument against snowflakes.
- [Kimball Group, Conformed Dimensions](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/conformed-dimension/): what makes dimensions conform.
- [Wikipedia, Bill Inmon](https://en.wikipedia.org/wiki/Bill_Inmon): his books, with *Corporate Information Factory*.
- [Wikipedia, OLAP cube](https://en.wikipedia.org/wiki/OLAP_cube): slice and dice as separate operations.
- [Dageville et al. (2016), The Snowflake Elastic Data Warehouse](https://www.cs.purdue.edu/homes/csjgwang/CloudNativeDB/SnowflakeSIGMOD16.pdf): S3, columnar files, and pruning without indices.
- [Melnik et al. (2020), Dremel: A Decade of Interactive SQL Analysis at Web Scale](https://www.vldb.org/pvldb/vol13/p3461-melnik.pdf): separate storage and compute, on the way to BigQuery.
- [Armbrust et al. (2021), Lakehouse](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf): the argument for open file formats.
- [DuckDB 2.0, GROUPING SETS](https://duckdb.org/docs/2.0/sql/query_syntax/grouping_sets): `GROUPING SETS`, `ROLLUP`, `CUBE`, and `GROUPING_ID`.
- [DuckDB 2.0, PIVOT statement](https://duckdb.org/docs/2.0/sql/statements/pivot): the pivot syntax used here.
