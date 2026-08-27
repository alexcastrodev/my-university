---
title: "Projetando um Sistema de Reservas de Hotel"
description: Por que um sistema de reservas é um dos raros designs onde correção supera throughput — o modelo de inventário por tipo de quarto, a corrida de reserva dupla entre dois usuários comprando o último quarto, e os mecanismos pessimistas, otimistas e baseados em restrições que de fato a impedem.
difficulty: Intermediate
readingTime: 13
tags:
  - Consistência de Dados
  - Transações ACID
  - Controle de Concorrência
  - Escalabilidade
prerequisites:
  - "Transactions, ACID, and Isolation Levels"
related:
  - label: "Transactions, ACID, and Isolation Levels"
    slug: transactions-acid-and-isolation-levels
  - label: "The Transactional Outbox Pattern"
    slug: outbox-pattern
  - label: "Read/Write Splitting and CQRS-Lite"
    slug: read-write-splitting-and-cqrs-lite
---

## Visão Geral

A maioria dos prompts de design de sistemas recompensa o instinto de escalar primeiro e relaxar a consistência: um sistema de chat pode mostrar uma lista de mensagens desatualizada, um feed pode estar alguns segundos atrasado, uma busca de proximidade pode perder um restaurante que abriu esta manhã. Um sistema de reservas de hotel é um dos raros casos onde esse instinto está errado. Vender o mesmo quarto duas vezes para a mesma noite não é uma leitura desatualizada que se resolve sozinha — é um hóspede parado na recepção com um e-mail de confirmação e nenhum lugar para dormir, e nenhuma quantidade de throughput compensa isso. O problema de design é, portanto, invertido: o caminho de escrita é pequeno, lento, e sem desculpas transacional, e a engenharia interessante está em manter o *resto* do sistema rápido em torno de um núcleo deliberadamente serializado.

## Requisitos

**Escopo funcional** para uma versão de tamanho de entrevista: navegar páginas de detalhe de hotel e tipo de quarto com preços para um intervalo de datas, reservar um ou mais quartos de um tipo dado para um intervalo de datas, cancelar uma reserva, e um caminho de admin para a equipe adicionar/atualizar hotéis, quartos, e tarifas. Preços são por dia e mudam diariamente — a tarifa de um tipo de quarto é uma função da data, não um atributo fixo do quarto. Deliberadamente fora de escopo: busca completa com filtros arbitrários, programas de fidelidade, e itinerários com múltiplos trechos.

**Requisitos não funcionais**, e é aqui que o design se compromete:

- **Consistência forte para a transação de reserva, especificamente.** Não para o sistema inteiro — para a única operação que decrementa o inventário disponível. Essa operação deve ser linearizável em relação a toda outra reserva para o mesmo hotel, tipo de quarto, e data. Tudo mais pode ser mais frouxo.
- **Disponibilidade sobre consistência para busca e navegação.** Um usuário vendo um quarto que foi reservado 200ms atrás é um incômodo recuperável (ele recebe um erro no checkout); uma página de busca que retorna um 503 durante uma promoção relâmpago é receita perdida. Navegação tolera desatualização; reserva não.
- **Intensivo em leitura no geral, leve em escrita em termos absolutos.** Pegue uma rede com 5.000 hotéis e 1M de quartos, 70% de ocupação, estadias médias de 3 noites: aproximadamente 240.000 reservas/dia, o que é cerca de **3 reservas por segundo**. Trabalhe de trás para frente no funil com uma taxa de conversão de 10% por passo e a página de confirmação de reserva roda ~30 QPS e a página de detalhe ~300 QPS. Leituras superam escritas em 100:1, e a taxa de escrita é baixa o suficiente para que um caminho de escrita caro e fortemente bloqueado seja acessível.
- **Latência moderada no caminho de escrita.** Uma reserva levando um ou dois segundos é aceitável. Uma reserva estar errada não é. Essa é a troca sobre a qual todo o design é construído.

