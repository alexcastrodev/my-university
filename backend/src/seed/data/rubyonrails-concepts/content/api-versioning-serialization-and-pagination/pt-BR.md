---
version: 1.0
updatedAt: 2026-08-21
title: "Versionamento de API, Serialização e Paginação no Rails"
summary: Versionar, serializar e paginar uma API são a mesma decisão tomada três vezes, qual contrato você está disposto a quebrar e quando, e errar qualquer uma delas quebra clientes silenciosamente em vez de alto. Cobre versionamento por caminho de URL vs. header, Jbuilder vs. PORO vs. gems de serializador dedicadas (incluindo o status de manutenção genuinamente ambíguo do active_model_serializers vs. alternativas atuais como Blueprinter, Alba e Panko), e paginação por offset vs. cursor/keyset com Kaminari e Pagy.
---
## Objective

Três decisões que parecem não relacionadas (como você versiona uma rota,
como você transforma um objeto ActiveRecord em JSON, e como você pagina
por uma coleção) na verdade são a mesma decisão tomada três vezes: *qual
contrato estou disposto a quebrar, e quando*. Erre o versionamento e o
aplicativo mobile de um cliente quebra silenciosamente no seu próximo
deploy. Erre a serialização e você ou vaza uma coluna que não pretendia
expor ou come um N+1 por resposta. Erre a paginação e um cliente "perde"
linhas toda vez que alguém insere um registro entre duas de suas
requisições de página; um bug que nunca aparece em uma demo com 20
registros de seed e aparece constantemente em uma tabela com 20 milhões.
Este conceito é sobre tomar essas três decisões de propósito, com o
estado atual real do ecossistema Ruby (não folclore de blog de cinco anos
atrás) por trás de cada escolha; o próprio README do
`active_model_serializers`, por exemplo, diz que seus mantenedores em
grande parte seguiram em frente e aponta os leitores para alternativas,
que é um fato que vale a pena conhecer antes de você dar `bundle add`
nele em 2026.

## Use Cases

- Montar `/api/v1/...` para um cliente mobile cuja cadência de release
  você não controla, e precisar de uma resposta real para o que acontece
  quando `/api/v2` for lançado.
- Revisar um PR que adiciona `render json: @user.as_json` (ou uma partial
  Jbuilder que toca em uma associação dentro de um loop) e precisar saber
  qual modo de falha (atributo vazado vs. N+1) você de fato está
  revisando.
- Escolher se uma nova página de índice de admin interna precisa de
  `page`/`per` do Kaminari (simples, números de página, tabela pequena) ou
  se um feed público, com muita escrita, de scroll infinito precisa de
  paginação por cursor em vez disso.
- Decidir se um conjunto crescente de respostas de API justifica trazer
  uma gem de serializador dedicada, ou se templates Jbuilder ainda são a
  quantidade certa de maquinário para o tamanho do time.
- Auditar uma API existente em busca de uma linha no `Gemfile` fixando
  `active_model_serializers` e decidir se isso é um risco vivo ou uma
  dependência estável o bastante para deixar quieta.

## Deep Dive

### Versionamento por caminho de URL

O formato comum: uma rota com namespace mais um controller com namespace.

```ruby
# config/routes.rb
namespace :api do
  namespace :v1 do
    resources :orders, only: %i[index show]
  end
  namespace :v2 do
    resources :orders, only: %i[index show]
  end
end
```

```ruby
# app/controllers/api/v1/orders_controller.rb
module Api
  module V1
    class OrdersController < Api::BaseController
      def show
        render json: OrderSerializerV1.new(order).as_json
      end
    end
  end
end
```

`GET /api/v1/orders/42` e `GET /api/v2/orders/42` são duas URLs
diferentes, então toda camada que cacheia por URL (um CDN, Rack::Cache, um
navegador) faz a coisa certa automaticamente. Também é trivialmente
depurável: `curl https://api.example.com/api/v2/orders/42` mostra
exatamente o que um cliente vê, sem headers para lembrar. O custo aparece
depois: a versão mora na URL base fixada no código de todo cliente, em
toda documentação interna, no caminho de toda linha de log; atualizá-la
não é uma flag de header, é uma migração coordenada de cliente.

### Versionamento baseado em header (media-type)

O roteamento do Rails suporta restrições arbitrárias baseadas em
requisição: uma classe (ou lambda) com um método `matches?(request)`,
como documentado para o mecanismo geral de constraints no Routing Guide
(seu próprio exemplo é lista de permissão de IP, mas o mecanismo é o
mesmo usado para negociação de versão):

```ruby
# app/constraints/api_version_constraint.rb
class ApiVersionConstraint
  def initialize(version:)
    @version = version
  end

  def matches?(request)
    request.headers["Accept"]&.include?("application/vnd.myapp.v#{@version}+json")
  end
end
```

