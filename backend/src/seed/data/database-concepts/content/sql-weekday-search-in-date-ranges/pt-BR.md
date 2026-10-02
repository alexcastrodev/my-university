---
version: 1.0
updatedAt: 2026-08-05
title: Busca por Dia da Semana em Intervalos de Datas
summary: Encontrar todas as ocorrências de um dia da semana em um ano e a primeira/última ocorrência em um mês, navegando pelas convenções incompatíveis de numeração dos dias da semana no PostgreSQL, no MySQL e no SQL Server.
---
## Objective

Duas perguntas intimamente relacionadas aparecem o tempo todo quando datas entram em um schema: "me dê todas as sextas-feiras de 2026" e "me dê a primeira segunda e a última sexta deste mês." A primeira é um filtro sobre uma série de datas gerada; a segunda é aritmética pura a partir do primeiro e do último dia do mês. As duas se reduzem à mesma primitiva (perguntar de forma confiável a uma data "que dia da semana você é?"), e essa primitiva é, entre PostgreSQL, MySQL e SQL Server, uma das coisas menos portáveis de todo o SQL. O dia 1 é domingo em algumas funções, segunda em outras, e no T-SQL depende de uma *configuração de sessão*. Erre a numeração e a consulta retorna, em silêncio, um conjunto de datas perfeitamente plausível e totalmente errado.

## Use Cases

- Agendar eventos semanais recorrentes: materializar todas as terças-feiras do resto do ano para alimentar um calendário de standups, um job de limpeza ou uma grade de reservas.
- Calcular regras de feriados no estilo americano, definidas como "o N-ésimo dia da semana de um mês": o Thanksgiving é a quarta quinta-feira de novembro, o Labor Day a primeira segunda de setembro, o Memorial Day a última segunda de maio. Nenhuma dessas é uma data fixa; todas são esta receita.
- Cortes de folha de pagamento e cobrança expressos como "a última sexta-feira do mês" ou "a segunda quarta-feira": calendários de negócio quase nunca usam números do dia do mês para isso, porque eles cairiam em fins de semana.
- Agrupar um relatório por dia da semana ("como os pedidos de segunda se comparam aos de sexta?"), em que a chave do grupo precisa sobreviver a ser calculada em um engine diferente daquele para o qual o dashboard foi escrito.
- Preencher lacunas do calendário: gerar uma espinha densa de datas para que semanas sem atividade ainda apareçam como linhas zeradas em vez de sumirem de um gráfico.

## Deep Dive

### Todas as ocorrências de um dia da semana em um ano

A abordagem do livro em todos os fornecedores é a mesma: gerar recursivamente todos os 365 (ou 366) dias do ano com uma cláusula `WITH RECURSIVE` e então filtrar até o dia da semana desejado. Isso ainda funciona, mas no PostgreSQL e no SQL Server 2022+ agora existem funções que retornam conjuntos e tornam a recursão desnecessária.

**PostgreSQL**: `generate_series` aceita timestamps com passo `interval`, então a espinha de datas é uma única chamada de função:

```sql
select gs::date as dy
  from generate_series(date '2026-01-01',
                       date '2026-12-31',
                       interval '1 day') as gs
 where extract(isodow from gs) = 5;   -- ISODOW: 1 = segunda ... 7 = domingo
```

Melhor ainda: não gere 365 linhas para jogar 313 fora. Caia na primeira sexta-feira e então avance de sete em sete dias:

```sql
select gs::date as dy
  from generate_series(
         -- primeira sexta-feira em ou depois de 1º de janeiro
         date '2026-01-01'
           + ((5 - extract(isodow from date '2026-01-01')::int + 7) % 7),
         date '2026-12-31',
         interval '7 days') as gs;
```

2026-01-01 é uma quinta-feira (`ISODOW` 4), então o deslocamento é `(5 - 4 + 7) % 7 = 1` e a série começa em 2026-01-02, a primeira sexta-feira do ano. Essa expressão `(alvo - atual + 7) % 7` é a receita inteira em uma linha, e ela reaparece literalmente na versão por mês abaixo.

**MySQL**: sem `generate_series`, então a CTE recursiva do livro ainda é a resposta idiomática (MySQL 8.0+):

