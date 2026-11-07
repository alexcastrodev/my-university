---
title: "Jetpack: tornando o consenso rápido de forma geral"
summary: O Jetpack é uma camada shim que dá a protocolos de consenso existentes, como o Raft, um fast path de 1 RTT rodando ao lado do caminho original, e que nomeia e corrige o risco da troca de view, em que uma promessa feita em uma view pode ser quebrada pela eleição de líder seguinte.
researchArea: Sistemas distribuídos
keywords: consenso, fast path, troca de view, replicação de máquina de estados, geo-replicação, comutatividade, raft
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Os consensos clássicos baseados em líder (Viewstamped Replication, MultiPaxos, Raft) precisam de 2 round-trip times (RTTs) para um cliente confirmar um comando: um para chegar ao líder e voltar, e outro para o líder replicar aos followers. Esse custo é alto em implantações geo-replicadas. Protocolos como Fast Paxos, EPaxos, Tapir, SwiftPaxos e CURP confirmam em 1 RTT deixando os clientes enviarem comandos direto a todas as réplicas e coletando um quorum maior, mas cada fast path está colado ao protocolo que o hospeda, e trocar a camada de consenso de um sistema maduro raramente é uma opção.

Este artigo do OSDI 2026, da Stony Brook University e da DatenLord, pergunta se um fast path pode ser um plugin. O Jetpack envia cada comando por um fast path e pelo caminho original ao mesmo tempo, e o cliente confirma assim que um dos dois termina.

Três termos se repetem. O caminho original é o protocolo sem modificações, o fast path é a rota de 1 RTT baseada em superquorum, e o risco da troca de view (view change hazard) é o modo como uma promessa feita pelo caminho original durante uma view pode se perder depois de uma eleição de líder.

Vale conhecer antes: [Paxos Made Simple](/papers/paxos-made-simple) e [Raft](/papers/raft-understandable-consensus-algorithm) para quorums, líderes e views, a ideia do Fast Paxos de usar um quorum maior para uma rodada direta, e o [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) como exemplo de desenho nativo de 1 RTT.

## Contribuição

- **Dois caminhos e uma promessa.** Quando um comando c é confirmado pelo fast path, o caminho original promete não propor nenhum comando conflitante concorrente à frente de c no log. Só os proposers da view atual precisam fazer a promessa, o que a mantém tratável, e um comando que não a obtém recorre ao caminho original.
- **Comutatividade e um superquorum.** A aplicação fornece um predicado `Conflict(c1, c2)` (em um armazenamento chave-valor, mesma chave e pelo menos uma escrita). Com 2f+1 réplicas, um comando é confirmado pelo fast path quando f + ceil(f/2) + 1 réplicas o reconhecem sem conflito, um conjunto que precisa incluir todos os proposers do caminho original.
- **O risco da troca de view.** Dois requisitos estruturais: R1, recuperar todo comando confirmado pelo fast path na view anterior, e R2, colocar cada comando recuperado antes de qualquer comando conflitante ainda não confirmado na nova view. Dois princípios os atendem. Princípio 1: o fast path mantém a própria view, e um comando só é confirmado pelo fast path quando os reconhecimentos dos dois caminhos estão na mesma view. Princípio 2: os novos proposers recuperam, pelo caminho original, os comandos confirmados pelo fast path na view anterior, ou um no-op, antes de confirmar qualquer outra coisa, e essa entrada vira um marcador de estabilidade.
- **Recuperação.** Três fases: pausar as réplicas, chegar a acordo com um passo estilo Paxos sobre um conjunto de recuperação (comandos presentes em pelo menos ceil(f/2) + 1 de f + 1 respostas), e então reenviá-lo ao protocolo original e retomar.
- **Um shim com dois pré-requisitos.** Uma réplica do Jetpack roda ao lado de cada réplica original. O protocolo original precisa manter a ordem de proposta igual à do log (PR 1) e a ordem de chegada igual à de proposta (PR 2). Os clientes ajustam a taxa de tentativas do fast path conforme a latência recente e a carga de CPU, recuando sob saturação.
- **Evidência de que o risco é real.** Os autores mostram lacunas no esboço de CURP para Raft, no Xline (um sistema construído sobre ele) e no Carousel.

## Metodologia

O Jetpack é escrito em C++. Raft e Copilot são construídos sobre o DepFast, o Mencius na mesma base de código, e os sistemas de produção são MongoDB 8.2.0, etcd 3.7.0-alpha.0 e ZooKeeper 3.9.4. Os autores verificam cada integração com model checking em TLA+ ao longo de trocas de view e relatam nenhuma violação de segurança, e o Apêndice B traz uma prova. Os experimentos rodam no AWS EC2 em 10 datacenters, com réplicas em cinco e clientes em todos os dez, e 60 clientes open-loop geram uma carga inspirada no YCSB, 50% leituras e 50% escritas sobre 1M de chaves Zipfian, variando o skew de 0,5 a 1,0 e o intervalo de chaves de 100 a 1M. O Jetpack roda com o fast path desligado, sempre ligado e adaptativo. Outros experimentos comparam o Jetpack-Raft com CURP, SwiftPaxos e EPaxos em uma mesma base de código, usam uma carga no estilo Akkio com localidade de líder e leases de leitura, desligam um líder para medir a recuperação, injetam 300 ms de latência de ida no piloto do Copilot e medem CPU e memória.