Esse último par de números é o ápice da estimativa: a 3 TPS você pode se dar ao luxo de isolamento serializável, locks de linha, e retentativas. Candidatos que pulam a estimativa frequentemente super-projetam o caminho de escrita em um pipeline de eventos eventualmente consistente que reintroduz exatamente o bug que foram pedidos para prevenir.

## Modelo de Dados

Um banco de dados relacional é a escolha padrão certa aqui — as entidades são estáveis e bem compreendidas, a carga de trabalho é intensiva em leitura com escritas pouco frequentes, e as garantias ACID são essenciais em vez de decorativas. O esquema ingênuo é `hotel → room → reservation(room_id, start_date, end_date)`, e está errado para hotéis de uma forma instrutiva.

Um hóspede não reserva o quarto 412. Um hóspede reserva *um quarto king com vista para a cidade*; o número específico do quarto é atribuído no check-in. O modelo do Airbnb (onde `listing_id` é a unidade de inventário) não se transfere. Então a unidade de inventário é `(hotel_id, room_type_id, date)`:

| Tabela | Colunas-chave | Notas |
|---|---|---|
| `hotel` | `hotel_id`, `name`, `address` | Estática; fortemente cacheada. |
| `room_type` | `room_type_id`, `hotel_id`, `name`, `max_occupancy` | Ex.: standard, king, duas queens. |
| `room` | `room_id`, `room_type_id`, `hotel_id`, `floor`, `status` | Quartos físicos; necessários para limpeza (housekeeping) e check-in, *não* para reserva. |
| `room_type_rate` | `(hotel_id, room_type_id, date)`, `rate` | O preço varia por dia. |
| `room_type_inventory` | `(hotel_id, room_type_id, date)` PK, `total_inventory`, `total_reserved` | A tabela contestada. Uma linha por tipo de quarto por **única data**. |
| `reservation` | `reservation_id` PK, `hotel_id`, `room_type_id`, `start_date`, `end_date`, `room_count`, `status` | `status ∈ {pending, paid, refunded, canceled, rejected}`. |

O design de `room_type_inventory` — uma linha por data de calendário em vez de um intervalo de datas armazenado — é o que torna consultas de intervalo triviais: verificar uma estadia de três noites é um `BETWEEN` sobre três linhas, e reservar é um `UPDATE` sobre essas mesmas três linhas. Linhas são pré-populadas dois anos à frente por um job diário. Com 5.000 hotéis × 20 tipos de quarto × 730 dias isso são ~73M linhas, o que é banal para uma instância única bem indexada; a razão para replicar é disponibilidade, não volume.

Disponibilidade para um intervalo de datas é então:

```sql
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1;
-- reservável se, para cada linha: total_reserved + :n <= total_inventory
```

Armazenar um par de contadores em vez de um booleano também torna o **overbooking** uma mudança de um caractere. Hotéis rotineiramente vendem ~110% da capacidade porque uma fração previsível de hóspedes cancela ou não comparece, então o predicado se torna `total_reserved + :n <= 1.1 * total_inventory`. O trabalho do sistema é impor o limite que o negócio define, exatamente — não decidir o limite.

## O Problema Central de Concorrência

Dois usuários clicam em "Reservar" no mesmo instante no último quarto king de 1º de junho. Ambas as requisições rodam a mesma lógica de dois passos: ler a linha de inventário, checar o predicado no código da aplicação, depois escrever o contador incrementado.

Sob qualquer nível de isolamento abaixo de serializável, ambas as leituras veem `total_reserved = 99, total_inventory = 100`. Ambos os predicados avaliam verdadeiro. Ambas as escritas definem `total_reserved = 100`. Ambas commitam. Dois e-mails de confirmação, um quarto. Este é um **lost update** de livro-texto: o ciclo de leitura-modificação-escrita de uma transação é atropelado pela outra, e nenhuma nunca observou o conflito. [Transactions, ACID, and Isolation Levels](transactions-acid-and-isolation-levels) cobre por que Read Committed e snapshot isolation ambos permitem isso, e por que `SERIALIZABLE` (via SSI no PostgreSQL) é o nível que não permite — a versão curta é que a checagem e a escrita não são atômicas uma em relação à outra, e níveis de isolamento abaixo de serializável não fazem promessa de que serão.

