---
version: 1.0
updatedAt: 2026-08-21
title: "Autoloading com Zeitwerk e Modularizando Grandes Aplicações Rails"
summary: A regra de o caminho do arquivo espelhar o namespace do Zeitwerk é um contrato em tempo de execução, não um guia de estilo; violá-la te dá um Zeitwerk::NameError, muitas vezes no primeiro eager load em CI ou produção em vez de em desenvolvimento local. Este conceito cobre o próprio contrato, as colisões de sigla e nomenclatura STI que o quebram em escala, e as duas ferramentas reais para desenhar fronteiras de módulo, Rails Engines e Packwerk, com os trade-offs concretos entre elas.
---
## Objective

O Zeitwerk não é um detalhe de implementação que você pode ignorar depois
que a aplicação inicializa; é um *contrato* contra o qual você escreve
código todo dia, e violá-lo é um travamento em tempo de execução, não um
capricho de estilo. Um arquivo em `app/services/api/user_sync.rb` que
define `class UserSync` em vez de `Api::UserSync` não falha no boot em
desenvolvimento; falha na primeira vez que algo referencia a constante,
com um `Zeitwerk::NameError`, potencialmente em produção depois de um
deploy que "funcionou" porque o caminho de código não foi eager-loaded
até a primeira requisição chegar nele. Conforme uma aplicação cresce além
de algumas centenas de models e services, esse mesmo contrato se torna a
coisa que ou torna a modularização gratuita (namespaces mapeiam
diretamente para diretórios, sem `require` manual) ou a coisa contra a
qual engenheiros brigam quando os diretórios de dois times colidem na
mesma sigla. Este conceito é sobre conhecer as regras reais que o
Zeitwerk impõe, as formas concretas de elas quebrarem em escala, e as
duas ferramentas reais (Rails Engines e Packwerk) para desenhar fronteiras
quando "tudo é um único namespace `app/` grande" para de funcionar.

## Use Cases

- Depurar um `Zeitwerk::NameError` no CI ou no deploy que nunca apareceu
  em desenvolvimento local porque o arquivo com problema nunca foi
  autoloaded até o eager loading rodar.
- Decidir o que fazer quando um nome de classe legítimo é uma sigla
  (`API`, `VAT`, `HTML`) e a camelização padrão do Zeitwerk produz a
  constante errada.
- Rodar `bin/rails zeitwerk:check` como um gate de CI antes de um deploy,
  em vez de descobrir uma violação de nomenclatura na primeira vez que a
  produção faz eager load da aplicação.
- Escolher entre uma Rails Engine completa, um pacote Packwerk, ou "só
  adicione outro diretório sob `app/`" quando um time quer isolar um
  módulo delimitado de um monólito existente.
- Diagnosticar por que o tempo de boot continua crescendo lançamento após
  lançamento, e se a correção é um problema de organização de código
  (eager load demais) ou um problema de arquitetura (acoplamento demais
  em uma única unidade de deploy).
- Revisar um PR que adiciona um novo namespace de nível superior e decidir
  se ele pertence em `app/`, em um novo pacote Packwerk, ou em uma engine
  extraída.

## Deep Dive

### O contrato central do Zeitwerk

O Zeitwerk substituiu o autoloader "clássico" do Rails no Rails 6, e a
regra que ele impõe é simples de declarar e fácil de violar: **caminhos
de arquivo espelham caminhos de constante**. Um diretório é um namespace,
um arquivo é uma constante, e aninhar um dentro do outro significa
aninhar o módulo dentro da classe:

```
app/models/user.rb                  -> User
app/models/billing/invoice.rb       -> Billing::Invoice
app/services/api/user_sync.rb       -> Api::UserSync
```

Não há `require`, nem `require_dependency`, nem `require_relative` para o
código da sua própria aplicação sob um caminho de autoload; o Zeitwerk
resolve a constante para um caminho de arquivo na primeira referência e a
carrega. Qualquer chamada `require_dependency` ainda em uma base de
código antiga é um resquício do autoloader clássico; é uma rede de
segurança no-op sob o Zeitwerk na melhor das hipóteses e uma fonte de
carregamento duplo confuso na pior.

O Rails registra duas instâncias separadas de loader Zeitwerk, não uma:

- **`Rails.autoloaders.main`** gerencia `app/*` e qualquer caminho de
  autoload customizado; o código que é descarregado e recarregado entre
  requisições em desenvolvimento (`config.enable_reloading`), e
  eager-loaded antecipadamente em produção (`config.eager_load = true`,
  ligado por padrão em `production`, desligado por padrão em
  `development`, e habilitado em `test` quando `CI` está definido).