```sql
with recursive cal (dy) as (
  select date '2026-01-01'
  union all
  select dy + interval 1 day from cal where dy < date '2026-12-31'
)
select dy from cal where weekday(dy) = 4;   -- WEEKDAY: 0 = segunda ... 6 = domingo
```

365 níveis de recursão cabem em `cte_max_recursion_depth`, cujo padrão é **1000**, mas uma espinha de vários anos não cabe, e o MySQL encerra a CTE em vez de retornar um resultado truncado. Aumente o limite por sessão quando o intervalo passar de uns três anos:

```sql
set session cte_max_recursion_depth = 10000;
```

**SQL Server**: o 2022 (16.x) adicionou `GENERATE_SERIES`, mas ele só produz **números**, não datas (de `tinyint` a `numeric`; não há sobrecarga para datas). A espinha de datas é uma série numérica alimentada em `DATEADD`:

```sql
declare @start date = '20260101', @end date = '20261231';

select dateadd(day, value, @start) as dy
  from generate_series(0, datediff(day, @start, @end))
 where datediff(day, '19000101', dateadd(day, value, @start)) % 7 = 4;
```

`GENERATE_SERIES` exige nível de compatibilidade do banco 160 ou superior. Em qualquer coisa mais antiga, a CTE recursiva do livro continua valendo, e note que ela precisa de `option (maxrecursion 400)`, porque o limite padrão de recursão do T-SQL é 100 e 365 iterações o ultrapassam direto com o erro 530.

Esse `datediff(day, '19000101', d) % 7` no filtro não é um truque arbitrário: 1900-01-01 é o dia zero do SQL Server *e* uma segunda-feira, então contar os dias a partir dele, módulo 7, gera um dia da semana de 0 a 6 começando na segunda que nenhuma configuração de sessão consegue perturbar. O que nos leva à pegadinha.

### Pegadinha: cada fornecedor numera os dias da semana de um jeito, e o MySQL discorda de si mesmo

Isto não é uma nota de rodapé. Eis o que cada função retorna para a *mesma* sexta-feira:

| Expressão | Dom | Seg | Ter | Qua | Qui | **Sex** | Sáb |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL `extract(dow from d)` | 0 | 1 | 2 | 3 | 4 | **5** | 6 |
| PostgreSQL `extract(isodow from d)` | 7 | 1 | 2 | 3 | 4 | **5** | 6 |
| PostgreSQL `to_char(d, 'D')` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| MySQL `dayofweek(d)` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| MySQL `weekday(d)` | 6 | 0 | 1 | 2 | 3 | **4** | 5 |
| SQL Server `datepart(weekday, d)`, `@@DATEFIRST = 7` | 1 | 2 | 3 | 4 | 5 | **6** | 7 |
| SQL Server `datepart(weekday, d)`, `@@DATEFIRST = 1` | 7 | 1 | 2 | 3 | 4 | **5** | 6 |

Cinco inteiros distintos significam "sexta-feira", dependendo da linha em que você está. Três coisas tornam isso pior que um problema de tabela de consulta:

**1. As duas convenções do próprio PostgreSQL discordam, e o livro cai nisso.** `EXTRACT` e `to_char` usam numerações diferentes; o manual do PostgreSQL diz isso com todas as letras: *"Note que a numeração do dia da semana do extract difere da numeração da função to_char(..., 'D')."* A solução da receita 9.5 para o PostgreSQL filtra por `cast(extract(dow from dy) as integer) = 6` e descreve o resultado como sextas-feiras, mas `DOW` 6 é **sábado**: o `= 6` vem da numeração do `to_char`, enquanto o código chama `EXTRACT`. (A solução da receita 9.6 para o PostgreSQL, uma página depois, usa corretamente `to_char(dy,'d')`, com a segunda como 2.) A consulta roda, retorna 52 linhas, e cada uma delas é o dia errado. Esse é exatamente o modo de falha de que esta seção inteira trata: nada dá erro.

```sql
-- filtro da 9.5 do livro: retorna sábados, não sextas
select gs::date from generate_series(date '2026-01-01', date '2026-12-31',
                                     interval '1 day') gs
 where extract(dow from gs) = 6;   -- 6 = sábado no DOW

-- o que se queria
 where extract(dow from gs) = 5;   -- ou: extract(isodow from gs) = 5
```