```ruby
# config/routes.rb
namespace :api, path: "api" do
  scope module: :v1, constraints: ApiVersionConstraint.new(version: 1) do
    resources :orders, only: %i[index show]
  end
  scope module: :v2, constraints: ApiVersionConstraint.new(version: 2) do
    resources :orders, only: %i[index show]
  end
end
```

Agora `GET /api/orders/42` é uma única URL para toda versão; que é o
argumento de venda para puristas de REST (o recurso tem uma identidade; a
*representação* varia) e o problema para todo mundo mais. Você não
consegue dar `curl` nele sem lembrar de definir `-H "Accept:
application/vnd.myapp.v2+json"`, então todo ticket de suporte e toda
checagem manual rápida fica mais difícil. Pior: um cache indexado só por
URL (a maioria dos CDNs, por padrão) não consegue diferenciar v1 de v2 e
vai tranquilamente servir a resposta v1 em cache de um cliente para uma
requisição v2 a menos que você configure explicitamente `Vary: Accept`;
um header que a maioria dos times esquece de definir e ainda mais CDNs
não respeitam bem.

### Serialização: Jbuilder vs. objetos Ruby simples vs. uma gem dedicada

**Jbuilder** vem com o Rails e mora na camada de view; é um template, não
uma classe:

```ruby
# app/views/api/v1/orders/show.json.jbuilder
json.id order.id
json.total order.total_cents
json.status order.status
json.line_items order.line_items do |item|
  json.sku item.sku
  json.quantity item.quantity
end
```

É flexível (Ruby completo em um template, condicionais, partials) e não
exige nenhuma dependência nova ou classe por model. O custo é exatamente
essa flexibilidade: nada impede `json.line_items order.line_items do
|item|` de chamar `item.discounts.where(...)` dentro do bloco; um método
de query chamado uma vez por iteração de loop é o mesmo formato de N+1
coberto no conceito irmão `n-plus-one-and-query-methods-in-models`, exceto
que aqui está escondido dentro de um template em vez de um método de
model, o que o torna mais fácil de perder na revisão.

**Um serializador PORO simples**: nenhuma gem, só uma classe com uma
lista explícita de atributos:

```ruby
class OrderSerializer
  def initialize(order)
    @order = order
  end

  def as_json(*)
    {
      id: @order.id,
      total: @order.total_cents,
      status: @order.status,
      line_items: @order.line_items.map { |i| { sku: i.sku, quantity: i.quantity } }
    }
  end
end
```

Zero dependências, explícito, fácil de testar isoladamente. Também é mais
um arquivo por model e não te dá nada de graça; sem convenção de chave
raiz, sem cache de associação, sem caminho de geração de JSON
benchmarkado. É o padrão certo até o número de serializadores ou o
requisito de performance crescer o bastante para querer uma abstração
compartilhada.

**Gems de serializador dedicadas**: e aqui o ecossistema de fato se
moveu. `active_model_serializers` (AMS) é o nome que a maioria dos
tutoriais da era 2015-2018 usa, mas o próprio README diz claramente:
*"Quase nenhum dos mantenedores da 0.8, 0.9, ou 0.10 anterior ainda está
trabalhando na AMS,"* seu último release marcado é `0.10.0.rc1` de
**abril de 2015**, e a própria seção "Alternatives" do README aponta os
leitores para Blueprinter e Alba. Isso não é o mesmo que "abandonado"; o
repositório ainda recebe commits esporádicos (mais recentemente no fim de
2025) e issues ainda são triadas; então chamá-lo de morto seria
exagerado; mas chamá-lo de "o padrão" em 2026, que é o que a maioria dos
posts de blog ainda faz, está simplesmente desatualizado. Trate uma nova
dependência da AMS como uma decisão que precisa de sua própria
justificativa, não um padrão seguro.

Duas gems que estão ambas atualmente ativas (commits com dias de
diferença uma da outra no momento desta escrita, ambas com adoção real:
Blueprinter ~1.3k estrelas no GitHub, Alba ~1.2k):

```ruby
# Blueprinter, github.com/procore-oss/blueprinter
class OrderBlueprint < Blueprinter::Base
  identifier :id
  fields :total_cents, :status

  association :line_items, blueprint: LineItemBlueprint
end

OrderBlueprint.render(order)
```

```ruby
# Alba, github.com/okuramasafumi/alba
class OrderResource
  include Alba::Resource

  attributes :id, :status
  attribute :total_cents

  many :line_items, resource: LineItemResource
end

OrderResource.new(order).serialize
```

