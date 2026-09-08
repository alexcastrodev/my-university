---
version: 1.0
updatedAt: 2026-08-17
title: "Consultas N+1 e Métodos de Query em Métodos de Instância de Model"
summary: A fonte mais comum de N+1s escondidos não é um includes faltando, é um método de query do ActiveRecord morando silenciosamente dentro de um método de instância.
---
## Objective

A causa mais comum de uma consulta N+1 "surpresa" em uma aplicação Rails não
é um `includes` faltando em um controller; é um método de query do
ActiveRecord (`where`, `find_by`, `joins`, `select`, `order`, `pluck`, e
umas quinze outras) chamado de dentro de um **método de instância de
model**. O método parece perfeitamente inofensivo isoladamente; o problema
só aparece quando ele é chamado uma vez por elemento dentro de um loop ou
uma partial de view, momento em que dispara uma query por registro em vez
de uma query total.

## Use Cases

- Revisar em code review um novo método de instância em um model
  ActiveRecord que lê como `def recent_reviews; Review.where(user:
  self).order(created_at: :desc); end`, reconhecendo esse formato como um
  risco de N+1 antes de ir para produção, não depois de um profiler
  encontrá-lo lá.
- Escolher entre `find_each`/`in_batches` e `.all.each` ao iterar uma
  tabela grande, para evitar carregar o conjunto de resultado inteiro na
  memória de uma vez.
- Decidir quando eager loading (`includes`/`preload`/`eager_load`)
  realmente ajuda versus quando busca demais e instancia mais objetos do
  que o código precisa.
- Auditar um endpoint lento contando queries SQL nos logs de desenvolvimento
  contra um volume de dados que de fato se parece com produção, não um
  punhado de registros de seed.

## Deep Dive

### O N+1 escondido: um método de query dentro de um método de instância

```ruby
class User < ApplicationRecord
  has_many :reviews

  # Looks harmless on its own...
  def recent_reviews
    reviews.where("created_at > ?", 1.week.ago).order(created_at: :desc)
  end
end
```

```erb
<% @users.each do |user| %>
  <%= user.recent_reviews.count %>
<% end %>
```

Mesmo que `@users` tenha sido carregado com uma única query, `user.
recent_reviews` reroda uma query `WHERE`/`ORDER BY` **por usuário**, porque
`reviews.where(...)` é uma query ActiveRecord nova, não um filtro sobre uma
associação já carregada. Nada nesse código está individualmente errado; o
método lê bem, a view lê bem; o N+1 só existe na interseção dos dois.

A correção não é necessariamente "adicionar `includes(:reviews)`" (isso
ainda deixaria a filtragem `WHERE`/`ORDER BY` acontecer uma vez por usuário
em Ruby, o que é tranquilo para um punhado de registros associados, mas
desperdício para milhares). Muitas vezes a correção melhor é empurrar a
lógica de filtragem para um **scope** em `Review` e chamá-lo explicitamente
do controller com eager loading, mantendo o método de instância do model
completamente livre de chamadas de query:

```ruby
class Review < ApplicationRecord
  scope :recent, -> { where("created_at > ?", 1.week.ago).order(created_at: :desc) }
end

# controller
@users = User.includes(:reviews).map { |u| [u, u.reviews.select { |r| r.created_at > 1.week.ago }] }
```

### `find_each` / `in_batches` em vez de `.all.each`

```ruby
# Loads every row into memory before iterating at all:
User.all.each { |u| u.update!(normalized_email: u.email.downcase) }

# Loads and processes in batches of 1000 by default:
User.find_each { |u| u.update!(normalized_email: u.email.downcase) }

# Same batching, but yields an ActiveRecord::Relation per batch, good for update_all:
User.in_batches { |batch| batch.update_all("normalized_email = LOWER(email)") }
```

`.all.each` materializa a tabela inteira como objetos Ruby antes de o bloco
sequer rodar uma vez. Em uma tabela de 100 mil linhas isso é a diferença
entre um script que roda em memória constante e um que incha para
centenas de megabytes antes de fazer qualquer trabalho.

### `select`/`pluck` para evitar instanciar o que você não precisa

```ruby
User.select(:id, :email)   # ActiveRecord objects, but only 2 attributes loaded
User.pluck(:id, :email)    # raw arrays, no ActiveRecord objects instantiated at all
```

`pluck` pula a instanciação de objeto ActiveRecord completamente, o que
importa quando a tabela é grande e o código só precisa dos valores crus
(construir um `Hash`, uma exportação CSV, um filtro `where(id: ...)` para
uma segunda query).

## Trade-offs

- **`select(:col1, :col2)` significa que acessar qualquer outro atributo
  levanta `ActiveModel::MissingAttributeError`** em vez de retornar `nil`
  silenciosamente; isso geralmente é uma vantagem (expõe um bug real
  exatamente no ponto de chamada), mas significa que você não pode
  selecionar parcialmente e esperar que o resto dos métodos do model
  continue funcionando.
  ```ruby
  user = User.select(:id).first
  user.email  # ActiveModel::MissingAttributeError
  ```
- **Eager loading de associações aninhadas multiplica objetos
  instanciados, não só queries**: `includes(cars: { parts: :vendor })`
  pode instanciar `cars.length * parts.length * vendors.length` objetos
  para um único registro de nível superior. Dois ou três níveis de
  profundidade, fazer eager loading cegamente de tudo que um linter
  aponta pode ser *mais lento* do que o N+1 que pretendia corrigir; sempre
  meça em vez de fazer eager loading por reflexo.
- **Mover lógica de query dos métodos de instância para scopes é uma
  decisão de design com um custo real**: significa que o controller (ou
  onde quer que o scope seja chamado) precisa saber mais sobre como montar
  os dados do que sabia quando o model expunha um único método
  conveniente; o ganho só aparece na escala de N chamadas, não em um
  script pontual.

## Documentation Links

- [Active Record Query Interface, Rails Guides](https://guides.rubyonrails.org/active_record_querying.html) (doc)
- [Active Record Basics, find_each / in_batches, Rails Guides](https://guides.rubyonrails.org/active_record_basics.html) (doc)
- [The Complete Guide to Rails Performance, Common ActiveRecord Pitfalls](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
