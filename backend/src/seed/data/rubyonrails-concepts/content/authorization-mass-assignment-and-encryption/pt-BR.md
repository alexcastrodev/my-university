---
version: 1.0
updatedAt: 2026-08-21
title: "Autorização, Mass Assignment e Criptografia do ActiveRecord"
summary: Pundit vs CanCanCan é uma escolha arquitetural, permit! é um buraco de mass assignment com um nome de um caractere, e cookies_serializer = :marshal transforma um secret_key_base vazado em execução remota de código em vez de só falsificação de sessão.
---
## Objective

Três decisões de segurança separadas são confundidas em "adicionar auth"
na maioria dos projetos Rails: *quem pode fazer isso* (autorização), *quais
campos eles podem definir* (mass assignment), e *o que de fato é legível se
o banco de dados vazar* (criptografia em repouso). Cada uma tem uma
resposta bem conhecida do Rails, e cada uma tem uma forma bem conhecida de
errar que vai para produção limpa, passa em revisão, e só aparece quando
alguém forja um parâmetro que você não esperava, faz dump de uma tabela
Postgres, ou lê um ticket de suporte que cola uma query SQL crua com um CPF
em texto plano nela. Este conceito é sobre as decisões concretas de API
(Pundit vs CanCanCan, `permit` vs `permit!`, criptografia determinística vs
não determinística), não "adicione autorização à sua aplicação", que toda
aplicação Rails já alega ter.

## Use Cases

- Escolher entre Pundit e CanCanCan para uma aplicação nova, ou decidir se
  uma classe `Ability` existente do CanCanCan cresceu além do seu formato e
  precisa virar objetos de política.
- Revisar um PR que adiciona `accepts_nested_attributes_for` a um model e
  pegar que a chamada de strong params correspondente reabre
  silenciosamente um buraco de mass assignment na associação.
- Decidir se uma coluna (CPF, número de conta bancária, email) precisa de
  `encrypts`, e se sim, se precisa continuar consultável, o que determina
  determinística vs não determinística e se você precisa de um índice cego.
- Auditar `config/initializers/session_store.rb` e `config/application.rb`
  em busca de `cookies_serializer` antes de uma revisão de segurança,
  porque `:marshal` em uma aplicação cujo `secret_key_base` já vazou
  alguma vez (um `.env` commitado, um dump de config do Heroku, uma
  breadcrumb do Sentry) é um caminho de desserialização diretamente
  explorável, não teórico.
- Explicar a um auditor de segurança exatamente o que `permit!` em uma
  action de controller significa em termos de raio de explosão, em vez de
  "está tudo bem, a gente valida no model".

## Deep Dive

### Pundit vs CanCanCan

Os dois resolvem "esse usuário pode fazer isso", mas colocam o boilerplate
em lugares diferentes. Mesmo model, os dois estilos:

**Pundit**: uma classe de política por model, chamada explicitamente em
toda action:

```ruby
# app/policies/post_policy.rb
class PostPolicy < ApplicationPolicy
  def update?
    user.admin? || (post.user == user && !post.published?)
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.admin? ? scope.all : scope.where(published: true)
    end
  end
end
```

```ruby
class PostsController < ApplicationController
  def index
    @posts = policy_scope(Post)
  end

  def update
    @post = Post.find(params[:id])
    authorize @post
    @post.update(post_params)
  end
end

class ApplicationController < ActionController::Base
  after_action :verify_authorized, except: :index
  after_action :verify_policy_scoped, only: :index
end
```

`authorize @post` infere a classe de política (`PostPolicy`) e a action
(`update?` a partir do nome da action do controller) e levanta
`Pundit::NotAuthorizedError` em caso de falha. `policy_scope(Post)` delega
para a classe `Scope` aninhada da política. `verify_authorized` /
`verify_policy_scoped` são guardas em tempo de desenvolvimento que falham
alto se você adicionar uma action e esquecer de chamar `authorize`; o
Pundit não te dá nenhuma aplicação implícita, então te dá uma forma de se
pegar esquecendo.