**2. As duas funções de dia da semana do MySQL não concordam entre si.** `DAYOFWEEK()` retorna *"1 = domingo, 2 = segunda, …, 7 = sábado"*, a convenção ODBC. `WEEKDAY()` retorna *"0 = segunda, 1 = terça, … 6 = domingo."* Mesmo engine, mesma tabela, linhas vizinhas no manual, ponto zero diferente *e* base diferente:

```sql
select dayofweek('2026-01-02'),   -- 6
       weekday('2026-01-02');     -- 4   -- as duas são sexta-feira
```

Qualquer código que misture as duas (ou que tenha sido copiado de um trecho que usava a outra) fica deslocado exatamente em dois dias de numeração, sem nenhum diagnóstico.

**3. A resposta do SQL Server depende do estado da sessão, não da data.** `DATEPART(weekday, …)` é documentado como dependente de `SET DATEFIRST`, e seu valor de retorno também *"depende do ambiente de idioma definido por SET LANGUAGE e pelo … idioma padrão … do login."* O padrão é 7 (domingo primeiro) para `us_english`; a maioria das configurações de idiomas europeus tem padrão 1 (segunda primeiro). Então a consulta idêntica retorna inteiros diferentes para dois usuários conectados ao mesmo banco:

```sql
set datefirst 7;  select datepart(weekday, '20260102');  -- 6 (sexta)
set datefirst 1;  select datepart(weekday, '20260102');  -- 5 (sexta)
```

A correção é normalizar em vez de confiar no valor bruto. Ancore em uma segunda-feira conhecida, ou retire `@@DATEFIRST` do resultado para obter um dia da semana ISO de 1 a 7:

```sql
-- dia da semana ISO (1 = segunda ... 7 = domingo), imune ao DATEFIRST
select ((@@datefirst + datepart(weekday, d) - 2) % 7) + 1 as iso_dow from t;

-- ou a forma com âncora: 0 = segunda ... 6 = domingo, sem estado de sessão nenhum
select datediff(day, '19000101', d) % 7 as mon_dow from t;
```

Note também que `SET DATEFIRST` tem escopo de sessão como toda instrução `SET`, então um pool de conexões que entrega uma sessão em que algum código anterior rodou `SET DATEFIRST 1` muda em silêncio o significado de um `= 6` fixo no código. A exceção que a própria Microsoft abre é reveladora: `DATEDIFF` ignora deliberadamente o `DATEFIRST` e sempre trata domingo como o primeiro dia da semana *"para garantir que a função seja determinística."* `DATEPART(weekday, …)` não recebe essa garantia.

### Primeira e última ocorrência de um dia da semana em um mês

Com a numeração resolvida, esta receita não precisa de recursão nenhuma: as soluções do livro para DB2 e SQL Server geram todos os dias do mês e pegam `MIN`/`MAX` das linhas marcadas, mas isso é um contorno para funções de data ausentes, não uma necessidade hoje. Dois fatos fazem todo o trabalho:

- O primeiro *dia da semana alvo* em ou depois do dia 1 do mês é `primeiro_dia + ((alvo - dow(primeiro_dia) + 7) % 7)`.
- O último é `ultimo_dia - ((dow(ultimo_dia) - alvo + 7) % 7)`.

Os dois usam a mesma "distância até o próximo/anterior dia da semana" módulo 7 da versão anual. O `+ 7` antes do `%` mantém o operando não negativo, o que importa porque `%` sobre inteiros negativos é território definido pela implementação tanto no MySQL quanto no T-SQL.

**PostgreSQL:**

```sql
with bounds as (
  select date_trunc('month', date '2026-08-05')::date as first_day,
         (date_trunc('month', date '2026-08-05')
            + interval '1 month - 1 day')::date        as last_day
)
select first_day + ((1 - extract(isodow from first_day)::int + 7) % 7) as first_monday,
       last_day  - ((extract(isodow from last_day)::int - 5 + 7) % 7)  as last_friday
  from bounds;
--  first_monday | last_friday
-- --------------+-------------
--  2026-08-03   | 2026-08-28
```

Agosto de 2026 começa em um sábado (`ISODOW` 6), então `(1 - 6 + 7) % 7 = 2` coloca a primeira segunda no dia 3; termina em uma segunda (`ISODOW` 1), então `(1 - 5 + 7) % 7 = 3` volta até a sexta, dia 28.

