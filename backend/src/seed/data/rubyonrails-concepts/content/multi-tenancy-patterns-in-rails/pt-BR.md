---
version: 1.0
updatedAt: 2026-08-21
title: "Padrões de Multi-Tenancy no Rails"
summary: Tenancy baseada em linha, em schema, e em banco de dados compram garantias de isolamento muito diferentes a custos operacionais muito diferentes, e a mais barata (um schema compartilhado com uma coluna tenant_id) impõe isolamento inteiramente em código de aplicação, onde um único scope esquecido é um vazamento completo de dados entre tenants.
---
## Objective

Um SaaS B2B com algumas centenas de contas de tenant compartilhando uma
aplicação Rails tem três opções reais para manter seus dados separados:
uma coluna `tenant_id`, um schema Postgres, ou um banco de dados
fisicamente separado. Os três são vendidos como "multi-tenancy", mas
compram garantias de isolamento radicalmente diferentes a custos
operacionais radicalmente diferentes, e o mais barato impõe isolamento
inteiramente em código de aplicação. Isso significa que o dia em que
alguém lança um novo model, ou uma chamada `.unscoped`, ou uma query SQL
crua sem um `WHERE tenant_id = ?`, é o dia em que as linhas de um tenant
se tornam legíveis (ou graváveis) por outro. Isso não é um caso de borda
hipotético: isolamento quebrado em nível de tenant/objeto é uma das
classes de vulnerabilidade SaaS mais comuns do mundo real, e diferente de
uma injeção SQL não exige nenhum atacante: um scope esquecido em um
script de admin interno ou um job em segundo plano é o bastante para
vazar dados sem ninguém sondando por isso. Escolher um modelo de tenancy,
e impô-lo corretamente, é uma decisão de segurança vestida de decisão de
arquitetura.

## Use Cases

- Escolher um modelo de tenancy para um produto multi-tenant novo:
  baseado em linha (mais barato, garantia mais fraca em nível de banco de
  dados), baseado em schema (fronteira imposta pelo banco de dados, mais
  overhead operacional), ou banco de dados por tenant (isolamento mais
  forte, mais caro de rodar em escala).
- Auditar uma aplicação existente baseada em linha em busca do modo de
  falha real desse modelo: um model, uma query crua, ou um job em
  segundo plano que não é escopado por tenant.
- Decidir entre construir escopo de tenant à mão com `default_scope` e
  `ActiveSupport::CurrentAttributes`, ou adotar uma gem como
  `acts_as_tenant`, e o que você está confiando a essa gem se fizer isso.
- Depurar uma conexão Postgres que parece estar consultando os dados do
  tenant errado intermitentemente; um sinal forte de um bug de reset de
  `search_path` em uma configuração baseada em schema, ou uma interação
  de pool de conexões com o PgBouncer.
- Passar identidade de tenant corretamente por um job Sidekiq/Solid
  Queue, já que o job roda em um processo worker sem nenhuma requisição
  e sem `Current.tenant` já definido.
- Decidir quando graduar de baseado em linha para baseado em schema, ou
  de qualquer um dos dois para a topologia completa de sharding por
  banco de dados por tenant.

## Deep Dive

### Os três modelos de tenancy, e seus trade-offs reais

**Baseado em linha (schema compartilhado).** Toda tabela escopada por
tenant carrega uma coluna `tenant_id`; toda tabela vive no mesmo schema,
no mesmo banco de dados, atrás do mesmo pool de conexões. O isolamento é
imposto inteiramente por código de aplicação lembrando de filtrar por
`tenant_id` em toda query.

```ruby
create_table :invoices do |t|
  t.references :tenant, null: false, foreign_key: true
  t.integer :amount_cents, null: false
  t.timestamps
end
add_index :invoices, [:tenant_id, :created_at]
```

**Baseado em schema.** Um schema Postgres por tenant, dentro do mesmo
banco de dados. A estrutura de tabela (`invoices`, `users`, ...) é
duplicada uma vez por schema; o isolamento é imposto pelo próprio
Postgres; uma conexão cujo `search_path` é `tenant_42` simplesmente não
consegue ver `tenant_43.invoices` sem qualificar o nome. Coberto na
próxima seção.