- **`Rails.autoloaders.once`** gerencia caminhos de autoload-once; código
  que deveria carregar uma única vez e nunca ser descarregado entre
  recargas, porque recarregá-lo deixaria referências obsoletas
  (decorações de framework, algumas extensões no momento do
  inicializador). `lib` é um exemplo comum quando adicionado aos caminhos
  de autoload.

Quando o contrato é violado (o arquivo não define a constante que o
Zeitwerk esperava), a falha é um `Zeitwerk::NameError`, uma subclasse de
`NameError`, com uma mensagem no formato:

```
Zeitwerk::NameError: expected file
/app/services/api/user_sync.rb to define constant Api::UserSync, but didn't
```

O detalhe operacional crítico: isso só dispara quando o arquivo é
*carregado*. Em desenvolvimento com autoloading preguiçoso, um arquivo
quebrado que nada referencia ainda vai ficar ali silenciosamente. A
primeira vez que ele morde costuma ser em CI ou produção, o que quer que
faça eager load primeiro; que é exatamente o motivo de `eager_load` em CI
e a task `zeitwerk:check` (abaixo) existirem: para forçar a falha cedo,
em uma máquina que não está atendendo tráfego real.

### Armadilhas comuns do Zeitwerk em escala

**Colisões de sigla e inflexão.** O inflector padrão do Zeitwerk usa
`String#camelize`, então `api_controller.rb` vira `ApiController`,
provavelmente tranquilo, mas um `api.rb` nu vira `Api`, não `API`. Se a
convenção real da base de código é `API`, essa incompatibilidade é um
`Zeitwerk::NameError` esperando pela primeira referência. A correção é um
override explícito de inflexão, convencionalmente reunido em um
inicializador:

```ruby
# config/initializers/inflections.rb
ActiveSupport::Inflector.inflections(:en) do |inflect|
  inflect.acronym "API"
  inflect.acronym "HTML"
  inflect.acronym "VAT"
end
```

Isso muda `camelize`/`underscore` do `ActiveSupport` globalmente, que
geralmente é o que você quer já que o inflector padrão do Zeitwerk
delega para ele. Para regras de inflexão escopadas a um único loader em
vez de todo o `ActiveSupport`, sobrescreva o loader diretamente:

```ruby
Rails.autoloaders.each do |autoloader|
  autoloader.inflector.inflect("html_parser" => "HTMLParser")
end
```

Os overrides são pareados contra nomes base exatos de arquivo/diretório
(sem extensão), não aplicados como uma regex geral; `api_client.rb`
precisa de sua própria entrada se `api.rb` não a cobrir.

**Colisões de nomenclatura entre subclasses STI e diretórios.** Uma
armadilha clássica: `Vehicle` usa single-table inheritance com `Car` e
`Truck` como subclasses vivendo diretamente em `app/models/`. Alguém
depois adiciona um *namespace* `Car` para um conceito não relacionado
(`app/models/car/rental_agreement.rb` definindo `Car::RentalAgreement`),
e agora `Car` é esperado ser tanto uma classe (a subclasse STI) quanto um
módulo (o diretório de namespace). O Zeitwerk levanta exceção sobre isso
no momento em que os dois são referenciados, porque uma única constante
não pode ser as duas coisas. A correção real é renomear um dos lados
(raro para um nome de classe STI pública) ou mover a classe STI para seu
próprio arquivo de namespace explícito para que a ambiguidade seja
resolvida antes de o Zeitwerk sequer ter que adivinhar.

**`zeitwerk:check` é a ferramenta que pega isso antes do deploy**, não a
revisão de código. Rode localmente ou, melhor, conecte ao CI:

```
$ bin/rails zeitwerk:check
Hold on, I am eager loading the application.
All is good!
```

Em caso de falha, aborta com a mensagem `Zeitwerk::NameError` subjacente.
Também pode reportar diretórios que existem sob um caminho de autoload
mas não serão eager-loaded a menos que adicionados a
`config.eager_load_paths`; vale a pena ler, já que esses diretórios são
exatamente os que conseguem esconder um arquivo quebrado até alguém
azarado o referenciar em produção.

### Rails Engines para fronteiras de módulo rígidas

Uma Engine é uma aplicação Rails aninhada dentro de uma aplicação Rails;
o mecanismo que o próprio Rails usa para ser uma aplicação Rails
(`Rails::Application < Rails::Engine`). Gere uma com `rails plugin new
blorgh --full` para uma engine básica, ou `--mountable` para uma isolada
por namespace. O arquivo que a define:

```ruby
# lib/blorgh/engine.rb
module Blorgh
  class Engine < ::Rails::Engine
    isolate_namespace Blorgh
  end
end
```