**CanCanCan**: uma classe `Ability` por usuário, checada implicitamente por
uma macro de controller:

```ruby
# app/models/ability.rb
class Ability
  include CanCan::Ability

  def initialize(user)
    can :read, Post, published: true
    return if user.nil?
    can :update, Post, user: user
    can :manage, Post if user.admin?
  end
end
```

```ruby
class PostsController < ApplicationController
  load_and_authorize_resource

  def update
    # @post already loaded via Post.find(params[:id]) AND authorized —
    # a CanCan::AccessDenied is raised before this line runs if it fails.
    @post.update(post_params)
  end

  def index
    # @posts is already scoped to Post.accessible_by(current_ability)
  end
end
```

`load_and_authorize_resource` infere o model a partir do nome do
controller, carrega o registro, e chama `authorize!` nele automaticamente;
não há nenhuma chamada explícita no corpo da action. `accessible_by
(current_ability)` faz para `index` o que `policy_scope` faz
explicitamente no Pundit, mas de novo implicitamente, conectado pela
macro.

**Onde cada um quebra.** A classe `Ability` única do CanCanCan é
genuinamente boa para regras simples e uniformes, mas todo papel ou
exceção adicional se torna mais uma linha de `can`/`cannot` com um hash de
condições, e esse arquivo se torna um ponto único de conflitos de merge e
um lugar onde a *interação* de regras (um `cannot` posterior sobrepõe um
`can` anterior? sim, mas você precisa saber disso) fica difícil de
auditar depois de algumas dezenas de regras. O uma-classe-por-model do
Pundit evita essa concentração, mas você paga boilerplate por model
(`initialize`, `attr_reader`, uma classe `Scope`) para todo model que
precisa de autorização, mesmo os triviais, e "essa action de controller
checa autorização" só é tão confiável quanto `verify_authorized`
capturando a omissão em todo ambiente que o roda (tipicamente não
produção). Nenhuma das duas bibliotecas autoriza nada por você se você não
a chamar; o hook implícito do CanCanCan só significa que o ponto de
chamada é uma macro de controller em vez de uma chamada de método no
corpo da action.

### Strong parameters: além do básico de `permit`/`require`

`permit!` e nested attributes são onde strong parameters de fato falham
na prática, além do exemplo introdutório `params.require(:post).permit
(:title)`.

**`permit!` desabilita a filtragem completamente.** Não concede permissões
adicionais com cuidado; marca o hash de params inteiro (e, recursivamente,
todo hash aninhado dentro dele) como permitido, sem nenhuma lista de
permissão:

```ruby
# Never do this with user-supplied params:
def update
  @post.update(params.require(:post).permit!)
end
```

Se `Post` algum dia ganhar um novo atributo (`admin_notes`, `featured`,
`user_id`), essa action deixa qualquer chamador defini-lo no momento em
que a migration rodar, com zero mudança de código e zero alerta de
revisão no controller. É o buraco de mass assignment que strong parameters
existe para fechar, reaberto com uma chamada de método. Usos legítimos são
estreitos: params confiáveis, não voltados ao usuário, que você mesmo
construiu (por exemplo, repermitir um hash que você construiu em um Rake
task), nunca params de requisição.

**`accepts_nested_attributes_for` é um vetor real de mass assignment.**
Esse é o padrão por trás de vários CVEs reais de mass assignment do Rails
de antes de strong parameters existir por padrão, e ainda é igualmente
explorável hoje se a lista de permissão aninhada for generosa demais:

```ruby
class Book < ApplicationRecord
  has_many :chapters
  accepts_nested_attributes_for :chapters
end
```

```ruby
# Looks reasonable, is not:
def book_params
  params.require(:book).permit(:title, chapters_attributes: [:title, :id, :book_id])
end
```

