---
version: 1.0
updatedAt: 2026-08-05
title: "Automação de HA com Patroni"
summary: A arquitetura do Patroni baseada em DCS (etcd/ZooKeeper/Consul para consenso, HAProxy para roteamento, cada nó rodando o mesmo loop de reconciliação) para failover totalmente automatizado do PostgreSQL, patronictl switchover para manutenção sem downtime, e por que operadores Kubernetes (CloudNativePG, Zalando postgres-operator) se tornaram um caminho de deployment comum hoje.
---
## Objective

O Patroni resolve o mesmo problema que o repmgr resolve (failover automatizado do PostgreSQL) com uma arquitetura fundamentalmente diferente: em vez de implementar sua própria lógica de consenso/quorum, ele delega isso a um Distributed Configuration Store externo (DCS: etcd, ZooKeeper ou Consul), e em vez de um IP virtual flutuante que precisa ser reatribuído, ele se pareia com o HAProxy para que todo nó fique acessível no mesmo endereço e o proxy sempre roteie para quem quer que o DCS diga ser o primário atual. Toda instância do Patroni roda o mesmo loop de forma independente (verificar no DCS se há um primário, reivindicar o papel se nenhum existir, ou se tornar réplica se já existir um), o que significa que não há um único processo Patroni que seja um ponto de falha; o cluster se autocura porque todo nó está rodando a mesma lógica de decisão contra uma fonte de verdade compartilhada e consistente.

## Use Cases

- Construir failover totalmente automatizado do PostgreSQL sem implementar lógica de consenso na mão: o DCS (etcd/ZooKeeper/Consul) já resolve o problema de "como nós distribuídos concordam sobre um fato".
- Realizar upgrades contínuos sem downtime: tirar o papel de primário de um nó, atualizá-lo enquanto é réplica, trazer o papel de volta, repetir para o resto do cluster.
- Evitar completamente disputas de reatribuição de IP virtual: o HAProxy roteia para o nó que o DCS atualmente nomeia como primário, então não existe uma janela em que dois nós poderiam acreditar cada um que possui o mesmo IP flutuante.
- Rodar HA de PostgreSQL dentro do Kubernetes, onde o suporte nativo do Patroni ao Kubernetes como DCS e o ecossistema mais amplo de operadores baseados em Patroni (CloudNativePG, o postgres-operator da Zalando) hoje são um caminho de deployment comum.

## Deep Dive

### Por que três camadas em vez de uma

```
                 ┌─────────┐
   clients ────▶ │ HAProxy │  (roteia para quem quer que o DCS diga ser o primário)
                 └────┬────┘
              ┌────────┼────────┐
              ▼        ▼        ▼
          [pgha1]   [pgha2]   [pgha3]   ← cada um rodando Patroni + PostgreSQL
              │        │        │
              └────────┼────────┘
                        ▼
                  [etcd cluster]        ← a fonte de verdade compartilhada
```

O HAProxy remove o problema de reatribuição de IP virtual: todo nó é acessível no mesmo endereço de proxy, e os health checks do proxy decidem quem realmente é o primário agora, em vez de algo ter que mover um IP flutuante e torcer para nenhum cache ARP obsoleto apontar para o lugar errado. O etcd (baseado em Raft, a mesma família de algoritmo de consenso usada por muitos sistemas distribuídos) dá a todo nó uma visão consistente de "quem é o primário" que sobrevive a partições de rede sem split-brain; essa é a parte que o repmgr implementa internamente, e que o Patroni trata como um componente plugável e substituível (ZooKeeper e Consul funcionam de forma idêntica do ponto de vista do Patroni, apenas backends de DCS diferentes).

### O loop de reconciliação que toda instância do Patroni roda

1. Verificar no DCS se existe uma chave de primário.
2. Se não existir, reivindicar o papel de primário escrevendo essa chave.
3. Se este nó detém o papel de primário, dizer ao HAProxy para rotear para cá.
4. Se já existe um primário em outro lugar, verificar o estado deste nó e, se necessário, transformá-lo em réplica.

Esse loop roda em todo nó, a cada poucos segundos, de forma independente. A falha de um primário significa que a próxima iteração do loop de todo nó sobrevivente encontra nenhuma chave de primário e tenta reivindicá-la; a garantia de consenso do DCS assegura que exatamente uma tentativa vence, e o loop de todo outro nó então converge para "tornar-se réplica do vencedor".

### Configurando um nó: um arquivo YAML por instância

```yaml
scope: stampede
name: pgha1

restapi:
  listen: pgha1:8008
  connect_address: pgha1:8008

etcd:
  host: pgha1:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        wal_level: replica
        wal_log_hints: "on"
  initdb:
    - encoding: UTF8
    - data-checksums

postgresql:
  listen: pgha1:5432
  connect_address: pgha1:5432
  data_dir: /db/pgdata
  bin_dir: /usr/lib/postgresql/18/bin
  authentication:
    replication:
      username: rep_user
      password: newpass
    superuser:
      username: postgres
      password: newpass
```

