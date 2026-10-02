---
version: 1.0
updatedAt: 2026-07-30
title: "Configuração Inicial do PostgreSQL: Conexões, Memória, WAL e Custos do Planejador"
summary: Como definir um postgresql.conf inicial defensável para um servidor de alta disponibilidade (dimensionamento de conexões e memória, ajuste de WAL e checkpoints, preparo para replicação, estimativas de custo do planejador e logging) e quais configurações específicas do livro foram renomeadas, removidas ou viraram o padrão desde 2020 (o hot_standby do wal_level virou replica, wal_keep_segments virou wal_keep_size, o padrão de checkpoint_completion_target agora é 0.9).
---
## Objective

Um servidor PostgreSQL de alta disponibilidade deveria começar com um `postgresql.conf` estável, em vez de acumular configurações de forma reativa depois de quedas. A maioria dos valores que importam cai em poucas famílias (dimensionamento de conexões e memória, comportamento de WAL e checkpoints, preparo para replicação, estimativas de custo do planejador e logging), e cada família tem uma fórmula inicial defensável em vez de um chute arbitrário.

## Use Cases

- Provisionar um novo servidor PostgreSQL e querer uma configuração inicial defensável em vez dos padrões de fábrica, que são ajustados para uso mínimo de recursos, não para disponibilidade em produção.
- Decidir quanta memória dar a `work_mem` e `shared_buffers` com base na RAM total do sistema, sem deixar consultas famintas nem disparar tempestades de escrita de checkpoint grandes que ameaçam a disponibilidade.
- Preparar um primário para suportar futuras réplicas por streaming ou lógicas sem precisar reiniciar depois: várias dessas configurações só fazem efeito após um restart completo do PostgreSQL, então acertá-las logo no início evita uma segunda queda.

## Deep Dive

### Dimensionamento de conexões e memória

- `max_connections`: cerca de 3× o número de núcleos de CPU (incluindo núcleos virtuais/hyperthreading). Errar um pouco para cima evita rejeições de conexão visíveis, ao custo de um pouco de folga.
- `shared_buffers`: 25% da RAM para servidores de até 32GB; para servidores maiores, comece em 8GB e teste subindo em incrementos de 2GB em vez de continuar com a regra dos 25%, já que um checkpoint forçado pode despejar no disco, de uma só vez, uma quantidade de RAM igual a `shared_buffers`, uma tempestade de escrita capaz de derrubar até hardware robusto.
- `work_mem`: 8MB / 16MB / 32MB dependendo da faixa de RAM total, reduzido pela metade se `max_connections` passar de 400. Cada conexão pode usar várias instâncias disso ao mesmo tempo (ordenações, hashes), então o valor se multiplica rápido sob alta concorrência.
- `maintenance_work_mem`: 1GB, reservado para trabalho em segundo plano (vacuum, analyze, criação de índices). Deixá-lo faminto aumenta a E/S de disco de formas que prejudicam o desempenho das consultas de modo geral, não só os jobs de manutenção.

### WAL, checkpoints e agressividade do vacuum

- `wal_level`: precisa permitir pelo menos um standby por streaming, então não pode ficar no valor mínimo padrão.
- `min_wal_size` / `max_wal_size`: dimensionados para que o PostgreSQL não force checkpoints só porque ficou sem segmentos de WAL durante um pico de escrita. Cerca de 10% da RAM do sistema como ponto de partida.
- `vacuum_cost_limit`: elevado acima do padrão para que o autovacuum seja agressivo o suficiente em tabelas OLTP maiores e ativas. Um autovacuum passivo demais arrisca o cenário de wraparound de ID de transação, em que o PostgreSQL se desliga preventivamente para evitar perda de dados, o que é quase o pior que uma configuração pode fazer à disponibilidade.
- `checkpoint_completion_target`: distribui as escritas do checkpoint por uma parte maior da janela de `checkpoint_timeout` em vez de fazê-las em rajada, reduzindo a disputa pelo disco.

### Preparo para replicação

- `hot_standby`: ligado, para que réplicas criadas depois possam ser usadas para leitura imediatamente.
- `max_wal_senders`: slots suficientes para os métodos de sincronização e backup que o cluster vai de fato usar. 10 é um ponto de partida razoável.
- Reter WAL suficiente para uma réplica que fique temporariamente para trás, para que ela não perca de vez a capacidade de alcançar o primário e exija uma reconstrução completa.

### Estimativas de custo do planejador e logging

- `random_page_cost`: reduzido em relação ao padrão para refletir armazenamento rápido. Armazenamento SSD/PCIe tem muito menos diferença entre leituras aleatórias e sequenciais do que discos giratórios pressupõem.
- `effective_cache_size`: cerca de 75% da RAM, dizendo ao planejador quantos dados provavelmente já estão em cache pelo sistema operacional. Isso empurra o planejador para índices quando os dados subjacentes provavelmente estão em memória.
- `log_min_duration_statement`: registra apenas consultas mais lentas que um limite (em milissegundos), evitando tanto o silêncio sobre consultas lentas quanto um log inundado por registrar tudo.
- `log_checkpoints` e `log_statement = ddl`: visibilidade sobre o tempo e a frequência dos checkpoints, e uma trilha de auditoria das mudanças de schema.