**Baseado em banco de dados.** Um banco de dados Postgres físico
(potencialmente um servidor físico) por tenant. Esse é o isolamento mais
forte dos três e o mais caro de operar; veja [Múltiplos Bancos de Dados,
Réplicas de Leitura e Sharding Horizontal no Rails](/rubyonrails-concepts/multi-database-sharding-and-read-replicas)
para a mecânica real de `connects_to shards:` /
`ActiveRecord::Middleware::ShardSelector`; este conceito não vai
rederivá-las.

A matriz de trade-off, dita claramente:

| Modelo | Isolamento imposto por | Custo de rodar | Modo de falha real |
|---|---|---|---|
| Baseado em linha | Código de aplicação | Um conjunto de tabelas, um pool de conexões, o mais barato | Um scope de `tenant_id` faltando é um vazamento completo de dados entre tenants |
| Baseado em schema | Fronteira de schema do Postgres | Migrations rodam uma vez por schema de tenant; teto brando na contagem de schema/conexão | `search_path` vazando através de uma conexão pooled |
| Baseado em banco de dados | Fronteira de banco de dados física | O mais alto, N bancos de dados, N pools de conexão, N jobs de backup/restore | Joins entre bancos de dados não existem; o mais caro em escala |

Baseado em linha é a escolha padrão por um motivo: é o mais barato de
rodar e o mais fácil de escalar horizontalmente (sem proliferação de
schema ou banco de dados por tenant). Mas sua garantia de isolamento mora
inteiramente em código Ruby que roda em toda única query, para sempre,
incluindo código que ninguém escreveu ainda; que é o motivo de a próxima
seção ser sobre tornar essa garantia difícil de esquecer em vez de
confiar em todo mundo lembrar dela.

### Impondo isolamento baseado em linha: `CurrentAttributes` + escopo

`ActiveSupport::CurrentAttributes` é o mecanismo suportado do Rails para
um singleton isolado por thread (e fiber), por requisição; exatamente o
formato que "tenant atual" precisa, para que não tenha que ser passado
por toda assinatura de método como um parâmetro. Segundo a documentação
da API do Rails, ele "reseta automaticamente antes e depois de cada
requisição", e o mesmo reset acontece em torno de cada execução de Active
Job:

```ruby
# app/models/current.rb
class Current < ActiveSupport::CurrentAttributes
  attribute :tenant
end
```

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  before_action :set_current_tenant

  private

  def set_current_tenant
    Current.tenant = Tenant.find_by!(subdomain: request.subdomain)
  end
end
```

O escopo em si pertence a uma classe base abstrata, não repetido por
model, para que haja exatamente um lugar para auditar:

```ruby
# app/models/tenant_scoped.rb
class TenantScoped < ApplicationRecord
  self.abstract_class = true

  default_scope { where(tenant_id: Current.tenant.id) }
end

class Invoice < TenantScoped
end
```

As duas formas concretas de isso falhar na prática:

1. **Um model novo que pula a classe base.** `class Report <
   ApplicationRecord` em vez de `class Report < TenantScoped` compila,
   inicializa, e roda tranquilamente; com zero escopo de tenant. Não há
   erro, só os relatórios de todo tenant retornados para todo tenant,
   silenciosamente, para sempre, até alguém perceber em um ticket de
   suporte.
2. **`Model.unscoped`.** `default_scope` é explicitamente desenhado para
   ser removível, e `unscoped` remove *todos* os scopes, não só o de
   tenant:

   ```ruby
   Invoice.unscoped.find(params[:id]) # bypasses tenant_id entirely
   ```

   Isso é frequentemente usado legitimamente (um painel de admin, um
   relatório entre tenants) e depois copiado e colado em um contexto onde
   não deveria estar. Prefira uma válvula de escape explícita e nomeada:
   `Invoice.unscoped.where(tenant_id: allowed_tenant_ids)` no mínimo, ou a
   API dedicada `without_tenant` de uma gem (próxima seção) que ao menos
   torna o bypass pesquisável na base de código.

### `acts_as_tenant`: uma gem real para tenancy baseada em linha

[`acts_as_tenant`](https://github.com/ErwinM/acts_as_tenant) é uma gem
consolidada exatamente para o padrão acima. Sua manutenção vale a pena
declarar precisamente em vez de assumir: a última versão lançada da gem
(1.0.1) saiu em dezembro de 2023, e o commit mais recente no repositório
no momento desta escrita é de abril de 2025 (uma correção de
documentação). Essa é uma cadência baixa mas não zero; trate-a como
mantida-mas-de-movimento-lento, e verifique o próprio rastreador de
issues antes de apostar uma fronteira de segurança nela, em vez de
confiar em "é popular" ou "não foi tocada há um tempo" como a resposta
completa.

Declará-la em um model embrulha um `belongs_to` e um `default_scope`
para você:

```ruby
class Invoice < ApplicationRecord
  acts_as_tenant :account
