---
version: 1.0
updatedAt: 2026-11-04
title: "Capstone: Escolhendo um Projeto de Replicação e Ordenação para uma Carga de Trabalho"
summary: "Dada uma carga de trabalho concreta, cinco perguntas levam a uma escolha entre consenso, certificação, réplicas causais, shared logs, projetos determinísticos e ordenação na rede, com o custo calculado e cada decisão defendida contra seus modos de falha."
---
## Objetivos de Aprendizagem

- Transformar uma carga de trabalho nas perguntas que decidem um projeto: o que precisa de ordem, onde ficam as réplicas, quais invariantes existem, quanta contenção há nos dados e o que a rede permite.
- Associar cada resposta a uma família de projetos desta disciplina e dizer o que essa família supõe.
- Calcular o custo de um projeto para uma carga concreta a partir de round trips, tamanhos de quórum e chance de conflito.
- Dividir um sistema em conjuntos de dados com projetos diferentes e defender cada escolha contra seus modos de falha.

## Contexto e Motivação

Esta disciplina cobriu uma dúzia de formas de ordenar e replicar dados, e cada lição terminou com um preço. Nenhuma venceu. `multi-paxos-from-one-decision-to-a-replicated-log` é simples e forte, e cobra um round trip até uma maioria a cada escrita. `causal-consistency` responde localmente e não protege um invariante. `deterministic-transactions-calvin` elimina os votos de commit e exige conjuntos de leitura e escrita declarados.

A habilidade que importa é ler uma carga de trabalho com atenção suficiente para saber qual preço ela pode pagar. Este capstone aplica essa habilidade a um único sistema, como `capstone-designing-a-cloud-storage-system-for-a-workload` fez para armazenamento. A conclusão é que um sistema raramente tem uma resposta só.

## Teoria Central

### Cinco perguntas

**1. O que precisa de ordem?** Uma máquina de estados replicada precisa de uma única ordem para tudo o que guarda, enquanto um conjunto de chaves independentes precisa de bem menos. Fazer esta pergunta primeiro evita comprar uma ordem global para dados que só precisam de ordem por chave.

**2. Existe um invariante entre operações concorrentes?** "Um assento é vendido uma vez" e "um nome de usuário é único" não podem ser verificados por dois sites agindo sozinhos. `transactional-causal-consistency` mostra dois datacenters aprovando, cada um, uma ação que é legal isoladamente e ilegal em conjunto. Se o invariante precisa valer, essas operações precisam de acordo, e nenhuma quantidade de metadados causais substitui isso.

**3. Onde estão as réplicas em relação aos clientes?** Dentro de um datacenter, um round trip é barato. Entre regiões, a velocidade da luz impõe um piso, e toda escrita que precisa chegar a uma maioria paga esse piso.

**4. Quanta contenção há nos dados?** A contenção decide entre projetos otimistas, que pagam com aborts, e projetos pessimistas ou determinísticos, que pagam com espera.

**5. O que você controla?** Projetos de ordenação na rede precisam de um sequenciador na rede. O Calvin precisa de transações cujos conjuntos possam ser declarados. Um projeto só está disponível se suas suposições puderem ser atendidas.

### As famílias e o que elas supõem

| Família | Entrega | Supõe | Paga com |
|---|---|---|---|
| Log de consenso | Uma ordem, linearizável | Uma maioria alcançável | Um round trip até a maioria por escrita |
| Certificação | Serializabilidade de uma cópia | Atomic broadcast | Aborts sob contenção |
| Réplicas causais | Escritas locais, disponibilidade | Nenhum invariante entre sites | Leituras mais fracas, atraso de visibilidade |
| Shared log | Uma ordem sobre muitos servidores | Uma forma de ordenar em escala | Uma etapa de ordenação no caminho |
| Determinístico | Ordem serial sem votos de commit | Conjuntos declarados | Atraso de batch, sem reordenar em torno de travamentos |
| Ordenação na rede | Caminho rápido sem coordenação | Uma rede controlada pelo operador | Um caminho lento, um datacenter |

Detecção de falhas e membership ficam por baixo de todas elas. `failure-detectors` explica por que a suspeita basta para a vivacidade, e `reconfiguration-changing-membership-in-paxos-and-raft` mostra por que trocar réplicas exige o mesmo cuidado que o caminho dos dados.

### Leia todo número publicado com sua condição

As lições aqui relatam vazão e latência de papers, e cada valor pertence a um testbed, uma carga e um tamanho de payload. Um número de um paper não pode ser posto contra o de outro como se ambos tivessem sido medidos juntos. Para decidir um projeto, use os papers para a forma do trade-off e meça a sua própria carga para a quantidade.