`isolate_namespace` é o que torna uma engine montável uma fronteira real
em vez de só "código que por acaso vive em uma gem": ela dá namespace aos
controllers, models, nomes de tabela (`blorgh_articles`), views, helpers
de rota, e chave de params da engine, para que a engine não consiga
acidentalmente colidir com as constantes da aplicação host mesmo que as
duas sejam autoloaded pelo mesmo processo Zeitwerk. Uma engine não
montável (`--full`) pula esse isolamento e compartilha o namespace da
aplicação host diretamente; mais parecida com uma gem simples que se
conecta na inicialização do Rails do que com um módulo delimitado.

O que uma extração completa de engine compra:

- **Suas próprias rotas**, desenhadas separadamente e montadas
  explicitamente:
  ```ruby
  # config/routes.rb (host app)
  Rails.application.routes.draw do
    mount Blorgh::Engine, at: "/blog"
  end
  ```
- **Suas próprias migrations**, copiadas para a aplicação host sob
  demanda em vez de rodadas automaticamente: `bin/rails
  blorgh:install:migrations`.
- **Seu próprio asset pipeline**, com namespace sob
  `app/assets/.../blorgh/`.
- Um namespace que **pode virar gem e ser versionado
  independentemente**: extraído completamente do repositório do
  monólito, ganhando seu próprio CHANGELOG e semver, e fixado por versão
  no `Gemfile` da aplicação host.

O que ela custa é real, não incidental: uma engine é uma segunda
aplicação com sua própria aplicação `test/dummy` para inicializar para
sua suíte de testes, seu próprio gemspec e grafo de dependências, e suas
próprias preocupações de inicialização em `lib/engine_name/engine.rb`
para acertar. Extrair uma engine de código que já vive em `app/` e
referencia livremente os models da aplicação host é cirurgia genuína;
toda referência entre fronteiras precisa se tornar uma dependência
explícita, exatamente o tipo de acoplamento que tornava a extração digna
de ser feita em primeiro lugar, e exatamente o tipo de trabalho para o
qual o Packwerk (a seguir) existe para fazer mais barato.

### Packwerk para fronteiras mais leves

O Packwerk, da Shopify, impõe fronteiras de módulo como um **lint
estático**, sem exigir extração estilo engine. Cada pacote é um diretório
com um `package.yml`:

```yaml
# components/orders/package.yml
enforce_dependencies: true
enforce_privacy: true
dependencies:
  - components/platform
  - components/shipping
```

`enforce_dependencies: true` significa que qualquer referência a uma
constante definida em um pacote não listado sob `dependencies` é uma
**violação de dependência**. `enforce_privacy: true` significa que
qualquer coisa que o pacote define fora de seu diretório `app/public/`
(configurável via `public_path`) é tratada como privada; uma referência a
ela de outro pacote é uma **violação de privacidade**, mesmo que seja uma
dependência declarada. Violações são encontradas por análise estática de
referências de constante, checadas com:

```
$ bin/packwerk check
```

O CI roda isso da mesma forma que roda o RuboCop. Violações existentes no
momento da adoção (o Packwerk é explicitamente construído para ser
colocado em um monólito que já quebra suas próprias regras propostas) são
registradas por pacote em `package_todo.yml` em vez de bloquear a build
imediatamente, para que a fronteira possa ser introduzida
incrementalmente e as violações pagas ao longo do tempo em vez de exigir
uma correção de uma vez só.

O trade-off contra engines é o ponto inteiro do Packwerk: adotá-lo em um
monólito existente custa um arquivo `package.yml` e um passo de CI, não
uma reestruturação de diretório ou o boot de uma segunda suíte de testes.
Mas a fronteira que ele desenha é exatamente tão forte quanto a aplicação
de CI e nada mais. Um pacote Packwerk não é um namespace Zeitwerk e não é
`isolate_namespace`; a própria busca de constante do Ruby não sabe que
pacotes existem, então nada impede código em tempo de execução de chamar
`Orders::LineItem` de dentro de `components/marketing` da forma que o
namespace de uma Engine impediria. Se `bin/packwerk check` não estiver
conectado ao CI, ou alguém fizer merge passando por uma checagem
vermelha, a "fronteira" é um comentário, não uma restrição.

### Quando de fato modularizar

Nada do acima vale a pena fazer preventivamente. Sinais concretos que
vale a pena citar em uma discussão de arquitetura, em vez de "a aplicação
parece grande":

- **Tempo de boot crescendo aproximadamente linearmente com o tamanho da
  aplicação.** Toda classe que o Zeitwerk faz eager load em produção é
  uma classe instanciada na memória antes de a primeira requisição ser
  atendida; uma aplicação que leva 45 segundos para inicializar porque
  faz eager load de 6.000 classes está pagando esse custo em todo deploy
  e todo início de instância autoescalada.