`ttl`/`loop_wait`/`retry_timeout` ajustam a rapidez com que uma falha é detectada em relação à tolerância do cluster a soluços transitórios de rede: um `ttl` mais curto faz failover mais rápido, mas arrisca uma promoção por falso positivo durante uma pequena interrupção. `maximum_lag_on_failover` (em bytes) exclui réplicas que ficaram muito atrasadas de serem candidatas a promoção, então um standby muito defasado não vence uma eleição e depois apresenta dados obsoletos como se fossem atuais. `use_pg_rewind: true` permite que um ex-primário rebaixado se reincorpore como réplica ressincronizando apenas os blocos divergentes, em vez de exigir uma reconstrução completa. Todo campo sob `bootstrap` só se aplica na criação inicial do cluster; em um cluster já existente, a configuração armazenada no DCS é autoritativa e a seção de bootstrap deste arquivo é ignorada.

### Operando o cluster: patronictl

```bash
patronictl -d pgha1:2379 list stampede
patronictl -d pgha1:2379 switchover stampede
```

`switchover` dispara uma transferência controlada: o Patroni pergunta qual nó promover (ou escolhe um automaticamente), rebaixa o primário atual e reconcilia o resto do cluster, tudo sem tirar o banco do ar. Esse é o mecanismo sobre o qual um upgrade contínuo sem downtime é construído: tirar o primário de um nó, atualizar quem agora é réplica, trazer de volta quando estiver pronto, repetir por nó. O Patroni também defende ativamente sua própria autoridade: se um operador para manualmente o PostgreSQL em um nó gerenciado pelo Patroni, o Patroni percebe a indisponibilidade na próxima iteração do loop e ou reinicia o processo ou, se era o primário, promove um substituto; deliberadamente difícil de burlar por acidente, que é exatamente a propriedade desejada de uma ferramenta de HA.

## Trade-offs

- **Delegar o consenso a um DCS é operacionalmente mais honesto do que implementá-lo você mesmo, mas isso adiciona um sistema distribuído inteiro a mais para operar.** etcd/ZooKeeper/Consul cada um precisa do próprio quorum (um número ímpar de nós, sua própria matemática de tolerância a falhas): a HA do Patroni só é tão boa quanto o cluster de DCS por baixo dela, então um "cluster" de etcd de 1 nó mal administrado compromete todo o design, não importa o quão bem o Patroni em si esteja configurado.
- **A seção de bootstrap só dispara uma vez, e isso pega gente desprevenida.** Mudar `bootstrap.dcs.postgresql.parameters` no arquivo YAML depois que um cluster já existe não faz nada: a configuração armazenada no DCS a partir do bootstrap inicial é o que está ativo, e ela precisa ser atualizada via `patronictl edit-config`, não editando o arquivo e reiniciando o Patroni.
```yaml
# editing this after the cluster already exists has no effect —
# it only applies on first bootstrap:
bootstrap:
  dcs:
    postgresql:
      parameters:
        wal_level: replica
```
- **`patronictl switchover` torna a manutenção genuinamente livre de downtime, ao custo de confiar totalmente na ferramenta com a seleção de primário.** O Patroni combatendo ativamente a intervenção manual (reiniciando uma instância parada, promovendo um substituto se um operador matar o primário na mão) é um recurso para confiabilidade sem supervisão e uma armadilha para quem não sabe que o Patroni está gerenciando o nó; "simplesmente reiniciar o postgres" deixa de ser um passo seguro de troubleshooting.
- **Livro vs. hoje**: o `wal_level: logical` da receita para um cluster puramente físico é mais do que necessário: `replica` (o padrão desde o PostgreSQL 10) é suficiente para replicação física via streaming e evita o volume extra de WAL que `logical` escreve sem nenhum benefício aqui (a mesma correção se aplica à receita simples de streaming replication deste livro; veja o conceito complementar sobre streaming replication). Separadamente, esta receita instala o Patroni 1.6.3 via `pip3` diretamente em servidores nus; o release atual está na série **4.x**, e, mais significativo do que o salto de versão, **hoje o Patroni é muito comumente implantado via operadores Kubernetes** (CloudNativePG, o postgres-operator da Zalando) em vez de instalado manualmente em VMs, com o suporte nativo do Patroni à API do Kubernetes como DCS sendo uma quarta opção ao lado de etcd/ZooKeeper/Consul. O fluxo manual de instalação e arquivo YAML que esta receita ensina continua válido e é exatamente o que esses operadores automatizam por baixo dos panos; vale saber isso na hora de decidir entre recorrer ao operador ou montar a stack na mão.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 10, "High Availability with Patroni", p. 433-475](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [Patroni Documentation](https://patroni.readthedocs.io/en/latest/) - doc
- [Patroni: YAML Configuration Settings](https://patroni.readthedocs.io/en/latest/yaml_configuration.html) - doc
- [Patroni: Running Patroni on Kubernetes](https://patroni.readthedocs.io/en/latest/kubernetes.html) - doc
- [etcd Documentation](https://etcd.io/docs/latest/) - doc