Permitir `:book_id` dentro de `chapters_attributes` deixa uma requisição
reparentar um capítulo *existente* (referenciado por `:id`) para um livro
diferente que o usuário atual não possui, só enviando o ID de capítulo de
outra pessoa com um `book_id` diferente. A correção é permitir só o que o
cliente deveria controlar (`:id`, `:title`, `:_destroy`) e nunca uma chave
estrangeira que estabelece propriedade; atribuição de propriedade pertence
ao controller (`current_user.books.find(...)`), não à lista de permissão
de params. Os guias atuais do Rails mostram a forma abreviada de array
aninhado como:

```ruby
params.expect(book: [:title, chapters_attributes: [[:title, :id]]])
```

**Obrigatório-faltando vs permitido-faltando são falhas diferentes.**
`params.require(:post)` levanta `ActionController::ParameterMissing` se a
chave estiver ausente, `nil`, em branco, ou um hash vazio; o tratamento de
exceção padrão do Rails transforma isso em um **400 Bad Request**, não um
500. É um erro de cliente por design, porque um param obrigatório de nível
superior faltando significa que a própria requisição está malformada. Uma
chave permitida mas ausente se comporta completamente diferente:
`permit(:title, :subtitle)` em um hash sem `:subtitle` simplesmente a
omite do resultado; nenhuma exceção, `post_params[:subtitle]` é `nil`, e
`update` só não toca aquela coluna. Confundir os dois (esperar um 500 para
um campo opcional faltando, ou não esperar um 400 para um obrigatório
faltando) é uma fonte comum de "por que essa requisição falhou no staging
mas não localmente" quando um cliente deixa de enviar um campo opcional.

### ActiveRecord::Encryption

O Rails 7 traz criptografia em repouso em nível de atributo sem uma gem
externa:

```ruby
class Author < ApplicationRecord
  encrypts :email, deterministic: true
  encrypts :notes  # non-deterministic (default)
end
```

**Determinística vs não determinística é uma troca de
consultabilidade-por-vazamento, não uma troca de força.** Criptografia não
determinística (o padrão) produz um texto cifrado diferente para o mesmo
texto plano toda vez; `Author.where(email: "x")` não consegue casar com
nada, porque não há texto cifrado estável para comparar. Criptografia
determinística (`deterministic: true`) sempre produz o mesmo texto cifrado
para o mesmo texto plano, o que faz `Author.find_by(email:
"tolkien@example.com")` voltar a funcionar, mas também significa que duas
linhas com o mesmo valor criptografado são visivelmente iguais para
qualquer um com acesso ao banco de dados, mesmo sem a chave: um atacante
(ou um DBA curioso) consegue saber quais linhas compartilham um email,
contar quantos usuários compartilham um valor, ou correlacioná-lo contra
texto cifrado visto em outro lugar, sem descriptografar nada. Esse é o
vazamento que o modo determinístico aceita em troca de `WHERE`.

**Índices cegos são como você consulta uma coluna determinística sem
expô-la diretamente à comparação de forma nenhuma**: na prática, isso é o
que `deterministic: true` combinado com o próprio suporte a igualdade de
atributo criptografado do Rails já te dá para buscas simples; para
esquemas de referência cruzada ou correspondência contra valores com hash
externo, o padrão é manter uma coluna indexada separada guardando um hash
com chave do texto plano e consultar aquela coluna em vez da
criptografada, para que a própria coluna criptografada nunca apareça em
uma cláusula `WHERE`.

**Gerenciamento de chaves** vem de três chaves, geradas com `bin/rails
db:encryption:init` e armazenadas sob `active_record_encryption` nas
credenciais do Rails:

```yaml
active_record_encryption:
  primary_key: <random>
  deterministic_key: <random>
  key_derivation_salt: <random>
```

`primary_key` deriva a chave usada para criptografia não determinística,
`deterministic_key` para criptografia determinística, e
`key_derivation_salt` é usado ao derivar as duas. Perder essas significa
perder todo valor criptografado no banco de dados, irrecuperavelmente;
elas pertencem à mesma categoria de segredo que `secret_key_base`, não em
um repositório, e idealmente rotacionadas através de
`config.active_record.encryption.primary_key` aceitando um array para que
chaves antigas e novas descriptografem durante a rotação.

