---
version: 1.0
updatedAt: 2026-08-18
title: "Indexação do Postgres Através de Migrations do Rails"
summary: Quais índices um schema Rails de fato precisa, por que a ordem de colunas de um índice composto decide tudo, e como confirmar a partir de um console Rails que o Postgres está de fato usando o índice que você adicionou.
---
## Objective

Um índice em uma aplicação Rails não é um interruptor que você liga quando
uma página parece lenta; é uma linha em uma migration que o Postgres
precisa manter em **todo** `INSERT`, `UPDATE` e `DELETE` contra aquela
tabela, para sempre. `add_index` é uma API pequena com uma quantidade
surpreendente de significado empacotado em suas opções (`order:`, `where:`,
`unique:`, uma expressão em vez de um nome de coluna, um array em vez de um
símbolo único), e o Rails é deliberadamente neutro sobre quais índices você
precisa: ele deixa você tranquilamente entregar um `belongs_to` cuja chave
estrangeira não tem índice nenhum. Saber quais índices são efetivamente
obrigatórios em um schema Rails, o que um índice composto de fato compra
para você, e como confirmar a partir de um console Rails que o Postgres
está realmente usando o índice que você escreveu é a diferença entre
ajustar e adivinhar.

## Use Cases

- Revisar uma migration que adiciona uma associação `belongs_to`/
  `references` e checar se a chave estrangeira de fato ganhou um índice; o
  Rails não adiciona um a menos que você peça.
- Decidir entre duas chamadas `add_index` em colunas únicas versus uma
  `add_index :table, [:a, :b]` composta, dado que o Postgres consegue
  combinar índices de coluna única sozinho via um bitmap index scan.
- Tornar uma query de expiração de cache baseada em chave (Russian doll)
  rápida, onde a query quente é `MAX(updated_at)` sobre uma coleção em vez
  de uma busca por id.
- Confirmar em um console Rails, com `.explain` ou `EXPLAIN ANALYZE`, que
  um scope lento está de fato batendo no índice que você adicionou, em vez
  de assumir que está porque a migration rodou.
- Diagnosticar uma tabela cujo uso de disco continua crescendo mesmo com
  contagens de linha estáveis, e decidir se precisa de ajuste de
  autovacuum ou de um `VACUUM FULL` em janela de manutenção.

## Deep Dive

### Índices compostos: a ordem das colunas é o jogo inteiro

Um índice composto só ajuda quando a ordem de colunas da query se alinha
com a ordem de colunas do índice.

```ruby
class AddIndexToOrders < ActiveRecord::Migration[7.1]
  def change
    add_index :orders, [:customer_id, :status]
  end
end
```

Esse índice serve `Order.where(customer_id: 1, status: "open")` e também
serve `Order.where(customer_id: 1)` sozinho, porque `customer_id` é a
coluna **líder**. Ele *não* ajuda `Order.where(status: "open")`: uma query
que pula a coluna líder não consegue usar o índice como estrutura de
busca. Isso costuma ser chamado de regra do prefixo mais à esquerda: um
índice em `[:a, :b, :c]` cobre `a`, `a, b`, e `a, b, c`, mas não `b`
sozinho nem `b, c`.

A reação tentadora é adicionar índices compostos para toda combinação de
coluna que a aplicação consulta. Resista. O Postgres já consegue combinar
dois índices separados de coluna única no momento da query usando um
**bitmap index scan**: ele constrói um bitmap de linhas correspondentes de
cada índice, os combina com AND, e então visita o heap uma vez:

```ruby
add_index :orders, :customer_id
add_index :orders, :status
```

Esses dois índices lidam com `customer_id` sozinho, `status` sozinho, e
(via bitmap AND) os dois juntos. Um índice composto é mais rápido que um
bitmap AND para seu formato específico, mas é um custo de escrita
contínuo: toda escrita em `orders` precisa mantê-lo, e é peso morto para
toda query que não começa com `customer_id`. Use o índice composto quando
você já mediu que aquele formato de query específico importa; não por
padrão.

A exceção onde o composto de fato é a escolha certa é quando o par é
semanticamente inseparável; uma associação polimórfica é o exemplo
canônico (abaixo).

### Os índices que uma aplicação Rails quase sempre precisa

**Chaves estrangeiras.** O Rails não indexa uma chave estrangeira de
`belongs_to` para você. Um `add_column :comments, :post_id, :bigint` nu te
dá uma coluna sem índice, e então toda busca `post.comments` é um
sequential scan. Os dois abaixo adicionam o índice:

```ruby
class AddPostToComments < ActiveRecord::Migration[7.1]
  def change
    # add_reference adds the index by default (index: true is the default)
    add_reference :comments, :post, foreign_key: true

    # or, on an existing column:
    add_index :comments, :post_id
  end
end
```

Note que `foreign_key: true` (a restrição referencial em nível de banco de
dados) e o índice são duas coisas diferentes; a restrição não cria o
índice, e um índice não impõe integridade referencial. Você geralmente
quer os dois.

**Colunas polimórficas.** Uma associação polimórfica é consultada por
`_type` e `_id` *juntos*, sempre, então esse é o caso onde o índice
composto é claramente certo:

