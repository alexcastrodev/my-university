---
title: "Não se contente com eventual: consistência causal escalável para armazenamento de área ampla com o COPS"
summary: O COPS é um armazenamento chave-valor geo-replicado que oferece consistência causal com tratamento convergente de conflitos (causal+) sem abrir mão de disponibilidade, baixa latência nem escalabilidade, rastreando dependências entre chaves e checando-as no datacenter receptor antes de uma escrita replicada ficar visível. A variante COPS-GT acrescenta transações de leitura sem bloqueio.
researchArea: Distributed Systems
keywords: consistência causal, causal+, geo-replicação, armazenamento chave-valor, ALPS, transações de leitura, rastreamento de dependências
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Armazenamentos de dados distribuídos e geo-replicados que sustentam aplicações online complexas, como redes sociais, precisam oferecer uma experiência "sempre ligada", em que as operações sempre terminam com baixa latência. Os sistemas atuais costumam sacrificar a consistência forte para atingir esses objetivos, expondo inconsistências aos clientes e exigindo lógica de aplicação complexa. Neste artigo, os autores identificam e definem um modelo de consistência, a consistência causal com tratamento convergente de conflitos, ou causal+, que é o mais forte alcançável sob essas restrições. Apresentam o projeto e a implementação do COPS, um armazenamento chave-valor que entrega esse modelo na área ampla. Uma contribuição central é a escalabilidade: o COPS impõe dependências causais entre chaves guardadas em um cluster inteiro, e não em um único servidor como os sistemas anteriores. A abordagem central é rastrear e checar explicitamente se as dependências causais entre chaves estão satisfeitas no cluster local antes de expor as escritas. Além disso, no COPS-GT introduzem transações de leitura (get transactions) para obter uma visão consistente de várias chaves sem travas nem bloqueio. A avaliação mostra que o COPS completa operações em menos de um milissegundo, tem vazão semelhante à dos sistemas anteriores com um servidor por cluster e escala bem conforme cresce o número de servidores. Mostra também que o COPS-GT tem latência, vazão e escala parecidas com as do COPS em cargas comuns.

## Visão geral

Este artigo do SOSP 2011 (Cascais, Portugal) é de Wyatt Lloyd e Michael J. Freedman (Princeton), Michael Kaminsky (Intel Labs) e David G. Andersen (Carnegie Mellon). Ele foi escrito quando os grandes serviços web já tinham se acomodado na consistência eventual. O [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) é o exemplo do próprio artigo: sempre gravável, com os conflitos deixados para a aplicação. O ensaio de Werner Vogels, [Eventually Consistent](/papers/eventually-consistent-vogels), explica esse trade-off, e a [Conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services) é a prova do CAP de onde o artigo parte.

Os autores chamam de ALPS um sistema com quatro propriedades: Availability (disponibilidade), baixa Latência, tolerância a Partições e alta Scalability (escalabilidade). Um armazenamento ideal acrescentaria a linearizabilidade ([Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects)), mas o artigo lembra que o CAP a exclui junto com disponibilidade e tolerância a partições, e que baixa latência também é incompatível com linearizabilidade e com consistência sequencial (resultados que ele cita, não novos). A pergunta passa a ser: qual o modelo mais forte que um sistema ALPS ainda consegue oferecer?

Vale conhecer antes: a relação acontece-antes de Lamport ([Relógios e ordenação de eventos](/papers/lamport-time-clocks-ordering-of-events)), hashing consistente e replicação em cadeia ([Chain Replication](/papers/chain-replication-high-throughput-availability)), em que o projeto se apoia.

## Contribuição