**MySQL**: `LAST_DAY()` fornece o fim do mês diretamente, e a numeração do `WEEKDAY()` começando a segunda em zero significa que o alvo para segunda é literalmente `0`:

```sql
select first_day + interval ((0 - weekday(first_day) + 7) % 7) day  as first_monday,
       last_day  - interval ((weekday(last_day) - 4 + 7) % 7) day   as last_friday
  from (select date_sub(date '2026-08-05',
                        interval dayofmonth(date '2026-08-05') - 1 day) as first_day,
               last_day(date '2026-08-05')                             as last_day) b;
```

Compare com a solução do livro para MySQL, que aninha um `CASE sign(dayofweek(dy)-2)` de três vias para emular uma função de "próximo dia" ausente. A forma com módulo colapsa os três ramos em uma expressão: o `% 7` *é* a análise de sinal.

**SQL Server**: `EOMONTH` (2012+) substitui a aritmética do último dia, e `DATEFROMPARTS` a do primeiro dia; o SQL Server 2022 pode usar `DATETRUNC(month, @d)` para esta última. A numeração do dia da semana vem da âncora imune ao DATEFIRST, para que nada dependa do idioma da sessão:

```sql
declare @d date = '2026-08-05';
declare @fd date = datefromparts(year(@d), month(@d), 1);  -- ou datetrunc(month, @d)
declare @ld date = eomonth(@d);

select dateadd(day,  (0 - datediff(day, '19000101', @fd) % 7 + 7) % 7, @fd) as first_monday,
       dateadd(day, -((datediff(day, '19000101', @ld) % 7 - 4 + 7) % 7),  @ld) as last_friday;
-- first_monday = 2026-08-03, last_friday = 2026-08-28
```

**O N-ésimo dia da semana, e por que as regras de feriado saem de graça.** O livro observa que somar 7 ou 14 dias à primeira ocorrência dá a segunda e a terceira. Isso se generaliza: o N-ésimo dia da semana alvo de um mês é `primeira_ocorrencia + 7 * (n - 1)`. As regras de feriados americanos viram então uma linha:

```sql
-- Thanksgiving nos EUA em 2026: quarta quinta-feira de novembro
select (dt + ((4 - extract(isodow from dt)::int + 7) % 7) + 7 * (4 - 1))::date
  from (select date '2026-11-01' as dt) t;
-- 2026-11-26

-- Labor Day nos EUA em 2026: primeira segunda-feira de setembro
select (dt + ((1 - extract(isodow from dt)::int + 7) % 7))::date
  from (select date '2026-09-01' as dt) t;
-- 2026-09-07
```

A única ressalva: "N-ésimo" e "último" não são intercambiáveis. O Memorial Day é a *última* segunda-feira de maio, não a quarta; maio de 2026 tem cinco segundas, então `first_monday + 21` dá o dia 25 só por coincidência da disposição daquele ano, enquanto `last_day - ((dow(last_day) - 1 + 7) % 7)` está correto todo ano. Qualquer mês pode ter quatro ou cinco de um dado dia da semana; calcule "o último" a partir do fim do mês, nunca como "o quarto."

## Trade-offs

- **A armadilha da numeração dos dias da semana é o maior risco desta receita, e ela falha em silêncio.** Uma constante inteira errada não gera erro: ela retorna a *quantidade* certa de linhas no dia errado, o que sobrevive a code review, a testes unitários que só verificam contagem de linhas e, muitas vezes, à produção, até alguém notar que o relatório de "sexta-feira" está caindo no sábado. A própria solução 9.5 do livro para PostgreSQL demonstra exatamente isso: `extract(dow ...) = 6` onde se queria `5`. Prefira convenções autoexplicativas (`ISODOW`, ou uma expressão normalizada) a números mágicos soltos, e nunca copie uma constante de dia da semana entre engines.
  ```sql
  -- mesmo dia da semana, cinco constantes "corretas" diferentes
  extract(dow   from d) = 5   -- PostgreSQL
  extract(isodow from d) = 5  -- PostgreSQL, ISO
  dayofweek(d) = 6            -- MySQL
  weekday(d)   = 4            -- MySQL, mesmo engine, resposta diferente
  datepart(weekday, d) = 6    -- SQL Server, só enquanto @@DATEFIRST = 7
  ```