### `pg_settings`: quais destas precisam de restart

Nem toda configuração aqui faz efeito do mesmo jeito: `pg_settings.context` diz quais exigem um restart completo (`postmaster`) e quais aceitam um reload ou um `SET` por sessão. Acertar no primeiro dia as configurações que exigem restart importa mais do que o resto, justamente porque corrigir um erro depois custa uma queda.

### Livro vs hoje: várias configurações foram renomeadas, removidas ou viraram o padrão

O checklist do livro se aplica ao PostgreSQL atual com um punhado de mudanças concretas desde 2020:

- **`wal_level = hot_standby` virou `replica`.** Renomeado no PostgreSQL 9.6 (os antigos valores `hot_standby`/`archive` foram fundidos em `replica`). O nome antigo ainda é aceito silenciosamente por compatibilidade, mas `replica` é o que configurações atuais deveriam usar.
- **`wal_keep_segments` virou `wal_keep_size`.** Removido no PostgreSQL 13 e substituído por `wal_keep_size`, especificado diretamente em MB em vez de uma contagem de segmentos. Não é mais preciso multiplicar uma contagem de segmentos por 16MB para raciocinar sobre uso de disco.
- **O padrão de `checkpoint_completion_target` mudou de 0.5 para 0.9 no PostgreSQL 14.** A recomendação manual do livro de definir 0.9 agora é simplesmente o que uma instalação nova já traz: não há mais nada para sobrescrever em uma versão atual.
- **`replication_slots` sempre foi uma abreviação para `max_replication_slots`.** A nomenclatura do livro é imprecisa, não desatualizada; o parâmetro real tem padrão 10 desde o PostgreSQL 10, igual ao valor inicial recomendado pelo livro.
- **O padrão de 10 para `max_wal_senders` não mudou** desde o PostgreSQL 10, e continua sendo um valor razoável para confiar em vez de sobrescrever.
- **"3× núcleos" para `max_connections` continua sendo uma heurística inicial razoável, mas a orientação atual pende mais para pooling do que o livro.** Cada conexão adicional carrega um custo real de memória compartilhada e de processo de backend; quando as conexões simultâneas chegam às centenas, a recomendação atual é um pooler de conexões externo (PgBouncer, PgCat) na frente do PostgreSQL, em vez de continuar aumentando `max_connections` diretamente. O PostgreSQL ainda não tem pooler embutido na versão estável atual: isso continua sendo um acréscimo operacional, não uma configuração do `postgresql.conf`.

## Trade-offs

- **Essas fórmulas são pontos de partida que uma carga real deveria sobrescrever, não alvos fixos.** O próprio livro aponta o `pgtune` para estimativa automatizada, com a ressalva de que ele tende a ser generoso com `work_mem` e `shared_buffers`. É útil como uma base melhor que os padrões do próprio PostgreSQL, não como substituto para medir uma carga real.
- **Aumentar `vacuum_cost_limit` troca E/S agora por evitar uma queda muito pior depois.** Um autovacuum mais agressivo disputa banda de E/S com o tráfego de consultas continuamente, em troca de evitar o desligamento por wraparound de ID de transação, uma troca que vale a pena para qualquer servidor que não tolere esse modo de falha.
- **Várias das configurações de maior impacto aqui (`wal_level`, `shared_buffers`, `max_connections`, `max_wal_senders`) exigem restart para mudar.** Acertá-las aproximadamente antes de o servidor receber tráfego de produção vale mais do que acertá-las com exatidão, já que o "exato" descoberto depois ainda custa uma queda para ser aplicado.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3ª edição (Packt, 2020): Capítulo 3, "Minimizing Downtime", receita "Configuration: getting it right the first time", p. 91-96: doc
- [PostgreSQL Documentation: Server Configuration](https://www.postgresql.org/docs/current/runtime-config.html): doc
- [PostgreSQL Documentation: Write Ahead Log Configuration](https://www.postgresql.org/docs/current/runtime-config-wal.html): doc
- [PostgreSQL Documentation: pg_settings](https://www.postgresql.org/docs/current/view-pg-settings.html): doc
- [PGTune: configuration estimator](https://pgtune.leopard.in.ua/): doc
- [PostgreSQL Documentation: Replication settings (wal_keep_size, max_replication_slots, max_wal_senders)](https://www.postgresql.org/docs/current/runtime-config-replication.html): doc
- [EnterpriseDB: Why you should use connection pooling with max_connections](https://www.enterprisedb.com/postgres-tutorials/why-you-should-use-connection-pooling-when-setting-maxconnections-postgres): doc
