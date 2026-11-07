---
title: "Grove: uma biblioteca de lógica de separação para verificar sistemas distribuídos"
summary: O Grove estende a lógica de separação concorrente com posse por nó, crashes, redes com perdas e invariantes limitados no tempo, para que as provas cubram leases baseados em tempo, e seus autores o usam para verificar o vKV, um key-value store replicado em Go cujas réplicas atendem leituras sob leases.
researchArea: Sistemas distribuídos
keywords: lógica de separação, verificação formal, leases, recuperação de crashes, reconfiguração, invariantes limitados no tempo, iris
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Verificar um sistema distribuído significa lidar ao mesmo tempo com concorrência, crashes que apagam a memória, mensagens perdidas ou duplicadas e relógios sincronizados de forma frouxa. Uma peça que os trabalhos anteriores de verificação não tratavam é o lease, uma promessa de que algo não vai mudar por um período de tempo. Os leases interagem com a recuperação de crashes e com a reconfiguração (um novo primário só pode ser escolhido depois que os leases expiram) e com a concorrência local ao nó, porque um lease pode expirar entre a checagem que passou e a leitura que ele deveria proteger.

Este artigo do SOSP 2023 (Koblenz), de Upamanyu Sharma, Ralf Jung, Joseph Tassarotti, M. Frans Kaashoek e Nickolai Zeldovich (MIT CSAIL, ETH Zurich e New York University), apresenta o Grove, uma biblioteca para lógica de separação concorrente (CSL). Ela estende o Perennial, que é construído sobre o Iris e o Coq, e é usada para verificar componentes distribuídos escritos em Go. O estudo de caso principal é o vKV, um key-value store multithread com replicação primário/backup, reconfiguração, recuperação de crashes e leituras baseadas em lease em qualquer réplica.

Vale separar três camadas: o Grove é a biblioteca de lógica, o vRSM é a biblioteca verificada de máquina de estados replicada construída com ele, e o vKV é um key-value store em cima do vRSM. Os autores dizem que o desenho do vKV não é novo, é um estudo de caso.

Vale conhecer antes: pré e pós-condições no estilo Hoare, a ideia de posse na lógica de separação (`x` aponta para `v` significa que esta thread possui a posição `x`), linearizabilidade e replicação primário/backup. O artigo cita o [Spanner](/papers/spanner-globally-distributed-database) como exemplo de leases que mantêm um único líder Paxos.

## Contribuição

- **Posse entre nós.** O Grove acrescenta recursos de points-to do heap por nó, além de recursos para o estado da rede e o conteúdo de arquivos. A conjunção separadora passa então a separar o estado entre nós, e não só entre threads. Os nós podem sofrer crash de forma independente em qualquer ponto, até durante a recuperação, perdendo o heap mas mantendo os arquivos duráveis, e o Grove estende a Crash Hoare Logic a esse cenário.
- **Um modelo de rede não confiável.** As mensagens podem ser descartadas, reordenadas ou duplicadas. Uma biblioteca `rpc` verificada oferece chamadas não confiáveis, e sua especificação exige uma pré-condição duplicável, porque uma requisição pode ser retransmitida e cada execução consome uma cópia. O padrão recorrente é formular as pré-condições como conhecimento, e não como posse exclusiva.
- **Recursos fantasmas.** As épocas aparecem como um `CurrentEpoch = e` exclusivo, mantido pelo serviço de configuração, e um `CurrentEpoch >= e` duplicável, que implica que as épocas só crescem. Os logs são listas append-only com três recursos: o points-to, um limite inferior duplicável e uma versão somente leitura usada para modelar uma réplica selada.
- **Invariantes limitados no tempo.** Um invariante que vale apenas até a expiração de um lease, com quatro regras. Ele é criado abrindo mão de um recurso e fixando uma expiração, recuperado depois da expiração, estendido apenas para frente e aberto enquanto não expirou. O tempo vem de um `GetTimeRange()` no estilo TrueTime, que devolve um intervalo que deve conter o tempo real, com relógios supostamente sincronizados dentro de limites conhecidos (abaixo de um segundo no vKV). A prova pode dar passos no instante dessa chamada e precisa considerar os dois resultados da checagem que vem depois.
- **Os estudos de caso.** O vKV é montado a partir de `rpc`, `storage`, `exactlyonce`, `replica`, `reconfig`, um `configservice` e uma pequena camada de replicação baseada em Paxos para ele. Uma escrita só é confirmada depois que todas as réplicas a aceitaram, e uma réplica atende leituras sob um lease de época dado pelo serviço de configuração. As aplicações por cima incluem o `cachekv` (cache no cliente baseado em lease), um serviço de locks e um banco.