- **ALPS e causal+.** A consistência causal exige que as leituras respeitem a causalidade potencial: ordem da thread de execução, "gets from" (ler um valor vem depois do put que o escreveu) e transitividade. O tratamento convergente de conflitos exige que puts concorrentes na mesma chave sejam tratados de forma idêntica em todas as réplicas por uma função associativa e comutativa, de modo que as réplicas nunca divirjam para sempre. O tratamento padrão é o last-writer-wins.
- **Um lugar no espectro.** O causal+ fica entre a consistência sequencial e a causal: mais forte que a causal e que a sequencial por chave, mais fraco que a sequencial. O artigo diz que sistemas anteriores como Bayou e PRACTI, tidos como causais, na verdade eram causal+, mas nenhum era escalável.
- **Checagem escalável de dependências.** Cada versão de chave carrega metadados, e uma escrita replicada só é efetivada num cluster remoto depois que suas dependências já estão efetivadas ali. As dependências podem estar em qualquer nó do cluster, enquanto os sistemas anteriores as limitavam a uma máquina.
- **Dependências mais próximas.** A biblioteca cliente marca só as dependências com caminho de comprimento um até a escrita, e assim o nó faz poucas chamadas dep_check.
- **Transações de leitura (COPS-GT).** A leitura de várias chaves devolve um retrato causal+ consistente em no máximo duas rodadas de leituras locais, sem travas e sem bloqueio. O artigo afirma que o COPS-GT é o primeiro sistema ALPS a conseguir isso.

## Metodologia

Cada datacenter roda uma réplica completa como cluster, particionado por hashing consistente e linearizável por dentro (o projeto usa replicação em cadeia por chave). Os clientes falam só com o cluster local. Um put é efetivado localmente, retorna e é replicado em segundo plano por put_after, levando chave, valor, dependências e versão. A versão é um timestamp de Lamport (o relógio do nó nos bits altos, seu identificador nos baixos), que também produz a ordem do last-writer-wins. O nó receptor envia dep_check aos nós que guardam as dependências mais próximas e efetiva a escrita quando todas passam. Cada contexto de cliente permite um único put pendente.

O COPS guarda uma versão e seu número por chave. O COPS-GT guarda várias versões com as listas completas de dependências. Seu get_trans lê a versão mais recente de cada chave, calcula a versão mais nova de cada chave implicada pelas dependências devolvidas e relê só as chaves defasadas por versão explícita, o que, segundo o artigo, não pode introduzir novas dependências. As dependências são podadas por uma marca never-depend (posta quando a escrita está efetivada em todos os datacenters), por um tempo de checkpoint global propagado por gossip e por um trans_time de 5 segundos, que limita por quanto tempo as versões antigas precisam ficar.

O protótipo tem cerca de 13.000 linhas de C++ sobre o FAWN-KV (cerca de 8.500 linhas), com Thrift e Snappy. Roda em 70 servidores do testbed VICCI divididos em datacenters lógicos, com banda total entre eles. Compara COPS, COPS-GT e LOG, o mesmo código sem rastreamento de dependências, que representa os sistemas de troca de logs. Cada teste dura 60 segundos (os primeiros e os últimos 15 são descartados) e é repetido 15 vezes, com a mediana reportada.

## Resultados

