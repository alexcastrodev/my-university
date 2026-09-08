---
version: 1.0
updatedAt: 2026-08-21
title: "Migrations de Schema Sem Downtime em Escala"
summary: Uma migration que roda em 40ms em dev pode segurar um lock ACCESS EXCLUSIVE em uma tabela de produção por minutos; este conceito cobre exatamente qual DDL trava o quê, como o strong_migrations pega isso antes de ir para produção, e o padrão de múltiplos deploys para mudanças que são inseguras não importa como você as escreva.
---
## Objective

Um `rails db:migrate` que roda em 40ms na sua sandbox de dev pode segurar
um lock `ACCESS EXCLUSIVE` em uma tabela `orders` de 200 milhões de linhas
em produção pelos vários minutos que o Postgres leva para reescrevê-la, e
toda outra query contra aquela tabela, leituras incluídas, faz fila atrás
desse lock durante todo esse tempo. O modo de falha não é a migration
falhar; é a aplicação cair enquanto a migration roda, seguido de uma
parede de requisições com timeout uma vez que ela finalmente commita. O
espaço entre "a mudança de schema está correta" e "a mudança de schema é
segura de rodar contra uma tabela ao vivo" é exatamente o que código
ingênuo de `ActiveRecord::Migration` não te protege: o Rails vai
tranquilamente gerar uma migration que trava uma tabela quente por uma
janela de manutenção que você não agendou. Este conceito é sobre a
mecânica específica de qual DDL trava o quê, como pegar isso antes de ir
para produção, e o padrão de múltiplos deploys para as mudanças que são
inseguras não importa como você as escreva.

## Use Cases

- Revisar um PR de migration que adiciona uma coluna `NOT NULL` ou muda o
  tipo de uma coluna em uma tabela que você sabe que recebe milhares de
  escritas por minuto, e precisar saber se é de fato segura ou só parece
  segura.
- Decidir se uma migration precisa de `algorithm: :concurrently` /
  `disable_ddl_transaction!` versus um rollout completo de múltiplos
  passos e múltiplos deploys (um compromisso muito maior); veja
  `postgres-indexing-for-rails` especificamente para o caso de índice
  concorrente.
- Renomear ou remover uma coluna que código de aplicação ainda lê, onde
  uma migration de deploy único quebraria ou o código antigo (no meio do
  deploy) ou apagaria silenciosamente dados ao vivo.
- Fazer backfill de uma nova coluna em uma tabela grande demais para
  atualizar em uma única transação sem inchá-la, bloquear replicação, ou
  disparar um `statement_timeout`.
- Configurar `strong_migrations` para um time para que uma migration
  perigosa falhe no CI/dev com uma explicação, em vez de falhar em
  produção com um incidente.
- Decidir se é seguro recorrer a `safety_assured { }` versus fazer a
  migration em múltiplos passos corretamente, quando um linter aponta
  algo que você acredita estar tranquilo.

## Deep Dive

### Por que migrations ingênuas travam tabelas de produção

Todo `ALTER TABLE` no Postgres pega algum lock; os perigosos pegam
`ACCESS EXCLUSIVE`, que bloqueia toda outra transação (leituras e
escritas) durante toda a duração da instrução.

**`ADD COLUMN` com um padrão: a fronteira de versão que de fato
importa.** Antes do Postgres 11, adicionar uma coluna com qualquer valor
padrão reescrevia a tabela inteira: o Postgres precisava voltar e carimbar
o valor padrão em toda linha existente, sob `ACCESS EXCLUSIVE`, durante
toda a operação. O Postgres 11 mudou isso para o caso comum: um padrão não
volátil (constante) agora é armazenado uma vez nos metadados de catálogo
da tabela e aplicado preguiçosamente quando cada linha é lida, então o
próprio `ALTER TABLE` é rápido independente do tamanho da tabela:

```ruby
class AddStatusToOrders < ActiveRecord::Migration[7.1]
  def change
    # Postgres 11+: metadata-only, near-instant even on a huge table.
    # Postgres < 11: rewrites every row under ACCESS EXCLUSIVE.
    add_column :orders, :status, :string, default: "pending"
  end
end
```