## Metodologia

As provas são checadas por máquina no Coq, e os autores confirmam que estão completas com `Print Assumptions`. As extensões do próprio Grove ao Perennial somam 1.597 linhas de Coq, com um teorema de solidez de composição distribuída. O esforço de prova é reportado como linhas de Go contra linhas de especificação e prova em Coq para cada componente (Figura 10), e o texto percorre cenários de "e se" que mostram onde uma prova travaria diante de um bug.

Os experimentos de desempenho usam 8 servidores do CloudLab (até 3 réplicas, 4 clientes, 1 serviço de configuração), cada um com um Xeon E5-2630v3, 64GB de RAM, um SSD de 200GB e uma placa de rede gigabit. A carga é o YCSB com chaves uniformes e valores de 128 bytes, de clientes em malha fechada, com 20 segundos de aquecimento e 1 minuto de medição. A base de comparação é o Redis com `appendfsync always`, contra o vKV preso a um core e sem backups. Outros experimentos aumentam o número de servidores e matam o primário de uma configuração de dois servidores.

## Resultados

Estes são os resultados relatados pelos autores.

- **Esforço de prova.** 2.435 linhas verificadas de Go exigem 28.077 linhas de especificação e prova em Coq, cerca de 12×, com mais 170 linhas de bibliotecas de rede e de sistema de arquivos confiadas. Os autores o consideram comparável a projetos de verificação concorrente e distribuída, um pouco acima do IronFleet (que também prova liveness) e um pouco abaixo do GoJournal. O componente `replica` exige 8.093 linhas de prova para 578 de código.
- **Especificações de topo pequenas.** A especificação do banco tem 52 linhas e a do vKV tem 49, em quatro partes: `main()` idempotente a crashes, um `Reconfigure` seguro, um `MakeClerk` correto e `Put`, `Get` e `CondPut` linearizáveis. A prova do banco usa apenas essas especificações.
- **Bugs descartados.** As provas explicam por que um primário antigo não consegue confirmar depois de selado, por que operações não confirmadas em um log podem ser confirmadas depois com segurança, por que uma longa pausa após a checagem do lease (um garbage collection, por exemplo) não quebra uma leitura, por que um `Put` não consegue mudar um valor em cache e por que o `GetAndCache` não consegue encurtar um lease.
- **Contra o Redis.** Em um core, o vKV chega a 67.360, 75.174 e 87.634 requisições por segundo com 100%, 50% e 5% de escritas, contra 99.066, 107.028 e 118.594 do Redis, o que os autores resumem como 67 a 73% do Redis. A latência de leitura sob carga baixa é de 126 µs contra 81 µs, e a de escrita de 603 µs contra 538 µs. A média é de 10 execuções, com desvio padrão de 1 a 2% no Redis e de 7 a 11% no vKV. Com 8 cores, o vKV chega a 5,1× seu throughput de um core com 5% de escritas.
- **Réplicas.** Com 5% de escritas, 3 servidores dão 1,7× o throughput de um, e com 0% de escritas 2,3×. A introdução traz 463.491 e 816.252 requisições por segundo para uma carga com 95% de leituras em 1 e 3 servidores. Com 50% e 100% de escritas, mais réplicas reduzem o throughput, já que as escritas custam mais no primário e poucas leituras são desviadas.
- **Reconfiguração.** Depois que o primário é morto aos 10 segundos, as leituras continuam no backup. O throughput cai, se recupera em parte e volta a cair conforme leituras de chaves com escritas em andamento ficam presas até a nova configuração começar. A reconfiguração inteira, copiando 1 milhão de pares de 128 bytes, leva cerca de 4 segundos, quase tudo em serializar e enviar o estado.
- **Leases adicionados depois.** O primeiro vRSM e vKV não tinham leases, então todo `Get` era replicado. As provas de replicação e reconfiguração permaneceram as mesmas, e uma prova nova por cima mostra que possuir a época atual significa que uma réplica está pelo menos tão atualizada quanto as operações confirmadas.