## Resultados

Estes são os resultados relatados pelos autores.

- **Latência.** No modo adaptativo, a latência média cai 53,39% no Raft, 63,90% no Copilot, 39,06% no MongoDB, 42,36% no etcd e 52,59% no ZooKeeper.
- **Sem custo quando não usado.** Com a taxa de tentativas em zero, o Jetpack-Raft quase se sobrepõe ao Raft original, e com a carga crescente a política adaptativa converge para o comportamento original.
- **Contra fast paths nativos.** Com carga baixa, Jetpack-Raft, CURP, SwiftPaxos e EPaxos confirmam em 165 a 210 ms, contra cerca de 355 ms do Raft. Raft, Jetpack-Raft e CURP saturam em 12 mil ops/s, o SwiftPaxos em cerca de 19 mil e o EPaxos em cerca de 25 mil, o que os autores atribuem ao compromisso entre generalidade e integração profunda.
- **Contenção.** Os ganhos diminuem com o aumento do skew, mas o Jetpack-Raft supera o original na latência média e no p99 em todos os níveis. Com skew 1,0 e 50% de leituras e escritas, a fração de requisições que de fato se beneficia é de 65,91% no Raft, 64,53% no Copilot, 34,66% no MongoDB e 18,87% no Mencius.
- **Mitigações de produção.** Com 73% das requisições chegando a um líder local, os outros 27% ainda pagam 2 RTTs. Leases de leitura aceleram só as leituras, enquanto o Jetpack acelera leituras e escritas e se combina com os dois.
- **Falhas e lentidão.** Desligar o líder deixa a recuperação cerca de 1 s mais longa no Raft e 1,5 s mais longa no MongoDB do que na versão original. A política adaptativa do Copilot volta a uma latência quase igual à original quando o piloto fica lento.
- **Mencius.** Os ganhos são menores e a CPU extra é de 36,83% sobre uma base de 16,70%, contra 3,03% a 9,57% extras nos demais. Os autores derivam um custo Ω(M) por comando para a integração não intrusiva com M líderes.
- **Esforço e compatibilidade.** As integrações com MongoDB, etcd e ZooKeeper exigiram 60, 68 e 52 linhas no protocolo original. Dos 16 sistemas de consenso pesquisados, 6 (entre eles o NOPaxos e o [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications)) já têm um fast path, 9 dos outros 10 atendem aos pré-requisitos, e o EPaxos não.

## Análise crítica

A ideia é limpa, e nomear o risco é útil além deste sistema. O artigo admite vários limites.

- **Troca-se throughput por latência.** Cada comando chega a todos os proposers, então o throughput máximo não melhora, e a política adaptativa só atenua isso recuando.
- **O overhead multi-líder é estrutural.** Os autores argumentam que desenhos multi-líder com log compartilhado são raros, citando seis dos dez principais bancos do DB-Engines que usam replicação por shard baseada em líder e nenhum que use multi-líder com log compartilhado. Eles também deixam em aberto BFT, transações interativas e o EPaxos.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A maioria dos números vem de uma carga padrão.** As reduções de destaque usam 50% de leituras e escritas sobre 1M de chaves. Para 95% de leituras o artigo relata apenas taxas de benefício, e no MongoDB essa taxa tem teto de 5%, então os ganhos dependem da proporção de leituras e da contenção.
- **A recuperação é pouco medida.** Cada sistema recebe um único desligamento induzido de líder, e o texto não informa número de repetições nem variância dos resultados de latência. O tempo de recuperação não é relacionado ao tamanho do log ou do pool de comandos, e as otimizações do Apêndice B.2 (de seis RPCs para duas) não são quantificadas.
- **O número de destaque é arredondado e puxado pelo Copilot.** O resumo diz "até 60%", enquanto o resultado do Copilot é 63,90%, e o artigo diz que o Copilot frequentemente falha no próprio FastAccept e cai para um caminho lento de 3 RTTs, então parte desse ganho reflete a base de comparação mais fraca do Copilot.
- **A correção é condicional.** A prova assume propriedades do protocolo original, e o texto não dá os tamanhos de modelo das execuções em TLA+. O MongoDB precisou de uma mudança que pula entradas não confirmadas no catch-up, justificada em uma frase. A pesquisa também inclui o SwiftPaxos, que as referências listam como NSDI, não OSDI nem SOSP.
- **As críticas e as bases de comparação são em parte construídas.** O caso do Carousel vem da especificação publicada, e o artigo registra que seus autores dizem que mecanismos adicionais podem cobri-lo. O problema do Xline foi reportado com um patch, mas o desfecho não é informado. O CURP da Figura 10 é uma versão com o risco corrigido.

## Pesquisas futuras

- Adaptar o EPaxos, que viola o PR 1, por exemplo forçando sua ordenação topológica a respeitar a ordem de inserção, e estender a abordagem a protocolos BFT e a transações interativas, como o artigo sugere.
- Predicados de conflito mais ricos (intervalos, predicados SQL) por meio de índices de intervalo ou escopos mais grossos, que o artigo descreve mas não avalia.
- Integração multi-líder mais barata, por exemplo relaxando o requisito de não intrusão por trás do limite Ω(M).
- O custo de recuperação conforme logs e pools de comandos crescem, com falhas repetidas e as otimizações do Apêndice B.2 medidas.