```ruby
class IndexCommentablesOnComments < ActiveRecord::Migration[7.1]
  def change
    add_index :comments, [:commentable_type, :commentable_id]
  end
end
```

`add_reference :comments, :commentable, polymorphic: true` cria exatamente
esse índice composto para você. Escrever as duas colunas como índices
separados de coluna única aqui seria estritamente pior: `commentable_type`
sozinho tem seletividade terrível (um punhado de nomes de classe distintos
em toda a tabela).

**`updated_at` / `created_at` quando usados para chaves de cache.**
Expiração de cache baseada em chave (veja o conceito irmão
`russian-doll-caching`) constrói uma chave de cache a partir do
`updated_at` máximo da coleção, então a query que roda a cada
renderização não é uma busca; é `SELECT MAX(updated_at) FROM posts`. O
Postgres consegue responder isso a partir de um índice caminhando até uma
ponta dele, mas só se a ordem de classificação do índice combinar, e
`NULLS LAST` importa porque `NULL` é classificado como o maior valor por
padrão em um índice descendente:

```ruby
class AddUpdatedAtIndexToPosts < ActiveRecord::Migration[7.1]
  def change
    add_index :posts, :updated_at, order: { updated_at: "DESC NULLS LAST" }
  end
end
```

O mesmo índice também serve a query de feed muito comum
`Post.order(updated_at: :desc).limit(20)`, que geralmente é o segundo
motivo de você querê-lo.

### Índices parciais, de expressão e únicos

Um **índice parcial** indexa só as linhas que casam com um predicado. É a
ferramenta certa quando a distribuição de valores é assimétrica; se 99%
das suas linhas são `billed = true` e toda query com a qual você se
importa está procurando pelo 1% que não é, indexar todas elas é espaço
desperdiçado e tempo de escrita desperdiçado:

```ruby
class AddUnbilledIndexToCustomers < ActiveRecord::Migration[7.1]
  def change
    add_index :customers, :billed, where: "billed = false"
  end
end
```

O Postgres só vai usar um índice parcial para uma query cuja cláusula
`WHERE` ele consegue provar que está coberta pelo predicado do índice,
então `Customer.where(billed: false)` o usa e `Customer.where(billed:
true)` não usa, que é o ponto principal.

Um **índice de expressão** indexa o resultado de uma função em vez de uma
coluna crua, que é o que torna buscas sem distinção de maiúsculas/
minúsculas rápidas:

```ruby
class AddLowerEmailIndexToUsers < ActiveRecord::Migration[7.1]
  def change
    add_index :users, "lower(email)", name: "index_users_on_lower_email"
  end
end
```

A query precisa usar a *mesma* expressão para o índice se aplicar;
`User.where("lower(email) = ?", email.downcase)` acerta nele, enquanto
`User.where(email: email)` não. Passar um `name:` explícito vale a pena
aqui porque o Rails não consegue derivar um nome de índice limpo a partir
de uma expressão, e o gerado é ao mesmo tempo estranho e fácil de colidir.

Por fim, prefira `unique: true` sempre que o dado genuinamente for único.
Um índice único é ao mesmo tempo mais rápido (o Postgres sabe que pode
parar na primeira correspondência) e uma restrição de integridade real em
nível de banco de dados, que um `validates_uniqueness_of` do Rails sozinho
não é; validações de model perdem corridas sob concorrência:

```ruby
add_index :users, :email, unique: true
```

### Confirmando que o índice é usado: EXPLAIN ANALYZE a partir do Rails

Adicionar um índice é uma hipótese; `EXPLAIN ANALYZE` é o teste. A partir
de um console Rails, o caminho mais barato é `.explain` em qualquer
relation:

```ruby
Order.where(customer_id: 1, status: "open").explain
# => EXPLAIN for: SELECT "orders".* FROM "orders" WHERE ...
#    Index Scan using index_orders_on_customer_id_and_status on orders ...
```

No Rails 7+, `.explain` recebe opções, então você consegue números reais
de execução e estatísticas de buffer sem sair do console:

```ruby
Order.where(customer_id: 1).explain(:analyze, :buffers, :verbose)
```

Para qualquer coisa mais exótica, ou em versões mais antigas, desça para a
connection:

```ruby
puts ActiveRecord::Base.connection.execute(
  "EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT * FROM orders WHERE customer_id = 1"
).values.join("\n")
```

Lendo a saída, duas coisas importam mais. Primeiro, compare o `cost`
estimado contra o `actual time`; se o planner estimou 50 linhas e de fato
obteve 500.000, as estatísticas estão obsoletas (o planner está escolhendo
mal porque tem informação ruim, não porque o índice está errado) e a
tabela pode precisar de um `ANALYZE`. Segundo, olhe o tipo de nó: um `Seq
Scan` onde você esperava um `Index Scan` é o sintoma clássico de que seu
índice não se aplica: ordem de coluna errada em um composto, uma expressão
de query que não casa com um índice de expressão, ou um predicado fora do
`where:` de um índice parcial. `BUFFERS` adiciona contadores `shared hit=`
/ `read=`, que dizem se as páginas vieram do cache de buffer do Postgres
ou do disco; um plano que parece bom em um cache aquecido e terrível em
produção geralmente é visível bem ali.