## Análise crítica

O artigo é franco sobre o que o Grove não cobre.

- **Só safety.** O Grove não consegue verificar liveness, então nada prova que o cliente recebe uma resposta nem que a reconfiguração termina. A lógica que decide quando reconfigurar não é mostrada e a safety é independente dela, e as escritas bloqueiam enquanto algum backup estiver indisponível.
- **Base de referência.** Os autores observam que o Redis mira outros objetivos (um core, sem replicação síncrona, sem reconfiguração ao vivo, sem exactly-once) e que o vKV guarda um ID de requisição de 16 bytes por operação. A variância do vKV em um core é atribuída ao runtime do Go.
- **Maquinaria para especialistas.** Vários componentes estão só na versão estendida, e as técnicas de mais baixo nível são oferecidas a especialistas em Iris.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **O comportamento sob falha é medido uma vez.** O experimento de reconfiguração é um crash, uma configuração de dois servidores e um tamanho de estado. O tempo é dominado por mover todo o estado, então provavelmente cresce com o volume de dados, mas nenhum outro tamanho é testado e nenhum outro sistema é comparado.
- **O resumo e o corpo diferem um pouco.** O resumo diz cerca de 2× ao ir de 1 para 3 servidores, o corpo dá 1,7× e 2,3× conforme a proporção de escritas, e os números da introdução dão cerca de 1,76×. Aqui valem os números do corpo. Do mesmo modo, as razões da Figura 11 dão cerca de 68% a 74%, contra os 67 a 73% declarados, uma pequena diferença de arredondamento.
- **A escala é pequena.** A escalabilidade para em 3 servidores, e as chaves são uniformes com valores de 128 bytes, então cargas com distribuição enviesada, clusters maiores e valores maiores não são testados. Com a confirmação em todas as réplicas, o caminho de escrita não melhora com mais réplicas.
- **Os leases são mostrados de forma indireta.** O texto diz que os leases importam para o desempenho de leitura, mas a Figura 13 mostra a escala com servidores, não o vKV com e sem leases, embora existisse uma versão sem leases. O `cachekv`, o serviço de locks e o banco são provados, mas não medidos.
- **O esforço de prova é em linhas, não em tempo.** A razão de 12× compara linhas entre projetos em Dafny, Go e Coq que provam propriedades diferentes, como os autores admitem em parte. Tempo de pessoas, tempo de checagem das provas e o esforço da mudança dos leases não são reportados.
- **A busca de bugs é por argumento.** Os cenários de "e se" explicam onde uma prova travaria, mas não há bugs injetados nem bugs achados em versões não verificadas, então "elimina classes amplas de bugs" se apoia em raciocínio.
- **O modelo carrega peso.** As garantias valem sob o modelo de execução: relógios dentro de limites conhecidos, arquivos duráveis que sobrevivem a crashes e código de rede e de sistema de arquivos confiado. O texto não diz como essas hipóteses foram checadas contra relógios e comportamento de `fsync` reais, e o modelo não tem corrupção de disco nem nós maliciosos.

## Pesquisas futuras

- Raciocínio sobre liveness, que o Grove não faz hoje, talvez para o detector de falhas e a política de reconfiguração que o vKV deixa fora da prova.
- Reaproveitar invariantes limitados no tempo em outros protocolos de lease, por exemplo os roster leases do [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases), cuja garantia é uma prova concisa e uma especificação em TLA+ (um pareamento meu, o artigo é anterior ao Bodega).
- Uma reconfiguração que não passe todo o estado por uma única réplica, com medições em vários tamanhos de estado e falhas repetidas.
- Validar o modelo contra sistemas reais (erro de relógio, `fsync`, falhas de disco) e reportar o esforço de prova em tempo, para comparar o custo com ferramentas como o [Verus](/papers/verus-practical-foundation-for-systems-verification), que o artigo não cita mas cujo VerusSync toma emprestadas álgebras de recursos da CSL, e com o [RustBelt](/papers/rustbelt-securing-foundations-of-rust), outra prova construída sobre o Iris.