end
```

Definindo o tenant atual por requisição:

```ruby
class ApplicationController < ActionController::Base
  set_current_tenant_through_filter
  before_action :set_tenant

  private

  def set_tenant
    set_current_tenant(Account.find_by!(subdomain: request.subdomain))
  end
end
```

Internamente, `acts_as_tenant` é construído diretamente sobre
`ActiveSupport::CurrentAttributes`; o mesmo mecanismo da seção anterior,
não um esquema `Thread.current` separado:

```ruby
# lib/acts_as_tenant.rb (gem internals)
class Current < ActiveSupport::CurrentAttributes
  attribute :current_tenant, :acts_as_tenant_unscoped
end

def self.current_tenant=(tenant)
  Current.current_tenant = tenant
end
```

Sua API escopada por bloco é a resposta da gem para o problema de "tenant
atual fora de uma requisição"; o mesmo formato que você precisa para jobs
em segundo plano, coberto abaixo:

```ruby
ActsAsTenant.with_tenant(account) do
  Invoice.create!(amount_cents: 5_000) # tenant_id set automatically
end
```

E sua própria válvula de escape nomeada, deliberadamente mais visível/
pesquisável do que um `unscoped` nu:

```ruby
ActsAsTenant.without_tenant do
  Invoice.all # every tenant's invoices — for an admin report, say
end
```

`ActsAsTenant.configure { |c| c.require_tenant = true }` faz um tenant
atual faltando levantar exceção em vez de silenciosamente retornar um
resultado sem escopo (ou vazio); vale a pena ligar, já que o modo de
falha alternativo de "nenhum tenant definido" é ou um vazamento ou um
resultado vazio confuso, não um erro apontando para o bug.

### Tenancy baseada em schema: `search_path` na prática

Schemas Postgres são namespaces dentro de um banco de dados;
`search_path` é a configuração por conexão que decide para qual schema um
nome de tabela não qualificado resolve. O adaptador Postgres do Rails
expõe isso como um método real e atual na conexão, `schema_search_path=`,
que executa `SET search_path TO ...` por baixo dos panos:

```ruby
ActiveRecord::Base.connection.schema_search_path = "tenant_42"
Invoice.all # resolves against tenant_42.invoices, no code change in the model
```

O próprio comentário de código-fonte do Rails naquele método vale a pena
citar exatamente, porque código de tenancy baseado em schema rotineiramente
faz o oposto do que ele diz: *"Isso não deveria ser chamado manualmente
mas definido em database.yml."* Essa orientação se encaixa em um único
schema fixo conhecido no momento do boot; não se encaixa em "o schema é
qualquer tenant que estiver fazendo essa requisição", que é desconhecível
até uma requisição chegar; então código de tenancy baseado em schema o
chama manualmente por necessidade, e herda a responsabilidade contra a
qual a própria documentação do Rails está avisando.

Essa responsabilidade tem um modo de falha específico e bem conhecido:
**`SET search_path` é uma configuração de nível de sessão, e o pool de
conexões do Rails reutiliza conexões entre requisições.** Uma conexão
cujo `search_path` foi trocado para `tenant_42` e depois é devolvida ao
pool sem ser resetada carrega essa configuração para qualquer requisição
que a pegue em seguida:

```ruby
# The footgun — no reset on the way out
class ApplicationController < ActionController::Base
  before_action { ActiveRecord::Base.connection.schema_search_path = current_tenant.schema_name }
  # request finishes, connection returns to the pool still set to this tenant's schema