Note que `ANALYZE` de fato executa a query, então envolva-o em uma
transação que você reverte se a instrução escrever.

### Tuplas mortas, autovacuum, e VACUUM FULL

O Postgres usa MVCC: um `UPDATE` não sobrescreve uma linha, escreve uma
nova versão da linha e marca a antiga como morta, e um `DELETE` só marca a
linha como morta. Essas **tuplas mortas** ainda ocupam páginas, então uma
tabela pesadamente atualizada incha mesmo quando sua contagem lógica de
linhas é constante, e tabelas inchadas significam mais páginas para ler
para o mesmo resultado, incluindo através de índices, que incham junto.

`autovacuum` é o processo em segundo plano que recupera tuplas mortas para
reuso, e deveria sempre estar ligado. Vem habilitado por padrão no
Postgres, e provedores gerenciados (o Heroku Postgres entre eles) o
entregam habilitado; o modo de falha geralmente é alguém o desabilitando
para "reduzir carga", o que troca um custo pequeno e contínuo por um
eventual custo grande.

A ressalva importante: um `VACUUM` comum marca espaço reutilizável por
aquela mesma tabela mas **não** o devolve ao sistema operacional. Só o
`VACUUM FULL` de fato encolhe os arquivos em disco, e faz isso reescrevendo
a tabela inteira enquanto segura um lock `ACCESS EXCLUSIVE`, que bloqueia
leituras *e* escritas durante todo o tempo. Isso o torna uma operação de
janela de manutenção em uma tabela de produção, nunca algo para disparar
casualmente de um console porque um gráfico de disco pareceu alarmante.

## Trade-offs

- **Todo índice é um imposto permanente de escrita.** A aceleração de
  leitura é visível em um benchmark; o custo é espalhado invisivelmente
  por todo `INSERT` e `UPDATE` naquela tabela mais a pressão extra de disco
  e cache. Índices que nenhuma query usa são perda pura, e se acumulam
  silenciosamente, porque migrations adicionam índices com muito mais
  frequência do que os removem. Auditar `pg_stat_user_indexes` por índices
  nunca escaneados vale a pena periodicamente.
- **A escolha entre composto vs. duas colunas únicas não é "composto é
  melhor".** Um índice composto vence decisivamente para seu formato exato
  de query e é inútil para queries que não começam com sua primeira
  coluna; dois índices de coluna única são mais flexíveis e deixam o
  Postgres combiná-los com bitmap AND, ao custo de serem mais lentos para
  aquele formato único. Escolher composto antes de você ter uma query
  medida é otimizar uma query que você ainda não escreveu.
  ```ruby
  add_index :orders, [:customer_id, :status]  # great for (customer_id, status) and (customer_id)
                                              # useless for (status)
  ```
- **Índices parciais e de expressão são frágeis de uma forma
  específica**: só se aplicam quando o texto da query casa com o que o
  índice descreve. Um índice de expressão em `lower(email)` para
  silenciosamente de ajudar no momento em que alguém reescreve o scope
  para `where(email: ...)`, e nada falha; a query só fica lenta. Os dois
  merecem um comentário no model ao lado do scope para o qual existem.
- **`unique: true` é uma restrição, não só uma otimização.** Ele vai
  rejeitar escritas, o que significa que adicioná-lo a uma tabela
  existente pode falhar em dados de produção que já contêm duplicatas.
  Esse geralmente é o resultado correto, mas significa que a migration
  precisa de um passo de deduplicação primeiro, e transforma uma mudança
  de "performance" em uma mudança de integridade de dados com um risco
  real de rollout.
- **Um índice `DESC NULLS LAST` em `updated_at` só compensa se a
  estratégia de cache para a qual existe estiver de fato implementada.**
  Se você não está fazendo expiração de cache baseada em chave e não está
  renderizando feeds ordenados por `updated_at`, é um índice na coluna
  mais frequentemente escrita da tabela; o pior custo de escrita possível
  para nenhum benefício de leitura.
- **`VACUUM FULL` corrige inchaço mas custa disponibilidade.** O lock
  exclusivo significa que a tabela fica indisponível para a reescrita, o
  que em uma tabela grande pode ser muitos minutos. Quando indisponibilidade
  é inaceitável, as alternativas (`pg_repack`, ou reconstruir índices
  concorrentemente) trocam complexidade operacional por essa
  disponibilidade; não existe uma versão disso que seja de graça e
  instantânea ao mesmo tempo.

## Documentation Links

- [Active Record Migrations, Rails Guides](https://guides.rubyonrails.org/active_record_migrations.html#creating-a-standalone-migration) (doc)
- [PostgreSQL Documentation, Indexes](https://www.postgresql.org/docs/current/indexes.html) (doc)
- [PostgreSQL Documentation, EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html) (doc)
- [PostgreSQL Documentation, Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) (doc)
- [The Complete Guide to Rails Performance, Interacting with (SQL) Databases: Indexing](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
