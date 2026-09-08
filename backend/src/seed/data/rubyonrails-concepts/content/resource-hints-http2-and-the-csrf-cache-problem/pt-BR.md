---
version: 1.0
updatedAt: 2026-08-17
title: "Resource Hints, HTTP/2 e o Problema de Cache do CSRF"
summary: Por que um script injetado via JavaScript é invisível para o preloader do navegador, o que o HTTP/2 de fato muda, e por que o token CSRF torna páginas HTML do Rails não cacheáveis.
---
## Objective

A maior parte do que um usuário experimenta como velocidade de página
acontece no navegador, não no servidor Rails, e um detalhe específico do
Rails silenciosamente derrota uma categoria inteira de cache de front-end
antes mesmo de ela começar: o token CSRF embutido em todo `<head>`
renderizado torna documentos HTML padrão efetivamente não cacheáveis via
HTTP. Entender resource hints, o que o HTTP/2 de fato muda, e onde esse
token CSRF morde é o que separa "o servidor responde em 80ms" de uma
página que de fato parece rápida de carregar.

## Use Cases

- Decidir qual resource hint (`dns-prefetch`, `preconnect`, `prefetch`,
  `prerender`) vale a pena usar para um recurso de terceiros específico,
  em vez de adicionar por reflexo o mais forte em todo lugar.
- Entender por que cache HTTP (`Cache-Control`, ETags) funciona bem para
  uma API JSON mas essencialmente não consegue para uma página HTML Rails
  normal.
- Decidir se dividir `application.js` em bundles de vendor/aplicação ainda
  importa uma vez que a aplicação é servida sobre HTTP/2.
- Auditar se um script injetado via JavaScript (um padrão comum de
  analytics) é invisível para o preloader especulativo do navegador, e
  corrigir isso.

## Deep Dive

### O preloader, e o único padrão que o derrota

```html
<!-- Invisible to the preloader — parser can't see this coming: -->
<script>
  var s = document.createElement("script");
  s.src = "https://analytics.example.com/a.js";
  document.head.appendChild(s);
</script>

<!-- Visible to the preloader, downloads in parallel with parsing: -->
<script async defer src="https://analytics.example.com/a.js"></script>
```

Navegadores rodam um parser secundário leve (o "preloader") que escaneia à
frente por recursos para começar a baixar especulativamente enquanto o
parser principal está bloqueado em outra coisa, mas ele funciona fazendo
pattern matching em HTML literal, então uma tag script *criada por
JavaScript* é invisível para ele. O padrão clássico de snippet de analytics
acima perde esse benefício silenciosamente; uma tag real `<script async
defer>` não perde.

### Resource hints, do mais fraco ao mais forte

```html
<link rel="dns-prefetch" href="//cdn.example.com">
<link rel="preconnect" href="https://api.example.com">
<link rel="prefetch" href="/next-page.html">
<link rel="prerender" href="/next-page.html">
```

`dns-prefetch` resolve só o DNS; o hint mais barato, e hoje majoritariamente
suplantado. `preconnect` faz DNS + TCP + TLS com antecedência, economizando
até cinco idas e voltas; seu melhor uso é um recurso cuja *origem* é
conhecida mas cuja *URL exata* ainda não é (algo injetado por um script).
`prefetch` baixa um recurso para a *próxima* navegação, por completo (sem
suporte no Safari). `prerender` renderiza a página seguinte inteira
especulativamente; raramente suportado, e caro porque busca também todo
subrecurso daquela página. No topo da web, `dns-prefetch` vê adoção real;
`preconnect`/`prefetch` são usados por uma fração pequena de sites, e
`prerender` por menos ainda; usar o hint errado (forte demais) para a
situação desperdiça largura de banda em especulação que não compensa.

### O problema do token CSRF

```erb
<meta name="csrf-token" content="<%= form_authenticity_token %>">
```

Essa tag, presente no `<head>` de essencialmente toda página Rails
renderizada no servidor, significa que a resposta HTML é diferente por
sessão, o que a torna efetivamente **não cacheável** por qualquer cache HTTP
compartilhado (um CDN, um cache de navegador compartilhado). Cache HTTP real
(`Cache-Control`, `ETag`/`304`) funciona bem para uma API JSON, que
tipicamente não carrega estado de sessão da mesma forma, mas "só faça cache
da página HTML inteira na camada HTTP" não funciona para uma view Rails
autenticada normal, não importa quão bem os headers `Cache-Control` sejam
ajustados.

### HTTP/2: o que de fato muda

```
HTTP/1.1: 6 connections per domain limit → splitting assets into many small
          files helps (parallel downloads up to that limit).
HTTP/2:   one multiplexed connection, many streams → splitting into many
          small files stops mattering the same way; header compression and
          stream prioritization become the free wins instead.
```

Concatenar e fazer domain-sharding de assets eram otimizações da era
HTTP/1.1 contornando seu limite de conexão por domínio; sob a multiplexação
do HTTP/2, baixar muitos arquivos pequenos custa próximo do que custa um
arquivo grande, então essa otimização específica para de compensar (embora
dividir por *frequência de mudança*, vendor vs. código da aplicação, ainda
possa fazer sentido por motivos de cache-busting). Os ganhos do HTTP/2 que
se aplicam independente do código da aplicação (compressão de header,
priorização de stream) exigem terminação em um CDN ou proxy reverso na
frente da aplicação Rails; o Rack/Rails em si não fala HTTP/2 diretamente.

## Trade-offs

- **Um script injetado via `document.createElement` perde visibilidade do
  preloader silenciosamente**: convertê-lo para uma tag real `<script
  async defer>` é quase um ganho gratuito onde for possível.
- **`preconnect` usado em todo domínio de terceiros "só por garantia" gasta
  um recurso real (uma conexão TCP+TLS aberta) especulativamente**:
  reserve-o para origens que de fato vão ser usadas, não aplicado por
  reflexo em todo lugar.
- **O problema de cacheabilidade do token CSRF no `<head>` não tem
  correção na camada HTTP**: as opções práticas são cache de
  fragmento/Russian Doll na camada de aplicação (veja aquele conceito), ou
  mover conteúdo genuinamente público para uma rota que não renderiza o
  token de autenticidade de forma nenhuma.

## Documentation Links

- [Resource Hints, W3C](https://www.w3.org/TR/resource-hints/) (doc)
- [Layouts and Rendering in Rails, CSRF meta tags](https://guides.rubyonrails.org/layouts_and_rendering.html) (doc)
- [The Complete Guide to Rails Performance, Resource Hints, HTTP/2 and You](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