**O que quebra em uma coluna já indexada ou única.** Um índice único em
nível de banco de dados ou `validates :email, uniqueness: true` em uma
coluna que você depois criptografa com `encrypts :email` (não
determinística) quebra imediatamente: o banco de dados agora está
comparando texto cifrado diferente a cada escrita, então um índice único
não aplica nada (todo valor parece único) e uma validação `uniqueness:
true` do Rails consulta `WHERE email = ?` com texto plano mas compara
contra colunas que nunca são iguais entre si. A coluna precisa ser
`deterministic: true` para que tanto o índice do banco de dados quanto a
validação do Rails voltem a significar algo; e trocar uma coluna existente
de não determinística para determinística (ou mudar `key_derivation_salt`)
exige recriptografar toda linha existente, já que o texto cifrado
armazenado para linhas antigas não vai casar com o novo texto cifrado
determinístico para o mesmo valor.

### Reforço de sessão e cookie

**O limite de 4 kB do cookie store criptografado é um teto rígido, não um
aviso brando.** `ActionDispatch::Session::CookieStore` é o padrão do
Rails e armazena a sessão inteira, criptografada, no próprio cookie; sem
tabela de sessão do lado do servidor. Cookies têm teto de 4 kB pela
especificação HTTP/navegadores, e o Rails não faz chunking nem compressão
em torno disso: empurre um array `session[:cart_items]` além do limite e
a escrita falha silenciosamente ou trunca dependendo de quem a escreveu, o
que aparece como dados de sessão intermitentemente faltando em produção,
sem exceção levantada no ponto da atribuição. A correção é ou manter a
sessão genuinamente pequena (IDs, não objetos) ou trocar
`config.session_store` para um armazenamento do lado do servidor
(`:cache_store`, um armazenamento de banco de dados) para aplicações que
precisam guardar mais estado por usuário.

**`SameSite` e `secure` são proteções separadas com padrões separados.**
Cookies do Rails têm padrão `same_site: :lax`: enviados em navegação de
nível superior mas retidos em subrequisições cross-site (uma tag `<img>`
cross-origin ou fetch), o que bloqueia uma classe de ataques adjacentes a
CSRF na camada de cookie. A flag `secure` (cookie só enviado via HTTPS)
tem padrão `false` no nível de `ActionDispatch::Cookies`, então depende de
`config.force_ssl`/configuração de ambiente de fato defini-la; uma
aplicação que serve tanto HTTP quanto HTTPS em algum ambiente (uma máquina
de staging sem terminação TLS configurada corretamente) pode enviar
silenciosamente cookies de sessão em texto plano se nada definir `secure:
true` explicitamente para aquele ambiente. (O lado do token de
falsificação de requisição da segurança de sessão, a meta tag CSRF e o
motivo de ela derrotar cache HTTP, é coberto em [Resource Hints, HTTP/2 e
o Problema de Cache do CSRF](resource-hints-http2-and-the-csrf-cache-problem).)

**`cookies_serializer` é onde um padrão de configuração se torna uma
classe real de vulnerabilidade.** `config.action_dispatch.cookies_serializer`
controla como valores de `ActionDispatch::Cookies`/sessão são
serializados; `:json` é o padrão para aplicações Rails novas (desde o
Rails 4.1, que trocou de `:marshal` especificamente por esse motivo).
`:marshal` desserializa com `Marshal.load`, que, diferente de JSON, pode
ser feito para instanciar objetos Ruby arbitrários a partir do payload
serializado. Se um atacante alguma vez obtiver `secret_key_base` (um
`.env` vazado, um arquivo de credenciais commitado, um dump de
configuração de uma plataforma de deploy mal configurada), ele consegue
forjar um cookie de sessão validamente assinado contendo um payload
Marshal malicioso; cadeias de gadget de desserialização Marshal
documentadas em Ruby/Rails já foram usadas no passado para transformar
isso em execução remota de código, que é o motivo real de `:json` ter se
tornado o padrão em vez de uma escolha arbitrária de reforço. Uma
aplicação que ainda define `cookies_serializer = :marshal` (herdado de uma
atualização pré-4.1, ou definido deliberadamente para um tipo que `:json`
não consegue serializar e desserializar de volta) deveria tratar
comprometimento de `secret_key_base` como um RCE, não só um risco de
falsificação de sessão, e priorizar a migração para fora de `:marshal`
de acordo.