Uma terceira opção que vale a pena conhecer especificamente por vazão
bruta é o **Panko** (`panko_serializer`), que é explicitamente construído
para velocidade; ele usa `Oj` para geração de JSON e pré-calcula
metadados de serialização com antecedência em vez de no momento da
requisição:

```ruby
class OrderSerializer < Panko::Serializer
  attributes :id, :total_cents, :status
  has_many :line_items, serializer: LineItemSerializer
end

render json: Panko::ArraySerializer.new(orders, each_serializer: OrderSerializer).to_json
```

O Panko tem uma comunidade menor do que Blueprinter ou Alba
(aproximadamente 600 estrelas no GitHub vs. 1.2k+); vale a pena pesar se
você valoriza um pool maior de respostas do Stack Overflow e
contribuidores sobre números brutos de benchmark.

As três gems compartilham o mesmo trade-off contra o Jbuilder: uma lista
de atributos explícita e declarada por classe significa que um revisor
(e a própria gem) consegue ver exatamente o que é exposto, e declarações
de associação são um ponto natural para lembrar de dar `includes`/
`preload` mais acima; mas é mais um arquivo, mais um nome de classe, e
mais uma coisa para manter sincronizada quando uma coluna é renomeada.

### Paginação: offset vs. cursor (keyset)

**Paginação baseada em offset**: o familiar `page`/`per_page`, via
Kaminari:

```ruby
User.order(:id).page(params[:page]).per(25)
```

ou via Pagy, que se vende especificamente por ser mais leve que as
alternativas; sua própria documentação afirma aproximadamente **40x mais
rápido, 36x menos memória, e 35x alocação de objeto mais simples** do que
gems concorrentes em seu benchmark, para o mesmo trabalho de paginação por
offset:

```ruby
# app/controllers/application_controller.rb
include Pagy::Method

# in a controller action
@pagy, @orders = pagy(:offset, Order.order(:id))
```

As duas calculam `LIMIT`/`OFFSET` por baixo dos panos. O problema de
correção com `OFFSET` é independente de qual gem o gera: **uma linha
inserida ou deletada antes do offset atual desloca toda página depois
dela.** Se um cliente busca a página 1 (linhas 1-25), alguém deleta a
linha 3, e o cliente busca a página 2, a linha 26 deslocou para o que a
página 1 agora retornaria; o cliente silenciosamente pula uma linha que
nunca viu. Insira em vez de deletar, e uma linha pode ser *duplicada*
entre duas requisições de página. Nenhuma gem consegue corrigir isso; é
inerente ao `OFFSET` contra uma tabela que muda entre requisições.

**Paginação por cursor (keyset)** evita isso não contando linhas de forma
nenhuma; filtra pelo último valor visto de uma coluna estável e ordenada:

```sql
-- the manual version of what keyset pagination does
SELECT * FROM orders WHERE id > :last_seen_id ORDER BY id LIMIT 25;
```

O Pagy traz isso como um paginador de primeira classe, descrito em sua
própria documentação como "a técnica mais rápida":

```ruby
@pagy, @orders = pagy(:keyset, Order.order(:id))
```

Como cada página é definida por "me dê linhas depois do cursor X", uma
linha inserida ou deletada em outro lugar da tabela não consegue deslocar
o que uma página retorna; o conjunto de resultado para um dado cursor é
estável independente de escritas concorrentes. O que ela abre mão é
navegação arbitrária: não há um `WHERE id > :cursor_for_page_5` sem ter
percorrido as páginas 1 a 4 primeiro, então "pule para a página 5" ou
"mostre contagem de páginas: 40" (os dois triviais com `OFFSET`) não
estão disponíveis com paginação keyset.

### Um framework de decisão

- **URL-path vs. versionamento por header**: o padrão é URL-path. É
  amigável a cache por construção, cURL-ável, e legível em toda linha de
  log; propriedades que importam para qualquer API com consumidores
  externos ou um plantão depurando às 2 da manhã. Recorra a versionamento
  por header só quando você já está comprometido com REST estrito
  orientado a media-type (uma especificação como JSON:API, ou um
  ecossistema de cliente que já negocia tipos de conteúdo) e está
  preparado para ser dono dos headers `Vary` corretamente em toda camada
  de cache.
- **Quando uma gem de serializador dedicada justifica sua
  complexidade**: quando uma base de código tem serializadores o
  bastante para que uma convenção compartilhada (declarações de
  associação, tratamento de nulo consistente, um único lugar para mudar
  o formato JSON globalmente) vença N templates Jbuilder ou POROs
  levemente diferentes; ou quando o tempo de serialização é um custo
  real e medido em um endpoint quente, que é quando a velocidade apoiada
  em Oj do Panko compensa sua comunidade menor. Para um punhado de
  endpoints em um time pequeno, Jbuilder simples ou um PORO não é
  subengenharia; é a quantidade certa de maquinário.