- **Risco de deploy vindo das mudanças de times não relacionados.** Se o
  PR de um time de pagamentos consegue quebrar o código do time de
  marketing porque os dois vivem no mesmo namespace `app/models` sem
  nenhuma fronteira declarada, esse é um problema no formato Packwerk
  antes de ser um problema no formato Engine.
- **O tempo de execução da suíte de testes do CI se tornando o gargalo em
  todo PR**, porque a suíte inteira carrega a aplicação inteira
  independente de quais 200 linhas mudaram; esse é o sinal mais forte
  para uma extração de Engine de fato, já que só uma fronteira real
  permite que um subconjunto da suíte de testes rode isoladamente.

Note a colisão de terminologia: o "eager loading" do Zeitwerk (carregar
toda classe no boot) e o "eager loading" do ActiveRecord
(`includes`/`preload` para evitar queries N+1) são mecanismos não
relacionados que por acaso compartilham um nome; tempo de boot crescendo
por causa de classes autoloaded demais não é corrigido por nada discutido
em estratégia de carregamento de query, e vice-versa.

## Trade-offs

- **O contrato do Zeitwerk não tem válvula de escape para "só esse
  arquivo".** Diferente do autoloader clássico, que tolerava
  contornos baseados em `require`, o Zeitwerk ou resolve uma constante
  para o caminho exato esperado ou levanta exceção. A única exceção
  legítima (um arquivo que genuinamente não deveria ser autoloaded) é
  `Rails.autoloaders.main.ignore(...)`, que é ela mesma mais uma coisa
  para rastrear e justificar em revisão.
- **`zeitwerk:check` só checa o que é eager-loaded.** Um diretório que
  existe mas não está em um caminho de eager-load pode esconder um
  arquivo quebrado indefinidamente; a task avisa sobre isso mas não falha
  por causa disso por padrão. Trate esse aviso como um checklist, não
  ruído.
  ```
  WARNING: The following directories will only be checked if you configure
  them to be eager loaded: app/uncommon_path
  ```
- **Overrides de inflexão são globais e fáceis de sub-escopar.**
  Adicionar `inflect.acronym "API"` a
  `ActiveSupport::Inflector.inflections` muda `"api".camelize` em todo
  lugar da aplicação, incluindo manipulação de string que não tem nada a
  ver com autoloading; um rótulo de exibição construído com `.camelize`
  a montante do Zeitwerk agora também lê `API`, que às vezes é desejado
  e às vezes é uma mudança silenciosa de comportamento que ninguém
  revisou como tal.
- **Uma Engine é infraestrutura real, não um `mkdir`.** Sua própria
  aplicação de teste dummy, sua própria sequência de boot, seu próprio
  gemspec; uma engine extraída prematuramente de um monólito com
  referências cruzadas emaranhadas custa semanas de desemaranhamento
  para uma fronteira que o Packwerk poderia ter imposto em uma tarde.
  Recorra a uma engine quando você de fato precisa de versionamento
  independente de processo ou isolamento genuíno em tempo de execução,
  não como o movimento padrão de modularização.
- **A fronteira do Packwerk é consultiva a menos que o CI de fato
  bloqueie por causa dela.** Esse é o trade que torna o Packwerk barato:
  também é o trade que o torna frágil. Um desenvolvedor sob pressão de
  prazo que atravessa uma fronteira de `package.yml` recebe uma checagem
  vermelha de CI, não um `NameError`; e uma checagem vermelha que passa
  por merge (ou uma linha de `package_todo.yml` silenciosamente estendida
  em vez de corrigida) é uma fronteira que existe só no papel.
  ```ruby
  # inside components/marketing, enforce_privacy: true is set,
  # this constant lives in components/orders/app/models (not app/public)
  Orders::LineItem.where(status: "pending") # violation, but boots and runs fine
  ```
- **Nenhuma das duas ferramentas te diz *qual* deveria ser a fronteira.**
  Packwerk e Engines ambos impõem uma fronteira depois de você tê-la
  desenhado; decidir onde a costura de fato pertence (quais models,
  services, e jobs formam um pacote coeso) é um julgamento de design que
  nenhuma das ferramentas faz por você, e desenhá-la no lugar errado só
  move o problema de acoplamento para os próprios pacotes.

## Documentation Links

- [Zeitwerk README, fxn/zeitwerk](https://github.com/fxn/zeitwerk) (doc)
- [Autoloading and Reloading Constants, Rails Guides](https://guides.rubyonrails.org/autoloading_and_reloading_constants.html) (doc)
- [Engines, Rails Guides](https://guides.rubyonrails.org/engines.html) (doc)
- [Packwerk README and USAGE, Shopify/packwerk](https://github.com/Shopify/packwerk) (doc)
