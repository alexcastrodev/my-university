---
version: 1.0
updatedAt: 2026-08-17
title: "Russian Doll Caching e os Trade-offs do Cache Store"
summary: Expiração baseada em chave significa nunca mais invalidar um cache manualmente, mas só se a chave do fragmento externo souber sobre a coleção interna, e só se seu cache store for de fato rápido.
---
## Objective

Russian Doll caching é a estratégia de expiração baseada em chave do Rails
para cache de fragmentos: em vez de expirar manualmente uma entrada de
cache quando os dados subjacentes mudam (observers, sweepers, chamadas
explícitas a `expire_fragment`), toda chave de cache embute informação
suficiente (a classe do registro, id, e `updated_at`) para que uma mudança
nos dados produza automaticamente uma chave totalmente nova. A entrada
antiga nunca é explicitamente deletada; ela simplesmente se torna
inalcançável e eventualmente é removida pela própria política LRU do cache
store. Isso só funciona de ponta a ponta se todo fragmento, incluindo os
que envolvem coleções, incluir os dados certos na sua própria chave, e só
tem boa performance se o cache store subjacente for de fato rápido, o que
não é automático.

## Use Cases

- Fazer cache de um fragmento de view para um único registro (um
  comentário, uma página de produto) para que nunca precise de invalidação
  manual quando o registro é editado.
- Fazer cache de um fragmento que envolve uma *coleção* de registros (uma
  lista de comentários, uma grade de produtos) onde qualquer item mudando
  deveria invalidar o fragmento externo também.
- Escolher um cache store (`MemoryStore`, `FileStore`, `Dalli`/
  `redis-cache-store`) com base em latência de fato medida, não em qual é
  o padrão do Rails.
- Reconhecer quando fazer cache de um fragmento é de fato *mais lento* do
  que não fazer cache nenhum, para conteúdo barato de renderizar e apoiado
  por um cache store remoto.

## Deep Dive

### O mecanismo de expiração baseado em chave

```erb
<% cache comment do %>
  <%= comment.body %>
<% end %>
```

`cache comment` constrói uma chave que embute o nome da classe, o id, e o
`updated_at` de `comment` (mais um digest do próprio template). Editar o
comentário muda seu `updated_at`, que muda a chave, o que significa que o
fragmento de view é renderizado de novo e armazenado sob uma chave *nova*;
a entrada antiga simplesmente nunca é buscada de novo. Nenhum código
explícito de invalidação é jamais escrito.

### Fragmentos aninhados precisam que a chave externa saiba sobre a coleção interna

```erb
<% cache product do %>
  <% cache [product, product.reviews.maximum(:updated_at)] do %>
    <% product.reviews.each do |review| %>
      <% cache review do %>
        <%= review.body %>
      <% end %>
    <% end %>
  <% end %>
<% end %>
```

Se a chave do fragmento *externo* de `product` dependesse só do próprio
`updated_at` de `product`, editar uma única review não mudaria o
`updated_at` do produto; então o fragmento externo continuaria servindo uma
página cacheada obsoleta mesmo com o fragmento interno de `review`,
corretamente chaveado, tendo se atualizado sozinho. Incluir
`product.reviews.maximum(:updated_at)` na chave externa faz qualquer edição
de review mudar a chave externa também.

### `touch: true` propaga a invalidação pela cadeia de associação de graça

```ruby
class Review < ApplicationRecord
  belongs_to :product, touch: true
end
```

Salvar uma `Review` agora também atualiza automaticamente
`product.updated_at`. Qualquer fragmento cacheado com `cache product` pega
essa chave nova sem a ginástica de chave aninhada acima; `touch: true` é a
correção mais elegante exatamente para esse problema de propagação de
invalidação, onde quer que a associação permita.

### A latência do cache store domina a decisão

Em ordem de magnitude, operações `fetch` por segundo, do mais rápido ao mais
lento: `LruRedux` (em processo) > `MemoryStore` > `FileStore` > Dalli/Redis
local > um Redis/Memcache **remoto** pela rede, que pode ser
aproximadamente quatro ordens de magnitude mais lento que um cache em
processo. Um fragmento que custa alguns milissegundos para renderizar pode
renderizar *mais rápido sem cache* do que custa a ida e volta até um cache
store remoto; cache só compensa quando o custo de renderização de fato
excede a própria latência do cache store.

## Trade-offs

- **`FileStore` (o padrão do Rails em algumas configurações) não é LRU**:
  ele expira entradas por horário de escrita, não por frequência de acesso,
  então uma chave frequentemente acessada pode ser removida antes de uma
  chave que ninguém mais lê. Também tem performance ruim em plataformas com
  sistemas de arquivos efêmeros ou em rede.
- **Um cache store remoto pode tornar um fragmento barato de renderizar
  mais lento do que nenhum cache**: antes de envolver algo em `cache
  do...end`, vale a pena saber (medindo, não assumindo) tanto o custo de
  renderização quanto a latência real de ida e volta do cache store.
- **Russian Doll caching aninhado adiciona overhead real de autoria**: todo
  nível que envolve uma coleção precisa ter sua chave deliberadamente
  estendida com o `updated_at` máximo daquela coleção (ou a associação
  precisa de `touch: true`); pular isso em apenas um nível aninhado
  reintroduz silenciosamente conteúdo obsoleto naquele nível, sem nenhum
  erro para sinalizar que isso aconteceu.

## Documentation Links

- [Caching with Rails, Rails Guides](https://guides.rubyonrails.org/caching_with_rails.html) (doc)
- [ActiveSupport::Cache::Store, Rails API docs](https://api.rubyonrails.org/classes/ActiveSupport/Cache/Store.html) (doc)
- [The Complete Guide to Rails Performance, Caching in Rails](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