Há uma segunda fonte de reserva dupla, mais boba, que vale a pena nomear porque entrevistadores perguntam por ela: **o mesmo usuário clicando duas vezes em Enviar**. Deixar o botão cinza no lado do cliente ajuda e não é uma solução — uma retentativa, uma rede instável, ou um cliente com JS desabilitado contorna isso. A correção é uma **chave de idempotência**: gere um `reservation_id` no servidor quando o usuário chega na página de confirmação, envie-o como parte do corpo de `POST /v1/reservations`, e faça dele a chave primária da tabela `reservation`. A segunda submissão viola a restrição de chave primária e é rejeitada pelo banco de dados, não pela lógica esperançosa da aplicação. Idempotência resolve *requisições duplicadas*; não faz nada por *requisições distintas concorrentes*, que é do que trata o resto desta seção.

## Três Mecanismos Que Realmente Previnem Isso

### Bloqueio pessimista

Tome um lock exclusivo de linha no momento da leitura para que a segunda transação bloqueie até que a primeira commite:

```sql
BEGIN;
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1
FOR UPDATE;                    -- transação 2 espera aqui
-- a aplicação checa o predicado nas linhas recém-travadas
UPDATE room_type_inventory SET total_reserved = total_reserved + :n
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1;
COMMIT;                        -- lock liberado; transação 2 agora lê 100
```

Correto, fácil de raciocinar, e a decisão certa quando a contenção é genuinamente pesada e você prefere enfileirar a se debater em retentativas. Os custos são reais: locks mantidos através de uma viagem de ida e volta da aplicação serializam um tipo de quarto quente inteiramente, e travar múltiplas linhas de data em ordem inconsistente entre requisições concorrentes convida deadlocks (sempre adquira em uma ordem determinística — `date` ascendente — para evitar isso). Locks de longa duração são especialmente perigosos se qualquer chamada externa, como autorização de pagamento, estiver dentro da transação. Nunca deveria estar.

### Controle de concorrência otimista

Não trave. Leia uma coluna `version`, e faça a escrita condicional a que a versão não tenha se movido:

```sql
-- leitura: version = 42, total_reserved = 99
UPDATE room_type_inventory
SET total_reserved = total_reserved + :n, version = version + 1
WHERE hotel_id = :hotel AND room_type_id = :type AND date = :date
  AND version = 42
  AND total_reserved + :n <= total_inventory;
-- linhas afetadas = 0  ->  alguém mais ganhou; aborte e tente de novo a leitura-checagem-escrita inteira
```

A transação que commita segundo encontra zero linhas afetadas e tenta de novo a partir da leitura. A 3 TPS isso é quase sempre a escolha certa por padrão: sem locks, sem deadlocks, sem leitores bloqueados, e conflitos são raros o suficiente para que retentativas sejam invisíveis. Seu modo de falha tem a forma de contenção: durante uma promoção relâmpago em um hotel, todo cliente lê a mesma versão, um ganha, o resto tenta de novo, e a próxima rodada tem a mesma estrutura. Throughput colapsa em uma tempestade de retentativas exatamente quando a demanda está mais alta. Use uma contagem limitada de retentativas com backoff com jitter, e trate "otimista sob alta contenção" como um penhasco conhecido, não uma surpresa.

Note que um `UPDATE` condicional simples com o predicado embutido na cláusula `WHERE` (como acima) é atômico mesmo sem a coluna de versão — o banco de dados reavalia a linha sob seu próprio lock de escrita. A coluna de versão se paga quando a decisão depende de mais estado do que a única linha sendo escrita.

### Uma restrição de banco de dados

Empurre a invariante para o esquema para que ela não possa ser violada por nenhum caminho de código, presente ou futuro. Para o modelo de contador, isso é um `CHECK`:

```sql
ALTER TABLE room_type_inventory
  ADD CONSTRAINT inventory_not_oversold
  CHECK (total_reserved >= 0 AND total_reserved <= total_inventory);
```

