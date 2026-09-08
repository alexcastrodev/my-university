---
version: 1.0
updatedAt: 2026-08-18
title: "Estratégia de Eager Loading e Operações em Massa no Banco"
summary: includes não é uma estratégia, é uma escolha entre preload e eager_load, e eager loading aninhado pode multiplicar objetos instanciados até ficar mais lento que o N+1 que substituiu. Mais: agregação em SQL, e activerecord-import para escritas em massa.
---
## Objective

`includes` costuma ser ensinado como a cura de uma linha para queries N+1,
o que esconde dois fatos que importam em produção: não é uma estratégia,
mas uma *escolha* entre duas (`preload` e `eager_load`) que o Rails faz por
você, e carregar mais associações não é monotonicamente melhor; eager
loading aninhado multiplica o número de objetos Ruby instanciados, então
pode acabar mais lento do que o lazy loading que substituiu. O mesmo
instinto se aplica no lado da escrita: um loop que chama `save` por
registro transforma uma operação lógica em milhares de idas e voltas,
quando o banco de dados e o `activerecord-import` conseguem expressar isso
em um punhado de instruções.

## Use Cases

- Decidir se uma página de índice lenta precisa de `preload(:author)`,
  `eager_load(:author)`, ou nenhum dos dois, quando a query já filtra ou
  ordena pelas colunas da associação.
- Revisar um PR onde um linter como o `bullet` sugeriu adicionar uma
  associação a `includes`, e julgar se essa sugestão de fato ajuda em
  volumes de dados de produção ou só triplica a contagem de objetos por
  linha.
- Substituir um relatório que carrega uma coleção e soma uma coluna em
  Ruby por um agregado único do lado do banco de dados.
- Escrever um script de seed, um importador, ou um backfill que precisa
  criar centenas de milhares de linhas, ou mutar uma tabela inteira de
  registros de uma vez.

## Deep Dive

### Três estratégias, não uma

```ruby
# 1. preload — one query per association, stitched together in Ruby
Book.preload(:author)
# SELECT * FROM books
# SELECT * FROM authors WHERE id IN (1, 2, 3, ...)

# 2. eager_load — a single LEFT OUTER JOIN
Book.eager_load(:author)
# SELECT books.*, authors.* FROM books LEFT OUTER JOIN authors ON authors.id = books.author_id

# 3. includes — Rails picks one of the two above
Book.includes(:author)                                   # behaves as preload
Book.includes(:author).where(authors: { country: "BR" })
    .references(:authors)                                # behaves as eager_load
```

A regra que o Rails aplica para `includes` é direta: se a query
**referencia** a tabela da associação (via `references(:authors)`, ou
implicitamente através de `joins`/`merge` sobre ela), precisa usar um JOIN,
então ele recorre a `eager_load`. Caso contrário, usa `preload`. É por isso
que `includes(:author).where(authors: { country: "BR" })` sem `references`
levanta um erro em vez de silenciosamente funcionar: a cláusula `WHERE`
nomeia uma tabela que a estratégia `preload` nunca coloca na query.

Quando cada estratégia vence:

- **`eager_load`** vence quando a query precisa filtrar ou ordenar pelas
  colunas da tabela associada. O JOIN é a única forma de expressar isso em
  uma instrução, e é uma ida e volta em vez de duas. Perde quando a
  associação é `has_many` e o pai tem colunas largas: o JOIN repete toda
  coluna do pai uma vez por linha filha na transmissão.
- **`preload`** vence quando a associação é um `has_many` grande e as
  linhas pai são pesadas; duas queries estreitas movem muito menos bytes do
  que um JOIN que duplica o pai. É a única opção que não pode ser combinada
  com condições sobre a associação. Também é a mais lenta das três no caso
  comum, porque sempre custa uma ida e volta extra mais o trabalho Ruby de
  parear filhos com pais pela chave estrangeira.
- **`includes`** é o padrão certo precisamente porque você geralmente não
  sabe de antemão qual formato a query vai assumir conforme evolui. Use o
  método explícito quando você já mediu e sabe melhor do que a heurística.

### Eager loading aninhado multiplica objetos