A exceção que ainda morde em qualquer versão do Postgres: um padrão
**volátil** (`clock_timestamp()`, `random()`, qualquer coisa que não
avalie para o mesmo valor em toda linha) força uma reescrita completa da
tabela não importa quão novo seja o seu Postgres, porque não há um valor
único para armazenar nos metadados. Se seu Postgres de produção é 11 ou
mais novo e seu padrão é uma constante, essa migration específica é
genuinamente barata; verifique as duas coisas antes de assumir isso.

**Mudando o tipo de uma coluna.** `change_column` geralmente reescreve a
tabela inteira e todo índice sobre ela, sob `ACCESS EXCLUSIVE`, durante
toda a duração; o Postgres precisa converter todo valor existente para a
nova representação em disco. Há uma exceção estreita quando o novo tipo é
binário-coercível com o antigo (por exemplo, alargar um `varchar` sem
mudança de limite de comprimento na representação), mas os casos comuns
que desenvolvedores Rails enfrentam (`integer` para `bigint`, `string`
para `text` com mudança de comprimento, qualquer coisa através de um cast
`USING`) são reescritas completas. Assuma que trava a tabela até você ter
confirmado o contrário na sua versão específica do Postgres e par de
tipos.

**Adicionando uma restrição `NOT NULL`.** `change_column_null :orders,
:customer_id, false` exige que o Postgres escaneie toda linha existente
para provar que nenhuma delas é `NULL`, e por padrão esse escaneamento
acontece sob `ACCESS EXCLUSIVE`, então uma adição de `NOT NULL` em uma
tabela enorme pode segurar o mesmo lock pelo mesmo tempo desconfortavelmente
longo de uma reescrita, mesmo que nenhum byte em disco de fato mude.

O Postgres tem sim uma forma de evitar o escaneamento bloqueante, mas não
é uma flag direta `NOT VALID` em `SET NOT NULL` no caso mais antigo e
comum; é uma rota indireta através de uma restrição `CHECK`: adicione
`CHECK (col IS NOT NULL) NOT VALID` (barato, não escaneia), valide-a
separadamente com `VALIDATE CONSTRAINT` (escaneia, mas só pega um lock
`SHARE UPDATE EXCLUSIVE` que não bloqueia leituras/escritas), e então o
Postgres 12+ reconhece que uma restrição validada já prova que a coluna
não tem nulos e deixa `SET NOT NULL` pular seu próprio escaneamento
completamente. A partir do Postgres 18 (lançado em setembro de 2025), o
Postgres também suporta `NOT VALID` diretamente em uma restrição not-null,
fechando a lacuna entre os dois mecanismos; mas a rota indireta de
restrição check acima é o que você vai precisar em qualquer coisa mais
antiga, e é o que `strong_migrations` gera por padrão (próxima seção).

### A gem strong_migrations