## Exemplos Resolvidos

Uma plataforma de ingressos tem quatro conjuntos de dados. Todas as latências, taxas e números de contenção abaixo são suposições deste exercício, e cada cálculo foi rodado em um script.

### Exemplo 1: Plano de controle

O mapa de shards e as feature flags mudam algumas vezes por minuto, precisam ser lidos de forma consistente e ficam em uma região, em cinco réplicas. As escritas são raras, não há transações entre chaves, e importa continuar disponível com duas quedas.

Um log de consenso se encaixa diretamente. Vale conferir quóruns flexíveis, porque `fast-paxos-and-flexible-quorums` mostra que só os quóruns da fase 1 e da fase 2 precisam se intersectar:

```text
Q1  Q2  intersectam?  quedas suportadas escrevendo  quedas suportadas elegendo
3   3   sim           2                             2
4   2   sim           3                             1
5   1   sim           4                             0
3   2   não
```

Um quórum menor na fase 2 ajuda uma carga que escreve o tempo todo. Esta quase não escreve, e com Q1 = 4 uma troca de líder suportaria só uma queda. Maiorias simples vencem, e a otimização é recusada.

### Exemplo 2: Estoque de assentos

Dezesseis shards em uma região guardam os assentos. Uma compra leva vários assentos que podem cruzar shards, e uma abertura de vendas concorrida deixa poucas chaves extremamente quentes. "Vendido uma vez" é um invariante, então a pergunta 2 elimina as réplicas causais.

A certificação não tem janela de lock, então parece atraente. Considere conjuntos de escrita de `k` chaves entre `D` chaves quentes, e `c` transações concorrentes:

```text
D          k  c    P(duas transações se sobrepõem)  P(ao menos uma sobreposição)
1.000.000  5  200  0,000025                         0,0050
100        5  200  0,2304                           1,0000
```

Em um espaço de chaves grande e frio, a certificação é excelente. Em uma abertura de vendas, a transação quase sempre encontra um conflito, e o trabalho abortado é repetido na mesma contenção.

Compare dois caminhos com lock em uma chave quente, supondo atraso de ida de 0,25 ms e 0,1 ms de execução. Neste modelo simples, 2PC sobre grupos de consenso segura os locks durante prepare, replicação, voto e replicação da decisão, ou seja, 6 atrasos de ida. Um projeto determinístico os segura durante a troca de leituras e a execução, cerca de 2 atrasos, porque a ordem foi fixada antes:

```text
2PC sobre consenso:  segura 1,60 ms -> no máximo 625 transações/s nessa chave
Determinístico:      segura 0,60 ms -> no máximo 1.667 transações/s nessa chave
```

O caminho determinístico paga em outro lugar: com as épocas de 10 ms do Calvin, uma requisição espera em média 5 ms pelo seu batch, mais a replicação. Os IDs dos assentos estão na requisição, então os conjuntos podem ser declarados, e alguns milissegundos são aceitáveis para quem compra um ingresso. Um projeto determinístico se encaixa.

A ordenação na rede cortaria ainda mais a latência, mas `network-ordered-consensus-nopaxos-eris-and-hydra` supõe uma rede controlada pelo operador. A plataforma roda em nuvem pública, então a pergunta 5 a elimina.

### Exemplo 3: Perfis e seguidores

Três regiões atendem os usuários, e as escritas precisam parecer instantâneas. Suponha round trips de 70 ms entre Virgínia e Irlanda, 150 ms entre Virgínia e Tóquio e 210 ms entre Irlanda e Tóquio. Consenso com líder na Virgínia e maioria de dois dá:

```text
Cliente em   Escrita com consenso   Escrita causal confirmada
Virgínia     70 ms                  local
Irlanda      140 ms                 local
Tóquio       220 ms                 local
```

A replicação causal confirma na região local, e a escrita fica visível nas outras depois de pelo menos o atraso de ida: 35 ms da Virgínia para a Irlanda, 75 ms para Tóquio, 105 ms da Irlanda para Tóquio. Perfis e seguidores não têm invariante entre sites, e um seguir que aparece 100 ms depois não prejudica ninguém, então a consistência causal transacional se encaixa. `causal-metadata-for-geo-replication-saturn` importa se os metadados virarem um problema de visibilidade ou de vazão.

Há uma exceção dentro desse conjunto. Nomes de usuário precisam ser únicos, e a pergunta 2 se aplica. As reservas de nome passam pelo log de consenso do plano de controle e pagam o round trip. Elas são raras, então o custo é pequeno.

### Exemplo 4: Eventos de pedidos