end
```

```ruby
# The fix — always reset, including on the exception path
class ApplicationController < ActionController::Base
  around_action :switch_tenant_schema

  private

  def switch_tenant_schema
    ActiveRecord::Base.connection.schema_search_path = current_tenant.schema_name
    yield
  ensure
    ActiveRecord::Base.connection.schema_search_path = "public"
  end
end
```

Esse exato risco é o motivo de a gem baseada em schema ativamente mantida,
[`ros-apartment`](https://github.com/rails-on-services/apartment) (um
fork mantido da gem `apartment` original), ter se afastado da troca de
`search_path` local à thread em conexões compartilhadas em sua
arquitetura v4 em direção a um design de pool por tenant; contexto de
tenant rastreado via `CurrentAttributes` e pools de conexão dedicados por
tenant, especificamente para que um `search_path` obsoleto não consiga
vazar da requisição de um tenant para a conexão de outro. Se você está
avaliando tenancy baseada em schema hoje, essa mudança arquitetural em si
é evidência de quão real essa armadilha é em produção, não uma
preocupação teórica. Também documenta uma segunda versão, mais afiada, da
mesma classe de bug: o PgBouncer em **modo de pooling de transação** pode
devolver uma conexão ao pool *entre* definir `search_path` e rodar sua
query, silenciosamente servindo a um tenant os dados de outro sem
nenhum erro levantado; um risco que é anterior a, e sobrevive a, qualquer
correção em nível de Rails.

### Jobs em segundo plano: contexto de tenant não sobrevive a uma fronteira de job

`ActiveSupport::CurrentAttributes` reseta em torno do `perform` de cada
job, o mesmo que faz em torno de cada requisição; o que significa que
`Current.tenant` é garantidamente **não definido** quando um job começa a
rodar, em qualquer processo worker que o pegue. Enfileirar um job de
dentro de uma requisição escopada por tenant não carrega `Current.tenant`
(ou o `search_path` de um schema) junto; o argumento do job precisa ser o
id do tenant, explícito e serializável, e o job precisa restabelecer o
contexto ele mesmo no topo do `perform`:

```ruby
# Row-based
class GenerateInvoicePdfJob < ApplicationJob
  def perform(tenant_id, invoice_id)
    tenant = Account.find(tenant_id)
    ActsAsTenant.with_tenant(tenant) do
      Invoice.find(invoice_id).generate_pdf!
    end
  end
end
```

```ruby
# Schema-based
class ExportTenantReportJob < ApplicationJob
  def perform(tenant_schema, report_id)
    ActiveRecord::Base.connection.schema_search_path = tenant_schema
    Report.find(report_id).export!
  ensure
    ActiveRecord::Base.connection.schema_search_path = "public"
  end