- **Quando paginação por cursor vale a pena perder "pule para a página
  5"**: qualquer endpoint paginado por um usuário final rolando para
  frente por um feed (scroll infinito, uma timeline mobile, um log de
  webhook/evento que um cliente consulta incrementalmente) onde correção
  sob escritas concorrentes importa mais que acesso aleatório. Mantenha
  paginação por offset para tabelas de backoffice de admin e em qualquer
  lugar onde um humano de fato digita um número de página ou precisa de
  uma UI de contagem total de páginas; essa é exatamente a interação que
  paginação keyset não consegue atender.

## Trade-offs

- **Versionamento por header é invisível para caches indexados por
  URL.** Uma camada de CDN ou `Rack::Cache` que não faz `Vary` em
  `Accept` vai servir uma resposta v1 para uma requisição v2 (ou o
  contrário) porque, do ponto de vista do cache, `GET /api/orders/42` é
  uma única chave de cache independente dos headers.
  ```ruby
  # Without Vary: Accept, a shared cache can't tell these apart:
  # GET /api/orders/42, Accept: application/vnd.myapp.v1+json
  # GET /api/orders/42, Accept: application/vnd.myapp.v2+json
  ```
- **A flexibilidade do Jbuilder também é sua armadilha.** Nada impede um
  método de query de ser chamado dentro de um loop no template; o mesmo
  formato de N+1 de chamar um método de query de um método de instância
  (veja o conceito irmão `n-plus-one-and-query-methods-in-models`), exceto
  que é menos visível porque está em um arquivo `.jbuilder` que um
  revisor de código pode passar por cima em vez de um método de model que
  ele examina.
  ```erb
  json.array! @orders do |order|
    json.id order.id
    # Fires once per order unless `line_items` was eager-loaded upstream:
    json.line_item_count order.line_items.where(refunded: false).count
  end
  ```
- **O status do `active_model_serializers` é genuinamente ambíguo, não
  resolvido.** Não está arquivado, e ainda recebe commits e atividade de
  issue ocasionais, mas seu último release marcado é anterior à maioria
  das versões do Rails atualmente suportadas, e o próprio README dos
  mantenedores diz que eles em grande parte pararam o desenvolvimento
  ativo e apontam para outro lugar. Não trate nem "está morto" nem "está
  tranquilo, todo mundo usa" como fato resolvido; confira o rastreador de
  issues e o histórico de commits você mesmo antes de depender dele para
  um projeto novo.
- **Uma gem de serializador ou paginador dedicada é uma dependência com
  sua própria cadência de atualização**: Blueprinter, Alba, e Panko estão
  todas ativamente mantidas hoje, mas "ativamente mantida hoje" é um
  instantâneo, não uma garantia; a mesma história da AMS é o lembrete de
  que "a gem atualmente recomendada" e "a gem em que essa base de código
  ainda vai estar confortavelmente daqui a cinco anos" não são a mesma
  afirmação.
- **Paginação keyset exige uma coluna de ordem genuinamente única,
  estável, e indexada**: uma coluna de ordem não única produz páginas
  silenciosamente erradas, não um erro:
  ```ruby
  # BUG: created_at has ties (e.g. bulk-imported rows with identical timestamps),
  # so rows sharing a timestamp can be skipped or repeated across pages.
  @pagy, @orders = pagy(:keyset, Order.order(:created_at))

  # Correct: order (and index) on a column guaranteed unique, like id,
  # or a compound (created_at, id) tiebreak.
  @pagy, @orders = pagy(:keyset, Order.order(:id))
  ```
- **O custo de `COUNT(*)` da paginação por offset é real em tabelas
  grandes**: calcular `total_pages` significa uma query `COUNT` em toda
  requisição a menos que você opte por um modo sem contagem/aproximado
  (o Pagy oferece variantes `countless`/`COUNTISH` especificamente para
  evitar isso); a chamada ingênua `page`/`per` paga esse custo por
  padrão.

## Documentation Links

- [Routing constraints, Rails Guides](https://guides.rubyonrails.org/routing.html) (doc)
- [Jbuilder](https://github.com/rails/jbuilder) (doc)
- [Kaminari](https://github.com/kaminari/kaminari) (doc)
- [Pagy](https://github.com/ddnexus/pagy) (doc)
- [Blueprinter](https://github.com/procore-oss/blueprinter) (doc)
- [Alba](https://github.com/okuramasafumi/alba) (doc)
- [Panko](https://panko.dev/) (doc)
- [active_model_serializers, status and alternatives](https://github.com/rails-api/active_model_serializers) (doc)