- **Microbenchmarks (Tabela 2, um servidor por datacenter, valores de 1 byte).** O get_by_version tem latência mediana de 0,37 ms no COPS e 0,38 ms no COPS-GT, contra 0,26 ms de um ping Thrift, a 52 Kops/s contra 60. O put_after tem mediana de 0,57 ms e 30 Kops/s no COPS, e 0,91 ms e 24 Kops/s no COPS-GT com uma dependência. Com 130 dependências, o COPS-GT tem 1,03 ms e 20 Kops/s. O percentil 99 chega a 7,45 ms e o 99,9 a 12,25 ms (ping). O artigo diz que a latência mediana do put_after fica em torno de 1 ms mesmo com até 130 dependências, e que cada dependência ocupa cerca de 12 bytes.
- **As dependências puxam o custo.** O tempo de checkpoint global fica cerca de 6 segundos atrasado, então um cliente que faz 100 puts por segundo carrega cerca de 600 dependências. O COPS-GT precisa rastreá-las todas, enquanto o COPS guarda de 1 a 4 mais próximas e sua vazão não depende da variância de acesso.
- **COPS contra COPS-GT.** Com os parâmetros padrão (put:get 1:1, 1024 clientes por servidor, variância 1, valores de 1 byte), o COPS-GT chega a cerca de dois terços do COPS, uma carga que os autores escolheram como não ideal. A diferença some com maior intervalo entre operações (32 mil clientes por servidor), put:get 1:16, variância 1/128 ou valores de 16KB. Numa "carga esperada" (32 mil clientes, 1KB, 1:16), os dois ficam "muito comparáveis".
- **Escalabilidade.** A vazão quase dobra cada vez que os servidores por datacenter dobram (1, 2, 4, 8, 16), no COPS e no COPS-GT, e o COPS com um servidor iguala o LOG. Os valores brutos por barra da Figura 12 só se leem no gráfico (leitura de gráfico) e não são citados aqui.
- **Espaço.** A 105 MB/s de tráfego de escrita por nó, guardar versões antigas durante o trans_time exige cerca de 525 MB de buffer extra por máquina.

## Análise crítica

O artigo declara vários limites. O COPS-GT é menos eficiente em cargas pesadas de escrita e menos robusto a partições longas e a falhas de datacenter, porque dependências sobre as versões mais novas não podem ser podadas durante uma partição. Um datacenter que falha perde as escritas ainda não replicadas para fora, o que os autores chamam de custo inevitável das escritas locais rápidas. Cada cliente só pode ter um put pendente. As falhas são assumidas como fail-stop e detectáveis.

Os pontos abaixo são uma leitura da evidência, não afirmações do artigo.

- **Sem transações de escrita.** O COPS oferece apenas puts de uma chave e transações de leitura. O próprio artigo observa que o Walter dá garantias transacionais entre chaves, inclusive para escritas, ao preço de um commit em duas fases na área ampla em alguns casos.
- **A tolerância a falhas não foi avaliada.** O protótipo deixa de fora a replicação em cadeia e a detecção de conflitos (o COPS-CD é só projeto), e não há experimento que perca um datacenter nem que meça as filas de replicação crescendo durante uma partição.
- **O testbed esconde a área ampla.** Os experimentos usam datacenters lógicos num mesmo cluster com banda total entre eles, e o texto não descreve atraso de área ampla emulado. O artigo argumenta que um RTT de 70 ms é cerca de 1% do atraso de uns 6 s do checkpoint, mas não mede nenhuma execução em área ampla.
- **Resumo contra tabelas.** "Menos de um milissegundo" é uma afirmação sobre a mediana: a Tabela 2 mostra percentis 99 de 3 a 7 ms e 99,9 de 7 a 12 ms.
- **Literatura posterior (não lida para este texto, tirada de outras análises do catálogo).** A entrada do [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) registra que seus autores deixaram COPS e Eiger fora da comparação porque a checagem explícita de dependências parecia impraticável com geo-replicação parcial. A entrada de [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) classifica a consistência causal como apenas "sticky available", o que combina com clientes do COPS falando com um único cluster local.

## Pesquisas futuras

- Transações de escrita e atualizações atômicas entre chaves sem um único ponto de serialização.
- Permitir que uma escrita seja efetivada depois de menos que todos os datacenters, o que o artigo lista como trabalho futuro.
- Metadados mais baratos: o custo de rastrear todas as dependências para as transações de leitura é o que limita o COPS-GT em cargas pesadas de escrita.
- Comparar com o [Spanner](/papers/spanner-globally-distributed-database), que (fora deste artigo) paga latência de área ampla para manter consistência forte, e com a convergência no estilo CRDT ([CRDTs](/papers/conflict-free-replicated-data-types)) como tratador de conflitos; veja também [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy).