end
```

`GenerateInvoicePdfJob.perform_later(Current.tenant.id, invoice.id)`,
nunca `perform_later(Current.tenant, invoice.id)` confiando na
serialização para carregar "atualidade" junto; não há tenant atual do
outro lado da fila, só o id que você explicitamente passou. Para a
mecânica de idempotência, retentativa, e fan-out do próprio job (o que
acontece quando esse job roda duas vezes, ou precisa distribuir trabalho
por item), veja [Jobs em Segundo Plano: Idempotência, Fan-out/Fan-in e
Escolha de Fila](/rubyonrails-concepts/background-jobs-idempotency-and-fan-out);
esta seção é só sobre a passagem de contexto de tenant através da
fronteira do job, que aquele conceito assume já resolvida.

## Trade-offs

- **Isolamento baseado em linha é uma garantia de código Ruby, não de
  banco de dados.** Todo model novo, toda query SQL crua
  (`ActiveRecord::Base.connection.execute` contorna `default_scope`
  completamente), e toda chamada `.unscoped` é um vazamento potencial que
  o próprio Postgres não tem como pegar, porque no que diz respeito ao
  Postgres é uma query contra uma tabela sem nenhuma fronteira de tenant
  de forma nenhuma:
  ```ruby
  ActiveRecord::Base.connection.execute(
    "SELECT * FROM invoices WHERE id = #{params[:id]}"
  ) # no tenant_id anywhere — default_scope never runs on raw SQL
  ```
- **Tenancy baseada em schema multiplica toda migration pela contagem de
  tenants.** `bin/rails db:migrate` contra um schema não toca nos outros
  N-1 schemas; um executor de migration ingênuo precisa percorrer todo
  schema de tenant, e uma migration que falha no tenant 400 de 600 deixa
  a frota em versões de schema inconsistentes até ser reconciliada; o
  mesmo formato operacional das migrations com shard, só que no nível de
  schema em vez do nível de banco de dados. Também existe um teto brando:
  nada no Postgres limita rigidamente o número de schemas por banco de
  dados, mas inchaço de catálogo de sistema e operações mais lentas de
  varredura de catálogo (migrations, `\dt`, autovacuum em `pg_catalog`)
  se tornam um custo real e mensurável conforme a contagem de schema
  cresce para os milhares; degrada gradualmente, não com um erro rígido,
  o que torna fácil não perceber até já estar caro de desfazer.
- **`CurrentAttributes` reseta em torno de requisições e jobs, não em
  torno de exemplos de teste que não passam por nenhum dos dois.** Um
  spec de model ou service que chama `Current.tenant = tenant_a`
  diretamente, sem passar por uma requisição ou job, deixa aquele valor
  definido para o *próximo* exemplo, porque nada dispara o reset fora dos
  callbacks de executor que o Rails conecta para requisições e jobs:
  ```ruby
  # spec/support/current_attributes.rb — without this, tenant state leaks between examples
  RSpec.configure do |config|
    config.after { Current.reset }
  end
  ```
  Estado de tenant vazado entre testes é pior que uma falha instável; é
  um teste que passa pelo motivo errado, silenciosamente validando contra
  o tenant do exemplo anterior.
- **Banco de dados por tenant tem o isolamento mais forte e a conta mais
  alta.** N bancos de dados significa N pools de conexão, N conjuntos de
  backups, N execuções de migration, e (segundo o conceito de sharding)
  joins entre tenants que param de ser joins SQL completamente. É a
  escolha certa para requisitos regulatórios ou de residência de dados
  rígidos; é um seguro caro contra um vazamento que isolamento baseado em
  linha, feito com cuidado, também previne a uma fração do custo
  operacional; os dois modelos não são igualmente validados por
  "precisávamos de isolamento forte", só um deles precisava de *tanto*
  disso.
- **Confiar a fronteira de isolamento a uma gem significa confiar em sua
  cadência de manutenção, não só em sua API.** O último release do
  `acts_as_tenant` é anterior a este documento por mais de dois anos;
  isso não é desqualificante, mas significa que CVEs, problemas de
  compatibilidade de versão do Rails, e relatos de bug de casos de borda
  se movem no ritmo que o mantenedor tiver tempo; confira o rastreador de
  issues para sua versão específica do Rails antes de adotá-la, em vez
  de inferir saúde só pela contagem de estrelas.

## Documentation Links

- [ActiveSupport::CurrentAttributes, Rails API](https://api.rubyonrails.org/classes/ActiveSupport/CurrentAttributes.html) (doc)
- [acts_as_tenant, GitHub](https://github.com/ErwinM/acts_as_tenant) (doc)
- [PostgreSQL Schemas, postgresql.org](https://www.postgresql.org/docs/current/ddl-schemas.html) (doc)
- [ros-apartment (fork mantido do Apartment), GitHub](https://github.com/rails-on-services/apartment) (doc)
- [Active Record Multiple Databases, Rails Guides](https://guides.rubyonrails.org/active_record_multiple_databases.html) (doc)