Para um modelo onde reservas mapeiam para quartos *específicos* (Airbnb, salas de reunião, aluguel de equipamento), a versão bem mais forte é uma **restrição de exclusão** sobre um tipo de intervalo, que torna reservas sobrepostas para o mesmo quarto fisicamente irrepresentáveis:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservation
  ADD CONSTRAINT no_overlapping_stays
  EXCLUDE USING gist (
    room_id      WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  ) WHERE (status IN ('pending', 'paid'));
```

`&&` é o operador de sobreposição de intervalo; a restrição diz "nenhuma duas reservas vivas podem compartilhar um quarto e se sobrepor no tempo." O limite `[)` é deliberado — o dia do checkout não é uma noite ocupada, então uma estadia terminando em 3 de junho e uma começando em 3 de junho não conflitam. Esta é a mais forte das três opções porque é imposta pelo motor de armazenamento independentemente de qual serviço, script, ou sessão manual de `psql` emite o insert. Seus custos: não é versionada junto com a lógica de aplicação tão naturalmente, não é portável entre motores (isso é específico do PostgreSQL), e como o controle otimista, converte contenção em erros visíveis ao usuário em vez de enfileirar.

**Escolhendo.** Baixa contenção e baixo volume de escrita — que descreve quase todo sistema de reserva real — favorece controle otimista mais uma restrição como backup: rápido no caso comum, impossível de errar no caso incomum. Contenção pesada e sustentada em uma única linha quente favorece bloqueio pessimista, porque enfileirar vence uma tempestade de retentativas. Uma restrição deveria estar presente nos três casos; não é uma alternativa aos outros tanto quanto a última linha de defesa atrás deles.

```mermaid
sequenceDiagram
    participant U1 as Usuário A
    participant U2 as Usuário B
    participant DB as BD de Inventário<br/>(1 quarto restante, version=42)

    U1->>DB: BEGIN; lê linha (99/100, v42)
    U2->>DB: BEGIN; lê linha (99/100, v42)
    Note over U1,U2: ambos veem um quarto disponível

    U1->>DB: UPDATE ... SET total_reserved=100, version=43<br/>WHERE version=42
    DB-->>U1: 1 linha afetada
    U1->>DB: INSERT reservation (chave idempotência); COMMIT
    DB-->>U1: 201 Confirmado

    U2->>DB: UPDATE ... SET total_reserved=100, version=43<br/>WHERE version=42
    DB-->>U2: 0 linhas afetadas (versão mudou)
    Note over U2,DB: CHECK (total_reserved <= total_inventory)<br/>também teria rejeitado esta escrita
    U2->>DB: ROLLBACK; tenta ler de novo
    DB-->>U2: 0 disponível
    U2-->>U2: 409 Esgotado — mostre, não tente para sempre