Cada venda produz eventos que muitos consumidores reproduzem, e essa reprodução precisa de uma ordem total. Suponha 40 shards de armazenamento com 15.000 appends por segundo cada, 600.000 no total, e um único sequenciador limitado a 200.000 tokens por segundo:

```text
Oferecido 600.000/s, entregue min(600.000, 200.000) = 200.000/s
Shards que o sequenciador consegue alimentar: 13 de 40
```

O sequenciador vira gargalo muito antes do armazenamento. `scaling-shared-logs-fuzzylog-and-scalog` oferece duas saídas. O FuzzyLog remove a ordem global, de que a reprodução precisa aqui, então fica de fora. O Scalog mantém a ordem total ordenando registros já replicados, ao custo de esperar por um cut. Se depois um consumidor precisar de latência fim a fim menor, `low-latency-shared-logs-lazylog-and-speclog` mostra para onde essa espera pode ir. Ela não desaparece.

### O resultado

| Conjunto de dados | Projeto | O que mudaria a escolha |
|---|---|---|
| Plano de controle | Log de consenso, maiorias | Carga pesada de escrita |
| Estoque de assentos | Transações determinísticas | Conjuntos que não possam ser declarados |
| Perfis, seguidores | Causal transacional | Um novo invariante entre sites |
| Nomes de usuário | Log de consenso | Nada comum |
| Eventos de pedidos | Shared log com cuts | Reprodução deixar de precisar de uma ordem |

## Equívocos Comuns e Armadilhas

- **"Escolha a garantia mais forte para ficar seguro."** O Exemplo 3 mostra a opção mais forte somando 220 ms a uma escrita que não precisava disso. Força tem preço, e pagá-lo onde nada depende dela é erro de projeto.
- **"Consistência causal é quase tão boa quanto consenso."** Ela serve bem até aparecer um invariante. O nome de usuário do Exemplo 3 não pode ser protegido por metadados, por mais ricos que sejam.
- **"Certificação é sempre mais barata porque evita locks."** O Exemplo 2 mostra que isso depende inteiramente da contenção: o mesmo protocolo foi de 0,5% à quase certeza de conflito.
- **"Este paper chegou a um milhão de operações por segundo, então meu sistema chega."** Esse número vem com um testbed, um payload e muitas vezes um fator de replicação omitido. Use-o para a forma, não para planejar.
- **"Um sequenciador mais rápido na rede resolve."** Só para operadores que podem implantá-lo, e só dentro de um datacenter.
- **"Um sistema deve ter um único projeto de replicação."** Quatro conjuntos de dados com respostas diferentes são o resultado normal, não uma falha de arquitetura.

## Resumo

Um projeto decorre de cinco perguntas: o que precisa de ordem, quais invariantes cruzam operações concorrentes, onde ficam as réplicas, quanta contenção há nos dados e o que você controla. Cada família responde a algumas delas e supõe o resto. Neste exemplo, o consenso ficou com dados raros e críticos, um projeto determinístico assumiu o estoque disputado, a replicação causal manteve perfis globais rápidos, e um shared log com cuts levou os eventos além do limite de um sequenciador. Calcule o custo para a sua carga, leia números publicados com suas condições e diga o que faria você mudar de ideia.

## Documentation Links

- [Howard, Malkhi and Spiegelman (2016): Flexible Paxos, Quorum Intersection Revisited](https://arxiv.org/abs/1608.06696): o requisito de interseção de quóruns por trás do Exemplo 1.
- [Thomson et al. (2012): Calvin: Fast Distributed Transactions for Partitioned Database Systems](https://cs.yale.edu/homes/thomson/publications/calvin-sigmod12.pdf): transações determinísticas e as épocas de 10 ms do Exemplo 2.
- [Li, Michael and Ports (2017): Eris: Coordination-Free Consistent Transactions Using In-Network Concurrency Control](https://syslab.cs.washington.edu/papers/eris-sosp17.pdf): a alternativa de ordenação na rede descartada no Exemplo 2.
- [Akkoorath et al. (2016): Cure: Strong Semantics Meets High Availability and Low Latency](https://webperso.info.ucl.ac.be/~pvr/icdcs2016-cure.pdf): o modelo causal transacional do Exemplo 3.
- [Lloyd et al. (2011): Don't Settle for Eventual: Scalable Causal Consistency for Wide-Area Storage with COPS](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf): replicação causal com operações locais.
- [Ding et al. (2020): Scalog: Seamless Reconfiguration and Total Order in a Scalable Shared Log](https://www.usenix.org/system/files/nsdi20-paper-ding.pdf): ordenar registros replicados por cuts, como no Exemplo 4.