[`strong_migrations`](https://github.com/ankane/strong_migrations) se
conecta em `ActiveRecord::Migration` e levanta exceção com uma explicação
*antes* de rodar uma migration que considera perigosa, em vez de deixar o
Postgres te ensinar da forma difícil em produção. Segundo seu README,
suas checagens específicas de Postgres cobrem: adicionar um índice não
concorrentemente, adicionar um `belongs_to`/`reference` (que implica um
índice não concorrente a menos que instruído de outra forma), adicionar
uma restrição única ou de exclusão, adicionar uma coluna `json` (ele quer
`jsonb`), adicionar uma coluna com um padrão volátil, definir uma coluna
`NOT NULL`, renomear um valor enum, e renomear um schema; mais checagens
agnósticas de banco de dados para remover uma coluna, mudar o tipo de uma
coluna, renomear uma coluna ou tabela, e mais algumas. Quando pega o caso
`NOT NULL`, não diz só "não"; gera o padrão de três passos de restrição
check para você:

```ruby
# Migration 1: add the constraint unvalidated, fast, no full scan
class AddNotNullCheckToOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    add_check_constraint :orders, "customer_id IS NOT NULL",
      name: "orders_customer_id_null", validate: false
  end
end

# Migration 2: validate it, scans, but with a non-blocking lock
class ValidateNotNullCheckOnOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    validate_check_constraint :orders, name: "orders_customer_id_null"
  end
end

# Migration 3: the real constraint is now free (Postgres 12+ skips its scan),
# then drop the check constraint since NOT NULL now enforces it
class AddNotNullToOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    safety_assured do
      change_column_null :orders, :customer_id, false
      remove_check_constraint :orders, name: "orders_customer_id_null"
    end
  end
end
```

`safety_assured { }` é a válvula de escape: envolve um bloco e diz à gem
"eu verifiquei que isso está tranquilo, pare de checar." A configuração
mora em `config/initializers/strong_migrations.rb`:
`StrongMigrations.target_version = 16` diz à gem qual versão do Postgres
a produção de fato roda, para que suas checagens combinem com a realidade
em vez do caso mais conservador; `StrongMigrations.safe_by_default = true`
faz a gem reescrever automaticamente certas chamadas inseguras para seus
equivalentes seguros de múltiplos passos; `StrongMigrations.start_after =
20260101000000` isenta migrations mais antigas que um timestamp dado,
útil ao adotar a gem em uma aplicação existente;
`StrongMigrations.lock_timeout` / `statement_timeout` definem padrões que
a gem aplica à conexão de migration.

Usar `safety_assured` é legítimo quando você de fato raciocinou sobre a
tabela específica: ela é pequena, tem baixo tráfego, ou a migration está
rodando em uma janela de manutenção explícita. É uma armadilha quando usado
para silenciar um aviso em uma tabela quente porque o prazo é hoje; nesse
ponto você desabilitou a única coisa que teria parado o incidente, e a gem
não tem como te avisar que a tabela que ela está protegendo cresceu 100x
desde a última vez que alguém olhou.

### O padrão de múltiplos passos para uma mudança genuinamente insegura

Algumas mudanças não têm nenhuma forma segura de migration única, não
importa qual lock você pegue; renomear uma coluna é o exemplo canônico. O
problema não é o próprio `ALTER TABLE RENAME COLUMN` (essa na verdade é
uma operação rápida, só de metadados, no Postgres); é que no momento em
que ela commita, toda linha de código de aplicação rodando que referencia
o nome antigo da coluna quebra, e durante um deploy gradual você *vai* ter
código antigo e código novo rodando contra o mesmo banco de dados
simultaneamente. A correção é dividir a mudança entre múltiplos deploys:

```ruby
# Deploy 1, add the new column, don't touch the old one
class AddNewEmailToUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :users, :new_email, :string
  end
end
```

```ruby
# Deploy 1 (app code), dual-write: every write goes to both columns
class User < ApplicationRecord
  before_save :sync_new_email

  private

  def sync_new_email
    self.new_email = email if email_changed?
  end
end
```

```ruby
# Deploy 1 or 2, backfill existing rows (see next section for how, at scale)
User.where(new_email: nil).in_batches.update_all("new_email = email")
```

```ruby
# Deploy 2, reads move to the new column once backfill is confirmed complete
class User < ApplicationRecord
  before_save :sync_new_email

  def email
    new_email
  end

  private

  def sync_new_email
    self.new_email = email if email_changed?
  end
end
```

```ruby
# Deploy 3, separately, once nothing reads or writes the old column, # drop it, ideally still behind strong_migrations' remove_column check
class RemoveOldEmailFromUsers < ActiveRecord::Migration[7.1]
  def change
    safety_assured { remove_column :users, :email }
  end
end
```

Isso precisa ser múltiplos deploys, não uma migration com ordenação
esperta, porque uma migration roda uma vez, em um único ponto no tempo,
enquanto um deploy é um *rollout*; processos de servidor antigos e
processos de servidor novos coexistem por quanto tempo o reinício gradual
levar. Uma única migration não consegue fazer código antigo entender uma
coluna renomeada; só entregar código de aplicação que tolera os dois
nomes, por pelo menos um ciclo de deploy completo, faz isso. O mesmo
formato se aplica a dividir uma coluna em duas, mudar o significado
semântico de uma coluna, ou mover dados para uma tabela nova.

### Fazendo backfill de tabelas grandes com segurança

Nunca faça backfill de uma tabela grande dentro da própria transação de
migration; uma migration que atualiza 50 milhões de linhas em uma única
instrução `UPDATE` segura locks e gera WAL durante toda a duração, e se
estiver envolvida na transação padrão de migration do Rails, uma falha no
meio do caminho reverte tudo e você pagou o custo total por nada.
`in_batches` (a API `ActiveRecord::Batches` do Rails) pagina pela tabela
usando a chave primária em vez de carregá-la na memória ou atualizá-la em
uma única passagem:

```ruby
# lib/tasks/backfill.rake, run as a rake task or background job, not inside a migration
namespace :backfill do
  task orders_status: :environment do
    Order.where(status: nil).in_batches(of: 2_000) do |batch|
      batch.update_all(status: "pending")
      sleep 0.1 # throttle: give replicas and autovacuum room to keep up
    end
  end
end
```

Um tamanho de lote na casa dos milhares baixos (2.000 é um ponto de
partida razoável, não uma regra) mantém cada `UPDATE` curto o bastante
para não segurar seus locks de linha por muito tempo e não gerar uma
rajada disruptiva de WAL de uma vez. O `sleep` entre lotes é um throttle
deliberadamente rústico; seu trabalho é deixar espaços para duas coisas
que um loop de lotes consecutivos faria passar fome: aplicação de réplica
(uma réplica síncrona ou com defasagem pode ficar ainda mais para trás se
o primário nunca parar de escrever), e autovacuum (um backfill pesado em
`UPDATE` gera tuplas mortas tão rápido quanto o MVCC reescreve linhas, e o
autovacuum precisa de margem de CPU e I/O para acompanhar ou a tabela
incha). Em um sistema com monitoramento real de defasagem de replicação,
checar a defasagem real entre lotes e recuar quando ela sobe é um throttle
melhor do que um sleep fixo, mas o sleep fixo é a solução de 80% que a
maioria dos times entrega.

Rodar isso como uma rake task invocada por um passo de deploy, ou como um
job em segundo plano (`BackfillOrdersStatusJob.perform_later`, se
encadeando lote a lote via `perform_later` de novo), em vez de dentro da
própria migration, importa por um motivo concreto: migrations são
esperadas para rodar até a conclusão durante um deploy, geralmente sob
algum timeout que o ferramental de deploy impõe, e um backfill de milhões
de linhas pode levar muito mais tempo do que essa janela. Desacoplá-lo do
deploy significa que o deploy termina em segundos e o backfill roda (e
pode ser pausado, retomado, ou tentado de novo) no seu próprio cronograma.

### Timeouts de lock como uma rede de segurança

Toda mitigação acima reduz a *chance* de uma migration bloquear a tabela
por muito tempo; `lock_timeout` é a última linha de defesa para quando
algo ainda dá errado: uma query de longa duração que você não sabia que
existia segurando um lock conflitante, uma estimativa que estava errada. É
uma configuração de nível de sessão genuína do Postgres (não um mecanismo
específico do Rails), definida com `SET lock_timeout`, que aborta uma
instrução se ela não conseguir adquirir um lock dentro do tempo dado, em
vez de fazer fila indefinidamente atrás do que quer que o esteja
segurando:

```ruby
class AddPriorityToOrders < ActiveRecord::Migration[7.1]
  def change
    reversible do |dir|
      dir.up do
        execute "SET lock_timeout = '5s'"
        add_column :orders, :priority, :integer
      end
    end
  end
end
```

`strong_migrations` expõe a mesma ideia como configuração em vez de SQL
cru por migration: `StrongMigrations.lock_timeout = 10.seconds` a aplica
a toda migration que a gem roda, pareado com um `StrongMigrations.
statement_timeout` mais longo para que trabalho lento mas sem disputa não
seja morto. De qualquer forma, o efeito é o mesmo: se a migration não
conseguir seu lock dentro do timeout, ela falha alto e imediatamente, e
você consegue tentar de novo em um momento mais tranquilo, em vez de a
migration fazer fila silenciosamente atrás de uma query travada enquanto
toda outra requisição contra aquela tabela faz fila atrás *dela*, que é
como uma migration de rotina se transforma em uma indisponibilidade
completa. `lock_timeout` não torna uma migration insegura segura;
converte "a aplicação cai por dez minutos" em "o deploy falha e o Slack te
diz o motivo", que é um modo de falha estritamente melhor.

## Trade-offs

- **O padrão de renomeação em múltiplos passos é genuinamente mais
  trabalho, não só mais cauteloso.** São três ou mais migrations, um
  período de escrita dupla em código de aplicação que precisa ser
  lembrado e eventualmente limpo, e coordenação entre pelo menos dois
  deploys. Times sob pressão de prazo frequentemente pulam direto para
  `rename_column` em uma tabela "pequena o bastante para não importar",
  o que é um julgamento real, não automaticamente errado, mas é um
  julgamento que precisa ser feito deliberadamente, tabela por tabela, não
  por padrão.
- **`safety_assured` silencia a checagem permanentemente para aquele
  bloco, sem distinção entre "eu verifiquei isso" e "estou irritado com o
  aviso".**
  ```ruby
  # Compiles, ships, and looks identical whether the author checked the table
  # size or just wanted the red error message to go away.
  safety_assured { change_column_null :orders, :customer_id, false }
  ```
  Um revisor de código vê a mesma única linha de qualquer forma. Alguns
  times exigem um comentário ao lado de todo `safety_assured` explicando
  *por que* é seguro, precisamente porque o bloco em si não carrega
  nenhuma evidência.
- **Um throttle de `sleep` fixo em um backfill é um chute, não uma
  medição.** `sleep 0.1` entre lotes estava tranquilo na tabela e padrão
  de tráfego contra o qual foi ajustado; ainda pode sobrecarregar uma
  réplica durante um pico de tráfego, ou ser desnecessariamente lento
  durante um período tranquilo. Checar a defasagem real de replicação é
  mais correto e mais trabalho; a maioria dos times aceita a imprecisão
  de um sleep fixo porque é bom o bastante quase sempre.
- **`lock_timeout` troca uma migration travada por um deploy falho.** Uma
  migration que expira no timeout do seu lock não rodou; se seu pipeline
  de deploy não trata uma migration falha como uma parada dura (alguns não
  tratam, se o passo de migration é fire-and-forget), a aplicação pode
  acabar servindo requisições contra um schema que o código novo assume
  que já mudou.
- **Fazer backfill fora da migration significa que o schema e os dados
  podem ficar fora de sincronia por um período estendido e observável.**
  Entre "coluna adicionada" e "backfill terminado", `Order.where(status:
  nil)` é um estado real e válido que seu código de aplicação precisa
  tratar corretamente, não um detalhe de implementação transitório.
  Código que assume que o backfill é instantâneo (a maioria das
  suposições de `NOT NULL` assume) vai quebrar exatamente nessa janela.
- **O comportamento dependente de versão do Postgres significa que
  "seguro" não é uma propriedade só da migration.** O mesmo `add_column
  ... default: "pending"` é um no-op só de metadados no Postgres 11+ e
  uma reescrita completa de tabela no Postgres 10. Uma migration revisada
  como segura contra a versão do Postgres do staging não é
  automaticamente segura contra a de produção; isso é exatamente o que
  `StrongMigrations.target_version` existe para fixar, e pular essa
  configuração significa que a gem está checando contra uma versão que
  pode não ser a que importa.

## Documentation Links

- [strong_migrations, README](https://github.com/ankane/strong_migrations) (doc)
- [PostgreSQL Documentation, ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) (doc)
- [PostgreSQL Documentation, lock_timeout (Client Connection Defaults)](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT) (doc)
- [PostgreSQL 11 Release Notes](https://www.postgresql.org/docs/11/release-11.html) (doc)
- [Active Record Migrations, Rails Guides](https://guides.rubyonrails.org/active_record_migrations.html) (doc)
- [ActiveRecord::Batches, Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Batches.html) (doc)