```

## Leituras Rápidas, Escritas Lentas: Dividindo os Caminhos

A proporção leitura-escrita de 100:1 significa que o tráfego de navegação nunca deveria tocar o primário. Dados de hotel e tipo de quarto são essencialmente estáticos e pertencem atrás de um CDN e um cache de aplicação. Dados de disponibilidade são mais interessantes: eles mudam, mas um usuário navegando lendo disponibilidade que está um ou dois segundos desatualizada é inofensivo, porque *a leitura não é a decisão*. Sirva consultas de disponibilidade de uma réplica de leitura ou um cache de inventário Redis com chave `hotel_id:room_type_id:date`, e deixe o primário tratar apenas a escrita transacional. [Read/Write Splitting and CQRS-Lite](read-write-splitting-and-cqrs-lite) cobre quando essa divisão se paga e quando é só duas fontes de verdade discordando.

A regra que torna isso seguro vale a pena declarar explicitamente: **o cache filtra, o banco de dados decide.** Um cache que diz "esgotado" pode rejeitar uma requisição cedo com segurança (só é conservador demais se estiver atrasado em relação a um cancelamento, e uma atualização corrige isso). Um cache que diz "disponível" nunca deve ser confiado para commitar — a transação de reserva revalida contra o primário sob a restrição, e o usuário recebe um 409 se o cache foi otimista. Todo modo de falha de leitura desatualizada colapsa em "usuário vê um quarto, clica em reservar, é informado que alguém venceu primeiro", que é um resultado normal e explicável em vez de uma corrupção de dados.

Propagar mudanças de inventário para o cache é um problema clássico de escrita dupla — atualize o banco de dados e o cache e espere que ambos tenham sucesso. Acompanhar o log de mudanças do banco de dados (CDC/Debezium) ou emitir a atualização através de um [outbox transacional](outbox-pattern) mantém o cache convergindo para o banco de dados em vez de divergir dele.

## Holds: Reservando Inventário Durante o Checkout

Há uma lacuna entre "usuário decidiu" e "pagamento foi confirmado" que dura segundos a minutos — um desafio 3-D Secure, uma retentativa de cartão, um PSP lento. Deixar o inventário disponível durante essa janela significa que um usuário pode ser cobrado por um quarto que outra pessoa acabou de pegar; decrementá-lo permanentemente significa que um checkout abandonado remove um quarto da venda para sempre.

A resposta é um **hold de curta duração com TTL**. Quando o usuário entra no checkout, insira a reserva com `status = 'pending'` e um `expires_at` alguns minutos à frente, e conte linhas pendentes contra `total_reserved` — o quarto agora é invisível para outros compradores. Sucesso do pagamento vira o status para `paid` e limpa `expires_at`; falha ou abandono do pagamento deixa expirar. Um job de varredura (ou uma chave Redis com um TTL real espelhando a linha) libera holds expirados de volta ao inventário.

Dois detalhes tornam isso robusto. Primeiro, expiração deve ser **imposta na leitura**, não apenas pelo job de varredura: qualquer checagem de disponibilidade deveria ignorar linhas pendentes cujo `expires_at` já passou, para que um job de varredura atrasado adie a recuperação mas nunca cause um esgotamento fantasma. Segundo, a chamada de pagamento pertence **fora** da transação de banco de dados — manter um lock de linha através de uma chamada HTTP de terceiros é como um timeout de PSP de 30 segundos vira uma indisponibilidade do hotel inteiro. Tome o hold em uma transação curta, commite, chame o PSP, depois tome uma segunda transação curta para confirmar. O hold é precisamente o que torna seguro liberar o lock no meio disso.

## Escalando Além de Uma Rede de Hotel

Na escala de uma rede (3 TPS) um único primário com réplicas é suficiente e sharding é super-engenharia. Na escala Booking.com ou Expedia — 1.000× o tráfego — o caminho de escrita ainda é o gargalo, e a chave de shard sai do padrão de acesso: quase toda consulta filtra por `hotel_id`, então `hash(hotel_id)` distribui a carga enquanto mantém cada transação de reserva dentro de um único shard. Essa última propriedade é o ponto inteiro. Uma reserva toca as linhas de inventário e a linha de reserva de um hotel; mantê-las co-localizadas significa que a transação ACID permanece local e nenhum protocolo de commit distribuído é necessário.

A mesma lógica argumenta contra dividir inventário e reservas em microsserviços separados com bancos de dados separados. Uma decomposição "pura" de microsserviços transforma uma transação local em uma distribuída exigindo 2PC (bloqueante, lento) ou uma saga com transações compensatórias (eventualmente consistente, e agora você está escrevendo código para des-reservar um quarto). Manter inventário e reserva em um serviço apoiado por um banco de dados — um híbrido pragmático — recompra ACID para a única operação onde mais importa. Reserve coreografia estilo saga para coisas como liquidação de pagamento e fan-out de notificações, onde consistência eventual é genuinamente aceitável.

Histórico de reservas também cresce sem limite enquanto só dados atuais e futuros são quentes. Arquivar estadias passadas em armazenamento frio mantém as tabelas transacionais pequenas, o que mantém os índices no caminho contestado rasos.

## Trade-offs

- **Consistência forte na escrita de reserva é acessível precisamente porque a taxa de escrita é baixa** — 3 TPS justifica isolamento serializável, locks de linha, e retentativas de uma forma que uma ingestão de eventos de 100 mil TPS nunca justificaria. A estimativa não é cerimônia; é o que licencia a escolha cara, e pulá-la é como candidatos acabam defendendo um pipeline de reserva eventualmente consistente que reintroduz reserva dupla por construção.
- **Controle de concorrência otimista é a escolha padrão certa e tem um penhasco de contenção acentuado** — sem locks, sem deadlocks, e custo quase zero quando conflitos são raros, mas durante uma promoção relâmpago em um hotel todo cliente tenta de novo na mesma corrida perdedora, então o throughput degrada exatamente quando a demanda atinge o pico. Limite as retentativas, adicione jitter, e mostre "esgotado" em vez de repetir em loop.
- **Bloqueio pessimista enfileira em vez de se debater, ao custo de serializar o caminho quente** — melhor que OCC sob contenção pesada, mas locks mantidos através de uma viagem de ida e volta da aplicação (e, catastroficamente, através de uma chamada de pagamento) convertem uma dependência lenta em uma parada do hotel inteiro, e locks multi-linha de intervalo de datas causam deadlock a menos que adquiridos em ordem determinística.
- **Uma restrição de banco de dados é o único mecanismo que não pode ser contornado, e o único que não pode passar por code review como código** — uma restrição de exclusão em `(room_id, daterange)` torna reservas sobrepostas irrepresentáveis independentemente de qual serviço ou script ad-hoc escreve a linha, mas é específica do motor, desajeitada de versionar junto com lógica de aplicação, e como o controle otimista, reporta conflitos como erros em vez de enfileirar.
- **Cachear disponibilidade melhora a escalabilidade de leitura e garante que o cache vai às vezes mentir** — isso é tolerável só porque o cache filtra e o banco de dados decide; um design que deixa o cache autorizar uma reserva trocou uma leitura desatualizada rara por uma reserva dupla real.
- **Holds previnem roubo no meio do checkout e criam um novo modo de falha: inventário retido por carrinhos abandonados** — um TTL curto demais falha usuários em fluxos de pagamento lentos, um TTL longo demais suprime disponibilidade real, e expiração deve ser imposta na leitura assim como pelo job de varredura para que um job atrasado nunca fabrique um esgotamento fantasma.

## Perguntas de Entrevista

- Duas transações leem `total_reserved = 99` contra um `total_inventory` de 100 e ambas commitam um incremento. Nomeie a anomalia, explique quais níveis de isolamento a permitem, e dê dois mecanismos diferentes que a previnem.
- Uma chave de idempotência em `POST /v1/reservations` impede que um usuário clicando duas vezes reserve duas vezes. Explique por que ela não faz nada por dois usuários *diferentes* competindo pelo último quarto.
- Por que modelar inventário como uma linha por `(hotel_id, room_type_id, date)` torna tanto checagens de disponibilidade de intervalo de datas quanto uma política de overbooking de 10% mais fáceis do que armazenar um intervalo de datas por reserva?
- Seu time quer servir disponibilidade de um cache Redis. Qual é a regra exata que mantém isso seguro, e o que um usuário experimenta quando o cache está errado em cada direção?
- Um purista de microsserviços insiste que inventário e reservas devem ter bancos de dados separados. O que especificamente quebra, o que você teria que construir para compensar, e qual é seu argumento para o híbrido?

## Referências

- [Alex Xu e Sahn Lam, "System Design Interview – An Insider's Guide, Volume 2" (ByteByteGo, 2022) — Capítulo 7, "Hotel Reservation System"](https://bytebytego.com)
- [PostgreSQL Documentation — Constraints (Exclusion Constraints)](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL Documentation — Range Types: Constraints on Ranges](https://www.postgresql.org/docs/current/rangetypes.html)
- [H. T. Kung e John T. Robinson, "On Optimistic Methods for Concurrency Control" (ACM TODS, 1981)](https://dl.acm.org/doi/10.1145/319566.319567)