- **Valores de dia da semana dependentes da sessão tornam as consultas T-SQL não portáveis entre *conexões*, não só entre fornecedores.** `DATEPART(weekday, …)` lê `@@DATEFIRST`, que tem escopo de sessão e é derivado do idioma padrão do login; uma conexão do pool que herdou `SET DATEFIRST 1` muda o significado de uma constante fixa no código sem nenhum sinal. Normalizar via `((@@datefirst + datepart(weekday, d) - 2) % 7) + 1`, ou contornar a configuração por completo com `datediff(day, '19000101', d) % 7`, custa uma expressão a mais e elimina uma classe inteira de bugs dependentes do ambiente.
- **Gerar uma espinha completa de datas e filtrar é mais simples de ler, mas faz ~7× o trabalho de avançar de sete em sete dias.** `generate_series(..., interval '1 day')` mais um `WHERE` sobre o dia da semana materializa 365 linhas para manter 52; a forma de deslocar e avançar de 7 em 7 materializa exatamente 52. Para uma consulta avulsa a diferença é ruído, mas dentro de uma subconsulta correlacionada, de uma view unida por linha ou de um intervalo de vários anos ela deixa de ser ruído, e no MySQL a forma densa ainda precisa ficar abaixo de `cte_max_recursion_depth` (padrão 1000), que uma espinha de mais de uns três anos ultrapassa.
- **A geração de datas com CTE recursiva carrega limites de recursão por engine que as soluções do livro precisam contornar explicitamente.** O `MAXRECURSION` padrão do SQL Server é 100, então a própria solução 9.5 do livro termina com `option (maxrecursion 400)`; omita isso e uma espinha de um ano inteiro morre no meio com o erro 530. O `cte_max_recursion_depth` do MySQL é uma variável de sistema, não um hint de consulta, então o contorno precisa ser uma instrução `SET SESSION` separada que a aplicação precisa lembrar de emitir. São diferenças operacionais reais, não de estilo.
- **"Última ocorrência" e "N-ésima ocorrência" são cálculos diferentes e não podem ser confundidos.** Um mês contém quatro ou cinco de qualquer dia da semana, dependendo do seu tamanho e do dia em que começa, então a última segunda às vezes é a quarta e às vezes é a quinta. O `CASE` `first_monday + 28 ou + 21` do livro lida com isso verificando se +28 ultrapassa o mês; calcular de trás para a frente a partir de `LAST_DAY`/`EOMONTH` é mais curto, não tem ramificação e é correto por construção. Reserve `primeira + 7 * (n - 1)` para regras realmente formuladas como "o N-ésimo" (Thanksgiving), e a aritmética do fim do mês para regras formuladas como "o último" (Memorial Day, cortes de folha no fim do mês).
- **Funções de data modernas eliminaram a maior parte dos andaimes do livro, mas não de forma uniforme.** O `generate_series` sobre timestamps do PostgreSQL, o `EOMONTH`/`DATEFROMPARTS`/`DATETRUNC` do SQL Server e o `LAST_DAY` do MySQL substituem, cada um, várias linhas das soluções de 2020; ainda assim, o `GENERATE_SERIES` do SQL Server é só numérico e precisa do nível de compatibilidade 160, e o MySQL continua sem nenhum gerador de séries. As técnicas convergem para um modelo mental comum (encontrar uma fronteira, aplicar aritmética módulo 7), enquanto a sintaxe teimosamente não converge.

## Documentation Links

- Anthony Molinaro e Robert de Graaf, "SQL Cookbook", 2ª edição (O'Reilly, 2020): Capítulo 9, "Date Manipulation", receitas 9.5, 9.6, p. 255-268: doc
- [PostgreSQL Documentation: Date/Time Functions and Operators (EXTRACT: dow, isodow)](https://www.postgresql.org/docs/current/functions-datetime.html): doc
- [MySQL Reference Manual: Date and Time Functions (DAYOFWEEK, WEEKDAY)](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html): doc
- [Microsoft Learn: DATEPART (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/functions/datepart-transact-sql): doc
- [Microsoft Learn: SET DATEFIRST (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-datefirst-transact-sql): doc