O custo de eager loading não é só contagem de query; é instanciação de
objeto. Considere fazer eager loading dos `cars` de um motorista, dos
`drivers` de cada carro, e das `parts` de cada carro com seus `vendors`:

```ruby
Car.includes(:drivers, parts: :vendor)
```

Isso não instancia `cars + drivers + parts + vendors` objetos. Instancia
aproximadamente:

```
cars * drivers  +  cars * parts * vendors
```

Com 50 carros, 3 motoristas cada, 40 peças cada e um vendor por peça, isso
é 150 + 6.000 = 6.150 objetos ActiveRecord construídos, cada um com seu
hash de atributos e type casting, para uma página que talvez renderize uma
dúzia deles. A versão com N+1 teria disparado mais queries mas construído
muito menos objetos; e alocação de objeto mais a pressão de garbage
collection por trás dela costuma ser o custo maior.

É por isso que um aviso do `bullet` é uma *hipótese*, não uma instrução. A
pergunta que ele não consegue responder é se a view de fato renderiza todo
um desses registros associados. Meça o endpoint das duas formas em volume
de dados realista antes de se comprometer com a versão com eager loading.

### Agregue no banco de dados, não em Ruby

```ruby
# Instantiates every order just to read one attribute off each:
Order.where(state: "paid").map(&:total).sum

# One SQL statement, no ActiveRecord objects at all:
Order.where(state: "paid").sum(:total)

Order.average(:total)
Order.minimum(:total)
Order.maximum(:total)
Order.count
Order.calculate(:sum, :total)

# Grouped aggregates come back as a Hash, still one query:
Order.group(:state).sum(:total)
# => { "paid" => 91_240.0, "pending" => 3_100.0 }
```

`sum`, `average`, `count`, `minimum`, `maximum` e o genérico `calculate`
todos compilam para funções agregadas SQL e retornam um escalar (ou um
`Hash` quando combinados com `group`). Nada é instanciado. O custo da
versão Ruby não é a soma; é construir milhares de objetos model e depois
descartá-los.

### Inserções em massa com activerecord-import

Um seed para 100 editoras, cada uma com 10.000 livros, cada um com 3
reviews, escrito da forma óbvia, é aproximadamente quatro milhões de
instruções `INSERT` individuais:

```ruby
# ~4,000,000 round-trips
100.times do
  publisher = Publisher.create!(name: Faker::Company.name)
  10_000.times do
    book = publisher.books.create!(title: Faker::Book.title)
    3.times { book.reviews.create!(rating: rand(1..5)) }
  end
end
```

A gem `activerecord-import` colapsa cada nível em uma instrução multi-linha
única:

```ruby
publishers = 100.times.map { Publisher.new(name: Faker::Company.name) }
Publisher.import(publishers)                 # 1 INSERT, returns records with ids

books = publishers.flat_map do |publisher|
  10_000.times.map { Book.new(publisher_id: publisher.id, title: Faker::Book.title) }
end
Book.import(books)                           # 1 INSERT

reviews = books.flat_map do |book|
  3.times.map { Review.new(book_id: book.id, rating: rand(1..5)) }
end
Review.import(reviews)                       # 1 INSERT
```

Três instruções em vez de quatro milhões. `import` também aceita uma forma
de colunas-e-valores que nunca constrói models de forma nenhuma, e opções
para comportamento de validação e upsert:

```ruby
Book.import(
  [:publisher_id, :title],
  [[1, "Ruby Under a Microscope"], [1, "Metaprogramming Ruby"]],
  validate: false,
  batch_size: 5_000
)

Book.import(
  books,
  on_duplicate_key_update: { conflict_target: [:isbn], columns: [:title, :price] }
)
```

`validate: false` pula validações do ActiveModel para o lote inteiro (boa
parte da aceleração, e um risco real se os dados não forem já confiáveis),
e `batch_size` impede que uma única instrução exceda os limites de tamanho
de query ou de parâmetros do banco de dados.

### Updates e deletes em massa