## Trade-offs

- **Nem Pundit nem CanCanCan protege uma action que você esquece de
  autorizar.** O `verify_authorized` do Pundit só falha alto se estiver
  conectado ao `ApplicationController` e de fato rodar no ambiente que
  importa; o `load_and_authorize_resource` do CanCanCan protege só as
  actions nas quais foi declarado; uma action customizada feita à mão no
  mesmo controller não ganha nada disso de graça:
  ```ruby
  class PostsController < ApplicationController
    load_and_authorize_resource  # covers index/show/create/update/destroy

    def publish  # custom action — NOT covered, no authorization check at all
      @post.update!(published: true)
    end
  end
  ```
- **`permit!` e uma lista de nested attributes permissiva demais parecem
  idênticas em um diff**: as duas são uma linha, as duas passam testes que
  só exercitam o caminho feliz, e nenhuma das duas falha até alguém
  enviar um param que sua suíte de testes nunca tentou. Revise mudanças
  de strong params pelo que elas *não* filtram, não só pelo que filtram.
- **Criptografia determinística é um vazamento de informação real, não só
  "levemente mais fraca".** Qualquer um com acesso a nível de linha ao
  banco de dados (um engenheiro de suporte rodando uma query manual, uma
  credencial de réplica de leitura comprometida) consegue ver quais
  linhas criptografadas compartilham um valor, sem nunca ter a chave de
  criptografia. Isso frequentemente é uma troca aceitável por `WHERE
  email = ?`, mas deveria ser uma escolha deliberada por coluna, não o
  padrão usado porque a não determinística quebrou uma query.
- **Rotacionar chaves de `active_record_encryption` não é de graça**:
  toda linha existente continua criptografada sob a chave antiga até ser
  recriptografada, e o Rails só tenta várias chaves na *descriptografia*;
  novas escritas sempre usam a chave mais nova. Uma chave considerada
  comprometida ainda exige uma passagem explícita de recriptografia sobre
  dados históricos, não só uma mudança de configuração, antes de você
  poder considerar o valor antigo totalmente rotacionado para fora.
- **`cookies_serializer = :marshal` é uma linha de configuração, não uma
  feature flag**: lê como um detalhe de implementação até `secret_key_base`
  vazar, momento em que é a diferença entre um incidente de falsificação
  de sessão e um incidente de execução remota de código. Se está definido
  por motivos legados, confirme o que de fato está armazenado na sessão
  antes de assumir que uma troca direta para `:json` é segura; qualquer
  coisa que não seja representável em JSON (um objeto customizado, uma
  estrutura com chave Symbol usada em outro lugar) vai serializar e
  desserializar de volta de forma diferente ou falhar silenciosamente
  depois da troca.

## Documentation Links

- [Pundit, GitHub](https://github.com/varvet/pundit) (doc)
- [CanCanCan, GitHub](https://github.com/CanCanCommunity/cancancan) (doc)
- [Action Controller Overview, Strong Parameters, Session, Rails Guides](https://guides.rubyonrails.org/action_controller_overview.html) (doc)
- [Active Record Encryption, Rails Guides](https://guides.rubyonrails.org/active_record_encryption.html) (doc)
- [Security, Rails Guides](https://guides.rubyonrails.org/security.html) (doc)
- [ActionController::Parameters, Rails API](https://api.rubyonrails.org/classes/ActionController/Parameters.html) (doc)
- [ActionDispatch::Cookies, Rails API](https://api.rubyonrails.org/classes/ActionDispatch/Cookies.html) (doc)