```ruby
# N UPDATEs, N sets of validations, N sets of callbacks:
Book.where(discontinued: true).each { |b| b.update!(price: 0) }

# One UPDATE statement:
Book.where(discontinued: true).update_all(price: 0)

# One UPDATE, with an expression evaluated by the database:
Book.where(discontinued: true).update_all("price = price * 0.5")

# One DELETE statement:
Book.where(discontinued: true).delete_all

# Instantiates each record and runs its destroy callbacks — N statements,
# but dependent: :destroy associations and callbacks are honoured:
Book.where(discontinued: true).destroy_all
```

`update_all` e `delete_all` compilam para uma única instrução e nunca
instanciam um model. `destroy_all` é o método de mutação em massa que ainda
roda callbacks `before_destroy`/`after_destroy` por registro e propaga
`dependent: :destroy`; é a escolha correta quando esses callbacks carregam
comportamento real, mas não é uma operação em massa no sentido SQL, e em um
escopo grande deveria ser conduzido através de batching em vez de rodado de
uma vez só.

## Trade-offs

- **`update_all` e `delete_all` pulam validações, callbacks, e
  timestamps.** Esse é o motivo inteiro deles serem rápidos, e o motivo
  inteiro deles serem perigosos: um `before_save` que mantém um contador
  desnormalizado sincronizado, um hook de auditoria do `paper_trail`, ou um
  `after_commit` de índice de busca simplesmente não vão disparar.
  `updated_at` também não é tocado, o que quebra silenciosamente qualquer
  coisa indexada nele, incluindo Russian doll caching.
  ```ruby
  Book.where(discontinued: true).update_all(price: 0, updated_at: Time.current)
  ```
- **`destroy_all` é seguro mas não é em massa.** Ele preserva callbacks ao
  custo de instanciar e deletar um registro de cada vez; em um escopo de
  500 mil linhas isso é 500 mil instruções `DELETE`. Escolher entre ele e
  `delete_all` é uma pergunta sobre seus callbacks, não sobre performance;
  e se os callbacks importam, a resposta honesta costuma ser manter
  `destroy_all` e mover o trabalho para um job em segundo plano, em vez de
  recorrer a `delete_all` e perder o comportamento.
- **O JOIN de `eager_load` duplica colunas do pai entre as linhas
  filhas.** Para um `has_many` com registros pai largos, um JOIN pode
  transferir várias vezes mais bytes do que as duas queries que `preload`
  emitiria. O instinto de "uma query é melhor que duas" está errado aqui
  com frequência suficiente para valer a pena checar as contagens de linha
  antes de forçar a estratégia.
- **`preload` não pode ser filtrado.** Como a associação é buscada em uma
  query `WHERE id IN (...)` separada, não há como restringir as linhas pai
  pelas colunas da associação. Se uma query precisa disso, `preload` não
  está só mais lento; está indisponível, e `includes` já terá trocado
  silenciosamente para `eager_load` de qualquer forma.
- **`import` com `validate: false` move a integridade de dados
  inteiramente para o banco de dados.** Qualquer regra que vive só em uma
  validação do ActiveModel e não em um `NOT NULL`, `CHECK`, ou índice único
  não é aplicada para aquele lote. O ganho de performance é real, mas é um
  argumento para colocar as restrições no schema, não para confiar na
  entrada.
- **Instruções em massa seguram locks por mais tempo.** Um único `UPDATE`
  sobre um milhão de linhas é uma transação segurando locks de linha por
  toda sua duração, o que pode bloquear escritores concorrentes de forma
  muito mais disruptiva do que mil updates pequenos fariam. `in_batches`
  combinado com `update_all` dá a maior parte da velocidade mantendo cada
  transação curta.

## Documentation Links

- [Active Record Query Interface, Eager Loading Associations, Rails Guides](https://guides.rubyonrails.org/active_record_querying.html#eager-loading-associations) (doc)
- [ActiveRecord::QueryMethods, Rails API docs](https://api.rubyonrails.org/classes/ActiveRecord/QueryMethods.html) (doc)
- [activerecord-import, GitHub](https://github.com/zdennis/activerecord-import) (doc)
- [The Complete Guide to Rails Performance, Common ActiveRecord Pitfalls](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
